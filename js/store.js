// 集中状态树 + 撤销/重做 + IndexedDB 持久化（Node 环境自动降级为内存存储）
import { createProject, clone, uid, renameShortsByPair } from './model.js';

// ---------- 存储（IndexedDB / 内存回退） ----------
const memory = { projects: new Map(), audio: new Map() };
const hasIDB = typeof indexedDB !== 'undefined';
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('formation-studio', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  }));
}
export const storage = {
  async putProject(p) {
    p.meta.updatedAt = new Date().toISOString();
    if (!hasIDB) { memory.projects.set(p.id, clone(p)); return; }
    await tx('projects', 'readwrite', s => s.put(clone(p)));
  },
  async getProject(id) {
    if (!hasIDB) return memory.projects.get(id) ? clone(memory.projects.get(id)) : null;
    return await tx('projects', 'readonly', s => s.get(id));
  },
  async listProjects() {
    if (!hasIDB) return [...memory.projects.values()].sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
    const all = await tx('projects', 'readonly', s => s.getAll());
    return (all || []).sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
  },
  async deleteProject(id) {
    if (!hasIDB) { memory.projects.delete(id); memory.audio.delete(id); return; }
    await tx('projects', 'readwrite', s => s.delete(id));
    await tx('audio', 'readwrite', s => s.delete(id));
  },
  async putAudio(id, blob) {
    if (!hasIDB) { memory.audio.set(id, blob); return; }
    await tx('audio', 'readwrite', s => s.put(blob, id));
  },
  async getAudio(id) {
    if (!hasIDB) return memory.audio.get(id) || null;
    return await tx('audio', 'readonly', s => s.get(id));
  },
};

// ---------- 状态 ----------
let state = {
  view: 'library',           // library | editor
  theme: (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && localStorage.getItem('fs.theme')) || 'dark',
  project: null,
  projectId: null,
  formationIndex: 0,
  selection: [],             // dancer ids
  editMode: true,            // 编辑开关（默认开）：舞台可拖动编辑；关闭为查看模式
  theme: 'dark',             // dark | light（持久化到 localStorage）
  showFacingHandle: false,  // 朝向把手（样式类，默认隐藏）
  showGhost: true,
  showPaths: true,
  showGrid: true,
  previewOnSwitch: true,     // 切换队形帧时自动播放过渡动画
  ripple: true,
  playing: false,
  library: [],
};
const listeners = new Set();
export function getState() { return state; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of [...listeners]) fn(state); }
export function setUI(patch) {
  Object.assign(state, patch);
  if (patch.theme) { try { localStorage.setItem('fs.theme', patch.theme); } catch {} }
  emit();
}

// ---------- 撤销/重做 ----------
const history = { stack: [], index: -1, max: 60 };
let saveTimer = null;

function snapshotNow(label) { return { snap: JSON.stringify(state.project), label }; }
export function commit(label = '修改') {
  if (!state.project) return;
  const cur = JSON.stringify(state.project);
  if (history.index >= 0 && history.stack[history.index].snap === cur) return;
  history.stack.splice(history.index + 1);
  history.stack.push({ snap: cur, label });
  if (history.stack.length > history.max) history.stack.shift();
  history.index = history.stack.length - 1;
  scheduleSave();
}
export function canUndo() { return history.index > 0; }
export function canRedo() { return history.index < history.stack.length - 1; }
export function undo() {
  if (!canUndo()) return false;
  history.index--;
  state.project = JSON.parse(history.stack[history.index].snap);
  afterProjectSwap(); emit(); scheduleSave();
  return true;
}
export function redo() {
  if (!canRedo()) return false;
  history.index++;
  state.project = JSON.parse(history.stack[history.index].snap);
  afterProjectSwap(); emit(); scheduleSave();
  return true;
}
export function undoLabel() { return canUndo() ? history.stack[history.index].label : ''; }
function afterProjectSwap() {
  // 队形可能被撤销增删，修正当前索引
  const ids = state.project.formations.map(f => f.id);
  const cur = state.project.formations[state.formationIndex];
  if (!cur) state.formationIndex = Math.max(0, ids.length - 1);
}

// 变更入口：mutate(fn, label) 即时提交历史；拖拽过程用 mutate(fn, null) + 结束时 commit(label)
export function mutate(fn, label = null) {
  if (!state.project) return;
  fn(state.project);
  state.project.meta.updatedAt = new Date().toISOString();
  if (label !== null) commit(label); else { scheduleSave(); }
  emit();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (state.project) storage.putProject(state.project); }, 400);
}
// 页面隐藏/关闭前立即落盘，避免 debounce 丢最后一次编辑
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const flush = () => {
    if (document.visibilityState === 'hidden' && state.project) {
      clearTimeout(saveTimer);
      storage.putProject(state.project);
    }
  };
  document.addEventListener('visibilitychange', flush);
  window.addEventListener('pagehide', flush);
}

// ---------- 项目生命周期 ----------
function rememberLast(id) {
  try { localStorage.setItem('fs.lastProject', id); } catch {} // Node/隐私模式下无 localStorage
}
export async function init(preferId = null) {
  const list = await storage.listProjects();
  state.library = list;
  let target = preferId && list.find(p => p.id === preferId) ? preferId : (list[0]?.id || null);
  if (target) await openProject(target); else state.view = 'library';
  emit();
}
export async function refreshLibrary() {
  state.library = await storage.listProjects();
  emit();
}
export function createNewProject(opts) {
  const p = createProject(opts);
  p.id = uid('prj');
  rememberLast(p.id);
  state.project = p;
  state.projectId = p.id;
  state.formationIndex = 0;
  state.selection = [];
  history.stack = []; history.index = -1;
  commit('新建项目');
  state.view = 'editor';
  storage.putProject(p);
  emit();
  return p;
}
export async function openProject(id) {
  let p = await storage.getProject(id);
  if (!p) return false;
  p = M.validateProject(p).project; // 消毒历史脏数据（如字符串数值）
  rememberLast(id);
  state.project = p;
  state.projectId = id;
  state.formationIndex = 0;
  state.selection = [];
  history.stack = []; history.index = -1;
  commit('打开项目');
  state.view = 'editor';
  emit();
  return true;
}
export function importProject(json) {
  const p = json;
  p.id = uid('prj');
  rememberLast(p.id);
  p.meta = { ...p.meta, title: (p.meta?.title || '导入项目') + '（副本）' };
  state.project = p;
  state.projectId = p.id;
  state.formationIndex = 0;
  state.selection = [];
  history.stack = []; history.index = -1;
  commit('导入项目');
  state.view = 'editor';
  storage.putProject(p);
  emit();
}
export async function closeProject() {
  if (state.project) await storage.putProject(state.project);
  state.view = 'library';
  state.project = null;
  await refreshLibrary();
}
export async function deleteProjectById(id) {
  await storage.deleteProject(id);
  if (state.projectId === id) { state.project = null; state.view = 'library'; }
  await refreshLibrary();
}
export async function duplicateProject(id) {
  const p = await storage.getProject(id);
  if (!p) return;
  const oldId = p.id;
  p.id = uid('prj');
  p.meta.title = p.meta.title + '（副本）';
  p.meta.createdAt = new Date().toISOString();
  await storage.putProject(p);
  const blob = await storage.getAudio(oldId);
  if (blob) await storage.putAudio(p.id, blob); // 副本继承音频
  await refreshLibrary();
}

// ---------- 名册辅助动作 ----------
import * as M from './model.js';
export { M };
