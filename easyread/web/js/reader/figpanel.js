/* 右侧面板：随文看图 + 本段脉络。
   上半部分放图：读到提到“图 N”的段落时换成这些图；一张占满，两张按长宽比自动并排或上下，三张以上（或点“聚焦”）一张大图加一排小图。
   下半部分放脉络：正在读的这段前后几段的主旨和承接、上面这几张图和别的图表 / 结果之间的关系、它们所在的结果链；点哪个就跳过去或在上面换图。
   中间的分隔条可以拖。只在右侧没开别的面板（原页、笔记、问 AI、脉络）时自动弹出；读到下一段没提到图，就留着上一组。 */
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
  let focus = null;                    // 几张图里“聚焦”的那张

  const keyOf = (ids) => ids.join(",");
  const readKey = (r) => (r ? r.id : "-" + ((PR.nearestGisted ? PR.nearestGisted(PR.readingBlock()) : PR.readingBlock()) || ""));
  const wide = () => innerWidth >= 1180;  // 窄屏时面板盖在正文上，不自动弹

  panel.innerHTML =
    '<div class="fp-head"><b class="fp-title">看图</b><button class="fp-from" data-fp="from" title="跳回提到这些图的段落"></button>' +
    '<span class="grow"></span>' +
    '<label class="pv-follow" title="读到提到“图 N”的段落时，自动在右侧打开"><input type="checkbox"' + (auto ? " checked" : "") + "> 自动</label>" +
    '<button class="btn icon" data-fp="close" title="关闭">×</button></div>' +
    '<div class="fp-top"></div><div class="fp-split" title="拖动调整图和脉络的上下比例（双击恢复）"></div><div class="fp-bottom"></div>';
  const top = panel.querySelector(".fp-top");
  const titleEl = panel.querySelector(".fp-title");
  const bottom = panel.querySelector(".fp-bottom");
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

  /* 面板开着：附近提到了图就上图下脉络；读到没提图的地方，有脉络就把图收起、脉络占满（没有脉络时图留着） */
  PR.syncFigs = function () {
    if (!PR.feature("figs")) return;
    if (PR.side && PR.side !== "figs") return;
    const r = refBlocks.length ? activeRef() : null;
    if (PR.side === "figs") {
      const key = readKey(r);
      if (key === lastActive) return;
      lastActive = key;
      if (r) { if (keyOf(r.figs) !== keyOf(shown) || r.id !== from) show(r.figs, r.id); }
      else if (shown.length && ctxOn()) show([], null);
      return;
    }
    if (!r) return;
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
    lastActive = readKey(r);
    if (r) show(r.figs, r.id); else if (ctxOn()) show([], null); else if (!shown.length) render();
    PR.openSide("figs");
  };

  /* 正文里点“图 N”：面板开着就在面板里看（不跳走），返回 true；没开就照常跳到图 */
  PR.figShow = function (fid, srcBlock) {
    if (PR.side !== "figs" || !PR.blockById[fid]) return false;
    lastActive = readKey(activeRef());
    if (!shown.includes(fid)) {
      const r = srcBlock && refBlocks.find((x) => x.id === srcBlock);
      show(r && r.figs.includes(fid) ? r.figs : [fid], srcBlock || from);
    }
    else if (shown.length > 2) { focus = fid; render(); }
    const card = top.querySelector('.fp-fig[data-id="' + fid + '"]');
    if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    return true;
  };

  function show(ids, src) {
    shown = ids.slice();
    from = src || null;
    focus = null;
    render();
  }
  /* 在上半部分看某张图：已经在就聚焦它；pair 给了就两张一起摆出来对比 */
  function showFig(fid, pair) {
    if (!PR.blockById[fid]) return;
    if (pair && PR.blockById[pair] && PR.blockById[pair].type === "figure" && pair !== fid) { shown = [pair, fid]; focus = null; }
    else if (shown.includes(fid)) focus = shown.length > 1 ? fid : null;
    else { shown = [fid]; focus = null; }
    lastActive = readKey(activeRef());
    render();
    const card = top.querySelector('.fp-fig[data-id="' + fid + '"]');
    if (card) { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
  }

  const floatInfo = (id) => ((S.gist || {}).floats || {})[id] || null;
  function labelOf(id) {
    const b = PR.blockById[id];
    if (!b) return id;
    const cap = PR.plain(PR.textFor(id + "#caption") || "");
    const m = cap.match(/^([^：:.．]{1,12})[：:.．]/);
    return m ? m[1].trim() : (b.type === "table" ? "表 " : "图 ") + (b.num || "");
  }
  PR.floatLabel = labelOf;

  function figHtml(id, opts) {
    const b = PR.blockById[id];
    const cap = PR.textFor(id + "#caption") || "";
    const m = cap.match(/^([^：:]{1,12})[：:.．]\s*/);
    const label = labelOf(id);
    const info = floatInfo(id);
    if (opts && opts.thumb) {
      return '<button class="fp-thumb" data-fp="focus" data-id="' + PR.esc(id) + '" title="' + PR.esc(label + (info && info.q ? "：" + info.q : "")) + '">' +
        (b.src ? '<img src="' + PR.imageUrl(b.src) + '" alt="" decoding="async">' : "") + "<span>" + PR.esc(label) + "</span></button>";
    }
    const img = b.src ? '<img src="' + PR.imageUrl(b.src) + '" alt="' + PR.esc(label) + '" decoding="async">'
      : '<button class="fig-missing" data-fp="page">图见原文第 ' + b.page + " 页（点击查看）</button>";
    const many = shown.length > 1;
    return '<figure class="fp-fig" data-id="' + PR.esc(id) + '">' +
      '<div class="fp-bar"><b>' + PR.esc(label) + '</b><span class="pg">p.' + b.page + '</span><span class="grow"></span>' +
      (many ? '<button class="btn sm" data-fp="focus" title="' + (focus === id ? "回到并排" : "只看这张，其余缩成小图") + '">' + (focus === id ? "并排" : "聚焦") + "</button>" : "") +
      '<button class="btn sm" data-fp="jump" title="跳到正文里的这张图">定位</button>' +
      (b.src ? '<button class="btn sm" data-fp="zoom" title="全屏放大（也可以直接点图）">放大</button>' : "") + "</div>" +
      (info && (info.q || info.look) ? '<div class="fp-look" title="' + PR.esc((info.q || "") + (info.look ? "\n看点：" + info.look : "")) + '">' + (info.q ? "<b>" + PR.esc(info.q) + "</b>" : "") + (info.look ? "<span>看点：" + PR.esc(info.look) + "</span>" : "") + "</div>" : "") +
      '<div class="fp-img">' + img + "</div>" +
      (cap ? '<figcaption class="fp-cap" title="点击展开 / 收起图注">' + PR.md(m ? cap.slice(m[0].length) : cap, { xref: false }) + "</figcaption>" : "") +
      "</figure>";
  }

  function render() {
    const ids = shown.filter((id) => PR.blockById[id]);
    panel.classList.toggle("has-ctx", ctxOn());
    panel.classList.toggle("ctx-only", !ids.length && ctxOn());
    titleEl.textContent = !ids.length && ctxOn() ? "本段脉络" : "看图";
    if (!ids.length && ctxOn()) {
      fromBtn.textContent = "这里没有提到图";
      top.className = "fp-top none"; top.innerHTML = ""; top.style.flexBasis = "";
      renderCtx();
      return;
    }
    if (!ids.length) {
      const all = (S.paper.blocks || []).filter((b) => b.type === "figure" && b.num);
      fromBtn.textContent = "";
      top.className = "fp-top empty";
      top.innerHTML = '<div class="fp-empty hint">读到提到“图 N”的段落时，图会出现在这里；在正文里点“图 N”也会在这里打开。' +
        (all.length ? '<div class="fp-all">' + all.map((b) => '<button class="btn sm line" data-fp="pick" data-id="' + PR.esc(b.id) + '">图 ' + PR.esc(b.num) + "</button>").join("") + "</div>" : "") + "</div>";
      renderCtx();
      return;
    }
    const fb = from && PR.blockById[from];
    fromBtn.textContent = fb ? (activeRef() && activeRef().id === from ? "本段提到 " : "上文提到 ") + ids.length + " 张" + (fb.page ? " · p." + fb.page : "") : "";
    // 一张：占满；两张：并排或上下（fit 里按长宽比选）；三张以上或点了“聚焦”：一张大图 + 一排小图
    const multi = ids.length >= 3 || (focus && ids.includes(focus));
    const main = multi ? (focus && ids.includes(focus) ? focus : ids[0]) : null;
    top.className = "fp-top " + (multi ? "multi" : ids.length === 2 ? "two" : "one");
    top.innerHTML = multi
      ? figHtml(main) + '<div class="fp-thumbs">' + ids.filter((x) => x !== main).map((x) => figHtml(x, { thumb: true })).join("") + "</div>"
      : ids.map((x) => figHtml(x)).join("");
    top.querySelectorAll(".fp-img img").forEach((im) => { if (!im.complete) im.addEventListener("load", fit, { once: true }); });
    fit();
    renderCtx();
  }

  /* 上半部分排图：图都按比例完整显示（contain），不滚动。
     两张时比较“并排”和“上下”两种摆法下两张图各自能放多大，取较小那张更大的摆法——两张都看得清。 */
  function fit() {
    top.style.flexBasis = "";  // 先按拖出来的比例（上限）量
    const cards = Array.from(top.querySelectorAll(".fp-fig"));
    if (!cards.length || !top.clientHeight) return;
    const imgs = cards.map((c) => c.querySelector(".fp-img img"));
    const cs = getComputedStyle(top);
    const W = top.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let H = top.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const thumbs = top.querySelector(".fp-thumbs");
    if (thumbs) H -= thumbs.offsetHeight + 8;
    const GAP = 10, PADX = 20;
    const chrome = (c, im) => c.offsetHeight - (im ? im.parentNode.offsetHeight : 0);
    const scaleOf = (im, w, h) => (im && im.naturalWidth ? Math.min(w / im.naturalWidth, h / im.naturalHeight) : 0);
    imgs.forEach((im) => { if (im) im.style.maxHeight = "40px"; });
    if (cards.length === 2 && imgs[0] && imgs[1]) {
      top.classList.remove("row");
      const ch = cards.map((c, i) => chrome(c, imgs[i]));
      const col = Math.min(...imgs.map((im, i) => scaleOf(im, W - PADX, (H - GAP) / 2 - ch[i])));
      const row = Math.min(...imgs.map((im, i) => scaleOf(im, (W - GAP) / 2 - PADX, H - ch[i] * 1.25)));
      top.classList.toggle("row", row > col * 1.05);
    }
    const isRow = top.classList.contains("row");
    cards.forEach((c, i) => {
      const im = imgs[i];
      if (!im) return;
      const share = cards.length === 2 && !isRow ? (H - GAP) / 2 : H;
      im.style.maxHeight = Math.max(80, Math.floor(share - chrome(c, im))) + "px";
    });
    // 图按比例放完还有空：上半部分收到刚好装下，多出来的高度给下面的脉络
    if (panel.classList.contains("has-ctx")) {
      const tr = top.getBoundingClientRect();
      const used = Math.max(...Array.from(top.children).map((c) => c.getBoundingClientRect().bottom)) - tr.top + parseFloat(cs.paddingBottom);
      if (used < tr.height - 16) top.style.flexBasis = Math.ceil(used) + "px";
    }
  }

  /* ---------- 下半部分：本段脉络、图表关系、结果链 ---------- */
  const ctxOn = () => PR.feature("gist") && !!PR.hasGists && PR.hasGists();
  let ctxFor = null;
  const REL_CLS = { 对照: "cmp", 递进: "up", 推广: "gen", 细化: "fine", 互证: "co", 补充: "add", 反差: "anti" };
  PR.relCls = (rel) => "rel-" + (REL_CLS[rel] || "add");

  function nodeChip(id, pair) {
    const b = PR.blockById[id];
    if (!b) return "";
    if (b.type === "figure" || b.type === "table") {
      return '<button class="fp-node float' + (shown.includes(id) ? " on" : "") + '" data-node="' + PR.esc(id) + '"' + (pair ? ' data-pair="' + PR.esc(pair) + '"' : "") +
        ' title="' + PR.esc((floatInfo(id) || {}).q || labelOf(id)) + '">' + PR.esc(labelOf(id)) + "</button>";
    }
    const g = PR.gists()[id];
    return '<button class="fp-node para' + (id === ctxFor ? " on" : "") + '" data-node="' + PR.esc(id) + '" title="' + PR.esc(g ? g.gist : "") + '">' +
      (g && g.role ? '<span class="g-role ' + PR.roleCls(g.role) + '">' + PR.esc(g.role) + "</span>" : "") +
      "<span>" + PR.esc(g ? g.gist.slice(0, 16) + (g.gist.length > 16 ? "…" : "") : "p." + b.page) + "</span></button>";
  }

  function renderCtx() {
    if (!ctxOn()) { bottom.innerHTML = ""; return; }
    const G = S.gist || {};
    const id = PR.nearestGisted((PR.currentBlock && PR.currentBlock()) || PR.readingBlock());
    ctxFor = id;
    const secs = PR.gistOutline ? PR.gistOutline() : [];
    let sec = null, i = -1;
    for (const s of secs) { const k = s.paras.findIndex((p) => p.id === id); if (k >= 0) { sec = s; i = k; break; } }
    if (!sec && secs.length) {  // 停在标题、图、公式上：用它所在那一节（或之前最近的一节）的开头
      const o = PR.order[id] != null ? PR.order[id] : 0;
      sec = secs.filter((s) => s.id === id || PR.order[s.paras[0].id] <= o).pop() || secs[0];
      i = 0;
    }
    let h = "";
    if (panel.classList.contains("ctx-only")) {  // 上文最近提到的图：一键拿回来
      const line = innerHeight * 0.3;
      const prev = refBlocks.filter((x) => x.el.getBoundingClientRect().top < line).pop();
      if (prev) h += '<button class="fp-prevfigs" data-fp="prevfigs" data-id="' + PR.esc(prev.id) + '">' + PR.icon("image", "sm") + "看上文提到的 " + prev.figs.map((f) => PR.esc(labelOf(f))).join("、") + "</button>";
    }
    if (sec) {
      const full = panel.classList.contains("ctx-only");  // 没有图、脉络占满整个面板：多看几段
      const lo = Math.max(0, i - (full ? 3 : 1)), hi = Math.min(sec.paras.length, i + (full ? 7 : 3));  // 有图时前 1 段、本段、后 2 段，留地方给图表关系
      h += '<div class="fp-ctx-h"><span class="ttl">本段脉络 · ' + PR.esc(sec.title) + '</span><span class="grow"></span><button class="btn sm" data-fp="map" title="打开全文脉络">全文脉络 ›</button></div>';
      const sg = ((G.sections || {})[sec.id] || {}).gist;
      if (sg && lo === 0) h += '<div class="mp-sec-g">' + PR.esc(sg) + "</div>";
      if (lo > 0) h += '<div class="fp-more hint">…前面还有 ' + lo + " 段</div>";
      for (let k = lo; k < hi; k++) {
        const p = sec.paras[k], e = PR.gists()[p.id];
        if (k > lo) h += linkRow(e);
        h += e ? '<button class="mp-card ' + PR.roleCls(e.role) + (p.id === id ? " on-read" : "") + '" data-jump="' + PR.esc(p.id) + '"' + (e.why ? ' title="' + PR.esc(e.why) + '"' : "") + ">" +
          (e.role ? '<span class="g-role ' + PR.roleCls(e.role) + '">' + PR.esc(e.role) + "</span>" : "") + '<span class="t">' + PR.esc(e.gist) + "</span></button>"
          : '<button class="mp-card missing" data-jump="' + PR.esc(p.id) + '"><span class="t">（这段还没有主旨）</span></button>';
      }
      if (hi < sec.paras.length) h += '<div class="fp-more hint">…后面还有 ' + (sec.paras.length - hi) + " 段</div>";
    }
    // 和上面这几张图、和本段有关的关系
    const focusIds = new Set(shown.concat(id ? [id] : []));
    const links = (G.links || []).filter((l) => focusIds.has(l.from) || focusIds.has(l.to));
    if (links.length) {
      h += '<div class="fp-ctx-h"><span class="ttl">图表与结果之间</span></div><div class="fp-links">' + links.slice(0, 8).map((l) =>
        '<div class="fp-link ' + PR.relCls(l.rel) + '">' + nodeChip(l.from, l.to) + '<span class="rel">' + PR.esc(l.rel) + " →</span>" + nodeChip(l.to, l.from) +
        (l.note ? '<span class="note">' + PR.esc(l.note) + "</span>" : "") + "</div>").join("") + "</div>";
    }
    // 结果链：上面的图 / 本段在哪条链上
    const chains = (G.chains || []).filter((c) => c.steps.some((st) => focusIds.has(st.id)));
    for (const c of chains.slice(0, 2)) {
      h += '<div class="fp-ctx-h"><span class="ttl">结果链 · ' + PR.esc(c.title) + "</span></div>" +
        '<div class="fp-chain">' + c.steps.map((st, k) => (k ? '<span class="arr">→</span>' : "") +
          '<span class="step' + (focusIds.has(st.id) ? " here" : "") + '"><span class="k">' + (k + 1) + "</span>" + nodeChip(st.id) +
          (st.note ? '<span class="note">' + PR.esc(st.note) + "</span>" : "") + "</span>").join("") + "</div>" +
        (c.conclusion ? '<div class="fp-concl">⇒ ' + PR.esc(c.conclusion) + "</div>" : "");
    }
    if (!links.length && !chains.length && PR.canAsk() && !G.chains) {
      h += '<div class="hint fp-more">还没有整理图表之间的关系。<button class="btn sm line" data-fp="relations">整理</button></div>';
    }
    bottom.innerHTML = h;
    const on = bottom.querySelector(".mp-card.on-read");
    if (on) { const r = on.getBoundingClientRect(), br = bottom.getBoundingClientRect(); if (r.top < br.top || r.bottom > br.bottom) bottom.scrollTop += r.top - br.top - 40; }
  }
  const LINK_CLS = { 转折: "turn", 递进: "up", 证据: "ev", 举例: "ex", 细化: "fine", 并列: "par", 总结: "sum" };
  function linkRow(e) {
    const l = e && e.link && e.link !== "开启" ? e.link : "";
    return '<div class="mp-link' + (l ? " l-" + (LINK_CLS[l] || "x") : "") + '"><i></i>' + (l ? "<span>" + PR.esc(l) + "</span>" : "") + "</div>";
  }
  /* 读到别的段：只重画下半部分（上半部分的图留着） */
  const syncCtx = PR.throttle(() => {
    if (PR.side !== "figs" || !ctxOn()) return;
    const id = PR.nearestGisted((PR.currentBlock && PR.currentBlock()) || PR.readingBlock());
    if (id !== ctxFor) renderCtx();
  }, 250);

  /* 上下比例：拖中间的分隔条，记在本机，双击恢复 */
  const split = panel.querySelector(".fp-split");
  const setSplit = (r) => panel.style.setProperty("--fp-top", Math.round(Math.max(25, Math.min(85, r))) + "%");
  setSplit(saved.split || 60);
  const saveSplit = (r) => { saved.split = Math.round(Math.max(25, Math.min(85, r))); PR.ls.set("easyread-fp", Object.assign(PR.ls.get("easyread-fp", {}), { split: saved.split })); };
  split.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    body.classList.add("resizing-v");
    const box = panel.getBoundingClientRect(), headH = panel.querySelector(".fp-head").offsetHeight;
    let r = saved.split || 60;
    const move = (ev) => { r = ((ev.clientY - box.top - headH) / (box.height - headH)) * 100; setSplit(r); };
    const up = () => {
      split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up);
      body.classList.remove("resizing-v");
      saveSplit(r); fit();
    };
    split.addEventListener("pointermove", move); split.addEventListener("pointerup", up);
  });
  split.addEventListener("dblclick", () => { saveSplit(60); setSplit(60); fit(); });

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
    if (act === "pick") { lastActive = readKey(activeRef()); show([b.dataset.id], null); }
    if (act === "focus") { const fid = b.dataset.id || id; focus = focus === fid ? null : fid; render(); }
    if (act === "map") PR.toggleMap(true);
    if (act === "relations") PR.gistRun("relations");
    if (act === "prevfigs") { const r = refBlocks.find((x) => x.id === b.dataset.id); if (r) { lastActive = readKey(activeRef()); show(r.figs, r.id); } }
  });
  /* 下半部分：段落卡片跳到原文；图表节点在上面换图（关系里的两张图一起摆出来对比），表格和段落跳到原文 */
  bottom.addEventListener("click", (e) => {
    const j = e.target.closest("[data-jump]");
    if (j) { PR.jumpTo("b-" + j.dataset.jump); return; }
    const n = e.target.closest("[data-node]");
    if (!n) return;
    const nid = n.dataset.node, nb = PR.blockById[nid];
    if (nb && nb.type === "figure") showFig(nid, n.dataset.pair);
    else PR.jumpTo("b-" + nid);
  });

  PR.on("side", (name) => {
    if (prevSide === "figs" && name !== "figs") dismissed = keyOf(shown);  // 关掉了：这组图别再自己弹出来
    if (name === "figs") { dismissed = ""; renderCtx(); setTimeout(fit, 360); }  // 等滑出、正文让位后再量一次
    prevSide = name;
  });
  PR.on("rendered", () => { collect(); if (PR.side === "figs") render(); });
  PR.on("gist-changed", () => { if (PR.side === "figs") render(); });
  PR.on("remote", (changed) => { if (changed.includes("gist") && PR.side === "figs") render(); });
  PR.on("block-rendered", () => collect());
  PR.$("#paper").addEventListener("click", (e) => { if (!e.target.closest("a")) setTimeout(PR.syncFigs, 0); });  // 点了段落：马上换成这段提到的图
  window.addEventListener("resize", PR.debounce(() => { if (PR.side === "figs") fit(); }, 150));
  PR.on("side-resized", () => { if (PR.side === "figs") fit(); });
  window.addEventListener("scroll", PR.throttle(PR.syncFigs, 200), { passive: true });
  window.addEventListener("scroll", syncCtx, { passive: true });
  PR.$("#paper").addEventListener("click", () => setTimeout(syncCtx, 0));
  PR.showFig = (fid, pair) => { if (PR.side !== "figs") { shown = []; PR.openSide("figs"); } showFig(fid, pair); };
})(window.PR);
