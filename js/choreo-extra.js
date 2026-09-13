// 编舞辅助纯函数（wuzhen-core 扩展）—— 无 DOM 依赖，Node 可直接 import；
// 由 scripts/build-core.mjs 与 model/shapes 一起打包为 dist/core/wuzhen-core.mjs。
// 注意：本文件与 model.js/shapes.js 拼接进同一模块作用域，顶层标识符不得与
// 它们的导出名或私有名冲突（禁用 dist/round2/margin/clampInt/num 等）。
import { DEFAULT_BPM, ROLE_COLOR, UNIT_STYLES } from './model.js';

// 合并单元「呈示为单元符号」的间距阈值（与 app js/stage.js MERGE_DIST 同值同语义）
const UNIT_MERGE_DIST = 0.8;

// 数字格式化：两位小数内稳定输出（SVG 坐标/长度）
function fx(v) { return String(Math.round(v * 100) / 100); }
// XML 文本转义（标签内容/属性通用最小集）
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------- toSVG：队形 → 零依赖 SVG 字符串（候选可视化） ----------
// 与 app 呈示同语义（js/stage.js drawOne/drawUnitSymbol/drawBond）：
//   - 舞台边界矩形；坐标米→px（scale px/米），padding 米留白；
//   - 合并单元两人 ≤0.8m：capsule=圆角矩形左右双半色+中缝+双 short 标签 /
//     single=单圆（取名册靠前成员颜色与标签）+虚线外环；>0.8m：两独立圆+虚线绑定；
//   - 独立舞者=角色色圆+白色朝向指针（0=上、顺时针）+short 标签。
// 参数：formation={positions:{id:{x,y,facing}}, merges?:[{a,b,style}]}
//       opts.stage={widthM,depthM}；opts.unitStyle='capsule'|'single'（覆盖各单元自报样式）
//       opts.dancers=[{id,short,role,color?}]（标签与配色来源，缺失回退 id 尾 4 位+灰）
//       opts.scale=px/米（默认24）；opts.padding=米（默认1）
export function toSVG(formation, { stage, unitStyle, dancers = [], scale = 24, padding = 1 } = {}) {
  const st = { ...(stage || {}) };
  const W = Number(st.widthM) > 0 ? Number(st.widthM) : 12;
  const H = Number(st.depthM) > 0 ? Number(st.depthM) : 16;
  const s = Number(scale) > 0 ? Number(scale) : 24;
  const pad = Number(padding) >= 0 ? Number(padding) : 1;
  const pos = (formation && formation.positions) || {};
  const merges = formation && Array.isArray(formation.merges) ? formation.merges : [];
  const vw = Math.ceil((W + 2 * pad) * s), vh = Math.ceil((H + 2 * pad) * s);
  const X = x => fx((x + pad) * s), Y = y => fx((y + pad) * s);
  const r = 0.45 * s;
  const meta = new Map();
  for (const d of (Array.isArray(dancers) ? dancers : [])) meta.set(d.id, d);
  const infoOf = id => {
    const d = meta.get(id);
    return {
      short: String(d?.short ?? String(id).slice(-4)),
      color: d?.color || ROLE_COLOR[d?.role] || '#64748b',
    };
  };
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}" font-family="sans-serif">`);
  // 舞台边界矩形
  parts.push(`  <rect x="${X(0)}" y="${Y(0)}" width="${fx(W * s)}" height="${fx(H * s)}" fill="#ffffff" stroke="#334155" stroke-width="2"/>`);
  // 单人圆（独立舞者与「拉伸的合并」共用）：角色色圆 + 朝向指针 + short 标签
  const one = (id, p) => {
    const inf = infoOf(id);
    const facing = ((Number(p.facing) || 0) % 360 + 360) % 360;
    return [
      `  <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${fx(r)}" fill="${inf.color}" stroke="rgba(15,23,42,.55)" stroke-width="1.5"/>`,
      `  <g transform="translate(${X(p.x)},${Y(p.y)}) rotate(${fx(facing)})"><polygon points="0,${fx(-r * 0.55)} ${fx(r * 0.42)},${fx(r * 0.38)} ${fx(-r * 0.42)},${fx(r * 0.38)}" fill="rgba(255,255,255,.92)"/></g>`,
      `  <text x="${X(p.x)}" y="${Y(p.y)}" fill="#fff" font-weight="700" font-size="${fx(r * 0.95)}" text-anchor="middle" dominant-baseline="central">${esc(inf.short)}</text>`,
    ].join('\n');
  };
  // 合并单元（帧级 merges）：接近=单元符号，分离=两圆+虚线绑定
  const mergedIds = new Set();
  merges.forEach((m, i) => {
    const a = pos[m.a], b = pos[m.b];
    if (!a || !b) return;
    mergedIds.add(m.a); mergedIds.add(m.b);
    const cx = (Number(a.x) + Number(b.x)) / 2, cy = (Number(a.y) + Number(b.y)) / 2;
    if (Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= UNIT_MERGE_DIST) {
      const style = UNIT_STYLES.includes(unitStyle) ? unitStyle : m.style;
      if (style === 'single') {
        // 单圆 + 虚线外环（颜色/标签取名册靠前的成员）
        const first = [m.a, m.b].filter(id => meta.has(id));
        const lead = first.length ? (meta.get(first[0])) : null;
        const inf = lead ? { short: String(lead.short ?? String(lead.id).slice(-4)), color: lead.color || ROLE_COLOR[lead.role] || '#64748b' } : infoOf(m.a);
        parts.push(`  <!-- single 单元 ${esc(inf.short)} -->`);
        parts.push(`  <circle cx="${X(cx)}" cy="${Y(cy)}" r="${fx(r)}" fill="${inf.color}" stroke="rgba(15,23,42,.55)" stroke-width="1.5"/>`);
        parts.push(`  <text x="${X(cx)}" y="${Y(cy)}" fill="#fff" font-weight="700" font-size="${fx(r * 0.95)}" text-anchor="middle" dominant-baseline="central">${esc(inf.short)}</text>`);
        parts.push(`  <circle cx="${X(cx)}" cy="${Y(cy)}" r="${fx(r * 1.45)}" fill="none" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      } else { // capsule：圆角矩形左右双半色 + 中缝 + 双标签
        const A = infoOf(m.a), B = infoOf(m.b);
        const w = r * 3.4, h = r * 1.5, rad = h * 0.45;
        const x0 = (cx + pad) * s - w / 2, y0 = (cy + pad) * s - h / 2, cxp = (cx + pad) * s;
        parts.push(`  <!-- capsule 单元 ${esc(A.short)}×${esc(B.short)} -->`);
        parts.push(`  <clipPath id="wzc${i}"><rect x="${fx(x0)}" y="${fx(y0)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(rad)}"/></clipPath>`);
        parts.push(`  <rect x="${fx(x0)}" y="${fx(y0)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(rad)}" fill="${A.color}"/>`);
        parts.push(`  <rect x="${fx(x0 + w / 2)}" y="${fx(y0)}" width="${fx(w / 2)}" height="${fx(h)}" fill="${B.color}" clip-path="url(#wzc${i})"/>`);
        parts.push(`  <line x1="${fx(cxp)}" y1="${fx(y0)}" x2="${fx(cxp)}" y2="${fx(y0 + h)}" stroke="rgba(255,255,255,.85)" stroke-width="2"/>`);
        parts.push(`  <rect x="${fx(x0)}" y="${fx(y0)}" width="${fx(w)}" height="${fx(h)}" rx="${fx(rad)}" fill="none" stroke="#334155" stroke-width="2"/>`);
        parts.push(`  <text x="${fx(cxp - w * 0.25)}" y="${fx(y0 + h / 2)}" fill="#fff" font-weight="700" font-size="${fx(h * 0.62)}" text-anchor="middle" dominant-baseline="central">${esc(A.short)}</text>`);
        parts.push(`  <text x="${fx(cxp + w * 0.25)}" y="${fx(y0 + h / 2)}" fill="#fff" font-weight="700" font-size="${fx(h * 0.62)}" text-anchor="middle" dominant-baseline="central">${esc(B.short)}</text>`);
      }
    } else {
      // 拉伸的合并：两独立圆 + 虚线绑定
      parts.push(`  <line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="rgba(56,189,248,.45)" stroke-width="1.5" stroke-dasharray="3 4"/>`);
      parts.push(one(m.a, a));
      parts.push(one(m.b, b));
    }
  });
  // 未合并舞者
  for (const [id, p] of Object.entries(pos)) {
    if (mergedIds.has(id) || !p) continue;
    parts.push(one(id, p));
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------- diffFormations：两队形的逐人移动量摘要 ----------
// a/b 为 {positions:{id:{x,y,...}}}；比较逐舞者欧氏距离（朝向不参与）。
// moved 仅含位移 > eps（默认 0.01m=1cm，滤除抖动），按距离降序、同距按 id 升序（稳定可复现）。
// 返回 { moved:[{id,from:{x,y},to:{x,y},dist}], maxDist, totalDist, addedIds, removedIds }
export function diffFormations(a, b, { eps = 0.01 } = {}) {
  const ap = (a && a.positions) || {}, bp = (b && b.positions) || {};
  const moved = [], addedIds = [], removedIds = [];
  for (const [id, p] of Object.entries(ap)) {
    const q = bp[id];
    if (!q) { removedIds.push(id); continue; }
    const d = Math.hypot(Number(q.x) - Number(p.x), Number(q.y) - Number(p.y));
    if (d > eps) moved.push({ id, from: { x: p.x, y: p.y }, to: { x: q.x, y: q.y }, dist: Math.round(d * 100) / 100 });
  }
  for (const id of Object.keys(bp)) if (!(id in ap)) addedIds.push(id);
  moved.sort((u, v) => (v.dist - u.dist) || String(u.id).localeCompare(String(v.id)));
  const maxDist = moved.length ? moved[0].dist : 0;
  const totalDist = Math.round(moved.reduce((s, m) => s + m.dist, 0) * 100) / 100;
  return { moved, maxDist, totalDist, addedIds, removedIds };
}

// ---------- feasibility：A→B 在 beats 拍内的速度可行性 ----------
// 每人需移动距离 ÷ 可走距离（cap 米/拍 × beats 拍）；cap=速度上限（米/拍）。
// 返回 { maxNeededDist, beats, ok, score, availableDist, secPerBeat, speedCapMPerBeat }
//   score=负荷比 maxNeededDist/availableDist（≤1 可行，越小越从容；无移动=0；不可行>1 或 ∞）。
// bpm 用于换算每拍秒数（secPerBeat）供人参考；非法值回退 DEFAULT_BPM。
export function feasibility(from, to, beats, bpm, cap = 1.2) {
  const maxNeededDist = diffFormations(from, to).maxDist;
  const b = Math.max(0, Number(beats) || 0);
  const tempo = Number(bpm) > 0 ? Number(bpm) : DEFAULT_BPM;
  const c = Number(cap) > 0 ? Number(cap) : 1.2;
  const availableDist = Math.round(c * b * 100) / 100;
  const ok = maxNeededDist <= availableDist + 1e-9;
  const score = maxNeededDist <= 0 ? 0
    : (availableDist > 0 ? Math.round((maxNeededDist / availableDist) * 100) / 100 : Infinity);
  return {
    maxNeededDist, beats: b, ok, score,
    availableDist, secPerBeat: Math.round((60 / tempo) * 1000) / 1000, speedCapMPerBeat: c,
  };
}
