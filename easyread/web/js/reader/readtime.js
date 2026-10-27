/* 阅读时长：页面在前台、两分钟内有滚动 / 点击 / 按键（或者开着自动滚动、朗读）才算在读。
   攒够 30 秒报一次给本地服务，按本地日期累计进 item.json 的 read；关页面、切走时把零头也报上。
   文献库的“阅读统计”和详情里的“读了多久”都用这份数据。离线单文件版不记。 */
(function (PR) {
  "use strict";
  const S = PR.state;
  const IDLE = 120000, EVERY = 30000;
  let lastActive = Date.now(), lastTick = Date.now(), acc = 0, sent = 0;

  ["scroll", "keydown", "pointerdown", "pointermove", "wheel", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));

  const on = () => PR.store.mode === "server" && !S.pdf && !!PR.token;
  const day = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  function flush(leaving) {
    const sec = Math.floor(acc / 1000);
    if (sec < (leaving ? 1 : 5) || !on()) return;
    acc -= sec * 1000;
    fetch("/api/p/" + PR.pid + "/readtime", {
      method: "POST", keepalive: !!leaving, headers: { "Content-Type": "application/json", "X-Token": PR.token },
      body: JSON.stringify({ sec, day: day() }),
    }).then((r) => {
      if (r.ok) return void (sent += sec);
      acc += sec * 1000;
      if (r.status === 403 && PR.reloadToken) PR.reloadToken();
    }).catch(() => { acc += sec * 1000; });
  }
  setInterval(() => {
    const now = Date.now(), dt = Math.min(now - lastTick, 5000);
    lastTick = now;
    const busy = document.body.classList.contains("autoscroll") || (PR.ttsActive && PR.ttsActive());
    if (!document.hidden && (busy || now - lastActive < IDLE)) acc += dt;
    if (acc >= EVERY) flush();
  }, 1000);
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });

  /* 这篇一共读了多久（含还没报上去的） */
  PR.readSeconds = () => (((S.item || {}).read || {}).total || 0) + sent + Math.floor(acc / 1000);
  PR.fmtDuration = function (sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec ? "不到 1 分钟" : "0 分钟";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? h + " 小时" + (m ? " " + m + " 分" : "") : m + " 分钟";
  };
})(window.PR);
