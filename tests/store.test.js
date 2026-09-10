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
  assert.equal(got.pairs.length, 3);
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
