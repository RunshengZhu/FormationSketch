// 手势状态机原子操作矩阵：不经过 DOM/浏览器，直接驱动纯状态机。
// 每条用例对应计划矩阵的一个原子操作（选择/拖动/弹窗手势/视图）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureMachine } from '../js/gesture.js';
import { removeDancer } from '../js/model.js';

// ---------- 假世界：固定舞者布局 + 记录全部命令 + 假时钟 ----------
// 布局：A(1,1) 与 B(1.4,1) 已合并（呈示分离）；C(5,5) 与 D(5.4,5) 相邻未合并；E(8,2) 孤立
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
  w.down = (x, y, { shift = false, touch = false, pointerId, button, space } = {}) =>
    w.machine.down({ pointerId: pointerId ?? ++pid.n, px: x * 100, py: y * 100, shift, touch, button, space });
  w.move = (x, y, { shift = false, touch = false, pointerId, button, space } = {}) =>
    w.machine.move({ pointerId: pointerId ?? pid.n, px: x * 100, py: y * 100, shift, touch, button, space });
  w.up = (x, y, { shift = false, touch = false, pointerId, button, space } = {}) =>
    w.machine.up({ pointerId: pointerId ?? pid.n, px: x * 100, py: y * 100, shift, touch, button, space });
  return w;
}

