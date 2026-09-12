// DEFECT-R21-1：库卡片右键菜单 #lib-card-menu 的 Esc 关闭 + keydown 监听生命周期（node 单测）。
// ui.js 模块顶层无 DOM 依赖（既有 ux-conflict-fixes.test.js 已证可 import）→ 先装极简
// document/window 桩再动态 import，即可在 node 里驱动 showLibCardMenu/closeLibCardMenu 的
// 真实监听注册/解绑代码路径（非复制逻辑）。浏览器侧行为（真实按键、菜单四项、复制/删除）
// 由 lab/r21-review.mjs 段 D E2E 覆盖，此处只锁监听生命周期机械性质。
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeDomStub() {
  const docListeners = []; // { type, fn, capture } —— document 级监听登记表
  const el = tag => ({
    tagName: String(tag).toUpperCase(), nodeType: 1, className: '', style: {}, children: [], removed: false,
    _ls: [],
    addEventListener(type, fn, capture) { this._ls.push({ type, fn, capture: !!capture }); },
    removeEventListener(type, fn, capture) { this._ls = this._ls.filter(l => !(l.type === type && l.fn === fn && !!l.capture === !!capture)); },
    setAttribute() {}, append(...cs) { for (const c of cs.flat()) if (c) this.children.push(c); },
    contains() { return false; }, // 桩：任何 pointerdown target 均判「菜单外」
    remove() { this.removed = true; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 140, bottom: 180, width: 140, height: 180 }; },
  });
  const doc = el('#document');
  doc.createElement = tag => el(tag);
  doc.createTextNode = text => ({ nodeType: 3, textContent: text });
  doc.body = el('body');
  doc.getElementById = () => null;
  doc.addEventListener = (type, fn, capture) => { docListeners.push({ type, fn, capture: !!capture }); };
  doc.removeEventListener = (type, fn, capture) => {
    const i = docListeners.findIndex(l => l.type === type && l.fn === fn && !!l.capture === !!capture);
    if (i >= 0) docListeners.splice(i, 1);
  };
  doc._docListeners = docListeners;
  return doc;
}

const proj = () => ({ meta: { title: 'R21甲' } });
const ACTS = { onOpen() {}, onDuplicate() {}, onDelete() {} };

test('DEFECT-R21-1 lib card menu: Esc closes once, keydown lifecycle leak-free', async () => {
  const doc = makeDomStub();
  globalThis.document = doc;
  globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} }; // 后两者供 store.js 顶层 pagehide 注册空转
  const { showLibCardMenu, closeLibCardMenu } = await import('../js/ui.js');
  const count = t => doc._docListeners.filter(l => l.type === t).length;

  // 1) 打开：keydown(捕获) 与 pointerdown(捕获) 各恰 1 条
  showLibCardMenu(10, 10, proj(), ACTS);
  assert.equal(count('keydown'), 1, '打开后 keydown 监听恰 1 条');
  assert.equal(count('pointerdown'), 1, '打开后 pointerdown 监听恰 1 条');
  assert.equal(doc._docListeners.find(l => l.type === 'keydown').capture, true, 'keydown 走捕获相位（与 pointerdown dismiss 一致）');

  // 2) Esc：菜单移出 DOM + 两类监听全部解绑（一次性）
  const menu = doc.body.children.at(-1);
  doc._docListeners.find(l => l.type === 'keydown').fn({ key: 'Escape' });
  assert.ok(menu.removed, 'Esc 后菜单已从 DOM 移除');
  assert.equal(count('keydown'), 0, 'Esc 后 keydown 监听已解绑');
  assert.equal(count('pointerdown'), 0, 'Esc 后 pointerdown 监听已解绑');

  // 3) 非 Escape 键：菜单不关、监听不动（不误伤输入）
  showLibCardMenu(10, 10, proj(), ACTS);
  doc._docListeners.find(l => l.type === 'keydown').fn({ key: 'a' });
  assert.equal(count('keydown'), 1, '非 Esc 键不触发关闭');
  assert.equal(count('pointerdown'), 1);

  // 4) 点外部（pointerdown capture 路径）关闭：keydown 同步解绑
  doc._docListeners.find(l => l.type === 'pointerdown').fn({ target: {} });
  assert.equal(count('keydown'), 0, '点外部关闭后 keydown 监听已解绑');
  assert.equal(count('pointerdown'), 0);

  // 5) 菜单未关时再次右键（重开覆盖）：旧监听先解绑，仍恰 1 条（不重复绑定）
  showLibCardMenu(5, 5, proj(), ACTS);
  showLibCardMenu(6, 6, proj(), ACTS);
  assert.equal(count('keydown'), 1, '连开两次 keydown 监听仍恰 1 条');
  assert.equal(count('pointerdown'), 1);
  closeLibCardMenu();
  assert.equal(count('keydown'), 0);

  // 6) 10 轮开合混合关闭路径（Esc / 点外部交替）：监听数恒 ≤1、终态归零 → 无泄漏
  for (let i = 0; i < 10; i++) {
    showLibCardMenu(4 + i, 8, proj(), ACTS);
    assert.equal(count('keydown'), 1, `第 ${i + 1} 轮打开后 keydown 恰 1 条`);
    if (i % 2 === 0) doc._docListeners.find(l => l.type === 'keydown').fn({ key: 'Escape' });
    else doc._docListeners.find(l => l.type === 'pointerdown').fn({ target: {} });
  }
  assert.equal(count('keydown'), 0, '多轮开合后 keydown 监听归零');
  assert.equal(count('pointerdown'), 0, '多轮开合后 pointerdown 监听归零');

  // 7) closeLibCardMenu 空场幂等（重复调用不抛、不误删他人监听）
  doc.addEventListener('keydown', () => {}, true);
  closeLibCardMenu(); closeLibCardMenu();
  assert.equal(count('keydown'), 1, '空场 close 不误删无关监听');
  doc.removeEventListener('keydown', doc._docListeners[0].fn, true);
});
