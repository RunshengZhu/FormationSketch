// 时间轴标记（timeline.tags）单元测试 —— 音乐时间轴 tag 道（主歌/副歌/间奏等分段记号）。
// 覆盖：模型 CRUD/默认命名/超长截断、validateProject 清洗与导出导入往返、undo 语义
// （打/改/移/删各恰一条历史、拖拽预览 mutate(null)+commit 一条）、beat 换算随 BPM/首拍、
// tags 纯标记不影响播放/队形逻辑（computeSegments/posAt 零变化）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, computeSegments, posAt, totalDurationSec, spb, beatToSec,
  validateProject, addTag, removeTag, renameTag, moveTag, tagById, nextTagName,
  sanitizeTags, TAG_NAME_MAX,
} from '../js/model.js';
import * as store from '../js/store.js';

test('createProject 自带 timeline.tags=[]（新项目从出生就有 tag 道数据位）', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  assert.deepEqual(p.timeline.tags, []);
});

test('addTag：显式命名/默认「标记 N」/负拍钳 0/返回带 id 的标记', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  const a = addTag(p, 16, '主歌');
  assert.equal(a.name, '主歌');
  assert.equal(a.beat, 16);
  assert.ok(a.id, '应有 id');
  const b = addTag(p, 32); // 缺省名
  assert.equal(b.name, '标记 2');
  const c = addTag(p, -3, '负拍');
  assert.equal(c.beat, 0, '负拍钳为 0');
  assert.equal(p.timeline.tags.length, 3);
});

test('nextTagName：从现有数量+1 起找第一个未占用号（删除后打点不重名）', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  addTag(p, 8, '主歌');
  addTag(p, 16); // 标记 2
  assert.equal(nextTagName(p), '标记 3');
  removeTag(p, tagById(p, p.timeline.tags[1].id).id);
  assert.equal(nextTagName(p), '标记 2', '删掉标记 2 后应补回 2');
  addTag(p, 24, '标记 3'); // 手动占用 3
  assert.equal(nextTagName(p), '标记 4');
});

test('renameTag：改名生效；空名/纯空白/未知 id 不改；超长截断 20 字', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  const t = addTag(p, 8, '主歌');
  renameTag(p, t.id, '副歌');
  assert.equal(t.name, '副歌');
  renameTag(p, t.id, '   ');
  assert.equal(t.name, '副歌', '纯空白名不生效');
  renameTag(p, t.id, '');
  assert.equal(t.name, '副歌');
  renameTag(p, 'tag_unknown', 'X');
  assert.equal(t.name, '副歌', '未知 id no-op');
  const long = '一二三四五六七八九十一二三四五六七八九十一二三四五'; // 25 字
  renameTag(p, t.id, long);
  assert.equal(t.name.length, TAG_NAME_MAX);
  assert.equal(t.name, long.slice(0, 20));
});

test('moveTag：移动拍位/负值钳 0/浮点两位舍入/未知 id no-op', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  const t = addTag(p, 8, 'A');
  moveTag(p, t.id, 24.375);
  assert.equal(t.beat, 24.38); // 三位小数 → 两位舍入
  moveTag(p, t.id, -5);
  assert.equal(t.beat, 0);
  moveTag(p, t.id, 16.006);
  assert.equal(t.beat, 16.01, '浮点两位舍入（16.006 → 16.01）');
  moveTag(p, 'nope', 99);
  assert.ok(p.timeline.tags.every(x => x.beat !== 99));
});

test('removeTag：删除生效；未知 id no-op', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  const a = addTag(p, 8, 'A');
  const b = addTag(p, 16, 'B');
  removeTag(p, a.id);
  assert.equal(p.timeline.tags.length, 1);
  assert.equal(p.timeline.tags[0].id, b.id);
  removeTag(p, 'nope');
  assert.equal(p.timeline.tags.length, 1);
});

