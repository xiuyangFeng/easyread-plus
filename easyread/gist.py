"""段落主旨与论文脉络。

让设置里的模型按章节读译文，给每段写一句主旨，标出它在论证里的角色、和上一段怎么接；
全部段落写完后再看一遍全文的主旨，提炼故事线、每节在做什么、核心论点和支撑它们的段落 / 图 / 表。

结果存在 gist.json（和 discussion.json 一样由“翻译方”写，页面只读）：
  blocks[段落 id]  = {gist, role, link, why, h, at}   h 是生成时这段译文的指纹，译文改了就知道过时了
                     读者改过的条目 by="me"，原来的 AI 版本放在 ai 里；重新生成不会覆盖读者改的
  sections[标题 id] = {gist}
  story            = 全文故事线（两三句）
  claims           = [{id, claim, kind, support: [{id, how}], weak}]
  floats[图表 id]   = {q, look}      这张图 / 表回答什么问题、看的时候先看哪里比什么
  links            = [{from, to, rel, note}]      图表之间、结果段落之间的关系（对照、递进、推广……）
  chains           = [{id, title, steps: [{id, note}], conclusion}]   结果链：从哪段结果经过哪些图表推出什么
"""
from __future__ import annotations

import threading
import re
from concurrent.futures import ThreadPoolExecutor

from . import engines
from .log import log
from .store import Workspace, now_iso, text_hash
from .store import empty_gist as empty  # noqa: F401  页面和测试用 gist.empty()

ROLES = ["概述", "背景", "问题", "思路", "方法", "设定", "结果", "对比", "解释", "局限", "结论"]
LINKS = ["开启", "递进", "转折", "举例", "证据", "细化", "并列", "总结"]
KINDS = ["主结论", "方法主张", "次要结论"]
RELS = ["对照", "递进", "推广", "细化", "互证", "补充", "反差"]
CHUNK_CHARS = 5000   # 一次交给模型的译文字数上限（同一节太长就切开，后一段带上前一段最后的主旨）
MIN_CHARS = 24       # 太短的段（公式后的“其中 …”半句）不写主旨
# 文末的事务性章节（致谢、各种声明、作者贡献、数据可用性、资助）不属于论证，不送给模型。页面 mappanel.js 里有同一条规则
SKIP_SECTIONS = re.compile(r"致谢|声明|利益|作者贡献|CRediT|可用性|资助|基金|附加信息|补充信息|参考文献|Acknowledg|Declaration|Funding|Availability", re.I)


def _title(b: dict) -> str:
    """“2 2. 方法”这种：译文里已经带了编号就不再加"""
    num, zh = str(b.get("num") or "").strip(), str(b.get("zh") or "").strip()
    return zh if not num or zh.startswith(num) else f"{num} {zh}"


# ---------- 读论文 ----------
def _text(paper_block: dict, edits: dict) -> str:
    """和页面 PR.textFor 一样：读者改过的译文优先。列表把各项连起来。"""
    def pick(key, default):
        e = edits.get(key)
        return e["zh"] if e and e.get("zh") is not None else default
    b = paper_block
    if b.get("type") == "list":
        return "\n".join(pick(f"{b['id']}#{i}", it.get("zh", "")) for i, it in enumerate(b.get("items", [])))
    return pick(b["id"], b.get("zh", ""))