// ---------- 选择 ----------
// 规格变更（单元原子性）：主假世界里 A/B 是合并单元——命中任一成员=整单元两人入选。
// 「单人」前提的用例一律改用未合并舞者 E（或 C/D）；合并成员的原子行为见 U 组。
test('1 单击未合并舞者：仅其入选，位置不变，无历史', () => {
  const w = makeWorld();
  w.down(8, 2); w.up(8, 2); // E 未合并
  assert.deepEqual(w.selection, ['E']);
  assert.equal(w.positions.E.x, 8);
  assert.deepEqual(w.log.commits, []);
});
test('2 单击已入选：未合并舞者选择不变；整单元已入选亦不闪断', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(8, 2); w.up(8, 2);
  assert.deepEqual(w.log.selects, []);
  assert.deepEqual(w.selection, ['E']);
  const w2 = makeWorld();
  w2.selection = ['A', 'B']; // 整单元（单元原子性下的合法形态）
  w2.down(1, 1); w2.up(1, 1);
  assert.deepEqual(w2.log.selects, []);
  assert.deepEqual(w2.selection, ['A', 'B']);
});
test('3 Shift+单击未选中合并成员：整单元原子加入，其余保留', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(1, 1, { shift: true }); w.up(1, 1, { shift: true });
  assert.deepEqual(w.selection.sort(), ['A', 'B', 'E']);
});
test('4 Shift+单击已入选单元：整单元原子移出，且不进入拖拽', () => {
  const w = makeWorld();
  w.selection = ['A', 'B', 'E'];
  w.down(1, 1, { shift: true }); w.up(1, 1, { shift: true });
  assert.deepEqual(w.selection, ['E']);
  w.move(3, 3); // 移出后的抬起前移动不应产生任何拖拽
  assert.deepEqual(w.log.applied, []);
});
test('5a 多选开：单击合并成员=整单元原子追加', () => {
  const w = makeWorld();
  w.multi = true; w.selection = ['E'];
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.selection.sort(), ['A', 'B', 'E']);
});
test('5b 多选关：单击=替换（命中合并成员替换为整单元）', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.selection, ['A', 'B']);
});
test('5c 多选中单击其一收拢：单元感知——合并成员收拢为整单元，未合并仍收拢为单人', () => {
  const w = makeWorld();
  w.selection = ['A', 'B', 'E'];
  w.down(1, 1); w.up(1, 1); // 点合并成员 A（未拖动）→ 收拢目标=整单元 [A,B]
  assert.deepEqual(w.selection, ['A', 'B']);
  w.selection = ['A', 'B', 'E'];
  w.down(8, 2); w.up(8, 2); // 点未合并 E → 收拢为单人（既有行为）
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
test('9 拖动未合并舞者：精确位移，仅其移动，一条历史', () => {
  const w = makeWorld();
  w.down(8, 2); w.move(8.5, 2); w.up(8.5, 2);
  assert.equal(w.positions.E.x, 8.5);
  assert.equal(w.positions.A.x, 1); // 拖合并成员=整单元同步位移（U4/U6），拖未合并舞者不联动任何人
  assert.deepEqual(w.log.commits, ['移动舞者']);
  assert.deepEqual(w.log.applied.at(-1), { E: { x: 8.5, y: 2 } });
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
test('12 拖动中 Escape：整单元回滚到按下前快照，零历史', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.5, 1);
  const consumed = w.machine.cancel();
  assert.equal(consumed, true);
  assert.equal(w.positions.A.x, 1);
  assert.deepEqual(w.log.rolledBack, [{ A: { x: 1, y: 1 }, B: { x: 1.4, y: 1 } }]); // 回滚快照=整单元
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
test('17 触摸长按未合并舞者：同款上下文菜单仅「删除」，取消后仍可正常拖动', () => {
  const w = makeWorld();
  w.down(8, 2, { touch: true }); w.advance(500);
  assert.equal(w.log.menus.length, 1);
  assert.equal(w.log.menus[0].mode, 'context'); // 仅「删除」入口的上下文菜单
  assert.deepEqual(w.log.menus[0].ids, ['E']);
  assert.equal(w.machine.state(), 'MENU');
  w.down(2, 2, { touch: true }); // 点外部=取消（走 hideMenu/gestureMenuClosed 解锁路径）
  assert.equal(w.machine.state(), 'IDLE');
  w.up(2, 2, { touch: true });
  w.up(8, 2, { touch: true, pointerId: 1 }); // 抬起长按的那根手指（MENU 吞抬起=无操作）
  w.down(8, 2, { touch: true }); w.move(8.5, 2, { touch: true }); w.up(8.5, 2, { touch: true });
  assert.deepEqual(w.log.commits, ['移动舞者']); // 长按菜单不排挤后续正常拖动
});
test('18 拖动松手落入他人 0.55m 内且尚未合并：合并确认浮窗', () => {
  const w = makeWorld();
  w.down(5, 5); w.move(5.4, 5); w.up(5.4, 5);
  assert.deepEqual(w.log.commits, ['移动舞者']); // 先提交移动
  assert.equal(w.log.menus.length, 1);
  assert.equal(w.log.menus[0].mode, 'merge');
  assert.deepEqual(w.log.menus[0].ids, ['C', 'D']);
});
test('19 与已合并成员重叠松手 / 拖离呈示距离：均不弹合并确认（已合并豁免）', () => {
  const w = makeWorld();
  w.down(1, 1); w.move(1.2, 1); w.up(1.2, 1); // A 仍在单元成员 B 的 0.55m 内
  assert.deepEqual(w.log.menus, []);
  const w2 = makeWorld();
  w2.down(1, 1); w2.move(3, 1); w2.up(3, 1); // 拖离单元成员超过呈示距离
  assert.deepEqual(w2.log.menus, []);
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
test('26a 朝向把手命中优先，拖动更新 facing；26b 未变化不产生历史', () => {
  const w = makeWorld();
  w.handleHit = true; w.selection = ['A'];
  w.down(1.9, 0.1); // 任意点（把手命中短路舞者命中）
  w.move(1.7, 0.1);
  w.up(1.7, 0.1);
  assert.equal(w.positions.A.facing !== 0, true);
  assert.deepEqual(w.log.commits, ['调整朝向']);
  const w2 = makeWorld();
  w2.handleHit = true; w2.selection = ['A'];
  w2.down(1.9, 0.1); w2.up(1.9, 0.1);
  assert.deepEqual(w2.log.commits, []);
});
test('27 PINCH 距离过小（<8px）不产生缩放', () => {
  const w = makeWorld();
  w.down(1, 1, { touch: true, pointerId: 1 });
  w.down(1.03, 1, { touch: true, pointerId: 2 }); // 3px 间距
  w.move(1.05, 1, { touch: true, pointerId: 2 });
  assert.deepEqual(w.log.zooms, []);
});

// ---------- 桌面双击 / 拖动重叠驻留（合并确认） ----------
test('28 桌面双击合并成员：350ms 内弹单元浮窗；28b 超间隔不触发', () => {
  const w = makeWorld();
  w.down(1, 1); w.up(1, 1);
  w.down(1, 1); w.up(1, 1); // 350ms 内二次单击
  assert.equal(w.log.menus.length, 1);
  assert.equal(w.log.menus[0].mode, 'unit');
  assert.deepEqual(w.log.menus[0].ids, ['A', 'B']);
  const w2 = makeWorld();
  w2.down(1, 1); w2.up(1, 1);
  w2.advance(400);
  w2.down(1, 1); w2.up(1, 1);
  assert.deepEqual(w2.log.menus, []);
});
test('28c 双击未合并舞者不触发；28d 桌面按住不动不弹窗（点选=整单元）', () => {
  const w = makeWorld();
  w.down(8, 2); w.up(8, 2);
  w.down(8, 2); w.up(8, 2);
  assert.deepEqual(w.log.menus, []);
  const w2 = makeWorld();
  w2.down(1, 1); w2.advance(800); w2.up(1, 1); // 桌面按住：长按仅触摸端
  assert.deepEqual(w2.log.menus, []);
  assert.deepEqual(w2.selection, ['A', 'B']); // 抬起=点选合并成员 → 整单元入选
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
test('29b 快速经过重叠不停留不弹窗；29c 驻留后松手不重复弹', () => {
  const w = makeWorld();
  w.down(5, 5);
  w.move(5.4, 5);        // 落在 D 上
  w.advance(200);        // 远小于驻留时长
  w.move(7, 5);          // 继续拖走
  w.advance(2000);       // 即使累计时间很长
  w.move(7.5, 5);
  w.up(7.5, 5);
  assert.deepEqual(w.log.menus, []);
  const w2 = makeWorld();
  w2.down(5, 5);
  w2.move(5.3, 5);
  w2.advance(1600);
  w2.move(5.3, 5);       // 驻留触发 → MENU
  w2.up(5.3, 5);         // 松手（MENU 态吞掉）
  assert.equal(w2.log.menus.length, 1); // 仍是驻留那一次
});

// ---------- 空白手势语义补全（L1 D-11 桌面平移 / D-02 触摸点按清选） ----------
// 语义裁定：左键空白拖动=框选（不变）；桌面平移=中键空白拖动 或 空格+左键空白拖动；
// 触摸空白：位移<promoteM 抬起=清空选择，晋升后单指拖动=平移且不改选择。
test('30 中键空白拖动=平移：panBy 序列，零选择/零框选/零历史', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(0.25, 0.25, { button: 1, pointerId: 1 });
  w.move(1.25, 0.75, { button: 1, pointerId: 1 });
  w.move(2.25, 1.25, { button: 1, pointerId: 1 });
  w.up(2.25, 1.25, { button: 1, pointerId: 1 });
  assert.deepEqual(w.log.pans, [[100, 50], [100, 50]]);
  assert.deepEqual(w.selection, ['E']);   // 平移全程不改选择
  assert.deepEqual(w.log.boxes, []);      // 不走框选
  assert.deepEqual(w.log.commits, []);    // 不产生历史
  assert.equal(w.machine.state(), 'IDLE');
});
test('31 中键空白平移中途 Escape(cancel)：终止且零历史', () => {
  const w = makeWorld();
  w.down(0.25, 0.25, { button: 1, pointerId: 1 });
  w.move(1.25, 0.75, { button: 1, pointerId: 1 });
  assert.equal(w.machine.cancel(), true);
  assert.deepEqual(w.selection, []);
  assert.deepEqual(w.log.commits, []);
});
test('32 空格+左键空白拖动=平移（space 经事件对象传入，state 机不读 DOM）', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(0.25, 0.25, { space: true, pointerId: 1 });
  w.move(2.25, 1.25, { space: true, pointerId: 1 });
  w.up(2.25, 1.25, { space: true, pointerId: 1 });
  assert.deepEqual(w.log.pans, [[200, 100]]);
  assert.deepEqual(w.selection, ['E']);
  assert.deepEqual(w.log.boxes, []);
});
test('33 空格+左键按在舞者上：不平移不选择不拖拽（平移仅空白起手）', () => {
  const w = makeWorld();
  w.down(1, 1, { space: true, pointerId: 1 });
  w.move(2, 2, { space: true, pointerId: 1 });
  w.up(2, 2, { space: true, pointerId: 1 });
  assert.deepEqual(w.log.pans, []);
  assert.deepEqual(w.selection, []);
  assert.deepEqual(w.log.applied, []);
  assert.deepEqual(w.log.selects, []);
});
test('34 中键按在舞者上：同 33（不误启动编辑手势）', () => {
  const w = makeWorld();
  w.down(1, 1, { button: 1, pointerId: 1 });
  w.move(2, 2, { button: 1, pointerId: 1 });
  w.up(2, 2, { button: 1, pointerId: 1 });
  assert.deepEqual(w.log.pans, []);
  assert.deepEqual(w.selection, []);
  assert.deepEqual(w.log.applied, []);
});
test('35 触摸空白点按（无晋升位移）抬起：清空选择且零平移', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(0.25, 0.25, { touch: true, pointerId: 91 });
  w.up(0.26, 0.26, { touch: true, pointerId: 91 }); // 无 move 事件 → 未晋升
  assert.deepEqual(w.selection, []);
  assert.deepEqual(w.log.pans, []);
});
test('36 触摸空白小抖动（<promoteM）不平移；晋升后补齐平移且全程不碰选择', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(0.25, 0.25, { touch: true, pointerId: 91 });
  w.move(0.3, 0.25, { touch: true, pointerId: 91 }); // 5px < 6px（promoteM×100px/m）
  assert.deepEqual(w.log.pans, []);
  w.move(2.25, 2.25, { touch: true, pointerId: 91 }); // 晋升：一次性补齐自按下起的位移
  assert.deepEqual(w.log.pans, [[200, 200]]);
  w.up(2.25, 2.25, { touch: true, pointerId: 91 });
  assert.deepEqual(w.selection, ['E']);    // 平移不改选择
  assert.deepEqual(w.log.selects, []);     // select 全程未被调用
});
test('37 左键空白拖动=框选（语义保持：不平移、矩形内全选）', () => {
  const w = makeWorld();
  w.selection = ['E'];
  w.down(0.2, 0.2, { button: 0, pointerId: 1 });
  w.move(2, 2, { button: 0, pointerId: 1 });
  assert.deepEqual(w.log.pans, []); // 左键拖动不平移
  w.up(2, 2, { button: 0, pointerId: 1 });
  assert.deepEqual(w.selection.sort(), ['A', 'B']);
  assert.equal(w.log.boxes.at(-1), null);
});

// ---------- 徽标即单元（DEFECT-L2-1 回归，原 tests/gesture.unit2.test.mjs U1~U10 并入） ----------
// 与主假世界的差异：支持「收拢同点呈示」布置；hitDancer 与 stage.js 一致——
// 逆序遍历（视觉上层/后绘者优先）、距离严格更近才替换（收拢同点命中 B 而非 A）。
function makeWorldU({ collapsed = true } = {}) {
  const w = {
    t: 0,
    timers: [],
    positions: {
      A: { x: 1, y: 1, facing: 0 },
      B: { x: collapsed ? 1 : 1.4, y: 1, facing: 0 }, // collapsed: collapsePair 后同点呈示
      C: { x: 5, y: 5, facing: 0 },
      D: { x: 5.4, y: 5, facing: 0 },
      E: { x: 8, y: 2, facing: 0 },
    },
    merges: [{ a: 'A', b: 'B', style: 'capsule' }],
    selection: [],
    multi: false,
    readOnly: false,
    log: {
      selects: [], applied: [], rolledBack: [], commits: [],
      menus: [], hidden: 0, boxes: [], pans: [], zooms: [],
    },
  };
  const host = {
    readOnly: () => w.readOnly,
    hitHandle: () => false,
    hitDancer: (x, y) => {
      const entries = Object.entries(w.positions);
      let best = null, bd = Infinity;
      for (let i = entries.length - 1; i >= 0; i--) {
        const [id, p] = entries[i];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < 0.38 * 1.35 && d < bd) { bd = d; best = id; }
      }
      return best;
    },
    toStage: (px, py) => ({ x: px / 100, y: py / 100 }),
    selection: () => [...w.selection],
    multiSelect: () => w.multi,
    formation: () => ({ positions: w.positions, merges: w.merges }),
    fmtIndex: () => 0,
    now: () => w.t,
    stage: () => ({ widthM: 10, depthM: 6, snap: false, gridM: 0.5, backstageM: 1 }),
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
  const pid = { n: 0 };
  w.down = (x, y, { shift = false, touch = false, pointerId, button, space } = {}) =>
    w.machine.down({ pointerId: pointerId ?? ++pid.n, px: x * 100, py: y * 100, shift, touch, button, space });
  w.move = (x, y, { shift = false, touch = false, pointerId, button, space } = {}) =>
    w.machine.move({ pointerId: pointerId ?? pid.n, px: x * 100, py: y * 100, shift, touch, button, space });
  w.up = (x, y, { shift = false, touch = false, pointerId, button, space } = {}) =>
    w.machine.up({ pointerId: pointerId ?? pid.n, px: x * 100, py: y * 100, shift, touch, button, space });
  return w;
}
const atU = (w, id) => ({ x: w.positions[id].x, y: w.positions[id].y });

test('U1 点选收拢徽标：整单元两人同时入选（原子）', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1); w.up(1, 1); // 徽标中点：命中视觉上层的 B → 原子选中整单元
  assert.deepEqual(w.selection, ['A', 'B']);
  assert.deepEqual(w.log.commits, []);
});
test('U2 shift+点选收拢徽标：整单元原子加入（既有选择保留）', () => {
  const w = makeWorldU({ collapsed: true });
  w.selection = ['E'];
  w.down(1, 1, { shift: true }); w.up(1, 1, { shift: true });
  assert.deepEqual(w.selection.sort(), ['A', 'B', 'E']);
});
test('U3 多选开：点选收拢徽标=整单元原子追加（触摸多选入口）', () => {
  const w = makeWorldU({ collapsed: true });
  w.multi = true; w.selection = ['E'];
  w.down(1, 1); w.up(1, 1);
  assert.deepEqual(w.selection.sort(), ['A', 'B', 'E']);
});
test('U4 直接抓取收拢徽标拖动：整单元同步位移，恰一条历史', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1); w.move(2.2, 3.4); w.up(2.2, 3.4); // Δ=(+1.2,+2.4)，同 C-02 证据
  assert.deepEqual(atU(w, 'A'), { x: 2.2, y: 3.4 });
  assert.deepEqual(atU(w, 'B'), { x: 2.2, y: 3.4 });
  assert.deepEqual(w.log.commits, ['移动舞者']);
  assert.deepEqual(Object.keys(w.log.applied.at(-1)).sort(), ['A', 'B']);
});
test('U5 先点选（=整单元入选）再拖拽：整单元同步位移（单人拉伸路径已删除，C-05 P2 旧语义退役）', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1); w.up(1, 1); // 先点选 → selection=[A,B]（点选即整单元）
  assert.deepEqual(w.selection, ['A', 'B']);
  w.down(1, 1); w.move(2, 1); w.up(2, 1);
  assert.deepEqual(atU(w, 'B'), { x: 2, y: 1 });
  assert.deepEqual(atU(w, 'A'), { x: 2, y: 1 }); // 不再存在「另一人不动」的拉伸
  assert.deepEqual(w.log.commits, ['移动舞者']);
});
test('U6 分离呈示的合并成员拖拽：整单元同步位移（拉伸/拆分拖拽路径不可达）', () => {
  const w = makeWorldU({ collapsed: false }); // A(1,1) B(1.4,1)：0.4m 两圆+虚线呈示
  w.down(1, 1); w.move(1.5, 1); w.up(1.5, 1);
  assert.equal(w.positions.A.x, 1.5);
  assert.equal(w.positions.B.x, 1.9); // 同步位移 +0.5，单元间距保持（不再单人拉伸）
});
test('U7 未合并舞者拖拽：仅自身位移（D-01/单人语义回归）', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(8, 2); w.move(8.5, 2.5); w.up(8.5, 2.5);
  assert.deepEqual(atU(w, 'E'), { x: 8.5, y: 2.5 });
  assert.equal(w.positions.A.x, 1);
  assert.equal(w.positions.C.x, 5);
});
test('U8 单元拖拽中 Escape：整单元回滚、零历史', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1); w.move(1.5, 1);
  assert.equal(w.machine.cancel(), true);
  assert.deepEqual(atU(w, 'A'), { x: 1, y: 1 });
  assert.deepEqual(atU(w, 'B'), { x: 1, y: 1 });
  assert.deepEqual(w.log.rolledBack, [{ A: { x: 1, y: 1 }, B: { x: 1, y: 1 } }]);
  assert.deepEqual(w.log.commits, []);
});
test('U9 单元拖拽中第二指按下：整单元回滚（PINCH 中断）', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1, { touch: true, pointerId: 1 });
  w.move(1.5, 1, { touch: true, pointerId: 1 }); // 已转正 DRAG
  w.down(2, 2, { touch: true, pointerId: 2 });   // 第二指 → 回滚
  assert.deepEqual(atU(w, 'A'), { x: 1, y: 1 });
  assert.deepEqual(atU(w, 'B'), { x: 1, y: 1 });
  assert.deepEqual(w.log.commits, []);
});
test('U10 拖动收拢单元途中不误弹确认（成员间距 0，已合并豁免）', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1); w.move(2.2, 3.4); w.move(3, 4); w.up(3, 4);
  assert.deepEqual(w.log.menus, []);
  assert.deepEqual(atU(w, 'A'), { x: 3, y: 4 });
  assert.deepEqual(atU(w, 'B'), { x: 3, y: 4 });
});

