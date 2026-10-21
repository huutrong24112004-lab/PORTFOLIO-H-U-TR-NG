/* ==========================================================
   Intro B2B · mạng lưới dữ liệu 3D (canvas 2D, tự dựng phối cảnh)
   - Quả cầu node + cạnh quay theo chuột, các "gói nội dung" chạy trên cạnh
   - Hai vành quỹ đạo, sàn lưới phối cảnh cuộn về phía người xem
   - Kết thúc bằng cú "đẩy camera" rồi lộ trang
   Không dùng thư viện ngoài.
   ========================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  if (root.getAttribute("data-b2b") !== "on") return;

  var el = document.getElementById("b2b-intro");
  if (!el) { root.removeAttribute("data-b2b"); return; }

  var cv = el.querySelector("canvas");
  var ctx = cv && cv.getContext ? cv.getContext("2d") : null;
  var skipBtn = el.querySelector(".b2b-skip");
  var pctEl = el.querySelector(".b2b-pct");
  var barEl = el.querySelector(".b2b-bar i");
  var steps = [].slice.call(el.querySelectorAll(".b2b-steps li"));

  /* ---------- ngôn ngữ ---------- */
  var langBtn = document.getElementById("lang");
  var isEN = root.lang === "en" || (langBtn && langBtn.getAttribute("data-l") === "en");
  if (isEN) {
    [].forEach.call(el.querySelectorAll("[data-en]"), function (n) {
      n.textContent = n.getAttribute("data-en");
    });
  }

  /* ---------- khóa cuộn trang trong lúc intro ---------- */
  var prevOverflow = root.style.overflow;
  root.style.overflow = "hidden";

  /* ---------- hằng số thời gian (ms) ---------- */
  var PROGRESS_MS = 3200;
  var EXIT_AT = 3450;
  var EXIT_MS = 750;
  var FAST_EXIT = 380;
  var STEP_FIRST = 1900, STEP_GAP = 420;

  /* ---------- tiện ích ---------- */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  function easeIn(x) { return x * x * x; }
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  /* ---------- khung vẽ ---------- */
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, cx = 0, cy = 0, R = 0, D = 0;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    if (cv) {
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      if (ctx) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    var portrait = W < 820 || H > W * 1.05;
    if (portrait) { cx = W * 0.5; cy = H * 0.31; R = Math.min(W * 0.34, H * 0.2); }
    else { cx = W * 0.68; cy = H * 0.5; R = Math.min(W * 0.2, H * 0.34); }
    D = R * 4.2;
  }
  resize();
  window.addEventListener("resize", resize);

  /* ---------- con trỏ → góc nhìn ---------- */
  var mx = 0, my = 0, tx = 0, ty = 0;
  function onMove(e) { tx = (e.clientX / W - 0.5) * 2; ty = (e.clientY / H - 0.5) * 2; }
  window.addEventListener("pointermove", onMove, { passive: true });

  /* ---------- dữ liệu cảnh ---------- */
  var N = 200, GA = Math.PI * (3 - Math.sqrt(5));
  var nodes = [], edges = [], i, j;
  for (i = 0; i < N; i++) {
    var ny = 1 - 2 * (i + 0.5) / N, nr = Math.sqrt(1 - ny * ny), th = i * GA;
    var sx = rnd() * 2 - 1, sy = rnd() * 2 - 1, sz = rnd() * 2 - 1;
    var sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1, sc = 1.5 + rnd() * 1.2;
    nodes.push({
      x: Math.cos(th) * nr, y: ny, z: Math.sin(th) * nr,
      sx: sx / sl * sc, sy: sy / sl * sc, sz: sz / sl * sc,
      d: rnd() * 0.42,
      hub: i % 23 === 5
    });
  }
  var TH2 = 0.36 * 0.36;
  for (i = 0; i < N; i++) {
    for (j = i + 1; j < N; j++) {
      var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z;
      if (dx * dx + dy * dy + dz * dz < TH2) edges.push(i, j);
    }
  }
  var EC = edges.length / 2;
  var PX = new Float32Array(N), PY = new Float32Array(N), PZ = new Float32Array(N),
      PS = new Float32Array(N), PA = new Float32Array(N);
  var LABELS = [
    { i: 5, t: "SEO" },
    { i: 51, t: "CONTENT" },
    { i: 97, t: "B2B" }
  ];
  var pulses = [], lastSpawn = 0;

  /* ---------- phép quay + chiếu phối cảnh ---------- */
  var rx = 0, ry = 0, rz = 0, qx = 0, qy = 0, qs = 1;
  var cyaw = 1, syaw = 0, cpit = 1, spit = 0, zoomV = 1;
  function rot(x, y, z) {
    var x1 = x * cyaw + z * syaw, z1 = -x * syaw + z * cyaw;
    rx = x1; ry = y * cpit - z1 * spit; rz = y * spit + z1 * cpit;
  }
  function proj(x, y, z) {
    var s = D / (D - z);
    var X = cx + x * s, Y = cy + y * s;
    qx = W * 0.5 + (X - W * 0.5) * zoomV;
    qy = H * 0.5 + (Y - H * 0.5) * zoomV;
    qs = s * zoomV;
  }

  /* ---------- vẽ ---------- */
  function drawFloor(t, asm) {
    var y0 = R * 1.5, k, z, a, b;
    var g = ctx.createLinearGradient(0, cy, 0, H);
    g.addColorStop(0, "rgba(60,140,255,0)");
    g.addColorStop(1, "rgba(60,140,255," + (0.34 * asm).toFixed(3) + ")");
    ctx.strokeStyle = g; ctx.lineWidth = 1;
    ctx.beginPath();
    for (k = -9; k <= 9; k++) {
      proj(k * R * 0.6, y0, -R * 6); a = qx; b = qy;
      proj(k * R * 0.6, y0, R * 1.6); ctx.moveTo(a, b); ctx.lineTo(qx, qy);
    }
    var step = R * 0.7, off = ((t * 0.45) % 1) * step;
    for (z = -R * 6 + off; z < R * 1.6; z += step) {
      proj(-R * 6, y0, z); a = qx; b = qy;
      proj(R * 6, y0, z); ctx.moveTo(a, b); ctx.lineTo(qx, qy);
    }
    ctx.stroke();

    /* quầng sáng dưới quả cầu */
    proj(0, y0, 0);
    ctx.save();
    ctx.translate(qx, qy); ctx.scale(1, 0.22);
    var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.7 * qs);
    rg.addColorStop(0, "rgba(0,120,255," + (0.4 * asm).toFixed(3) + ")");
    rg.addColorStop(1, "rgba(0,120,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(-R * 2 * qs, -R * 2 * qs, R * 4 * qs, R * 4 * qs);
    ctx.restore();
  }

  function drawRing(t, rr, tz, tx_, speed, phase, alpha) {
    if (alpha <= 0) return;
    var seg = 72, ctx_ = Math.cos(tx_), stx = Math.sin(tx_), ctz = Math.cos(tz), stz = Math.sin(tz);
    var k, a, x, z, y1, z1, x2, y2, px = 0, py = 0, d, first = true;
    ctx.lineWidth = 1;
    for (k = 0; k <= seg; k++) {
      a = k / seg * TAU; x = Math.cos(a) * rr * R; z = Math.sin(a) * rr * R;
      y1 = -z * stx; z1 = z * ctx_;
      x2 = x * ctz - y1 * stz; y2 = x * stz + y1 * ctz;
      rot(x2, y2, z1); proj(rx, ry, rz);
      if (!first) {
        d = clamp((rz / (rr * R) + 1) / 2, 0, 1);
        ctx.strokeStyle = "rgba(110,190,255," + (alpha * (0.1 + 0.55 * d)).toFixed(3) + ")";
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
      }
      px = qx; py = qy; first = false;
    }
    /* vệ tinh trên quỹ đạo */
    a = t * speed + phase; x = Math.cos(a) * rr * R; z = Math.sin(a) * rr * R;
    y1 = -z * stx; z1 = z * ctx_;
    x2 = x * ctz - y1 * stz; y2 = x * stz + y1 * ctz;
    rot(x2, y2, z1); proj(rx, ry, rz);
    d = clamp((rz / (rr * R) + 1) / 2, 0, 1);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(80,190,255," + (alpha * 0.22 * (0.4 + d)).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(qx, qy, 9 * qs, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(210,240,255," + (alpha * (0.5 + 0.5 * d)).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(qx, qy, 2.6 * qs, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  function draw(t, ex) {
    zoomV = 1 + easeIn(ex) * 1.7;
    ctx.clearRect(0, 0, W, H);

    mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
    var asm = clamp(t / 1.7, 0, 1);
    var yaw = 0.7 + t * 0.26 + mx * 0.55, pit = -0.36 + my * 0.22;
    cyaw = Math.cos(yaw); syaw = Math.sin(yaw); cpit = Math.cos(pit); spit = Math.sin(pit);

    /* quầng sáng nền */
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.6);
    bg.addColorStop(0, "rgba(0,102,207,.30)");
    bg.addColorStop(1, "rgba(0,102,207,0)");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    drawFloor(t, clamp(t / 1.2, 0, 1));

    /* node */
    var n, p, e, k;
    for (k = 0; k < N; k++) {
      n = nodes[k];
      p = clamp((asm - n.d) / (1 - 0.42), 0, 1); e = easeOut(p);
      rot((n.sx + (n.x - n.sx) * e) * R, (n.sy + (n.y - n.sy) * e) * R, (n.sz + (n.z - n.sz) * e) * R);
      proj(rx, ry, rz);
      PX[k] = qx; PY[k] = qy; PZ[k] = rz / R; PS[k] = qs; PA[k] = 0.15 + 0.85 * p;
    }

    /* cạnh (gộp theo 4 mức độ sâu) */
    var ef = clamp((asm - 0.55) / 0.45, 0, 1), bkt, d, a, b;
    if (ef > 0) {
      ctx.lineWidth = 1;
      for (bkt = 0; bkt < 4; bkt++) {
        ctx.beginPath();
        for (k = 0; k < EC; k++) {
          a = edges[k * 2]; b = edges[k * 2 + 1];
          d = clamp(((PZ[a] + PZ[b]) * 0.5 + 1) / 2, 0, 0.999);
          if ((d * 4 | 0) === bkt) { ctx.moveTo(PX[a], PY[a]); ctx.lineTo(PX[b], PY[b]); }
        }
        ctx.strokeStyle = "rgba(88,170,255," + ((0.05 + 0.12 * bkt) * ef).toFixed(3) + ")";
        ctx.stroke();
      }
    }

    /* gói nội dung chạy trên cạnh */
    if (asm > 0.85 && t - lastSpawn > 0.11 && pulses.length < 14 && EC) {
      var ei = (Math.random() * EC) | 0, sw = Math.random() < 0.5;
      pulses.push({ a: edges[ei * 2 + (sw ? 1 : 0)], b: edges[ei * 2 + (sw ? 0 : 1)], s: t, d: 0.7 + Math.random() * 0.9 });
      lastSpawn = t;
    }
    ctx.globalCompositeOperation = "lighter";
    for (k = pulses.length - 1; k >= 0; k--) {
      var pu = pulses[k], u = (t - pu.s) / pu.d;
      if (u >= 1) { pulses.splice(k, 1); continue; }
      var u2 = Math.max(0, u - 0.24), hx = PX[pu.a] + (PX[pu.b] - PX[pu.a]) * u, hy = PY[pu.a] + (PY[pu.b] - PY[pu.a]) * u;
      var tx2 = PX[pu.a] + (PX[pu.b] - PX[pu.a]) * u2, ty2 = PY[pu.a] + (PY[pu.b] - PY[pu.a]) * u2;
      var dn = clamp(((PZ[pu.a] + PZ[pu.b]) * 0.5 + 1) / 2, 0, 1), al = (0.3 + 0.7 * dn) * Math.sin(u * Math.PI);
      ctx.strokeStyle = "rgba(120,215,255," + (al * 0.85).toFixed(3) + ")"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(tx2, ty2); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = "rgba(90,200,255," + (al * 0.22).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(hx, hy, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(225,247,255," + al.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(hx, hy, 2.1, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    /* chấm node */
    var pulse = 0.5 + 0.5 * Math.sin(t * 3.2), rad, al2;
    for (k = 0; k < N; k++) {
      d = clamp((PZ[k] + 1) / 2, 0, 1); n = nodes[k];
      rad = Math.max(0.2, (0.8 + 1.9 * d) * PS[k] * (n.hub ? 1.8 : 1));
      al2 = (0.18 + 0.82 * d) * PA[k];
      ctx.fillStyle = (n.hub ? "rgba(120,215,255," : "rgba(175,218,255,") + al2.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(PX[k], PY[k], rad, 0, TAU); ctx.fill();
      if (n.hub && d > 0.4 && asm > 0.9) {
        ctx.strokeStyle = "rgba(80,200,255," + (0.5 * (1 - pulse) * d).toFixed(3) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(PX[k], PY[k], rad + 3 + pulse * 7, 0, TAU); ctx.stroke();
      }
    }

    /* vành quỹ đạo */
    var ringIn = clamp((t - 1.1) / 0.9, 0, 1);
    drawRing(t, 1.42, 0.42 + t * 0.04, 0.2, 0.55, 0.0, ringIn * 0.9);
    drawRing(t, 1.78, -0.55 - t * 0.03, -0.35, -0.38, 2.1, ringIn * 0.6);

    /* nhãn gắn vào các hub */
    var labelIn = clamp((t - 1.7) / 0.6, 0, 1);
    if (labelIn > 0) {
      ctx.font = "600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
      ctx.textBaseline = "middle";
      try { ctx.letterSpacing = "1.5px"; } catch (err) { /* trình duyệt cũ */ }
      for (k = 0; k < LABELS.length; k++) {
        var li = LABELS[k].i, la = clamp(((PZ[li] + 1) / 2 - 0.62) / 0.25, 0, 1) * labelIn;
        if (la <= 0) continue;
        var dir = PX[li] >= cx ? 1 : -1, lx = PX[li], ly = PY[li];
        ctx.strokeStyle = "rgba(130,205,255," + (la * 0.8).toFixed(3) + ")"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + dir * 24, ly - 22); ctx.lineTo(lx + dir * 62, ly - 22); ctx.stroke();
        ctx.fillStyle = "rgba(225,240,255," + la.toFixed(3) + ")";
        ctx.textAlign = dir > 0 ? "left" : "right";
        ctx.fillText(LABELS[k].t, lx + dir * 70, ly - 22);
      }
      try { ctx.letterSpacing = "0px"; } catch (err2) { /* bỏ qua */ }
    }
  }

  /* ---------- vòng lặp + kết thúc ---------- */
  var t0 = 0, raf = 0, done = false, leaving = false, exitStart = 0, exitMs = EXIT_MS;

  function startExit(now, fast) {
    if (leaving) return;
    leaving = true; exitStart = now; exitMs = fast ? FAST_EXIT : EXIT_MS;
    el.classList.add("leaving"); if (fast) el.classList.add("fast");
    if (pctEl) pctEl.textContent = "100%";
    if (barEl) barEl.style.transform = "scaleX(1)";
  }

  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("keydown", onKey);
    root.removeAttribute("data-b2b");
    root.classList.remove("intro-on");
    root.style.overflow = prevOverflow;
    if (el.parentNode) el.parentNode.removeChild(el);
    try { window.dispatchEvent(new Event("b2b-intro-end")); } catch (e) { /* bỏ qua */ }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!t0) t0 = now;
    var ms = now - t0, t = ms / 1000, ex = 0, k;

    if (!leaving) {
      var prog = clamp(ms / PROGRESS_MS, 0, 1);
      if (pctEl) pctEl.textContent = Math.round(prog * 100) + "%";
      if (barEl) barEl.style.transform = "scaleX(" + prog.toFixed(3) + ")";
      for (k = 0; k < steps.length; k++) {
        if (ms > STEP_FIRST + k * STEP_GAP) steps[k].classList.add("on");
      }
      if (ms >= EXIT_AT) startExit(now, false);
    }
    if (leaving) {
      ex = clamp((now - exitStart) / exitMs, 0, 1);
      if (ex >= 1) { finish(); return; }
    }
    if (ctx) draw(t, ex);
  }

  function skip() { startExit(performance.now(), true); }
  function onKey(e) { if (e.key === "Escape" || e.key === "Enter") skip(); }

  if (skipBtn) skipBtn.addEventListener("click", function (e) { e.stopPropagation(); skip(); });
  el.addEventListener("click", skip);
  document.addEventListener("keydown", onKey);

  el.classList.add("play");
  if (skipBtn) { try { skipBtn.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ } }
  raf = requestAnimationFrame(frame);
})();
