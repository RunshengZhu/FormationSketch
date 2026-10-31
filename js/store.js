// 集中状态树 + 撤销/重做 + 持久化（http→IndexedDB；file:// 离线→localStorage；Node 环境自动降级为内存存储）
import { createProject, clone, uid } from './model.js';

// ---------- 存储（IndexedDB / localStorage 离线档 / 内存回退） ----------
const memory = { projects: new Map(), audio: new Map() };
const hasIDB = typeof indexedDB !== 'undefined';

// ---------- 后端选择（确定性，不混写） ----------
// file:// 双击打开的离线单文件：IndexedDB 在 file 源下是会话级（写后刷新即丢，实测），
// localStorage 则浏览器完全重启后仍存活（实测）→ 离线档唯一后端为 localStorage。
// http(s) 托管部署维持 IndexedDB（现状零改动）；两档互不读写。
// Node 测试环境无 location → 走原有 IDB/内存路径。
export function isFileOrigin() {
  return typeof location !== 'undefined' && location.protocol === 'file:';
}
const LS_KEY_PREFIX = 'wuzhen:proj:'; // 每项目一条 JSON 记录；不设独立索引键，键前缀扫描即索引（无失步风险）
const lsAvailable = typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && typeof localStorage.setItem === 'function';
export const STORAGE_MODE = (isFileOrigin() && lsAvailable) ? 'ls' : (hasIDB ? 'idb' : 'memory');

function lsIds() {
  const ids = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_KEY_PREFIX)) ids.push(k.slice(LS_KEY_PREFIX.length));
    }
  } catch {}
  return ids;
}
function lsReadRaw(id) {
  try { return localStorage.getItem(LS_KEY_PREFIX + id); } catch { return null; }
}
function lsWrite(id, rec) {
  // 配额满等写失败：安全忽略（不 crash、不阻塞主流程），当前会话内存里的活对象不受影响
  try { localStorage.setItem(LS_KEY_PREFIX + id, JSON.stringify(rec)); }
  catch (e) { console.warn('[wuzhen] 离线存储写入失败（不影响当前会话）', e); }
}
function lsParse(id) {
  // 读时消毒：解析/清洗失败 → null（视为不存在），绝不阻塞打开流程
  const raw = lsReadRaw(id);
  if (raw == null) return null;
  try {
    const p = M.validateProject(JSON.parse(raw)).project;
    p.id = id; // 键名即 id，防记录内 id 漂移
    return p;
  } catch { return null; }
}
// LS 档启动清洗：不可解析的条目直接移除；可解析的过 validateProject 回写净化结果（脏数据不致 boot 失败）
function lsCleanup() {
  for (const id of lsIds()) {
    let obj = null;
    try { obj = JSON.parse(lsReadRaw(id)); } catch { obj = null; }
    if (!obj || typeof obj !== 'object') { try { localStorage.removeItem(LS_KEY_PREFIX + id); } catch {} continue; }
    try {
      const cleaned = M.validateProject(obj).project;
      cleaned.id = id;
      if (JSON.stringify(cleaned) !== lsReadRaw(id)) lsWrite(id, cleaned);
    } catch {}
  }
}
if (STORAGE_MODE === 'ls') { try { lsCleanup(); } catch {} }
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
    // 先 clone 再盖时间戳：绝不原地改写活对象（其已被 commit 基线快照引用，
    // 原地改写会让下一次 commit 的重复判定失效）。落盘记录内容与原语义一致。
    const rec = clone(p);
    rec.meta.updatedAt = new Date().toISOString();
    if (STORAGE_MODE === 'ls') { lsWrite(rec.id, rec); return; }
    if (!hasIDB) { memory.projects.set(rec.id, rec); return; }
    await tx('projects', 'readwrite', s => s.put(rec));
  },
  async getProject(id) {
    if (STORAGE_MODE === 'ls') return lsParse(id);
    if (!hasIDB) return memory.projects.get(id) ? clone(memory.projects.get(id)) : null;
    return await tx('projects', 'readonly', s => s.get(id));
  },
  async listProjects() {
    if (STORAGE_MODE === 'ls') return lsIds().map(id => lsParse(id)).filter(Boolean)
      .sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
    if (!hasIDB) return [...memory.projects.values()].sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
    const all = await tx('projects', 'readonly', s => s.getAll());
    return (all || []).sort((a, b) => (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || ''));
  },
  async deleteProject(id) {
    if (STORAGE_MODE === 'ls') { try { localStorage.removeItem(LS_KEY_PREFIX + id); } catch {} return; }
    if (!hasIDB) {
      memory.projects.delete(id); memory.audio.delete(id);
      for (const k of [...memory.audio.keys()]) if (k.startsWith(id + ':')) memory.audio.delete(k);
      return;
    }
    await tx('projects', 'readwrite', s => s.delete(id));
    await tx('audio', 'readwrite', s => s.delete(id));
    // v3 媒体资产 blob（键 `${projectId}:${assetId}`）一并清扫
    await tx('audio', 'readwrite', s => {
      const req = s.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (typeof c.key === 'string' && c.key.startsWith(id + ':')) c.delete();
        c.continue();
      };
    });
  },
  async putAudio(id, blob) {
    // LS 离线档：音频 Blob 塞不进 localStorage 配额 → 安全忽略（不落盘、不 crash、不阻塞主流程）。
    // 当前会话内音乐照常播放（AudioController 自持 blob），仅跨重启不保留（已明确接受）。
    if (STORAGE_MODE === 'ls') return;
    if (!hasIDB) { memory.audio.set(id, blob); return; }
    await tx('audio', 'readwrite', s => s.put(blob, id));
  },
  async getAudio(id) {
    if (STORAGE_MODE === 'ls') return null;
    if (!hasIDB) return memory.audio.get(id) || null;
    return await tx('audio', 'readonly', s => s.get(id));
  },
  // ---- v3 媒体资产 blob（复用 audio store，键 `${projectId}:${assetId}`；LS 档不持久，同 putAudio） ----
  async putAsset(projectId, assetId, blob) {
    if (STORAGE_MODE === 'ls') return;
    if (!hasIDB) { memory.audio.set(`${projectId}:${assetId}`, blob); return; }
    await tx('audio', 'readwrite', s => s.put(blob, `${projectId}:${assetId}`));
  },
  async getAsset(projectId, assetId) {
    if (STORAGE_MODE === 'ls') return null;
    if (!hasIDB) return memory.audio.get(`${projectId}:${assetId}`) || null;
    return await tx('audio', 'readonly', s => s.get(`${projectId}:${assetId}`));
  },
};