// ---------- 单元原子性补充（本轮规格变更新增） ----------
test('U11 框选命中单元任一成员：整单元原子入选', () => {
  const w = makeWorldU({ collapsed: false }); // A(1,1) B(1.4,1) 分离呈示
  w.down(0.6, 0.6); w.move(1.2, 1.4); w.up(1.2, 1.4); // 矩形仅罩住 A
  assert.deepEqual(w.selection, ['A', 'B']); // B 在矩形外仍随单元入选
  const w2 = makeWorldU({ collapsed: true }); // 收拢徽标：两人同点
  w2.down(0.5, 0.5); w2.move(1.5, 1.5); w2.up(1.5, 1.5);
  assert.deepEqual(w2.selection, ['A', 'B']);
});
test('U13 拖合并单元到第三方舞者上松手：合并确认（单元成员 × 第三方）', () => {
  const w = makeWorldU({ collapsed: true });
  w.down(1, 1); w.move(5, 5); w.up(5, 5); // 徽标（命中者 B）拖到 C(5,5)
  assert.deepEqual(w.log.commits, ['移动舞者']);
  assert.equal(w.log.menus.length, 1);
  assert.equal(w.log.menus[0].mode, 'merge');
  assert.deepEqual(w.log.menus[0].ids, ['B', 'C']);
});

