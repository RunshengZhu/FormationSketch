// 音频剪辑引擎（实验分支 exp/audition-lite · 规格 docs/music-clip-ui-spec.md v3）
// 分两层：
//   纯模型操作 —— clip 的 trim/split/移动/波纹删除/自动交叉淡化/淡化包络/磁吸候选/波形包络，
//     全部纯函数（node 可测，与 DOM/WebAudio 零耦合），语义对齐 lightmix（sess_044daf25）同构实现；
//   ClipTransport —— 「A Tale of Two Clocks」双时钟调度器：25ms 轮询 + 120ms 前瞻，
//     每个 clip 只调度一次完整剩余区间（不是切片），停止统一 stop()；
//     增益自动化走 setValueCurveAtTime 分段（常量段 setValueAtTime 首尾相接，无曲线重叠）。
// 交叉淡化：等功率（sin/cos 互补，功率和恒 1）——重叠区两 clip 同时出声，波形按包络收窄。
import { uid, MIN_CLIP_DUR } from './model.js';

export { MIN_CLIP_DUR };
export const TICK_MS = 25;           // 调度轮询间隔
export const LOOKAHEAD = 0.12;       // 调度前瞻（秒）
export const START_DELAY = 0.06;     // 起播延迟（ctx 时钟锚定的提前量）
export const GAIN_MAX = 4;           // clip 增益上限（线性）
export const CLIP_COLORS = ['#38bdf8', '#0ea5e9', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b'];
export const CLIP_DEFAULT_COLOR = '#38bdf8';

const r6 = v => Math.round(v * 1e6) / 1e6;

// ---------- 基础 ----------
export function clipEnd(c) { return c.timelineStartSec + c.lengthSec; }
export function lastClipEndSec(clips) {
  let e = 0;
  for (const c of clips || []) e = Math.max(e, clipEnd(c));
  return e;
}
// 有效音频事件区间（合并重叠后的可听区间；skipMuted=true 时静音 clip 不算事件）——段间静音判定用
export function effectiveRegions(clips, { skipMuted = true } = {}) {
  const list = (clips || [])
    .filter(c => !skipMuted || !c.muted)
    .map(c => [c.timelineStartSec, clipEnd(c)])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of list) {
    if (!out.length || s > out[out.length - 1][1] + 1e-9) out.push([s, e]);
    else out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
  }
  return out;
}
// 淡化总量钳制（fadeIn+fadeOut ≤ length，超限按比例收缩）——trim/split 后调用
export function capFades(c) {
  c.fadeInSec = Math.max(0, c.fadeInSec || 0);
  c.fadeOutSec = Math.max(0, c.fadeOutSec || 0);
  const total = c.fadeInSec + c.fadeOutSec;
  if (total > c.lengthSec && total > 0) {
    const k = c.lengthSec / total;
    c.fadeInSec = r6(c.fadeInSec * k);
    c.fadeOutSec = r6(c.fadeOutSec * k);
  }
}
// 淡化包络（等功率；clip 相对时刻 t）：升= sin(x·π/2)，降 = sin(x'·π/2) —— 重叠区互补
export function fadeEnvAt(clip, t) {
  let v = 1;
  const fi = clip.fadeInSec || 0, fo = clip.fadeOutSec || 0;
  if (fi > 1e-4 && t < fi) v *= Math.sin((Math.max(0, t) / fi) * Math.PI / 2);
  if (fo > 1e-4) {
    const fromEnd = clip.lengthSec - t;
    if (fromEnd < fo) v *= Math.sin((Math.max(0, fromEnd) / fo) * Math.PI / 2);
  }
  return v;
}
// clip 相对时刻 t 的线性增益（含静音/淡化/包络，不含轨增益）
export function clipGainAt(clip, t) {
  if (clip.muted) return 0;
  return (clip.gain ?? 1) * fadeEnvAt(clip, t);
}

