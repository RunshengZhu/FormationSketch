// W3 收尾批 node 单测（整改方案 docs/workflow-rectification-plan.md §6 批次 W3）：
// 全部走纯函数出口（timeline.js musicLaneH 移动端上限参数 / rulerScaleKeyOf / resolveRulerScaleFor），
// 不依赖 DOM/浏览器。只新增文件，不改既有测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  musicLaneH, musicContentH, rulerScaleKeyOf, resolveRulerScaleFor,
  MUSIC_LANE_MAX_H, MUSIC_LANE_MAX_H_MOBILE, MUSIC_LANE_MIN_H,
  TL_RULER_H, SEG_LANE_H_MUSIC, MUSIC_LANE_GAP, TRACKS_OPS_H,
} from '../js/timeline.js';

// ---------- ① W3 §2.3 移动端 laneH 64（上限参数；桌面缺省不变） ----------
test('G3W1 移动端 laneH 上限 64：375×724 容器任意轨数均=64（触控友好，§2.3「laneH 64」）', () => {
  // 移动音乐模式容器实测 ≈ 502（724 − 顶栏 48 − 工具条 40 − preview 条 88 − playbar 44 − 边框）
  for (const c of [502, 727]) {
    for (const n of [1, 2, 3, 4]) {
      assert.equal(musicLaneH(c, n, TRACKS_OPS_H, MUSIC_LANE_MAX_H_MOBILE), 64,
        `容器 ${c} / ${n} 轨 → 64`);
    }
  }
  // 容器过矮（raw < 64）：上限不生效、仍走容器推导但 floor 56 托底
  assert.equal(musicLaneH(340, 4, TRACKS_OPS_H, MUSIC_LANE_MAX_H_MOBILE), 57, '(340−22−28−26−3×12)/4=57');
});
test('G3W2 桌面缺省上限不变：musicLaneH 四参缺省仍 120 封顶（W1 基线零回退）', () => {
  assert.equal(musicLaneH(727, 1), 120, '桌面 1 轨=120（IR-W1-1 口径）');
  assert.equal(musicLaneH(727, 2), 120);
  assert.equal(musicLaneH(502, 4), Math.max(MUSIC_LANE_MIN_H, Math.min(MUSIC_LANE_MAX_H, (502 - TL_RULER_H - SEG_LANE_H_MUSIC - TRACKS_OPS_H - 3 * MUSIC_LANE_GAP) / 4)),
    '桌面同容器 4 轨=容器推导值（98），不迁就移动上限');
  assert.equal(musicLaneH(NaN, 2, TRACKS_OPS_H, MUSIC_LANE_MAX_H_MOBILE), 64, '非法容器 → 上限兜底（随 maxH）');
  assert.equal(musicLaneH(502, 2, TRACKS_OPS_H, 30), MUSIC_LANE_MIN_H, 'maxH 低于下限 → 钳到下限 56（不产生 <56 的 lane）');
});
test('G3W3 移动 4 轨内容高自洽：64px lane 内容 368；容器不足时纵滚（overflow-y:auto 恒开）', () => {
  const content = musicContentH(MUSIC_LANE_MAX_H_MOBILE, 4);
  assert.equal(content, TL_RULER_H + SEG_LANE_H_MUSIC + 4 * 64 + 3 * MUSIC_LANE_GAP + TRACKS_OPS_H, '22+28+4×64+3×12+26=368');
  assert.ok(content > musicContentH(MUSIC_LANE_MAX_H_MOBILE, 2), '轨多内容更高 → 超出容器即 #tl-body 纵滚');
});

// ---------- ② W3 §4.3① 尺规刻度按模式分键 ----------
const ls = (init = {}) => {
  const m = new Map(Object.entries(init));
  const calls = { set: [], del: [] };
  return {
    calls,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { calls.set.push([k, v]); m.set(k, String(v)); },
    removeItem: k => { calls.del.push(k); m.delete(k); },
  };
};
test('G3W4 键名映射：stage/music 各自键名（wuzhen:rulerScale.stage / .music）', () => {
  assert.equal(rulerScaleKeyOf('stage'), 'wuzhen:rulerScale.stage');
  assert.equal(rulerScaleKeyOf('music'), 'wuzhen:rulerScale.music');
  assert.equal(rulerScaleKeyOf('anything-else'), 'wuzhen:rulerScale.stage', '非 music 一律按 stage 键（缺省分支）');
});
test('G3W5 缺省均=拍：无任何记忆时两模式都读出 beat', () => {
  assert.equal(resolveRulerScaleFor(ls(), 'stage'), 'beat');
  assert.equal(resolveRulerScaleFor(ls(), 'music'), 'beat');
  assert.equal(resolveRulerScaleFor(null, 'music'), 'beat', 'storage 不可用 → beat 兜底');
});
test('G3W6 分键互不串：stage=sec、music=beat 各读各键；一侧改写不影响另一侧', () => {
  const store = ls({ 'wuzhen:rulerScale.stage': 'sec', 'wuzhen:rulerScale.music': 'beat' });
  assert.equal(resolveRulerScaleFor(store, 'stage'), 'sec');
  assert.equal(resolveRulerScaleFor(store, 'music'), 'beat');
  // 模拟 music 侧改写后，stage 侧读值不变
  store.setItem('wuzhen:rulerScale.music', 'sec');
  assert.equal(resolveRulerScaleFor(store, 'stage'), 'sec');
  assert.equal(resolveRulerScaleFor(store, 'music'), 'sec');
  store.setItem('wuzhen:rulerScale.stage', 'beat');
  assert.equal(resolveRulerScaleFor(store, 'stage'), 'beat');
  assert.equal(resolveRulerScaleFor(store, 'music'), 'sec');
});
test('G3W7 旧单键一次性播种：legacy=sec → 播种当前模式键并退役旧键；另一模式仍缺省拍', () => {
  const a = ls({ 'wuzhen:rulerScale': 'sec' });
  assert.equal(resolveRulerScaleFor(a, 'music'), 'sec', '旧用户首次进音乐模式 → sec');
  assert.deepEqual(a.calls.set, [['wuzhen:rulerScale.music', 'sec']], '播种 music 键');
  assert.deepEqual(a.calls.del, ['wuzhen:rulerScale'], '旧键读后即退役');
  assert.equal(resolveRulerScaleFor(a, 'stage'), 'beat', 'stage 侧不被旧键牵连（缺省拍）');
  // 再次读取走新键，不再触发迁移
  a.calls.set.length = 0; a.calls.del.length = 0;
  assert.equal(resolveRulerScaleFor(a, 'music'), 'sec');
  assert.equal(a.calls.set.length, 0);
});
test('G3W8 旧单键=beat 同样退役（值与缺省同，仍清旧键防复活）', () => {
  const a = ls({ 'wuzhen:rulerScale': 'beat' });
  assert.equal(resolveRulerScaleFor(a, 'stage'), 'beat');
  assert.deepEqual(a.calls.set, [['wuzhen:rulerScale.stage', 'beat']]);
  assert.deepEqual(a.calls.del, ['wuzhen:rulerScale']);
});
test('G3W9 非法值忽略：mode 键/旧键垃圾值 → beat；不写不删', () => {
  const a = ls({ 'wuzhen:rulerScale.stage': 'yz', 'wuzhen:rulerScale': 'sec!' });
  assert.equal(resolveRulerScaleFor(a, 'stage'), 'beat');
  assert.equal(a.calls.set.length, 0);
  assert.equal(a.calls.del.length, 0);
});
