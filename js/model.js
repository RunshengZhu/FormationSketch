// 数据模型与时间轴计算 —— 纯逻辑，无 DOM 依赖（可在 Node 中单测）
// 约定：坐标单位米，原点舞台左上，+x 右 +y 下；角度 0=上(−y)、顺时针、0..359

export const DEFAULT_BPM = 120;
export const ROLE_COLOR = { M: '#3b82f6', F: '#ec4899', X: '#10b981' };
export const ROLE_NAME = { M: '男', F: '女', X: '其他' };

let _uidCounter = 0;
export function uid(prefix = 'id') {
  _uidCounter = (_uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${_uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export function clone(o) { return JSON.parse(JSON.stringify(o)); }
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// ---------- 创建 ----------
export function addDancer(project, name, role = 'X', short = '') {
  const d = { id: uid('d'), name, short: short || nextShort(project, role), role, color: ROLE_COLOR[role] || ROLE_COLOR.X };
  project.dancers.push(d);
  for (const f of project.formations) ensureDancerInFormation(project, f, d.id);
  return d;
}
function nextShort(project, role) {
  const used = new Set(project.dancers.map(d => d.short));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}
export function addPair(project, leaderName, followerName) {
  const n = project.pairs.length + 1 + project.dancers.length; // 保证 short 唯一的简单策略
  // 舞对编号 = 现有舞对数 + 1，但需避免与已有 short 冲突
  let num = project.pairs.length + 1;
  const used = new Set(project.dancers.map(d => d.short));
  while (used.has(String(num))) num++;
  const leader = addDancer(project, leaderName, 'M', String(num));
  const follower = addDancer(project, followerName, 'F', String(num));
  const pair = { id: uid('p'), leader: leader.id, follower: follower.id };
  project.pairs.push(pair);
  return pair;
}
export function createProject({ title = '未命名队列舞', pairs = 6, extraM = 0, extraF = 0 } = {}) {
  const project = {
    version: 1,
    meta: { title, team: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    stage: { widthM: 12, depthM: 16, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 2, bgImage: null },
    audio: { name: '', durationSec: 0, bpm: DEFAULT_BPM, beatsPerBar: 4, firstBeatSec: 0 },
    dancers: [], pairs: [], formations: [],
    timeline: { blocks: [], countInBeats: 8, metronome: false, playSpeed: 1 },
  };
  for (let i = 1; i <= pairs; i++) addPair(project, `M${i}`, `F${i}`);
  for (let i = 1; i <= extraM; i++) addDancer(project, `M${pairs + i}`, 'M');
  for (let i = 1; i <= extraF; i++) addDancer(project, `F${pairs + i}`, 'F');
  // 初始队形：双横排（以舞对为单位）
  const f = { id: uid('f'), name: '开场队形', color: '#64748b', note: '', positions: {} };
  project.formations.push(f);
  genDefaultRows(project, f);
  syncTimeline(project);
  return project;
}
function genDefaultRows(project, f) {
  const ids = orderedDancers(project, 'pair');
  const { widthM: W, depthM: H } = project.stage;
  const n = ids.length, rows = n <= 4 ? 1 : 2, m = 1.5;
  const per = Math.ceil(n / rows);
  const spacing = per > 1 ? (W - 2 * m) / (per - 1) : 0;
  const face = faceAudience(project.stage);
  ids.forEach((id, i) => {
    const r = Math.floor(i / per), c = i % per;
    const rowCount = Math.min(per, n - r * per);
    const off = (per - rowCount) * spacing / 2;
    f.positions[id] = { x: m + off + c * spacing, y: H / 2 + (r - (rows - 1) / 2) * 1.6, facing: face };
  });
}

// ---------- 舞者/舞对 ----------
export function dancerById(project, id) { return project.dancers.find(d => d.id === id) || null; }
export function pairOf(project, dancerId) { return project.pairs.find(p => p.leader === dancerId || p.follower === dancerId) || null; }
export function partnerOf(project, dancerId) {
  const p = pairOf(project, dancerId);
  if (!p) return null;
  return p.leader === dancerId ? p.follower : p.leader;
}
export function orderedDancers(project, unit = 'pair') {
  if (unit !== 'pair') return project.dancers.map(d => d.id);
  const inPair = new Set();
  const ids = [];
  for (const p of project.pairs) {
    if (project.dancers.some(d => d.id === p.leader) && project.dancers.some(d => d.id === p.follower)) {
      ids.push(p.leader, p.follower); inPair.add(p.leader); inPair.add(p.follower);
    }
  }
  for (const d of project.dancers) if (!inPair.has(d.id)) ids.push(d.id);
  return ids;
}
export function removeDancer(project, dancerId) {
  project.dancers = project.dancers.filter(d => d.id !== dancerId);
  project.pairs = project.pairs.filter(p => p.leader !== dancerId && p.follower !== dancerId);
  for (const f of project.formations) delete f.positions[dancerId];
}
export function removePair(project, pairId) { project.pairs = project.pairs.filter(p => p.id !== pairId); }
// 从更早的队形顺延缺失舞者的位置（查不到则放舞台中心附近）
export function carryPositionsForward(project, index) {
  const f = project.formations[index];
  if (!f) return;
  const { widthM, depthM } = project.stage;
  for (const d of project.dancers) {
    if (f.positions[d.id]) continue;
    let found = null;
    for (let i = index - 1; i >= 0 && !found; i--) {
      const prev = project.formations[i].positions[d.id];
      if (prev) found = { x: prev.x, y: prev.y, facing: prev.facing };
    }
    f.positions[d.id] = found || { x: widthM / 2, y: depthM / 2, facing: faceAudience(project.stage) };
  }
}
// ---------- 帧内合并单元（任意两名舞者合为一个呈示符号） ----------
export const UNIT_STYLES = ['capsule', 'diamond', 'twin'];
export const mergeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function findMerge(formation, idA, idB) {
  const key = mergeKey(idA, idB);
  return (formation.merges || []).find(m => mergeKey(m.a, m.b) === key) || null;
}
export function addMerge(formation, idA, idB, style = 'capsule') {
  if (idA === idB || findMerge(formation, idA, idB)) return null;
  if (!UNIT_STYLES.includes(style)) style = 'capsule';
  const m = { a: idA, b: idB, style };
  (formation.merges = formation.merges || []).push(m);
  return m;
}
export function removeMerge(formation, idA, idB) {
  const key = mergeKey(idA, idB);
  formation.merges = (formation.merges || []).filter(m => mergeKey(m.a, m.b) !== key);
}
export function setMergeStyle(formation, idA, idB, style) {
  const m = findMerge(formation, idA, idB);
  if (m && UNIT_STYLES.includes(style)) m.style = style;
}
// 把一对舞伴收拢/拆开到标准间距（用于生成器后处理与呈示切换）
export function collapsePair(f, idA, idB) {
  const a = f.positions[idA], b = f.positions[idB];
  if (!a || !b) return;
  const mx = Math.round(((a.x + b.x) / 2) * 100) / 100;
  const my = Math.round(((a.y + b.y) / 2) * 100) / 100;
  a.x = b.x = mx; a.y = b.y = my;
}
// 切换队形帧的组队呈示状态：
// 组队：名册舞对自动建合并单元并收拢；拆队：移除全部合并单元并按标准间距拆开
export function setCombined(project, index, combined) {
  const f = project.formations[index];
  if (!f) return;
  f.combined = !!combined;
  applyFormationLayout(project, index);
}
// 帧布局归一：补齐缺席舞者 + 按组队状态收拢/拆开
export function applyFormationLayout(project, index) {
  const f = project.formations[index];
  if (!f) return;
  carryPositionsForward(project, index);
  if (f.combined !== false) {
    for (const pair of project.pairs) {
      if (!f.positions[pair.leader] || !f.positions[pair.follower]) continue;
      if (!findMerge(f, pair.leader, pair.follower)) addMerge(f, pair.leader, pair.follower, 'capsule');
    }
    for (const m of f.merges || []) collapsePair(f, m.a, m.b);
  } else {
    for (const m of f.merges || []) {
      const a = f.positions[m.a], b = f.positions[m.b];
      if (!a || !b) continue;
      const mx = Math.round(((a.x + b.x) / 2) * 100) / 100;
      const my = Math.round(((a.y + b.y) / 2) * 100) / 100;
      a.x = Math.round((mx - 0.35) * 100) / 100; b.x = Math.round((mx + 0.35) * 100) / 100;
      a.y = b.y = my;
    }
    f.merges = [];
  }
}
// 帧的组队呈示状态（缺省视为组队）
export function isCombined(formation) { return formation ? formation.combined !== false : true; }
// 将两名已有舞者组成舞伴（两人都必须未配对）；对内编号取不冲突的最小号
export function addPairByIds(project, leaderId, followerId) {
  if (!dancerById(project, leaderId) || !dancerById(project, followerId)) return null;
  if (pairOf(project, leaderId) || pairOf(project, followerId)) return null;
  const used = new Set(project.dancers.map(d => d.short));
  let num = 1;
  while (used.has(String(num))) num++;
  const pair = { id: uid('p'), leader: leaderId, follower: followerId };
  dancerById(project, leaderId).short = String(num);
  dancerById(project, followerId).short = String(num);
  project.pairs.push(pair);
  return pair;
}
export function renameShortsByPair(project) {
  // 按舞对顺序重编 short：对内同号（第 n 对 = n），未配对舞者往后编
  let n = 1;
  for (const p of project.pairs) {
    const l = dancerById(project, p.leader), fo = dancerById(project, p.follower);
    if (l) l.short = String(n);
    if (fo) fo.short = String(n);
    n++;
  }
  for (const d of project.dancers) {
    if (!pairOf(project, d.id)) { d.short = String(n); n++; }
  }
}

// ---------- 队形 ----------
export function faceAudience(stage) { return { bottom: 180, top: 0, left: 270, right: 90 }[stage.audience] ?? 180; }
export function ensureDancerInFormation(project, formation, dancerId) {
  if (formation.positions[dancerId]) return;
  const n = Object.keys(formation.positions).length;
  formation.positions[dancerId] = {
    x: project.stage.widthM / 2 + (n % 5 - 2) * 0.6,
    y: project.stage.depthM / 2 + (Math.floor(n / 5) - 1) * 0.6,
    facing: faceAudience(project.stage),
  };
}
export function ensureFormationComplete(project, formation) {
  for (const d of project.dancers) ensureDancerInFormation(project, formation, d.id);
}
export function createFormationFrom(project, srcIndex, { name } = {}) {
  const src = project.formations[srcIndex];
  const f = {
    id: uid('f'), name: name || `队形 ${project.formations.length + 1}`,
    color: ['#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'][project.formations.length % 6],
    note: src?.note || '', 
    positions: src ? clone(src.positions) : {},
    merges: src && src.merges ? clone(src.merges) : [],
  };
  if (srcIndex >= 0 && srcIndex < project.formations.length - 1) project.formations.splice(srcIndex + 1, 0, f);
  else project.formations.push(f);
  ensureFormationComplete(project, f);
  syncTimeline(project);
  return f;
}
export function deleteFormation(project, index) {
  if (project.formations.length <= 1) return null;
  const [rm] = project.formations.splice(index, 1);
  syncTimeline(project);
  return rm;
}
export function moveFormation(project, from, to) {
  if (from === to || from < 0 || from >= project.formations.length) return;
  const [f] = project.formations.splice(from, 1);
  project.formations.splice(clamp(to, 0, project.formations.length), 0, f);
  syncTimeline(project);
}
export function formationIndexById(project, fid) { return project.formations.findIndex(f => f.id === fid); }

// ---------- 时间轴 ----------
export function syncTimeline(project) {
  const old = new Map(project.timeline.blocks.map(b => [b.formationId, b]));
  project.timeline.blocks = project.formations.map(f => {
    const o = old.get(f.id);
    return { formationId: f.id, holdBeats: o?.holdBeats ?? 16, travelBeats: o?.travelBeats ?? 8 };
  });
}
export function spb(project) { return 60 / (project.audio.bpm || DEFAULT_BPM); }
export function beatToSec(project, beat) { return (project.audio.firstBeatSec || 0) + beat * spb(project); }
export function secToBeat(project, sec) { return (sec - (project.audio.firstBeatSec || 0)) / spb(project); }

export function computeSegments(project) {
  const blocks = project.timeline.blocks, formations = project.formations;
  const segs = [];
  let b = 0;
  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    const hasTravel = i < blocks.length - 1;
    const holdStart = b, holdEnd = b + Math.max(0, blk.holdBeats);
    const travelEnd = hasTravel ? holdEnd + Math.max(0, blk.travelBeats) : holdEnd;
    segs.push({ i, formationId: blk.formationId, holdStart, holdEnd, travelEnd, hasTravel });
    b = travelEnd;
  }
  return { segments: segs, totalBeats: b };
}
export function totalDurationSec(project) {
  const { totalBeats } = computeSegments(project);
  return beatToSec(project, totalBeats);
}
export function segmentAt(segments, beat) {
  if (!segments.length) return null;
  if (beat <= 0) return segments[0];
  for (const s of segments) if (beat < s.travelEnd) return s;
  return segments[segments.length - 1];
}

// ---------- 位置插值 ----------
export function lerpAngle(a, b, t) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return (a + d * t + 360) % 360;
}
function lerpFormations(A, B, t) {
  const out = {};
  const ids = new Set([...Object.keys(A), ...Object.keys(B)]);
  for (const id of ids) {
    const a = A[id] || B[id], b = B[id] || A[id];
    out[id] = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      facing: lerpAngle(a.facing || 0, b.facing || 0, t),
    };
  }
  return out;
}
export function posAt(project, beat) {
  const formations = project.formations;
  if (!formations.length) return { positions: {}, seg: null, phase: 'hold', t: 0 };
  const { segments } = computeSegments(project);
  if (beat <= 0) return { positions: formations[0].positions, seg: segments[0], phase: 'hold', t: 0 };
  const last = segments[segments.length - 1];
  if (beat >= last.travelEnd) return { positions: formations[formations.length - 1].positions, seg: last, phase: 'hold', t: 1 };
  const seg = segmentAt(segments, beat);
  if (beat < seg.holdEnd) return { positions: formations[seg.i].positions, seg, phase: 'hold', t: 0 };
  const t = easeInOut((beat - seg.holdEnd) / Math.max(1e-6, seg.travelEnd - seg.holdEnd));
  return { positions: lerpFormations(formations[seg.i].positions, formations[seg.i + 1].positions, t), seg, phase: 'travel', t };
}
export function currentFormationIndexAt(project, beat) {
  const { segments } = computeSegments(project);
  const seg = segmentAt(segments, beat);
  return seg ? seg.i : 0;
}

// ---------- 小节/8拍显示 ----------
export function beatLabel(project, beat) {
  const bpb = project.audio.beatsPerBar || 4;
  const b = Math.max(0, beat);
  const bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1;
  return `${bar}.${bt}`;
}
export function countLabel(beat) { return `${Math.floor(Math.max(0, beat) / 8) + 1}`; } // 第 n 个 8 拍

// ---------- 时间轴对齐 ----------
// 把第 index 个队形块的起点对齐到目标拍（调整前一个过渡的时长，必要时压缩上一块的保持时长）
export function alignBlockStart(project, index, targetBeat, segments = computeSegments(project).segments) {
  if (index <= 0 || !segments[index] || !segments[index - 1]) return false;
  const prevSeg = segments[index - 1];
  const prev = project.timeline.blocks[index - 1];
  let need = targetBeat - prevSeg.holdEnd;
  if (need < 0.5) {
    const reduce = Math.min(0.5 - need, Math.max(0, prev.holdBeats - 0.5));
    prev.holdBeats = Math.max(0.5, prev.holdBeats - reduce);
    need += reduce;
  }
  prev.travelBeats = Math.max(0.5, need);
  return true;
}

// ---------- 校验 / 迁移 ----------
function num(v, def, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
export function validateProject(json) {
  const errors = [];
  if (!json || typeof json !== 'object') return { ok: false, errors: ['不是合法的项目对象'] };
  if (json.version !== 1 && json.version !== 2) errors.push(`未知版本 ${json.version}`);
  delete (json.audio || {}).dataBase64; // 内嵌音乐在导入入口处还原为 Blob，不进项目记录
  delete (json.audio || {}).dataFormat;
  const p = json;
  p.meta = (p.meta && typeof p.meta === 'object') ? p.meta : { title: '导入项目' };
  p.meta.title = String(p.meta.title ?? '未命名').slice(0, 120);
  p.stage = { widthM: 12, depthM: 16, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 2, bgImage: null, ...p.stage };
  p.stage.widthM = num(p.stage.widthM, 12, 4, 60);
  p.stage.depthM = num(p.stage.depthM, 16, 4, 60);
  p.stage.gridM = num(p.stage.gridM, 0.5, 0.1, 2);
  p.stage.backstageM = num(p.stage.backstageM, 2, 0, 10);
  p.stage.snap = !!p.stage.snap;
  if (!['bottom', 'top', 'left', 'right'].includes(p.stage.audience)) p.stage.audience = 'bottom';
  p.audio = { name: '', durationSec: 0, bpm: DEFAULT_BPM, beatsPerBar: 4, firstBeatSec: 0, ...p.audio };
  p.audio.bpm = num(p.audio.bpm, DEFAULT_BPM, 30, 300);
  p.audio.beatsPerBar = num(p.audio.beatsPerBar, 4, 2, 12);
  p.audio.firstBeatSec = num(p.audio.firstBeatSec, 0, 0, 3600);
  p.audio.durationSec = num(p.audio.durationSec, 0, 0, 36000);
  p.audio.name = String(p.audio.name ?? '').slice(0, 200);
  p.dancers = Array.isArray(p.dancers) ? p.dancers : [];
  p.pairs = Array.isArray(p.pairs) ? p.pairs : [];
  p.formations = Array.isArray(p.formations) ? p.formations : [];
  p.timeline = { blocks: [], countInBeats: 8, metronome: false, playSpeed: 1, ...p.timeline };
  p.timeline.countInBeats = num(p.timeline.countInBeats, 8, 0, 32);
  p.timeline.blocks = Array.isArray(p.timeline.blocks) ? p.timeline.blocks : [];
  for (const f of p.formations) f.positions = f.positions || {};
  const ids = new Set();
  for (const d of p.dancers) { if (!d.id || ids.has(d.id)) d.id = uid('d'); ids.add(d.id); d.role = ['M', 'F', 'X'].includes(d.role) ? d.role : 'X'; }
  const dids = new Set(p.dancers.map(d => d.id));
  p.pairs = p.pairs.filter(pp => dids.has(pp.leader) && dids.has(pp.follower));
  p.formations = p.formations.filter(f => f && f.id);
  if (!p.formations.length) p.formations.push({ id: uid('f'), name: '开场队形', color: '#64748b', note: '', positions: {} });
  for (const f of p.formations) {
    const np = {};
    for (const [k, v] of Object.entries(f.positions)) if (dids.has(k) && v && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y)) np[k] = { x: v.x, y: v.y, facing: ((v.facing || 0) % 360 + 360) % 360 };
    f.positions = np;
    // 合并单元清洗：引用有效、去重、样式合法
    if (Array.isArray(f.merges)) {
      const seen = new Set();
      f.merges = f.merges.filter(m => m && dids.has(m.a) && dids.has(m.b) && m.a !== m.b && UNIT_STYLES.includes(m.style) && !seen.has(mergeKey(m.a, m.b)) && (seen.add(mergeKey(m.a, m.b)), true)).slice(0, 32);
      if (!f.merges.length) delete f.merges;
    } else delete f.merges;
  }
  syncTimeline(p);
  return { ok: errors.length === 0, errors, project: p };
}
