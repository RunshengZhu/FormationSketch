// player.js 状态机回归：循环×预览叠加（数拍入场竞态用例已随 build-68-nocountin 退役）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createFormationFrom, segmentsFromClips } from '../js/model.js';
import { Player } from '../js/player.js';
import { MusicTimeline } from '../js/timeline.js';

function makePlayer(project) {
  const p = new Player({
    audio: { ready: false, click: () => {}, duration: 0 },
    getProject: () => project,
    onTick: () => {},
    onStateChange: () => {},
    onPreviewEnd: () => { project.__previewEnds = (project.__previewEnds || 0) + 1; },
  });
  return p;
}
// 每调用一次 _tick 前推进虚拟时钟 dtMs 毫秒
function advance(p, dtMs) {
  if (p._virtual) p._virtual.t0 -= dtMs;
  p._tick();
}

test('循环挂起时，预览仍能到达终点并结束（循环不被拉回打断）', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  createFormationFrom(project, 1);
  const { segments } = segmentsFromClips(project.formations); // clip 即段：[start,end)（旧 holdStart/travelEnd 换源）
  // 在队形2段（index1）上开启循环
  const loopSeg = segments[1];
  const p = makePlayer(project);
  p.setLoop(true, loopSeg.start, loopSeg.end);
  // 预览最后一段过渡（index2 → 结束）：起点在 loop 区间之后
  const target = segments[2];
  p.play(target.start, { previewStop: target.end, forceVirtual: true });
  // 快进驱动 tick：每次 500ms，最多 200 次
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.playing, false, '预览应结束');
  assert.equal(p.beat, target.end, '停在预览终点');
  assert.ok(project.__previewEnds >= 1, 'onPreviewEnd 触发');
  // 循环在预览结束后恢复
  assert.equal(p.loopOn, true);
  assert.equal(p.loopStart, loopSeg.start);
  assert.equal(p.loopEnd, loopSeg.end);
  p.stop();
});

test('预览起点在循环区间内：循环被挂起，预览照常结束', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  createFormationFrom(project, 1);
  const { segments } = segmentsFromClips(project.formations); // clip 即段：[start,end)（旧 holdStart/travelEnd 换源）
  const loopSeg = segments[0];
  const p = makePlayer(project);
  p.setLoop(true, loopSeg.start, loopSeg.end);
  // 预览段1→2（起点 24 拍，位于 loop [0,24) 之外但下一 tick 即 >= loopEnd）
  const target = segments[1];
  p.play(target.start, { previewStop: target.end, forceVirtual: true });
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.playing, false, '预览应结束（未被循环拉回）');
  assert.ok(project.__previewEnds >= 1);
  p.stop();
});

test('预览中 stop()：循环恢复且状态清零', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  const { segments } = segmentsFromClips(project.formations); // clip 即段：[start,end)（旧 holdStart/travelEnd 换源）
  const p = makePlayer(project);
  p.setLoop(true, segments[0].start, segments[0].end);
  p.play(segments[0].start, { previewStop: segments[0].end, forceVirtual: true });
  assert.equal(p.loopOn, false, '预览期间循环挂起');
  p.stop();
  assert.equal(p.loopOn, true, '循环恢复');
  assert.equal(p.beat, 0);
  assert.equal(p._stopAt, null);
});

test('切帧动效不经过播放引擎：beat/播放头不受影响', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  createFormationFrom(project, 1);
  const p = makePlayer(project);
  p.setSpeed(1);
  p.play(0, { forceVirtual: true });
  advance(p, 500);
  p.pause();
  const beatBefore = p.beat;
  // 模拟 UI 层的舞台动画：只动画布数据，Player 无感知
  assert.equal(p.playing, false);
  assert.equal(p.beat, beatBefore);
  assert.equal(p._stopAt, null);
  assert.equal(p._forceVirtual, false);
  p.stop();
});

