/* 图表一览：很多人读论文先看图——一屏摊开全部图和表（缩略图 + 题注 + 页码 + 所在章节），
   脉络里有“这张图回答什么”的也带上。点卡片跳到正文那里，点图放大。按 I 打开 / 关闭，Esc 关闭。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  let box = null, filter = "all";

  const isOpen = () => !!box && box.classList.contains("open");
  function items() {
    return (S.paper.blocks || []).filter((b) => b.type === "figure" || b.type === "table");
  }
  function label(b) {
    const cap = PR.plain(PR.textFor(b.id + "#caption") || "");
    const m = cap.match(/^([^：:]{1,12})[：:]\s*(.*)$/);
    return { name: m ? m[1] : (b.type === "figure" ? "图 " : "表 ") + (b.num || ""), text: m ? m[2] : cap };
  }
  function pageImg(n) { const p = ((S.paper.meta || {}).pages || []).find((x) => x.n === n); return p ? PR.imageUrl(p.img) : ""; }
  function miniTable(b) {
    const rows = (b.head || []).concat((b.rows || []).slice(0, 7));
    return '<table class="gl-tbl">' + rows.map((r, i) => "<tr>" + r.map((c) => (i < (b.head || []).length ? "<th>" : "<td>") +
      PR.esc(PR.plain(String(c)).replace(/\n/g, " ").slice(0, 40)) + (i < (b.head || []).length ? "</th>" : "</td>")).join("") + "</tr>").join("") + "</table>";
  }
  function cardHtml(b) {
    const l = label(b);
    const fl = ((S.gist || {}).floats || {})[b.id];
    let visual;
    if (b.type === "table") visual = '<div class="gl-vis tbl">' + miniTable(b) + "</div>";
    else if (b.src) visual = '<div class="gl-vis"><img loading="lazy" src="' + PR.imageUrl(b.src) + '" alt=""></div>';
    else visual = '<div class="gl-vis page"><img loading="lazy" src="' + pageImg(b.page) + '" alt=""><span>原页</span></div>';
    return '<div class="gl-card" data-gl="' + PR.esc(b.id) + '">' + visual +
      '<div class="gl-cap"><b>' + PR.esc(l.name) + "</b>" + PR.esc(l.text.slice(0, 140)) + (l.text.length > 140 ? "…" : "") + "</div>" +
      (fl && fl.q ? '<div class="gl-q">回答：' + PR.esc(PR.plain(fl.q)) + "</div>" : "") +
      '<div class="gl-meta">' + PR.esc(PR.sectionOf(b.id)) + " · p." + b.page + "</div></div>";
  }
  function render() {
    const all = items();
    const nf = all.filter((b) => b.type === "figure").length, nt = all.length - nf;
    const list = all.filter((b) => filter === "all" || b.type === filter);
    box.innerHTML = '<div class="gl-head"><b>图表一览</b><div class="seg">' +
      [["all", "全部 " + all.length], ["figure", "图 " + nf], ["table", "表 " + nt]].map(([k, l]) => '<button data-glf="' + k + '" class="' + (filter === k ? "on" : "") + '">' + l + "</button>").join("") +
      '</div><span class="hint">点卡片回到正文，点图放大</span><span class="grow"></span><button class="btn icon" data-glx title="关闭（Esc）">×</button></div>' +
      '<div class="gl-grid">' + (list.length ? list.map(cardHtml).join("") : '<p class="hint">这篇论文还没有译出图或表。</p>') + "</div>";
  }
  PR.toggleGallery = function (force) {
    if (!box) {
      box = PR.el("div", { id: "gallery", role: "dialog", "aria-label": "图表一览" });
      document.body.appendChild(box);
      box.addEventListener("click", (e) => {
        const f = e.target.closest("[data-glf]");
        if (f) { filter = f.dataset.glf; return render(); }
        if (e.target.closest("[data-glx]")) return PR.toggleGallery(false);
        const img = e.target.closest(".gl-vis img");
        if (img && PR.openLightbox) return PR.openLightbox(img);
        const c = e.target.closest("[data-gl]");
        if (c) { PR.toggleGallery(false); PR.jumpTo("b-" + c.dataset.gl); }
      });
    }
    const open = force != null ? force : !isOpen();
    if (open) render();
    box.classList.toggle("open", open);
    document.body.classList.toggle("gallery-open", open);
  };
  document.addEventListener("keydown", (e) => {
    if (isOpen() && e.key === "Escape" && !PR.$("#lightbox.open")) { e.stopImmediatePropagation(); PR.toggleGallery(false); }
  }, true);
})(window.PR);
