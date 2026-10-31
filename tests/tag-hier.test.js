// build-47-taghier：tag 分层 + 手动节奏标注 + BPM 识别类隐藏 —— node 单测（纯函数出口 + MusicTimeline 几何桩）。
// 覆盖：F1 模型（level/sig/bars 可选字段、tagRhythmLabel、sectionSegmentsOf(level)、sanitize 三字段、
// JSON 往返 deepEqual 不新增键）；F5 抽测（tagLevelsOf、nestSegmentsByLevel 索引归属、层级段操作）；
// F2 几何（分层划分轨 segLaneH/audioTop/块区跟随、stage 红线 E-12 恒单层 18、跨层命中隔离）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MusicTimeline, SEG_LANE_H_MUSIC, TAG_LANE_H, TL_RULER_H,
  TRACKS_OPS_H, MUSIC_BLOCKS_TOTAL_H, MUSIC_BLOCKS_H, MUSIC_LANE_MAX_H,
} from '../js/timeline.js';
import {
  sectionSegmentsOf, sanitizeTags, tagRhythmLabel, tagLevelsOf, tagLevelOf,
  clampTagLevel, setTagLevel, setTagRhythm, addTag, nestSegmentsByLevel,
  TAG_LEVEL_MAX, TAG_SIGS, SEG_COLOR_COUNT,
} from '../js/model.js';

// 最小项目夹具（同 w1-music 口径：build-70 clip 字段驻队形，见 proj 内迁移）
const blk = (hold, travel = 0) => ({ holdBeats: hold, travelBeats: travel });
// MusicTimeline 构造/_bind 需要 window 存根（同 layout-merge/tlnav 口径；仅 addEventListener）
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
const proj = (blocks, tags = []) => {
  // build-70 夹具迁移：旧 blocks [{holdBeats,travelBeats}] → 队形 clip 字段（与 validateProject
  // 迁移同规则：formation i startBeat=累计 holdStart、lenBeats=holdBeats；travelBeats=空隙）
  const formations = [];
  let b = 0;
  for (const k of blocks) {
    formations.push({ id: `f${formations.length}`, name: `F${formations.length}`, color: '#64748b', note: '', positions: {}, startBeat: b, lenBeats: k.holdBeats });
    b += k.holdBeats + k.travelBeats;
  }
  return {
    audio: { bpm: 120, firstBeatSec: 0, beatsPerBar: 4 },
    formations,
    timeline: { tags },
  };
};

// ---------- F1a：tagRhythmLabel 展示组合 ----------
test('tagRhythmLabel：sig+bars → 「3/4 · 2小节」；只有 sig/bars；都无 → 空串', () => {
  assert.equal(tagRhythmLabel({ sig: '3/4', bars: 2 }), '3/4 · 2小节');
  assert.equal(tagRhythmLabel({ sig: '4/4' }), '4/4');
  assert.equal(tagRhythmLabel({ sig: '6/8' }), '6/8');
  assert.equal(tagRhythmLabel({ bars: 4 }), '4小节');
  assert.equal(tagRhythmLabel({}), '');
  assert.equal(tagRhythmLabel(null), '');
  assert.equal(tagRhythmLabel(undefined), '');
  // 非法字段不参与组合（白名单外 sig / 非正整数 bars 视为无标注）
  assert.equal(tagRhythmLabel({ sig: '7/8', bars: 0 }), '');
  assert.equal(tagRhythmLabel({ sig: '3/4', bars: 1.5 }), '3/4');
  assert.equal(tagRhythmLabel({ sig: '3/4', bars: -2 }), '3/4');
});

