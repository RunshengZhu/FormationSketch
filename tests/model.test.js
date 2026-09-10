// model.js 单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, addDancer, addPair, removeDancer, removePair, partnerOf, orderedDancers,
  createFormationFrom, deleteFormation, moveFormation, syncTimeline,
  computeSegments, posAt, spb, beatToSec, secToBeat, beatLabel,
  lerpAngle, validateProject, renameShortsByPair, ensureFormationComplete, uid, clone, addPairByIds,
} from '../js/model.js';

test('createProject：舞者/舞对数量与编号', () => {
  const p = createProject({ title: 'T', pairs: 6, extraM: 1, extraF: 2 });
  assert.equal(p.dancers.length, 12 + 3);
  assert.equal(p.pairs.length, 6);
  assert.equal(p.formations.length, 1);
  // 舞对编号：第 1 对的男女 short 均为 "1"
  const pr = p.pairs[0];
  const l = p.dancers.find(d => d.id === pr.leader);
  const f = p.dancers.find(d => d.id === pr.follower);
  assert.equal(l.short, '1');
  assert.equal(f.short, '1');
  assert.equal(l.role, 'M'); assert.equal(f.role, 'F');
  // 初始队形覆盖所有舞者
  ensureFormationComplete(p, p.formations[0]);
  for (const d of p.dancers) assert.ok(p.formations[0].positions[d.id], `缺 ${d.name}`);
});

test('partnerOf / orderedDancers', () => {
  const p = createProject({ pairs: 3 });
  const pr = p.pairs[1];
  assert.equal(partnerOf(p, pr.leader), pr.follower);
  assert.equal(partnerOf(p, pr.follower), pr.leader);
  const solo = addDancer(p, '独舞', 'X');
  assert.equal(partnerOf(p, solo.id), null);
  const ordPair = orderedDancers(p, 'pair');
  assert.equal(ordPair.length, 7); // 3对 + 1单人
  // 舞对相邻
  assert.equal(ordPair.indexOf(pr.leader) + 1, ordPair.indexOf(pr.follower));
  assert.equal(orderedDancers(p, 'dancer').length, 7);
});

test('removeDancer 清理舞对与位置', () => {
  const p = createProject({ pairs: 2 });
  const pr = p.pairs[0];
  createFormationFrom(p, 0);
  removeDancer(p, pr.leader);
  assert.equal(p.pairs.length, 1);
  for (const f of p.formations) assert.ok(!(pr.leader in f.positions));
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

test('validateProject：坏数据修复与往返一致', () => {
  const p = createProject({ pairs: 2 });
  createFormationFrom(p, 0);
  const json = JSON.parse(JSON.stringify(p));
  // 破坏：悬空舞对、坏位置、空队形数组
  json.pairs.push({ id: 'bad', leader: 'nope', follower: 'nada' });
  json.formations[0].positions['ghost'] = { x: 1, y: 1, facing: 400 };
  const { ok, errors, project: fixed } = validateProject(json);
  assert.equal(ok, true);
  assert.equal(errors.length, 0);
  assert.equal(fixed.pairs.length, 2);
  assert.ok(!('ghost' in fixed.formations[0].positions));
  const facing = Object.values(fixed.formations[0].positions)[0].facing;
  assert.ok(facing >= 0 && facing < 360);
  assert.equal(fixed.timeline.blocks.length, fixed.formations.length);
  // 再校验一次往返
  const again = validateProject(clone(fixed));
  assert.equal(again.ok, true);
});

test('renameShortsByPair 与 removePair', () => {
  const p = createProject({ pairs: 3 });
  const pr0 = p.pairs[0];
  removePair(p, pr0.id);
  renameShortsByPair(p);
  const l1 = p.dancers.find(d => d.id === p.pairs[0].leader);
  assert.equal(l1.short, '1');
});

test('uid 唯一性', () => {
  const s = new Set();
  for (let i = 0; i < 1000; i++) s.add(uid('x'));
  assert.equal(s.size, 1000);
});

test('addPairByIds：组对/重复绑定拒绝/编号不冲突', () => {
  const p = createProject({ pairs: 2 });
  const soloM = addDancer(p, '新男', 'M');
  const soloF = addDancer(p, '新女', 'F');
  const pair = addPairByIds(p, soloM.id, soloF.id);
  assert.ok(pair, '应创建成功');
  assert.equal(partnerOf(p, soloM.id), soloF.id);
  // 已配对者不能再组
  assert.equal(addPairByIds(p, soloM.id, p.dancers[0].id), null);
  // 新对两人共享编号，且不与任何其他舞者冲突
  const newShort = p.dancers.find(d => d.id === soloM.id).short;
  assert.equal(newShort, p.dancers.find(d => d.id === soloF.id).short);
  assert.ok(!p.dancers.some(d => d.id !== soloM.id && d.id !== soloF.id && d.short === newShort), '编号不与外pairs冲突');
  // 拆对后可重新组对
  removePair(p, pair.id);
  assert.equal(partnerOf(p, soloM.id), null);
  assert.ok(addPairByIds(p, soloM.id, soloF.id));
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
