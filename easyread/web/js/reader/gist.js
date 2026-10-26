/* 段落主旨（gist.json）：每段一句话、它在论证里的角色、和上一段怎么接。
   - 宽屏时排在正文左边的留白里（右边是批注，互不挤），一条条往下错开不重叠；左边放不下就成段首一行小字。
   - “只看主旨”：正文收成一行行主旨，按章节扫一遍论证骨架；点一行展开那段，再点收起。
   - 双击主旨可以改（存成 by=me，重新生成不覆盖）；段落“⋯”菜单里可以让模型重写这一段。
   - 生成任务（整篇 / 一段 / 只重新提炼论点）在服务端单独跑，这里轮询进度，发 gist-job 事件给脉络面板。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const body = document.body;

  PR.GIST_ROLES = ["概述", "背景", "问题", "思路", "方法", "设定", "结果", "对比", "解释", "局限", "结论"];
  const ROLE_CLS = { 概述: "sum", 背景: "bg", 问题: "prob", 思路: "idea", 方法: "meth", 设定: "set", 结果: "res", 对比: "cmp", 解释: "exp", 局限: "lim", 结论: "con" };
  PR.roleCls = (role) => "r-" + (ROLE_CLS[role] || "none");

  PR.gists = () => (S.gist && S.gist.blocks) || {};
  PR.hasGists = () => Object.keys(PR.gists()).length > 0;
  const on = () => PR.feature("gist") && (PR.prefs.gist !== false || body.classList.contains("gist-skim"));

  /* 和服务端 gist.outline 一样取这段的文字：读者改过的译文优先，列表各项连起来，去掉首尾空白 */
  PR.gistSource = function (b) {
    if (!b) return "";
    if (b.type === "list") return (b.items || []).map((_, i) => PR.textFor(b.id + "#" + i)).join("\n").trim();
    return (PR.textFor(b.id) || "").trim();
  };
  PR.gistStale = function (id) {
    const e = PR.gists()[id];
    return !!(e && e.h && e.h !== PR.hashText(PR.gistSource(PR.blockById[id])));
  };

  function gistHtml(id, e) {
    const link = e.link && e.link !== "开启" ? '<span class="g-link">' + PR.esc(e.link) + "</span>" : "";
    const why = e.why ? e.why : e.by === "me" ? "我改过的主旨" : "";
    return '<div class="gist' + (e.by === "me" ? " mine" : "") + '" data-gid="' + PR.esc(id) + '"' + (why ? ' title="' + PR.esc(why) + '（双击修改）"' : ' title="双击修改"') + ">" +
      '<span class="g-meta">' + (e.role ? '<span class="g-role ' + PR.roleCls(e.role) + '">' + PR.esc(e.role) + "</span>" : "") + link + "</span>" +
      '<span class="g-text">' + PR.esc(e.gist) + "</span>" +
      (PR.gistStale(id) ? '<span class="g-stale" title="这段译文后来改过，主旨可能过时；在“脉络”面板里点“补全”会重写">可能过时</span>' : "") + "</div>";
  }

  function clear(scope) {
    PR.$$(".gist, .gist-sec, .gist-story", scope || PR.$("#paper")).forEach((x) => x.remove());
    PR.$$(".has-gist", scope || PR.$("#paper")).forEach((x) => x.classList.remove("has-gist"));
  }

  function addTo(id) {
    const e = PR.gists()[id];
    const el = document.getElementById("b-" + id);
    if (!e || !el || el.querySelector(":scope > .gist")) return;
    el.insertAdjacentHTML("afterbegin", gistHtml(id, e));
    el.classList.add("has-gist");
  }

  PR.renderGists = function () {
    if (S.pdf) return;
    clear();
    body.classList.toggle("has-gists", PR.hasGists());
    if (!on() || !PR.hasGists()) { body.classList.remove("gist-on", "gist-side"); return; }
    body.classList.add("gist-on");
    Object.keys(PR.gists()).forEach(addTo);
    // 只看主旨时，标题下面带上“这一节在做什么”，最前面是全文故事线
    const secs = (S.gist && S.gist.sections) || {};
    for (const [hid, s] of Object.entries(secs)) {
      const el = document.getElementById("b-" + hid);
      if (el && s.gist) el.insertAdjacentHTML("beforeend", '<div class="gist-sec">' + PR.esc(s.gist) + "</div>");
    }
    const head = PR.$("#paper .paper-head");
    if (head && S.gist.story) head.insertAdjacentHTML("beforeend", '<div class="gist-story"><b>故事线</b>' + PR.esc(S.gist.story) + "</div>");
    layout();
  };

  /* 左侧留白够宽（≥150px）就排在左边，按段落位置往下错开、不重叠 */
  function layout() {
    const paper = PR.$("#paper");
    const list = PR.$$("#paper > .blk > .gist");
    if (!list.length) return;
    const skim = body.classList.contains("gist-skim");
    const avail = paper.getBoundingClientRect().left - 28;
    const side = !skim && avail >= 150;
    body.classList.toggle("gist-side", side);
    list.forEach((g) => { g.style.top = ""; });
    if (!side) return;
    paper.style.setProperty("--gist-w", Math.min(232, avail - 6) + "px");
    const tops = list.map((g) => g.getBoundingClientRect().top);
    const hs = list.map((g) => g.offsetHeight);
    let bottom = -Infinity;
    list.forEach((g, i) => {
      const want = Math.max(tops[i], bottom + 8);
      if (want - tops[i] > 0.5) g.style.top = Math.round(want - tops[i]) + "px";
      bottom = want + hs[i];
    });
  }
  PR.layoutGists = layout;

  /* ---------- 只看主旨 ---------- */
  let pill = null;
  PR.skimOn = () => body.classList.contains("gist-skim");
  PR.toggleSkim = function (force) {
    const want = force != null ? force : !PR.skimOn();
    if (want && !PR.hasGists()) { PR.toast("还没有段落主旨：打开右上角“脉络”生成"); return; }
    // 记住正在读的段：切换后它（或它前面最近一条主旨）还在屏幕同一位置
    const anchor = nearestGisted(PR.readingBlock && PR.readingBlock());
    const node = anchor && document.getElementById("b-" + anchor);
    const before = node ? node.getBoundingClientRect().top : 0;
    body.classList.toggle("gist-skim", want);
    PR.$$("#paper .blk.open").forEach((x) => x.classList.remove("open"));
    PR.renderGists();
    if (want) showPill(); else if (pill) { pill.remove(); pill = null; }
    if (node) window.scrollBy(0, node.getBoundingClientRect().top - before);
    PR.$$('[data-mp="skim"]').forEach((b) => b.classList.toggle("on", want));
    if (!want) { PR.fitWide(); PR.renderMargin(); }
    PR.emit("skim", want);
  };
  function nearestGisted(id) {
    const blocks = S.paper.blocks || [];
    let i = PR.order[id];
    if (i == null) return id;
    for (; i >= 0; i--) { const b = blocks[i]; if (PR.gists()[b.id] || b.type === "heading") return b.id; }
    return id;
  }
  PR.nearestGisted = nearestGisted;
  function showPill() {
    if (pill) return;
    const n = Object.keys(PR.gists()).length;
    pill = PR.el("div", { id: "skimbar" }, '<span>只看主旨 · ' + n + ' 段 · 点一行展开</span><button class="btn sm" data-s="all">全部展开</button><button class="btn sm" data-s="exit">回到正文' + (PR.keyOf("skim") ? "（" + PR.keyOf("skim") + "）" : "") + "</button>");
    pill.addEventListener("click", (e) => {
      const b = e.target.closest("[data-s]");
      if (!b) return;
      if (b.dataset.s === "exit") PR.toggleSkim(false);
      if (b.dataset.s === "all") {
        const all = PR.$$("#paper .has-gist");
        const open = all.some((x) => !x.classList.contains("open"));
        all.forEach((x) => x.classList.toggle("open", open));
        b.textContent = open ? "全部收起" : "全部展开";
      }
    });
    document.body.appendChild(pill);
  }
  /* 只看主旨时：点主旨行展开 / 收起那段（不触发段落操作条） */
  PR.$("#paper").addEventListener("click", (e) => {
    if (!PR.skimOn()) return;
    const g = e.target.closest(".gist");
    const blk = e.target.closest("#paper > .has-gist");
    if (!blk || (!g && blk.classList.contains("open"))) return;
    if (e.target.closest("input, select, button")) return;
    e.stopPropagation();
    blk.classList.toggle("open");
  });

  /* ---------- 改主旨 ---------- */
  PR.$("#paper").addEventListener("dblclick", (e) => {
    const g = e.target.closest(".gist");
    if (!g) return;
    e.stopPropagation();
    getSelection().removeAllRanges();
    if (PR.store.mode !== "server") return PR.toast("离线版不能改主旨");
    editGist(g);
  }, true);
  function editGist(g) {
    const id = g.dataset.gid, e = PR.gists()[id];
    if (!e || g.classList.contains("editing")) return;
    g.classList.add("editing");
    g.style.top = g.style.top;  // 保持位置
    g.innerHTML = '<select class="input">' + PR.GIST_ROLES.map((r) => "<option" + (r === e.role ? " selected" : "") + ">" + r + "</option>").join("") + "</select>" +
      '<input class="input" maxlength="60" value="' + PR.esc(e.gist) + '">' +
      '<span class="g-acts"><button class="btn sm" data-g="save">保存</button><button class="btn sm" data-g="cancel">取消</button>' +
      (e.by === "me" ? '<button class="btn sm" data-g="revert" title="换回 AI 写的版本">恢复 AI 版</button>' : "") + "</span>";
    const inp = g.querySelector("input"), sel = g.querySelector("select");
    inp.focus(); inp.select();
    const done = async (act) => {
      if (act === "cancel") { g.outerHTML = gistHtml(id, e); layout(); return; }
      try {
        const r = await PR.api("/api/p/" + PR.pid + "/gist-edit", { method: "POST", body: act === "revert" ? { block: id, revert: true } : { block: id, gist: inp.value, role: sel.value } });
        S.gist.blocks = S.gist.blocks || {};
        if (r.entry && r.entry.gist) S.gist.blocks[id] = r.entry; else delete S.gist.blocks[id];
        S.versions.gist = (r.versions || {}).gist || S.versions.gist;
        PR.renderGists(); PR.emit("gist-changed");
        PR.toast(act === "revert" ? "已换回 AI 写的主旨" : "主旨已保存");
      } catch (err) { PR.toast("没保存上：" + PR.esc(err.message)); }
    };
    g.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); done("save"); }
      if (ev.key === "Escape") { ev.preventDefault(); done("cancel"); }
    });
    g.addEventListener("click", (ev) => { ev.stopPropagation(); const b = ev.target.closest("[data-g]"); if (b) done(b.dataset.g); });
  }

  /* ---------- 生成任务 ---------- */
  PR.gistJob = null;
  let pollT = null;
  PR.gistRun = async function (mode, block) {
    if (!PR.canAsk()) return PR.toast("离线版或还没设置模型，不能生成主旨");
    try {
      const job = await PR.api("/api/p/" + PR.pid + "/gist", { method: "POST", body: { mode: mode || "missing", block } });
      track(job);
    } catch (e) { PR.toast("没开始：" + PR.esc(e.message)); }
  };
  PR.gistStop = () => PR.api("/api/p/" + PR.pid + "/gist", { method: "POST", body: { cancel: true } }).catch(() => {});
  function track(job) {
    PR.gistJob = job;
    PR.emit("gist-job", job);
    clearInterval(pollT);
    pollT = setInterval(async () => {
      let list;
      try { list = (await PR.api("/api/jobs?pid=" + encodeURIComponent(PR.pid))).jobs; } catch (e) { return; }
      const j = list.find((x) => x.id === job.id) || job;
      const finished = !list.find((x) => x.id === job.id) || ["done", "error"].includes(j.state);
      PR.gistJob = finished ? null : j;
      if (!finished) { PR.emit("gist-job", j); PR.poll(); return; }  // 边写边显示
      clearInterval(pollT);
      await PR.poll();
      PR.emit("gist-job", null);
      PR.toast(j.state === "error" ? "主旨没生成完：" + PR.esc(j.message) : (j.mode === "block" ? "这段的主旨已重写" : "主旨与脉络：" + PR.esc(j.message)), null, 6000);
    }, 1500);
  }
  /* 打开页面时，如果这篇正在生成（比如翻译完自动开始的），接上进度 */
  async function resume() {
    if (PR.store.mode !== "server") return;
    try {
      const j = (await PR.api("/api/jobs?pid=" + encodeURIComponent(PR.pid))).jobs.find((x) => x.kind === "gist" && ["queued", "running"].includes(x.state));
      if (j) track(j);
    } catch (e) { /* 服务没开 */ }
  }

  /* 段落菜单里的“重写这段主旨” */
  PR.gistAction = function (id) {
    const b = PR.blockById[id];
    if (!b || !["para", "list"].includes(b.type) || !PR.feature("gist") || !PR.canAsk() || PR.gistSource(b).length < 24) return null;
    return { k: "gist", label: PR.gists()[id] ? "让模型重写这段主旨" : "让模型写这段主旨", icon: "redo", menuOnly: true, fn: () => PR.gistRun("block", id) };
  };

  PR.on("rendered", () => { PR.renderGists(); });
  PR.on("block-rendered", (id) => {  // 改译文后这一块重排了：主旨补回去，顺便看看是不是过时了
    const el = document.getElementById("b-" + id);
    if (!el || !on()) return;
    addTo(id); layout();
  });
  PR.on("remote", (changed) => { if (changed.includes("gist")) { PR.renderGists(); PR.emit("gist-changed"); } });
  PR.on("side-resized", () => layout());
  PR.on("side-layout", () => layout());
  window.addEventListener("resize", PR.debounce(layout, 150));
  if (document.fonts) document.fonts.ready.then(layout);
  new ResizeObserver(PR.debounce(layout, 120)).observe(PR.$("#paper"));
  setTimeout(resume, 1200);
})(window.PR);
