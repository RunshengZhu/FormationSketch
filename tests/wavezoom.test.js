// build-52-wavezoom 四项 node 单测。
//   F1 指针中心缩放：wheel handler ctrl/meta 分支静态断言（zoomAt 锚定，旧无锚定 zoom 退役）。
//   F2 颜色对应：tagColorAt/tagColorMap/stageDeepestLevelOf 纯函数（索引↔划分轨↔stage 同源同色）
//     + drawTags 最深层过滤行为（_tagGeom/命中只含所画层）+ main.js 索引面板单一出处静态断言。
//   F3 双模式对齐：交互矩阵注释块存在断言 + stage 补齐行为（tag 道空白/块轨空白单击=定位播放线、
//     拖旗磁吸小节线）。双指手势 stage 共用已在 tests/tlnav.test.js 改写断言，不重复。
//   F4 波形重构：columnMinMax（env 桶聚合/样本直读/跨路径同域/边界/stride 有界）、
//     visibleColumnRange 可视列范围、drawClipBox 接线静态断言。
// DOM 桩沿用 tests/tlnav.test.js 的 fakeEl 口径（无真实 canvas 2D）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicTimeline, visibleColumnRange } from '../js/timeline.js';
import { computeWaveEnvelope, columnMinMax, WAVE_COL_MAX_STRIDE } from '../js/audio-clips.js';
import { moveTag } from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcTl = readFileSync(join(root, 'js/timeline.js'), 'utf8');
const srcMain = readFileSync(join(root, 'js/main.js'), 'utf8');
const srcAc = readFileSync(join(root, 'js/audio-clips.js'), 'utf8');

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
const winHs = {};
window.addEventListener = (t, fn) => { (winHs[t] = winHs[t] || []).push(fn); }; // _up 挂 window：捕获以便派发

function fakeEl() {
  const hs = {};
  return {
    _hs: hs,
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 200 }),
    style: {},
  };
}
function makeProj() {
  return {
    audio: { bpm: 120, beatsPerBar: 4, firstBeatSec: 0, name: '', durationSec: 40 },
    timeline: {
      tags: [],
      tracks: [{ id: 'trk1', name: '配乐', gain: 1, muted: false }],
      audioClips: [],
    },
    // build-70 夹具迁移：旧 blocks [hold16+travel8] → clip [0,16)（travel=空隙，域尾语义随 clip.end）
    formations: [{ id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [], startBeat: 0, lenBeats: 16 }],
    media: { assets: [{ id: 'a1', name: '曲一', durationSec: 40 }] },
  };
}
// 标准 stage 实例：secPerPx 显式（pps=20，绕开自适应几何）；render 桩计数；rec 记录 hooks 调用
function makeTL(proj = makeProj(), { mode = 'stage' } = {}) {
  winHs.pointerup = [];
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  const rec = { muts: [], labels: [], seeks: [], commits: [], renders: 0 };
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => proj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      canEdit: () => true,
      onSelectFormation: () => {},
      mutate: fn => { fn(proj); rec.muts.push(null); },
      mutateQuiet: fn => { fn(proj); rec.muts.push(null); },
      mutateLabeled: (fn, label) => { fn(proj); rec.labels.push(label); },
      commitEdit: label => { rec.commits.push(label); },
      seekBeat: b => { rec.seeks.push(b); },
      toast: () => {},
      pauseIfPlaying: () => {},
      onTimeSelection: () => {},
    },
  });
  tl.mode = mode;
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; };
  return { tl, cv, sc, proj, rec };
}
// canvas 2D 桩：drawTags/drawSegLane 落笔所需的全部方法/属性
function fakeCtx() {
  return {
    save() {}, restore() {},
    fillRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {},
    fillText() {}, measureText: s => ({ width: String(s).length * 6 }),
    font: '', textBaseline: '', strokeStyle: '', fillStyle: '', lineWidth: 1,
  };
}

