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
  createFormationFrom, deleteFormation, moveFormation,
  segmentsFromClips, clipStartOf, clipLenOf, clipEndOf,
  FORM_CLIP_LEN_DEFAULT, posAt, spb, beatToSec, secToBeat, beatLabel,
  lerpAngle, validateProject, renumberShorts, ensureFormationComplete, uid, clone,
  addMerge, removeMerge, setMergeStyle, findMerge, collapseUnit, UNIT_STYLES,
  createGroup, removeGroup, renameGroup, setGroupMembers, nextGroupName, groupById, expandUnits,
  sanitizeAudioClips,
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

// ---------- 初始化预设「已组合」（presetMerged） ----------
test('createProject presetMerged：每对合并为 capsule 且位置收拢，groups 正常', () => {
  const p = createProject({ title: '预设', pairs: 6, presetMerged: true });
  const f = p.formations[0];
  // merges 数 = 对数，全部 capsule
  assert.equal(f.merges.length, 6);
  assert.ok(f.merges.every(m => m.style === 'capsule'));
  // 每对 M_i×F_i 恰在同一个单元里，且两人位置重合（收拢）；键集合 = 全体舞者
  const byName = n => p.dancers.find(d => d.name === n);
  for (let i = 1; i <= 6; i++) {
    const m = byName(`M${i}`), w = byName(`F${i}`);
    const u = f.merges.find(x => (x.a === m.id && x.b === w.id) || (x.a === w.id && x.b === m.id));
    assert.ok(u, `M${i}×F${i} 应在同一合并单元`);
    const a = f.positions[u.a], b = f.positions[u.b];
    assert.equal(a.x, b.x); assert.equal(a.y, b.y, '收拢后两人重合');
  }
  assert.deepEqual(Object.keys(f.positions).sort(), p.dancers.map(d => d.id).sort(), 'positions 键 === dancers');
  // 位置保持双横排布局节奏：所有单元中心只落在两行 y 上
  const ys = new Set(f.merges.map(u => f.positions[u.a].y));
  assert.equal(ys.size, 2);
  // 默认编组方案照常（gender → 男士/女士两组，全员入组）
  assert.equal(p.groups.length, 2);
  const men = p.groups.find(g => g.name === '男士'), women = p.groups.find(g => g.name === '女士');
  assert.equal(men.memberIds.length, 6);
  assert.equal(women.memberIds.length, 6);
  // 拆开一个单元后两人原地独立（与手动 merge 数据形态一致）
  const [u0] = f.merges;
  removeMerge(f, u0.a, u0.b);
  assert.equal(f.merges.length, 5);
  assert.ok(f.positions[u0.a] && f.positions[u0.b]);
});

