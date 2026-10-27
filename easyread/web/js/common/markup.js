/* 行内标记：$TeX$、**粗体**、*斜体*、`代码`、[n] 引用，以及“公式 (1) / 表 2 / 第 2.2 节 / 附录 A”这类交叉引用。
   译文、讨论、笔记都用同一套，用户编辑时看到的就是这套原始标记。 */
(function (PR) {
  "use strict";
  const MATH = /(?<!\\)\$((?:\\\$|[^$])+?)(?<!\\)\$/g;
  const mathCache = new Map();

  PR.tex = function (tex, display) {
    const key = (display ? "D" : "I") + tex;
    if (mathCache.has(key)) return mathCache.get(key);
    let html;
    try {
      html = katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: "ignore", trust: false });
    } catch (e) {
      html = '<code title="公式渲染失败">' + PR.esc(tex) + "</code>";
    }
    mathCache.set(key, html);
    return html;
  };

  function citeLinks(s) {
    return s.replace(/\[(\d+(?:\s*[,，–-]\s*\d+)*)\]/g, (m, inner) => {
      const parts = inner.split(/(\s*[,，–-]\s*)/);
      const linked = parts.map((p) => (/^\d+$/.test(p) && PR.refById && PR.refById[p])
        ? '<a class="cite" data-ref="' + p + '">' + p + "</a>" : p).join("");
      return "[" + linked + "]";
    });
  }

  /* 作者-年份制引用：（Itatani et al., 2022; Wu et al., 2025）、Fuchs and Whelton (2020)、（Li 等，2021）。
     按第一作者姓氏 + 年份在参考文献里找；找不到的原样留着，不乱链。 */
  const fold = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let ayRefs = [];
  const ayCache = new Map();
  PR.indexAuthorYear = function (refs) {
    ayCache.clear();
    ayRefs = (refs || []).map((r, i) => {
      const t = fold(r.text);
      const y = t.search(/(?:19|20)\d{2}/);
      return { id: String(r.id), text: t, head: t.slice(0, Math.min(240, Math.max(60, y < 0 ? 160 : y))), i };
    });
  };
  PR.authorYearRef = function (names, ys) {
    const key = names + "|" + ys;
    if (ayCache.has(key)) return ayCache.get(key);
    const year = ys.slice(0, 4), suf = ys.slice(4);
    const parts = fold(names).replace(/&amp;/g, "&").replace(/\bet\s+al\.?|等人?/g, " ")
      .split(/\s*(?:,|，|、|\band\b|&|和|与)\s*/).map((x) => x.trim()).filter(Boolean);
    const word = (w) => new RegExp("(^|[^a-z])" + reEsc(w) + "(?![a-z])");
    let found = null;
    if (parts[0] && parts[0].length >= 2) {
      const yre = new RegExp("(^|\\D)" + year + "(?!\\d)");
      const w1 = word(parts[0]);
      let c = ayRefs.filter((r) => yre.test(r.text)).map((r) => { const m = w1.exec(r.head); return m ? { r, pos: m.index } : null; }).filter(Boolean);
      if (parts[1]) { const w2 = word(parts[1]); const both = c.filter((x) => w2.test(x.r.head)); if (both.length) c = both; }
      c.sort((a, b) => a.pos - b.pos || a.r.i - b.r.i);
      if (c.length && suf) {
        const exact = c.filter((x) => x.r.text.includes(year + suf));
        const same = c.filter((x) => x.pos === c[0].pos);
        found = (exact[0] || same[suf.charCodeAt(0) - 97] || c[0]).r.id;
      } else if (c.length) found = c[0].r.id;
    }
    ayCache.set(key, found);
    return found;
  };
  const NAME = "[A-Z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F'’\\-]+";
  const AY_ITEM = new RegExp("^((?:e\\.g\\.|i\\.e\\.|see|cf\\.|如|见|参见)[,，]?\\s*)?(" + NAME + "[^;；()（）]*?)[,，]?\\s*((?:19|20)\\d{2}[a-z]?)$");
  const AY_NARR = new RegExp("(" + NAME + "(?:\\s+" + NAME + ")?(?:\\s*(?:et al\\.|等人?)|\\s+(?:and|&amp;|和|与)\\s+" + NAME + ")?)\\s*([（(])((?:19|20)\\d{2}[a-z]?)([)）])", "g");
  function ayLink(text, names, ys) {
    const id = PR.authorYearRef(names, ys);
    return id && PR.refById && PR.refById[id] ? '<a class="cite" data-ref="' + PR.esc(id) + '">' + text + "</a>" : text;
  }
  function authorYearLinks(s) {
    if (!ayRefs.length || !/(?:19|20)\d{2}/.test(s)) return s;
    s = s.replace(/([（(])([^()（）<>]{6,600}?)([)）])/g, (m, open, inner, close) => {
      if (!/(?:19|20)\d{2}/.test(inner)) return m;
      return open + inner.split(/(\s*(?<!&[a-z]{1,6});\s*|\s*；\s*)/).map((item, i) => {
        if (i % 2) return item;
        const mm = item.match(AY_ITEM);
        return mm ? (mm[1] || "") + ayLink(item.slice((mm[1] || "").length), mm[2], mm[3]) : item;
      }).join("") + close;
    });
    return s.replace(AY_NARR, (m, names, open, ys, close, at, all) => {
      if (/<a [^>]*$/.test(all.slice(Math.max(0, at - 80), at))) return m;  // 已经在链接里
      const sp = names.match(/^(\S+\s+)(.+)$/);  // “Recently Smith et al. (2020)”：句首的词不是姓
      if (sp && !PR.authorYearRef(names, ys) && PR.authorYearRef(sp[2], ys)) return sp[1] + ayLink(m.slice(sp[1].length), sp[2], ys);
      return ayLink(m, names, ys);
    });
  }

  /* 缩写：全文抽出来的“wall shear stress (WSS)”，正文里的 WSS 悬停看全称（reader/abbr.js 建表） */
  function abbrLinks(s) {
    const re = PR.abbrRe;
    if (!re) return s;
    let depth = 0;
    return s.split(/(<[^>]+>)/).map((part) => {
      if (part[0] === "<") {
        if (/^<(a|code)[\s>]/i.test(part)) depth++;
        else if (/^<\/(a|code)>/i.test(part)) depth = Math.max(0, depth - 1);
        return part;
      }
      return depth ? part : part.replace(re, (m, ab) => '<abbr class="ab" data-ab="' + ab + '">' + m + "</abbr>");
    }).join("");
  }

  function xref(kind, key, label) {
    const ix = PR.xindex && PR.xindex[kind];
    if (!ix || !ix[key]) return label;
    return '<a class="xref" data-kind="' + kind + '" data-key="' + PR.esc(key) + '">' + label + "</a>";
  }

  function xrefLinks(s) {
    // 公式 (9) 和 (10)：把这一串里每个编号都链上
    s = s.replace(/公式\s*[（(]\d+[）)](?:\s*(?:和|与|及|、|或|,|，)\s*[（(]\d+[）)])*/g,
      (m) => m.replace(/[（(](\d+)[）)]/g, (mm, n) => xref("eq", n, mm)));
    s = s.replace(/公式\s*(\d+)(?![\d.）)])/g, (m, n) => xref("eq", n, m));
    s = s.replace(/表\s*(\d+)/g, (m, n) => xref("tab", n, m));
    s = s.replace(/图\s*(\d+)/g, (m, n) => xref("fig", n, m));
    s = s.replace(/第\s*(\d+(?:\.\d+)*)\s*节/g, (m, n) => xref("sec", n, m));
    s = s.replace(/附录\s*([A-Z])(?![a-zA-Z])/g, (m, n) => xref("sec", n, m));
    // 英文原文里的
    s = s.replace(/\b(Equations?)\s+(\d+)(?:\s+(and)\s+(\d+))?/g, (m, w, a, and, b) =>
      w + " " + xref("eq", a, a) + (b ? " " + and + " " + xref("eq", b, b) : ""));
    s = s.replace(/\bTable\s+(\d+)/g, (m, n) => xref("tab", n, m));
    s = s.replace(/\bFigure\s+(\d+)/g, (m, n) => xref("fig", n, m));
    s = s.replace(/\bFigs?\.\s*(\d+)/g, (m, n) => xref("fig", n, m));
    s = s.replace(/\bSection\s+(\d+(?:\.\d+)*)/g, (m, n) => xref("sec", n, m));
    s = s.replace(/\bAppendix\s+([A-Z])\b/g, (m, n) => xref("sec", n, m));
    return s;
  }

  /* AI 回答里偶尔会带出段落编号 [p4-5]、[eq7]，换成读者看得懂的“式 7”“第 4 页” */
  function blockLabel(s) {
    return s.replace(/\[([a-z]+\d*(?:-[\w-]+)?)\]/g, (m, id) => {
      const b = PR.blockById && PR.blockById[id];
      if (!b) return m;
      return b.type === "math" && b.tag ? "（式 " + b.tag + "）" : b.page ? "（第 " + b.page + " 页）" : m;
    });
  }

  function inline(text, opts) {
    let s = blockLabel(PR.esc(text).replace(/\\\$/g, "$"));
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    if (opts.cite !== false) s = authorYearLinks(citeLinks(s));
    if (opts.xref !== false) s = abbrLinks(xrefLinks(s));
    return s.replace(/\n/g, "<br>");
  }

  /* 一行/一段文字 -> HTML */
  PR.md = function (text, opts) {
    opts = opts || {};
    text = String(text == null ? "" : text);
    // 公式先换成占位符再处理粗体等标记，这样 **粗体里带 $公式$** 也能认出来
    const maths = [];
    MATH.lastIndex = 0;
    const s = text.replace(MATH, (m, t) => "" + (maths.push(t) - 1) + "");
    return inline(s, opts).replace(/(\d+)/g, (m, i) => PR.tex(maths[i].replace(/\\\$/g, "\\$"), false));
  };

  /* 多段文字（讨论、笔记正文）：空行分段；$$...$$ 是行间公式——AI 常把它紧贴在上一行文字或列表后面，也要拆出来 */
  PR.mdBlocks = function (text, opts) {
    return String(text || "").trim().split(/\n\s*\n/).map((p) =>
      p.split(/(?<!\\)\$\$([\s\S]+?)\$\$/).map((part, i) =>
        i % 2 ? '<div class="eq">' + PR.tex(part.trim(), true) + "</div>" : para(part, opts)).join("")).join("");
  };

  function para(p, opts) {
    p = p.trim();
    if (!p) return "";
    const h = p.match(/^#{1,4}\s+(.+)$/);
    if (h) return '<p class="md-h">' + PR.md(h[1], opts) + "</p>";
    const lines = p.split("\n");
    // 列表：从某行起每行都以 “- ”“* ”或“1. ”开头（AI 的回答常用“引子：\n- …\n- …”）
    const isItem = (l) => /^\s*([-*•]|\d+[.、)])\s+/.test(l);
    const k = lines.findIndex(isItem);
    if (k >= 0 && lines.slice(k).every(isItem)) {
      const ordered = /^\s*\d/.test(lines[k]);
      return (k ? "<p>" + PR.md(lines.slice(0, k).join("\n"), opts) + "</p>" : "") + (ordered ? "<ol>" : "<ul>") +
        lines.slice(k).map((l) => "<li>" + PR.md(l.replace(/^\s*([-*•]|\d+[.、)])\s+/, ""), opts) + "</li>").join("") + (ordered ? "</ol>" : "</ul>");
    }
    return "<p>" + PR.md(p, opts) + "</p>";
  }

  /* 去掉标记的纯文字，给目录、列表摘要用 */
  PR.plain = (text) => String(text || "").replace(MATH, (m, t) => t).replace(/\*\*|`/g, "");
})(window.PR);
