// 时间轴对齐（对齐到播放头）单元测试
// build-70-formationclips M2 改写：alignBlockStart（压上一块 hold/改过渡）随 blocks 模型退役——
// 对齐=alignFormationClipStart：选中 clip 的 start 整段平移到目标拍（moveFormationClip 邻界钳制：
// 不越左右邻 clip、长度不变；空隙自动成为变换段）。返回对齐后的实际 start（UI toast 汇报钳制结果）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, createFormationFrom, alignFormationClipStart,
  clipStartOf, clipLenOf, clipEndOf, segmentsFromClips, beatToSec,
} from '../js/model.js';

// 夹具：3 clip [0,16) / [24,40) / [48,64)（clip0↔1 空隙 8、clip1↔2 空隙 8）
function gapProject() {
  const p = createProject({ pairs: 1 });
  createFormationFrom(p, 0); // [16,32)
  createFormationFrom(p, 1); // [32,48)
  p.formations[1].startBeat = 24;
  p.formations[2].startBeat = 48;
  return p;
}

test('alignFormationClipStart：clip 起点对齐到目标拍（空隙内平移、长度不变）', () => {
  const p = gapProject();
  // 初始：clip1 起点 24。对齐到 30（界内 [16, 48−16]= [16,32]）→ 空隙0 变 14
  const got = alignFormationClipStart(p, 1, 30);
  assert.equal(got, 30, '返回实际 start（未钳制=目标值）');
  assert.equal(clipStartOf(p.formations[1]), 30);
  const { segments } = segmentsFromClips(p.formations);
  assert.equal(segments[1].start, 30, '段起点=30（旧 holdStart 换源）');
  // clip 长度不变（旧「hold 不变」断言换源）
  assert.equal(clipLenOf(p.formations[1]), 16);
});

test('alignFormationClipStart：目标越左/右邻界 → 钳到界内最近位（不交叉）', () => {
  const p = gapProject();
  // 目标 10 < 左邻 clip0.end=16 → 钳到 16（空隙 0，贴合）
  assert.equal(alignFormationClipStart(p, 1, 10), 16, '钳到左邻界（空隙收缩为 0，不再压上一块 hold）');
  assert.equal(clipStartOf(p.formations[1]), 16);
  // 目标 90 > 右邻界 hi−len=48−16=32 → 钳到 32（不越右邻 start）
  assert.equal(alignFormationClipStart(p, 1, 90), 32, '钳到右邻界');
  assert.equal(clipEndOf(p.formations[1]), 48, 'end 不越右邻 start=48');
  // 邻 clip 数据一个字节不动（旧「过渡被改写」机制退役的模型级保证）
  assert.equal(clipStartOf(p.formations[0]), 0);
  assert.equal(clipLenOf(p.formations[0]), 16);
  assert.equal(clipStartOf(p.formations[2]), 48);
});

test('alignFormationClipStart：越界索引拒绝；clip0 也是一等 clip（界内可平移）', () => {
  const p = gapProject();
  const before = JSON.stringify(p.formations.map(f => [f.startBeat, f.lenBeats]));
  assert.equal(alignFormationClipStart(p, 99, 5), null, '越界索引 → null');
  assert.equal(JSON.stringify(p.formations.map(f => [f.startBeat, f.lenBeats])), before, '越界调用零写入');
  // clip0：lo=0、hi=右邻 start=24 → maxStart=24−16=8；对齐 5 → 5（候场区收缩）
  assert.equal(alignFormationClipStart(p, 0, 5), 5, 'clip0 可在界内平移（clip 一等对象语义）');
  assert.equal(clipStartOf(p.formations[0]), 5);
});

test('alignFormationClipStart 后段起点严格递增（秒换算单调）', () => {
  const p = gapProject();
  alignFormationClipStart(p, 1, 30);
  const { segments } = segmentsFromClips(p.formations);
  for (let i = 1; i < segments.length; i++) {
    assert.ok(beatToSec(p, segments[i].start) > beatToSec(p, segments[i - 1].start));
  }
});
