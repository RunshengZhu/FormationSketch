// F-10（UX-10）：EditStrip chip 触摸长按拖拽排序——node 可测层（纯几何决策）。
// 交互集成（真实 CDP 触摸、拿起态视觉、边缘自动滚动、pointercancel 回滚、鼠标 DnD 回归）
// 由 lab 探针 wuzhen-e2e-lab/probe-f10-touch-reorder.mjs 覆盖；本文件锁定决策数学与不变量。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUCH_DRAG, dragTargetIndex, shiftSlots, EditStrip } from '../js/timeline.js';

// ---------- 参数口径 ----------
test('F10-0 参数口径：长按 300ms、位移阈值 10px、边缘带 28px/步长 10px（与探针/文档对齐）', () => {
  assert.equal(TOUCH_DRAG.LP_MS, 300);
  assert.equal(TOUCH_DRAG.SLOP_PX, 10);
  assert.equal(TOUCH_DRAG.EDGE_PX, 28);
  assert.equal(TOUCH_DRAG.EDGE_STEP, 10);
});

// ---------- dragTargetIndex：dy → 目标插入位（跨半格换位、双向、钳制） ----------
test('F10-1 中点判定：位移过半格才换位（0.49 格不换，0.51 格换 1 位）', () => {
  assert.equal(dragTargetIndex(0, 100, 1, 4), 1);
  assert.equal(dragTargetIndex(49, 100, 1, 4), 1);
  assert.equal(dragTargetIndex(51, 100, 1, 4), 2);
  assert.equal(dragTargetIndex(-49, 100, 1, 4), 1);
  assert.equal(dragTargetIndex(-51, 100, 1, 4), 0);
});
test('F10-2 跨多格：round 累进（1.4 格→+1，1.6 格→+2）', () => {
  assert.equal(dragTargetIndex(140, 100, 0, 5), 1);
  assert.equal(dragTargetIndex(160, 100, 0, 5), 2);
  assert.equal(dragTargetIndex(-240, 100, 3, 5), 1);
});
test('F10-3 钳制：不越出 [0, count-1]', () => {
  assert.equal(dragTargetIndex(99999, 100, 0, 4), 3);
  assert.equal(dragTargetIndex(-99999, 100, 2, 4), 0);
  assert.equal(dragTargetIndex(0, 100, 3, 4), 3);
});
test('F10-4 退化输入：单 chip / 非法 slotH 原位返回（不产生 NaN 索引）', () => {
  assert.equal(dragTargetIndex(500, 100, 0, 1), 0);
  assert.equal(dragTargetIndex(500, 0, 1, 4), 1);
  assert.equal(dragTargetIndex(500, -5, 1, 4), 1);
  assert.equal(dragTargetIndex(NaN, 100, 1, 4), 1, 'NaN dy 经 clamp 回原位');
});

// ---------- shiftSlots：预览让位（from 自身恒 0；between 才让一格） ----------
test('F10-5 向后拖（from=1→to=3）：chip2/3 各上移一格，其余零位移', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(i => shiftSlots(1, 3, i)), [0, 0, -1, -1, 0]);
});
test('F10-6 向前拖（from=3→to=1）：chip1/2 各下移一格，其余零位移', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(i => shiftSlots(3, 1, i)), [0, 1, 1, 0, 0]);
});
test('F10-7 原位 / 相邻一格：仅直接交换对象让位', () => {
  assert.deepEqual([0, 1, 2].map(i => shiftSlots(1, 1, i)), [0, 0, 0]);
  assert.deepEqual([0, 1, 2].map(i => shiftSlots(1, 2, i)), [0, 0, -1]);
  assert.deepEqual([0, 1, 2].map(i => shiftSlots(1, 0, i)), [1, 0, 0]);
});
test('F10-8 不变量：让位位移之和 + 被拿起的自身位移 = 0（布局闭合，无漂移）', () => {
  for (let from = 0; from < 5; from++) {
    for (let to = 0; to < 5; to++) {
      const sum = [0, 1, 2, 3, 4].reduce((a, i) => a + shiftSlots(from, to, i), 0);
      assert.equal(sum + (to - from), 0, `from=${from} to=${to}`);
    }
  }
});

