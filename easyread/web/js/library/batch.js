/* 多选之后的批量操作（右侧面板、在选中的论文上右键）：改状态、星标、放进 / 拿出分类、导出 BibTeX 和引用列表、
   文献对比表、移到回收站。列表头上的“导出引用”导出当前列表里的全部论文。 */
(function (PR) {
  "use strict";
  const L = PR.lib;
  const plain = (s) => String(s || "").replace(/\$([^$]+)\$/g, "$1").replace(/\*\*|`/g, "");
  const stamp = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); };

  /* ---------- 批量改 ---------- */
  PR.batchApply = async function (ids, change) {
    const items = ids.map(L.byId).filter(Boolean);
    const body = (i) => change.addTag ? (i.tags || []).includes(change.addTag) ? null : { tags: (i.tags || []).concat(change.addTag) }
      : change.removeTag ? (i.tags || []).includes(change.removeTag) ? { tags: i.tags.filter((t) => t !== change.removeTag) } : null
      : change;
    const todo = items.map((i) => [i, body(i)]).filter(([, b]) => b);
    todo.forEach(([i, b]) => Object.assign(i, b));
    L.render();
    for (const [i, b] of todo) await PR.api("/api/p/" + i.id + "/item", { method: "POST", body: b }).catch((e) => PR.toast("保存失败：" + PR.esc(e.message)));
    PR.toast(change.addTag ? "已把 " + items.length + " 篇放进“" + PR.esc(change.addTag) + "”" : change.removeTag ? "已从“" + PR.esc(change.removeTag) + "”拿出" : "已更新 " + todo.length + " 篇");
    L.load();
  };

  /* ---------- 引用导出 ---------- */
  function bibtex(items) {
    const used = {};
    return items.map((i) => {
      let t = PR.cite(i, "bibtex");
      const key = (t.match(/^@\w+\{([^,]+),/) || [])[1];
      if (key) {
        used[key] = (used[key] || 0) + 1;
        if (used[key] > 1) t = t.replace(key + ",", key + String.fromCharCode(96 + used[key]) + ",");  // 同名的加 b、c…
      }
      return t;
    }).join("\n\n") + "\n";
  }
  function download(text, name, type) {
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name.replace(/[\\/:*?"<>|]/g, "") });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function copy(text, what) {
    navigator.clipboard.writeText(text).then(() => PR.toast("已复制" + what), () => PR.toast("复制失败"));
  }
  function exportItems(items, label) {
    return [
      { label: "下载 BibTeX（.bib）· " + items.length + " 篇", icon: "download", fn: () => download(bibtex(items), (label || "论文") + "-" + stamp() + ".bib", "application/x-bibtex;charset=utf-8") },
      { label: "复制 BibTeX", icon: "copy", fn: () => copy(bibtex(items), " " + items.length + " 条 BibTeX") },
      { label: "复制引用列表 · GB/T 7714", icon: "copy", fn: () => copy(items.map((i, k) => "[" + (k + 1) + "] " + PR.cite(i, "gb")).join("\n"), " " + items.length + " 条 GB/T 7714 引用") },
      { label: "复制引用列表 · APA", icon: "copy", fn: () => copy(items.map((i) => PR.cite(i, "apa")).join("\n"), " " + items.length + " 条 APA 引用") },
    ];
  }
  PR.$("#exportView").addEventListener("click", (e) => {
    const items = L.filtered();
    if (!items.length) return PR.toast("当前列表是空的");
    const view = (L.VIEWS.find((v) => v[0] === L.view) || [])[1];
    PR.menu(e.currentTarget, exportItems(items, L.tag || view || "论文"));
  });

  /* ---------- 右侧批量面板 ---------- */
  const sel = () => Array.from(L.multi).map(L.byId).filter(Boolean);
  PR.renderBatch = function (box) {
    const items = sel();
    const cats = L.cats();
    box.innerHTML = '<div class="detail-head"><span>已选 ' + items.length + ' 篇</span><button class="detail-close" data-b="close" title="取消选择（Esc）">' + PR.icon("x", "sm") + "</button></div>" +
      '<div class="detail-inner batch">' +
      '<ol class="b-list">' + items.map((i) => "<li>" + PR.esc(i.title_zh || i.title_en || "（未命名）") + "</li>").join("") + "</ol>" +
      '<p class="hint">⌘ / Ctrl 点论文加减，Shift 点一段，⌘A 全选当前列表。</p>' +
      "<h4>对比</h4>" +
      '<button class="btn accent" data-b="compare">' + PR.icon("panel", "sm") + "文献对比表</button>" +
      '<p class="hint">把这几篇的研究问题、核心论点、我的笔记排成一张表，可导出 Excel / Markdown。</p>' +
      "<h4>阅读状态</h4>" +
      '<div class="seg"><button data-b-status="unread">未读</button><button data-b-status="reading">在读</button><button data-b-status="done">已读</button></div>' +
      '<div class="b-row"><button class="btn sm line" data-b="star">' + PR.icon("star", "sm") + "加星标</button><button class=\"btn sm line\" data-b=\"unstar\">取消星标</button></div>" +
      "<h4>分类</h4>" +
      '<div class="cats">' + cats.map((c) => {
        const n = items.filter((i) => (i.tags || []).includes(c)).length;
        return '<button class="catchip' + (n === items.length ? " on" : "") + '" data-b-cat="' + PR.esc(c) + '" title="' + (n === items.length ? "点一下全部拿出" : "点一下全部放进去") + '">' + PR.icon(n === items.length ? "check" : "folder", "sm") + PR.esc(c) + (n && n < items.length ? " · " + n : "") + "</button>";
      }).join("") + '<input id="bCatInput" placeholder="＋ 新分类" maxlength="30"></div>' +
      "<h4>导出</h4>" +
      '<div class="b-row"><button class="btn sm line" data-b="bib">' + PR.icon("download", "sm") + "下载 BibTeX</button><button class=\"btn sm line\" data-b=\"cite\">" + PR.icon("copy", "sm") + "复制引用…</button></div>" +
      '<h4>其他</h4><button class="btn sm line danger" data-b="trash">' + PR.icon("trash", "sm") + "把这 " + items.length + " 篇移到回收站</button></div>";
  };
  PR.batchMenu = function (where) {
    const items = sel();
    PR.menu(where, [
      { label: "文献对比表（" + items.length + " 篇）", icon: "panel", fn: () => PR.openCompare(items.map((i) => i.id)) },
      "-",
      { label: "标为未读", fn: () => PR.batchApply(items.map((i) => i.id), { status: "unread" }) },
      { label: "标为在读", fn: () => PR.batchApply(items.map((i) => i.id), { status: "reading" }) },
      { label: "标为已读", fn: () => PR.batchApply(items.map((i) => i.id), { status: "done" }) },
      { label: "加星标", icon: "star", fn: () => PR.batchApply(items.map((i) => i.id), { starred: true }) },
      "-",
      ...L.cats().map((c) => ({ label: "放进“" + c + "”", icon: "folder", fn: () => PR.batchApply(items.map((i) => i.id), { addTag: c }) })),
      "-",
      ...exportItems(items, "已选论文"),
    ]);
  };
  async function trashAll(items, at) {
    if (!(await PR.confirm({ title: "把 " + items.length + " 篇移到回收站？", body: "会放进文献库的 .trash 目录，可以找回。", ok: "移到回收站", danger: true, at }))) return;
    for (const i of items) await PR.api("/api/p/" + i.id + "/delete", { method: "POST", body: {} }).catch((e) => PR.toast(PR.esc(e.message)));
    L.select(null); L.load(); PR.toast("已移到回收站");
  }
  const box = PR.$("#detail");
  box.addEventListener("click", (e) => {
    if (!L.multi.size) return;
    const items = sel(), ids = items.map((i) => i.id);
    const st = e.target.closest("[data-b-status]");
    if (st) return PR.batchApply(ids, { status: st.dataset.bStatus });
    const c = e.target.closest("[data-b-cat]");
    if (c) { const name = c.dataset.bCat; return PR.batchApply(ids, items.every((i) => (i.tags || []).includes(name)) ? { removeTag: name } : { addTag: name }); }
    const b = e.target.closest("[data-b]");
    if (!b) return;
    const act = b.dataset.b;
    if (act === "close") L.select(null);
    if (act === "compare") PR.openCompare(ids);
    if (act === "star") PR.batchApply(ids, { starred: true });
    if (act === "unstar") PR.batchApply(ids, { starred: false });
    if (act === "bib") download(bibtex(items), "已选论文-" + stamp() + ".bib", "application/x-bibtex;charset=utf-8");
    if (act === "cite") PR.menu(b, exportItems(items, "已选论文"));
    if (act === "trash") trashAll(items, b);
  });
  box.addEventListener("keydown", (e) => {
    if (e.target.id !== "bCatInput" || e.key !== "Enter") return;
    const name = e.target.value.trim().slice(0, 30);
    if (!name) return;
    if (!L.cats().includes(name)) { L.side.cats.push(name); PR.savePrefs("library", { cats: L.side.cats }); }
    PR.batchApply(Array.from(L.multi), { addTag: name });
  });

  /* ---------- 文献对比表 ---------- */
  let cmp = null, rows = [];
  const STATUS = { unread: "未读", reading: "在读", done: "已读" };
  const claimsText = (r) => r.claims.map((c, k) => (k + 1) + ". " + plain(c.claim) + (c.weak ? "（证据偏弱）" : "")).join("\n");
  const COLS = [
    ["论文", (r) => (r.title_zh || r.title_en) + (r.title_zh && r.title_en ? "\n" + r.title_en : "")],
    ["作者 · 年份 · 出处", (r) => [(r.authors || "").split(",").slice(0, 3).join(",") + ((r.authors || "").split(",").length > 3 ? " 等" : ""), r.year, r.venue || r.arxiv].filter(Boolean).join(" · ")],
    ["故事线（脉络）", (r) => plain(r.story)],
    ["核心论点（脉络）", claimsText],
    ["我的论文笔记", (r) => r.paper_note],
    ["阅读", (r) => (STATUS[r.status] || "未读") + (r.progress ? " · " + Math.round(r.progress * 100) + "%" : "") + (r.notes + r.highlights ? " · " + (r.notes + r.highlights) + " 条笔记/划线" : "")],
  ];
  function tableHtml() {
    const cell = (r, [name, fn]) => {
      const v = fn(r);
      if (!v && name.includes("脉络")) return '<td class="dim">还没有生成脉络</td>';
      if (!v && name === "我的论文笔记") return '<td class="dim">还没写</td>';
      if (name === "论文") return '<td><a href="/read/' + r.id + '" target="_blank" rel="noopener">' + PR.esc(plain(r.title_zh || r.title_en)) + "</a>" +
        (r.title_zh && r.title_en ? '<span class="en">' + PR.esc(plain(r.title_en)) + "</span>" : "") + "</td>";
      return "<td>" + PR.esc(v).replace(/\n/g, "<br>") + "</td>";
    };
    return '<div class="cmp-scroll"><table class="cmp"><thead><tr>' + COLS.map(([n]) => "<th>" + n + "</th>").join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + COLS.map((c) => cell(r, c)).join("") + "</tr>").join("") + "</tbody></table></div>";
  }
  function csv() {
    const q = (s) => '"' + String(s || "").replace(/"/g, '""') + '"';
    return "﻿" + [COLS.map(([n]) => q(n)).join(",")].concat(rows.map((r) => COLS.map(([, fn]) => q(fn(r))).join(","))).join("\r\n");
  }
  function markdown() {
    const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    return "| " + COLS.map(([n]) => n).join(" | ") + " |\n|" + COLS.map(() => " --- ").join("|") + "|\n" +
      rows.map((r) => "| " + COLS.map(([, fn]) => esc(fn(r))).join(" | ") + " |").join("\n") + "\n";
  }
  function renderCmp() {
    const missing = rows.filter((r) => !r.has_gist);
    cmp.querySelector(".dialog").innerHTML = '<div class="cmp-head"><h2>文献对比表 · ' + rows.length + " 篇</h2><span class=\"grow\"></span>" +
      '<button class="btn sm line" data-c="md">' + PR.icon("copy", "sm") + "复制 Markdown</button>" +
      '<button class="btn sm line" data-c="csv">' + PR.icon("download", "sm") + "下载 Excel（CSV）</button>" +
      '<button class="btn sm" data-c="close">关闭</button></div>' +
      (missing.length ? '<p class="hint cmp-miss">' + missing.length + " 篇还没有生成论文脉络，故事线和核心论点是空的。" +
        (L.engine !== "none" ? '<button class="linkish" data-c="gist">让模型为这 ' + missing.length + " 篇生成脉络</button>（会花模型额度，好了点“刷新”）" : "") +
        '<button class="linkish" data-c="reload">刷新</button></p>' : "") + tableHtml();
  }
  async function load(ids) {
    rows = (await PR.api("/api/compare?ids=" + encodeURIComponent(ids.join(",")))).rows || [];
    renderCmp();
  }
  PR.openCompare = async function (ids) {
    if (ids.length < 2) return PR.toast("至少选两篇");
    if (!cmp) {
      cmp = PR.el("div", { class: "dialog-backdrop", id: "cmpDlg" }, '<div class="dialog cmp-dialog" role="dialog" aria-label="文献对比表"></div>');
      document.body.appendChild(cmp);
      cmp.addEventListener("click", async (e) => {
        if (e.target === cmp) return cmp.classList.remove("open");
        const b = e.target.closest("[data-c]");
        if (!b) return;
        const act = b.dataset.c;
        if (act === "close") cmp.classList.remove("open");
        if (act === "md") copy(markdown(), " Markdown 表格，可以贴进 Obsidian / Notion");
        if (act === "csv") download(csv(), "文献对比-" + stamp() + ".csv", "text/csv;charset=utf-8");
        if (act === "reload") load(rows.map((r) => r.id));
        if (act === "gist") {
          const miss = rows.filter((r) => !r.has_gist);
          if (!(await PR.confirm({ title: "为 " + miss.length + " 篇生成脉络？", body: "用设置里的翻译模型逐章读译文，每篇大约相当于翻译一篇的几分之一的额度。", ok: "生成", at: b }))) return;
          for (const r of miss) await PR.api("/api/p/" + r.id + "/gist", { method: "POST", body: { mode: "missing" } }).catch((err) => PR.toast(PR.esc(err.message)));
          PR.toast("已开始生成，好了点“刷新”");
        }
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && cmp.classList.contains("open")) cmp.classList.remove("open"); });
    }
    cmp.querySelector(".dialog").innerHTML = '<p class="hint"><span class="spin"></span> 正在整理…</p>';
    cmp.classList.add("open");
    try { await load(ids); } catch (err) { cmp.querySelector(".dialog").innerHTML = '<p class="hint">没取到：' + PR.esc(err.message) + "</p>"; }
  };
})(window.PR);
