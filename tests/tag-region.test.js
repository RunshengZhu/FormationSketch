// build-49-tagregion：tag 区域块化（clip 同构交互）+ BPM 全面退场 —— node 单测。
// F1 模型：旧点 tag 迁移为区域块（无缝衔接/末尾 +16/零负宽兜底）、不变式强制（end>start、
//   同层不交叠钳制）、往返（已有 endBeat 零触碰，JSON 逐字节稳定）；
// F2 交互：区域几何钳制纯函数（tagRegionBounds/clampRegionMove/clampRegionEdge/moveTagRegion/
//   resizeTagRegion/placeTagRegion/fitTagRegionInLevel）+ 划分轨拖拽行为（体=移动/缘=调界/
//   单击=仅选中/跨层 hover 落位）；删除入口收敛（轨道无 ×、菜单唯二入口）；
// F3 索引行组成（名称优先/节奏标注/秒位区间/「…」菜单）+ 菜单一致性（轨道长按/右键与索引
//   「…」共用 segMenuItems 同一渲染函数）+ BPM 退场静态断言（工具条藏显、秒=唯一对齐规范）；
// F4 stage 红线抽测（TAG_LANE_H=18 不动、sectionSegmentsOf 仅 stage 旧路径保留）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicTimeline, TAG_LANE_H, SEG_LANE_H_MUSIC, TL_RULER_H } from '../js/timeline.js';
import {
  sanitizeTags, resolveTagRegions, tagEndBeatOf, tagRegionBounds,
  clampRegionMove, clampRegionEdge, moveTagRegion, resizeTagRegion, placeTagRegion,
  fitTagRegionInLevel, addTag, setTagLevel, tagLevelOf, tagRhythmLabel,
  TAG_REGION_DEFAULT_BEATS, TAG_REGION_MIN_BEATS,
} from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelSrc = readFileSync(join(root, 'js', 'model.js'), 'utf8');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');
const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8');
const cssSrc = readFileSync(join(root, 'css', 'style.css'), 'utf8');

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };

const blk = (hold, travel = 0) => ({ holdBeats: hold, travelBeats: travel });
const proj = (blocks, tags = [], extra = {}) => ({
  audio: { bpm: 120, firstBeatSec: 0, beatsPerBar: 4 },
  timeline: { blocks, tags, ...extra },
});

// ---------- F1：迁移（旧点 tag → 区域块） ----------
test('F1 迁移：旧点 tag 同层无缝衔接（endBeat=下一个同层 beat），末尾 +16（缺省 2 个 4/4 小节）', () => {
  const out = sanitizeTags([
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 16, name: 'B' }, { id: 'c', beat: 32, name: 'C' },
  ]);
  assert.deepEqual(out.map(t => [t.beat, t.endBeat]), [[0, 16], [16, 32], [32, 48]],
    '无缝衔接保留旧分段观感；末 tag endBeat=beat+16');
  // 分层迁移各层独立：L0 首尾相接、L1 末尾 +16
  const out2 = sanitizeTags([
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 16, name: 'B', level: 1 },
  ]);
  assert.deepEqual(out2.map(t => [t.beat, t.endBeat]), [[0, 16], [16, 32]],
    'b 与 a 不同层：a 为层内末尾 → +16；b 同');
});
test('F1 迁移：零/负宽兜底 endBeat=beat+1；越界钳到邻界（容忍相等=贴合）', () => {
  // 零宽：显式 endBeat ≤ beat → beat+1 兜底
  const out = sanitizeTags([{ id: 'a', beat: 8, name: 'A', endBeat: 8 }]);
  assert.equal(out[0].endBeat, 8 + TAG_REGION_MIN_BEATS, '零宽 → beat+1');
  const out2 = sanitizeTags([{ id: 'a', beat: 8, name: 'A', endBeat: 5 }]);
  assert.equal(out2[0].endBeat, 9, '负宽（endBeat<beat）→ beat+1');
  // 越界：a 的 endBeat 越过同层右邻 b.beat → 钳到邻界（贴合）
  const out3 = sanitizeTags([
    { id: 'a', beat: 0, name: 'A', endBeat: 100 }, { id: 'b', beat: 8, name: 'B', endBeat: 24 },
  ]);
  assert.deepEqual(out3.map(t => [t.beat, t.endBeat]), [[0, 8], [8, 24]], '越界钳到邻界');
  // 贴合（相等）合法不触碰
  const out4 = sanitizeTags([
    { id: 'a', beat: 0, name: 'A', endBeat: 8 }, { id: 'b', beat: 8, name: 'B', endBeat: 24 },
  ]);
  assert.deepEqual(out4.map(t => [t.beat, t.endBeat]), [[0, 8], [8, 24]], '贴合（end==next.beat）零触碰');
});

