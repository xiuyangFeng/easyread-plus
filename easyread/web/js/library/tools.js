/* 文献库侧栏顶上的两个视图：
   - 全部笔记：所有论文的划线、笔记、问题、论文笔记放在一处，按类型 / 颜色 / 分类筛，上面的搜索框也能搜；
     点一条回到原文那一段；“随机回顾”翻出几条以前划的，常读常新；可以导出 Markdown。
   - 阅读统计：今天 / 本周 / 本月读了多久、连续几天、读完几篇，近半年的阅读日历，读得最久的论文。
     阅读时长由阅读页记录（reader/readtime.js），只算页面在前台、人在动的时间。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const COLORS = { yellow: "黄", green: "绿", blue: "蓝", pink: "红" };
  const KINDS = [["all", "全部"], ["highlight", "划线"], ["note", "笔记"], ["question", "问题"], ["paper", "论文笔记"]];
  const KIND_LABEL = { highlight: "划线", note: "笔记", question: "问题", paper: "论文笔记" };
  const ui = Object.assign({ kind: "all", color: "", cat: "", sort: "time" }, PR.ls.get("easyread-notes-view", {}));
  const save = () => PR.ls.set("easyread-notes-view", { kind: ui.kind, color: ui.color, cat: ui.cat, sort: ui.sort });
  let data = null, loading = false, review = null;
  const localDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const short = (p) => (p.short || (p.title || "").split(/[：:]/)[0] || p.title_en || "（未命名）");

  async function fetchNotes(box) {
    if (loading) return;
    loading = true;
    try { data = await PR.api("/api/notes"); } catch (e) { data = { notes: [], papers: {}, error: e.message }; }
    loading = false;
    if (L.view === "notes") renderNotes(box);
  }
  function filtered() {
    const q = L.q.trim().toLowerCase();
    return data.notes.filter((n) => {
      const p = data.papers[n.pid] || {};
      if (ui.kind !== "all" && n.kind !== ui.kind) return false;
      if (ui.color && n.color !== ui.color) return false;
      if (ui.cat && !(p.tags || []).includes(ui.cat)) return false;
      return !q || [n.quote, n.body, n.section, p.title, p.title_en].join(" ").toLowerCase().includes(q);
    });
  }
  const link = (n) => "/read/" + n.pid + (n.anchor && n.anchor !== "head" ? "#b-" + n.anchor : "");
  function card(n, withPaper) {
    const p = data.papers[n.pid] || {};
    const meta = [withPaper ? short(p) : "", n.section, n.page ? "p." + n.page : "", PR.relTime(n.updated)].filter(Boolean);
    return '<a class="nc k-' + n.kind + (n.color ? " c-" + n.color : "") + '" href="' + link(n) + '">' +
      (n.quote ? '<div class="nc-q">' + PR.esc(n.quote) + "</div>" : "") +
      (n.body ? '<div class="nc-b">' + PR.esc(n.body) + "</div>" : "") +
      '<div class="nc-m"><span class="kind">' + (KIND_LABEL[n.kind] || "笔记") + (n.kind === "question" ? (n.answered ? " · 已答" : " · 待答") : "") + "</span>" + meta.map(PR.esc).join(" · ") + "</div></a>";
  }
  function pickReview() {
    const pool = data.notes.filter((n) => n.quote || (n.body && n.kind !== "paper"));
    const now = Date.now(), out = [];
    const w = pool.map((n) => 1 + Math.max(0, (now - new Date(n.updated || 0)) / 864e5) / 14);  // 越久没看越容易被翻出来
    for (let k = 0; k < 3 && pool.length; k++) {
      let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
      while (r > w[i] && i < w.length - 1) r -= w[i++];
      out.push(pool.splice(i, 1)[0]); w.splice(i, 1);
    }
    return out;
  }
  function renderNotes(box) {
    if (!data) { box.innerHTML = '<div class="empty-state"><span class="spin"></span> 正在汇总所有论文的笔记…</div>'; return fetchNotes(box); }
    const list = filtered();
    const cats = L.cats();
    let h = '<div class="tool-bar"><div class="seg">' + KINDS.map(([k, l]) => '<button data-nk="' + k + '" class="' + (ui.kind === k ? "on" : "") + '">' + l + "</button>").join("") + "</div>" +
      '<div class="dots"><button data-nc="" class="' + (!ui.color ? "on" : "") + '" title="全部颜色">全</button>' +
      Object.entries(COLORS).map(([c, l]) => '<button data-nc="' + c + '" class="dot c-' + c + (ui.color === c ? " on" : "") + '" title="' + l + '色划线"></button>').join("") + "</div>" +
      (cats.length ? '<select class="input" data-ncat><option value="">全部分类</option>' + cats.map((c) => '<option value="' + PR.esc(c) + '"' + (ui.cat === c ? " selected" : "") + ">" + PR.esc(c) + "</option>").join("") + "</select>" : "") +
      '<select class="input" data-nsort><option value="time"' + (ui.sort === "time" ? " selected" : "") + '>最近的在前</option><option value="paper"' + (ui.sort === "paper" ? " selected" : "") + ">按论文分组</option></select>" +
      '<span class="grow"></span><button class="btn sm line" data-nt="review">' + PR.icon("sparkle", "sm") + "随机回顾</button>" +
      '<button class="btn sm line" data-nt="md">' + PR.icon("download", "sm") + "导出 Markdown</button>" +
      '<button class="btn icon sm" data-nt="reload" title="刷新">' + PR.icon("redo", "sm") + "</button></div>";
    if (review && review.length) h += '<div class="review"><div class="review-head">随机回顾 · 以前划过、记过的<span class="grow"></span><button class="linkish" data-nt="again">换一批</button><button class="linkish" data-nt="noreview">收起</button></div>' +
      '<div class="review-cards">' + review.map((n) => card(n, true)).join("") + "</div></div>";
    PR.$("#count").textContent = list.length + " 条";
    if (!list.length) h += '<div class="empty-state"><div class="big">' + (data.notes.length ? "没有符合条件的笔记" : "还没有笔记") + "</div>" +
      (data.notes.length ? "换个筛选或关键词试试。" : "在阅读页选中文字可以划线、写笔记、提问，都会汇总到这里。") + "</div>";
    else if (ui.sort === "paper") {
      const groups = {};
      list.forEach((n) => (groups[n.pid] = groups[n.pid] || []).push(n));
      h += Object.entries(groups).map(([pid, ns]) => '<div class="nc-group"><div class="nc-paper"><a href="/read/' + pid + '">' + PR.esc((data.papers[pid] || {}).title || "") + "</a><span>" + ns.length + " 条</span></div>" +
        ns.map((n) => card(n, false)).join("") + "</div>").join("");
    } else h += '<div class="nc-flat">' + list.map((n) => card(n, true)).join("") + "</div>";
    box.innerHTML = '<div class="notes-view">' + h + "</div>";
  }
  function notesMarkdown(list) {
    const groups = {};
    list.forEach((n) => (groups[n.pid] = groups[n.pid] || []).push(n));
    const out = ["# 文献笔记汇总", "", "导出于 " + new Date().toLocaleString("zh-CN") + "，共 " + list.length + " 条。", ""];
    for (const [pid, ns] of Object.entries(groups)) {
      const p = data.papers[pid] || {};
      out.push("## " + p.title, "", [p.title_en && "*" + p.title_en + "*", p.year].filter(Boolean).join(" · "), "");
      for (const n of ns) {
        if (n.kind === "paper") { out.push("**论文笔记**", "", n.body, ""); continue; }
        const where = [n.section, n.page && "p." + n.page].filter(Boolean).join(" · ");
        out.push("- **" + (KIND_LABEL[n.kind] || "笔记") + "**" + (n.quote ? "「" + n.quote + "」" : "") + (n.body ? "：" + n.body.replace(/\n/g, " ") : "") +
          (where ? "（[" + where + "](" + location.origin + link(n) + ")）" : ""));
      }
      out.push("");
    }
    return out.join("\n");
  }

  /* ---------- 阅读统计 ---------- */
  let stats = null;
  async function renderStats(box) {
    if (!stats) {
      box.innerHTML = '<div class="empty-state"><span class="spin"></span> 正在统计…</div>';
      try { stats = await PR.api("/api/stats"); } catch (e) { box.innerHTML = '<div class="empty-state">没取到：' + PR.esc(e.message) + "</div>"; return; }
      if (L.view !== "stats") return;
    }
    const days = stats.days || {}, nd = stats.notes_days || {};
    const now = new Date(), today = localDay(now);
    const sumSince = (from) => Object.entries(days).filter(([d]) => d >= from).reduce((a, [, s]) => a + s, 0);
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const month = today.slice(0, 8) + "01";
    let streak = 0;
    for (const d = new Date(now); ; d.setDate(d.getDate() - 1)) {  // 今天还没读也不断：从昨天往回数
      const k = localDay(d);
      if (days[k] >= 60 || nd[k]) streak++;
      else if (k !== today) break;
      if (streak > 3650) break;
    }
    const doneMonth = (stats.done || []).filter((x) => x.at && localDay(new Date(x.at)) >= month).length;
    const notesMonth = Object.entries(nd).filter(([d]) => d >= month).reduce((a, [, n]) => a + n, 0);
    const tile = (label, value, sub) => '<div class="tile"><div class="tl">' + label + '</div><div class="tv">' + value + "</div>" + (sub ? '<div class="ts">' + sub + "</div>" : "") + "</div>";
    let h = '<div class="stats-view"><div class="tiles">' +
      tile("今天", PR.fmtDur(days[today] || 0)) + tile("本周", PR.fmtDur(sumSince(localDay(monday)))) + tile("本月", PR.fmtDur(sumSince(month))) +
      tile("累计", PR.fmtDur(stats.total_sec || 0), stats.papers + " 篇在库") + tile("连续阅读", streak + " 天") +
      tile("本月读完", doneMonth + " 篇", "标为“已读”的") + tile("本月笔记", notesMonth + " 条", "划线、笔记、问题") + "</div>";
    // 近 26 周的阅读日历：一格一天，颜色越深读得越久
    const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 25 * 7);
    const level = (sec, n) => (sec >= 3600 ? 4 : sec >= 1800 ? 3 : sec >= 600 ? 2 : sec >= 60 || n ? 1 : 0);
    let cells = "", months = "", lastM = -1;
    for (let w = 0; w < 26; w++) {
      const d0 = new Date(start); d0.setDate(start.getDate() + w * 7);
      months += '<span style="grid-column:' + (w + 1) + '">' + (d0.getMonth() !== lastM ? d0.getMonth() + 1 + "月" : "") + "</span>";
      lastM = d0.getMonth();
      for (let k = 0; k < 7; k++) {
        const d = new Date(d0); d.setDate(d0.getDate() + k);
        const key = localDay(d), sec = days[key] || 0, n = nd[key] || 0;
        const future = key > today;
        cells += '<i class="lv' + (future ? " fu" : level(sec, n)) + '" style="grid-column:' + (w + 1) + ";grid-row:" + (k + 1) + '"' +
          (future ? "" : ' title="' + (d.getMonth() + 1) + "月" + d.getDate() + "日：" + (sec ? "读了 " + PR.fmtDur(sec) : "没有阅读记录") + (n ? " · 写了 " + n + " 条笔记" : "") + '"') + "></i>";
      }
    }
    h += '<h3>阅读日历 · 近半年</h3><div class="heat"><div class="hm-months">' + months + '</div><div class="hm-wrap"><div class="hm-days"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div><div class="hm">' + cells + "</div></div>" +
      '<div class="hm-legend">少<i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i>多<span>（不到 10 分钟 / 10–30 分钟 / 30–60 分钟 / 1 小时以上；只写了笔记的日子算最浅一档）</span></div></div>';
    const top = stats.top || [];
    if (top.length) {
      const max = top[0].sec;
      h += "<h3>读得最久的论文</h3><div class=\"bars\">" + top.map((t) => '<a class="bar-row" href="/read/' + t.pid + '"><span class="bt">' + PR.esc(t.title) + '</span><span class="bb"><i style="width:' + Math.max(2, (t.sec / max) * 100) + '%"></i></span><span class="bv">' + PR.fmtDur(t.sec) + (t.days > 1 ? " · " + t.days + " 天" : "") + "</span></a>").join("") + "</div>";
    } else h += '<p class="hint stats-hint">阅读时长从这一版开始记录：在阅读页里页面在前台、两分钟内有滚动或点击，才算在读。读一会儿再回来看。</p>';
    const done = (stats.done || []).slice(0, 8);
    if (done.length) h += "<h3>最近读完</h3><ul class=\"done-list\">" + done.map((x) => '<li><a href="/read/' + x.pid + '">' + PR.esc(x.title) + "</a><span>" + (x.at ? PR.relTime(x.at) : "") + "</span></li>").join("") + "</ul>";
    box.innerHTML = h + "</div>";
  }

  L.TOOLS.notes = { title: "全部笔记", render: renderNotes };
  L.TOOLS.stats = { title: "阅读统计", render: (box) => { stats = null; renderStats(box); } };

  const list = PR.$("#list");
  list.addEventListener("click", (e) => {
    if (L.view !== "notes" || !data) return;
    const k = e.target.closest("[data-nk]"), c = e.target.closest("[data-nc]"), t = e.target.closest("[data-nt]");
    if (k) { ui.kind = k.dataset.nk; save(); return renderNotes(list); }
    if (c) { ui.color = c.dataset.nc; save(); return renderNotes(list); }
    if (!t) return;
    const act = t.dataset.nt;
    if (act === "review" || act === "again") { review = pickReview(); if (!review.length) PR.toast("还没有可回顾的划线或笔记"); renderNotes(list); }
    if (act === "noreview") { review = null; renderNotes(list); }
    if (act === "reload") { data = null; renderNotes(list); }
    if (act === "md") {
      const items = filtered();
      if (!items.length) return PR.toast("没有可导出的笔记");
      const a = PR.el("a", { href: URL.createObjectURL(new Blob([notesMarkdown(items)], { type: "text/markdown;charset=utf-8" })), download: "文献笔记汇总-" + localDay(new Date()) + ".md" });
      document.body.appendChild(a); a.click(); a.remove();
    }
  });
  list.addEventListener("change", (e) => {
    if (L.view !== "notes") return;
    if (e.target.matches("[data-ncat]")) { ui.cat = e.target.value; save(); renderNotes(list); }
    if (e.target.matches("[data-nsort]")) { ui.sort = e.target.value; save(); renderNotes(list); }
  });
  /* 轮询刷新列表时（每 15 秒），工具视图别重画、别丢滚动位置；切进来时重新取 */
  const render0 = L.render;
  let lastView = null;
  L.render = function () {
    const tool = L.TOOLS[L.view];
    if (tool && lastView === L.view && list.firstElementChild && !L.q_changed) { PR.renderSide(); return; }
    if (L.view === "notes" && lastView !== "notes") data = null;
    lastView = L.view;
    L.q_changed = false;
    render0();
  };
  PR.$("#q").addEventListener("input", () => { L.q_changed = true; });
})(window.PR);