// ---------- F1b：sanitizeTags 三可选字段 ----------
test('sanitizeTags level/sig/bars：合法落盘；level 钳 0..3（越界钳制、非整数回 0 不落键）；sig 白名单外/bars 非正整数不落键', () => {
  const out = sanitizeTags([
    { id: 'a', beat: 0, name: '第一段', level: 0, sig: '3/4', bars: 4 },
    { id: 'b', beat: 12, name: '子段', level: 2 },
    { id: 'c', beat: 24, name: '越界钳制', level: 9 },      // 9 → 钳 3
    { id: 'd', beat: 36, name: '负层', level: -1 },          // -1 → 钳 0（=缺省不落键）
    { id: 'e', beat: 48, name: '非整数层', level: 1.5 },     // 非法 → 0 不落键
    { id: 'f', beat: 60, name: '坏sig', sig: '7/8', bars: 2 }, // sig 白名单外不落；bars 保留
    { id: 'g', beat: 72, name: '坏bars', sig: '2/4', bars: 0 }, // bars 非正整数不落；sig 保留
    { id: 'h', beat: 84, name: '旧数据' },                    // 无三字段=旧数据 shape 逐值一致
  ]);
  // build-49 F1 改写：sanitize 区域化——点 tag 迁移补 endBeat（=下一同层 tag.beat，无缝衔接；
  // 各层末尾 tag → beat+16）。注意 b(L2)/c(L3) 各自独占一层=层内末尾 → beat+16。
  assert.deepEqual(out[0], { id: 'a', beat: 0, name: '第一段', sig: '3/4', bars: 4, endBeat: 36 }, 'level 0=缺省不落键；同层下一个=d@36');
  assert.deepEqual(out[1], { id: 'b', beat: 12, name: '子段', level: 2, endBeat: 28 }, 'L2 独占 → 层内末尾 +16');
  assert.deepEqual(out[2], { id: 'c', beat: 24, name: '越界钳制', level: TAG_LEVEL_MAX, endBeat: 40 }, '9 钳 3 落盘；L3 独占 → +16');
  assert.deepEqual(out[3], { id: 'd', beat: 36, name: '负层', endBeat: 48 }, '-1 钳 0 不落键');
  assert.deepEqual(out[4], { id: 'e', beat: 48, name: '非整数层', endBeat: 60 }, '1.5 → 0 不落键');
  assert.deepEqual(out[5], { id: 'f', beat: 60, name: '坏sig', bars: 2, endBeat: 72 }, 'sig 白名单外不落；bars 保留');
  assert.deepEqual(out[6], { id: 'g', beat: 72, name: '坏bars', sig: '2/4', endBeat: 84 }, 'bars 非正整数不落；sig 保留');
  assert.deepEqual(out[7], { id: 'h', beat: 84, name: '旧数据', endBeat: 100 }, 'L0 层内末尾 → beat+16（缺省 2 个 4/4 小节）');
});

test('sanitizeTags 幂等往返：sanitize(sanitize(x)) 逐字节一致（deepEqual），非法输入不新增键', () => {
  const dirty = [
    { id: 'a', beat: 0, name: 'A', level: 1, sig: '6/8', bars: 2 },
    { id: 'b', beat: 8, name: 'B', level: 0.5, sig: 'x', bars: '很多' },
    { beat: 16, name: 'C', level: 3 },
  ];
  const once = sanitizeTags(dirty);
  const twice = sanitizeTags(once);
  assert.deepEqual(twice, once);
  const exported = JSON.parse(JSON.stringify({ timeline: { tags: once } })).timeline.tags;
  assert.deepEqual(sanitizeTags(exported), once, '导出→导入自然往返不新增/不改键');
});

// ---------- F1c：sectionSegmentsOf(level) 分层分段 ----------
test('sectionSegmentsOf level：同层相邻 tag 成段、各层独立派生、末段延到域尾；缺省 0=既有调用方零改动', () => {
  const p = proj([blk(64)], [
    { id: 't0', beat: 0, name: '第一段', sig: '3/4', bars: 4 },        // L0
    { id: 't1', beat: 16, name: 'A1', level: 1 },                       // L1
    { id: 't2', beat: 32, name: 'A2', level: 1, sig: '4/4', bars: 2 },  // L1
    { id: 't3', beat: 48, name: 'B1', level: 2 },                       // L2
  ]);
  const end = 64;
  assert.deepEqual(sectionSegmentsOf(p, end, 0).segs.map(s => [s.start, s.end, s.tag.name]),
    [[0, 64, '第一段']], 'level 0：单 tag 成段延到域尾');
  assert.deepEqual(sectionSegmentsOf(p, end, 1).segs.map(s => [s.start, s.end]),
    [[16, 32], [32, 64]], 'level 1 两段独立；末段延到域尾；首段前区间不属任何段');
  assert.deepEqual(sectionSegmentsOf(p, end, 2).segs.map(s => [s.start, s.end]),
    [[48, 64]], 'level 2');
  assert.deepEqual(sectionSegmentsOf(p, end, 3).segs, [], '空层 → 无段');
  // 缺省 level=0：与旧签名调用逐值一致（既有调用方零改动）
  assert.deepEqual(sectionSegmentsOf(p, end).segs, sectionSegmentsOf(p, end, 0).segs);
  assert.deepEqual(sectionSegmentsOf(p).segs.map(s => [s.start, s.end]), [[0, 64]]);
  // 非法 level 回 0
  assert.deepEqual(sectionSegmentsOf(p, end, 'x').segs, sectionSegmentsOf(p, end, 0).segs);
});