// ---------- F1：往返（已有 endBeat 零触碰） ----------
test('F1 往返：已有合法 endBeat 的区域数据 sanitize 幂等 + JSON 往返零触碰（不新增/不改键）', () => {
  const regions = [
    { id: 'a', beat: 0, name: 'A', endBeat: 8, color: 2 },
    { id: 'b', beat: 8, name: 'B', endBeat: 24, level: 1, sig: '3/4', bars: 2 },
    { id: 'c', beat: 32, name: 'C', endBeat: 40.5 },
  ];
  const once = sanitizeTags(regions);
  assert.deepEqual(once, regions, '合法区域逐字段保真（含小数 endBeat）');
  const twice = sanitizeTags(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once, '导出→导入自然往返不新增/不改键');
  assert.deepEqual(resolveTagRegions(JSON.parse(JSON.stringify(once))), once,
    'resolveTagRegions 对合法数据零触碰');
});

// ---------- F1：tagEndBeatOf 兜底读取 ----------
test('F1 tagEndBeatOf：缺 endBeat → beat+16（未迁移数据兜底）；有则透传', () => {
  assert.equal(tagEndBeatOf({ beat: 8 }), 8 + TAG_REGION_DEFAULT_BEATS);
  assert.equal(tagEndBeatOf({ beat: 8, endBeat: 20 }), 20);
  assert.equal(tagEndBeatOf(null), TAG_REGION_DEFAULT_BEATS);
});

