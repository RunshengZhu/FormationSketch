// W1 音乐模式主区化 node 单测（整改方案 docs/workflow-rectification-plan.md §6 批次 W1）：
// 全部走纯函数出口（timeline.js musicLaneH/musicContentH/resolveInitialUiMode；model.js
// 节奏划分轨族），不依赖 DOM/浏览器。既有套件口径不变：本文件只新增，不改既有测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  musicLaneH, musicContentH, tlTotalHeight, resolveInitialUiMode,
  TRACKS_OPS_H, TL_RULER_H, SEG_LANE_H_MUSIC, MUSIC_LANE_GAP, MUSIC_LANE_MIN_H, MUSIC_LANE_MAX_H,
} from '../js/timeline.js';
import {
  sectionSegmentsOf, evenSectionBeats, barRuleSections, parseSectionTable, sectionTableToEntries,
  applySectionEntries, splitSectionAt, mergeSectionWithNext, removeSection, setSectionColor,
  sanitizeTags, SEG_COLOR_COUNT,
} from '../js/model.js';

// 最小项目夹具（computeSegments 只读 blocks 的 holdBeats/travelBeats；tags 见 timeline.tags）
const blk = (hold, travel = 0) => ({ holdBeats: hold, travelBeats: travel });
const proj = (blocks, tags = []) => ({
  audio: { bpm: 120, firstBeatSec: 0, beatsPerBar: 4 },
  timeline: { blocks, tags },
});
const ls = map => ({ getItem: k => (k in map ? map[k] : null) });

// ---------- ① 音乐模式几何（W1-1）：容器推导 + clamp(56,120) ----------
test('G2W1 laneH 推导：860 高容器 1 轨封顶 120；下限 56 托底（容器 ≤336 时 4 轨触底）', () => {
  // 1360×860 音乐模式实测：bottom-area=812 − playbar 44 − 工具条 40 ≈ tl-scroll 727
  assert.equal(musicLaneH(727, 1), 120, '1 轨=120（上限封顶）');
  assert.equal(musicLaneH(727, 2), 120, '2 轨充裕 → 仍封顶 120');
  assert.equal(musicLaneH(727, 4), 120, '4 轨充裕 → 仍封顶 120（56 为下限非目标值）');
  // clamp 下限演示：内容高 336 = 22+28+4×56+3×12+26，容器恰好放下 → laneH=56
  assert.equal(musicLaneH(336, 4), 56);
  assert.equal(musicLaneH(300, 4), 56, '更矮容器 → floor 56 托底（内容超出 → #tl-body 纵滚）');
  assert.equal(musicLaneH(336, 1), 120, '1 轨下限之上先封顶');
});
test('G2W1 laneH 非法输入与钳制边界', () => {
  assert.equal(musicLaneH(NaN, 2), 120, '容器非数值 → 上限兜底');
  assert.equal(musicLaneH('x', 2), 120);
  assert.equal(musicLaneH(727, 0), 120, 'n=0 → 按 1 轨');
  assert.equal(musicLaneH(727, -3), 120, '负 n → 按 1 轨');
  assert.equal(musicLaneH(727, 2.9), 120, '非整 n 向下取整');
  assert.equal(musicLaneH(MUSIC_LANE_MAX_H + TL_RULER_H + SEG_LANE_H_MUSIC + TRACKS_OPS_H, 1), MUSIC_LANE_MAX_H);
});
test('G2W1 内容高：与 laneH/n 自洽；容器 ≥ 内容 → 画布拉满不滚动；容器 < 内容 → 纵滚', () => {
  assert.equal(musicContentH(120, 1), TL_RULER_H + SEG_LANE_H_MUSIC + 120 + TRACKS_OPS_H);
  assert.equal(musicContentH(56, 4), 22 + 28 + 4 * 56 + 3 * MUSIC_LANE_GAP + 26, '4 轨 56 内容高=336');
  // floor 恰好自洽：容器 336 → 内容 336（不滚）；容器 335 → 内容 336（超出 1px → 滚）
  assert.ok(musicContentH(musicLaneH(727, 4), 4) <= 727, '860 高 4 轨内容不超容器（无滚动）');
  assert.ok(musicContentH(musicLaneH(335, 4), 4) > 335, '容器不足 floor 内容 → 纵向滚动');
});
test('G2W1 编舞红线不动：tlTotalHeight stage 三值 150/120/160 逐值保持（E-12）', () => {
  assert.equal(tlTotalHeight('stage', 66, false), 150);
  assert.equal(tlTotalHeight('stage', 66, true), 120);
  assert.equal(tlTotalHeight('stage', 112, false), 160);
  assert.equal(TRACKS_OPS_H, 26, '加轨条高=26（音乐模式底部 ＋加轨 DOM 条）');
  assert.equal(SEG_LANE_H_MUSIC, 28, '节奏划分轨升级 28px（§2.2.1；编舞 tag 道仍 18 不变）');
  assert.equal(MUSIC_LANE_GAP, 12);
  assert.deepEqual([MUSIC_LANE_MIN_H, MUSIC_LANE_MAX_H], [56, 120]);
});

