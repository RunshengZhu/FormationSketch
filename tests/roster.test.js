// build-69-roster：舞者生命周期重构——名册为唯一身份源 + 批量/按对添加（node 单测）。
// 覆盖（与任务 R1-R4 对应）：
//   R1 removeDancerFromFormation：只动目标帧（positions 清位 + merges 引用清理），
//      名册/编组/其它队形零触碰；越界 no-op；多人批量（ids 去重）；合并成员不留悬挂。
//   R2 rejoinFormations：补齐全部缺席队形（返回补齐数）、全勤 0、名册外 id 安全 0。
//   R3 addCouples：数量/命名延续（M_i/F_i 统一序）/「第k对」编组建立与追加不冲突/gender 组并存；
//      addDancersBatch：角色过滤（含非法角色回落 X）/命名延续（M/F/舞者n 序列）/全帧补位。
//   R4 静态断言：画布删除入口（main.js）全部改走新函数而非 removeDancer；名册删除确认链
//      （ui.js：confirm 全局删除文案先于 M.removeDancer）+ 重新入队/批量添加接线；
//      selectionMenuSpec 末位项改「移出队形」；画布只用名册舞者回归（移出后 dancers 数不变、
//      positions 键 ⊆ 名册、幽灵不报错、重新入队补齐后不变式恢复）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject, addCouples, addDancersBatch, removeDancerFromFormation,
  rejoinFormations, addMerge, createGroup, createFormationFrom, validateProject,
  removeDancer,
} from '../js/model.js';
import { selectionMenuSpec } from '../js/main.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = readFileSync(join(ROOT, 'js', 'main.js'), 'utf8');
const uiSrc = readFileSync(join(ROOT, 'js', 'ui.js'), 'utf8');
const namesOf = p => p.dancers.map(d => d.name);
const coupleGroups = p => (p.groups || []).filter(g => /^第\d+对$/.test(g.name || ''));

// ---------- R1：removeDancerFromFormation（画布删除新语义） ----------
test('R1 removeDancerFromFormation：只动目标帧——清位+merges 清理；名册/编组/它帧保留', () => {
  const p = createProject({ pairs: 2 }); // M1 F1 M2 F2
  createFormationFrom(p, 0); // 第 2 帧
  const [a, b, c] = p.dancers.map(d => d.id);
  addMerge(p.formations[0], a, b, 'capsule');
  addMerge(p.formations[1], a, c, 'single');
  createGroup(p, [a, b], '混编');
  const nDancers = p.dancers.length;

  removeDancerFromFormation(p, 0, [a]);

  assert.equal(p.dancers.length, nDancers, '名册零变化（画布移除≠名册删除）');
  assert.ok(p.dancers.some(d => d.id === a), '舞者记录保留');
  assert.deepEqual(p.groups.find(g => g.name === '混编').memberIds, [a, b], '编组零变化');
  // 目标帧：a 清位、b 原地保留；涉及 a 的 merge 清理（清空后键移除，与 removeDancer 同口径）
  assert.ok(!(a in p.formations[0].positions));
  assert.ok(b in p.formations[0].positions);
  assert.equal(p.formations[0].merges, undefined, '该帧 merges 清空后键移除');
  // 其它帧零触碰：a 的位置与 merge 原样保留
  assert.ok(a in p.formations[1].positions);
  assert.deepEqual(p.formations[1].merges, [{ a, b: c, style: 'single' }], '它帧 merges 不受影响');
  assert.ok(validateProject(JSON.parse(JSON.stringify(p))).ok, '移出态经校验幂等通过');
});

test('R1 removeDancerFromFormation：队形索引越界/空 ids no-op（不抛错、零变化）', () => {
  const p = createProject({ pairs: 1 });
  const before = JSON.stringify(p);
  removeDancerFromFormation(p, 99, [p.dancers[0].id]);
  removeDancerFromFormation(p, -1, [p.dancers[0].id]);
  removeDancerFromFormation(p, 0, []);
  removeDancerFromFormation(p, 0, null);
  assert.equal(JSON.stringify(p), before, '越界与空输入均零变化');
});

test('R1 removeDancerFromFormation：多人批量（ids 去重）+ 合并单元成员清位不悬挂', () => {
  const p = createProject({ pairs: 2 });
  const [a, b, c] = p.dancers.map(d => d.id);
  addMerge(p.formations[0], a, b, 'capsule');
  removeDancerFromFormation(p, 0, [a, a, c]); // 重复 id + 含单元成员
  assert.ok(!(a in p.formations[0].positions) && !(c in p.formations[0].positions));
  assert.ok(b in p.formations[0].positions, '未选成员原地保留');
  assert.equal(p.formations[0].merges, undefined, '涉及成员的 merge 记录清理');
  assert.equal(p.dancers.length, 4, '名册零变化');
  assert.ok(validateProject(JSON.parse(JSON.stringify(p))).ok);
});

