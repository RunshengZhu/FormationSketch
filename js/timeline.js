// 时间线：编辑模式队形条（缩略图+拖拽排序） / 音乐模式波形时间线（块拖拽、节拍吸附、播放头）
// v3（exp/audition-lite）：常驻音频轨（简单态 26px / 展开态 Audition Lite 72px）——
// clip 自由摆放（间隙=静音、重叠=自动等功率交叉淡化+菱形手柄）、Audition 式内容锚定 trim、
// 分割（Ctrl/Cmd+K / 剃刀）、淡化/增益把手、时间选区、右键菜单、磁吸（clip 缘/块边界/tag/
// 播放头/选区/零交叉）。纯 clip 模型操作在 audio-clips.js（node 可测），此处只做几何与手势。
import { drawScene, stageBounds, dancerEnvelope, unionBounds } from './stage.js';
// build-70-formationclips M2：队形轴 clip 化——computeSegments/块边拖把手退役，
// 段派生走 segmentsFromClips；clip 移动/缩放/空隙/分割操作全部复用 model.js 纯函数（node 可测）。
import { segmentsFromClips, moveFormationClip, resizeFormationClip, setFormationClipLen,
  splitFormationClip, clipStartOf,
  spb, beatToSec, secToBeat, beatLabel,
  addTag, removeTag, moveTag, tagById, nextTagName, TAG_NAME_MAX,
  tagLevelOf, tagRhythmLabel, setTagLevel,
  tagLevelCountOf,
  tagEndBeatOf, moveTagRegion, resizeTagRegion, placeTagRegion, fitTagRegionInLevel,
  clipsOf, TRACK_MAX, trackOfClip, moveClipToTrack, musicDomainSec, clampCurve } from './model.js';
// 单弹窗不变式（build-48-tagui F2）：开编辑器前先关已开的右键/长按菜单。命名空间导入——
// 单文件包构建（build-single.mjs）按 ORDER 先 timeline 后 ui，命名空间对象按引用共享，
// 运行时调用时 FS.ui 已填充完成；ESM（dev/node 测试）语义不变。
import * as UI from './ui.js';
import {
  clipEnd, computeOverlaps, applyAutoCrossfades, pruneAutoCrossfades,
  trimClipLeftAnchored, trimClipLeftBoundary, trimClipRightAnchored, trimClipRightBoundary,
  splitClipAt, rippleDeleteClips, trimClipsToRange,
  collectSnapCandidates, snapTime, nearestZeroCrossing, fadeEnvAt,
  fadeEdgeEnv, setSeamCurves, resetClipFades,
  // build-88-waveui 需求 1：env 桶聚合版列极值更名 envColumnMinMax（本文件另导出样本域
  // columnMinMax(channelData,startIdx,endIdx)——解码 AudioBuffer 直读的高精度波形专用）。
  columnMinMax as envColumnMinMax, WAVE_COL_MAX_STRIDE,
  MIN_CLIP_DUR, CLIP_DEFAULT_COLOR,
} from './audio-clips.js';
// Wave 变速/变调离线处理（P 契约冻结，js/clip-process.js 零静态依赖）：needsProcess(clip) 判定
// 是否走 processed 管线、clipProcessKey(clip) 处理参数指纹（processed 波形列缓存键成分）。
// processClipAudio（浏览器 OfflineAudioContext 管线）不经本文件直接调用——由调度方经
// hooks.processClipAudio 接线（main.js buildStrips，本文件只声明可选 hooks 与回退逻辑）。
import { needsProcess, clipProcessKey } from './clip-process.js';
import {
  sectionSegmentsOf, removeSection, setSectionColor,
} from './model.js';

export const AUDIO_SIMPLE_H = 26;    // 简单态音轨高（常驻，每条轨 lane）
export const AUDIO_EXPANDED_H = 72;  // 展开态（Audition Lite）音轨高（保留常量供几何换算；W1 起无展开态入口）
export const TRACKS_OPS_H = 26;      // 多轨加轨条高（音乐模式底部 DOM 条：＋加轨；轨满时 disabled 提示）
const TRIM_TOL_PX = 10;              // clip 缘/把手命中半径（M3 T2：6→10px 低缩放可命中）
const TRIM_TOL_TOUCH_PX = 14;        // 触屏指针的 trim 缘命中半径（M3 T7：finger 精度放宽）
const SNAP_TOL_PX = 8;               // 磁吸阈值（像素，时间域换算）
const ZC_RADIUS_SEC = 0.004;         // 零交叉吸附半径（消切点咔哒）
// 淡化曲线二维把手（build-45-fadecurve）：横=长度（既有）、纵=曲线 k。
const FADE_HIT_TOP_PX = 16;          // 淡化把手命中区高（12→16px 触屏可达；不侵占 trim——trim 缘无 y 分区，命中链先 fade 后 trim 既有次序不变）
const CURVE_PX_PER_K = 40;           // 纵向换算：40px = 1.0 k 全程（钳 [-1,1]）
const CURVE_SNAP_K = 0.15;           // |k| < 0.15（≈6px 位移）吸附回 0=等功率（方便回默认）
const MAX_PHYS_W = 8192;             // 画布物理像素宽上限（backing store 内存护栏）
// ---- build-88-waveui 需求 3：缩放范围钉值（视口窗口渲染后画布不再随「域×pps」膨胀，
// 上限由「采样级对齐」需求钉死，而非画布像素上限）----
export const PPS_MIN = 4;     // px/s 缩放下限（钉值）：10 分钟域 ≈ 1 屏总览（更远靠 #tl-nav 概览条全域导航）
export const PPS_MAX = 2400;  // px/s 缩放上限（钉值）：48kHz 下 ≈20 样本/px，配合需求 1 逐像素波形=采样级对齐视图
export const WAVE_TILE_MAX_COLS = 1 << 18; // 波形列缓存单条列数上限（≈2×1MB Float32；超长 clip 深放大走瞬态逐帧计算，防 LRU 撑爆内存）
const SEAM_HIT_HALF_W = 13;          // 接缝把手命中半宽（26px 全宽 ≥24px 触屏要求）
const SEAM_HIT_HALF_H = 10;          // 接缝把手命中半高（菱形 ± 菱心）
const r6 = v => Math.round(v * 1e6) / 1e6;