// ---------- ② 自动划分三来源（W1-7 前半） ----------
test('来源①均分：64 拍分 8 段 → 段起点 0/8/…/56；非整除保留 2 位；N 非法 → []', () => {
  assert.deepEqual(evenSectionBeats(64, 8), [0, 8, 16, 24, 32, 40, 48, 56]);
  assert.deepEqual(evenSectionBeats(100, 3), [0, 33.33, 66.67]);
  assert.deepEqual(evenSectionBeats(64, 1), [0]);
  assert.deepEqual(evenSectionBeats(0, 8), [], '曲长 0 → 拒绝');
  assert.deepEqual(evenSectionBeats(64, 0), []);
  assert.deepEqual(evenSectionBeats(64, -1), []);
  assert.deepEqual(evenSectionBeats(64, 65), [], '上限 64');
  assert.deepEqual(evenSectionBeats(64, 'x'), []);
});
test('来源②小节规则：主歌16/副歌8 交替、重复段名带序号、到曲终即止；单规则不编号', () => {
  assert.deepEqual(barRuleSections(48),
    [{ name: '主歌1', beat: 0 }, { name: '副歌1', beat: 16 }, { name: '主歌2', beat: 24 }, { name: '副歌2', beat: 40 }]);
  assert.deepEqual(barRuleSections(24, [{ name: '副歌', beats: 8 }]),
    [{ name: '副歌', beat: 0 }, { name: '副歌', beat: 8 }, { name: '副歌', beat: 16 }]);
  assert.deepEqual(barRuleSections(0), []);
  assert.deepEqual(barRuleSections(48, []), []);
});
test('来源③段落表解析：「前奏8 主歌32 副歌32」→ 名称+拍数；空白/逗号/换行分隔皆可；任一项不合法整表拒绝', () => {
  assert.deepEqual(parseSectionTable('前奏8 主歌32 副歌32'),
    [{ name: '前奏', beats: 8 }, { name: '主歌', beats: 32 }, { name: '副歌', beats: 32 }]);
  assert.deepEqual(parseSectionTable('前奏 8，主歌 32\n副歌 32.5'),
    [{ name: '前奏', beats: 8 }, { name: '主歌', beats: 32 }, { name: '副歌', beats: 32.5 }]);
  assert.deepEqual(parseSectionTable(''), []);
  assert.deepEqual(parseSectionTable('主歌'), [], '缺拍数 → 拒绝');
  assert.deepEqual(parseSectionTable('主歌32x'), [], '带非数字尾缀 → 拒绝');
  assert.deepEqual(parseSectionTable('主歌0'), [], '拍数 0 → 拒绝');
});
test('来源③段落表落标：累计拍位、越过曲尾自动截断；曲长 0 → []', () => {
  assert.deepEqual(sectionTableToEntries(parseSectionTable('前奏8 主歌32'), 64),
    [{ name: '前奏', beat: 0 }, { name: '主歌', beat: 8 }]);
  assert.deepEqual(sectionTableToEntries(parseSectionTable('前奏8 主歌32'), 16),
    [{ name: '前奏', beat: 0 }, { name: '主歌', beat: 8 }], '曲尾 16 拍截断：末段由派生规则延到曲终');
  assert.deepEqual(sectionTableToEntries(parseSectionTable('前奏8'), 0), []);
});

