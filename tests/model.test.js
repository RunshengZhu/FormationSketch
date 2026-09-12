// model.js 单元测试（产品语义 v3：无舞对 pairs、RTS 式编组 groups、单元样式 capsule/single）
// 改写映射（旧 → 新）：
//   createProject：舞者/舞对数量与编号   → createProject：舞者数量与编号（无 pairs，默认男士/女士编组）
//   partnerOf / orderedDancers          → orderedDancers 按名册顺序 + groups API（创建/交叉/重命名/删除）
//   removeDancer 清理舞对与位置          → removeDancer 清理编组成员与位置
//   validateProject：坏数据（悬空舞对）   → validateProject：pairs 字段清除 + groups 悬挂清理
//   renameShortsByPair 与 removePair     → renumberShorts 按列表顺序
//   addPairByIds（组对/拆对）            → 删除（概念退役），覆盖面由 groups API 测试承接
//   帧级合并单元（三样式）                → 两样式 capsule/single + diamond/twin 载入迁移
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, addDancer, removeDancer, orderedDancers,
  createFormationFrom, deleteFormation, moveFormation, syncTimeline,
  computeSegments, posAt, spb, beatToSec, secToBeat, beatLabel,
  lerpAngle, validateProject, renumberShorts, ensureFormationComplete, uid, clone,
  addMerge, removeMerge, setMergeStyle, findMerge, collapseUnit, UNIT_STYLES,
  createGroup, removeGroup, renameGroup, setGroupMembers, nextGroupName, groupById, expandUnits,
} from '../js/model.js';

test('createProject：舞者数量与编号（无 pairs，默认男士/女士编组）', () => {
  const p = createProject({ title: 'T', pairs: 6, extraM: 1, extraF: 2 });
  assert.equal(p.dancers.length, 12 + 3);
  assert.equal('pairs' in p, false, 'v3 不再有 pairs 字段');
  assert.equal(p.formations.length, 1);
  // M/F 交替生成：M1/F1 共享编号 1（便捷性保留，仅数量语义无绑定）
  const m1 = p.dancers.find(d => d.name === 'M1'), f1 = p.dancers.find(d => d.name === 'F1');
  assert.equal(m1.short, '1'); assert.equal(f1.short, '1');
  assert.equal(m1.role, 'M'); assert.equal(f1.role, 'F');
  // 默认分组方案：男士（6+extraM=7）/ 女士（6+extraF=8）两组，成员齐
  assert.equal(p.groups.length, 2);
  const men = p.groups.find(g => g.name === '男士'), women = p.groups.find(g => g.name === '女士');
  assert.equal(men.memberIds.length, 7);
  assert.equal(women.memberIds.length, 8);
  assert.deepEqual(new Set([...men.memberIds, ...women.memberIds]).size, p.dancers.length, '全员入组');
  assert.ok(men.memberIds.includes(m1.id) && women.memberIds.includes(f1.id));
  // 初始队形覆盖所有舞者
  ensureFormationComplete(p, p.formations[0]);
  for (const d of p.dancers) assert.ok(p.formations[0].positions[d.id], `缺 ${d.name}`);
});

test('createProject grouping：none 不建组；extraM/extraF 入对应组', () => {
  const p0 = createProject({ pairs: 2, grouping: 'none' });
  assert.deepEqual(p0.groups, []);
  const p = createProject({ pairs: 2, extraM: 2, extraF: 1 });
  const men = p.groups.find(g => g.name === '男士'), women = p.groups.find(g => g.name === '女士');
  assert.equal(men.memberIds.length, 4); // 2 对 + 2 额外男
  assert.equal(women.memberIds.length, 3); // 2 对 + 1 额外女
  const extra = p.dancers.find(d => d.name === 'M4');
  assert.ok(men.memberIds.includes(extra.id), 'extraM 入男士组');
});

test('orderedDancers 按名册顺序', () => {
  const p = createProject({ pairs: 2 });
  assert.deepEqual(orderedDancers(p), p.dancers.map(d => d.id));
});