// ---------- 重叠 / 自动交叉淡化 ----------
// 重叠对（a 在前）：start/end 为时间线秒
export function computeOverlaps(clips) {
  const out = [];
  const list = [...(clips || [])].sort((a, b) => a.timelineStartSec - b.timelineStartSec);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const s = Math.max(a.timelineStartSec, b.timelineStartSec);
      const e = Math.min(clipEnd(a), clipEnd(b));
      if (e - s > MIN_CLIP_DUR) out.push({ a, b, start: s, end: e });
    }
  }
  return out;
}
// 移动/trim 后调用：重叠处建立等功率交叉淡化对（auto:true，拖开后自动还原）。
// 每侧 auto 淡化带对级记录 autoPair=对端 clip id（R41-D1/D2）：prune 据此只清
// 真正构成对的两端；同对先后序翻转（拖移越过对端仍重叠）时先清反向陈旧 auto 再建对。
export function applyAutoCrossfades(clips, targetIds) {
  const touched = new Set();
  const ids = targetIds instanceof Set ? targetIds : new Set(targetIds || []);
  for (const ov of computeOverlaps(clips)) {
    if (!(ids.has(ov.a.id) || ids.has(ov.b.id))) continue;
    if (ov.a.fadeInAuto && ov.a.autoPair === ov.b.id) { ov.a.fadeInSec = 0; ov.a.fadeInAuto = false; }
    if (ov.b.fadeOutAuto && ov.b.autoPair === ov.a.id) { ov.b.fadeOutSec = 0; ov.b.fadeOutAuto = false; }
    const dur = r6(ov.end - ov.start);
    ov.a.fadeOutSec = dur; ov.a.fadeOutAuto = true; ov.a.autoPair = ov.b.id;
    ov.b.fadeInSec = dur; ov.b.fadeInAuto = true; ov.b.autoPair = ov.a.id;
    capFades(ov.a); capFades(ov.b);
    touched.add(ov.a.id); touched.add(ov.b.id);
  }
  return touched;
}
// 交叉对被拖开（不再重叠）后，auto 淡化还原为 0（手动淡化不受影响）。
// 只处理与 target 构成对（任一侧 auto 淡化的 autoPair 指向对方；旧数据无 autoPair 时
// 按「先者 fadeOut × 后者 fadeIn」互补标记识别）的 other——与 target 无关的既有对
// 一律不动（R41-D1：按先后序盲清会铲掉无关对的半边、留下陈旧另一半 R41-D2）。
export function pruneAutoCrossfades(clips, targetId) {
  const cleared = new Set();
  const list = clips || [];
  const target = list.find(c => c.id === targetId);
  if (!target) return cleared;
  const clearPaired = (x, partnerId) => {   // 只清 x 侧指向 partner 的 auto 淡化
    if (x.fadeOutAuto && x.autoPair === partnerId) { x.fadeOutSec = 0; x.fadeOutAuto = false; x.autoPair = null; cleared.add(x.id); }
    if (x.fadeInAuto && x.autoPair === partnerId) { x.fadeInSec = 0; x.fadeInAuto = false; x.autoPair = null; cleared.add(x.id); }
  };
  for (const other of list) {
    if (other.id === target.id) continue;
    const s = Math.max(target.timelineStartSec, other.timelineStartSec);
    const e = Math.min(clipEnd(target), clipEnd(other));
    if (e - s > MIN_CLIP_DUR) continue;      // 仍重叠：对仍成立（时长由 apply 重算）
    if ((target.fadeInAuto || target.fadeOutAuto) && target.autoPair === other.id) clearPaired(target, other.id);
    if ((other.fadeInAuto || other.fadeOutAuto) && other.autoPair === target.id) clearPaired(other, target.id);
    const targetFirst = target.timelineStartSec < other.timelineStartSec ||
      (target.timelineStartSec === other.timelineStartSec && target.id < other.id);
    // 旧数据兼容（两侧均无 autoPair 的互补 auto 标记才视作对；链式对按方向各清各的）
    const legacy = targetFirst
      ? (target.fadeOutAuto && target.autoPair == null && other.fadeInAuto && other.autoPair == null)
      : (target.fadeInAuto && target.autoPair == null && other.fadeOutAuto && other.autoPair == null);
    if (legacy) {
      if (targetFirst && target.fadeOutAuto) { target.fadeOutSec = 0; target.fadeOutAuto = false; cleared.add(target.id); }
      if (!targetFirst && target.fadeInAuto) { target.fadeInSec = 0; target.fadeInAuto = false; cleared.add(target.id); }
      if (targetFirst && other.fadeInAuto) { other.fadeInSec = 0; other.fadeInAuto = false; cleared.add(other.id); }
      if (!targetFirst && other.fadeOutAuto) { other.fadeOutSec = 0; other.fadeOutAuto = false; cleared.add(other.id); }
    }
  }
  // target 侧 auto 淡化指向已删除的对端（ghost）→ 陈旧，一并还原
  if ((target.fadeInAuto || target.fadeOutAuto) && target.autoPair && !list.some(c => c.id === target.autoPair)) {
    clearPaired(target, target.autoPair);
  }
  return cleared;
}

