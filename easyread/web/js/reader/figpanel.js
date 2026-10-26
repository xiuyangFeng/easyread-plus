/* 右侧面板：随文看图。读到提到“图 N”的段落时，把这些图上下排在右边，边读边看。
   只在右侧没开别的面板（原页、笔记、问 AI）时自动弹出；读到下一段没提到图，就留着上一组，不来回开合。
   图多了按各自比例分高度：都放得下就原样，放不下先压高的那几张，再不行才滚动。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;
  const panel = PR.$("#figpanel");
  if (!panel || S.pdf) return;

  const saved = PR.ls.get("easyread-fp", {});
  let auto = saved.auto !== false;     // 读到“图 N”时自动弹出
  let refBlocks = [];                  // [{id, el, figs}]，正文里提到了图的块，按文中顺序
  let shown = [];                      // 面板里正在显示的图（figure 块 id）
  let from = null;                     // 是哪一段提到的
  let dismissed = "";                  // 用户关掉面板时显示的那组图：读到同一组不再自己弹出来
  let prevSide = null;
  let lastActive = null;               // 上次同步时正在读的那段：只有换了段才换图，免得盖掉手动点开的图

  const keyOf = (ids) => ids.join(",");
  const wide = () => innerWidth >= 1180;  // 窄屏时面板盖在正文上，不自动弹

  panel.innerHTML =
    '<div class="fp-head"><b class="fp-title">随文看图</b><button class="fp-from" data-fp="from" title="跳回提到这些图的段落"></button>' +
    '<span class="grow"></span>' +
    '<label class="pv-follow" title="读到提到“图 N”的段落时，自动在右侧打开"><input type="checkbox"' + (auto ? " checked" : "") + "> 自动</label>" +
    '<button class="btn icon" data-fp="close" title="关闭">×</button></div>' +
    '<div class="fp-list"></div>';
  const list = panel.querySelector(".fp-list");
  const fromBtn = panel.querySelector(".fp-from");
  panel.querySelector(".pv-follow input").addEventListener("change", (e) => {
    auto = e.target.checked;
    PR.ls.set("easyread-fp", { auto });
  });

  /* 正文重排后重新收集：哪些块提到了哪些图（取渲染后的链接，改过的译文、对照的英文都算） */
  function collect() {
    refBlocks = [];
    for (const el of PR.$$("#paper > .blk")) {
      const id = el.dataset.id;
      const figs = [];
      el.querySelectorAll('a.xref[data-kind="fig"]').forEach((a) => {
        const fid = PR.xindex.fig[a.dataset.key];
        if (fid && fid !== id && !figs.includes(fid)) figs.push(fid);
      });
      if (figs.length) refBlocks.push({ id, el, figs });
    }
  }

  /* 正在读的、提到了图的那段：先看点中的段，再看阅读线（视口 30%）穿过的段，再看屏幕上半部离阅读线最近的 */
  function activeRef() {
    const cur = PR.currentBlock && PR.currentBlock();
    if (cur) { const r = refBlocks.find((x) => x.id === cur); if (r) return r; }
    const bar = (PR.$("#bar") || {}).offsetHeight || 0;
    const line = innerHeight * 0.3, low = innerHeight * 0.62;
    let best = null, dist = Infinity;
    for (const r of refBlocks) {
      const rc = r.el.getBoundingClientRect();
      if (rc.top > low) break;
      if (rc.bottom < bar + 20) continue;
      if (rc.top <= line && rc.bottom >= line) return r;
      const d = Math.min(Math.abs(rc.top - line), Math.abs(rc.bottom - line));
      if (d < dist) { dist = d; best = r; }
    }
    return best;
  }

  PR.syncFigs = function () {
    if (!PR.feature("figs") || !refBlocks.length) return;
    if (PR.side && PR.side !== "figs") return;
    const r = activeRef();
    if (!r) return;
    if (PR.side === "figs") {
      if (r.id === lastActive) return;
      lastActive = r.id;
      if (keyOf(r.figs) !== keyOf(shown) || r.id !== from) show(r.figs, r.id);
      return;
    }
    if (auto && wide() && keyOf(r.figs) !== dismissed && !body.classList.contains("drawer-open")) {
      lastActive = r.id;
      show(r.figs, r.id);
      PR.openSide("figs");
    }
  };

  PR.toggleFigs = function (force) {
    const open = force != null ? force : PR.side !== "figs";
    if (!open) return PR.openSide(null);
    const r = activeRef();
    lastActive = r ? r.id : null;
    if (r) show(r.figs, r.id); else if (!shown.length) render();
    PR.openSide("figs");
  };

  /* 正文里点“图 N”：面板开着就在面板里看（不跳走），返回 true；没开就照常跳到图 */
  PR.figShow = function (fid, srcBlock) {
    if (PR.side !== "figs" || !PR.blockById[fid]) return false;
    lastActive = (activeRef() || {}).id || null;
    if (!shown.includes(fid)) {
      const r = srcBlock && refBlocks.find((x) => x.id === srcBlock);
      show(r && r.figs.includes(fid) ? r.figs : [fid], srcBlock || from);
    }
    const card = list.querySelector('[data-id="' + fid + '"]');
    if (card) {
      list.scrollTo({ top: card.offsetTop - list.offsetTop - 8, behavior: "smooth" });
      card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    }
    return true;
  };

  function show(ids, src) {
    shown = ids.slice();
    from = src || null;
    render();
  }

  function figHtml(id) {
    const b = PR.blockById[id];
    const cap = PR.textFor(id + "#caption") || "";
    const m = cap.match(/^([^：:]{1,12})[：:.．]\s*/);
    const label = m ? m[1].trim() : "图 " + b.num;
    const img = b.src ? '<img src="' + PR.imageUrl(b.src) + '" alt="' + PR.esc(label) + '" decoding="async">'
      : '<button class="fig-missing" data-fp="page">图见原文第 ' + b.page + " 页（点击查看）</button>";
    return '<figure class="fp-fig" data-id="' + PR.esc(id) + '">' +
      '<div class="fp-bar"><b>' + PR.esc(label) + '</b><span class="pg">p.' + b.page + '</span><span class="grow"></span>' +
      '<button class="btn sm" data-fp="jump" title="跳到正文里的这张图">定位</button>' +
      (b.src ? '<button class="btn sm" data-fp="zoom" title="全屏放大（也可以直接点图）">放大</button>' : "") + "</div>" +
      '<div class="fp-img">' + img + "</div>" +
      (cap ? '<figcaption class="fp-cap" title="点击展开 / 收起图注">' + PR.md(m ? cap.slice(m[0].length) : cap, { xref: false }) + "</figcaption>" : "") +
      "</figure>";
  }

  function render() {
    const ids = shown.filter((id) => PR.blockById[id]);
    if (!ids.length) {
      const all = (S.paper.blocks || []).filter((b) => b.type === "figure" && b.num);
      fromBtn.textContent = "";
      list.innerHTML = '<div class="fp-empty hint">读到提到“图 N”的段落时，图会出现在这里；在正文里点“图 N”也会在这里打开。' +
        (all.length ? '<div class="fp-all">' + all.map((b) => '<button class="btn sm line" data-fp="pick" data-id="' + PR.esc(b.id) + '">图 ' + PR.esc(b.num) + "</button>").join("") + "</div>" : "") + "</div>";
      return;
    }
    const fb = from && PR.blockById[from];
    fromBtn.textContent = fb ? (activeRef() && activeRef().id === from ? "本段提到 " : "上文提到 ") + ids.length + " 张" + (fb.page ? " · p." + fb.page : "") : "";
    list.innerHTML = ids.map(figHtml).join("");
    list.scrollTop = 0;
    list.querySelectorAll(".fp-img img").forEach((im) => { if (!im.complete) im.addEventListener("load", fit, { once: true }); });
    fit();
  }

  /* 分高度：每张图在面板宽度下的自然高度 h_i，总可用高度 avail。
     放得下就不限；放不下找一个上限 c，让 Σmin(h_i, c) = avail（矮图不动，只压高图），c 不低于 180px，再不够就滚动。 */
  function fit() {
    const figs = Array.from(list.querySelectorAll(".fp-fig"));
    if (!figs.length || !list.clientHeight) return;
    const imgs = figs.map((f) => f.querySelector(".fp-img img"));
    imgs.forEach((im) => { if (im) im.style.maxHeight = ""; });
    const cs = getComputedStyle(list);
    let avail = list.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const nat = [];
    figs.forEach((f, i) => {
      const im = imgs[i];
      const boxH = im ? im.parentNode.offsetHeight : 0;
      avail -= f.offsetHeight - boxH + parseFloat(getComputedStyle(f).marginBottom || 0);
      if (!im) return;
      const w = im.parentNode.clientWidth;
      nat.push(im.naturalWidth ? w * im.naturalHeight / im.naturalWidth : boxH || 240);
    });
    if (!nat.length) return;
    const sum = nat.reduce((a, b) => a + b, 0);
    let cap = Infinity;
    if (sum > avail) {
      const hs = nat.slice().sort((a, b) => a - b);
      let rest = avail;
      for (let i = 0; i < hs.length; i++) {
        const c = rest / (hs.length - i);
        if (hs[i] >= c) { cap = c; break; }
        rest -= hs[i];
      }
      cap = Math.max(180, cap);
    }
    if (isFinite(cap)) imgs.forEach((im) => { if (im) im.style.maxHeight = Math.floor(cap) + "px"; });
  }

  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fp]");
    const fig = e.target.closest(".fp-fig");
    const id = fig && fig.dataset.id;
    if (!b) {
      const cap = e.target.closest(".fp-cap");
      if (cap && !e.target.closest("a")) { cap.classList.toggle("open"); fit(); }
      return;
    }
    const act = b.dataset.fp;
    if (act === "close") PR.toggleFigs(false);
    if (act === "from" && from) PR.jumpTo("b-" + from);
    if (act === "jump" && id) PR.jumpTo("b-" + id);
    if (act === "zoom" && id) { const im = fig.querySelector(".fp-img img"); if (im) im.click(); }
    if (act === "page" && id) { const fb = PR.blockById[id]; PR.openPage(fb.page, id); }
    if (act === "pick") { lastActive = (activeRef() || {}).id || null; show([b.dataset.id], null); }
  });

  PR.on("side", (name) => {
    if (prevSide === "figs" && name !== "figs") dismissed = keyOf(shown);  // 关掉了：这组图别再自己弹出来
    if (name === "figs") { dismissed = ""; setTimeout(fit, 360); }  // 等滑出、正文让位后再量一次
    prevSide = name;
  });
  PR.on("rendered", () => { collect(); if (PR.side === "figs") render(); });
  PR.on("block-rendered", () => collect());
  PR.$("#paper").addEventListener("click", (e) => { if (!e.target.closest("a")) setTimeout(PR.syncFigs, 0); });  // 点了段落：马上换成这段提到的图
  window.addEventListener("resize", PR.debounce(() => { if (PR.side === "figs") fit(); }, 150));
  PR.on("side-resized", () => { if (PR.side === "figs") fit(); });
  window.addEventListener("scroll", PR.throttle(PR.syncFigs, 200), { passive: true });
})(window.PR);