// ---------- EditStrip 类约定（node 可导入性 + 状态字段存在，交互走探针） ----------
test('F10-9 EditStrip 可在无 DOM 环境实例化字段约定：_td 空态、touchmove 拦截监听已挂容器', () => {
  // EditStrip 构造需要容器元素（addEventListener/observe）——用最小假容器验证接线约定
  const hs = {};
  const container = {
    addEventListener: (t, fn, o) => { hs[t] = { fn, o }; },
    clientWidth: 164,
  };
  if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = class { observe() {} };
  const strip = new EditStrip(container, {});
  assert.equal(strip._td, null, '空闲态 _td=null');
  assert.equal(strip._suppressClickUntil, 0, '点击抑制初始为 0');
  assert.equal(typeof hs.touchmove, 'object', 'touchmove 监听已挂容器');
  assert.equal(hs.touchmove.o.passive, false, 'touchmove 必须非 passive 才能 preventDefault 掐断滚动接管');
  // 拿起前不拦（返回 undefined，未 preventDefault）；拿起后才拦
  const ev = { preventDefault: () => { ev.pd = true; } };
  hs.touchmove.fn(ev);
  assert.notEqual(ev.pd, true, '空闲态 touchmove 不 preventDefault（列表原生滚动不受影响）');
  strip._td = { active: true };
  hs.touchmove.fn(ev);
  assert.equal(ev.pd, true, '拖拽中 touchmove preventDefault（阻断滚动接管）');
});

// ---------- 边缘自动滚动补偿（防回归：14b 曾因回写 scroll0 双计，chip 以 2× 滚速脱手） ----------
test('F10-10 横滚补偿：scroll0 冻结于拿起时刻——指尖静止压缘时被拿 chip translateY 增速 = scrollTop 增速（1.0±0.1），让位预览同步推进', () => {
  // 假世界：5 chips、slotH=100、容器可视 [0,800]；被拿 chip0 指尖压下缘静止
  const chips = [0, 1, 2, 3, 4].map(i => ({
    getBoundingClientRect: () => ({ top: i * 100, height: 90 }),
    classList: { add() {}, remove() {}, contains: () => false },
    style: {}, setPointerCapture() {}, releasePointerCapture() {},
  }));
  const el = {
    addEventListener() {}, clientWidth: 164, scrollTop: 0, append() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 800, left: 0, right: 200 }),
    querySelectorAll: sel => (sel === '.es-chip' ? chips : []),
  };
  if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = class { observe() {} };
  let rafCb = null;
  const g = globalThis, raf0 = g.requestAnimationFrame, caf0 = g.cancelAnimationFrame;
  g.requestAnimationFrame = cb => { rafCb = cb; return 1; };
  g.cancelAnimationFrame = () => {};
  try {
    const strip = new EditStrip(el, {});
    const td = strip._td = {
      id: 1, chip: chips[0], from: 0, to: 0,
      startX: 100, startY: 790, lastY: 790, // 指尖压下缘（>800-28）且此后不动
      active: false, chips: null, slots: null, slotH: 0, scroll0: 0, raf: 0, lpTimer: 0,
    };
    strip._lift(td); // 拿起：scroll0 = 0（拿起时刻 scrollTop，此后必须冻结）
    assert.equal(td.scroll0, 0, 'scroll0 = 拿起时刻 scrollTop');
    const tyOf = () => parseFloat(/translateY\((-?[\d.]+)px\)/.exec(td.chip.style.transform)?.[1] ?? '0');
    let prevTy = tyOf();
    for (let k = 1; k <= 20; k++) {
      rafCb(); // 每帧边缘步进 +10px（fake scroller 直接生效，real=10）
      const ty = tyOf();
      const ratio = (ty - prevTy) / (el.scrollTop - (k - 1) * 10);
      assert.ok(Math.abs(ratio - 1) <= 0.1, `第${k}帧 translateY 增速/scrollTop 增速=${ratio}，须 1.0±0.1`);
      // 世界坐标不变量：chip 屏幕位 = 布局位 - scrollTop + ty，指尖静止时应恒定（不脱手）
      assert.ok(Math.abs((td.slots[0].top - el.scrollTop + ty) - td.slots[0].top) <= 0.1,
        `第${k}帧 chip 屏幕位置漂移（应钉在指尖）`);
      prevTy = ty;
    }
    assert.equal(td.scroll0, 0, '滚动 20 帧后 scroll0 仍未被回写（冻结）');
    assert.equal(td.to, 2, 'dy=200 → 换位判定推进到 2（以 1× 滚速推进，双计时会到 4）');
    const shifted = chips.map(c => /translateY\((-?[\d.]+)px\)/.exec(c.style.transform || '')?.[1] ?? null);
    assert.equal(shifted[0], '200', '被拿 chip ty=+200（10px/帧 × 20 帧，恰 1× 滚速）');
    assert.deepEqual(shifted.slice(1), ['-100', '-100', null, null], '让位预览：chip1/2 各上移一格，chip3/4 零位移（shiftSlots(0,2) 口径）');
  } finally {
    g.requestAnimationFrame = raf0; g.cancelAnimationFrame = caf0;
  }
});
