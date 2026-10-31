// 媒体库侧边栏（build-42-sidebar）node 单测：纯逻辑机械面。
// 范围（浏览器全管线——侧栏真实拖拽/点击添加/开合记忆/移动抽屉——由 lab CDP 探针覆盖，
// main.js 接收端重 musicTl/DOM/WebAudio，node 不复刻）：
//   S1 audio-clips.trackEndSec：第一轨末尾落点计算（「＋ 添加」点击快速放置的 sec 依据）；
//   S2 ui.resolveMediaSidebarOpen：开合偏好解析（缺省开；'0'=收起；storage 异常恒开）；
//   S3 ui.renderMediaLibraryContent：侧边栏/弹窗兜底共用的渲染器——资产行构成、行内
//      「＋ 添加」仅在 addToTimeline 提供时呈示、各操作钮回调接线、dragstart 生产者挂载。
// 弹窗兜底实现（showMediaLibraryModal）的遮罩转发机械面由 tests/mlib-drop-forward.test.js 钉死，不重复。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- DOM 桩（口径同 mlib-drop-forward.test.js，加 textContent/firstElementChild） ----------
function makeDomStub() {
  const el = (tag, id = '') => ({
    tagName: String(tag).toUpperCase(), id, nodeType: 1, className: '', style: { cssText: '' },
    children: [], _ls: [], innerHTML: '', hidden: false,
    get firstElementChild() { return this.children.find(c => c.nodeType === 1) || null; },
    get textContent() {
      return this.children.map(c => (c.nodeType === 3 ? c.textContent : c.textContent)).join('');
    },
    addEventListener(type, fn) { this._ls.push({ type, fn }); },
    removeEventListener() {},
    setAttribute(k, v) { this[k] = v; }, // 属性直写（title/draggable 等供断言读取）
    append(...cs) { for (const c of cs.flat(9)) if (c) this.children.push(c); },
    contains() { return false; },
    remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  });
  const doc = {
    createElement: tag => el(tag),
    createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, // store.js 顶层 visibilitychange/pagehide 挂点空转
    body: el('body'),
  };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true };
  return { doc, win, el };
}

// 全局桩先置（ui.js 经 store.js 顶层判存；本文件不 import main.js——其 boot 有 document 判存会真跑）
const stub = makeDomStub();
globalThis.document = stub.doc;
globalThis.window = stub.win;

const ui = await import('../js/ui.js');
const { trackEndSec } = await import('../js/audio-clips.js');

// ---------- 工具：深度查找 ----------
function allEls(node, out = []) {
  for (const c of node.children || []) { out.push(c); allEls(c, out); }
  return out;
}
const btnByText = (root, text) => allEls(root).find(e => e.tagName === 'BUTTON' && e.textContent.includes(text));
const fire = (target, type) => target._ls.filter(l => l.type === type).forEach(l => l.fn({ dataTransfer: null, target }));

const proj = (extra = {}) => ({
  media: {
    assets: [
      { id: 'a1', name: 'A.wav', durationSec: 12.5, size: 1024 },
      { id: 'b2', name: 'B.wav', durationSec: 5, size: 700 },
    ],
    activeAssetId: 'a1',
  },
  ...extra,
});
const mkActs = (calls, opts = {}) => ({
  importFiles: files => calls.push(['import', files]),
  setActive: id => calls.push(['setActive', id]),
  rename: id => calls.push(['rename', id]),
  remove: id => calls.push(['remove', id]),
  hasBlob: () => true,
  pickFiles: () => calls.push(['pickFiles']),
  ...(opts.addToTimeline ? { addToTimeline: id => calls.push(['add', id]) } : {}),
});