// ---------- F2：交互纯函数（钳制口径，node 可测） ----------
test('F2 tagRegionBounds：同层邻界 lo=左邻 endBeat、hi=右邻 beat；level 给定按目标层；自身不参与', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 'c', beat: 32, name: 'C', endBeat: 48, level: 1 }, // 右邻在另一层，不参与 L0 界
    { id: 't', beat: 20, name: 'T', endBeat: 30 },           // 被查区域自身
  ]);
  const b = tagRegionBounds(p, 't');
  assert.deepEqual({ lo: b.lo, hi: b.hi, width: b.width }, { lo: 16, hi: Infinity, width: 10 });
  const b2 = tagRegionBounds(p, 'a', 1); // 跨层目标：按 level 1 解析邻界（c 同层）
  assert.equal(b2.lo, 0, 'L1 无左邻 → lo=0');
  assert.equal(b2.hi, 32, 'L1 右邻 c.beat=32');
  assert.equal(b2.width, 16, 'width=自身区域宽');
});
test('F2 clampRegionMove：钳 [lo, hi-width]；无空间（邻区已贴合）→ null；两位小数舍入', () => {
  assert.equal(clampRegionMove(12, 8, 0, 32), 12);
  assert.equal(clampRegionMove(-4, 8, 0, 32), 0, '左钳 0/lo');
  assert.equal(clampRegionMove(40, 8, 0, 32), 24, '右钳 hi-width');
  assert.equal(clampRegionMove(10.005, 8, 0, 32), 10.01, '两位小数舍入');
  assert.equal(clampRegionMove(10, 8, 4, 10), null, 'hi-width<lo（无空间）→ null');
  assert.equal(clampRegionMove('x', 8, 0, 32), null, '非有限 → null');
  assert.equal(clampRegionMove(5, 0, 0, 32), 5, 'width 非法回最小宽');
});
test('F2 clampRegionEdge：L ∈ [lo, end-最小宽]；R ∈ [beat+最小宽, hi]', () => {
  assert.equal(clampRegionEdge('L', 5, 10, 20, 0, Infinity), 5);
  assert.equal(clampRegionEdge('L', 25, 10, 20, 0, Infinity), 19, 'L 不越过尾缘（最小宽）');
  assert.equal(clampRegionEdge('L', -3, 10, 20, 0, Infinity), 0, 'L 左钳 lo/0');
  assert.equal(clampRegionEdge('R', 36, 10, 20, 0, 32), 32, 'R 右钳 hi');
  assert.equal(clampRegionEdge('R', 10.5, 10, 20, 0, 32), 11, 'R 不越过首缘（最小宽）');
  assert.equal(clampRegionEdge('R', 99, 10, 20, 0, Infinity), 99);
  assert.equal(clampRegionEdge('R', 'x', 10, 20, 0, 32), null, '非有限 → null');
});
test('F2 moveTagRegion/resizeTagRegion：整块平移保宽；缘调界受邻界+最小宽钳制；未知 id no-op', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 't', beat: 24, name: 'T', endBeat: 40 },
  ]);
  assert.equal(moveTagRegion(p, 't', 20), true, '左移到 [20,36)（lo=16 内）');
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [20, 36]);
  assert.equal(moveTagRegion(p, 't', 4), true, '左越左邻 → 钳 lo=16');
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [16, 32], '保宽平移');
  assert.equal(resizeTagRegion(p, 't', 'L', 4), true, 'L 缘越左邻 → 钳 lo');
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [16, 32]);
  assert.equal(resizeTagRegion(p, 't', 'R', 999), true, 'R 缘自由（无右邻）');
  assert.equal(p.timeline.tags[1].endBeat, 999);
  assert.equal(resizeTagRegion(p, 't', 'R', 16.4), true, 'R 缘 < beat+最小宽 → 钳 beat+1');
  assert.equal(p.timeline.tags[1].endBeat, 17);
  assert.equal(moveTagRegion(p, 'nope', 8), false, '未知 id no-op');
});
test('F2 placeTagRegion：跨层落位=level 变更+钳制后平移；目标层无空间 → null 不动；level 0 删键', () => {
  // 目标 L1 空隙不足（x=[20,36) 与 y=[44,60) 间仅 8 < 宽 12）→ null 原位不动
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 'x', beat: 20, name: 'X', endBeat: 36, level: 1 },
    { id: 'y', beat: 44, name: 'Y', endBeat: 60, level: 1 },
    { id: 't', beat: 24, name: 'T', endBeat: 36 }, // L0，宽 12
  ]);
  assert.equal(placeTagRegion(p, 't', 1, 22), null, '目标 L1 无 12 拍空隙 → 不动');
  assert.equal(p.timeline.tags[3].beat, 24, '原位不变');
  assert.equal(tagLevelOf(p.timeline.tags[3]), 0, 'level 未变');
  // 同层（L0）落位：a 之后全空 → [50,62)
  const t2 = placeTagRegion(p, 't', 0, 50);
  assert.notEqual(t2, null);
  assert.ok(!('level' in t2), '落 level 0 = 删键（缺省 shape）');
  assert.deepEqual([t2.beat, t2.endBeat], [50, 62]);
  // 目标层空隙恰容：x=[20,36) 与 y=[52,68) 间 16 拍 ≥ 宽 12 → 落位贴合钳制
  const p2 = proj([blk(64)], [
    { id: 'x', beat: 20, name: 'X', endBeat: 36, level: 1 },
    { id: 'y', beat: 52, name: 'Y', endBeat: 68, level: 1 },
    { id: 't', beat: 24, name: 'T', endBeat: 36 },
  ]);
  const t3 = placeTagRegion(p2, 't', 1, 38);
  assert.equal(t3.level, 1, '落 L1 落键');
  assert.deepEqual([t3.beat, t3.endBeat], [38, 50], '钳 [lo=36, hi-width=40] 内取 38');
});
test('F2 fitTagRegionInLevel：升降级后区域钳回邻界——保宽优先平移，无空间贴 lo 缩宽（≥最小宽）', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 'x', beat: 20, name: 'X', endBeat: 28, level: 1 },
    { id: 't', beat: 24, name: 'T', endBeat: 36 }, // 与 L1 的 X 重叠
  ]);
  setTagLevel(p, 't', 1); // 升 L1（模型层只改 level）
  fitTagRegionInLevel(p, 't');
  assert.deepEqual([p.timeline.tags[2].beat, p.timeline.tags[2].endBeat], [28, 40],
    '与 X 重叠 → 保宽（12）平移贴 X 尾（右向自由）');
  // 无空间：L1 空隙 1 拍 < 宽 16 → 贴 lo 缩到最小宽
  const p2 = proj([blk(64)], [
    { id: 'x', beat: 0, name: 'X', endBeat: 30, level: 1 },
    { id: 'y', beat: 31, name: 'Y', endBeat: 40, level: 1 },
    { id: 't', beat: 0, name: 'T', endBeat: 16 },
  ]);
  setTagLevel(p2, 't', 1);
  fitTagRegionInLevel(p2, 't');
  const t2 = p2.timeline.tags[2];
  assert.deepEqual([t2.beat, t2.endBeat], [30, 31], 'hi-width<lo → 贴 lo、缩到最小宽');
});