// ---------- F1 指针中心缩放（wheel handler 静态断言） ----------
test('F1 ctrl/meta+wheel=zoomAt 指针中心锚定（e.clientX），旧无锚定 this.zoom 分支退役', () => {
  const wheelStart = srcTl.indexOf("this.scroll.addEventListener('wheel'");
  const wheel = srcTl.slice(wheelStart, srcTl.indexOf('}, { passive: false });', wheelStart));
  const ctrlBranch = wheel.slice(wheel.indexOf('if (e.ctrlKey || e.metaKey)'), wheel.indexOf('else if (e.altKey)'));
  assert.match(ctrlBranch, /this\.zoomAt\(e\.deltaY < 0 \? 1\.2 : 1 \/ 1\.2, e\.clientX\)/,
    'ctrl/meta 分支必须以指针 clientX 为锚调用 zoomAt');
  assert.doesNotMatch(ctrlBranch, /this\.zoom\(e\.deltaY/, '旧无锚定 this.zoom 直调不得残留于 ctrl 分支');
  // alt 路径与双指捏合路径保持（回归锚）
  assert.match(wheel, /else if \(e\.altKey\)[\s\S]*?this\.zoomAt\(e\.deltaY < 0 \? 1\.2 : 1 \/ 1\.2, e\.clientX\)/);
  assert.match(srcTl, /this\.zoomAt\(g\.zoom, \(a\.x \+ b\.x\) \/ 2\)/, '双指捏合质心锚定保持');
  // 两模式共用同一 handler（无模式门控包住 wheel 分支）
  assert.doesNotMatch(wheel, /mode === 'music'/, 'wheel handler 必须模式无关（两模式同时获益）');
});

// ---------- F2 颜色对应 ----------
test('F2 tagColorAt：tag.color 0..3 覆盖 + 越界回绕 + 缺省层内序回退（与 SEG_COLORS 同板）', () => {
  const SEG = MusicTimeline.SEG_COLORS;
  assert.equal(SEG.length, 4);
  assert.equal(MusicTimeline.tagColorAt({ color: 0 }, 9), SEG[0]);
  assert.equal(MusicTimeline.tagColorAt({ color: 3 }, 0), SEG[3]);
  assert.equal(MusicTimeline.tagColorAt({ color: 5 }, 0), SEG[1], '越界正数回绕');
  assert.equal(MusicTimeline.tagColorAt({ color: -1 }, 0), SEG[3], '负数回绕');
  assert.equal(MusicTimeline.tagColorAt({}, 2), SEG[2], '缺省用层内序');
  assert.equal(MusicTimeline.tagColorAt(null, 1), SEG[1]);
});

test('F2 tagColorMap：层内拍序缺省 + tag.color 覆盖——索引面板与 drawSegLane 同源同色', () => {
  const p = makeProj();
  p.timeline.tags = [
    { id: 'a', name: 'A', beat: 8 },              // level 0，beat 序 k=2
    { id: 'b', name: 'B', beat: 0, color: 2 },    // level 0，k=0 但 color 覆盖
    { id: 'c', name: 'C', beat: 4 },              // level 0，k=1
    { id: 'e', name: 'E', beat: 12 },             // level 0，k=3
    { id: 'd', name: 'D', beat: 16, level: 1 },   // level 1，层内序 k=0（独立计数）
  ];
  const map = MusicTimeline.tagColorMap(p);
  const SEG = MusicTimeline.SEG_COLORS;
  assert.equal(map.get('b'), SEG[2], 'color 覆盖（层内序本为 0 → 证明非序决定）');
  assert.equal(map.get('c'), SEG[1], 'level0 拍序 1');
  assert.equal(map.get('a'), SEG[2], 'level0 拍序 2');
  assert.equal(map.get('e'), SEG[3], 'level0 拍序 3');
  assert.equal(map.get('d'), SEG[0], 'level1 层内序 0（非全局续号——旧 s.i/s.i=0 错位根因）');
  // 同层同拍稳定序（id 兜底，与 drawSegLane 排序逐值一致）
  p.timeline.tags = [{ id: 'x', name: 'X', beat: 4 }, { id: 'w', name: 'W', beat: 4 }];
  const m2 = MusicTimeline.tagColorMap(p);
  assert.equal(m2.get('w'), SEG[0]);
  assert.equal(m2.get('x'), SEG[1]);
});

test('F2 stageDeepestLevelOf：最深层=现存最大 level，无 tag=0', () => {
  assert.equal(MusicTimeline.stageDeepestLevelOf([]), 0);
  assert.equal(MusicTimeline.stageDeepestLevelOf(null), 0);
  assert.equal(MusicTimeline.stageDeepestLevelOf([{ beat: 0 }, { beat: 4, level: 1 }, { beat: 8 }]), 1);
  assert.equal(MusicTimeline.stageDeepestLevelOf([{ beat: 0, level: 2 }, { beat: 4, level: 1 }]), 2);
});

test('F2 drawTags（stage 18px）：只画最深层（_tagGeom/命中同集合）、更浅层不画；几何常量不变', () => {
  const p = makeProj();
  p.timeline.tags = [
    { id: 's1', name: '浅A', beat: 4 },            // level 0
    { id: 's2', name: '浅B', beat: 12 },           // level 0
    { id: 'd1', name: '深A', beat: 6, level: 1 },  // level 1（最深层）
  ];
  const { tl } = makeTL(p);
  tl.W = 800;
  tl.drawTags(fakeCtx(), p);
  assert.ok(tl._tagGeom.has('d1'), '最深层 tag 落笔（几何登记）');
  assert.ok(!tl._tagGeom.has('s1') && !tl._tagGeom.has('s2'), '更浅层不画（不可命中）');
  assert.equal(tl.stageLevelOf(p), 1);
  // 命中与呈示同集合：浅层旗点 x 不可命中，深层旗点可命中
  const xShallow = 4 * 0.5 * 20; // beat4 → 40px
  assert.equal(tl.tagAt(xShallow, tl.stageLevelOf(p)), null, '浅层旗点不命中（未呈示）');
  assert.equal(tl.tagAt(6 * 0.5 * 20, tl.stageLevelOf(p))?.tag.id, 'd1', '深层旗点命中');
  // 全部为浅层 tag 时（无高层）→ 行为退化为旧口径（level 0 全画）
  p.timeline.tags = [{ id: 's1', name: '浅A', beat: 4 }];
  tl.drawTags(fakeCtx(), p);
  assert.ok(tl._tagGeom.has('s1'));
  // 18px 几何不变（E-12）：TAG_LANE_H 常量与 drawTags 落笔行仍用 18
  assert.match(srcTl, /export const TAG_LANE_H = 18;/);
});

test('F2 颜色单一出处静态断言：drawSegLane/drawTags 走 tagColorAt，索引面板走 tagColorMap', () => {
  const segLane = srcTl.slice(srcTl.indexOf('  drawSegLane(ctx, p) {'));
  assert.match(segLane, /const color = MusicTimeline\.tagColorAt\(tag, k\);/,
    'drawSegLane（music 划分轨）单一出处');
  const drawTags = srcTl.slice(srcTl.indexOf('  drawTags(ctx, p) {'), srcTl.indexOf('  // ---------- 节奏划分轨'));
  assert.match(drawTags, /const color = MusicTimeline\.tagColorAt\(tag, k\); \/\/ F2：对应色/,
    'drawTags（stage tag 道）单一出处');
  assert.match(srcMain, /const colorMap = MusicTimeline\.tagColorMap\(p\);/, '索引面板单一出处');
  assert.match(srcMain, /const color = colorMap\.get\(s\.tag\.id\) \|\| MusicTimeline\.tagColorAt\(s\.tag, s\.i\);/);
  assert.doesNotMatch(srcMain, /const COLORS = MusicTimeline\.SEG_COLORS;\s*\n\s*rows\.forEach/, '旧 s.i 内联色序退役');
  // stage 呈示色用 hexA(color,…) 对应色带（旧固定蓝 rgba(56,189,248,.10) 退役）
  assert.match(drawTags, /ctx\.fillStyle = hexA\(color, \.10\);/, '区域带=对应色');
  assert.match(drawTags, /ctx\.fillStyle = hovered \? '#7dd3fc' : color;/, '旗面对应色');
  assert.doesNotMatch(drawTags, /rgba\(56,189,248,\.10\)/, '旧固定蓝区域带退役');
});

// ---------- F3 双模式对齐 ----------
test('F3 交互矩阵注释块存在（timeline.js 头部，含对齐项与 music 专属白名单）', () => {
  assert.match(srcTl, /build-52-wavezoom F3：双模式时间轴交互矩阵/);
  for (const item of ['缩放', '横滚', '空白单击', '尺规 scrub', 'Shift+拖拽', '磁吸开关', 'music 专属']) {
    assert.ok(srcTl.includes(item), `矩阵须含条目：${item}`);
  }
});

test('F3 stage tag 道空白单击=定位播放线（可拖 scrub，与 music 划分轨空白同语义）', () => {
  const { tl, cv, rec } = makeTL(); // 无 tag → 全道空白
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 31, pointerId: 1, pointerType: 'mouse' });
  assert.equal(tl.drag && tl.drag.kind, 'scrub', '空白按下=scrub 拖拽态');
  assert.equal(rec.seeks.length, 1, '单击定位播放线');
  assert.equal(rec.seeks[0], 10, 'x=100px/pps20 → 5s → spb0.5 → beat 10（seekBeat 拍域既有口径）');
  // 旗点/× 语义不回退：有旗时命中旗点=拖拽预备（非 scrub）
  const p = tl.hooks.getProject();
  p.timeline.tags = [{ id: 't1', name: 'A', beat: 6 }];
  cv._hs.pointerdown[0]({ clientX: 60, clientY: 31, pointerId: 2, pointerType: 'mouse' });
  assert.equal(tl.drag && tl.drag.kind, 'tag', '旗点命中仍是拖旗预备');
  assert.equal(rec.seeks.length, 1, '旗点按下不 seek（跳转在抬起未移动时）');
});

