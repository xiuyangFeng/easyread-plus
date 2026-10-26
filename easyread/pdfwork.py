"""PDF 相关的机械活：渲染原页、抽文字和字符坐标、裁图、给译文段落定位原页区域。

这里不做任何翻译，也不调用模型。
"""
from __future__ import annotations

import json
import re
import threading
import unicodedata
from pathlib import Path

from .log import log
from .store import write_json_atomic

_pdfium_lock = threading.Lock()


def render_pages(pdf: Path, out_dir: Path, scale: float = 2.4, quality: int = 84) -> list[dict]:
    import pypdfium2 as pdfium

    out_dir.mkdir(parents=True, exist_ok=True)
    with _pdfium_lock:
        doc = pdfium.PdfDocument(str(pdf))
        try:
            pages = []
            for i in range(len(doc)):
                page = doc[i]
                w, h = page.get_size()
                img = page.render(scale=scale).to_pil().convert("RGB")
                name = f"page-{i + 1:03d}.webp"
                img.save(out_dir / name, "WEBP", quality=quality, method=5)
                pages.append({"n": i + 1, "w": round(w, 2), "h": round(h, 2), "img": f"pages/{name}"})
            return pages
        finally:
            doc.close()


def extract_text(pdf: Path, out_dir: Path) -> int:
    """每页一份 .txt（给 agent 读）和 .chars.json（给定位用，坐标按页宽高归一化）。"""
    import pdfplumber
    import pypdfium2 as pdfium

    out_dir.mkdir(parents=True, exist_ok=True)
    with _pdfium_lock:
        doc = pdfium.PdfDocument(str(pdf))
        try:
            for i in range(len(doc)):
                tp = doc[i].get_textpage()
                (out_dir / f"page-{i + 1:03d}.txt").write_text(tp.get_text_range(), encoding="utf-8")
        finally:
            doc.close()
    with pdfplumber.open(str(pdf)) as plumb:
        for i, page in enumerate(plumb.pages):
            W, H = float(page.width), float(page.height)
            chars = [
                [c["text"], round(c["x0"] / W, 4), round(c["top"] / H, 4), round(c["x1"] / W, 4), round(c["bottom"] / H, 4)]
                for c in page.chars
            ]
            (out_dir / f"page-{i + 1:03d}.chars.json").write_text(json.dumps(chars, ensure_ascii=False), encoding="utf-8")
        return len(plumb.pages)


def crop(root: Path, page: int, box: list[float], out_name: str, scale: float = 3.0) -> str:
    """box 是按页宽高归一化的 [x0, y0, x1, y1]；输出到 figures/，返回相对路径。"""
    import pypdfium2 as pdfium

    with _pdfium_lock:
        doc = pdfium.PdfDocument(str(root / "source.pdf"))
        try:
            img = doc[page - 1].render(scale=scale).to_pil().convert("RGB")
        finally:
            doc.close()
    W, H = img.size
    x0, y0, x1, y1 = box
    part = img.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
    (root / "figures").mkdir(exist_ok=True)
    rel = f"figures/{out_name}.webp"
    part.save(root / rel, "WEBP", quality=90)
    return rel


# ---------- 定位：译文段落 -> 原页区域 ----------

_MATH = re.compile(r"\$[^$]*\$")
_ALNUM = re.compile(r"[a-z0-9]")


def _norm(s: str) -> str:
    return "".join(_ALNUM.findall(unicodedata.normalize("NFKC", s).lower()))


def _page_stream(extract_dir: Path, n: int):
    path = extract_dir / f"page-{n:03d}.chars.json"
    if not path.exists():
        return None
    chars = json.loads(path.read_text(encoding="utf-8"))
    text, idx = [], []
    for k, c in enumerate(chars):
        for t in _norm(c[0]):  # 连字 ﬁ/ﬂ 会展开成两个字母，指向同一个字符框
            text.append(t)
            idx.append(k)
    return "".join(text), idx, chars


