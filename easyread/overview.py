"""跨论文的汇总：全部笔记、阅读统计、文献对比表。都是现读各篇的 JSON 现算，不另存一份。"""
from __future__ import annotations

from collections import Counter

from .citegraph import meta_of


def _sections(paper: dict, edits: dict) -> tuple[dict, dict]:
    """块 id → 所在章节标题、所在页。"""
    sec, page, cur = {}, {}, ""
    for b in paper.get("blocks") or []:
        bid = b.get("id")
        if not bid:
            continue
        if b.get("type") in ("heading", "references"):
            e = edits.get(bid) or {}
            zh = e.get("zh") if e.get("zh") is not None else b.get("zh")
            text, num = (zh or b.get("en") or "").strip(), (b.get("num") or "").strip()
            cur = text if not num or text.startswith(num) else num + " " + text  # 有的译文标题自己带了编号
        sec[bid] = cur
        page[bid] = b.get("page")
    return sec, page


def _paper_info(ws, meta: dict, item: dict) -> dict:
    return {"title": meta.get("title_zh") or meta.get("title_en") or "（未命名）", "title_en": meta.get("title_en", ""),
            "short": meta.get("short_zh", ""), "tags": item.get("tags") or [], "status": item.get("status", "unread"),
            "year": meta.get("year") or "", "authors": meta.get("authors", "")}


def notes(lib) -> dict:
    """全部论文的划线、笔记、问题和论文笔记。{"notes": [...], "papers": {id: 标题等}}"""
    out, papers = [], {}
    for ws in lib.all():
        paper = ws.load("paper") or {}
        reader = ws.load("reader") or {}
        item = ws.load("item") or {}
        papers[ws.id] = _paper_info(ws, meta_of(ws), item)
        sec, page = _sections(paper, reader.get("edits") or {})
        replied = {e.get("reply_to") for e in (ws.load("discussion") or {}).get("entries", []) if e.get("reply_to")}
        for n in (reader.get("notes") or {}).values():
            if n.get("deleted") or not (n.get("quote") or n.get("body")):
                continue
            anchor = n.get("anchor") or "head"
            out.append({"pid": ws.id, "id": n.get("id"), "kind": n.get("kind") or "note", "color": n.get("color") or "",
                        "style": n.get("style") or "", "quote": n.get("quote") or "", "body": n.get("body") or "",
                        "anchor": anchor, "page": page.get(anchor), "section": sec.get(anchor, ""),
                        "created": n.get("created") or "", "updated": n.get("updated") or n.get("created") or "",
                        "answered": n.get("id") in replied})
        pn = reader.get("paper_note") or {}
        if (pn.get("body") or "").strip():
            out.append({"pid": ws.id, "id": "paper-note", "kind": "paper", "color": "", "style": "", "quote": "",
                        "body": pn["body"], "anchor": "head", "page": None, "section": "", "created": pn.get("at") or "",
                        "updated": pn.get("at") or "", "answered": False})
    out.sort(key=lambda n: n["updated"], reverse=True)
    return {"notes": out, "papers": papers}


def stats(lib) -> dict:
    """阅读统计的原始数据；本周、连续天数这些按读者本地日期在页面上算。"""
    days: Counter = Counter()
    notes_days: Counter = Counter()
    top, done = [], []
    for ws in lib.all():
        item = ws.load("item") or {}
        info = _paper_info(ws, meta_of(ws), item)
        read = item.get("read") or {}
        for d, s in (read.get("days") or {}).items():
            days[d] += int(s or 0)
        if read.get("total"):
            top.append({"pid": ws.id, "title": info["title"], "sec": int(read["total"]),
                        "days": len(read.get("days") or {}), "last": max((read.get("days") or {"": 0}).keys())})
        if item.get("status") == "done":
            done.append({"pid": ws.id, "title": info["title"], "at": item.get("done_at") or ""})
        for n in ((ws.load("reader") or {}).get("notes") or {}).values():
            if not n.get("deleted") and n.get("created"):
                notes_days[n["created"][:10]] += 1
    top.sort(key=lambda x: x["sec"], reverse=True)
    done.sort(key=lambda x: x["at"], reverse=True)
    return {"days": dict(days), "notes_days": dict(notes_days), "top": top[:10], "done": done,
            "total_sec": sum(days.values()), "papers": len(lib.all())}


def compare(lib, ids: list[str]) -> list[dict]:
    """文献对比表的一行一篇：基本信息 + 脉络里的故事线和核心论点 + 我的论文笔记。"""
    rows = []
    for pid in ids[:40]:
        ws = lib.ws(pid)
        if not ws:
            continue
        s = lib.summary(ws)
        gist = ws.load("gist") or {}
        reader = ws.load("reader") or {}
        rows.append({
            **{k: s.get(k) for k in ("id", "title_zh", "title_en", "authors", "year", "venue", "arxiv", "url", "status",
                                     "progress", "notes", "highlights", "abstract", "tags")},
            "story": gist.get("story") or "",
            "claims": [{"kind": c.get("kind", ""), "claim": c.get("claim", ""), "weak": c.get("weak", "")}
                       for c in (gist.get("claims") or [])[:6] if c.get("claim")],
            "has_gist": bool(gist.get("story") or gist.get("blocks")),
            "paper_note": ((reader.get("paper_note") or {}).get("body") or "").strip(),
        })
    return rows
