/* 缩写词：从英文原文抽“wall shear stress (WSS)”（Schwartz–Hearst 算法），也认译文里的“（coronary artery disease, CAD）”。
   正文和原文里再出现 WSS，悬停就看到全称、术语表里的中文译法、在哪儿第一次定义。左侧抽屉“术语”页列出全部缩写。
   设置里可以关掉（功能开关“缩写词释义”）。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const ABBR = "([A-Z][A-Za-z0-9\\-]*[A-Z][A-Za-z0-9\\-]*?)(?:s)?";

  /* Schwartz & Hearst (2003)：从缩写最后一个字母往前，在全称里倒着找；首字母必须落在词首 */
  function longForm(short, cand) {
    let s = short.length - 1, l = cand.length - 1;
    while (s >= 0) {
      const c = short[s].toLowerCase();
      if (!/[a-z0-9]/.test(c)) { s--; continue; }
      while ((l >= 0 && cand[l].toLowerCase() !== c) || (s === 0 && l > 0 && /[a-z0-9]/i.test(cand[l - 1]))) l--;
      if (l < 0) return null;
      l--; s--;
    }
    return cand.slice(cand.lastIndexOf(" ", l) + 1).trim();
  }
  function fromEnglish(text, add, id) {
    const re = new RegExp("\\(" + ABBR + "\\)", "g");
    for (const m of text.matchAll(re)) {
      const short = m[1];
      if (short.length > 10) continue;
      const words = text.slice(0, m.index).replace(/\$[^$]*\$/g, " ").split(/[.;:!?(\[]/).pop().trim().split(/\s+/);
      const cand = words.slice(-Math.min(short.length + 5, short.length * 2)).join(" ");
      const long = cand && longForm(short, cand);
      if (long && long.length > short.length + 2 && !long.includes(short) && long.split(/\s+/).length <= short.length + 3) add(short, long, id);
    }
  }
  function fromChinese(text, add, id) {  // 译文里“（coronary artery disease, CAD）”
    const re = new RegExp("[（(]([A-Za-z][A-Za-z\\- ]{3,80}?)[,，]\\s*" + ABBR + "[）)]", "g");
    for (const m of text.matchAll(re)) if (longForm(m[2], m[1])) add(m[2], m[1].trim(), id);
  }

  PR.abbrs = {};
  PR.abbrRe = null;
  PR.buildAbbrs = function () {
    const found = {};
    const add = (short, long, id) => { if (!found[short] && !/-$/.test(short)) found[short] = { short, long, first: id }; };
    for (const b of S.paper.blocks || []) {
      const en = [b.en, b.caption_en].concat((b.items || []).map((i) => i.en)).filter(Boolean).join(" ");
      if (en) fromEnglish(en, add, b.id);
      const zh = [b.zh, b.caption_zh].concat((b.items || []).map((i) => i.zh)).filter(Boolean).join(" ");
      if (zh) fromChinese(zh, add, b.id);
    }
    const gloss = {};
    (S.paper.glossary || []).forEach((g) => { if (g.en && g.zh) gloss[g.en.toLowerCase().replace(/s$/, "")] = g.zh; });
    for (const a of Object.values(found)) a.zh = gloss[a.long.toLowerCase().replace(/s$/, "")] || "";
    PR.abbrs = found;
    const keys = Object.keys(found).sort((a, b) => b.length - a.length);
    PR.abbrRe = keys.length && PR.feature("abbr")
      ? new RegExp("(?<![A-Za-z0-9\\-])(" + keys.map((k) => k.replace(/[-]/g, "\\-")).join("|") + ")s?(?![A-Za-z0-9\\-])", "g") : null;
  };

  function card(a) {
    const b = PR.blockById[a.first];
    return '<div class="hd">缩写 · ' + PR.esc(a.short) + '</div><div class="cap"><b lang="en">' + PR.esc(a.long) + "</b>" +
      (a.zh ? "　" + PR.esc(a.zh) : "") + "</div>" +
      (b ? '<div class="ab-foot">第 ' + (b.page || "?") + ' 页首次定义 · <button class="linkish" data-ab-go="' + PR.esc(a.first) + '">跳过去看</button></div>' : "");
  }
  let hoverT = null;
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("abbr.ab");
    if (!el) return;
    const a = PR.abbrs[el.dataset.ab];
    if (!a) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => PR.popover(el, card(a)), 220);
  });
  document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest("abbr.ab")) { clearTimeout(hoverT); PR.hidePopoverSoon(); } });
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-ab-go]");
    if (!go) return;
    PR.hidePopover(); PR.toggleDrawer(false);
    PR.jumpTo("b-" + go.dataset.abGo);
  });

  /* 抽屉“术语”页下面的缩写表 */
  PR.abbrTableHtml = function () {
    const list = Object.values(PR.abbrs).sort((a, b) => a.short.localeCompare(b.short));
    if (!list.length) return "";
    return '<div class="hint" style="margin:18px 0 6px">缩写 · ' + list.length + ' 个（从原文自动识别，正文里悬停可看）</div><table class="terms-t abbr-t">' +
      list.map((a) => '<tr><td><button class="linkish" data-ab-go="' + PR.esc(a.first) + '" title="跳到首次定义">' + PR.esc(a.short) + '</button></td><td lang="en">' + PR.esc(a.long) + "</td><td>" + PR.esc(a.zh) + "</td></tr>").join("") + "</table>";
  };

  PR.on("ui-changed", () => {
    const had = !!PR.abbrRe;
    PR.buildAbbrs();
    if (had !== !!PR.abbrRe && PR.$("#paper").childElementCount) PR.rerenderKeepingPlace();  // 正文还没排出来时（启动中）不用重排
  });
})(window.PR);
