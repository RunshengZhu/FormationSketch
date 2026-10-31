// rosterwave.test.js —— Wave1 需求 1/4/5/6（node 单测，无浏览器依赖）：
//   需求 1 sanitizeTags description：非空 trim+slice200 保留 / 空白不落键 / 非法不落键
//     （JSON 往返不新增键，与 sig/bars 同纪律）+ validateProject 入口联动；
//   需求 4 syncPositionsRange：forward/backward/有限 N/越界截断/返回数/facing 保留/缺位跳过
//     （构造 6 队形项目断言 x/y 同步）+ syncForwardPositions 薄包装等价；
//   需求 5 onStageIds：舞台矩形内外样点（含后台/候场/观众区）+ 按名册序；
//   需求 5 生成器 ids 选项：applySlots/genDefaultRows 提供时仅子集动、其余原坐标逐值不变；
//     缺省=现行为（整表替换/全员）；就近映射只在子集内进行；
//   需求 6 admitToFormation：有源队形顺延（最近，同距取更早）/无源中央/已在场 no-op/非法安全；
//   需求 6 名册 toggle 静态断言：getFormationIndex 缺省隐藏、两分支 mutate 语义、
//     .chip/.chip-on 复用、「重新入队」新可用性（缺席>0 且未上场）。
//   附：sanitizeTracks laneH（并行 Wave 字段）数值钳 [24,240] 保留、非法不落键。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject, sanitizeTags, sanitizeTracks, syncForwardPositions, syncPositionsRange,
  onStageIds, admitToFormation, genDefaultRows, removeDancerFromFormation,
  validateProject, clone,
} from '../js/model.js';
import { genSlots, applySlots } from '../js/shapes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiSrc = readFileSync(join(ROOT, 'js', 'ui.js'), 'utf8');

// ---------- 需求 1：sanitizeTags description ----------
test('需求1 sanitizeTags description：非空 trim+slice200；空白/非字符串不落键；幂等往返不新增键', () => {
  const long = 'x'.repeat(250);
  const out = sanitizeTags([
    { id: 'a', beat: 0, name: '主歌', description: '  开场段落  ' },
    { id: 'b', beat: 16, name: '副歌', description: long },
    { id: 'c', beat: 32, name: '间奏', description: '   ' },
    { id: 'd', beat: 48, name: '桥段', description: 42 },
    { id: 'e', beat: 64, name: '尾奏', description: null },
    { id: 'f', beat: 80, name: '无字段' },
  ]);
  assert.equal(out[0].description, '开场段落', 'trim 后保留');
  assert.equal(out[1].description.length, 200, '超长 slice 200');
  for (const k of [2, 3, 4, 5]) {
    assert.ok(!('description' in out[k]), `空/非法不落键（项 ${k}）`);
  }
  // 无 description 的项保持既有 shape 逐值一致（endBeat=同层下一个 tag.beat）
  assert.deepEqual(out[5], { id: 'f', beat: 80, name: '无字段', endBeat: 96 });
  // 幂等 + JSON 往返不新增/不改键
  assert.deepEqual(sanitizeTags(out), out);
  assert.deepEqual(sanitizeTags(JSON.parse(JSON.stringify(out))), out);
});

test('需求1 validateProject 联动：合法 description 载入保留；空白 description 清洗后无键', () => {
  const p = createProject({ pairs: 1 });
  p.timeline.tags = [{ id: 't1', beat: 0, name: '主歌', description: '  副歌前过渡  ' }];
  const r1 = validateProject(p);
  assert.ok(r1.ok, r1.errors?.join('；'));
  assert.equal(r1.project.timeline.tags[0].description, '副歌前过渡');
  r1.project.timeline.tags = [{ id: 't2', beat: 0, name: 'X', description: '   ' }];
  const r2 = validateProject(r1.project);
  assert.ok(r2.ok);
  assert.ok(!('description' in r2.project.timeline.tags[0]), '空 description 不落键');
});

