// 音频剪辑引擎（实验分支 exp/audition-lite · 规格 docs/music-clip-ui-spec.md v3）
// 分两层：
//   纯模型操作 —— clip 的 trim/split/移动/波纹删除/自动交叉淡化/淡化包络/磁吸候选/波形包络，
//     全部纯函数（node 可测，与 DOM/WebAudio 零耦合），语义对齐 lightmix（sess_044daf25）同构实现；
//   ClipTransport —— 「A Tale of Two Clocks」双时钟调度器：25ms 轮询 + 120ms 前瞻，
//     每个 clip 只调度一次完整剩余区间（不是切片），停止统一 stop()；
//     增益自动化走 setValueCurveAtTime 分段（常量段 setValueAtTime 首尾相接，无曲线重叠）。
// 交叉淡化：等功率（sin/cos 互补，功率和恒 1）——重叠区两 clip 同时出声，波形按包络收窄。
//   build-45 起淡化曲线可调（fadeInCurve/fadeOutCurve ∈ [-1,1]，0=等功率缺省，见 fadeEnvAt）；
//   自动交叉淡化只发生在**同轨**重叠对之间（computeOverlaps 同轨过滤，F1 规格变更）。
// 多轨（R47）：数据模型在 model.js（timeline.tracks + clip.trackId）；引擎侧每轨一条持久
// Gain 子链挂既有 master 入口（syncTracks/setTrackGainById/setTrackMutedById），未激活时
// 链路与旧版逐字节一致（audio.js 与 main.js 均零改动）。
import { uid, MIN_CLIP_DUR, DEFAULT_TRACK_ID, clampCurve } from './model.js';
// clip 变速（保音高 TSM）+ 变调（半音）processed 消费（语义契约归 clip-process.js · 并行交付）：
// needsProcess(clip)=speed≠1||semi≠0；processed buffer 时长=源/speed（已烘焙变速），1:1 播放/混音。
import { needsProcess, clipProcessKey } from './clip-process.js';