def _anchors(en: str) -> tuple[str, str]:
    plain_parts = [p for p in _MATH.split(en) if _norm(p)]
    if not plain_parts:
        return "", ""
    head = _norm(plain_parts[0])[:28]
    tail = _norm(plain_parts[-1])[-28:]
    return head, tail


def _box(chars, idx, a: int, b: int):
    sel = [chars[idx[k]] for k in range(a, min(b, len(idx) - 1) + 1)]
    return [min(c[1] for c in sel), min(c[2] for c in sel), max(c[3] for c in sel), max(c[4] for c in sel)]


def block_english(block: dict) -> str:
    if block.get("type") == "list":
        return " ".join(it.get("en", "") for it in block.get("items", []))
    if block.get("type") in ("table", "figure"):
        return block.get("caption_en", "")
    return block.get("en", "")


def locate(root: Path) -> dict:
    paper = json.loads((root / "paper.json").read_text(encoding="utf-8"))
    extract_dir = root / "extract"
    streams: dict[int, tuple] = {}
    layout: dict[str, dict] = {}
    cursor: dict[int, int] = {}
    for block in paper.get("blocks", []):
        bid, page = block.get("id"), block.get("page")
        if not bid or not page:
            continue
        if block.get("box"):
            layout[bid] = {"page": page, "box": block["box"], "src": "manual"}
            continue
        head, tail = _anchors(block_english(block))
        if not head:
            continue
        for pn in (page, page + 1):
            if pn not in streams:
                streams[pn] = _page_stream(extract_dir, pn)
            st = streams[pn]
            if not st:
                continue
            text, idx, chars = st
            a = text.find(head, cursor.get(pn, 0) if pn == page else 0)
            if a < 0:
                a = text.find(head)
            if a < 0:
                continue
            b = text.find(tail, a) if tail else -1
            end = b + len(tail) - 1 if b >= 0 else min(a + len(_norm(block_english(block))), len(idx) - 1)
            layout[bid] = {"page": pn, "box": _box(chars, idx, a, end), "src": "text" if b >= 0 else "head"}
            cursor[pn] = end
            break
    _extend_captioned(paper.get("blocks", []), layout)
    _clamp_overlaps(layout)
    _fill_gaps(paper.get("blocks", []), layout)
    write_json_atomic(root / "layout.json", layout)
    return layout


def _extend_captioned(blocks: list[dict], layout: dict):
    """表格/图只匹配到了题注，把框往上撑到前一个同页块的下沿（题注在上方的往下撑）。"""
    for i, block in enumerate(blocks):
        loc = layout.get(block.get("id"))
        if block.get("type") not in ("table", "figure") or not loc or loc.get("src") == "manual":
            continue
        page = loc["page"]
        x0, y0, x1, y1 = loc["box"]
        if block.get("caption_pos", "below") == "below":
            prev = next((layout[b["id"]] for b in reversed(blocks[:i]) if layout.get(b.get("id"), {}).get("page") == page), None)
            y0 = prev["box"][3] + 0.005 if prev and prev["box"][3] < y0 else 0.08
        else:
            nxt = next((layout[b["id"]] for b in blocks[i + 1:] if layout.get(b.get("id"), {}).get("page") == page), None)
            y1 = nxt["box"][1] - 0.005 if nxt and nxt["box"][1] > y1 else 0.92
        loc["box"] = [min(x0, 0.15), round(y0, 4), max(x1, 0.85), round(y1, 4)]


def _clamp_overlaps(layout: dict):
    """只匹配到开头的块按长度估了结尾，可能压到下一块；截到下一块上沿。"""
    by_page: dict[int, list] = {}
    for loc in layout.values():
        by_page.setdefault(loc["page"], []).append(loc)
    for locs in by_page.values():
        locs.sort(key=lambda l: l["box"][1])
        for cur, nxt in zip(locs, locs[1:]):
            if cur["src"] in ("head", "text") and cur["box"][3] > nxt["box"][1] > cur["box"][1]:
                cur["box"][3] = round(nxt["box"][1] - 0.002, 4)