def outline(ws: Workspace) -> dict:
    """按一级标题分节，收集要写主旨的段落。参考文献之后（附录）照样算，参考文献本身不算。"""
    paper = ws.load("paper")
    edits = (ws.load("reader") or {}).get("edits", {})
    sections, cur, sub, in_refs = [], None, "", False
    for b in paper.get("blocks", []):
        t = b.get("type")
        if t == "references":
            cur, in_refs = None, True
            continue
        if t == "heading" and (b.get("level") or 1) == 1:
            cur = {"id": b["id"], "title": _title(b), "paras": []}
            sections.append(cur)
            sub, in_refs = "", bool(SKIP_SECTIONS.search(cur["title"]))  # 事务性章节整节跳过
            continue
        if in_refs:  # 参考文献列表后面、下一个标题前面的零碎（版权页、作者简介），以及事务性章节
            continue
        if t == "heading":
            sub = _title(b)
            continue
        if t not in ("para", "list"):
            continue
        text = _text(b, edits).strip()
        if len(text) < MIN_CHARS:
            continue
        if cur is None:  # 第一个标题之前（摘要）
            cur = {"id": "_front", "title": "摘要" if b.get("role") == "abstract" else "开头", "paras": []}
            sections.append(cur)
        cur["paras"].append({"id": b["id"], "text": text, "sub": sub, "h": text_hash(text), "abstract": b.get("role") == "abstract"})
    floats = [{"id": b["id"], "kind": "图" if b["type"] == "figure" else "表", "num": str(b.get("num") or ""),
               "label": (b.get("caption_zh") or "")[:80], "caption": (b.get("caption_zh") or "")[:160]}
              for b in paper.get("blocks", []) if b.get("type") in ("figure", "table") and b.get("caption_zh")]
    # 每段提到了哪些图表（和页面把“图 7”“表 2”变成链接的规则一样）
    by_num = {(f["kind"], f["num"]): f["id"] for f in floats if f["num"]}
    for sec in sections:
        for p in sec["paras"]:
            refs = []
            for kind, num in re.findall(r"(图|表)\s*(\d+)", p["text"]):
                fid = by_num.get((kind, num))
                if fid and fid not in refs:
                    refs.append(fid)
            p["refs"] = refs
    meta = paper.get("meta", {})
    return {"title": meta.get("title_zh") or meta.get("title_en") or "", "sections": [s for s in sections if s["paras"]], "floats": floats}


def _chunks(paras: list[dict]) -> list[list[dict]]:
    out, cur, size = [], [], 0
    for p in paras:
        if cur and size + len(p["text"]) > CHUNK_CHARS:
            out.append(cur)
            cur, size = [], 0
        cur.append(p)
        size += len(p["text"])
    if cur:
        out.append(cur)
    return out


# ---------- 提示词 ----------
def _prompt_paras(o: dict, sec: dict, chunk: list[dict], prev: str, only: set[str] | None = None) -> str:
    heads = " / ".join(s["title"] for s in o["sections"])
    body = "\n\n".join(f"[{p['id']}]" + (f"（{p['sub']}）" if p["sub"] else "") + f"\n{p['text']}" for p in chunk)
    want = f"只需要输出这几段：{', '.join(sorted(only))}（其余段落是上下文）。" if only else "每一段都要输出。"
    return (
        f"你在帮读者理清论文《{o['title']}》的论证脉络。论文的章节：{heads}。\n"
        f"现在读的是「{sec['title']}」" + (f"，前面一段的主旨是：{prev}" if prev else "，这是本节开头") + "。\n\n"
        f"下面是这一节的段落（中文译文，方括号里是段落 id）：\n\n{body}\n\n"
        f"请给每一段写：\n"
        f"- gist：一句话主旨，不超过 24 个字。用自己的话说出这段在讲什么、得出什么，不要照抄首句，不要“本段介绍了”这类套话。\n"
        f"- role：这段在论证里的角色，只能从这些里选一个：{'、'.join(ROLES)}。摘要用“概述”。\n"
        f"- link：和上一段的关系，只能选一个：{'、'.join(LINKS)}。本节第一段用“开启”。\n"
        f"- why：不超过 40 字，说明为什么这么概括、它怎么承接上一段。\n"
        f"{want}只依据给出的文字，不要编造。\n\n"
        '只输出 JSON：{"blocks": [{"id": "段落 id", "gist": "", "role": "", "link": "", "why": ""}]}'
    )