// ---------- 需求 4：syncPositionsRange ----------
// 6 队形项目：队形 0 源占位（x=100+k,y=5+k,facing=180）；队形 i=1..5 占位 x=10i+k,y=20i+k、
// facing=90+i（逐队形不同，用于断言 facing 保留与「未被同步」的逐值对照）。
function mkSix() {
  const p = createProject({ pairs: 2 }); // 4 名舞者 + 初始队形
  const ids = p.dancers.map(d => d.id);
  const f0 = p.formations[0];
  ids.forEach((id, k) => { f0.positions[id] = { x: 100 + k, y: 5 + k, facing: 180 }; });
  for (let i = 1; i <= 5; i++) {
    const f = { id: 'f' + i, name: 'F' + i, positions: {}, merges: [] };
    ids.forEach((id, k) => { f.positions[id] = { x: 10 * i + k, y: 20 * i + k, facing: 90 + i }; });
    p.formations.push(f);
  }
  return { p, ids };
}

test('需求4 syncPositionsRange forward 缺省=全部后续：x/y 同步、facing 保留、返回 {formations:5}', () => {
  const { p, ids } = mkSix();
  const r = syncPositionsRange(p, 0, [ids[1]]);
  assert.deepEqual(r, { formations: 5, dancers: 1 });
  for (let i = 1; i <= 5; i++) {
    const pos = p.formations[i].positions[ids[1]];
    assert.equal(pos.x, 101, `队形 ${i} x=源值`);
    assert.equal(pos.y, 6, `队形 ${i} y=源值`);
    assert.equal(pos.facing, 90 + i, `队形 ${i} facing 保留原值`);
  }
});

test('需求4 syncPositionsRange backward：同步到全部先前队形（x/y 同步、facing 保留）', () => {
  const { p, ids } = mkSix();
  const r = syncPositionsRange(p, 5, [ids[2]], { dir: 'backward' });
  assert.deepEqual(r, { formations: 5, dancers: 1 });
  for (let i = 0; i <= 4; i++) {
    const pos = p.formations[i].positions[ids[2]];
    assert.equal(pos.x, 52, `队形 ${i} x=末队形源值`);
    assert.equal(pos.y, 102, `队形 ${i} y=末队形源值`);
    assert.equal(pos.facing, i === 0 ? 180 : 90 + i, `队形 ${i} facing 保留原值（队形 0 夹具=180）`);
  }
  assert.equal(p.formations[5].positions[ids[2]].x, 52, '源队形自身不变');
});

test('需求4 有限 count=2：只同步相邻 2 个队形，更远队形逐值不动', () => {
  const { p, ids } = mkSix();
  const before = clone(p.formations.slice(3).map(f => f.positions));
  const r = syncPositionsRange(p, 0, [ids[0]], { count: 2 });
  assert.deepEqual(r, { formations: 2, dancers: 1 });
  assert.equal(p.formations[1].positions[ids[0]].x, 100, '队形 1 已同步');
  assert.equal(p.formations[2].positions[ids[0]].x, 100, '队形 2 已同步');
  assert.deepEqual(p.formations.slice(3).map(f => f.positions), before, '队形 3..5 逐值不变');
});

test('需求4 backward 有限 count=2 + 越界自动截断（forward 末尾 / backward 队首）', () => {
  const p1 = mkSix();
  let r = syncPositionsRange(p1.p, 4, [p1.ids[0]], { count: 2 });
  assert.deepEqual(r, { formations: 1, dancers: 1 }, 'forward 从 4 起：只有队形 5 可同步');
  assert.equal(p1.p.formations[5].positions[p1.ids[0]].x, 40, '同步源=队形 4 的 x');
  assert.equal(p1.p.formations[3].positions[p1.ids[0]].x, 30, '反向不越界');

  const p2 = mkSix();
  r = syncPositionsRange(p2.p, 1, [p2.ids[1]], { dir: 'backward', count: 99 });
  assert.deepEqual(r, { formations: 1, dancers: 1 }, 'backward 从 1 起：只有队形 0 可同步');
  assert.equal(p2.p.formations[0].positions[p2.ids[1]].x, 11, '同步源=队形 1 的 x（10·1+1）');
});