test('F3 stage 块轨空白/加轨条带单击=定位播放线（对齐 music 既有语义）', () => {
  const { tl, cv, rec } = makeTL();
  tl.blocksTop = 72; tl.blocksH = 36; // render 桩未跑，手工落几何（与 stage 布局同值）
  cv._hs.pointerdown[0]({ clientX: 500, clientY: 90, pointerId: 1, pointerType: 'mouse' }); // 块轨空白（beat 50 > clip 末 16）
  assert.equal(tl.drag && tl.drag.kind, 'scrub');
  assert.equal(rec.seeks.length, 1, '块轨空白定位');
  tl.drag = null;
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 69, pointerId: 2, pointerType: 'mouse' }); // 音轨(40..66)与块轨(72..)之间条带
  assert.equal(tl.drag && tl.drag.kind, 'scrub');
  assert.equal(rec.seeks.length, 2, '加轨条带定位');
  // 块身单击=选队形 + 播放线对齐 clip 开头（build-70 M2 需求 5：单击对齐——
  // 旧「块身单击不定位」白名单随选中+定位一体化语义退役）
  let sel = 0;
  tl.hooks.onSelectFormation = () => { sel++; };
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 90, pointerId: 3, pointerType: 'mouse' });
  assert.equal(sel, 1, '块身单击选队形');
  assert.equal(rec.seeks.length, 3, '块身单击定位到 clip 开头（需求 5）');
  assert.equal(rec.seeks.at(-1), 0, '对齐目标=clip.start（clip0 从 beat 0 起）');
  assert.equal(tl.drag && tl.drag.kind, 'fcMove', '块身按下进入拖移待定（可拖整段平移）');
});