def _prompt_structure(o: dict, data: dict) -> str:
    lines = []
    for s in o["sections"]:
        lines.append(f"## {s['title']}  [{s['id']}]")
        for p in s["paras"]:
            g = data["blocks"].get(p["id"])
            if g:
                lines.append(f"[{p['id']}] {g.get('role', '')}｜{g.get('gist', '')}")
    floats = "\n".join(f"[{f['id']}] {f['label']}" for f in o["floats"]) or "（无）"
    return (
        f"下面是论文《{o['title']}》每一段的主旨（方括号里是段落 id，竖线前是这段在论证里的角色）：\n\n" + "\n".join(lines) +
        f"\n\n论文里的图和表：\n{floats}\n\n"
        "请据此整理全文的论证结构：\n"
        "- story：全文的故事线，两三句话：要解决什么问题、怎么做、证明了什么。\n"
        "- sections：每一节在全文里做什么，每节一句话，不超过 30 字；id 用上面 ## 后面方括号里的 id。\n"
        f"- claims：论文的 3–6 个核心论点。kind 只能是：{'、'.join(KINDS)}。claim 不超过 40 字。"
        "support 列出直接支撑它的段落、图、表（id 必须是上面出现过的），how 不超过 20 字说明怎么支撑（如“定量对比”“消融实验”）。"
        "如果某个论点的证据明显单薄（只有一处、没有对比、样本少），在 weak 里用一句话指出，否则 weak 留空。\n"
        "只依据给出的内容，不要编造。\n\n"
        '只输出 JSON：{"story": "", "sections": [{"id": "", "gist": ""}], '
        '"claims": [{"claim": "", "kind": "", "support": [{"id": "", "how": ""}], "weak": ""}]}'
    )


def _prompt_relations(o: dict, data: dict) -> str:
    gs = data["blocks"]
    mentioned: dict[str, list[str]] = {}
    lines = []
    for sec in o["sections"]:
        for p in sec["paras"]:
            for fid in p.get("refs", []):
                mentioned.setdefault(fid, []).append(p["id"])
            g = gs.get(p["id"])
            if g and (g.get("role") in ("结果", "对比", "解释", "结论", "局限") or p.get("refs")):
                refs = "、".join(f["kind"] + f["num"] for f in o["floats"] if f["id"] in p.get("refs", []))
                lines.append(f"[{p['id']}]（{sec['title'][:12]}）{g.get('role', '')}｜{g.get('gist', '')}" + (f"　提到：{refs}" if refs else ""))
    floats = "\n".join(f"[{f['id']}] {f['caption']}" + (f"　被这些段提到：{', '.join(mentioned[f['id']][:6])}" if f["id"] in mentioned else "")
                       for f in o["floats"]) or "（无）"
    return (
        f"下面是论文《{o['title']}》的图表和与结果相关的段落（方括号里是 id）。\n\n图表：\n{floats}\n\n"
        "结果相关的段落（角色｜主旨）：\n" + ("\n".join(lines) or "（无）") + "\n\n"
        "请帮读者理清“图与图、结果与结果之间”的逻辑：\n"
        "- floats：每张图表一条。q 不超过 30 字，说这张图 / 表回答什么问题；look 不超过 50 字，告诉读者看的时候先看哪里、比什么、结论是什么。\n"
        f"- links：图表之间、结果段落之间值得注意的关系，6–20 条。rel 只能是：{'、'.join(RELS)}。"
        "（对照：同一设置下比两个条件；递进：后者在前者基础上更进一步；推广：换数据集 / 场景验证；细化：放大局部或拆开看；互证：不同方式得出同一结论；补充：补充信息；反差：结论不一致或有例外。）"
        "note 不超过 30 字，说清楚两者怎么联系。from 在前、to 在后，按论文顺序。\n"
        "- chains：2–4 条结果链，每条是论文用来证明一件事的证据顺序。title 不超过 16 字；steps 按顺序列出 3–7 步，"
        "把结果段落和它所依据的图表交替串起来（比如：段落 → 图 → 表 → 段落），有图表的链每条至少包含一张图或表；每步 note 不超过 20 字；"
        "conclusion 不超过 40 字，说这条链最后证明了什么。\n"
        "id 只能用上面出现过的。只依据给出的内容，不要编造。\n\n"
        '只输出 JSON：{"floats": [{"id": "", "q": "", "look": ""}], "links": [{"from": "", "to": "", "rel": "", "note": ""}], '
        '"chains": [{"title": "", "steps": [{"id": "", "note": ""}], "conclusion": ""}]}'
    )