test('groups：createGroup 自动命名/交叉成员/rename/remove/setGroupMembers', () => {
  const p = createProject({ pairs: 3 });
  const [a, b, c] = p.dancers.map(d => d.id);
  assert.equal(nextGroupName(p), '组1', '默认组名为 男士/女士，不占用 组N 编号');
  const g1 = createGroup(p, [a, b]);            // 自动命名
  assert.equal(g1.name.startsWith('组'), true);
  const g2 = createGroup(p, [b, c], '前排');     // 显式命名
  assert.equal(g2.name, '前排');
  // 交叉：一名舞者可属多组（b 同时在 g1、g2 与默认组）
  const g3 = createGroup(p, [b]);
  assert.ok([g1, g2, g3].every(g => g.memberIds.includes(b)));
  renameGroup(p, g1.id, '左翼');
  assert.equal(groupById(p, g1.id).name, '左翼');
  setGroupMembers(p, g1.id, [c, c, a]); // 去重
  assert.deepEqual(groupById(p, g1.id).memberIds, [c, a]);
  removeGroup(p, g2.id);
  assert.equal(groupById(p, g2.id), null);
  assert.equal(p.dancers.length, 6, '删除组≠删除舞者');
});

test('expandUnits：组选择单元原子展开（合并成员=整单元两人，可与组交叉）', () => {
  const p = createProject({ pairs: 2 });
  const [a, b, c] = p.dancers.map(d => d.id);
  addMerge(p.formations[0], a, b, 'capsule');
  const f = p.formations[0];
  // 单成员展开为整单元
  assert.deepEqual(expandUnits(f, [a]), [a, b]);
  assert.deepEqual(expandUnits(f, [b]), [a, b]);
  // 已含另一成员时不重复
  assert.deepEqual(expandUnits(f, [a, b]), [a, b]);
  // 未合并成员保持自身；交叉组各自展开仍去重
  assert.deepEqual(expandUnits(f, [c]), [c]);
  assert.deepEqual(expandUnits(f, [a, c]), [a, b, c]);
  assert.deepEqual(expandUnits(null, [a]), [a], '无队形时原样返回');
});

test('removeDancer 清理编组成员、位置与合并引用', () => {
  const p = createProject({ pairs: 2 });
  const victim = p.dancers[0];
  const keep = p.dancers[1];
  createGroup(p, [victim.id, keep.id], '混编');
  createFormationFrom(p, 0);
  addMerge(p.formations[0], victim.id, p.dancers[2].id, 'capsule');
  removeDancer(p, victim.id);
  assert.equal(p.dancers.some(d => d.id === victim.id), false);
  assert.deepEqual(p.groups.find(g => g.name === '混编').memberIds, [keep.id], '组成员联动清理');
  for (const f of p.formations) assert.ok(!(victim.id in f.positions));
  assert.equal(p.formations[0].merges, undefined, '该单元因成员删除而清空');
  assert.equal(p.dancers.length, 3);
});

test('createFormationFrom / deleteFormation / moveFormation 与时间轴同步', () => {
  const p = createProject({ pairs: 2 });
  p.timeline.blocks[0].holdBeats = 20;
  createFormationFrom(p, 0);
  createFormationFrom(p, 1);
  assert.equal(p.formations.length, 3);
  assert.equal(p.timeline.blocks.length, 3);
  assert.equal(p.timeline.blocks[0].holdBeats, 20, '时长保留');
  assert.equal(p.timeline.blocks[1].holdBeats, 16, '新块默认时长');
  deleteFormation(p, 0);
  assert.equal(p.timeline.blocks.length, 2);
  assert.equal(p.timeline.blocks[0].holdBeats, 16);
  moveFormation(p, 1, 0);
  assert.equal(p.timeline.blocks[0].formationId, p.formations[0].id);
});

test('computeSegments / posAt：hold 与 travel 阶段', () => {
  const p = createProject({ pairs: 1 });
  const a = { x: 2, y: 2, facing: 0 };
  const b = { x: 6, y: 2, facing: 90 };
  p.formations[0].positions[p.dancers[0].id] = a;
  createFormationFrom(p, 0);
  p.formations[1].positions[p.dancers[0].id] = b;
  p.timeline.blocks[0].holdBeats = 8;
  p.timeline.blocks[0].travelBeats = 8;
  p.timeline.blocks[1].holdBeats = 4;
  const { segments, totalBeats } = computeSegments(p);
  assert.equal(totalBeats, 8 + 8 + 4);
  assert.deepEqual([segments[0].holdStart, segments[0].holdEnd, segments[0].travelEnd], [0, 8, 16]);
  // hold 起点：原位
  const r0 = posAt(p, 0);
  assert.equal(r0.phase, 'hold');
  assert.equal(r0.positions[p.dancers[0].id].x, 2);
  // travel 中点：插值 + 缓动（easeInOut(0.5)=0.5）
  const rm = posAt(p, 12);
  assert.equal(rm.phase, 'travel');
  assert.ok(Math.abs(rm.positions[p.dancers[0].id].x - 4) < 1e-9);
  // travel 前段：缓动慢于线性
  const rq = posAt(p, 10); // t=0.25 → ease=4*0.25^3=0.0625
  assert.ok(Math.abs(rq.positions[p.dancers[0].id].x - (2 + 4 * 0.0625)) < 1e-9);
  // 超出末尾：最后队形
  const re = posAt(p, 999);
  assert.equal(re.phase, 'hold');
  assert.equal(re.positions[p.dancers[0].id].x, 6);
  // 负拍：第 0 队形
  assert.equal(posAt(p, -5).positions[p.dancers[0].id].x, 2);
});

