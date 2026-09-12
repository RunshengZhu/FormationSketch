// store.js 单元测试（内存存储回退 + 撤销/重做）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/store.js';
import * as M from '../js/model.js';

test('mutate + commit + undo/redo', () => {
  store.createNewProject({ title: 'A', pairs: 2 });
  const p0 = store.getState().project;
  assert.equal(store.canUndo(), false);

  store.mutate(p => { M.createFormationFrom(p, 0); }, '新队形');
  assert.equal(store.getState().project.formations.length, 2);
  assert.equal(store.canUndo(), true);

  store.mutate(p => { M.createFormationFrom(p, 1); }, '新队形');
  assert.equal(store.getState().project.formations.length, 3);

  store.undo();
  assert.equal(store.getState().project.formations.length, 2);
  store.undo();
  assert.equal(store.getState().project.formations.length, 1);
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), true);

  store.redo();
  assert.equal(store.getState().project.formations.length, 2);
  store.redo();
  assert.equal(store.getState().project.formations.length, 3);
  assert.equal(store.canRedo(), false);
  assert.ok(p0 !== store.getState().project, 'undo 后对象应被替换');
});

test('mutate(label=null) 不产生历史，commit 后可撤销', () => {
  store.createNewProject({ title: 'B', pairs: 2 });
  const before = store.canUndo();
  const id = store.getState().project.formations[0].positions;
  const key = Object.keys(id)[0];
  store.mutate(p => { p.formations[0].positions[key].x += 1; }, null); // 拖拽中
  assert.equal(store.canUndo(), before, '拖拽中不应产生新历史');
  store.commit('移动舞者');
  assert.equal(store.canUndo(), true);
  store.undo();
  assert.ok(Math.abs(store.getState().project.formations[0].positions[key].x % 0.5) < 1e-9);
});

test('重复 commit 相同状态被跳过', () => {
  store.createNewProject({ title: 'C', pairs: 1 });
  store.commit('空提交');
  assert.equal(store.canUndo(), false);
});

test('项目持久化：内存存储往返', async () => {
  store.createNewProject({ title: '持久', pairs: 3 });
  const p = store.getState().project;
  store.commit('修改');
  await store.storage.putProject(p);
  const got = await store.storage.getProject(p.id);
  assert.equal(got.meta.title, '持久');
  assert.equal(got.dancers.length, 6);
  assert.equal(got.groups.length, 2, '默认男士/女士编组随项目持久化');
  const list = await store.storage.listProjects();
  assert.ok(list.some(x => x.id === p.id));
  await store.storage.deleteProject(p.id);
  assert.equal(await store.storage.getProject(p.id), null);
});

test('音频 Blob 持久化往返', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
  await store.storage.putAudio('test-prj', blob);
  const got = await store.storage.getAudio('test-prj');
  assert.equal(got.size, 3);
});

test('undo 后 formationIndex 自校正', () => {
  store.createNewProject({ title: 'D', pairs: 1 });
  store.mutate(p => { M.createFormationFrom(p, 0); }, '新队形');
  store.setUI({ formationIndex: 1 });
  store.undo(); // 撤销新队形 → 队形只剩 1 个
  assert.ok(store.getState().formationIndex < store.getState().project.formations.length);
});

// ---------- 离线 localStorage 档（file:// 回退） ----------
// 通过「先设全局 location/localStorage 再动态 import（带 query 换模块实例）」模拟 file:// 打开场景；
// node --test 每个文件独立进程，全局污染不外泄。静态 import 的 store（无 location）即 http/Node 现状。
function fakeLs() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
async function loadStoreInMode(protocol, ls) {
  const prevLoc = globalThis.location;
  const prevLs = globalThis.localStorage;
  globalThis.location = { protocol };
  globalThis.localStorage = ls;
  const mod = await import(`../js/store.js?mode-${protocol}-${Math.random()}`);
  return { mod, restore: () => { globalThis.location = prevLoc; globalThis.localStorage = prevLs; } };
}

