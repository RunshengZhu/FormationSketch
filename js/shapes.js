// 队形生成器与整体位置变换 —— 纯逻辑，无 DOM 依赖
import { faceAudience, uid } from './model.js';

// build-62-formations2 F1：+13 种常用预设（grid/triangle/halfcircle/parallelogram/chevron/star/
// xpattern/center-surround/doublecircle/diagonal2/staggered/sline/heart）。旧 8 种 value 与几何
// 逐一不变（兼容既有测试与用户习惯）；新种全部观众相对（几何按「观众在数据 +y 侧」的底侧约定
// 呈示，audience='top' 时由显示层垂直镜像整体翻转，见 stage.js）、适配任意 count、域内 clamp。
export const SHAPE_KINDS = [
  // 基础
  'rows', 'line', 'columns', 'grid',
  // 几何
  'circle', 'arc', 'halfcircle', 'diamond', 'triangle', 'parallelogram', 'chevron', 'star', 'xpattern', 'center-surround', 'doublecircle',
  // 线条
  'v', 'diagonal', 'diagonal2', 'staggered', 'sline', 'heart',
];

const margin = stage => Math.min(1.5, stage.widthM / 8);

// 生成 count 个槽位（米坐标）
export function genSlots(kind, count, stage, opts = {}) {
  const m = margin(stage), W = stage.widthM, H = stage.depthM;
  const cx = W / 2, cy = H / 2;
  const face = faceAudience(stage);
  const pts = [];
  const push = (x, y, f = face) => pts.push({ x, y, facing: ((f % 360) + 360) % 360 });
  // 新预设（build-62 F1）专用：域内 clamp 后落点（[m, W−m]×[m, H−m]；旧 8 种几何不动）
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pushC = (x, y, f = face) => push(cl(x, m, W - m), cl(y, m, H - m), f);
  // 一行 cnt 点在 [cxCenter−halfW, cxCenter+halfW] 内均布（单点居中）
  const spreadX = (cxCenter, halfW, cnt, i) => cnt > 1 ? cxCenter - halfW + (2 * halfW) * i / (cnt - 1) : cxCenter;

  switch (kind) {
    case 'line': {
      const y = cy, sp = count > 1 ? (W - 2 * m) / (count - 1) : 0;
      for (let i = 0; i < count; i++) push(cx - (count - 1) * sp / 2 + i * sp, y);
      break;
    }
    case 'rows': {
      const rows = clampInt(opts.rows || (count <= 4 ? 1 : 2), 1, 4);
      const per = Math.ceil(count / rows), gap = 1.6;
      const sp = per > 1 ? (W - 2 * m) / (per - 1) : 0;
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / per), c = i % per;
        const rowCount = Math.min(per, count - r * per);
        const off = (per - rowCount) * sp / 2;
        push(m + off + c * sp, cy + (r - (rows - 1) / 2) * gap);
      }
      break;
    }
    case 'columns': {
      const cols = clampInt(opts.cols || Math.max(2, Math.round(count / 3)), 1, count);
      const per = Math.ceil(count / cols), gapX = 1.4, gapY = per > 1 ? (H - 2 * m) / (per - 1) : 0;
      for (let i = 0; i < count; i++) {
        const c = Math.floor(i / per), r = i % per;
        push(cx + (c - (cols - 1) / 2) * gapX, m + r * gapY);
      }
      break;
    }
    case 'circle': {
      const r = Math.min(W, H) / 2 - m;
      for (let i = 0; i < count; i++) {
        const th = 360 * i / count; // 0=顶部，顺时针
        const rad = th * Math.PI / 180;
        push(cx + r * Math.sin(rad), cy - r * Math.cos(rad), th + 180); // 面向圆心
      }
      break;
    }
    case 'arc': {
      // 弧形：圆心在观众侧，队伍背对观众心、面向观众，呈环抱状
      const r = Math.min(W / 2, H * 0.7) - m;
      const baseY = cy + r * 0.45;
      const spread = 130; // 总张角
      for (let i = 0; i < count; i++) {
        const a = (-spread / 2 + spread * (count > 1 ? i / (count - 1) : 0.5)) * Math.PI / 180;
        push(cx + r * Math.sin(a), baseY - r * Math.cos(a));
      }
      break;
    }
    case 'v': {
      // V 形：顶点在上（远台），开口朝观众
      const s = 1.1, ang = 27 * Math.PI / 180;
      const half = Math.floor(count / 2);
      let k = 0;
      for (let side = -1; side <= 1; side += 2) {
        for (let j = 0; j < (side < 0 ? half : count - half); j++) {
          const d = j + 1;
          push(cx + side * d * s * Math.sin(ang), cy - H * 0.18 + d * s * Math.cos(ang));
          k++;
        }
      }
      break;
    }
    case 'diagonal': {
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5;
        push(m + t * (W - 2 * m), m + t * (H - 2 * m));
      }
      break;
    }
    case 'diamond': {
      // 菱形周界均布：顶点 上/右/下/左
      const vs = [{ x: cx, y: m }, { x: W - m, y: cy }, { x: cx, y: H - m }, { x: m, y: cy }];
      const lens = [0, 1, 2, 3].map(i => dist(vs[i], vs[(i + 1) % 4]));
      const per = lens.reduce((a, b) => a + b, 0);
      for (let i = 0; i < count; i++) {
        let d = per * i / count, seg = 0;
        while (seg < 3 && d > lens[seg]) { d -= lens[seg]; seg++; }
        const a = vs[seg], b = vs[(seg + 1) % 4], t = d / lens[seg];
        push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
      break;
    }
    case 'grid': {
      // 方阵网格：r×c 尽量方正（|r−c| 最小）；末行不足列数时居中
      let bestC = 1, bestScore = Infinity;
      for (let c = 1; c <= count; c++) {
        const r = Math.ceil(count / c);
        const score = Math.abs(r - c);
        if (score < bestScore) { bestScore = score; bestC = c; }
      }
      const gc = bestC, gr = Math.ceil(count / gc);
      const gsp = Math.min(2.0, gc > 1 ? (W - 2 * m) / (gc - 1) : 0);
      const ggy = Math.min(1.6, gr > 1 ? (H - 2 * m) / (gr - 1) : 0);
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / gc), c = i % gc;
        const rowCount = Math.min(gc, count - r * gc);
        const off = (gc - rowCount) * gsp / 2; // 末行居中
        pushC(cx - (gc - 1) * gsp / 2 + off + c * gsp, cy - (gr - 1) * ggy / 2 + r * ggy);
      }
      break;
    }
    case 'triangle': {
      // 三角形（实心）：顶点朝后（远离观众），opts.flip=倒三角（顶点朝观众）。
      // 行内人数按行宽比例（w_r=r+1）最大余数法分配——顶点行最窄、底行最宽
      const R = Math.max(1, Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2)); // 最小 R 使 R(R+1)/2 ≥ count
      const T = R * (R + 1) / 2;
      const counts = Array.from({ length: R }, (_, r) => Math.floor(count * (r + 1) / T));
      let given = counts.reduce((a, b) => a + b, 0);
      const fracOrder = counts.map((_, r) => r).sort((a, b) => (count * (b + 1) / T % 1) - (count * (a + 1) / T % 1));
      for (let k = 0; given < count; k++, given++) counts[fracOrder[k % R]]++;
      const spanY = Math.min(H - 2 * m, H * 0.6);
      const baseW = Math.min(W - 2 * m, H * 0.7);
      let row = 0, rowStart = 0; // 行游标跨舞者持久推进（逐行填满再进下一行）
      for (let i = 0; i < count; i++) {
        while (row < R - 1 && i - rowStart >= counts[row]) { rowStart += counts[row]; row++; }
        const idxInRow = i - rowStart;
        const halfW = baseW / 2 * (row + 1) / R;
        const rowY = R > 1 ? spanY * row / (R - 1) : 0;
        pushC(spreadX(cx, halfW, counts[row], idxInRow), opts.flip ? cy + spanY / 2 - rowY : cy - spanY / 2 + rowY);
      }
      break;
    }
    case 'halfcircle': {
      // 反半圆：标准半圆（180° 张角），拱背朝后、开口朝观众（与 arc 浅弧的区别=张角与半径）
      const r = Math.min(W / 2 - m, H * 0.55);
      const ccyy = Math.min(H - m, m + r + (H - 2 * m - r) * 0.3);
      for (let i = 0; i < count; i++) {
        const th = (count > 1 ? 180 * i / (count - 1) : 90) * Math.PI / 180; // 0°=右端 → 180°=左端
        pushC(cx + r * Math.cos(th), ccyy - r * Math.sin(th));
      }
      break;
    }
    case 'parallelogram': {
      // 平行四边形：斜置矩形阵列（每行右移 shear）
      const prows = clampInt(opts.rows || (count <= 3 ? 1 : 2), 1, 4);
      const pcols = Math.ceil(count / prows);
      const psp = Math.min(1.8, pcols > 1 ? (W - 2 * m) * 0.6 / (pcols - 1) : 0);
      const budget = (W - 2 * m) - (pcols - 1) * psp;
      const shear = prows > 1 ? Math.min(1.2, budget / (prows - 1)) : 0;
      const pgy = Math.min(1.6, prows > 1 ? (H * 0.5) / (prows - 1) : 0);
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / pcols), c = i % pcols;
        const startX = cx - ((pcols - 1) * psp + (prows - 1) * shear) / 2 + r * shear;
        pushC(startX + c * psp, cy - (prows - 1) * pgy / 2 + r * pgy);
      }
      break;
    }
    case 'chevron': {
      // 楔形：双排 V 实心（嵌套 V 带，顶点朝后、开口朝观众）；奇数人时顶点站 1 人
      const D = Math.ceil(Math.max(0, count - 1) / 2); // 最大深度
      const cs = D > 0 ? Math.min(1.6, (W / 2 - m) / D) : 0;
      const cgap = D > 0 ? Math.min(1.5, H * 0.55 / D) : 0;
      const apexY = cy - H * 0.22;
      let k = 0;
      if (count % 2 === 1) { pushC(cx, apexY); k++; }
      for (let d = 1; k < count; d++) {
        pushC(cx - d * cs, apexY + d * cgap); k++; // 左臂
        if (k >= count) break;
        pushC(cx + d * cs, apexY + d * cgap); k++; // 右臂
      }
      break;
    }
    case 'star': {
      // 五角星：外/内交替十边形轮廓按周长均匀采样（顶点+凹点，人数多时沿轮廓均匀）
      const R = Math.min(W, H) / 2 - m;
      const ri = R * 0.42;
      const vs = [];
      for (let j = 0; j < 10; j++) {
        const rad = j % 2 === 0 ? R : ri;
        const ph = j * 36 * Math.PI / 180; // j=0 顶部外顶点
        vs.push({ x: cx + rad * Math.sin(ph), y: cy - rad * Math.cos(ph) });
      }
      const lens = [];
      let per = 0;
      for (let j = 0; j < 10; j++) {
        const L = dist(vs[j], vs[(j + 1) % 10]);
        lens.push(L); per += L;
      }
      for (let i = 0; i < count; i++) {
        let d = per * i / count, seg = 0;
        while (seg < 9 && d > lens[seg]) { d -= lens[seg]; seg++; }
        const a = vs[seg], b = vs[(seg + 1) % 10], t = lens[seg] > 0 ? d / lens[seg] : 0;
        pushC(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
      break;
    }
    case 'xpattern': {
      // X 形：两条对角线交叉于中心；4 臂自中心向外均布（不重复占中心点）
      const corners = [{ x: m, y: m }, { x: W - m, y: m }, { x: W - m, y: H - m }, { x: m, y: H - m }];
      const base = Math.floor(count / 4), rem = count % 4;
      for (let i = 0; i < count; i++) {
        const arm = i % 4;
        const cnt = base + (arm < rem ? 1 : 0);
        const j = Math.floor(i / 4);
        if (cnt === 0) continue;
        const t = (j + 1) / cnt; // (0,1]：末点落在角上
        pushC(cx + (corners[arm].x - cx) * t, cy + (corners[arm].y - cy) * t);
      }
      break;
    }
    case 'center-surround': {
      // 众星捧月：中心小簇（ceil(n/3)）+ 外围大环（环上面向圆心，与 circle 同约定）
      const innerN = Math.ceil(count / 3), outerN = count - innerN;
      const R = Math.min(W, H) / 2 - m;
      const rc = Math.min(1.6, R * 0.35);
      for (let i = 0; i < innerN; i++) {
        const th = 360 * (innerN > 1 ? i / innerN : 0) * Math.PI / 180;
        pushC(cx + rc * Math.sin(th), cy - rc * Math.cos(th), innerN > 1 ? th + 180 : face);
      }
      for (let i = 0; i < outerN; i++) {
        const th = 360 * i / outerN;
        const rad = th * Math.PI / 180;
        pushC(cx + R * Math.sin(rad), cy - R * Math.cos(rad), th + 180); // 面向圆心
      }
      break;
    }
    case 'doublecircle': {
      // 双圆：内外同心圆（外圈 ceil(n·2/3)、内圈其余；内圈错半步起步）
      const outerN = Math.ceil(count * 2 / 3), innerN = count - outerN;
      const R = Math.min(W, H) / 2 - m;
      const ri = R * 0.52;
      for (let i = 0; i < outerN; i++) {
        const th = 360 * i / outerN;
        const rad = th * Math.PI / 180;
        pushC(cx + R * Math.sin(rad), cy - R * Math.cos(rad), th + 180); // 面向圆心
      }
      for (let i = 0; i < innerN; i++) {
        const th = 360 * (i + 0.5) / Math.max(1, innerN);
        const rad = th * Math.PI / 180;
        pushC(cx + ri * Math.sin(rad), cy - ri * Math.cos(rad), th + 180);
      }
      break;
    }
    case 'diagonal2': {
      // 双斜线：两条平行斜线错开（各 ceil/floor 半数，含两端点）
      const off = Math.min(1.2, (W - 2 * m) * 0.08);
      const dxx = W / 2 - off - m;
      const nA = Math.ceil(count / 2);
      for (let i = 0; i < count; i++) {
        const onA = i < nA;
        const j = onA ? i : i - nA;
        const cnt = onA ? nA : count - nA;
        const t = cnt > 1 ? j / (cnt - 1) : 0.5;
        const xTop = onA ? m : W / 2 + off;
        pushC(xTop + dxx * t, m + (H - 2 * m) * t);
      }
      break;
    }
    case 'staggered': {
      // 交错横排：两排前后错位半间距（后排在先、整体右移半距；keep-visible 排型——
      // 前排间隙对准后排每人）；组宽=(per−1)·sp+sp/2 居中，两排均不出域
      const per = Math.ceil(count / 2);
      const sp = per > 1 ? (W - 2 * m) / (per - 0.5) : 0;
      const gap = 1.6;
      for (let i = 0; i < count; i++) {
        const back = i < per;
        const j = back ? i : i - per;
        const x = cx - (per - 1) * sp / 2 - sp / 4 + j * sp + (back ? sp / 2 : 0);
        pushC(x, back ? cy - gap / 2 : cy + gap / 2);
      }
      break;
    }
    case 'sline': {
      // 蛇形/S 曲线：纵向推进（后→前），弯数按人数自适应（≥18 人三折 / ≥8 人两折 / 其余一折）；
      // 朝向沿行进切线（蛇形队惯常面向行进方向）
      const bends = count >= 18 ? 3 : (count >= 8 ? 2 : 1);
      const A = (W / 2 - m) * 0.8;
      const path = [];
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0.5;
        const p = { x: cx + A * Math.sin(Math.PI * bends * t), y: m + t * (H - 2 * m) };
        path.push(p);
        const prev = path[i - 1];
        pushC(p.x, p.y, prev ? angleTo(prev, p) : face);
      }
      if (count > 1) {
        const last = pts[pts.length - 1], prev = pts[pts.length - 2];
        last.facing = ((angleTo(prev, last) % 360) + 360) % 360;
      }
      break;
    }
    case 'heart': {
      // 心形：参数化心形曲线按弧长均匀采样（心尖朝观众、双瓣朝后），bbox 拟合场内
      const N = 240;
      const raw = [];
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (let i = 0; i <= N; i++) {
        const t = 2 * Math.PI * i / N;
        const mx = 16 * Math.pow(Math.sin(t), 3);
        const my = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        raw.push({ x: mx, y: my });
        if (mx < bx0) bx0 = mx; if (mx > bx1) bx1 = mx;
        if (my < by0) by0 = my; if (my > by1) by1 = my;
      }
      const sc = Math.min((W - 2 * m) / (bx1 - bx0), (H - 2 * m) / (by1 - by0)) * 0.92;
      const path = raw.map(p => ({ x: cx + (p.x - (bx0 + bx1) / 2) * sc, y: cy - (p.y - (by0 + by1) / 2) * sc }));
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
      const total = cum[cum.length - 1];
      let seg = 0;
      for (let i = 0; i < count; i++) {
        const d = total * i / count;
        while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
        const t = cum[seg + 1] > cum[seg] ? (d - cum[seg]) / (cum[seg + 1] - cum[seg]) : 0;
        pushC(path[seg].x + (path[seg + 1].x - path[seg].x) * t, path[seg].y + (path[seg + 1].y - path[seg].y) * t);
      }
      break;
    }
    default:
      for (let i = 0; i < count; i++) push(cx, cy);
  }
  if (opts.face === 'center') for (const p of pts) p.facing = ((angleTo(p, { x: cx, y: cy }) % 360) + 360) % 360;
  return pts;
}

