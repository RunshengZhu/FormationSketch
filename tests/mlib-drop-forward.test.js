// W4 GOLD-DEFECT-1 残留修复（方案 b：媒体库弹窗遮罩按落点转发资产 drop）node 单测。
// 缺陷（reviewer CDP 真实拖拽实证）：资产行 dragstart 写 text/x-wuzhen-asset 正常，但
// .modal-back（fixed inset:0 z-index:100）盖满视口——弹窗打开时时间轴真正消费端 #tl-scroll
// 的 drop 永远不可达，遮罩 drop 处理器读出 assetId 后显式丢弃（原 `void assetId`）。
// 修复：落点（clientX/Y）位于 #tl-scroll 矩形内 → window CustomEvent('wuzhen:tl-asset-drop')
// 转发给 main.js 既有 sec/lane→createClipFromDrop 消费链（换算不重复造），弹窗保持打开。
// 本文件口径（与 lib-menu-esc.test.js 同）：node 只锁机械性质——判定纯函数 + 真实
// showMediaLibraryModal 监听路径的派发/不派发；浏览器全管线（真实拖拽→换算→建 clip→
// 连拖多资产）由 lab CDP 探针覆盖（main.js 接收端重 musicTl/DOM，node 不复刻）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TL_RECT = { left: 100, top: 500, right: 1000, bottom: 700, width: 900, height: 200 };

function makeDomStub(tlRect = TL_RECT) {
  const el = (tag, id = '') => ({
    tagName: String(tag).toUpperCase(), id, nodeType: 1, className: '', style: {},
    children: [], removed: false, hidden: false, innerHTML: '',
    _ls: [],
    _rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    addEventListener(type, fn) { this._ls.push({ type, fn }); },
    removeEventListener(type, fn) { this._ls = this._ls.filter(l => !(l.type === type && l.fn === fn)); },
    setAttribute() {}, append(...cs) { for (const c of cs.flat()) if (c) this.children.push(c); },
    contains() { return false; }, remove() { this.removed = true; },
    getBoundingClientRect() { return { ...this._rect }; },
  });
  const root = el('div', 'modal-root');
  const tl = el('div', 'tl-scroll');
  if (tlRect) tl._rect = { ...tlRect };
  const doc = el('#document');
  doc.createElement = tag => el(tag);
  doc.createTextNode = text => ({ nodeType: 3, textContent: text });
  doc.getElementById = id => (id === 'modal-root' ? root : id === 'tl-scroll' ? tl : null);
  doc.body = el('body');
  const dispatched = [];
  const win = {
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {}, // store.js 顶层 pagehide 等空转
    dispatchEvent(ev) { dispatched.push(ev); return true; },
  };
  return { doc, win, root, tl, dispatched };
}

const proj = () => ({
  media: {
    assets: [
      { id: 'a1', name: 'A.wav', durationSec: 12.5, size: 1024 },
      { id: 'b2', name: 'B.wav', durationSec: 5, size: 700 },
    ],
    activeAssetId: 'a1',
  },
});
const mkActs = calls => ({
  importFiles: files => calls.push(['import', files]),
  setActive: id => calls.push(['setActive', id]),
  rename() {}, remove() {}, hasBlob: () => true, pickFiles() {},
});
const assetDt = id => ({ types: ['text/x-wuzhen-asset'], getData: t => (t === 'text/x-wuzhen-asset' ? id : ''), files: [] });
const filesDt = files => ({ types: ['Files'], getData: () => '', files });
const fire = (back, ev) => back._ls.filter(l => l.type === 'drop').forEach(l => l.fn(ev));
const mkDrop = (x, y, dt) => ({ preventDefault() {}, clientX: x, clientY: y, dataTransfer: dt });

// ---------- 1) 判定纯函数 isAssetDropOverTimeline ----------
test('GOLD-DEFECT-1b S1 落点判定：矩形内 true；四边外/缺 rect/零尺寸 rect（display:none）均 false', async () => {
  const { isAssetDropOverTimeline } = await import('../js/ui.js');
  assert.equal(isAssetDropOverTimeline(150, 600, TL_RECT), true, '矩形内');
  assert.equal(isAssetDropOverTimeline(100, 500, TL_RECT), true, '左上角点含边界');
  assert.equal(isAssetDropOverTimeline(99, 600, TL_RECT), false, '左边外');
  assert.equal(isAssetDropOverTimeline(1001, 600, TL_RECT), false, '右边外');
  assert.equal(isAssetDropOverTimeline(500, 499, TL_RECT), false, '上边外');
  assert.equal(isAssetDropOverTimeline(500, 701, TL_RECT), false, '下边外');
  assert.equal(isAssetDropOverTimeline(150, 600, null), false, 'rect 缺失（元素不存在）');
  assert.equal(isAssetDropOverTimeline(150, 600, { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }), false, '零尺寸 rect（display:none，如移动端队形页签隐藏时间轴）');
});

