"""库内引用关系：一篇论文的参考文献里，有没有文献库里的另一篇。

按标题认：去掉大小写、标点、空格、公式记号（$G^3e$ 和 G3e 算同一个）后，看参考文献条目里是否包含那篇的英文标题；
标题太短的（规范化后不足 24 个字符）容易误配，只用 arXiv 编号和 DOI 认。
结果按各篇 paper.json / item.json 的修改时间缓存，文件不变就不重算。
"""
from __future__ import annotations

import re
import threading
import unicodedata

from .sources import ARXIV_RE
from .store import file_version

MIN_TITLE = 24

_cache: dict = {"sig": None, "data": None}
_lock = threading.Lock()


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", s.lower())


def meta_of(ws) -> dict:
    meta = dict((ws.load("paper") or {}).get("meta") or {})
    meta.update({k: v for k, v in ((ws.load("item") or {}).get("meta_override") or {}).items() if v})
    return meta


def keys_of(meta: dict) -> tuple[list[str], list[str]]:
    """(规范化标题，可能带主标题；arXiv 编号和 DOI，小写)。"""
    title = meta.get("title_en") or ""
    titles: list[str] = []
    for cand in (title, re.split(r"[:：]\s", title)[0]):
        n = norm(cand)
        if len(n) >= MIN_TITLE and n not in titles:
            titles.append(n)
    ids: list[str] = []
    m = ARXIV_RE.search(meta.get("arxiv") or "")
    if m:
        ids.append(re.sub(r"v\d+$", "", m.group(1)).lower())
    if meta.get("doi"):
        ids.append(str(meta["doi"]).lower())
    return titles, ids


def graph(lib) -> dict:
    """{"edges": [{"from": 引用方 id, "to": 被引方 id, "ref": 引用方参考文献里的条目 id}]}"""
    wss = lib.all()
    sig = tuple((ws.id, file_version(ws.paper_path), file_version(ws.item_path)) for ws in wss)
    with _lock:
        if _cache["sig"] == sig:
            return _cache["data"]
    papers = []
    for ws in wss:
        paper = ws.load("paper") or {}
        titles, ids = keys_of(meta_of(ws))
        refs = [(str(r.get("id")), norm(r.get("text")), (r.get("text") or "").lower()) for r in paper.get("references") or []]
        papers.append((ws.id, titles, ids, refs))
    edges = []
    for pid, _, _, refs in papers:
        if not refs:
            continue
        joined = "|".join(r[1] for r in refs)  # 规范化后只剩字母数字，| 不会出现在里面
        raw = "\n".join(r[2] for r in refs)
        for tid, titles, ids, _ in papers:
            if tid == pid:
                continue
            hit = None
            if any(t in joined for t in titles):
                hit = next((rid for rid, n, _ in refs if any(t in n for t in titles)), None)
            if not hit and any(i in raw for i in ids):
                hit = next((rid for rid, _, r in refs if any(i in r for i in ids)), None)
            if hit:
                edges.append({"from": pid, "to": tid, "ref": hit})
    data = {"edges": edges}
    with _lock:
        _cache.update(sig=sig, data=data)
    return data


def counts(lib) -> dict[str, tuple[int, int]]:
    """每篇：(引用了库里几篇, 被库里几篇引用)。"""
    out: dict[str, list[int]] = {}
    for e in graph(lib)["edges"]:
        out.setdefault(e["from"], [0, 0])[0] += 1
        out.setdefault(e["to"], [0, 0])[1] += 1
    return {k: (a, b) for k, (a, b) in out.items()}


def refs_in_library(lib, pid: str) -> dict[str, str]:
    """这篇的参考文献里，哪些条目就是库里的论文：{条目 id: 论文 id}。"""
    return {e["ref"]: e["to"] for e in graph(lib)["edges"] if e["from"] == pid}