def relations(ws: Workspace, cfg: dict, cancel) -> None:
    """图表之间、结果之间的关系和结果链。需要先有段落主旨。"""
    o = outline(ws)
    data = load(ws)
    if not data["blocks"]:
        raise engines.EngineError("还没有段落主旨，先生成主旨")
    res = engines.parse_json(engines.run(cfg, _prompt_relations(o, data), ws.root, None, cancel))
    if not isinstance(res, dict):
        raise engines.EngineError("模型没有给出图表关系")
    float_ids = {f["id"] for f in o["floats"]}
    ok_ids = float_ids | {p["id"] for s in o["sections"] for p in s["paras"]}
    floats = {}
    for f in res.get("floats") or []:
        fid = str((f or {}).get("id"))
        if fid in float_ids and (f.get("q") or f.get("look")):
            floats[fid] = {"q": str(f.get("q") or "").strip()[:60], "look": str(f.get("look") or "").strip()[:100]}
    links, seen = [], set()
    for x in res.get("links") or []:
        a, b, rel = str((x or {}).get("from")), str((x or {}).get("to")), str((x or {}).get("rel") or "").strip()
        if a in ok_ids and b in ok_ids and a != b and (a, b) not in seen:
            seen.add((a, b))
            links.append({"from": a, "to": b, "rel": rel if rel in RELS else "补充", "note": str(x.get("note") or "").strip()[:60]})
    chains = []
    for i, c in enumerate(res.get("chains") or []):
        steps = [{"id": str(st.get("id")), "note": str(st.get("note") or "").strip()[:40]}
                 for st in (c or {}).get("steps") or [] if isinstance(st, dict) and str(st.get("id")) in ok_ids]
        if len(steps) >= 2:
            chains.append({"id": f"k{i + 1}", "title": str(c.get("title") or "结果链").strip()[:30], "steps": steps,
                           "conclusion": str(c.get("conclusion") or "").strip()[:80]})

    def apply(d):
        d.update(floats=floats, links=links, chains=chains, relations_at=now_iso())
        return d
    _update(ws, apply)


# ---------- 写回 ----------
def _clean_block(x: dict) -> dict | None:
    gist = str(x.get("gist") or "").strip()
    if not gist:
        return None
    role = str(x.get("role") or "").strip()
    link = str(x.get("link") or "").strip()
    return {"gist": gist[:60], "role": role if role in ROLES else "", "link": link if link in LINKS else "",
            "why": str(x.get("why") or "").strip()[:120]}


def _merge_blocks(ws: Workspace, got: list[dict], wanted: dict[str, dict], who: str) -> int:
    """wanted：段落 id -> 这段的 {h}。读者改过的（by=me）只更新底下的 ai 版本。"""
    n = 0

    def apply(data):
        nonlocal n
        for x in got:
            pid = str(x.get("id", ""))
            if pid not in wanted:
                continue
            clean = _clean_block(x)
            if not clean:
                continue
            entry = {**clean, "h": wanted[pid]["h"], "at": now_iso()}
            cur = data["blocks"].get(pid)
            if cur and cur.get("by") == "me":
                cur["ai"] = entry
            else:
                data["blocks"][pid] = entry
            n += 1
        data["at"], data["by"] = now_iso(), who
        return data
    _update(ws, apply)
    return n


def _update(ws: Workspace, fn) -> dict:
    return ws.update("gist", fn)


def load(ws: Workspace) -> dict:
    return ws.load("gist")