test('sectionSegmentsOf level：旧数据（无 level 键）三层语义与现状逐值一致；endBeatOverride 照常', () => {
  const p = proj([blk(16, 8), blk(16, 8), blk(16)], [
    { id: 't0', beat: 0, name: 'A' }, { id: 't1', beat: 24, name: 'B' }, { id: 't2', beat: 48, name: 'C' },
  ]);
  const legacy = sectionSegmentsOf(p);
  const lv0 = sectionSegmentsOf(p, undefined, 0);
  assert.deepEqual(lv0, legacy);
  assert.deepEqual(lv0.segs.map(s => [s.start, s.end]), [[0, 24], [24, 48], [48, 64]]);
  assert.deepEqual(sectionSegmentsOf(p, 999, 0).segs.map(s => [s.start, s.end]),
    [[0, 24], [24, 48], [48, 999]], 'endBeatOverride 与 level 参数正交（音乐域尾）');
});

// ---------- F1d：层级读写（setTagLevel / setTagRhythm / addTag extra / tagLevelsOf） ----------
test('setTagLevel：钳 0..3；0=删键保持缺省 shape；非法不动；tagLevelOf 缺省/非法 → 0', () => {
  const p = proj([blk(16)], [{ id: 't0', beat: 0, name: 'A' }]);
  assert.equal(tagLevelOf(p.timeline.tags[0]), 0);
  assert.equal(tagLevelOf(null), 0);
  assert.equal(tagLevelOf({ level: 2.5 }), 0);
  setTagLevel(p, 't0', 3);
  assert.equal(p.timeline.tags[0].level, 3);
  setTagLevel(p, 't0', 0);
  assert.ok(!('level' in p.timeline.tags[0]), '回 0 = 删键（缺省 shape 不落盘）');
  setTagLevel(p, 't0', 9); // 越界钳 3
  assert.equal(p.timeline.tags[0].level, 3);
  setTagLevel(p, 't0', 'x'); // 非法不动
  assert.equal(p.timeline.tags[0].level, 3);
  assert.equal(setTagLevel(p, 'nope', 1), null);
  assert.equal(clampTagLevel(1.5), 0);
  assert.equal(clampTagLevel('2'), 2, '数字字符串经 Number 归一（Number.isInteger 判定前转换）');
});

test('setTagRhythm：白名单 sig / 正整数 bars 落盘，空/非法删键（可完全清除节奏标注）', () => {
  const p = proj([blk(16)], [{ id: 't0', beat: 0, name: 'A', sig: '4/4', bars: 4 }]);
  setTagRhythm(p, 't0', { sig: '3/4', bars: 2 });
  assert.deepEqual({ sig: p.timeline.tags[0].sig, bars: p.timeline.tags[0].bars }, { sig: '3/4', bars: 2 });
  setTagRhythm(p, 't0', { sig: null, bars: null });
  assert.ok(!('sig' in p.timeline.tags[0]) && !('bars' in p.timeline.tags[0]), '全清=两键删除（不标节奏）');
  setTagRhythm(p, 't0', { sig: '9/9', bars: -1 });
  assert.ok(!('sig' in p.timeline.tags[0]) && !('bars' in p.timeline.tags[0]), '非法值不落键');
  assert.equal(setTagRhythm(p, 'nope', { sig: '3/4' }), null);
});