test('需求4 边界：count=0 零写入；非法 dir 回落 forward；缺位跳过计数；syncForwardPositions 薄包装等价', () => {
  const a = mkSix();
  const snap = clone(a.p.formations);
  assert.deepEqual(syncPositionsRange(a.p, 0, [a.ids[0]], { count: 0 }), { formations: 0, dancers: 1 });
  assert.deepEqual(a.p.formations, snap, 'count=0 零写入');

  const b = mkSix();
  assert.deepEqual(syncPositionsRange(b.p, 0, [b.ids[1]], { dir: 'sideways' }), { formations: 5, dancers: 1 }, '非法 dir=forward');
  assert.equal(b.p.formations[5].positions[b.ids[1]].x, 101);

  const c = mkSix();
  removeDancerFromFormation(c.p, 3, [c.ids[0]]); // 队形 3 缺位
  assert.deepEqual(syncPositionsRange(c.p, 0, [c.ids[0]]), { formations: 4, dancers: 1 }, '缺位队形跳过不计数');
  assert.ok(!(c.ids[0] in c.p.formations[3].positions), '缺位队形不臆造坐标');

  // 薄包装：同 id 深拷贝孪生上分别跑 syncForwardPositions / syncPositionsRange——
  // 返回值与 formations 写入结果逐值一致（uid 同源，deepEqual 安全）
  const w = mkSix();
  const twin = clone(w.p);
  assert.deepEqual(
    syncForwardPositions(w.p, 0, [w.ids[1]]),
    syncPositionsRange(twin, 0, [w.ids[1]]),
  );
  assert.deepEqual(w.p.formations, twin.formations, '写入结果逐值一致');
  assert.deepEqual(syncForwardPositions(w.p, 99, [w.ids[0]]), { formations: 0, dancers: 0 }, '越界 index 安全');
});

// ---------- 需求 5：onStageIds ----------
test('需求5 onStageIds：矩形内含边界在场；后台/候场/观众区/越界样点不在场；按名册序返回', () => {
  const p = createProject({ pairs: 2 }); // stage 16×12，audience bottom
  const [a, b, c, d] = p.dancers.map(x => x.id);
  const f = p.formations[0];
  f.positions[a] = { x: 0, y: 0, facing: 0 };   // 左上角（边界含）
  f.positions[b] = { x: 16, y: 12, facing: 0 }; // 右下角（边界含）
  f.positions[c] = { x: 8, y: 13, facing: 0 };  // 后台（depthM 外条带）
  f.positions[d] = { x: -2, y: 6, facing: 0 };  // 左候场（wingM 条带，矩形外）
  assert.deepEqual(onStageIds(p, f), [a, b], '按名册序、矩形内含边界');

  f.positions[a] = { x: 8, y: 14, facing: 0 };  // 观众区
  f.positions[b] = { x: 16.5, y: 5, facing: 0 }; // 右墙外
  f.positions[c] = { x: 8, y: -0.1, facing: 0 }; // 上边界外
  f.positions[d] = { x: 5, y: 12.1, facing: 0 }; // 下边界外（后台方向）
  assert.deepEqual(onStageIds(p, f), [], '矩形外一律不在场');

  delete f.positions[c];
  delete f.positions[b];
  f.positions[a] = { x: 3, y: 3, facing: 0 };
  assert.deepEqual(onStageIds(p, f), [a], '缺位舞者不算在场');
});