// ---------- S1 trackEndSec：第一轨末尾落点 ----------
test('侧栏 S1 trackEndSec：空轨=0；同轨取最后 clip 终点；他轨不参与；无 trackId 缺省归第一轨', () => {
  assert.equal(trackEndSec([], 'trk1'), 0, '空轨=0（第一轨无 clip）');
  assert.equal(trackEndSec(null, 'trk1'), 0, 'clips 缺失=0');
  const clips = [
    { id: 'c1', trackId: 'trk1', timelineStartSec: 0, lengthSec: 10 },
    { id: 'c2', trackId: 'trk1', timelineStartSec: 8, lengthSec: 6 },   // 终点 14（最后）
    { id: 'c3', trackId: 'trk2', timelineStartSec: 30, lengthSec: 20 }, // 他轨不参与
    { id: 'c4', timelineStartSec: 2, lengthSec: 3 },                    // 无 trackId=trk1（终点 5）
  ];
  assert.equal(trackEndSec(clips, 'trk1'), 14, '第一轨末尾=14（c2 终点，非全长 clip 终点 30）');
  assert.equal(trackEndSec(clips, 'trk2'), 50, '第二轨末尾=50');
  assert.equal(trackEndSec([{ id: 'x', timelineStartSec: 1, lengthSec: 2 }], 'trk2'), 0, '无 trackId 的 clip 不算到他轨');
});

// ---------- S2 resolveMediaSidebarOpen：开合偏好 ----------
test('侧栏 S2 开合偏好：缺省开；显式 "0"=收起；"1"/未写=开；storage 抛异常恒开', async () => {
  assert.equal(ui.resolveMediaSidebarOpen(null), true, 'ls 缺失=开');
  assert.equal(ui.resolveMediaSidebarOpen({ getItem: () => null }), true, '未写键=开（默认开）');
  assert.equal(ui.resolveMediaSidebarOpen({ getItem: () => '1' }), true);
  assert.equal(ui.resolveMediaSidebarOpen({ getItem: () => '0' }), false, '显式收起记忆');
  assert.equal(ui.resolveMediaSidebarOpen({ getItem: () => { throw new Error('隐私模式'); } }), true, 'storage 异常恒开');
});

// ---------- S3 renderMediaLibraryContent：共享渲染器 ----------
// build-46-layout F4 单行化改写注：资产行改单行布局 [名(ellipsis) 时长·大小] [配乐chip] [… ]，
// 行内「＋ 添加/用作配乐/重命名/删除」按钮组收进行尾「…」的 showContextMenu 菜单（复用既有
// handler）。原「行内按钮直接断言」相应改为「点开菜单断言菜单项与回调接线」；拖拽生产者、
// 空态/导入按钮、数据缺失标记、兜底弹窗契约不受影响。

// 打开资产行「…」菜单并返回菜单元素（showContextMenu fixed 定位挂 document.body）
function openRowMenu(row) {
  const more = allEls(row).find(e => e.tagName === 'BUTTON' && e.textContent === '…');
  assert.ok(more, '行尾「…」菜单钮存在');
  fire(more, 'click');
  const menu = stub.doc.body.children.find(e => String(e.id) === 'clip-ctx-menu');
  assert.ok(menu, '点「…」后 showContextMenu 菜单挂 body（id=clip-ctx-menu）');
  return menu;
}

test('侧栏 S3a 行构成（F4 单行化）：每行 名称+时长+「…」+dragstart 生产者；行内操作钮收进菜单', async () => {
  const calls = [];
  const wrap = stub.doc.createElement('div');
  ui.renderMediaLibraryContent(wrap, { getProject: () => proj(), acts: mkActs(calls, { addToTimeline: true }) });
  const rows = allEls(wrap).filter(e => String(e.className).includes('mlib-row'));
  assert.equal(rows.length, 2, '两行资产');
  assert.ok(rows[0].textContent.includes('A.wav') && rows[0].textContent.includes('12.5s'), '行含名称与时长');
  assert.equal(rows[0]._ls.filter(l => l.type === 'dragstart').length, 1, '每行恰挂 1 个 dragstart 生产者');
  // 单行化：行内不再有「＋ 添加/用作配乐/重命名/删除」直排按钮——全部收进「…」菜单
  assert.ok(!btnByText(rows[0], '＋ 添加') && !btnByText(rows[1], '用作配乐'), '行内无直排操作钮');
  assert.ok(rows[0].textContent.includes('配乐'), '激活行呈配乐 chip');
  // 菜单内容：添加到第一轨（addToTimeline 提供时）/ 用作配乐（非激活行）/ 重命名 / 删除
  const menu0 = openRowMenu(rows[0]);
  assert.ok(btnByText(menu0, '添加到第一轨末尾'), '激活行菜单含「添加到第一轨末尾」（addToTimeline 提供时）');
  assert.ok(!btnByText(menu0, '用作配乐'), '激活行菜单无「用作配乐」（已是配乐）');
  assert.ok(btnByText(menu0, '重命名') && btnByText(menu0, '删除'), '菜单含重命名/删除');
  stub.doc.body.children.length = 0; // 清理挂 body 的菜单（跨用例隔离）
  const menu1 = openRowMenu(rows[1]);
  assert.ok(btnByText(menu1, '用作配乐'), '非激活行菜单含「用作配乐」');
  stub.doc.body.children.length = 0;
  // 兜底弹窗形态（不传 addToTimeline）：菜单无「添加到第一轨末尾」，行数不变
  const wrap2 = stub.doc.createElement('div');
  ui.renderMediaLibraryContent(wrap2, { getProject: () => proj(), acts: mkActs([]) });
  assert.equal(allEls(wrap2).filter(e => String(e.className).includes('mlib-row')).length, 2, '兜底形态行数不变');
  const rows2 = allEls(wrap2).filter(e => String(e.className).includes('mlib-row'));
  const menu2 = openRowMenu(rows2[0]);
  assert.ok(!btnByText(menu2, '添加到第一轨末尾'), '兜底形态菜单无「添加到第一轨末尾」');
  stub.doc.body.children.length = 0;
});