// ---------- F2：划分轨拖拽行为（MusicTimeline 桩，与 tag-ui2 同口径） ----------
function fakeEl() {
  const hs = {};
  return {
    _hs: hs,
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    style: {},
  };
}
function makeTL(projObj, hooksExtra = {}) {
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  const rec = { commits: [], seeks: [] };
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => projObj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      onSelectFormation: () => {},
      mutate: fn => fn(projObj),
      mutateQuiet: fn => fn(projObj), // 拖拽高频预览直接落模型（与浏览器同口径）
      mutateLabeled: (fn, label) => { fn(projObj); rec.commits.push(label); },
      commitEdit: label => { rec.commits.push(label); },
      seekBeat: b => { rec.seeks.push(b); },
      onSegContextMenu: () => {},
      ...hooksExtra,
    },
  });
  tl.secPerPx = 0.05; // pps=20；0.5s/拍 → 1 拍=10px
  tl.rulerH = 22;
  tl.render = () => {};
  return { tl, cv, sc, rec };
}
const pd = (x, y, id = 1) => ({ pointerId: id, pointerType: 'mouse', clientX: x, clientY: y, button: 0 });
const pm = (x, y, id = 1) => ({ pointerId: id, pointerType: 'mouse', clientX: x, clientY: y });

test('F2 拖体=移动：保宽平移+小节线磁吸；恰一条「移动标记」历史', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 't', beat: 16, name: 'T', endBeat: 32 },
  ]);
  const { tl, cv, rec } = makeTL(p);
  tl.mode = 'music';
  cv._hs.pointerdown[0](pd(210, 30)); // x=210 → 拍 21 ∈ T[16,32)，距缘 >1px（缘=160/320±6）
  assert.equal(tl.drag?.kind, 'tagRegion');
  assert.equal(tl.drag?.part, 'body');
  assert.equal(tl.selSegId, 't', '按下即选中（build-49：单击=仅选中）');
  cv._hs.pointermove[0](pm(240, 30)); // 拍 24 → 磁吸小节线 24
  cv._hs.pointerup?.[0]?.(pm(240, 30));
  tl._up({ pointerId: 1 });
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [24, 40], '保宽平移 [16,32)→[24,40)');
  assert.deepEqual(rec.commits, ['移动标记'], '松手恰一条历史');
});