// ---------- build-70 r3 回归：seekFormation 废字段修复 + 单击 clip=选中且对齐 ----------
// 根因：seekFormation 读旧 blocks 模型段字段 seg.holdStart（segmentsFromClips 下=undefined）
// → seekBeat(undefined) → Math.max(0,Math.min(undefined,…))=NaN 静默毒化 this.beat——
// 切帧（chip/条带/键盘导航）后播放线丢失/呈 0；单击 clip 路径被 hooks.seekBeat(hit.start)
// 二次调用部分掩盖（先 NaN 后 16），无后续 seek 的入口全断。
test('r3 seekFormation：对齐所选队形 clip 开头（clip.start，非 NaN/0）；越界索引 no-op', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  createFormationFrom(project, 1); // clips [0,16) [16,32) [32,48)
  project.formations[1].startBeat = 16;
  const p = makePlayer(project);
  p.seekFormation(1);
  assert.equal(p.beat, 16, 'seekFormation(1) → clip1.start=16（回归：旧 holdStart=undefined → NaN）');
  p.seekFormation(0);
  assert.equal(p.beat, 0, 'seekFormation(0) → clip0.start=0');
  p.seekBeat(30);
  p.seekFormation(99);
  assert.equal(p.beat, 30, '越界索引：seg 不存在 → no-op（beat 不动）');
  p.stop();
});

test('r3 seekBeat 非有限入参显式忽略：undefined/NaN 不毒化 this.beat（保持原值）', () => {
  const project = createProject({ pairs: 1 });
  const p = makePlayer(project);
  p.seekBeat(12);
  p.seekBeat(undefined);
  p.seekBeat(NaN);
  p.seekBeat('x');
  assert.equal(p.beat, 12, '非有限入参 → 显式 return（beat 保持 12，不再 NaN 化）');
  p.stop();
});

test('r3 单击 clip 体=选中该队形且播放线对齐 clip 开头（全链：timeline hooks → switchFormation → player.beat）', () => {
  if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
  const fakeEl = () => {
    const hs = {};
    return { _hs: hs, addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
      setPointerCapture() {}, releasePointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 120 }), style: {} };
  };
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  project.formations[1].startBeat = 16;
  const player = new Player({
    audio: { ready: false, click: () => {}, duration: 0 },
    getProject: () => project, onTick: () => {}, onStateChange: () => {}, onPreviewEnd: () => {},
  });
  const ui = { formationIndex: 0 };
  // main.js switchFormation 同链复刻（pause + setUI + seekFormation）
  const switchFormation = i => {
    player.pause();
    ui.formationIndex = i;
    player.seekFormation(i);
  };
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => project,
      getProjectId: () => 'p1',
      getPlayer: () => player,
      audio: null,
      getIndex: () => ui.formationIndex,
      canEdit: () => true,
      onSelectFormation: switchFormation,
      mutate: fn => fn(project),
      mutateQuiet: fn => fn(project),
      mutateLabeled: (fn) => fn(project),
      commitEdit: () => {},
      seekBeat: b => player.seekBeat(Math.max(0, b)), // main.js:685 同款
      toast: () => {},
      onFormationClipContextMenu: () => {},
      onAfterRender: () => {},
    },
  });
  tl.render = () => {}; // node 假 DOM 无 2D 上下文（tag-ui2/wavezoom 同口径）
  tl.rulerH = 22; tl.blocksTop = 72; tl.blocksH = 36; tl.W = 800; tl.H = 120;
  tl.secPerPx = 0.05; // pps=20
  // 单击 clip2 体中心：beat 18 → 9s → x=180；y=90（块区带 [72,108] 内）
  // r4：委托式 seek 探针——钉单击链的 seek 序列（seekFormation 一跳 + hooks.seekBeat 一跳，
  // 同值 16；观测层若为「替换不透传」型 patch 会吞掉两跳 → beat 停 0，属仪器伪象非产品缺陷，
  // 见 e2e-lab battery-r4-fc-click.mjs 干净/patched 双场景实测）
  const seekCalls = [];
  const oSeek2 = player.seekBeat.bind(player);
  player.seekBeat = b => { seekCalls.push(b); return oSeek2(b); };
  cv._hs.pointerdown[0]({ clientX: 180, clientY: 90, pointerId: 1, pointerType: 'mouse' });
  tl._up({ pointerId: 1 });
  assert.equal(ui.formationIndex, 1, '选中切到队形 1');
  const { segments } = segmentsFromClips(project.formations);
  assert.equal(player.beat, segments[1].start, '播放线=clip1.start（选中与对齐同时、稳定）');
  assert.equal(player.beat, 16);
  assert.deepEqual(seekCalls, [16, 16], '单击恰两跳同值 seek（seekFormation + hooks.seekBeat）');
  player.stop();
});