# ---------- 任务 ----------
def run(ws: Workspace, cfg: dict, mode: str, cancel: threading.Event, report, block: str | None = None) -> dict:
    """mode：missing 只补没写的和过时的；all 全部重写（读者改的保留）；block 只重写一段；
    structure 只重新提炼故事线、论点和图表关系；relations 只重新整理图表关系。
    report(done, total, message)。返回 {"blocks": 写了几段, "failed": 几批失败}。"""
    o = outline(ws)
    if mode != "block":  # 不再写主旨的段（删掉了、变短了、归到事务性章节里了）：AI 写的清掉，读者改的留着
        keep = {p["id"] for sec in o["sections"] for p in sec["paras"]}
        secs = {sec["id"] for sec in o["sections"]}
        _update(ws, lambda d: d.update(blocks={k: v for k, v in d["blocks"].items() if k in keep or v.get("by") == "me"},
                                       sections={k: v for k, v in d.get("sections", {}).items() if k in secs}) or d)
    data = load(ws)
    who = engines.who(cfg)
    jobs = []  # (节, 这一批段落, 只要哪些)
    if mode in ("missing", "all", "block"):
        for sec in o["sections"]:
            def need(p):
                if mode == "block":
                    return p["id"] == block
                cur = data["blocks"].get(p["id"])
                if mode == "all":
                    return True
                if not cur:
                    return True
                base = cur.get("ai") if cur.get("by") == "me" else cur
                return cur.get("by") != "me" and (base or {}).get("h") != p["h"]
            todo = {p["id"] for p in sec["paras"] if need(p)}
            if not todo:
                continue
            if mode == "block":  # 一段：带前后各 3 段做上下文
                i = next(i for i, p in enumerate(sec["paras"]) if p["id"] == block)
                jobs.append((sec, sec["paras"][max(0, i - 3): i + 4], todo))
            else:  # 一节里只要有一段要写，整节重读（承接关系要看上下文），只取要写的那几段
                for ch in _chunks(sec["paras"]):
                    want = {p["id"] for p in ch} & todo
                    if want:
                        jobs.append((sec, ch, want if want != {p["id"] for p in ch} else None))
        if mode == "block" and not jobs:
            raise ValueError("这段太短或不是正文段落，不写主旨")

    if mode == "relations":
        report(0, 1, "整理图表和结果之间的关系")
        relations(ws, cfg, cancel)
        report(1, 1, "完成")
        return {"blocks": 0, "failed": 0}
    total = len(jobs) + (0 if mode == "block" else 2)
    done, failed, wrote, last_err = 0, 0, 0, ""
    lock = threading.Lock()
    if not jobs and mode == "missing" and data.get("claims") and "chains" in data:
        report(1, 1, "已是最新")
        return {"blocks": 0, "failed": 0}
    report(0, total, f"读第 1/{total} 批" if jobs else "提炼故事线和论点")

    def work(item):
        nonlocal done, failed, wrote, last_err
        sec, chunk, only = item
        if cancel.is_set():
            raise engines.Cancelled()
        first = sec["paras"].index(chunk[0])
        prev_id = sec["paras"][first - 1]["id"] if first > 0 else None
        prev = (load(ws)["blocks"].get(prev_id) or {}).get("gist", "") if prev_id else ""
        prompt = _prompt_paras(o, sec, chunk, prev, only)
        got = None
        for attempt in range(2):
            try:
                res = engines.parse_json(engines.run(cfg, prompt, ws.root, None, cancel))
                got = res.get("blocks") if isinstance(res, dict) else res
                if isinstance(got, list):
                    break
                got = None
            except engines.Cancelled:
                raise
            except engines.EngineError as e:
                log.warning("主旨失败 %s %s 第 %d 次：%s", ws.id, sec["title"], attempt + 1, e)
                last_err = str(e)
                if attempt == 1 or "limit" in str(e).lower() or "额度" in str(e):
                    break
        wanted = {p["id"]: p for p in chunk if only is None or p["id"] in only}
        n = _merge_blocks(ws, got or [], wanted, who) if got else 0
        with lock:
            done += 1
            wrote += n
            failed += 0 if got else 1
            report(done, total, f"已读 {done}/{total} 批（{sec['title'][:16]}）")

    if jobs:
        # 同一节的几批按顺序（后一批要用前一批最后一段的主旨），不同节并发
        by_sec: dict[str, list] = {}
        for j in jobs:
            by_sec.setdefault(j[0]["id"], []).append(j)
        workers = max(1, min(int(cfg.get("concurrency") or 1), 4))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(lambda items: [work(it) for it in items], items) for items in by_sec.values()]
            for f in futs:
                f.result()
        if not wrote and failed:
            raise engines.EngineError(f"{failed} 批都没写成：{last_err[:300]}")

    rel_err = ""
    if mode != "block" and (wrote or mode in ("structure", "all") or not data.get("claims") or "chains" not in data):
        if cancel.is_set():
            raise engines.Cancelled()
        if wrote or mode in ("structure", "all") or not data.get("claims"):
            report(done, total, "提炼故事线和论点")
            structure(ws, cfg, cancel)
        done += 1
        report(done, total, "整理图表和结果之间的关系")
        try:  # 图表关系没整理出来不影响前面的主旨和论点
            relations(ws, cfg, cancel)
        except engines.EngineError as e:
            rel_err = str(e)[:200]
            log.warning("图表关系失败 %s：%s", ws.id, e)
        done += 1
        report(done, total, "完成")
    return {"blocks": wrote, "failed": failed, "relations_error": rel_err}


