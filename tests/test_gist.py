"""段落主旨与脉络：分节、只补过时的、读者改的不被覆盖、论点里的 id 要真实存在。  python -m unittest tests.test_gist"""
import json
import re
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from easyread import engines, gist
from easyread.store import Workspace, write_json_atomic

LONG = "这是一段足够长的正文译文，用来测试主旨生成是否按章节分批进行。"


def make_ws() -> Workspace:
    root = Path(tempfile.mkdtemp(prefix="easyread-gist-"))
    blocks = [
        {"id": "p1-1", "type": "para", "page": 1, "role": "abstract", "zh": "摘要：" + LONG},
        {"id": "s1", "type": "heading", "level": 1, "page": 1, "num": "1", "zh": "引言"},
        {"id": "p1-2", "type": "para", "page": 1, "zh": "引言第一段。" + LONG},
        {"id": "p1-3", "type": "para", "page": 1, "zh": "其中 x 是输入。"},  # 太短，不写
        {"id": "s2", "type": "heading", "level": 1, "page": 2, "num": "2", "zh": "方法"},
        {"id": "s2-1", "type": "heading", "level": 2, "page": 2, "num": "2.1", "zh": "编码器"},
        {"id": "p2-1", "type": "para", "page": 2, "zh": "方法第一段。" + LONG},
        {"id": "p2-2", "type": "list", "page": 2, "items": [{"zh": "第一项。" + LONG}, {"zh": "第二项。"}]},
        {"id": "fig1", "type": "figure", "page": 2, "num": "1", "caption_zh": "图 1：总体框架。"},
        {"id": "refs", "type": "references", "page": 3, "zh": "参考文献"},
        {"id": "p3-1", "type": "para", "page": 3, "zh": "参考文献之后、附录标题之前的段落不算。" + LONG},
    ]
    write_json_atomic(root / "paper.json", {"meta": {"title_zh": "测试论文", "pages": []}, "blocks": blocks})
    return Workspace(root)


def fake_engine(calls: list):
    def run(cfg, prompt, cwd, images=None, cancel=None):
        if "整理全文的论证结构" in prompt:
            calls.append("structure")
            return json.dumps({"story": "先提出问题，再给方法。", "sections": [{"id": "s2", "gist": "给出方法"}, {"id": "nope", "gist": "x"}],
                               "claims": [{"claim": "方法有效", "kind": "主结论", "support": [{"id": "p2-1", "how": "说明"}, {"id": "fig1", "how": "框架"},
                                                                                        {"id": "p9-9", "how": "编的"}], "weak": ""}]})
        only = re.search(r"只需要输出这几段：([^（]+)（", prompt)
        ids = [x.strip() for x in only.group(1).split(",")] if only else re.findall(r"^\[([\w-]+)\]", prompt, re.M)
        calls.append(tuple(ids))
        return "```json\n" + json.dumps({"blocks": [{"id": i, "gist": f"{i} 的主旨", "role": "方法", "link": "递进", "why": "因为"} for i in ids]}) + "\n```"
    return run


class GistTest(unittest.TestCase):
    def setUp(self):
        self.ws = make_ws()
        self.cfg = {"engine": "openai", "concurrency": 2, "openai": {"model": "m"}}

    def tearDown(self):
        shutil.rmtree(self.ws.root, ignore_errors=True)

    def run_gist(self, mode="missing", block=None):
        calls = []
        with mock.patch.object(engines, "run", fake_engine(calls)):
            res = gist.run(self.ws, self.cfg, mode, threading.Event(), lambda *a: None, block=block)
        return res, calls

    def test_outline_sections_and_skips(self):
        o = gist.outline(self.ws)
        self.assertEqual([s["id"] for s in o["sections"]], ["_front", "s1", "s2"])
        ids = [p["id"] for s in o["sections"] for p in s["paras"]]
        self.assertEqual(ids, ["p1-1", "p1-2", "p2-1", "p2-2"])  # 短段、参考文献后的段不算
        self.assertEqual(o["sections"][2]["paras"][0]["sub"], "2.1 编码器")
        self.assertEqual(o["floats"], [{"id": "fig1", "label": "图 1：总体框架。"}])

    def test_generate_then_up_to_date(self):
        res, calls = self.run_gist()
        self.assertEqual(res, {"blocks": 4, "failed": 0})
        self.assertEqual(sorted(c for c in calls if c != "structure"), [("p1-1",), ("p1-2",), ("p2-1", "p2-2")])
        self.assertEqual(calls[-1], "structure")
        d = self.ws.load("gist")
        self.assertEqual(d["blocks"]["p2-1"]["role"], "方法")
        self.assertEqual(d["story"], "先提出问题，再给方法。")
        self.assertEqual(list(d["sections"]), ["s2"])  # 不存在的节 id 丢掉
        self.assertEqual([s["id"] for s in d["claims"][0]["support"]], ["p2-1", "fig1"])  # 编出来的 id 丢掉
        res, calls = self.run_gist()
        self.assertEqual((res["blocks"], calls), (0, []))

    def test_edited_translation_makes_only_that_paragraph_stale(self):
        self.run_gist()
        write_json_atomic(self.ws.reader_path, {"edits": {"p2-1": {"zh": "我改过的译文。" + LONG}}})
        res, calls = self.run_gist()
        self.assertEqual(calls[0], ("p2-1",))  # 整节作上下文，只要 p2-1
        self.assertEqual(res["blocks"], 1)

    def test_reader_edit_survives_regenerate_and_can_revert(self):
        self.run_gist()
        gist.edit(self.ws, "p1-2", "我自己写的主旨", "问题")
        self.run_gist("all")
        e = self.ws.load("gist")["blocks"]["p1-2"]
        self.assertEqual((e["gist"], e["role"], e["by"]), ("我自己写的主旨", "问题", "me"))
        self.assertEqual(e["ai"]["gist"], "p1-2 的主旨")
        gist.edit(self.ws, "p1-2", revert=True)
        self.assertEqual(self.ws.load("gist")["blocks"]["p1-2"]["gist"], "p1-2 的主旨")
        with self.assertRaises(ValueError):
            gist.edit(self.ws, "p1-3", "太短的段不写")

    def test_single_block_mode(self):
        res, calls = self.run_gist("block", "p2-2")
        self.assertEqual(calls, [("p2-2",)])  # 一段不重新提炼论点
        self.assertEqual(list(self.ws.load("gist")["blocks"]), ["p2-2"])

    def test_bad_output_counts_as_failed_batch(self):
        def broken(cfg, prompt, cwd, images=None, cancel=None):
            raise engines.EngineError("模型输出里没有 JSON")
        with mock.patch.object(engines, "run", broken):
            with self.assertRaisesRegex(engines.EngineError, "批都没写成"):  # 一段都没写成：把模型的错说出来
                gist.run(self.ws, self.cfg, "missing", threading.Event(), lambda *a: None)


if __name__ == "__main__":
    unittest.main()