// ---------- W1 音乐模式主区化几何（纯函数，node 可测） ----------
// 编舞（stage）保持既有公式逐值（红线 E-12；build-56-indextab F1 单独放开桌面基线 150→112，
// 内容地板 114 兜底）；音乐（music）改为
// 「容器实测高推导」：laneH = clamp((容器高 − 22 尺规 − 28 划分轨 − 26 加轨条 − 12×(n−1) 轨距) / n, 56, 120)，
// 轨多超出容器时 #tl-body 纵向滚动（floor 56 托底仍放不下才滚）。
export const TL_RULER_H = 22;        // 尺规高（drawRuler 同源）
export const TAG_LANE_H = 18;        // 编舞模式 tag 道高（既有值不动——移动端 tl 120 基线依赖）
export const SEG_LANE_H_MUSIC = 28;  // 音乐模式节奏划分轨高（tag 道升级，§2.2.1）
export const MUSIC_LANE_GAP = 12;    // 音乐模式相邻 lane 间距
export const MUSIC_LANE_MIN_H = 56;  // lane 高下限（多轨托底）
export const MUSIC_LANE_MAX_H = 120; // lane 高上限（单轨封顶）
export const MUSIC_LANE_MAX_H_MOBILE = 64; // 移动端 lane 高上限（W3 §2.3：触控友好 64px；floor 56 不变）
// F5（build-46-layout）：音乐模式块区常显——队形块区置于全部音频 lane 与加轨条（26px DOM 条）
// 之下，几何与编舞块区同构（bh=36），与上方内容间距 6px；合计常显高度开销 42px
// （totalHeightMusic / musicLaneH / musicContentH 的 extraH 入参同源）。
export const MUSIC_BLOCKS_H = 36;       // 块区高（drawBlocks 同源）
export const MUSIC_BLOCKS_GAP_H = 6;    // 块区与加轨条间距
export const MUSIC_BLOCKS_TOTAL_H = MUSIC_BLOCKS_H + MUSIC_BLOCKS_GAP_H; // 42
// build-46-layout：面板拖宽钳制（纯函数，node 可测）。
// 右侧合并侧边栏：min 180、max min(480, 容器 40%)——容器极窄时 max 不低于 min（floor 胜出不破版）。
export function clampSidebarWidth(w, containerW) {
  const min = 180;
  const max = Math.max(min, Math.min(480, (Number(containerW) || 0) * 0.4));
  const v = Number(w);
  if (!Number.isFinite(v)) return max;
  return Math.max(min, Math.min(max, v));
}
// 左侧轨头列拖宽：min 96（现移动端 96px 信息密度下限）、max 240；非法入参回桌面缺省 148。
export function clampHeadWidth(w) {
  const v = Number(w);
  if (!Number.isFinite(v)) return 148;
  return Math.max(96, Math.min(240, v));
}
// ---------- build-79-clipgrab（需求 7a）：队形 clip 边界热区收窄——命中分流纯函数（node 可测） ----------
// 旧实现：clip 左/右缘 ±10px 命中不分块宽——短块（宽 <20px）时块身任意一点都落在某侧缘热区内，
// 「点击选中/拖动块身」动线被「改边界」完全挤掉。收窄为固定像素（FC_EDGE_HIT_PX=8），并按块宽
// 钳制不超过 1/3：任何宽度下块身至少保有 1/3 宽的「选中/拖动」命中区。
export const FC_EDGE_HIT_PX = 8; // 边界热区固定像素（块外 ±e 仍算缘=旧「从空隙抓缘改长度」保留）
// 分流：'l'=左缘热区、'r'=右缘热区、'body'=其余（块身=选中/拖动；块外点调用方自然落空处理）。
// 两侧同时命中取就近缘、等距取左（1/3 钳制下 w>0 恒不重叠——此分支为防御性兜底）。
export function clipEdgeHit(clipX0, clipX1, px, edgePx = FC_EDGE_HIT_PX) {
  const x0 = Number(clipX0), x1 = Number(clipX1), q = Number(px);
  const w = x1 - x0;
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(q)) return 'body';
  const eRaw = Number(edgePx);
  const e = Number.isFinite(eRaw) && eRaw > 0 ? Math.min(eRaw, w / 3) : 0; // 钳制≤块宽 1/3（需求钉值）
  if (!(e > 0)) return 'body';
  const inL = q >= x0 - e && q <= x0 + e;
  const inR = q >= x1 - e && q <= x1 + e;
  if (inL && inR) return Math.abs(q - x0) <= Math.abs(q - x1) ? 'l' : 'r';
  if (inL) return 'l';
  if (inR) return 'r';
  return 'body';
}
export function tlTotalHeight(mode, audioBottomVal, mobile) {
  // W1 起音乐模式不走本函数（容器推导见 musicLaneH/musicContentH/totalHeightFor）。
  // build-56-indextab F1：stage 桌面基线 150→112（仅 stage 缺省值；音乐模式推导零变化、移动端
  // 120 不动）。内容地板=audioBottom+6+36+6（stage 常量域 66+48=114）由 Math.max 兜底——
  // 实际写入高 114（恰合内容零死区），较旧 150 省 36px 给舞台。
  const base = mobile ? 120 : 112;
  return Math.max(base, audioBottomVal + 6 + 36 + 6);
}
// maxH：上限参数（缺省 120=桌面不变；移动端传 64——W3 §2.3「laneH 64」）。
// extraH：额外常显开销（build-46-layout F5 传 MUSIC_BLOCKS_TOTAL_H=42——块区常显后 lane 推导
// 扣除块区+间距；缺省 0=旧四参调用逐值不变，既有仪器不回退）。
// 内容超出容器时 #tl-body 纵向滚动（overflow-y:auto 由 CSS 恒开，floor 托底仍放不下才滚）。
export function musicLaneH(containerH, n, opsH = TRACKS_OPS_H, maxH = MUSIC_LANE_MAX_H, extraH = 0) {
  const k = Math.max(1, Math.floor(Number(n) || 1));
  const cap = Math.max(MUSIC_LANE_MIN_H, Number(maxH) || MUSIC_LANE_MAX_H);
  const raw = (Number(containerH) - TL_RULER_H - SEG_LANE_H_MUSIC - opsH - (Number(extraH) || 0) - MUSIC_LANE_GAP * (k - 1)) / k;
  if (!Number.isFinite(raw)) return cap;
  return Math.max(MUSIC_LANE_MIN_H, Math.min(cap, raw));
}
export function musicContentH(laneH, n, opsH = TRACKS_OPS_H, extraH = 0) {
  const k = Math.max(1, Math.floor(Number(n) || 1));
  return TL_RULER_H + SEG_LANE_H_MUSIC + k * laneH + MUSIC_LANE_GAP * (k - 1) + opsH + (Number(extraH) || 0);
}
// ---------- build-83-constlane：编舞队形道恒定高度（需求 8 拖高联动整体退役） ----------
// 用户裁定：轨道区域不应有拖高逻辑——道高恒定，底区拖高（.ba-sized grip）只作用于上方
// 画布区（flex 自动让位），轨道内容恒 128（rows 72 + 道高 56）；盒高不足 128 → 纵滚条
//（溢出语义 build-82 已归位且用户确认正确）；盒高富余 → 道下方留白。
export const STAGE_LANE_DEFAULT_H = 56; // 编舞队形道恒定道高（内容总高 128=rows72+56）
const TL_NAV_H = 16;                 // #tl-nav 概览导航条高（css 钉值，此处同步）
// ---------- build-79-laneh（需求 9①）：轨级 laneH 读取回退（纯函数，node 可测） ----------
// track.laneH（数值 px，音乐模式轨头卡片交界拖动写入；model.sanitizeTracks 数值保留/非法删除
// 由并行改动收口）合法（有限数）→ 钳 [24,240]；缺省/非法 → 回退调用方推导值
//（musicLaneH 容器推导 _mLaneH，G2W1 推导链零变化）。
export const TRACK_LANE_H_MIN = 24;  // 轨级 lane 高下限（需求钉值）
export const TRACK_LANE_H_MAX = 240; // 轨级 lane 高上限（需求钉值）
export function trackLaneHOf(track, fallback) {
  const v = Number(track?.laneH);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(TRACK_LANE_H_MIN, Math.min(TRACK_LANE_H_MAX, v));
}
// 旧展开键一次性迁移（C6）：无 uiMode 记录且 audioTrackExpanded=1 → 音乐模式（原「展开」语义）。
// 读后即退役：键不再被任何代码写入。纯函数（node 可测）；ls 只需 {getItem}。
export function resolveInitialUiMode(ls) {
  let saved = null, legacy = null;
  try { saved = ls?.getItem?.('wuzhen:uiMode') ?? null; } catch {}
  if (saved === 'music') return 'music';
  if (saved == null) {
    try { legacy = ls?.getItem?.('wuzhen:audioTrackExpanded') ?? null; } catch {}
    if (legacy === '1') return 'music';
  }
  return 'stage';
}
// ---- W3 尺规刻度按模式分键（整改方案 §4.3①）：wuzhen:rulerScale.stage / .music 各自记忆，互不串 ----
// 缺省：stage=拍（编舞恒定 BPM 口径不变）；music=秒（M1 决策⑤——音乐为底层，BPM 未校准时
// 拍网格无意义，秒刻度才是缺省；老用户已选过则各自记忆键兜底，不受缺省变化影响）。
// 旧单键 wuzhen:rulerScale 一次性播种到「当前模式」键后退役（读后即删，另一模式保持各自缺省）。
// 纯函数（node 可测）；ls 只需 {getItem,setItem,removeItem}。
export function rulerScaleKeyOf(mode) {
  return mode === 'music' ? 'wuzhen:rulerScale.music' : 'wuzhen:rulerScale.stage';
}
export function resolveRulerScaleFor(ls, mode) {
  let v = null;
  try { v = ls?.getItem?.(rulerScaleKeyOf(mode)) ?? null; } catch {}
  if (v === 'sec' || v === 'beat') return v;
  // 旧单键迁移：有值 → 播种当前模式键并退役旧键；无值/异常 → 模式缺省（stage=拍、music=秒）
  try { v = ls?.getItem?.('wuzhen:rulerScale') ?? null; } catch {}
  if (v === 'sec' || v === 'beat') {
    try { ls?.setItem?.(rulerScaleKeyOf(mode), v); ls?.removeItem?.('wuzhen:rulerScale'); } catch {}
    return v;
  }
  return mode === 'music' ? 'sec' : 'beat';
}
// 秒刻度（决策⑥降级刻度）：NICE 秒族主刻度步长——取「像素宽 ≥68px」的最小步长。
// lightmix NICE_STEPS 秒族口径（0.1…3600），供变速曲/无节拍音乐按秒对齐。
export function niceSecStep(pps, minPx = 68) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  if (!(pps > 0)) return 3600;
  for (const s of steps) if (s * pps >= minPx) return s;
  return 3600;
}
// 秒刻度标签：<60s 呈「12.5s」，≥60s 呈「m:ss」
export function fmtSecLabel(sec) {
  if (sec >= 60) {
    const m = Math.floor(sec / 60 + 1e-9), s = Math.round(sec - m * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const r = Math.round(sec * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}s`;
}
// build-52-wavezoom F4：波形逐列渲染的可视列范围（canvas x 域，纯函数 node 可测）。
// 画布 x=0 在轨头列右缘（M2 几何）→ lane 可视宽=clientWidth−headW；可视列=[scrollLeft,
// scrollLeft+可视宽+2]（±2 与旧 clip 可视边距同口径）。clientWidth 缺失（node 桩/异常）=
// 无视口信息 → 全画布 [0,W+2]（旧全宽遍历口径，行为兜底）。headW 超过 clientWidth 时 span 钳 1。
export function visibleColumnRange(scrollLeft, clientWidth, headW, W) {
  const w = Math.max(0, Math.floor(Number(W) || 0));
  const cw = Math.floor(Number(clientWidth) || 0);
  if (!(cw > 0)) return [0, w + 2];
  const sl = Math.max(0, Math.floor(Number(scrollLeft) || 0));
  const head = Math.max(0, Math.floor(Number(headW) || 0));
  const span = Math.max(1, cw - head);
  return [sl, Math.min(w + 2, sl + span + 2)];
}
// ---------- build-88-waveui 需求 1：高精度波形列极值缓存（LRU，node 可测） ----------
// 键=「assetId|srcStart 样本|列数」：横滚/拖动不换键（列区间同源，命中零分配零重扫）、
// 缩放换列数才重算。tile=min/max Float32Array 对（±Infinity=该列未算哨兵，绘制时惰性逐列填充
// ——只算可见列，禁止全轨重扫）。Map 插入序=LRU 序：命中重插表尾、超限淘汰最旧。
// rate 入参（Wave raw 回退路径的 ×speed 映射，可缺省）：rate=1/缺省时键与旧 3 段格式逐字节一致
//（既有调用/既有测试零回退）；rate≠1 追加第 4 段「r+百分子」——clip.speed 两位小数 ×100 取整为
// 无损量化（0.25→25、1.25→125），同 asset 同 srcStart 同列数不同速必不同键：变速后波形列极值按
// 构造不可能命中陈旧 tile（raw 回退路径的缓存失效取舍：键含 speed 即隐式按 clip+speed 失效，旧
// 速率 tile 留 LRU 内自然淘汰，不做显式清扫——LRU 上限 8，清扫不可回收额外内存，省一条遍历）。
// processed 主路径不经本函数：列缓存键=assetId|clipProcessKey(clip)|起点样本|列数（见 drawClipBox）。
export function waveTileKey(assetId, startSample, cols, rate = 1) {
  const r = Number(rate);
  const rq = Number.isFinite(r) && r > 0 ? r : 1;
  const base = `${String(assetId)}|${Math.round(Number(startSample) || 0)}|${Math.max(1, Math.round(Number(cols) || 1))}`;
  return rq === 1 ? base : `${base}|r${Math.round(rq * 100)}`;
}
export class WaveTileCache {
  constructor(cap = 8) { this.cap = Math.max(1, Number(cap) || 8); this.map = new Map(); }
  get(key) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    this.map.delete(key); this.map.set(key, v); // 命中即升为最新（LRU）
    return v;
  }
  set(key, cols) {
    let t = this.map.get(key);
    if (t !== undefined) {
      this.map.delete(key); // 重 set 既有键=刷新（不重复分配、不触发淘汰）
    } else {
      t = { min: new Float32Array(Math.max(1, cols | 0)).fill(Infinity), max: new Float32Array(Math.max(1, cols | 0)).fill(-Infinity) };
      while (this.map.size >= this.cap) this.map.delete(this.map.keys().next().value); // 淘汰最旧
    }
    this.map.set(key, t);
    return t;
  }
  get size() { return this.map.size; }
}
// 样本域列极值（纯函数，node 可测）：[startIdx,endIdx) 样本区间的真 [min,max]。
// stride=max(1,floor(n/64)) 有界扫描（≤64+步长内极限次读）+ 末样本补读（区间右缘真值）；
// 索引钳 [0,len]；空/逆序=[0,0]；单样本=[v,v]；NaN 样本按 0 计（防御坏文件）。
// 与 audio-clips 的 envColumnMinMax（秒域+env 桶聚合）分工：本函数服务解码 AudioBuffer 直读路径。
export function columnMinMax(channelData, startIdx, endIdx) {
  const d = channelData;
  if (!d || !d.length) return [0, 0];
  let i0 = Math.floor(Number(startIdx)), i1 = Math.ceil(Number(endIdx));
  if (!Number.isFinite(i0) || !Number.isFinite(i1)) return [0, 0];
  i0 = Math.max(0, Math.min(d.length, i0));
  i1 = Math.max(i0, Math.min(d.length, i1));
  const n = i1 - i0;
  if (n <= 0) return [0, 0];
  const fin = v => (Number.isFinite(v) ? v : 0);
  if (n === 1) { const v = fin(d[i0]); return [v, v]; }
  const stride = Math.max(1, Math.floor(n / WAVE_COL_MAX_STRIDE));
  let mn = Infinity, mx = -Infinity;
  for (let i = i0; i < i1; i += stride) {
    const v = d[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const vl = d[i1 - 1];
  if (vl < mn) mn = vl;
  if (vl > mx) mx = vl;
  return [fin(mn), fin(mx)];
}
// ---------- Wave 变速/变调双旋钮（clip.speed 保音高 TSM + clip.pitchSemi 半音；timeline 呈示半边）----------
// 语义契约（冻结）：clip.speed ∈ [0.25,4] 两位小数（1=不落键）、clip.pitchSemi ∈ [-12,12] 整数
// （0=不落键）——字段清洗归 model.sanitizeAudioClips；needsProcess 时 transport/mixdown 消费
// js/clip-process.js 离线渲染的 processed buffer（保音高 TSM+变调一体，时长=源/speed）并以
// 1:1 playbackRate 播放——波形主路径因此改读 processed buffer 1:1 直采（列区间不乘速率）；
// processed 未就绪的瞬态回退 raw buffer 时保留 ×speed 磁带式近似映射（srcSampleAt 退役为
// raw 回退路径内部细节）。旧 clip.rate 滑动变速消费面由引擎链（audio-clips.js Q）接管。
export const CLIP_SPEED_MIN = 0.25; // 变速下限钉值（与 model 清洗/菜单滑杆量程同界）
export const CLIP_SPEED_MAX = 4;    // 变速上限钉值
export const CLIP_SEMI_MIN = -12;   // 变调下限钉值（半音）
export const CLIP_SEMI_MAX = 12;    // 变调上限钉值
// clip.speed 消费面读取：缺省/非法/非正 → 1（`clip.speed || 1` 契约；不依赖模型侧清洗交付进度）。
export function clipSpeedOf(c) {
  const r = Number(c?.speed);
  return Number.isFinite(r) && r > 0 ? r : 1;
}
// clip.pitchSemi 消费面读取：整数钳 [-12,12]，缺省/非法 → 0。
export function clipSemiOf(c) {
  const v = Number(c?.pitchSemi);
  return Number.isInteger(v) ? Math.max(CLIP_SEMI_MIN, Math.min(CLIP_SEMI_MAX, v)) : 0;
}
// 波形列采样纯函数（raw 回退路径内部细节）：采样位置 = srcStart 样本 + 列相对时刻 × mult × 源采样率。
// mult 非法回 1（与 clipSpeedOf 同口径）；srcStart/relSec/srcRate 非有限 → 0（防御，与 columnMinMax
// 的 [0,0] 哨兵同风格）。返回浮点采样位——列 [sA,sB) 半开区间的取整由 columnMinMax 内部 floor/ceil
// 承担（与既有非变速路径同源，此处不做额外量化）。processed 主路径以 mult=1 调用（1:1 直采）。
export function srcSampleAt(srcStartSamples, relSec, mult, srcRate) {
  const s0 = Number(srcStartSamples), t = Number(relSec), sr = Number(srcRate);
  const r = Number(mult);
  const rr = Number.isFinite(r) && r > 0 ? r : 1;
  if (!Number.isFinite(s0) || !Number.isFinite(t) || !Number.isFinite(sr)) return 0;
  return s0 + t * rr * sr;
}
// AudioBuffer / processClipAudio 结果对象（{channels:[Float32Array,…], sampleRate, duration}）
// 统一的 ch0 读取：两种形态都喂得进波形直采链（调度方 resolveProcessedClip 返回哪种都兼容）。
export function channelData0Of(buf) {
  if (!buf) return null;
  if (typeof buf.getChannelData === 'function') {
    try { return buf.getChannelData(0) || null; } catch { return null; }
  }
  return Array.isArray(buf.channels) ? (buf.channels[0] || null) : null;
}
// ---------- build-88-waveui 需求 2：尺规滚轮缩放步进（纯函数，node 可测） ----------
// deltaY>0=缩小、<0=放大：×1.15^(-deltaY/100)（每 100 delta=一步）；单次步进指数钳 ±3
//（触控板惯性大 delta 不跳变：单事件至多 ×1.15³≈1.52）。deltaY=0/非有限=1（本帧不缩）。
// wheel 直接步进无防抖；两指上下拖=原生 wheel 事件同路。
export function wheelZoomStep(deltaY) {
  const d = Number(deltaY);
  if (!Number.isFinite(d) || d === 0) return 1;
  const exp = Math.max(-3, Math.min(3, d / 100));
  return Math.pow(1.15, -exp);
}
// ---------- build-77-zoomsel：缩放锚点决策（纯函数，node 可测） ----------
// 有选中 clip（selectedClipRange={start,end} 秒）→ 返回其中心时刻：所有缩放入口（±/－/＋按钮、
// ctrl·alt 滚轮、双指捏合；⤢ fit 适配整域无锚概念不参与）统一以它为锚，缩放前后该时刻保持在
// 视口同一屏幕 x。屏幕 x 不变的补偿式（MusicTimeline._zoomAnchorCommit / zoomAt 同源）：
//   scrollLeft' = scrollLeft + anchorSec × (newPps − oldPps)
//   （headW 在等式两侧同项相消；浏览器对 scrollLeft 钳非负与量程——越界即贴边，与既有锚一致）。
// 无选中 → 回退既有锚（行为不变）：fallbackSec=入口自带锚（滚轮/捏合=指针/质心时刻、
// ±按钮=可视域中点，调用方换算后传入）钳非负原样返回；未传时按可视域 [viewStart,viewEnd]
// 中点（±按钮既有锚的域口径，scale>0 为时间域有效前提）；再退化 playheadSec；全缺省=0（域起点）。
export function zoomAnchorSec({ viewStart = 0, viewEnd = 0, scale = null, selectedClipRange = null, playheadSec = null, fallbackSec = null } = {}) {
  const r = selectedClipRange;
  if (r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end >= r.start) {
    return Math.max(0, (r.start + r.end) / 2);
  }
  if (Number.isFinite(fallbackSec)) return Math.max(0, fallbackSec);
  const vs = Number.isFinite(viewStart) ? Math.max(0, viewStart) : 0;
  const ve = Number.isFinite(viewEnd) ? Math.max(0, viewEnd) : 0;
  if (ve > vs && (scale == null || (Number.isFinite(scale) && scale > 0))) return (vs + ve) / 2;
  if (Number.isFinite(playheadSec)) return Math.max(0, playheadSec);
  return 0;
}
// ---------- build-77-tagdel：tag 命中分流（纯函数，node 可测） ----------
// kind：'tag'=stage 旗点/× 命中带（低层 flag，E-12 单层道）；'region'=music 区域块（build-49 F4，
// 删除入口已收敛菜单）；'blank'=道内空白。sig：{isLongPress,isContextMenu}=触摸长按/桌面右键
// 两个菜单手势（stage 本轮补齐，music 既有）。
//   'menu'：开 tag 菜单（onSegContextMenu 系——删除唯二轨道入口之一，另一入口=索引「…」）；
//   'edit'：选中并打开既有改名/编辑 popover（_openTagInput 系）——stage 单击唯一动作，
//           原「× 点按即删除」与「单击跳转」一并收敛为防误删编辑动线；
//   'none'：无附加 tag 动作——region 单击=既有「仅选中」（build-49 F2 不动）、blank=既有
//           scrub/长按新建（空白流程不经本函数决策，各自独立）。
// 不变量：任何入参组合都不返回 'delete'——单击/点按删除路径自 build-77 起不存在。
export function tagHitAction(kind, { isLongPress = false, isContextMenu = false } = {}) {
  if ((kind === 'tag' || kind === 'region') && (isLongPress || isContextMenu)) return 'menu';
  if (kind === 'tag') return 'edit';
  return 'none';
}
function store_getProjectId(hooks) {
  try { return hooks.getProjectId?.() ?? null; } catch { return null; }
}
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(56,189,248,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- F-10（UX-10）：chip 触摸长按拖拽排序——纯几何决策（node 可测） ----------
// 触屏不产生 HTML5 dragstart（UX-10 根因），排序走 Pointer Events 长按路径：
// 长按 LP_MS 触发拿起态（lift 视觉 + 可选触觉反馈），此后 pointermove 实时预览插入位
// （transform 平移预览，不动数据），pointerup 才经 hooks.move 提交恰一条「调整队形顺序」历史；
// pointercancel（浏览器/系统接管）安全回滚：零数据写入、零历史。
// 鼠标路径不进此状态机（pointerType 判定分流），HTML5 DnD（C-07 既有）不受影响。
export const TOUCH_DRAG = {
  LP_MS: 300,     // 长按时长：超过即拿起（research-arrangeus 触摸动线口径 ~300ms）
  SLOP_PX: 10,    // 拿起前的位移阈值：超了视为滚动/误手势，解除长按（chip 铺满列表，不能吃掉原生滚动）
  EDGE_PX: 28,    // 拖拽中指针接近容器边缘的判定带
  EDGE_STEP: 10,  // 边缘自动滚动的每帧步长（px/frame，rAF 驱动）
};
// dy（相对拿起的位移，含自动滚动补偿）→ 目标插入位。slotH=chip 高+间距；跨半格换位（中点判定）。
export function dragTargetIndex(dy, slotH, from, count) {
  if (!(slotH > 0) || count < 2 || !Number.isFinite(dy)) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / slotH)));
}
// 预览位移（格数）：被拿起 chip 恒 0（自身位移单独算）；from→to 之间的 chip 让位一格。
export function shiftSlots(from, to, i) {
  if (i === from) return 0;
  if (from < to) return (i > from && i <= to) ? -1 : 0;
  if (from > to) return (i >= to && i < from) ? 1 : 0;
  return 0;
}

// ---------- build-44-tlnav：音乐模式触屏导航/长按剪切（纯函数，node 可测） ----------
// 缺陷根因：#tl-canvas touch-action:none 吃掉全部触屏手势（原生滚动失效），而单指语义是
// 既有红线（空白拖=时间选区 C8 / 单击=清选定位 C12 / clip 拖移·trim·淡化），不能动——
// 横向导航走双指（质心位移=平移滚动容器、指距比=锚定质心捏合缩放），剪切入口走长按弹菜单。
// 与舞台手势机（gesture.js PINCH 态）同构，但宿主接口完全不同（此处直接驱动 #tl-scroll），
// 抽纯函数共享几何口径即可，不硬套状态机框架（低耦合）。
export const TP_LP_MS = 550;          // 长按弹剪辑菜单时长（触屏/笔；鼠标有右键不进此路径）
export const TP_SLOP_PX = 8;          // 长按/拖拽待定的最大位移：超=拖拽意图，取消长按转正拖拽
export const TP_PINCH_MIN_DIST = 8;   // 捏合最小指距：低于不产生缩放（防抖动除零/误放大）
export const TP_ZOOM_STEP_MAX = 1.35; // 单事件缩放因子上限（两指快速张开不跳变）
export function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function pinchCentroid(ax, ay, bx, by) { return { x: (ax + bx) / 2, y: (ay + by) / 2 }; }
export function pinchDist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
// 捏合缩放因子 = curDist/prevDist 钳在 [1/MAX, MAX]；prev 指距过近或异常值 → 1（本帧不缩，只平移）
export function pinchZoomFactor(prevDist, curDist) {
  if (!(prevDist >= TP_PINCH_MIN_DIST) || !(curDist > 0)) return 1;
  return clampNum(curDist / prevDist, 1 / TP_ZOOM_STEP_MAX, TP_ZOOM_STEP_MAX);
}
// 两指几何（{ax,ay,bx,by}）→ 单帧手势 {dx,dy,zoom}：质心位移 + 钳制后的捏合比；入参缺失返回 null
export function twoPointerGesture(prev, cur) {
  if (!prev || !cur) return null;
  const pc = pinchCentroid(prev.ax, prev.ay, prev.bx, prev.by);
  const cc = pinchCentroid(cur.ax, cur.ay, cur.bx, cur.by);
  return {
    dx: cc.x - pc.x,
    dy: cc.y - pc.y,
    zoom: pinchZoomFactor(pinchDist(prev.ax, prev.ay, prev.bx, prev.by), pinchDist(cur.ax, cur.ay, cur.bx, cur.by)),
  };
}

// ---------- 编辑模式：队形条 ----------
// ---------- build-66-mobileux F3：缩略图视口 bbox（纯函数，node 可测） ----------
// 舞者可自由驻留任意区域（观众区/后台深处）——视口 bbox = stageBounds（舞台+后台+候场，
// 恒为下限：各边至少覆盖之）∪ 全队形舞者位置（外扩 0.5m）的并集。全队形取同一 bbox：
// 越界舞者入画不缺失、缩略图之间位置可比对、纵横比按最终 bbox 反推（任意宽高比舞台自动适配）。
export function thumbBoxOf(p) {
  let env = null;
  for (const f of (p?.formations || [])) env = unionBounds(env, dancerEnvelope(f.positions, 0.5));
  return unionBounds(stageBounds(p.stage), env);
}
// 显式 bbox → 画布视口（fitView 同式：pad 内缩、双轴 min 比例、居中；退化/非正尺寸回退保守
// 正值——0 尺寸画布绘制本就是无害 no-op，防负 scale 一路传进 ctx.arc）
export function fitBoundsView(w, h, box, pad = 4) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const raw = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const scale = Number.isFinite(raw) && raw > 0 ? raw : 10;
  return { scale, ox: (w - bw * scale) / 2 - box.x0 * scale, oy: (h - bh * scale) / 2 - box.y0 * scale };
}

export class EditStrip {
  constructor(container, hooks) {
    this.el = container;
    this.hooks = hooks; // {select(i), add(), duplicate(), delete(), move(from,to), getProject(), getIndex(), names()}
    this._key = '';
    this._boxKey = '';   // F3 舞者包络缓存键（场地尺寸 + 全队形 positions 签名）
    this._box = null;    // F3 缓存的视口 bbox（thumbBoxOf 结果）
    this._thumbTimer = null;
    this._td = null;               // F-10 触摸拖拽状态（null=空闲；active=false=长按未生效）
    this._suppressClickUntil = 0;  // 触摸落位后抑制合成 click 误选（落位=排序，不应改选队形）
    // round23 需求 3：缩略图按容器实测尺寸 × dpr 绘制——容器尺寸变化（窗口缩放、移动端
    // 队形 tab 从 display:none 展开）时按新尺寸重绘，保持舞台纵横比、不拉伸不裁切。
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.drawThumbs());
      this._ro.observe(container);
    }
    // F-10：拿起后必须掐断原生滚动接管（touch-action 在手势开始时已定型，改不回去）——
    // 拖拽中在容器上以非 passive 监听 touchmove 并 preventDefault；拿起前不拦（列表照常可滚）。
    container.addEventListener('touchmove', e => { if (this._td && this._td.active) e.preventDefault(); }, { passive: false });
  }
  // 视口 bbox（build-66-mobileux F3）：thumbBoxOf（stageBounds ∪ 全队形舞者包络 0.5m）+ 签名键
  // 缓存——拖舞者/改场地（宽深/后台/候场）失效重算，其余 drawThumbs 高频路径命中缓存零重算。
  thumbBox(p) {
    const key = [p.stage.widthM, p.stage.depthM, p.stage.backstageM ?? 0, p.stage.wingM ?? 0].join('x')
      + '|' + p.formations.map(f => Object.entries(f.positions || {})
        .map(([id, q]) => id + '=' + (q?.x ?? '?') + ',' + (q?.y ?? '?')).join(';')).join('#');
    if (key !== this._boxKey) { this._boxKey = key; this._box = thumbBoxOf(p); }
    return this._box;
  }
  // 缩略图盒尺寸（CSS px）：宽=列表可用宽（上限 160），高按最终 bbox（F3：舞台全域 ∪ 舞者包络）
  // 纵横比反推。高度上限 96：保证 1280×800 桌面下前 3 个 chip 完整落在 #formation-list 可视区内
  // （既有动线依赖不滚动直点第 3 个 chip；round23 回归教训——148px 高会把 chip3 挤出可视区，
  // 使其中心坐标落进底部时间轴区，点击变成 scrub）。
  thumbSize(p) {
    const avail = Math.max(40, Math.min(160, (this.el.clientWidth || 164) - 26));
    const b = this.thumbBox(p);
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const w = Math.round(Math.min(avail, 96 * bw / bh));
    return { w, h: Math.round(w * bh / bw) };
  }
  render() {
    // rAF 合帧（性能修复）：一次指针移动此前触发两次全量重绘（emit 订阅链 + 拖拽自绘），
    // 同帧合并为一次；node 测试环境无 rAF 时同步直行（行为不变）。
    if (this._renderQueued) return;
    this._renderQueued = true;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => fn();
    raf(() => { this._renderQueued = false; this._renderNow(); });
  }
  _renderNow() {
    const p = this.hooks.getProject();
    if (!p) return;
    const key = p.formations.map(f => f.id).join(',') + '|' + this.hooks.getIndex();
    if (key === this._key) { this.drawThumbs(); return; }
    this._key = key;
    this.el.innerHTML = '';
    p.formations.forEach((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'es-chip' + (i === this.hooks.getIndex() ? ' active' : '');
      chip.draggable = true;
      const cv = document.createElement('canvas');
      const nm = document.createElement('div');
      nm.className = 'es-name';
      nm.textContent = `${i + 1}. ${f.name}`;
      nm.title = f.name;
      chip.append(cv, nm);
      chip.addEventListener('click', () => {
        if (performance.now() < this._suppressClickUntil) return; // F-10：触摸排序落位后的合成 click 不改选队形
        this.hooks.select(i);
      });
      chip.addEventListener('dragstart', e => { this._dragFrom = i; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chip.addEventListener('dragover', e => { e.preventDefault(); });
      chip.addEventListener('drop', e => { e.preventDefault(); if (this._dragFrom != null && this._dragFrom !== i) this.hooks.move(this._dragFrom, i); this._dragFrom = null; });
      // F-10：触摸/笔长按拖拽排序（鼠标不进此路径，仍走上面的 HTML5 DnD）
      chip.addEventListener('pointerdown', e => this._chipPointerDown(e, chip, i));
      chip.addEventListener('pointermove', e => this._chipPointerMove(e));
      chip.addEventListener('pointerup', e => this._chipPointerUp(e));
      chip.addEventListener('pointercancel', e => this._chipPointerCancel(e));
      this.el.append(chip);
    });
    const add = document.createElement('button');
    add.className = 'btn small'; add.textContent = '＋';
    add.title = '新队形（复制当前）';
    add.addEventListener('click', () => this.hooks.add());
    this.el.append(add);
    this.drawThumbs();
  }
  drawThumbs() {
    const p = this.hooks.getProject();
    if (!p) return;
    const { w, h } = this.thumbSize(p);
    // build-66-mobileux F3：全 chip 共享同一视口（一次计算）——位置跨缩略图可比对；
    // drawScene 收 opts.view 后跳过内部 fitView（绘制链本身零变化，minimal 照画任意位置舞者）
    const view = fitBoundsView(w, h, this.thumbBox(p), 4);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    [...this.el.querySelectorAll('.es-chip')].forEach((chip, i) => {
      const f = p.formations[i];
      const cv = chip.querySelector('canvas');
      if (!cv) return;
      if (cv.width !== W || cv.height !== H) {
        cv.width = W; cv.height = H;
        // CSS 尺寸同步锁定（宽=实测可用宽、高=舞台纵横比），避免 100% 拉伸变形
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (f) drawScene(ctx, { x: 0, y: 0, w, h }, p, f.positions, { minimal: true, pad: 4, view, merges: f.merges || [] });
    });
  }

  // ---------- F-10：触摸长按拖拽排序（触摸/笔专用；鼠标走 HTML5 DnD） ----------
  _chipPointerDown(e, chip, i) {
    if (e.pointerType === 'mouse') return;          // 鼠标 = 既有 HTML5 DnD，零改动
    if (this._td) return;                            // 已有手势进行中（不可能双触摸排序）
    const td = this._td = {
      id: e.pointerId, chip, from: i, to: i,
      startX: e.clientX, startY: e.clientY, lastY: e.clientY,
      active: false, chips: null, slots: null, slotH: 0, scroll0: 0, raf: 0, lpTimer: 0,
    };
    // 捕获指针：后续 move/up/cancel 全部回到 chip，手指滑出列表也能继续拖
    try { chip.setPointerCapture(e.pointerId); } catch { this._td = null; return; }
    td.lpTimer = setTimeout(() => this._lift(td), TOUCH_DRAG.LP_MS);
  }
  _lift(td) { // 长按生效：拿起态（视觉抬升 + 可选触觉反馈），开始边缘自动滚动循环
    if (this._td !== td) return;
    const chips = [...this.el.querySelectorAll('.es-chip')];
    if (chips.length < 2 || chips[td.from] !== td.chip) { this._td = null; return; }
    td.active = true;
    td.chips = chips;
    // 基准几何（未加变换时的布局位）：此后换位判定与预览全部以此为参照
    td.slots = chips.map(c => { const r = c.getBoundingClientRect(); return { top: r.top, h: r.height }; });
    td.slotH = chips.length > 1
      ? (td.slots[1].top - td.slots[0].top)      // 相邻 chip 布局位差 = 高 + gap（均匀格）
      : (td.slots[0].h + 6);
    td.scroll0 = this.el.scrollTop;
    td.chip.classList.add('lift');
    [...chips].forEach(c => { if (c !== td.chip) c.classList.add('tshift'); });
    try { navigator.vibrate && navigator.vibrate(10); } catch {} // 触觉反馈：可选、失败静默
    const step = () => {  // 边缘自动滚动：拖拽中指针压住容器上/下边缘时按帧推进列表
      if (this._td !== td || !td.active) return;
      const r = this.el.getBoundingClientRect();
      let d = 0;
      if (td.lastY < r.top + TOUCH_DRAG.EDGE_PX) d = -TOUCH_DRAG.EDGE_STEP;
      else if (td.lastY > r.bottom - TOUCH_DRAG.EDGE_PX) d = TOUCH_DRAG.EDGE_STEP;
      if (d) {
        const before = this.el.scrollTop;
        this.el.scrollTop = before + d;
        const real = this.el.scrollTop - before;
        // scroll0 必须冻结为拿起时刻的 scrollTop：_applyPreview 的 dy=(lastY-startY)+(scrollTop-scroll0)
        // 本身已含增量 real（世界坐标补偿）；若再回写 scroll0 会把 real 双计，chip 以 2× 滚速脱手。
        if (real) this._applyPreview(td);
      }
      td.raf = requestAnimationFrame(step);
    };
    td.raf = requestAnimationFrame(step);
    this._applyPreview(td);
  }
  _chipPointerMove(e) {
    const td = this._td;
    if (!td || e.pointerId !== td.id) return;
    td.lastY = e.clientY;
    if (!td.active) {
      // 长按生效前位移超阈值：判定为滚动/误手势，解除长按（不拦原生滚动）
      if (Math.hypot(e.clientX - td.startX, e.clientY - td.startY) > TOUCH_DRAG.SLOP_PX) {
        clearTimeout(td.lpTimer);
        try { td.chip.releasePointerCapture(td.id); } catch {}
        this._td = null;
      }
      return;
    }
    this._applyPreview(td);
  }
  _applyPreview(td) { // 实时预览：只动 transform，不写数据
    if (!td.active || !td.chips) return;
    const n = td.chips.length;
    const dy = (td.lastY - td.startY) + (this.el.scrollTop - td.scroll0); // 含自动滚动补偿
    td.to = dragTargetIndex(dy, td.slotH, td.from, n);
    const maxDy = (n - 1 - td.from) * td.slotH, minDy = -td.from * td.slotH;
    const y = Math.max(minDy, Math.min(maxDy, dy));
    td.chip.style.transform = `translateY(${y}px)`;
    for (let k = 0; k < n; k++) {
      if (k === td.from) continue;
      const s = shiftSlots(td.from, td.to, k) * td.slotH;
      td.chips[k].style.transform = s ? `translateY(${s}px)` : '';
    }
  }
  _chipPointerUp(e) {  // 落位：提交恰一条「调整队形顺序」历史（render 经 store 订阅自动重建）
    const td = this._td;
    if (!td || e.pointerId !== td.id) return;
    const { from, to, chips, active } = td;
    this._teardown(td);
    const count = this.hooks.getProject()?.formations.length;
    if (active && chips && count === chips.length && to !== from) {
      this._suppressClickUntil = performance.now() + 400;
      this.hooks.move(from, to);
    }
  }
  _chipPointerCancel(e) { // 轮10纪律：浏览器/系统中途接管 → 安全回滚（零数据写入、零历史）
    const td = this._td;
    if (!td || e.pointerId !== td.id) return;
    this._teardown(td);
  }
  _teardown(td) {
    clearTimeout(td.lpTimer);
    cancelAnimationFrame(td.raf);
    if (td.active && td.chips) {
      for (const c of td.chips) { c.style.transform = ''; c.classList.remove('lift', 'tshift'); }
    }
    try { td.chip.releasePointerCapture(td.id); } catch {}
    if (this._td === td) this._td = null;
  }
}

// ---------- 音乐模式：波形时间线 ----------
// TAG_LANE_H：尺规与队形块之间的窄 tag 道（时间轴标记：打点/改名/拖动/删除/点击跳转，
// 纯拍位标记不改播放逻辑）。道内交互独立分区：build-77-tagdel 起单点旗/点按名称尾=选中并打开
// 编辑 popover（防误删——原「单击跳转」「× 即删除」退役，删除唯二入口=长按/右键菜单、
// 索引「…」）、拖旗=移动、双击空白=打点、双击旗=改名。build-52 F3 对齐：道内空白单击/拖动=
// 定位播放线（与音乐划分轨/尺规同语义）。build-79-tagflag（需求 2）：× glyph 呈示退役，
// 旗点纯旗（点选态高亮保留）；名称尾命中面（delX）与「点按=编辑」语义保留（详见面头交互矩阵 §3）。
// ---------- build-52-wavezoom F3：双模式时间轴交互矩阵（stage=编舞 / music=音乐） ----------
// 裁定：两模式只是轨道 UI 呈示形式不同——底层实现与 clip 卡片以外的操作逻辑对齐（同一分支/
// 同一函数复用，不做两套）。逐项核对结果（✅=本轮对齐后两模式同语义；🔒=music 专属保留）：
//  1. 缩放        ✅ ctrl/meta+wheel=zoomAt 指针中心（F1，两模式同 handler）、alt+wheel=锚定、
//                 双指捏合=质心锚定（_tpMove→zoomAt，build-52 起 stage 亦进入）、＋/－/⤢=zoomCenter、
//                 fit/上限钳制各自 mode 分支共享 zoom()。build-77-zoomsel：有选中 clip（music=
//                 clipSel 音频 clip 并集 / stage=formationIndex 队形 clip）→ 全入口统一锚定
//                 选中中心（该时刻缩放前后屏幕 x 不变）；无选中=既有锚（指针/质心/视口中点）不变。
//  2. 横滚        ✅ shift+wheel 横移（共享 handler）、wheel deltaX 原生横滚、双指平移（_tpMove
//                 质心位移，build-52 起 stage 共用）、底部概览导航滑块（build-51 F4，两模式恒显）。
//  3. 空白单击=   ✅ 尺规空白、划分轨（tag 道/区域轨）空白、音频 lane 空隙、块轨空白、加轨条带——
//     定位播放线     两模式全部 seek+可拖 scrub（stage 三处为本轮补齐：tag 道空白/块轨空白/加轨条带）。
//  4. 尺规 scrub  ✅ 两模式同分支（点击/拖动定位；播放中语义由 seekBeat 既有口径承担）。
//  5. Shift+拖拽= ✅ 尺规路径两模式同分支；音频 lane 空白建选区路径留 music（🔒 stage 音轨
//     时间选区       26px 只读，单击/拖动恒 seek——属「stage 只读呈示」白名单）。
//  6. 磁吸开关    ✅ 同一 snapOn 状态（S 键 hoverAudio 作用域与工具条开关为 music UI 🔒）；
//                 stage 消费点=拖旗吸小节线（snapTagBeatToBar，本轮补齐）；music 消费点=clip
//                 缘/区域缘/建段落点/零交叉（既有）。
//  7. 🔒 clip 剪辑手势（拖移/trim/淡化/增益/剃刀/长按菜单/分割/循环预览）=music 专属；
//     stage 音轨只读呈示+单击 seek（W2 E-10 口径延续）。
//  8. 🔒 tag 区域编辑手势（拖移/跨层/调界/长按菜单/双击编辑/空白新建）=music 专属；
//     stage tag 道 build-77-tagdel：单击旗/×=选中+编辑 popover（防误删：单击跳转/× 删除退役，
//     长按/右键菜单补齐为删除入口）、拖移/双击打点改名旧口径保留（呈示收敛最深层，F2）。
export class MusicTimeline {
  // 段色板（4 色循环；tag.color 0..3 覆盖）——节奏划分轨呈示用
  static SEG_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24'];
  // ---- F2（build-52-wavezoom）：tag 呈示色单一出处 ----
  // 索引面板 ↔ 划分轨（music drawSegLane）↔ 编舞 tag 道（stage drawTags）三处同 tag 同色。
  // 色板=SEG_COLORS（4 色循环，tag.color 0..3 覆盖）；缺省序=该 tag 在**其层内**的拍序
  //（与 drawSegLane 既有逐值一致）。旧索引面板用 s.i（music 路径恒 0 / stage 全局段序），
  // 与轨道的层内序不一致 → 缺省（未换色）tag 的索引色与轨道色错位——本次收口到同一函数。
  static tagColorAt(tag, ordinalInLevel) {
    const COLORS = MusicTimeline.SEG_COLORS;
    const i = Number.isFinite(tag?.color) ? tag.color : (ordinalInLevel ?? 0);
    return COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
  }
  // 全量 tag → 颜色映射（渲染前一次算好）。层内拍序口径与 drawSegLane 的过滤+排序逐值一致：
  // 同层内 beat 升序、id 字典序兜底（同拍稳定序）。索引面板按 tag.id 取色即可与轨道同色。
  static tagColorMap(p) {
    const byLevel = new Map();
    for (const t of p?.timeline?.tags || []) {
      const lv = tagLevelOf(t) | 0;
      if (!byLevel.has(lv)) byLevel.set(lv, []);
      byLevel.get(lv).push(t);
    }
    const map = new Map();
    for (const arr of byLevel.values()) {
      arr.sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
      arr.forEach((t, k) => map.set(t.id, MusicTimeline.tagColorAt(t, k)));
    }
    return map;
  }
  // stage（编舞 18px 单道）呈示层=当前存在的**最深层**（最底层 tag 的 level）；无 tag=0。
  // 更浅层不画不可命中（呈示与 tagAt/_tagGeom 命中同集合——看见的才可交互）。
  static stageDeepestLevelOf(tags) {
    let mx = 0;
    for (const t of tags || []) { const lv = tagLevelOf(t) | 0; if (lv > mx) mx = lv; }
    return mx;
  }

  // build-88-waveui 需求 1：构造 opts 增加可选 resolveBuffer(assetId)→AudioBuffer|Promise|null
  //（main.js 由 Wave 并行 agent K 接线；缺省 null 时波形回退既有 peaks/env 绘制，观感不变——零破坏）。
  constructor({ canvas, overlay, scroll, hooks, resolveBuffer = null }) {
    this.cv = canvas; this.ov = overlay; this.scroll = scroll;
    this.inner = canvas.parentElement; // #tl-inner：tag 内联命名输入挂这里（随横向滚动移动）
    this.hooks = hooks; // {getProject(), getPlayer(), onSelectFormation(i), mutate(fn,label), mutateLabeled(fn,label), commitEdit(label), seekBeat(b), audio, canEdit(), pauseIfPlaying(), onTimeSelection(range|null), onClipContextMenu(info), onSegContextMenu(info), toast(msg), resolveProcessedClip(clip)→AudioBuffer-like|Promise|null（Wave 变速/变调 processed 波形解析，调度方接线）, processClipAudio(raw,{speed,pitchSemi})→Promise（离线处理触发，调度方接线）}
    this.secPerPx = 0;  // 0 = 自适应
    this.drag = null;
    this.hoverTag = null;      // 悬停旗点 id（旗面高亮 + title 提示；build-79-tagflag：× 已退役）
    this.activeTag = null;     // 点选旗点 id：旗面保持高亮（触屏无 hover 的点选态路径）
    this._tagGeom = new Map(); // id → {x, delX}（drawTags 落笔几何，命中 × 用）
    this._tagInput = null;     // （build-47 退役）旧内联命名输入；编辑器升级为 _tagPopover 浮层
    // ---- 节奏划分轨（W1）----
    this.selSegId = null;      // 选中区域（tag id）：高亮描边 + 单击区域=仅选中（build-49）
    this.hoverSegId = null;    // 悬停区域 id（呈示高亮）
    this._segGeom = [];        // 区域落笔几何 [{id,x0,x1}]（命中用）
    this.dragHoverTagLane = null; // build-49：区域拖体跨层预览高亮（指针所指目标划分轨 lane；松手清零）
    // ---- build-47 分层 tag 轨道（仅音乐模式）：popover 编辑器与层内长按状态 ----
    this._tagPopover = null;   // 标记编辑 popover {el, id, beat, level, done}；null=关闭
    this._swallowDown = false; // popover 关闭型点外 dismiss 吞掉的那次画布 pointerdown（不透传 scrub）
    this._tagLp = null;        // 划分轨长按状态（touch/pen）：{id,x0,y0,cx,cy,info,timer}；null=空闲
    // ---- v3 音频轨状态（W1 起「展开态」退役：affordances 跟随模式——音乐=满血、编舞=简单） ----
    this.snapOn = true;        // 磁吸（S 开关；localStorage 记忆）
    this.razor = false;        // 剃刀模式（R 开关；会话态）
    // ---- build-88-waveui 需求 1：高精度波形状态 ----
    this.resolveBuffer = resolveBuffer; // assetId → AudioBuffer|Promise|null（K 接线契约：构造 opts.resolveBuffer）
    this._tiles = new WaveTileCache(8); // 波形列极值缓存（LRU 上限 8 条，键见 waveTileKey）
    this._bufCache = new Map();         // resolveBuffer 同步结果缓存（assetId→AudioBuffer）
    this._bufPend = new Set();          // 在途 Promise 去重（防每帧重复挂 then→render 循环）
    // ---- Wave 变速/变调 processed 波形状态 ----
    this._procMemo = new Map();         // resolveProcessedClip 同步结果 memo（`${assetId}|${clipProcessKey}`→buffer-like）
    this._procPend = new Set();         // processed 在途去重（同 memo 键；Promise 到位 requestDraw 一次）
    this.clipSel = new Set();  // 选中 clip id（单选/Ctrl 多选）
    this.timeSel = null;       // 时间选区 {start, end}（秒；空白拖拽/尺规 Shift 拖拽）
    this.hoverClipEdge = null; // {id, part} 悬停命中（光标 + 边缘高亮）
    this.hoverAudio = false;   // 悬停音频轨（S/R 快捷键作用域判定）
    this._projectId = null;    // 项目切换检测（清 clip 选择态）
    this._mLaneH = MUSIC_LANE_MAX_H; // 音乐模式 lane 高（render 按容器实测推导缓存）
    this._containerH = 0;            // tl-scroll 实测高（音乐模式每 render 采样）
    this.dragHoverLane = null;       // W3：clip 拖移中指针所指目标 lane（纯前端高亮，不碰模型；松手清零）
    // ---- build-79-laneh（需求 9①）：轨级 lane 高拖拽状态 ----
    this._laneHPreview = new Map();  // trackId → 预览 px（拖动中内存值，pointerup 才经 mutate 落盘 track.laneH）
    this._laneHDrag = null;          // {pointerId,trackId,row,startY,startH}；null=空闲
    // ---- build-44-tlnav：音乐模式触屏导航（双指平移+捏合）与长按剪切状态 ----
    this._tpPts = new Map();   // 活跃触点（pointerId → {x,y} client 坐标；仅 touch/pen 登记）
    this._tp = null;           // 双指手势进行中：上一帧两指几何 {ax,ay,bx,by}；null=未激活
    this._lp = null;           // 长按状态：{id,clipId,cx,cy,x0,y0,sec,timer}；null=空闲
    this._lpFiredAt = -1e9;    // 长按菜单触发时刻（Android 原生 contextmenu 跟弹的抑制窗起点）；
                               // 负初值：performance.now() 自进程/页面加载从 0 计，0 初值会误吞开局 800ms 内的右键
    // ---- round46 Lane A：双 UI 模式（'stage'=编舞默认 | 'music'=音乐）----
    // 旧键一次性迁移（C6）：resolveInitialUiMode 读 uiMode/旧展开键，读后旧键退役（无人再写）
    this.mode = 'stage';
    try { this.mode = resolveInitialUiMode(typeof localStorage !== 'undefined' ? localStorage : null); } catch {}
    // 尺规刻度（决策⑥）：'beat'=小节/8拍（默认，恒定 BPM 口径）| 'sec'=秒（变速曲降级对齐）
    // W3 分键：按当前模式读 wuzhen:rulerScale.<mode>（旧单键一次性播种；两模式互不串）
    this.rulerScale = 'beat';
    try { this.rulerScale = resolveRulerScaleFor(typeof localStorage !== 'undefined' ? localStorage : null, this.mode); } catch {}
    try { this.snapOn = localStorage.getItem('wuzhen:audioSnap') !== '0'; } catch {}
    // W1：容器尺寸变化（模式切换/窗口缩放/flex 反转）→ 重采样重绘（音乐模式高度不再写死）
    if (typeof ResizeObserver !== 'undefined' && this.scroll) {
      this._ro = new ResizeObserver(() => this.render());
      this._ro.observe(this.scroll);
    }
    this._bind();
  }
  // 展开态退役（C6/C7）：affordances 改由模式派生——音乐=满血剪辑 UI、编舞=26px 简单道。
  // 保留只读访问器兼容既有仪器快照（window.__fs.snapshot().audioTrack.expanded）。
  get expanded() { return this.mode === 'music'; }
  pxPerSec() { return this.secPerPx ? 1 / this.secPerPx : 0; }
  // 时间轴域长（秒）：music=音乐域（musicDomainSec——秒制基座，M1）；stage=blocks 域（逐值不动）。
  domainSecOf(p) {
    if (this.mode !== 'music') {
      const { totalBeats } = segmentsFromClips(p.formations);
      return beatToSec(p, totalBeats) || 10;
    }
    return musicDomainSec(p);
  }
  laneVisibleW() {
    // M2 修（build-37-headerfix）：画布可视域宽 = 容器宽 − 轨头列宽。轨头是 flex 兄弟列，画布从其
    // 右缘起绘——可视 lane 区只有 (clientWidth − headW)。旧代码拿整容器宽当地板/fit 基准，画布恒
    // 比 lane 区宽 headW → fit 态也有 headW 横向溢出，右滚（看曲尾/锚定缩放）即把 clip 前段滑入
    // sticky 轨头之下（用户实测：轨头卡片盖住 clip 开头不可见）。
    // stage 模式 headWidth()=0 → 退化为旧值（逐值不动，红线 E-12）。
    const w0 = this.scroll?.clientWidth || 600;
    const headW = this.headWidth();
    return headW > 0 ? Math.max(120, w0 - headW) : w0;
  }
  layoutWidth(p) {
    const w0 = this.laneVisibleW();
    if (this.secPerPx) return Math.max(w0, this.domainSecOf(p) / this.secPerPx);
    // 自适应：music=fit 即地板（域+2s 尾余量铺满 lane 可视区，缩到底=整曲入画，无「细缝+空底」；
    // 也不再有 headW 的隐藏溢出）。stage=既有公式逐值不动（红线）。
    if (this.mode === 'music') return Math.max(w0, musicDomainSec(p) * (w0 / (musicDomainSec(p) + 2)));
    const totalSec = this.domainSecOf(p);
    return Math.max(w0, totalSec * Math.max(8, w0 / Math.max(totalSec, 30)));
  }
  // ---- build-88-waveui 需求 3：视口窗口渲染 ----
  // 画布=视口宽（不再是「域×pps」整条内容宽），世界坐标经平移映射到画布：
  //   screenX = worldPx − scrollLeft（worldPx = sec×pps，各绘制函数坐标基准不变）。
  // #tl-inner 仍写世界宽 layoutWidth（横滚量程/#tl-nav 概览全域导航不变）；canvas/overlay 为
  // #tl-inner 内 absolute 元素（css 只读），以内联 left 跟随 scrollLeft+headW 贴视口。
  _syncCanvasOffset() {
    if (typeof document === 'undefined') return;
    // build-89 修复：轨头自 build-46 起为 flow 列（sticky 占位），#tl-inner 已从轨头右缘起排——
    // canvas left 只需跟随 scrollLeft；旧式 `+ headWidth()` 是浮层时代遗留，构成双重偏移
    // （轨头与波形区之间恒定一条 headW 宽空列，占据轨道区——用户实测）。
    const left = (this.scroll?.scrollLeft || 0) + 'px';
    for (const c of [this.cv, this.ov]) if (c && c.style) c.style.left = left;
  }
  // 可视世界 px 窗口 [viewX0, viewX1)（scrollLeft 派生；各绘制函数 early-skip 基准）
  _viewSpan() {
    const sl = Math.max(0, this.scroll?.scrollLeft || 0);
    return [sl, sl + Math.max(1, this.W || 0)];
  }
  // ---- v3 几何：音频轨夹在划分轨（tag 道）与队形块区之间，块区改为紧随其后（不再底部锚定） ----
  // 多轨（汇合轮）：编舞模式恒单 lane（既有行为，含多轨数据项目）；音乐模式每轨一条 lane。
  tracksOf(p) {
    const t = p?.timeline?.tracks;
    return (Array.isArray(t) && t.length) ? t : [];
  }
  trackCount(p) { return this.mode === 'music' ? Math.max(1, this.tracksOf(p).length) : 1; }
  // ---- build-47 分层 tag 轨道（仅音乐模式）----
  // 层集：stage 恒 [0]（红线 E-12：编舞单层 18px 逐字节不变）；music=显式 tagLevelCount 展开
  //（build-48-tagui F4：1..3，缺省 1；空层也渲染轨道——可直接双击/长按建 tag）。
  // 旧「按出现 level 推导」（tagLevelsOf）退役为索引面板专用；越层旧数据经 validate 钳到 count-1。
  segLevelsOf(p) {
    if (this.mode !== 'music') return [0];
    const n = tagLevelCountOf(p ?? this.hooks.getProject());
    return Array.from({ length: n }, (_, i) => i);
  }
  // 划分轨高：编舞=tag 道 18（既有值不动，移动端 tl 120 基线依赖）；
  // 音乐=28px × 层数（每层高保持 28 纵向堆叠；单层=28 与现状逐值一致）
  segLaneH(p) {
    if (this.mode !== 'music') return TAG_LANE_H;
    return SEG_LANE_H_MUSIC * this.segLevelsOf(p).length;
  }
  // 指针 y → 划分轨 lane 序号（0 基；轨外 → -1）。level 值经 tagLevelAtLane 取。
  tagLaneIndexAt(p, y) {
    const rel = y - (this.rulerH ?? TL_RULER_H);
    const n = this.segLevelsOf(p).length;
    if (rel <= 0 || rel > n * SEG_LANE_H_MUSIC) return -1;
    return Math.min(n - 1, Math.floor((rel - 1) / SEG_LANE_H_MUSIC));
  }
  tagLevelAtLane(p, li) { return this.segLevelsOf(p)[li] ?? 0; }
  // F2（build-52-wavezoom）：stage tag 道命中层=当前存在的最深层（与 drawTags 呈示同集合——
  // 更浅层不画即不可命中）。stage segLevelsOf 恒 [0]（E-12 几何），但 tag 数据可带更高层
  //（音乐模式建的分层区域），呈示/命中都只认最深层。
  stageLevelOf(p) { return MusicTimeline.stageDeepestLevelOf(p?.timeline?.tags); }
  tagLaneTopOf(li) { return (this.rulerH ?? TL_RULER_H) + li * SEG_LANE_H_MUSIC; }
  audioTop() { return (this.rulerH ?? TL_RULER_H) + this.segLaneH(); }
  // lane 高：编舞=简单道 26（展开态已退役）；音乐=容器推导 clamp（render 缓存）
  audioLaneH() { return this.mode === 'music' ? this._mLaneH : AUDIO_SIMPLE_H; }
  lanePitch() { return this.audioLaneH() + (this.mode === 'music' ? MUSIC_LANE_GAP : 0); }
  // 轨 i 渲染 lane 高（build-79-laneh 需求 9①）：拖动预览（内存）> track.laneH（模型，钳 [24,240]）
  // > 推导 _mLaneH（缺省回退）。无覆写/无预览时逐轨同值=既有推导，几何逐值不变。
  trackLaneHPx(p, i) {
    const t = this.tracksOf(p)[i] || null;
    const pv = t ? this._laneHPreview.get(t.id) : undefined;
    if (Number.isFinite(pv)) return clampNum(pv, TRACK_LANE_H_MIN, TRACK_LANE_H_MAX);
    return trackLaneHOf(t, this._mLaneH);
  }
  // lane 顶：逐轨累加（轨级 laneH 可不等；等值时与旧 i×pitch 公式逐值一致）
  laneTopOf(p, i) {
    let y = this.audioTop();
    const gap = this.mode === 'music' ? MUSIC_LANE_GAP : 0;
    for (let k = 0; k < i; k++) y += this.trackLaneHPx(p, k) + gap;
    return y;
  }
  // 指针 y → lane 序号（音乐模式多轨；越界钳到首/末 lane）。分槽=高+gap（末槽无 gap），
  // 等值时与旧 floor((y-audioTop)/pitch) 均匀分槽逐值一致；轨高不等时按累加界切分。
  laneIndexAt(p, y) {
    const n = this.trackCount(p);
    const rel = y - this.audioTop();
    if (!(rel > 0)) return 0;
    const gap = this.mode === 'music' ? MUSIC_LANE_GAP : 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const h = this.trackLaneHPx(p, i);
      if (rel < acc + h + (i < n - 1 ? gap : 0)) return i;
      acc += h + gap;
    }
    return n - 1;
  }
  trackAtLane(p, i) { return this.tracksOf(p)[i] || null; }
  audioBottom(p) {
    const n = this.trackCount(p);
    if (this.mode !== 'music') return this.audioTop() + n * this.audioLaneH();
    let s = this.audioTop();
    for (let i = 0; i < n; i++) s += this.trackLaneHPx(p, i); // build-79-laneh：逐轨实高求和
    return s + Math.max(0, n - 1) * MUSIC_LANE_GAP;
  }
  blocksTopFor() {
    // F5（build-46-layout）：块区顶=音频 lane 群之下。音乐模式先让过 26px 加轨条（DOM 条与
    // 轨头 tlh-ops 同位）再留 6px 间距；编舞模式无加轨条，保持 audioBottom+6 逐值不动（E-12）。
    const ops = this.mode === 'music' ? TRACKS_OPS_H : 0;
    return this.audioBottom(this.hooks.getProject()) + ops + MUSIC_BLOCKS_GAP_H;
  }
  totalHeightFor() {
    // build-83-constlane：stage 道高恒定（用户裁定：轨道区无拖高逻辑，底区拖高只作用于上方
    // 画布区）。内容恒 rows + 56 = 128：盒高富余 → 道下留白；盒高不足 → 纵滚条（溢出语义
    // build-82 已归位）。音乐模式走 totalHeightMusic（不动）。
    return this.blocksTopFor() + STAGE_LANE_DEFAULT_H;
  }
  // 音乐模式画布内容高：尺规 22 + 划分轨 28×层数（build-47 分层）+ n×laneH + (n−1)×12 轨距
  // + 加轨条 26 + 块区 42（F5：块区常显开销 MUSIC_BLOCKS_TOTAL_H）；
  // laneH=clamp((容器高−开销)/n, 56, 120)（移动端 §2.3 上限降 64——W3）。内容不足容器时画布
  // 拉满容器（背景铺满）；floor 托底仍放不下 → #tl-body 纵滚。
  totalHeightMusic(p) {
    const c = this._containerH || (typeof this.scroll?.clientHeight === 'number' ? this.scroll.clientHeight : 0) || 0;
    const n = this.trackCount(p);
    const mobile = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023.5px)').matches;
    // 分层开销（build-47）：第 2 层起每层 +28（沿用 build-45 extraH 入参模式，既有缺省调用不变）
    const extra = MUSIC_BLOCKS_TOTAL_H + (this.segLevelsOf(p).length - 1) * SEG_LANE_H_MUSIC;
    this._mLaneH = musicLaneH(c, n, TRACKS_OPS_H, mobile ? MUSIC_LANE_MAX_H_MOBILE : MUSIC_LANE_MAX_H, extra);
    // build-79-laneh（需求 9①）：内容高按逐轨实高求和——无 track.laneH 覆写时逐轨=推导值，
    // 与 musicContentH(_mLaneH,…) 均一公式逐值一致（G2W1 不回退）。划分轨计账与旧式一致：
    // 基础 28 进本式、第 2 层起每层 +28 走 extra（分层开销不双计）。
    let lanes = 0;
    for (let i = 0; i < n; i++) lanes += this.trackLaneHPx(p, i);
    const contentH = TL_RULER_H + SEG_LANE_H_MUSIC + lanes + MUSIC_LANE_GAP * Math.max(0, n - 1) + TRACKS_OPS_H + extra;
    return Math.max(contentH, c);
  }
  hasMedia(p) { return !!(p?.media?.assets?.length); }
  assetDurOf(p, assetId) { return p?.media?.assets?.find(a => a.id === assetId)?.durationSec ?? Infinity; }
  render() {
    // rAF 合帧（性能修复）：一次指针移动此前触发两次全量重绘（emit 订阅链 + 拖拽自绘），
    // 同帧合并为一次；node 测试环境无 rAF 时同步直行（行为不变）。
    if (this._renderQueued) return;
    this._renderQueued = true;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => fn();
    raf(() => { this._renderQueued = false; this._renderNow(); });
  }
  _renderNow() {
    const p = this.hooks.getProject();
    if (!p) return;
    // 项目切换：清 clip 选择态（clip id 属于项目数据）
    const pid = store_getProjectId(this.hooks);
    if (pid !== this._projectId) {
      this._projectId = pid;
      this.clipSel = new Set();
      this.timeSel = null;
      this.razor = false;
      this._lpCancel(); // D2：项目切换时长的按计时作废（旧 clip 的菜单不再有意义）
      this._endTp();    // D1：跨项目的双指手势一并中止
      this._procMemo.clear(); this._procPend.clear(); // Wave：跨项目 processed 波形 memo/在途态一并清
    }
    // M2 修（build-37-headerfix）：轨头显隐先于几何计算同步——headWidth() 读 #tl-tracks-head.hidden，
    // 若在 render 末尾才同步，启动即音乐模式/切模式的首个 render 会拿陈旧 hidden（把轨头当 0 宽），
    // 画布宽多算 headW。syncAudioDom 只动轨头 hidden 与空态灰字定位（audioTop/audioBottom 均为模式
    // 派生常量，不依赖 W/H），提前到此处安全。
    this.syncAudioDom(p);
    // 高度：编舞=固定公式（build-56 F1 起桌面基线 112（内容地板 114）/移动 120/富余域 160，
    // render 写入 scroll 高）；音乐（W1 主区化）=容器实测推导（flex 撑满，不写高），内容不足时画布拉满容器。
    let h;
    if (this.mode === 'music') {
      if (this.scroll && this.scroll.style && this.scroll.style.height) this.scroll.style.height = ''; // 清编舞模式写死的行内高，交还 flex
      this._containerH = this.scroll?.clientHeight || 0;
      h = this.totalHeightMusic(p);
    } else {
      // build-83-constlane：内容高恒 128（道高恒定）。未拖高（无 .ba-sized）写行内高=
      // flex-basis；拖高（.ba-sized）盒高由用户拖定值经 flex 链派生（css build-82 规则），
      // 不写行内高——内容 128 ≤ 盒 → 道下留白；盒 < 128 → 纵滚条（溢出语义已归位）。
      h = this.totalHeightFor();
      const baSized = !!this.scroll?.closest?.('#bottom-area')?.classList.contains('ba-sized');
      if (!baSized && this.scroll?.style && this.scroll.clientHeight !== h) this.scroll.style.height = h + 'px';
    }
    const H = Math.max(h, this.scroll.clientHeight || h);
    // build-88-waveui 需求 3（视口窗口渲染）：W=画布宽=视口 lane 宽（不再=「域×pps」内容宽）；
    // worldW=世界宽只用于 #tl-inner 撑横滚量程（#tl-nav 概览条仍全域导航）。
    const worldW = this.layoutWidth(p);
    const W = Math.max(1, Math.round(this.laneVisibleW()));
    // 物理像素钳制（移动端崩溃根因）：W 上限 8192 CSS px × devicePixelRatio(手机 3) 的
    // backing store ≈187MB/画布 ×2 张（cv+ov），逼近 iOS 画布内存上限→杀 tab。钳物理宽
    // ≤8192：放大越深精度自动降档（dprEff=min(dpr, 8192/W)），普通缩放全清晰度无损。
    // build-88 视口化后 W=视口宽、上限自动满足——公式保留作护栏。
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_PHYS_W / Math.max(1, W)));
    this._dpr = dpr; // drawPlayhead 同步用（ov 与 cv 必须同刻度）
    for (const c of [this.cv, this.ov]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    // M2 修（build-37-headerfix）：#tl-inner 显式宽度 = 世界宽——横滚量程 = headW + worldW 按构造
    // 成立（画布只是贴视口的可视窗口，不再撑量程）。
    if (this.inner) this.inner.style.width = worldW + 'px';
    this.W = W; this.H = H; this.worldW = worldW;
    this._syncCanvasOffset(); // 画布贴视口（left=scrollLeft+headW；scroll 监听在横滚时也会同步）
    // 轨头收起态（build-46 验收反馈）：内容行全 display:none 后列高 auto 塌 0——细条隐形不可点。
    // CSS 链路（.tl-grid auto 高）理不顺，直接以画布内容高写内联高，细条恒有形可点。
    const _th = typeof document !== 'undefined' ? document.getElementById('tl-tracks-head') : null;
    if (_th) {
      if (this.mode === 'music' && _th.classList.contains('tlh-collapsed')) _th.style.height = Math.round(H) + 'px';
      else if (_th.style.height) _th.style.height = '';
    }
    const ctx = this.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);
    // build-88 视口窗口平移：此后所有绘制沿用世界 px 坐标（x=sec×pps，与旧全宽画布逐值同源），
    // 画布只露 [scrollLeft, scrollLeft+W] 窗口（drawPlayhead 对 overlay 同一平移）。
    ctx.translate(-(this.scroll?.scrollLeft || 0), 0);
    this.drawRuler(ctx, p, H);
    this.drawAudioLane(ctx, p, H);
    // F5（build-46-layout）：块区两模式常显——音乐模式块区置于加轨条之下（blocksTopFor 模式
    // 感知），单击选队形/悬停高亮/拖边调保持过渡全量复用编舞逻辑（edgeHits stage-only 门控
    // 已移除，y 域由调用方钳在块区带）；块数据同一份（segmentsFromClips），零拷贝零分支。
    this.drawBlocks(ctx, p, H);
    if (this.mode === 'music') this.drawSegLane(ctx, p); // 节奏划分轨（28px：段色块/名称胶囊/边界线+旗）
    else {
      this.drawTags(ctx, p);
      this.drawSegEmphasis(ctx, p); // W2 §2.2.1③b：编舞浓缩呈现——段边界强调刻度线（纯绘制层，零交互）
    }
    this.drawPlayhead();
    // syncAudioDom 已前移至 render 顶部（build-37-headerfix：headWidth() 需在读几何前拿到
    // 轨头最新 hidden 态——见 render 开头注）
    // E2E 信号：全量渲染出口 +1（drawPlayhead 单独局部重绘不经此处，不计；Node 导入无 window 跳过）
    if (typeof window !== 'undefined' && window.__fs) window.__fs.renderSeq++;
    this.hooks.onAfterRender?.(); // build-51-stageux F4：概览导航条拇指同步（W 变化源；缺省零开销）
  }

  // ---- W2 节奏划分浓缩呈现（§2.2.1③b，编舞模式专用）----
  // 段边界以强调刻度线绘制：2px（粗于普通 1px 拍线）、段色着色（SEG_COLORS，tag.color 覆盖），
  // 纵贯尺规 + tag 道 + 音频简单道（播放头 overlay 仍在最上层）。段名呈示由既有 tag 道名称胶囊
  // 与旗点原生 title（空间不足时悬浮）承担，不重复绘制文本。纯绘制层增强：零交互变化、
  // 零基础体验影响（红线 E-12 不动）；无 tags 时零残留（不画任何线，IR-W2-5）。
  drawSegEmphasis(ctx, p) {
    const tags = p.timeline.tags || [];
    if (!tags.length) return;
    const { segs } = sectionSegmentsOf(p);
    if (!segs.length) return;
    const pps = this.ppsOf(p);
    const bottom = this.audioBottom(p);
    const COLORS = MusicTimeline.SEG_COLORS;
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口：只画可视段界
    ctx.save();
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const x = beatToSec(p, s.start) * pps;
      if (x > viewX1) break;
      if (x < viewX0) continue;
      const ci = ((s.tag.color ?? k) % COLORS.length + COLORS.length) % COLORS.length;
      ctx.strokeStyle = COLORS[ci];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 音频轨 DOM 附属（轨头显隐、空态入口）随几何同步。
  // W1 退役（C6/C7/C16）：#tl-audio-toggle 展开钮与 #tl-head 编舞展开态表头整体删除，
  // 互斥显示逻辑随之消亡——轨头只看 music 模式。
  // W2（C12 空态合并）：#tl-audio-empty 由「＋载入/媒体库」双钮改为一行灰字（点击跳音乐模式，
  // main.js 接线），只在编舞模式无音乐时呈示；音乐模式空态由工具条资产组承接（恒可见载入/媒体库）。
  // M2（轨头 container 化）：轨头浮层定位（top/height 内联写入）整段退役——轨头改为 #tl-scroll
  // 内 sticky flex 列（与 lane 区同一行容器），行高对齐按构造成立，遮挡与错位按构造消失。
  syncAudioDom(p) {
    if (typeof document === 'undefined') return;
    const media = this.hasMedia(p);
    const multi = this.mode === 'music';
    const th = document.getElementById('tl-tracks-head');
    if (th) {
      // build-89：可见性翻转即触发轨头重建——syncTracksHead 有 hidden 早退门，若主渲染
      // 的建卡先于本翻转执行，卡片会缺失到下一次状态渲染（切模式首帧实测缝隙）。
      const wasHidden = th.hidden;
      th.hidden = !multi;
      if (wasHidden && !th.hidden && typeof window !== 'undefined') {
        try { window.__fs?.syncTracksHead?.(p); } catch {}
      }
    }
    const empty = document.getElementById('tl-audio-empty');
    if (empty) {
      empty.hidden = !(this.mode === 'stage' && !media); // 仅编舞模式无音乐时呈示灰字
      empty.style.top = this.audioTop() + 'px';
      empty.style.height = (this.audioBottom(p) - this.audioTop()) + 'px';
    }
  }

  // ---- v3 音频轨绘制（汇合轮：音乐模式每轨一条 lane；W1 起 lane 间距 12px 仅音乐模式） ----
  drawAudioLane(ctx, p, h) {
    const n = this.trackCount(p);
    const lh = this.audioLaneH(); // 缺省推导值（轨级 laneH 覆写时逐轨实高见 trackLaneHPx）
    const gap = this.mode === 'music' ? MUSIC_LANE_GAP : 0;
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口：满宽铺装/缘线只过可视窗
    ctx.save();
    // lane 底与上下缘（轨静音=lane 底更暗一档，呈示语义；轨分隔线隔开各轨）
    // build-79-laneh（需求 9①）：逐轨实高绘制（无覆写时=推导值，逐值不变）
    for (let i = 0; i < n; i++) {
      const top = this.laneTopOf(p, i);
      const hi = this.trackLaneHPx(p, i);
      ctx.fillStyle = this.tracksOf(p)[i]?.muted ? 'rgba(148,163,184,.028)' : 'rgba(148,163,184,.05)';
      ctx.fillRect(viewX0, top, viewX1 - viewX0, hi);
      ctx.strokeStyle = 'rgba(148,163,184,.2)';
      ctx.beginPath();
      ctx.moveTo(viewX0, top + hi + .5); ctx.lineTo(viewX1, top + hi + .5);
      ctx.moveTo(viewX0, top + .5); ctx.lineTo(viewX1, top + .5);
      ctx.stroke();
    }
    // W3 拖移中跨轨预览（§4.2 手势增强）：clip 拖移中按指针 y 高亮目标 lane——纯前端高亮，
    // 不碰模型（跨轨落轨仍由既有 _applyClipMove 的 moveClipToTrack 承担）；非拖移态零残留。
    if (this.mode === 'music' && n > 1 && this.dragHoverLane != null && this.dragHoverLane >= 0 && this.dragHoverLane < n) {
      const top = this.laneTopOf(p, this.dragHoverLane);
      const hl = this.trackLaneHPx(p, this.dragHoverLane); // build-79-laneh：目标 lane 实高
      ctx.fillStyle = 'rgba(56,189,248,.13)';
      ctx.fillRect(viewX0, top, viewX1 - viewX0, hl);
      ctx.strokeStyle = 'rgba(56,189,248,.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(viewX0, top + 1); ctx.lineTo(viewX1, top + 1);
      ctx.moveTo(viewX0, top + hl - 1); ctx.lineTo(viewX1, top + hl - 1);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    const clips = clipsOf(p);
    if (!this.hasMedia(p)) {
      if (this.expanded) {
        ctx.fillStyle = 'rgba(148,163,184,.55)';
        ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
        ctx.fillText('载入音乐后在此剪辑（工具条「＋ 载入音乐」或「媒体库」）', 10, this.audioTop() + lh / 2); // canvas 呈示用纯文字（icon-mapping §六）
      }
      ctx.restore();
      return;
    }
    // 时间选区（蓝色高亮带，先画在底层；音乐模式纵贯全部轨 lane）
    if (this.timeSel) {
      const pps0 = this.ppsOf(p);
      const x0 = this.timeSel.start * pps0, x1 = this.timeSel.end * pps0;
      ctx.fillStyle = 'rgba(56,189,248,.16)';
      ctx.fillRect(x0, this.audioTop(), Math.max(1, x1 - x0), this.audioBottom(p) - this.audioTop());
      ctx.strokeStyle = 'rgba(56,189,248,.7)';
      ctx.beginPath();
      ctx.moveTo(x0 + .5, this.audioTop()); ctx.lineTo(x0 + .5, this.audioBottom(p));
      ctx.moveTo(x1 - .5, this.audioTop()); ctx.lineTo(x1 - .5, this.audioBottom(p));
      ctx.stroke();
    }
    const pps = this.ppsOf(p);
    // clip 按轨分组绘制（组内保持数组 z 序；编舞模式 n=1 全量单 lane 既有行为）
    for (let i = 0; i < n; i++) {
      const tid = this.tracksOf(p)[i]?.id;
      const top = this.laneTopOf(p, i);
      for (const c of clips) {
        if (n > 1 && (trackOfClip(p, c)?.id) !== tid) continue;
        this.drawClipBox(ctx, p, c, top, lh, pps);
      }
    }
    // 交叉淡化接缝把手（build-45）：同轨 auto 配对（fadeOutAuto/autoPairOut + fadeInAuto/
    // autoPairIn 双缘互指）在交叠中点画菱形手柄——纵向拖=双曲线同调（_move xFade 分支），
    // 交叉时间锁定不动。computeOverlaps 已同轨过滤（F1 规格变更：跨轨重叠零自动干预、
    // 不画手柄）；手动淡化重叠对不画（各 clip 用自己的缘把手调曲线）。
    // 红线 E-12：淡化把手属剪辑部件，只画在音乐模式（expanded）渲染路径——编舞模式不画
    //（旧实现在 stage 也画此菱形，但 _xFadeHit 一直 expanded 门控、stage 不可命中，属死视觉）。
    if (this.expanded) for (const ov of computeOverlaps(clips)) {
      if (!(ov.a.fadeOutAuto && ov.a.autoPairOut === ov.b.id && ov.b.fadeInAuto && ov.b.autoPairIn === ov.a.id)) continue;
      const li = n > 1 ? Math.max(0, this.tracksOf(p).findIndex(t => t.id === trackOfClip(p, ov.a)?.id)) : 0;
      const mx = ((ov.start + ov.end) / 2) * pps;
      if (mx < viewX0 - 6 || mx > viewX1 + 6) continue; // build-88 视口窗口：出窗接缝把手早退
      const my = this.laneTopOf(p, li) + 10;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#e879f9';
      ctx.strokeStyle = 'rgba(232,121,249,.5)';
      ctx.lineWidth = 1;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
    }
    ctx.restore();
  }
  // ---- build-88-waveui 需求 1：clip 资产 AudioBuffer 解析（resolveBuffer 钩子优先）----
  // 钩子可返 AudioBuffer | Promise<AudioBuffer> | null：Promise 到位后入缓存并补绘一帧
  //（本帧先走 env/平线兜底绘制）；无钩子/钩子未中 → 既有 hooks.audio.resolveAssetBuffer 同步链
  // 兜底（零破坏）。_bufCache/_bufPend 去重，防每帧重复挂 then→render 循环。
  _resolveClipBuffer(assetId) {
    const cached = this._bufCache.get(assetId);
    if (cached) return cached;
    const rb = this.resolveBuffer;
    if (typeof rb === 'function') {
      let v = null;
      try { v = rb(assetId) ?? null; } catch { v = null; }
      if (v && typeof v.then === 'function') {
        if (!this._bufPend.has(assetId)) {
          this._bufPend.add(assetId);
          Promise.resolve(v).then(b => {
            this._bufPend.delete(assetId);
            if (b) { this._bufCache.set(assetId, b); this.render(); } // 到位补绘（波形升精度）
          }).catch(() => { this._bufPend.delete(assetId); });
        }
      } else if (v) {
        this._bufCache.set(assetId, v);
        return v;
      }
    }
    return this.hooks.audio?.resolveAssetBuffer?.(assetId) || null; // 既有同步链兜底
  }
  // ---- Wave 变速/变调：clip processed buffer 解析（hooks.resolveProcessedClip(clip) 优先）----
  // 调度方接线契约：返回 AudioBuffer-like | processClipAudio 结果对象 | Promise | null（缓存归调度
  // 方）。同步非空 → 波形 1:1 直采主路径；thenable（处理中）→ 到位补绘一帧（Promise.then 里一次
  // requestDraw），本帧按未就绪呈「处理中…」；null/未接线/异常 → 回退 raw buffer。memo 按
  // `${assetId}|${clipProcessKey(c)}` 记同步结果（键含资产 id——clipProcessKey 只是指纹，跨资产防撞）。
  _resolveProcessedClip(c) {
    const rp = this.hooks.resolveProcessedClip;
    if (typeof rp !== 'function') return null;
    const mk = `${c.assetId}|${clipProcessKey(c)}`;
    const memo = this._procMemo.get(mk);
    if (memo) return memo;
    let v = null;
    try { v = rp(c) ?? null; } catch { v = null; }
    if (v && typeof v.then === 'function') {
      if (!this._procPend.has(mk)) {
        this._procPend.add(mk);
        Promise.resolve(v).then(b => {
          this._procPend.delete(mk);
          if (b) { this._procMemo.set(mk, b); this.requestDraw(); } // 就绪自动补绘（每键恰一次）
        }).catch(() => { this._procPend.delete(mk); });
      }
      return null; // 处理中：本帧按未就绪呈示（「处理中…」徽标 + raw 回退波形）
    }
    if (v) this._procMemo.set(mk, v);
    return v;
  }
  // 异步就绪补绘入口（变速/变调处理完成 / processed Promise 到位）：render 自带 rAF 合帧，
  // 同帧多次触发只绘一次；node 测试无 rAF 时同步直行。
  requestDraw() { this.render(); }
  drawClipBox(ctx, p, c, top, lh, pps) {
    const x0 = c.timelineStartSec * pps, x1 = clipEnd(c) * pps, w = x1 - x0;
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口：出窗 clip 早退（不进任何落笔）
    if (x1 <= viewX0 || x0 >= viewX1) return;
    const pad = this.expanded ? 3 : 3;
    const y0 = top + pad, y1 = top + lh - pad;
    const color = c.color || CLIP_DEFAULT_COLOR;
    const speed = clipSpeedOf(c); // Wave 变速（缺省/非法=1；processed 主路径 1:1、raw 回退 ×speed）
    const semi = clipSemiOf(c);   // Wave 变调半音（缺省/非法=0；徽标呈示用）
    const selected = this.clipSel.has(c.id);
    const visX0 = Math.max(viewX0 - 2, x0), visX1 = Math.min(viewX1 + 2, x1);
    ctx.save();
    // 盒底
    ctx.fillStyle = hexA(color, c.muted ? .05 : .13);
    ctx.fillRect(visX0, y0, visX1 - visX0, y1 - y0);
    // 波形（build-88-waveui 需求 1：解码 AudioBuffer 逐像素列直读优先；env/平线两级回退）——
    // Wave 双链 buffer 解析：needsProcess(clip) 时优先 processed（hooks.resolveProcessedClip，
    // 保音高 TSM+变调离线处理产物，1:1 直采——transport/mixdown 同源消费面）；null（未就绪/
    // 未接线）→ 回退 raw buffer（_resolveClipBuffer 既有链，×speed 磁带式近似映射）。无处理
    // clip 两链同值（speed=1），行为与旧链逐值一致。
    // 主路径：每可见像素列对应 buffer 采样区间 [列起点, +1/pps)，真 [min,max]（columnMinMax
    // stride 有界）→ 任意缩放下峰谷位置与真实波形逐像素吻合。列极值 LRU 缓存：横滚/拖动命中
    // 零分配零重扫、缩放换列数才重算；tile 惰性逐列填充（±Infinity=未算哨兵）——只算可见列，
    // 禁止全轨重扫。回退① env 桶聚合（buffer 未就绪；build-52 F4 既有逐列真值绘制，观感不变）、
    // 回退② 0.14 平线（env 也未就绪既有兜底）。增益链（gain×fade，列左缘取样）三路径同源。
    const env = this.hooks.audio?.assets?.get(c.assetId)?.env || null;
    const mid = (y0 + y1) / 2;
    const amp = (y1 - y0) / 2 - (this.expanded ? 6 : 4);
    const gfBase = Math.min(1.6, c.gain ?? 1);
    ctx.fillStyle = hexA(color, c.muted ? .22 : .58);
    const proc = needsProcess(c) ? this._resolveProcessedClip(c) : null; // processed 优先（无处理不询钩子）
    const buf = this._resolveClipBuffer(c.assetId); // raw 基线（resolveBuffer 钩子 → 既有同步链兜底）
    const waveBuf = proc || buf; // Wave 双链：processed 命中则波形改读 processed（1:1），否则 raw
    const ch0 = channelData0Of(waveBuf); // AudioBuffer 与 processClipAudio 结果对象双形态兼容
    const sr = (env?.sampleRate || (waveBuf && waveBuf.sampleRate) || 44100);
    const [vx0, vx1] = visibleColumnRange(this.scroll?.scrollLeft, this.scroll?.clientWidth, this.headWidth(), this.worldW || this.W);
    const gx0 = Math.max(Math.ceil(visX0), vx0), gx1 = Math.min(visX1, vx1); // 可视列并集（盒内∩窗口）
    if (ch0 && waveBuf.sampleRate > 0) {
      // ---- 主路径：解码样本直读（采样级对齐视图）----
      const peak = env && Number.isFinite(env.peak) && env.peak > 1e-6 ? env.peak : 1;
      const srcRate = waveBuf.sampleRate;
      // processed 主路径：processed[i] ≙ src[i×speed] ⇒ clip 内容起点（processed 域）=
      // srcStartSec÷speed；1:1 直采（mult=1）。raw 回退路径：起点不缩、列相对时刻 ×speed
      //（磁带式瞬态近似——processed 到位后自动升 1:1 精度）。
      const mult = proc ? 1 : speed;
      const srcStartSamples = proc ? (c.srcStartSec * srcRate) / speed : c.srcStartSec * srcRate;
      const cols = Math.max(1, Math.ceil(x1 - x0));
      // 列极值缓存键：raw 路径=既有 3 段+speed 百分子（waveTileKey）；processed 路径=
      // assetId|clipProcessKey(clip)|起点样本|列数——键含 speed/semi 指纹（重变速/变调后按构造
      // 不可能命中陈旧 tile；旧键留 LRU 内自然淘汰）+资产/起点/列数防撞（clipProcessKey 只是
      // 参数指纹，不含资产与几何）。
      const tile = cols <= WAVE_TILE_MAX_COLS
        ? this._tiles.set(proc
          ? `${c.assetId}|${clipProcessKey(c)}|${Math.round(srcStartSamples)}|${cols}`
          : waveTileKey(c.assetId, srcStartSamples, cols, mult), cols)
        : null; // 超长 clip 深放大：瞬态逐帧算（仍只算可视列，量=可视宽）防 LRU 撑爆内存
      const firstCol = Math.ceil(x0);
      for (let x = gx0; x < gx1; x++) {
        const col = x - firstCol;
        let mn, mx;
        const rel = (x - x0) / pps;                                   // 列左缘的时间轴相对时刻
        const sA = srcSampleAt(srcStartSamples, rel, mult, srcRate);  // 列覆盖的采样区间 [sA,sB)
        const sB = srcSampleAt(srcStartSamples, (x + 1 - x0) / pps, mult, srcRate);
        if (tile && col >= 0 && col < cols && tile.min[col] !== Infinity) {
          mn = tile.min[col]; mx = tile.max[col];                      // 缓存命中：零分配零重扫
        } else {
          [mn, mx] = columnMinMax(ch0, sA, sB);
          if (tile && col >= 0 && col < cols) { tile.min[col] = mn; tile.max[col] = mx; }
        }
        const gf = gfBase * fadeEnvAt(c, (x - x0) / pps);              // 既有 gain×fade 增益链
        const aT = Math.max(1, (mx / peak) * gf * amp);
        const aB = Math.max(1, (-mn / peak) * gf * amp);
        ctx.fillRect(x, mid - aT, 1, aT + aB);                         // 真 min/max 竖条（非对称保留波形形状）
      }
    } else if (env) {
      // ---- 回退①：env 桶聚合（build-52 F4 既有路径逐值保留）----
      // varispeed 注：本回退为 buffer 未就绪的瞬态近似，暂不映射 rate（wavezoom.test.js 钉死
      // envColumnMinMax 调用形态且签名归 audio-clips.js/L 所有）；buffer 到位后主路径即按 rate 直读。
      for (let x = gx0; x < gx1; x++) {
        const rel = (x - x0) / pps;                       // 列左缘的 clip 相对时刻
        const t0 = c.srcStartSec + rel;                   // 列覆盖的 src 区间 [t0, t0+列宽秒)
        const [mn, mx] = envColumnMinMax(env, ch0, t0, t0 + 1 / pps, sr);
        const gf = gfBase * fadeEnvAt(c, rel);            // 增益×淡化（列左缘取样，与旧口径一致）
        const aT = Math.max(1, mx * gf * amp);
        const aB = Math.max(1, -mn * gf * amp);
        ctx.fillRect(x, mid - aT, 1, aT + aB);
      }
    } else {
      // ---- 回退②（0.14 既有）：包络未就绪（资产未解码）画平线——仍只走可视列 ----
      for (let x = gx0; x < gx1; x++) {
        const rel = (x - x0) / pps;
        const v = .14 * gfBase * fadeEnvAt(c, rel);
        const a = Math.max(1, v * amp);
        ctx.fillRect(x, mid - a, 1, a * 2);
      }
    }
    // 名牌
    const nm = (c.name || '音频') + (c.muted ? '（静音）' : '');
    if (w > 34) {
      ctx.fillStyle = c.muted ? 'rgba(148,163,184,.8)' : '#e2e8f0';
      ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
      const maxChars = Math.floor((w - 8) / 6.2);
      if (maxChars > 1) ctx.fillText(nm.slice(0, maxChars), x0 + 4, y0 + 2);
    }
    // 变速/变调徽标（Wave 双旋钮）：右上角 10px「×1.25 +3st」——speed≠1 / pitchSemi≠0 分节各自
    // 出现，缺省节省略。needsProcess 且 processed 未就绪 → 同位呈「处理中…」小字（处理完成经
    // requestDraw 自动补绘升 processed 波形）。呈示与名牌同层（非剪辑部件，E-12 两模式皆画）；
    // w≤20px 的退化窄盒不画（文本远宽于盒身糊邻道，同名牌宽度门）。
    const badge = (needsProcess(c) && !proc) ? '处理中…'
      : [
        speed !== 1 ? `×${speed.toFixed(2)}` : '',
        semi ? `${semi > 0 ? '+' : ''}${semi}st` : '',
      ].filter(Boolean).join(' ');
    if (badge && w > 20) {
      ctx.save();
      ctx.fillStyle = hexA(color, .95);
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(badge, x1 - 3, y0 + 2);
      ctx.restore();
    }
    if (this.expanded) {
      // 增益包络横线（黄，中线）
      ctx.strokeStyle = 'rgba(250,204,21,.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0 + 2, mid); ctx.lineTo(x1 - 2, mid); ctx.stroke();
      // 淡化把手（顶部方把手；auto 交叉淡化呈品红）——F3（build-46-layout）常驻：无条件绘制，
      // fade=0 时把手贴 clip 左/右缘、半档明度（rgba 45%）提示「未设置」；hover/触屏命中区
      // 不变（10/14px）。从 0 横拖=创建淡化、拖回缘=清除（既有钳 0 路径）。把手与 trim 缘把手
      // 的视觉重叠按命中次序让步（fade 仅顶部 16px 带优先，见 _audioHit 注），不做几何偏移。
      const drawFh = (fx, isAuto, idle) => {
        ctx.fillStyle = isAuto ? '#e879f9' : (idle ? 'rgba(125,211,252,.45)' : '#7dd3fc');
        ctx.fillRect(fx - 3.5, y0 - 1.5, 7, 7);
        ctx.strokeStyle = 'rgba(2,6,23,.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(fx - 3.5, y0 - 1.5, 7, 7);
      };
      drawFh(x0 + (c.fadeInSec || 0) * pps, !!c.fadeInAuto, !((c.fadeInSec || 0) > 0.005));
      drawFh(x1 - (c.fadeOutSec || 0) * pps, !!c.fadeOutAuto, !((c.fadeOutSec || 0) > 0.005));
      // 淡化曲线（build-45 F4）：把手的「速度」可视化——采样 14 点折线，形状由 fadeEdgeEnv
      // 实时给出（与听感同源）。auto 用品红（同 auto 把手配色）、手动用浅蓝；配色即可区分，
      // 不另引入新色。交叉淡化区两 clip 各自的曲线在同一 lane 相向收/放，视觉自然呈 X 交汇。
      const drawFadeCurve = (edge) => {
        const fi = c.fadeInSec || 0, fo = c.fadeOutSec || 0;
        const isIn = edge === 'in';
        const span = (isIn ? fi : fo) * pps;
        if (span <= 0.05) return;                       // 与把手同一可见阈（0.005s × pps 兜底亚像素）
        const k = isIn ? (c.fadeInCurve || 0) : (c.fadeOutCurve || 0);
        const isAuto = isIn ? !!c.fadeInAuto : !!c.fadeOutAuto;
        const bx = isIn ? x0 : x1 - span;               // 曲线起点缘（淡入=左缘、淡出=把手位）
        ctx.strokeStyle = isAuto ? 'rgba(232,121,249,.9)' : 'rgba(125,211,252,.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const N = 14;
        for (let i = 0; i < N; i++) {
          const s = i / (N - 1);
          // th：淡入=已进行比例 s；淡出=距终点比例（自把手向右 1→0）——与 fadeEnvAt 相位同口径
          const th = isIn ? s : 1 - s;
          const v = fadeEdgeEnv(th, k);
          const px = bx + s * span;
          const py = y1 - v * (y1 - y0);                // 包络 0..1 → 盒底..盒顶（淡出帘语义）
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
      };
      if ((c.fadeInSec || 0) > 0.005) drawFadeCurve('in');
      if ((c.fadeOutSec || 0) > 0.005) drawFadeCurve('out');
      // trim 缘（M3 T1）：两端把手 glyph 常驻（竖把×2+中缺刻，Audition 式）——hover 增亮至实色
      // +外描边、选中呈实色；laneH<40 或 clip 宽<24px 降级为既有 3px 半透明线（窄盒防糊）。
      // 命中热区与 glyph 解耦（_audioHit：10px/触屏 14px），把手只承担「可见」。
      const hotL = this.hoverClipEdge?.id === c.id && (this.hoverClipEdge.part === 'trimL' || this.hoverClipEdge.part === 'trimLB');
      const hotR = this.hoverClipEdge?.id === c.id && (this.hoverClipEdge.part === 'trimR' || this.hoverClipEdge.part === 'trimRB');
      if (lh < 40 || w < 24) {
        ctx.fillStyle = hotL ? '#f43f5e' : 'rgba(244,63,94,.5)';
        ctx.fillRect(x0 - 1.5, y0, 3, y1 - y0);
        ctx.fillStyle = hotR ? '#f43f5e' : 'rgba(244,63,94,.5)';
        ctx.fillRect(x1 - 1.5, y0, 3, y1 - y0);
      } else {
        this._drawTrimGrip(ctx, x0, y0, y1, hotL ? 2 : selected ? 1 : 0);
        this._drawTrimGrip(ctx, x1, y0, y1, hotR ? 2 : selected ? 1 : 0);
      }
    }
    // 选中高亮描边
    if (selected) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - 1, y0 - 1, w + 2, y1 - y0 + 2);
    }
    ctx.restore();
  }
  // M3 T1：trim 把手 glyph。mode：0=常驻（半透明可见）1=选中 clip（近实色）2=hover（实色+外描边）。
  // 形态：缘线贯穿全高（细）+ 中线上下两截竖把、中间 3px 缺刻（Audition 修剪把手式样）。
  _drawTrimGrip(ctx, x, y0, y1, mode) {
    const mid = (y0 + y1) / 2;
    const a = mode === 2 ? 1 : mode === 1 ? .95 : .6;
    ctx.fillStyle = `rgba(244,63,94,${(a * .7).toFixed(3)})`;
    ctx.fillRect(x - 1, y0, 2, y1 - y0);          // 缘线（全高贯穿）
    ctx.fillStyle = `rgba(244,63,94,${a})`;
    ctx.fillRect(x - 2.5, mid - 9.5, 5, 8);       // 上竖把
    ctx.fillRect(x - 2.5, mid + 1.5, 5, 8);       // 下竖把（中缺刻 3px）
    if (mode === 2) {                              // hover 强化：外描边
      ctx.strokeStyle = 'rgba(244,63,94,.95)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 3.5, mid - 10.5, 7, 10);
      ctx.strokeRect(x - 3.5, mid + .5, 7, 10);
      ctx.lineWidth = 1;
    }
  }

  drawRuler(ctx, p, h) {
    const pps = this.ppsOf(p);
    const rulerH = TL_RULER_H;
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口：尺规只画可视窗
    ctx.save();
    ctx.fillStyle = '#131c31';
    ctx.fillRect(viewX0, 0, viewX1 - viewX0, rulerH);
    ctx.strokeStyle = '#243049'; ctx.fillStyle = '#8ea2bd';
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    // build-77-expux（时间唯一标准）：stage 模式强制秒刻度——拍/小节网格在编舞模式退役，
    // 拍/秒切换钮（编舞摘要条）随本决策移除；music 模式仍按 rulerScale（缺省秒、可切拍）不动。
    if (this.rulerScale === 'sec' || this.mode === 'stage') {
      // 秒刻度（决策⑥降级刻度）：NICE 秒族主刻度 + 1/5 细分短线；变速曲/无节拍音乐按秒对齐
      const step = niceSecStep(pps);
      ctx.beginPath();
      let k = Math.max(0, Math.floor(viewX0 / (step * pps))); // build-88：跳到可视首刻度（早跳过出窗前缀）
      for (; ; k++) {
        const x = k * step * pps;
        if (x > viewX1) break;
        ctx.moveTo(x, rulerH - 8); ctx.lineTo(x, h);
        ctx.fillText(fmtSecLabel(k * step), x + 3, rulerH / 2);
      }
      const minor = step / 5;
      if (minor * pps >= 10) {
        for (k = Math.max(0, Math.floor(viewX0 / (minor * pps))); ; k++) {
          const x = k * minor * pps;
          if (x > viewX1) break;
          ctx.moveTo(x, rulerH); ctx.lineTo(x, rulerH + 6);
        }
      }
      ctx.stroke();
      ctx.restore();
      this.rulerH = rulerH;
      return;
    }
    const bpb = p.audio.beatsPerBar || 4;
    const spbV = spb(p);
    const pxPerBar = bpb * spbV * pps;
    const barStep = pxPerBar < 26 ? 8 : pxPerBar < 60 ? 4 : 1;
    // 小节线域：music=音乐域秒（拍网格 overlay 覆盖整个秒域——blocks 短于音频时小节线不中途断尾）；
    // stage=blocks 域（逐值不动）。
    const barsDomainSec = this.mode === 'music' ? musicDomainSec(p) : beatToSec(p, segmentsFromClips(p.formations).totalBeats);
    const totalBars = Math.ceil(barsDomainSec / spbV / bpb) + 2;
    ctx.beginPath();
    for (let bar = 0; bar <= totalBars; bar += barStep) {
      const x = beatToSec(p, bar * bpb) * pps;
      if (x > viewX1) break;        // build-88：小节 x 升序，出窗右缘即止
      if (x < viewX0) continue;     // 窗左前缀跳过
      ctx.moveTo(x, rulerH - 8); ctx.lineTo(x, h);
      if (pxPerBar * barStep > 30) ctx.fillText(String(bar + 1), x + 3, rulerH / 2);
    }
    // 8拍刻度（舞蹈计数）
    const pxPer8 = 8 * spbV * pps;
    if (pxPer8 > 44) {
      ctx.strokeStyle = 'rgba(56,189,248,.35)';
      ctx.beginPath();
      for (let c8 = 0; ; c8++) {
        const x = beatToSec(p, c8 * 8) * pps;
        if (x > viewX1) break;
        if (x < viewX0) continue;
        ctx.moveTo(x, rulerH); ctx.lineTo(x, h);
        if (pxPer8 > 70) ctx.fillText(`${c8 + 1}个8拍`, x + 3, h - 8);
      }
      ctx.stroke();
    }
    ctx.stroke();
    ctx.restore();
    this.rulerH = rulerH;
  }
  // 旧整曲波形道已由 v3 常驻音频轨取代（drawWave 移除）：波形按 clip 画在音轨内（drawClipBox）。
  // ---- build-70 M2：队形轴 clip 化绘制 ----
  // clip=队形色块+队形名+时长徽标（既有块绘制改造）；clip 之间的空隙=变换段（斜纹+时长标注——
  // 时长=空隙本身，随 clip 拖动/缩放自动适应，无把手不可拖）；
  // 选中 clip 高亮描边+左右缘把手（拖缘=改长度）；[0, 首 clip.start) 候场与域尾余量=空白底。
  // build-77-expux（时间唯一标准）：stage 模式徽标/变换标注一律秒呈示（拍值估计退役）；
  // music 模式呈示不动（拍·秒双显）。
  drawBlocks(ctx, p, h) {
    const { segments } = segmentsFromClips(p.formations);
    const pps = this.ppsOf(p);
    const spbV = spb(p);
    const top = this.blocksTopFor();
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口
    // build-83-constlane：stage 道高恒定 STAGE_LANE_DEFAULT_H（拖高联动退役，见 totalHeightFor）；
    // music 模式维持 MUSIC_BLOCKS_H=36（G2W1 块区常显开销推导链不动）。v3：块区紧随音频轨（不再底部锚定）
    const bh = this.mode === 'stage' ? STAGE_LANE_DEFAULT_H : MUSIC_BLOCKS_H;
    const selIdx = this.hooks.getIndex();
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    for (let k = 0; k < segments.length; k++) {
      const s = segments[k];
      const f = p.formations[s.i];
      if (!f) continue;
      const x0 = beatToSec(p, s.start) * pps;
      const x1 = beatToSec(p, s.end) * pps;
      // build-88 视口窗口：本 clip 与其尾随变换段都完全出窗才跳过（段 x 升序，右出界即止）
      const nxt0 = k + 1 < segments.length ? beatToSec(p, segments[k + 1].start) * pps : x1;
      if (x0 > viewX1) break;
      if (Math.max(x1, nxt0) < viewX0) continue;
      const selected = s.i === selIdx;
      const hovered = this.hoverSeg === s.i;
      const holdSec = ((s.end - s.start) * spbV).toFixed(1).replace(/\.0$/, '');
      // clip 体（队形色块）
      ctx.fillStyle = (f.color || '#64748b') + (hovered ? '77' : '55');
      ctx.fillRect(x0, top, Math.max(2, x1 - x0), bh);
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected ? '#38bdf8' : (f.color || '#64748b');
      ctx.strokeRect(x0, top, x1 - x0, bh);
      if (x1 - x0 > 34) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(f.name.slice(0, Math.floor((x1 - x0) / 7)), x0 + 4, top + 9);
      }
      // 时长徽标（拍 + 秒）。build-77-expux（时间唯一标准）：stage 模式只呈秒（去拍值，
      // 极窄档的裸拍数一并退役——秒值放不下就不标）；music 模式双显不动。
      if (x1 - x0 > 40) {
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(this.mode === 'stage' ? `${holdSec}s` : `${Math.round(s.end - s.start)}拍·${holdSec}s`, x0 + 4, top + bh - 9);
        ctx.font = '10px sans-serif';
      } else if (x1 - x0 > 8 && this.mode !== 'stage') {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(`${Math.round(s.end - s.start)}`, x0 + 2, top + bh - 9);
      }
      // 选中/悬停：左右缘把手（拖缘=改长度；钳制与磁吸在拖拽路径）
      if (selected || hovered) {
        this._drawGrip(ctx, x0, top, bh, 'clip');
        this._drawGrip(ctx, x1, top, bh, 'clip');
      }
      // 悬停高亮描边
      if (hovered && !selected) {
        ctx.strokeStyle = 'rgba(56,189,248,.8)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, top, x1 - x0, bh);
      }
      // 变换段（本 clip 与下一 clip 之间的空隙，自动适应）：斜纹+时长标注，无把手不可拖
      const nxt = segments[k + 1];
      if (nxt) {
        const gx1 = beatToSec(p, nxt.start) * pps;
        const tw = Math.max(1, gx1 - x1);
        ctx.fillStyle = hovered ? 'rgba(56,189,248,.30)' : 'rgba(148,163,184,.25)';
        ctx.fillRect(x1, top, tw, bh);
        ctx.strokeStyle = 'rgba(148,163,184,.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, top, tw, bh);
        // 斜线纹理
        if (tw > 6 && bh > 10) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x1, top, tw, bh); ctx.clip();
          ctx.strokeStyle = 'rgba(148,163,184,.28)';
          for (let gx = x1 - bh; gx < x1 + tw; gx += 7) {
            ctx.moveTo(gx, top + bh); ctx.lineTo(gx + bh, top);
          }
          ctx.stroke();
          ctx.restore();
        }
        const gapBeats = Math.max(0, nxt.start - s.end);
        // build-77-expux（时间唯一标准）：stage 模式拍值估计退役，改秒标签；极窄空隙不标注
        //（灰色斜纹空隙本身已表意，右缘外浮字与下一段队形名争位）。music 模式拍·秒双显不动。
        if (this.mode === 'stage') {
          const label = `变换${(gapBeats * spbV).toFixed(1).replace(/\.0$/, '')}s`;
          if (tw > label.length * 6 + 6) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(label, x1 + 4, top + bh / 2);
          }
        } else {
          const travelBeats = Math.round(gapBeats * 10) / 10;
          const travelSec = (gapBeats * spbV).toFixed(1).replace(/\.0$/, '');
          const label = `变换${travelBeats}拍·${travelSec}s`; // canvas 呈示纯文字（icon-mapping §六）
          if (tw > label.length * 6 + 6) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(label, x1 + 4, top + bh / 2);
          } else if (tw > 14) {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(travelBeats + '拍', x1 + 3, top + bh / 2);
          } else {
            // 太窄：标到空隙右侧外
            ctx.fillStyle = '#8ea2bd';
            ctx.fillText(travelBeats + '拍', gx1 + 3, top + bh / 2);
          }
        }
      }
    }
    ctx.restore();
    this.blocksTop = top; this.blocksH = bh;
  }
  _drawGrip(ctx, x, top, bh, kind) {
    ctx.save();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - 2, top - 2, 4, bh + 4);
    // 把手抓点
    ctx.fillRect(x - 5, top + bh / 2 - 7, 10, 14);
    ctx.restore();
  }
  // ---------- 时间轴标记 tag 道（编舞模式；E-12 红线：单层 18px 几何与点击口径零变化） ----------
  // build-49 F4：tag=区域块（新语义）——渲染区域淡色带 [beat,endBeat)，起点旗+名称胶囊。
  // 除「带状呈示」外几何/交互逐值不动：拖旗=整块移位（moveTag 区域平移）、双击改名。
  // build-77-tagdel：单击旗/名称尾（原 × 区）=选中+编辑 popover（防误删），删除唯二入口=
  // 长按/右键 tag 菜单与索引「…」；单击旗=选中+编辑（原「单击跳转」退役）——
  // 命中几何（旗点 tagAt/名称尾 _tagGeomHit）与拖旗/双击语义逐值不动。
  // build-79-tagflag（需求 2）：× glyph 呈示退役（旗点纯旗、点选态高亮保留在旗面）；
  // 命中面（delX）与「点按=编辑」语义原样保留。
  drawTags(ctx, p) {
    // F2（build-52-wavezoom）：编舞 tag 道呈示规则升级——只画当前存在的**最深层**（最底层）
    // tag，且区域带/旗/名称胶囊用该 tag 的对应色（MusicTimeline.tagColorAt——与音乐划分轨、
    // 索引面板同一出处同色）；更浅层不画（多层重叠糊在 18px 单道里的旧规则退役）。
    // 18px 几何不变（E-12：道高/旗/胶囊落笔几何逐值不动，只换过滤与颜色）；命中与呈示同集合
    //（_tagGeom 只写所画 tag、tagAt 调用方按 stageLevelOf 过滤——看见的才可交互）。
    const all = [...(p.timeline.tags || [])];
    const lv = MusicTimeline.stageDeepestLevelOf(all);
    const tags = all.filter(t => (tagLevelOf(t) | 0) === lv)
      .sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
    const top = this.rulerH ?? 22;
    const pps = this.ppsOf(p);
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口：tag 只画可视窗（看见的才可交互）
    this._tagGeom = new Map();
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,.07)';
    ctx.fillRect(viewX0, top, viewX1 - viewX0, TAG_LANE_H);
    ctx.strokeStyle = 'rgba(148,163,184,.22)';
    ctx.beginPath(); ctx.moveTo(viewX0, top + TAG_LANE_H + .5); ctx.lineTo(viewX1, top + TAG_LANE_H + .5); ctx.stroke();
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    let lastEnd = -1e9; // 前一旗名称胶囊右缘（名称防重叠：贪心左→右）
    for (let k = 0; k < tags.length; k++) {
      const tag = tags[k];
      const color = MusicTimeline.tagColorAt(tag, k); // F2：对应色（层内拍序缺省，同轨道/索引）
      const xWorld = beatToSec(p, tag.beat) * pps;
      if (xWorld > viewX1) break; // build-88：旗 x 升序，出窗右缘即止（不画不登记=不可命中）
      const xEndWorld = beatToSec(p, tagEndBeatOf(tag)) * pps; // 区域带右缘（build-49）
      if (xEndWorld < viewX0) continue; // 整旗在窗左
      const x = Math.max(1, Math.min(viewX1 - 1, xWorld));
      const xEnd = Math.min(viewX1, xEndWorld);
      // build-79-tagflag（需求 2）：× glyph 退役——旗点=纯旗；hover/点选（activeTag）均高亮旗面
      //（× 时代的「点选态高亮」语义保留在旗上）
      const hovered = this.hoverTag === tag.id || this.activeTag === tag.id;
      // 区域带（对应色呈示）：淡色填充 + 尾缘线；单层几何不变（E-12）
      ctx.fillStyle = hexA(color, .10);
      ctx.fillRect(x, top + 1, Math.max(1, xEnd - x), TAG_LANE_H - 2);
      // 旗杆 + 旗面（对应色）
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, top + TAG_LANE_H - 1); ctx.lineTo(x, top + 3); ctx.stroke();
      ctx.fillStyle = hovered ? '#7dd3fc' : color;
      ctx.beginPath();
      ctx.moveTo(x + 1, top + 3); ctx.lineTo(x + 9, top + 6.5); ctx.lineTo(x + 1, top + 10);
      ctx.closePath(); ctx.fill();
      // 名称胶囊：距前旗名称太近（<20px）或被区域尾缘顶住 → 只画旗点（名称走 title/跳转/改名可见）
      const nameW = ctx.measureText(tag.name).width;
      const maxW = Math.min(xEnd - x - 14, viewX1 - x - 2);
      let delX = x + 11;
      if (nameW > 0 && x - lastEnd >= 20 && nameW <= maxW) {
        ctx.fillStyle = hexA(color, .16);
        ctx.fillRect(x + 3, top + 2, nameW + 8, TAG_LANE_H - 5);
        ctx.fillStyle = '#dbeafe';
        ctx.fillText(tag.name, x + 7, top + TAG_LANE_H / 2 + .5);
        delX = x + nameW + 13;
        lastEnd = x + nameW + 10;
      } else {
        lastEnd = Math.max(lastEnd, x + 6);
      }
      // build-79-tagflag（需求 2）：× 不再绘制（旗点纯旗）。delX 几何仍登记（_tagGeomHit）——
      // 名称尾部「点按=编辑」命中区保留（build-77 语义：点按该区=选中+打开编辑 popover，零删除）
      this._tagGeom.set(tag.id, { x, delX, top, h: TAG_LANE_H });
    }
    ctx.restore();
  }
  // ---------- 节奏划分轨（音乐模式专用呈示；build-49 F1/F2 区域块化） ----------
  // 区域即段：每层直接渲染该层 tags 的 [beat,endBeat) 色块——不再由 sectionSegmentsOf 邻接推导；
  // 空白=该层该处没有任何区域（天然支持，strict 开关退役）。区域呈示=色块（4 色循环，tag.color
  // 覆盖）+ 首尾边界强色线 + 名称胶囊；无 × 删除 glyph（删除入口收敛到长按/右键菜单与索引「…」）。
  // 交互同构音频 clip（F2）：单击区域=仅选中；拖体=移动（可跨层）；拖缘=调边界（trim 同规格命中）。
  // build-47 分层：N 层轨=显式 tagLevelCount（F4），每层高 28 纵向堆叠、层间以既有 lane 缘线
  // 分隔；高层更「重」：色块填充 alpha 随层深递减（dim），单层 dim=1 与现状逐值一致。
  // 层标识 L1/L2 小字绘于层左端（仅多层时，单层观感不变）。
  drawSegLane(ctx, p) {
    const pps = this.ppsOf(p);
    this._tagGeom = new Map();
    this._segGeom = [];
    const levels = this.segLevelsOf(p);
    const top0 = this.rulerH ?? TL_RULER_H;
    const [viewX0, viewX1] = this._viewSpan(); // build-88 视口窗口
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    for (let li = 0; li < levels.length; li++) {
      const level = levels[li];
      const top = top0 + li * SEG_LANE_H_MUSIC;
      const H = SEG_LANE_H_MUSIC;
      const dim = Math.max(.55, 1 - li * .18); // 层深递减（level 0 最亮/最饱和；单层=1）
      // lane 底与下缘（层间分隔线）
      ctx.fillStyle = 'rgba(148,163,184,.07)';
      ctx.fillRect(viewX0, top, viewX1 - viewX0, H);
      ctx.strokeStyle = 'rgba(148,163,184,.22)';
      ctx.beginPath(); ctx.moveTo(viewX0, top + H + .5); ctx.lineTo(viewX1, top + H + .5); ctx.stroke();
      // 层级标识（仅多层时绘制——单层保持现状观感）：L1=最高层
      if (levels.length > 1) {
        ctx.fillStyle = 'rgba(148,163,184,.85)';
        ctx.fillText(`L${level + 1}`, 4, top + H / 2 + .5);
      }
      // 拖体跨层预览高亮（F2，与 clip 跨轨拖拽同款语义）：指针所在目标 lane 淡蓝高亮
      if (this.drag?.kind === 'tagRegion' && this.drag.part === 'body' && this.dragHoverTagLane === li) {
        ctx.fillStyle = 'rgba(56,189,248,.13)';
        ctx.fillRect(viewX0, top, viewX1 - viewX0, H);
        ctx.strokeStyle = 'rgba(56,189,248,.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(viewX0, top + 1); ctx.lineTo(viewX1, top + 1);
        ctx.moveTo(viewX0, top + H - 1); ctx.lineTo(viewX1, top + H - 1);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      let lastEnd = -1e9; // 前一名称胶囊右缘（防重叠贪心）
      const lvTags = (p.timeline.tags || [])
        .filter(t => tagLevelOf(t) === level)
        .sort((a, b) => a.beat - b.beat || String(a.id).localeCompare(String(b.id)));
      for (let k = 0; k < lvTags.length; k++) {
        const tag = lvTags[k];
        const x0 = Math.max(0, beatToSec(p, tag.beat) * pps);
        const x1 = Math.min(viewX1, beatToSec(p, tagEndBeatOf(tag)) * pps);
        if (x1 <= viewX0 || x0 >= viewX1) { this._segGeom.push({ id: tag.id, x0, x1, level }); continue; }
        // F2（build-52-wavezoom）：呈示色单一出处（tagColorAt——k=层内拍序，与旧内联式逐值一致；
        // 索引面板 tagColorMap 同源 → 同 tag 同色三处对应）
        const color = MusicTimeline.tagColorAt(tag, k);
        const hovered = this.hoverSegId === tag.id;
        const selected = this.selSegId === tag.id;
        // 区域色块（alpha 随层深递减）
        ctx.fillStyle = hexA(color, (hovered ? .30 : .16) * dim);
        ctx.fillRect(x0, top + 1, Math.max(1, x1 - x0), H - 2);
        // 选中区域高亮描边
        if (selected) {
          ctx.strokeStyle = color; ctx.lineWidth = 1.5;
          ctx.strokeRect(x0 + .75, top + 1.75, Math.max(1, x1 - x0) - 1.5, H - 3.5);
          ctx.lineWidth = 1;
        }
        // 首尾边界强色线（粗于普通拍线的 2px 竖线；相邻区域贴合时同位双线=后画者胜，视觉一致）
        for (const ex of [x0, Math.min(viewX1, x1)]) {
          const bx = Math.max(1, Math.min(viewX1 - 1, ex));
          ctx.strokeStyle = color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(bx, top + 2); ctx.lineTo(bx, top + H - 2); ctx.stroke();
        }
        ctx.lineWidth = 1;
        // 名称胶囊（名称 + 节奏标注 build-47；空间不足/与前一胶囊过近 → 省略，走 title/编辑器可见）
        lastEnd = Math.max(lastEnd, this._drawSegCapsule(ctx, tag, x0, x1, top, H, dim, color, hovered, levels.length, lastEnd));
        this._segGeom.push({ id: tag.id, x0, x1, level });
      }
    }
    ctx.restore();
  }
  // 名称胶囊落笔（drawSegLane 区域共用；返回更新后的胶囊右缘，未画=原值原样返回）。
  // build-49：不再写 × 几何（删除 glyph 退役；_tagGeom 仅 stage drawTags 旗点/× 使用）。
  _drawSegCapsule(ctx, tag, bx, xLimit, top, H, dim, color, hovered, levelCount, lastEnd) {
    const rhythm = tagRhythmLabel(tag);
    const name = rhythm ? `${tag.name} ${rhythm}` : tag.name;
    const nameW = ctx.measureText(name).width;
    const capX = levelCount > 1 ? Math.max(bx + 10, 24) : bx + 10; // 多层时胶囊让开左端 L 标识
    const capViewX1 = this._viewSpan()[1]; // build-88 视口窗口：胶囊按可视窗右缘裁
    if (nameW > 0 && capX - lastEnd >= 4 && capX + nameW + 8 <= xLimit - 2 && capX < capViewX1 - 2) {
      ctx.fillStyle = hexA(color, .22 * dim);
      ctx.fillRect(capX, top + H / 2 - 7, nameW + 8, 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(name, capX + 4, top + H / 2 + .5);
      lastEnd = capX + nameW + 10;
    }
    return lastEnd;
  }
  // 段界拖拽的小节线吸附（§2.2.1 拖段边界）：拍位就近吸到 bpb 整数倍（容差=磁吸像素阈值）；
  // 磁吸关（S）时不吸。返回 [吸附后拍位, 是否吸附]。
  snapTagBeatToBar(beat) {
    const p = this.hooks.getProject();
    if (!p || !this.snapOn) return [beat, false];
    const bpb = p.audio.beatsPerBar || 4;
    const tolBeats = SNAP_TOL_PX / (this.ppsOf(p) * spb(p));
    const snapped = Math.round(beat / bpb) * bpb;
    return Math.abs(snapped - beat) <= tolBeats ? [Math.max(0, snapped), true] : [beat, false];
  }
  tagAt(x, level = null) { // 旗点命中（±9px，取最近）；y 分区由调用方判定。
    // level（build-47 分层）：给定则只命中该层旗点——分层轨各层独立，跨层旗点不可越层抓取；
    // 缺省 null=全部（编舞单层与既有调用方零变化）
    const p = this.hooks.getProject();
    if (!p) return null;
    const pps = this.ppsOf(p);
    let best = null;
    for (const tag of p.timeline.tags || []) {
      if (level != null && tagLevelOf(tag) !== level) continue;
      const tx = beatToSec(p, tag.beat) * pps;
      const d = Math.abs(x - tx);
      if (d <= 9 && (!best || d < best.d)) best = { tag, x: tx, d };
    }
    return best;
  }
  // 名称尾（原 × 位）落笔几何命中 → tag id（与旗点位置解耦）。
  // build-79-tagflag（需求 2）：× glyph 退役但命中面保留——点按名称尾=选中+编辑 popover。
  // y（build-47 分层，可选）：给定则只命中 y 所在层的该区——多层同 x 不串层。
  _tagGeomHit(x, tol = 6, y = null) {
    for (const [id, g] of this._tagGeom) {
      if (Math.abs(x - g.delX) > tol) continue;
      if (y != null && !(y >= g.top && y <= g.top + (g.h ?? TAG_LANE_H))) continue;
      return id;
    }
    return null;
  }
  inTagLane(y) {
    const rel = y - (this.rulerH ?? TL_RULER_H);
    return rel > 0 && rel <= this.segLaneH();
  }
  // 划分域 override（M1 D4）：music 模式末段终点=音乐域换算拍。build-49 起音乐模式区域呈示/命中
  // 不再需要域值（区域自带 [beat,endBeat)）；本函数保留给潜在调用方/调试（现无内部调用方）。
  segDomainBeat(p) {
    if (this.mode !== 'music') return undefined;
    return Math.max(1, secToBeat(p, musicDomainSec(p)));
  }
  // 区域命中（build-49 F1/F2，音乐模式）：拍位落在该层哪个区域 [beat,endBeat) → 该 tag。
  // 空白（无区域覆盖）→ null（单击=定位播放线）。分层按 level 取（跨层互不命中）。
  regionAt(x, level = 0) {
    const p = this.hooks.getProject();
    if (!p) return null;
    const beat = this.xToBeat(x);
    const tags = (p.timeline.tags || [])
      .filter(t => tagLevelOf(t) === level)
      .sort((a, b) => a.beat - b.beat);
    return tags.find(t => beat >= t.beat && beat < tagEndBeatOf(t)) || null;
  }
  _tagTitle(x, y) { // 原生 title：区域=名称+节奏+秒区间+手势提示；stage 旗点=名称+拍位、×=删除
    if (!this.inTagLane(y)) { if (this.cv.title) this.cv.title = ''; return; }
    const p = this.hooks.getProject();
    // 音乐模式（build-49 区域块化）：区域悬停提示——秒区间（时间轴=唯一对齐规范）+ 手势说明
    if (this.mode === 'music') {
      const level = this.tagLevelAtLane(p, this.tagLaneIndexAt(p, y));
      const hit = this.regionAt(x, level);
      if (hit) {
        const rhythm = tagRhythmLabel(hit);
        const s0 = beatToSec(p, hit.beat), s1 = beatToSec(p, tagEndBeatOf(hit));
        this.cv.title = `${hit.name}${rhythm ? ' · ' + rhythm : ''} · ${s0.toFixed(1)}→${s1.toFixed(1)}s · 拖动移动/换层 · 拖缘调界 · 双击编辑 · 长按或右键菜单`;
      } else if (this.cv.title) this.cv.title = '';
      return;
    }
    // stage（build-77-tagdel：名称尾/旗点=编辑提示、build-79-tagdel 措辞随 × 退役更新；F2：只命中呈示的最深层）
    const delId = this._tagGeomHit(x, 6, y);
    if (delId) {
      const t = tagById(p, delId);
      if (t) { this.cv.title = `编辑标记「${t.name}」（点按编辑；删除走长按/右键菜单或索引「…」）`; return; }
    }
    const hit = this.tagAt(x, this.stageLevelOf(p));
    const rhythm = hit ? tagRhythmLabel(hit.tag) : '';
    if (hit) this.cv.title = `${hit.tag.name} · ${beatLabel(p, hit.tag.beat)} 小节（${Math.round(hit.tag.beat * 10) / 10} 拍）· 单击编辑 / 拖动移位 / 长按或右键菜单`;
    else if (this.cv.title) this.cv.title = '';
  }
  // 标记编辑 popover（build-47，_openTagInput 升级：单行文本 → 小浮层；build-49 区域模型）：
  // 名称 text + 拍值 select（无/2/4、3/4、4/4、6/8）+ 小节数 number（可空）+ 描述 text（可空，
  // build-79-tagdesc）+ 确定。popover 高度自适应（定位按实测 offsetHeight 钳视口内，放不下翻上方
  // ——多一行描述不遮道）。build-49：删除钮退役——删除入口收敛两处（长按/右键菜单「删除标记」、
  // 索引行「…」菜单）。提交走 mutateLabeled 恰一条历史（新建「打标记」/编辑「编辑标记」）；
  // Esc/点外部=取消（零写入）。定位钳制在视口内（移动端可达）；打开期间吞画布指针（不透传 scrub）。
  // id=编辑既有标记；id=null 为新建模式（beat/level 决定落点与层级，确定时才落数据——新区域缺省宽 16 拍）。
  _openTagInput({ beat = 0, id = null, initial = '', level = 0 } = {}) {
    this.closeTagPopover();
    UI.closeContextMenu(); // 单弹窗不变式（F2）：编辑器打开前先关已开的段/剪辑菜单等弹层
    const p = this.hooks.getProject();
    if (!p) return;
    if (typeof document === 'undefined') return;
    const src = id ? tagById(p, id) : null;
    const h = (tag, attrs, ...kids) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
      }
      for (const c of kids.flat()) { if (c == null) continue; el.append(c.nodeType ? c : document.createTextNode(c)); }
      return el;
    };
    const nameInp = h('input', { type: 'text', maxlength: String(TAG_NAME_MAX), value: src ? src.name : (initial || ''), placeholder: nextTagName(p), spellcheck: 'false' });
    const sigSel = h('select', {},
      h('option', { value: '' }, '拍值：无'),
      ...['2/4', '3/4', '4/4', '6/8'].map(s => h('option', { value: s, ...(src?.sig === s ? { selected: true } : {}) }, s)));
    if (!src?.sig) sigSel.value = '';
    const barsInp = h('input', { type: 'number', min: '1', step: '1', value: src?.bars != null ? String(src.bars) : '', placeholder: '小节数（可空）' });
    // build-79-tagdesc（需求 1 的 timeline 半边）：可选「描述」输入——读写 tag.description
    //（字符串 trim、空串删键、≤200 字；数据清洗由 model.sanitizeTags 收口，此处只管读写呈示）。
    const descInp = h('input', { type: 'text', maxlength: '200', value: src?.description != null ? String(src.description) : '', placeholder: '描述（可选）', spellcheck: 'false' });
    const el = h('div', { class: 'unit-menu tl-tag-pop' },
      h('div', { class: 'um-title' }, src ? `编辑标记 · ${src.name}` : '新建标记'),
      h('div', { class: 'um-row' }, h('span', { class: 'um-lab' }, '名称'), nameInp),
      h('div', { class: 'um-row' },
        h('span', { class: 'um-lab' }, '节奏'), sigSel,
        barsInp),
      h('div', { class: 'um-row' }, h('span', { class: 'um-lab' }, '描述'), descInp),
      h('div', { class: 'um-row' },
        h('span', { style: 'flex:1' }),
        h('button', { class: 'um-btn um-cancel', onclick: () => this.closeTagPopover() }, '取消'),
        h('button', { class: 'um-btn um-cur', onclick: () => commit() }, '确定')));
    const st = this._tagPopover = { el, id: src ? src.id : null, beat, level, done: false };
    const commit = () => {
      if (!st || st.done) return;
      st.done = true;
      const name = nameInp.value.trim().slice(0, TAG_NAME_MAX);
      const sig = sigSel.value || null;
      const barsRaw = Number(barsInp.value);
      const bars = Number.isInteger(barsRaw) && barsRaw > 0 ? barsRaw : null;
      const desc = String(descInp.value ?? '').trim().slice(0, 200); // build-79-tagdesc：trim+裁 200
      this.closeTagPopover();
      if (st.id) {
        this.hooks.mutateLabeled?.(p2 => {
          const t = tagById(p2, st.id);
          if (!t) return;
          if (name) t.name = name;
          if (sig) t.sig = sig; else delete t.sig;
          if (bars) t.bars = bars; else delete t.bars;
          if (desc) t.description = desc; else delete t.description; // 空串=删键（缺省 shape 不落盘）
        }, '编辑标记');
      } else {
        this.hooks.mutateLabeled?.(p2 => {
          const t = addTag(p2, st.beat, name, { level: st.level, sig, bars });
          if (desc) t.description = desc; // 新建模式：addTag 白名单字段外补挂描述
        }, '打标记');
      }
      this.render();
    };
    for (const inp of [nameInp, barsInp, descInp]) {
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.closeTagPopover(); }
      });
      inp.addEventListener('pointerdown', ev => ev.stopPropagation()); // 浮层内指针不透给画布/dismiss
    }
    sigSel.addEventListener('pointerdown', ev => ev.stopPropagation());
    // 点外部=取消（capture 抢在画布 _down 前）：落点在画布上时置吞针标记，防 dismiss 后同一
    // 次按下继续 scrub/选段（「打开期间吞画布指针」）
    st.onDocDown = ev => {
      if (st.done) return;
      if (el.contains(ev.target)) return;
      this.closeTagPopover();
      if (ev.target === this.cv) this._swallowDown = true;
    };
    st.onDocKey = ev => { if (ev.key === 'Escape') this.closeTagPopover(); };
    document.addEventListener('pointerdown', st.onDocDown, true);
    document.addEventListener('keydown', st.onDocKey, true);
    document.body.append(el);
    // 定位：锚在旗点/落点画布 x → 视口坐标，钳制视口内；默认挂在划分轨下方，放不下翻到上方
    const rect = this.cv.getBoundingClientRect();
    const vw = window.innerWidth || 360, vh = window.innerHeight || 640;
    const x = beatToSec(p, src ? src.beat : beat) * this.ppsOf(p);
    const w = el.offsetWidth || 200, hh = el.offsetHeight || 120;
    let left = Math.round(rect.left + x - 24);
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = Math.round(rect.top + (this.rulerH ?? TL_RULER_H) + this.segLaneH(p) + 6);
    if (top + hh > vh - 8) top = Math.max(8, Math.round(rect.top - hh - 6));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    requestAnimationFrame(() => { try { nameInp.focus(); nameInp.select(); } catch {} });
  }
  // 既有入口兼容（右键菜单「编辑内容」/双击旗点）：按 tag id 打开编辑器
  openTagEditor(tagId) {
    const p = this.hooks.getProject();
    const t = p && tagById(p, tagId);
    if (!t) return;
    this._openTagInput({ id: t.id, initial: t.name, level: tagLevelOf(t) });
  }
  closeTagPopover() {
    const st = this._tagPopover;
    if (!st) return;
    st.done = true;
    this._tagPopover = null;
    try { st.el.remove(); } catch {}
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', st.onDocDown, true);
      document.removeEventListener('keydown', st.onDocKey, true);
    }
  }
  // ⚑ 打点：在当前播放头（或 scrub 位置）打标记——只开命名输入、不动播放状态
  stampTag() {
    const p = this.hooks.getProject();
    if (!p) return;
    const beat = Math.max(0, Math.round((this.hooks.getPlayer?.()?.beat || 0) * 100) / 100);
    const x = beatToSec(p, beat) * this.ppsOf(p);
    const sc = this.scroll;
    const headW = this.headWidth(); // M2：可视区右缘扣除轨头列宽
    if (x < sc.scrollLeft + 8 || x > sc.scrollLeft + sc.clientWidth - headW - 130) sc.scrollLeft = Math.max(0, x - 80);
    this._openTagInput({ beat });
  }
  drawPlayhead() {
    const p = this.hooks.getProject();
    if (!p) return;
    const dpr = this._dpr || window.devicePixelRatio || 1; // 与 _renderNow 的钳制刻度一致
    const ctx = this.ov.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.translate(-(this.scroll?.scrollLeft || 0), 0); // build-88 视口窗口：与主画布同一世界平移
    const player = this.hooks.getPlayer();
    const pps = this.ppsOf(p);
    const x = beatToSec(p, Math.max(0, player.beat)) * pps;
    ctx.save();
    ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 8); ctx.closePath();
    ctx.fillStyle = '#f43f5e'; ctx.fill();
    ctx.restore();
  }
  ppsOf(p) {
    if (this.secPerPx) return 1 / this.secPerPx;
    if (this.mode === 'music') {
      // music：auto pps=fit（域+2s 尾余量，IR-M1-1「auto 画布域=音频时长+2s」）
      return this.W / (musicDomainSec(p) + 2);
    }
    const { totalBeats } = segmentsFromClips(p.formations);
    const totalSec = Math.max(beatToSec(p, totalBeats), 5);
    return this.W / (totalSec + 1);
  }
  secToX(sec) { return sec * this.ppsOf(this.hooks.getProject()); }
  xToBeat(x) {
    const p = this.hooks.getProject();
    const sec = x / this.ppsOf(p);
    return secToBeat(p, sec);
  }
  zoom(factor) {
    const p = this.hooks.getProject();
    const cur = this.ppsOf(p);
    // build-77-zoomsel：缩放前取选中对象区间（旧 pps 几何下）。有选中：所有缩放入口统一以选中
    // 中心为锚——±/－/＋按钮直调本方法（main.js 接线不可改，锚定收敛在此）、滚轮/捏合/zoomCenter
    // 经 zoomAt 选中时同样直达此处；无选中：既有行为逐值不变（scrollLeft 不动）。
    const selRange = this._zoomSelRangeSec(p);
    if (this.mode === 'music') {
      // build-88-waveui 需求 3：pps 范围扩展（视口窗口渲染后画布不随「域×pps」膨胀，缩放界改
      // 常量钉值）——min 4px/s（10 分钟域一屏总览；更远靠 #tl-nav 概览条全域导航）、
      // max 2400px/s（48kHz≈20 样本/px，配合需求 1 逐像素波形=采样级对齐视图）。
      // 旧「8192/域」画布像素上限与 fit 地板随视口化退役（自适应 fit 仍由 zoomFit/auto 承担）。
      this.secPerPx = 1 / clampNum(cur * factor, PPS_MIN, PPS_MAX);
      if (selRange) { this._zoomAnchorCommit(cur, selRange); return; }
      this.render();
      return;
    }
    // build-88 同界（两模式一致；旧 0.5 地板与「4096/域」画布上限随视口化退役）
    this.secPerPx = 1 / clampNum(cur * factor, PPS_MIN, PPS_MAX);
    if (selRange) { this._zoomAnchorCommit(cur, selRange); return; }
    this.render();
  }
  // build-77-zoomsel：选中中心锚定补偿（zoom() 选中路径专用）。数学：锚点屏幕 x 不变 ⇔
  // scrollLeft' = scrollLeft + anchorSec×(newPps−oldPps)（headW 两侧同项相消；浏览器钳非负/量程，
  // 越界贴边与既有锚一致）。补偿前同步落盘画布尺寸（build-52 同款：旧小画布+宽视口时浏览器
  // 瞬间把 scrollLeft 钳回 0、rAF 异步重绘来不及救）；无真实画布的测试桩跳过重绘。
  _zoomAnchorCommit(oldPps, selRange) {
    const anchorSec = zoomAnchorSec({ selectedClipRange: selRange, scale: oldPps });
    this._renderQueued = false;
    if (typeof this.cv?.getContext === 'function') this._renderNow();
    const newPps = this.ppsOf(this.hooks.getProject());
    if (newPps > 0 && this.scroll) {
      this.scroll.scrollLeft = Math.max(0, (this.scroll.scrollLeft || 0) + anchorSec * (newPps - oldPps));
    }
    this.render(); // build-88 视口窗口：scrollLeft 即视口——补偿写入后重画可视窗（rAF 合帧）
  }
  // build-77-zoomsel：当前选中对象的时间区间（秒）→ 缩放锚源；无选中 → null（回退既有锚）。
  // 音乐模式 = clipSel 选中音频 clip 的整体跨度 [min start, max end]（单选=该 clip；多选=并集，
  // 中心即锚；空集/陈旧 id → null）；编舞模式 = formationIndex 对应队形 clip 的 [start,end]
  // （当前队形无 clip 段 → null）。
  _zoomSelRangeSec(p) {
    if (this.mode === 'music') {
      if (!this.clipSel?.size) return null;
      let s0 = Infinity, s1 = -Infinity;
      for (const c of clipsOf(p)) {
        if (!this.clipSel.has(c.id)) continue;
        s0 = Math.min(s0, c.timelineStartSec);
        s1 = Math.max(s1, clipEnd(c));
      }
      return (Number.isFinite(s0) && Number.isFinite(s1) && s1 >= s0) ? { start: s0, end: s1 } : null;
    }
    const idx = this.hooks.getIndex?.();
    const seg = segmentsFromClips(p.formations).segments.find(s => s.i === idx);
    return seg ? { start: beatToSec(p, seg.start), end: beatToSec(p, seg.end) } : null;
  }
  zoomFit() { this.secPerPx = 0; this.render(); }

  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => this._down(e));
    cv.addEventListener('pointermove', e => this._move(e));
    cv.addEventListener('dblclick', e => this._dblclick(e));
    // v3：clip 右键菜单（空白处=取消选择，规格 §4）
    cv.addEventListener('contextmenu', e => {
      const p = this.hooks.getProject();
      if (!p) return;
      // D2：自实现长按菜单刚触发过（Android 原生长按 contextmenu 跟弹）→ 吞掉防双菜单
      if (performance.now() - this._lpFiredAt < 800) { e.preventDefault(); return; }
      // F2（build-48-tagui）：长按待定中（_lp/_tagLp 已布防未到点）——Android 原生 contextmenu
      //（~500ms）先于自实现计时（550ms）到达：吞掉防「原生菜单先行 + 计时再弹」双弹层；
      // 到点由 _lpFire/_tagLpFire 统一开菜单（单弹窗不变式：开前先关旧）。
      if (this._lp || this._tagLp || this._fcLp) { e.preventDefault(); return; }
      const r = this.cv.getBoundingClientRect();
      // build-88 视口窗口：画布贴视口（rect.left 不再随横滚移动）→ 世界 x = 画布 x + scrollLeft
      const x = e.clientX - r.left + (this.scroll?.scrollLeft || 0), y = e.clientY - r.top;
      // 区域划分轨右键（音乐模式）：全功能区域菜单（编辑内容/换色/升降级/删除标记——build-49
      // 去掉拆分/合并，区域模型下无意义）；轨道菜单与索引行「…」菜单同一渲染函数（showSegMenu）。
      // build-77-tagdel：stage 旗点右键同样进 tag 菜单（删除唯二轨道入口之一；点按 × 删除退役，
      // 菜单与索引「…」是仅存删除入口）——空白右键保持浏览器默认（无 preventDefault）。
      if (this.inTagLane(y)) {
        if (this.mode === 'music') {
          e.preventDefault();
          const level = this.tagLevelAtLane(p, this.tagLaneIndexAt(p, y));
          const hit = this.regionAt(x, level);
          this.closeTagPopover(); // 单弹窗不变式：开菜单前先关已开的标记编辑器
          this.hooks.onSegContextMenu?.({
            tagId: hit ? hit.id : null,
            level: hit ? tagLevelOf(hit) : level,
            beat: Math.max(0, Math.round(this.xToBeat(x) * 100) / 100),
            screenX: e.clientX, screenY: e.clientY,
          });
          return;
        }
        const hit = this.tagAt(x, this.stageLevelOf(p)); // F2：只命中呈示的最深层
        if (hit) {
          e.preventDefault();
          this.closeTagPopover(); // 单弹窗不变式：开菜单前先关已开的标记编辑器
          this.hooks.onSegContextMenu?.({
            tagId: hit.tag.id,
            level: tagLevelOf(hit.tag),
            beat: Math.max(0, Math.round(hit.tag.beat * 100) / 100),
            screenX: e.clientX, screenY: e.clientY,
          });
        }
        return;
      }
      // build-70 M2：队形 clip 右键菜单（块区带；分割于此/删除队形/对齐到播放头——与长按同一入口）。
      // 先于音频 lane 判定（无音乐时 audioBottom 早返回会吞掉块区右键——块区带两模式恒显）。
      const bt = this.blocksTop ?? 0, bh = this.blocksH ?? 0;
      if (bh > 0 && y >= bt && y <= bt + bh) {
        e.preventDefault();
        this.closeTagPopover(); // 单弹窗不变式（同上）
        const beat = Math.max(0, Math.round(this.xToBeat(x) * 100) / 100);
        const { segments } = segmentsFromClips(p.formations);
        const hit = segments.find(s => beat >= s.start && beat < s.end);
        this.hooks.onFormationClipContextMenu?.({
          index: hit ? hit.i : null,
          beat,
          screenX: e.clientX, screenY: e.clientY,
        });
        return;
      }
      if (y < this.audioTop() || y > this.audioBottom(p) || !clipsOf(p).length) return;
      e.preventDefault();
      this.closeTagPopover(); // 单弹窗不变式（同上）
      const hit = this._audioHit(x, y, clipsOf(p), e.pointerType === 'touch');
      this.hooks.onClipContextMenu?.({
        clipId: hit ? hit.clip.id : null,
        screenX: e.clientX, screenY: e.clientY,
        timelineSec: Math.max(0, x / this.ppsOf(p)), // D2：「在此处分割」落点（右键点画布 x → 秒）
      });
    });
    window.addEventListener('pointerup', e => this._up(e), { passive: true });
    // F-02（UX-02）：浏览器中途接管（滚动接管/来电横幅/系统手势）会发 pointercancel 而后续
    // pointerup 不再来——不置 drag=null 则拖拽状态卡死，之后无按键的鼠标 hover 路过即持续
    // 改写块时长（数据损坏链）。即使 touch-action 已阻断滚动接管，其他接管源仍需此兜底。
    // W3：顺带清拖移跨轨预览高亮（有残留才补绘——node 单测环境 render 不可用，零残留零调用）
    cv.addEventListener('pointercancel', () => {
      this._lpCancel();      // D2：浏览器接管 → 长按计时一并作废
      this._tagLpCancel();   // build-47：划分轨长按计时同口径作废
      this._fcLpCancel();    // build-70：队形 clip 长按同口径作废
      this._endTp();         // D1：双指手势作废（脏指针防护，同 F-01 口径）
      const hadHover = this.dragHoverLane != null || this.dragHoverTagLane != null;
      this.drag = null;
      this.dragHoverLane = null;
      this.dragHoverTagLane = null;
      if (hadHover) this.render();
    });
    // build-88-waveui 需求 3（视口窗口渲染）：横滚只挪窗口——画布贴视口重定位 + 重绘可视窗。
    // 程序性 scrollLeft 写入（锚定缩放/tl-nav 概览/双指平移）同经此闭环，无需逐调用点补绘。
    this.scroll.addEventListener('scroll', () => { this._syncCanvasOffset(); this.render(); }, { passive: true });
    this.scroll.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        // F1（build-52-wavezoom）：ctrl/meta+滚轮=指针中心锚定缩放（zoomAt）——触控板捏合手势
        // 发的就是 ctrl+wheel，Mac 触控板双指捏合 / Ctrl+滚轮鼠标用户全部以当前指针位置为中心
        // 缩放（旧路径 this.zoom 无锚定，放大时视野向左缘漂）。stage/music 共用本 handler，
        // 两模式同时获益；锚定换算经 headWidth()（M2），触屏双指捏合仍走 _tpMove 质心锚定不变。
        e.preventDefault();
        this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
      } else if (e.altKey) {
        // C16：Alt+滚轮 锚定光标缩放（与左下 －/＋/⤢ 同义）
        e.preventDefault();
        this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
      } else if (e.clientY - this.scroll.getBoundingClientRect().top <= TL_RULER_H) {
        // build-88-waveui 需求 2：尺规/刻度区裸滚轮=锚定光标缩放（deltaY>0=缩小、<0=放大，
        // 两指上下拖=原生 wheel 同路；步进经 wheelZoomStep 钳幅、直接步进无防抖）。锚点复用
        // zoomAt 锚点数学——无选中=光标处时刻、有选中=选中中心既有语义；两模式同 handler。
        // 尺规以外区域的 wheel 不劫持（维持原生滚动/既有分支）。
        e.preventDefault();
        this.zoomAt(wheelZoomStep(e.deltaY), e.clientX);
      } else if (e.shiftKey) {
        // C16：Shift+滚轮 横移
        e.preventDefault();
        this.scroll.scrollLeft += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      }
    }, { passive: false });
    this._wireTracksHeadLaneGrip(); // build-79-laneh（需求 9①）：轨头卡片交界拖动调轨 lane 高
  }
  // ---- build-79-laneh（需求 9①）：多轨轨头卡片交界拖动=调节该轨 lane 高 ----
  // 绑定在 #tl-tracks-head 容器（main.buildTracksHead 以 innerHTML 重建行内容，容器级监听不丢）。
  // 命中=轨行（.tlh-track）底缘向上 6px + 行间 12px gap（与画布 MUSIC_LANE_GAP 同带宽）；行内
  // 控件（改名/静音/音量/删除/加轨钮）不抢。拖动实时预览（内存 _laneHPreview + 行内 height 即时
  // 反馈，零数据写入），pointerup 经 mutateLabeled 恰一条「调整轨道高度」写 track.laneH
  //（数值 px，clampNum [24,240]）；pointercancel 回滚预览零写入。node 无 document 安全跳过。
  _wireTracksHeadLaneGrip() {
    if (typeof document === 'undefined') return;
    const box = document.getElementById('tl-tracks-head');
    if (!box || box._tlLaneGripWired || typeof box.addEventListener !== 'function') return;
    box._tlLaneGripWired = true;
    const GRIP_PX = 6; // 行底缘向上命中带（叠加行间 12px gap = 18px 竖向热区）
    const rowsOf = () => (typeof box.querySelectorAll === 'function' ? [...box.querySelectorAll('.tlh-track')] : []);
    const gripAt = e => {
      const rows = rowsOf();
      return rows.findIndex(row => {
        const r = row.getBoundingClientRect?.();
        if (!r) return false;
        return e.clientY >= r.bottom - GRIP_PX && e.clientY <= r.bottom + MUSIC_LANE_GAP;
      });
    };
    box.addEventListener('pointerdown', e => {
      if (this.mode !== 'music' || box.classList?.contains?.('tlh-collapsed')) return;
      if (this.hooks.canEdit?.() === false) return; // 编辑锁：只读预览不供拖高
      const gi = gripAt(e);
      if (gi < 0) return;
      if (e.target?.closest?.('button,input,select')) return; // 行内控件不抢
      const p = this.hooks.getProject();
      const t = this.tracksOf(p)[gi];
      if (!t) return;
      e.preventDefault();
      const row = rowsOf()[gi];
      try { box.setPointerCapture(e.pointerId); } catch {}
      this._laneHDrag = { pointerId: e.pointerId, trackId: t.id, row, startY: e.clientY, startH: this.trackLaneHPx(p, gi) };
    });
    box.addEventListener('pointermove', e => {
      const d = this._laneHDrag;
      if (!d || e.pointerId !== d.pointerId) {
        // 悬停光标：交界带 row-resize（无拖拽时轻量判定）
        if (!this._laneHDrag && box.style) {
          box.style.cursor = (this.mode === 'music' && !box.classList?.contains?.('tlh-collapsed') && gripAt(e) >= 0) ? 'row-resize' : '';
        }
        return;
      }
      const h = clampNum(d.startH + (e.clientY - d.startY), TRACK_LANE_H_MIN, TRACK_LANE_H_MAX);
      this._laneHPreview.set(d.trackId, h);
      try { if (d.row && d.row.style) d.row.style.height = Math.round(h) + 'px'; } catch {} // 轨头卡片即时反馈
      this.render(); // 画布 lane 实时跟随（预览值，未落盘）
    });
    const end = e => {
      const d = this._laneHDrag;
      if (!d || e.pointerId !== d.pointerId) return;
      this._laneHDrag = null;
      try { box.releasePointerCapture(e.pointerId); } catch {}
      const pv = this._laneHPreview.get(d.trackId);
      this._laneHPreview.delete(d.trackId);
      if (e.type === 'pointerup' && Number.isFinite(pv)) {
        const hh = Math.round(clampNum(pv, TRACK_LANE_H_MIN, TRACK_LANE_H_MAX)); // 数值 px 落盘
        this.hooks.mutateLabeled?.(pr => {
          const t = (pr.timeline?.tracks || []).find(k => k.id === d.trackId);
          if (t) t.laneH = hh; // model.sanitizeTracks 数值保留/非法删除由并行改动收口（契约已钉）
        }, '调整轨道高度');
      } else if (d.row && d.row.style) {
        try { d.row.style.height = Math.round(d.startH) + 'px'; } catch {} // 取消：回滚行内预览
      }
      this.render();
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }
  // 锚定缩放：anchorClientX（视口坐标）下的时间点在缩放后保持原屏幕位。
  // M2：canvas x=0 在轨头列右缘——时间↔容器坐标换算统一经 headWidth() 偏移（轨头隐藏=0，公式退化为旧式）。
  headWidth() {
    const th = typeof document !== 'undefined' ? document.getElementById('tl-tracks-head') : null;
    return (th && !th.hidden && this.mode === 'music') ? (th.offsetWidth || 0) : 0;
  }
  zoomAt(factor, anchorClientX) {
    const p = this.hooks.getProject();
    if (!p) return;
    // build-77-zoomsel：有选中对象 → 锚定收敛在 zoom()（选中中心，所有入口一致），入参
    // anchorClientX 忽略（调用签名不变）；无选中 → 既有指针/质心锚定逐值不变（下方原样）。
    if (this._zoomSelRangeSec(p)) { this.zoom(factor); return; }
    const oldPps = this.ppsOf(p);
    const rect = this.scroll.getBoundingClientRect();
    const headW = this.headWidth();
    const anchorSec = Math.max(0, (anchorClientX - rect.left - headW + this.scroll.scrollLeft) / oldPps);
    this.zoom(factor);
    // 锚定补偿前必须同步落盘画布尺寸（build-52 验收实测）：旧小画布+宽视口时内容无滚动余量，
    // 浏览器瞬间把 scrollLeft 钳回 0，补偿全丢（放大跳回左缘）；rAF 异步重绘来不及救。
    this._renderQueued = false;
    if (typeof this.cv?.getContext === 'function') this._renderNow(); // 无真实画布的测试桩跳过重绘
    const newPps = this.ppsOf(p);
    if (newPps > 0) this.scroll.scrollLeft = Math.max(0, headW + anchorSec * newPps - (anchorClientX - rect.left));
    this.render(); // build-88 视口窗口：锚定补偿写完 scrollLeft 后重画可视窗（rAF 合帧）
  }
  // M4：－/＋ 缩放按钮的中心锚定——以视口（轨头列右侧 lane 区）水平中点为锚，缩放前后
  // 中心秒不变（现状按钮锚左缘，放大时视野持续向右漂）。复用 zoomAt 的锚定换算。
  // build-77-zoomsel：有选中 clip 时 zoomAt 将锚切到选中中心（入参中点忽略），入口行为一致。
  zoomCenter(factor) {
    const rect = this.scroll.getBoundingClientRect();
    const headW = this.headWidth();
    this.zoomAt(factor, rect.left + headW + (rect.width - headW) / 2);
  }
  // 视口坐标 → 时间线秒（C13 落点换算用）。M2：经 canvas 实测 rect（自动含轨头列宽）；
  // build-88 视口窗口：画布贴视口后世界偏移由 scrollLeft 项承担（旧「canvas rect 随内容滚」
  // 的隐式偏移等价换算为显式 +scrollLeft，scrollLeft=0 时逐值一致）。
  secFromClientX(clientX) {
    const p = this.hooks.getProject();
    // build-88 视口窗口：画布左缘恒在视口 lane 区左端 → 世界 x = 画布 x + scrollLeft
    //（scrollLeft=0 时与旧式逐值一致）。
    return Math.max(0, (clientX - this.cv.getBoundingClientRect().left + (this.scroll?.scrollLeft || 0)) / this.ppsOf(p));
  }
  edgeHits(x) {
    // build-70 M2：块缘命中=clip 左/右缘（拖缘=改长度，与音频 clip trim 同构；旧 hold/travel
    // 双把手退役——变换段不再是数据，无缘可拖）。命中只判 x；y 域由调用方钳在块区（_down 的
    // blocksTop..+blocksH 带）——非块区 y 不入拖拽。
    // build-79-clipgrab（需求 7a）：分流收窄走 clipEdgeHit 纯函数——边界热区固定 FC_EDGE_HIT_PX=8px
    // 且钳制≤块宽 1/3，其余块身=选中/拖动（短块块身不再被「改边界」热区挤掉）；块外 ±8px 抓缘带
    // 保留（旧「从空隙抓缘」动线不回退；音乐模式音频 clip 的 trim 缘命中走 _audioHit 既有链，
    // 本函数只服务队形块区）。
    const p = this.hooks.getProject();
    const { segments } = segmentsFromClips(p.formations);
    const pps = this.ppsOf(p);
    const hits = [];
    for (const s of segments) {
      const hx0 = beatToSec(p, s.start) * pps;
      const hx1 = beatToSec(p, s.end) * pps;
      const part = clipEdgeHit(hx0, hx1, x, FC_EDGE_HIT_PX);
      if (part === 'l') hits.push({ kind: 'clipL', seg: s });
      else if (part === 'r') hits.push({ kind: 'clipR', seg: s });
    }
    return hits;
  }
  _down(e) {
    const p = this.hooks.getProject();
    if (!p) return;
    // build-47：标记编辑 popover 打开期间吞画布指针（不透传 scrub/选段）；
    // _swallowDown=dismiss 型点外按下（capture 先行关闭 popover），同样吞掉本次按下
    if (this._tagPopover) return;
    if (this._swallowDown) { this._swallowDown = false; return; }
    // ---- D1（build-44）：双指导航登记（build-52 F3 起 stage/music 共用，touch/pen；鼠标不进此路径）----
    // 第二指落下 → 以 pointercancel 同路径中止单指状态机，转入双指平移+捏合（_tpMove）。
    // 编舞模式原为 music 专属（红线 E-12 隔离）；双模式操作对齐裁定后放开——缩放/横滚两模式
    // 同一手势语言（_enterTp/_tpMove 零分叉复用），单指语义不受影响（第二指才触发）。
    if (e.pointerType !== 'mouse') {
      // 陈旧指针防护（build-48 验收实测）：浏览器吞掉 pointerup/pointercancel 时残留条目
      // 会让下一次按下被误判为「第二指」进入双指模式，单指语义全灭。5s 内的条目才视为
      // 活跃参与者（真实双指按下间隔远小于此）。
      const _now = performance.now();
      for (const [k, v] of this._tpPts) if (_now - (v.t || 0) > 5000) this._tpPts.delete(k);
      this._tpPts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: _now });
      if (this._tpPts.size >= 2) { this._enterTp(e.pointerId); return; }
    }
    const r = this.cv.getBoundingClientRect();
    // build-88 视口窗口：世界 x = 画布 x + scrollLeft（命中测试/换算全部世界 px 基准）
    const x = e.clientX - r.left + (this.scroll?.scrollLeft || 0), y = e.clientY - r.top;
    // 划分轨（编舞 tag 道 / 音乐区域划分轨）：
    // 编舞（build-52 F2/F3 对齐后）：呈示=最深层 tag+对应色（drawTags）；旗点命中=预备拖动
    //（磁吸开吸小节线）/单击=选中+编辑 popover（build-77-tagdel：原「单击跳转」与「× 点按
    // 即删除」一并收敛为防误删编辑动线，删除唯二入口=长按/右键菜单、索引「…」）；空白单击/
    // 拖动=定位播放线（与音乐同语义）；双击空白=打点、双击旗=改名。
    // 音乐（build-49 区域块化，与音频 clip 同构）：单击区域=仅选中（不定位播放线、不删）；
    // 拖区域体=移动（水平位移+垂直跨层，钳制不与同层邻区交叠）；拖区域左/右缘=调首尾边界
    // （trim 缘同规格命中区+邻界贴合+最小宽 1 拍）；空白单击=定位播放线（可拖 scrub）；
    // 长按区域=全功能菜单（与右键同款）；长按空白=新建区域（默认宽 16 拍）。删除入口只在菜单。
    if (this.inTagLane(y)) {
      if (this.mode === 'music') {
        this.activeTag = null;
        // build-47 分层：命中/建段全部按指针所在层（tagLevelAtLane）取——跨层互不越界
        const li = this.tagLaneIndexAt(p, y);
        const level = this.tagLevelAtLane(p, li);
        const hit = this.regionAt(x, level);
        if (hit) {
          const editable = this.hooks.canEdit?.() !== false;
          // 拖缘命中区与 clip trim 缘同规格（TRIM_TOL_PX/TRIM_TOL_TOUCH_PX；先 L 后 R，同 clip）
          const tol = e.pointerType === 'touch' ? TRIM_TOL_TOUCH_PX : TRIM_TOL_PX;
          const pps = this.ppsOf(p); // build-49 修复：_down 无 pps 局部——缺它区域命中即 ReferenceError（区域单击/拖拽全灭）
          const x0 = beatToSec(p, hit.beat) * pps;
          const x1 = beatToSec(p, tagEndBeatOf(hit)) * pps;
          let part = 'body';
          if (editable) {
            if (Math.abs(x - x0) <= tol) part = 'edgeL';
            else if (Math.abs(x - x1) <= tol) part = 'edgeR';
          }
          // 长按区域（touch/pen）=打开全功能菜单（与右键完全同款，F2）；与拖动共用待定口径
          //（位移超阈取消长按转拖拽）
          if (e.pointerType !== 'mouse') {
            this._tagLpArm(e, { kind: 'menu', tagId: hit.id, level, beat: Math.max(0, Math.round(this.xToBeat(x) * 100) / 100) });
          }
          try { this.cv.setPointerCapture(e.pointerId); } catch {}
          this.selSegId = hit.id; // 单击=仅选中（高亮即时反馈；不定位播放线）
          this.drag = { kind: 'tagRegion', id: hit.id, part, level, startX: x, moved: false };
          this.render();
        } else {
          // 空白（该层该处无区域）：单击=定位播放线（build-46 语义保持，可拖 scrub）；
          // 长按空白=该层新建区域（默认宽 16 拍，落点吸附小节线；触发时 drag 作废）
          this.selSegId = null;
          if (e.pointerType !== 'mouse') {
            this._tagLpArm(e, { kind: 'create', beat: Math.max(0, Math.round(this.xToBeat(x) * 100) / 100), level });
          }
          try { this.cv.setPointerCapture(e.pointerId); } catch {}
          this.drag = { kind: 'scrub' };
          this.hooks.seekBeat(this.xToBeat(x));
        }
        return;
      }
      const delId = this._tagGeomHit(x, 6, y);
      if (delId) {
        // build-77-tagdel：点按 ×（原「点按即删除」：一条「删标记」历史直落）退役——
        // tagHitAction('tag')='edit'：选中并打开既有改名/编辑 popover，零数据写入零历史。
        // 删除唯二入口=长按/右键 tag 菜单（本分支不再提供）与索引行「…」既有入口。
        this.hoverTag = null;
        this.selSegId = null;
        this.activeTag = delId;
        if (tagHitAction('tag') === 'edit') this.openTagEditor(delId);
        this.render();
        return;
      }
      this.activeTag = null;
      const hit = this.tagAt(x, this.stageLevelOf(p)); // F2：只命中呈示的最深层（看见的才可交互）
      if (hit) {
        // build-77-tagdel：触屏长按旗点=tag 菜单（删除唯二轨道入口之一，与右键同源
        // onSegContextMenu）；位移超阈转拖旗、短按抬起=单击编辑（_up tag 分支）
        if (e.pointerType !== 'mouse') {
          this._tagLpArm(e, { kind: 'menu', tagId: hit.tag.id, level: tagLevelOf(hit.tag), beat: Math.max(0, Math.round(hit.tag.beat * 100) / 100) });
        }
        try { this.cv.setPointerCapture(e.pointerId); } catch {}
        this.drag = { kind: 'tag', id: hit.tag.id, startX: x, moved: false };
        return;
      }
      // F3（build-52-wavezoom）对齐「空白单击=定位播放线」：tag 道空白（非旗点非 ×）单击/
      // 拖动=定位播放线（与音乐模式划分轨空白、尺规同一 seek+scrub 语义）。旗点跳转/拖移、
      // × 删除旧口径不变；道内交互分区注释同步更新（见类头交互矩阵）。
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      this.drag = { kind: 'scrub' };
      this.hooks.seekBeat(this.xToBeat(x));
      return;
    }
    // ---- v3 音频轨 ----
    // W2（修 E-10 混合态）：编舞 26px 简单道只读——点击=seek（拖动沿尺规 scrub 语义延续），
    // 不再进入拖移/trim/剃刀/时间选区等任何剪辑手势（剪辑编辑全部在音乐模式）。
    const clips = clipsOf(p);
    if (clips.length && y >= this.audioTop() && y <= this.audioBottom(p)) {
      if (this.mode !== 'music') {
        try { this.cv.setPointerCapture(e.pointerId); } catch {}
        this.drag = { kind: 'scrub' };
        this.hooks.seekBeat(this.xToBeat(x));
        return;
      }
      this._audioDown(e, x, y, clips);
      return;
    }
    const inBlockBand = y >= (this.blocksTop ?? 0) && y <= (this.blocksTop ?? 0) + (this.blocksH ?? 0);
    // build-70 M2：拖 clip 左/右缘=改长度（clipL/clipR；模型侧 resizeFormationClip 邻界钳制+min 1 拍）
    const editable = this.hooks.canEdit?.() !== false;
    const edges = this.edgeHits(x);
    if (editable && edges.length && inBlockBand) {
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      if (e.pointerType !== 'mouse') this._fcLpArm(e, { index: edges[0].seg.i, beat: Math.max(0, Math.round(this.xToBeat(x) * 100) / 100) });
      this.drag = { ...edges[0], startX: x };
      return;
    }
    if (y <= this.rulerH) {
      // 尺规：点击/拖动定位（Shift+拖拽=时间选区，C11/C8；普通拖拽保持 scrub 兼容既有仪器）
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      if (e.shiftKey) {
        this.drag = { kind: 'timeSel', startSec: x / this.ppsOf(p), moved: false, fromRuler: true };
        this.timeSel = { start: x / this.ppsOf(p), end: x / this.ppsOf(p) };
      } else {
        this.drag = { kind: 'scrub' };
        this.hooks.seekBeat(this.xToBeat(x));
      }
      return;
    }
    // build-70 M2：单击 clip=选中该队形（onSelectFormation）+ 播放线对齐 clip 开头（需求 5）；
    // 按住后拖动=整段平移（clipMove；钳制不越邻 clip）。两模式同分支（块区两模式常显）。
    if (inBlockBand) {
      const { segments } = segmentsFromClips(p.formations);
      const beat = this.xToBeat(x);
      const hit = segments.find(s => beat >= s.start && beat < s.end);
      if (hit) {
        this.hooks.onSelectFormation(hit.i);
        this.hooks.seekBeat(hit.start); // 需求 5：播放线默认对齐 clip 开头
        if (e.pointerType !== 'mouse') {
          this._fcLpArm(e, { index: hit.i, beat: Math.max(0, Math.round(beat * 100) / 100) });
        }
        if (editable) {
          try { this.cv.setPointerCapture(e.pointerId); } catch {}
          this.drag = { kind: 'fcMove', seg: hit, grabBeat: beat - hit.start, startX: x, moved: false };
          this.render();
        }
        return;
      }
      // 定位语义（build-46 验收反馈三；build-52 F3 对齐）：块轨空白（clip 之外/变换段不可落点
      // 处的空白带）单击/拖动=定位播放线（可拖 scrub）。
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      this.drag = { kind: 'scrub' };
      this.hooks.seekBeat(this.xToBeat(x));
      return;
    }
    // 定位语义（build-52 F3 对齐）：音频区（audioBottom）与块区（blocksTop）之间的加轨条/
    // 间隔带——单击/拖动=定位播放线（与尺规同语义）。音乐模式既有；stage 该带仅 6px 间距，
    // 同语义补齐（空白单击=定位播放线对齐项）。
    if (y > this.audioBottom(p) && y < (this.blocksTop ?? 0)) {
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      this.drag = { kind: 'scrub' };
      this.hooks.seekBeat(this.xToBeat(x));
      return;
    }
    // build-79-scruball（需求 9②）：空白=兜底 seek——块区之下留白、域尾空白等一切尚未被上方
    // 分支认领的画布高度（整个 tl 画布高度都在 scrub 命中面内），单击/拖动=定位播放线。
    // 既有命中优先级不变（tag 道/音频轨/块区/尺规/加轨条带全部先行，本分支只兜底）。
    try { this.cv.setPointerCapture(e.pointerId); } catch {}
    this.drag = { kind: 'scrub' };
    this.hooks.seekBeat(this.xToBeat(x));
  }
  // ---- D1：双指平移+捏合（音乐模式专属；编舞模式红线 E-12 零触碰） ----
  // 进入：第二指落下时调用。单指状态机（时间选区/clip 拖移/长按计时）按 pointercancel
  // 同路径清理——拖拽置空、跨轨高亮清零补绘、长按计时作废。
  _enterTp(newId) {
    this._lpCancel();
    this._fcLpCancel(); // build-70：队形 clip 长按同口径作废（双指接管）
    const hadHover = this.dragHoverLane != null || this.dragHoverTagLane != null;
    this.drag = null;
    this.dragHoverLane = null;
    this.dragHoverTagLane = null;
    if (hadHover) this.render();
    try { this.cv.setPointerCapture(newId); } catch {} // 两指各自捕获：滑出画布边缘手势不断
    const [a, b] = [...this._tpPts.values()];
    this._tp = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }
  // 驱动：参与指的 move 全部喂给手势机。返回 true=事件已消费（不进单指拖拽/悬停逻辑）。
  // _tp 为 null 时恒 false——第一指在第二指落下前仍走既有单指语义（红线不动）。
  _tpMove(e) {
    if (!this._tp || !this._tpPts.has(e.pointerId)) return false;
    const pt = this._tpPts.get(e.pointerId);
    pt.x = e.clientX; pt.y = e.clientY;
    if (this._tpPts.size < 2) { this._tp = null; return true; } // 抬掉一指：手势结束，剩指吞事件防误触
    const [a, b] = [...this._tpPts.values()];
    const g = twoPointerGesture(this._tp, { ax: a.x, ay: a.y, bx: b.x, by: b.y });
    if (g) {
      // 质心位移=平移，内容跟手：指右移(+) → 视口左移 → scrollLeft 减；赋值越界由浏览器钳在量程内
      this.scroll.scrollLeft -= g.dx;
      this.scroll.scrollTop -= g.dy;
      if (g.zoom !== 1) this.zoomAt(g.zoom, (a.x + b.x) / 2); // 指距比=锚定质心捏合缩放（复用 M2 锚定数学）
    }
    this._tp = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    return true;
  }
  _endTp() { this._tpPts.clear(); this._tp = null; }
  // ---- D2：长按 clip 弹剪辑菜单（touch/pen；音乐模式）----
  // iOS Safari 长按不产生 contextmenu、Android 会——统一自实现计时器（不依赖 contextmenu），
  // 触发后短窗内吞原生 contextmenu 防双菜单（见 _bind 的 contextmenu 分支）。
  _armLongPress(e, hit, sec) {
    this._lpCancel();
    const lp = this._lp = {
      id: e.pointerId, clipId: hit.clip.id,
      cx: e.clientX, cy: e.clientY, x0: e.clientX, y0: e.clientY,
      sec, timer: 0,
    };
    lp.timer = setTimeout(() => this._lpFire(lp), TP_LP_MS);
  }
  _lpCancel() {
    const lp = this._lp;
    if (!lp) return;
    clearTimeout(lp.timer);
    this._lp = null;
  }
  _lpFire(lp) {
    if (this._lp !== lp) return; // 已被取消/换手势：过期计时器不生效
    this._lp = null;
    this._lpFiredAt = performance.now();
    this.drag = null; // 长按生效：该指的待定拖拽转菜单，不再有拖拽/单击语义
    this.hooks.onClipContextMenu?.({
      clipId: lp.clipId, screenX: lp.cx, screenY: lp.cy, timelineSec: lp.sec,
    });
  }
  // ---- build-47：划分轨长按（touch/pen；音乐模式）----
  // 复用 build-44 长按机制口径（TP_LP_MS=550ms、位移 TP_SLOP_PX=8px 取消、_lpFiredAt 抑制
  // Android 原生 contextmenu 跟弹——F2 再补待定期原生 contextmenu 吞针，见 _bind）。
  // F2（build-48-tagui）：info.kind='menu' → 打开与右键完全相同的全功能段菜单（编辑内容/
  // 于此拆分/合并/删除/升降级/换色；「编辑内容」项才进字段编辑器），不再直开编辑器；
  // info.kind='create' → 该层新建 tag 并直接编辑（空白建段既有入口不变）。
  _tagLpArm(e, info) {
    this._tagLpCancel();
    const lp = this._tagLp = {
      id: e.pointerId, cx: e.clientX, cy: e.clientY, x0: e.clientX, y0: e.clientY, info, timer: 0,
    };
    lp.timer = setTimeout(() => this._tagLpFire(lp), TP_LP_MS);
  }
  _tagLpCancel() {
    const lp = this._tagLp;
    if (!lp) return;
    clearTimeout(lp.timer);
    this._tagLp = null;
  }
  _tagLpFire(lp) {
    if (this._tagLp !== lp) return; // 已被取消/转拖拽：过期计时器不生效
    this._tagLp = null;
    this._lpFiredAt = performance.now(); // 抑制紧随的 Android 原生 contextmenu（防双菜单/双动作）
    this.drag = null; // 长按生效：待定拖拽/单击语义作废
    if (lp.info?.kind === 'menu') {
      // 单弹窗不变式：先关已开的编辑器/菜单，再开与右键同款的段菜单（同一入口 showSegMenu）
      this.closeTagPopover();
      UI.closeContextMenu();
      this.hooks.onSegContextMenu?.({
        tagId: lp.info.tagId,
        level: lp.info.level ?? 0,
        beat: lp.info.beat ?? 0,
        screenX: lp.cx, screenY: lp.cy,
      });
    } else if (lp.info?.kind === 'create') {
      const p = this.hooks.getProject();
      let newId = null;
      this.hooks.mutateLabeled?.(p2 => {
        newId = addTag(p2, lp.info.beat, '', { level: lp.info.level }).id;
      }, '打标记');
      if (newId) this.openTagEditor(newId);
      this.render();
    }
  }
  // ---- build-70 M2：队形 clip 长按菜单（touch/pen；两模式）----
  // 复用同一长按机制口径（TP_LP_MS=550ms、位移 TP_SLOP_PX=8px 取消、_lpFiredAt 抑制原生
  // contextmenu 跟弹）。触发=打开与右键同款的队形 clip 菜单（分割于此/删除队形/对齐到播放头，
  // 同一入口 showFormationClipMenu）。
  _fcLpArm(e, info) {
    this._fcLpCancel();
    const lp = this._fcLp = {
      id: e.pointerId, cx: e.clientX, cy: e.clientY, x0: e.clientX, y0: e.clientY, info, timer: 0,
    };
    lp.timer = setTimeout(() => this._fcLpFire(lp), TP_LP_MS);
  }
  _fcLpCancel() {
    const lp = this._fcLp;
    if (!lp) return;
    clearTimeout(lp.timer);
    this._fcLp = null;
  }
  _fcLpFire(lp) {
    if (this._fcLp !== lp) return; // 已被取消/转拖拽：过期计时器不生效
    this._fcLp = null;
    this._lpFiredAt = performance.now(); // 抑制紧随的 Android 原生 contextmenu（防双菜单/双动作）
    this.drag = null; // 长按生效：待定拖拽/单击语义作废
    // 单弹窗不变式：先关已开的编辑器/菜单，再开队形 clip 菜单（与右键同一入口）
    this.closeTagPopover();
    UI.closeContextMenu();
    this.hooks.onFormationClipContextMenu?.({
      index: lp.info?.index ?? null,
      beat: lp.info?.beat ?? 0,
      screenX: lp.cx, screenY: lp.cy,
    });
  }

  // ---- v3 音频轨命中与手势 ----
  // 命中链（展开态）：fade 把手 → trim 缘 → 增益横线 → 盒体；简单态只有盒体（拖移/点击定位）。
  // 多轨（汇合轮）：音乐模式先按 y 定 lane，只命中该轨 clip；编舞模式单 lane 全量（既有）。
  // M3 T2/T7：命中半径 mouse/pen=10px（TRIM_TOL_PX）、touch=14px（TRIM_TOL_TOUCH_PX）；
  // 「顶部 16px 归淡化」分区（build-45 由 12px 加宽，触屏可达 F3；trim 缘无 y 分区，二者
  // x 域重叠时命中链先 fade 后 trim 的既有次序即为让步规则——fade 优先胜出）。
  _audioHit(x, y, clips, touch = false) {
    const p = this.hooks.getProject();
    const pps = this.ppsOf(p);
    const n = this.trackCount(p);
    const lh = this.audioLaneH();
    const tol = touch ? TRIM_TOL_TOUCH_PX : TRIM_TOL_PX;
    let laneClips = clips, laneTop = this.audioTop();
    if (n > 1) {
      const li = this.laneIndexAt(p, y);
      const tid = this.trackAtLane(p, li)?.id;
      laneClips = clips.filter(c => trackOfClip(p, c)?.id === tid);
      laneTop = this.laneTopOf(p, li);
    }
    const laneMid = laneTop + lh / 2;
    for (let i = laneClips.length - 1; i >= 0; i--) { // 数组顺序即 z 序，顶层优先
      const c = laneClips[i];
      const x0 = c.timelineStartSec * pps, x1 = clipEnd(c) * pps;
      if (x < x0 - tol || x > x1 + tol) continue;
      if (!this.expanded) return { clip: c, part: 'body' };
      // F3（build-46-layout）常驻淡化把手：fade=0 时把手贴 clip 左/右缘常驻呈示（半明度「未设置」
      // 态），命中门控同步删除——无淡化的 clip 也能直接从缘把手拖出淡化（横拖=长度，纵拖=曲线，
      // 拖回缘=清除既有钳 0 路径）。与 trim 缘的重叠让步规则：淡化把手只在顶部 16px 窄带
      // （FADE_HIT_TOP_PX）且命中链先 fade 后 trim 的既有次序优先，trim 缘全高命中不变——
      // 无需几何让步（缝>缘>trim>增益>盒体次序整体不变）。
      if (Math.abs(x - (x0 + (c.fadeInSec || 0) * pps)) <= tol && y - laneTop <= FADE_HIT_TOP_PX) return { clip: c, part: 'fadeIn' };
      if (Math.abs(x - (x1 - (c.fadeOutSec || 0) * pps)) <= tol && y - laneTop <= FADE_HIT_TOP_PX) return { clip: c, part: 'fadeOut' };
      if (Math.abs(x - x0) <= tol) return { clip: c, part: 'trimL' };
      if (Math.abs(x - x1) <= tol) return { clip: c, part: 'trimR' };
      if (Math.abs(y - laneMid) <= 5 && x >= x0 && x <= x1) return { clip: c, part: 'gain' };
      return { clip: c, part: 'body' };
    }
    return null;
  }
  _xFadeHit(x, y, clips) {
    if (!this.expanded) return null;
    const p = this.hooks.getProject();
    const pps = this.ppsOf(p);
    const n = this.trackCount(p);
    const tracks = this.tracksOf(p);
    // build-45 F5：只命中**同轨 auto 配对**（双缘互指）——接缝把手语义=双曲线同调；
    // 手动淡化重叠对不再提供旧的「比例拖拽」（横向改交叉时长与「交叉时间不变」需求冲突，已退役）。
    for (const ov of computeOverlaps(clips)) {
      if (!(ov.a.fadeOutAuto && ov.a.autoPairOut === ov.b.id && ov.b.fadeInAuto && ov.b.autoPairIn === ov.a.id)) continue;
      const mx = ((ov.start + ov.end) / 2) * pps;
      const li = n > 1 ? Math.max(0, tracks.findIndex(t => t.id === trackOfClip(p, ov.a)?.id)) : 0;
      const my = this.laneTopOf(p, li) + 10;   // 与 drawAudioLane 菱形同一 y（命中=所见）
      if (Math.abs(x - mx) <= SEAM_HIT_HALF_W && Math.abs(y - my) <= SEAM_HIT_HALF_H) return ov;
    }
    return null;
  }
  // 磁吸候选（规格 C17：clip 缘/块边界/tag/播放头/时间选区/零交叉）
  _snapCandidates(excludeId) {
    const p = this.hooks.getProject();
    const { segments } = segmentsFromClips(p.formations);
    // 音乐模式：队形 clip 边界仍不作为磁吸候选（F5 块区常显后维持既有磁吸行为不变——「磁吸钩子照常」；
    // 音频 clip 拖移吸附走 tag/播放头/选区/clip 缘/零交叉既有候选集，块区只读呈示不反哺音频吸附）。
    // build-70：stage 模式候选=队形 clip 缘（start/end；空隙不再是数据边界，无第三个候选点）。
    const blockSecs = this.mode !== 'stage' ? [] : (() => {
      const out = [];
      for (const s of segments) { out.push(beatToSec(p, s.start), beatToSec(p, s.end)); }
      return out;
    })();
    const tagSecs = (p.timeline.tags || []).map(t => beatToSec(p, t.beat));
    const player = this.hooks.getPlayer?.();
    return collectSnapCandidates({
      clips: clipsOf(p), excludeId,
      playheadSec: player ? beatToSec(p, Math.max(0, player.beat)) : null,
      selStartSec: this.timeSel?.start ?? null,
      selEndSec: this.timeSel?.end ?? null,
      blockSecs, tagSecs,
    });
  }
  _snap(sec, excludeId) {
    if (!this.snapOn) return { t: sec, line: null };
    const pps = this.ppsOf(this.hooks.getProject());
    return snapTime(sec, this._snapCandidates(excludeId), SNAP_TOL_PX / pps);
  }
  // 零交叉吸附（trim 缘；仅磁吸开启时）：把 src 侧端点吸到最近过零点（≤4ms 才生效）
  _snapZeroCross(clip, side) {
    if (!this.snapOn) return;
    const buf = this.hooks.audio?.resolveAssetBuffer?.(clip.assetId);
    if (!buf) return;
    const sr = buf.sampleRate;
    const ch0 = buf.getChannelData(0);
    const srcSample = (side === 'in' ? clip.srcStartSec : clip.srcStartSec + clip.lengthSec) * sr;
    const zc = nearestZeroCrossing(ch0, srcSample, ZC_RADIUS_SEC * sr);
    const delta = (zc / sr) - (side === 'in' ? clip.srcStartSec : clip.srcStartSec + clip.lengthSec);
    if (Math.abs(delta) > ZC_RADIUS_SEC) return;
    if (side === 'in') {
      clip.srcStartSec = r6(clip.srcStartSec + delta);
      clip.timelineStartSec = r6(clip.timelineStartSec + delta);
      clip.lengthSec = r6(clip.lengthSec - delta);
    } else {
      clip.lengthSec = r6(clip.lengthSec + delta);
    }
  }
  _audioDown(e, x, y, clips) {
    const p = this.hooks.getProject();
    const editable = this.hooks.canEdit?.() !== false;
    const pps = this.ppsOf(p);
    const sec = x / pps;
    this._lastX = x;
    try { this.cv.setPointerCapture(e.pointerId); } catch {}
    // 剃刀：点击 clip 即分割（C6）
    if (this.razor) {
      const hit = this._audioHit(x, y, clips, e.pointerType === 'touch');
      if (hit && editable) {
        this.hooks.pauseIfPlaying?.();
        this.hooks.mutateLabeled?.(pr => { splitClipAt(pr.timeline.audioClips, hit.clip.id, sec); }, '分割音频剪辑');
      }
      this.drag = null;
      return;
    }
    // 选择（C1）：单击=单选；Ctrl/Cmd=多选切换。空白拖拽=时间选区（C8）；空白单击=定位播放头（C12）
    // 接缝把手（build-45 F5）：命中区加宽到 26px（SEAM_HIT_HALF_W，触屏可达）；命中优先于
    // fade 缘把手（短重叠时缝把手可能遮住缘把手，缝把手是 auto 对的主交互，先缝后缘）。
    const ov = this._xFadeHit(x, y, clips);
    if (ov && editable) {
      // startK 取前 clip 淡出缘曲线（两缘同调后应相等；历史分歧时以前缘为准整体拉齐）
      this.drag = { kind: 'xFade', a: ov.a, b: ov.b, startX: x, startY: y, startK: ov.a.fadeOutCurve || 0, moved: false, ovStart: ov.start, ovEnd: ov.end };
      return;
    }
    const hit = this._audioHit(x, y, clips, e.pointerType === 'touch');
    if (hit) {
      // D2：触屏/笔长按 clip=剪辑菜单（剪切入口）。剃刀不布（点击即分割，已有即时语义）；
      // 长按与拖拽共存口径：touch 先进「待定」（drag.pending）——位移超 TP_SLOP_PX 转正拖拽
      // （并取消长按），静止满 TP_LP_MS 转菜单。鼠标有右键菜单，不进此路径。
      if (e.pointerType !== 'mouse' && this.mode === 'music' && !this.razor) this._armLongPress(e, hit, sec);
      if (e.ctrlKey || e.metaKey) {
        if (this.clipSel.has(hit.clip.id)) this.clipSel.delete(hit.clip.id);
        else this.clipSel.add(hit.clip.id);
      } else if (!this.clipSel.has(hit.clip.id)) {
        this.clipSel = new Set([hit.clip.id]);
      }
      const ids = [...this.clipSel];
      if (hit.part === 'body') {
        if (editable) {
          this.hooks.pauseIfPlaying?.(); // 守卫：播放中移动先自动暂停
          this.drag = { kind: 'clipMove', ids, primary: hit.clip, grabSec: sec - hit.clip.timelineStartSec, startX: x, moved: false };
        } else this.drag = null;
      } else if (editable) {
        const part = hit.part;
        const isTrim = part === 'trimL' || part === 'trimR';
        if (isTrim) this.hooks.pauseIfPlaying?.(); // 守卫：播放中 trim 先自动暂停（淡化/增益实时不暂停）
        this.drag = { kind: part === 'trimL' ? (e.shiftKey ? 'trimLB' : 'trimL') : part === 'trimR' ? (e.shiftKey ? 'trimRB' : 'trimR') : part, id: hit.clip.id, startX: x, moved: false };
        // F3 二维把手：记录纵向起点与起始曲线 k——move 时 dy/CURVE_PX_PER_K 增量调曲线
        if (part === 'fadeIn' || part === 'fadeOut') {
          this.drag.startY = y;
          this.drag.startCurve = hit.part === 'fadeIn' ? (hit.clip.fadeInCurve || 0) : (hit.clip.fadeOutCurve || 0);
        }
      } else {
        this.drag = null;
      }
      // 触屏待定标记（见上注）：长按计时存续且拖拽状态机已建立时冻结其首动，防 8px 内抖动偷移 clip
      if (this._lp && this.drag) {
        this.drag.pending = true;
        this.drag.startClientX = e.clientX;
        this.drag.startClientY = e.clientY;
      }
      this.render();
      return;
    }
    this.drag = { kind: 'timeSel', startSec: sec, startX: x, moved: false };
    this.timeSel = { start: sec, end: sec };
    this.render();
  }
  _dragX(e) {
    const r = this.cv.getBoundingClientRect();
    return e.clientX - r.left + (this.scroll?.scrollLeft || 0); // build-88 视口窗口：世界 x = 画布 x + scrollLeft
  }
  _applyClipMove(drag, x, y = null) {
    const p = this.hooks.getProject();
    const pps = this.ppsOf(p);
    // W3 拖移跨轨预览：先记指针所指 lane（纯前端高亮；模型变更仍在下方 mutate 内）
    const hoverLane = (y != null && this.mode === 'music' && this.trackCount(p) > 1)
      ? this.laneIndexAt(p, y)
      : null;
    const hoverChanged = this.dragHoverLane !== hoverLane;
    this.dragHoverLane = hoverLane;
    let newStart = Math.max(0, x / pps - drag.grabSec);
    // 磁吸：起点/终点就近候选（取距离更小者；不吸自己）
    const snapS = this._snap(newStart, drag.primary.id);
    const snapE = this._snap(newStart + drag.primary.lengthSec, drag.primary.id);
    if (snapS.line !== null || snapE.line !== null) {
      const dS = snapS.line !== null ? Math.abs(snapS.line - newStart) : Infinity;
      const dE = snapE.line !== null ? Math.abs(snapE.line - (newStart + drag.primary.lengthSec)) : Infinity;
      if (dS <= dE) newStart = snapS.line ?? newStart; else newStart = Math.max(0, (snapE.line ?? (newStart + drag.primary.lengthSec)) - drag.primary.lengthSec);
    }
    // 跨轨拖拽（汇合轮，音乐模式多轨）：指针落到别的 lane → moveClipToTrack（模型）+ 提交后 reschedule
    let toTrackId = null;
    if (y != null && this.trackCount(p) > 1) {
      const t = this.trackAtLane(p, this.laneIndexAt(p, y));
      if (t && trackOfClip(p, drag.primary)?.id !== t.id) toTrackId = t.id;
    }
    const delta = newStart - drag.primary.timelineStartSec;
    if (!delta && !toTrackId) {
      if (hoverChanged) this.render(); // 纵向挪入/挪出目标 lane 也要即时呈示高亮（横移零位时）
      return;
    }
    drag.trackChanged = !!toTrackId;
    this.hooks.mutateQuiet?.(pr => { // 拖移高频预览：跳过全 App render 订阅链（性能修复）
      if (toTrackId) for (const id of drag.ids) moveClipToTrack(pr, id, toTrackId);
      for (const id of drag.ids) {
        const c = pr.timeline.audioClips.find(k => k.id === id);
        if (c) c.timelineStartSec = r6(Math.max(0, c.timelineStartSec + delta));
      }
      applyAutoCrossfades(pr.timeline.audioClips, drag.ids);
      for (const id of drag.ids) pruneAutoCrossfades(pr.timeline.audioClips, id);
    });
    drag.moved = true;
    this.render();
  }
  _move(e) {
    // D1：双指手势进行中——参与指的 move 全喂手势机（平移/捏合），不进拖拽/悬停逻辑
    if (this._tpMove(e)) return;
    const drag = this.drag;
    // build-47：划分轨长按待定中（touch/pen 按下未满时长）——静止等编辑器；位移超阈=
    // 拖拽/滚动意图，取消长按（与 clip 长按 D2 同口径）
    if (this._tagLp) {
      if (Math.hypot(e.clientX - this._tagLp.x0, e.clientY - this._tagLp.y0) > TP_SLOP_PX) this._tagLpCancel();
      else return;
    }
    // build-70：队形 clip 长按待定中——位移超阈=拖拽意图，取消长按转正拖拽（与 tag/clip 同口径）
    if (this._fcLp) {
      if (Math.hypot(e.clientX - this._fcLp.x0, e.clientY - this._fcLp.y0) > TP_SLOP_PX) this._fcLpCancel();
      else return;
    }
    // D2：长按待定中（触屏按下 clip 未满时长）——静止等菜单；位移超阈=拖拽意图，
    // 取消长按并把本次拖拽转正（同一 move 事件继续走下方既有拖拽逻辑）
    if (drag && drag.pending) {
      if (Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) <= TP_SLOP_PX) return;
      drag.pending = false;
      this._lpCancel();
    }
    const x0 = this._dragX(e);
    const r0 = this.cv.getBoundingClientRect();
    const y0 = e.clientY - r0.top;
    // 悬停反馈（无拖拽时）：clip 命中光标 + tag 旗点 + 块高亮
    if (!drag) {
      const x = x0, y = y0;
      const p = this.hooks.getProject();
      const edges = p ? this.edgeHits(x) : [];
      let hoverSeg = null;
      let hoverTag = null;
      let hoverSegId = null;
      let laneCursor = null; // 划分轨专用光标（build-49 区域：缘=ew-resize、体=grab）
      this.hoverAudio = false;
      this.hoverClipEdge = null;
      if (p && this.inTagLane(y)) {
        if (this.mode === 'music') {
          // 区域悬停高亮（build-49）：体/缘一体的区域命中——缘区给 ew-resize（trim 同款）、体给 grab
          const level = this.tagLevelAtLane(p, this.tagLaneIndexAt(p, y));
          const hit = this.regionAt(x, level);
          hoverSegId = hit ? hit.id : null;
          if (hit) {
            const pps = this.ppsOf(p);
            const tol = TRIM_TOL_PX;
            const nearL = Math.abs(x - beatToSec(p, hit.beat) * pps) <= tol;
            const nearR = Math.abs(x - beatToSec(p, tagEndBeatOf(hit)) * pps) <= tol;
            laneCursor = (nearL || nearR) ? 'ew-resize' : 'grab';
          }
        } else {
          // 旗点或 ×（几何）都算悬停该标记——× 在名称末端，鼠标移过去不能让 × 消失（stage 旧口径）
          // F2：旗点悬停只认呈示的最深层（× 几何本就只含所画 tag）
          const hit = this.tagAt(x, this.stageLevelOf(p));
          hoverTag = hit ? hit.tag.id : this._tagGeomHit(x, 8, y);
        }
      } else if (p && y >= this.audioTop() && y <= this.audioBottom(p) && clipsOf(p).length) {
        // v3 音频轨悬停：部件光标（trim/fade/gain/body/剃刀）——音乐模式满血；
        // W2 编舞模式只读缩影：恒 pointer（呈示/点击 seek），不呈示剪辑部件态、不置 hoverAudio
        //（S/R 剪辑快捷键的作用域随之归音乐模式）
        this.hoverAudio = false;
        if (this.mode !== 'music') {
          this.hoverClipEdge = null;
          this.cv.style.cursor = 'pointer';
          this._tagTitle(x, y);
          this.render();
          return;
        }
        this.hoverAudio = true;
        const clips = clipsOf(p);
        if (!this._xFadeHit(x, y, clips)) {
          const hit = this._audioHit(x, y, clips, e.pointerType === 'touch');
          if (hit) {
            this.hoverClipEdge = { id: hit.clip.id, part: hit.part };
            // F3 二维把手：fade 把手横=长度、纵=曲线 → move 双向光标（ns 语义并入，不再单 ew-resize）
            const cursors = { trimL: 'ew-resize', trimR: 'ew-resize', trimLB: 'ew-resize', trimRB: 'ew-resize', fadeIn: 'move', fadeOut: 'move', gain: 'ns-resize', body: this.razor ? 'crosshair' : 'grab' };
            this.cv.style.cursor = this.razor ? 'crosshair' : (cursors[hit.part] || 'default');
            this._tagTitle(x, y);
            // M3 T2：trim 把手 tooltip（可发现性）——把手常驻 glyph 的语义提示；非 trim 部件清空
            //（_tagTitle 已先行清掉 tag 道之外的 title，此处只在 trim 缘覆写）
            this.cv.title = (hit.part === 'trimL' || hit.part === 'trimR')
              ? '拖动=修剪（内容跟手）· Shift=只移边界'
              : '';
            // 悬停渲染守卫（性能修复）：同一 clip 同一部件的重复移动（触屏拖动时 60-120Hz）
            // 不再逐事件全量重绘——光标/tooltip 已就地更新，画布高亮未变化无需重绘
            const hs = hit.clip.id + ':' + hit.part + ':' + (this.razor ? 1 : 0);
            if (hs !== this._hoverSig) { this._hoverSig = hs; this.render(); }
            return;
          }
        }
        this.cv.style.cursor = this.razor ? 'crosshair' : 'default';
        this._tagTitle(x, y);
        if (this._hoverSig) { this._hoverSig = null; this.render(); } // 离开部件：仅状态翻转时重绘
        return;
      } else {
        for (const hit of edges) hoverSeg = hit.seg.i;
        // F5：块身悬停高亮两模式生效（stage 原分支条件仅去 mode 门控，行为零变化）；
        // build-70：clip 内=grab（拖动=整段平移）、缘=ew-resize（命中光标由 edges 分支给出）
        if (hoverSeg === null && y >= (this.blocksTop ?? 0) && y <= (this.blocksTop ?? 0) + (this.blocksH ?? 0)) {
          if (p) {
            const beat = this.xToBeat(x);
            for (const s of segmentsFromClips(p.formations).segments) {
              if (beat >= s.start && beat < s.end) { hoverSeg = s.i; break; }
            }
          }
        }
      }
      // build-70：clip 体光标=grab（缘 ew-resize 由 edges 优先判定）
      const inBlockBandHover = y >= (this.blocksTop ?? 0) && y <= (this.blocksTop ?? 0) + (this.blocksH ?? 0);
      const blockCursor = (inBlockBandHover && hoverSeg !== null && !edges.length) ? 'grab' : null;
      this.cv.style.cursor = laneCursor ?? ((hoverTag || hoverSegId) ? 'pointer' : (edges.length ? 'ew-resize' : blockCursor ?? 'default'));
      this._tagTitle(x, y);
      this._hoverSig = null;
      if (this.hoverSeg !== hoverSeg || this.hoverTag !== hoverTag || this.hoverSegId !== hoverSegId) {
        this.hoverSeg = hoverSeg;
        this.hoverTag = hoverTag;
        this.hoverSegId = hoverSegId;
        this.render();
      }
      return;
    }
    const p = this.hooks.getProject();
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left + (this.scroll?.scrollLeft || 0); // build-88：世界 x
    const spbV = spb(p);
    const minBeats = 0.5;
    if (drag.kind === 'scrub') {
      this.hooks.seekBeat(this.xToBeat(x));
      return;
    }
    // ---- v3 音频轨拖拽族 ----
    const clips = clipsOf(p);
    if (drag.kind === 'clipMove') {
      this._applyClipMove(drag, x, y0);
      return;
    }
    if (drag.kind === 'trimL' || drag.kind === 'trimLB' || drag.kind === 'trimR' || drag.kind === 'trimRB') {
      const c = clips.find(k => k.id === drag.id);
      if (!c) return;
      const assetDur = this.assetDurOf(p, c.assetId);
      let sec = x / this.ppsOf(p);
      const snapped = this._snap(sec, c.id);
      if (snapped.line !== null) sec = snapped.t;
      let ok = false;
      if (drag.kind === 'trimL') { ok = trimClipLeftAnchored(c, sec, assetDur); if (ok) this._snapZeroCross(c, 'in'); }
      else if (drag.kind === 'trimLB') ok = trimClipLeftBoundary(c, sec, assetDur);
      else if (drag.kind === 'trimR') { ok = trimClipRightAnchored(c, sec, assetDur); if (ok) this._snapZeroCross(c, 'out'); }
      else ok = trimClipRightBoundary(c, sec, assetDur);
      if (ok) {
        drag.moved = true;
        this.hooks.mutateQuiet?.(pr => { // 拖拽高频路径：跳过全 App render 订阅链
          applyAutoCrossfades(pr.timeline.audioClips, [c.id]);
          pruneAutoCrossfades(pr.timeline.audioClips, c.id);
        });
        this.render();
      }
      return;
    }
    if (drag.kind === 'fadeIn' || drag.kind === 'fadeOut') {
      const c = clips.find(k => k.id === drag.id);
      if (!c) return;
      const pps = this.ppsOf(p);
      const x0c = c.timelineStartSec * pps, x1c = clipEnd(c) * pps;
      // 横向 = 淡化长度（既有语义）；纵向 = 曲线 k（F3 二维把手）。
      let f = drag.kind === 'fadeIn' ? (x - x0c) / pps : (x1c - x) / pps;
      f = Math.max(0, Math.min(c.lengthSec, f));
      c[drag.kind === 'fadeIn' ? 'fadeInSec' : 'fadeOutSec'] = r6(f);
      c[drag.kind === 'fadeIn' ? 'fadeInAuto' : 'fadeOutAuto'] = false; // 手动淡化（拖开不还原）
      // 曲线轴：下拖 dy>0 → k 增大（渐变起步更慢）；上拖 → k 减小（起步更快）。
      // 40px=全程 1.0 k；|k|<0.15（≈6px 位移）吸附回 0=等功率（方便回默认）。
      // 纯横向拖（dy≈0）时 k 原值近 0 → 吸附仍写 0，与旧数据等价，不产生行为漂移。
      const dy = y0 - (drag.startY ?? y0);
      const kRaw = (drag.startCurve || 0) + dy / CURVE_PX_PER_K;
      const k = clampCurve(Math.abs(kRaw) < CURVE_SNAP_K ? 0 : kRaw);
      c[drag.kind === 'fadeIn' ? 'fadeInCurve' : 'fadeOutCurve'] = k;
      drag.moved = true;
      this.hooks.mutateQuiet?.(() => {});
      this.render();
      return;
    }
    if (drag.kind === 'xFade') {
      // 接缝把手（build-45 F5）：纵向拖=双曲线同调（setSeamCurves 同写前缘 fadeOutCurve 与
      // 后缘 fadeInCurve）——交叉时长（=重叠时长）与 auto 标志都不动，曲线调整不解除配对；
      // 横向拖=无语义（「交叉时间不变」，旧比例拖拽已退役，见 _xFadeHit 注）。
      const dy = y0 - (drag.startY ?? y0);
      if (drag.curveMode || Math.abs(dy) >= 6) {   // 位移 ≥6px 判定纵向意图，此后锁定曲线模式（防抖动半途跳值）
        drag.curveMode = true;
        const kRaw = (drag.startK || 0) + dy / CURVE_PX_PER_K;   // 40px=全程 1.0 k，下正上负
        setSeamCurves(drag.a, drag.b, Math.abs(kRaw) < CURVE_SNAP_K ? 0 : kRaw); // 近 0 吸附=等功率，与缘把手同一手感
        drag.moved = true;
      }
      this.hooks.mutateQuiet?.(() => {});
      this.render();
      return;
    }
    if (drag.kind === 'gain') {
      const c = clips.find(k => k.id === drag.id);
      if (!c) return;
      // 增益横线在 clip 所在 lane 的中线（多轨：各轨各自中线）
      const li = this.trackCount(p) > 1 ? Math.max(0, this.tracksOf(p).findIndex(t => t.id === trackOfClip(p, c)?.id)) : 0;
      const laneTop = this.laneTopOf(p, li);
      const laneMid = laneTop + this.audioLaneH() / 2;
      const g = Math.max(0, Math.min(2, 1 + (laneMid - y0) / (this.audioLaneH() / 2 - 6)));
      c.gain = r6(g);
      drag.moved = true;
      this.hooks.mutateQuiet?.(() => {});
      this.render();
      return;
    }
    if (drag.kind === 'timeSel') {
      const sec = Math.max(0, x / this.ppsOf(p));
      drag.moved = drag.moved || Math.abs(x - drag.startX) > 3 || !!drag.fromRuler;
      this.timeSel = { start: Math.min(drag.startSec, sec), end: Math.max(drag.startSec, sec) };
      this.hooks.onTimeSelection?.(this.timeSel);
      this.render();
      return;
    }
    if (drag.kind === 'tag') {
      // 编舞拖旗移位（E-12 旧口径；区域模型下 moveTag=整块平移保持区域宽）：实时预览
      //（mutate(fn,null) 不进历史），松手在 _up 提交恰一条「移动标记」。
      // F3（build-52-wavezoom）对齐「磁吸开关」：磁吸开（既有 snapOn，S/工具条同一状态）=
      // 拖旗就近吸附小节线（snapTagBeatToBar，与音乐区域拖移/建段同机制同容差）；磁吸关不吸。
      drag.moved = drag.moved || Math.abs(x - drag.startX) > 2;
      if (drag.moved) {
        this._tagLpCancel(); // build-47：拖界转正即取消长按编辑（待定共存口径同 clip）
        let beat = this.xToBeat(x);
        [beat] = this.snapTagBeatToBar(beat);
        this.hooks.mutate(proj => { moveTag(proj, drag.id, beat); });
        this.hoverTag = drag.id;
      }
      return;
    }
    if (drag.kind === 'tagRegion') {
      // 区域拖拽（build-49 F2，音乐模式；与音频 clip 同构）：
      // 体=移动（水平位移+垂直跨层；跨层 hover 高亮与提交口径复用 clip 跨轨拖拽）；
      // 缘=调首尾边界（邻界贴合钳制 + 最小宽 1 拍）；边缘磁吸=小节线（沿用既有磁吸机制，S 可关）。
      // 高频预览走 mutateQuiet（跳过全 App render 订阅链），松手 _up 提交恰一条历史。
      drag.moved = drag.moved || Math.abs(x - drag.startX) > 2;
      if (drag.moved) {
        this._tagLpCancel(); // 拖拽转正即取消长按菜单（待定共存口径同 clip）
        let beat = this.xToBeat(x);
        [beat] = this.snapTagBeatToBar(beat); // 边缘磁吸：小节线（磁吸关时不吸）
        // 跨层：指针落到其它划分轨 lane → 目标层（hover 高亮即时反馈；-1=拖出划分轨保持原层）
        const li = this.tagLaneIndexAt(p, y0);
        this.dragHoverTagLane = drag.part === 'body' ? (li >= 0 ? li : null) : null;
        const targetLevel = (drag.part === 'body' && li >= 0) ? this.tagLevelAtLane(p, li) : drag.level;
        this.hooks.mutateQuiet?.(pr => {
          if (drag.part === 'body') {
            if (targetLevel !== drag.level) placeTagRegion(pr, drag.id, targetLevel, beat);
            else moveTagRegion(pr, drag.id, beat);
          } else {
            resizeTagRegion(pr, drag.id, drag.part === 'edgeL' ? 'L' : 'R', beat);
          }
        });
        this.render();
      }
      return;
    }
    // ---- build-70 M2：队形 clip 拖拽族 ----
    // 拖体=整段平移（clipMove）；拖缘=改长度（clipL=左缘动 start+len 联动、clipR=右缘动 len）。
    // 模型侧 moveFormationClip/resizeFormationClip 邻界钳制（不越邻 clip、min 1 拍）；
    // 拍位吸附=整拍（既有口径）。高频预览走 mutateQuiet，松手 _up 提交恰一条历史。
    if (drag.kind === 'fcMove') {
      drag.moved = drag.moved || Math.abs(x - drag.startX) > 2;
      if (drag.moved) {
        this._fcLpCancel(); // 拖拽转正即取消长按菜单（待定共存口径同 clip/tag）
        let target = this.xToBeat(x) - drag.grabBeat;
        target = Math.round(target); // 吸附到整拍
        this.hooks.mutateQuiet?.(pr => { moveFormationClip(pr, drag.seg.i, target); });
        this.render();
      }
      return;
    }
    if (drag.kind === 'clipL' || drag.kind === 'clipR') {
      this._fcLpCancel();
      const beat = Math.round(this.xToBeat(x)); // 吸附到整拍
      let changed = false;
      this.hooks.mutateQuiet?.(pr => {
        changed = resizeFormationClip(pr, drag.seg.i, drag.kind === 'clipL' ? 'L' : 'R', beat) || changed;
      });
      if (changed) drag.moved = true;
      this.render();
      return;
    }
  }
  _up(e) {
    // D1/D2：双指手势参与指抬起——只退出手势（_tp 仍在时吞掉语义，换指继续），不触发单指行为
    if (e && this._tpPts.has(e.pointerId)) {
      this._tpPts.delete(e.pointerId);
      if (this._tpPts.size < 2) this._tp = null;
      if (this._tp) return;
      // 手势已结束的残余指：单指状态机已在进入双指时中止（drag=null），落回下方通用清理
    }
    this._lpCancel(); // D2：抬起/取消一律作废长按计时（触发路径只有 _lpFire 自己）
    this._tagLpCancel(); // build-47：划分轨长按同口径（未满时长的抬起=单击/拖拽语义，不弹编辑器）
    this._fcLpCancel(); // build-70：队形 clip 长按同口径（未满时长的抬起=单击/拖拽语义，不弹菜单）
    if (this.drag && this.drag.kind === 'tag') {
      const { id, moved } = this.drag;
      this.drag = null;
      if (moved) this.hooks.commitEdit?.('移动标记'); // 预览已写入，提交恰一条历史
      else {
        // build-77-tagdel：单击旗点=tagHitAction('tag')='edit'——选中并打开既有改名/编辑
        // popover（原「单击跳转」让位防误删编辑动线；播放线定位走空白/尺规 scrub 既有入口）。
        // 'menu' 分支（长按/右键）才是删除入口；node 测试桩无 document 时编辑器自行空转。
        if (tagHitAction('tag') === 'edit') {
          const t = tagById(this.hooks.getProject(), id);
          if (t) {
            this.activeTag = id;
            this.openTagEditor(id);
          }
        }
      }
      this.render();
      return;
    }
    if (this.drag && this.drag.kind === 'tagRegion') {
      // 区域拖拽提交（build-49 F2）：moved=恰一条历史（移动/调界/换层都在同一次 mutateQuiet 预览后
      // 由 commit 收口）；未 moved=单击区域——仅选中（_down 已置 selSegId），不定位播放线、不弹菜单。
      const d0 = this.drag;
      this.drag = null;
      const hadLaneHover = this.dragHoverTagLane != null;
      this.dragHoverTagLane = null;
      if (d0.moved) this.hooks.commitEdit?.(d0.part === 'body' ? '移动标记' : '调整标记范围');
      if (d0.moved || hadLaneHover) this.render();
      return;
    }
    // build-70 M2：队形 clip 拖拽提交——moved=恰一条历史；未 moved=单击 clip（选中+播放线
    // 对齐 clip 开头已在 _down 即时生效，无需补写）。
    if (this.drag && (this.drag.kind === 'fcMove' || this.drag.kind === 'clipL' || this.drag.kind === 'clipR')) {
      const d0 = this.drag;
      this.drag = null;
      if (d0.moved) this.hooks.commitEdit?.(d0.kind === 'fcMove' ? '移动队形段' : '调整队形段时长');
      this.render();
      return;
    }
    // ---- v3 音频轨拖拽提交 ----
    const d = this.drag;
    if (d && (d.kind === 'clipMove' || d.kind === 'trimL' || d.kind === 'trimR' || d.kind === 'trimLB' || d.kind === 'trimRB')) {
      if (d.moved) this.hooks.commitEdit?.(d.kind.startsWith('trim') ? '修剪音频剪辑' : '移动音频剪辑');
      // 单击 clip 只选中、不再定位播放头（build-46 验收反馈三：定位语义与 clip 点击解耦——
      // 定位走 clip/tag 之外的空白区：尺规/lane 空隙/加轨条带/块轨空白，C12 仅保留 lane 空白路径）
      // 跨轨拖拽提交后重调度（任务裁定：结构变化后播放中需 reschedule；未播放时 reschedule 自身即空操作）
      if (d.moved && d.kind === 'clipMove' && d.trackChanged) this.hooks.audio?.ensureTransport?.().reschedule?.();
    } else if (d && (d.kind === 'fadeIn' || d.kind === 'fadeOut' || d.kind === 'xFade')) {
      if (d.moved) this.hooks.commitEdit?.('调整淡化');
    } else if (d && d.kind === 'gain') {
      if (d.moved) this.hooks.commitEdit?.('剪辑增益');
    } else if (d && d.kind === 'timeSel') {
      if (!d.moved) { // 空白单击：清选区+定位播放头（C12）
        this.timeSel = null;
        this.hooks.onTimeSelection?.(null);
        this.hooks.seekBeat(this.xToBeat(this._lastX ?? 0));
      }
    }
    this._lastX = null;
    // W3 顺序约束（DEFECT-W3-D1）：清 hover 与补绘必须相邻（先清零再 render），且 hadHover 时
    // 无条件补绘、moved 提交路径也不例外——commitEdit(store.commit) 只入历史不触发渲染（无 emit），
    // 松手前画布上最后一帧仍是拖移中带高亮的画面，跳过补绘则淡蓝残留驻留至下一次任意重渲染
    //（原注释「moved 时 commitEdit/render 已在上方路径触发」假设恰好反了）。
    if (this.dragHoverLane != null || this.dragHoverTagLane != null) {
      this.dragHoverLane = null;
      this.dragHoverTagLane = null;
      this.render();
    }
    this.drag = null;
  }
  // ---- v3 clip 原子操作（键盘/右键菜单入口；守卫：编辑锁 + 播放中先自动暂停） ----
  _guard(editableOnly = true) {
    const p = this.hooks.getProject();
    if (!p || !clipsOf(p).length) return false;
    if (editableOnly && this.hooks.canEdit?.() === false) {
      this.hooks.toast?.('编辑已关闭，无法修改（选择/预览可用）');
      return false;
    }
    return true;
  }
  _pauseIfPlaying() { this.hooks.pauseIfPlaying?.(); }
  playheadSec() {
    const p = this.hooks.getProject();
    const player = this.hooks.getPlayer?.();
    return p && player ? beatToSec(p, Math.max(0, player.beat || 0)) : 0;
  }
  // C6：播放头处分割（Ctrl/Cmd+K）。有选中切选中；无选中切所有跨播放头的 clip（Razor All）
  splitAtPlayhead() {
    if (!this._guard()) return;
    this._pauseIfPlaying();
    const t = this.playheadSec();
    this.hooks.mutateLabeled?.(pr => {
      const clips = pr.timeline.audioClips;
      const ids = this.clipSel.size ? [...this.clipSel] : clips.map(c => c.id);
      for (const id of ids) splitClipAt(clips, id, t);
    }, '分割音频剪辑');
    this.render();
  }
  // D2（build-44）：指定秒处分割单个 clip——长按菜单「在此处分割」/右键菜单落点入口。
  // 与剃刀路径（splitClipAt + mutateLabeled '分割音频剪辑'）同构；先预检落点合法性：
  // store.mutate 带 label 即入历史，空操作也会堆一条撤销——不合法改为 toast 提示、零写入。
  splitAtSec(clipId, sec) {
    const p = this.hooks.getProject();
    if (!p || !clipId) return false;
    const c = clipsOf(p).find(k => k.id === clipId);
    if (!c) return false;
    if (!(sec > c.timelineStartSec + MIN_CLIP_DUR && sec < clipEnd(c) - MIN_CLIP_DUR)) {
      this.hooks.toast?.('分割点需落在剪辑内部（两端各留最小长度）');
      return false;
    }
    if (this.hooks.canEdit?.() === false) {
      this.hooks.toast?.('编辑已关闭，无法修改（选择/预览可用）');
      return false;
    }
    this._pauseIfPlaying();
    this.hooks.mutateLabeled?.(pr => { splitClipAt(pr.timeline.audioClips, clipId, sec); }, '分割音频剪辑');
    this.render();
    return true;
  }
  // ---- build-88-waveui 需求 4：剃刀单发 API（timeline 半边；main.js 契约冻结）----
  // 对当前选中音频 clip（clipSel）在播放头时刻执行既有分割（复用 splitAtSec=剃刀/菜单同款
  // splitClipAt + mutateLabeled '分割音频剪辑' 路径）。方法本体不依赖 razorOn（既有剃刀指针
  // 模式代码保留；UI 层停用剃刀按钮语义由 main.js 承担）。
  // 返回 {ok:true, clips:2} 或 {ok:false, reason:'未选中 clip'|'播放线不在选中 clip 范围内'|…}。
  cutSelectedClipAtPlayhead() {
    const p = this.hooks.getProject();
    const c = p ? clipsOf(p).find(k => this.clipSel?.has(k.id)) : null; // 多选取 clip 序首个选中
    if (!c) return { ok: false, reason: '未选中 clip' };
    const t = this.playheadSec();
    if (!(t > c.timelineStartSec + MIN_CLIP_DUR && t < clipEnd(c) - MIN_CLIP_DUR)) {
      return { ok: false, reason: '播放线不在选中 clip 范围内' };
    }
    if (!this.splitAtSec(c.id, t)) return { ok: false, reason: '编辑已关闭' }; // splitAtSec 已 toast
    return { ok: true, clips: 2 };
  }
  // C10：删除/波纹删除选中（有时间选区时无选中=删除选区内 clip？——规格把选区作为
  // 「修剪到时间选区」的作用域；删除始终以选中 clip 为对象）
  deleteSelected(ripple = false) {
    if (!this._guard()) return;
    if (!this.clipSel.size) return;
    this._pauseIfPlaying();
    const ids = [...this.clipSel];
    this.hooks.mutateLabeled?.(pr => {
      const clips = pr.timeline.audioClips;
      if (ripple) rippleDeleteClips(clips, ids);
      const set = new Set(ids);
      pr.timeline.audioClips = clips.filter(c => !set.has(c.id));
    }, ripple ? '波纹删除音频剪辑' : '删除音频剪辑');
    this.clipSel = new Set();
    this.render();
  }
  // C9：静音/取消静音选中 clip（实时，可播放中操作）
  toggleMuteSelected() {
    if (!this._guard(false)) return;
    if (!this.clipSel.size) return;
    const p = this.hooks.getProject();
    const sel = clipsOf(p).filter(c => this.clipSel.has(c.id));
    const anyAudible = sel.some(c => !c.muted);
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) { if (anyAudible) c.muted = true; else delete c.muted; }
    }, anyAudible ? '静音音频剪辑' : '取消静音音频剪辑');
    this.render();
  }
  resetGainSelected() {
    if (!this._guard(false) || !this.clipSel.size) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) c.gain = 1;
    }, '增益重置');
    this.render();
  }
  // ---- Wave 变速/变调双旋钮（main.js 右键菜单滑杆/重置调用的三方法契约冻结）----
  // setSpeedSelected(speed)：钳 [0.25,4] 两位小数 → mutateLabeled('剪辑变速') 写选中 clip.speed
  //（1=删键不落键，多选=作用于全部选中，同 swatches 口径）→ needsProcess 时经 hooks.processClipAudio
  // 触发离线处理（processed 缓存归调度方；完成 requestDraw 补绘「处理中…」→ processed 波形）→
  // 既有 reschedule 链 live 生效（未播放=空操作）。不暂停播放（增益/淡化实时类同款）。
  _clampSpeed(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(Math.max(CLIP_SPEED_MIN, Math.min(CLIP_SPEED_MAX, v)) * 100) / 100;
  }
  // setPitchSelected(semi)：整数钳 [-12,12] → mutateLabeled('剪辑变调') 写 clip.pitchSemi
  //（0=删键不落键）→ 同上尾链。
  _clampSemi(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(Math.max(CLIP_SEMI_MIN, Math.min(CLIP_SEMI_MAX, v)));
  }
  setSpeedSelected(speed) {
    if (!this._guard(false) || !this.clipSel.size) return;
    const v = this._clampSpeed(speed);
    if (v == null) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) {
        if (v === 1) delete c.speed; // 1=删键（不落键）
        else c.speed = v;
      }
    }, '剪辑变速');
    this._afterSpeedPitchMutate();
  }
  setPitchSelected(semi) {
    if (!this._guard(false) || !this.clipSel.size) return;
    const v = this._clampSemi(semi);
    if (v == null) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) {
        if (v === 0) delete c.pitchSemi; // 0=删键（不落键）
        else c.pitchSemi = v;
      }
    }, '剪辑变调');
    this._afterSpeedPitchMutate();
  }
  // 变速/变调重置：speed/pitchSemi 双删键（一并清除，回直通播放），恰一条「变速变调重置」历史
  //（同增益重置口径）。
  resetSpeedPitchSelected() {
    if (!this._guard(false) || !this.clipSel.size) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) { delete c.speed; delete c.pitchSemi; }
    }, '变速变调重置');
    this._afterSpeedPitchMutate();
  }
  // 三入口共用尾链：needsProcess 选中触发离线处理（完成自动补绘）→ reschedule live 生效 → 补绘。
  // 处理触发零异常外泄：raw buffer 未就绪 / hooks.processClipAudio 未接线（归调度方）→ 静默
  // 跳过（呈「处理中…」+raw 回退波形，下次编辑或调度方链路再触发）。
  _afterSpeedPitchMutate() {
    this._ensureProcessedSelected();
    this.hooks.audio?.ensureTransport?.().reschedule?.();
    this.render();
  }
  // 对全部选中 clip 触发 processed 渲染：needsProcess 且 processed 未就绪时经
  // hooks.processClipAudio(raw, {speed, pitchSemi})（调度方接线到 js/clip-process.js 并缓存，
  // 供 hooks.resolveProcessedClip 后续命中）；按 memo 键去重（同参数在途只发一次），完成
  // requestDraw 恰一次。
  _ensureProcessedSelected() {
    const fire = this.hooks.processClipAudio;
    if (typeof fire !== 'function') return;
    const p = this.hooks.getProject();
    if (!p) return;
    for (const c of clipsOf(p)) {
      if (!this.clipSel.has(c.id) || !needsProcess(c)) continue;
      if (this._resolveProcessedClip(c)) continue; // 已就绪（同步命中）
      const mk = `${c.assetId}|${clipProcessKey(c)}`;
      if (this._procPend.has(mk)) continue;        // 同参数在途去重
      const raw = this._resolveClipBuffer(c.assetId);
      if (!raw || typeof raw.then === 'function') continue; // raw 未就绪（Promise 型不在本同步链）
      this._procPend.add(mk);
      Promise.resolve(fire(raw, { speed: clipSpeedOf(c), pitchSemi: clipSemiOf(c) }))
        .then(() => { this._procPend.delete(mk); this.requestDraw(); })
        .catch(() => { this._procPend.delete(mk); });
    }
  }
  // F6「淡化归零」（build-45）：选中 clip 的 fadeIn/fadeOut 长度与曲线全清零。auto 配对缘
  // 不直接抹字段——走引擎 resetClipFades（内部复用 prune 同款 clearAutoEdge 路径：双缘记录、
  // 兼容镜像、对端回指缘一并干净解绑），不绕过既有解除配对簿记。播放中不暂停（同淡化把手
  // 拖拽口径：淡化/增益实时类编辑不暂停）。
  resetFadesSelected() {
    if (!this._guard(false) || !this.clipSel.size) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const id of this.clipSel) resetClipFades(pr.timeline.audioClips, id);
    }, '淡化归零');
    this.render();
  }
  renameSelected(name) {
    if (!this._guard(false) || !this.clipSel.size) return false;
    const n = String(name || '').trim().slice(0, 80);
    if (!n) return false;
    const p = this.hooks.getProject();
    const first = clipsOf(p).find(c => this.clipSel.has(c.id));
    if (!first) return false;
    this.hooks.mutateLabeled?.(pr => {
      const c = pr.timeline.audioClips.find(k => k.id === first.id);
      if (c) c.name = n;
    }, '重命名音频剪辑');
    this.render();
    return true;
  }
  setSelectedColor(color) {
    if (!this._guard(false) || !this.clipSel.size) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) c.color = color;
    }, '剪辑颜色');
    this.render();
  }
  // 修剪到时间选区（右键菜单；作用域=选中 clip ∩ [start,end]）
  trimSelectedToTimeSel() {
    if (!this._guard()) return;
    if (!this.timeSel || !this.clipSel.size) { this.hooks.toast?.('先框出时间选区并选中 clip'); return; }
    this._pauseIfPlaying();
    const ids = [...this.clipSel];
    const { start, end } = this.timeSel;
    this.hooks.mutateLabeled?.(pr => {
      const dropped = trimClipsToRange(pr.timeline.audioClips, ids, start, end);
      if (dropped.length) pr.timeline.audioClips = pr.timeline.audioClips.filter(c => !dropped.includes(c.id));
    }, '修剪到时间选区');
    this.render();
  }
  // C3：←/→ 微移（plain=逐帧 10ms；Shift=按网格步进即整拍）。M3 T8：opts.step 显式步长——
  // Alt+←/→ 选中 clip 微移 0.1s（Alt 步进语义延伸到 clip；设计 T8 原文案 10ms，交付口径取 0.1s，
  // 与播放头 Alt 秒步进同数量级），两档既有缺省不受影响。
  nudgeSelected(deltaSec, { grid = false, step: stepSec = null } = {}) {
    if (!this._guard()) return;
    if (!this.clipSel.size) return;
    this._pauseIfPlaying();
    const p = this.hooks.getProject();
    const gridSec = grid ? spb(p) : 0.01;
    const magnitude = (stepSec != null && Number(stepSec) > 0) ? Number(stepSec) : gridSec;
    const step = (deltaSec >= 0 ? 1 : -1) * magnitude;
    const ids = [...this.clipSel];
    this.hooks.mutate(pr => {
      for (const id of ids) {
        const c = pr.timeline.audioClips.find(k => k.id === id);
        if (!c) continue;
        let ns = c.timelineStartSec + step;
        if (grid) ns = Math.round(ns / gridSec) * gridSec;
        c.timelineStartSec = r6(Math.max(0, ns));
      }
      applyAutoCrossfades(pr.timeline.audioClips, ids);
      for (const id of ids) pruneAutoCrossfades(pr.timeline.audioClips, id);
    }, null);
    this.hooks.commitEdit?.('微移音频剪辑');
    this.render();
  }
  clearClipSelection() {
    this.clipSel = new Set();
    this.timeSel = null;
    this.hooks.onTimeSelection?.(null);
    this.render();
  }
  // ---- 节奏划分轨区域级操作（build-49 区域模型；长按/右键菜单与索引「…」菜单入口） ----
  // 每个操作 mutateLabeled 恰一条历史；tags 不参与播放逻辑，无需暂停/编辑锁（同 tag 道既有口径）。
  // build-49：拆分/合并退役（区域模型下无意义）——splitSegAt/mergeSegWithNext 与模型函数一并删除。
  deleteSeg(tagId) {
    const p = this.hooks.getProject();
    if (!p || !tagId) return;
    this.hooks.mutateLabeled?.(pr => { removeSection(pr, tagId); }, '删除标记');
    if (this.selSegId === tagId) this.selSegId = null;
    this.render();
  }
  setSegColor(tagId, color) {
    const p = this.hooks.getProject();
    if (!p || !tagId) return;
    this.hooks.mutateLabeled?.(pr => { setSectionColor(pr, tagId, color); }, '标记颜色');
    this.render();
  }
  // 升/降一级（菜单入口）：delta<0=升一级（层号−1、更上层），delta>0=降一级。
  // 越界（level 0 再升 / 显式层数-1 再降，F4）不动（菜单项已按界裁剪，此处兜底）；
  // 换层后区域重贴目标层邻界（build-49 F1：fitTagRegionInLevel——保宽优先，无空间缩宽）。
  bumpSegLevel(tagId, delta) {
    const p = this.hooks.getProject();
    const t = p && tagId ? tagById(p, tagId) : null;
    if (!t) return;
    const maxLv = tagLevelCountOf(p) - 1; // F4：升降界随显式层数（顶层 0 无升、count-1 无降）
    const nv = tagLevelOf(t) + (delta < 0 ? -1 : 1);
    if (nv < 0 || nv > maxLv) return;
    this.hooks.mutateLabeled?.(pr => { setTagLevel(pr, tagId, nv); fitTagRegionInLevel(pr, tagId); }, '标记层级');
    this.render();
  }
  // 双 UI 模式切换（编舞⇄音乐）：只动呈示/命中面（块区隐藏、几何收口），不清任何编辑态——
  // clipSel/timeSel/缩放/播放头/tag 原样保留；DOM 侧（块时长栏 hidden、舞台收窄）由 main.js 接线。
  // 返回生效后的模式；播放中的切换禁止由 main.setUiMode 守卫（toast「暂停后可切换」）。
  setMode(v) {
    const nv = v === 'music' ? 'music' : 'stage';
    if (nv !== this.mode) {
      this.mode = nv;
      // D1/D2：触屏手势状态跨模式作废（长按剪切仍 music 专属；双指导航 build-52 F3 起
      // 两模式共用同一手势语言，跨模式仍作废重进防几何陈旧）
      this._lpCancel();
      this._tagLpCancel();     // build-47：划分轨长按同口径作废
      this._fcLpCancel();      // build-70：队形 clip 长按同口径作废
      this.closeTagPopover();  // build-47：编辑器浮层跨模式关闭（锚点几何随模式失效）
      this._endTp();
      try { localStorage.setItem('wuzhen:uiMode', nv); } catch {}
      // W3 分键：切模式即恢复该模式自己记的刻度（互不串；按钮呈示由 main.syncScaleToggle 刷新）
      try { this.rulerScale = resolveRulerScaleFor(typeof localStorage !== 'undefined' ? localStorage : null, nv); } catch {}
      this.render();
    }
    return this.mode;
  }
  // 尺规刻度切换（决策⑥）：'beat'⇄'sec'；W3 起写当前模式自己的键（wuzhen:rulerScale.<mode>）
  setRulerScale(v) {
    this.rulerScale = v === 'sec' ? 'sec' : 'beat';
    try { localStorage.setItem(rulerScaleKeyOf(this.mode), this.rulerScale); } catch {}
    this.render();
    return this.rulerScale;
  }
  toggleSnap() {
    this.snapOn = !this.snapOn;
    try { localStorage.setItem('wuzhen:audioSnap', this.snapOn ? '1' : '0'); } catch {}
    this.hooks.toast?.(`磁吸${this.snapOn ? '开' : '关'}（clip 缘/块边界/tag/播放头/选区/零交叉）`);
    this.render();
  }
  setRazor(v) {
    this.razor = v == null ? !this.razor : !!v;
    this.hooks.toast?.(this.razor ? '剃刀模式：点击 clip 分割（R/Esc 退出）' : '剃刀模式关闭');
    this.render();
    return this.razor;
  }
  // C12：双击 clip=选中并循环预览（范围循环至手动停止）
  previewSelectedClipAt(x, y, clips, touch = false) {
    const hit = this._audioHit(x, y, clips, touch);
    if (!hit) return false;
    this.clipSel = new Set([hit.clip.id]);
    this.hooks.previewClip?.(hit.clip);
    this.render();
    return true;
  }
  // 双击：区域=打开字段编辑器；音频轨=clip 循环预览（选中）或空白取消全选（C1/C12）。
  // × 删除后 400ms 内的双击忽略（双击 × 只删一次，不应原地加回——stage × 仍存续）。
  // build-49 音乐模式区域：双击区域=字段编辑器（名称/节奏/小节数）；双击层内空白=新建区域
  //（默认宽 16 拍，落点吸附小节线，同磁吸口径），确定才落数据（Esc/点外=取消零写入）。
  _dblclick(e) {
    const p = this.hooks.getProject();
    if (!p) return;
    if (performance.now() - (this._delAt || 0) < 400) return;
    const r = this.cv.getBoundingClientRect();
    // build-88 视口窗口：世界 x = 画布 x + scrollLeft（tag/区域命中与既有世界 px 命中链自洽）
    const x = e.clientX - r.left + (this.scroll?.scrollLeft || 0), y = e.clientY - r.top;
    const clips = clipsOf(p);
    if (clips.length && y >= this.audioTop() && y <= this.audioBottom(p)) {
      // W2（E-10 只读化）：编舞模式简单道双击不再触发 clip 循环预览/清选（呈示+seek 之外无剪辑交互）
      if (this.mode !== 'music') return;
      // 双击空白=取消全选；双击 clip=选中并循环预览
      if (!this.previewSelectedClipAt(x, y, clips, e.pointerType === 'touch')) this.clearClipSelection();
      return;
    }
    if (!this.inTagLane(y)) return;
    if (this.mode === 'music') {
      const level = this.tagLevelAtLane(p, this.tagLaneIndexAt(p, y));
      const hit = this.regionAt(x, level);
      if (hit) { this.openTagEditor(hit.id); return; }
      let b = Math.max(0, this.xToBeat(x));
      [b] = this.snapTagBeatToBar(b);
      this._openTagInput({ beat: Math.round(b * 100) / 100, level });
      return;
    }
    const hit = this.tagAt(x, this.stageLevelOf(p)); // F2：只命中呈示的最深层
    if (hit) this.openTagEditor(hit.tag.id);
    else this._openTagInput({ beat: Math.max(0, Math.round(this.xToBeat(x) * 100) / 100) });
  }
}
