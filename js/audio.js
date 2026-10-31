// 音频：媒体资产库（v3 多资产）、文件加载、波形峰值、播放控制、节拍器点击声
// v3（exp/audition-lite）：AudioController 升级为「会话资产库」——assets: Map(id→资产)，
// 活动资产（配乐）沿用 el/<audio> 旧通道（试听/旧播放路径零改动）；clip 播放走
// ClipTransport（audio-clips.js，WebAudio BufferSource 调度），buffer 解码失败时自动
// 回退 el 旧通道（降级可用）。
import { ClipTransport, computeWaveEnvelope } from './audio-clips.js';

export class AudioController {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.ctx = null;
    this.peaks = null;        // 活动资产波形（Float32Array，值 0..1，旧 drawWave 用）
    this.resolveProcessed = null; // build-92-stretch：(clip)→processed AudioBuffer|Promise|null（main 接线）
    this.duration = 0;
    this.url = null;
    this.name = '';
    this.ready = false;
    this.blob = null;         // 活动资产源 Blob：下载版（file://→localStorage）不落盘，
                              // 「导出 ▾」含音乐需要从这里兜底取（DEFECT-R26-2）
    // ---- v3 媒体资产库 ----
    this.assets = new Map();  // id → {id,name,durationSec,size,blob,buffer,peaks,env}
    this.activeId = null;
    this.transport = null;    // ClipTransport（懒建）
  }
  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  get activeAsset() { return this.activeId != null ? (this.assets.get(this.activeId) || null) : null; }
  // 活动资产已解码出 AudioBuffer → clip 通道可用；false 时播放回退 el 旧通道
  get bufferReady() { return !!this.activeAsset?.buffer; }

  // 导入一个媒体资产：解码（AudioBuffer + 波形包络一次性计算）；失败仍登记元数据（buffer=null，
  // 只能作元数据展示，播放回退）。返回资产对象。
  async addAsset(blob, name = '', id = null) {
    const asset = {
      id: id || `ast_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name: name || blob.name || 'audio',
      durationSec: 0,
      size: blob.size || 0,
      blob, buffer: null, peaks: null, env: null,
    };
    try {
      const ab = await blob.arrayBuffer();
      this.ensureCtx();
      const buf = await this.ctx.decodeAudioData(ab.slice(0));
      asset.buffer = buf;
      asset.durationSec = buf.duration;
      asset.peaks = computePeaks(buf, 1800);
      asset.env = computeWaveEnvelope(buf, 512);
    } catch {
      // 解码失败：用 <audio> 元数据兜底时长（播放不可用，走 el 通道的旧路径也不可用此资产）
      try {
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.src = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
          probe.addEventListener('loadedmetadata', resolve, { once: true });
          probe.addEventListener('error', () => reject(new Error('音频无法解码')), { once: true });
          setTimeout(() => reject(new Error('音频元数据超时')), 4000);
        });
        asset.durationSec = probe.duration || 0;
        URL.revokeObjectURL(probe.src);
      } catch { /* 元数据也拿不到：durationSec=0 */ }
    }
    this.assets.set(asset.id, asset);
    return asset;
  }
  // 设活动资产（配乐）：同步旧通道字段（el/peaks/duration/blob/ready）——旧播放路径零改动
  setActiveAsset(id) {
    const a = this.assets.get(id);
    if (!a) return false;
    this.dispose(); // 清旧 el 会话（旧 url/peaks）；资产库不动
    this.activeId = id;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.url = URL.createObjectURL(a.blob);
    this.el.src = this.url;
    this.blob = a.blob;
    this.peaks = a.peaks;
    this.duration = a.durationSec;
    this.name = a.name;
    this.ready = true;
    return true;
  }
  // 旧入口兼容：载入并设为活动资产（「载入音乐…」/导入回填/自动恢复共用）
  async loadBlob(blob, name = '', id = null) {
    const asset = await this.addAsset(blob, name, id);
    this.setActiveAsset(asset.id);
    return this;
  }
  // ---- v3 clip 通道（Player 调用；buffer 未就绪返回 false → Player 回退 el 通道） ----
  ensureTransport() {
    if (!this.transport) {
      this.transport = new ClipTransport({ getContext: () => this.ensureCtx(), destination: () => this.ensureCtx()?.destination });
    }
    return this.transport;
  }
  resolveAssetBuffer(assetId) {
    const a = this.assets.get(assetId);
    return a?.buffer || null;
  }
  // 导出兜底（视频导出混音前用）：确保资产解出 AudioBuffer。
  // 缓存命中直接返回；未命中且 blob 存在 → 新建 OfflineAudioContext 重解码（不依赖手势/
  // AudioContext 运行态，iPad Safari 上 addAsset 时 decodeAudioData 偶发失败的场景成功率
  // 更高）。成功回填 asset.buffer 并尽力同步 durationSec/peaks/env（活动资产同步旧通道字段）；
  // 失败返回 null（调用方决定报错或静音跳过）。纯加法——不动既有播放路径。
  async ensureAssetBuffer(assetId) {
    const a = this.assets.get(assetId);
    if (!a) return null;
    if (a.buffer) return a.buffer;
    if (!a.blob) return null;
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return null;
      const ab = await a.blob.arrayBuffer();
      const off = new OAC(2, 1, 48000);
      // 兼容新旧实现：promise 型直接用；回调型（老 Safari）走 success/error 回调（双路 settle 幂等）
      const buf = await new Promise((res, rej) => {
        const p = off.decodeAudioData(ab, res, rej);
        if (p && typeof p.then === 'function') p.then(res, rej);
      });
      a.buffer = buf;
      if (buf?.duration) a.durationSec = buf.duration;
      try {
        a.peaks = computePeaks(buf, 1800);
        a.env = computeWaveEnvelope(buf, 512);
      } catch { /* 波形刷新失败不回滚解码成功 */ }
      if (this.activeId === assetId) { this.peaks = a.peaks; this.duration = a.durationSec; }
      return a.buffer;
    } catch {
      return null;
    }
  }
  playClips(clips, fromSec, rate = 1) {
    const t = this.ensureTransport();
    return t.play(clips, { from: fromSec, rate, resolveBuffer: id => this.resolveAssetBuffer(id), resolveProcessed: this.resolveProcessed });
  }
  seekClips(sec, rate = this.transport?.rate ?? 1) {
    if (!this.transport?.playing) return;
    const clipsRef = this.transport._clips;
    this.transport.play(clipsRef, { from: sec, rate, resolveBuffer: id => this.resolveAssetBuffer(id), resolveProcessed: this.resolveProcessed });
  }
  stopClips() { this.transport?.stopInternal(); }
  get clipsPlaying() { return !!(this.transport?.playing); }
  get clipsPosition() { return this.transport?.position ?? 0; }
  setTrackGain(g) { this.transport?.setTrackGain(g); }
  setTrackMuted(m) { this.transport?.setTrackMuted(m); }

  play(offsetSec, rate = 1) {
    this.el.playbackRate = rate;
    this.el.currentTime = Math.max(0, Math.min(offsetSec, this.duration || offsetSec));
    // FIX-R34-2：捕获 play() promise——播放随即被 pause 打断时（换曲先停/快速暂停）会
    // reject AbortError，旧实现未捕获 → unhandled rejection 冒成 pageerror 噪声。
    // 真正的播放失败（会话消失/解码失败）仍由 player._tick 的「音频通道停了」自愈兜底。
    return this.el.play().catch(() => {});
  }
  pause() { this.el.pause(); }
  stop() { this.el.pause(); this.el.currentTime = 0; }
  seek(sec) { this.el.currentTime = Math.max(0, sec); }
  get currentTime() { return this.el.currentTime; }
  get playing() { return !this.el.paused && !this.el.ended; }
  setRate(r) { this.el.playbackRate = r; }
  // 节拍器点击声
  click(accent = false, when = 0) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1976 : 1319;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.09);
  }
  dispose() {
    try { this.el.pause(); } catch {}
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.peaks = null; this.ready = false; this.duration = 0; this.blob = null;
  }
}

// 波形峰值（活动资产 0..1 归一化，旧 drawWave 用；clip 绘制用资产 env，见 audio-clips.computeWaveEnvelope）
export function computePeaks(audioBuffer, buckets = 1800) {
  const ch = audioBuffer.getChannelData(0);
  const per = Math.floor(ch.length / buckets) || 1;
  const peaks = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * per, end = Math.min(start + per, ch.length);
    for (let j = start; j < end; j += Math.max(1, Math.floor(per / 50))) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  const mx = peaks.reduce((a, b) => Math.max(a, b), 0.0001);
  for (let i = 0; i < buckets; i++) peaks[i] = peaks[i] / mx;
  return peaks;
}
