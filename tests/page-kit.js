// 公共仪器库：L0（page-l0.js）与 L1（page-l1.js）共用的探针、SCREEN 比对、泄漏检查、用例引擎。
// 本文件属测试仪器，被测应用代码（js/*、index.html、css/*）零改动。
// 约定：截图回注钩子由 lab 驱动注入 —— window.__l1Shot 或 window.__l0Shot（page.screenshot → PNG base64）。

export const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 容差常量（像素判定阈值） ----------
export const TH_PRESENT = 40;   // 舞者存在：3×3 均色与基线色距 >
export const TH_COLOR = 70;     // 采样点与期望填充色色距 <
export const TH_HL = 45;        // 选中高亮 #0ea5e9 检出色距 <（男蓝填充 #3b82f6 与高亮色距≈58，须低于该值才可分辨）
export const TH_HL_DELTA = 18;  // 高亮出现前后同点位色距变化 >
export const TH_BG = 25;        // 判定"回到背景"的色距 <
export const SCREEN_TOL = 2;    // SCREEN 逐像素通道容差
export const SCREEN_RATIO = 0.005; // 差异像素比 < 0.5%

// ---------- 共享上下文 ----------
export function makeCtx() {
  const fs = window.__fs;
  const store = fs.store, M = fs.M, sv = fs.stageView();
  const state = () => store.getState();
  const fmt = () => state().project.formations[state().formationIndex];
  const toClient = (x, y) => {
    const r = sv.canvas.getBoundingClientRect(), v = sv.view;
    return { x: r.left + v.ox + x * v.scale, y: r.top + v.oy + y * v.scale };
  };
  return { fs, store, M, sv, state, fmt, toClient };
}

// ---------- 像素采样 ----------
export function dprOf() { return window.devicePixelRatio || 1; }
export function mean3x3(cv, cx, cy) { // 画布上 client 坐标点的 3×3 均色（背衬像素）
  const r = cv.getBoundingClientRect(), dpr = dprOf();
  const bx = Math.round((cx - r.left) * dpr), by = Math.round((cy - r.top) * dpr);
  const w = cv.width, h = cv.height;
  let rr = 0, gg = 0, bb = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = bx + dx, y = by + dy;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
    rr += d[0]; gg += d[1]; bb += d[2]; n++;
  }
  return { r: rr / n, g: gg / n, b: bb / n };
}
export function px1(cv, cx, cy) { // 画布上 client 坐标点的单像素色（1px 线条检测用）
  const r = cv.getBoundingClientRect(), dpr = dprOf();
  const x = Math.round((cx - r.left) * dpr), y = Math.round((cy - r.top) * dpr);
  if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return null;
  const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}
export const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
export const rgb = c => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
export function hex(c) { const n = parseInt(c.slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }

// 圆环采样：angle 0..359 步长 15°，半径 [r-1, r, r+1]，返回最小色距及其点位
export function ringMinDist(cv, cx, cy, rpx, color) {
  let best = { d: Infinity, at: null };
  for (let a = 0; a < 360; a += 15) {
    for (const rr of [rpx - 1, rpx, rpx + 1]) {
      const x = cx + Math.cos(a * Math.PI / 180) * rr, y = cy + Math.sin(a * Math.PI / 180) * rr;
      const d = dist(mean3x3(cv, x, y), color);
      if (d < best.d) best = { d, at: { a, rr: Math.round(rr * 10) / 10 } };
    }
  }
  return best;
}
// 圆内采样：0.55r 处 8 方向，返回与期望色的最小色距（避开圆心文字/箭头覆盖）
export function innerMinDist(cv, cx, cy, rpx, color) {
  let best = { d: Infinity, at: null };
  for (let a = 0; a < 360; a += 45) {
    const x = cx + Math.cos(a * Math.PI / 180) * rpx * 0.55, y = cy + Math.sin(a * Math.PI / 180) * rpx * 0.55;
    const d = dist(mean3x3(cv, x, y), color);
    if (d < best.d) best = { d, at: { a } };
  }
  return best;
}
// 半径测量：8 条放射线上"最后匹配填充色"的半径取中位数（用于缩放后直径等比断言）
export function measureRadius(cv, cx, cy, rMax, color) {
  const rays = [];
  for (let a = 0; a < 360; a += 45) {
    let last = 0;
    for (let r = 2; r <= rMax; r += 0.5) {
      const p = px1(cv, cx + Math.cos(a * Math.PI / 180) * r, cy + Math.sin(a * Math.PI / 180) * r);
      if (p && dist(p, color) < 60) last = r;
    }
    rays.push(last);
  }
  rays.sort((x, y) => x - y);
  const med = rays.length % 2 ? rays[(rays.length - 1) / 2] : (rays[rays.length / 2 - 1] + rays[rays.length / 2]) / 2;
  return { median: med, rays };
}
// 区域扫采样：在候选点集上取与期望色的最小色距（小徽标上有文字/描边，固定点会被白字污染；
// 区域内"存在纯填充色像素"是更强的呈示证据）
export function minDistOver(sample, color, candidates) {
  let best = { d: Infinity, at: null, n: candidates.length };
  for (const [x, y] of candidates) {
    const d = dist(sample(x, y), color);
    if (d < best.d) best = { d, at: [Math.round(x), Math.round(y)], n: candidates.length };
  }
  return best;
}
export function gridRegion(x0, y0, x1, y1, step = 2) {
  const pts = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) pts.push([x, y]);
  return pts;
}
// 单像素边框扫描：沿矩形四边 ±band px 内扫描与目标色的最小单像素色距（1px 线条的 AA 用单像素判）
export function edgeMinDist(sample, x0, y0, x1, y1, color, band = 3, stepAlong = 4) {
  let best = { d: Infinity, at: null };
  const scan = (x, y) => { const p = sample(x, y); if (!p) return; const d = dist(p, color); if (d < best.d) best = { d, at: [Math.round(x), Math.round(y)] }; };
  const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bot = Math.max(y0, y1);
  for (let x = left + 2; x <= right - 2; x += stepAlong) {
    for (let o = -band; o <= band; o++) { scan(x, top + o); scan(x, bot + o); }
  }
  for (let y = top + 2; y <= bot - 2; y += stepAlong) {
    for (let o = -band; o <= band; o++) { scan(left + o, y); scan(right + o, y); }
  }
  return best;
}

