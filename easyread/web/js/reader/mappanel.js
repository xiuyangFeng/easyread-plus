/* 右侧面板：论文脉络。
   - 脉络：全文故事线；全景条（每节一行，每段一个按角色着色的点）；再按章节把每段主旨排成卡片，卡片之间标出承接（递进、转折……）。
   - 论点：模型提炼的 3–6 个核心论点，每个下面挂着支撑它的段落、图、表，点了跳回原文核对；证据单薄的会标出来。
   - 图表：结果链（证据顺序，图表带缩略图）、图表关系弧线图（对照、递进、推广……）、全部关系。
   都是竖着排，面板多窄都不用左右滑。跟着阅读位置高亮当前段。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const panel = PR.$("#mappanel");
  if (!panel) return;

  let tab = PR.ls.get("easyread-mp-tab", "flow");
  let follow = PR.ls.get("easyread-mp-follow", true);
  let cur = null;

  panel.innerHTML =
    '<div class="mp-head"><b class="mp-title">论文脉络</b>' +
    '<div class="seg"><button data-mt="flow">脉络</button><button data-mt="claims">论点</button><button data-mt="rel">图表</button></div>' +
    '<span class="grow"></span>' +
    '<label class="pv-follow" title="跟着阅读位置高亮、滚动"><input type="checkbox"' + (follow ? " checked" : "") + "> 跟随</label>" +
    '<button class="btn sm" data-mp="skim" title="正文收成一行行主旨，快速扫论证骨架">只看主旨</button>' +
    '<button class="btn icon" data-mp="more" title="生成、导出">⋯</button>' +
    '<button class="btn icon" data-mp="close" title="关闭">×</button></div>' +
    '<div class="mp-status"></div><div class="mp-body"></div>';
  const bodyEl = panel.querySelector(".mp-body");
  const statusEl = panel.querySelector(".mp-status");
  panel.querySelector(".pv-follow input").addEventListener("change", (e) => { follow = e.target.checked; PR.ls.set("easyread-mp-follow", follow); if (follow) syncCurrent(true); });

  PR.mapOpen = () => PR.side === "map";
  PR.toggleMap = function (force) {
    const open = force != null ? force : PR.side !== "map";
    PR.openSide(open ? "map" : null);
    if (open) { render(); setTimeout(() => syncCurrent(true), 380); }
  };

  /* ---------- 数据 ---------- */
  const G = () => S.gist || {};
  /* 和服务端 gist.outline 一样分节：一级标题一节；参考文献之后的零碎、文末事务性章节（致谢、声明……）不算；太短的段不写主旨 */
  const SKIP = /致谢|声明|利益|作者贡献|CRediT|可用性|资助|基金|附加信息|补充信息|参考文献|Acknowledg|Declaration|Funding|Availability/i;
  const titleOf = (b) => { const t = PR.plain(PR.textFor(b.id) || b.zh || "").trim(), n = String(b.num || "").trim(); return !n || t.startsWith(n) ? t : n + " " + t; };
  function outline() {
    const secs = [];
    let sec = null, sub = "", inRefs = false;
    for (const b of S.paper.blocks || []) {
      if (b.type === "references") { sec = null; inRefs = true; continue; }
      if (b.type === "heading" && (b.level || 1) === 1) { sec = { id: b.id, title: titleOf(b), paras: [] }; secs.push(sec); sub = ""; inRefs = SKIP.test(sec.title); continue; }
      if (b.type === "heading") { sub = titleOf(b); continue; }
      if (inRefs || !["para", "list"].includes(b.type) || PR.gistSource(b).length < 24) continue;
      if (!sec) { sec = { id: "_front", num: "", title: b.role === "abstract" ? "摘要" : "开头", paras: [] }; secs.push(sec); }
      sec.paras.push({ id: b.id, sub });
    }
    return secs.filter((s) => s.paras.length);
  }
  const secLabel = (s) => s.title;
  PR.gistOutline = outline;

  /* ---------- 渲染 ---------- */
  function render() {
    if (PR.side !== "map") return;
    PR.$$("[data-mt]", panel).forEach((b) => b.classList.toggle("on", b.dataset.mt === tab));
    PR.$('[data-mp="skim"]', panel).classList.toggle("on", PR.skimOn && PR.skimOn());
    renderStatus();
    const secs = outline();
    const total = secs.reduce((n, s) => n + s.paras.length, 0);
    const have = secs.reduce((n, s) => n + s.paras.filter((p) => PR.gists()[p.id]).length, 0);
    if (!have) { bodyEl.innerHTML = emptyHtml(total, secs.length); return; }
    bodyEl.innerHTML = tab === "claims" ? claimsHtml() : tab === "rel" ? relHtml() : flowHtml(secs);
    syncCurrent(false);
  }

  function emptyHtml(total, nsec) {
    const can = PR.canAsk();
    return '<div class="mp-empty"><p><b>还没有段落主旨。</b></p>' +
      "<p>生成后：每段旁边有一句话主旨，标出它是“问题、方法、结果……”，以及和上一段是递进还是转折；这里会画出全文的脉络，再提炼出核心论点和支撑它们的段落、图、表。</p>" +
      '<p class="hint">这篇共 ' + total + " 段，分 " + nsec + " 节；模型会按章节读译文（每节一到几次调用），最后再看一遍全文提炼论点。用的是设置里的翻译模型。</p>" +
      (can ? (PR.gistJob ? "" : '<button class="btn primary" data-mp="gen">生成主旨与脉络</button>')
        : '<p class="hint">' + (PR.store.mode === "server" ? "还没有设置模型：在文献库的“设置”里选一个翻译模型。" : "离线版只能看，不能生成。") + "</p>") + "</div>";
  }

  function renderStatus() {
    const j = PR.gistJob;
    if (j) {
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      statusEl.innerHTML = '<div class="mp-job"><span class="spin"></span><span class="grow">' + PR.esc(j.message || "生成中") + "</span>" +
        '<button class="btn sm line" data-mp="stop">停止</button></div><div class="mp-bar"><i style="width:' + pct + '%"></i></div>';
      statusEl.style.display = "";
      return;
    }
    const stale = Object.keys(PR.gists()).filter((id) => PR.gistStale(id)).length;
    const missing = outline().reduce((n, s) => n + s.paras.filter((p) => !PR.gists()[p.id]).length, 0);
    if (PR.hasGists() && (stale || missing) && PR.canAsk()) {
      statusEl.innerHTML = '<div class="mp-job"><span class="grow">' + [missing ? missing + " 段还没有主旨" : "", stale ? stale + " 段译文改过、主旨可能过时" : ""].filter(Boolean).join("，") +
        '</span><button class="btn sm line" data-mp="gen">补全</button></div>';
      statusEl.style.display = "";
    } else { statusEl.innerHTML = ""; statusEl.style.display = "none"; }
  }

  function storyHtml() {
    return G().story ? '<div class="mp-story"><div class="lbl">全文故事线</div>' + PR.esc(G().story) + "</div>" : "";
  }

  function flowHtml(secs) {
    const gs = PR.gists();
    const counts = {};
    // 全景：每节一行，每段一个点
    const overview = '<div class="mp-overview">' + secs.map((s) =>
      '<div class="ov-row"><button class="ov-label" data-jump="' + PR.esc(s.id === "_front" ? s.paras[0].id : s.id) + '" title="' + PR.esc(secLabel(s)) + '">' + PR.esc(secLabel(s)) + "</button>" +
      '<span class="ov-dots">' + s.paras.map((p) => {
        const e = gs[p.id];
        if (e && e.role) counts[e.role] = (counts[e.role] || 0) + 1;
        return '<i class="dot ' + (e ? PR.roleCls(e.role) : "missing") + '" data-jump="' + PR.esc(p.id) + '" title="' + PR.esc(e ? (e.role ? e.role + "｜" : "") + e.gist : "还没有主旨") + '"></i>';
      }).join("") + "</span></div>").join("") + "</div>";
    const legend = '<div class="mp-legend">' + PR.GIST_ROLES.filter((r) => counts[r]).map((r) =>
      '<span><i class="dot ' + PR.roleCls(r) + '"></i>' + r + " " + counts[r] + "</span>").join("") + "</div>";
    // 章节流
    const flow = secs.map((s) => {
      const sg = ((G().sections || {})[s.id] || {}).gist;
      let lastSub = "", h = '<section class="mp-sec"><button class="mp-sec-h" data-jump="' + PR.esc(s.id === "_front" ? s.paras[0].id : s.id) + '">' + PR.esc(secLabel(s)) + "</button>" +
        (sg ? '<div class="mp-sec-g">' + PR.esc(sg) + "</div>" : "");
      s.paras.forEach((p, i) => {
        const e = gs[p.id];
        if (p.sub && p.sub !== lastSub) { h += '<div class="mp-sub">' + PR.esc(p.sub) + "</div>"; lastSub = p.sub; }
        else if (i > 0) h += linkHtml(e);
        h += e ? '<button class="mp-card ' + PR.roleCls(e.role) + (e.by === "me" ? " mine" : "") + '" data-jump="' + PR.esc(p.id) + '" data-card="' + PR.esc(p.id) + '"' + (e.why ? ' title="' + PR.esc(e.why) + '"' : "") + ">" +
          (e.role ? '<span class="g-role ' + PR.roleCls(e.role) + '">' + PR.esc(e.role) + "</span>" : "") + '<span class="t">' + PR.esc(e.gist) + "</span>" +
          (PR.gistStale(p.id) ? '<span class="g-stale">可能过时</span>' : "") + "</button>"
          : '<button class="mp-card missing" data-jump="' + PR.esc(p.id) + '" data-card="' + PR.esc(p.id) + '"><span class="t">（这段还没有主旨）</span></button>';
      });
      return h + "</section>";
    }).join("");
    return storyHtml() + overview + legend + '<div class="mp-flow">' + flow + "</div>";
  }

  const LINK_CLS = { 转折: "turn", 递进: "up", 证据: "ev", 举例: "ex", 细化: "fine", 并列: "par", 总结: "sum" };
  function linkHtml(e) {
    const l = e && e.link && e.link !== "开启" ? e.link : "";
    return '<div class="mp-link' + (l ? " l-" + (LINK_CLS[l] || "x") : "") + '"><i></i>' + (l ? "<span>" + PR.esc(l) + "</span>" : "") + "</div>";
  }

  function supportLabel(id) {
    const b = PR.blockById[id];
    if (!b) return { kind: "", text: id };
    if (b.type === "figure" || b.type === "table") {
      const cap = PR.plain(PR.textFor(id + "#caption") || "");
      const m = cap.match(/^([^：:.．]{1,12})[：:.．]\s*/);
      return { kind: b.type === "figure" ? "图" : "表", label: m ? m[1] : (b.type === "figure" ? "图 " : "表 ") + (b.num || ""), text: m ? cap.slice(m[0].length) : cap };
    }
    const e = PR.gists()[id];
    return { kind: "段", role: e && e.role, text: e ? e.gist : PR.plain(PR.gistSource(b)).slice(0, 40), page: b.page };
  }

  function claimsHtml() {
    const claims = G().claims || [];
    if (!claims.length) {
      return storyHtml() + '<div class="mp-empty"><p>还没有提炼核心论点。</p>' + (PR.canAsk() && !PR.gistJob ? '<button class="btn primary" data-mp="structure">提炼故事线和论点</button>' : "") + "</div>";
    }
    const KCLS = { 主结论: "main", 方法主张: "meth", 次要结论: "minor" };
    return storyHtml() + '<div class="mp-claims">' + claims.map((c, i) =>
      '<div class="mp-claim k-' + (KCLS[c.kind] || "minor") + '"><div class="mp-claim-h"><span class="n">' + (i + 1) + '</span><span class="kind">' + PR.esc(c.kind || "") + "</span>" +
      '<span class="t">' + PR.esc(c.claim) + "</span></div>" +
      (c.support && c.support.length ? '<ul class="mp-support">' + c.support.map((s) => {
        const L = supportLabel(s.id);
        return '<li><button data-jump="' + PR.esc(s.id) + '" data-card="' + PR.esc(s.id) + '">' +
          (L.kind === "段" ? '<span class="g-role ' + PR.roleCls(L.role) + '">' + PR.esc(L.role || "段落") + "</span>" : '<span class="s-float">' + PR.esc(L.label) + "</span>") +
          '<span class="t">' + PR.esc(L.text) + "</span>" + (s.how ? '<span class="how">' + PR.esc(s.how) + "</span>" : "") +
          (L.page ? '<span class="pg">p.' + L.page + "</span>" : "") + "</button></li>";
      }).join("") + "</ul>" : '<div class="hint mp-nosup">模型没有给出直接证据</div>') +
      (c.weak ? '<div class="mp-weak" title="证据可能不足的地方，值得读原文时留意">证据提示：' + PR.esc(c.weak) + "</div>" : "") + "</div>").join("") + "</div>" +
      '<p class="hint mp-foot">论点和证据由模型根据各段主旨提炼，点每一条可以跳回原文核对。</p>';
  }

  /* ---------- 图表：结果链 + 图表关系弧线图 ---------- */
  const REL_ORDER = ["对照", "递进", "推广", "细化", "互证", "补充", "反差"];
  function nodeHtml(id) {
    const b = PR.blockById[id];
    if (!b) return "";
    const info = ((G().floats || {})[id]) || {};
    if (b.type === "figure" || b.type === "table") {
      return '<button class="mp-node float" data-jump="' + PR.esc(id) + '" data-card="' + PR.esc(id) + '">' +
        (b.type === "figure" && b.src ? '<img src="' + PR.imageUrl(b.src) + '" alt="" loading="lazy" decoding="async">' : "") +
        '<span class="body"><span class="s-float">' + PR.esc(PR.floatLabel ? PR.floatLabel(id) : id) + "</span>" +
        (info.q ? '<span class="t">' + PR.esc(info.q) + "</span>" : "") + (info.look ? '<span class="look">看点：' + PR.esc(info.look) + "</span>" : "") + "</span></button>";
    }
    const e = PR.gists()[id];
    return '<button class="mp-node para" data-jump="' + PR.esc(id) + '" data-card="' + PR.esc(id) + '"><span class="body">' +
      (e && e.role ? '<span class="g-role ' + PR.roleCls(e.role) + '">' + PR.esc(e.role) + "</span>" : "") +
      '<span class="t">' + PR.esc(e ? e.gist : PR.plain(PR.gistSource(b)).slice(0, 40)) + '</span><span class="pg">p.' + b.page + "</span></span></button>";
  }

  function relHtml() {
    const g = G();
    const chains = g.chains || [], links = g.links || [];
    if (!chains.length && !links.length && !Object.keys(g.floats || {}).length) {
      return '<div class="mp-empty"><p>还没有整理图表和结果之间的关系。</p><p class="hint">会看一遍所有图表的题注和结果段落的主旨：说明每张图回答什么、该看哪里，图表之间是对照、递进还是推广，再串出几条“结果链”。只调用一次模型。</p>' +
        (PR.canAsk() && !PR.gistJob ? '<button class="btn primary" data-mp="relations">整理图表关系</button>' : "") + "</div>";
    }
    let h = "";
    // 结果链：竖着的流程，图表带缩略图
    if (chains.length) {
      h += '<div class="mp-h2">结果链 <span class="hint">论文用来证明每件事的证据顺序</span></div>';
      h += chains.map((c) => '<div class="mp-chainbox"><div class="mp-chain-t">' + PR.esc(c.title) + "</div>" +
        c.steps.map((st, k) => (k ? '<div class="mp-arrow">↓' + (st.note ? " <span>" + PR.esc(st.note) + "</span>" : "") + "</div>" : (st.note ? '<div class="mp-arrow first"><span>' + PR.esc(st.note) + "</span></div>" : "")) + nodeHtml(st.id)).join("") +
        (c.conclusion ? '<div class="mp-arrow">⇓</div><div class="mp-concl">' + PR.esc(c.conclusion) + "</div>" : "") + "</div>").join("");
    }
    // 弧线图：图表按文中顺序排一列，有关系的用弧线连起来（颜色 = 关系），悬停高亮
    const floats = (S.paper.blocks || []).filter((b) => (b.type === "figure" || b.type === "table") && (b.num || (g.floats || {})[b.id]));
    const idx = Object.fromEntries(floats.map((b, i) => [b.id, i]));
    const fl = links.filter((l) => idx[l.from] != null && idx[l.to] != null);
    if (floats.length && fl.length) {
      const ROW = 46, GUT = 74;
      const used = new Set(fl.flatMap((l) => [l.from, l.to]));
      const arcs = fl.map((l) => {
        const a = idx[l.from], b = idx[l.to], y1 = a * ROW + ROW / 2, y2 = b * ROW + ROW / 2;
        const d = Math.min(GUT - 8, 14 + 9 * Math.abs(b - a));
        return '<path class="' + PR.relCls(l.rel) + '" data-a="' + PR.esc(l.from) + '" data-b="' + PR.esc(l.to) + '" d="M' + GUT + " " + y1 + " C" + (GUT - d) + " " + y1 + " " + (GUT - d) + " " + y2 + " " + GUT + " " + y2 + '">' +
          "<title>" + PR.esc(PR.floatLabel(l.from) + " " + l.rel + " " + PR.floatLabel(l.to) + (l.note ? "：" + l.note : "")) + "</title></path>";
      }).join("");
      h += '<div class="mp-h2">图表关系 <span class="hint">悬停一张图看它连着谁</span></div>' +
        '<div class="mp-legend">' + REL_ORDER.filter((r) => fl.some((l) => l.rel === r)).map((r) => '<span class="' + PR.relCls(r) + '"><i class="relbar"></i>' + r + "</span>").join("") + "</div>" +
        '<div class="mp-arcs" style="--row:' + ROW + 'px;--gut:' + GUT + 'px"><svg width="' + GUT + '" height="' + floats.length * ROW + '">' + arcs + "</svg>" +
        floats.map((b) => { const info = (g.floats || {})[b.id] || {};
          return '<button class="arc-row' + (used.has(b.id) ? "" : " lone") + '" data-jump="' + PR.esc(b.id) + '" data-card="' + PR.esc(b.id) + '" data-arc="' + PR.esc(b.id) + '">' +
            '<span class="s-float">' + PR.esc(PR.floatLabel(b.id)) + '</span><span class="t">' + PR.esc(info.q || PR.plain(PR.textFor(b.id + "#caption") || "").replace(/^[^：:]{1,12}[：:]\s*/, "")) + "</span></button>"; }).join("") + "</div>";
    }
    // 全部关系（含段落）
    if (links.length) {
      h += '<div class="mp-h2">全部关系</div><div class="fp-links">' + links.map((l) =>
        '<div class="fp-link ' + PR.relCls(l.rel) + '">' + chip(l.from) + '<span class="rel">' + PR.esc(l.rel) + " →</span>" + chip(l.to) +
        (l.note ? '<span class="note">' + PR.esc(l.note) + "</span>" : "") + "</div>").join("") + "</div>";
    }
    return h + '<p class="hint mp-foot">图表关系和结果链由模型根据题注和各段主旨整理，点任何一项跳回原文核对。</p>';
  }
  function chip(id) {
    const b = PR.blockById[id];
    if (!b) return "";
    if (b.type === "figure" || b.type === "table") return '<button class="fp-node float" data-jump="' + PR.esc(id) + '" data-card="' + PR.esc(id) + '">' + PR.esc(PR.floatLabel(id)) + "</button>";
    const e = PR.gists()[id];
    return '<button class="fp-node para" data-jump="' + PR.esc(id) + '" data-card="' + PR.esc(id) + '" title="' + PR.esc(e ? e.gist : "") + '">' +
      (e && e.role ? '<span class="g-role ' + PR.roleCls(e.role) + '">' + PR.esc(e.role) + "</span>" : "") + "<span>" + PR.esc(e ? e.gist.slice(0, 16) + (e.gist.length > 16 ? "…" : "") : "p." + b.page) + "</span></button>";
  }
  /* 悬停弧线图里的一张图：高亮和它相连的弧和图 */
  const clearArcs = () => PR.$$(".mp-arcs", bodyEl).forEach((b) => { b.classList.remove("hovering"); PR.$$(".hl", b).forEach((x) => x.classList.remove("hl")); });
  bodyEl.addEventListener("mouseover", (e) => {
    const r = e.target.closest("[data-arc]");
    const box = e.target.closest(".mp-arcs");
    if (!box) return clearArcs();
    const id = r && r.dataset.arc;
    box.classList.toggle("hovering", !!id);
    PR.$$("path", box).forEach((p) => p.classList.toggle("hl", !!id && (p.dataset.a === id || p.dataset.b === id)));
    const linked = new Set(PR.$$("path.hl", box).flatMap((p) => [p.dataset.a, p.dataset.b]));
    PR.$$(".arc-row", box).forEach((x) => x.classList.toggle("hl", linked.has(x.dataset.arc)));
  });
  bodyEl.addEventListener("mouseleave", clearArcs);

  /* ---------- 跟随阅读位置 ---------- */
  function syncCurrent(force) {
    if (PR.side !== "map") return;
    const id = PR.nearestGisted((PR.currentBlock && PR.currentBlock()) || PR.readingBlock());
    if (!force && id === cur) return;
    cur = id;
    PR.$$(".on-read", bodyEl).forEach((x) => x.classList.remove("on-read"));
    const hits = PR.$$('[data-card="' + CSS.escape(id) + '"], .dot[data-jump="' + CSS.escape(id) + '"]', bodyEl);
    hits.forEach((x) => x.classList.add("on-read"));
    const card = hits.find((x) => x.classList.contains("mp-card")) || hits.find((x) => x.closest(".mp-support"));
    if (card && follow) {
      const r = card.getBoundingClientRect(), br = bodyEl.getBoundingClientRect();
      if (r.top < br.top + 40 || r.bottom > br.bottom - 40) bodyEl.scrollTo({ top: bodyEl.scrollTop + r.top - br.top - bodyEl.clientHeight / 2 + r.height / 2, behavior: force ? "auto" : "smooth" });
    }
  }

  /* ---------- 导出 Markdown ---------- */
  function exportMd() {
    const m = S.paper.meta || {};
    const gs = PR.gists();
    let md = "# " + (m.title_zh || m.title_en || "论文") + " · 论文脉络\n\n";
    if (G().story) md += "> " + G().story + "\n\n";
    for (const s of outline()) {
      md += "## " + secLabel(s) + "\n\n";
      const sg = ((G().sections || {})[s.id] || {}).gist;
      if (sg) md += "*" + sg + "*\n\n";
      let lastSub = "";
      for (const p of s.paras) {
        if (p.sub && p.sub !== lastSub) { md += "\n**" + p.sub + "**\n\n"; lastSub = p.sub; }
        const e = gs[p.id];
        if (e) md += "- " + (e.role ? "【" + e.role + "】" : "") + (e.link && e.link !== "开启" ? "（" + e.link + "）" : "") + e.gist + "\n";
      }
      md += "\n";
    }
    const claims = G().claims || [];
    if (claims.length) {
      md += "## 核心论点\n\n";
      claims.forEach((c, i) => {
        md += (i + 1) + ". **" + (c.kind || "论点") + "**：" + c.claim + "\n";
        (c.support || []).forEach((s) => { const L = supportLabel(s.id); md += "   - " + (L.kind === "段" ? "第 " + (L.page || "?") + " 页：" + L.text : L.label + "：" + L.text) + (s.how ? "（" + s.how + "）" : "") + "\n"; });
        if (c.weak) md += "   - ⚠ " + c.weak + "\n";
      });
    }
    const name = (m.short_zh || m.title_zh || "论文").replace(/[\\/:*?"<>|]/g, "").slice(0, 40) + "-脉络.md";
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- 事件 ---------- */
  panel.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mt]");
    if (t) { tab = t.dataset.mt; PR.ls.set("easyread-mp-tab", tab); render(); bodyEl.scrollTop = 0; setTimeout(() => syncCurrent(true), 0); return; }
    const j = e.target.closest("[data-jump]");
    if (j) { PR.jumpTo("b-" + j.dataset.jump); return; }
    const b = e.target.closest("[data-mp]");
    if (!b) return;
    const act = b.dataset.mp;
    if (act === "close") PR.toggleMap(false);
    if (act === "skim") PR.toggleSkim();
    if (act === "gen") PR.gistRun("missing");
    if (act === "structure") PR.gistRun("structure");
    if (act === "relations") PR.gistRun("relations");
    if (act === "stop") PR.gistStop();
    if (act === "more") {
      const can = PR.canAsk() && !PR.gistJob;
      PR.menu(b, [
        { label: "补全主旨（只写没写的和过时的）", icon: "sparkle", disabled: !can, fn: () => PR.gistRun("missing") },
        { label: "全部重新生成（我改过的保留）", icon: "redo", disabled: !can || !PR.hasGists(), fn: () => PR.confirm({ title: "全部重新生成？", body: "会把整篇再读一遍、再花一遍 token；你改过的主旨保留。", ok: "重新生成" }).then((ok) => ok && PR.gistRun("all")) },
        { label: "重新提炼故事线、论点和图表关系", icon: "redo", disabled: !can || !PR.hasGists(), fn: () => PR.gistRun("structure") },
        { label: "只重新整理图表关系", icon: "redo", disabled: !can || !PR.hasGists(), fn: () => PR.gistRun("relations") },
        "-",
        { label: (PR.prefs.gist !== false ? "✓ " : "") + "正文旁边显示主旨", icon: "panel", fn: () => { PR.setPref("gist", PR.prefs.gist === false, true); PR.renderGists(); } },
        { label: "导出脉络（Markdown）", icon: "download", disabled: !PR.hasGists(), fn: exportMd },
      ]);
    }
  });

  PR.on("gist-job", () => { if (PR.side === "map") { renderStatus(); if (!PR.hasGists() || !PR.gistJob) render(); } });
  PR.on("gist-changed", () => render());
  PR.on("skim", () => render());
  PR.on("rendered", () => render());
  window.addEventListener("scroll", PR.throttle(() => syncCurrent(false), 200), { passive: true });
  PR.$("#paper").addEventListener("click", () => setTimeout(() => syncCurrent(false), 0));
})(window.PR);