// ---------- trim（Audition 式：内容锚定 / Shift 变体只改边界） ----------
// 左缘内容锚定：srcStart 与 timelineStart 同步前进（delta 克隆源时间），源内不越界
export function trimClipLeftAnchored(c, newStart, assetDur = Infinity) {
  newStart = r6(newStart);
  const delta = newStart - c.timelineStartSec;
  if (delta > 0 && c.srcStartSec + delta > (assetDur ?? Infinity) + 1e-9) return false;
  if (c.srcStartSec + delta < -1e-9) return false;          // 不能越出素材头部
  if (c.lengthSec - delta < MIN_CLIP_DUR) return false;
  if (newStart < 0) return false;
  c.srcStartSec = r6(c.srcStartSec + delta);
  c.timelineStartSec = newStart;
  c.lengthSec = r6(c.lengthSec - delta);
  capFades(c);
  return true;
}
// 左缘只改边界（Shift）：srcStart 不动，边界右移=掐掉头部（内容随之平移露出）
export function trimClipLeftBoundary(c, newStart, assetDur = Infinity) {
  newStart = r6(newStart);
  const end = clipEnd(c);
  if (newStart < 0 || end - newStart < MIN_CLIP_DUR) return false;
  if (c.srcStartSec + (end - newStart) > (assetDur ?? Infinity) + 1e-9) return false;
  c.timelineStartSec = newStart;
  c.lengthSec = r6(end - newStart);
  capFades(c);
  return true;
}
// 右缘内容锚定：length 变化（源锚定），不能越出素材尾部
export function trimClipRightAnchored(c, newEnd, assetDur = Infinity) {
  newEnd = r6(newEnd);
  const newDur = newEnd - c.timelineStartSec;
  if (newDur < MIN_CLIP_DUR) return false;
  if (c.srcStartSec + newDur > (assetDur ?? Infinity) + 1e-9) return false;
  c.lengthSec = r6(newDur);
  capFades(c);
  return true;
}
// 右缘只改边界（Shift）：同样受素材尾界约束
export function trimClipRightBoundary(c, newEnd, assetDur = Infinity) {
  return trimClipRightAnchored(c, newEnd, assetDur);
}