// ---------- R2：rejoinFormations（名册「重新入队」的模型层） ----------
test('R2 rejoinFormations：补齐全部缺席队形、返回补齐数；全勤 0；名册外 id 安全 0', () => {
  const p = createProject({ pairs: 2 });
  createFormationFrom(p, 0);
  const a = p.dancers[0].id;
  removeDancerFromFormation(p, 1, [a]); // 第 2 帧缺席
  assert.ok(!(a in p.formations[1].positions));
  assert.equal(rejoinFormations(p, a), 1, '缺席 1 帧 → 补齐 1');
  assert.ok(a in p.formations[1].positions, '补位落键');
  assert.equal(rejoinFormations(p, a), 0, '全勤 → 0（UI 据此 disabled）');
  assert.equal(rejoinFormations(p, 'd_ghost'), 0, '名册外 id → 0（幽灵不报错、不补位）');
  // 多帧缺席一次补齐
  const q = createProject({ pairs: 1 });
  createFormationFrom(q, 0);
  createFormationFrom(q, 1);
  const id = q.dancers[0].id;
  removeDancerFromFormation(q, 0, [id]);
  removeDancerFromFormation(q, 2, [id]);
  assert.equal(rejoinFormations(q, id), 2, '缺席 2 帧 → 补齐 2');
});

// ---------- R3：addCouples / addDancersBatch（批量添加） ----------
test('R3 addCouples：数量/命名延续/「第k对」编组建立/新舞者全帧补位', () => {
  const p = createProject({ pairs: 3 }); // M1..M3 F1..F3
  const n0 = p.dancers.length;
  const added = addCouples(p, 2);
  assert.equal(added.length, 4, '返回新增 ids（每对 2 人）');
  assert.equal(p.dancers.length, n0 + 4);
  assert.deepEqual(namesOf(p).slice(-4), ['M4', 'F4', 'M5', 'F5'], 'M/F 序列续接');
  const cg = coupleGroups(p);
  assert.deepEqual(cg.map(g => g.name), ['第1对', '第2对'], '「第k对」编组从最大序+1 起');
  const m4 = p.dancers.find(d => d.name === 'M4'), f4 = p.dancers.find(d => d.name === 'F4');
  assert.deepEqual(cg[0].memberIds, [m4.id, f4.id], '每对编组 memberIds=[男,女]');
  assert.deepEqual(cg[0].memberIds, [added[0], added[1]], '返回 ids 与编组成员一致');
  // 画布只能用名册舞者：新增舞者经 addDancer 自动补进全部队形（positions 键 === dancers）
  for (const f of p.formations) {
    assert.deepEqual(Object.keys(f.positions).sort(), p.dancers.map(d => d.id).sort());
  }
});

test('R3 addCouples 追加：序号不冲突（第k对取最大序+1、M/F 名续接）；gender 分组并存', () => {
  const p = createProject({ pairs: 2 });
  addCouples(p, 1); // 第1对（M3/F3）
  addCouples(p, 2); // 第2对、第3对（M4/F4、M5/F5）
  assert.deepEqual(coupleGroups(p).map(g => g.name), ['第1对', '第2对', '第3对'], '追加序号不冲突');
  assert.deepEqual(namesOf(p).slice(-4), ['M4', 'F4', 'M5', 'F5']);
  assert.ok(p.groups.some(g => g.name === '男士') && p.groups.some(g => g.name === '女士'), 'gender 分组并存');
  // 男女序列错位场景（extraM 使 M 序超前）：k 取男女共同最大序+1，避免错位配对
  const q = createProject({ pairs: 2, extraM: 2 }); // M1..M4、F1..F2
  const addedQ = addCouples(q, 1);
  assert.deepEqual(namesOf(q).slice(-2), ['M5', 'F5'], 'k=男女共同最大序+1');
  assert.deepEqual(q.groups.find(g => g.name === '第1对').memberIds, addedQ, '编组=本次新增两人');
});

test('R3 addCouples：n=0/负数 no-op 返回空数组', () => {
  const p = createProject({ pairs: 1 });
  assert.deepEqual(addCouples(p, 0), []);
  assert.deepEqual(addCouples(p, -2), []);
  assert.equal(p.dancers.length, 2);
  assert.equal(coupleGroups(p).length, 0);
});

