// 手势状态机原子操作矩阵：不经过 DOM/浏览器，直接驱动纯状态机。
// 每条用例对应计划矩阵的一个原子操作（选择/拖动/弹窗手势/视图）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureMachine } from '../js/gesture.js';

// ---------- 假世界：固定舞者布局 + 记录全部命令 + 假时钟 ----------
// 布局：A(1,1) 与 B(1.4,1) 已组队；C(5,5) 与 D(5.4,5) 相邻未组队；E(8,2) 孤立
function makeWorld(opts = {}) {
  const w = {
    t: 0,
    timers: [],
    positions: {
      A: { x: 1, y: 1, facing: 0 },
      B: { x: 1.4, y: 1, facing: 0 },
      C: { x: 5, y: 5, facing: 0 },
      D: { x: 5.4, y: 5, facing: 0 },
      E: { x: 8, y: 2, facing: 0 },
    },
    merges: [{ a: 'A', b: 'B', style: 'capsule' }],
    selection: [],
    multi: false,
    readOnly: false,
    handleHit: false,
    log: {
      selects: [], applied: [], rolledBack: [], commits: [],
      menus: [], hidden: 0, boxes: [], pans: [], zooms: [],
    },
  };
  const host = {
    readOnly: () => w.readOnly,
    hitHandle: () => w.handleHit,
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
    multiSelect: () => w.multi,
    formation: () => ({ positions: w.positions, merges: w.merges }),
    fmtIndex: () => 0,
    now: () => w.t,
    stage: () => ({ widthM: 10, depthM: 6, snap: !!opts.snap, gridM: 0.5, backstageM: 1 }),
    select: (ids, o = {}) => {
      w.log.selects.push([ids, o]);
      if (o.add && o.toggleOff) w.selection = w.selection.filter(i => !ids.includes(i));
      else if (o.add) w.selection = [...new Set([...w.selection, ...ids])];
      else w.selection = [...ids];
    },
    applyPositions: map => {
      w.log.applied.push(map);
      for (const [id, v] of Object.entries(map)) Object.assign(w.positions[id], v);
    },
    rollback: map => {
      w.log.rolledBack.push(map);
      for (const [id, v] of Object.entries(map)) Object.assign(w.positions[id], { x: v.x, y: v.y });
    },
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
  w.advance = ms => { // 推进假时钟并触发到期定时器
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
  const pid = { n: 0 };
  w.down = (x, y, { shift = false, touch = false, pointerId } = {}) =>
    w.machine.down({ pointerId: pointerId ?? ++pid.n, px: x * 100, py: y * 100, shift, touch });
  w.move = (x, y, { shift = false, touch = false, pointerId } = {}) =>
    w.machine.move({ pointerId: pointerId ?? pid.n, px: x * 100, py: y * 100, shift, touch });
  w.up = (x, y, { shift = false, touch = false, pointerId } = {}) =>
    w.machine.up({ pointerId: pointerId ?? pid.n, px: x * 100, py: y * 100, shift, touch });
  return w;
}

// ---------- 选择 ----------
test('1 单击舞者：仅其入选，位置不变，无历史', () => {
  const w = makeWorld();
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.selection, ['A']);
  assert.equal(w.positions.A.x, 1);
  assert.deepEqual(w.log.commits, []);
});
test('2 单击已选中舞者：选择保持不变（不闪断）', () => {
  const w = makeWorld();
  w.selection = ['A'];
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.log.selects, []);
  assert.deepEqual(w.selection, ['A']);
});
test('3 Shift+单击未选中：追加且其余保留', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(1, 1, { shift: true }); w.up(1, 1, { shift: true });
  assert.deepEqual(w.selection.sort(), ['A', 'E']);
});
test('4 Shift+单击已选中：移出该人，且不进入拖拽', () => {
  const w = makeWorld();
  w.selection = ['A', 'E'];
  w.down(1, 1, { shift: true }); w.up(1, 1, { shift: true });
  assert.deepEqual(w.selection, ['E']);
  w.move(3, 3); // 移出后的抬起前移动不应产生任何拖拽
  assert.deepEqual(w.log.applied, []);
});
test('5a 多选开：单击=追加', () => {
  const w = makeWorld();
  w.multi = true; w.selection = ['E'];
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.selection.sort(), ['A', 'E']);
});
test('5b 多选关：单击=替换', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.selection, ['A']);
});
test('5c 多选关：多选中单击其一（未拖动）收拢为单人', () => {
  const w = makeWorld();
  w.selection = ['A', 'E'];
  w.down(8, 2); w.up(8, 2); // 点 E，未拖动
  assert.deepEqual(w.selection, ['E']);
});
test('6 框选：矩形内全员恰好人选', () => {
  const w = makeWorld();
  w.down(0.2, 0.2); w.move(5.8, 5.8); w.up(5.8, 5.8);
  assert.deepEqual(w.selection, ['A', 'B', 'C', 'D']);
  assert.equal(w.log.boxes.at(-1), null); // 结束后矩形清除
});
test('7 Shift+框选：与原选择取并集', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(0.2, 0.2); w.move(5.8, 5.8); w.up(5.8, 5.8, { shift: true });
  assert.deepEqual(w.selection, ['E', 'A', 'B', 'C', 'D']);
});
test('8 空闲时 cancel()（Escape）：不消费，交由上层清空选择', () => {
  const w = makeWorld();
  assert.equal(w.machine.cancel(), false);
});
test('8b 单击空白（<6px）：清空选择', () => {
  const w = makeWorld();
  w.selection = ['A'];
  w.down(0.2, 0.2); w.up(0.21, 0.2);
  assert.deepEqual(w.selection, []);
});
test('8c 单击静止重叠舞者（未组队）：不弹合并确认', () => {
  const w = makeWorld();
  w.down(5, 5); w.up(5, 5); // C 与 D 静止相距 0.4m
  assert.deepEqual(w.log.menus, []);
  assert.deepEqual(w.selection, ['C']);
});

