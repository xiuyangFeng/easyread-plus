"""中文 PDF 导出测试：文件名生成、插图自动裁切、PDF HTML 构建与无头打印。  python -m unittest tests.test_pdf_export"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, ImageDraw

from easyread import build as builder, pdfwork
from easyread.store import Workspace, write_json_atomic


def _make_chars(text: str, x0: float, y0: float, x1: float, y1: float) -> list:
    n = max(len(text), 1)
    dx = (x1 - x0) / n
    return [[ch, round(x0 + i * dx, 4), y0, round(x0 + (i + 1) * dx, 4), y1] for i, ch in enumerate(text)]


def make_pdf_ws() -> Workspace:
    root = Path(tempfile.mkdtemp(prefix="easyread-pdf-test-"))
    (root / "extract").mkdir()
    (root / "pages").mkdir()

    # 造一张 600x800 的白底页面图，中间画一块深色矩形模拟插图
    img = Image.new("RGB", (600, 800), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([80, 120, 520, 320], fill=(40, 90, 140))
    img.save(root / "pages" / "page-001.webp", "WEBP")

    chars = (
        _make_chars("This is the opening paragraph.", 0.10, 0.06, 0.90, 0.11)
        + _make_chars("Figure 1: Architecture of our proposed model.", 0.10, 0.43, 0.90, 0.48)
        + _make_chars("As shown in Fig. 1, the model consists of two stages.", 0.10, 0.52, 0.90, 0.65)
    )
    write_json_atomic(root / "extract" / "page-001.chars.json", chars)

    paper = {
        "meta": {
            "id": "testpaper01",
            "title_en": "A Test: Paper / Title?",
            "title_zh": "一篇测试论文：标题/示例",
            "page_count": 1,
            "pages": [{"n": 1, "w": 600, "h": 800, "img": "pages/page-001.webp"}],
        },
        "translation": {"status": "done", "done_pages": [1]},
        "glossary": [],
        "references": [{"num": 1, "text": "Author A. Title. 2025."}],
        "blocks": [
            {"id": "p1", "type": "para", "page": 1, "en": "This is the opening paragraph.", "zh": "这是开篇段落。"},
            {"id": "fig1", "type": "figure", "page": 1, "label": "图 1",
             "caption_en": "Figure 1: Architecture of our proposed model.",
             "caption_zh": "图 1：本文提出的模型架构。"},
            {"id": "p2", "type": "para", "page": 1, "en": "As shown in Fig. 1, the model consists of two stages.", "zh": "如图 1 所示，模型包含两个阶段。"},
        ],
    }
    write_json_atomic(root / "paper.json", paper)
    return Workspace(root)


class PdfExportTest(unittest.TestCase):
    def setUp(self):
        self.ws = make_pdf_ws()

    def tearDown(self):
        shutil.rmtree(self.ws.root, ignore_errors=True)

    def test_pdf_filename_variants(self):
        self.assertEqual(builder.pdf_filename(self.ws, "zh", False), "一篇测试论文：标题示例-中文版.pdf")
        self.assertEqual(builder.pdf_filename(self.ws, "bi", False), "一篇测试论文：标题示例-中英对照.pdf")
        self.assertEqual(builder.pdf_filename(self.ws, "zh", True), "一篇测试论文：标题示例-中文版-含批注.pdf")

    def test_crop_figures_extracts_missing_src(self):
        paper = self.ws.load("paper")
        fig_map = pdfwork.crop_figures(self.ws.root, paper)
        self.assertEqual(fig_map.get("fig1"), "figures/fig1.webp")
        crop_file = self.ws.root / "figures" / "fig1.webp"
        self.assertTrue(crop_file.exists())
        with Image.open(crop_file) as im:
            self.assertGreater(im.width, 400)
            self.assertGreater(im.height, 150)

    def test_fill_figure_srcs_persists_to_paper(self):
        """打开阅读页时给没 src 的 figure 块补裁图并写回 paper.json，二次调用不再动文件。"""
        from easyread.store import file_version

        paper = self.ws.load("paper")
        fig = next(b for b in paper["blocks"] if b["id"] == "fig1")
        self.assertEqual(fig.get("src") or "", "")
        pdfwork.fill_figure_srcs(self.ws)
        fig = next(b for b in self.ws.load("paper")["blocks"] if b["id"] == "fig1")
        self.assertEqual(fig["src"], "figures/fig1.webp")
        self.assertTrue((self.ws.root / "figures" / "fig1.webp").is_file())
        version = file_version(self.ws.paper_path)
        pdfwork.fill_figure_srcs(self.ws)  # 都有 src 了：空操作，不写文件
        self.assertEqual(file_version(self.ws.paper_path), version)

    def test_build_pdf_html_payload_skips_page_images(self):
        html_out = self.ws.root / "temp.html"
        builder.build(self.ws, html_out, include_page_images=False,
                      extra={"pdf": {"mode": "bi", "notes": True}})
        html = html_out.read_text(encoding="utf-8")
        marker = '<script id="pr-data" type="application/json">'
        start = html.index(marker) + len(marker)
        end = html.index("</script>", start)
        data = json.loads(html[start:end])
        self.assertEqual(data["pdf"], {"mode": "bi", "notes": True})
        self.assertNotIn("pages/page-001.webp", data["images"])
        self.assertIn("figures/fig1.webp", data["images"])
        fig = next(b for b in data["paper"]["blocks"] if b["id"] == "fig1")
        self.assertEqual(fig["src"], "figures/fig1.webp")

    def test_build_pdf_calls_headless_browser(self):
        out_pdf = self.ws.root / "out.pdf"

        def fake_run(cmd, **kwargs):
            for arg in cmd:
                if arg.startswith("--print-to-pdf="):
                    target = Path(arg.split("=", 1)[1])
                    target.write_bytes(b"%PDF-1.4\n" + b"0" * 2048)
            res = mock.MagicMock()
            res.returncode = 0
            return res

        with mock.patch.object(builder, "find_browser", return_value="/usr/bin/google-chrome"), \
             mock.patch("subprocess.run", side_effect=fake_run) as m_run:
            res_path = builder.build_pdf(self.ws, out_pdf, mode="bi", notes=True)
            self.assertEqual(res_path, out_pdf)
            self.assertTrue(out_pdf.exists())
            self.assertTrue(m_run.called)


if __name__ == "__main__":
    unittest.main()