// ---------- split / delete / ripple ----------
// 在时刻 t 分割一个 clip，成功返回新右 clip（左侧原地收缩；数组插入右 clip 保持 z 序）
export function splitClipAt(clips, id, t) {
  const idx = (clips || []).findIndex(c => c.id === id);
  if (idx < 0) return null;
  const c = clips[idx];
  const end = clipEnd(c);
  if (t <= c.timelineStartSec + MIN_CLIP_DUR || t >= end - MIN_CLIP_DUR) return null;
  const leftDur = t - c.timelineStartSec;
  const right = {
    ...JSON.parse(JSON.stringify(c)),
    id: uid('clip'),
    timelineStartSec: r6(t),
    srcStartSec: r6(c.srcStartSec + leftDur),
    lengthSec: r6(end - t),
  };
  right.fadeInSec = Math.min(right.fadeInSec || 0, right.lengthSec);
  right.fadeInAuto = false;
  c.lengthSec = r6(leftDur);
  c.fadeOutAuto = false;
  capFades(c); capFades(right);
  clips.splice(idx + 1, 0, right);
  return right;
}
export function deleteClips(clips, ids) {
  const set = ids instanceof Set ? ids : new Set(ids || []);
  const removed = (clips || []).filter(c => set.has(c.id));
  return removed;
}
// 波纹删除：删掉后右侧（start ≥ 被删跨度右缘）clip 左移补位
export function rippleDeleteClips(clips, ids) {
  const set = ids instanceof Set ? ids : new Set(ids || []);
  const removed = (clips || []).filter(c => set.has(c.id));
  if (!removed.length) return 0;
  const minStart = Math.min(...removed.map(c => c.timelineStartSec));
  const maxEnd = Math.max(...removed.map(clipEnd));
  const span = maxEnd - minStart;
  for (const c of clips) {
    if (set.has(c.id)) continue;
    if (c.timelineStartSec >= maxEnd - 1e-9) c.timelineStartSec = r6(c.timelineStartSec - span);
  }
  return clips.filter(c => !set.has(c.id)).length;
}
// 修剪到时间选区：选中的 clip 与 [s,e] 求交（内容锚定语义），完全在外 → 删除
export function trimClipsToRange(clips, ids, s, e) {
  const set = ids instanceof Set ? ids : new Set(ids || []);
  const dropped = [];
  for (const c of [...clips]) {
    if (!set.has(c.id)) continue;
    const cs = c.timelineStartSec, ce = clipEnd(c);
    if (ce <= s + 1e-9 || cs >= e - 1e-9) { dropped.push(c.id); continue; }
    if (s > cs) trimClipLeftAnchored(c, s);
    if (clipEnd(c) > e) trimClipRightAnchored(c, e);
  }
  return dropped;
}

// ---------- 磁吸（时间域最近邻，阈值按像素换算） ----------
export function collectSnapCandidates({ clips = [], excludeId = null, playheadSec = null,
  selStartSec = null, selEndSec = null, blockSecs = [], tagSecs = [] } = {}) {
  const pts = new Set();
  const add = t => { if (Number.isFinite(t) && t >= 0) pts.add(r6(t)); };
  for (const c of clips) {
    if (c.id === excludeId) continue;
    add(c.timelineStartSec); add(clipEnd(c));
  }
  add(playheadSec);
  add(selStartSec); add(selEndSec);
  for (const t of blockSecs) add(t);
  for (const t of tagSecs) add(t);
  return [...pts].sort((a, b) => a - b);
}
export function snapTime(t, candidates, thresholdSec) {
  let best = null, bestDist = thresholdSec;
  let lo = 0, hi = candidates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (candidates[mid] < t) lo = mid + 1; else hi = mid; }
  for (const i of [lo - 1, lo]) {
    const c = candidates[i];
    if (c === undefined) continue;
    const d = Math.abs(c - t);
    if (d <= bestDist) { bestDist = d; best = c; }
  }
  return best === null ? { t, line: null } : { t: best, line: best };
}
// 零交叉吸附（消切点咔哒）：在 data[pos±radius] 内找最近方向变化点（采样点域）
export function nearestZeroCrossing(data, pos, radiusSamples) {
  if (!data || !data.length) return Math.round(pos);
  const center = Math.round(pos);
  const lo = Math.max(1, center - Math.floor(radiusSamples));
  const hi = Math.min(data.length - 1, center + Math.ceil(radiusSamples));
  let best = center, bestDist = Infinity;
  for (let i = lo; i <= hi; i++) {
    const a = data[i - 1], b = data[i];
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) {
      const d = Math.abs(i - center);
      if (d < bestDist) { bestDist = d; best = i; }
    }
  }
  return best;
}

