// round23 UX 优化回归：多选上下文菜单载荷 / labelMode 显示字段 / BPM-秒换算与数拍入场。
// 全部 node 可测（纯逻辑 + 桩 ctx），不依赖 DOM/浏览器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureMachine } from '../js/gesture.js';
import {
  createProject, validateProject, removeDancer, addMerge, computeSegments,
  spb, beatToSec, secToBeat, totalDurationSec, dancerLabel, truncateLabel, labelModeOf,
} from '../js/model.js';
import { drawScene } from '../js/stage.js';
import { Player } from '../js/player.js';

// ---------- 假世界（同 tests/gesture.test.js 口径的最小版） ----------
// 布局：A(1,1)·B(1.4,1) 已合并（capsule）；C(5,5)、D(5.4,5) 相邻未合并；E(8,2) 孤立
function makeWorld() {
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
    readOnly: false,
    log: { selects: [], menus: [] },
  };
  const host = {
    readOnly: () => w.readOnly,
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
    fmtIndex: () => 2,
    now: () => w.t,
    stage: () => ({ widthM: 10, depthM: 6, snap: false, gridM: 0.5, backstageM: 1 }),
    select: (ids) => { w.log.selects.push([...ids]); w.selection = [...ids]; },
    applyPositions: () => {},
    rollback: () => {},
    commit: () => {},
    showMenu: p => w.log.menus.push(p),
    hideMenu: () => {},
    box: () => {},
    panBy: () => {},
    zoomAt: () => {},
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
  return w;
}

// ---------- 需求 1：多选右键/长按 → 整 selection 菜单载荷 ----------
test('M1 右键命中多选中成员（未合并多人）：multi 载荷=整 selection（单元原子展开、保持顺序）', () => {
  const w = makeWorld();
  w.selection = ['E', 'C', 'D'];
  assert.equal(w.machine.contextMenu({ px: 540, py: 500 }), true); // 命中 D
  const m = w.log.menus[0];
  assert.equal(m.mode, 'multi');
  assert.deepEqual(m.ids, ['E', 'C', 'D']); // 选择顺序，不重排
  assert.deepEqual(m.at, w.positions.D);    // 锚点=命中者
  assert.equal(m.formationIndex, 2);
  assert.equal(w.machine.state(), 'MENU');
});

test('M2 恰好选中一个合并单元：右键/长按仍是 unit 载荷（样式按钮唯一出现处）', () => {
  const w = makeWorld();
  w.selection = ['A', 'B'];
  assert.equal(w.machine.contextMenu({ px: 100, py: 100 }), true);
  const m = w.log.menus[0];
  assert.equal(m.mode, 'unit');
  assert.deepEqual(m.ids, ['A', 'B']);
  assert.equal(m.style, 'capsule');
});

test('M3 混合多选（合并单元+单人）：multi 载荷 N=展开后人数；长按同款', () => {
  const w = makeWorld();
  w.selection = ['A', 'B', 'C']; // A|B 合并 + C 单人 → 展开仍 3 人
  assert.equal(w.machine.contextMenu({ px: 500, py: 500 }), true); // 命中 C
  const m = w.log.menus[0];
  assert.equal(m.mode, 'multi');
  assert.equal(m.ids.length, 3);
  assert.deepEqual(m.ids, ['A', 'B', 'C']);
  // 长按路径：多选中长按 D 同样发 multi 载荷
  const w2 = makeWorld();
  w2.selection = ['C', 'D', 'E'];
  w2.machine.down({ pointerId: 1, px: 540, py: 500, touch: true });
  w2.advance(500); // lpMs
  const m2 = w2.log.menus[0];
  assert.equal(m2.mode, 'multi');
  assert.deepEqual(m2.ids, ['C', 'D', 'E']);
});

test('M4 命中者不在 selection：先（单元原子）选中它再出菜单——单人=context、合并=unit', () => {
  const w = makeWorld();
  w.selection = ['E'];
  assert.equal(w.machine.contextMenu({ px: 500, py: 500 }), true); // 右键 C（不在选择中）
  assert.deepEqual(w.log.selects, [['C']]);       // 先选中
  assert.deepEqual(w.selection, ['C']);
  assert.equal(w.log.menus[0].mode, 'context');   // 单人 → 仅删除菜单
  assert.deepEqual(w.log.menus[0].ids, ['C']);
  const w2 = makeWorld();
  w2.selection = ['E'];
  assert.equal(w2.machine.contextMenu({ px: 100, py: 100 }), true); // 右键合并成员 A
  assert.deepEqual(w2.log.selects, [['A', 'B']]); // 整单元入选
  assert.equal(w2.log.menus[0].mode, 'unit');
  assert.deepEqual(w2.log.menus[0].ids, ['A', 'B']);
});