// ---------- 拖动 ----------
test('9 拖动单人：精确位移，仅其移动，一条历史', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.5, 1); w.up(1.5, 1);
  assert.equal(w.positions.A.x, 1.5);
  assert.equal(w.positions.B.x, 1.4); // 舞伴不联动
  assert.deepEqual(w.log.commits, ['移动舞者']);
  assert.deepEqual(w.log.applied.at(-1), { A: { x: 1.5, y: 1 } });
});
test('10 拖动全程经过他人上方：零弹窗', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.4, 1); w.move(5, 5); w.move(5.4, 5); w.move(8, 3); w.up(8, 3);
  assert.deepEqual(w.log.menus, []);
});
test('11 松手钳制在舞台+后台范围内', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(25, 1); w.up(25, 1); // 目标 x=25，钳到 10+1
  assert.equal(w.positions.A.x, 11);
});
test('12 拖动中 Escape：回滚到按下前，零历史', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.5, 1);
  const consumed = w.machine.cancel();
  assert.equal(consumed, true);
  assert.equal(w.positions.A.x, 1);
  assert.deepEqual(w.log.rolledBack, [{ A: { x: 1, y: 1 } }]);
  assert.deepEqual(w.log.commits, []);
});
test('13 拖动恰好一条历史；单击零历史', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.3, 1); w.up(1.3, 1);
  assert.deepEqual(w.log.commits, ['移动舞者']);
  const w2 = makeWorld();
  w2.down(1, 1); w2.up(1, 1);
  assert.deepEqual(w2.log.commits, []);
});
test('15 snap 开启：位移对齐网格', () => {
  const w = makeWorld({ snap: true });
  w.down(1, 1); w.move(1.3, 1); w.up(1.3, 1); // 0.3m → 对齐到 0.5m
  assert.equal(w.positions.A.x, 1.5);
});

