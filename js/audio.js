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
    this.blob = null;         // 当前会话的音频源 Blob：下载版（file://→localStorage）不落盘，
                              // 「导出 ▾」含音乐需要从这里兜底取（DEFECT-R26-2，与在线 IndexedDB 行为对齐）
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
    // 任务#3（报告#3）：失败不破坏当前会话——先在临时 <audio> 上等元数据，成功后才替换旧会话。
    // 旧实现先 dispose() 再等元数据，损坏音频 reject 后播放器留下 ready=false 的空会话，
    // 播放中载入即僵死（playing=true 空转）；现在失败时旧音乐照常可用。
    const el = new Audio();
    el.preload = 'auto';
    const url = URL.createObjectURL(blob);
    el.src = url;
    try {
      await new Promise((resolve, reject) => {
        el.addEventListener('loadedmetadata', resolve, { once: true });
        el.addEventListener('error', () => reject(new Error('音频无法解码')), { once: true });
      });
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    this.dispose(); // 元数据确认可解码后才提交：清旧会话（旧 url/blob/peaks/旧元素）
    this.el = el;
    this.blob = blob; // 会话内保留原始 Blob（导出含乐兜底用；dispose 时清空）
    this.url = url;
    this.name = name || blob.name || 'audio';
    this.duration = this.el.duration || 0;
    // 波形（失败不阻塞，仅无波形显示）
    try {
      const ab = await blob.arrayBuffer();
      this.ensureCtx();
      const buf = await this.ctx.decodeAudioData(ab);
      this.peaks = computePeaks(buf, 1800);
      this.duration = buf.duration;
    } catch { this.peaks = null; }
    // FIX-R34-1：ready 置位移到波形解码之后。旧实现 ready 先置位，而 loadAudioFile 的
    // 项目字段提交（p.audio.name）要等 loadBlob 返回——中间隔着整段 decodeAudioData
    //（长曲数百毫秒）。用户在此窗口按 ▶：useAudio 仍为 false → 虚拟时钟起播；随后
    // name 提交使 useAudio 翻真，_tick 误判「音频通道停了」自愈暂停 → 播放刚起即停。
    // ready 与项目字段提交顺序对齐后，竞态窗口闭合。
    this.ready = true;
    return this;
  }
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
