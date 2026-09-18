// 音乐编辑守卫与双时钟终态（round32：docs/music-editing-defects.md 修复轮）node 回归。
// 覆盖：#5 数拍取消、#6 无音乐终态统一、#7/报告#8 音频先完钳制+虚拟接管、#9 scrub 钳制、
// #3 音频会话消失自愈、#21 相关（stop 复位音频时钟）。DOM 层守卫（#2 禁改/#16 暂停/#10 告警）
// 由 lab 探针 r32-musicguard.mjs 实测，此处只收 player/audio 可测语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, computeSegments, spb, secToBeat } from '../js/model.js';
import { Player } from '../js/player.js';

// 音频桩：可编程 currentTime/playing/ready，记录调用
function makeAudioStub({ ready = false, duration = 0 } = {}) {
  const stub = {
    ready, duration, currentTime: 0, _playing: false,
    calls: { play: [], seek: [], pause: 0 },
    get playing() { return this._playing; },
    play(sec) { this.calls.play.push(sec); this.currentTime = sec; this._playing = true; },
    pause() { this.calls.pause++; this._playing = false; },
    stop() { this._playing = false; this.currentTime = 0; },
    seek(sec) { this.calls.seek.push(sec); this.currentTime = sec; },
    setRate() {}, click() {},
  };
  return stub;
}

function makePlayer(project, audio) {
  const events = { states: [], ticks: 0, previewEnds: 0 };
  const p = new Player({
    audio,
    getProject: () => project,
    onTick: () => { events.ticks++; },
    onStateChange: s => { events.states.push(s); },
    onCountin: () => {},
    onPreviewEnd: () => { events.previewEnds++; },
  });
  return { p, events };
}

// 快进虚拟时钟后手动 _tick（与 tests/player.test.js 同口径）
function advance(p, dtMs) {
  if (p._virtual) p._virtual.t0 -= dtMs;
  p._tick();
}

// ---------- 任务#5（报告#5）：数拍中 ▶/空格/Esc/scrub = 取消倒计，回停止态 ----------
test('#5 cancelCountin：取消倒计回停止态（不直接起播），beat 回到起数基准拍', async () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 4;
  project.audio.bpm = 600; // spb=0.1s：真实定时器下 1 拍 ≈ 0.1s
  const { p } = makePlayer(project, makeAudioStub());
  p.play(0); // fresh + countIn
  assert.equal(p.countin, true);
  assert.equal(p.playing, false);
  await new Promise(r => setTimeout(r, 150)); // 等 1 拍倒计走完
  assert.ok(p.beat < 0, '倒计中为负拍');
  const had = p.cancelCountin();
  assert.equal(had, true, '确有倒计被取消');
  assert.equal(p.countin, false, '倒计态清除');
  assert.equal(p.playing, false, '不直接起播（回到停止态）');
  assert.equal(p.beat, 0, 'beat 回到起数基准拍（不再停在负拍）');
  assert.equal(p._ciTimer, null, '定时器清理');
  // 取消后可以重新起数（重开完整倒计是用户显式动作，非手滑副作用）
  p.play(0);
  assert.equal(p.countin, true);
  p.cancelCountin();
  // 非倒计态调用=无操作
  assert.equal(p.cancelCountin(), false);
});

test('#5 pause/cancelCountin 在段中起数时同样还原基准拍；再次 ▶ 重新起数', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 4;
  const { p } = makePlayer(project, makeAudioStub());
  p.play(24); // 从 24 拍起数
  assert.equal(p.countin, true);
  p.pause(); // 切帧/删队形等路径（pause 清倒计）
  assert.equal(p.countin, false);
  assert.equal(p.beat, 24, '基准拍还原（不被负拍残留污染）');
  p.play(24); // 重按 ▶：重新起数
  assert.equal(p.countin, true);
  p.cancelCountin();
  assert.equal(p.beat, 24);
});

// ---------- 任务#6（报告#6）：无音乐档终态统一——播到 totalBeats 停止并置 ended ----------
test('#6 无音乐播完整条时间轴：停在 totalBeats、ended 事件、不触发 onPreviewEnd（不再静默归 0）', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 0;
  const { totalBeats } = computeSegments(project);
  assert.equal(totalBeats, 16, '前置：单队形（末块无过渡）= 保持 16 拍');
  const { p, events } = makePlayer(project, makeAudioStub());
  p.play(0, { countIn: false, forceVirtual: true }); // togglePlay 无音乐分支新语义：无 previewStop
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.playing, false, '自动停止');
  assert.equal(p.beat, totalBeats, '停在 totalBeats（不静默归 0）');
  const ended = events.states.find(s => s.ended);
  assert.ok(ended, '发出 ended');
  assert.equal(ended.reason, undefined, '时间轴自然终了（非音频先完）');
  assert.equal(events.previewEnds, 0, '整曲播放不是切帧预览（无 onPreviewEnd 归 0）');
  p.stop();
});