test('F3 stage 拖旗磁吸小节线（snapTagBeatToBar 同机制；磁吸关不吸）', () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: 'A', beat: 3.9 }];
  const { tl, cv, rec } = makeTL(p);
  tl.snapOn = true;
  cv._hs.pointerdown[0]({ clientX: 39, clientY: 31, pointerId: 1, pointerType: 'mouse' }); // 旗点 x=39
  assert.equal(tl.drag && tl.drag.kind, 'tag');
  // 拖到 x=42（beat 4.2，容差 8px/(20pps×0.5spb)=0.8 拍 → 吸到 4 小节线）
  tl._move({ clientX: 42, clientY: 31, pointerId: 1 });
  winHs.pointerup[0]({ pointerId: 1 });
  assert.equal(p.timeline.tags[0].beat, 4, '磁吸开：就近吸小节线（4）');
  assert.deepEqual(rec.commits, ['移动标记'], '恰一条历史（旧口径不变）');
  // 磁吸关：原值落位
  const p2 = makeProj();
  p2.timeline.tags = [{ id: 't1', name: 'A', beat: 3.9 }];
  const t2 = makeTL(p2);
  t2.tl.snapOn = false;
  t2.cv._hs.pointerdown[0]({ clientX: 39, clientY: 31, pointerId: 1, pointerType: 'mouse' });
  t2.tl._move({ clientX: 42, clientY: 31, pointerId: 1 });
  winHs.pointerup = []; winHs.pointerup.push(() => t2.tl._up({ pointerId: 1 }));
  winHs.pointerup[0]({ pointerId: 1 });
  assert.equal(p2.timeline.tags[0].beat, 4.2, '磁吸关：不吸（round2 落位）');
});