test('R3 addDancersBatch：角色过滤/命名延续/非法角色回落 X', () => {
  const p = createProject({ pairs: 2 }); // M1 F1 M2 F2
  const mIds = addDancersBatch(p, 2, 'M');
  assert.deepEqual(p.dancers.filter(d => mIds.includes(d.id)).map(d => d.name), ['M3', 'M4'], 'M 序列续接');
  assert.ok(p.dancers.filter(d => mIds.includes(d.id)).every(d => d.role === 'M' && d.color === '#3b82f6'), '角色/颜色过滤正确');
  const fIds = addDancersBatch(p, 1, 'F');
  assert.deepEqual(p.dancers.filter(d => fIds.includes(d.id)).map(d => d.name), ['F3'], 'F 序列续接（独立计数）');
  const xIds = addDancersBatch(p, 3, 'X');
  assert.deepEqual(p.dancers.filter(d => xIds.includes(d.id)).map(d => d.name), ['舞者1', '舞者2', '舞者3'], 'X 用 舞者n 序列');
  assert.ok(p.dancers.filter(d => xIds.includes(d.id)).every(d => d.role === 'X' && d.color === '#10b981'));
  const badIds = addDancersBatch(p, 1, 'bogus');
  assert.ok(p.dancers.find(d => badIds.includes(d.id)).role === 'X', '非法角色回落 X');
  // 全帧补位（画布只能用名册舞者）
  for (const f of p.formations) {
    assert.deepEqual(Object.keys(f.positions).sort(), p.dancers.map(d => d.id).sort());
  }
  // 与既有 舞者n 命名续接：名册里已有 舞者5 时，批量从最大序+1
  const q = createProject({ pairs: 1 });
  q.dancers.push({ id: 'dx', name: '舞者5', short: '5', role: 'X', color: '#10b981' });
  const cont = addDancersBatch(q, 2, 'X');
  assert.deepEqual(q.dancers.filter(d => cont.includes(d.id)).map(d => d.name), ['舞者6', '舞者7'], '从既有 舞者n 最大序续接');
});

test('R3 addDancersBatch：n=0 no-op；批量不建编组（按对语义仅 addCouples 承担）', () => {
  const p = createProject({ pairs: 1 });
  const g0 = JSON.stringify(p.groups);
  assert.deepEqual(addDancersBatch(p, 0, 'M'), []);
  assert.equal(JSON.stringify(p.groups), g0, '编组零变化');
  addDancersBatch(p, 2, 'M');
  assert.equal(JSON.stringify(p.groups), g0, '批量添加不建/不改编组');
});

// ---------- R4：selectionMenuSpec（画布删除项收口「移出队形」） ----------
test('R4 selectionMenuSpec：末位删除项改「移出队形」（removeFromFormation，delete kind 退役）', () => {
  const one = selectionMenuSpec({ count: 1 });
  assert.deepEqual(one.map(i => i.kind), ['facing', 'removeFromFormation']);
  assert.equal(one.at(-1).label, '移出队形', 'N=1 既有文案位（page-r 仪器口径，build-69 起为移出队形）');
  const two = selectionMenuSpec({ count: 2, pairEligible: true });
  assert.deepEqual(two.map(i => i.kind), ['facing', 'saveGroup', 'mergeUnit', 'removeFromFormation']);
  assert.equal(two.at(-1).label, '移出队形（2 人）');
  const three = selectionMenuSpec({ count: 3 });
  assert.deepEqual(three.map(i => i.kind), ['facing', 'saveGroup', 'distribute', 'removeFromFormation']);
  assert.equal(three.at(-1).label, '移出队形（3 人）');
});

// ---------- R4：静态断言——画布删除入口 / 名册确认链 / 批量接线 ----------
test('R4 静态：画布删除入口全部改走 removeDancerFromFormation（main.js 不再调 removeDancer）', () => {
  assert.ok(mainSrc.includes('M.removeDancerFromFormation('), 'main.js 使用新模型函数');
  assert.ok(!mainSrc.includes('M.removeDancer('), '画布不得再全局删除舞者（唯一入口收归名册）');
  // 单人/单元浮窗按钮：文案「移出队形」+ title 提示（名册保留）
  assert.ok(mainSrc.includes("b.textContent = '移出队形'"), '浮窗按钮文案「移出队形」');
  assert.ok(mainSrc.includes("'仅从当前队形移除，名册保留（彻底删除请去名册）'"), 'title 提示（名册保留指引）');
  // 多选删除按钮：移出队形（N 人）
  assert.ok(mainSrc.includes('移出队形（${n} 人）'), '多选按钮文案「移出队形（N 人）」');
  assert.ok(!mainSrc.includes('删除所选（${n} 人）'), '「删除所选（N 人）」按钮文案退役');
  // Del 键与浮窗同语义
  assert.ok(/key === 'Delete'[\s\S]{0,300}removeDancerFromFormation/.test(mainSrc), 'Del 键走新函数');
  // 名册 modal 仍是全局删除唯一入口（ui.js 调 removeDancer）
  assert.ok(uiSrc.includes('M.removeDancer('), '名册删除走 removeDancer（全局语义）');
});

