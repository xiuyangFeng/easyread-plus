/* 顶栏、阅读设置（字号/版心/行距用滑杆，= - 键也能调）、左侧抽屉（目录/术语/说明）、悬浮卡。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;

  /* ---------- 偏好 ---------- */
  const DEF = { fs: 18, measure: 35, lh: 1.9, font: "serif", theme: "auto", mode: "zh", margin: true, gist: true };
  PR.prefs = Object.assign({}, DEF, PR.ls.get("easyread-prefs", {}));
  PR.applyPrefs = function () {
    const p = PR.prefs, root = document.documentElement;
    root.style.setProperty("--fs", p.fs + "px");
    root.style.setProperty("--lh", p.lh);
    root.style.setProperty("--measure", p.measure + "em");
    PR.applyTheme(p.theme);
    body.classList.toggle("font-sans", p.font === "sans");
    body.classList.toggle("mode-bi", p.mode === "bi");
    body.classList.toggle("no-margin", !p.margin);
    PR.$$("#bar .seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === p.mode));
    PR.ls.set("easyread-prefs", Object.assign(PR.ls.get("easyread-prefs", {}), p));
    if (PR.store.mode === "server") PR.savePrefs("reader", p);
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => PR.applyPrefs());
  const relayout = PR.debounce(() => { PR.fitWide(); PR.renderMargin(); PR.syncPage && PR.syncPage(true); }, 60);
  PR.setPref = function (k, v, quiet) {
    const anchor = PR.readingBlock && PR.readingBlock();
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    PR.prefs[k] = v;
    PR.applyPrefs();
    if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);  // 调字号时阅读位置不跳
    if (!quiet) PR.renderSettings();
    else syncSettings();
    relayout();
  };
  PR.bumpFont = (d) => { PR.setPref("fs", Math.min(28, Math.max(13, PR.prefs.fs + d)), true); PR.toast("字号 " + PR.prefs.fs + " px", null, 900); };

  /* 触控板双指捏合 / Ctrl+滚轮：浏览器默认把整页当图片放大，右侧面板和顶栏会被挤出窗口。
     这里改成调正文字号，版面始终贴着窗口排。灯箱里的捏合留给灯箱自己缩放图片。 */
  let pinch = 0;
  const zoomed = () => !!window.visualViewport && visualViewport.scale > 1.01;
  window.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || S.pdf || (e.target.closest && e.target.closest("#lightbox"))) return;
    if (zoomed()) return;  // 已经被放大了：捏合交还给浏览器，好让人缩回去
    e.preventDefault();
    pinch += e.deltaY;
    if (Math.abs(pinch) >= 36) { PR.bumpFont(pinch < 0 ? 1 : -1); pinch = 0; }
  }, { passive: false });
  let gesture = 1;  // Safari 的捏合走 gesture 事件
  document.addEventListener("gesturestart", (e) => { e.preventDefault(); gesture = 1; });
  document.addEventListener("gesturechange", (e) => {
    if (e.target.closest && e.target.closest("#lightbox")) return;
    e.preventDefault();
    if (e.scale / gesture > 1.12) { PR.bumpFont(1); gesture = e.scale; }
    else if (gesture / e.scale > 1.12) { PR.bumpFont(-1); gesture = e.scale; }
  });

  /* 页面已经处在放大状态（之前捏合过；Chrome 刷新也会保留这个倍数）：在看得见的区域里提示，一键恢复。
     刷新、location.replace 都恢复不了，得换个网址参数重新打开；带上 #正在读的段，打开后还在原处，参数随后从地址栏抹掉。
     提示条跟着可视区域（visualViewport）走、按倍数反向缩小，不然它自己也会被挤出去。 */
  if (/[?&]fit=/.test(location.search)) history.replaceState(null, "", location.pathname + location.hash);
  let tip = null, tipOff = false;
  function placeTip() {
    if (!tip) return;
    const v = visualViewport;
    tip.style.transform = "scale(" + 1 / v.scale + ")";
    tip.style.left = v.offsetLeft + (v.width - tip.offsetWidth / v.scale) / 2 + "px";
    tip.style.top = v.offsetTop + 14 / v.scale + "px";
  }
  function checkZoom() {
    if (S.pdf || !window.visualViewport) return;
    if (!zoomed()) { if (tip) { tip.remove(); tip = null; } return; }
    if (tipOff) return;
    if (!tip) {
      tip = PR.el("div", { id: "zoomtip", role: "alert" },
        '<span></span><button class="btn sm" data-z="fit">恢复原大小</button><button class="btn icon sm" data-z="x" title="不用了">×</button>');
      tip.addEventListener("click", (e) => {
        const b = e.target.closest("[data-z]");
        if (!b) return;
        if (b.dataset.z === "x") { tipOff = true; tip.remove(); tip = null; return; }
        const id = PR.readingBlock && PR.readingBlock();
        location.href = location.pathname + "?fit=" + Date.now() + (id && id !== "head" ? "#b-" + id : "");
      });
      document.body.appendChild(tip);
    }
    tip.querySelector("span").textContent = "页面被放大到 " + Math.round(visualViewport.scale * 100) + "%，右边会被挤出窗口，要左右滑才看得全。";
    placeTip();
  }
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", checkZoom);
    visualViewport.addEventListener("scroll", placeTip);
    setTimeout(checkZoom, 800);
  }

  function segHtml(key, opts) {
    return '<div class="seg">' + opts.map(([v, label]) => '<button data-p="' + key + '" data-v="' + v + '" class="' + (String(PR.prefs[key]) === String(v) ? "on" : "") + '">' + label + "</button>").join("") + "</div>";
  }
  function slider(key, label, min, max, step, unit) {
    return '<div class="row slider"><span>' + label + '</span><input type="range" data-r="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + PR.prefs[key] + '"><b data-rv="' + key + '">' + PR.prefs[key] + unit + "</b></div>";
  }
  PR.renderSettings = function () {
    PR.$("#settings").innerHTML =
      slider("fs", "字号", 13, 28, 1, " px") + slider("measure", "版心", 26, 50, 1, " 字") + slider("lh", "行距", 1.5, 2.4, 0.05, "") +
      '<div class="row"><span>显示</span>' + segHtml("mode", [["zh", "译文"], ["bi", "对照"]]) + "</div>" +
      '<div class="row"><span>字体</span>' + segHtml("font", [["serif", "宋体"], ["sans", "黑体"]]) + "</div>" +
      '<div class="row"><span>主题</span>' + segHtml("theme", [["auto", "跟随"], ["light", "浅"], ["dark", "深"]]) + "</div>" +
      '<div class="row"><span>边注</span>' + segHtml("margin", [[true, "显示"], [false, "收起"]]) + "</div>" +
      '<div class="row slider"><span>自动滚速</span><input type="range" data-r="scrollSpeed" min="1" max="10" step="1" value="' + (PR.prefs.scrollSpeed || 4) + '"><b data-rv="scrollSpeed">' + (PR.prefs.scrollSpeed || 4) + '</b><button class="btn sm line" data-x2="autoscroll" style="margin-left:8px">开/关</button></div>' +
      '<div class="row slider"><span>朗读语速</span><input type="range" data-r="ttsRate" min="0.7" max="1.6" step="0.05" value="' + (PR.prefs.ttsRate || 1) + '"><b data-rv="ttsRate">' + (PR.prefs.ttsRate || 1) + '</b><button class="btn sm line" data-tts="start" style="margin-left:8px">朗读</button><button class="btn sm line" data-tts="stop">停止</button></div>' +
      '<div class="row hintrow"><button class="linkish" data-open-pdf>导出中文 PDF…</button><span style="margin-left:auto"></span>' +
      (PR.keysOn ? "<kbd>=</kbd> <kbd>-</kbd> 调字号　" : "") + (PR.store.mode === "server" ? '<button class="linkish" data-open-settings="reading">更多设置…</button>' : "") + "</div>";
  };
  function syncSettings() {
    PR.$$("#settings [data-r]").forEach((r) => { r.value = PR.prefs[r.dataset.r]; });
    PR.$$("#settings [data-rv]").forEach((b) => { const k = b.dataset.rv; b.textContent = PR.prefs[k] + ({ fs: " px", measure: " 字" }[k] || ""); });
  }
  PR.$("#settings").addEventListener("input", (e) => {
    const r = e.target.closest("[data-r]");
    if (r) PR.setPref(r.dataset.r, +r.value, true);
  });
  PR.$("#settings").addEventListener("click", (e) => {
    if (e.target.closest("[data-open-pdf]")) { PR.$("#settings").classList.remove("open"); return PR.openPdfExport && PR.openPdfExport(); }
    const os = e.target.closest("[data-open-settings]");
    if (os) { PR.$("#settings").classList.remove("open"); return PR.openSettings(os.dataset.openSettings); }
    const tt = e.target.closest("[data-tts]");
    if (tt) return void (tt.dataset.tts === "start" ? PR.ttsStart && PR.ttsStart() : PR.ttsStop && PR.ttsStop());
    const x2 = e.target.closest('[data-x2="autoscroll"]');
    if (x2) return PR.toggleAutoscroll && PR.toggleAutoscroll();
    const b = e.target.closest("[data-p]");
    if (!b) return;
    let v = b.dataset.v;
    if (b.dataset.p === "margin") v = v === "true";
    PR.setPref(b.dataset.p, v);
  });
  PR.resetType = () => { ["fs", "measure", "lh"].forEach((k) => (PR.prefs[k] = DEF[k])); PR.setPref("fs", DEF.fs, true); PR.toast("已恢复默认字号和版心", null, 1200); };

  /* ---------- 自动滚动：免手滚，滚轮 / 点击 / 任意按键停止 ---------- */
  let autoT = null, autoStarted = 0;
  PR.toggleAutoscroll = function () {
    if (autoT) { stopAuto(); return PR.toast("自动滚动已停止"); }
    const speed = Math.max(1, Math.min(10, PR.prefs.scrollSpeed || 4));
    let last = performance.now();
    const step = (t) => {
      window.scrollBy(0, ((t - last) / 1000) * speed * 14);  // 4 档 ≈ 每秒 56px，约两行
      last = t;
      autoT = requestAnimationFrame(step);
    };
    autoStarted = Date.now();
    autoT = requestAnimationFrame(step);
    document.body.classList.add("autoscroll");
    PR.toast("自动滚动中（" + speed + " 档，设置里可调）· 滚轮或任意按键停止", null, 3600);
  };
  function stopAuto() {
    if (autoT) cancelAnimationFrame(autoT);
    autoT = null;
    document.body.classList.remove("autoscroll");
  }
  ["wheel", "touchstart", "pointerdown"].forEach((ev) => window.addEventListener(ev, stopAuto, { passive: true }));
  document.addEventListener("keydown", (e) => {  // 刚按 W 开启的那次按键不算
    if (autoT && Date.now() - autoStarted > 250) stopAuto();
  });

  /* ---------- 顶栏 ---------- */  PR.$("#backBtn").innerHTML = PR.icon("back", "sm") + PR.logo();
  /* 在线演示：左上角回演示主页，顶栏多一个“在线演示”标记 */
  PR.setupDemo = function () {
    if (!S.demo) return;
    const back = PR.$("#backBtn");
    back.href = S.demo.home || "../"; back.title = "EasyRead 主页"; back.style.display = "";
    const pill = PR.el("a", { class: "demo-pill", href: S.demo.repo, target: "_blank", rel: "noopener", title: "这是在线演示；在 GitHub 上免费下载，装到自己电脑" }, "在线演示<span> · 免费下载</span>");
    PR.$("#bar .save-state").before(pill);
  };
  PR.$('[data-act="drawer"]').innerHTML = PR.icon("menu");
  PR.$('[data-act="map"]').innerHTML = PR.icon("map", "sm") + "<span>脉络</span>";
  PR.$('[data-act="figs"]').innerHTML = PR.icon("image", "sm") + "<span>看图</span>";
  PR.$('[data-act="pages"]').innerHTML = PR.icon("page", "sm") + "<span>原页</span>";
  PR.$('[data-act="pages"]').addEventListener("mouseenter", () => PR.preloadPage && PR.preloadPage());  // 鼠标移过去就开始加载
  PR.$('[data-act="notes"]').innerHTML = PR.icon("note", "sm") + "<span>笔记</span>";
  PR.$('[data-act="chat"]').innerHTML = PR.icon("sparkle", "sm") + "<span>问 AI</span>";
  /* 设置里关掉的功能：顶栏按钮也藏起来 */
  PR.applyFeatures = function () {
    const set = (sel, on) => { const el = PR.$(sel); if (el) el.style.display = on ? "" : "none"; };
    set('[data-act="pages"]', PR.feature("pages"));
    set('[data-act="figs"]', PR.feature("figs"));
    set('[data-act="map"]', PR.feature("gist"));
    if (!PR.feature("gist") && PR.side === "map") PR.openSide(null);
    if (!PR.feature("gist") && PR.skimOn && PR.skimOn()) PR.toggleSkim(false);
    if (PR.renderGists) PR.renderGists();
    if (!PR.feature("figs") && PR.side === "figs") PR.openSide(null);
    set('[data-act="chat"]', PR.feature("chat") && PR.chatView());
    if (!PR.feature("pages") && PR.side === "pages") PR.openSide(null);
    if (!PR.feature("chat") && PR.side === "chat") PR.openSide(null);
  };
  PR.on("ui-changed", () => { PR.applyFeatures(); PR.hideBlockbar && PR.hideBlockbar(); PR.renderMargin && PR.renderMargin(); });
  PR.$("#bar").addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) return PR.setPref("mode", m.dataset.mode);
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const act = a.dataset.act;
    if (act === "drawer") PR.toggleDrawer();
    if (act === "pages") PR.togglePages();
    if (act === "figs") PR.toggleFigs();
    if (act === "map") PR.toggleMap();
    if (act === "notes") PR.toggleNotesPanel();
    if (act === "chat") PR.toggleChat();
    if (act === "settings") { PR.renderSettings(); PR.$("#settings").classList.toggle("open"); }
    if (act === "about") PR.toggleDrawer(true, "about");
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#settings, [data-act=settings]")) PR.$("#settings").classList.remove("open");
    if (!e.target.closest("#popover, a.cite, a.xref, mark.hl, .stale-tag, #blockbar")) PR.hidePopover();
  });
  PR.on("status", ({ s, text }) => {
    const el = PR.$(".save-state");
    el.dataset.s = s;
    el.querySelector("span").textContent = text;
    el.title = s === "saved" ? "修改已写入 reader.json" : text;
  });
  PR.renderJobState = function () {
    const j = S.job || {};
    const el = PR.$("#jobState");
    if (["queued", "running"].includes(j.state)) el.innerHTML = '<span class="spin"></span> ' + PR.esc(j.message || "翻译中") + (j.total ? " " + j.done + "/" + j.total : "");
    else if (j.state === "error") el.innerHTML = '<span class="err" title="' + PR.esc(j.error || "") + '">翻译出错</span>';
    else if (j.state === "partial") el.innerHTML = '<span class="err" title="' + PR.esc(j.error || "") + '">' + Object.keys(j.failed || {}).length + " 页没译成功</span>";
    else el.innerHTML = "";
  };

  /* ---------- 抽屉 ---------- */
  let tab = "toc";
  PR.toggleDrawer = function (force, which) {
    if (which) tab = which;
    const open = force != null ? force : !body.classList.contains("drawer-open");
    body.classList.toggle("drawer-open", open);
    if (open) PR.renderDrawer();
  };
  PR.$("#scrim").onclick = () => PR.toggleDrawer(false);
  if (PR.store.mode !== "server") PR.$('[data-tab="recent"]').hidden = true;  // 离线单文件版没有文献库
  PR.$(".drawer-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; PR.renderDrawer(); } });

  PR.renderDrawer = function () {
    PR.$$(".drawer-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const box = PR.$(".drawer-body");
    box.innerHTML = ({ toc: tocHtml, terms: termsHtml, about: aboutHtml, recent: recentHtml, search: () => (PR.searchDrawer ? PR.searchDrawer() : "") })[tab]();
    box.className = "drawer-body " + tab;
  };
  /* 最近读过的论文：不用回文献库就能换一篇 */
  let recent = null;
  function recentHtml() {
    if (!recent) {
      PR.api("/api/library").then((d) => { recent = d.items.filter((i) => i.last_opened).sort((a, b) => String(b.last_opened).localeCompare(String(a.last_opened))).slice(0, 15); if (tab === "recent") PR.renderDrawer(); })
        .catch(() => { recent = []; });
      return '<p class="hint">加载中…</p>';
    }
    return '<nav class="toc recent-list">' + recent.map((i) => '<a href="/read/' + i.id + '" class="l1' + (i.id === PR.pid ? " on" : "") + '"><span class="cnt">' + (i.progress > 0.02 ? Math.round(i.progress * 100) + "%" : "") + "</span>" +
      PR.esc(i.title_zh || i.title_en || "（未命名）") + "</a>").join("") + '</nav><a class="btn sm line" href="/" style="margin-top:12px">打开文献库</a>';
  }
  function countByHeading() {
    const counts = {};
    let cur = "head";
    for (const b of S.paper.blocks || []) {
      if (b.type === "heading" || b.type === "references") cur = b.id;
      const n = ((PR.noteGroups || {})[b.id] || []).length;
      if (n) counts[cur] = (counts[cur] || 0) + n;
    }
    return counts;
  }
  function tocHtml() {
    const counts = countByHeading();
    const cur = PR.currentHeading && PR.currentHeading();
    let html = '<nav class="toc">', app = false;
    for (const h of PR.headings) {
      if (h.appendix && !app) { html += '<div class="group">附录</div>'; app = true; }
      html += '<a href="#b-' + h.id + '" data-go="' + h.id + '" class="' + (h.level === 2 ? "l2" : "l1") + (cur === h.id ? " on" : "") + '">' +
        (counts[h.id] ? '<span class="cnt">' + counts[h.id] + "</span>" : "") + '<span class="n">' + PR.esc(h.num || "") + "</span>" + PR.esc(PR.plain(PR.textFor(h.id) || h.zh)) + "</a>";
    }
    const done = new Set((S.paper.translation || {}).done_pages || []);
    const miss = ((S.paper.meta || {}).pages || []).filter((p) => !done.has(p.n));
    if (miss.length) html += '<div class="group">未译的页</div>' + miss.map((p) => '<a href="#orig-' + p.n + '" data-go-orig="' + p.n + '" class="l1"><span class="n"></span>原文第 ' + p.n + " 页</a>").join("");
    return html + "</nav>";
  }
  function termsHtml() {
    const g = S.paper.glossary || [];
    return '<p class="hint" style="margin:0 0 10px">译法不合心意？改右边的译法，再点“替换”，会把正文里的旧译法换成新的（记为你的修改，公式不动，随时可在段落右键“恢复译者稿”）。</p>' +
      (g.length ? '<table class="terms-t">' + g.map((t, i) => "<tr><td>" + PR.esc(t.en) + '</td><td><input class="input term-in" data-i="' + i + '" value="' + PR.esc(t.zh) + '"></td><td><button class="btn sm line" data-term="' + i + '">替换</button></td></tr>').join("") + "</table>" : '<p class="hint">这篇论文还没有术语表。</p>') +
      '<div class="term-free"><div class="hint" style="margin:14px 0 6px">任意替换</div><div style="display:flex;gap:6px"><input class="input" id="tFrom" placeholder="原译法"><input class="input" id="tTo" placeholder="新译法"><button class="btn sm line" data-term="free">替换</button></div></div>';
  }
  function aboutHtml() {
    const tr = S.paper.translation || {};
    const m = S.paper.meta || {};
    const pdf = PR.pdfUrl(1);
    const status = S.demo ? "这是 EasyRead 的在线演示。你在这里做的划线和笔记只存在这个浏览器里，别人看不到。装到自己电脑上，就能导入任意论文、后台翻译、边读边问 AI。"
      : PR.store.mode === "server"
      ? "你改的译文、笔记、划线写进论文目录的 reader.json（每次保存记日志，每 10 分钟留快照）。翻译方只写 paper.json 和 discussion.json，不会覆盖你的内容。"
      : "这是离线单文件版：修改只存在当前浏览器里。要把修改带回文献库，点“导出我的修改”得到一个 JSON，再运行 easyread merge。";
    return '<div class="about"><h3>译文</h3><p>' + ((tr.done_pages || []).length) + " / " + ((m.pages || []).length) + " 页。" + PR.esc(tr.note || "") + "</p>" +
      "<h3>保存</h3><p>" + status + "</p>" + (PR.store.pending ? "<p>还有 " + PR.store.pending + " 条修改在等待写入。</p>" : "") +
      '<div class="row">' + (pdf ? '<a class="btn sm line" href="' + pdf + '" target="_blank" rel="noopener">打开原 PDF</a>' : "") +
      '<button class="btn sm line" data-x="pdf">导出中文 PDF…</button>' +
      '<button class="btn sm line" data-x="md">导出笔记…</button>' +
      '<button class="btn sm line" data-x="papermd">导出整篇译文 MD</button>' + (PR.store.mode === "static" && !S.demo ? '<button class="btn sm line" data-x="ops">导出我的修改</button>' : "") + "</div>" +
      "<h3>怎么用</h3><p>点一下段落，上方出现操作条：笔记、提问、问 AI、原文、改译文、原页。右键段落是完整菜单。选中文字可以用四种颜色划线、写笔记、提问；打开问 AI 时，选中的文字可以直接拖进输入框，一次引用多段。双击一段直接改译文。</p>" +
      "<h3>快捷键</h3>" + (PR.keysOn
        ? '<div class="keyrows">' + PR.KEY_ACTIONS.filter(([id, , , , need]) => PR.keymap[id] && (!need || PR.feature(need))).map(([id, label]) => "<kbd>" + PR.esc(PR.keyOf(id)) + "</kbd><span>" + label + "</span>").join("") +
          "<kbd>1</kbd><span>选中文字后按 1–4：四色划线</span><kbd>Esc</kbd><span>关闭面板、取消选中</span></div>"
        : "<p>快捷键已关闭。</p>") +
      '<button class="btn sm line" data-x="keys">设置快捷键和功能</button></div>';
  }
  PR.$("#drawer").addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); PR.toggleDrawer(false); PR.jumpTo("b-" + go.dataset.go); return; }
    const og = e.target.closest("[data-go-orig]");
    if (og) { e.preventDefault(); PR.toggleDrawer(false); PR.jumpTo("orig-" + og.dataset.goOrig); return; }
    const t = e.target.closest("[data-term]");
    if (t) {
      let from, to;
      if (t.dataset.term === "free") { from = PR.$("#tFrom").value.trim(); to = PR.$("#tTo").value.trim(); }
      else { const g = S.paper.glossary[+t.dataset.term]; from = g.zh; to = PR.$('.term-in[data-i="' + t.dataset.term + '"]').value.trim(); }
      const n = PR.replaceTerm(from, to, true);
      if (!n) return PR.toast("正文里没找到“" + PR.esc(from) + "”");
      PR.confirm({ title: "替换 " + n + " 处？", body: "把正文里的“" + from + "”换成“" + to + "”。", ok: "替换", at: t })
        .then((ok) => { if (ok) { PR.replaceTerm(from, to); PR.toast("已替换 " + n + " 处"); } });
      return;
    }
    const x = e.target.closest("[data-x]");
    if (x) x.dataset.x === "keys" ? PR.openSettings("keys") : x.dataset.x === "pdf" ? PR.openPdfExport() : x.dataset.x === "md" ? PR.openExport() : x.dataset.x === "papermd" ? PR.downloadFullMd() : PR.download(x.dataset.x);
  });

  PR.download = function (kind) {
    const stem = ((S.paper.meta || {}).short_zh || (S.paper.meta || {}).title_zh || "论文").replace(/[\\/:*?"<>|]/g, "");
    const text = kind === "ops" ? JSON.stringify(PR.exportOps(), null, 1) : PR.notesMarkdown();
    const a = PR.el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" })), download: stem + (kind === "ops" ? "-我的修改.json" : "-笔记.md") });
    document.body.appendChild(a); a.click(); a.remove();
  };

  /* ---------- 悬浮卡 ---------- */
  let popHideT = null, popSticky = false;
  PR.popover = function (anchor, html, opts) {
    if (!html) return;
    clearTimeout(popHideT);
    const pop = PR.$("#popover");
    pop.onclick = null;
    popSticky = !!(opts && opts.sticky);
    pop.classList.toggle("wide", !!(opts && opts.wide));
    pop.innerHTML = html;
    pop.classList.add("open");
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const x = Math.min(innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2));
    let y = r.bottom + 8;
    if (y + h > innerHeight - 10) y = r.top - h - 8;
    pop.style.left = x + "px"; pop.style.top = Math.max(58, y) + "px";
  };
  PR.hidePopover = () => { clearTimeout(popHideT); PR.$("#popover").classList.remove("open"); };
  PR.hidePopoverSoon = () => { if (popSticky) return; clearTimeout(popHideT); popHideT = setTimeout(PR.hidePopover, 220); };
  PR.$("#popover").addEventListener("mouseenter", () => clearTimeout(popHideT));
  PR.$("#popover").addEventListener("mouseleave", () => PR.hidePopoverSoon());
})(window.PR);