// ---------- 右键上下文菜单（stage 层把 contextmenu 翻译为 machine.contextMenu，纯状态机可测） ----------
test('R1 右键命中合并单元（IDLE）：弹单元菜单与长按同款；非 IDLE 拒绝', () => {
  const w = makeWorld();
  assert.equal(w.machine.contextMenu({ px: 100, py: 100 }), true); // A(1,1)·B(1.4,1) 合并
  assert.equal(w.machine.state(), 'MENU');
  const m = w.log.menus[0];
  assert.equal(m.mode, 'unit');
  assert.deepEqual(m.ids, ['A', 'B']);
  assert.equal(m.style, 'capsule');
  assert.equal(w.machine.contextMenu({ px: 100, py: 100 }), false); // MENU 态不响应
  assert.equal(w.log.menus.length, 1);
});
test('R2 右键命中未合并舞者=删除菜单；空白/进行中手势/只读不弹', () => {
  const w = makeWorld();
  assert.equal(w.machine.contextMenu({ px: 800, py: 200 }), true); // E(8,2) 未合并
  assert.equal(w.log.menus[0].mode, 'context');
  assert.deepEqual(w.log.menus[0].ids, ['E']);
  w.machine.reset(); // 浮窗经按钮关闭 → gestureMenuClosed（stage 层调 reset 解锁）
  assert.equal(w.machine.contextMenu({ px: 10, py: 10 }), false); // 空白：不弹
  assert.equal(w.log.menus.length, 1);
  w.down(1, 1); // 进行中手势（PENDING）
  assert.equal(w.machine.contextMenu({ px: 100, py: 100 }), false); // 仅 IDLE 响应
  w.up(1, 1);
  const w2 = makeWorld();
  w2.readOnly = true;
  assert.equal(w2.machine.contextMenu({ px: 800, py: 200 }), false); // 只读（查看模式/播放中）
  assert.deepEqual(w2.log.menus, []);
});

