// 就绪信号单测（E2E 确定性信号轮）：store.flushNow 幂等/无项目 no-op + renderSeq 计数语义
// （状态驱动重绘 +1；动画帧直调 draw() 不计——与 __fs.renderSeq 口径一致）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../js/store.js';
import * as M from '../js/model.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('flushNow：无项目时 no-op（resolved，不抛）', async () => {
  // 独立性：本用例最前执行前可能有其他用例建过项目，这里只验证空态路径本身的确定性
  const p = store.getState().project;
  store.setUI({ project: null, projectId: null }); // setUI 只 patch，不会触发 putProject
  await assert.doesNotReject(() => store.flushNow());
  if (p) store.setUI({ project: p, projectId: p.id });
});

test('flushNow：清防抖立即落盘（不必等 400ms）+ 幂等（无新变更不重复写，updatedAt 不动）', async () => {
  store.createNewProject({ title: 'flush-now', pairs: 2 });
  const id = store.getState().project.id;
  store.mutate(pl => { pl.formations[0].name = 'F1-改'; }, null); // mutate(null) → scheduleSave（400ms 防抖挂起）
  await store.flushNow();                                          // 确定性落盘（不 sleep 等防抖）
  const first = await store.storage.getProject(id);
  assert.equal(first.formations[0].name, 'F1-改', 'flushNow 后存储应已是最新内容');

  await sleep(30); // 给可能的重复写留窗口：若 flushNow 不幂等，updatedAt 会被第二次写刷新
  const again = await store.storage.getProject(id);
  assert.equal(again.meta.updatedAt, first.meta.updatedAt, '无新变更时 flushNow 不得重复写盘');

  // 再来一轮变更：flushNow 连续两次都收敛到同一内容（幂等可重复调用）
  store.mutate(pl => { pl.formations[0].name = 'F1-改2'; }, null);
  await store.flushNow(); await store.flushNow();
  const third = await store.storage.getProject(id);
  assert.equal(third.formations[0].name, 'F1-改2');
});

test('flushNow：等待在途防抖写（防抖已触发但 putProject 未完成时，await 后仍必落稳）', async () => {
  store.createNewProject({ title: 'flush-inflight', pairs: 2 });
  const id = store.getState().project.id;
  store.mutate(pl => { pl.meta.title = 'flush-inflight-2'; }, null);
  await store.flushNow();
  // 触发防抖后立即再变更并 flush：savePending 路径直接写最新态
  store.mutate(pl => { pl.meta.title = 'flush-inflight-3'; }, null);
  await store.flushNow();
  const rec = await store.storage.getProject(id);
  assert.equal(rec.meta.title, 'flush-inflight-3');
});

// ---------- renderSeq 计数语义（StageView 存根实例化；Node 无 DOM/无 canvas） ----------
test('renderSeq：requestDraw 状态驱动重绘 +1；动画帧直调 draw() 不计', async () => {
  // 先铺最小浏览器全局（stage.js 模块级与构造期会读 window/ResizeObserver）
  const g = globalThis;
  const savedWindow = g.window, savedRO = g.ResizeObserver;
  const __fs = { renderSeq: 0 };
  g.window = { __fs, devicePixelRatio: 1 };
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  try {
    const { StageView } = await import('../js/stage.js');
    // ctx 存根：吸收一切 2d 调用与属性赋值
    const noop = () => {};
    const ctx = new Proxy({}, { get: () => noop, set: () => true });
    const canvas = {
      width: 0, height: 0,
      getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
      addEventListener: noop, setPointerCapture: noop,
      parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      getContext: () => ctx,
    };
    const p = M.createProject({ title: 'render-seq', pairs: 2, grouping: 'none' });
    M.createFormationFrom(p, 0); // 动效需要第二帧作为目标
    const getScene = () => ({
      project: p, formation: p.formations[0], formationIndex: 0,
      positions: p.formations[0].positions, selection: new Set(),
      showGhost: false, showPaths: false, readOnly: true,
    });
    let animEnd = 0;
    const sv = new StageView(canvas, ctx, getScene, {
      select: noop, mutateLive: noop, commit: noop,
      onSwitchAnimEnd: () => { animEnd++; },
    });

    assert.equal(__fs.renderSeq, 0, '初始为 0');
    sv.requestDraw();                       // 状态驱动重绘（render()/ResizeObserver/缩放等公共出口）
    assert.equal(__fs.renderSeq, 1, 'requestDraw 出口恰好 +1');
    sv.draw();                              // 动画帧路径：直调 draw()（_animTick 每 16ms 即此路径）
    assert.equal(__fs.renderSeq, 1, '动画帧直调 draw() 不计');
    sv.requestDraw(); sv.requestDraw();
    assert.equal(__fs.renderSeq, 3, '每次状态驱动重绘各 +1');

    // 切帧动效全程（200ms 下限）：逐帧 draw() 不计数，结束仅 onSwitchAnimEnd 回调
    await new Promise(res => {
      sv.startPositionsPreview(p.formations[0], p.formations[1], 200);
      const orig = sv.hooks.onSwitchAnimEnd;
      sv.hooks.onSwitchAnimEnd = () => { orig(); res(); };
    });
    assert.equal(animEnd, 1, '动效正常收尾');
    assert.equal(__fs.renderSeq, 3, '动效逐帧与收尾帧均不计（口径：只计状态驱动重绘）');
  } finally {
    g.window = savedWindow; g.ResizeObserver = savedRO;
  }
});
