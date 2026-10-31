// round20 UX 冲突修复（F-01/F-02/F-04/F-08 机器层）node 单测。
// 对应调研报告 tests/ux-browser-conflicts.md §2 方案总表与 §8a 的 IR 口径：
//   F-01 cancel 清 pointers/pinch（UX-01 脏指针 → 二次触摸误判 PINCH）
//   F-02 MusicTimeline pointercancel → drag=null（UX-02 drag 卡死 + hover 误改数据损坏链）
//   F-04 history 哨兵决策机（UX-04 后退=应用内回库；往返不堆积）
//   F-08/右键可 node 测部分：cancel 后手势机回 IDLE、contextMenu 仍可弹（策略层由浏览器探针覆盖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureMachine } from '../js/gesture.js';
import { MusicTimeline } from '../js/timeline.js';
import { createHistorySentinel } from '../js/ui.js';

// ---------- F-01：手势机假世界（精简自 gesture.test.js makeWorld） ----------
function makeWorld() {
  const w = {
    t: 0, timers: [],
    positions: {
      A: { x: 1, y: 1, facing: 0 }, B: { x: 1.4, y: 1, facing: 0 },
      E: { x: 8, y: 2, facing: 0 },
    },
    merges: [{ a: 'A', b: 'B', style: 'capsule' }],
    selection: [],
    log: { applied: [], rolledBack: [], commits: [], menus: [], hidden: 0, boxes: [], pans: [], zooms: [] },
  };
  const host = {
    readOnly: () => false,
    hitHandle: () => false,
    hitDancer: (x, y) => {
      let best = null, bd = 0.3;
      for (const [id, p] of Object.entries(w.positions)) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    },
    toStage: (px, py) => ({ x: px / 100, y: py / 100 }),
    selection: () => [...w.selection],
    multiSelect: () => false,
    formation: () => ({ positions: w.positions, merges: w.merges }),
    fmtIndex: () => 0,
    now: () => w.t,
    stage: () => ({ widthM: 10, depthM: 6, snap: false, gridM: 0.5, backstageM: 1 }),
    select: ids => { w.selection = [...ids]; },
    applyPositions: map => { w.log.applied.push(map); for (const [id, v] of Object.entries(map)) Object.assign(w.positions[id], v); },
    rollback: map => { w.log.rolledBack.push(map); for (const [id, v] of Object.entries(map)) Object.assign(w.positions[id], { x: v.x, y: v.y }); },
    commit: label => w.log.commits.push(label),
    showMenu: p => w.log.menus.push(p),
    hideMenu: () => { w.log.hidden++; },
    box: r => w.log.boxes.push(r),
    panBy: (dx, dy) => w.log.pans.push([dx, dy]),
    zoomAt: (...a) => w.log.zooms.push(a),
    requestDraw: () => {},
    setTimeout: (fn, ms) => { w.timers.push({ fn, due: w.t + ms }); return w.timers.length - 1; },
    clearTimeout: id => { if (w.timers[id]) w.timers[id] = null; },
  };
  w.host = host;
  w.machine = createGestureMachine(host);
  w.advance = ms => {
    const end = w.t + ms;
    for (;;) {
      const due = w.timers.filter(x => x && x.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      w.t = due.due;
      w.timers[w.timers.indexOf(due)] = null;
      due.fn();
    }
    w.t = end;
  };
  w.down = (x, y, o = {}) => w.machine.down({ pointerId: o.pointerId ?? 1, px: x * 100, py: y * 100, touch: !!o.touch, button: o.button, shift: o.shift });
  w.move = (x, y, o = {}) => w.machine.move({ pointerId: o.pointerId ?? 1, px: x * 100, py: y * 100, touch: !!o.touch });
  w.up = (x, y, o = {}) => w.machine.up({ pointerId: o.pointerId ?? 1, px: x * 100, py: y * 100, touch: !!o.touch, shift: o.shift });
  return w;
}

// ---------- F-01：cancel 清 pointers 表与 pinch（UX-01 IR：cancel→新单指状态干净、无缩放跳变）
// build-70 M4 注：单指空白=框选（原 PAN 路径退役）——cancel 后新单指按下=BOX 即新基线状态。 ----------
test('F01-1 框选中 pointercancel：pointers 表清空；新单指按下=BOX 而非 PINCH，零缩放', () => {
  const w = makeWorld();
  w.down(0.2, 0.2, { touch: true, pointerId: 8 });
  w.move(0.6, 0.2, { touch: true, pointerId: 8 }); // 拖框（M4：单指空白=框选）
  assert.equal(w.machine.state(), 'BOX');
  assert.equal(w.machine.cancel(), true);
  assert.deepEqual(w.machine.debugPointers(), []); // 修复前残留 [8]
  // 同一根手指的「新触摸」：
  w.down(0.2, 0.2, { touch: true, pointerId: 9 });
  assert.equal(w.machine.state(), 'BOX'); // 修复前=PINCH（脏指针凑成双指）
  assert.deepEqual(w.machine.debugPointers(), [9]);
  w.move(2.2, 1.2, { touch: true, pointerId: 9 });
  w.up(2.2, 1.2, { touch: true, pointerId: 9 });
  assert.deepEqual(w.log.zooms, []); // 全程零捏合缩放（无脏坐标跳变）
  assert.equal(w.machine.state(), 'IDLE');
});
test('F01-2 PINCH 进行中 cancel：pointers 与 pinch 一并作废；残指抬起零动作', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true, pointerId: 7 });
  w.down(2, 1, { touch: true, pointerId: 8 });
  assert.equal(w.machine.state(), 'PINCH');
  w.move(2.4, 1, { touch: true, pointerId: 8 });
  assert.equal(w.log.zooms.length > 0, true);
  assert.equal(w.machine.cancel(), true);
  assert.deepEqual(w.machine.debugPointers(), []); // 修复前残留 [7,8]
  w.up(2.4, 1, { touch: true, pointerId: 8 }); // 迟到的抬起（cancel 后本不应到来）
  assert.equal(w.machine.state(), 'IDLE');
  // 后续新单指：正常框选（M4），零缩放（无脏坐标跳变）
  const n = w.log.zooms.length;
  w.down(0.2, 0.2, { touch: true, pointerId: 9 });
  w.move(1.2, 0.2, { touch: true, pointerId: 9 });
  assert.equal(w.machine.state(), 'BOX');
  w.move(1.3, 0.2, { touch: true, pointerId: 9 });
  w.up(1.3, 0.2, { touch: true, pointerId: 9 });
  assert.equal(w.log.zooms.length, n);
});
test('F01-3 舞者长按等待中 cancel：定时器解除（不再转菜单）、pointers 清空、返回消费', () => {
  const w = makeWorld();
  w.down(8, 2, { touch: true, pointerId: 9 }); // 命中舞者 E：PENDING + 长按布防
  assert.equal(w.machine.state(), 'PENDING');
  assert.equal(w.machine.cancel(), true);
  assert.deepEqual(w.machine.debugPointers(), []);
  w.advance(600); // 越过 lpMs=500：若定时器未解除将弹菜单（修复前后均应解除，防回归）
  assert.equal(w.machine.state(), 'IDLE');
  assert.deepEqual(w.log.boxes, []);
  assert.deepEqual(w.log.menus, []);
});
test('F01-4 DRAG 中 cancel：回滚不变；pointers 同步清空（合并两条既有语义）', () => {
  const w = makeWorld();
  w.down(8, 2); w.move(8.5, 2);
  assert.equal(w.machine.cancel(), true);
  assert.equal(w.positions.E.x, 8); // 回滚到按下前
  assert.deepEqual(w.machine.debugPointers(), []);
  assert.deepEqual(w.log.commits, []);
});
test('F08-1 cancel 后手势机回 IDLE：contextMenu 可再次弹出（右键策略可 node 测部分）', () => {
  const w = makeWorld();
  w.down(8, 2); w.move(8.5, 2);
  w.machine.cancel();
  assert.equal(w.machine.state(), 'IDLE');
  assert.equal(w.machine.contextMenu({ px: 800, py: 200 }), true); // 未合并 E：context 菜单
  assert.equal(w.log.menus[0].mode, 'context');
  assert.equal(w.machine.contextMenu({ px: 10, py: 10 }), false); // MENU 态不响应
  // MENU 态 cancel：消费并退出浮窗
  assert.equal(w.machine.cancel(), true);
  assert.equal(w.log.hidden, 1);
  assert.equal(w.machine.state(), 'IDLE');
});
test('F01-5 空闲时 cancel：不消费（既有语义 8 保持），pointers 本就为空', () => {
  const w = makeWorld();
  assert.equal(w.machine.cancel(), false);
  assert.deepEqual(w.machine.debugPointers(), []);
});

