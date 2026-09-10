// 队形生成器与整体位置变换 —— 纯逻辑，无 DOM 依赖
import { faceAudience, uid } from './model.js';

export const SHAPE_KINDS = ['rows', 'line', 'columns', 'circle', 'arc', 'v', 'diagonal', 'diamond'];

const margin = stage => Math.min(1.5, stage.widthM / 8);

// 生成 count 个槽位（米坐标）
export function genSlots(kind, count, stage, opts = {}) {
  const m = margin(stage), W = stage.widthM, H = stage.depthM;
  const cx = W / 2, cy = H / 2;
  const face = faceAudience(stage);
  const pts = [];
  const push = (x, y, f = face) => pts.push({ x, y, facing: ((f % 360) + 360) % 360 });

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
export function applySlots(formation, orderedIds, slots, { current = {} } = {}) {
  const remaining = new Set(orderedIds);
  const positions = {};
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
export function swapPairPositions(formation, project) {
  // 镜像后交换每对男女位置（保持相对握持方位的镜像一致性）
  for (const p of project.pairs) {
    const a = formation.positions[p.leader], b = formation.positions[p.follower];
    if (a && b) { formation.positions[p.leader] = b; formation.positions[p.follower] = a; }
  }
}
export function faceAll(positions, ids, target, { stage, project }) {
  const face = faceAudience(stage);
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  for (const id of ids) {
    const p = positions[id]; if (!p) continue;
    if (target === 'audience') p.facing = face;
    else if (target === 'center') p.facing = Math.round(((angleTo(p, { x: cx, y: cy }) % 360) + 360) % 360);
    else if (target === 'project' || target === 'partner') {
      const partner = partnerIdOf(project, id);
      if (partner && positions[partner]) p.facing = Math.round(((angleTo(p, positions[partner]) % 360) + 360) % 360);
    }
  }
}
function partnerIdOf(project, id) {
  const p = project.pairs.find(q => q.leader === id || q.follower === id);
  return p ? (p.leader === id ? p.follower : p.leader) : null;
}