def _fill_gaps(blocks: list[dict], layout: dict):
    """公式这类没有英文可匹配的块：放在下一个同页块之上、它上方最近一个块之下。"""
    for i, block in enumerate(blocks):
        bid = block.get("id")
        if not bid or bid in layout or not block.get("page"):
            continue
        page = block["page"]
        nxt = next((layout[b["id"]] for b in blocks[i + 1:] if layout.get(b.get("id"), {}).get("page") == page), None)
        bottom = nxt["box"][1] if nxt else 0.92
        above = [l["box"][3] for l in layout.values() if l["page"] == page and l["box"][3] <= bottom + 0.001]
        top = max(above) if above else 0.08
        if bottom - top < 0.01:
            bottom = top + 0.04
        layout[bid] = {"page": page, "box": [0.12, round(top, 4), 0.88, round(bottom, 4)], "src": "between"}


def engine_image(root: Path, n: int) -> Path:
    """给翻译模型看的原页图（JPEG，模型工具普遍支持），按需生成。"""
    out = root / "extract" / f"page-{n:03d}.jpg"
    if not out.exists():
        import pypdfium2 as pdfium
        with _pdfium_lock:
            if not out.exists():
                doc = pdfium.PdfDocument(str(root / "source.pdf"))
                try:
                    doc[n - 1].render(scale=2.0).to_pil().convert("RGB").save(out, "JPEG", quality=82)
                finally:
                    doc.close()
    return out


