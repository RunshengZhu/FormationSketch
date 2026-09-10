// 时间轴对齐（对齐到播放头）单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createFormationFrom, computeSegments, alignBlockStart, beatToSec } from '../js/model.js';

test('alignBlockStart：把块起点对齐到目标拍（调整前一段过渡）', () => {
  const p = createProject({ pairs: 1 });
  createFormationFrom(p, 0);
  createFormationFrom(p, 1);
  p.timeline.blocks[0].holdBeats = 16; p.timeline.blocks[0].travelBeats = 8;
  p.timeline.blocks[1].holdBeats = 16; p.timeline.blocks[1].travelBeats = 8;
  const { segments } = computeSegments(p);
  // 初始：块1 起点 = 24 拍。对齐到 30 拍 → 过渡0 变为 30-16=14 拍
  assert.ok(alignBlockStart(p, 1, 30, segments));
  assert.equal(p.timeline.blocks[0].travelBeats, 14);
  const segs2 = computeSegments(p).segments;
  assert.equal(segs2[1].holdStart, 30);
  // 块1 hold 不变
  assert.equal(p.timeline.blocks[1].holdBeats, 16);
});

test('alignBlockStart：目标在过渡开始之前 → 压缩上一块 hold 兜底', () => {
  const p = createProject({ pairs: 1 });
  createFormationFrom(p, 0);
  p.timeline.blocks[0].holdBeats = 16; p.timeline.blocks[0].travelBeats = 8;
  const { segments } = computeSegments(p);
  // 目标 10 拍 < holdEnd(16) + 0.5 → hold 压缩
  assert.ok(alignBlockStart(p, 1, 10, segments));
  const segs2 = computeSegments(p).segments;
  assert.ok(segs2[1].holdStart >= 10 - 1e-9);
  assert.ok(p.timeline.blocks[0].holdBeats >= 0.5);
  assert.ok(p.timeline.blocks[0].travelBeats >= 0.5);
});

test('alignBlockStart：块0 与越界索引拒绝', () => {
  const p = createProject({ pairs: 1 });
  createFormationFrom(p, 0);
  const before = JSON.stringify(p.timeline.blocks);
  assert.equal(alignBlockStart(p, 0, 5), false);
  assert.equal(alignBlockStart(p, 99, 5), false);
  assert.equal(JSON.stringify(p.timeline.blocks), before);
});

test('alignBlockStart 后秒换算保持单调', () => {
  const p = createProject({ pairs: 1 });
  createFormationFrom(p, 0);
  alignBlockStart(p, 1, 20);
  const { segments } = computeSegments(p);
  for (let i = 1; i < segments.length; i++) {
    assert.ok(beatToSec(p, segments[i].holdStart) > beatToSec(p, segments[i - 1].holdStart));
  }
});