// ---------- [SCREEN] 截图回注比对（§0.1 算法） ----------
export async function decodeShot(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const oc = new OffscreenCanvas(bmp.width, bmp.height);
  const octx = oc.getContext('2d', { willReadFrequently: true });
  octx.drawImage(bmp, 0, 0);
  return { img: octx.getImageData(0, 0, bmp.width, bmp.height), w: bmp.width, h: bmp.height };
}
function shotFn() { const f = window.__l1Shot || window.__l0Shot; if (!f) throw new Error('截图钩子未注入（window.__l1Shot/__l0Shot）'); return f; }
export async function screenCompare(inset = 2, mask = null) {
  // mask：{x0,y0,x1,y1} client 坐标矩形（如打开中的 .unit-menu DOM 浮窗）——
  // 浮窗是画布之上的 DOM，逐像素比对必须把该区域剔除，否则浮窗像素全算差异。
  const b64 = await shotFn()();
  const { img: shot, w: sw, h: sh } = await decodeShot(b64);
  const sv = window.__fs.stageView(), cv = sv.canvas;
  const r = cv.getBoundingClientRect(), dpr = dprOf();
  const lx = Math.round(r.left * dpr), ly = Math.round(r.top * dpr); // 画布在页面像素中的原点
  const m = {
    x: lx + inset, y: ly + inset,
    w: Math.round(r.width * dpr) - inset * 2, h: Math.round(r.height * dpr) - inset * 2,
  };
  const maskPx = mask ? {
    x0: Math.round(mask.x0 * dpr), y0: Math.round(mask.y0 * dpr),
    x1: Math.round(mask.x1 * dpr), y1: Math.round(mask.y1 * dpr),
  } : null;
  const inMask = (px, py) => maskPx && px >= maskPx.x0 && px <= maskPx.x1 && py >= maskPx.y0 && py <= maskPx.y1;
  // 关键：实时位图 getImageData 用画布本地坐标（背衬 store），截图用页面像素坐标
  const live = cv.getContext('2d').getImageData(inset, inset, m.w, m.h);
  const ratioAt = (dx, dy) => {
    let diff = 0; const total = m.w * m.h;
    for (let yy = 0; yy < m.h; yy++) {
      let li = yy * m.w * 4;
      let si = ((m.y + yy + dy) * sw + (m.x + dx)) * 4;
      for (let xx = 0; xx < m.w; xx++, li += 4, si += 4) {
        if (inMask(m.x + xx + dx, m.y + yy + dy)) continue;
        const dr = Math.abs(live.data[li] - shot.data[si]);
        const dg = Math.abs(live.data[li + 1] - shot.data[si + 1]);
        const db = Math.abs(live.data[li + 2] - shot.data[si + 2]);
        if (dr > SCREEN_TOL || dg > SCREEN_TOL || db > SCREEN_TOL) diff++;
      }
    }
    return diff / total;
  };
  const raw = ratioAt(0, 0);
  let best = raw, bestOff = [0, 0];
  if (raw >= SCREEN_RATIO) { // ±1px 对齐容差（消除图层像素吸附差；陈旧帧不可能靠平移对齐）
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const q = ratioAt(dx, dy);
      if (q < best) { best = q; bestOff = [dx, dy]; }
    }
  }
  return { b64, raw, best, bestOff, region: m, shotSize: { w: sw, h: sh }, dpr };
}
export function shotSample(shotImg, shotW, cx, cy) { // 截图上的 3×3 均色（client 坐标 × dpr）
  const dpr = dprOf();
  const px = Math.round(cx * dpr), py = Math.round(cy * dpr);
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = px + dx, y = py + dy;
    if (x < 0 || y < 0 || x >= shotW || y >= shotImg.height) continue;
    const i = (y * shotW + x) * 4;
    r += shotImg.data[i]; g += shotImg.data[i + 1]; b += shotImg.data[i + 2]; n++;
  }
  return { r: r / n, g: g / n, b: b / n };
}
export function shotPx(shotImg, shotW, cx, cy) { // 截图上的单像素色（client 坐标 × dpr）
  const dpr = dprOf();
  const x = Math.round(cx * dpr), y = Math.round(cy * dpr);
  if (x < 0 || y < 0 || x >= shotW || y >= shotImg.height) return null;
  const i = (y * shotW + x) * 4;
  return { r: shotImg.data[i], g: shotImg.data[i + 1], b: shotImg.data[i + 2] };
}

