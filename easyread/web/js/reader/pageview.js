/* 原文面板（PDF 原页 / 英文原文，随阅读位置同步）和右侧面板的开关、宽度。
   - 右侧面板一次开一个：原文、笔记、问 AI、看图、脉络。
   - 原文面板可以停靠到左边（宽屏）：左原文 · 中译文 · 右看图 / 脉络，三栏同时开时左右两栏按比例让出地方，中间至少留够读的宽度。
   - 原文有两种看法：原页（PDF 页图，框出当前段）和英文（排好版的英文原文，高亮当前段，点了中文跳过去）。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;
  const root = document.documentElement;
  let pvPage = 1, pvBlock = null;
  const pages = () => (S.paper.meta || {}).pages || [];

  /* 记住“放大”“跟随”“看法”“停靠”（存在浏览器里，下次打开还是这个状态） */
  function savePv(patch) { PR.ls.set("easyread-pv", Object.assign(PR.ls.get("easyread-pv", {}), patch)); }
  const pvSaved = PR.ls.get("easyread-pv", {});
  let view = pvSaved.view === "en" ? "en" : "page";
  let dock = pvSaved.dock === "left" ? "left" : "right";
  let leftOpen = false, leftT = null;

  const wideScreen = () => innerWidth >= 1180;  // 窄屏面板盖在正文上：不停靠左边、不调宽度
  const leftDock = () => dock === "left" && wideScreen();
  PR.pagesOpen = () => PR.side === "pages" || leftOpen;
  const pagesBtn = () => PR.$('[data-act="pages"]');

  /* 右侧面板开关：pages | notes | chat | figs | map | null */
  /* 面板先滑出来（只动面板，不卡），滑完再让正文让位、重排一次。
     长论文有几万个节点，正文宽度一变就要整页重排（两三百毫秒），放在点击的当下会让人觉得按钮反应慢。 */
  PR.side = null;
  let sideT = null;
  PR.openSide = function (name) {
    PR.side = name;
    body.classList.toggle("pv-open", name === "pages");
    body.classList.toggle("np-open", name === "notes");
    body.classList.toggle("ch-open", name === "chat");
    body.classList.toggle("fp-open", name === "figs");
    body.classList.toggle("mp-open", name === "map");
    PR.$('[data-act="chat"]').classList.toggle("on", name === "chat");
    pagesBtn().classList.toggle("on", name === "pages" || leftOpen);
    PR.$('[data-act="notes"]').classList.toggle("on", name === "notes");
    PR.$('[data-act="figs"]').classList.toggle("on", name === "figs");
    PR.$('[data-act="map"]').classList.toggle("on", name === "map");
    applyCols();
    PR.emit("side", name);
    clearTimeout(sideT);
    if (name) { const t = PR.$("#toast"); if (t) t.classList.remove("open"); }  // 提示条别挡住面板底部的输入框
    if (body.classList.contains("side-open") === !!name) return;  // 面板之间切换：正文宽度不变
    sideT = setTimeout(() => requestAnimationFrame(() => keepPlace(() => body.classList.toggle("side-open", !!PR.side))), 300);
  };

  /* 正文宽度要变：变之前记住正在读的段，变完重排、再滚回同一位置 */
  function keepPlace(change) {
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    change();
    PR.fitWide(); PR.renderMargin();
    PR.emit("side-layout");  // 正文让位完了：左边留白变了，主旨要重新排
    if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);
  }

  /* ---------- 宽度：右栏（--side-w，拖左边缘）、左栏（--left-w，拖右边缘）；两栏都开时按比例缩到中间留够 ---------- */
  const MIN_MID = 640;  // 中间版心（含两侧页边）至少这么宽，正文大约 520 像素
  const sideWanted = () => PR.ls.get("easyread-side-w", 0) || Math.min(innerWidth * 0.44, 720);
  const leftWanted = () => PR.ls.get("easyread-left-w", 0) || Math.min(innerWidth * 0.36, 640);
  const clampW = (w) => Math.round(Math.max(320, Math.min(w, innerWidth - 520, innerWidth * 0.75)));
  function applyCols() {
    const w = PR.ls.get("easyread-side-w", 0);
    if (w && wideScreen()) root.style.setProperty("--side-w", clampW(w) + "px");
    else root.style.removeProperty("--side-w");
    body.classList.toggle("pvl", leftDock());
    if (!leftOpen) { root.style.removeProperty("--Lw"); root.style.removeProperty("--Rw"); return; }
    let L = leftWanted(), R = PR.side ? Math.min(sideWanted(), innerWidth * 0.75) : 0;
    const room = innerWidth - MIN_MID - 24;
    if (L + R > room) {
      const k = room / (L + R);
      L = Math.max(300, L * k);
      if (R) R = Math.max(320, Math.min(R * k, room - L));
    }
    root.style.setProperty("--Lw", Math.round(L) + "px");
    if (R) root.style.setProperty("--Rw", Math.round(R) + "px"); else root.style.removeProperty("--Rw");
  }
  function relayout() {  // 拖完宽度：重排后还停在刚才读的地方，原页换合适大小的图
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    return () => {
      PR.fitWide(); PR.renderMargin();
      PR.emit("side-layout");
      if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);
      if (PR.pagesOpen() && view === "page") showPage(pvPage, pvBlock);
      PR.emit("side-resized");
    };
  }
  applyCols();
  window.addEventListener("resize", PR.debounce(() => {
    if (leftOpen && !wideScreen()) { setLeft(false); PR.openSide("pages"); }  // 窗口变窄：左边放不下，回到右侧
    applyCols();
  }, 150));

  /* 拖动条：右栏在它左边缘、左栏在它右边缘。拖的时候只动面板（--side-drag / --left-drag），松手才重排正文 */
  function makeGrip(id, title, onMove, onDone, onReset) {
    const g = PR.el("div", { id, title });
    document.body.appendChild(g);
    g.addEventListener("mousedown", (e) => e.preventDefault());  // 别让拖动顺带选中正文
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      body.classList.add("resizing");
      let w = 0;
      const move = (ev) => { w = onMove(ev); };
      const up = () => {
        g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up);
        body.classList.remove("resizing");
        const sel = getSelection(); if (sel && !sel.isCollapsed && !PR.$("#selbar").contains(sel.anchorNode)) sel.removeAllRanges();
        if (!w) { onDone(0); return; }
        const done = relayout();
        onDone(w);
        applyCols();
        requestAnimationFrame(done);
      };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up);
    });
    g.addEventListener("dblclick", () => { const done = relayout(); onReset(); applyCols(); requestAnimationFrame(done); });
  }
  document.addEventListener("selectstart", (e) => { if (body.classList.contains("resizing")) e.preventDefault(); });
  makeGrip("side-grip", "拖动调整右侧面板宽度（双击恢复默认）",
    (ev) => { const L = leftOpen ? parseFloat(getComputedStyle(root).getPropertyValue("--Lw")) || 0 : 0;
      const w = Math.round(Math.max(320, Math.min(innerWidth - ev.clientX, innerWidth - L - MIN_MID - 24, innerWidth * 0.75)));
      root.style.setProperty("--side-drag", w + "px"); return w; },
    (w) => { root.style.removeProperty("--side-drag"); if (w) PR.ls.set("easyread-side-w", w); },
    () => PR.ls.set("easyread-side-w", 0));
  makeGrip("left-grip", "拖动调整左侧原文宽度（双击恢复默认）",
    (ev) => { const R = PR.side ? (parseFloat(getComputedStyle(root).getPropertyValue("--Rw")) || sideWanted()) : 0;
      const w = Math.round(Math.max(300, Math.min(ev.clientX, innerWidth - R - MIN_MID - 24, innerWidth * 0.6)));
      root.style.setProperty("--left-drag", w + "px"); return w; },
    (w) => { root.style.removeProperty("--left-drag"); if (w) PR.ls.set("easyread-left-w", w); },
    () => PR.ls.set("easyread-left-w", 0));

  /* ---------- 原文面板开关 ---------- */
  function setLeft(open) {
    leftOpen = open;
    applyCols();
    body.classList.toggle("pvl-show", open);  // 面板先滑出来
    pagesBtn().classList.toggle("on", open || PR.side === "pages");
    clearTimeout(leftT);
    leftT = setTimeout(() => requestAnimationFrame(() => {
      if (body.classList.contains("pvl-open") === leftOpen) return;
      keepPlace(() => body.classList.toggle("pvl-open", leftOpen));  // 再让正文让位
      if (leftOpen && view === "page") showPage(pvPage, pvBlock);
    }), 300);
  }
  PR.togglePages = function (force) {
    const open = force != null ? force : !PR.pagesOpen();
    if (leftDock()) {
      if (PR.side === "pages") PR.openSide(null);
      setLeft(open);
    } else {
      if (leftOpen) setLeft(false);
      PR.openSide(open ? "pages" : (PR.side === "pages" ? null : PR.side));
    }
    if (open) { PR.syncPage(true); }
  };
  PR.openPage = function (page, blockId) {
    pvBlock = blockId || null;
    setView("page");
    if (!PR.pagesOpen()) PR.togglePages(true);
    showPage(page, blockId);
  };
  function setDock(d) {
    const wasOpen = PR.pagesOpen();
    dock = d;
    savePv({ dock: d });
    if (wasOpen) { if (d === "left") { if (PR.side === "pages") PR.openSide(null); setLeft(true); } else { setLeft(false); PR.openSide("pages"); } }
    applyCols();
    updateHead();
  }

  /* ---------- 原页 ---------- */
  /* 原图是 2.4 倍渲染（约 1500 像素宽、几百 KB），面板用不了那么大：要一张和面板一样宽的，服务端生成一次后缓存 */
  function srcOf(n) {
    const p = pages()[n - 1];
    if (!p) return "";
    const base = PR.imageUrl(p.img);
    if (PR.store.mode !== "server") return base;
    const need = (PR.$(".pv-scroll").clientWidth || 480) * (body.classList.contains("pv-zoom") ? 1.65 : 1) * (devicePixelRatio || 1);
    return need <= 1000 ? base + "?w=1000" : need <= 1600 ? base + "?w=1600" : base;  // 1000 宽的服务端已提前生成好
  }
  const preloaded = new Set();
  function preload(n) {
    const s = srcOf(n);
    if (s && !preloaded.has(s)) { preloaded.add(s); const im = new Image(); im.decoding = "async"; im.src = s; }
  }
  PR.preloadPage = () => { const b = PR.blockById[PR.readingBlock()]; if (b && b.page) preload(b.page); };

  function showPage(page, blockId) {
    const list = pages();
    if (!list.length) return;
    pvPage = Math.min(list.length, Math.max(1, page));
    const img = PR.$(".pv-page img");
    img.decoding = "async";
    const src = srcOf(pvPage);
    if (img.getAttribute("src") !== src) { img.setAttribute("src", src); PR.$(".pv-page").classList.add("loading"); img.onload = () => PR.$(".pv-page").classList.remove("loading"); }
    preload(pvPage + 1); preload(pvPage - 1);
    PR.$(".pv-label").textContent = "第 " + pvPage + " / " + list.length + " 页";
    const pdf = PR.$('[data-pv="pdf"]');
    const url = PR.pdfUrl(pvPage);
    pdf.style.display = url ? "" : "none";
    if (url) pdf.href = url;
    const hl = PR.$(".pv-hl");
    const loc = blockId && S.layout[blockId];
    if (loc && loc.page === pvPage) {
      const [x0, y0, x1, y1] = loc.box;
      Object.assign(hl.style, { left: (x0 * 100 - 0.8) + "%", top: (y0 * 100 - 0.4) + "%", width: ((x1 - x0) * 100 + 1.6) + "%", height: ((y1 - y0) * 100 + 0.8) + "%" });
      hl.classList.add("on");
      const scroller = PR.$(".pv-scroll");
      const doScroll = () => { const h = PR.$(".pv-page").offsetHeight;  // 原页里框出的那段也放在面板中间
        scroller.scrollTo({ top: Math.max(0, ((y0 + y1) / 2) * h + 18 - scroller.clientHeight / 2), behavior: "smooth" }); };
      img.complete ? doScroll() : img.addEventListener("load", doScroll, { once: true });
    } else hl.classList.remove("on");
  }

  /* ---------- 英文原文 ---------- */
  const enBox = PR.$(".pv-en");
  let enBuilt = false, enCur = null, enUserScroll = 0;
  function enHtml(b) {
    const id = ' data-id="' + PR.esc(b.id) + '"';
    if (b.type === "heading" && b.en) return '<h3 class="en-h l' + (b.level || 1) + '"' + id + ">" + (b.num ? '<span class="num">' + PR.esc(b.num) + "</span>" : "") + PR.md(b.en, { cite: false, xref: false }) + "</h3>";
    if (b.type === "para" && b.en) return '<p class="en-p' + (b.cont ? " cont" : "") + (b.role === "abstract" ? " abstract" : "") + '"' + id + ">" + PR.md(b.en) + "</p>";
    if (b.type === "list") { const items = (b.items || []).filter((it) => it.en); return items.length ? "<" + (b.ordered ? "ol" : "ul") + ' class="en-p"' + id + ">" + items.map((it) => "<li>" + PR.md(it.en) + "</li>").join("") + "</" + (b.ordered ? "ol" : "ul") + ">" : ""; }
    if (b.type === "math" && b.tex) return '<div class="en-math"' + id + ">" + PR.tex(b.tex, true) + (b.tag ? '<span class="tag">(' + PR.esc(b.tag) + ")</span>" : "") + "</div>";
    if ((b.type === "figure" || b.type === "table") && (b.caption_en || b.src)) {
      return '<figure class="en-fig"' + id + ">" + (b.type === "figure" && b.src ? '<img src="' + PR.imageUrl(b.src) + '" alt="" loading="lazy" decoding="async">' : "") +
        (b.caption_en ? "<figcaption>" + PR.md(b.caption_en, { xref: false }) + "</figcaption>" : "") + "</figure>";
    }
    if (b.type === "references") return '<h3 class="en-h l1"' + id + ">" + PR.esc(b.en || "References") + '</h3><ol class="en-refs">' + (S.paper.references || []).map((r) => "<li>[" + PR.esc(r.id) + "] " + PR.esc(r.text) + "</li>").join("") + "</ol>";
    return "";
  }
  function buildEn() {
    const m = S.paper.meta || {};
    enBox.innerHTML = (m.title_en ? '<h2 class="en-title">' + PR.md(m.title_en, { cite: false, xref: false }) + "</h2>" : "") +
      (S.paper.blocks || []).map(enHtml).join("") || '<p class="hint">这篇还没有英文原文（翻译后才有）。</p>';
    enBuilt = true; enCur = null;
  }
  function syncEn(force) {
    if (!PR.pagesOpen() || view !== "en") return;
    if (!enBuilt) buildEn();
    if (!force && !PR.$(".pv-follow input").checked) return;
    const blocks = S.paper.blocks || [];
    let i = PR.order[(PR.currentBlock && PR.currentBlock()) || PR.readingBlock()];
    if (i == null) i = 0;
    let el = null;
    for (; i >= 0 && !el; i--) el = enBox.querySelector('[data-id="' + CSS.escape(blocks[i].id) + '"]');  // 这块没有英文就用前面最近的
    if (!el || (el === enCur && !force)) return;
    if (enCur) enCur.classList.remove("on");
    enCur = el; el.classList.add("on");
    if (Date.now() - enUserScroll < 1500 && !force) return;  // 刚自己在英文里滚过，别抢
    const r = el.getBoundingClientRect(), br = enBox.getBoundingClientRect();
    enBox.scrollTo({ top: enBox.scrollTop + r.top - br.top - enBox.clientHeight * 0.28, behavior: force ? "auto" : "smooth" });
  }
  enBox.addEventListener("wheel", () => { enUserScroll = Date.now(); }, { passive: true });
  enBox.addEventListener("click", (e) => {  // 点英文段落：中文跳到同一段（点链接照常）
    if (e.target.closest("a, button") || getSelection().toString()) return;
    const el = e.target.closest("[data-id]");
    if (el) { PR.jumpTo("b-" + el.dataset.id); enUserScroll = 0; }
  });

  function setView(v) {
    view = v;
    savePv({ view: v });
    PR.$("#pageview").classList.toggle("v-en", v === "en");
    PR.$$("[data-pvv]").forEach((b) => b.classList.toggle("on", b.dataset.pvv === v));
    if (v === "en") syncEn(true); else if (PR.pagesOpen()) PR.syncPage(true);
  }
  function updateHead() {
    const d = PR.$('[data-pv="dock"]');
    if (d) { d.textContent = dock === "left" ? "⇥" : "⇤"; d.title = dock === "left" ? "停回右侧" : "停靠到左侧：右边留给看图、脉络"; }
  }

  PR.syncPage = function (force) {
    if (!PR.pagesOpen()) return;
    if (view === "en") return syncEn(force);
    if (!force && !PR.$(".pv-follow input").checked) return;
    const id = (PR.currentBlock && PR.currentBlock()) || PR.readingBlock();
    const b = PR.blockById[id];
    if (!b) return;
    if (!force && id === pvBlock) return;
    pvBlock = id;
    const loc = S.layout[id];
    showPage(loc ? loc.page : b.page, id);
  };
  PR.on("rendered", () => { enBuilt = false; if (PR.pagesOpen() && view === "en") syncEn(true); });
  PR.$("#paper").addEventListener("click", () => setTimeout(() => { if (view === "en") syncEn(false); }, 0));

  PR.$("#pageview").addEventListener("click", (e) => {
    const v = e.target.closest("[data-pvv]");
    if (v) return setView(v.dataset.pvv);
    const b = e.target.closest("[data-pv]");
    if (!b) return;
    const act = b.dataset.pv;
    if (act === "close") PR.togglePages(false);
    if (act === "dock") setDock(dock === "left" ? "right" : "left");
    if (act === "prev") showPage(pvPage - 1, pvBlock);
    if (act === "next") showPage(pvPage + 1, pvBlock);
    if (act === "zoom") {
      body.classList.toggle("pv-zoom");
      b.textContent = body.classList.contains("pv-zoom") ? "适宽" : "放大";
      savePv({ zoom: body.classList.contains("pv-zoom") });
      showPage(pvPage, pvBlock);
    }
  });
  PR.pageStep = (d) => showPage(pvPage + d, pvBlock);

  if (pvSaved.zoom) {
    body.classList.add("pv-zoom");
    const zb = PR.$('[data-pv="zoom"]');
    if (zb) zb.textContent = "适宽";
  }
  const followBox = PR.$(".pv-follow input");
  if (followBox) {
    if (pvSaved.follow === false) followBox.checked = false;
    followBox.addEventListener("change", () => savePv({ follow: followBox.checked }));
  }
  PR.$("#pageview").classList.toggle("v-en", view === "en");
  PR.$$("[data-pvv]").forEach((b) => b.classList.toggle("on", b.dataset.pvv === view));
  updateHead();
})(window.PR);