test('R4 静态：名册删除确认链（confirm 全局删除文案）+ 重新入队 + 批量添加/删整对接线', () => {
  const idxConfirm = uiSrc.indexOf('不可撤销于名册，但可 Undo');
  const idxRemove = uiSrc.indexOf('M.removeDancer(');
  assert.ok(idxConfirm > -1 && idxRemove > -1 && idxConfirm < idxRemove, '两步确认：confirm 文案先于全局删除调用');
  assert.ok(uiSrc.includes('M.rejoinFormations('), '重新入队接线（补齐缺席队形）');
  assert.ok(uiSrc.includes('disabled: missing === 0'), '全勤时「重新入队」disabled');
  assert.ok(uiSrc.includes('M.addCouples(') && uiSrc.includes('M.addDancersBatch('), '批量添加接线（按对/按数量）');
  assert.ok(uiSrc.includes('对标准') && uiSrc.includes('presetBtn(6)') && uiSrc.includes('presetBtn(8)'), '预设快捷钮（6/8 对标准，createProject 同款 pairs 语义追加）');
  assert.ok(uiSrc.includes('删整对'), '「删除对」入口在名册行');
  assert.ok(uiSrc.includes('/^第\\d+对$/'), '对信息读 groups（「第k对」命名，不新增数据字段）');
  assert.ok(uiSrc.includes('syncSelection'), '名册删除后清画布残留选中态');
});

// ---------- R4：回归——画布只用名册舞者（移出队形 ≠ 名册删除） ----------
test('R4 回归：移出队形后 dancers 数不变、positions 键 ⊆ 名册、merges 不悬挂、重入队恢复不变式', () => {
  const p = createProject({ pairs: 2, presetMerged: true });
  createFormationFrom(p, 0);
  createFormationFrom(p, 1);
  const ids = p.dancers.map(d => d.id);
  removeDancerFromFormation(p, 1, ids.slice(0, 2)); // 模拟画布删除入口（含合并单元成员）

  assert.equal(p.dancers.length, ids.length, '名册数不变（用户抱怨点：画布删除不再删名册）');
  assert.ok(coupleGroups(p).length === 0 && p.groups.length === 2, '既有编组零变化');
  for (const f of p.formations) {
    for (const k of Object.keys(f.positions)) assert.ok(p.dancers.some(d => d.id === k), `positions 键 ${k} 在名册内`);
    for (const m of f.merges || []) {
      assert.ok(p.dancers.some(d => d.id === m.a) && p.dancers.some(d => d.id === m.b), 'merges 不悬挂');
    }
  }
  // 移出态经 validateProject 往返保留（不重补位）——「重新入队」语义在重载后仍可达
  const v = validateProject(JSON.parse(JSON.stringify(p))).project;
  assert.equal(v.dancers.length, ids.length);
  assert.ok(!(ids[0] in v.formations[1].positions) && !(ids[1] in v.formations[1].positions), '缺席态跨保存/载入保留');
  // 重新入队：补齐后 positions 键 === dancers 不变式恢复（幽灵不报错）
  assert.equal(rejoinFormations(p, ids[0]) + rejoinFormations(p, ids[1]), 2);
  for (const f of p.formations) {
    assert.deepEqual(Object.keys(f.positions).sort(), p.dancers.map(d => d.id).sort());
  }
});

test('R4 回归：名册删除（removeDancer 全局语义）与画布移除互补——两入口语义分野', () => {
  const p = createProject({ pairs: 2 });
  createFormationFrom(p, 0);
  const victim = p.dancers[0];
  // 画布入口：名册保留
  removeDancerFromFormation(p, 0, [victim.id]);
  assert.ok(p.dancers.some(d => d.id === victim.id), '画布移除：名册保留');
  assert.ok(!(victim.id in p.formations[0].positions));
  assert.ok(victim.id in p.formations[1].positions, '其它帧不受影响');
  // 名册入口：全局删除（唯一入口，带 confirm——静态断言见上）
  const g0 = p.dancers.length;
  p.groups.push({ id: 'gx', name: '临时组', memberIds: [victim.id] });
  removeDancer(p, victim.id);
  assert.equal(p.dancers.length, g0 - 1, '名册删除：记录移除');
  assert.deepEqual(p.groups.find(g => g.name === '临时组').memberIds, [], '组成员联动清理');
  for (const f of p.formations) assert.ok(!(victim.id in f.positions), '所有队形清位');
});