test('侧栏 S3b 点击接线：「…」菜单项→addToTimeline/setActive/rename/remove 各走 acts；导入按钮保留', async () => {
  const calls = [];
  const wrap = stub.doc.createElement('div');
  ui.renderMediaLibraryContent(wrap, { getProject: () => proj(), acts: mkActs(calls, { addToTimeline: true }), rerender: () => calls.push(['rerender']) });
  const rows = allEls(wrap).filter(e => String(e.className).includes('mlib-row'));
  fire(btnByText(openRowMenu(rows[0]), '添加到第一轨末尾'), 'click');
  stub.doc.body.children.length = 0;
  fire(btnByText(openRowMenu(rows[1]), '添加到第一轨末尾'), 'click');
  assert.deepEqual(calls.filter(c => c[0] === 'add'), [['add', 'a1'], ['add', 'b2']], '菜单「添加到第一轨末尾」带资产 id 调 addToTimeline');
  calls.length = 0;
  stub.doc.body.children.length = 0;
  fire(btnByText(openRowMenu(rows[1]), '用作配乐'), 'click');
  assert.deepEqual(calls.filter(c => c[0] === 'setActive'), [['setActive', 'b2']], '菜单「用作配乐」走 acts.setActive');
  assert.deepEqual(calls.filter(c => c[0] === 'rerender'), [['rerender']], '弹窗形态即时 rerender 钩子同步');
  stub.doc.body.children.length = 0;
  fire(btnByText(openRowMenu(rows[1]), '重命名'), 'click');
  stub.doc.body.children.length = 0;
  fire(btnByText(openRowMenu(rows[1]), '删除'), 'click');
  fire(btnByText(wrap, '导入音频'), 'click');
  assert.deepEqual(calls.filter(c => c[0] === 'rename' || c[0] === 'remove' || c[0] === 'pickFiles'),
    [['rename', 'b2'], ['remove', 'b2'], ['pickFiles']], '重命名/删除/导入各走 acts');
});

test('侧栏 S3c 空态与数据缺失标记：无资产呈导入指引；hasBlob=false 行呈「数据缺失」', async () => {
  const wrap = stub.doc.createElement('div');
  ui.renderMediaLibraryContent(wrap, { getProject: () => ({ media: { assets: [], activeAssetId: null } }), acts: mkActs([], { addToTimeline: true }) });
  assert.ok(wrap.textContent.includes('还没有音频') && wrap.textContent.includes('导入音频'), '空态指引');
  const wrap2 = stub.doc.createElement('div');
  ui.renderMediaLibraryContent(wrap2, { getProject: () => proj(), acts: { ...mkActs([]), hasBlob: () => false } });
  assert.ok(wrap2.textContent.includes('数据缺失'), '缺失标记呈示');
});

test('侧栏 S3d 兜底保留契约：showMediaLibraryModal 与 isAssetDropOverTimeline 仍导出（防御性兜底）', async () => {
  assert.equal(typeof ui.showMediaLibraryModal, 'function', '弹窗兜底实现保留（生产不调用）');
  assert.equal(typeof ui.isAssetDropOverTimeline, 'function');
  assert.equal(ui.isAssetDropOverTimeline(1, 1, null), false);
});