test('#6 全曲播完后再按 ▶（playerAtEnd 语义）：seekBeat(0) 后 fresh 起播回第 0 段', () => {
  const project = createProject({ pairs: 1 });
  createFormationHelper(project);
  project.timeline.countInBeats = 0;
  const { p, events } = makePlayer(project, makeAudioStub());
  p.play(0, { countIn: false, forceVirtual: true });
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.beat, computeSegments(project).totalBeats);
  // togglePlay 的 playerAtEnd() 分支：从头播（此处验证玩家原语：play(0) fresh 回 0 并重新推进）
  p.play(0, { countIn: false, forceVirtual: true });
  assert.equal(p.playing, true);
  advance(p, 250);
  assert.ok(p.beat > 0 && p.beat < 1, `从 0 重新推进（beat=${p.beat.toFixed(2)}）`);
  assert.ok(!events.states.at(-1)?.ended, '重播中不应带 ended');
  p.stop();
});
function createFormationHelper(project) {
  // 2 个队形：16+8 / 16（末块无过渡）→ totalBeats 40
  const f = { id: 'f2', name: '二', color: '#111', note: '', positions: {} };
  project.formations.push(f);
  project.timeline.blocks.push({ formationId: 'f2', holdBeats: 16, travelBeats: 0 });
  return project;
}

// ---------- 任务#7（报告#8）：音频短于时间轴——自然结束停在音频末拍，▶ 后虚拟时钟接管 ----------
test('#7 音频先于时间轴自然结束：播放头钳在音频末拍（不跳 totalBeats）、ended reason=audio', () => {
  const project = createProject({ pairs: 1 });
  createFormationHelper(project); // totalBeats 40
  project.timeline.countInBeats = 0;
  project.audio.name = 'short.wav';
  const spbv = spb(project); // 0.5s @120bpm
  const audio = makeAudioStub({ ready: true, duration: 6 }); // 6s = 12 拍 ≪ 40 拍
  const { p, events } = makePlayer(project, audio);
  p.play(0); // 音频时钟起播
  assert.equal(p.playing, true);
  // 驱动：每 tick 推进音频 1s（2 拍）
  for (let i = 0; i < 20 && p.playing; i++) { audio.currentTime = Math.min(6, audio.currentTime + 1); p._tick(); }
  assert.equal(p.playing, false, '音频放完即停');
  const expectBeat = secToBeat(project, 6);
  assert.equal(Math.abs(p.beat - expectBeat) < 1e-9, true, `播放头=音频末拍 ${expectBeat}（不越到 totalBeats=40）`);
  assert.equal(p._audioEnded, true, '进入音频结束态');
  const ended = events.states.find(s => s.ended);
  assert.ok(ended);
  assert.equal(ended.reason, 'audio', '带 reason=audio（UI 层据此 toast「音乐已结束」一次）');
  p.stop();
});

test('#7 音频结束态再按 ▶：虚拟时钟从当前拍接管至 totalBeats（混合语义），终态 ended 无 reason', () => {
  const project = createProject({ pairs: 1 });
  createFormationHelper(project);
  project.timeline.countInBeats = 0;
  project.audio.name = 'short.wav';
  const audio = makeAudioStub({ ready: true, duration: 6 });
  const { p, events } = makePlayer(project, audio);
  p.play(0);
  for (let i = 0; i < 20 && p.playing; i++) { audio.currentTime = Math.min(6, audio.currentTime + 1); p._tick(); }
  assert.equal(p._audioEnded, true);
  // ▶ 续播（togglePlay 暂停续播分支 play(null,{countIn:false})）：useAudio 已被 _audioEnded 关断
  assert.equal(p.useAudio, false, '音频结束态 useAudio=false → 虚拟时钟接管');
  p.play(null, { countIn: false });
  assert.equal(p.playing, true);
  assert.equal(audio.calls.play.length, 1, '续播不再驱动音频通道（仅最初一次 play）');
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.playing, false);
  assert.equal(p.beat, 40, '虚拟时钟接管直至 totalBeats');
  const last = events.states.at(-1);
  assert.equal(last.ended, true);
  assert.equal(last.reason, undefined, '第二段终了=时间轴自然终了');
  p.stop();
});

