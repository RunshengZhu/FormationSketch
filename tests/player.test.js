// player.js 状态机回归：循环×预览叠加、数拍入场竞态
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createFormationFrom, computeSegments } from '../js/model.js';
import { Player } from '../js/player.js';

function makePlayer(project) {
  const p = new Player({
    audio: { ready: false, click: () => {}, duration: 0 },
    getProject: () => project,
    onTick: () => {},
    onStateChange: () => {},
    onCountin: () => {},
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
  project.timeline.countInBeats = 0;
  const { segments } = computeSegments(project);
  // 在队形2段（index1）上开启循环
  const loopSeg = segments[1];
  const p = makePlayer(project);
  p.setLoop(true, loopSeg.holdStart, loopSeg.travelEnd);
  // 预览最后一段过渡（index2 → 结束）：起点在 loop 区间之后
  const target = segments[2];
  p.play(target.holdStart, { previewStop: target.travelEnd, countIn: false, forceVirtual: true });
  // 快进驱动 tick：每次 500ms，最多 200 次
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.playing, false, '预览应结束');
  assert.equal(p.beat, target.travelEnd, '停在预览终点');
  assert.ok(project.__previewEnds >= 1, 'onPreviewEnd 触发');
  // 循环在预览结束后恢复
  assert.equal(p.loopOn, true);
  assert.equal(p.loopStart, loopSeg.holdStart);
  assert.equal(p.loopEnd, loopSeg.travelEnd);
  p.stop();
});

test('预览起点在循环区间内：循环被挂起，预览照常结束', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  createFormationFrom(project, 1);
  project.timeline.countInBeats = 0;
  const { segments } = computeSegments(project);
  const loopSeg = segments[0];
  const p = makePlayer(project);
  p.setLoop(true, loopSeg.holdStart, loopSeg.travelEnd);
  // 预览段1→2（起点 24 拍，位于 loop [0,24) 之外但下一 tick 即 >= loopEnd）
  const target = segments[1];
  p.play(target.holdStart, { previewStop: target.travelEnd, countIn: false, forceVirtual: true });
  for (let i = 0; i < 200 && p.playing; i++) advance(p, 500);
  assert.equal(p.playing, false, '预览应结束（未被循环拉回）');
  assert.ok(project.__previewEnds >= 1);
  p.stop();
});

test('数拍入场进行中再次 play：旧入场被取消，不产生双时钟', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 4;
  const p = makePlayer(project);
  p.play(0); // 触发数拍入场
  assert.equal(p.countin, true);
  assert.ok(p._ciTimer, '入场定时器存在');
  // 入场未结束时再次启动预览
  p.play(8, { previewStop: 16, countIn: false, forceVirtual: true });
  assert.equal(p._ciTimer, null, '旧入场定时器被清理');
  assert.equal(p.countin, false);
  assert.equal(p.playing, true);
  assert.ok(Math.abs(p.beat - 8) < 0.01, `beat≈8, got ${p.beat}`);
  p.stop();
});

test('预览中 stop()：循环恢复且状态清零', () => {
  const project = createProject({ pairs: 1 });
  createFormationFrom(project, 0);
  project.timeline.countInBeats = 0;
  const { segments } = computeSegments(project);
  const p = makePlayer(project);
  p.setLoop(true, segments[0].holdStart, segments[0].travelEnd);
  p.play(segments[0].holdStart, { previewStop: segments[0].travelEnd, countIn: false, forceVirtual: true });
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
  project.timeline.countInBeats = 0;
  const p = makePlayer(project);
  p.setSpeed(1);
  p.play(0, { countIn: false, forceVirtual: true });
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