test('F2 拖体钳制：同层左邻贴合——移动范围被邻区端点夹住', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 't', beat: 16, name: 'T', endBeat: 32 },
  ]);
  const { tl, cv } = makeTL(p);
  tl.mode = 'music';
  cv._hs.pointerdown[0](pd(210, 30));
  cv._hs.pointermove[0](pm(60, 30)); // 拖到拍 6 → 钳 lo=a.endBeat=16
  tl._up({ pointerId: 1 });
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [16, 32], '贴左邻端点，不交叠');
});

test('F2 拖缘=调界：R 缘外拉（磁吸）+ L 缘内收；恰一条「调整标记范围」历史', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', endBeat: 16 },
    { id: 't', beat: 16, name: 'T', endBeat: 32 },
  ]);
  const { tl, cv, rec } = makeTL(p);
  tl.mode = 'music';
  cv._hs.pointerdown[0](pd(315, 30)); // R 缘 x=320（拍 32，区域终点排他 → 缘内 315 命中，|315-320|=5 ≤ tol 10）
  assert.equal(tl.drag?.part, 'edgeR', '缘命中（±10px trim 同规格）');
  cv._hs.pointermove[0](pm(360, 30)); // 拍 36（小节线，磁吸阈 0.8 拍内命中）
  tl._up({ pointerId: 1 });
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [16, 36], 'R 缘外拉到小节线');
  assert.deepEqual(rec.commits, ['调整标记范围']);
  // L 缘内收：钳 [lo, endBeat-最小宽]
  const m2 = makeTL(p);
  m2.tl.mode = 'music';
  m2.cv._hs.pointerdown[0](pd(160, 30)); // L 缘 x=160（拍 16，起点包含 → 缘上直接命中）
  m2.cv._hs.pointermove[0](pm(320, 30)); // 拖到拍 32 → 钳 endBeat-最小宽=35
  m2.tl._up({ pointerId: 2 });
  assert.deepEqual([p.timeline.tags[1].beat, p.timeline.tags[1].endBeat], [32, 36], 'L 缘钳 [lo, end-1]');
  assert.deepEqual(m2.rec.commits, ['调整标记范围']);
});

test('F2 跨层换轨：拖体垂直到 lane 1 → level 变更+目标层钳制落位；hover 高亮随手清', () => {
  const p = proj([blk(64)], [
    { id: 't', beat: 16, name: 'T', endBeat: 32 }, // L0
    { id: 'x', beat: 0, name: 'X', endBeat: 20, level: 1 }, // L1 左邻
  ]);
  p.timeline.tagLevelCount = 2;
  const { tl, cv } = makeTL(p);
  tl.mode = 'music';
  cv._hs.pointerdown[0](pd(210, 30)); // lane 0 体
  assert.equal(tl.drag?.level, 0);
  cv._hs.pointermove[0](pm(260, TL_RULER_H + SEG_LANE_H_MUSIC + 14)); // lane 1（y=64），拍 26
  assert.equal(tl.dragHoverTagLane, 1, '跨层 hover 高亮（clip 跨轨同口径）');
  tl._up({ pointerId: 1 });
  assert.equal(tl.dragHoverTagLane, null, '抬起清 hover');
  assert.equal(tagLevelOf(p.timeline.tags[0]), 1, 'level 随拖拽变更');
  assert.deepEqual([p.timeline.tags[0].beat, p.timeline.tags[0].endBeat], [26, 42], '目标层钳制后落位');
});