// ---------- 状态 ----------
let state = {
  view: 'library',           // library | editor
  // FIX-R39-1（round39 P6 主题 E2E 实测发现）：对象字面量里 theme 键重复——末尾的
  // `theme: 'dark'` 覆盖了首行的 localStorage 读值，导致 fs.theme 持久化形同虚设
  //（刷新必回深色）。删去重复键，恢复「记忆上次主题」语义（TC-P6-12 检查点）。
  theme: (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' && localStorage.getItem('fs.theme')) || 'dark',
  project: null,
  projectId: null,
  formationIndex: 0,
  selection: [],             // dancer ids
  editMode: true,            // 编辑开关（默认开）：舞台可拖动编辑；关闭为查看模式
  multiSelect: false,        // 多选开关（触摸端多选入口）：开启后点按=追加选择
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
// E2E 确定性落盘辅助：savePending=有防抖写挂起；saveInFlight=最近一次在途写 Promise
//（防抖回调已触发但写未完成时，flushNow 也要等它——保证 await 后最新状态必然已持久）。
let savePending = false, saveInFlight = null;

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

// 拖拽过程专用（性能修复）：与 mutate(fn,null) 同效但不 emit——拖拽中每次指针移动若走
// emit，会触发全 App render 订阅链（DOM+时间轴两画布全量重绘）×2 次/事件，放大态画布
// 巨大时是移动端卡顿主因。拖拽视觉由 timeline 自绘承担，结束时 commit(label) 统一 emit 一次。
export function mutateQuiet(fn) {
  if (!state.project) return;
  fn(state.project);
  state.project.meta.updatedAt = new Date().toISOString();
  scheduleSave();
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
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    savePending = false;
    saveInFlight = state.project ? storage.putProject(state.project) : null;
  }, 400);
}
// E2E 确定性落盘出口（window.__fs.flushNow 的内部钩子，最小加法）：
// 清防抖定时器并立即写盘；幂等——无待写内容时不重复写盘（updatedAt 不被无谓刷新），
// 仅等待在途写完成；无项目时 no-op。供测试在断言持久化前调用，替代「盲等 400ms 防抖」。
export function flushNow() {
  if (!state.project) return Promise.resolve();          // 无项目 no-op
  if (!savePending) return saveInFlight || Promise.resolve(); // 无挂起写：等在途写（可能为 null=已落稳）
  savePending = false;
  clearTimeout(saveTimer); saveTimer = null;
  return (saveInFlight = storage.putProject(state.project));
}
// 页面隐藏/关闭前立即落盘，避免 debounce 丢最后一次编辑
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const flush = () => {
    if (document.visibilityState === 'hidden' && state.project) {
      clearTimeout(saveTimer);
      savePending = false; // 与 flushNow 同口径：已立即落盘，清挂起标记（行为零变化，仅记账）
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
  for (const a of p.media?.assets || []) { // v3：副本继承全部媒体资产 blob
    const ab = await storage.getAsset(oldId, a.id);
    if (ab) await storage.putAsset(p.id, a.id, ab);
  }
  await refreshLibrary();
}

// ---------- 名册辅助动作 ----------
import * as M from './model.js';
export { M };