// ---------- F4 波形重构 ----------
function mkData(fn, n, sr) {
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(i, i / sr);
  return d;
}

test('F4 computeWaveEnvelope 返回 peak（样本直读路径同域归一化基准）', () => {
  const sr = 8000;
  const data = mkData(i => (i % 1000 === 0 ? 0.8 : (i % 512 === 3 ? -0.4 : 0.1)), 8000, sr);
  const env = computeWaveEnvelope({ getChannelData: () => data, sampleRate: sr, duration: 1 }, 512);
  assert.ok(env && env.peak > 0.79 && env.peak <= 0.81, 'peak=全资产最大|幅|（归一化前）');
  assert.equal(env.min[0], -0.5, '桶内 min 已按 peak 归一化（-0.4/0.8）');
});

test('F4 columnMinMax env 桶聚合：min of min / max of max，跨桶列=覆盖桶聚合', () => {
  const sr = 8000, bucket = 512; // 桶时长 0.064s
  // 桶0: [-0.5, 1]（归一化后），桶1: [-1, 0.25]
  const data = mkData(i => {
    if (i < 512) return i === 3 ? -0.4 : (i === 7 ? 0.8 : 0);
    return i === 515 ? -0.8 : (i === 519 ? 0.2 : 0);
  }, 1024, sr);
  const env = computeWaveEnvelope({ getChannelData: () => data, sampleRate: sr, duration: 0.128 }, bucket);
  const peak = env.peak;
  const col = columnMinMax(env, null, 0, 0.128, sr); // 两桶
  assert.deepEqual(col.map(v => Math.round(v * 1e6) / 1e6),
    [Math.round(-0.8 / peak * 1e6) / 1e6, Math.round(0.8 / peak * 1e6) / 1e6],
    '跨桶列=min of min / max of max（-0.8 与 +0.8）');
  // 单桶列=env 桶原值
  assert.deepEqual(columnMinMax(env, null, 0.064, 0.128, sr).map(v => Math.round(v * 1e6) / 1e6),
    [env.min[1], env.max[1]]);
});

