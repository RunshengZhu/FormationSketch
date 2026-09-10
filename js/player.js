// 回放引擎：音频时钟 / 虚拟时钟、数拍入场、循环、节拍器
import { computeSegments, spb, beatToSec, secToBeat, currentFormationIndexAt } from './model.js';

export class Player {
  constructor({ audio, getProject, onTick, onStateChange, onCountin, onPreviewEnd }) {
    this.audio = audio;           // AudioController
    this.getProject = getProject;
    this.onTick = onTick;         // ({beat, sec, formationIndex, phase})
    this.onStateChange = onStateChange; // ({playing})
    this.onCountin = onCountin;   // (n|0) 剩余入场拍，0 隐藏
    this.onPreviewEnd = onPreviewEnd; // (endBeat) 切帧预览结束
    this.playing = false;
    this.countin = false;
    this.beat = 0;
    this.speed = 1;
    this.loopOn = false;
    this.loopStart = 0; this.loopEnd = 0;
    this._virtual = null;         // {baseBeat, t0}
    this._lastIntBeat = null;
    this._stopAt = null;          // 预览过渡时的结束拍
  }
  get useAudio() {
    if (this._forceVirtual) return false;
    const p = this.getProject();
    return !!(p?.audio?.name && this.audio?.ready);
  }
  // 切帧预览中（有限段虚拟播放）：不抢占用户选择的队形高亮
  get previewing() {
    return this._forceVirtual === true && this._stopAt !== null;
  }
  segments() { return computeSegments(this.getProject() || { timeline: { blocks: [] } }); }