// ---------- 「删除」数据一致性（单元菜单/上下文菜单复用 model.removeDancer，node 可测） ----------
test('R3 删除舞者数据一致性：positions 键===dancers、merges/groups 引用清理、单元=两人都删', () => {
  const mk = () => ({
    dancers: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    groups: [{ id: 'g1', name: '组1', memberIds: ['A', 'C'] }],
    formations: [
      { positions: { A: { x: 1, y: 1 }, B: { x: 1, y: 1 }, C: { x: 5, y: 5 } }, merges: [{ a: 'A', b: 'B', style: 'capsule' }] },
      { positions: { A: { x: 2, y: 2 }, B: { x: 2, y: 2 }, C: { x: 6, y: 6 } }, merges: [] },
    ],
  });
  const p = mk();
  removeDancer(p, 'A'); // 先删单元之一：悬挂引用必须清理
  assert.deepEqual(p.dancers.map(d => d.id), ['B', 'C']);
  assert.deepEqual(p.groups[0].memberIds, ['C'], '编组成员引用清理');
  for (const f of p.formations) {
    assert.deepEqual(Object.keys(f.positions).filter(k => !p.dancers.some(d => d.id === k)), []); // positions 键 ⊆ dancers
    assert.equal(f.merges, undefined); // merges 引用清理（清空后键移除，与 validateProject 清洗一致）
  }
  const p2 = mk();
  removeDancer(p2, 'A'); removeDancer(p2, 'B'); // 单元删除=两名成员都删
  assert.deepEqual(p2.dancers.map(d => d.id), ['C']);
  assert.deepEqual(Object.keys(p2.formations[0].positions), ['C']);
  assert.deepEqual(p2.groups[0].memberIds, ['C']);
});

