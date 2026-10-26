"""文献库功能测试：跨论文全文搜索、全库备份 zip。  python -m unittest tests.test_library"""
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

from easyread import library
from easyread.store import write_json_atomic


def make_lib() -> Path:
    root = Path(tempfile.mkdtemp(prefix="easyread-lib-test-"))
    paper = {
        "meta": {"title_zh": "图网络血流动力学预测", "title_en": "Graph Networks for Haemodynamics", "year": "2025"},
        "blocks": [
            {"id": "h1", "type": "heading", "page": 1, "num": "2.1", "zh": "方法", "en": "Methods"},
            {"id": "p1", "type": "para", "page": 1, "zh": "我们用**图神经网络**预测动脉瘤的壁面剪切应力。", "en": "We use graph neural networks to predict wall shear stress."},
            {"id": "p2", "type": "para", "page": 2, "zh": "这一段讲的是插值和中心线。", "en": "This paragraph talks about interpolation and centerlines."},
            {"id": "fig1", "type": "figure", "page": 2, "caption_zh": "图 1：模型架构。", "caption_en": "Fig. 1: Architecture."},
        ],
        "glossary": [], "references": [],
    }
    for name, extra in (("paperone", {}), ("papertwo", {})):
        d = root / name
        d.mkdir()
        write_json_atomic(d / "paper.json", dict(paper))
        write_json_atomic(d / "reader.json", {"schema": 2, "rev": 0, "edits": {"p1": {"zh": "我们用**图注意力网络**预测动脉瘤的壁面剪切应力（我改过）。", "at": "2026-01-01T00:00:00"}}, "notes": {}, "paper_note": {"body": "整篇的感悟：中心线很重要。", "at": ""}, "progress": {}})
        write_json_atomic(d / "item.json", {"added": "2026-01-01T00:00:00", "tags": [], "status": "unread", "starred": False})
        (d / "pages").mkdir()
        (d / "pages" / "page-001.webp").write_bytes(b"fake")
        (d / "source.pdf").write_bytes(b"%PDF-fake")
    (root / ".trash").mkdir()
    return root


class LibrarySearchTest(unittest.TestCase):
    def setUp(self):
        self.root = make_lib()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def test_finds_translated_text_with_edit_override(self):
        rs = library.search(self.root, "注意力网络")
        self.assertEqual(len(rs), 2)  # 两篇论文里 p1 都用了“我的修改”
        self.assertEqual(rs[0]["block"], "p1")
        self.assertEqual(rs[0]["where"], "译文")
        self.assertIn("图注意力网络", rs[0]["snippet"])

    def test_finds_english_and_caption(self):
        rs = library.search(self.root, "centerline")
        self.assertEqual(len(rs), 2)
        self.assertEqual(rs[0]["where"], "原文")
        rs = library.search(self.root, "architecture")
        self.assertEqual(rs[0]["block"], "fig1#caption")

    def test_finds_notes_and_short_query_returns_empty(self):
        rs = library.search(self.root, "中心线很重要")
        self.assertEqual(len(rs), 2)
        self.assertEqual(rs[0]["where"], "论文笔记")
        self.assertEqual(library.search(self.root, "中"), [])

    def test_per_paper_limit(self):
        rs = library.search(self.root, "的")  # 常见字，每篇最多 8 条
        self.assertLessEqual(len(rs), 16)


class LibraryBackupTest(unittest.TestCase):
    def setUp(self):
        self.root = make_lib()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def test_backup_contains_data_but_not_regen_dirs(self):
        out = library.backup(self.root, self.root / ".backup.zip")
        with zipfile.ZipFile(out) as z:
            names = set(z.namelist())
        self.assertIn(Path("paperone") / "paper.json", {Path(n) for n in names})
        self.assertTrue(any(n.endswith("source.pdf") for n in names))
        self.assertFalse(any("pages/" in n for n in names))  # 原页图可再生，不进备份
        self.assertFalse(any(".trash" in n for n in names))
        out.unlink()


if __name__ == "__main__":
    unittest.main()
