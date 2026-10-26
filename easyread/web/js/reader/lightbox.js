/* 灯箱：点正文里的插图、原页图，全屏放大看——滚轮缩放、拖动平移、双击 100%/适应、一键下载原图。
   原页面板里的小图会换成全尺寸原页再放大，保证缩大了也清晰。 */
(function (PR) {
  "use strict";
  let lb = null, img = null, cap = null, pct = null;
  let z = 1, tx = 0, ty = 0, fit = 1;

  function ensure() {
    if (lb) return;
    lb = PR.el("div", { id: "lightbox", role: "dialog", "aria-label": "图片查看" },
      '<div class="lb-stage"></div><div class="lb-bar">' +
      '<span class="lb-cap"></span><span class="grow"></span>' +
      '<button class="btn sm line" data-lb="out" title="缩小">−</button><span class="lb-pct"></span>' +
      '<button class="btn sm line" data-lb="in" title="放大">＋</button>' +
      '<button class="btn sm line" data-lb="fit">适应</button>' +
      '<button class="btn sm line" data-lb="full">100%</button>' +
      '<button class="btn sm line" data-lb="dl">' + PR.icon("download", "sm") + "下载原图</button>" +
      '<button class="btn sm" data-lb="close">关闭</button></div>');
    document.body.appendChild(lb);
    img = PR.el("img", { alt: "" });
    lb.querySelector(".lb-stage").appendChild(img);
    cap = lb.querySelector(".lb-cap");
    pct = lb.querySelector(".lb-pct");
    let drag = null;
    lb.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoom(z * Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
    lb.querySelector(".lb-stage").addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX - tx, y: e.clientY - ty };
      lb.classList.add("dragging");
      e.currentTarget.setPointerCapture(e.pointerId);
    });
    lb.addEventListener("pointermove", (e) => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } });
    lb.addEventListener("pointerup", () => { drag = null; lb.classList.remove("dragging"); });
    img.addEventListener("dblclick", () => zoom(Math.abs(z - fit) < 0.01 ? 1 : fit));
    lb.addEventListener("click", (e) => {
      const b = e.target.closest("[data-lb]");
      if (b) {
        const act = b.dataset.lb;
        if (act === "close") return close();
        if (act === "in") return zoom(z * 1.25);
        if (act === "out") return zoom(z / 1.25);
        if (act === "fit") return zoom(fit);
        if (act === "full") return zoom(1);
        if (act === "dl") return download();
        return;
      }
      if (!e.target.closest(".lb-bar, .lb-stage img")) close();  // 点四周空白关闭
    });
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") { e.stopImmediatePropagation(); close(); }
      if (e.key === "+" || e.key === "=") zoom(z * 1.25);
      if (e.key === "-") zoom(z / 1.25);
      if (e.key === "0") zoom(fit);
    }, true);
    window.addEventListener("resize", () => { if (isOpen()) { measure(); apply(); } });
  }

  const isOpen = () => lb && lb.classList.contains("open");

  function measure() {
    // “适应”= 不滚动能看全；“100%”= 图片一个像素对应屏幕一个像素
    fit = Math.min((innerWidth - 24) / img.naturalWidth, (innerHeight - 90) / img.naturalHeight, 1);
    if (!isFinite(fit) || fit <= 0) fit = 1;
  }
  function zoom(nz, keepCenter) {
    const cx = keepCenter ? innerWidth / 2 : innerWidth / 2, cy = innerHeight / 2;
    tx = cx - (cx - tx) * (nz / z);
    ty = cy - (cy - ty) * (nz / z);
    z = Math.max(0.05, Math.min(12, nz));
    clampPan();
    apply();
  }
  function clampPan() {
    const w = img.naturalWidth * z, h = img.naturalHeight * z;
    const mx = Math.max(0, (w - innerWidth) / 2 + 40), my = Math.max(0, (h - innerHeight) / 2 + 40);
    tx = Math.max(-mx, Math.min(mx, tx));
    ty = Math.max(-my, Math.min(my, ty));
  }
  function apply() {
    img.style.transform = "translate(calc(-50% + " + tx + "px), calc(-50% + " + ty + "px)) scale(" + z + ")";
    pct.textContent = Math.round(z * 100) + "%";
  }

  function download() {
    fetch(img.src).then((r) => r.blob()).then((b) => {
      const ext = (b.type.split("/")[1] || "webp").replace("jpeg", "jpg");
      const name = (cap.textContent || "figure").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) + "." + ext;
      const a = PR.el("a", { href: URL.createObjectURL(b), download: name });
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(() => window.open(img.src, "_blank"));
  }

  function open(target) {
    ensure();
    let src = target.currentSrc || target.src || "";
    if (!src) return;
    // 原页面板显示的是 w=1000 的缩小版：灯箱里换成全尺寸原页
    if (target.closest(".pv-page") && src.includes("?")) src = src.split("?")[0];
    const blk = target.closest(".blk, .fp-fig");
    const capEl = blk && (blk.querySelector(".caption .zh") || blk.querySelector("figcaption"));
    cap.textContent = capEl ? capEl.textContent.trim().slice(0, 120) : "";
    z = 0.001; tx = ty = 0;
    img.style.transform = "translate(-50%,-50%) scale(0.001)";
    img.onload = () => { measure(); zoom(fit); };
    img.src = src;
    lb.classList.add("open");
    document.body.classList.add("lb-open");
  }
  function close() {
    if (!lb) return;
    lb.classList.remove("open");
    document.body.classList.remove("lb-open");
    img.removeAttribute("src");  // 停掉还在加载的大图
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#lightbox")) return;
    const t = e.target.closest("#paper img, .pv-page img, #figpanel .fp-img img");
    if (!t || e.target.closest("a, button, .editor-wrap") || !t.naturalWidth) return;
    if (t.naturalWidth < 60 && t.naturalHeight < 60) return;
    e.preventDefault();
    open(t);
  });
})(window.PR);