test('F4 columnMinMax 深放大样本直读：亚桶列真 min/max（同 peak 归一化），跨路径同域', () => {
  const sr = 8000, bucket = 512;
  const data = mkData(i => {
    if (i < 512) return i === 3 ? -0.4 : (i === 7 ? 0.8 : 0);
    return 0;
  }, 1024, sr);
  const env = computeWaveEnvelope({ getChannelData: () => data, sampleRate: sr, duration: 0.128 }, bucket);
  // 列 [0.001, 0.002) = 样本 [8,16) → 全 0
  assert.deepEqual(columnMinMax(env, data, 0.001, 0.002, sr), [0, 0]);
  // 列 [0, 0.001) = 样本 [0,8)：min=-0.4、max=0.8 → /peak 归一化（与 env 桶 0 同域同值）
  const col = columnMinMax(env, data, 0, 0.001, sr);
  assert.deepEqual(col.map(v => Math.round(v * 1e6) / 1e6), [env.min[0], env.max[0]],
    '亚桶列覆盖桶 0 峰值样本 → 与 env 聚合路径同值（幅度固定语义）');
  // 放大后仍逐列有细节：单样本列各自带真值（非单点漂移、非桶地板）
  const cNeg = columnMinMax(env, data, 3 / sr, 4 / sr, sr);
  const cPos = columnMinMax(env, data, 7 / sr, 8 / sr, sr);
  assert.ok(cNeg[0] < 0 && cNeg[0] === cNeg[1], '负峰单样本列=[v,v]');
  assert.ok(cPos[1] > 0.9 && cPos[0] === cPos[1], '正峰单样本列=[v,v]（0.8/peak≈1）');
  assert.ok(Math.abs(cNeg[0]) !== cPos[1], '两列幅度独立');
});

test('F4 columnMinMax 边界：t0<0 钳 0、t1>时长钳时长、零宽=[0,0]、双缺=null、env 缺=data 原值域', () => {
  const sr = 8000;
  const data = mkData(i => (i === 10 ? -0.5 : 0.25), 8000, sr);
  const env = computeWaveEnvelope({ getChannelData: () => data, sampleRate: sr, duration: 0.5 }, 512);
  // t0<0 钳 0 → 列 [0, 0.005)=样本 [0,40)（含样本 10）深放大数据路径 → [-1, 0.5]（/peak0.5）
  assert.deepEqual(columnMinMax(env, data, -1, 0.005, sr).map(v => Math.round(v * 1e6) / 1e6), [-1, 0.5], 't0<0 钳 0');
  // t1>时长钳时长：两列等价（同聚合域）
  assert.deepEqual(columnMinMax(env, data, 0.4, 9, sr), columnMinMax(env, data, 0.4, 0.5, sr), 't1>时长钳时长');
  assert.deepEqual(columnMinMax(env, data, 0.1, 0.1, sr), [0, 0], '零宽');
  assert.deepEqual(columnMinMax(env, data, 0.2, 0.1, sr), [0, 0], '逆序=零宽');
  assert.equal(columnMinMax(null, null, 0, 1, sr), null, 'env/data 双缺 → null（调用方平线兜底）');
  const raw = columnMinMax(null, data, 0, 0.002, sr);
  assert.deepEqual(raw, [-0.5, 0.25], 'env 缺 + data 在：原值域（无归一化基准）');
});

