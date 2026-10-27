"""库内引用关系、全部笔记、阅读统计、对比表、阅读时长。  python -m unittest tests.test_overview"""
import shutil
import tempfile
import unittest
from pathlib import Path

from easyread import citegraph, overview
from easyread.library import Library
from easyread.store import Workspace, write_json_atomic


def paper(title, refs=(), arxiv=""):
    return {"meta": {"title_en": title, "title_zh": title + "（中）", "arxiv": arxiv},
            "blocks": [{"id": "h1", "type": "heading", "page": 1, "num": "2", "zh": "2 方法"},
                       {"id": "p1", "type": "para", "page": 3, "zh": "正文", "en": "text"}],
            "references": [{"id": str(i + 1), "text": t} for i, t in enumerate(refs)], "glossary": []}


def make_lib() -> Path:
    root = Path(tempfile.mkdtemp(prefix="easyread-ov-test-"))
    papers = {
        "aaaa1111": paper("Physics-informed graph neural networks for flow field estimation in carotid arteries"),
        "bbbb2222": paper("Geometry-Guided Graph Encoding Network ($G^3e$-Net) for Haemodynamics", refs=[
            "Suk, J., Brune, C., 2024. Physics-informed graph neural networks for flow field estimation in carotid arteries. arXiv.",
            "Lu, L., 2021. Learning nonlinear operators via DeepONet. Nat. Mach. Intell.",
        ]),
        "cccc3333": paper("DeepONet", arxiv="arXiv:1910.03193v3"),  # 标题太短，只能靠 arXiv 编号认
        "dddd4444": paper("A survey", refs=["Somebody. Geometry guided graph encoding network (G3e-Net) for haemodynamics. MedIA 2026.",
                                            "Lu, L. et al. DeepONet. arXiv:1910.03193 (2019)."]),
    }
    for pid, p in papers.items():
        d = root / pid
        d.mkdir()
        write_json_atomic(d / "paper.json", p)
        write_json_atomic(d / "item.json", {"added": "2026-01-01T00:00:00", "tags": ["血流"] if pid == "aaaa1111" else [], "status": "unread"})
    write_json_atomic(root / "bbbb2222" / "reader.json", {"notes": {
        "n1": {"id": "n1", "kind": "highlight", "color": "pink", "quote": "一句话", "anchor": "p1", "created": "2026-10-20T10:00:00+08:00", "updated": "2026-10-20T10:00:00+08:00"},
        "n2": {"id": "n2", "kind": "note", "body": "删掉的", "anchor": "p1", "deleted": True, "created": "2026-10-21T10:00:00+08:00"},
        "n3": {"id": "n3", "kind": "question", "body": "为什么？", "anchor": "p1", "created": "2026-10-22T10:00:00+08:00", "updated": "2026-10-22T10:00:00+08:00"},
    }, "paper_note": {"body": "整篇感想", "at": "2026-10-23T10:00:00+08:00"}})
    write_json_atomic(root / "bbbb2222" / "gist.json", {"story": "先问题后方法", "claims": [{"id": "c1", "kind": "主结论", "claim": "更准", "support": []}], "blocks": {}})
    return root


class CiteGraphTest(unittest.TestCase):
    def setUp(self):
        self.root = make_lib()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.lib = Library(self.root)

    def test_edges_by_title_and_arxiv(self):
        edges = {(e["from"], e["to"], e["ref"]) for e in citegraph.graph(self.lib)["edges"]}
        self.assertIn(("bbbb2222", "aaaa1111", "1"), edges)   # 标题
        self.assertIn(("dddd4444", "bbbb2222", "1"), edges)   # 标题里的 $G^3e$ 和 G3e 算同一个
        self.assertIn(("dddd4444", "cccc3333", "2"), edges)   # 短标题靠 arXiv 编号
        self.assertNotIn(("bbbb2222", "cccc3333", "2"), edges)  # “DeepONet” 太短，不按标题配
        self.assertEqual(citegraph.counts(self.lib)["aaaa1111"], (0, 1))
        self.assertEqual(citegraph.refs_in_library(self.lib, "dddd4444"), {"1": "bbbb2222", "2": "cccc3333"})

    def test_cache_refreshes_when_paper_changes(self):
        self.assertEqual(len(citegraph.graph(self.lib)["edges"]), 3)
        p = paper("A survey", refs=[])
        write_json_atomic(self.root / "dddd4444" / "paper.json", p)
        self.assertEqual(len(citegraph.graph(self.lib)["edges"]), 1)


class OverviewTest(unittest.TestCase):
    def setUp(self):
        self.root = make_lib()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.lib = Library(self.root)

    def test_notes_skip_deleted_and_include_paper_note(self):
        d = overview.notes(self.lib)
        kinds = [n["kind"] for n in d["notes"]]
        self.assertEqual(kinds, ["paper", "question", "highlight"])  # 最近改的在前
        hl = d["notes"][-1]
        self.assertEqual((hl["section"], hl["page"], hl["color"]), ("2 方法", 3, "pink"))  # 标题自带编号时不重复
        self.assertEqual(d["papers"]["bbbb2222"]["title_en"][:8], "Geometry")

    def test_read_time_and_stats(self):
        ws = Workspace(self.root / "aaaa1111")
        ws.add_read_time(40, "2026-10-25")
        ws.add_read_time(5000, "2026-10-26")  # 单次最多记 600 秒
        r = ws.load("item")["read"]
        self.assertEqual((r["total"], r["days"]), (640, {"2026-10-25": 40, "2026-10-26": 600}))
        with self.assertRaises(ValueError):
            ws.add_read_time(10, "昨天")
        ws.patch_item({"status": "done"})
        s = overview.stats(self.lib)
        self.assertEqual(s["total_sec"], 640)
        self.assertEqual(s["top"][0]["pid"], "aaaa1111")
        self.assertTrue(s["done"][0]["at"])
        self.assertEqual(s["notes_days"], {"2026-10-20": 1, "2026-10-22": 1})
        self.assertEqual(self.lib.summary(ws)["read_sec"], 640)

    def test_compare_rows(self):
        rows = overview.compare(self.lib, ["bbbb2222", "nope", "aaaa1111"])
        self.assertEqual([r["id"] for r in rows], ["bbbb2222", "aaaa1111"])
        self.assertEqual((rows[0]["story"], rows[0]["claims"][0]["claim"], rows[0]["paper_note"]), ("先问题后方法", "更准", "整篇感想"))
        self.assertFalse(rows[1]["has_gist"])


if __name__ == "__main__":
    unittest.main()