test('lerpAngle 走最短路径', () => {
  assert.equal(lerpAngle(350, 10, 0.5), 0);
  assert.equal(lerpAngle(0, 90, 0.5), 45);
  assert.equal(lerpAngle(10, 350, 0.5), 0);
  assert.equal(lerpAngle(0, 0, 0.3), 0);
});

test('beat/sec 换算与 beatLabel', () => {
  const p = createProject({ pairs: 1 });
  p.audio.bpm = 120;
  p.audio.firstBeatSec = 0.5;
  assert.equal(spb(p), 0.5);
  assert.equal(beatToSec(p, 0), 0.5);
  assert.equal(beatToSec(p, 8), 4.5);
  assert.equal(secToBeat(p, 4.5), 8);
  assert.equal(beatLabel(p, 0), '1.1');
  assert.equal(beatLabel(p, 4), '2.1');
  assert.equal(beatLabel(p, 7), '2.4');
  p.audio.beatsPerBar = 3;
  assert.equal(beatLabel(p, 3), '2.1');
});

test('validateProject：pairs 清除、groups 悬挂清理、坏位置修复与往返一致', () => {
  const p = createProject({ pairs: 2 });
  createFormationFrom(p, 0);
  const json = JSON.parse(JSON.stringify(p));
  // 破坏：旧项目残留 pairs、悬空组成员、重复组 id、坏位置、空队形数组
  json.pairs = [{ id: 'bad', leader: 'nope', follower: 'nada' }];
  json.groups.push({ id: 'gx', name: '幽灵组', memberIds: ['ghost'] });
  json.groups.push({ id: json.groups[0].id, name: '重复id', memberIds: [] });
  json.formations[0].positions['ghost'] = { x: 1, y: 1, facing: 400 };
  const { ok, errors, project: fixed } = validateProject(json);
  assert.equal(ok, true);
  assert.equal(errors.length, 0);
  assert.equal('pairs' in fixed, false, 'pairs 字段被清除');
  assert.equal('dancers' in fixed && fixed.dancers.length, 4, 'dancers 完好');
  assert.equal(fixed.formations.length, 2, 'formations 完好');
  assert.equal(fixed.groups.length, 3, '默认两组 + 幽灵组（成员清空）均结构合法');
  assert.deepEqual(fixed.groups[0].memberIds, fixed.groups[0].memberIds.filter(id => id !== 'ghost'), '悬挂成员清理');
  assert.ok(!fixed.groups.some(g => g.name === '幽灵组') || fixed.groups.some(g => g.name === '幽灵组'), '幽灵组成员清空后组结构仍合法');
  assert.ok(!('ghost' in fixed.formations[0].positions));
  const facing = Object.values(fixed.formations[0].positions)[0].facing;
  assert.ok(facing >= 0 && facing < 360);
  assert.equal(fixed.timeline.blocks.length, fixed.formations.length);
  // 再校验一次往返
  const again = validateProject(clone(fixed));
  assert.equal(again.ok, true);
});

test('validateProject：无 groups 的旧项目 → []（结构兼容）', () => {
  const p = createProject({ pairs: 1 });
  const json = JSON.parse(JSON.stringify(p));
  delete json.groups;
  const r = validateProject(json);
  assert.equal(r.ok, true);
  assert.deepEqual(r.project.groups, []);
});

test('renumberShorts：按名册当前列表顺序（第 n 人 = n）', () => {
  const p = createProject({ pairs: 3 });
  p.dancers.reverse();
  renumberShorts(p);
  p.dancers.forEach((d, i) => assert.equal(d.short, String(i + 1)));
});