test('addTag extra：level/sig/bars 合法才落键；缺省调用 shape 与既有逐值一致（build-49 F1 改写：+endBeat 缺省宽 16）', () => {
  const p = proj([blk(16)], []);
  const a = addTag(p, 8, 'A', { level: 2, sig: '6/8', bars: 3 });
  assert.deepEqual(a, { id: a.id, beat: 8, name: 'A', level: 2, sig: '6/8', bars: 3, endBeat: 24 }, '新区域缺省宽 16 拍');
  const b = addTag(p, 16, 'B', { level: 9, sig: 'x', bars: 0 });
  assert.equal(b.level, TAG_LEVEL_MAX, 'level 越界与 sanitize 同口径钳制');
  assert.ok(!('sig' in b) && !('bars' in b), 'sig/bars 非法不落');
  const c = addTag(p, 24, 'C');
  assert.deepEqual(c, { id: c.id, beat: 24, name: 'C', endBeat: 40 }, '四参缺省与旧三参逐值一致（endBeat=缺省区域宽）');
  assert.equal(TAG_SIGS.length, 4);
  assert.deepEqual(TAG_SIGS, ['2/4', '3/4', '4/4', '6/8']);
  assert.equal(SEG_COLOR_COUNT, 4);
});

test('tagLevelsOf：出现的 level 升序去重；无 tag → [0]；maxLevels 截断保高层（移动端最多 3）', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A', level: 2 },
    { id: 'b', beat: 16, name: 'B' },            // level 0
    { id: 'c', beat: 32, name: 'C', level: 1 },
  ]);
  assert.deepEqual(tagLevelsOf(p), [0, 1, 2]);
  assert.deepEqual(tagLevelsOf(p, 2), [0, 1], '截断保高层（level 2 让位）');
  assert.deepEqual(tagLevelsOf(proj([blk(16)])), [0], '无 tag → 单层（现状）');
  assert.deepEqual(tagLevelsOf(proj([blk(16)], [{ id: 'x', beat: 0, name: 'X', level: 3 }])), [3], '空层不占位：孤层自成一层');
});

// ---------- F1e：层级段操作（build-49 F2 退役） ----------
// splitSectionAt/mergeSectionWithNext 随「于此拆分/与下一段合并」菜单项一并退役（区域块模型下
// 无意义，且拆分/合并语义与同层不交叠钳制冲突）。层级操作面收敛为「升一级/降一级」（setTagLevel
// + fitTagRegionInLevel 重贴，见 tests/tag-region.test.js）。原两测（拆分随层/合并同层判定）随之退役。

// ---------- F5：索引分层归属（nestSegmentsByLevel 纯函数） ----------
test('nestSegmentsByLevel：子段 beat 落入父段范围即归属（不强制完全包含）；无父 → 顶层', () => {
  const seg = (id, name, start, end, level) => ({ i: 0, tag: { id, name, ...(level ? { level } : {}) }, start, end });
  const segs = [
    seg('s1', '第一段', 0, 64, 0),
    seg('s2', 'A1', 16, 40, 1),     // 落入 s1 → depth 1
    seg('s3', 'A1a', 20, 30, 2),    // 落入 s2 → depth 2
    seg('s4', '深层回落', 50, 60, 2), // 父层（s2 已结束）不含 → 最近包含低层=s1 → depth 1
    seg('s5', '第二段', 64, 96, 0),
    seg('s6', 'B1', 70, 90, 1),
    seg('s7', '真孤儿', 200, 210, 1), // 无任何低层包含 → 顶层 depth 0
  ];
  const rows = nestSegmentsByLevel(segs);
  assert.deepEqual(rows.map(r => [r.seg.tag.id, r.depth]),
    [['s1', 0], ['s2', 1], ['s3', 2], ['s4', 1], ['s5', 0], ['s6', 1], ['s7', 0]],
    's4（L2）父层已结束 → 回落最近的包含低层 s1（depth=父层级+1）；s7 无父 → 顶层');
  // 时间序保持（出参按 start 升序）
  assert.deepEqual(rows.map(r => r.seg.start), [0, 16, 20, 50, 64, 70, 200]);
  assert.deepEqual(nestSegmentsByLevel([]), []);
  assert.deepEqual(nestSegmentsByLevel(null), []);
});