// ---------- 需求 5：生成器 ids 选项 ----------
test('需求5 applySlots ids 选项：仅子集写生成位置、其余原坐标逐值不变；就近映射只在子集内', () => {
  const p = createProject({ pairs: 2 });
  const f = p.formations[0];
  const [a, b, c, d] = p.dancers.map(x => x.id);
  f.positions[a] = { x: 1, y: 1, facing: 45 };
  f.positions[b] = { x: 2, y: 1, facing: 46 };
  f.positions[c] = { x: 3, y: 1, facing: 47 };
  f.positions[d] = { x: 4, y: 1, facing: 48 };
  const slots = genSlots('circle', 2, p.stage);
  applySlots(f, p.dancers.map(x => x.id), slots, { current: clone(f.positions), ids: [a, b] });
  // 就近映射只在 {a,b} 内进行：b(2,1) 比 a(1,1) 更近顶部槽位 → b 得槽 0、a 得槽 1
  //（若 c(3,1) 参与全局贪心它会抢走槽 0——被 ids 排除）
  assert.deepEqual(f.positions[b], { x: 8, y: 1.5, facing: 180 }, '子集内就近直配（槽 0）');
  assert.deepEqual(f.positions[a], { x: 8, y: 10.5, facing: 0 }, '子集内就近直配（槽 1）');
  // 子集外：原坐标逐值不变
  assert.deepEqual(f.positions[c], { x: 3, y: 1, facing: 47 });
  assert.deepEqual(f.positions[d], { x: 4, y: 1, facing: 48 });

  // 缺省（不提供 ids）= 现行为：整表替换（只有槽位数个键，子集外舞者被清位）
  const f2 = { id: 'f2', name: 'Y', positions: {}, merges: [] };
  f2.positions[a] = { x: 1, y: 1, facing: 45 };
  f2.positions[c] = { x: 3, y: 1, facing: 47 };
  applySlots(f2, p.dancers.map(x => x.id), slots, { current: clone(f2.positions) });
  assert.equal(Object.keys(f2.positions).length, 2, '整表替换：无槽位的舞者不出现在 positions');
  assert.ok(!('d' in f2.positions));
});

test('需求5 genDefaultRows ids 选项：仅子集写位、几何按子集人数推导；缺省=现行为全员', () => {
  const p = createProject({ pairs: 3 }); // 6 人，stage 16×12
  const ids = p.dancers.map(d => d.id);
  const f = { id: 'fx', name: 'X', positions: {}, merges: [] };
  p.formations.push(f);
  genDefaultRows(p, f, { ids: [ids[3], ids[0]] }); // 乱序传入 → 按名册序取子集
  assert.deepEqual([...Object.keys(f.positions)].sort(), [ids[0], ids[3]].sort(), '仅子集写位');
  assert.deepEqual(f.positions[ids[0]], { x: 1.5, y: 6, facing: 180 }, '子集 2 人单排左点');
  assert.deepEqual(f.positions[ids[3]], { x: 14.5, y: 6, facing: 180 }, '子集 2 人单排右点');

  // 缺省（不提供 ids）= 现行为：全员、与 createProject 初始队形同构
  const f2 = { id: 'fy', name: 'Y', positions: {}, merges: [] };
  genDefaultRows(p, f2);
  assert.deepEqual(f2.positions, p.formations[0].positions, '与建档初始队形逐值一致');
  assert.equal(Object.keys(f2.positions).length, 6);
});

// ---------- 需求 6：admitToFormation ----------
function mkThree() {
  const p = createProject({ pairs: 2 });
  const ids = p.dancers.map(d => d.id);
  for (let i = 1; i <= 2; i++) {
    const f = { id: 'f' + i, name: 'F' + i, positions: {}, merges: [] };
    ids.forEach((id, k) => { f.positions[id] = { x: i, y: k, facing: 30 * i }; });
    p.formations.push(f);
  }
  return { p, ids };
}

test('需求6 admitToFormation：有源顺延最近队形（x/y/facing）；同距取更早者', () => {
  const { p, ids } = mkThree();
  // 目标 index2：最近有位=队形1（k=1 向后）→ 顺延其位置
  removeDancerFromFormation(p, 2, [ids[0]]);
  const srcSnap = clone(p.formations[1].positions);
  assert.equal(admitToFormation(p, 2, ids[0]), true, '写入成功返回 true');
  assert.deepEqual(p.formations[2].positions[ids[0]], { x: 1, y: 0, facing: 30 }, '顺延队形 1 位置（x/y/facing）');
  assert.deepEqual(p.formations[1].positions, srcSnap, '源队形零触碰（纯补位语义）');
  // 目标 index1：队形 0 与队形 2 同距 → 取更早者（队形 0）
  removeDancerFromFormation(p, 1, [ids[1]]);
  assert.equal(admitToFormation(p, 1, ids[1]), true);
  assert.deepEqual(p.formations[1].positions[ids[1]], p.formations[0].positions[ids[1]], '同距取更早（顺延队形 0 位置）');
});