// ---------- 波形包络（一次性计算，绘制代价与缩放无关） ----------
// bucket 样本/桶的 min/max 双数组，幅值按资产峰值归一化到 1 —— 任意缩放直接取样绘制
export function computeWaveEnvelope(buffer, bucket = 512) {
  if (!buffer || !buffer.getChannelData) return null;
  const ch0 = buffer.getChannelData(0);
  const len = ch0.length;
  const n = Math.max(1, Math.ceil(len / bucket));
  const min = new Float32Array(n), max = new Float32Array(n);
  let peak = 1e-6;
  for (let b = 0; b < n; b++) {
    const s = b * bucket, e = Math.min(len, s + bucket);
    let mn = 1, mx = -1;
    for (let i = s; i < e; i++) {
      const v = ch0[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === 1) mn = 0;
    if (mx === -1) mx = 0;
    min[b] = mn; max[b] = mx;
    const a = Math.max(Math.abs(mn), Math.abs(mx));
    if (a > peak) peak = a;
  }
  if (peak > 1e-6) for (let b = 0; b < n; b++) { min[b] /= peak; max[b] /= peak; }
  return { bucket, count: n, sampleRate: buffer.sampleRate, durationSec: buffer.duration, min, max };
}
// 任意 [srcStart, srcStart+len] 秒区间在 x 像素列的包络取样（envelope + 区间 → 列值）
export function envAt(env, srcSec) {
  if (!env || !(srcSec >= 0) || srcSec > env.durationSec) return 0;
  const i = Math.floor(srcSec * env.sampleRate / env.bucket);
  if (!Number.isFinite(i)) return 0;
  const k = Math.max(0, Math.min(env.count - 1, i));
  return Math.max(Math.abs(env.min[k]), Math.abs(env.max[k]));
}

// ---------- ClipTransport：双时钟调度器 ----------
// 语义：position = startPos + (ctx.currentTime - startCtxTime)；clip 调度以「时间轴秒」为域，
// 进 clip → 起 BufferSource（srcStart+偏移），出 clip / 段间静音 → 不调度（自然静音）。
// 淡化/增益/静音/等功率交叉淡化全部经 Gain 自动化表达（调度时点快照；live 编辑走 reschedule）。
export class ClipTransport {
  constructor({ getContext, destination }) {
    this.getContext = getContext;   // () => AudioContext（懒建）
    this.destination = destination; // 恒为 ctx.destination
    this.playing = false;
    this._timer = null;
    this._sources = [];
    this._gains = [];
    this._scheduled = new Set();
    this._clips = [];
    this._resolveBuffer = () => null; // assetId → AudioBuffer | null
    this.trackGainVal = 1;            // 轨音量（0..1 线性，C15）
    this.trackMuted = false;
    this.master = null;
    this.startPos = 0;
    this.startCtxTime = 0;   // 调度锚（含 START_DELAY：源起播提前量）
    this._clockCtxTime = 0;  // 走带时钟锚（无延迟：position 立即从 from 前进，beat 不回落 0）
    this.rate = 1;
  }
  _ensureMaster(ctx) {
    if (!this.master || this.master.context !== ctx) {
      const dest = typeof this.destination === 'function' ? this.destination() : this.destination;
      this.master = ctx.createGain();
      this.master.gain.value = this.trackMuted ? 0 : this.trackGainVal;
      if (dest) this.master.connect(dest);
    }
    return this.master;
  }
  setTrackGain(g) {
    this.trackGainVal = Math.max(0, Math.min(2, Number(g) || 0));
    if (this.master) this.master.gain.setTargetAtTime(this.trackMuted ? 0 : this.trackGainVal, this.master.context.currentTime, 0.01);
  }
  setTrackMuted(m) {
    this.trackMuted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.trackMuted ? 0 : this.trackGainVal, this.master.context.currentTime, 0.01);
  }
  get position() {
    if (!this.playing || !this.master) return this.startPos;
    // 走带时钟与调度锚分离：position 立即从 startPos 前进（START_DELAY 窗口内不回落 0，
    // 否则 seek/循环回卷后 beat 瞬时归 0 → 队形跟随/循环区间被改写；S3-06/M6 回归）
    return Math.max(0, this.startPos + (this.master.context.currentTime - this._clockCtxTime));
  }
  play(clips, { from = 0, rate = 1, resolveBuffer = this._resolveBuffer } = {}) {
    const ctx = this.getContext();
    if (!ctx) return false;
    this.stopInternal();
    this._clips = clips || [];
    this._resolveBuffer = resolveBuffer || this._resolveBuffer;
    this.rate = Math.max(0.25, Math.min(4, rate || 1));
    this.startPos = Math.max(0, from || 0);
    this._ensureMaster(ctx);
    this.startCtxTime = ctx.currentTime + START_DELAY;
    this._clockCtxTime = ctx.currentTime;
    this._scheduled.clear();
    this.playing = true;
    this.tick();
    this._timer = setInterval(() => this.tick(), TICK_MS);
    return true;
  }
  // live 编辑（淡化/增益/静音/结构变化在守卫暂停后）后重调度：从当前位置无缝续走
  reschedule(clips, rate = this.rate) {
    if (!this.playing) return;
    const pos = this.position;
    this.play(clips || this._clips, { from: pos, rate, resolveBuffer: this._resolveBuffer });
  }
  stop() {
    const pos = this.position;
    this.stopInternal();
    this.startPos = pos;
    return pos;
  }
  stopInternal() {
    if (this._timer !== null) { clearInterval(this._timer); this._timer = null; }
    for (const s of this._sources) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} }
    for (const g of this._gains) { try { g.disconnect(); } catch {} }
    this._sources = []; this._gains = [];
    this._scheduled.clear();
    this.playing = false;
  }
  ctxTimeOf(tlSec) { return this.startCtxTime + (tlSec - this.startPos); }
  tick() {
    if (!this.playing || !this.master) return;
    const ctx = this.master.context;
    const pos = Math.max(0, this.position);
    const horizon = pos + LOOKAHEAD + (this.startCtxTime - ctx.currentTime > 0 ? START_DELAY : 0);
    const clips = [...this._clips].sort((a, b) => a.timelineStartSec - b.timelineStartSec);
    for (const clip of clips) {
      if (clip.timelineStartSec > horizon) break;
      if (this._scheduled.has(clip.id)) continue;
      const end = clipEnd(clip);
      if (end <= pos + 1e-4) { this._scheduled.add(clip.id); continue; }
      this._scheduled.add(clip.id);
      if (clip.muted) continue;
      const buffer = this._resolveBuffer(clip.assetId);
      if (!buffer) continue;
      const tlStart = Math.max(clip.timelineStartSec, pos);
      if (end - tlStart <= 1e-3) continue;
      this.scheduleClip(ctx, clip, buffer, tlStart, end);
    }
  }
  // 调度一个 clip 的剩余区间：源偏移 + 分段增益自动化（fade 段 setValueCurveAtTime）
  scheduleClip(ctx, clip, buffer, tlStart, tlEnd) {
    const when = Math.max(this.ctxTimeOf(tlStart), ctx.currentTime + 0.005);
    const skip = Math.max(0, tlStart - clip.timelineStartSec);
    const durTl = tlEnd - tlStart;
    if (durTl <= 1e-3) return;
    const srcOffset = clip.srcStartSec + skip * this.rate;
    if (buffer.duration - srcOffset <= 1e-4) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (this.rate !== 1) src.playbackRate.value = this.rate;
    const gain = ctx.createGain();
    src.connect(gain); gain.connect(this.master);
    this.applyGainAutomation(gain.gain, clip, skip, skip + durTl, ct => when + (ct - skip));
    src.start(when, srcOffset, durTl * this.rate);
    this._sources.push(src); this._gains.push(gain);
  }
  // 分段增益自动化：常量段 setValueAtTime、淡化段 setValueCurveAtTime(96 点)，首尾相接无重叠
  applyGainAutomation(param, clip, tStart, tEnd, ctxOf) {
    const inEnd = clip.fadeInSec || 0;
    const outStart = clip.lengthSec - (clip.fadeOutSec || 0);
    const pushCurve = (a, b) => {
      const n = 96;
      const arr = new Float32Array(n);
      for (let i = 0; i < n; i++) arr[i] = clipGainAt(clip, a + ((b - a) * i) / (n - 1));
      try {
        param.setValueAtTime(arr[0], ctxOf(a));
        param.setValueCurveAtTime(arr, ctxOf(a), b - a);
      } catch { /* 曲线竞争：忽略 */ }
    };
    let cursor = tStart;
    if (tStart < inEnd - 1e-6) {
      const b = Math.min(tEnd, inEnd);
      pushCurve(tStart, b);
      cursor = b;
    } else {
      try { param.setValueAtTime(clipGainAt(clip, tStart), ctxOf(tStart)); } catch {}
    }
    const midEnd = Math.min(tEnd, Math.max(cursor, outStart));
    if (midEnd > cursor + 1e-6) {
      try { param.setValueAtTime(clipGainAt(clip, cursor + 1e-6), ctxOf(cursor)); } catch {}
      cursor = midEnd;
    }
    if (cursor < tEnd - 1e-6) pushCurve(cursor, tEnd);
  }
}

