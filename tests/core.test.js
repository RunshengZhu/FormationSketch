// wuzhen-core 单元测试（Phase 0 验收）
// 覆盖：
//   1) 直接 import js/ 源码测核心行为（建项目/队形/合并/校验）——与 app 同源零漂移；
//   2) 新增纯函数 toSVG / diffFormations / feasibility（js/choreo-extra.js）；
//   3) build-core 产物 dist/core/wuzhen-core.mjs 可 import、导出齐全、行为与源一致。
// 零依赖，node --test tests/core.test.js 可跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as modelNS from '../js/model.js';
import * as shapesNS from '../js/shapes.js';
import * as extraNS from '../js/choreo-extra.js';
import {
  createProject, validateProject, addMerge, removeMerge, findMerge, collapseUnit,
  expandUnits, ensureFormationComplete, clone,
} from '../js/model.js';
import { genSlots, applySlots, mirrorH, SHAPE_KINDS } from '../js/shapes.js';
import { toSVG, diffFormations, feasibility } from '../js/choreo-extra.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = { widthM: 12, depthM: 16, audience: 'bottom' };
const ROLE_FILL_M = '#3b82f6', ROLE_FILL_F = '#ec4899'; // ROLE_COLOR.M/.F（ROLE_COLOR 亦随 core 导出）

// ---------- 1) 核心行为（js/ 源码直测） ----------
test('createProject：12 人 6 单元（presetMerged 演练种子形态）', () => {
  const p = createProject({ title: '演练', pairs: 6, presetMerged: true });
  assert.equal(p.dancers.length, 12);
  assert.equal(p.formations.length, 1);
  assert.equal(p.groups.length, 2); // 男士/女士
  const f = p.formations[0];
  assert.equal(f.merges.length, 6, '6 对全部合并');
  assert.ok(f.merges.every(m => m.style === 'capsule'));
  ensureFormationComplete(p, f);
  assert.deepEqual(Object.keys(f.positions).sort(), p.dancers.map(d => d.id).sort());
  // 收拢后每单元两人重合
  for (const m of f.merges) {
    const a = f.positions[m.a], b = f.positions[m.b];
    assert.equal(a.x, b.x); assert.equal(a.y, b.y);
  }
  // build-70：syncTimeline 退役——clip 字段驻队形（createProject 即 [0,16) 缺省，无独立同步步）
  assert.equal(p.formations[0].startBeat, 0);
  assert.equal(p.formations[0].lenBeats, 16);
});

test('genSlots/applySlots/mirrorH：与 app 同源的基础行为', () => {
  for (const kind of SHAPE_KINDS) {
    const pts = genSlots(kind, 12, stage);
    assert.equal(pts.length, 12, kind);
    for (const pt of pts) {
      assert.ok(pt.x >= -0.01 && pt.x <= stage.widthM + 0.01, `${kind} x 越界`);
      assert.ok(pt.y >= -0.01 && pt.y <= stage.depthM + 0.01, `${kind} y 越界`);
    }
  }
  const p = createProject({ pairs: 6, presetMerged: true });
  const src = p.formations[0];
  const f2 = { name: '圆', positions: {}, merges: clone(src.merges) };
  applySlots(f2, p.dancers.map(d => d.id), genSlots('circle', 12, stage), { current: src.positions });
  assert.equal(Object.keys(f2.positions).length, 12);
  const before = clone(f2.positions);
  mirrorH(f2, stage);
  for (const [id, q] of Object.entries(f2.positions)) {
    assert.equal(q.x, Math.round((stage.widthM - before[id].x) * 100) / 100, id);
    assert.equal(q.facing, (360 - before[id].facing) % 360, `${id} facing 镜像`);
  }
});

test('合并原子：addMerge 替换语义 / collapseUnit / expandUnits / findMerge', () => {
  const f = {
    positions: {
      a: { x: 2, y: 2, facing: 180 }, b: { x: 5, y: 2, facing: 180 }, c: { x: 8, y: 2, facing: 180 },
    },
  };
  const m = addMerge(f, 'a', 'b', 'capsule');
  assert.ok(m && findMerge(f, 'b', 'a') === m, 'mergeKey 与方向无关');
  // 替换语义：a 与 c 合并时，旧 a×b 自动解除（一人同时只属一个单元）
  addMerge(f, 'a', 'c', 'single');
  assert.equal(findMerge(f, 'a', 'b'), null);
  assert.equal(f.merges.length, 1);
  assert.equal(f.merges[0].style, 'single');
  assert.deepEqual(expandUnits(f, ['a']), ['a', 'c'], '单元原子展开');
  assert.deepEqual(expandUnits(f, ['b']), ['b'], '非单元成员原样');
  // 重新 a×b（替换 a×c）并收拢到中点
  addMerge(f, 'a', 'b', 'capsule');
  assert.equal(f.merges.length, 1);
  collapseUnit(f, 'a', 'b');
  assert.equal(f.positions.a.x, 3.5);
  assert.deepEqual([f.positions.a.x, f.positions.a.y], [f.positions.b.x, f.positions.b.y]);
  removeMerge(f, 'a', 'b');
  assert.equal(f.merges.length, 0);
});