test('F2 删除入口收敛：轨道区域无 × 删除 glyph；单击无位移=仅选中（零提交零 seek）', () => {
  const p = proj([blk(64)], [{ id: 't', beat: 16, name: 'T', endBeat: 32 }]);
  const { tl, cv, rec } = makeTL(p);
  tl.mode = 'music';
  // 删除 glyph 退役：音乐划分轨渲染（drawSegLane+_drawSegCapsule）不落 × 几何（_tagGeom 仅 stage 用）
  const i0 = tlSrc.indexOf('drawSegLane(ctx, p) {');
  const i1 = tlSrc.indexOf('_tagGeomHit(x, tol = 6, y = null)');
  assert.ok(i0 > 0 && i1 > i0, 'drawSegLane 区段定位到');
  const segLaneSrc = tlSrc.slice(i0, i1);
  assert.ok(!segLaneSrc.includes('delX'), '音乐区域渲染无 × 删除几何');
  assert.ok(!segLaneSrc.includes("fillText('×'"), '音乐区域渲染无 × glyph');
  assert.ok(segLaneSrc.includes('无 × 删除 glyph') || tlSrc.includes('无 × 删除 glyph'), '退役注记在源');
  // build-79-tagflag（需求 2）：× glyph 全线退役——stage 旗点纯旗（名称尾「点按=编辑」命中面保留）
  assert.ok(!tlSrc.includes("fillText('×'"), '时间轴不再绘制 × glyph（stage 旗点纯旗）');
  // 单击（无位移）= 仅选中：无 seek、无提交
  cv._hs.pointerdown[0](pd(210, 30));
  tl._up({ pointerId: 1 });
  assert.equal(tl.selSegId, 't');
  assert.deepEqual(rec.seeks, [], '区域单击不定位播放线');
  assert.deepEqual(rec.commits, [], '单击零历史');
});