def structure(ws: Workspace, cfg: dict, cancel) -> None:
    o = outline(ws)
    data = load(ws)
    if not data["blocks"]:
        raise engines.EngineError("还没有段落主旨，先生成主旨")
    res = engines.parse_json(engines.run(cfg, _prompt_structure(o, data), ws.root, None, cancel))
    if not isinstance(res, dict):
        raise engines.EngineError("模型没有给出论文结构")
    para_ids = {p["id"] for s in o["sections"] for p in s["paras"]}
    float_ids = {f["id"] for f in o["floats"]}
    sec_ids = {s["id"] for s in o["sections"]}
    claims = []
    for i, c in enumerate(res.get("claims") or []):
        text = str(c.get("claim") or "").strip()
        if not text:
            continue
        support = [{"id": str(s.get("id")), "how": str(s.get("how") or "").strip()[:40]}
                   for s in (c.get("support") or []) if isinstance(s, dict) and str(s.get("id")) in para_ids | float_ids]
        kind = str(c.get("kind") or "").strip()
        claims.append({"id": f"c{i + 1}", "claim": text[:80], "kind": kind if kind in KINDS else "次要结论",
                       "support": support, "weak": str(c.get("weak") or "").strip()[:120]})
    sections = {str(s.get("id")): {"gist": str(s.get("gist") or "").strip()[:60]}
                for s in (res.get("sections") or []) if isinstance(s, dict) and str(s.get("id")) in sec_ids and s.get("gist")}

    def apply(d):
        d["story"] = str(res.get("story") or "").strip()[:300]
        d["sections"] = sections
        d["claims"] = claims
        d["structure_at"] = now_iso()
        return d
    _update(ws, apply)


# ---------- 读者改 ----------
def edit(ws: Workspace, block: str, gist: str | None = None, role: str | None = None, revert: bool = False) -> dict:
    o = outline(ws)
    para = next((p for s in o["sections"] for p in s["paras"] if p["id"] == block), None)
    if not para:
        raise ValueError("这段不写主旨")

    def apply(d):
        cur = d["blocks"].get(block)
        if revert:
            if cur and cur.get("ai"):
                d["blocks"][block] = cur["ai"]
            elif cur and cur.get("by") == "me":
                d["blocks"].pop(block)
            return d
        text = (gist or "").strip()
        if not text:
            raise ValueError("主旨不能为空")
        ai = (cur.get("ai") if cur and cur.get("by") == "me" else cur) or None
        entry = {"gist": text[:60], "role": role if role in ROLES else ((cur or {}).get("role") or ""),
                 "link": (cur or {}).get("link", ""), "why": "", "h": para["h"], "at": now_iso(), "by": "me"}
        if ai:
            entry["ai"] = ai
        d["blocks"][block] = entry
        return d
    return _update(ws, apply)["blocks"].get(block) or {}
