/* 朗读译文：用浏览器自带的语音合成，从当前读到的那段开始往下念，念到哪跟到哪。
   键 V 开/关，设置里能调语速。长句拆开念，避开 Chrome 对超长段落的截断。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  let queue = [], qi = 0, on = false, curEl = null;

  const synth = () => window.speechSynthesis;

  function pickVoice() {
    const vs = synth().getVoices() || [];
    return vs.find((v) => /^zh([-_]CN)?$/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }

  /* 朗读用的文字：标题带编号，段落用译文（优先“我的修改”），列表逐条，图表读题注；公式跳过。 */
  function texts() {
    const out = [];
    for (const b of S.paper.blocks || []) {
      if (!b.id) continue;
      if (b.type === "heading" || b.type === "references") {
        const t = PR.plain(PR.textFor(b.id) || b.zh || "");
        if (t) out.push([b.id, (b.num ? b.num + "，" : "") + t]);
      } else if (b.type === "para") {
        const t = PR.plain(PR.textFor(b.id));
        if (t) out.push([b.id, t]);
      } else if (b.type === "list") {
        (b.items || []).forEach((it, i) => {
          const t = PR.plain(PR.textFor(b.id + "#" + i));
          if (t) out.push([b.id, t]);
        });
      } else if (b.type === "figure" || b.type === "table") {
        const t = PR.plain(PR.textFor(b.id + "#caption"));
        if (t) out.push([b.id, t]);
      }
    }
    return out;
  }

  function chunks(t) {  // 按句子拆成 ≤160 字的小段
    const parts = t.replace(/([。！？；.!?;])/g, "$1\u0001").split("\u0001");
    const out = [];
    let buf = "";
    for (let p of parts) {
      while (p.length > 160) { out.push(p.slice(0, 160)); p = p.slice(160); }
      if ((buf + p).length > 160) { if (buf) out.push(buf); buf = p; }
      else buf += p;
    }
    if (buf) out.push(buf);
    return out;
  }

  function highlight(id) {
    if (curEl) curEl.classList.remove("tts-on");
    curEl = document.getElementById("b-" + id);
    if (curEl) {
      curEl.classList.add("tts-on");
      const r = curEl.getBoundingClientRect();
      if (r.bottom < 80 || r.top > innerHeight - 80) PR.centerOn(curEl);
    }
  }

  function speakNext() {
    if (!on || qi >= queue.length) return stop();
    const [id, text] = queue[qi];
    highlight(id);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = Math.max(0.7, Math.min(1.6, PR.prefs.ttsRate || 1));
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = () => { if (!on) return; qi++; setTimeout(speakNext, 120); };
    u.onerror = () => { if (on) { qi++; setTimeout(speakNext, 300); } };
    synth().speak(u);
  }

  PR.ttsStart = function () {
    if (!synth()) return PR.toast("这个浏览器不支持语音朗读");
    stop(true);
    const all = texts();
    if (!all.length) return PR.toast("这篇还没有可朗读的译文");
    const cur = PR.readingBlock();
    let start = all.findIndex(([id]) => id === cur);
    if (start < 0) start = 0;  // 从公式/图片上开始时，往前找最近的文字段
    else for (let i = start - 1; i >= 0; i--) { if (all[i][0] === cur) start = i; else break; }
    queue = [];
    all.slice(start).forEach(([id, t]) => chunks(t).forEach((c) => queue.push([id, c])));
    qi = 0;
    on = true;
    document.body.classList.add("tts-on");
    speakNext();
  };
  PR.ttsStop = function (silent) {
    on = false;
    queue = [];
    if (synth()) synth().cancel();
    if (curEl) curEl.classList.remove("tts-on");
    curEl = null;
    document.body.classList.remove("tts-on");
    if (!silent) PR.toast("朗读已停止");
  };
  PR.ttsToggle = function () { on ? PR.ttsStop() : PR.ttsStart(); };
  PR.ttsActive = () => on;

  window.addEventListener("beforeunload", () => synth() && synth().cancel());
})(window.PR);