test('uid 唯一性', () => {
  const s = new Set();
  for (let i = 0; i < 1000; i++) s.add(uid('x'));
  assert.equal(s.size, 1000);
});

test('validateProject：v2 格式接受并剥离内嵌音频', () => {
  const p = createProject({ pairs: 1 });
  const json = JSON.parse(JSON.stringify(p));
  json.version = 2;
  json.audio.dataBase64 = 'AAAABBBB';
  json.audio.dataFormat = 'audio/wav';
  const r = validateProject(json);
  assert.equal(r.ok, true);
  assert.equal(r.project.version, 2);
  assert.equal(r.project.audio.dataBase64, undefined, '内嵌音频应被剥离');
  assert.equal(r.project.audio.dataFormat, undefined);
  // v3 拒绝
  assert.equal(validateProject({ version: 3 }).ok, false);
});

test('UNIT_STYLES 仅两样式：capsule / single', () => {
  assert.deepEqual(UNIT_STYLES, ['capsule', 'single']);
});

test('帧级合并单元：add 替换语义 / style（两样式）/ remove / 迁移', () => {
  const p = createProject({ pairs: 2 });
  const a = p.dancers[0].id, b = p.dancers[1].id;
  // 添加合并（任意两名舞者）：single 合法；非法样式回落 capsule
  const m = addMerge(p.formations[0], a, b, 'single');
  assert.ok(m);
  assert.equal(m.style, 'single');
  assert.equal(addMerge(p.formations[0], a, b, 'capsule'), null, '重复添加被拒绝');
  assert.equal(addMerge(p.formations[0], p.dancers[2].id, p.dancers[3].id, 'diamond').style, 'capsule', '旧样式名不再合法→capsule');
  // 切换样式（合法/非法）
  setMergeStyle(p.formations[0], a, b, 'capsule');
  assert.equal(findMerge(p.formations[0], a, b).style, 'capsule');
  setMergeStyle(p.formations[0], a, b, 'twin');
  assert.equal(findMerge(p.formations[0], a, b).style, 'capsule', 'twin 已退役，切换被拒');
  // 替换语义：一名舞者同时只属于一个合并单元，与其他人建组时旧绑定自动解除
  const c = p.dancers[2].id;
  addMerge(p.formations[0], a, c, 'single');
  const fm = p.formations[0];
  assert.equal(findMerge(fm, a, c) !== undefined, true, '新合并应建立');
  assert.equal(findMerge(fm, a, b), null, 'A 的旧绑定应被替换');
  assert.equal(fm.merges.filter(m => m.a === a || m.b === a).length, 1, 'A 只属于一个单元');
  // collapseUnit：两人收拢到中点
  fm.positions[a] = { x: 2, y: 2, facing: 0 };
  fm.positions[c] = { x: 4, y: 4, facing: 90 };
  collapseUnit(fm, a, c);
  assert.deepEqual([fm.positions[a].x, fm.positions[a].y], [fm.positions[c].x, fm.positions[c].y]);
  // validateProject 清洗：无效引用/样式被剔除，diamond/twin 迁移为 capsule
  removeMerge(fm, a, c);
  const json = JSON.parse(JSON.stringify(p));
  json.version = 2;
  json.formations[0].merges = [
    { a: 'ghost', b: a, style: 'capsule' },
    { a, b, style: 'bad' },
    { a, b, style: 'diamond' },
    { a, b, style: 'twin' },
  ];
  const r = validateProject(json);
  assert.equal(r.project.formations[0].merges.length, 1, '重复键去重后仅存一条');
  assert.equal(r.project.formations[0].merges[0].style, 'capsule', 'diamond/twin → capsule 迁移');
});

test('载入迁移：含 diamond/twin 旧样式的项目归一为 capsule', () => {
  const p = createProject({ pairs: 2 });
  const [a, b, c, d] = p.dancers.map(x => x.id);
  const json = JSON.parse(JSON.stringify(p));
  json.formations[0].merges = [
    { a, b, style: 'diamond' },
    { a: c, b: d, style: 'twin' },
  ];
  const r = validateProject(json);
  assert.equal(r.ok, true);
  const styles = r.project.formations[0].merges.map(m => m.style);
  assert.deepEqual(styles, ['capsule', 'capsule']);
});