test('需求6 admitToFormation：无源=舞台中央面向观众；已在场 no-op；非法入参安全', () => {
  const { p, ids } = mkThree();
  const e = ids[3];
  for (let i = 0; i < 3; i++) removeDancerFromFormation(p, i, [e]); // 全队形无位
  assert.equal(admitToFormation(p, 1, e), true);
  assert.deepEqual(p.formations[1].positions[e], { x: 8, y: 6, facing: 180 }, '舞台中央+面向观众');

  const before = JSON.stringify(p.formations[1].positions[ids[2]]);
  assert.equal(admitToFormation(p, 1, ids[2]), false, '已在场 no-op 返回 false');
  assert.equal(JSON.stringify(p.formations[1].positions[ids[2]]), before, 'no-op 零写入');

  assert.equal(admitToFormation(p, 99, ids[0]), false, 'index 越界安全');
  assert.equal(admitToFormation(p, -1, ids[0]), false);
  assert.equal(admitToFormation(p, 0, 'nope'), false, '未知舞者安全');

  const r = validateProject(clone(p));
  assert.ok(r.ok, r.errors?.join('；'), '补位后项目校验通过');
});

// ---------- 需求 6：名册 toggle（ui.js 静态断言） ----------
test('需求6 名册 toggle 静态断言：getFormationIndex 缺省隐藏；两分支 mutate 语义；复用 .chip', () => {
  // 签名：可选参数缺省 null（现调用零破坏——缺省整个状态列隐藏）
  assert.match(uiSrc, /getFormationIndex = null/);
  // 列头/行内状态芯片均以 getFormationIndex / onStage 为条件（缺省不渲染、无 th/td 残留）
  assert.match(uiSrc, /\.\.\.\(getFormationIndex \? \[h\('th', \{\}, '上场'\)\] : \[\]\)/);
  assert.match(uiSrc, /\(onStage == null\) \? null : h\('button'/);
  assert.match(uiSrc, /\.\.\.\(statusChip \? \[h\('td', \{\}, statusChip\)\] : \[\]\)/);
  // 两分支 mutate 语义：在场→removeDancerFromFormation（历史「下场」）；不在场→admitToFormation（历史「上场」）
  assert.match(uiSrc, /if \(onStage\) M\.removeDancerFromFormation\(p, cur, \[d\.id\]\);/);
  assert.match(uiSrc, /else M\.admitToFormation\(p, cur, d\.id\);/);
  assert.match(uiSrc, /'下场' : '上场'/);
  // 芯片样式复用既有 .chip/.chip-on（css 零改动）
  assert.match(uiSrc, /onStage \? 'chip chip-on' : 'chip'/);
  // 「重新入队」新可用性：缺席>0 且未上场（旧字面 `missing === 0` 保留为前缀，叠加已上场禁用）
  assert.match(uiSrc, /disabled: missing === 0 \|\| !!onStage/);
});

// ---------- 附：sanitizeTracks laneH（并行 Wave 字段放行） ----------
test('laneH：数值钳 [24,240] 保留；非法/缺省不落键（JSON 往返不新增键、幂等）', () => {
  const ts = sanitizeTracks([
    { id: 't1', name: 'A', gain: 1, muted: false, laneH: 300 },
    { id: 't2', name: 'B', gain: 1, muted: false, laneH: 10 },
    { id: 't3', name: 'C', gain: 1, muted: false, laneH: 96 },
    { id: 't4', name: 'D', gain: 1, muted: false, laneH: 'oops' },
    { id: 't5', name: 'E', gain: 1, muted: false },
  ]);
  assert.equal(ts[0].laneH, 240, '上界钳制');
  assert.equal(ts[1].laneH, 24, '下界钳制');
  assert.equal(ts[2].laneH, 96, '界内原值');
  assert.ok(!('laneH' in ts[3]), '非法不落键');
  assert.ok(!('laneH' in ts[4]), '缺省不落键');
  assert.deepEqual(sanitizeTracks(ts), ts, '幂等往返');
});