  play(fromBeat = null, { previewStop = null, countIn = true, forceVirtual = false } = {}) {
    if (this.playing) return;
    // 清理遗留的数拍入场（避免双时钟竞态）
    this._cancelCountin();
    const p = this.getProject();
    if (!p) return;
    const fresh = fromBeat !== null;
    if (fresh) this.beat = fromBeat;
    this._stopAt = previewStop;
    this._forceVirtual = !!forceVirtual;
    // 预览期间挂起循环，防止循环拉回导致预览永不结束
    this._loopStash = null;
    if (previewStop !== null && this.loopOn) {
      this._loopStash = { start: this.loopStart, end: this.loopEnd };
      this.loopOn = false;
    }
    const doStart = () => {
      if (this.playing) return; // 防御：已被其他路径启动
      this.playing = true;
      this._lastIntBeat = null;
      if (this.useAudio) {
        this.audio.setRate(this.speed);
        this.audio.play(beatToSec(p, this.beat), this.speed);
        this._virtual = null;
      } else {
        this._virtual = { baseBeat: this.beat, t0: performance.now() };
      }
      this.onStateChange?.({ playing: true });
      this._tick();
    };
    const ci = countIn && fresh ? (p.timeline.countInBeats || 0) : 0;
    if (ci > 0) {
      // 数拍入场：负拍虚拟时钟，每拍一声（每小节首拍高音）
      this.countin = true;
      this.playing = false;
      let n = ci;
      const total = ci;
      const bpb = p.audio.beatsPerBar || 4;
      const interval = spb(p) * 1000 / this.speed;
      const clickOne = () => {
        this.audio.click((total - n) % bpb === 0, 0);
        n--;
        this.onCountin?.(n);
        this.beat = -n; // 负拍显示
        this._emit();
        if (n <= 0) { clearInterval(this._ciTimer); this._ciTimer = null; this.countin = false; this.beat = 0; doStart(); }
      };
      this.onCountin?.(n);
      clickOne();
      this._ciTimer = setInterval(clickOne, interval);
    } else {
      doStart();
    }
  }
  _cancelCountin() {
    if (this._ciTimer) {
      clearInterval(this._ciTimer);
      this._ciTimer = null;
      this.countin = false;
      this.onCountin?.(0);
    }
  }
  _restoreLoop() {
    if (this._loopStash) {
      this.setLoop(true, this._loopStash.start, this._loopStash.end);
      this._loopStash = null;
    }
  }
  pause() {
    if (this._ciTimer) { clearInterval(this._ciTimer); this._ciTimer = null; this.countin = false; this.onCountin?.(0); }
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this.playing) return;
    this.playing = false;
    if (this.useAudio) this.audio.pause();
    this._virtual = null;
    this._forceVirtual = false;    this.onStateChange?.({ playing: false });
  }
  stop() {
    this.pause();
    this.beat = 0;
    this._stopAt = null;
    this._forceVirtual = false;    this._restoreLoop();
    if (this.audio?.ready) this.audio.seek(0);
    this.onCountin?.(0);
    this._emit();
  }
  seekBeat(b) {
    this.beat = b;
    if (this.useAudio) this.audio.seek(beatToSec(this.getProject(), b));
    else if (this.playing) this._virtual = { baseBeat: b, t0: performance.now() };
    this._lastIntBeat = null;
    this._emit();
  }
  seekFormation(index) {
    const { segments } = this.segments();
    const seg = segments[index];
    if (seg) this.seekBeat(seg.holdStart);
  }
  setSpeed(s) {
    this.speed = s;
    if (this.useAudio) this.audio.setRate(s);
    if (this.playing && this._virtual) this._virtual = { baseBeat: this.beat, t0: performance.now() };
  }
  setLoop(on, start = 0, end = 0) {
    this.loopOn = on; this.loopStart = start; this.loopEnd = end;
  }
  _tick() {
    if (!this.playing) return;
    const p = this.getProject();
    if (!p) { this.playing = false; return; }
    if (this.useAudio && !this.audio.playing) { this.pause(); return; }
    let beat;
    if (this.useAudio && this.audio.playing) {
      beat = secToBeat(p, this.audio.currentTime);
      this._virtual = null;
    } else if (this._virtual) {
      beat = this._virtual.baseBeat + (performance.now() - this._virtual.t0) / 1000 * (p.audio.bpm || 120) / 60  * this.speed;
    } else {
      beat = this.beat;
    }
    if (p.timeline.metronome) {
      const ib = Math.floor(beat);
      if (this._lastIntBeat === null) this._lastIntBeat = ib;
      else if (ib > this._lastIntBeat) {
        const bpb = p.audio.beatsPerBar || 4;
        this.audio.click(((ib % bpb) + bpb) % bpb === 0, 0);
        this._lastIntBeat = ib;
      }
    }
    this.beat = beat;
    // 预览终点优先于循环（预览期间循环已挂起，双保险）
    if (this._stopAt !== null && beat >= this._stopAt) {
      this.pause();
      this.beat = this._stopAt;
      const end = this._stopAt;
      this._stopAt = null;
      this._restoreLoop(); // 恢复被预览挂起的循环
      this.onPreviewEnd?.(end); // 预览结束：通知 UI 复位到编辑视图
    } else if (this.loopOn && this.loopEnd > this.loopStart && beat >= this.loopEnd) {
      this.seekBeat(this.loopStart);
    } else {
      const { totalBeats } = this.segments();
      if (beat >= totalBeats || (this.useAudio && this.audio.duration && this.audio.currentTime >= this.audio.duration - 0.02)) {
        this.pause();
        this.beat = totalBeats;
        this.onStateChange?.({ playing: false, ended: true });
      }
    }
    this._emit();
    // setTimeout 驱动（rAF 在后台/部分环境会被节流导致回放停滞）
    this._timer = setTimeout(() => this._tick(), 16);
  }
  _emit() {
    const p = this.getProject();
    const fi = p ? currentFormationIndexAt(p, this.beat) : 0;
    this.onTick?.({ beat: this.beat, sec: p ? beatToSec(p, Math.max(0, this.beat)) : 0, formationIndex: fi });
  }
  dispose() {
    this.pause();
    this.onTick = null; this.onStateChange = null;
  }
}
