/* 库内全文搜索：上面的搜索框本来只搜标题/作者/摘要；输入 ≥2 个字时，把所有论文的译文、
   英文原文和笔记也搜一遍（/api/search），结果排在列表上方，点一下直接跳到那一段。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const box = document.createElement("div");
  box.id = "ftBox";
  document.querySelector(".main").insertBefore(box, PR.$("#list"));
  let t = null, seq = 0;

  function render(results, q, pending) {
    if (!q || q.trim().length < 2) { box.innerHTML = ""; return; }
    if (pending) { box.innerHTML = '<div class="ft-pending"><span class="spin"></span> 正在搜索全部论文的译文…</div>'; return; }
    if (!results.length) { box.innerHTML = ""; return; }  // 没有全文命中就不占地方
    const mark = (s) => PR.esc(s).replace(new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "<mark>$&</mark>");
    let html = "", cur = null, n = 0;
    for (const r of results) {
      if (r.id !== cur) {
        cur = r.id;
        html += '<div class="ft-paper">' + PR.icon("book", "sm") + "<b>" + PR.esc(r.title) + "</b>" +
          '<a class="ft-open" href="/read/' + r.id + '">打开</a></div>';
      }
      n++;
      html += '<a class="ft-row" href="/read/' + r.id + "#b-" + PR.esc(r.block.split("#")[0]) + '">' +
        '<span class="ft-meta">' + PR.esc((r.section || "开头") + (r.page ? " · p." + r.page : "") + (r.where ? " · " + r.where : "")) + "</span>" +
        '<span class="ft-snip">' + mark(r.snippet) + "</span></a>";
    }
    box.innerHTML = '<div class="ft-head">全文搜索 · ' + n + ' 条（只搜已导入的论文）</div>' + html;
  }

  PR.$("#q").addEventListener("input", PR.debounce((e) => {
    const q = e.target.value.trim();
    clearTimeout(t);
    if (q.length < 2) return render("", q);
    const mine = ++seq;
    render([], q, true);
    t = setTimeout(async () => {
      try {
        const d = await PR.api("/api/search?q=" + encodeURIComponent(q));
        if (mine === seq) render(d.results || [], q);
      } catch (err) { if (mine === seq) box.innerHTML = ""; }
    }, 200);
  }, 250));
})(window.PR);