test('M5 展开规则：选择含整单元时 multi 的 N=展开后人数（非原始选择数）', () => {
  const w = makeWorld();
  w.selection = ['A', 'C']; // A 的单元展开为 A+B → N=3
  assert.equal(w.machine.contextMenu({ px: 500, py: 500 }), true);
  const m = w.log.menus[0];
  assert.equal(m.mode, 'multi');
  assert.deepEqual(m.ids, ['A', 'B', 'C']);
});

test('M6 只读/空白右键不弹 multi 菜单（编辑锁语义不变）', () => {
  const w = makeWorld();
  w.selection = ['C', 'D'];
  w.readOnly = true;
  assert.equal(w.machine.contextMenu({ px: 540, py: 500 }), false);
  assert.deepEqual(w.log.menus, []);
  w.readOnly = false;
  assert.equal(w.machine.contextMenu({ px: 9999, py: 9999 }), false); // 空白
  assert.deepEqual(w.log.menus, []);
});

// ---------- 需求 1 佐证：多选删除的模型层一致性（菜单「删除所选（N 人）」走 removeDancer） ----------
test('M7 批量删除（removeDancer×N）：positions 键===dancers、merges/groups 引用清理', () => {
  const p = createProject({ pairs: 2 });
  const [a, b, c] = p.dancers.map(d => d.id);
  addMerge(p.formations[0], a, b, 'capsule');
  for (const id of [a, c]) removeDancer(p, id); // 删单元之一 + 单人
  const rest = p.dancers.map(d => d.id).sort();
  assert.deepEqual(p.groups.flatMap(g => g.memberIds).sort(), rest, '编组成员引用清理');
  for (const f of p.formations) {
    assert.deepEqual(Object.keys(f.positions).sort(), rest);
    assert.equal(f.merges, undefined); // 被删单元的 merge 记录清理（含清空后键移除）
  }
});

// ---------- 需求 2：labelMode 显示字段（项目级设置 + 标签数据 + 绘制文本） ----------
test('L1 createProject/validateProject 的 labelMode 默认与清洗（旧项目零迁移）', () => {
  assert.equal(labelModeOf(createProject({ pairs: 1 })), 'no');
  assert.equal(createProject({ pairs: 1 }).settings.labelMode, 'no');
  const legacy = { version: 1, dancers: [], formations: [{ id: 'f', positions: {} }] }; // 无 settings
  const v = validateProject(legacy).project;
  assert.equal(v.settings.labelMode, 'no');
  const bad = validateProject({ version: 1, settings: { labelMode: 'bogus' }, dancers: [], formations: [{ id: 'f', positions: {} }] }).project;
  assert.equal(bad.settings.labelMode, 'no');
  const good = validateProject({ version: 1, settings: { labelMode: 'name' }, dancers: [], formations: [{ id: 'f', positions: {} }] }).project;
  assert.equal(good.settings.labelMode, 'name');
});

test('L2 dancerLabel：no=序号(1..N) / short=简称 / name=姓名，缺失回退简称→序号；长名截断', () => {
  const p = createProject({ pairs: 1 });
  p.dancers[0].name = '王小明';
  p.dancers[0].short = 'M1';
  assert.equal(dancerLabel(p, p.dancers[0], 7), '7');   // no：名册序号优先（忽略 short）
  p.settings.labelMode = 'short';
  assert.equal(dancerLabel(p, p.dancers[0], 7), 'M1');
  p.settings.labelMode = 'name';
  assert.equal(dancerLabel(p, p.dancers[0], 7), '王小明');
  p.dancers[0].name = '   ';                            // 姓名缺失 → 简称
  assert.equal(dancerLabel(p, p.dancers[0], 7), 'M1');
  p.dancers[0].short = '';                              // 简称也缺失 → 序号
  assert.equal(dancerLabel(p, p.dancers[0], 7), '7');
  assert.equal(truncateLabel('超长姓名测试用', 4), '超长姓…');
  assert.equal(truncateLabel('王五', 4), '王五');
  assert.equal(truncateLabel(12, 4), '12');
});

// 桩 2D 上下文：记录 fillText 文本（labelMode 绘制数据的观测面）
function stubCtx() {
  const texts = [];
  const noop = () => {};
  const handler = {
    get(target, prop) {
      if (prop === '__texts') return texts;
      if (!target[prop]) {
        target[prop] = prop === 'fillText'
          ? (...a) => texts.push(String(a[0]))
          : noop;
      }
      return target[prop];
    },
    set(target, prop, v) { target[prop] = v; return true; },
  };
  return new Proxy({}, handler);
}

