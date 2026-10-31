// 导出视频（编排播放）——WebCodecs 离线渲染 + Mediabunny 封装引擎（build-80-mb 重写）
// 全程浏览器本地计算：逐帧 drawScene（编舞插值）+ 三轨条（队形/音乐/节奏标签）→ mediabunny
// CanvasSource（avc，码率即码率参数、keyFrameInterval=2s）编码；配乐纯 JS 逐样本离线混音
// （数学与引擎同源：clipGainAt/trackOfClip）→ mediabunny AudioBufferSource 编码；
// Mp4OutputFormat(fastStart:'in-memory') + BufferTarget 封装为 .mp4（moov 前置，进度条可拖）。
// 兼容面（build-80-mb）：视频需 VideoEncoder+VideoFrame；音频三级探测——原生 AAC → 原生
// Opus → vendored wasm 软编 AAC（@mediabunny/aac-encoder，FFmpeg AAC-LC，覆盖 iOS16 Safari/
// Firefox/无 AAC Chromium）。无实时录制回退路：探测不过即拒绝（UI 禁用+toast）。
// 背压纪律：逐帧 await videoSource.add(...)、逐块 await audioSource.add(...)——mediabunny 以
// add 返回的 Promise 传播编码器/写入器背压，内存不随时长无界堆积。
// 逐帧插值复用 model.posAt（播放路径同源纯函数，不复制数学）；strip 呈示规则与时间线同源
// （SEG_COLORS/tagColorMap/stageDeepestLevelOf 来自 timeline.js，淡化/增益包络来自 audio-clips.js）。
import {
  segmentsFromClips, beatToSec, secToBeat, posAt, musicDomainSec, clipsOf, trackOfClip, clone,
  tagEndBeatOf, tagLevelOf,
} from './model.js';
import {
  clipEnd, clipGainAt, fadeEnvAt, envAt, CLIP_DEFAULT_COLOR,
} from './audio-clips.js';
// clip 变速/变调消费门（语义契约归 clip-process.js · 并行交付）：needsProcess(clip)=speed≠1||semi≠0
import { needsProcess } from './clip-process.js';
import { drawScene, fitView } from './stage.js';
import { MusicTimeline } from './timeline.js';
import { safeName } from './export.js';
import * as mb from './mediabunny.js';
import { registerAacEncoder } from './aac-encoder.js';
// build-86-mp3out：LAME 软编 MP3（wasm 内联单文件，懒注册；import 行禁尾注——打包器正则锚定行尾）
import { registerMp3Encoder } from './mp3-encoder.js';

// ---------- 预设（三档；音频统一 AAC/Opus 80kbps 立体声） ----------
export const PRESETS = [
  { id: 'small', name: '小', width: 640, height: 360, fps: 15, bitrate: 450000, audioBitrate: 80000 },
  { id: 'standard', name: '标准', width: 960, height: 540, fps: 15, bitrate: 800000, audioBitrate: 80000 },
  { id: 'hd', name: '清晰', width: 1280, height: 720, fps: 15, bitrate: 1300000, audioBitrate: 80000 },
];
export const DEFAULT_PRESET_ID = 'standard'; // 默认「标准」
export function pickPreset(id) {
  const hit = PRESETS.find(p => p.id === id);
  return hit || PRESETS.find(p => p.id === DEFAULT_PRESET_ID);
}

// 能力门（同步轻判）：视频编码三件套收窄为 VideoEncoder+VideoFrame 必备——音频可由 vendored
// wasm 软编兜底，不再要求 AudioEncoder 齐备（build-80-mb 语义收窄；完整探测走异步
// probeExportCapabilities，本函数只做同步快判，供 UI 高频路径复用）。
export function videoExportSupported() {
  return typeof window !== 'undefined'
    && typeof window.VideoEncoder === 'function'
    && typeof window.VideoFrame === 'function';
}