test('#7 ended 事件抢先窗口（音频通道先停）：_finish 同样钳到音频末拍；音频=时间轴长度时归 totalBeats', () => {
  // 场景 A：音频 6s ≪ 40 拍，ended 抢先（playing=false 且 currentTime=duration）
  const project = createProject({ pairs: 1 });
  createFormationHelper(project);
  project.timeline.countInBeats = 0;
  project.audio.name = 'short.wav';
  const audio = makeAudioStub({ ready: true, duration: 6 });
  const { p, events } = makePlayer(project, audio);
  p.play(0);
  audio.currentTime = 5; // 播到 10 拍
  p._tick();
  assert.ok(Math.abs(p.beat - 10) < 1e-9);
  audio.currentTime = 6;
  audio._playing = false; // 'ended' 事件已置（下一 tick 走 useAudio && !playing 首行）
  p._tick();
  assert.equal(p.playing, false);
  assert.equal(Math.abs(p.beat - secToBeat(project, 6)) < 1e-9, true, '首行路径同样钳在音频末拍');
  assert.equal(events.states.find(s => s.ended)?.reason, 'audio');
  // 场景 B：音频与时间轴同时到头（4s=8 拍 = totalBeats 8）→ 归 totalBeats、无 reason
  const projectB = createProject({ pairs: 1 });
  projectB.timeline.blocks[0].holdBeats = 8; // 单队形：末块无过渡 → totalBeats=8
  projectB.timeline.countInBeats = 0;
  projectB.audio.name = 'equal.wav';
  const audioB = makeAudioStub({ ready: true, duration: 4 }); // 4s=8 拍
  const { p: pb, events: evB } = makePlayer(projectB, audioB);
  pb.play(0);
  audioB.currentTime = 4;
  pb._tick();
  assert.equal(pb.playing, false);
  assert.equal(pb.beat, 8, '音频与时间轴同时到头 → 停 totalBeats');
  assert.equal(evB.states.at(-1).reason, undefined, '不误报「音乐已结束」toast 语义');
  pb.stop();
});

// ---------- 任务#9（报告#9）：scrub/播放头钳制 [0, totalBeats] ----------
test('#9 seekBeat 越界钳制：>totalBeats 钳到终点、<0 钳到 0；音频结束态拖回音频范围恢复音频时钟', () => {
  const project = createProject({ pairs: 1 });
  createFormationHelper(project); // totalBeats 40
  project.timeline.countInBeats = 0;
  project.audio.name = 'x.wav';
  const audio = makeAudioStub({ ready: true, duration: 6 });
  const { p } = makePlayer(project, audio);
  p.seekBeat(70);
  assert.equal(p.beat, 40, '越界 scrub 钳到 totalBeats（不再触发越界停播）');
  p.seekBeat(-5);
  assert.equal(p.beat, 0);
  // 音频结束态：拖回音频范围内（<6s 即 <12 拍）→ _audioEnded 清除，下次起播恢复音频时钟
  p._audioEnded = true;
  p.seekBeat(4); // 4 拍=2s < 6s
  assert.equal(p._audioEnded, false, '回到波形内=音频时钟恢复');
  p.seekBeat(20); // 20 拍=10s > 6s，仍在波形外
  assert.equal(p._audioEnded, false, '未被再次置位（仅结束时刻置位）');
  p.stop();
});

// ---------- 任务#3（报告#3）：音频会话播放中消失 → 干净暂停（僵死自愈） ----------
test('#3 播放中音频会话失效（ready 翻转）：下一 tick 干净暂停，不再空转僵死', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 0;
  project.audio.name = 'ok.wav';
  const audio = makeAudioStub({ ready: true, duration: 60 });
  const { p, events } = makePlayer(project, audio);
  p.play(0);
  audio.currentTime = 1; // 2 拍处
  p._tick();
  assert.ok(Math.abs(p.beat - 2) < 1e-9);
  assert.equal(p._virtual, null, '音频时钟路径无虚拟时钟');
  // 模拟载入失败 dispose / 存储驱逐：ready=false，且元素已停
  audio.ready = false;
  audio._playing = false;
  p._tick();
  assert.equal(p.playing, false, '自愈=暂停（不再 beat 冻结的假播放）');
  assert.equal(events.states.at(-1).playing, false);
  assert.equal(events.states.at(-1).ended, undefined, '异常中断不发 ended（区别于自然终了）');
  p.stop();
});

// ---------- 任务#21 相关（player 侧）：stop() 整体复位音频时钟（_audioEnded 清除） ----------
test('#21 stop 后 _audioEnded 复位：下次 ▶ 恢复音频时钟而非永久虚拟', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 0;
  project.audio.name = 'x.wav';
  const audio = makeAudioStub({ ready: true, duration: 6 });
  const { p } = makePlayer(project, audio);
  p.play(0);
  p._audioEnded = true; // 模拟音频先完态
  p.stop();
  assert.equal(p._audioEnded, false, 'stop 清音频结束态');
  assert.equal(p.useAudio, true, 'useAudio 恢复（p.audio.name + ready）');
  p.stop();
});