// ---------- 弹窗手势 ----------
test('16 触摸长按已组队舞者 500ms：单元浮窗，输入锁定', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true }); w.advance(500);
  assert.equal(w.log.menus.length, 1);
  const m = w.log.menus[0];
  assert.equal(m.mode, 'unit');
  assert.deepEqual(m.ids, ['A', 'B']);
  assert.equal(m.style, 'capsule');
  assert.equal(w.machine.state(), 'MENU');
  // 锁定期间指针事件不产生任何舞台命令
  const before = w.log.applied.length;
  w.move(2, 2, { touch: true }); w.down(2, 2, { touch: true }); // down 同时应退出浮窗
  assert.equal(w.log.hidden, 1);
  assert.equal(w.machine.state(), 'IDLE');
  assert.equal(w.log.applied.length, before);
});
test('17 触摸长按未组队舞者：不弹浮窗，仍可正常拖动', () => {
  const w = makeWorld();
  w.down(8, 2, { touch: true }); w.advance(500);
  assert.deepEqual(w.log.menus, []);
  w.move(8.5, 2); w.up(8.5, 2);
  assert.deepEqual(w.log.commits, ['移动舞者']);
});
test('18 拖动松手落入他人 0.55m 内且非舞伴：合并确认浮窗', () => {
  const w = makeWorld();
  w.down(5, 5); w.move(5.4, 5); w.up(5.4, 5);
  assert.deepEqual(w.log.commits, ['移动舞者']); // 先提交移动
  assert.equal(w.log.menus.length, 1);
  assert.equal(w.log.menus[0].mode, 'merge');
  assert.deepEqual(w.log.menus[0].ids, ['C', 'D']);
});
test('19 松手时与舞伴重叠：不弹（已组队不重复确认）', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.2, 1); w.up(1.2, 1); // A 仍在 B 的 0.55m 内
  assert.deepEqual(w.log.menus, []);
});
test('19b 拖离舞伴超过呈示距离松手：不弹', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(3, 1); w.up(3, 1);
  assert.deepEqual(w.log.menus, []);
});
test('20 合并浮窗：点外部取消 = 零数据变更，解除锁定', () => {
  const w = makeWorld();
  w.down(5, 5); w.move(5.4, 5); w.up(5.4, 5); // 弹确认
  const appliedLen = w.log.applied.length;
  w.down(8, 2); // 点外部
  assert.equal(w.log.hidden, 1);
  assert.equal(w.machine.state(), 'IDLE');
  assert.equal(w.log.applied.length, appliedLen);
  assert.equal(w.merges.length, 1); // merges 未变
});
test('21 触摸长按后移动超阈值：取消长按转正常拖拽', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true });
  w.move(1.1, 1); // client 位移 10px < 12px 容差，先按住
  w.advance(200);
  w.move(1.4, 1); // 位移 40px > 12px，取消长按
  w.advance(400);
  assert.deepEqual(w.log.menus, []);
  w.up(1.1, 1);
  assert.deepEqual(w.log.commits, ['移动舞者']);
});
test('22 转正拖拽后长按定时不再触发', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true }); w.move(1.3, 1, { touch: true });
  w.advance(500);
  assert.deepEqual(w.log.menus, []);
});

// ---------- 视图 ----------
test('23a 鼠标空白拖动=框选；23b 触摸空白拖动=平移且不改选择', () => {
  const w = makeWorld();
  w.down(0.2, 0.2); w.move(2, 2); w.up(2, 2);
  assert.deepEqual(w.selection, ['A', 'B']);
  assert.equal(w.log.boxes.length >= 2, true); // 过程矩形 + 结束 null

  const w2 = makeWorld();
  w2.selection = ['E'];
  w2.down(0.2, 0.2, { touch: true, pointerId: 91 });
  w2.move(2, 2, { touch: true, pointerId: 91 });
  w2.up(2, 2, { touch: true, pointerId: 91 });
  assert.deepEqual(w2.log.pans.at(-1), [180, 180]);
  assert.deepEqual(w2.selection, ['E']); // 平移不改选择
  assert.deepEqual(w2.log.boxes, []);
});
test('24 双指：拖拽回滚→缩放+平移；残留单指不误触发', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true, pointerId: 1 });
  w.move(1.4, 1, { touch: true, pointerId: 1 });
  w.down(2, 2, { touch: true, pointerId: 2 }); // 第二指按下
  assert.deepEqual(w.log.rolledBack.length, 1); // 半途拖拽回滚
  assert.deepEqual(w.log.commits, []); // 不产生历史
  const z0 = w.log.zooms.length;
  w.move(2.5, 2, { touch: true, pointerId: 1 });
  w.move(1.5, 2.5, { touch: true, pointerId: 2 });
  assert.equal(w.log.zooms.length > z0, true);
  assert.equal(w.log.pans.length > 0, true);
  w.up(2.5, 2, { touch: true, pointerId: 1 });
  const appliedBefore = w.log.applied.length;
  w.move(5, 5, { touch: true, pointerId: 2 }); // 残留单指
  assert.equal(w.log.applied.length, appliedBefore);
  assert.deepEqual(w.log.boxes, []);
});
test('25 只读模式吞掉全部手势', () => {
  const w = makeWorld();
  w.readOnly = true;
  w.down(1, 1); w.move(2, 2); w.up(2, 2);
  assert.deepEqual(w.log.applied, []);
  assert.deepEqual(w.log.selects, []);
});
test('26a 朝向把手命中优先，拖动更新 facing', () => {
  const w = makeWorld();
  w.handleHit = true; w.selection = ['A'];
  w.down(1.9, 0.1); // 任意点（把手命中短路舞者命中）
  w.move(1.7, 0.1);
  w.up(1.7, 0.1);
  assert.equal(w.positions.A.facing !== 0, true);
  assert.deepEqual(w.log.commits, ['调整朝向']);
});
test('26b 朝向未变化松手：不产生历史', () => {
  const w = makeWorld();
  w.handleHit = true; w.selection = ['A'];
  w.down(1.9, 0.1); w.up(1.9, 0.1);
  assert.deepEqual(w.log.commits, []);
});
test('27 PINCH 距离过小（<8px）不产生缩放', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true, pointerId: 1 });
  w.down(1.03, 1, { touch: true, pointerId: 2 }); // 3px 间距
  w.move(1.05, 1, { touch: true, pointerId: 2 });
  assert.deepEqual(w.log.zooms, []);
});