test('sanitizeTags：非数组→[]；非对象项/beat 非有限/负值/空名/重复 id（保首弃后）/缺 id 补 uid/名称截断', () => {
  const out = sanitizeTags([
    { id: 't1', beat: 4, name: '主歌' },
    null,
    'junk',
    { id: 't2', beat: 'abc', name: 'X' },      // beat 非有限 → 丢
    { id: 't3', beat: -1, name: 'X' },          // 负值 → 丢
    { id: 't4', beat: 8, name: '  ' },          // 空名 → 丢
    { id: 't1', beat: 99, name: '重复' },       // 重复 id → 丢（保首）
    { beat: 12, name: '补id' },                 // 缺 id → 补 uid
    { id: 't5', beat: 16, name: '一二三四五六七八九十一二三四五六七八九十一二三四五' }, // 截断
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: 't1', beat: 4, name: '主歌' });
  assert.ok(out[1].id.startsWith('tag_'), '缺 id 应补 uid');
  assert.equal(out[1].beat, 12);
  assert.equal(out[2].name.length, TAG_NAME_MAX);
  assert.deepEqual(sanitizeTags('nope'), []);
  assert.deepEqual(sanitizeTags(undefined), []);
});

test('validateProject：旧项目无 tags → 补 []；垃圾 tags 全丢 → []；ok 不受影响', () => {
  const base = { version: 1, dancers: [], formations: [{ id: 'f1', name: 'F', positions: {} }], timeline: { blocks: [] } };
  const r1 = validateProject(JSON.parse(JSON.stringify(base)));
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.project.timeline.tags, []);
  const dirty = JSON.parse(JSON.stringify(base));
  dirty.timeline.tags = [{ beat: 4, name: 'ok' }, { beat: -2, name: 'neg' }, { beat: 8, name: '' }, 'x'];
  const r2 = validateProject(dirty);
  assert.equal(r2.ok, true, 'tags 清洗不产生项目级错误');
  assert.equal(r2.project.timeline.tags.length, 1);
  assert.equal(r2.project.timeline.tags[0].name, 'ok');
});

test('validateProject：导出→导入自然往返（id/beat/name 逐字段保真，无需版本迁移）', () => {
  const p = createProject({ title: '往返', pairs: 2 });
  addTag(p, 16, '主歌');
  addTag(p, 48.25, '副歌');
  addTag(p, 80, '间奏');
  const exported = JSON.parse(JSON.stringify(p)); // exportProjectJSON 的 cloneBasic 同构
  delete exported.id;
  const r = validateProject(exported);
  assert.equal(r.ok, true);
  assert.deepEqual(r.project.timeline.tags, p.timeline.tags);
});

test('tags 纯标记：增删改不改 computeSegments/posAt/totalDurationSec（不影响播放与队形逻辑）', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  const segs0 = computeSegments(p);
  const total0 = totalDurationSec(p);
  const pos0 = posAt(p, 20);
  addTag(p, 20, '标记');
  moveTag(p, p.timeline.tags[0].id, 30);
  removeTag(p, p.timeline.tags[0].id);
  addTag(p, 20, '再打');
  const segs1 = computeSegments(p);
  const total1 = totalDurationSec(p);
  const pos1 = posAt(p, 20);
  assert.deepEqual(segs1.segments.map(s => ({ ...s })), segs0.segments.map(s => ({ ...s })));
  assert.equal(total1, total0);
  assert.deepEqual(pos1.positions, pos0.positions);
  assert.equal(pos1.seg.i, pos0.seg.i);
});

test('beat 换算随 BPM：tag 拍位不变、秒位随动（bpm 120→60 秒位翻倍）；firstBeatSec 平移秒位', () => {
  const p = createProject({ title: 'T', pairs: 2 });
  p.audio.firstBeatSec = 0;
  p.audio.bpm = 120;
  addTag(p, 16, '副歌');
  assert.equal(beatToSec(p, 16), 16 * spb(p)); // 16 × 0.5 = 8s
  assert.equal(beatToSec(p, p.timeline.tags[0].beat), 8);
  p.audio.bpm = 60;
  assert.equal(p.timeline.tags[0].beat, 16, '拍位不变');
  assert.equal(beatToSec(p, p.timeline.tags[0].beat), 16, '秒位随 BPM 翻倍');
  p.audio.firstBeatSec = 2;
  assert.equal(beatToSec(p, p.timeline.tags[0].beat), 18, '首拍偏移平移秒位');
  // 经 validateProject 往返后同样成立（导入改 BPM 场景）
  const r = validateProject(JSON.parse(JSON.stringify(p)));
  r.project.audio.bpm = 240;
  assert.equal(beatToSec(r.project, r.project.timeline.tags[0].beat), 2 + 16 * spb(r.project));
});