test('nestSegmentsByLevel：与 sectionSegmentsOf 串联——L1 子段归属其 beat 所在 L0 段', () => {
  const p = proj([blk(64)], [
    { id: 't0', beat: 0, name: '第一段', sig: '3/4', bars: 4 },
    { id: 't1', beat: 32, name: '第二段' },
    { id: 't2', beat: 40, name: 'A1', level: 1 },
    { id: 't3', beat: 44, name: 'A2', level: 1 },
  ]);
  const segs = [
    ...sectionSegmentsOf(p, 64, 0).segs,
    ...sectionSegmentsOf(p, 64, 1).segs,
  ];
  const rows = nestSegmentsByLevel(segs);
  assert.deepEqual(rows.map(r => [r.seg.tag.name, r.depth]),
    [['第一段', 0], ['第二段', 0], ['A1', 1], ['A2', 1]]);
});

// ---------- F2 几何（MusicTimeline 实例桩，同 layout-merge 口径） ----------
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
      mutateLabeled: (fn, label) => { fn(projObj); rec.labels.push(label); },
      commitEdit: () => {},
      seekBeat: () => { rec.seeks++; },
      ...hooksExtra,
    },
  });
  const rec = { labels: [], seeks: [], renders: 0 };
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; }; // node 无 canvas 2D（同 tlnav 桩）
  return { tl, cv, sc, rec };
}

test('F2 几何：music 划分轨高=28×显式层数、audioTop/块区随层数下移；stage 恒单层 18（E-12 逐值不动）', () => {
  // build-48-tagui F4 新规格：划分轨层数=显式 p.timeline.tagLevelCount（不再按出现 level 推导）；
  // tag.level 只决定 tag 落在哪一层，空层也渲染轨道。
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' },
    { id: 'b', beat: 16, name: 'B', level: 1 },
    { id: 'c', beat: 32, name: 'C', level: 2 },
  ]);
  const { tl } = makeTL(p);
  tl.mode = 'stage';
  assert.deepEqual(tl.segLevelsOf(p), [0], 'stage levels 恒 [0]');
  assert.equal(tl.segLaneH(p), TAG_LANE_H, 'stage 划分轨 18px 不变');
  assert.equal(tl.audioTop(), TL_RULER_H + TAG_LANE_H, 'stage audioTop=22+18=40 不变');
  tl.mode = 'music';
  assert.deepEqual(tl.segLevelsOf(p), [0], '缺省显式层数 1（旧项目零迁移，空层不自动出现）');
  p.timeline.tagLevelCount = 3;
  assert.deepEqual(tl.segLevelsOf(p), [0, 1, 2], '显式 3 层=空层也渲染（level 3 层不存在）');
  assert.equal(tl.segLaneH(p), SEG_LANE_H_MUSIC * 3, '3 层=84px');
  assert.equal(tl.audioTop(), TL_RULER_H + 84, '音频区随层下移');
  assert.equal(tl.tagLaneTopOf(2), TL_RULER_H + 2 * SEG_LANE_H_MUSIC);
  // 块区跟随：blocksTopFor = audioBottom + 加轨条 26 + 6
  assert.equal(tl.blocksTopFor(), tl.audioTop() + 1 * tl.audioLaneH() + TRACKS_OPS_H + 6);
  // 内容高计账：分层开销进 totalHeightMusic（extraH 入参模式）——
  // 宽裕容器：层数 +1 → 内容高 +28 且 laneH 封顶 120 不被挤压
  tl._containerH = 727;
  p.timeline.tagLevelCount = 1;
  tl.totalHeightMusic(p);
  assert.equal(tl.audioLaneH(), MUSIC_LANE_MAX_H, '单层 laneH 封顶');
  p.timeline.tagLevelCount = 2;
  tl.totalHeightMusic(p);
  assert.equal(tl.audioLaneH(), MUSIC_LANE_MAX_H, '双层 laneH 仍封顶（727 容器充裕）');
  // 矮容器：内容高超出容器（可比较返回值）——层数 +1 → 内容高恰 +28
  tl._containerH = 150;
  p.timeline.tagLevelCount = 1;
  const h1 = tl.totalHeightMusic(p);
  p.timeline.tagLevelCount = 2;
  const h2 = tl.totalHeightMusic(p);
  assert.equal(h2 - h1, SEG_LANE_H_MUSIC, '多一层 → 内容高 +28（laneH 同为 floor 56）');
  assert.ok(h1 > 150 && h1 === TL_RULER_H + SEG_LANE_H_MUSIC + 56 + TRACKS_OPS_H + MUSIC_BLOCKS_TOTAL_H,
    '单层 floor 内容高公式自洽');
});

