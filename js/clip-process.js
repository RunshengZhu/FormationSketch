// clip 变速（保音高 TSM）+ 变调（半音）——DSP 管线与数据字段（本模块零静态依赖，node 可测）。
//
// 分层：
//   纯函数  processedLenOf / clipProcessKey / needsProcess —— 同步、零环境依赖，node --test 直接测；
//   浏览器  processClipAudio —— OfflineAudioContext + vendored signalsmith-stretch（AudioWorklet 形态）
//           离线渲染出变速/变调后的双声道样本；node 下不可跑（无 Web Audio），测试只覆盖纯函数。
//
// 消费契约（并行 Wave：audio-clips.js resolver / video-export.js mixdown 依赖，勿漂移签名）：
//   needsProcess(clip)            → 是否需要离线处理（speed≠1 或 pitchSemi≠0）；
//   clipProcessKey(clip)          → 处理参数指纹（缓存键前缀）；
//   processClipAudio(buffer, {speed, pitchSemi}, ?opts) → Promise<{channels:[L,R], sampleRate, duration}>。
//
// 数据字段（js/model.js sanitizeAudioClips 清洗）：clip.speed ∈ [0.25,4] 两位小数、
// clip.pitchSemi ∈ [-12,12] 整数；缺省=1/0 时不落键（读侧一律 clip.speed||1、clip.pitchSemi||0）。
// 与 clip.rate（滑动变速·磁带式·音高随速度）互补：speed/pitchSemi 是「保音高 TSM + 独立半音变调」，
// 引擎读侧叠加次序与消费方式归 audio-clips.js（Q）。

// ---------- 纯函数 ----------

// 处理后样本长度 = round(源样本数 / speed)（speed<1 拉长、>1 缩短）。speed 非法（非有限/≤0）
// 按 1 速原样返回（防御：清洗层已钳 [0.25,4]，此处只兜底直通调用）。
export function processedLenOf(srcSamples, speed) {
  const n = Math.round(Number(srcSamples) || 0);
  const s = Number(speed);
  if (!Number.isFinite(s) || s <= 0) return n;
  return Math.round(n / s);
}

// 处理参数指纹：s{speed*100}|p{semitones}（speed 两位小数×100 → 整数域；缺省 = s100|p0）。
// 纯字符串拼装（缓存键前缀），不做数值清洗——清洗归 model.sanitizeAudioClips。
export function clipProcessKey(clip) {
  const c = clip || {};
  return `s${(c.speed || 1) * 100}|p${c.pitchSemi || 0}`;
}

// 是否需要离线处理：speed≠1 或 pitchSemi≠0（缺省字段按 1/0 → 不处理，走直通播放）。
export function needsProcess(clip) {
  const c = clip || {};
  return (c.speed || 1) !== 1 || (c.pitchSemi || 0) !== 0;
}

// ---------- LRU 缓存（模块级，上限 8 条） ----------
// 键 = clipProcessKey(clip) + '#' + buffer 长度（processedCacheKey 统一拼装，Q/R 可复用）。
// 值 = processClipAudio 的结果对象（channels Float32Array 引用共享，不二次拷贝）。
// 注意：键不含资产 id——同长度+同参数的不同资产理论上会互撞（规格既定取舍）；资产卸载时
// 由消费方调 clearClipProcessCache() 兜底失效。
const PROCESS_CACHE_MAX = 8;
const processCache = new Map(); // Map 保持插入序 → 首键即最久未用
export function processedCacheKey(clip, srcLen) {
  return `${clipProcessKey(clip)}#${Number(srcLen) || 0}`;
}
// 查缓存并触碰（LRU：命中即移到最新）。未命中返回 undefined。
export function getProcessedCached(key) {
  if (!processCache.has(key)) return undefined;
  const v = processCache.get(key);
  processCache.delete(key);
  processCache.set(key, v);
  return v;
}
// 写缓存并淘汰（超上限逐出最久未用）。暴露供消费方在自管管线里回填（additive，契约外补充）。
export function putProcessedCached(key, result) {
  processCache.delete(key);
  processCache.set(key, result);
  while (processCache.size > PROCESS_CACHE_MAX) {
    processCache.delete(processCache.keys().next().value);
  }
}
export function clearClipProcessCache() {
  processCache.clear();
}

// ---------- 浏览器管线（薄壳） ----------
// vendored signalsmith-stretch 加载：单文件 bundle 里 vendor 已由打包器内联为
// FS.signalsmithStretch.SignalsmithStretch（零 fetch 直取）；dev ESM 下动态 import 懒加载
// （113KB wasm 模块不进首屏关键路径）。两种形态都缓存构造器，二次调用零开销。
let stretchCtor = null;
async function loadStretchCtor() {
  if (stretchCtor) return stretchCtor;
  const bundled = typeof window !== 'undefined' && window.FS && window.FS.signalsmithStretch && window.FS.signalsmithStretch.SignalsmithStretch;
  if (bundled) {
    stretchCtor = bundled;
    return stretchCtor;
  }
  const mod = await import('./signalsmith-stretch.js');
  stretchCtor = mod.SignalsmithStretch || mod.default;
  return stretchCtor;
}

// 离线处理一段解码音频：speed（0.25–4，保音高 TSM）+ pitchSemi（-12..12 半音）。
// 返回双声道定长结果，样本数恒为 processedLenOf(buffer.length, speed)。
// opts.cache（默认 true）：命中 LRU 直接返回；渲染成功后回填。传 false 强制重算且不落缓存。
// 限制：buffer.sampleRate 需在 OfflineAudioContext 合法域（8k–96kHz，设备解码产物均满足）。
export async function processClipAudio(buffer, { speed = 1, pitchSemi = 0 } = {}, opts = {}) {
  const srcLen = buffer.length;
  const key = processedCacheKey({ speed, pitchSemi }, srcLen);
  if (opts.cache !== false) {
    const hit = getProcessedCached(key);
    if (hit) return hit;
  }
  const outLen = Math.max(1, processedLenOf(srcLen, speed));
  const oac = new OfflineAudioContext(2, outLen, buffer.sampleRate);
  const Stretch = await loadStretchCtor();
  const node = await Stretch(oac);
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL; // 单声道源复制为双声道
  await node.addBuffers([chL, chR]);
  node.schedule({ active: true, rate: speed, semitones: pitchSemi });
  node.start(0);
  const rendered = await oac.startRendering();
  // 裁到 processedLenOf 样本（OAC 定长渲染本身即 outLen，slice 兜底并拷出独立数组防复用污染）
  const n = Math.min(outLen, rendered.length);
  const channels = [rendered.getChannelData(0).slice(0, n), rendered.getChannelData(1).slice(0, n)];
  const result = { channels, sampleRate: buffer.sampleRate, duration: outLen / buffer.sampleRate };
  if (opts.cache !== false) putProcessedCached(key, result);
  return result;
}
