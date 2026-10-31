// 音乐域基座与播放域模式感知（M1 · docs/music-mode-redesign.md D1/D3，风险 R1 专项单测）。
// 试金石场景：3 队形×(16+8)=64 拍（120BPM=32s blocks 域）+ 64s 音频 → 音频域=2×块域。
// 覆盖：musicDomainSec 域上界、seekBeat 模式感知钳制、ended 终点域（music=域尾无虚拟接管 /
// stage=build-51-stageux 用户指令改语义：有音频资产 → 同 music 直达音乐尾；无音频 →
// totalBeats 虚拟接管保留）、BPM/首拍播放中改动的秒位不变重映射、划分域 override。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, segmentsFromClips, spb, beatToSec, secToBeat,
  musicDomainSec, sectionSegmentsOf,
} from '../js/model.js';
import { Player } from '../js/player.js';

// 试金石项目：3 队形 16+8 → totalBeats=64（120BPM=32s）；64s 资产 + 全长 clip
// （build-70-formationclips 夹具迁移：旧 blocks [{hold:16,travel:8}×3] → clip 字段——
//   formation i startBeat=i*24（16 hold + 8 空隙累计）、lenBeats=16，域逐值等价）
function stoneProject() {
  const p = createProject({ pairs: 1, grouping: 'none' });
  while (p.formations.length < 3) p.formations.push({ id: `f${p.formations.length}`, name: `F${p.formations.length}`, color: '#64748b', note: '', positions: {} });
  p.formations.forEach((f, i) => { f.startBeat = i * 24; f.lenBeats = 16; });
  p.media = { assets: [{ id: 'a1', name: 'long.wav', durationSec: 64, size: 1 }], activeAssetId: 'a1' };
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 64, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'long' }];
  p.audio.name = 'long.wav';
  p.audio.durationSec = 64;
  return p;
}

function makeAudioStub() {
  return {
    ready: false, duration: 0, currentTime: 0, calls: { play: [], seek: [], pause: 0 },
    get playing() { return false; },
    play(sec) { this.calls.play.push(sec); }, pause() { this.calls.pause++; },
    stop() {}, seek(sec) { this.calls.seek.push(sec); }, setRate() {}, click() {},
  };
}

function makePlayer(project, audio, { mode } = {}) {
  const events = { states: [], ticks: 0 };
  const p = new Player({
    audio,
    getProject: () => project,
    ...(mode !== undefined ? { getMode: () => mode } : {}), // 缺省不传=stage 语义（钩子可选）
    onTick: () => { events.ticks++; },
    onStateChange: s => { events.states.push(s); },
    onCountin: () => {},
    onPreviewEnd: () => {},
  });
  return { p, events };
}
// 快进虚拟时钟后手动 _tick（与 tests/music-guard.test.js 同口径）
function advance(pl, dtMs) {
  if (pl._virtual) pl._virtual.t0 -= dtMs;
  pl._tick();
}

// ---------- D1：musicDomainSec ----------
test('musicDomainSec：max(最后 clip 终点, 资产时长, 10)——试金石 64s', () => {
  const p = stoneProject();
  assert.equal(segmentsFromClips(p.formations).totalBeats, 64, '前置：clip 域=64 拍');
  assert.equal(beatToSec(p, 64), 32, '前置：clip 域=32s');
  assert.equal(musicDomainSec(p), 64, '域=max(clip 终点 64, 资产 64, 10)=64');
});
test('musicDomainSec：无音乐=10s 托底；clip 拖出比资产长→取 clip 终点；编舞 clip 域只经 formEndSec 参与', () => {
  const bare = createProject({ pairs: 1 });
  assert.equal(musicDomainSec(bare), 10, '无 media → 下限 10s');
  const p = stoneProject();
  p.timeline.audioClips[0].timelineStartSec = 10; // 拖到 10s 起 → 终点 74s > 资产 64s
  assert.equal(musicDomainSec(p), 74, 'clip 终点主导（拖出更长域自动变长）');
  const shortAudio = stoneProject();
  shortAudio.media.assets[0].durationSec = 8;
  shortAudio.timeline.audioClips[0].lengthSec = 8;
  assert.equal(musicDomainSec(shortAudio), 32, '音频 8s < 编舞 clip 域 32s → 编舞域主导（clip 一等对象域自动伸缩，build-70 换源）');
});