test('F2 几何：单层 music 与现状逐值一致（segLaneH=28、audioTop=50）——旧项目零迁移', () => {
  const p = proj([blk(64)], [{ id: 'a', beat: 0, name: 'A' }]);
  const { tl } = makeTL(p);
  tl.mode = 'music';
  assert.deepEqual(tl.segLevelsOf(p), [0]);
  assert.equal(tl.segLaneH(p), SEG_LANE_H_MUSIC);
  assert.equal(tl.audioTop(), 50);
  assert.equal(tl.segLaneH(), SEG_LANE_H_MUSIC, '缺省取 hooks.getProject()（既有调用形态兼容）');
});

test('F2 命中：tagAt(level) 跨层隔离、tagLaneIndexAt 分层定位、_tagGeomHit y 同层过滤', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 8, name: 'A' },               // L0 旗：8拍×0.5s×20pps = x 80
    { id: 'a2', beat: 24, name: 'A2' },            // L0 第二旗（与 A 成段 [8,24)，供段命中断言）
    { id: 'b', beat: 8, name: 'B', level: 1 },     // 同拍位 L1 旗（不同层；孤旗不成段——F3 严格语义）
  ]);
  p.timeline.tagLevelCount = 2; // F4：显式双层（空层渲染/命中按显式层）
  const { tl } = makeTL(p);
  tl.mode = 'music';
  assert.deepEqual(tl.segLevelsOf(p), [0, 1]);
  assert.equal(tl.tagLaneIndexAt(p, TL_RULER_H + 10), 0, '上层内 → lane 0');
  assert.equal(tl.tagLaneIndexAt(p, TL_RULER_H + SEG_LANE_H_MUSIC + 10), 1, '下层内 → lane 1');
  assert.equal(tl.tagLaneIndexAt(p, TL_RULER_H + 2 * SEG_LANE_H_MUSIC + 10), -1, '划分轨外 → -1');
  assert.equal(tl.tagLevelAtLane(p, 1), 1);
  // 跨层隔离：lane 1 内只命中 L1 旗
  assert.equal(tl.tagAt(80, 0)?.tag.id, 'a');
  assert.equal(tl.tagAt(80, 1)?.tag.id, 'b');
  assert.equal(tl.tagAt(80)?.tag.id, 'a', '缺省 level=全量（既有调用形态零变化）');
  // × 几何命中 y 过滤：两层同 delX 只有 y 所在层的命中
  tl._tagGeom = new Map([
    ['a', { x: 80, delX: 120, top: TL_RULER_H, h: SEG_LANE_H_MUSIC }],
    ['b', { x: 80, delX: 120, top: TL_RULER_H + SEG_LANE_H_MUSIC, h: SEG_LANE_H_MUSIC }],
  ]);
  assert.equal(tl._tagGeomHit(120, 6, TL_RULER_H + 14), 'a');
  assert.equal(tl._tagGeomHit(120, 6, TL_RULER_H + SEG_LANE_H_MUSIC + 14), 'b');
  assert.equal(tl._tagGeomHit(120, 6), 'a', '缺省 y=旧行为（首命中）');
  // 段命中分层（build-49 F1 区域模型改写：regionAt=[beat,endBeat) 覆盖命中，不再邻接推导；
  // 缺 endBeat 的旧点 tag 兜底 beat+16——L1 孤旗 B@8 也自成区域 [8,24)，不再「孤旗=空白」）
  assert.equal(tl.regionAt(80, 0)?.id, 'a', 'x=80 → 拍 8 → L0 的 A 区域 [8,24)');
  assert.equal(tl.regionAt(80, 1)?.id, 'b', 'L1 的 B 区域 [8,24)（区域模型：点 tag 兜底 beat+16）');
  assert.equal(tl.regionAt(40, 0), null, '拍 4 在 A 区域之前 → 空白');
  assert.equal(tl.regionAt(80 * 20 * 0.05 / 0.05, 1), null, '划分轨外空白（拍 80 → 无区域覆盖）');
});