// ---------- ③ 段派生与段操作（W1-7 后半：拖界/右键族的数据面） ----------
test('段派生：段 i=[tags[i],tags[i+1])，末段延到曲终；首 tag 前区间不属任何段；零长段跳过', () => {
  const p1 = proj([blk(16, 8), blk(16, 8), blk(16)], [
    { id: 't0', beat: 0, name: 'A' }, { id: 't1', beat: 24, name: 'B' }, { id: 't2', beat: 48, name: 'C' },
  ]);
  const { segs, totalBeats } = sectionSegmentsOf(p1);
  assert.equal(totalBeats, 64, '16+8+16+8+16');
  assert.deepEqual(segs.map(s => [s.start, s.end]), [[0, 24], [24, 48], [48, 64]]);
  assert.deepEqual(segs.map(s => s.tag.name), ['A', 'B', 'C']);
  const p2 = proj([blk(16)], [{ id: 't0', beat: 8, name: 'A' }, { id: 't1', beat: 8, name: 'B' }]);
  assert.deepEqual(sectionSegmentsOf(p2).segs.map(s => [s.start, s.end]), [[8, 16]], '重复拍位零长段跳过、前导区间不划段');
  assert.deepEqual(sectionSegmentsOf(proj([blk(16)])).segs, [], '无标记 → 无段');
});
test('落标 applySectionEntries：整表替换 tags；空名回落「段落 k」；color 非法不落', () => {
  const p = proj([blk(16)], [{ id: 'old', beat: 4, name: '旧' }]);
  applySectionEntries(p, [{ name: '前奏', beat: 0 }, { name: '', beat: 8 }, { name: '副歌', beat: 16, color: 2 }, { name: 'X', beat: 24, color: 9 }]);
  assert.equal(p.timeline.tags.length, 4);
  assert.equal(p.timeline.tags[0].name, '前奏');
  assert.equal(p.timeline.tags[1].name, '段落 2', '空名回落默认段名');
  assert.equal(p.timeline.tags[2].color, 2);
  assert.ok(!('color' in p.timeline.tags[3]), 'color 越界 → 不落该键');
  assert.ok(p.timeline.tags.every(t => /^tag_/.test(t.id)), '全部补 uid');
});
test('拆分段：原段名+「·2」截断、拍位钳 ≥0.01、color 随原段；未知 tagId → null', () => {
  const p = proj([blk(16)], [{ id: 't0', beat: 0, name: '副歌', color: 3 }]);
  const t = splitSectionAt(p, 't0', 8.005);
  assert.equal(p.timeline.tags.length, 2);
  assert.equal(t.name, '副歌·2');
  assert.equal(t.color, 3);
  assert.equal(splitSectionAt(p, 'nope', 8), null);
  const p2 = proj([blk(16)], [{ id: 't0', beat: 0, name: '一二三四五六七八九十一二三四五六七八九十' }]);
  const t2 = splitSectionAt(p2, 't0', 4);
  assert.ok(t2.name.length <= 20, '段名截断 ≤ TAG_NAME_MAX');
});
test('合并相邻：移除下一段起点（本段延到再下一段）；末段并入前段（移除自身前一界）', () => {
  const p = proj([blk(16)], [
    { id: 't0', beat: 0, name: 'A' }, { id: 't1', beat: 8, name: 'B' }, { id: 't2', beat: 16, name: 'C' },
  ]);
  mergeSectionWithNext(p, 't0');
  assert.deepEqual(p.timeline.tags.map(t => t.id), ['t0', 't2'], 'A 合并 B → 移除 B 界');
  mergeSectionWithNext(p, 't2');
  assert.deepEqual(p.timeline.tags.map(t => t.id), ['t2'], '末段 C 并入前段 → 移除前一界 A，C 保留延到曲终');
  const p3 = proj([blk(16)], [{ id: 't0', beat: 0, name: 'A' }]);
  mergeSectionWithNext(p3, 't0');
  assert.deepEqual(p3.timeline.tags.map(t => t.id), ['t0'], '仅一段：无可并 → 原样');
});
test('删除段 = 移除段起点 tag；换色 0..3 越界不动', () => {
  const p = proj([blk(16)], [{ id: 't0', beat: 0, name: 'A' }, { id: 't1', beat: 8, name: 'B' }]);
  removeSection(p, 't1');
  assert.deepEqual(p.timeline.tags.map(t => t.id), ['t0']);
  setSectionColor(p, 't0', 2);
  assert.equal(p.timeline.tags[0].color, 2);
  setSectionColor(p, 't0', 9);
  assert.equal(p.timeline.tags[0].color, 2, '越界不改');
  setSectionColor(p, 't0', 1.5);
  assert.equal(p.timeline.tags[0].color, 2, '非整数不改');
  assert.equal(SEG_COLOR_COUNT, 4, '段色板 4 色');
});

// ---------- ④ 一次性迁移与清洗（W1-3 / 零破坏 shape） ----------
test('旧键一次性迁移（C6）：uiMode 优先；无 uiMode 且 audioTrackExpanded=1 → music；读后语义等价退役', () => {
  assert.equal(resolveInitialUiMode(ls({ 'wuzhen:uiMode': 'music' })), 'music');
  assert.equal(resolveInitialUiMode(ls({ 'wuzhen:uiMode': 'stage' })), 'stage');
  assert.equal(resolveInitialUiMode(ls({ 'wuzhen:uiMode': 'stage', 'wuzhen:audioTrackExpanded': '1' })), 'stage', '显式 stage 优先于旧键');
  assert.equal(resolveInitialUiMode(ls({ 'wuzhen:audioTrackExpanded': '1' })), 'music', '旧展开用户首启落音乐模式');
  assert.equal(resolveInitialUiMode(ls({ 'wuzhen:audioTrackExpanded': '0' })), 'stage');
  assert.equal(resolveInitialUiMode(ls({})), 'stage');
  assert.equal(resolveInitialUiMode({ getItem: () => { throw new Error('隐私模式'); } }), 'stage', 'storage 异常安全回落 stage');
});
test('sanitizeTags color 透传：合法 0..3 保留；无/非法 → 输出 shape 与既有逐值一致（零迁移成本）', () => {
  const out = sanitizeTags([
    { id: 'a', beat: 0, name: 'A', color: 3 },
    { id: 'b', beat: 8, name: 'B' },
    { id: 'c', beat: 16, name: 'C', color: 4 },
    { id: 'd', beat: 24, name: 'D', color: 1.5 },
  ]);
  assert.deepEqual(out[0], { id: 'a', beat: 0, name: 'A', color: 3 });
  assert.deepEqual(out[1], { id: 'b', beat: 8, name: 'B' }, '无 color 键 → shape 与既有完全一致');
  assert.deepEqual(out[2], { id: 'c', beat: 16, name: 'C' });
  assert.deepEqual(out[3], { id: 'd', beat: 24, name: 'D' });
});