// ---------- F-02：MusicTimeline pointercancel（假 DOM，node 直驱） ----------
function fakeEl() {
  const hs = {};
  return {
    _hs: hs,
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 120 }),
    style: {},
  };
}
function makeTL() {
  if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
  const proj = {
    meta: { title: 't' }, dancers: [], groups: [],
    stage: { widthM: 10, depthM: 6, backstageM: 0, gridM: 0.5, snap: false, audience: 'bottom' },
    audio: { bpm: 120, beatsPerBar: 4, firstBeatSec: 0, name: '', durationSec: 40 },
    timeline: { metronome: false },
    // build-70 夹具迁移：旧 blocks [hold16+travel8 ×2, hold16] → clip [0,16)/[24,40)/[48,64)
    formations: [
      { id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [], startBeat: 0, lenBeats: 16 },
      { id: 'f2', name: 'B', color: '#64748b', positions: { a: { x: 2, y: 1 } }, merges: [], startBeat: 24, lenBeats: 16 },
      { id: 'f3', name: 'C', color: '#64748b', positions: { a: { x: 3, y: 1 } }, merges: [], startBeat: 48, lenBeats: 16 },
    ],
  };
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  const rec = { muts: 0, commits: 0, seeks: [] };
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => proj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      onSelectFormation: () => {},
      mutate: fn => { fn(proj); rec.muts++; },
      // build-70 M2：clip 拖拽高频预览走 mutateQuiet（无历史），松手 commitEdit 收口
      mutateQuiet: fn => { fn(proj); rec.muts++; },
      commitEdit: () => { rec.commits++; },
      seekBeat: b => { rec.seeks.push(b); },
    },
  });
  // 手工布局字段（render() 需要真实 canvas 2D，node 内直接设定等价状态）
  tl.rulerH = 22; tl.blocksTop = 76; tl.blocksH = 36; tl.W = 800; tl.H = 120;
  tl.hoverSeg = 0; // 预置悬停态：hover 路径不触发 render（无 2D 上下文）
  // build-70 M2：clip 拖拽路径（fcMove/clipL/clipR）每帧无条件 render——node 假 DOM 无 2D 上下文，
  // 与 tag-ui2/wavezoom 同口径打桩（重绘次数不在本套件断言域内）
  tl.render = () => {};
  const pps = tl.ppsOf(proj);
  const holdEdgeX = tl.secToX(8 * 0.5 * 2); // beat 16 × spb(0.5s) = 8s
  return { tl, cv, sc, proj, rec, holdEdgeX, pps };
}
test('F02-1 尺规 scrub 拖拽中 pointercancel：drag 立即置空（不卡死）', () => {
  const { tl, cv, rec } = makeTL();
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 5, pointerType: 'touch' });
  assert.deepEqual(tl.drag && tl.drag.kind, 'scrub');
  assert.equal(rec.seeks.length, 1);
  cv._hs.pointercancel[0](); // 修复前：无监听，drag 卡死 {kind:'scrub'}
  assert.equal(tl.drag, null);
  // 卡死后 hover 不再 seek/误动作（y=94 取块区、x=100 落在第 0 块：悬停态与预置一致，不触发渲染）
  const n = rec.seeks.length;
  cv._hs.pointermove[0]({ clientX: 100, clientY: 94, pointerId: 5, pointerType: 'mouse' });
  assert.equal(rec.seeks.length, n);
});
test('F02-2 clip 右缘拖拽中 pointercancel：drag 置空，随后无按键 hover 不再改写 clip 时长（数据损坏链关闭）', () => {
  const { tl, cv, rec, holdEdgeX } = makeTL();
  cv._hs.pointerdown[0]({ clientX: holdEdgeX, clientY: 94, pointerId: 5, pointerType: 'touch' });
  assert.deepEqual(tl.drag && tl.drag.kind, 'clipR', 'build-70 M2：块右缘=clipR（旧 hold 把手退役）');
  cv._hs.pointermove[0]({ clientX: holdEdgeX + 30, clientY: 94, pointerId: 5, pointerType: 'touch' });
  assert.equal(rec.muts, 1); // 拖拽中已一次 live mutate（预期内）
  cv._hs.pointercancel[0]();
  assert.equal(tl.drag, null); // 修复前：drag 卡死 {kind:'hold'}
  cv._hs.pointermove[0]({ clientX: holdEdgeX + 60, clientY: 94, pointerId: 5, pointerType: 'mouse' });
  cv._hs.pointermove[0]({ clientX: holdEdgeX - 60, clientY: 94, pointerId: 5, pointerType: 'mouse' });
  assert.equal(rec.muts, 1); // hover 路过零改写（修复前：持续改写）
  assert.equal(rec.commits, 0); // 被打断的拖拽不再补提交
});
test('F02-3 鼠标基线不受影响：down→move→up 正常 mutateQuiet+commit（T4 对照组防回归）', () => {
  const { tl, cv, rec, holdEdgeX } = makeTL();
  cv._hs.pointerdown[0]({ clientX: holdEdgeX, clientY: 94, pointerId: 1, pointerType: 'mouse' });
  cv._hs.pointermove[0]({ clientX: holdEdgeX + 24, clientY: 94, pointerId: 1, pointerType: 'mouse' });
  assert.equal(rec.muts, 1, '高频预览 mutateQuiet 恰一次');
  tl._up();
  assert.equal(rec.commits, 1, '松手提交恰一条「调整队形段时长」历史');
  assert.equal(tl.drag, null);
});

