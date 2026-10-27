/* 参考文献：每条下面一行小工具——
   - 正文引用 N 处：点开逐处列出（章节 · 页码 · 那句话），点哪处跳回哪处；
   - 已经在文献库里的（按标题 / arXiv / DOI 认出来，见 citegraph.py）直接打开；
   - 不在库里的一键导入（用条目里的 DOI、arXiv 编号，没有就猜标题，导入前可以改），或者去 Google Scholar / Semantic Scholar 搜。
   引用号的悬停卡片里也带上“正文引用 N 处 · 库中已有”。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  let citedBy = {};  // 条目 id → [块 id…]，按正文顺序
  let inLib = {};    // 条目 id → {id, title}
  const server = () => PR.store.mode === "server" && !S.pdf;

  function collect() {
    citedBy = {};
    for (const a of PR.$$("#paper > .blk:not(.blk-references) a.cite[data-ref]")) {
      const bid = a.closest(".blk").dataset.id;
      const list = citedBy[a.dataset.ref] || (citedBy[a.dataset.ref] = []);
      if (!list.includes(bid)) list.push(bid);
    }
  }
  function decorate() {
    if (S.pdf) return;
    for (const li of PR.$$("#paper .refs li[id^='ref-']")) {
      const id = li.id.slice(4);
      const n = (citedBy[id] || []).length, lib = inLib[id];
      let tools = li.querySelector(".ref-tools");
      if (!tools) { tools = PR.el("div", { class: "ref-tools no-print" }); li.appendChild(tools); }
      tools.innerHTML = (n ? '<button data-rf="cites" data-id="' + PR.esc(id) + '">正文引用 ' + n + " 处</button>" : "") +
        (lib ? '<a class="ref-lib" href="/read/' + PR.esc(lib.id) + '" target="_blank" rel="noopener" title="' + PR.esc(lib.title) + '">' + PR.icon("book", "sm") + "库中已有 · 打开</a>" : "") +
        '<button data-rf="more" data-id="' + PR.esc(id) + '">' + (lib || !server() ? "搜索" : "导入 / 搜索") + " ▾</button>";
    }
  }
  async function loadLib() {
    if (!server()) return;
    try { inLib = (await PR.api("/api/p/" + PR.pid + "/refmatch")).refs || {}; } catch (e) { inLib = {}; }
    decorate();
  }
  let first = true;
  PR.on("rendered", () => {
    collect(); decorate();
    if (first) { first = false; loadLib(); }
  });

  /* 引用号悬停卡片的底部一行（actions.js 的 refCard 调用） */
  PR.refCardExtra = function (id) {
    const n = (citedBy[id] || []).length, lib = inLib[id];
    const bits = [];
    if (n > 1) bits.push('<button class="linkish" data-rf-list="' + PR.esc(id) + '">正文共引用 ' + n + " 处</button>");
    if (lib) bits.push('<a class="linkish" href="/read/' + PR.esc(lib.id) + '" target="_blank" rel="noopener">库中已有 · 打开</a>');
    return bits.length ? '<div class="ref-foot">' + bits.join("　·　") + "</div>" : "";
  };

  /* 正文里引用这条的那句话 */
  function snippet(bid, id) {
    const host = document.getElementById("b-" + bid);
    const a = host && (host.querySelector('.zh a.cite[data-ref="' + CSS.escape(id) + '"]') || host.querySelector('a.cite[data-ref="' + CSS.escape(id) + '"]'));
    if (!a) return "";
    const box = a.closest(".zh, .en, li") || host;
    const text = PR.fullText(box), at = text.indexOf(a.textContent);
    if (at < 0) return PR.esc(text.slice(0, 90));
    const from = Math.max(0, text.lastIndexOf("。", at) + 1, at - 60), to = Math.min(text.length, at + a.textContent.length + 30);
    return (from > 0 ? "…" : "") + PR.esc(text.slice(from, at)) + "<mark>" + PR.esc(a.textContent) + "</mark>" + PR.esc(text.slice(at + a.textContent.length, to)) + (to < text.length ? "…" : "");
  }
  function showCites(anchor, id) {
    const list = citedBy[id] || [];
    PR.popover(anchor, '<div class="hd">正文里引用 [' + PR.esc(id) + "] 的 " + list.length + " 处</div>" +
      '<div class="rf-list">' + list.map((bid) => {
        const b = PR.blockById[bid] || {};
        return '<button data-rf-go="' + PR.esc(bid) + '" data-id="' + PR.esc(id) + '"><span class="rf-where">' + PR.esc(PR.sectionOf(bid)) + (b.page ? " · p." + b.page : "") + "</span>" + snippet(bid, id) + "</button>";
      }).join("") + "</div>", { sticky: true, wide: true });
  }
  function goCite(bid, id) {
    PR.hidePopover();
    PR.jumpTo("b-" + bid);
    const hits = PR.$$("#b-" + CSS.escape(bid) + ' a.cite[data-ref="' + CSS.escape(id) + '"]');
    hits.forEach((x) => x.classList.add("hit"));
    setTimeout(() => hits.forEach((x) => x.classList.remove("hit")), 2400);
  }

  /* 从条目里找能拿去导入的东西：DOI > arXiv 编号 > 引号里的标题 > 年份后面那句 > 最像标题的一段 */
  PR.guessRefQuery = function (text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    const doi = text.match(/\b10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)\]]/);
    if (doi) return doi[0];
    const ax = text.match(/arxiv[:\s/]*(?:abs\/|pdf\/)?(\d{4}\.\d{4,5})/i);
    if (ax) return ax[1];
    const q = text.match(/[“"]([^”"]{12,300}?)[,.]?[”"]/);
    if (q) return q[1];
    const y = text.match(/(?:^|[\s,(])(?:19|20)\d{2}[a-z]?\)?[.,:]\s+(.{12,300})/);  // “作者, 2021. 标题. 期刊”
    const yt = y && y[1].split(/[.?!](?:\s|$)|,?\s+in:\s/i)[0].replace(/,\s*$/, "");
    if (yt && yt.split(/\s+/).length >= 3 && !/\b[A-Z]\.,/.test(yt)) return yt;
    const segs = text.split(/\.\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
    const authorish = (s) => (s.match(/,/g) || []).length >= 2 || /,\s+and\s/.test(s) || /\b[A-Z]\.(?:\s|,|$)/.test(s);
    const score = (s) => s.split(/\s+/).length - 20 * authorish(s) - 6 * /\d/.test(s) - 4 * /^(in|proc|proceedings)\b/i.test(s);
    segs.sort((a, b) => score(b) - score(a));
    return segs[0] || text.slice(0, 200);
  };

  function moreMenu(anchor, id) {
    const r = PR.refById[id];
    if (!r) return;
    const q = PR.guessRefQuery(r.text);
    const lib = inLib[id];
    const items = [];
    if (lib) items.push({ label: "在文献库里打开", icon: "book", fn: () => window.open("/read/" + lib.id, "_blank") });
    else if (server()) items.push({ label: "导入这篇到文献库…", icon: "plus", fn: () => importBox(anchor, id, q) });
    items.push(
      { label: "Google Scholar 搜索", icon: "search", fn: () => window.open("https://scholar.google.com/scholar?q=" + encodeURIComponent(q), "_blank", "noopener") },
      { label: "Semantic Scholar 搜索", icon: "search", fn: () => window.open("https://www.semanticscholar.org/search?q=" + encodeURIComponent(q), "_blank", "noopener") },
      "-",
      { label: "复制这条文献", icon: "copy", fn: () => navigator.clipboard.writeText(r.text).then(() => PR.toast("已复制")) });
    PR.menu(anchor, items);
  }

  function importBox(anchor, id, q) {
    const p = Object.assign({ auto: true, scope: "all", first: 10 }, PR.ls.get("easyread-import", {}));
    const canTr = S.engine && S.engine !== "none";
    PR.popover(anchor, '<div class="hd">导入参考文献 [' + PR.esc(id) + "]</div>" +
      '<p class="rf-hint">按 DOI、arXiv 编号或标题找公开的 PDF。没认对就改一下：</p>' +
      '<input class="input" id="rfQ" value="' + PR.esc(q) + '">' +
      '<div class="rf-acts"><button class="btn sm" data-rfi="cancel">取消</button>' +
      '<button class="btn sm line" data-rfi="only">只导入</button>' + (canTr ? '<button class="btn sm accent" data-rfi="tr">导入并翻译</button>' : "") + "</div>", { sticky: true, wide: true });
    setTimeout(() => { const i = PR.$("#rfQ"); i && i.focus(); }, 30);
    PR.$("#popover").onclick = async (e) => {
      const b = e.target.closest("[data-rfi]");
      if (!b) return;
      const ref = PR.$("#rfQ").value.trim();
      PR.hidePopover();
      if (b.dataset.rfi === "cancel" || !ref) return;
      const translate = b.dataset.rfi === "tr";
      PR.toast('<span class="spin"></span> 正在查找并下载…', null, 60000);
      try {
        const r = await PR.api("/api/import-url", { method: "POST", body: { ref, translate, scope: p.scope === "first" ? "first:" + Math.max(1, +p.first || 10) : p.scope } });
        PR.toast(r.new ? "已导入" + (translate ? "，后台开始翻译" : "") : "这篇已经在库里了", { label: "打开", fn: () => window.open("/read/" + r.id, "_blank") }, 8000);
        loadLib();
      } catch (err) { PR.toast("导入失败：" + PR.esc(err.message), null, 8000); }
    };
  }

  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-rf-go]");
    if (go) return goCite(go.dataset.rfGo, go.dataset.id);
    const lst = e.target.closest("[data-rf-list]");
    if (lst) { const r = lst.getBoundingClientRect(); return showCites({ getBoundingClientRect: () => r }, lst.dataset.rfList); }  // 悬停卡片要整个换掉，先记下位置
    const b = e.target.closest("#paper [data-rf]");
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.rf === "cites") showCites(b, b.dataset.id);
    else moreMenu(b, b.dataset.id);
  });
})(window.PR);