// ---------- 「按队形段自动切」（C18/P1 纯函数部分） ----------
// times=[{t, fade}]：块边界（时间线秒）+ 过渡拍时长；assetDurOf(assetId)→素材秒长。
// 逐边界：跨边界 clip 分割 → 相邻对交叉淡化（前段右延 fade/2、后段左移 fade/2，
// 淡化中点恰落在边界；源界/时间轴零点约束下钳制）。重复执行幂等（已切边界跳过）。
export function autoSplitAtBoundaries(clips, times, assetDurOf = () => Infinity) {
  let splits = 0, fades = 0;
  const sorted = [...times].sort((a, b) => a.t - b.t);
  for (const { t, fade } of sorted) {
    // 已有 clip 缘恰在该点（±1ms）或该点落在既有淡化重叠区内 → 视为已处理（幂等）
    const atEdge = clips.some(c => Math.abs(c.timelineStartSec - t) < 1e-3 || Math.abs(clipEnd(c) - t) < 1e-3);
    const inFadedOverlap = computeOverlaps(clips).some(ov =>
      (ov.a.fadeOutSec || 0) > 0.005 && t > ov.start + 1e-3 && t < ov.end - 1e-3);
    let left = null;
    if (!atEdge && !inFadedOverlap) {
      const idx = clips.findIndex(c => t > c.timelineStartSec + MIN_CLIP_DUR && t < clipEnd(c) - MIN_CLIP_DUR);
      if (idx < 0) continue;
      const srcClip = clips[idx];
      const rightNew = splitClipAt(clips, srcClip.id, t);
      if (!rightNew) continue;
      // 新右段继承的 fadeIn 来自边界左侧上下文（与本边界无关）→ 清零，交由本边界新建交叉淡化
      rightNew.fadeInSec = 0;
      rightNew.fadeInAuto = false;
      splits++;
    }
    left = clips.find(c => Math.abs(clipEnd(c) - t) < 1e-3 + 0.05) || null; // 淡化中点=边界：左段缘=边界±f/2
    if (!left || !(fade > 0.005)) continue;
    // 相邻右 clip：起点在边界附近（≤ left 终点邻域）
    const right = clips.find(c => c !== left && c.timelineStartSec > left.timelineStartSec
      && c.timelineStartSec <= clipEnd(left) + 1e-3) || null;
    if (!right) continue;
    // 已有淡化 → 幂等跳过
    if (left.fadeOutSec > 0.005 || right.fadeInSec > 0.005) continue;
    const assetDur = assetDurOf(left.assetId);
    // 交叉淡化：前段右延 f/2（源界内）、后段左移 f/2 且源入点同步前进 f/2（内容连续，
    // 淡化中点恰落在边界）；f 钳制在两侧半长与源界内
    const growRoom = assetDur - (left.srcStartSec + left.lengthSec);
    let f = Math.min(fade, left.lengthSec / 2, right.lengthSec / 2);
    if (growRoom < f / 2) f = growRoom * 2 > 0.02 ? growRoom * 2 : 0;
    if (f < 0.01) continue;
    if (!trimClipRightAnchored(left, clipEnd(left) + f / 2, assetDur)) f = Math.max(0.01, Math.min(f, right.timelineStartSec));
    if (right.timelineStartSec >= f / 2 && right.srcStartSec + right.lengthSec - f / 2 <= assetDur + 1e-6) {
      right.timelineStartSec = r6(right.timelineStartSec - f / 2);
      right.srcStartSec = r6(right.srcStartSec + f / 2);   // 内容锚定：左移边界=露出更晚源内容
      right.lengthSec = r6(right.lengthSec - f / 2);
    } else {
      continue;
    }
    left.fadeOutSec = r6(f); left.fadeOutAuto = false;
    right.fadeInSec = r6(f); right.fadeInAuto = false;
    capFades(left); capFades(right);
    fades++;
  }
  return { splits, fades };
}