// ---------- F-04：history 哨兵决策机（纯逻辑） ----------
function fakeHist() {
  const entries = [{ fs: null }];
  const h = {
    entries, pushes: 0, backs: 0, i: 0,
    state: () => entries[h.i],
    push: st => { entries.splice(h.i + 1); entries.push(st); h.i++; h.pushes++; },
    back: () => { if (h.i > 0) h.i--; h.backs++; },
    fwd: () => { if (h.i < entries.length - 1) h.i++; },
    replace: st => { entries[h.i] = st; },
  };
  return h;
}
const mkSentinel = h => createHistorySentinel({ push: () => h.push({ fs: 'editor', pid: 'P1' }), back: () => h.back(), state: () => h.state() });
test('F04-1 进编辑器压哨兵恰一次；恢复/重载（已标记）不重复压入', () => {
  const h = fakeHist(); const s = mkSentinel(h);
  s.enter();
  assert.equal(h.pushes, 1);
  assert.deepEqual(h.state(), { fs: 'editor', pid: 'P1' });
  s.enter(); // 已在哨兵条目（重载恢复场景）
  assert.equal(h.pushes, 1);
});
test('F04-2 浏览器后退（编辑器内）→ 应用内回库；再次后退不再拦截（真实离开）', () => {
  const h = fakeHist(); const s = mkSentinel(h);
  s.enter();
  h.back(); // 用户按浏览器后退：落到库条目
  assert.deepEqual(s.onPop(h.state(), 'editor'), { action: 'toLibrary' });
  // 视图已切库（main 渲染层执行 closeProject），此时 exitUi 不再弹（哨兵已被后退消费）
  const b0 = h.backs;
  s.exitUi();
  assert.equal(h.backs, b0);
  // 再次后退：离开站点——哨兵不再拦截
  h.back();
  assert.deepEqual(s.onPop(h.state(), 'library'), { action: 'none' });
});
test('F04-3 应用内回库（「‹ 项目库」按钮路径）：主动弹掉哨兵并吞掉随之而来的 popstate', () => {
  const h = fakeHist(); const s = mkSentinel(h);
  s.enter();
  s.exitUi(); // 按钮路径：视图已切库，弹哨兵
  assert.equal(h.backs, 1);
  assert.deepEqual(s.onPop(h.state(), 'library'), { action: 'none' }); // 自驱 back 的 popstate 被吞
  // 吞噬只消费一次
  assert.deepEqual(s.onPop(h.state(), 'library'), { action: 'none' });
});
test('F04-4 库⇄编辑器往返 N 轮：哨兵不堆积（条目数恒定，push 覆盖 forward）', () => {
  const h = fakeHist(); const s = mkSentinel(h);
  s.enter();
  for (let k = 0; k < 5; k++) {
    h.back();
    assert.deepEqual(s.onPop(h.state(), 'editor'), { action: 'toLibrary' });
    s.exitUi(); // 后退消费过哨兵 → 无操作
    s.enter();
  }
  assert.equal(h.entries.length, 2, `条目应恒为 2，实际 ${h.entries.length}`);
  assert.equal(h.pushes, 6); // 初始 1 次 + 每轮 1 次（覆盖式）
});
test('F04-5 前进到哨兵（曾后退到库）→ 重开该项目；无 pid/项目缺失由上层摘标记', () => {
  const h = fakeHist(); const s = mkSentinel(h);
  s.enter();
  h.back();
  s.onPop(h.state(), 'editor');
  h.fwd(); // 浏览器前进：落回哨兵条目
  assert.deepEqual(s.onPop(h.state(), 'library'), { action: 'reopen', pid: 'P1' });
  // 重开后视图=编辑器、state 已标记 → enter 不重复压
  s.enter();
  assert.equal(h.pushes, 1);
});
test('F04-6 库视图下任意 popstate（无标记）不拦截；编辑器视图收到标记态 popstate（前进重开已完成）不动作', () => {
  const h = fakeHist(); const s = mkSentinel(h);
  assert.deepEqual(s.onPop(null, 'library'), { action: 'none' });
  h.push({ fs: 'editor', pid: 'P1' });
  assert.deepEqual(s.onPop(h.state(), 'editor'), { action: 'none' }); // 已在哨兵条目：无动作
});
