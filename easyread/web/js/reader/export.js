/* 导出笔记（Markdown）与导出中文版 PDF（支持纯中文译文、中英双语对照、附带笔记与 AI 批注）。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const KINDS = [
    ["paper", "论文笔记（整篇的感悟）"], ["note", "我的笔记"], ["highlight", "我的划线"], ["question", "我的问题"],
    ["ai", "AI 的回答和解释（页边）"], ["chat", "问 AI 的对话记录"], ["quote", "每条附上原文引用"],
  ];

  function counts() {
    const notes = PR.myNotes();
    return {
      paper: (S.reader.paper_note || {}).body ? 1 : 0,
      note: notes.filter((n) => n.kind === "note" || (n.kind !== "question" && n.kind !== "highlight")).length,
      highlight: notes.filter((n) => n.kind === "highlight").length,
      question: notes.filter((n) => n.kind === "question").length,
      ai: (S.discussion.entries || []).length,
    };
  }

  /* 整篇译文导出 Markdown：标题、段落、列表、公式（$$）、表格（GFM）、插图、参考文献，可直接放进 Obsidian / Notion。 */
  PR.fullMarkdown = function () {
    const m = S.paper.meta || {};
    const out = [];
    out.push("# " + (m.title_zh || m.title_en || "论文"));
    const bits = [m.authors, m.year, m.venue || m.arxiv, m.url].filter(Boolean).map((x) => String(x).replace(/\n+/g, " "));
    if (bits.length) out.push("", bits.join(" · "));
    out.push("", "> 由 EasyRead 翻译排版，公式为 LaTeX 源码，图片链接在本机服务开着时可用。", "");
    let figN = 0;
    for (const b of S.paper.blocks || []) {
      if (!b.id) continue;
      if (b.type === "heading") out.push("", (b.level === 1 ? "## " : "### ") + (b.num ? b.num + " " : "") + PR.plain(PR.textFor(b.id) || b.zh || ""), "");
      else if (b.type === "para") out.push(PR.textFor(b.id) || "", "");
      else if (b.type === "list") {
        (b.items || []).forEach((it, i) => out.push((b.ordered ? (i + 1) + ". " : "- ") + (PR.textFor(b.id + "#" + i) || "")));
        out.push("");
      }
      else if (b.type === "math") out.push("$$", (b.tex || "") + (b.tag && /^\d+$/.test(b.tag) ? "\n\\tag{" + b.tag + "}" : ""), "$$", "");
      else if (b.type === "table") {
        if (b.caption_zh || PR.textFor(b.id + "#caption")) out.push("**" + PR.plain(PR.textFor(b.id + "#caption")).replace(/^\s*表[^：:]*[：:]\s*/, "") + "**", "");
        out.push(mdTable(b), "");
      } else if (b.type === "figure") {
        figN++;
        const url = PR.store.mode === "server" && b.src ? location.origin + PR.imageUrl(b.src) : (b.src || "");
        if (b.src) out.push("![" + PR.plain(PR.textFor(b.id + "#caption")).slice(0, 60) + "](" + url + ")");
        const cap = PR.textFor(b.id + "#caption");
        if (cap) out.push("*" + PR.plain(cap).replace(/^\s*图[^：:]*[：:]\s*/, "") + "*");
        out.push("");
      } else if (b.type === "note") out.push("> " + PR.plain(b.zh || "").replace(/\n/g, "\n> "), "");
      else if (b.type === "references") {
        out.push("", "## 参考文献", "");
        (S.paper.references || []).forEach((r) => out.push("[" + r.id + "] " + r.text));
        out.push("");
      }
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

    function mdTable(b) {
      const plain = (c) => PR.plain(String(c == null ? "" : c)).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
      const al = (b.align || "").split("");
      const line = (r) => "| " + r.map(plain).join(" | ") + " |";
      const sep = "|" + (b.head || [[]])[0].map((_, i) => (al[i] === "l" ? " :--- " : al[i] === "r" ? " ---: " : al[i] === "c" ? " :---: " : " --- ")).join("|") + "|";
      return [line((b.head || [[]])[0]), sep].concat((b.rows || []).map(line)).join("\n");
    }
  };

  function downloadText(text, name, mime) {
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  PR.downloadFullMd = function () {
    const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || (S.paper.meta || {}).title_en || "论文").replace(/[\\/:*?"<>|]/g, "");
    downloadText(PR.fullMarkdown(), stem + "-中文译文.md", "text/markdown;charset=utf-8");
    PR.toast("已导出整篇译文 Markdown");
  };

  PR.openExport = function () {
    const c = counts();
    const saved = PR.ls.get("easyread-export", { paper: true, note: true, highlight: true, question: true, ai: true, chat: false, quote: true });
    const dlg = PR.$("#readerDlg");
    dlg.querySelector(".dialog").innerHTML = "<h2>导出笔记</h2><div class=\"exp-opts\">" +
      KINDS.map(([k, l]) => '<label><input type="checkbox" data-exp="' + k + '"' + (saved[k] ? " checked" : "") + ">" + l +
        (c[k] != null ? '<span class="n">' + c[k] + " 条</span>" : "") + "</label>").join("") +
      '</div><p class="hint">导出成 Markdown，按原文章节顺序排，可以直接放进 Obsidian、Notion。</p>' +
      '<div class="actions"><button class="btn sm line" data-exp-switch-pdf style="margin-right:auto">导出中文 PDF…</button>' +
      '<button class="btn sm line" data-exp-full>整篇译文 MD</button>' +
      '<button class="btn" data-exp-close>取消</button><button class="btn primary" data-exp-go>导出</button></div>';
    dlg.classList.add("open");
  };

  PR.openPdfExport = function () {
    const c = counts();
    const totalNotes = (c.paper || 0) + (c.note || 0) + (c.highlight || 0) + (c.question || 0) + (c.ai || 0);
    const saved = PR.ls.get("easyread-pdf-export", { mode: "zh", notes: false });
    const dlg = PR.$("#readerDlg");
    dlg.querySelector(".dialog").innerHTML = "<h2>导出中文 PDF</h2><div class=\"exp-opts\">" +
      '<label><input type="radio" name="pdfMode" value="zh"' + (saved.mode !== "bi" ? " checked" : "") + ">纯中文译文（推荐）</label>" +
      '<label><input type="radio" name="pdfMode" value="bi"' + (saved.mode === "bi" ? " checked" : "") + ">中英双语对照（每段中文下附英文原文）</label>" +
      '<hr style="border:0;border-top:1px solid var(--rule);margin:4px 0">' +
      '<label><input type="checkbox" data-pdf-notes' + (saved.notes ? " checked" : "") + ">包含我的笔记、划线与 AI 批注" +
      '<span class="n">' + totalNotes + " 处</span></label></div>" +
      '<p class="hint">基于中文阅读页重排生成 PDF（宋体正文、KaTeX 公式、三线表、裁切插图、参考文献）。</p>' +
      '<div class="actions"><button class="btn sm line" data-pdf-switch-md style="margin-right:auto">只导出笔记 Markdown…</button>' +
      '<button class="btn" data-exp-close>取消</button><button class="btn primary" data-pdf-go>导出 PDF</button></div>';
    dlg.classList.add("open");
  };

  PR.printPdf = function (opts) {
    opts = opts || {};
    const body = document.body;
    const prevBi = body.classList.contains("mode-bi");
    const prevNotes = body.classList.contains("print-notes");
    const prevClean = body.classList.contains("print-clean");
    body.classList.toggle("mode-bi", opts.mode === "bi");
    body.classList.toggle("print-notes", !!opts.notes);
    body.classList.toggle("print-clean", !opts.notes);
    PR.$$("#paper img[loading=lazy]").forEach((img) => img.removeAttribute("loading"));
    PR.fitWide && PR.fitWide();
    const restore = () => {
      body.classList.toggle("mode-bi", prevBi);
      body.classList.toggle("print-notes", prevNotes);
      body.classList.toggle("print-clean", prevClean);
      PR.fitWide && PR.fitWide();
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    setTimeout(() => window.print(), 120);
  };

  PR.exportPdf = async function (opts) {
    opts = opts || { mode: "zh", notes: false };
    if (PR.store.mode !== "server") return PR.printPdf(opts);
    if (PR.flush) await PR.flush();
    PR.toast('<span class="spin"></span> 正在生成中文 PDF，请稍候…', null, 45000);
    try {
      const url = "/api/p/" + encodeURIComponent(PR.pid) + "/export-pdf?mode=" + encodeURIComponent(opts.mode || "zh") + "&notes=" + (opts.notes ? "1" : "0");
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "生成失败 " + r.status);
      }
      const blob = await r.blob();
      const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || (S.paper.meta || {}).title_en || "论文").replace(/[\\/:*?"<>|]/g, "");
      const suffix = (opts.mode === "bi" ? "中英对照" : "中文版") + (opts.notes ? "-含批注" : "");
      const a = PR.el("a", { href: URL.createObjectURL(blob), download: stem + "-" + suffix + ".pdf" });
      document.body.appendChild(a); a.click(); a.remove();
      PR.toast("已导出中文 PDF");
    } catch (e) {
      PR.toast("正在调用浏览器打印另存为 PDF…");
      PR.printPdf(opts);
    }
  };

  PR.$("#readerDlg").addEventListener("click", async (e) => {
    const dlg = PR.$("#readerDlg");
    if (e.target.closest("[data-exp-close]")) return dlg.classList.remove("open");
    if (e.target.closest("[data-exp-switch-pdf]")) return PR.openPdfExport();
    if (e.target.closest("[data-exp-full]")) { dlg.classList.remove("open"); return PR.downloadFullMd(); }
    if (e.target.closest("[data-pdf-switch-md]")) return PR.openExport();
    if (e.target.closest("[data-pdf-go]")) {
      const modeEl = dlg.querySelector('input[name="pdfMode"]:checked');
      const notesEl = dlg.querySelector("[data-pdf-notes]");
      const opts = { mode: modeEl ? modeEl.value : "zh", notes: !!(notesEl && notesEl.checked) };
      PR.ls.set("easyread-pdf-export", opts);
      dlg.classList.remove("open");
      return PR.exportPdf(opts);
    }
    if (!e.target.closest("[data-exp-go]")) return;
    const pick = {};
    PR.$$("[data-exp]", dlg).forEach((i) => (pick[i.dataset.exp] = i.checked));
    PR.ls.set("easyread-export", pick);
    let chat = [];
    if (pick.chat && PR.store.mode === "server") { try { chat = (await PR.api("/api/p/" + PR.pid + "/chat")).messages || []; } catch (err) { /* 没有就算了 */ } }
    const text = PR.notesMarkdown(pick, chat);
    const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || "论文").replace(/[\\/:*?"<>|]/g, "");
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" })), download: stem + "-笔记.md" });
    document.body.appendChild(a); a.click(); a.remove();
    dlg.classList.remove("open");
  });
})(window.PR);
