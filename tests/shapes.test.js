// shapes.js 单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, orderedDancers } from '../js/model.js';
import {
  genSlots, applySlots, mirrorH, mirrorV, rotateSelected, distributeAxis,
  swapTwo, swapPairPositions, faceAll, angleTo, SHAPE_KINDS,
} from '../js/shapes.js';

const stage = { widthM: 12, depthM: 16, audience: 'bottom' };

test('genSlots：各形状数量与边界', () => {
  for (const kind of SHAPE_KINDS) {
    for (const n of [1, 5, 12, 16]) {
      const pts = genSlots(kind, n, stage);
      assert.equal(pts.length, n, `${kind} n=${n}`);
      for (const p of pts) {
        assert.ok(p.x >= -0.01 && p.x <= stage.widthM + 0.01, `${kind} x 越界 ${p.x}`);
        assert.ok(p.y >= -0.01 && p.y <= stage.depthM + 0.01, `${kind} y 越界 ${p.y}`);
        assert.ok(p.facing >= 0 && p.facing < 360, `${kind} facing`);
      }
    }
  }
});

test('genSlots：圆面向圆心', () => {
  const pts = genSlots('circle', 8, stage, { face: 'center' });
  // 顶部点 (cx, cy-r) 面向下方 = 180
  const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
  assert.equal(top.facing, 180);
  // 生成器自带面向圆心：右侧点面向左（270±）
  const right = pts.reduce((a, b) => (b.x > a.x ? b : a));
  assert.ok(Math.abs(right.facing - 270) < 181 && (right.facing > 180 || right.facing < 360));
});

test('applySlots：唯一映射 + 就近保持', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const slots = genSlots('line', 4, stage);
  const formation = { positions: {} };
  applySlots(formation, ids, slots, {});
  assert.equal(Object.keys(formation.positions).length, 4);
  const xs = Object.values(formation.positions).map(p => p.x).sort((x, y) => x - y);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  // 就近映射：b 在最右侧 → 重新生成时 b 仍映射到最右
  formation.positions.b = { x: stage.widthM - 1, y: 8, facing: 180 };
  applySlots(formation, ids, slots, { current: formation.positions });
  const rightmost = ids.reduce((acc, id) => formation.positions[id].x > formation.positions[acc].x ? id : acc, ids[0]);
  assert.equal(rightmost, 'b');
});

test('mirrorH：x 镜像 + 朝向镜像 + 舞对换位', () => {
  const p = createProject({ pairs: 1 });
  const f = p.formations[0];
  const [l, fo] = orderedDancers(p, 'pair');
  f.positions[l] = { x: 3, y: 5, facing: 30 };
  f.positions[fo] = { x: 4, y: 5, facing: 150 };
  mirrorH(f, p.stage);
  assert.equal(f.positions[l].x, 9); // 12-3
  assert.equal(f.positions[l].facing, 330); // 360-30
  swapPairPositions(f, p);
  assert.equal(f.positions[l].x, 8); // 原 follower 位置 12-4
  assert.equal(f.positions[fo].x, 9);
});

test('mirrorV：前后镜像', () => {
  const p = createProject({ pairs: 1 });
  const f = p.formations[0];
  const [l] = orderedDancers(p, 'pair');
  f.positions[l] = { x: 3, y: 5, facing: 90 };
  mirrorV(f, p.stage);
  assert.equal(f.positions[l].y, 11); // 16-5
  assert.equal(f.positions[l].facing, 90); // 左右朝向不变
});

test('rotateSelected：绕中心旋转 90°', () => {
  const positions = {
    a: { x: 6, y: 6, facing: 0 },
    b: { x: 8, y: 6, facing: 90 },
    c: { x: 2, y: 2, facing: 180 },
  };
  rotateSelected(positions, ['a', 'b'], 90, { x: 6, y: 6 });
  assert.ok(Math.abs(positions.a.x - 6) < 1e-9 && Math.abs(positions.a.y - 6) < 1e-9);
  assert.ok(Math.abs(positions.b.x - 6) < 1e-9 && Math.abs(positions.b.y - 8) < 1e-9, `got ${positions.b.x},${positions.b.y}`);
  assert.equal(positions.b.facing, 180); // 90+90
  assert.equal(positions.c.x, 2); // 未选中不动
});

test('distributeAxis 等间距', () => {
  const positions = {
    a: { x: 0, y: 2 }, b: { x: 0, y: 10 }, c: { x: 0, y: 4 },
  };
  distributeAxis(positions, ['a', 'b', 'c'], 'y');
  assert.deepEqual([positions.a.y, positions.c.y, positions.b.y], [2, 6, 10]);
});

test('swapTwo', () => {
  const f = { positions: { a: { x: 1, y: 1, facing: 0 }, b: { x: 2, y: 2, facing: 90 } } };
  swapTwo(f, 'a', 'b');
  assert.deepEqual(f.positions.a, { x: 2, y: 2, facing: 90 });
});

test('faceAll：面向观众/圆心/舞伴', () => {
  const p = createProject({ pairs: 1 });
  const f = p.formations[0];
  const [l, fo] = orderedDancers(p, 'pair');
  f.positions[l] = { x: 4, y: 6, facing: 0 };
  f.positions[fo] = { x: 8, y: 6, facing: 0 };
  faceAll(f.positions, [l], 'audience', { stage: p.stage, project: p });
  assert.equal(f.positions[l].facing, 180); // 观众在下方
  faceAll(f.positions, [l], 'partner', { stage: p.stage, project: p });
  assert.equal(f.positions[l].facing, 90); // 舞伴在右侧
  faceAll(f.positions, [l], 'center', { stage: p.stage, project: p });
  assert.equal(f.positions[l].facing, 135); // 圆心 (6,8) 在 (4,6) 的右下 45°方向：90+45
});

test('angleTo 约定：0=上 顺时针', () => {
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 0, y: -1 }), 0);
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 1, y: 0 }), 90);
  assert.equal(angleTo({ x: 0, y: 0 }, { x: 0, y: 1 }), 180);
  assert.equal(angleTo({ x: 0, y: 0 }, { x: -1, y: 0 }), 270);
});