// ---------- undo 语义（store.mutate 历史） ----------
test('undo：打标记 → undo 消失 → redo 回来（历史恰一条、label=打标记）', () => {
  store.createNewProject({ title: 'U1', pairs: 2 });
  const before = JSON.stringify(store.getState().project.timeline.tags);
  store.mutate(p => { addTag(p, 16, '主歌'); }, '打标记');
  assert.equal(store.undoLabel(), '打标记');
  assert.equal(store.getState().project.timeline.tags.length, 1);
  store.undo();
  assert.equal(JSON.stringify(store.getState().project.timeline.tags), before);
  store.redo();
  assert.equal(store.getState().project.timeline.tags.length, 1);
  assert.equal(store.getState().project.timeline.tags[0].name, '主歌');
});

test('undo：改名/移动/删除各恰一条历史（label 对应）', () => {
  store.createNewProject({ title: 'U2', pairs: 2 });
  let id = '';
  store.mutate(p => { id = addTag(p, 8, '主歌').id; }, '打标记');
  store.mutate(p => { renameTag(p, id, '副歌'); }, '改标记');
  assert.equal(store.undoLabel(), '改标记');
  store.undo();
  assert.equal(store.getState().project.timeline.tags[0].name, '主歌', '改标记可单步撤销');
  store.mutate(p => { moveTag(p, id, 24); }, '移动标记');
  assert.equal(store.undoLabel(), '移动标记');
  store.undo();
  assert.equal(store.getState().project.timeline.tags[0].beat, 8, '移动可单步撤销');
  store.mutate(p => { removeTag(p, id); }, '删标记');
  assert.equal(store.undoLabel(), '删标记');
  store.undo();
  assert.equal(store.getState().project.timeline.tags.length, 1, '删除可单步撤销');
  assert.equal(store.getState().project.timeline.tags[0].id, id);
});

test('undo：拖拽移动语义 = mutate(null) 实时预览不进历史 + commit(移动标记) 恰一条', () => {
  store.createNewProject({ title: 'U3', pairs: 2 });
  let id = '';
  store.mutate(p => { id = addTag(p, 8, 'A').id; }, '打标记');
  const depthAfterAdd = store.canUndo();
  // 拖拽中：多次预览（等价真实拖动的 pointermove 序列）
  store.mutate(p => { moveTag(p, id, 10); }, null);
  store.mutate(p => { moveTag(p, id, 12); }, null);
  store.mutate(p => { moveTag(p, id, 16.5); }, null);
  assert.equal(store.canUndo(), depthAfterAdd, '预览不产生新历史');
  store.commit('移动标记');
  assert.equal(store.undoLabel(), '移动标记');
  assert.equal(store.getState().project.timeline.tags[0].beat, 16.5);
  store.undo();
  assert.equal(store.getState().project.timeline.tags[0].beat, 8, '一次 undo 回到拖前');
  store.redo();
  assert.equal(store.getState().project.timeline.tags[0].beat, 16.5, 'redo 回到拖后');
});

test('undo：标签操作与队形操作混用互不干扰（undo 逐条回退）', () => {
  store.createNewProject({ title: 'U4', pairs: 2 });
  store.mutate(p => { addTag(p, 8, '主歌'); }, '打标记');
  const n0 = store.getState().project.formations.length;
  store.mutate(p => { p.timeline.blocks[0].holdBeats = 20; }, '调整保持时长');
  store.undo(); // 回退时长
  assert.equal(store.getState().project.timeline.blocks[0].holdBeats, 16);
  assert.equal(store.getState().project.timeline.tags.length, 1, '标记不受影响');
  store.undo(); // 回退打标记
  assert.equal(store.getState().project.timeline.tags.length, 0);
  assert.equal(store.getState().project.formations.length, n0);
});
