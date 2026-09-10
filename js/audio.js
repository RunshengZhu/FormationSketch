// 音频：文件加载、波形峰值、播放控制、节拍器点击声
export class AudioController {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.ctx = null;
    this.peaks = null;        // Float32Array，长度 N，值 -1..1
    this.duration = 0;
    this.url = null;
    this.name = '';
    this.ready = false;
  }
  ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  async loadBlob(blob, name = '') {
    this.dispose();
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    this.name = name || blob.name || 'audio';
    await new Promise((resolve, reject) => {
      const ok = () => { this.duration = this.el.duration || 0; this.ready = true; resolve(); };
      this.el.addEventListener('loadedmetadata', ok, { once: true });
      this.el.addEventListener('error', () => reject(new Error('音频无法解码')), { once: true });
    });
    // 波形（失败不阻塞，仅无波形显示）
    try {
      const ab = await blob.arrayBuffer();
      this.ensureCtx();
      const buf = await this.ctx.decodeAudioData(ab);
      this.peaks = computePeaks(buf, 1800);
      this.duration = buf.duration;
    } catch { this.peaks = null; }
    return this;
  }
  play(offsetSec, rate = 1) {
    this.el.playbackRate = rate;
    this.el.currentTime = Math.max(0, Math.min(offsetSec, this.duration || offsetSec));
    return this.el.play();
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
    this.url = null; this.peaks = null; this.ready = false; this.duration = 0;
  }
}
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