// ---------- D3/R1①：seekBeat 模式感知钳制 ----------
test('seekBeat music 模式：播放头可达音乐域（64s→128 拍），不再钳在编舞域 64 拍', () => {
  const p = stoneProject();
  const { p: pl } = makePlayer(p, makeAudioStub(), { mode: 'music' });
  pl.seekBeat(1000);
  assert.equal(pl.beat, 128, '钳到 secToBeat(64s)=128 拍（blocks 域 2 倍）');
  pl.seekBeat(97); // 48.5s——编舞域之外（>64 拍）
  assert.equal(pl.beat, 97, '编舞域内自由定位');
  pl.seekBeat(-5);
  assert.equal(pl.beat, 0, '负值仍钳 0');
});
// build-51-stageux F1（用户指令改写）：stage 有音频资产 → 与 music 同域（播放直达音乐尾）；
// stage 无音频 → 维持 totalBeats。原「stage 钳 totalBeats」断言随用户指令退役，无音频口径保留。
test('seekBeat 缺省（无 getMode 钩子）=stage：有音频资产 → 钳音乐域（播放直达音乐尾，用户指令）', () => {
  const p = stoneProject();
  const { p: pl } = makePlayer(p, makeAudioStub());
  pl.seekBeat(1000);
  assert.equal(pl.beat, 128, '钳音乐域 secToBeat(64s)=128 拍（编舞域 64 拍之外可达）');
  // 无音频资产对照：纯编舞项目仍钳 totalBeats
  const p2 = stoneProject();
  p2.media = { assets: [], activeAssetId: null };
  p2.timeline.audioClips = [];
  const { p: pl2 } = makePlayer(p2, makeAudioStub());
  pl2.seekBeat(1000);
  assert.equal(pl2.beat, 64, '无音频 → 钳 totalBeats=64（纯编舞排练语义保留）');
});
test('seekBeat stage 显式钩子：有音频资产同样钳音乐域（与 music 一致，用户指令）', () => {
  const p = stoneProject();
  const { p: pl } = makePlayer(p, makeAudioStub(), { mode: 'stage' });
  pl.seekBeat(1000);
  assert.equal(pl.beat, 128);
});

// ---------- D3/R1②：ended 终点域 ----------
test('music 模式虚拟时钟：越过音乐域尾（128 拍）才 ended，停域尾；编舞域 64 拍不再提前掐断', () => {
  const p = stoneProject();
  const { p: pl, events } = makePlayer(p, makeAudioStub(), { mode: 'music' });
  pl.play(0, { forceVirtual: true });
  advance(pl, 33 * 1000); // 33s > 32s 编舞域——HEAD 在此 ended，现在必须继续走
  assert.equal(pl.playing, true, '33s 未结束（音乐域 64s）');
  assert.equal(events.states.filter(s => s.ended).length, 0, '无 ended 误报（E58-05 根除）');
  advance(pl, 40 * 1000); // 累计 73s > 64s
  assert.equal(pl.playing, false, '域尾终态');
  const last = events.states.at(-1);
  assert.equal(last.ended, true);
  assert.equal(pl.beat, 128, '停在音乐域尾拍（64s 换算）');
  assert.equal(pl._audioEnded, false, 'music 无虚拟接管语义');
});
test('music 模式 _finish（音频自然放完）：ended 且无 _audioEnded 接管，播放头钳域内', () => {
  const p = stoneProject();
  const { p: pl, events } = makePlayer(p, makeAudioStub(), { mode: 'music' });
  pl._clipsActive = false;
  pl._finish(true, 64);
  assert.equal(events.states.at(-1).ended, true);
  assert.equal(pl._audioEnded, false, '音频放完=干净终态（无 reason:audio 接管）');
  assert.ok(pl.beat <= 128, '播放头钳在域内');
});
// build-51-stageux F1（用户指令改写）：stage 有音频资产 → 播放直达音乐尾（与 music 一致：
// 33s 不被 blocks 域掐断、域尾终态、无虚拟接管）；_finish 音频先完=干净终态（reason:audio）。
// 原「stage blocks 域 ended + 虚拟接管」断言随用户指令退役；无音频口径在 tests/stageux.test.js 钉。
test('stage 有音频资产：33s 处继续走（编舞域不再提前掐断）；越过音乐域尾（128 拍）才 ended', () => {
  const p = stoneProject();
  const { p: pl, events } = makePlayer(p, makeAudioStub(), { mode: 'stage' });
  pl.play(0, { forceVirtual: true });
  advance(pl, 33 * 1000); // 33s > 32s 编舞域——旧行为在此 ended，现必须继续走（用户指令）
  assert.equal(pl.playing, true, '33s 未结束（音乐域 64s——两模式一致）');
  assert.equal(events.states.filter(s => s.ended).length, 0, '无 ended 误报');
  advance(pl, 40 * 1000); // 累计 73s > 64s
  assert.equal(pl.playing, false, '域尾终态');
  const last = events.states.at(-1);
  assert.equal(last.ended, true);
  assert.equal(pl.beat, 128, '停在音乐域尾拍（64s 换算）');
  assert.equal(pl._audioEnded, false, '有音频资产无虚拟接管语义（与 music 一致）');
});
test('stage 有音频资产 _finish（音频自然放完）：ended reason:audio、播放头钳域内、无虚拟接管', () => {
  const p = stoneProject();
  const { p: pl, events } = makePlayer(p, makeAudioStub(), { mode: 'stage' });
  pl._clipsActive = false;
  pl._finish(true, 20); // 音频 20s 先完（< blocks 32s）
  assert.equal(events.states.at(-1).ended, true);
  assert.equal(events.states.at(-1).reason, 'audio');
  assert.equal(pl._audioEnded, false, '音频放完=播放整体终态（直达音乐尾语义，无接管）');
  assert.equal(pl.beat, 40, '播放头钳在音频末拍 20s=40 拍');
});
test('stage 无音频资产：编舞域 32s 照旧 ended；_finish 虚拟接管语义保留（round30 #7）', () => {
  const p = stoneProject();
  p.media = { assets: [], activeAssetId: null };
  p.timeline.audioClips = [];
  const { p: pl, events } = makePlayer(p, makeAudioStub(), { mode: 'stage' });
  pl.play(0, { forceVirtual: true });
  advance(pl, 33 * 1000);
  assert.equal(pl.playing, false, '无音频 → 编舞域 32s 照旧 ended');
  assert.equal(pl.beat, 64, '停在 totalBeats（任务#6 终态统一不变）');

  const p2 = stoneProject();
  p2.media = { assets: [], activeAssetId: null };
  p2.timeline.audioClips = [];
  const { p: pl2, events: ev2 } = makePlayer(p2, makeAudioStub(), { mode: 'stage' });
  pl2._finish(true, 20); // 音频 20s 先完，编舞域 32s（理论路径：无资产项目正常不进音频通道）
  assert.equal(pl2._audioEnded, true, '虚拟接管标记（round30 #7 语义保留）');
  assert.equal(ev2.states.at(-1).reason, 'audio');
  assert.equal(pl2.beat, 40, '钳在音频末拍 20s=40 拍');
});