// ---------- 泄漏即停（§4.3） ----------
export function leakCheck() {
  const sv = window.__fs.stageView();
  const appP = sv.gesture.debugPointers();
  const st = sv.gesture.state();
  const inj = window.__input.activeCount;
  const menu = !!document.querySelector('.unit-menu');
  const probs = [];
  if (inj > 0) probs.push(`注入器活跃指针=${inj}（仪器侧）`);
  if (appP.length) probs.push(`应用残留指针=[${appP.join(',')}]（应用侧）`);
  if (st !== 'IDLE') probs.push(`手势态=${st}≠IDLE`);
  if (menu) probs.push('.unit-menu 未关闭');
  return { ok: probs.length === 0, detail: probs.join('; ') || 'state=IDLE pointers=[] menu=无 inj=0', injResidue: inj > 0, appLeak: appP.length > 0 || st !== 'IDLE' || menu };
}

// ---------- 用例引擎 ----------
// failFast=true（L1）：单条动线内首个失败断言后，后续断言作废（记录已通过部分）。
// step(name, ok, detail, layer)：layer ∈ STATE/DOM/PIXEL/SCREEN（省略视作 STATE）。
export async function runCases(cases, shots, { failFast = false } = {}) {
  const out = [];
  for (const c of cases) {
    const steps = [];
    let voided = false;
    const step = (name, ok, detail = '', layer = 'STATE') => {
      steps.push({ name, ok: !!ok, detail: String(detail), layer });
      if (failFast && !ok) { voided = true; throw { __stepFail: true, name }; }
    };
    let ownShot = false;
    const takeShot = async name => { shots[name] = await (shotFn())(); ownShot = true; return shots[name]; };
    try {
      await c.run({ step, takeShot });
    } catch (err) {
      if (err && err.__stepFail) {
        steps.push({ name: '(后续断言作废: 失败即停)', ok: true, detail: `首败于「${err.name}」，本动线后续断言按规范作废`, layer: 'META' });
      } else {
        steps.push({ name: '(异常)', ok: false, detail: (err && (err.stack || err.message)) || String(err), layer: 'META' });
      }
    }
    const leak = leakCheck();
    steps.push({ name: '(泄漏检查: 指针/状态/浮窗)', ok: leak.ok, detail: leak.detail, layer: 'STATE' });
    if (leak.injResidue) { try { window.__input.reset(); } catch {} }
    const ok = steps.every(s => s.ok) && !voided;
    if (!ok && !ownShot) { try { shots['fail-' + c.id] = await (shotFn())(); } catch {} }
    const fails = steps.filter(s => !s.ok);
    const evidence = (fails.length ? fails : steps).map(s => `${s.name}: ${s.detail}`).join(' | ');
    out.push({ id: c.id, name: c.name, ok, evidence: evidence.length > 500 ? evidence.slice(0, 500) + '…' : evidence, steps });
  }
  return out;
}