def page_variant(root: Path, rel: str, width: int) -> Path | None:
    """原页图的缩小版（原图 2.4 倍渲染、约 1500 像素宽，右侧面板用不着那么大）。生成一次缓存在 pages/w{宽}/。"""
    width = max(400, min(2000, width // 100 * 100))
    src = (root / rel).resolve()
    if not src.is_relative_to((root / "pages").resolve()) or not src.is_file():
        return None
    out = root / "pages" / f"w{width}" / src.name
    if not out.exists():
        from PIL import Image
        out.parent.mkdir(exist_ok=True)
        with Image.open(src) as im:
            if im.width <= width:
                return src
            im.resize((width, round(im.height * width / im.width)), Image.LANCZOS).save(out, "WEBP", quality=80, method=4)
    return out


PANEL_WIDTH = 1000  # 原页面板默认要的宽度（阅读页按面板宽度只会要 1000 或 1600）


def warm_variants(root: Path, width: int = PANEL_WIDTH) -> None:
    """后台把整篇的面板图都先生成好，打开原页面板时不用等。"""
    for src in sorted((root / "pages").glob("page-*.webp")):
        if not (root / "pages" / f"w{width}" / src.name).exists():
            page_variant(root, f"pages/{src.name}", width)


def prepare(root: Path) -> list[dict]:
    """渲染原页 + 抽文字，返回 meta.pages。"""
    pages = render_pages(root / "source.pdf", root / "pages")
    extract_text(root / "source.pdf", root / "extract")
    return pages


def crop_figures(root: Path, paper: dict | None = None) -> dict[str, str]:
    """给没有 src 的 figure 块自动从原页裁出插图（去掉英文题注与四周白边），缓存在 figures/<id>.webp。"""
    if paper is None:
        pfile = root / "paper.json"
        if not pfile.exists():
            return {}
        paper = json.loads(pfile.read_text(encoding="utf-8"))
    blocks = paper.get("blocks", [])
    figs = [b for b in blocks if b.get("type") == "figure" and b.get("id")]
    if not figs:
        return {}

    out: dict[str, str] = {}
    need: list[dict] = []
    for b in figs:
        bid = b["id"]
        rel = b.get("src") or f"figures/{bid}.webp"
        if (root / rel).is_file():
            out[bid] = rel
        else:
            need.append(b)
    if not need:
        return out

    from PIL import Image, ImageChops

    extract_dir = root / "extract"
    streams: dict[int, tuple] = {}
    raw_boxes: dict[str, tuple[int, list[float]]] = {}
    cursor: dict[int, int] = {}
    for b in blocks:
        bid, page = b.get("id"), b.get("page")
        if not bid or not page:
            continue
        head, tail = _anchors(block_english(b))
        if not head:
            continue
        for pn in (page, page + 1):
            if pn not in streams:
                streams[pn] = _page_stream(extract_dir, pn)
            st = streams[pn]
            if not st:
                continue
            text, idx, chars = st
            a = text.find(head, cursor.get(pn, 0) if pn == page else 0)
            if a < 0:
                a = text.find(head)
            if a < 0:
                continue
            t_pos = text.find(tail, a) if tail else -1
            end = t_pos + len(tail) - 1 if t_pos >= 0 else min(a + len(_norm(block_english(b))), len(idx) - 1)
            raw_boxes[bid] = (pn, _box(chars, idx, a, end))
            cursor[pn] = end
            break

    (root / "figures").mkdir(exist_ok=True)
    for b in need:
        bid = b["id"]
        if bid not in raw_boxes:
            continue
        page, cbox = raw_boxes[bid]
        cx0, cy0, cx1, cy1 = cbox
        if cx1 <= 0.51:
            x0, x1 = max(0.04, cx0 - 0.01), min(0.495, cx1 + 0.01)
        elif cx0 >= 0.49:
            x0, x1 = max(0.505, cx0 - 0.01), min(0.96, cx1 + 0.01)
        else:
            x0, x1 = max(0.04, min(cx0, 0.10) - 0.01), min(0.96, max(cx1, 0.90) + 0.01)

        if b.get("caption_pos", "below") == "below":
            above = [
                ob[3] for oid, (op, ob) in raw_boxes.items()
                if oid != bid and op == page and ob[3] <= cy0 + 0.008
                and min(x1, ob[2]) - max(x0, ob[0]) > 0.04
            ]
            y0 = max(above) + 0.005 if above else 0.052
            y1 = cy0 - 0.005
        else:
            below = [
                ob[1] for oid, (op, ob) in raw_boxes.items()
                if oid != bid and op == page and ob[1] >= cy1 - 0.008
                and min(x1, ob[2]) - max(x0, ob[0]) > 0.04
            ]
            y0 = cy1 + 0.005
            y1 = min(below) - 0.005 if below else 0.92

        if y1 - y0 < 0.04:
            continue
        page_img = root / "pages" / f"page-{page:03d}.webp"
        if not page_img.is_file():
            continue
        try:
            with Image.open(page_img) as im:
                W, H = im.size
                part = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))).convert("RGB")
                bg = Image.new("RGB", part.size, (255, 255, 255))
                diff = ImageChops.difference(part, bg).convert("L").point(lambda p: 255 if p > 15 else 0)
                bbox = diff.getbbox()
                if not bbox:
                    continue
                pad = 10
                bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(part.width, bbox[2] + pad), min(part.height, bbox[3] + pad))
                part = part.crop(bbox)
                if part.width < 40 or part.height < 30:
                    continue
                rel = f"figures/{bid}.webp"
                part.save(root / rel, "WEBP", quality=90)
                out[bid] = rel
        except Exception:  # noqa: BLE001
            continue
    return out


def fill_figure_srcs(ws) -> None:
    """给 paper.json 里没有 src 的 figure 块补上裁好的插图并落盘，阅读页就能内联看图。
    打开论文和翻译结束时各调一次；图都缓存过时只是读一遍 paper.json，失败不影响阅读。"""
    try:
        paper = ws.load("paper")
        if not paper or not any(b.get("type") == "figure" and not b.get("src") for b in paper.get("blocks", [])):
            return
        fig_map = crop_figures(ws.root, paper)
        if not fig_map:
            return

        def apply(p):
            for b in p.get("blocks", []):
                if b.get("type") == "figure" and not b.get("src") and fig_map.get(b.get("id")):
                    b["src"] = fig_map[b["id"]]
        ws.update("paper", apply)
    except Exception:  # noqa: BLE001
        log.exception("补齐插图失败 %s", getattr(ws, "id", ws))