function clampInt(v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function angleTo(a, b) { return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360; } // 0=上 顺时针 0..360

// 把槽位映射进队形：优先保持现有就近站位（slot→最近舞者，贪心）
// Wave1 需求 5：可选 opts.ids 子集生成——就近映射只在 ids 子集内进行、仅对这些舞者写生成
// 位置，其余舞者本帧位置原样保留（不做整表替换）；缺省 ids=null=现行为（orderedIds 全员、
// 整表替换，逐字节不变）。槽位数由调用方给定（子集生成传 genSlots(kind, ids.length, …)）。
export function applySlots(formation, orderedIds, slots, { current = {}, ids = null } = {}) {
  const subset = (Array.isArray(ids) && ids.length) ? new Set(ids) : null;
  const targets = subset ? orderedIds.filter(id => subset.has(id)) : orderedIds;
  const remaining = new Set(targets);
  const positions = {};
  if (subset) {
    // 子集模式：子集外舞者原位保留（positions 以保留项为底、仅子集键被生成结果改写）
    for (const [id, p] of Object.entries(formation.positions || {})) {
      if (!subset.has(id)) positions[id] = p;
    }
  }
  for (const s of slots) {
    let best = null, bd = Infinity;
    for (const id of remaining) {
      const p = current[id];
      const d = p ? dist(p, s) : 1e9; // 无位置的舞者最后安排
      if (d < bd) { bd = d; best = id; }
    }
    if (!best) break;
    remaining.delete(best);
    positions[best] = { x: round2(s.x), y: round2(s.y), facing: Math.round(s.facing ?? 0) };
  }
  formation.positions = positions;
}
function round2(v) { return Math.round(v * 100) / 100; }

// ---------- 整体变换 ----------
export function mirrorH(formation, stage) { // 左右镜像
  for (const p of Object.values(formation.positions)) { p.x = round2(stage.widthM - p.x); p.facing = (360 - p.facing) % 360; }
}
export function mirrorV(formation, stage) { // 前后镜像
  for (const p of Object.values(formation.positions)) { p.y = round2(stage.depthM - p.y); p.facing = (180 - p.facing + 360) % 360; }
}
export function rotateSelected(positions, ids, deg, center) {
  const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  for (const id of ids) {
    const p = positions[id]; if (!p) continue;
    const dx = p.x - center.x, dy = p.y - center.y;
    p.x = round2(center.x + dx * cos - dy * sin);
    p.y = round2(center.y + dx * sin + dy * cos);
    p.facing = ((p.facing + deg) % 360 + 360) % 360;
  }
}
export function distributeAxis(positions, ids, axis) {
  const list = ids.map(id => ({ id, p: positions[id] })).filter(e => e.p);
  list.sort((a, b) => a.p[axis] - b.p[axis]);
  if (list.length < 3) return;
  const lo = list[0].p[axis], hi = list[list.length - 1].p[axis];
  list.forEach((e, i) => { e.p[axis] = round2(lo + (hi - lo) * i / (list.length - 1)); });
}
export function swapTwo(formation, idA, idB) {
  const a = formation.positions[idA], b = formation.positions[idB];
  if (!a || !b) return;
  formation.positions[idA] = b; formation.positions[idB] = a;
}
export function faceAll(positions, ids, target, { stage }) {
  const face = faceAudience(stage);
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  for (const id of ids) {
    const p = positions[id]; if (!p) continue;
    if (target === 'audience') p.facing = face;
    else if (target === 'center') p.facing = Math.round(((angleTo(p, { x: cx, y: cy }) % 360) + 360) % 360);
  }
}