// ---------- 2) 真实 showMediaLibraryModal 遮罩 drop 监听路径 ----------
function openLibrary(stub) {
  return import('../js/ui.js').then(ui => {
    const calls = [];
    ui.showMediaLibraryModal({ getProject: proj, acts: mkActs(calls), toast: () => {} });
    const back = stub.root.children[0];
    assert.equal(back._ls.filter(l => l.type === 'drop').length, 1, '遮罩恰挂 1 个 drop 监听');
    return { ui, calls, back };
  });
}

test('GOLD-DEFECT-1b S2 资产 drop 落点在 #tl-scroll 内：恰派发 1 次 wuzhen:tl-asset-drop（含 assetId+落点），不触发文件导入', async () => {
  const stub = makeDomStub();
  globalThis.document = stub.doc; globalThis.window = stub.win;
  const { calls, back } = await openLibrary(stub);
  fire(back, mkDrop(150, 600, assetDt('a1')));
  assert.equal(stub.dispatched.length, 1, '恰派发 1 次');
  assert.equal(stub.dispatched[0].type, 'wuzhen:tl-asset-drop');
  assert.deepEqual(stub.dispatched[0].detail, { assetId: 'a1', clientX: 150, clientY: 600 }, 'detail 携带 assetId 与原始落点（sec/lane 换算留给 main.js 消费端）');
  assert.equal(calls.length, 0, '不误触发文件导入');
  assert.equal(stub.root.hidden, false, '弹窗保持打开（连拖多资产工作流前提）');
});

test('GOLD-DEFECT-1b S3 资产 drop 落点在矩形外（弹窗盒子内等）：维持既有语义——不派发、不导入、不生成 clip', async () => {
  const stub = makeDomStub();
  globalThis.document = stub.doc; globalThis.window = stub.win;
  const { calls, back } = await openLibrary(stub);
  fire(back, mkDrop(50, 100, assetDt('a1')));
  fire(back, mkDrop(1001, 701, assetDt('a1'))); // 恰在矩形外角
  assert.equal(stub.dispatched.length, 0, '不派发');
  assert.equal(calls.length, 0, '不导入');
});

test('GOLD-DEFECT-1b S4 文件 drop（含落点在矩形内）：仍走导入路径，不派发转发——音频文件拖入弹窗=导入不回归', async () => {
  const stub = makeDomStub();
  globalThis.document = stub.doc; globalThis.window = stub.win;
  const { calls, back } = await openLibrary(stub);
  const f = { type: 'audio/wav', name: 'x.wav' };
  fire(back, mkDrop(150, 600, filesDt([f])));
  assert.equal(stub.dispatched.length, 0, 'Files 无资产 payload，不派发');
  assert.equal(calls.length, 1 && calls[0][0] === 'import' ? 1 : 0, '走 importFiles');
  assert.equal(calls[0][1][0].name, 'x.wav');
});

test('GOLD-DEFECT-1b S5 连拖两资产（同弹窗会话内两次 drop）：两次派发各带落点——多轨连拖机械面', async () => {
  const stub = makeDomStub();
  globalThis.document = stub.doc; globalThis.window = stub.win;
  const { calls, back } = await openLibrary(stub);
  fire(back, mkDrop(150, 550, assetDt('a1')));
  fire(back, mkDrop(700, 650, assetDt('b2')));
  assert.equal(stub.dispatched.length, 2, '两次 drop 各派发一次');
  assert.deepEqual(stub.dispatched.map(ev => ev.detail), [
    { assetId: 'a1', clientX: 150, clientY: 550 },
    { assetId: 'b2', clientX: 700, clientY: 650 },
  ]);
  assert.equal(stub.root.hidden, false, '两次拖放间弹窗始终未关');
  assert.equal(calls.length, 0);
});

test('GOLD-DEFECT-1b S6 #tl-scroll 不存在（getElementById null）：不派发不抛——防御性兜底', async () => {
  const stub = makeDomStub(null);
  stub.doc.getElementById = id => (id === 'modal-root' ? stub.root : null); // tl-scroll 缺席
  globalThis.document = stub.doc; globalThis.window = stub.win;
  const { calls, back } = await openLibrary(stub);
  assert.doesNotThrow(() => fire(back, mkDrop(150, 600, assetDt('a1'))));
  assert.equal(stub.dispatched.length, 0);
  assert.equal(calls.length, 0);
});
