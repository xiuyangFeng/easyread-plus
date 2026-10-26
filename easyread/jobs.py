"""后台任务：导入后的渲染与整篇翻译（一条队列，状态落在每篇的 job.json，重启后接着做），
“让模型回答我的问题 / 重译这段”这类小任务（另一条队列，不用等整篇翻译），
以及生成段落主旨和论文脉络（每篇单独一个线程，要读十几批，不能堵住小任务）。"""
from __future__ import annotations

import queue
import threading
import time

from . import config, gist, pdfwork, translate
from .engines import Cancelled, EngineError
from .library import Library
from .log import log
from .store import Workspace, now_iso


class Jobs:
    def __init__(self, lib: Library):
        self.lib = lib
        self.bulk: queue.Queue[str] = queue.Queue()
        self.small: queue.Queue[dict] = queue.Queue()
        self.cancels: dict[str, threading.Event] = {}
        self.recent: list[dict] = []  # 小任务的状态，给页面轮询
        self.lock = threading.Lock()
        for target in (self._bulk_loop, self._small_loop):
            threading.Thread(target=target, daemon=True).start()
        self._resume()

    # ---------- 整篇 ----------
    def _write(self, ws: Workspace, **fields):
        def apply(job):
            job.update(fields)
            job["updated"] = now_iso()
        ws.update("job", apply)

    def enqueue(self, ws: Workspace, pages: list[int] | None = None, translate_after: bool = True, scope: str | None = None):
        """pages=None：按 scope（all / body / first:N）翻译还没译的页。"""
        self._write(ws, type="translate" if translate_after else "prepare", state="queued", message="排队中",
                    pages=pages, scope=scope or "all", translate=translate_after, done=0, total=0, error="", failed={})
        self.bulk.put(ws.id)

    def cancel(self, pid: str):
        ev = self.cancels.get(pid)
        if ev:
            ev.set()
        ws = self.lib.ws(pid)
        if ws and (ws.load("job") or {}).get("state") == "queued":
            self._write(ws, state="cancelled", message="已取消")

    def _resume(self):
        for ws in self.lib.all():
            job = ws.load("job") or {}
            if job.get("state") in ("queued", "running"):
                self._write(ws, state="queued", message="排队中（服务重启后继续）")
                self.bulk.put(ws.id)

    def _bulk_loop(self):
        while True:
            pid = self.bulk.get()
            ws = self.lib.ws(pid)
            if not ws:
                continue
            job = ws.load("job") or {}
            if job.get("state") != "queued":
                continue
            cancel = self.cancels[pid] = threading.Event()
            try:
                self._run_bulk(ws, job, cancel)
            except Cancelled:
                self._write(ws, state="cancelled", message="已取消，已译的部分保留")
            except Exception as e:  # noqa: BLE001
                msg = str(e) if isinstance(e, (EngineError, KeyError, ValueError)) else f"{type(e).__name__}: {e}"
                self._write(ws, state="error", message="出错了", error=msg[:800])
                log.exception("后台任务出错 %s", pid)
                try:
                    translate.journal(ws, f"出错停止：{msg[:500]}")
                except OSError:
                    pass
            finally:
                self.cancels.pop(pid, None)

    def _run_bulk(self, ws: Workspace, job: dict, cancel: threading.Event):
        cfg = config.load()
        if not ws.load("paper").get("meta", {}).get("pages"):
            self._write(ws, state="running", message="正在渲染原页、抽取文字")
            translate.prepare(ws)
        if not job.get("translate") or cfg.get("engine") == "none":
            self._write(ws, state="done", message="已导入" + ("（未开启自动翻译）" if job.get("translate") else ""))
            return
        paper = ws.load("paper")
        all_pages = [p["n"] for p in paper["meta"]["pages"]]
        done_pages = set(paper.get("translation", {}).get("done_pages", []))
        wanted = job.get("pages") or translate.scope_pages(ws, job.get("scope")) or all_pages
        pages = wanted if job.get("pages") else [n for n in wanted if n not in done_pages]
        if not pages:
            self._write(ws, state="done", message="选定范围已译完")
            return

        def report(done, total, message):
            if cancel.is_set():
                raise Cancelled()
            self._write(ws, state="running", done=done, total=total, message=message)

        started = time.time()
        failed = translate.translate_pages(ws, cfg, pages, cancel, report)
        pdfwork.fill_figure_srcs(ws)  # 译文落了盘，把插图裁出来内联；失败只记日志
        minutes = max(1, round((time.time() - started) / 60))
        if failed:
            first = next(iter(failed.values()))
            self._write(ws, state="partial", failed={str(k): v for k, v in failed.items()}, error=first,
                        message=(f"{len(pages) - len(failed)} 页译好了，" if len(failed) < len(pages) else "") + f"{len(failed)} 页没译成功")
        else:
            self._write(ws, state="done", failed={}, error="", message=f"翻译完成（{len(pages)} 页，用时约 {minutes} 分钟）")
        if cfg.get("gist_auto"):  # 设置里开了“翻译完自动生成主旨与脉络”
            self.submit_gist(ws.id, "missing")

    # ---------- 小任务 ----------
    def submit_small(self, kind: str, pid: str, **kw) -> dict:
        job = {"id": f"j{int(time.time() * 1000)}", "kind": kind, "pid": pid, "state": "queued", "message": "排队中",
               "at": now_iso(), **kw}
        with self.lock:
            self.recent = ([job] + self.recent)[:50]
        self.small.put(job)
        return job

    # ---------- 段落主旨与脉络 ----------
    def submit_gist(self, pid: str, mode: str = "missing", block: str | None = None) -> dict:
        """同一篇同时只跑一个；已在跑就返回那个。"""
        with self.lock:
            running = next((j for j in self.recent if j["pid"] == pid and j["kind"] == "gist" and j["state"] in ("queued", "running")), None)
            if running:
                return dict(running)
            job = {"id": f"j{int(time.time() * 1000)}", "kind": "gist", "pid": pid, "mode": mode, "block": block,
                   "state": "queued", "message": "排队中", "done": 0, "total": 0, "at": now_iso()}
            self.recent = ([job] + self.recent)[:50]
            cancel = self.cancels["gist:" + pid] = threading.Event()
        threading.Thread(target=self._run_gist, args=(job, cancel), daemon=True).start()
        return dict(job)

    def cancel_gist(self, pid: str) -> None:
        ev = self.cancels.get("gist:" + pid)
        if ev:
            ev.set()

    def _run_gist(self, job: dict, cancel: threading.Event):
        ws = self.lib.ws(job["pid"])
        try:
            if not ws:
                raise KeyError(job["pid"])
            cfg = config.load()
            if cfg.get("engine") == "none":
                raise EngineError("还没有设置模型")

            def report(done, total, message):
                if cancel.is_set():
                    raise Cancelled()
                job.update(state="running", done=done, total=total, message=message)
            job.update(state="running", message="准备中")
            res = gist.run(ws, cfg, job["mode"], cancel, report, block=job.get("block"))
            msg = "完成" if job["mode"] == "structure" else f"写好 {res['blocks']} 段主旨" if res["blocks"] else "已是最新"
            if res["failed"]:
                msg += f"，{res['failed']} 批没成功（可以再点一次补上）"
            job.update(state="done", message=msg)
        except Cancelled:
            job.update(state="error", message="已停止，写好的部分保留")
        except Exception as e:  # noqa: BLE001
            job.update(state="error", message=str(e)[:500])
            log.exception("主旨任务出错 %s", job.get("pid"))
        finally:
            self.cancels.pop("gist:" + job["pid"], None)

    def small_status(self, pid: str | None = None) -> list[dict]:
        with self.lock:
            return [dict(j) for j in self.recent if not pid or j["pid"] == pid]

    def _small_loop(self):
        while True:
            job = self.small.get()
            ws = self.lib.ws(job["pid"])
            if not ws:
                continue
            job["state"], job["message"] = "running", "模型思考中"
            try:
                cfg = config.load()
                if job["kind"] == "answer":
                    translate.answer(ws, cfg, job["note"], None)
                elif job["kind"] == "retranslate":
                    translate.retranslate(ws, cfg, job["key"], job.get("hint", ""), None)
                job["state"], job["message"] = "done", "完成"
            except Exception as e:  # noqa: BLE001
                job["state"], job["message"] = "error", str(e)[:500]
                log.exception("小任务出错 %s", job.get("kind"))