// ---------- F3：索引行组成 / 菜单一致性 / BPM 退场（静态断言） ----------
test('F3 索引行：名称 flex:1 ellipsis 优先 → 节奏标注（tagRhythmLabel 仅用户标注）→ 秒位区间 → 行尾「…」', () => {
  const i0 = mainSrc.indexOf('function renderSegIndexPanel');
  const i1 = mainSrc.indexOf('function siSeek');
  const siSrc = mainSrc.slice(i0, i1);
  assert.ok(i0 > 0 && i1 > i0, 'renderSegIndexPanel 定位到');
  // 名称优先完整显示（flex:1 + ellipsis），排首且不被挤占
  assert.match(siSrc, /flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/, '名称 span=flex:1 ellipsis');
  assert.ok(siSrc.indexOf('flex:1;min-width:0') < siSrc.indexOf('...(rhythm ?'), '名称 span 先于节奏标注 spread（行内顺序）');
  // 秒位区间（时间轴=唯一对齐规范）：beatToSec → `s`
  assert.match(siSrc, /M\.beatToSec\(p, s\.start\)\.toFixed\(1\)\}→\$\{M\.beatToSec\(p, s\.end\)\.toFixed\(1\)\}s/, '行尾秒位区间 0.0→16.0s 形态');
  // 删除「xx拍」：索引行不渲染任何拍位推算
  assert.ok(!/拍`/.test(siSrc), '索引行无「xx拍」标注');
  assert.ok(!/beatLabel/.test(siSrc), '索引行无 beatLabel 拍位呈示');
  // 行尾「…」钮 → 与轨道长按/右键完全相同的菜单
  assert.match(siSrc, /'…'/, '行尾「…」钮');
  assert.match(siSrc, /showContextMenu\(segMenuItems\(s\.tag\.id\)/, '「…」菜单走 segMenuItems（与轨道同一渲染函数）');
  assert.match(siSrc, /e\.stopPropagation\(\)/, '「…」点击不触发行跳转');
});
test('F3 菜单一致性：轨道长按/右键与索引「…」共用 segMenuItems（单一定义、双调用方、含删除标记 danger）', () => {
  const defs = mainSrc.match(/function segMenuItems\(/g) || [];
  assert.equal(defs.length, 1, 'segMenuItems 单一定义（同一渲染函数的机械保证）');
  const uses = mainSrc.match(/segMenuItems\(/g) || [];
  assert.ok(uses.length >= 3, `定义+两处调用（轨道 showSegMenu 与索引「…」）≥3 处，实际 ${uses.length}`);
  // 菜单项构成：编辑内容/换色/升降级/删除标记(danger)；无拆分/合并（区域模型退役）
  const i0 = mainSrc.indexOf('function segMenuItems');
  const menuSrc = mainSrc.slice(i0, mainSrc.indexOf('function showSegMenu'));
  assert.match(menuSrc, /label: '编辑内容'/);
  assert.match(menuSrc, /label: '删除标记', danger: true/);
  assert.ok(!/label: '于此拆分'|label: '与下一段合并'/.test(menuSrc), '拆分/合并菜单项已退役');
  // 轨道路径：contextmenu/长按 → hooks.onSegContextMenu → main.showSegMenu → segMenuItems
  assert.match(mainSrc, /function showSegMenu\(\{ tagId[\s\S]*?segMenuItems\(tagId\)/);
  assert.match(tlSrc, /onSegContextMenu/, 'timeline 经 hooks.onSegContextMenu 出口（右键/长按共用）');
});
test('F3 BPM 退场静态：工具条藏显（内联 display:none + .b49-exit CSS 兜底）+ JS 处理器保留', () => {
  // 内联藏显（index.html）：外层 label 挂 style。向前窗口或同开标签内命中 display:none 即可。
  // build-91-varispeed（需求 7b）：btn-offset-test-music（试听）随点拍/试听退役从本列移除（DOM+接线一并删除）。
  for (const id of ['bpm-input-music', 'offset-input-music', 'bpb-select-music', 'tl-scale-toggle-music']) {
    const idx = htmlSrc.indexOf(`id="${id}"`);
    assert.ok(idx > 0, `#${id} 存在`);
    const before = htmlSrc.slice(Math.max(0, idx - 200), idx);
    const sameTag = htmlSrc.slice(idx, htmlSrc.indexOf('>', idx) + 1);
    assert.ok(
      /display:none/.test(before) || sameTag.includes('display:none'),
      `#${id} 内联 display:none（外层或控件自身）`);
  }
  const bpmIdx = htmlSrc.indexOf('id="bpm-input-music"');
  assert.match(htmlSrc.slice(Math.max(0, bpmIdx - 200), bpmIdx), /b49-exit/, 'BPM 输入挂 .b49-exit 类');
  // CSS 兜底（防内联被误删）
  assert.match(cssSrc, /#music-toolbar \.b49-exit\{display:none\}/, 'style.css .b49-exit 兜底规则');
  assert.match(cssSrc, /build-49-tagregion BPM 全面退场/, '退场注记可回');
  // JS 处理器保留（回滚=删内联样式与 CSS 规则即可）；试听钮退役不在此列（build-91-varispeed 需求 7b）
  for (const id of ['bpm-input-music', 'offset-input-music', 'bpb-select-music']) {
    assert.match(mainSrc, new RegExp(`\\$\\('${id}'\\)\\.addEventListener`), `#${id} 处理器保留`);
  }
  // 点拍/试听退役守卫：钮 DOM（摘要条+工具条）与 tapTempo/auditionFirstBeat 接线零残留
  assert.ok(!htmlSrc.includes('id="btn-tap"') && !htmlSrc.includes('id="btn-tap-music"'), '点拍钮 DOM 退役');
  assert.ok(!htmlSrc.includes('id="btn-offset-test"') && !htmlSrc.includes('id="btn-offset-test-music"'), '试听钮 DOM 退役');
  assert.ok(!mainSrc.includes('tapTempo(') && !mainSrc.includes('auditionFirstBeat('), 'tapTempo/auditionFirstBeat 接线与函数退役');
  // 索引面板无「拍位」/「xx拍」字样（用户可见面零拍位推算；分秒读数=导航面）；
  // 注：main.js 其它处（音频校准注释等）的「拍位」属内部机制描述，不在退场范围。
  const iSi0 = mainSrc.indexOf('function renderSegIndexPanel');
  const iSi1 = mainSrc.indexOf('function siSeek');
  assert.ok(!/拍位|拍`/.test(mainSrc.slice(iSi0, iSi1)), '索引面板区源码无「拍位」呈示');
  // build-91-varispeed 需求 1b：索引播放头行两分支统一分秒读数（fmtMinSec）
  assert.match(mainSrc, /siState\.ph\.textContent = `▶ 当前 \$\{fmtMinSec\(M\.beatToSec\(p, b\)\)\}`;/, '索引播放头行=分秒读数');
  assert.match(mainSrc, /mode === 'music' \? `\$\{Math\.max\(0, t\.sec\)\.toFixed\(1\)\}s` : M\.beatLabel/, '播放条音乐=秒显示、stage 拍标签不动（E-12）');
  // 内部 beat↔second 映射保留（stage 编舞仍需）
  assert.match(modelSrc, /export function beatToSec/, 'beatToSec 机制保留');
});
// build-79-tagflag 措辞更新（需求 2）：× glyph 呈示已退役——stage 旗点=纯旗、点选态高亮保留在
// 旗面，「点按名称尾/旗点=编辑 popover」语义不变，删除唯二入口=长按/右键 tag 菜单与索引「…」。
// F4 对 fillText('×') 的静态断言同步改写为「不再绘制 ×」。
test('F4 stage 红线抽测：TAG_LANE_H=18 不动；sectionSegmentsOf 保留且注明 stage 归属；stage 旗点纯旗（不再绘制 ×，点按=编辑 popover 语义保留）', () => {
  assert.equal(TAG_LANE_H, 18, 'stage tag 道高逐值不动（E-12）');
  assert.match(modelSrc, /「区域即段」——音乐模式一律直接读[\s\S]*?仅服务 stage（编舞）非严格旧语义路径/, 'sectionSegmentsOf 归属注记');
  assert.match(modelSrc, /export function sectionSegmentsOf/, '函数保留（stage 旧路径使用）');
  assert.ok(!/fillText\('×'/.test(tlSrc), 'stage drawTags × glyph 退役（需求 2：旗点纯旗）');
});
test('F1/F3 数据源：addTag=区域缺省宽 16；⚑ 打点=播放头新建区域+开编辑器（stampTag → _openTagInput）', () => {
  const p = proj([blk(64)], []);
  const t = addTag(p, 8, 'A');
  assert.equal(t.endBeat, 8 + TAG_REGION_DEFAULT_BEATS, '新建区域缺省宽 16 拍');
  assert.match(tlSrc, /stampTag\(\) \{[\s\S]*?_openTagInput\(\{ beat \}\)/, '⚑ 打点走编辑器（区域语义）');
  assert.match(tlSrc, /_openTagInput\(\{ beat = 0, id = null, initial = '', level = 0 \} = \{\}\)/, '编辑器入口（名称/拍值/小节数）');
  // 空白双击=新建区域（吸附小节线）+开编辑器；区域双击=编辑器
  assert.match(tlSrc, /const hit = this\.regionAt\(x, level\);\s*\n\s*if \(hit\) \{ this\.openTagEditor\(hit\.id\); return; \}/, '双击区域=字段编辑器');
  assert.match(tlSrc, /let b = Math\.max\(0, this\.xToBeat\(x\)\);\s*\n\s*\[b\] = this\.snapTagBeatToBar\(b\);/, '空白双击落点吸附小节线');
});