test('validateProject：合法项目 ok；坏数据被清洗；未知版本报错', () => {
  const p = createProject({ pairs: 2, presetMerged: true });
  const good = validateProject(clone(p));
  assert.equal(good.ok, true, good.errors?.join('; '));
  // 坏数据：悬挂 merge（引用不存在舞者）+ 非有限坐标 + 非法朝向
  const bad = clone(p);
  bad.formations[0].merges.push({ a: 'ghost', b: p.dancers[0].id, style: 'capsule' });
  bad.formations[0].positions[p.dancers[0].id] = { x: NaN, y: Infinity, facing: 400 };
  const fixed = validateProject(bad);
  assert.equal(fixed.ok, true, '可清洗的坏数据不算硬错误');
  assert.ok(!fixed.project.formations[0].merges.some(m => m.a === 'ghost'), '悬挂 merge 被清除');
  const d0 = fixed.project.formations[0].positions[p.dancers[0].id];
  assert.ok(!d0 || (Number.isFinite(d0.x) && d0.facing === 40), '非有限坐标被丢弃、朝向归一化');
  // 未知版本 → 硬错误
  const v99 = validateProject({ version: 99 });
  assert.equal(v99.ok, false);
});

// ---------- 2) 新增纯函数 ----------
test('toSVG：含 svg 根/舞台边界/单元符号/short 标签等关键元素', () => {
  const p = createProject({ title: 'SVG', pairs: 3, presetMerged: true });
  const f = p.formations[0];
  const svg = toSVG(f, { stage: p.stage, dancers: p.dancers });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'svg 根与命名空间');
  assert.ok(svg.includes('viewBox='), 'viewBox');
  assert.ok(svg.includes('<rect'), '舞台边界矩形');
  assert.ok(svg.trimEnd().endsWith('</svg>'), '闭合');
  // capsule 单元：圆角矩形双半色 + 双 short 标签（M_i/F_i 共享 short=i）
  assert.ok(svg.includes('rx='), 'capsule 圆角');
  assert.ok(svg.includes(ROLE_FILL_M) && svg.includes(ROLE_FILL_F), '双半色（M/F 角色色）');
  assert.ok(svg.includes('>1</text>') && svg.includes('>3</text>'), 'short 标签');
  // single 单元：单圆 + 虚线外环
  const fs = clone(f);
  fs.merges[0].style = 'single';
  const svgSingle = toSVG(fs, { stage: p.stage, dancers: p.dancers });
  assert.ok(svgSingle.includes('stroke-dasharray="4 3"'), 'single 虚线外环');
  // unitStyle 覆盖：全部按 single 画
  const svgOverride = toSVG(f, { stage: p.stage, dancers: p.dancers, unitStyle: 'single' });
  assert.ok(svgOverride.includes('stroke-dasharray="4 3"'));
  // 拉伸的合并（两人距离 > 0.8m）：两圆 + 虚线绑定（capsule 基线无 circle 元素）
  const fstr = clone(f);
  const [m0] = fstr.merges;
  fstr.positions[m0.b] = { x: fstr.positions[m0.a].x + 3, y: fstr.positions[m0.a].y, facing: 180 };
  const svgStretch = toSVG(fstr, { stage: p.stage, dancers: p.dancers });
  assert.ok(svgStretch.includes('stroke-dasharray="3 4"'), '拉伸合并的虚线绑定');
  assert.equal(svgStretch.split('<circle').length - 1, svg.split('<circle').length - 1 + 2, '拆出两个独立圆');
  // 转义：short 含 XML 特殊字符
  const p2 = createProject({ pairs: 1 });
  p2.dancers[0].short = 'a<b';
  const svgEsc = toSVG(p2.formations[0], { stage: p2.stage, dancers: p2.dancers });
  assert.ok(svgEsc.includes('a&lt;b') && !svgEsc.includes('a<b'), 'XML 转义');
});