// ---------- 决策④：播放中改 BPM/首拍 → 秒位不变、拍位重映射 ----------
test('remapBeatToSec：虚拟时钟播放中重定基准——秒位置保持、拍位按新映射', () => {
  const p = stoneProject();
  const { p: pl } = makePlayer(p, makeAudioStub(), { mode: 'music' });
  pl.play(0, { forceVirtual: true });
  advance(pl, 8000); // 走到 ≈16 拍 = 8s（120BPM；定时器分辨率误差 <0.01 拍）
  assert.ok(Math.abs(pl.beat - 16) < 0.01, `beat≈16（实际 ${pl.beat}）`);
  const secBefore = beatToSec(p, pl.beat); // 8s
  p.audio.bpm = 240; // 模拟 mutate 后
  pl.remapBeatToSec(secBefore);
  assert.equal(Math.abs(beatToSec(p, pl.beat) - secBefore) < 1e-9, true, '秒位置不变');
  assert.ok(Math.abs(pl.beat - 32) < 0.01, `8s @240BPM = 32 拍（重映射；实际 ${pl.beat}）`);
  // 继续播放：从新基准按新 BPM 推进（手动快进一帧，避免真实定时器空转）
  pl._virtual.t0 -= 1000;
  const b0 = pl.beat;
  pl._tick();
  assert.ok(pl.beat > b0, '续走不回跳');
  pl.pause();
});
test('remapBeatToSec：非播放/非虚拟时钟=无操作（音频通道天然秒位不变，无需处理）', () => {
  const p = stoneProject();
  const { p: pl } = makePlayer(p, makeAudioStub(), { mode: 'music' });
  pl.beat = 50;
  pl.remapBeatToSec(25); // 未播放
  assert.equal(pl.beat, 50, '停止态不动');
  pl.play(10, { forceVirtual: true });
  pl._virtual = null; // 模拟音频通道（_clipsActive 路径，node 无 WebAudio 用置空近似）
  pl.beat = 20;
  pl.remapBeatToSec(10);
  assert.equal(pl.beat, 20, '音频通道路径不改写 beat（由 _tick 秒反推）');
  pl.pause();
});

// ---------- D4：划分域 override ----------
test('sectionSegmentsOf endBeatOverride：music 域 128 拍——末段延到音频末；缺省=现状 totalBeats', () => {
  const p = stoneProject();
  p.timeline.tags = [{ id: 't1', beat: 0, name: 'A' }, { id: 't2', beat: 32, name: 'B' }];
  const dft = sectionSegmentsOf(p);
  assert.equal(dft.totalBeats, 64, '缺省末段终点=totalBeats（编舞零变化）');
  assert.equal(dft.segs.at(-1).end, 64);
  const ov = sectionSegmentsOf(p, secToBeat(p, musicDomainSec(p)));
  assert.equal(ov.totalBeats, 128, 'override=音乐域换算拍');
  assert.equal(ov.segs.at(-1).end, 128, '末段 B 延到 128 拍（64s）——音频后半可划分');
  assert.equal(ov.segs.length, 2, '段数不变');
});
test('sectionSegmentsOf override 非法值回退现状（0/负/NaN/Infinity → totalBeats）', () => {
  const p = stoneProject();
  p.timeline.tags = [{ id: 't1', beat: 0, name: 'A' }];
  for (const bad of [0, -5, NaN, Infinity, 'x']) {
    const r = sectionSegmentsOf(p, bad);
    assert.equal(r.totalBeats, 64, `bad=${bad}`);
  }
});
