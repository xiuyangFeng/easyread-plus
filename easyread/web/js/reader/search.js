/* 阅读页内搜索：在抽屉“搜索”里搜译文和英文原文，回车跳到下一条。
   数据都在本地（paper.json），不用问服务；命中列表按章节分组，点一下跳回原段。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const ft = { q: "", hits: [], idx: -1, t: null };

  /* 可搜索的文字：[(blockId, 页码, 章节, 文字)]。译文优先“我的修改”，英文原文也搜。 */
  function sources() {
    const out = [];
    let section = "";
    for (const b of S.paper.blocks || []) {
      if (!b.id) continue;
      if (b.type === "heading" || b.type === "references") {
        section = (b.num ? b.num + " " : "") + PR.plain(PR.textFor(b.id) || b.zh || "");
        out.push([b.id, b.page, section, PR.plain(PR.textFor(b.id) || b.zh || "")]);
        continue;
      }
      if (b.type === "para") {
        out.push([b.id, b.page, section, PR.plain(PR.textFor(b.id))]);
        if (b.en) out.push([b.id, b.page, section, b.en]);
      } else if (b.type === "list") {
        (b.items || []).forEach((it, i) => {
          out.push([b.id + "#" + i, b.page, section, PR.plain(PR.textFor(b.id + "#" + i))]);
          if (it.en) out.push([b.id + "#" + i, b.page, section, it.en]);
        });
      } else if (b.type === "figure" || b.type === "table") {
        out.push([b.id + "#caption", b.page, section, PR.plain(PR.textFor(b.id + "#caption"))]);
        if (b.caption_en) out.push([b.id + "#caption", b.page, section, b.caption_en]);
      }
    }
    return out;
  }

  function hit(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return null;
    const start = Math.max(0, i - 26), end = Math.min(text.length, i + q.length + 34);
    const esc = (s) => PR.esc(s).replace(new RegExp(PR.esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "<mark>$&</mark>");
    return (start ? "…" : "") + esc(text.slice(start, end)) + (end < text.length ? "…" : "");
  }

  function run(q) {
    ft.q = q;
    ft.hits = [];
    ft.idx = -1;
    if (q.trim().length >= 2) {
      for (const [bid, page, section, text] of sources()) {
        if (!text) continue;
        const s = hit(text, q.trim());
        if (s) ft.hits.push({ bid, page, section, s });
        if (ft.hits.length >= 200) break;
      }
    }
    const box = PR.$("#ftResults");
    if (box) renderResults(box);
  }

  function renderResults(box) {
    if (!ft.q.trim()) {
      box.innerHTML = '<p class="hint">输入关键词，在整篇的译文和英文原文里找。按 <kbd>Enter</kbd> 跳到下一条，<kbd>Esc</kbd> 关闭。</p>';
      return;
    }
    if (!ft.hits.length) return void (box.innerHTML = '<p class="hint">没搜到“' + PR.esc(ft.q) + "”。</p>");
    box.innerHTML = '<p class="hint ft-count">' + ft.hits.length + " 条结果，<kbd>Enter</kbd> 跳下一条</p>" +
      '<nav class="toc ft-list">' + ft.hits.map((h, i) =>
        '<a data-ft="' + i + '" class="l1"><span class="cnt">' + (h.page ? "p." + h.page : "") + "</span>" +
        '<span class="ft-sec">' + PR.esc(h.section || "开头") + "</span>" +
        '<span class="ft-snip">' + h.s + "</span></a>").join("") + "</nav>";
  }

  function go(i) {
    const h = ft.hits[i];
    if (!h) return;
    PR.jumpTo("b-" + h.bid.split("#")[0]);
    PR.setCurrent && PR.setCurrent(h.bid.split("#")[0], { bar: false });
  }

  PR.openSearch = function () {
    PR.toggleDrawer(true, "search");
    PR.renderDrawer();
    setTimeout(() => PR.$("#ftInput") && PR.$("#ftInput").focus(), 60);
  };

  PR.searchDrawer = function () {
    setTimeout(() => {
      const input = PR.$("#ftInput");
      if (!input) return;
      input.value = ft.q;
      input.addEventListener("input", () => { clearTimeout(ft.t); ft.t = setTimeout(() => run(input.value), 150); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); ft.idx = (ft.idx + 1) % Math.max(1, ft.hits.length); go(ft.idx); }
      });
      renderResults(PR.$("#ftResults"));
      PR.$("#ftResults").addEventListener("click", (e) => {
        const a = e.target.closest("[data-ft]");
        if (a) go(+a.dataset.ft);
      });
    }, 0);
    return '<input class="input" id="ftInput" placeholder="搜索整篇译文和英文原文…" autocomplete="off"><div id="ftResults" class="ft-results"></div>';
  };

  /* Ctrl/Cmd+F 也呼出搜索（浏览器自带的“页面内查找”搜不到译文里的公式和重排文字） */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !e.target.closest("textarea, input, [contenteditable]")) {
      e.preventDefault();
      PR.openSearch();
    }
  }, true);
})(window.PR);