// ---------- 桌面双击 / 拖动重叠驻留（合并确认） ----------
test('28 桌面双击已组队舞者：单元浮窗', () => {
  const w = makeWorld();
  w.down(1, 1); w.up(1, 1);
  w.down(1, 1); w.up(1, 1); // 350ms 内二次单击
  assert.equal(w.log.menus.length, 1);
  assert.equal(w.log.menus[0].mode, 'unit');
  assert.deepEqual(w.log.menus[0].ids, ['A', 'B']);
});
test('28b 双击间隔超 350ms：不触发', () => {
  const w = makeWorld();
  w.down(1, 1); w.up(1, 1);
  w.advance(400);
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.log.menus, []);
});
test('28c 双击未组队舞者：不触发', () => {
  const w = makeWorld();
  w.down(8, 2); w.up(8, 2);
  w.down(8, 2); w.up(8, 2);
  assert.deepEqual(w.log.menus, []);
});
test('28d 桌面按住不动：长按不触发（长按仅触摸端）', () => {
  const w = makeWorld();
  w.down(1, 1); w.advance(800); w.up(1, 1);
  assert.deepEqual(w.log.menus, []);
  assert.deepEqual(w.selection, ['A']);
});
test('29 拖到重叠位置驻留 1.5s：不松手即弹合并确认', () => {
  const w = makeWorld();
  w.down(5, 5);          // 按住 C
  w.move(5.2, 5);        // 拖近 D
  w.advance(1600);       // 停住 1.6s
  w.move(5.2, 5);        // 驻留检查在 move 中评估
  assert.equal(w.machine.state(), 'MENU');
  assert.equal(w.log.menus.length, 1);
  assert.deepEqual(w.log.menus[0].ids, ['C', 'D']);
  assert.deepEqual(w.log.commits, ['移动舞者']); // 位移已先提交
  // 菜单取消后位置保留（移动是真实意图）
  w.down(8, 2, { touch: false });
  assert.equal(w.machine.state(), 'IDLE');
  assert.equal(Math.abs(w.positions.C.x - 5.2) < 0.01, true);
});
test('29b 快速经过重叠不停留：不弹窗', () => {
  const w = makeWorld();
  w.down(5, 5);
  w.move(5.4, 5);        // 落在 D 上
  w.advance(200);        // 远小于驻留时长
  w.move(7, 5);          // 继续拖走
  w.advance(2000);       // 即使累计时间很长
  w.move(7.5, 5);
  w.up(7.5, 5);
  assert.deepEqual(w.log.menus, []);
});
test('29c 驻留后松手：不重复弹窗', () => {
  const w = makeWorld();
  w.down(5, 5);
  w.move(5.3, 5);
  w.advance(1600);
  w.move(5.3, 5);        // 驻留触发 → MENU
  w.up(5.3, 5);          // 松手（MENU 态吞掉）
  assert.equal(w.log.menus.length, 1); // 仍是驻留那一次
});