// ---------- DEFECT-R-1 回归：浮窗载荷的合并/非合并标记与菜单构成来源一致 ----------
// main.js showUnitMenu 的按钮构成只按 payload.mode 分支（DOM 组成属 E2E 层，node 测不到）：
//   mode='unit' → 拆开+样式×3+删除；mode='context' → 仅删除。
// 因此状态机必须保证载荷标记与舞者合并状态一致：合并成员经任何浮窗入口
// （右键 / 触摸长按）一律发 unit 载荷（含两人 id），仅未合并舞者才发 context 载荷——
// 否则 context 载荷会落进单元按钮组（R-1 缺陷的根因面）。
test('R4 载荷标记与合并状态一致：合并成员两入口=unit 载荷（两人），未合并两入口=context 载荷（单人）', () => {
  for (const entry of ['ctx', 'lp']) {
    // 合并成员 A（makeWorld 里 A(1,1)·B(1.4,1) 已合并）
    const wu = makeWorld();
    if (entry === 'ctx') wu.machine.contextMenu({ px: 100, py: 100 });
    else { wu.down(1, 1, { touch: true }); wu.advance(500); }
    const mu = wu.log.menus[0];
    assert.equal(mu.mode, 'unit'); // 合并成员绝不发 context 载荷
    assert.deepEqual([...mu.ids].sort(), ['A', 'B']);
    assert.equal(wu.machine.state(), 'MENU');
    // 对照：未合并舞者 E → context 载荷、单人 id（仅「删除」菜单的构成来源）
    const ws = makeWorld();
    if (entry === 'ctx') ws.machine.contextMenu({ px: 800, py: 200 });
    else { ws.down(8, 2, { touch: true }); ws.advance(500); }
    const ms = ws.log.menus[0];
    assert.equal(ms.mode, 'context');
    assert.deepEqual(ms.ids, ['E']);
  }
});