test('F4 columnMinMax stride 有界：env 聚合 ≤64 桶/列（stride=ceil）、样本路径 floor 公式有界扫描', () => {
  assert.equal(WAVE_COL_MAX_STRIDE, 64);
  const sr = 8000, bucket = 512; // 8000 桶 ≈ 512s
  const n = 4096000;
  const data = new Float32Array(n);
  data[123] = 0.5; data[4000000] = -0.9; // 两处峰
  const env = computeWaveEnvelope({ getChannelData: () => data, sampleRate: sr, duration: n / sr }, bucket);
  assert.equal(env.count, 8000);
  // 全域单列（8000 桶 → stride=ceil(8000/64)=125 → 恰 64 次聚合）：确定性 + stride 路径语义对拍
  const c1 = columnMinMax(env, null, 0, n / sr, sr);
  const c2 = columnMinMax(env, null, 0, n / sr, sr);
  assert.deepEqual(c1, c2, '同输入恒同输出（缩放间稳定的前提）');
  let mn = 1, mx = -1;
  for (let k = 0; k < 8000; k += 125) { if (env.min[k] < mn) mn = env.min[k]; if (env.max[k] > mx) mx = env.max[k]; }
  assert.deepEqual(c1, [mn, mx], 'env stride 路径=测试侧同公式对拍');
  // 样本路径 floor 公式（任务裁定 stride=max(1,floor(n/64))）：扫描次数 ≤ 64+步长内极限
  const nSmall = 1000;
  const strideData = Math.max(1, Math.floor(nSmall / WAVE_COL_MAX_STRIDE)); // 15
  assert.equal(strideData, 15);
  assert.ok(Math.ceil(nSmall / strideData) <= WAVE_COL_MAX_STRIDE + strideData - 1, 'floor 公式扫描量有界（≤64+15）');
});

test('F4 visibleColumnRange：可视列=[scrollLeft, scrollLeft+cw−headW+2]；无视口=全画布（旧口径兜底）', () => {
  assert.deepEqual(visibleColumnRange(200, 800, 148, 2000), [200, 854]);
  assert.deepEqual(visibleColumnRange(0, 800, 0, 2000), [0, 802], 'stage（headW=0）');
  assert.deepEqual(visibleColumnRange(5000, 800, 148, 2000), [5000, 2002], '右缘钳画布+2');
  assert.deepEqual(visibleColumnRange(0, 0, 0, 2000), [0, 2002], 'clientWidth 缺失（node 桩）=全画布');
  assert.deepEqual(visibleColumnRange(-50, 800, 148, 2000), [0, 654], '负 scroll 钳 0');
  assert.deepEqual(visibleColumnRange(10, 100, 148, 2000), [10, 13], 'head≥cw 时 span 钳 1');
  assert.deepEqual(visibleColumnRange(undefined, undefined, 0, undefined), [0, 2], '全缺省不抛');
});

test('F4 drawClipBox 接线静态断言：逐列 min/max+visibleColumnRange，旧 step 单点取样退役', () => {
  const box = srcTl.slice(srcTl.indexOf('  drawClipBox(ctx, p, c, top, lh, pps) {'));
  // build-91-varispeed：W 入参换世界宽 worldW（视口窗口渲染后画布≠世界宽，横滚列窗不因画布宽截断）
  assert.match(box, /visibleColumnRange\(this\.scroll\?\.scrollLeft, this\.scroll\?\.clientWidth, this\.headWidth\(\), this\.worldW \|\| this\.W\)/,
    '只遍历可视列（scrollLeft..+可视宽）');
  assert.match(box, /columnMinMax\(ch0, sA, sB\)/, 'build-88 需求 1：解码 AudioBuffer 逐像素列直读主路径');
  assert.match(box, /envColumnMinMax\(env, ch0, t0, t0 \+ 1 \/ pps, sr\)/, 'env 回退路径逐列真 min/max（buffer 未就绪时）');
  assert.match(box, /ctx\.fillRect\(x, mid - aT, 1, aT \+ aB\);/, '逐列 1px 竖条（真 min/max 非对称）');
  assert.match(box, /v = \.14 \* gfBase \* fadeEnvAt\(c, rel\)/, 'env 缺失 0.14 平线兜底保持');
  assert.doesNotMatch(box, /Math\.floor\(this\.W \/ 2400\)/, '旧全画布 step 循环退役');
  assert.match(srcTl, /import \{[\s\S]*?columnMinMax as envColumnMinMax,[\s\S]*?\} from '\.\/audio-clips\.js';/,
    'env 版列极值别名导入（样本域 columnMinMax 由 timeline 自导出）');
});