test('createProject presetMerged：8 对 + grouping none；validate 往返合法；默认（未传）不合并', () => {
  const p8 = createProject({ pairs: 8, presetMerged: true, grouping: 'none' });
  assert.equal(p8.formations[0].merges.length, 8);
  assert.ok(p8.formations[0].merges.every(m => m.style === 'capsule'));
  assert.deepEqual(p8.groups, []);
  assert.equal(p8.dancers.length, 16);
  // 经 validateProject 消毒后 merges 原样保留（引用有效、样式合法）
  const r = validateProject(JSON.parse(JSON.stringify(p8)));
  assert.equal(r.ok, true);
  assert.equal(r.project.formations[0].merges.length, 8);
  assert.ok(r.project.formations[0].merges.every(m => m.style === 'capsule'));
  assert.deepEqual(Object.keys(r.project.formations[0].positions).sort(), r.project.dancers.map(d => d.id).sort());
  // 默认不合并（现状回归）
  const pd = createProject({ pairs: 6 });
  assert.equal(pd.formations[0].merges, undefined);
  // presetMerged=false 显式传入同样不合并
  const pf = createProject({ pairs: 2, presetMerged: false });
  assert.equal(pf.formations[0].merges, undefined);
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

test('createFormationFrom / deleteFormation / moveFormation（build-70 clip 语义：追加在末、删除留空位、换序换槽）', () => {
  const p = createProject({ pairs: 2 });
  p.formations[0].lenBeats = 20; // clip0 [0,20)
  createFormationFrom(p, 0);     // 追加在末 clip.end 之后 → [20,36)
  createFormationFrom(p, 1);     // [36,52)
  assert.equal(p.formations.length, 3);
  assert.equal(clipStartOf(p.formations[0]), 0);
  assert.equal(clipLenOf(p.formations[0]), 20, '时长保留');
  assert.equal(clipStartOf(p.formations[1]), 20, '新 clip 追加在末 clip.end 之后');
  assert.equal(clipLenOf(p.formations[1]), FORM_CLIP_LEN_DEFAULT, '新 clip 缺省 16 拍');
  const slotsBefore = p.formations.map(f => [f.startBeat, f.lenBeats]);
  // 删除=移除 formation+clip，空位保留：后续 clip 的 startBeat/lenBeats 一个字节不动
  deleteFormation(p, 0);
  assert.equal(p.formations.length, 2);
  assert.deepEqual(p.formations.map(f => [f.startBeat, f.lenBeats]),
    slotsBefore.slice(1), '被删 clip 的空位保留（后续 clip 时域零触碰）');
  // 调整顺序：clip 槽位留在原地、内容按新序换槽（旧 syncTimeline「时长保序、内容换位」对应）
  const ids = p.formations.map(f => f.id);
  moveFormation(p, 1, 0);
  assert.deepEqual(p.formations.map(f => [f.startBeat, f.lenBeats]), slotsBefore.slice(1), '槽位集合不变');
  assert.deepEqual(p.formations.map(f => f.id), [ids[1], ids[0]], '内容按新序换槽');
});

test('segmentsFromClips / posAt：clip 保持与空隙变换段（build-70 M3 同链换源）', () => {
  const p = createProject({ pairs: 1 });
  const a = { x: 2, y: 2, facing: 0 };
  const b = { x: 6, y: 2, facing: 90 };
  p.formations[0].positions[p.dancers[0].id] = a;
  createFormationFrom(p, 0);
  p.formations[1].positions[p.dancers[0].id] = b;
  // 旧夹具（hold8+travel8 / hold4）→ clip 等价域：f0 [0,8)、空隙 8、f1 [16,20)
  p.formations[0].lenBeats = 8;
  p.formations[1].startBeat = 16;
  p.formations[1].lenBeats = 4;
  const { segments, totalBeats } = segmentsFromClips(p.formations);
  assert.equal(totalBeats, 8 + 8 + 4, '域尾=末 clip.end（空隙计入域）');
  assert.deepEqual([segments[0].start, segments[0].end, segments[1].start, segments[1].end], [0, 8, 16, 20]);
  // clip 内：原位保持
  const r0 = posAt(p, 0);
  assert.equal(r0.phase, 'hold');
  assert.equal(r0.positions[p.dancers[0].id].x, 2);
  // 空隙中点：变换段（prev→next 插值 + 缓动 easeInOut(0.5)=0.5）
  const rm = posAt(p, 12);
  assert.equal(rm.phase, 'travel');
  assert.ok(Math.abs(rm.positions[p.dancers[0].id].x - 4) < 1e-9);
  // 空隙前段：缓动慢于线性
  const rq = posAt(p, 10); // t=(10−8)/(16−8)=0.25 → ease=4*0.25^3=0.0625
  assert.ok(Math.abs(rq.positions[p.dancers[0].id].x - (2 + 4 * 0.0625)) < 1e-9);
  // 超出末尾：最后队形
  const re = posAt(p, 999);
  assert.equal(re.phase, 'hold');
  assert.equal(re.positions[p.dancers[0].id].x, 6);
  // 负拍（候场）：第 0 队形
  assert.equal(posAt(p, -5).positions[p.dancers[0].id].x, 2);
  // 空隙 0：瞬时切换（travel 分支不可达）
  const p2 = createProject({ pairs: 1 });
  p2.formations[0].positions[p2.dancers[0].id] = a;
  createFormationFrom(p2, 0);
  p2.formations[1].positions[p2.dancers[0].id] = b;
  assert.equal(posAt(p2, 16).phase, 'hold', 'clip1 起点=hold（空隙 0 无变换段）');
  assert.equal(posAt(p2, 16).positions[p2.dancers[0].id].x, 6);
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
  // build-70：clip 不变式收口（旧 blocks 断言换源）——数组序=时间序、lenBeats ≥ 1、逐 clip 有域
  const clips = fixed.formations.map(f => [clipStartOf(f), clipLenOf(f)]);
  for (let k = 0; k + 1 < clips.length; k++) {
    assert.ok(clips[k][0] + clips[k][1] <= clips[k + 1][0] + 1e-9, '交叉禁止：clip.end ≤ 右邻.start');
  }
  assert.ok(clips.every(([s, l]) => s >= 0 && l >= 1), 'startBeat ≥ 0、lenBeats ≥ 1');
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

// ---------- 滑动变速（varispeed · clip.rate 清洗五态） ----------
test('sanitizeAudioClips rate 五态：缺省/1/非法删键、合法保留两位小数、越界钳 [0.25,4]；清洗幂等', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const mk = (id, rate) => (rate === undefined
    ? { id, assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5 }
    : { id, assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5, rate });
  const clips = sanitizeAudioClips([
    mk('r0'),               // ① 缺省 → 删键（不补键，读侧 clip.rate || 1）
    mk('r1', 1),            // ② 1 → 删键（JSON 往返零漂移）
    mk('r2', 1.234),        // ③ 合法 → 两位小数 1.23
    mk('r3', 12),           // ④ 越上界 → 钳 4
    mk('r4', 0.01),         // ④' 越下界 → 钳 0.25
    mk('r5', 'abc'),        // ⑤ 非法（非数值）→ 删键
    mk('r6', NaN),          // ⑤' 非法（NaN）→ 删键
  ], assets);
  assert.equal(clips.length, 7);
  assert.equal('rate' in clips[0], false, '缺省不补键');
  assert.equal('rate' in clips[1], false, 'rate=1 删键');
  assert.equal(clips[2].rate, 1.23, '保留两位小数（1% 粒度）');
  assert.equal(clips[3].rate, 4, '越上界钳 4');
  assert.equal(clips[4].rate, 0.25, '越下界钳 0.25');
  assert.equal('rate' in clips[5], false, '非数值删键');
  assert.equal('rate' in clips[6], false, 'NaN 删键');
  // 时间轴 slot 域不受 rate 影响；清洗幂等（含 rate 键形态二次清洗逐字节一致）
  assert.deepEqual(
    clips.map(c => [c.timelineStartSec, c.srcStartSec, c.lengthSec]),
    clips.map(() => [0, 0, 5]),
  );
  const again = sanitizeAudioClips(JSON.parse(JSON.stringify(clips)), assets);
  assert.deepEqual(again, clips, 'rate 清洗幂等（JSON 往返零漂移）');
});

// ---------- 离线变速/变调（TSM · clip.speed + clip.pitchSemi 清洗五态） ----------
test('sanitizeAudioClips speed 五态：缺省/1/≈1/非法删键、合法保留两位小数、越界钳 [0.25,4]；清洗幂等', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const mk = (id, speed) => (speed === undefined
    ? { id, assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5 }
    : { id, assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5, speed });
  const clips = sanitizeAudioClips([
    mk('s0'),               // ① 缺省 → 删键（不补键，读侧 clip.speed || 1）
    mk('s1', 1),            // ② 1 → 删键（JSON 往返零漂移）
    mk('s1b', 1.002),       // ②' ≈1（两位小数后=1.00）→ 删键
    mk('s2', 1.234),        // ③ 合法 → 两位小数 1.23
    mk('s3', 12),           // ④ 越上界 → 钳 4
    mk('s4', 0.01),         // ④' 越下界 → 钳 0.25
    mk('s5', 'abc'),        // ⑤ 非法（非数值）→ 删键
    mk('s6', NaN),          // ⑤' 非法（NaN）→ 删键
  ], assets);
  assert.equal(clips.length, 8);
  assert.equal('speed' in clips[0], false, '缺省不补键');
  assert.equal('speed' in clips[1], false, 'speed=1 删键');
  assert.equal('speed' in clips[2], false, 'speed≈1（1.002→1.00）删键');
  assert.equal(clips[3].speed, 1.23, '保留两位小数（1% 粒度）');
  assert.equal(clips[4].speed, 4, '越上界钳 4');
  assert.equal(clips[5].speed, 0.25, '越下界钳 0.25');
  assert.equal('speed' in clips[6], false, '非数值删键');
  assert.equal('speed' in clips[7], false, 'NaN 删键');
  // 时间轴 slot 域不受 speed 影响；清洗幂等（JSON 往返零漂移）
  assert.deepEqual(
    clips.map(c => [c.timelineStartSec, c.srcStartSec, c.lengthSec]),
    clips.map(() => [0, 0, 5]),
  );
  const again = sanitizeAudioClips(JSON.parse(JSON.stringify(clips)), assets);
  assert.deepEqual(again, clips, 'speed 清洗幂等');
});

test('sanitizeAudioClips pitchSemi 五态：缺省/0/非法删键、整数保留、越界钳 [-12,12]；清洗幂等', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const mk = (id, pitchSemi) => (pitchSemi === undefined
    ? { id, assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5 }
    : { id, assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5, pitchSemi });
  const clips = sanitizeAudioClips([
    mk('p0'),               // ① 缺省 → 删键（读侧 clip.pitchSemi || 0）
    mk('p1', 0),            // ② 0 → 删键（JSON 往返零漂移）
    mk('p2', 3),            // ③ 合法整数 → 保留
    mk('p2b', '5'),         // ③' 数值字符串整值 → 保留 5
    mk('p3', 20),           // ④ 越上界 → 钳 12
    mk('p4', -20),          // ④' 越下界 → 钳 -12
    mk('p5', 2.5),          // ⑤ 非法（非整值）→ 删键
    mk('p6', 'abc'),        // ⑤' 非法（非数值）→ 删键
    mk('p7', NaN),          // ⑤'' 非法（NaN）→ 删键
  ], assets);
  assert.equal(clips.length, 9);
  assert.equal('pitchSemi' in clips[0], false, '缺省不补键');
  assert.equal('pitchSemi' in clips[1], false, 'pitchSemi=0 删键');
  assert.equal(clips[2].pitchSemi, 3, '合法整数保留');
  assert.equal(clips[3].pitchSemi, 5, '数值字符串整值保留');
  assert.equal(clips[4].pitchSemi, 12, '越上界钳 12');
  assert.equal(clips[5].pitchSemi, -12, '越下界钳 -12');
  assert.equal('pitchSemi' in clips[6], false, '非整值删键');
  assert.equal('pitchSemi' in clips[7], false, '非数值删键');
  assert.equal('pitchSemi' in clips[8], false, 'NaN 删键');
  const again = sanitizeAudioClips(JSON.parse(JSON.stringify(clips)), assets);
  assert.deepEqual(again, clips, 'pitchSemi 清洗幂等');
});

test('sanitizeAudioClips speed/pitchSemi 与 rate 同 clip 并存：各自独立落键、联合清洗幂等', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const clips = sanitizeAudioClips([
    { id: 'm1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 5, rate: 1.5, speed: 0.5, pitchSemi: -2 },
  ], assets);
  assert.deepEqual({ rate: clips[0].rate, speed: clips[0].speed, pitchSemi: clips[0].pitchSemi },
    { rate: 1.5, speed: 0.5, pitchSemi: -2 }, '三字段独立保留');
  const again = sanitizeAudioClips(JSON.parse(JSON.stringify(clips)), assets);
  assert.deepEqual(again, clips, '联合清洗幂等（JSON 往返零漂移）');
});