test('L3 drawScene 标签跟随 labelMode：单人圆/capsule 双标/single 单标（node 桩 ctx）', () => {
  const p = createProject({ pairs: 2 });
  const f = p.formations[0];
  const [a, b] = p.dancers; // M1(1,1) F1(1,2) 相邻 → 合并演示
  addMerge(f, a.id, b.id, 'capsule');
  const pos = f.positions;
  const draw = () => {
    const ctx = stubCtx();
    drawScene(ctx, { x: 0, y: 0, w: 300, h: 400 }, p, pos, { minimal: true, pad: 4, theme: 'light', merges: f.merges || [] });
    return ctx.__texts;
  };
  // no（默认）：标签=名册序号
  p.settings.labelMode = 'no';
  assert.deepEqual(draw().slice().sort(), ['1', '2', '3', '4']);
  // short：编号=简称（本项目中一致），改一个简称以区分
  p.dancers[2].short = 'A';
  p.settings.labelMode = 'short';
  assert.ok(draw().includes('A'));
  // name：姓名截断呈示
  p.dancers[2].name = '特别长的舞台姓名';
  p.settings.labelMode = 'name';
  assert.ok(draw().includes('特别长…'));
  // single 样式：单标=序号较小的成员标签
  f.merges[0].style = 'single';
  p.settings.labelMode = 'no';
  const texts = draw();
  assert.equal(texts.filter(t => t === '1').length, 1); // 单元内取小序号，画一次
  assert.ok(texts.includes('3'), '未合并舞者仍按序号呈示');
});

// ---------- 需求 4 佐证：BPM-秒换算 / 数拍入场 / 持久字段 ----------
test('B1 spb/beatToSec/secToBeat 换算：BPM 修改联动时间轴秒长（含首拍偏移）', () => {
  const p = createProject({ pairs: 1 });
  createProject; // noop 防止 tree-shake 误判（保持 import 稳定）
  assert.equal(spb(p), 0.5); // 120 BPM
  p.audio.bpm = 60;
  assert.equal(spb(p), 1);
  assert.equal(beatToSec(p, 8), 8);          // 8 拍 = 8s
  p.audio.firstBeatSec = 1.5;
  assert.equal(beatToSec(p, 8), 9.5);
  assert.equal(secToBeat(p, 9.5), 8);
  const { totalBeats } = computeSegments(p);
  const d120 = totalDurationSec({ ...p, audio: { ...p.audio, bpm: 120, firstBeatSec: 0 } });
  const d60 = totalDurationSec({ ...p, audio: { ...p.audio, bpm: 60, firstBeatSec: 0 } });
  assert.equal(Math.round(d60 / d120), 2);   // BPM 减半 → 总秒长翻倍
});

test('B2 数拍入场：countInBeats 生效（负拍推进 → 入场毕转播放），节拍器开关为项目持久字段', () => {
  const p = createProject({ pairs: 1 });
  p.audio.bpm = 600; // spb=0.1s：真实定时器下 4 拍 ≈ 0.4s
  p.timeline.countInBeats = 4;
  const counts = [];
  const player = new Player({
    audio: { ready: false, click: () => {}, duration: 0 },
    getProject: () => p,
    onTick: () => {},
    onStateChange: () => {},
    onCountin: n => counts.push(n),
    onPreviewEnd: () => {},
  });
  player.play(0);
  assert.equal(player.countin, true);
  assert.equal(counts[0], 4, '启动即上报总入场拍');
  assert.equal(counts[1], 3, '首拍立即计数（剩 3）');
  assert.ok(player.beat < 0, '入场期间为负拍');
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(player.countin, false);
      assert.equal(player.playing, true);
      assert.ok(player.beat >= 0);
      player.stop();
      // 节拍器/入场拍随 validateProject 持久（旧项目补默认值）
      p.timeline.metronome = true;
      const v = validateProject(JSON.parse(JSON.stringify(p))).project;
      assert.equal(v.timeline.metronome, true);
      assert.equal(v.timeline.countInBeats, 4);
      resolve();
    }, 700);
  });
});

test('B3 validateProject：metronome/countInBeats 缺省补默认（旧项目零迁移）', () => {
  const v = validateProject({ version: 1, dancers: [], formations: [{ id: 'f', positions: {} }] }).project;
  assert.equal(v.timeline.metronome, false);
  assert.equal(v.timeline.countInBeats, 8);
});