test('diffFormations：移动量精确数值 + 增删人员', () => {
  const a = { positions: { d1: { x: 0, y: 0 }, d2: { x: 1, y: 1 }, dx: { x: 9, y: 9 } } };
  const b = { positions: { d1: { x: 3, y: 4 }, d2: { x: 1, y: 1 }, dn: { x: 0, y: 0 } } };
  const d = diffFormations(a, b);
  assert.equal(d.moved.length, 1);
  assert.deepEqual(d.moved[0], { id: 'd1', from: { x: 0, y: 0 }, to: { x: 3, y: 4 }, dist: 5 });
  assert.equal(d.maxDist, 5);
  assert.equal(d.totalDist, 5);
  assert.deepEqual(d.addedIds, ['dn']);
  assert.deepEqual(d.removedIds, ['dx']);
  // 小于 eps（默认 1cm）的抖动不计入；eps 可调
  const c = { positions: { d1: { x: 0.005, y: 0 } } };
  assert.equal(diffFormations(a, c).moved.length, 0);
  assert.equal(diffFormations(a, c, { eps: 0.001 }).moved.length, 1);
  // 多人按距离降序稳定排序
  const m2 = diffFormations(
    { positions: { p: { x: 0, y: 0 }, q: { x: 0, y: 0 } } },
    { positions: { p: { x: 1, y: 0 }, q: { x: 0, y: 2 } } },
  );
  assert.deepEqual(m2.moved.map(x => x.id), ['q', 'p']);
  assert.equal(m2.totalDist, 3);
});

test('feasibility：距离/拍数/cap 的精确边界', () => {
  const a = { positions: { d1: { x: 0, y: 0 } } };
  const b = { positions: { d1: { x: 3, y: 4 } } }; // 需移动 5m
  // 默认 cap=1.2：5 拍可走 6m → ok，负荷 5/6≈0.83
  const r1 = feasibility(a, b, 5, 120);
  assert.equal(r1.maxNeededDist, 5);
  assert.equal(r1.beats, 5);
  assert.equal(r1.ok, true);
  assert.equal(r1.score, 0.83);
  // 恰好压线：cap×beats = 5 → ok（含浮点容差）
  const r2 = feasibility(a, b, 5 / 1.2, 120, 1.2);
  assert.equal(r2.ok, true);
  assert.equal(r2.score, 1);
  // 超限：2 拍只能走 2.4m
  const r3 = feasibility(a, b, 2, 120);
  assert.equal(r3.ok, false);
  assert.equal(r3.score, 2.08);
  // 0 拍且需移动 → 不可行，score ∞
  const r4 = feasibility(a, b, 0, 120);
  assert.equal(r4.ok, false);
  assert.equal(r4.score, Infinity);
  // 原地不动 → 恒可行
  const r5 = feasibility(a, a, 0, 120);
  assert.deepEqual([r5.maxNeededDist, r5.ok, r5.score], [0, true, 0]);
  // 默认 cap = 1.2；非法 bpm 回退 120（secPerBeat=0.5）
  assert.deepEqual(feasibility(a, b, 5), feasibility(a, b, 5, 120, 1.2));
  assert.equal(feasibility(a, b, 5, 0).secPerBeat, 0.5);
  assert.equal(feasibility(a, b, 5, 120).availableDist, 6);
});

// ---------- 3) build-core 产物：可 import、导出齐全、行为同源 ----------
test('build-core 产物 dist/core/wuzhen-core.mjs', async () => {
  const build = spawnSync(process.execPath, ['scripts/build-core.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(build.status, 0, `build-core 失败：${build.stderr}`);
  const core = await import(pathToFileURL(join(ROOT, 'dist/core/wuzhen-core.mjs')) + `?t=${Date.now()}`);
  // 导出齐全：三个源模块的全部导出都在产物中，且总数一致（不多不少）
  for (const name of Object.keys(modelNS)) assert.ok(name in core, `产物缺 model 导出 ${name}`);
  for (const name of Object.keys(shapesNS)) assert.ok(name in core, `产物缺 shapes 导出 ${name}`);
  for (const name of Object.keys(extraNS)) assert.ok(name in core, `产物缺 choreo-extra 导出 ${name}`);
  assert.equal(
    Object.keys(core).length,
    Object.keys(modelNS).length + Object.keys(shapesNS).length + Object.keys(extraNS).length,
    '导出总数一致',
  );
  // 行为同源：同输入 → 同输出（toSVG 确定性、feasibility/diffFormations 数值、项目形态）
  const p = createProject({ pairs: 6, presetMerged: true });
  assert.equal(
    core.toSVG(p.formations[0], { stage: p.stage, dancers: p.dancers }),
    toSVG(p.formations[0], { stage: p.stage, dancers: p.dancers }),
    'toSVG 与源逐字节一致',
  );
  const a = { positions: { x: { x: 0, y: 0 } } }, b = { positions: { x: { x: 3, y: 4 } } };
  assert.deepEqual(core.feasibility(a, b, 5, 120), feasibility(a, b, 5, 120));
  assert.deepEqual(core.diffFormations(a, b), diffFormations(a, b));
  const pc = core.createProject({ pairs: 6, presetMerged: true });
  assert.equal(pc.dancers.length, 12);
  assert.equal(pc.formations[0].merges.length, 6);
  const v = core.validateProject(clone(pc));
  assert.equal(v.ok, true);
});