test('file 协议判定 → 选 localStorage 档；http 不走 LS', async () => {
  const fileCtx = await loadStoreInMode('file:', fakeLs());
  try {
    assert.equal(fileCtx.mod.STORAGE_MODE, 'ls');
    assert.equal(fileCtx.mod.isFileOrigin(), true);
  } finally { fileCtx.restore(); }

  const ls2 = fakeLs();
  const httpCtx = await loadStoreInMode('https:', ls2);
  try {
    assert.notEqual(httpCtx.mod.STORAGE_MODE, 'ls');
    assert.equal(httpCtx.mod.isFileOrigin(), false);
    // http 档绝不写 LS 键
    await httpCtx.mod.storage.putProject({ id: 'prj_http', meta: { title: 'x' }, dancers: [], groups: [], formations: [{ id: 'f', positions: {} }], timeline: { blocks: [] }, audio: {}, stage: {} });
    assert.equal(ls2.length, 0, 'https 下不应产生任何 wuzhen: 键');
  } finally { httpCtx.restore(); }
});

test('LS 档 CRUD/列表/删除语义与 IDB 档一致', async () => {
  const ls = fakeLs();
  const { mod, restore } = await loadStoreInMode('file:', ls);
  try {
    const p = M.createProject({ title: '离线测试', pairs: 2 });
    p.id = 'prj_ls1';
    await mod.storage.putProject(p);
    assert.ok(ls.getItem('wuzhen:proj:prj_ls1'), 'putProject 应写入 wuzhen:proj:<id> 键');
    const got = await mod.storage.getProject('prj_ls1');
    assert.equal(got.meta.title, '离线测试');
    assert.equal(got.dancers.length, 4);
    assert.ok(got.meta.updatedAt, 'putProject 应盖 updatedAt 时间戳');
    assert.ok(got !== p, 'getProject 返回反序列化新对象，不共享引用');
    // 列表按 updatedAt 降序（与 IDB 档一致）：直接写两条不同时间戳的记录
    const older = M.createProject({ title: '旧', pairs: 1 }); older.id = 'prj_old';
    older.meta.updatedAt = '2026-01-01T00:00:00.000Z';
    ls.setItem('wuzhen:proj:prj_old', JSON.stringify(older));
    const list = await mod.storage.listProjects();
    assert.equal(list.length, 2);
    assert.deepEqual(list.map(x => x.id), ['prj_ls1', 'prj_old']);
    // 删除后 getProject → null、列表为空；删除不存在的 id 不抛
    await mod.storage.deleteProject('prj_ls1');
    assert.equal(await mod.storage.getProject('prj_ls1'), null);
    await mod.storage.deleteProject('prj_never_existed');
    assert.equal((await mod.storage.listProjects()).length, 1);
  } finally { restore(); }
});

test('LS 档音频降级：putAudio 不落盘不抛、getAudio 返回空', async () => {
  const ls = fakeLs();
  const { mod, restore } = await loadStoreInMode('file:', ls);
  try {
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'audio/wav' });
    await mod.storage.putAudio('prj_ls2', blob); // 不得抛
    assert.equal(await mod.storage.getAudio('prj_ls2'), null);
    const audioKeys = [...Array(ls.length).keys()].map(i => ls.key(i)).filter(k => !k.startsWith('wuzhen:proj:'));
    assert.deepEqual(audioKeys, [], '音频不得写入 localStorage 任何键');
  } finally { restore(); }
});

test('LS 档脏数据清洗：不可解析条目移除、可解析条目 validate 净化，boot 不失败', async () => {
  const ls = fakeLs();
  const dirty = M.createProject({ title: '脏', pairs: 1 });
  dirty.id = 'prj_dirty';
  dirty.stage.widthM = '30';          // 字符串数值 → 应清洗为 number
  dirty.stage.depthM = 'not-a-num';   // 非法 → 回落默认 16
  ls.setItem('wuzhen:proj:prj_dirty', JSON.stringify(dirty));
  ls.setItem('wuzhen:proj:prj_broken', '{not-json'); // 不可解析 → 应被移除
  const { mod, restore } = await loadStoreInMode('file:', ls); // 模块加载即启动清洗
  try {
    const clean = await mod.storage.getProject('prj_dirty');
    assert.equal(typeof clean.stage.widthM, 'number');
    assert.equal(clean.stage.widthM, 30);
    assert.equal(clean.stage.depthM, 16);
    assert.equal(await mod.storage.getProject('prj_broken'), null);
    assert.equal(ls.getItem('wuzhen:proj:prj_broken'), null, '不可解析条目应在启动时移除');
    const list = await mod.storage.listProjects();
    assert.deepEqual(list.map(x => x.id), ['prj_dirty'], '脏数据不致 boot/列表失败');
  } finally { restore(); }
});