// ---------- 能力探测（异步、无副作用；入口据此启用/禁用导出菜单项） ----------
// 三态探测：ok=true 时 audioCodec ∈ 'aac'|'opus'|'wasm-aac'——
//   'aac'/'opus'：原生 AudioEncoder.isConfigSupported 逐个探测（先 AAC 后 Opus）；
//   'wasm-aac'：原生皆缺且 vendored 软编 AAC 在场（registerAacEncoder 可注册）；
//   皆缺 → ok=false，reason 为面向用户的一句话（node 裸环境同此路）。
// 探测不注册、不实例化 wasm（软编只在 exportVideo 真正选它时才注册——wasm 懒启动纪律）。
const AUDIO_PROBE_CONFIG = { sampleRate: 48000, numberOfChannels: 2, bitrate: 80000 };
// build-85-audioonly：音频编码选路抽离（不问视频门）——aac→opus→wasm-aac；皆缺 null。
// 探测不注册、不实例化 wasm（软编只在真正选它时才注册——wasm 懒启动纪律）。
export async function pickAudioCodec() {
  if (typeof AudioEncoder === 'function') {
    for (const [codec, tag] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      try {
        const s = await AudioEncoder.isConfigSupported({ codec, ...AUDIO_PROBE_CONFIG });
        if (s?.supported) return tag;
      } catch { /* 探测失败等同不支持，继续下一候选 */ }
    }
  }
  if (typeof registerAacEncoder === 'function') return 'wasm-aac';
  return null;
}
export async function probeExportCapabilities() {
  // 视频门用 unqualified 全局探测（浏览器中与 window.* 等价；node 单测可经 globalThis 注入，
  // 与 videoExportSupported 的 window 判定语义一致——VideoEncoder+VideoFrame 必备）。
  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
    return { ok: false, reason: '当前浏览器不支持视频导出（需 Safari 16.4+/Chrome/Firefox）', audioCodec: null };
  }
  const audioCodec = await pickAudioCodec();
  if (audioCodec) return { ok: true, audioCodec };
  return { ok: false, reason: '当前浏览器缺少可用的音频编码器（AAC/Opus），无法导出带声音的视频', audioCodec: null };
}