test('F2 长按：tagLp 触发=全功能段菜单入口（menu→onSegContextMenu 与右键同款 / create→打标记恰一条历史）；位移超阈/抬起取消', async () => {
  const p = proj([blk(64)], [{ id: 'a', beat: 8, name: 'A' }]);
  const menus = [];
  const { tl, rec } = makeTL(p, {
    onSegContextMenu: info => menus.push(info), // F2：长按=段菜单（不再直开编辑器）
  });
  tl.mode = 'music';
  // menu：到点触发 onSegContextMenu（与右键同一入口；node 无 document → 编辑器路径安全早退）
  tl._tagLpArm({ pointerId: 1, clientX: 5, clientY: 5 }, { kind: 'menu', tagId: 'a', level: 0, beat: 8 });
  assert.ok(tl._tagLp, '待定中');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(tl._tagLp, null);
  assert.equal(menus.length, 1, '长按触发恰一次段菜单');
  assert.equal(menus[0].tagId, 'a');
  assert.equal(menus[0].beat, 8, '「于此拆分」落点=长按处拍位');
  assert.ok(menus[0].screenX === 5 && menus[0].screenY === 5, '菜单锚点=按压点');
  // create：触发=落一条「打标记」+ 开编辑器
  tl._tagLpArm({ pointerId: 2, clientX: 5, clientY: 5 }, { kind: 'create', beat: 24, level: 1 });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(rec.labels.at(-1), '打标记');
  const created = p.timeline.tags.at(-1);
  assert.equal(created.level, 1, '新建随层');
  assert.equal(created.beat, 24);
  // 位移超阈取消（拖拽意图）：计时器到点不触发
  const before = p.timeline.tags.length;
  const menusBefore = menus.length;
  tl._tagLpArm({ pointerId: 3, clientX: 0, clientY: 0 }, { kind: 'create', beat: 30, level: 0 });
  tl._tagLp.x0 = 100; // 模拟 move 判定位移 > TP_SLOP_PX（_move 同式）
  tl._tagLpCancel();
  await new Promise(r => setTimeout(r, 600));
  assert.equal(p.timeline.tags.length, before, '取消后不落数据');
  assert.equal(menus.length, menusBefore, '取消后不弹菜单');
});

test('F2 模型联动：bumpSegLevel 升/降一级恰一条「标记层级」历史；界限随显式层数（F4），越界不动', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' },
    { id: 'b', beat: 16, name: 'B', level: 2 },
  ]);
  p.timeline.tagLevelCount = 3; // 显式 3 层 → 层号界 0..2
  const { tl, rec } = makeTL(p);
  tl.mode = 'music';
  tl.bumpSegLevel('a', +1); // 降一级 0→1
  assert.equal(p.timeline.tags[0].level, 1);
  assert.equal(rec.labels.at(-1), '标记层级');
  tl.bumpSegLevel('a', -1); // 升一级 1→0（删键）
  assert.ok(!('level' in p.timeline.tags[0]));
  tl.bumpSegLevel('b', -1); // 升一级 2→1
  assert.equal(p.timeline.tags[1].level, 1);
  tl.bumpSegLevel('b', +1); // 降一级 1→2
  assert.equal(p.timeline.tags[1].level, 2);
  const labelsBefore = rec.labels.length;
  tl.bumpSegLevel('a', -1); // 顶层 0 无升（越界兜底不动、零历史）
  tl.bumpSegLevel('b', +1); // 显式最底层 2 无降（越界兜底不动、零历史——旧 TAG_LEVEL_MAX=3 界退役）
  assert.equal(rec.labels.length, labelsBefore, '越界不产生历史');
  assert.ok(!('level' in p.timeline.tags[0]));
  assert.equal(p.timeline.tags[1].level, 2);
});
