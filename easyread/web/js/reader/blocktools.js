/* 表格和公式的复制工具：render.js 在表格、行间公式右上角放了复制按钮，这里管点击后的行为。
   表格可以复制成贴进 Excel 的 TSV、Markdown 表格，或下载 CSV（带 BOM，Excel 打开不乱码）。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const cellText = (c) => PR.plain(String(c == null ? "" : c)).replace(/\s*\n\s*/g, " ").trim();

  function tableData(b) {
    const head = (b.head || []).map((r) => r.map(cellText));
    const rows = (b.rows || []).map((r) => r.map(cellText));
    return { head, rows };
  }
  function tsv(b) {
    const { head, rows } = tableData(b);
    return head.concat(rows).map((r) => r.join("\t")).join("\n");
  }
  function mdTable(b) {
    const { head, rows } = tableData(b);
    const al = (b.align || "").split("");
    const esc = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    const line = (r) => "| " + r.map(esc).join(" | ") + " |";
    const sep = "|" + (head[0] || []).map((_, i) => (al[i] === "l" ? " :--- " : al[i] === "r" ? " ---: " : al[i] === "c" ? " :---: " : " --- ")).join("|") + "|";
    return [line(head[0] || []), sep].concat(rows.map(line)).join("\n");
  }
  function csv(b) {
    const { head, rows } = tableData(b);
    const q = (s) => '"' + s.replace(/"/g, '""') + '"';
    return "\ufeff" + head.concat(rows).map((r) => r.map(q).join(",")).join("\r\n");
  }

  function tableMenu(anchor, b) {
    const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || "table").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
    const dl = (text, ext, mime) => {
      const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type: mime })), download: stem + "-" + b.id + "." + ext });
      document.body.appendChild(a); a.click(); a.remove();
    };
    PR.menu(anchor, [
      { label: "复制表格 · 贴进 Excel / WPS", icon: "copy", fn: () => navigator.clipboard.writeText(tsv(b)).then(() => PR.toast("已复制，直接粘贴进 Excel")) },
      { label: "复制 Markdown 表格", icon: "copy", fn: () => navigator.clipboard.writeText(mdTable(b)).then(() => PR.toast("已复制 Markdown 表格")) },
      "-",
      { label: "下载 CSV", icon: "download", fn: () => dl(csv(b), "csv", "text/csv;charset=utf-8") },
      { label: "下载 Markdown 表格", icon: "download", fn: () => dl(mdTable(b), "md", "text/markdown;charset=utf-8") },
    ]);
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn || !btn.closest("#paper")) return;
    e.preventDefault();
    e.stopPropagation();
    const blk = btn.closest(".blk");
    const b = blk && PR.blockById[blk.dataset.id];
    if (!b) return;
    if (btn.dataset.copy === "tex" && b.tex) {
      navigator.clipboard.writeText(b.tex).then(() => PR.toast("已复制 LaTeX 源码"));
    } else if (btn.dataset.copy === "table") {
      tableMenu(btn, b);
    }
  });
})(window.PR);