// ---------- 文件名「项目名-YYYYMMDD.mp4」 ----------
export function videoFileName(project, now = new Date()) {
  const d = now instanceof Date ? now : new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${safeName(project?.meta?.title)}-${ymd}.mp4`;
}
// build-85-audioonly：「项目名-YYYYMMDD-audio.m4a」（-audio 后缀防与视频导出同名混淆）
export function audioFileName(project, now = new Date()) {
  return videoFileName(project, now).replace(/\.mp4$/, '-audio.m4a');
}

// ---------- 三轨条几何（纯函数，node 可测） ----------
// 下部 ~130px：队形段 46 / 音乐 40 / 节奏标签 24，上缘 4px、行距 4px（4+46+4+40+4+24+8=130）
export const STRIP_H = 130;
export function stripLayout(preset) {
  const w = Math.max(2, preset.width | 0), h = Math.max(2, preset.height | 0);
  const stripY = h - STRIP_H;
  const formationY = stripY + 4;
  const musicY = formationY + 46 + 4;
  const tagY = musicY + 40 + 4;
  return {
    width: w, height: h,
    stageW: w, stageH: stripY,       // 上部舞台（drawScene letterbox 自适应）
    stripY, stripH: STRIP_H,
    rows: {
      formation: { y: formationY, h: 46 },
      music: { y: musicY, h: 40 },
      tag: { y: tagY, h: 24 },
    },
  };
}
// 秒 → strip 像素 x（时间轴范围=音乐域，全宽铺满；越域钳 [0,width]；纯函数）
export function stripXAt(layout, domainSec, sec) {
  const T = Math.max(1e-6, Number(domainSec) || 0);
  const x = (Math.max(0, Number(sec) || 0) / T) * layout.width;
  return Math.min(layout.width, x);
}

// hex → rgba() 字符串（strip 呈示用；非法入参回退灰色）
function rgba(hex, a) {
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(String(hex || ''));
  if (!m) return `rgba(148,163,184,${a})`;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// ---------- strip 数据（纯函数，node 可测；几何+内容，渲染层只落笔） ----------
// 队形段（build-70 M3 换源：model.segmentsFromClips 同链）：clip=队形色实底块+队形名+时长秒
//（时间唯一标准：秒呈示，beatToSec 差值——不再出拍值估计）；相邻 clip 间的空隙=变换段
//（灰块，时长=空隙本身自动适应）。
export function formationBandData(project, layout, domainSec) {
  const { segments } = segmentsFromClips(project.formations);
  const out = [];
  for (let k = 0; k < segments.length; k++) {
    const s = segments[k];
    const f = project.formations[s.i];
    if (!f) continue;
    out.push({
      kind: 'hold', i: s.i,
      x0: stripXAt(layout, domainSec, beatToSec(project, s.start)),
      x1: stripXAt(layout, domainSec, beatToSec(project, s.end)),
      color: f.color || '#64748b',
      name: f.name || `队形 ${s.i + 1}`,
      label: `${(beatToSec(project, s.end) - beatToSec(project, s.start)).toFixed(1)}s`,
    });
    const nxt = segments[k + 1];
    if (nxt) {
      out.push({
        kind: 'travel', i: s.i,
        x0: stripXAt(layout, domainSec, beatToSec(project, s.end)),
        x1: stripXAt(layout, domainSec, beatToSec(project, nxt.start)),
        color: '#94a3b8', name: '', label: '',
      });
    }
  }
  return out;
}
// 音乐轨（model 层 clips + envAt 粗粒度采样）：clip 色块 + 振幅条（3px 步进）
export function musicBandData(project, layout, domainSec, envOf) {
  const out = [];
  for (const c of clipsOf(project)) {
    const x0 = stripXAt(layout, domainSec, c.timelineStartSec);
    const x1 = stripXAt(layout, domainSec, clipEnd(c));
    if (x1 <= 0 || x0 >= layout.width) continue;
    const color = c.color || CLIP_DEFAULT_COLOR;
    const gfBase = Math.min(1.6, c.gain ?? 1);
    const bars = [];
    const pps = layout.width / Math.max(1e-6, domainSec); // px per sec（strip 域）
    const env = envOf ? (envOf(c.assetId) || null) : null;
    for (let x = Math.ceil(Math.max(0, x0)); x < Math.min(layout.width, x1); x += 3) {
      const rel = (x + 1.5 - x0) / pps;                 // 列中心的 clip 相对时刻
      if (rel < 0 || rel > c.lengthSec) continue;
      const srcSec = c.srcStartSec + rel;
      const v = env ? envAt(env, srcSec) * gfBase * fadeEnvAt(c, rel) : 0.14 * gfBase * fadeEnvAt(c, rel);
      bars.push({ x, v });
    }
    out.push({ x0, x1, color, muted: !!c.muted, bars });
  }
  return out;
}
// 节奏标签轨（model 层 tag 区域块；呈示规则与编舞模式一致=最深层，色板/取色同源 timeline.js）
export function tagBandData(project, layout, domainSec) {
  const tags = project?.timeline?.tags || [];
  if (!tags.length) return [];
  const deepest = MusicTimeline.stageDeepestLevelOf(tags);
  const colorMap = MusicTimeline.tagColorMap(project);
  return tags
    .filter(t => tagLevelOf(t) === deepest)
    .map(t => ({
      x0: stripXAt(layout, domainSec, beatToSec(project, t.beat)),
      x1: stripXAt(layout, domainSec, beatToSec(project, tagEndBeatOf(t))),
      color: colorMap.get(t.id) || '#38bdf8',
      name: t.name || '',
    }));
}

// ---------- 帧渲染（逐帧落笔；文本 Math.round 整数像素对齐，块区/舞者 1px 描边由 drawScene/此处承担） ----------
export function renderExportFrame(ctx, layout, { project, positions, merges, theme, sec, domainSec, bands }) {
  const dark = theme !== 'light';
  // 整幅底
  ctx.fillStyle = dark ? '#0b1220' : '#dfe6ee';
  ctx.fillRect(0, 0, layout.width, layout.height);
  // 上部舞台：drawScene 等比 letterbox（fitView）；build-63-stageview2 F3：fit 包络同链
  // 传舞者位置——舞者在观众区/后台深处时导出画面同样包含不裁切（与编辑器视野同口径）
  drawScene(ctx, { x: 0, y: 0, w: layout.stageW, h: layout.stageH }, project, positions, {
    view: fitView(layout.stageW, layout.stageH, project.stage, 16, positions),
    merges: merges || [],
    theme,
    pad: 16,
  });
  drawStrip(ctx, layout, { project, sec, domainSec, bands });
}

function drawStrip(ctx, layout, { sec, domainSec, bands }) {
  const W = layout.width;
  ctx.save();
  // 行底（半透明叠于深底上，一次合成、逐帧确定）
  for (const key of ['formation', 'music', 'tag']) {
    const r = layout.rows[key];
    ctx.fillStyle = 'rgba(148,163,184,.05)';
    ctx.fillRect(0, r.y, W, r.h);
    ctx.strokeStyle = 'rgba(148,163,184,.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, r.y + r.h + 0.5); ctx.lineTo(W, r.y + r.h + 0.5);
    ctx.stroke();
  }
  // 队形段行
  const fr = layout.rows.formation;
  ctx.textBaseline = 'middle';
  for (const b of bands.formations) {
    const x0 = Math.round(b.x0), x1 = Math.round(b.x1);
    const w = Math.max(1, x1 - x0);
    if (x1 <= 0 || x0 >= W) continue;
    if (b.kind === 'hold') {
      ctx.fillStyle = b.color;               // 纯色底（高对比文字）
      ctx.fillRect(x0, fr.y, w, fr.h);
      ctx.strokeStyle = 'rgba(15,23,42,.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, fr.y + 0.5, w - 1, fr.h - 1);
      const label = b.label;
      if (w > 30) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, fr.y, w, fr.h); ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(b.name, Math.round(x0 + 4), Math.round(fr.y + 12));
        ctx.font = '9px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(label, Math.round(x0 + 4), Math.round(fr.y + fr.h - 11));
        ctx.restore();
      }
    } else {
      ctx.fillStyle = 'rgba(148,163,184,.25)';
      ctx.fillRect(x0, fr.y, w, fr.h);
      ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, fr.y + 0.5, w - 1, fr.h - 1);
    }
  }
  // 音乐轨行：clip 色块 + 粗粒度波形振幅条
  const mr = layout.rows.music;
  const mid = mr.y + mr.h / 2;
  for (const c of bands.music) {
    const x0 = Math.round(Math.max(0, c.x0)), x1 = Math.round(Math.min(W, c.x1));
    const w = Math.max(1, x1 - x0);
    if (x1 <= 0 || x0 >= W) continue;
    ctx.fillStyle = rgba(c.color, c.muted ? .06 : .16);
    ctx.fillRect(x0, mr.y + 2, w, mr.h - 4);
    const amp = mr.h / 2 - 5;
    ctx.fillStyle = rgba(c.color, c.muted ? .25 : .62);
    for (const bar of c.bars) {
      const a = Math.max(1, bar.v * amp);
      ctx.fillRect(Math.round(bar.x), Math.round(mid - a), 2, Math.round(a * 2));
    }
    ctx.strokeStyle = rgba(c.color, c.muted ? .35 : .8); ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, mr.y + 2.5, w - 1, mr.h - 5);
  }
  // 节奏标签行：区域块颜色+名称（最深层）
  const tr = layout.rows.tag;
  for (const t of bands.tags) {
    const x0 = Math.round(t.x0), x1 = Math.round(t.x1);
    const w = Math.max(1, x1 - x0);
    if (x1 <= 0 || x0 >= W) continue;
    ctx.fillStyle = t.color;
    ctx.fillRect(x0, tr.y, w, tr.h);
    ctx.strokeStyle = 'rgba(15,23,42,.55)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, tr.y + 0.5, w - 1, tr.h - 1);
    if (w > 26 && t.name) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, tr.y, w, tr.h); ctx.clip();
      ctx.fillStyle = '#0b1220';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(t.name, Math.round(x0 + 4), Math.round(tr.y + tr.h / 2 + 1));
      ctx.restore();
    }
  }
  // 实时推进播放线（strip 域，顶部三角+竖线，与时间线 drawPlayhead 同色）
  const x = Math.max(1, Math.min(W - 1, Math.round(stripXAt(layout, domainSec, sec))));
  ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, layout.stripY); ctx.lineTo(x, layout.stripY + layout.stripH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, layout.stripY); ctx.lineTo(x + 5, layout.stripY); ctx.lineTo(x, layout.stripY + 8);
  ctx.closePath();
  ctx.fillStyle = '#f43f5e'; ctx.fill();
  ctx.restore();
}

// ---------- 离线混音（纯 JS 逐样本；数学与引擎同源：clipGainAt×trackGain，node 可测） ----------
// 混音排布计划：每个可发声 clip → [起止样本 / 源入点 / 轨增益]；静音 clip/静音轨跳过、越域钳制
export function mixPlan(project, { domainSec, rate = 48000 } = {}) {
  const entries = [];
  for (const clip of clipsOf(project)) {
    if (clip.muted) continue;
    const track = trackOfClip(project, clip);
    if (!track || track.muted) continue;
    const startSec = Math.max(0, clip.timelineStartSec);
    const endSec = Math.min(domainSec, clipEnd(clip));
    if (!(endSec - startSec > 1e-6)) continue;
    entries.push({
      clip,
      trackGain: Math.max(0, Math.min(2, track.gain ?? 1)),
      startSample: Math.round(startSec * rate),
      endSample: Math.round(endSec * rate),
      srcStartSec: clip.srcStartSec + (startSec - clip.timelineStartSec), // 内容锚定（左缘出域时源同步前进）
    });
  }
  return entries;
}

// ---------- 音频预检（导出纯函数，node 可测） ----------
// 混音前对 plan 涉及的全部唯一资产逐个异步取 buffer（resolveAsync 可返 Promise 或同步值）：
//   resolvedCount=成功解析的唯一资产数；missingIds=不可解析的资产 id（保序、去重）。
// 全缺失 → 调用方抛错拒导（宁失败也不产出无声片）；部分缺失 → 静音缺失片段续导并注明。
// 背景：iPad Safari 资产导入时 decodeAudioData 偶发失败 → asset.buffer=null，旧路径静默跳过
// 产出「成功」的无声视频——预检闸门 + ensureAssetBuffer 重解码兜底双保险。
export async function audioPreflight(planEntries, resolveAsync) {
  const ids = [];
  const seen = new Set();
  for (const e of (planEntries || [])) {
    const id = e?.clip?.assetId;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const missingIds = [];
  let resolvedCount = 0;
  for (const id of ids) {
    let buf = null;
    try { buf = (await resolveAsync(id)) || null; } catch { buf = null; } // 取Buffer抛错=缺失（不冒泡）
    if (buf) resolvedCount++;
    else missingIds.push(id);
  }
  return { resolvedCount, missingIds };
}
// 单 clip 离线混入（累加到 out.L/out.R）：线性插值重采样 + 增益（同引擎 clipGainAt 口径）。
// 滑动变速（varispeed）：源读取位 = (srcStartSec + rel×(clip.rate||1))×srcRate——slot 域时长
// 不变，slot 内按 clip.rate 消费更多/更少源内容（线性插值重采样即磁带式变速，音高随速度变化；
// 源提前耗尽 → 读取位越 srcLen 自然静音，与引擎「磁带放完」语义一致）。exportAudio 共用本函数。
// processed 消费（clip.speed/pitchSemi）：entry.bufferOverride 在场（调用方经 resolveProcessed+
// needsProcess 预填的 TSM 产物，时长=源/speed）→ 源通道换 processed 且 1:1 消费——源读取位=
// (srcStartSec/speed + rel)×srcRate，不乘 clip.rate（playbackRate 恒 1 的离线等价）；无
// override（含无 speed/semi 的 clip）→ 既有 raw+rate 数学原样。override 兼容两种形态：
// {channels:[L,R], sampleRate, duration}（processClipAudio 契约）与 AudioBuffer 同构
//（getChannelData+numberOfChannels）。不破坏既有签名。
export function mixClipInto(out, entry, buffer, { rate = 48000 } = {}) {
  const ov = entry.bufferOverride || null;
  const srcBuf = ov || buffer;
  const srcRate = srcBuf.sampleRate || 44100;
  const chN = Math.max(1, (ov && ov.channels ? ov.channels.length : srcBuf.numberOfChannels) || 1);
  const chData = [];
  for (let ch = 0; ch < Math.min(2, chN); ch++) {
    chData.push(ov && ov.channels ? ov.channels[ch] : srcBuf.getChannelData(ch));
  }
  const srcLen = chData[0].length;
  const clip = entry.clip;
  const clipRate = ov ? 1 : (clip.rate || 1);
  const srcBase = ov ? entry.srcStartSec / (clip.speed || 1) : entry.srcStartSec; // processed 域=源域÷speed
  const { startSample, endSample, trackGain } = entry;
  const L = out.L, R = out.R;
  for (let n = startSample; n < endSample; n++) {
    const rel = n / rate - clip.timelineStartSec;        // clip 相对时刻（增益域）
    const gain = trackGain * clipGainAt(clip, rel);
    if (gain === 0) continue;
    const pos = (srcBase + rel * clipRate) * srcRate;    // 源采样位（线性插值=变速重采样）
    const i0 = Math.floor(pos);
    if (pos < 0 || i0 >= srcLen) continue;
    const i1 = Math.min(srcLen - 1, i0 + 1);             // 尾样本钳制（插值仍取真值）
    const frac = pos - i0;
    const v0 = chData[0][i0] + (chData[0][i1] - chData[0][i0]) * frac;
    const v1 = chData.length > 1
      ? chData[1][i0] + (chData[1][i1] - chData[1][i0]) * frac
      : v0;                                              // 单声道源 → 两声道同值
    L[n] += v0 * gain;
    R[n] += v1 * gain;
  }
}

// ---------- 逐帧位置（播放路径同源）：复用 model.posAt 既有插值，不复制数学 ----------
function positionsAtBeat(project, beat) {
  const pr = posAt(project, beat);
  const fi = pr.seg ? pr.seg.i : 0;
  return { positions: pr.positions, merges: project.formations[fi]?.merges || [], fi };
}

function cancelledError() { const e = new Error('已取消导出'); e.cancelled = true; return e; }

// ---------- 入口：exportVideo ----------
// opts = { project, preset, theme, resolveBuffer(assetId)→AudioBuffer|Promise<AudioBuffer>|null,
//          resolveProcessed(clip)→processed|Promise|null, envOf(assetId)→env|null,
//          onProgress({phase, ratio}), isCancelled()→bool }
// 返回 { blob, mime:'video/mp4', ext:'mp4', audioCodec:'aac'|'opus'|'wasm-aac', videoCodec:'avc',
//        frames, durationSec, bytes, note, audioSilent }
//（videoCodec=mediabunny 实际命中的编码名；audioSilent=全部 clip 被静音/跳过，此时无音轨；
// 音频资产全缺失则直接抛错不出无声片）
// onProgress 三相位、ratio 恒为全局 0..1：'render'（渲染+视频编码 0→0.85）、
// 'audio'（离线混音+音频编码 0.85→0.95）、'mux'（封装 0.95→1）。
export async function exportVideo({ project, preset, theme = 'dark', resolveBuffer = () => null, resolveProcessed = null, envOf = () => null, onProgress = () => {}, isCancelled = () => false } = {}) {
  const caps = await probeExportCapabilities();
  if (!caps.ok) throw new Error(caps.reason);
  if (!project) throw new Error('无项目');
  const p = clone(project);              // 快照：导出期间编辑/播放不串帧
  const P = pickPreset(preset);
  const domainSec = musicDomainSec(p);
  const layout = stripLayout(P);
  const totalFrames = Math.max(1, Math.ceil(domainSec * P.fps));
  const rate = 48000;

  // strip 带数据一次性预算（快照内不变）
  const bands = {
    formations: formationBandData(p, layout, domainSec),
    music: musicBandData(p, layout, domainSec, envOf),
    tags: tagBandData(p, layout, domainSec),
  };

  // —— 音频排布与预检（先于渲染：资产全缺失/编码器缺失时快速失败，不白烧一段渲染） ——
  const plan = mixPlan(p, { domainSec, rate });
  const hasAudio = plan.length > 0;
  let missingClipN = 0;
  if (hasAudio) {
    // plan 非空且全部资产不可解析 → 抛错拒导（宁失败也不产出无声片）；
    // 部分缺失 → 继续导出（缺失 clip 静音），完成弹窗注明。
    const pre = await audioPreflight(plan, resolveBuffer);
    if (pre.resolvedCount === 0) {
      throw new Error('音频素材未能解码，无法导出带声音的视频——请重新导入音乐后重试');
    }
    const missingSet = new Set(pre.missingIds);
    missingClipN = pre.missingIds.length
      ? plan.filter(e => missingSet.has(e.clip.assetId)).length
      : 0;
  }
  // wasm 软编兜底：仅在原生 AAC/Opus 皆缺时注册（mediabunny 自定义编码器优先于原生——
  // 提前注册会把 Safari 等原生 AAC 平台也拖进 wasm 慢路，违背性能优先）。
  if (hasAudio && caps.audioCodec === 'wasm-aac') registerAacEncoder();

  // —— mediabunny 输出管线（MP4 + 内存快起 + BufferTarget） ——
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) throw new Error('导出视频需要浏览器环境');
  canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new mb.BufferTarget(),
  });
  // 视频源：avc + 码率参数 + 2s 关键帧间隔（P.fps 帧率经 track 元数据透出给封装器）
  const videoSource = new mb.CanvasSource(canvas, {
    codec: 'avc',
    bitrate: P.bitrate,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: P.fps });
  // 音频源：codec 按探测结果（'wasm-aac' 时注册后走 mediabunny 'aac' 名 → 软编）；无声导出不出音轨
  const audioSource = hasAudio
    ? new mb.AudioBufferSource({ codec: caps.audioCodec === 'opus' ? 'opus' : 'aac', bitrate: P.audioBitrate })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const frameSec = 1 / P.fps;
  try {
    await output.start();

    // —— 相位①：逐帧渲染 + 视频编码（0 → 0.85）——
    // 背压：await add()——输出管线过载时该 Promise 挂起，内存不无界堆积
    for (let f = 0; f < totalFrames; f++) {
      if (isCancelled()) throw cancelledError();
      const sec = f * frameSec;
      const { positions, merges } = positionsAtBeat(p, secToBeat(p, sec));
      renderExportFrame(ctx, layout, { project: p, positions, merges, theme, sec, domainSec, bands });
      await videoSource.add(sec, frameSec);
      if (f % 5 === 0 || f === totalFrames - 1) onProgress({ phase: 'render', ratio: (f + 1) / totalFrames * 0.85 });
    }
    videoSource.close(); // 早关：封装器知悉视频轨已尽，利于缓冲规划

    // —— 相位②：离线混音 + 音频编码（0.85 → 0.95）——
    if (hasAudio) {
      const totalSamples = Math.ceil(domainSec * rate);
      const out = { L: new Float32Array(totalSamples), R: new Float32Array(totalSamples) };
      for (let k = 0; k < plan.length; k++) {
        if (isCancelled()) throw cancelledError();
        const buf = await resolveBuffer(plan[k].clip.assetId); // 契约：可返 Promise（同步值保持兼容）
        if (!buf) continue; // 资产 buffer 缺失（解码失败/被驱逐）：该 clip 静音跳过
        // processed 预填（clip.speed/pitchSemi）：resolveProcessed 在场且 needsProcess 才换源；
        // 缺席/失败/返 null → 该 clip 落回 raw 数学（速度/变调不消费，静默降级）
        if (resolveProcessed && !plan[k].bufferOverride && needsProcess(plan[k].clip)) {
          try { plan[k].bufferOverride = (await resolveProcessed(plan[k].clip)) || null; } catch { plan[k].bufferOverride = null; }
        }
        mixClipInto(out, plan[k], buf, { rate });
        onProgress({ phase: 'audio', ratio: 0.85 + (k + 1) / Math.max(1, plan.length) * 0.02 });
      }
      // 叠轨和值钳 ±1（防过载削波失真；原地单遍，随后分块直拷进 AudioBuffer）
      for (let i = 0; i < totalSamples; i++) {
        out.L[i] = Math.max(-1, Math.min(1, out.L[i]));
        out.R[i] = Math.max(-1, Math.min(1, out.R[i]));
      }
      // 分块喂给 AudioBufferSource（1s/块）：逐块 await add() 背压 + 编码进度可见
      const chunkLen = rate; // 1 秒
      const nChunks = Math.max(1, Math.ceil(totalSamples / chunkLen));
      for (let i = 0; i < nChunks; i++) {
        if (isCancelled()) throw cancelledError();
        const start = i * chunkLen;
        const n = Math.min(chunkLen, totalSamples - start);
        const chunk = new AudioBuffer({ length: n, sampleRate: rate, numberOfChannels: 2 });
        chunk.copyToChannel(out.L.subarray(start, start + n), 0);
        chunk.copyToChannel(out.R.subarray(start, start + n), 1);
        await audioSource.add(chunk);
        onProgress({ phase: 'audio', ratio: 0.87 + (i + 1) / nChunks * 0.08 });
      }
      audioSource.close();
    } else {
      onProgress({ phase: 'audio', ratio: 0.95 }); // 无声导出直过音频相位（ratio 恒单调）
    }

    // —— 相位③：封装（0.95 → 1）——
    await output.finalize();
    onProgress({ phase: 'mux', ratio: 1 });
  } catch (err) {
    // 取消/异常：终止管线释放编码器与写入器（已终态则忽略）
    try { if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel(); } catch { /* 尽力清理 */ }
    throw err;
  }

  const buffer = output.target.buffer;
  if (!buffer || !buffer.byteLength) throw new Error('视频封装无输出（编码器异常）');
  let note = caps.audioCodec === 'opus'
    ? '当前浏览器音频编码回退为 Opus（Chrome 产物 iOS 相册可能不认）'
    : ''; // 'wasm-aac' 产物即真 AAC（兼容等同原生），不提示
  if (missingClipN > 0) note += (note ? '；' : '') + `${missingClipN} 个音频片段解码失败已静音`;
  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    mime: 'video/mp4',
    ext: 'mp4',
    videoCodec: 'avc',          // mediabunny 实际命中的视频编码（avc→avc1 High 轮廓自动定级）
    audioCodec: caps.audioCodec,
    frames: totalFrames,
    durationSec: domainSec,
    bytes: buffer.byteLength,
    audioSilent: !hasAudio,     // 全部 clip 被静音/跳过（资产全缺失路径已在预检抛错）
    note,
  };
}

// ---------- 仅导出音频（build-85-audioonly）：离线混音 → Mediabunny 音频轨 → M4A ----------
// 复用视频路同源混音（mixPlan+mixClipInto）与编码选路（pickAudioCodec：aac→opus→wasm-aac，
// wasm 懒注册）；无视频轨。format='m4a'（默认）→ audio/mp4 容器；format='mp3' → LAME 软编 audio/mpeg。
// opts = { project, resolveBuffer(assetId)→AudioBuffer|Promise|null, resolveProcessed(clip)→
//          processed|Promise|null, onProgress({phase,ratio}), isCancelled()→bool }；
// 相位：'mix' 混音 0→0.4、'encode' 编码 0.4→0.95、'mux' 0.95→1。
// 返回 { blob, mime, ext:'m4a'|'mp3', audioCodec, durationSec, bytes, note }。
// build-87：实测裁尾（纯函数，node 可测）——从尾向前找首个 |样本|>eps 的位置，
// 返回 截断长度 = 该位置 +1 + padSec 余量（钳内容长内）；全静音返回 0（调用方报错）。
export function tailFitSamples(L, R, rate, { eps = 1e-4, padSec = 0.2 } = {}) {
  const n = Math.min(L.length, R.length);
  let last = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(L[i]) > eps || Math.abs(R[i]) > eps) { last = i; break; }
  }
  if (last < 0) return 0;
  const pad = Math.round((Number(padSec) || 0) * (Number(rate) || 48000));
  return Math.min(n, last + 1 + pad);
}
export async function exportAudio({ project, format = 'm4a', resolveBuffer = () => null, resolveProcessed = null, onProgress = () => {}, isCancelled = () => false } = {}) {
  if (!project) throw new Error('无项目');
  const wantMp3 = format === 'mp3'; // build-86-mp3out：MP3 走 LAME 软编 + Mp3OutputFormat
  const p = clone(project);
  const domainSec = musicDomainSec(p);
  if (!(domainSec > 0)) throw new Error('时间轴为空，没有可导出的音频');
  const rate = 48000;
  // build-87：混音总长自动适配真实音频内容——上界 = 可发声 clip 的最晚结束点
  //（plan 已剔除静音 clip/静音轨/越域；编辑拖长的队形域/资产全长不再带入静音尾巴）。
  // 混完再按实测最后非零样本裁尾（tailFitSamples：应对 clip 内源提前耗尽/淡出段）。
  const plan = mixPlan(p, { domainSec, rate });
  const contentUB = plan.reduce((m, e) => Math.max(m, e.endSample), 0);
  if (!(contentUB > 0)) throw new Error('时间轴上没有可导出的音频内容（无音频 clip 或全部静音）');
  const totalSamples = Math.min(Math.ceil(domainSec * rate), contentUB);
  const out = { L: new Float32Array(totalSamples), R: new Float32Array(totalSamples) };
  let resolved = 0;
  for (let k = 0; k < plan.length; k++) {
    if (isCancelled()) throw cancelledError();
    const buf = await resolveBuffer(plan[k].clip.assetId); // Promise/同步双返回
    if (!buf) continue; // 缺失 clip 静音跳过（同 exportVideo 口径）
    // processed 预填（clip.speed/pitchSemi）：同 exportVideo 门控；无 override 落回 raw 数学
    if (resolveProcessed && !plan[k].bufferOverride && needsProcess(plan[k].clip)) {
      try { plan[k].bufferOverride = (await resolveProcessed(plan[k].clip)) || null; } catch { plan[k].bufferOverride = null; }
    }
    mixClipInto(out, plan[k], buf, { rate });
    resolved++;
    onProgress({ phase: 'mix', ratio: (k + 1) / Math.max(1, plan.length) * 0.4 });
  }
  if (plan.length && !resolved) throw new Error('音频素材未能解码，无法导出音频——请重新导入音乐后重试');
  // build-87：实测裁尾——最后非零样本 + 0.2s 余量（clip 内源提前耗尽/淡出到零的段不进产物）
  const fit = tailFitSamples(out.L, out.R, rate, { eps: 1e-4, padSec: 0.2 });
  if (!fit) throw new Error('混音结果为纯静音——请检查音频 clip 的静音/增益设置');

  // —— 编码选路与懒注册（同 exportVideo 纪律）——
  // mp3：LAME 软编注册即生效（registerMp3Encoder 幂等），无浏览器原生 mp3 编码器可探
  let codec;
  if (wantMp3) {
    codec = 'mp3';
    registerMp3Encoder();
  } else {
    codec = await pickAudioCodec();
    if (!codec) throw new Error('当前浏览器缺少可用的音频编码器（AAC/Opus），无法导出音频');
    if (codec === 'wasm-aac') registerAacEncoder();
  }

  // —— Float32 L/R → AudioBuffer（OfflineAudioContext 仅借 createBuffer，零开销） ——
  const OAC = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
    : (typeof window !== 'undefined' ? window.OfflineAudioContext : null);
  if (!OAC) throw new Error('当前环境不支持 Web Audio，无法导出音频');
  const mixBuffer = new OAC(2, Math.max(1, fit), rate).createBuffer(2, Math.max(1, fit), rate);
  mixBuffer.getChannelData(0).set(out.L.subarray(0, fit));
  mixBuffer.getChannelData(1).set(out.R.subarray(0, fit));

  // —— Mediabunny 纯音频轨 M4A ——
  const output = new mb.Output({
    format: wantMp3 ? new mb.Mp3OutputFormat() : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new mb.BufferTarget(),
  });
  const src = new mb.AudioBufferSource({
    codec: wantMp3 ? 'mp3' : (codec === 'opus' ? 'opus' : 'aac'),
    bitrate: 192000, // 纯音频给足码率
  });
  output.addAudioTrack(src);
  await output.start();
  onProgress({ phase: 'encode', ratio: 0.4 });
  // 1s/块喂入（逐块 await add() 背压；音频编码远快于视频，块进即可见进度）
  const CHUNK = rate;
  for (let start = 0; start < fit; start += CHUNK) {
    if (isCancelled()) { try { await output.cancel(); } catch {} throw cancelledError(); }
    const n = Math.min(CHUNK, fit - start);
    const sliceBuf = new OAC(2, n, rate).createBuffer(2, n, rate);
    sliceBuf.getChannelData(0).set(out.L.subarray(start, start + n));
    sliceBuf.getChannelData(1).set(out.R.subarray(start, start + n));
    await src.add(sliceBuf);
    onProgress({ phase: 'encode', ratio: 0.4 + ((start + n) / fit) * 0.55 });
  }
  await src.close();
  onProgress({ phase: 'mux', ratio: 0.95 });
  await output.finalize();
  const bytes = output.target.buffer;
  const blob = new Blob([bytes], { type: wantMp3 ? 'audio/mpeg' : 'audio/mp4' });
  onProgress({ phase: 'mux', ratio: 1 });
  return {
    blob,
    mime: wantMp3 ? 'audio/mpeg' : 'audio/mp4',
    ext: wantMp3 ? 'mp3' : 'm4a',
    audioCodec: wantMp3 ? 'mp3' : (codec === 'wasm-aac' ? 'aac' : codec), // wasm-aac 产物即真 AAC
    durationSec: fit / rate,
    bytes: blob.size,
    note: wantMp3 ? '' : (codec === 'opus' ? '当前浏览器音频编码为 Opus（M4A 容器；部分播放器/iOS 相册可能不认，建议通用场景用支持 AAC 的浏览器）' : ''),
  };
}
