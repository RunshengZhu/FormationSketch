// 回放引擎：音频时钟 / 虚拟时钟、数拍入场、循环、节拍器
// v3（exp/audition-lite）：音频通道升级双轨——clip 调度（ClipTransport，WebAudio）为主，
// <audio> 元素旧通道为回退（buffer 解码失败/无 clip 的边界）。播放语义（规格 §2/§6）：
// 播放头进 clip → 调度（srcStart+偏移）；出 clip → 段间静音（时间轴时钟继续走）；
// ended = 越过最后 clip 终点与 totalBeats 取先到（先到者按 #7 混合语义处置：
// 时间轴未完 → _audioEnded 虚拟接管；已完 → 统一终态 ended）。既有守卫全部继承。
import { computeSegments, spb, beatToSec, secToBeat, currentFormationIndexAt, musicDomainSec } from './model.js';
import { lastClipEndSec } from './audio-clips.js';

export class Player {
  constructor({ audio, getProject, onTick, onStateChange, onCountin, onPreviewEnd, getMode }) {
    this.audio = audio;           // AudioController
    this.getProject = getProject;
    this.getMode = getMode;       // UI 模式钩子（'stage'|'music'；缺省=stage——编舞语义，M1 模式感知分支隔离）
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
    this._ciBase = null;          // 数拍起数的基准拍（取消倒计时回到这里）
    this._audioEnded = false;     // 音频先于时间轴自然结束：true=后续播放由虚拟时钟接管（见 useAudio）
    this._clipsActive = false;    // 本次播放是否走 clip 调度通道（起播时定格；中途不切换）
  }
  // 当前 UI 模式（M1 风险 R1 隔离阀）：music=秒域（seek 钳 [0, 音乐域]、ended=域尾、无虚拟接管）；
  // stage=编舞域逐值不动（钳 [0,totalBeats]、ended 虚拟接管）。钩子缺省/异常一律按 stage（红线兜底）。
  _isMusic() {
    try { return this.getMode?.() === 'music'; } catch { return false; }
  }
  get useAudio() {
    if (this._forceVirtual) return false;
    if (this._audioEnded) return false; // 音频已放完：虚拟时钟接管至 totalBeats（重按 ▶ 从当前拍续走）
    const p = this.getProject();
    return !!(p?.audio?.name && this.audio?.ready);
  }
  // clip 通道判定：活动资产已解码出 buffer 且项目有 clip（v1 迁移后载入音乐即有全长 clip）
  _useClips(p) {
    p = p || this.getProject();
    return !!(this.audio?.bufferReady && Array.isArray(p?.timeline?.audioClips) && p.timeline.audioClips.length > 0);
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
      this._clipsActive = this.useAudio && this._useClips(p); // useAudio=false（_audioEnded/_forceVirtual）→ 虚拟接管
      if (this._clipsActive) {
        // clip 调度通道：从当前拍的秒位起播（播放头出 clip 区间 = 段间静音，时钟继续走）；
        // el playbackRate 镜像（保持「音频通道速率」可观测，TC-P5-06 口径）
        this.audio.setRate(this.speed);
        this.audio.playClips(p.timeline.audioClips, beatToSec(p, this.beat), this.speed);
        this._virtual = null;
      } else if (this.useAudio) {
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
      // 数拍入场：负拍虚拟时钟，每拍一声（每小节首拍高音）。
      // DEFECT-R28-1：旧实现 onCountin(n) 画满数后同 tick 立即 clickOne()——首帧数字被覆盖为
      // n-1，倒计序列只显示 3,2,1（4 拍入场只画 3 个数），与文档「依次 4→1→隐藏」不符。
      // 现改为：先画完整 n，再进入节拍间隔；每拍一声不变，起播时刻=第 n 拍点击后（总时长仍 n 拍）。
      this.countin = true;
      this.playing = false;
      this._ciBase = this.beat; // 任务#5：取消倒计时回到起数基准拍（回到停止态，不直接起播）
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
        if (n <= 0) { clearInterval(this._ciTimer); this._ciTimer = null; this.countin = false; this._ciBase = null; this.beat = 0; doStart(); }
      };
      this.onCountin?.(n);
      this._ciTimer = setInterval(clickOne, interval);
    } else {
      doStart();
    }
  }
  _cancelCountin() {
    // 任务#5：取消倒计回到停止态——基准拍还原（不再停在负拍），返回是否确有倒计被取消
    if (this._ciTimer) {
      clearInterval(this._ciTimer);
      this._ciTimer = null;
    }
    if (!this.countin) return false;
    this.countin = false;
    this.beat = this._ciBase ?? 0;
    this._ciBase = null;
    this.onCountin?.(0);
    return true;
  }
  // 数拍中 ▶/空格/Esc/scrub 的统一取消入口：只取消倒计，不直接起播
  cancelCountin() {
    const had = this._cancelCountin();
    if (had) this._emit();
    return had;
  }
  _restoreLoop() {
    if (this._loopStash) {
      this.setLoop(true, this._loopStash.start, this._loopStash.end);
      this._loopStash = null;
    }
  }
  pause() {
    this._cancelCountin(); // 任务#5：数拍中暂停=取消倒计并回到基准拍（停止态）
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this.playing) return;
    this.playing = false;
    if (this._clipsActive) this.audio.stopClips();
    else if (this.useAudio) this.audio.pause();
    this._virtual = null;
    this._forceVirtual = false;    this.onStateChange?.({ playing: false });
  }
  stop() {
    this.pause();
    this.beat = 0;
    this._stopAt = null;
    this._audioEnded = false; // 停止=整体复位：下次 ▶ 恢复音频时钟（从头起播）
    this._forceVirtual = false;    this._restoreLoop();
    if (this.audio?.ready) this.audio.seek(0);
    this.onCountin?.(0);
    this._emit();
  }
  seekBeat(b) {
    const p = this.getProject();
    if (p) {
      // 任务#9（报告#9）：scrub/播放头目标一律钳制——越界定位不再触发停播/画出波形外。
      // M1 模式感知（风险 R1）：music 模式域=[0, 音乐域秒换算拍]（播放头可达 blocks 域之外，
      // 64s 音频在 32s 队形项目中可停可起）；stage 模式保持 [0, totalBeats]（编舞红线逐值不动）。
      const maxBeat = this._isMusic()
        ? Math.max(0, secToBeat(p, musicDomainSec(p)))
        : computeSegments(p).totalBeats;
      b = Math.max(0, Math.min(b, maxBeat));
      // 音频结束态下把播放头拖回音频范围内 → 恢复音频时钟（下次起播重新走 audio 通道）
      const audioEndSec = this._clipsEndSec(p);
      const inAudio = audioEndSec !== null
        ? beatToSec(p, b) < audioEndSec - 0.02
        : (this.audio?.duration && beatToSec(p, b) < this.audio.duration - 0.02);
      if (this._audioEnded && inAudio) this._audioEnded = false;
    }
    this.beat = b;
    if (this.playing && this._clipsActive) this.audio.seekClips(beatToSec(p, b), this.speed); // clip 通道：重调度
    else if (this.useAudio) this.audio.seek(beatToSec(p, b));
    else if (this.playing) this._virtual = { baseBeat: b, t0: performance.now() };
    this._lastIntBeat = null;
    this._emit();
  }
  // 音频通道的有效终点（时间线秒）：clip 通道=最后 clip 终点；el 通道=资产时长；无音乐=null
  _clipsEndSec(p) {
    p = p || this.getProject();
    if (this._useClips(p)) return lastClipEndSec(p.timeline.audioClips);
    if (p?.audio?.name && this.audio?.ready) return this.audio.duration || 0;
    return null;
  }
  seekFormation(index) {
    const { segments } = this.segments();
    const seg = segments[index];
    if (seg) this.seekBeat(seg.holdStart);
  }
  setSpeed(s) {
    this.speed = s;
    if (this.playing && this._clipsActive) {
      // clip 通道：重调度换 rate（buffer source 的 playbackRate 起播时定格）；
      // el playbackRate 同步镜像（活动资产未播放，仅保持「音频通道速率」可观测，TC-P5-06 口径）
      this.audio.setRate(s);
      this.audio.seekClips(this.audio.clipsPosition, s);
      return;
    }
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
    if (this._clipsActive) {
      // clip 通道：transport 停了 = 自然越过最后 clip 终点（或异常）→ 终态处置
      if (!this.audio.clipsPlaying) {
        const pos = this.audio.clipsPosition;
        const endSec = this._clipsEndSec(p) || 0;
        this._finish(pos >= endSec - 0.06, Math.min(pos, endSec || pos));
        return;
      }
    } else if (this.useAudio && !this.audio.playing) {
      // 音频通道停了：区分「自然放完」（含 ended 事件抢先的窗口）与「异常中断」（任务#7/#3）
      this._finish(!!(this.audio.duration && this.audio.currentTime >= this.audio.duration - 0.02));
      return;
    }
    // 任务#3（报告#3）：音频会话在播放中消失（载入失败/存储驱逐）→ 干净暂停，
    // 不再走 beat=this.beat 空转的「僵死播放」态
    if (!this.useAudio && !this._virtual && !this._forceVirtual) { this.pause(); return; }
    let beat;
    if (this._clipsActive) {
      // clip 通道：beat 由 transport 双时钟位置反推（段间静音时时钟继续走、队形照常推进）
      beat = secToBeat(p, this.audio.clipsPosition);
      this._virtual = null;
    } else if (this.useAudio && this.audio.playing) {
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
      // M1 模式感知（风险 R1）：ended 终点域——music=音乐域尾（secToBeat(musicDomainSec)，
      // 音频播完/越过域尾才 ended，不再被 blocks 域提前掐断）；stage=totalBeats（逐值不动）。
      const endBeat = this._isMusic()
        ? Math.max(0, secToBeat(p, musicDomainSec(p)))
        : this.segments().totalBeats;
      if (beat >= endBeat) {
        // 任务#6（报告#6）：终态统一——两套时钟都停在终点并置 ended（不再静默归 0）
        this.pause();
        this.beat = endBeat;
        this.onStateChange?.({ playing: false, ended: true });
      } else {
        // 任务#7（报告#8）：音频先于时间轴自然结束（ended 前的采样窗口）——
        // clip 通道按「最后 clip 终点」判定，el 通道按资产时长判定（虚拟接管态不判）。
        // 终点钳制：起播点越界（续播拍 > 音频终点，el 路径会 clamp seek）时播放头同样钳在音频末拍。
        const endSec = (this._clipsActive || this.useAudio) ? this._clipsEndSec(p) : null;
        const pos = this._clipsActive ? this.audio.clipsPosition : this.audio.currentTime;
        if (endSec !== null && endSec > 0 && pos >= endSec - 0.02) this._finish(true, Math.min(pos, endSec));
      }
    }
    this._emit();
    // setTimeout 驱动（rAF 在后台/部分环境会被节流导致回放停滞）
    this._timer = setTimeout(() => this._tick(), 16);
  }
  // 音频通道结束的收尾：自然放完时把播放头钳在音频末拍（不越过波形）、
  // 时间轴还没走完则置 _audioEnded（下一次 ▶ 由虚拟时钟从当前拍接管至 totalBeats）。
  // M1 模式感知（风险 R1）：music 模式无虚拟接管——音频放完即终态，播放头钳在音乐域内
  // （末拍=min(音频末拍, 域尾拍)）；stage 分支逐值不动（编舞排练跟队形走完无乐尾段，round30 #7）。
  // endPos：clip 通道=transport 位置（时间线秒）；el 通道缺省读 el.currentTime
  _finish(audioEnded, endPos = null) {
    this.pause();
    if (!audioEnded) return;
    const p = this.getProject();
    if (!p) return;
    const pos = endPos ?? (this._clipsActive ? this.audio.clipsPosition : (this.audio.currentTime || this.audio.duration || 0));
    if (this._isMusic()) {
      const domainBeat = Math.max(0, secToBeat(p, musicDomainSec(p)));
      this.beat = Math.min(Math.max(0, secToBeat(p, pos || 0)), domainBeat);
      // reason:'audio' → main 层「音乐已结束」toast——music 模式下音频放完=音乐真结束，
      // toast 语义成立（E58-05「队形走完误报音乐结束」随 blocks 域钳制一并消亡）
      this.onStateChange?.({ playing: false, ended: true, reason: 'audio' });
      this._emit();
      return;
    }
    const { totalBeats } = this.segments();
    const endBeat = Math.max(0, Math.min(secToBeat(p, pos || 0), totalBeats));
    if (totalBeats - endBeat <= 0.05) {
      this.beat = totalBeats;
      this.onStateChange?.({ playing: false, ended: true });
    } else {
      this.beat = endBeat;
      this._audioEnded = true;
      this._lastIntBeat = null;
      this.onStateChange?.({ playing: false, ended: true, reason: 'audio' });
    }
    this._emit();
  }
  // 决策④（播放中解锁 BPM/首拍）：秒制走带下安全——改动后秒位置保持不变、拍位按新映射重算。
  // 音频通道（clip/el）_tick 每帧由音频秒位反推拍位，天然满足，无需处理；
  // 虚拟时钟无音频锚点：以「改动瞬间的播放头秒位」重定基准（baseBeat/t0），拍位与显示秒位连续不跳。
  remapBeatToSec(sec) {
    if (!this.playing || !this._virtual) return;
    const p = this.getProject();
    if (!p) return;
    const b = Math.max(0, secToBeat(p, Math.max(0, Number(sec) || 0)));
    this._virtual = { baseBeat: b, t0: performance.now() };
    this.beat = b;
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
