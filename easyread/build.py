"""把阅读页和一篇论文打成单个 HTML 或导出成中文 PDF：离线打开、打印、发给别人看。

单文件 HTML 里的修改存在浏览器；在页面“说明”里导出后，用 `easyread merge ID --from 导出.json` 并回文献库。
"""
from __future__ import annotations

import base64
import html as htmllib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import pdfwork
from .config import WEB
from .store import Workspace

_LINK = re.compile(r'<link rel="stylesheet" href="/web/([^"]+)"\s*/?>')
_SCRIPT = re.compile(r'<script src="/web/([^"]+)"></script>')


def _data_uri(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def _inline_css(rel: str) -> str:
    path = WEB / rel
    css = path.read_text(encoding="utf-8")
    if "katex" in rel:  # 字体转成 data URI，离线也能显示公式
        css = re.sub(r"url\((fonts/[^)]+\.woff2)\)", lambda m: f"url({_data_uri(path.parent / m.group(1), 'font/woff2')})", css)
        css = re.sub(r",\s*url\(fonts/[^)]+\.(woff|ttf)\) format\(\"(woff|truetype)\"\)", "", css)
    return f"<style>{css}</style>"


def _script(rel: str) -> str:
    js = (WEB / rel).read_text(encoding="utf-8").replace("</script", "<\\/script")
    return f"<script>{js}</script>"


def _paper_stem(paper: dict, ws_id: str) -> str:
    meta = paper.get("meta", {})
    raw = meta.get("short_zh") or meta.get("title_zh") or meta.get("title_en") or ws_id
    return re.sub(r'[\\/:*?"<>|]', "", str(raw)).strip() or ws_id


def build(
    ws: Workspace,
    out: Path | None = None,
    assets: Path | None = None,
    extra: dict | None = None,
    include_page_images: bool = True,
) -> Path:
    """assets：图片不内嵌、另存到这个目录（放到网站上时页面小很多，图按需加载）；extra：额外写进页面数据的内容。"""
    page = (WEB / "reader.html").read_text(encoding="utf-8")
    page = _LINK.sub(lambda m: _inline_css(m.group(1)), page)
    page = _SCRIPT.sub(lambda m: _script(m.group(1)), page)
    page = page.replace('<link rel="icon" href="/web/favicon.svg">', f'<link rel="icon" href="{_data_uri(WEB / "favicon.svg", "image/svg+xml")}">')
    paper = json.loads(json.dumps(ws.load("paper")))
    item = ws.load("item")
    for k, v in (item.get("meta_override") or {}).items():
        if v:
            paper.setdefault("meta", {})[k] = v

    # 自动为未设置 src 的 figure 块补齐从原页裁出的插图
    fig_map = pdfwork.crop_figures(ws.root, paper)
    for b in paper.get("blocks", []):
        if b.get("type") == "figure" and not b.get("src") and b.get("id") in fig_map:
            b["src"] = fig_map[b["id"]]

    images = {}
    page_rels = [p["img"] for p in paper.get("meta", {}).get("pages", [])] if include_page_images else []
    fig_rels = [b["src"] for b in paper.get("blocks", []) if b.get("src")]
    for rel in page_rels + fig_rels:
        src = ws.root / rel
        if not src.exists():
            continue
        if assets:
            dst = assets / rel.replace("/", "-")
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())
            images[rel] = f"{assets.name}/{dst.name}"
        else:
            images[rel] = _data_uri(src, "image/webp")
    data = {n: ws.load(n) for n in ("discussion", "reader", "layout", "gist")}
    data["item"] = item
    data.update({"paper": paper, "images": images}, **(extra or {}))
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    page = page.replace("<!--PR:DATA-->", f'<script id="pr-data" type="application/json">{payload}</script>')
    title = paper.get("meta", {}).get("title_zh") or paper.get("meta", {}).get("title_en") or "论文"
    page = re.sub(r"<title>.*?</title>", f"<title>{htmllib.escape(title)}</title>", page, count=1)
    stem = _paper_stem(paper, ws.id)
    out = out or ws.root / f"{stem}-离线版.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    return out


def find_browser() -> str | None:
    """查找本机可用于无头打印 PDF 的 Chromium 内核浏览器（Chrome / Edge / Chromium / Brave）。"""
    for env_key in ("EASYREAD_BROWSER", "CHROME_PATH"):
        val = os.environ.get(env_key)
        if val and Path(val).is_file():
            return val
    for cmd in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"):
        found = shutil.which(cmd)
        if found:
            return found
    candidates: list[Path] = []
    if sys.platform == "darwin":
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
    elif sys.platform.startswith("win"):
        local = Path(os.environ.get("LOCALAPPDATA", "C:/Users/Default/AppData/Local"))
        candidates = [
            Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
            Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
            local / "Google/Chrome/Application/chrome.exe",
            Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
            Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
            local / "Microsoft/Edge/Application/msedge.exe",
        ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def pdf_filename(ws: Workspace, mode: str = "zh", notes: bool = False) -> str:
    paper = ws.load("paper")
    for k, v in (ws.load("item").get("meta_override") or {}).items():
        if v:
            paper.setdefault("meta", {})[k] = v
    stem = _paper_stem(paper, ws.id)
    suffix = "中英对照" if mode == "bi" else "中文版"
    if notes:
        suffix += "-含批注"
    return f"{stem}-{suffix}.pdf"


def build_pdf(
    ws: Workspace,
    out: Path | None = None,
    mode: str = "zh",
    notes: bool = False,
) -> Path:
    """将翻译后的中文版导出为重排 PDF。mode='zh'（纯中文）或 'bi'（中英对照）；notes=True 时附带笔记与 AI 批注。"""
    mode = "bi" if mode == "bi" else "zh"
    browser = find_browser()
    if not browser:
        raise RuntimeError("本机未检测到 Chrome 或 Edge 浏览器，无法直接生成 PDF；请在阅读页点“导出 PDF”使用浏览器打印另存为 PDF。")
    out = (out or (ws.root / pdf_filename(ws, mode=mode, notes=notes))).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    has_blocks = bool(ws.load("paper").get("blocks"))
    with tempfile.TemporaryDirectory(prefix="easyread-pdf-") as tmp:
        tmpdir = Path(tmp)
        tmp_html = tmpdir / "export.html"
        build(
            ws,
            out=tmp_html,
            extra={"pdf": {"mode": mode, "notes": bool(notes)}},
            include_page_images=not has_blocks,
        )
        udir = tmpdir / "profile"
        cmd = [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-pdf-header-footer",
            f"--user-data-dir={udir}",
            f"--print-to-pdf={out}",
            tmp_html.resolve().as_uri(),
        ]
        if sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0:
            cmd.insert(1, "--no-sandbox")
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if not out.is_file() or out.stat().st_size == 0:
            err = (res.stderr or res.stdout or "").strip()[-400:]
            raise RuntimeError(f"生成 PDF 失败：{err or '浏览器未输出文件'}")
    return out

