/* 右侧面板：原文页（随阅读位置翻页、框出当前段）。和笔记面板共用右侧，一次开一个。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;
  let pvPage = 1, pvBlock = null;
  const pages = () => (S.paper.meta || {}).pages || [];

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
    PR.$('[data-act="pages"]').classList.toggle("on", name === "pages");
    PR.$('[data-act="notes"]').classList.toggle("on", name === "notes");
    PR.$('[data-act="figs"]').classList.toggle("on", name === "figs");
    PR.$('[data-act="map"]').classList.toggle("on", name === "map");
    PR.emit("side", name);
    clearTimeout(sideT);
    if (name) { const t = PR.$("#toast"); if (t) t.classList.remove("open"); }  // 提示条别挡住面板底部的输入框
    if (body.classList.contains("side-open") === !!name) return;  // 面板之间切换：正文宽度不变
    sideT = setTimeout(() => requestAnimationFrame(() => {
      const anchor = PR.readingBlock && PR.readingBlock();
      const node = anchor && document.getElementById("b-" + anchor);
      const before = node ? node.getBoundingClientRect().top : 0;
      body.classList.toggle("side-open", !!PR.side);
      PR.fitWide(); PR.renderMargin();
      PR.emit("side-layout");  // 正文让位完了：左边留白变了，主旨要重新排
      if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);  // 重排后还停在刚才读的地方
    }), 300);
  };

  /* 右侧面板宽度：拖面板左边缘调，记在本机，双击恢复默认。
     拖的时候只动面板（--side-drag），松手才让正文跟着重排一次，长论文拖起来也不卡。 */
  const root = document.documentElement;
  const wideScreen = () => innerWidth >= 1180;  // 窄屏面板盖在正文上，不调
  const clampW = (w) => Math.round(Math.max(320, Math.min(w, innerWidth - 520, innerWidth * 0.75)));
  function applySideW() {
    const w = PR.ls.get("easyread-side-w", 0);
    if (w && wideScreen()) root.style.setProperty("--side-w", clampW(w) + "px");
    else root.style.removeProperty("--side-w");
  }
  function relayout() {  // 正文宽度变了：重排后还停在刚才读的地方
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    return () => {
      PR.fitWide(); PR.renderMargin();
      if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);
      if (PR.side === "pages") showPage(pvPage, pvBlock);  // 面板变宽了可能要换大一号的原页图
      PR.emit("side-resized");
    };
  }
  applySideW();
  window.addEventListener("resize", PR.debounce(applySideW, 150));
  const grip = PR.el("div", { id: "side-grip", title: "拖动调整右侧面板宽度（双击恢复默认）" });
  document.body.appendChild(grip);
  grip.addEventListener("mousedown", (e) => e.preventDefault());  // 别让拖动顺带选中正文
  document.addEventListener("selectstart", (e) => { if (body.classList.contains("resizing")) e.preventDefault(); });
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    body.classList.add("resizing");
    let w = 0;
    const move = (ev) => { w = clampW(innerWidth - ev.clientX); root.style.setProperty("--side-drag", w + "px"); };
    const up = () => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      body.classList.remove("resizing");
      root.style.removeProperty("--side-drag");
      const sel = getSelection(); if (sel && !sel.isCollapsed && !PR.$("#selbar").contains(sel.anchorNode)) sel.removeAllRanges();
      if (!w) return;
      const done = relayout();
      PR.ls.set("easyread-side-w", w);
      applySideW();
      requestAnimationFrame(done);
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
  grip.addEventListener("dblclick", () => {
    const done = relayout();
    PR.ls.set("easyread-side-w", 0);
    applySideW();
    requestAnimationFrame(done);
  });

  PR.togglePages = function (force) {
    const open = force != null ? force : PR.side !== "pages";
    PR.openSide(open ? "pages" : null);
    if (open) PR.syncPage(true);
  };
  PR.openPage = function (page, blockId) {
    pvBlock = blockId || null;
    if (PR.side !== "pages") PR.openSide("pages");
    showPage(page, blockId);
  };

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

  PR.syncPage = function (force) {
    if (PR.side !== "pages") return;
    if (!force && !PR.$(".pv-follow input").checked) return;
    const id = (PR.currentBlock && PR.currentBlock()) || PR.readingBlock();
    const b = PR.blockById[id];
    if (!b) return;
    if (!force && id === pvBlock) return;
    pvBlock = id;
    const loc = S.layout[id];
    showPage(loc ? loc.page : b.page, id);
  };

  PR.$("#pageview").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pv]");
    if (!b) return;
    const act = b.dataset.pv;
    if (act === "close") PR.togglePages(false);
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

  /* 记住“放大”和“跟随”开关（存在浏览器里，下次打开还是这个状态） */
  function savePv(patch) { PR.ls.set("easyread-pv", Object.assign(PR.ls.get("easyread-pv", {}), patch)); }
  const pvSaved = PR.ls.get("easyread-pv", {});
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
})(window.PR);