export { MIN_CLIP_DUR };
export const TICK_MS = 25;           // 调度轮询间隔
export const LOOKAHEAD = 0.12;       // 调度前瞻（秒）
export const START_DELAY = 0.06;     // 起播延迟（秒）
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
// 指定轨最后 clip 的终点秒（该轨无 clip=0）——媒体库「＋ 添加」点击快速放置的落点计算
//（build-42-sidebar）：新增 clip 追在第一轨末尾，不依赖拖拽精度。clip.trackId 缺失按
// DEFAULT_TRACK_ID 归一（与 model.trackOfClip / 引擎 _trackIdOf 同口径），纯函数 node 可测。
export function trackEndSec(clips, trackId) {
  let e = 0;
  for (const c of clips || []) {
    if ((c.trackId || DEFAULT_TRACK_ID) !== trackId) continue;
    e = Math.max(e, clipEnd(c));
  }
  return e;
}
// ---------- ⏮⏭ clip 缘步进（音乐模式重定位 M3 · 决策①正式实装） ----------
// 音乐模式 ⏮/⏭ = 前后 clip 缘步进（经典 DAW 语义）：全部 clip 的起点/终点缘升序去重后，
// 取当前秒位**严格**前/后的最近缘（恰停在缘上时跳过自身）；dir<0 无前缘=0、dir>0 无后缘=
// 域尾（domainEndSec）。纯函数（node 可测）；秒→拍换算与 seek 由调用方承担。
export function clipEdgeStepSec(clips, curSec, domainEndSec, dir) {
  const edges = [];
  for (const c of clips || []) {
    const s = r6(Number(c.timelineStartSec) || 0);
    const e = r6(clipEnd(c) || 0);
    if (Number.isFinite(s)) edges.push(s);
    if (Number.isFinite(e)) edges.push(e);
  }
  edges.sort((a, b) => a - b);
  const cur = Number(curSec) || 0;
  const EPS = 1e-6;
  if (dir < 0) {
    let prev = 0;
    for (const e of edges) if (e < cur - EPS) prev = e; // 升序末个命中=最近前缘；无缘=0
    return prev;
  }
  for (const e of edges) if (e > cur + EPS) return e;   // 升序首个命中=最近后缘
  return Math.max(0, Number(domainEndSec) || 0);        // 无后缘=域尾
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
// ---------- 淡化曲线（build-45-fadecurve） ----------
// 曲线参数 k ∈ [-1,1] 存于 clip.fadeInCurve / clip.fadeOutCurve，缺省 0 = 既有等功率 sin
//（旧项目/旧 JSON 无该字段 → 读作 0，零迁移成本）。实现为「相位弯曲」：
//   p = 2^k ∈ [0.5, 2]；淡入 v = sin(θ^p · π/2)（θ = t/fadeInSec），
//   淡出 v = sin(θ'^p · π/2)（θ' = fromEnd/fadeOutSec）。
// k=0 → p=1 → θ^1 逐位等于 θ（此处显式走 p===1 快路，不经 Math.pow，保证与旧公式逐位一致）。
// 听感方向（以公式实际行为为准）：
//   淡入：k>0（p>1）→ θ^p<θ，前段增益更低 —— 渐强「起步更慢」，末段快速补齐（慢进快出型）；
//         k<0（p<1）→ θ^p>θ，前段增益更快爬起 —— 渐强「起步更快」，后段趋缓（快进型）。
//   淡出：θ' 自 1 递减到 0，k>0 → θ'^p<θ'，衰减起点即快速下坠 —— 渐弱「起步更急」；
//         k<0 → 前段维持较久、末段才快速归零 —— 渐弱「拖尾更缓」。
// 等功率互补性：k=0 时 sin²+cos²=1（重叠区两 clip 功率和恒 1，既有保证）；k≠0 时为风格化
// 曲线，功率和不再恒 1（用户显式调曲线即接受此听感）。
export function fadePow(k) {
  const kc = Math.max(-1, Math.min(1, Number(k) || 0));
  return Math.pow(2, kc);
}
// 单缘相位弯曲包络：th ∈ [0,1]（淡入=已进行比例 / 淡出=距终点比例），k=缘曲线参数。
// th 先钳 [0,1] 再弯曲（p===1 时钳制对域内值恒等，不破坏 k=0 逐位兼容）。
// 抽成纯函数供 fadeEnvAt 与时间线曲线绘制（视觉与听感同源）共用。
export function fadeEdgeEnv(th, k) {
  const p = fadePow(k);
  const tc = Math.max(0, Math.min(1, th));
  const bent = p === 1 ? tc : Math.pow(tc, p);
  return Math.sin(bent * Math.PI / 2);
}
// 淡化包络（clip 相对时刻 t）：升= sin(θ^p·π/2)，降 = sin(θ'^p·π/2) —— 重叠区 k=0 时互补
export function fadeEnvAt(clip, t) {
  let v = 1;
  const fi = clip.fadeInSec || 0, fo = clip.fadeOutSec || 0;
  if (fi > 1e-4 && t < fi) v *= fadeEdgeEnv(Math.max(0, t) / fi, clip.fadeInCurve);
  if (fo > 1e-4) {
    const fromEnd = clip.lengthSec - t;
    if (fromEnd < fo) v *= fadeEdgeEnv(Math.max(0, fromEnd) / fo, clip.fadeOutCurve);
  }
  return v;
}
// clip 相对时刻 t 的线性增益（含静音/淡化/包络，不含轨增益）
export function clipGainAt(clip, t) {
  if (clip.muted) return 0;
  return (clip.gain ?? 1) * fadeEnvAt(clip, t);
}

// ---------- 重叠 / 自动交叉淡化 ----------
// 重叠对（a 在前）：start/end 为时间线秒。
// build-45 规格变更（F1）：只配对**同轨**重叠（trackId 归一口径与 trackOfClip/_trackIdOf 一致：
// 缺失/未设回落 DEFAULT_TRACK_ID）。跨轨重叠是多轨叠层的正当用法（如整曲垫底+点缀音效），
// 自动淡化干预反而破坏分层混音——旧实现（裁定③「不加轨过滤」）自本版起退役：跨轨重叠零
// 自动干预，亦不画交叉淡化手柄/曲线。纯函数 node 可测。
const trackIdOf = c => (c && c.trackId) || DEFAULT_TRACK_ID;
export function computeOverlaps(clips) {
  const out = [];
  const list = [...(clips || [])].sort((a, b) => a.timelineStartSec - b.timelineStartSec);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (trackIdOf(a) !== trackIdOf(b)) continue;   // 同轨限定（build-45 F1）
      const s = Math.max(a.timelineStartSec, b.timelineStartSec);
      const e = Math.min(clipEnd(a), clipEnd(b));
      if (e - s > MIN_CLIP_DUR) out.push({ a, b, start: s, end: e });
    }
  }
  return out;
}
// 移动/trim 后调用：重叠处建立等功率交叉淡化对（auto:true，拖开后自动还原）。
// 每侧 auto 淡化带「缘级」对端记录（R47 双缘升级）：autoPairOut=淡出缘对端（本 clip 较早、
// 对端较晚）、autoPairIn=淡入缘对端（本 clip 较晚、对端较早）——链式三 clip（A-B、B-C 共享 B）
// 下 B 的两条缘各自独立记录，单字段 autoPair（已废弃但保留为兼容镜像，语义=末次写入的对端）
// 会互相覆写导致拖 C 误清 A-B 对；prune 据双缘精确匹配，只清真正构成对的那条缘。
// build-45（F5）：重建对只写淡化**时长**（=重叠时长，交叉时间继续自动跟随），不动
// fadeInCurve/fadeOutCurve——接缝曲线是用户可调的风格参数，重排/重配对不该悄悄抹掉。
export function applyAutoCrossfades(clips, targetIds) {
  const touched = new Set();
  const ids = targetIds instanceof Set ? targetIds : new Set(targetIds || []);
  for (const ov of computeOverlaps(clips)) {
    if (!(ids.has(ov.a.id) || ids.has(ov.b.id))) continue;
    // 既有 auto 对与本对同缘匹配 → 先还原（先后序翻转的陈旧反向缘；按缘精确匹配；曲线随缘还原）
    if (ov.a.fadeInAuto && ov.a.autoPairIn === ov.b.id) { ov.a.fadeInSec = 0; ov.a.fadeInAuto = false; ov.a.fadeInCurve = 0; }
    if (ov.b.fadeOutAuto && ov.b.autoPairOut === ov.a.id) { ov.b.fadeOutSec = 0; ov.b.fadeOutAuto = false; ov.b.fadeOutCurve = 0; }
    const dur = r6(ov.end - ov.start);
    ov.a.fadeOutSec = dur; ov.a.fadeOutAuto = true; ov.a.autoPairOut = ov.b.id; ov.a.autoPair = ov.b.id;
    ov.b.fadeInSec = dur; ov.b.fadeInAuto = true; ov.b.autoPairIn = ov.a.id; ov.b.autoPair = ov.a.id;
    capFades(ov.a); capFades(ov.b);
    touched.add(ov.a.id); touched.add(ov.b.id);
  }
  return touched;
}
// 交叉对被拖开（不再重叠）后，auto 淡化还原为 0（手动淡化不受影响）。
// R47 双缘升级：优先按缘级记录（autoPairOut/autoPairIn）精确匹配清除——只清真正指向
// 对方的那条缘，链式共享中段 clip（同时持有 in/out 两条缘）的另一对不受扰；仅当两侧
// 均无双缘记录（旧数据未过 validate 迁移）才回退旧「互补 auto 标记」启发式（R41-D1：
// 与 target 无关的既有对一律不动；R41-D2：半边污染的陈旧 auto 淡化整体还原）。
// 按缘清除 auto 淡化（build-45 起模块级共享：pruneAutoCrossfades 与 resetClipFades 同路，
// 保证「淡化归零」与拖开还原的簿记逐字节一致）。只清 x 上指向 partner 的那条 auto 缘
//（out=淡出缘、in=淡入缘）；曲线随缘一并归 0（时长已 0 的曲线是惰性字段，不留陈旧形状）；
// 兼容镜像 autoPair 同步。
function clearAutoEdge(x, edge, partnerId, cleared) {
  if (edge === 'out' && x.fadeOutAuto && x.autoPairOut === partnerId) {
    x.fadeOutSec = 0; x.fadeOutAuto = false; x.fadeOutCurve = 0; x.autoPairOut = null;
    if (x.autoPair === partnerId) x.autoPair = null;
    cleared.add(x.id);
  }
  if (edge === 'in' && x.fadeInAuto && x.autoPairIn === partnerId) {
    x.fadeInSec = 0; x.fadeInAuto = false; x.fadeInCurve = 0; x.autoPairIn = null;
    if (x.autoPair === partnerId) x.autoPair = null;
    cleared.add(x.id);
  }
}
export function pruneAutoCrossfades(clips, targetId) {
  const cleared = new Set();
  const list = clips || [];
  const target = list.find(c => c.id === targetId);
  if (!target) return cleared;
  const clearEdge = (x, edge, partnerId) => clearAutoEdge(x, edge, partnerId, cleared);
  const hasDual = x => x.autoPairOut != null || x.autoPairIn != null;
  for (const other of list) {
    if (other.id === target.id) continue;
    const s = Math.max(target.timelineStartSec, other.timelineStartSec);
    const e = Math.min(clipEnd(target), clipEnd(other));
    if (e - s > MIN_CLIP_DUR) continue;      // 仍重叠：对仍成立（时长由 apply 重算）
    clearEdge(target, 'out', other.id); clearEdge(target, 'in', other.id);
    clearEdge(other, 'out', target.id); clearEdge(other, 'in', target.id);
    if (!hasDual(target) && !hasDual(other)) {
      // 旧数据兼容（两侧均无双缘记录时才用互补 auto 标记识别；链式对按方向各清各的）
      const targetFirst = target.timelineStartSec < other.timelineStartSec ||
        (target.timelineStartSec === other.timelineStartSec && target.id < other.id);
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
  }
  // target 侧 auto 缘指向已删除的对端（ghost）→ 陈旧，一并还原（双缘 + 旧单字段两条路）
  if (target.fadeOutAuto && target.autoPairOut && !list.some(c => c.id === target.autoPairOut)) {
    clearEdge(target, 'out', target.autoPairOut);
  }
  if (target.fadeInAuto && target.autoPairIn && !list.some(c => c.id === target.autoPairIn)) {
    clearEdge(target, 'in', target.autoPairIn);
  }
  if ((target.fadeInAuto || target.fadeOutAuto) && target.autoPair && !list.some(c => c.id === target.autoPair)) {
    // 旧格式幽灵：双缘未覆盖的残留 auto 缘一并还原（镜像记录清空）
    if (target.fadeOutAuto && target.autoPairOut == null) { target.fadeOutSec = 0; target.fadeOutAuto = false; cleared.add(target.id); }
    if (target.fadeInAuto && target.autoPairIn == null) { target.fadeInSec = 0; target.fadeInAuto = false; cleared.add(target.id); }
    target.autoPair = null;
  }
  return cleared;
}

// ---------- 接缝曲线 / 淡化归零（build-45-fadecurve · 纯函数 node 可测） ----------
// 接缝把手（同轨 auto 交叉对）纵向拖：前 clip fadeOutCurve 与后 clip fadeInCurve **同调**写
// 同一 k（[-1,1] 外收界）——交叉时长（fadeOutSec/fadeInSec=重叠时长）不动、auto 标志不解除
// （曲线调整不改交叉时间，时长仍由 applyAutoCrossfades 随重叠自动联动）。a=前（淡出缘）、
// b=后（淡入缘）；返回收界后的 k（调用方可回写 UI 态）。
export function setSeamCurves(a, b, k) {
  const kc = clampCurve(k);
  if (a) a.fadeOutCurve = kc;
  if (b) b.fadeInCurve = kc;
  return kc;
}
// 「淡化归零」（F6 菜单）：targetId 的 fadeIn/fadeOut 长度与曲线全清零。auto 配对缘不走
// 直接抹字段——复用 prune 同款 clearAutoEdge（双缘记录/兼容镜像一并清理），且对端回指缘
//（a.autoPairOut=b ⇔ b.autoPairIn=a）同步还原，整对干净解绑；手动缘直接清零。
// 返回被清理的 clip id 集合（含对端），与 prune 的 cleared 同口径。
export function resetClipFades(clips, targetId) {
  const cleared = new Set();
  const list = clips || [];
  const target = list.find(c => c.id === targetId);
  if (!target) return cleared;
  const byId = new Map(list.map(c => [c.id, c]));
  // 先还原对端回指缘（须在清 target 双缘记录之前查，否则对端 id 已不可考）
  const outPartner = target.fadeOutAuto ? byId.get(target.autoPairOut) : null;
  const inPartner = target.fadeInAuto ? byId.get(target.autoPairIn) : null;
  if (outPartner) clearAutoEdge(outPartner, 'in', target.id, cleared);
  if (inPartner) clearAutoEdge(inPartner, 'out', target.id, cleared);
  clearAutoEdge(target, 'out', target.autoPairOut, cleared);
  clearAutoEdge(target, 'in', target.autoPairIn, cleared);
  // 对记录无条件收口：缘已清/转手动后残留的 autoPairOut/autoPairIn/autoPair 一并抹掉
  //（含「手动缘挂陈旧对记录」的污染形态；幽灵对端上方 clearAutoEdge 已按记录匹配清除）
  target.autoPairOut = null; target.autoPairIn = null; target.autoPair = null;
  // 手动缘与曲线：无条件全清零（auto 缘已被 clearAutoEdge 清过，此处幂等收口）
  target.fadeInSec = 0; target.fadeOutSec = 0;
  target.fadeInCurve = 0; target.fadeOutCurve = 0;
  target.fadeInAuto = false; target.fadeOutAuto = false;
  cleared.add(target.id);
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
// bucket 样本/桶的 min/max 双数组，幅值按资产峰值归一化到 1 —— 任意缩放直接取样绘制。
// peak 一并返回（build-52-wavezoom F4）：深放大的样本直读路径用同一峰值归一化，与 env 聚合
// 路径幅度同域——任一时间点幅度在不同缩放下固定（不重算峰值，O(1) 取用）。
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
  return { bucket, count: n, sampleRate: buffer.sampleRate, durationSec: buffer.duration, min, max, peak };
}
// 任意 [srcStart, srcStart+len] 秒区间在 x 像素列的包络取样（envelope + 区间 → 列值）
export function envAt(env, srcSec) {
  if (!env || !(srcSec >= 0) || srcSec > env.durationSec) return 0;
  const i = Math.floor(srcSec * env.sampleRate / env.bucket);
  if (!Number.isFinite(i)) return 0;
  const k = Math.max(0, Math.min(env.count - 1, i));
  return Math.max(Math.abs(env.min[k]), Math.abs(env.max[k]));
}

// ---------- build-52-wavezoom F4：逐列真 min/max（波形稳定幅度 + 深放大变细） ----------
// 列宽扫描上限（任务裁定）：env 桶聚合路径每列 ≤64 桶、样本直读路径每列 ≤64 样本——
// 单帧总扫描量 = 可视列数 × 64，有界（低倍粗粒度退化为桶 stride 采样聚合，视觉等价）。
export const WAVE_COL_MAX_STRIDE = 64;
// 单列 [t0,t1) 秒区间的真实 [min,max]（归一化幅值域，与 env 同一口径）：
//  - env 存在且列宽 ≥ 桶时长：聚合覆盖的 env 桶 k0..k1（min of min / max of max）；
//    桶数 > 上限时按桶 stride 采样聚合（≤64 桶/列）。
//  - env 存在且列宽 < 桶时长（深放大）：直读 data 对应样本区间（stride=max(1, floor(n/64))，
//    含末样本）取真 min/max，再按 env.peak 归一化——亚桶粒度仍有真实细节，与粗粒度同域。
//  - env 缺失 + data 存在：样本路径（peak=1 原值域，无归一化基准）。
//  - env 存在 + data 缺失：亚桶列回退为所在单桶（envAt 同口径，桶定幅度=稳定）。
//  - 两者皆缺：null（调用方画 0.14 兜底平线）。
// 边界：t0<0 钳 0、t1>时长钳时长、零宽/逆序列=[0,0]；sr 缺省取 env.sampleRate。
// 纯函数（node 可测）：同输入恒同输出——同一时间点的列幅度只由其覆盖区间决定，与缩放历次
// 状态无关（旧实现单点 envAt 取样随缩放漂移的根因即在此）。
export function columnMinMax(env, data, t0, t1, sr) {
  if (!(sr > 0)) sr = env?.sampleRate || 44100;
  const dur = env?.durationSec;
  let a = Number(t0), b = Number(t1);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return env || data ? [0, 0] : null;
  if (Number.isFinite(dur)) b = Math.min(b, dur);
  if (a < 0) a = 0;
  if (!(b > a)) return [0, 0];
  if (env && (b - a) >= env.bucket / (env.sampleRate || sr)) {
    const esr = env.sampleRate || sr;
    let k0 = Math.floor(a * esr / env.bucket);
    let k1 = Math.ceil(b * esr / env.bucket);      // 右开（首尾跨桶各计一次）
    k0 = Math.max(0, Math.min(env.count - 1, k0));
    k1 = Math.max(0, Math.min(env.count, k1));
    if (k1 <= k0) k1 = k0 + 1;
    const stride = Math.max(1, Math.ceil((k1 - k0) / WAVE_COL_MAX_STRIDE));
    let mn = 1, mx = -1;
    for (let k = k0; k < k1; k += stride) {
      if (env.min[k] < mn) mn = env.min[k];
      if (env.max[k] > mx) mx = env.max[k];
    }
    if (mn === 1) mn = 0;
    if (mx === -1) mx = 0;
    return [mn, mx];
  }
  if (data && data.length) {
    const i0 = Math.max(0, Math.floor(a * sr));
    const i1 = Math.min(data.length, Math.ceil(b * sr));
    const n = i1 - i0;
    if (n <= 0) return [0, 0];
    const stride = Math.max(1, Math.floor(n / WAVE_COL_MAX_STRIDE));
    let mn = 1, mx = -1;
    for (let i = i0; i < i1; i += stride) {
      const v = data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const vl = data[i1 - 1]; // stride 跳过的末样本补一次（区间右缘真值）
    if (vl < mn) mn = vl;
    if (vl > mx) mx = vl;
    const peak = env && Number.isFinite(env.peak) && env.peak > 1e-6 ? env.peak : 1;
    return [mn / peak, mx / peak];
  }
  if (env) { // 亚桶列且无原始数据：所在单桶（桶定幅度，缩放间稳定）
    const k = Math.max(0, Math.min(env.count - 1, Math.floor(a * (env.sampleRate || sr) / env.bucket)));
    return [env.min[k], env.max[k]];
  }
  return null;
}

// ---------- ClipTransport：双时钟调度器 ----------
// 语义：position = startPos + (ctx.currentTime - startCtxTime)；clip 调度以「时间线秒」为域，
// 进 clip → 起 BufferSource（srcStart+偏移），出 clip / 段间静音 → 不调度（自然静音）。
// 淡化/增益/静音/等功率交叉淡化全部经 Gain 自动化表达（调度时点快照；live 编辑走 reschedule）。
// 多轨（R47）：syncTracks(tracks)/play({tracks}) 激活后，每轨一条持久 Gain 子链
//   src → clipGain → trackGain(id) → master → destination，轨 gain×muted 在子链上表达
//   （轨静音=子链增益 0，实时生效无需 reschedule；轨 gain 变更 setTargetAtTime 平滑）。
//   未激活（_tracks=null，既止单轨调用面）保持 clipGain 直连 master 的原链路，逐字节兼容。
//   旧 setTrackGain/setTrackMuted（C15 单轨总控）不动：作用在 master 上，多轨下为全局微调。
export class ClipTransport {
  // resolveProcessed（可选）：(clip) → processed buffer | Promise<buffer> | null——clip.speed/
  //   pitchSemi 的 TSM 产物供给方（缺省 null=全走既有 raw 路径，行为零变化）。
  constructor({ getContext, destination, resolveProcessed = null }) {
    this.getContext = getContext;   // () => AudioContext（懒建）
    this.destination = destination; // 恒为 ctx.destination
    this.playing = false;
    this._timer = null;
    this._sources = [];
    this._gains = [];
    this._scheduled = new Set();
    this._clips = [];
    this._resolveBuffer = () => null; // assetId → AudioBuffer | null
    this.resolveProcessed = resolveProcessed;         // (clip) → processed | Promise | null
    this._processedCache = new Map();                 // assetId|processKey → processed buffer（同步命中免重复处理）
    this._pendingProcessed = new Set();               // 处理中的 key（防同键重复挂 Promise/重复重调度）
    this.trackGainVal = 1;            // 轨音量（0..1 线性，C15；多轨下=master 总控）
    this.trackMuted = false;
    this.master = null;
    this._tracks = null;              // 多轨态（项目 timeline.tracks 引用形态）；null=legacy 单链
    this._trackGains = new Map();     // trackId → GainNode（每轨持久子链）
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
  // ---- 多轨子链 ----
  // clip 归属轨 id：trackId 缺失/悬挂回落首轨（与 model.trackOfClip 同口径）
  _trackIdOf(clip) {
    if (!this._tracks) return null;
    const id = clip && clip.trackId;
    return (id && this._tracks.some(t => t.id === id)) ? id : this._tracks[0].id;
  }
  _ensureTrackGain(ctx, trackId) {
    let g = this._trackGains.get(trackId);
    if (!g || g.context !== ctx) {
      const t = (this._tracks || []).find(x => x.id === trackId);
      g = ctx.createGain();
      g.gain.value = (t && t.muted) ? 0 : ((t && t.gain) ?? 1);
      g.connect(this._ensureMaster(ctx));
      this._trackGains.set(trackId, g);
    }
    return g;
  }
  // 同步项目轨态到子链（loadProject/轨结构变化后调用）：gain/muted 实时平滑生效；
  // tracks 空/非数组 → 拆子链回 legacy 单链。删除的轨断开其子链。
  syncTracks(tracks) {
    const list = (Array.isArray(tracks) && tracks.length) ? tracks : null;
    this._tracks = list;
    if (!list) {
      for (const g of this._trackGains.values()) { try { g.disconnect(); } catch {} }
      this._trackGains.clear();
      return;
    }
    if (!this.master) return; // 尚未建链：起播时按轨态惰性创建
    const now = this.master.context.currentTime;
    const ids = new Set();
    for (const t of list) {
      ids.add(t.id);
      const g = this._trackGains.get(t.id);
      if (g) g.gain.setTargetAtTime(t.muted ? 0 : (t.gain ?? 1), now, 0.01);
    }
    for (const [id, g] of [...this._trackGains]) {
      if (!ids.has(id)) { try { g.disconnect(); } catch {} this._trackGains.delete(id); }
    }
  }
  // 单轨实时控制（汇合轮 UI 入口）：写回轨态并平滑生效；轨不存在返回 false
  setTrackGainById(trackId, g) {
    const t = (this._tracks || []).find(x => x.id === trackId);
    if (!t) return false;
    t.gain = Math.max(0, Math.min(2, Number(g) || 0));
    const node = this._trackGains.get(trackId);
    if (node) node.gain.setTargetAtTime(t.muted ? 0 : t.gain, node.context.currentTime, 0.01);
    return true;
  }
  setTrackMutedById(trackId, m) {
    const t = (this._tracks || []).find(x => x.id === trackId);
    if (!t) return false;
    t.muted = !!m;
    const node = this._trackGains.get(trackId);
    if (node) node.gain.setTargetAtTime(t.muted ? 0 : t.gain, node.context.currentTime, 0.01);
    return true;
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
  play(clips, { from = 0, rate = 1, resolveBuffer = this._resolveBuffer, resolveProcessed, tracks } = {}) {
    const ctx = this.getContext();
    if (!ctx) return false;
    this.stopInternal();
    this._clips = clips || [];
    this._resolveBuffer = resolveBuffer || this._resolveBuffer;
    if (resolveProcessed !== undefined) this.resolveProcessed = resolveProcessed || null; // 缺省保留实例值
    this.rate = Math.max(0.25, Math.min(4, rate || 1));
    this.startPos = Math.max(0, from || 0);
    if (tracks !== undefined) this.syncTracks(tracks); // 多轨：起播即同步轨态（跨轨同 tick 调度）
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
  // 调度一个 clip 的剩余区间：源偏移 + 分段增益自动化（fade 段 setValueCurveAtTime）。
  // 滑动变速（varispeed）：组合速率 = (clip.rate||1) × this.rate（clip 级×传输级）——
  // playbackRate=组合速率、源消耗=slot 时长×组合速率（播放墙钟时长仍=slot 时长）；时间轴
  // slot 恒定（淡化/结束全在时间轴域）；源提前耗尽 → WebAudio 到源尾自然停止，slot 剩余=静音
  //（磁带放完语义，不做循环）。
  // processed 消费（clip.speed/pitchSemi）：needsProcess 且 resolveProcessed 在场时优先用
  // processed buffer（变速已烘焙、1:1 消费，见 _scheduleProcessed）；Promise 未就绪先以 raw
  // buffer 按 speed 磁带式应急起播（音高暂变，秒级），到位后 reschedule 一次无缝换入
  //（决策②，_pendingProcessed 防同键重复挂接；processed 缺失/null → raw 路径原样）。
  scheduleClip(ctx, clip, buffer, tlStart, tlEnd) {
    if (this.resolveProcessed && needsProcess(clip)) {
      const key = `${clip.assetId}|${clipProcessKey(clip)}`; // 前缀资产 id：异资产同参数不串缓存
      const cached = this._processedCache.get(key);
      if (cached) { this._scheduleProcessed(ctx, clip, cached, tlStart, tlEnd); return; }
      let pb = null;
      try { pb = this.resolveProcessed(clip) || null; } catch { pb = null; }
      if (pb && typeof pb.then === 'function') {
        this._scheduleRawStopgap(ctx, clip, buffer, tlStart, tlEnd);
        if (!this._pendingProcessed.has(key)) {
          this._pendingProcessed.add(key);
          Promise.resolve(pb).then(proc => {
            this._pendingProcessed.delete(key);
            if (!proc) return;
            this._processedCache.set(key, proc);
            // 仍在播放同一 clip（未停、本 tick 已调度、窗口未走完）才重调度换入 processed
            if (this.playing && this._scheduled.has(clip.id) && clipEnd(clip) > this.position + 1e-3) {
              this.reschedule();
            }
          }).catch(() => { this._pendingProcessed.delete(key); }); // 处理失败=应急 raw 播完本 slot
        }
        return;
      }
      if (pb) { this._processedCache.set(key, pb); this._scheduleProcessed(ctx, clip, pb, tlStart, tlEnd); return; }
      // resolveProcessed 返回 null → 落回既有 raw 路径（speed/semi 不消费，行为与无 processed 供给一致）
    }
    const when = Math.max(this.ctxTimeOf(tlStart), ctx.currentTime + 0.005);
    const skip = Math.max(0, tlStart - clip.timelineStartSec);
    const durTl = tlEnd - tlStart;
    if (durTl <= 1e-3) return;
    const clipRate = (clip.rate || 1) * this.rate;
    const srcOffset = clip.srcStartSec + skip * clipRate;
    if (buffer.duration - srcOffset <= 1e-4) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (clipRate !== 1) src.playbackRate.value = clipRate;
    const gain = ctx.createGain();
    src.connect(gain);
    // 多轨激活 → 挂轨子链（轨 gain×muted）；legacy 单链 → 直连 master（原链路）
    gain.connect(this._tracks ? this._ensureTrackGain(ctx, this._trackIdOf(clip)) : this.master);
    this.applyGainAutomation(gain.gain, clip, skip, skip + durTl, ct => when + (ct - skip));
    src.start(when, srcOffset, durTl * clipRate);
    this._sources.push(src); this._gains.push(gain);
  }
  // processed buffer 1:1 消费：变速/变调已烘焙进 buffer（时长=源/speed），playbackRate 不再乘
  // speed——只余 clip.rate（旧 varispeed）× this.rate（传输级）作磁带因子叠乘；processed 域=
  // 源域÷speed → 入点=srcStartSec/speed，skip/durTl 1:1 直映射。buffer 比slot 短（源提前耗尽）
  // → 截断调度时长，slot 剩余静音（磁带放完同语义）。静音/淡化/增益自动化与 raw 同链不变。
  _scheduleProcessed(ctx, clip, pbuf, tlStart, tlEnd) {
    const when = Math.max(this.ctxTimeOf(tlStart), ctx.currentTime + 0.005);
    const skip = Math.max(0, tlStart - clip.timelineStartSec);
    const durTl = tlEnd - tlStart;
    if (durTl <= 1e-3) return;
    const speed = Math.max(0.25, Math.min(4, Number(clip.speed) || 1));
    const tapeRate = (clip.rate || 1) * this.rate;
    const srcOffset = clip.srcStartSec / speed + skip * tapeRate;
    const avail = (pbuf.duration || 0) - srcOffset;
    if (avail <= 1e-4) return;
    const src = ctx.createBufferSource();
    src.buffer = pbuf;
    if (tapeRate !== 1) src.playbackRate.value = tapeRate;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(this._tracks ? this._ensureTrackGain(ctx, this._trackIdOf(clip)) : this.master);
    this.applyGainAutomation(gain.gain, clip, skip, skip + durTl, ct => when + (ct - skip));
    src.start(when, srcOffset, Math.min(durTl * tapeRate, avail));
    this._sources.push(src); this._gains.push(gain);
  }
  // 应急起播（processed 为 Promise 未就绪）：raw buffer 按 speed 磁带式先响（playbackRate=
  // speed×clip.rate×this.rate，音高随速度变），processed 到位后整体 reschedule 无缝换入。
  _scheduleRawStopgap(ctx, clip, buffer, tlStart, tlEnd) {
    const when = Math.max(this.ctxTimeOf(tlStart), ctx.currentTime + 0.005);
    const skip = Math.max(0, tlStart - clip.timelineStartSec);
    const durTl = tlEnd - tlStart;
    if (durTl <= 1e-3) return;
    const speed = Math.max(0.25, Math.min(4, Number(clip.speed) || 1));
    const r = speed * (clip.rate || 1) * this.rate;
    const srcOffset = clip.srcStartSec + skip * r;
    if (buffer.duration - srcOffset <= 1e-4) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (r !== 1) src.playbackRate.value = r;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(this._tracks ? this._ensureTrackGain(ctx, this._trackIdOf(clip)) : this.master);
    this.applyGainAutomation(gain.gain, clip, skip, skip + durTl, ct => when + (ct - skip));
    src.start(when, srcOffset, durTl * r);
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
      rightNew.fadeInCurve = 0; // 曲线随缘归 0（build-45：时长清零不留陈旧形状）
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
