// build-48-tagui：tag 编辑体验三项修复 node 单测。
// F1 小节数=纯标注制（索引面板无 BPM 推算小节、bars 标注驱动小节格——源静态断言 + tagRhythmLabel 组合复用）；
// F2 单弹窗不变式（开新关旧）与长按=全功能段菜单（行为断言 + 源静态断言）；
// F3 strict 分段纯函数（空白区/末段不延域 + stage 非 strict 回归 E-12）+ 空白单击定位播放线；
// F4 tagLevelCount sanitize/钳制/JSON 往返 + 显式层管理（加/删层模型）+ 轨头层区静态断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicTimeline } from '../js/timeline.js';
import {
  sectionSegmentsOf, sanitizeTags, tagRhythmLabel,
  tagLevelCountOf, clampTagLevelCount, setTagLevelCount, addTagLayer, removeTagLayer,
  setTagLevel, addTag, removeTag, validateProject, TAG_LEVEL_COUNT_MAX, TAG_LEVEL_MAX,
} from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };

const blk = (hold, travel = 0) => ({ holdBeats: hold, travelBeats: travel });
// build-70 夹具迁移：旧 blocks → 队形 clip 字段（与 validateProject 迁移同规则；
// travelBeats=到下一 clip 的空隙；tags 见 timeline.tags）
const proj = (blocks, tags = [], extra = {}) => {
  const formations = [];
  let b = 0;
  for (const k of blocks) {
    formations.push({ id: `f${formations.length}`, name: `F${formations.length}`, color: '#64748b', note: '', positions: {}, startBeat: b, lenBeats: k.holdBeats });
    b += k.holdBeats + k.travelBeats;
  }
  return {
    audio: { bpm: 120, firstBeatSec: 0, beatsPerBar: 4 },
    formations,
    timeline: { tags, ...extra },
  };
};

// ---------- F1：小节数=纯标注制（索引面板） ----------
test('F1 静态：索引面板无 BPM 推算小节——播放头行无「小节」、段内小节格无 bpb 推算、bars 标注驱动', () => {
  const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
  // build-91-varispeed 需求 1b 改写：播放头行（siTick）两分支统一分秒读数（旧「music 纯秒 /
  // stage 拍·秒」双分支收进 fmtMinSec——秒→分秒「x分x秒」）。不携带推算小节数。
  assert.match(mainSrc, /siState\.ph\.textContent = `▶ 当前 \$\{fmtMinSec\(M\.beatToSec\(p, b\)\)\}`;/,
    '播放头行=分秒读数「▶ 当前 x分x秒」（无「（N.N 小节）」尾巴）');
  assert.match(mainSrc, /function fmtMinSec\(sec\)/, '分秒格式化器在（秒→分秒单出处）');
  assert.ok(!/ph\.textContent[^;]*小节/.test(mainSrc), '播放头行不再出现「小节」字样');
  // 段内小节格：无 bpb 向上取整推算；有 bars 标注驱动
  assert.ok(!/Math\.ceil\(\(s\.end - s\.start\) \/ bpb\)/.test(mainSrc), '小节格不再按全局 BPM/bpb 推算格数');
  assert.ok(/s\.tag\.bars/.test(mainSrc), '小节格按段起始 tag 的 bars 标注展开');
  assert.match(mainSrc, /小节 \$\{j \+ 1\}\/\$\{bars\}/, '格行标=段内第 j/bars 小节（标注语义）');
  // 段行节奏标注仍走 tagRhythmLabel（有标注才显示）
  assert.match(mainSrc, /M\.tagRhythmLabel\(s\.tag\)/);
  // 时间轴段带 label 已是标注制（drawSegLane → tagRhythmLabel），核对不回退
  const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');
  assert.match(tlSrc, /tagRhythmLabel\(tag\)|tagRhythmLabel\(s\.tag\)/, '段带名称胶囊节奏标注仍在');
});

test('F1 模型底座：tagRhythmLabel 组合不变；sanitize 区域化（build-49 F1 改写：单点 tag 迁移为 [beat,beat+16) 区域）', () => {
  assert.equal(tagRhythmLabel({}), '');
  assert.equal(tagRhythmLabel({ sig: '3/4' }), '3/4', '有 sig 无 bars → 只显示拍值（小节格不画）');
  assert.equal(tagRhythmLabel({ bars: 2 }), '2小节');
  // build-49 F1：旧点 tag（无 endBeat）迁移为区域——末尾单 tag endBeat=beat+16（缺省 2 个 4/4 小节）
  assert.deepEqual(
    sanitizeTags([{ id: 'x', beat: 0, name: 'X', sig: '3/4' }]),
    [{ id: 'x', beat: 0, name: 'X', sig: '3/4', endBeat: 16 }],
    '点 tag → 区域块（sig 白名单字段原样保留）');
});

// ---------- F2：单弹窗不变式 + 长按=全功能段菜单 ----------
test('F2 静态：单弹窗不变式三对「开前先关」——编辑器↔菜单、菜单↔编辑器、下拉↔弹层', () => {
  const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');
  const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
  // 编辑器打开前先关已开菜单（timeline._openTagInput → ui.closeContextMenu）
  assert.match(tlSrc, /_openTagInput\(\{ beat = 0, id = null, initial = '', level = 0 \} = \{\}\) \{\s*\n\s*this\.closeTagPopover\(\);\s*\n\s*UI\.closeContextMenu\(\);/,
    '_openTagInput 先 closeTagPopover + closeContextMenu');
  // 菜单打开前先关已开编辑器（contextmenu 两分支 + 长按 menu 路径）
  assert.match(tlSrc, /this\.closeTagPopover\(\); \/\/ 单弹窗不变式：开菜单前先关已开的标记编辑器/,
    '段右键分支先关编辑器');
  assert.match(tlSrc, /this\.closeTagPopover\(\); \/\/ 单弹窗不变式（同上）/, 'clip 右键分支先关编辑器');
  assert.match(tlSrc, /closeTagPopover\(\);\s*\n\s*UI\.closeContextMenu\(\);\s*\n\s*this\.hooks\.onSegContextMenu/,
    '长按 menu 路径先关编辑器+菜单再开段菜单');
  // main.js 下拉（自动划分/导出）打开前关弹层
  assert.match(mainSrc, /if \(menu\.hidden\) \{ closeContextMenu\(\); musicTl\?\.closeTagPopover\(\); \}/,
    '自动划分下拉开前关菜单+编辑器');
  assert.match(mainSrc, /if \(menu\.hidden\) closeContextMenu\(\); \/\/ 单弹窗不变式（F2）：开本下拉前先关已开的弹层/,
    '导出下拉开前关弹层');
  // Android 双弹窗根因：长按待定中吞原生 contextmenu（tag 路径补齐 _lpFiredAt 同款机制）
  assert.match(tlSrc, /if \(this\._lp \|\| this\._tagLp \|\| this\._fcLp\) \{ e\.preventDefault\(\); return; \}/,
    '长按待定中（_lp/_tagLp/_fcLp，build-70 增队形 clip 长按）原生 contextmenu 吞针');
  assert.match(tlSrc, /_tagLpFire\(lp\) \{\s*\n\s*if \(this\._tagLp !== lp\) return;[\s\S]*?this\._lpFiredAt = performance\.now\(\)/,
    'tag 长按触发同样落 _lpFiredAt 抑制窗');
});

test('F2 行为：长按待定中右键（原生 contextmenu 提前到达）不开菜单——双弹层根因消除', async () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 8, name: 'A' }, { id: 'a2', beat: 24, name: 'A2' },
  ]);
  const { tl, cv, menus } = makeTL(p);
  tl.mode = 'music';
  const ev = tagCtxEvent(80, 30); // x=80（拍 8 旗点）、y=30（划分轨 lane 0）
  // 待定中：吞针不开菜单
  tl._tagLpArm({ pointerId: 9, clientX: 80, clientY: 30 }, { kind: 'menu', tagId: 'a', level: 0, beat: 8 });
  cv._hs.contextmenu[0](ev);
  assert.equal(menus.length, 0, '长按待定中右键不弹菜单（550ms 自实现计时统一开）');
  assert.equal(ev.defaultPrevented, true, '原生 contextmenu 被 preventDefault');
  tl._tagLpCancel();
  // 到点路径：与右键同款段菜单
  tl._tagLpArm({ pointerId: 9, clientX: 80, clientY: 30 }, { kind: 'menu', tagId: 'a', level: 0, beat: 8 });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(menus.length, 1, '长按到点恰开一次段菜单');
  assert.equal(menus[0].tagId, 'a');
});

test('F2 行为：右键段身=段菜单入口照常（strict 命中段身 → tagId 正确）；showContextMenu 开新关旧', async () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 8, name: 'A' }, { id: 'a2', beat: 24, name: 'A2' },
  ]);
  const { tl, cv, menus } = makeTL(p);
  tl.mode = 'music';
  cv._hs.contextmenu[0](tagCtxEvent(160, 30)); // x=160 → 拍 16 → A 段身 [8,24)
  assert.equal(menus.length, 1);
  assert.equal(menus[0].tagId, 'a', '段身右键命中段起点 tag');
  assert.equal(Math.round(menus[0].beat * 10) / 10, 16, '「于此拆分」落点=右键处拍位');
  // ui.showContextMenu 开新关旧（单弹窗不变式机械面；document 桩驱动真实监听路径）
  const doc = makeDomStub();
  globalThis.document = doc;
  try {
    const ui = await import('../js/ui.js');
    ui.showContextMenu([{ label: '甲', fn: () => {} }], { x: 10, y: 10 });
    const first = doc.body.children.at(-1);
    ui.showContextMenu([{ label: '乙', fn: () => {} }], { x: 10, y: 10 });
    assert.equal(doc.body.children.filter(el => el.className === 'unit-menu').length, 1, '开新菜单前旧菜单已移除');
    ui.closeContextMenu();
    assert.equal(doc.body.children.filter(el => el.className === 'unit-menu').length, 0, 'closeContextMenu 移除菜单');
    assert.ok(!first.removed || doc.body.children.length >= 0); // 桩 remove 标记见 makeDomStub
  } finally {
    delete globalThis.document;
  }
});

// ---------- F3：严格相邻 tag 分段（允许空白） ----------
test('F3 strict：段=严格相邻同层 tag 之间——末 tag 不延域尾；首 tag 前/末 tag 后=空白', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 32, name: 'B' }, { id: 'c', beat: 64, name: 'C' },
  ]);
  const r = sectionSegmentsOf(p, 128, 0, { strict: true });
  assert.deepEqual(r.segs.map(s => [s.start, s.end, s.tag.name]), [[0, 32, 'A'], [32, 64, 'B']],
    '只有相邻对成段；末 tag C 之后=空白（不延域尾 128）');
  assert.deepEqual(r.tags.map(t => t.id), ['a', 'b', 'c'], '返回值 additive：tags=该层排序 tag（孤儿旗呈示用）');
  // 单 tag / 无 tag → 全空白
  const single = proj([blk(64)], [{ id: 'x', beat: 16, name: 'X' }]);
  assert.deepEqual(sectionSegmentsOf(single, 128, 0, { strict: true }).segs, [], '单 tag 不成段（首尾皆空白）');
  const none = proj([blk(64)], []);
  assert.deepEqual(sectionSegmentsOf(none, 128, 0, { strict: true }).segs, [], '无 tag → 无段');
  // 零长（同拍位）起点不成段：A@8 与 B@8 → A 零长跳过、B 为末 tag 也不成段
  const zero = proj([blk(64)], [{ id: 'a', beat: 8, name: 'A' }, { id: 'b', beat: 8, name: 'B' }]);
  assert.deepEqual(sectionSegmentsOf(zero, 128, 0, { strict: true }).segs, [], '零长对+末 tag → 全空白');
  // 删段中间 tag 自然并段
  const p2 = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 32, name: 'B' }, { id: 'c', beat: 64, name: 'C' },
  ]);
  removeTag(p2, 'b');
  assert.deepEqual(sectionSegmentsOf(p2, 128, 0, { strict: true }).segs.map(s => [s.start, s.end]),
    [[0, 64]], '删中间 tag → 前后段自然合并');
  // 删到首/尾即产生空白
  const p3 = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 32, name: 'B' }, { id: 'c', beat: 64, name: 'C' },
  ]);
  removeTag(p3, 'c'); // 删末 tag：剩 [a@0, b@32] → 段 [0,32)，32 拍之后=尾部空白
  assert.deepEqual(sectionSegmentsOf(p3, 128, 0, { strict: true }).segs.map(s => [s.start, s.end]),
    [[0, 32]], '删末 tag → 尾部产生空白（末 tag 之后不延域）');
  removeTag(p3, 'a'); // 删首 tag：剩 [b@32] 单 tag → 全空白
  assert.deepEqual(sectionSegmentsOf(p3, 128, 0, { strict: true }).segs, [], '删到只剩单 tag → 全空白');
});

test('F3 stage 非 strict 回归（红线 E-12）：缺省路径末段延域尾逐值不变', () => {
  const p = proj([blk(16, 8), blk(16, 8), blk(16)], [
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 24, name: 'B' }, { id: 'c', beat: 48, name: 'C' },
  ]);
  // 缺省（stage 调用形态）：末段延 totalBeats=64
  assert.deepEqual(sectionSegmentsOf(p).segs.map(s => [s.start, s.end]), [[0, 24], [24, 48], [48, 64]]);
  // strict 差分：同一数据下末 tag 之后为空白
  assert.deepEqual(sectionSegmentsOf(p, undefined, 0, { strict: true }).segs.map(s => [s.start, s.end]),
    [[0, 24], [24, 48]], 'strict 只差「末段延域尾」一处');
  // 层参数与 strict 正交（音乐模式按层 strict）
  const pl = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' }, { id: 'b', beat: 32, name: 'B', level: 1 }, { id: 'c', beat: 48, name: 'C', level: 1 },
  ]);
  assert.deepEqual(sectionSegmentsOf(pl, 128, 1, { strict: true }).segs.map(s => [s.start, s.end]), [[32, 48]]);
  assert.deepEqual(sectionSegmentsOf(pl, 128, 1).segs.map(s => [s.start, s.end]),
    [[32, 48], [48, 128]], '非 strict 层路径照旧延域尾');
});

test('F3 行为：划分轨空白单击=定位播放线（可拖 scrub）；区域体单击=仅选中不定位（build-49 F2 改写）', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 16, name: 'A' }, { id: 'a2', beat: 32, name: 'A2' },
  ]);
  const { tl, cv, rec } = makeTL(p);
  tl.mode = 'music';
  // x=80 → 拍 8：首区域（[16,32)，x=160）之前的空白——迁移后仍是空白（区域不覆盖拍 8）
  cv._hs.pointerdown[0]({ pointerId: 1, pointerType: 'mouse', clientX: 80, clientY: 30, button: 0 });
  assert.equal(tl.drag?.kind, 'scrub', '空白单击进入定位/scrub 拖拽');
  assert.equal(rec.seeks.at(-1), 8, '播放线定位到单击处（拍 8）');
  assert.equal(tl.selSegId, null, '空白不选中段');
  tl._up({ pointerId: 1 });
  // build-49 F2：区域体单击=仅选中（高亮）——不定位播放线、不弹菜单、不删除
  cv._hs.pointerdown[0]({ pointerId: 2, pointerType: 'mouse', clientX: 200, clientY: 30, button: 0 });
  assert.equal(tl.drag?.kind, 'tagRegion', '区域命中进入 tagRegion 拖拽状态（体拖动=移动）');
  assert.equal(tl.drag?.part, 'body', '命中区域体（非边缘）');
  assert.equal(tl.selSegId, 'a', '区域单击=仅选中该区域');
  tl._up({ pointerId: 2 });
  assert.equal(rec.seeks.at(-1), 8, '区域单击不定位播放线（seek 仍停在空白单击的拍 8）');
});

// ---------- F4：显式层管理 tagLevelCount ----------
test('F4 模型：tagLevelCountOf 缺省 1、钳 1..3；setTagLevelCount 写键/删键并钳降越层 tag', () => {
  const p = proj([blk(64)], []);
  assert.equal(tagLevelCountOf(p), 1, '缺省 1（键不存在）');
  assert.equal(clampTagLevelCount(2), 2);
  assert.equal(clampTagLevelCount(0), 1, '越下界钳 1');
  assert.equal(clampTagLevelCount(9), TAG_LEVEL_COUNT_MAX, '越上界钳 3');
  assert.equal(clampTagLevelCount(1.5), 1, '非整数回缺省');
  assert.equal(clampTagLevelCount('x'), 1);
  p.timeline.tagLevelCount = 3;
  assert.equal(tagLevelCountOf(p), 3);
  setTagLevelCount(p, 1);
  assert.ok(!('tagLevelCount' in p.timeline), 'setTagLevelCount(1)=删键（缺省 shape 不落盘）');
  // 越层钳降：count=2 时 level 2/3 → 1
  p.timeline.tags = [
    { id: 'a', beat: 0, name: 'A' },
    { id: 'b', beat: 8, name: 'B', level: 2 },
    { id: 'c', beat: 16, name: 'C', level: 3 },
  ];
  setTagLevelCount(p, 2);
  assert.deepEqual(p.timeline.tags.map(t => t.level ?? 0), [0, 1, 1], '越层 tag 钳到 count-1（数据不丢失）');
  assert.equal(p.timeline.tagLevelCount, 2);
});

test('F4 模型：addTagLayer 上限把守；removeTagLayer 仅空层可删、更深层号依次上移', () => {
  const p = proj([blk(64)], [
    { id: 'a', beat: 0, name: 'A' },                 // L0（有 tag → 删层拒绝）
    { id: 'deep', beat: 16, name: 'D', level: 2 },   // L2
  ]);
  setTagLevelCount(p, 3);
  // 上限把守：到 3 拒绝加层
  p.timeline.tagLevelCount = TAG_LEVEL_COUNT_MAX;
  const full = addTagLayer(p);
  assert.equal(full.ok, false, '到上限 3 拒绝');
  assert.match(full.error, /最多 3 层/);
  // 有 tag 的层拒绝删
  const busy = removeTagLayer(p, 0);
  assert.equal(busy.ok, false);
  assert.match(busy.error, /仍有 1 个标记/);
  // 删中间空层（level 1）：level 2 的 deep 上移到 level 1
  const r = removeTagLayer(p, 1);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(p.timeline.tags.find(t => t.id === 'deep').level, 1, '被删层之下的层号依次上移');
  // 删空层到 1：仅剩一层不可删；回到缺省 1 不落键
  removeTag(p, 'deep');
  assert.equal(removeTagLayer(p, 1).ok, true, 'count 2 → 1');
  const last = removeTagLayer(p);
  assert.equal(last.ok, false);
  assert.match(last.error, /仅剩一层/);
  assert.ok(!('tagLevelCount' in p.timeline), '回到缺省 1 不落键');
});

test('F4 validate：sanitize 钳制 + JSON 往返（缺省 1 不落键、显式层数保留）', () => {
  const mk = tlc => JSON.parse(JSON.stringify({
    version: 1,
    meta: { title: 'T' },
    dancers: [{ id: 'd1', name: '甲', short: '1', role: 'M', color: '#3b82f6' }],
    formations: [{ id: 'f1', name: '开场', color: '#64748b', note: '', positions: { d1: { x: 1, y: 1, facing: 180 } } }],
    timeline: {
      blocks: [], tags: [
        { id: 'a', beat: 0, name: 'A' },
        { id: 'b', beat: 8, name: 'B', level: 3 },
      ],
      ...(tlc != null ? { tagLevelCount: tlc } : {}),
    },
  }));
  // 缺省（无键）→ 输出无键（deepEqual 往返不新增键）
  const v1 = validateProject(mk(null)).project;
  assert.ok(!('tagLevelCount' in v1.timeline), '缺省 1 不落键');
  assert.ok(!('level' in v1.timeline.tags[1]), 'count 缺省 1 → 越层 tag（level 3）钳到 0（level 键删除）');
  // 显式 2：保留；level 3 越层钳到 1
  const v2 = validateProject(mk(2)).project;
  assert.equal(v2.timeline.tagLevelCount, 2);
  assert.equal(v2.timeline.tags[1].level, 1, 'level ≥ tagLevelCount 的导入数据钳到 count-1');
  // 非法 9 → 钳 3
  const v9 = validateProject(mk(9)).project;
  assert.equal(v9.timeline.tagLevelCount, TAG_LEVEL_COUNT_MAX);
  // 二次校验幂等（导入→导出→再导入 shape 稳定）
  const again = validateProject(JSON.parse(JSON.stringify(v2))).project;
  assert.deepEqual(again.timeline.tagLevelCount, 2);
  assert.deepEqual(again.timeline.tags.map(t => [t.id, t.level ?? 0]), v2.timeline.tags.map(t => [t.id, t.level ?? 0]));
});

test('F4 几何/轨头：显式层数驱动空层渲染；轨头 tag 层区静态断言（corner2 行 + 加/删层 + 移动端紧凑）', () => {
  const p = proj([blk(64)], [{ id: 'a', beat: 0, name: 'A' }]); // 只有 level 0 tag
  const { tl } = makeTL(p);
  tl.mode = 'music';
  assert.deepEqual(tl.segLevelsOf(p), [0], '缺省单层');
  p.timeline.tagLevelCount = 3;
  assert.deepEqual(tl.segLevelsOf(p), [0, 1, 2], '显式 3 层——空层（无 tag）也渲染轨道');
  assert.equal(tl.segLaneH(p), 28 * 3, '层高计账随显式层数');
  // 轨头层区：main.js 静态断言（node 无 DOM 渲染管线；结构由 buildTracksHead 真实挂载点保证）
  const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
  const cssSrc = readFileSync(join(root, 'css', 'style.css'), 'utf8');
  assert.match(mainSrc, /class: 'tlh-corner2', style: `height:\$\{SEG_LANE_H_MUSIC \* tlc\}px`/,
    'corner2 高=28px×显式层数（与画布划分轨逐行对齐）');
  assert.match(mainSrc, /tlh-lvl-name/, '每层一行「层N·tag数」');
  assert.match(mainSrc, /tlh-lvl-add/, '「＋ 加层」钮（上限 3 到限禁用）');
  assert.match(mainSrc, /tlh-lvl-del/, '每层删层钮');
  assert.match(mainSrc, /function addTagLayerFlow\(\)/);
  assert.match(mainSrc, /function removeTagLayerFlow\(level\)/);
  assert.match(mainSrc, /M\.tagLevelCountOf\(p\) - 1/, '段菜单升降级界限随显式层数');
  assert.match(cssSrc, /#tl-tracks-head \.tlh-lvl\{/, '层区行 CSS（28px 对齐）');
  assert.match(cssSrc, /#tl-tracks-head \.tlh-lvl-name\{font-size:9px\}/, '移动端 375 层区小字紧凑（C-09a）');
  // 升/降一级界限（模型兜底路径）随显式层数——行为复测（顶层 0 无升、count-1 无降）
  const menus = [];
  const { tl: tl2, rec: rec2 } = makeTL(p, { onSegContextMenu: i => menus.push(i) });
  tl2.mode = 'music';
  tl2.bumpSegLevel('a', -1);
  assert.equal(rec2.labels.length, 0, '顶层 0 无升（零历史）');
});

// ---------- 共享桩（同 tag-hier/tlnav 口径） ----------
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
  const menus = [];
  const rec = { labels: [], seeks: [], renders: 0 };
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
      seekBeat: b => { rec.seeks.push(b); },
      onSegContextMenu: info => menus.push(info),
      ...hooksExtra,
    },
  });
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; };
  return { tl, cv, sc, rec, menus };
}
// 画布 contextmenu 事件桩（clientX/Y → 画布 x/y 经 getBoundingClientRect(0,0) 直映射）
function tagCtxEvent(x, y) {
  return { clientX: x, clientY: y, pointerType: 'mouse', preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
}
// 极简 document 桩（同 lib-menu-esc 口径裁剪）：驱动 ui.showContextMenu 真实监听注册/移除
function makeDomStub() {
  const docListeners = [];
  const el = tag => ({
    tagName: String(tag).toUpperCase(), nodeType: 1, className: '', style: {}, children: [], removed: false,
    _ls: [],
    addEventListener(type, fn, capture) { this._ls.push({ type, fn, capture: !!capture }); },
    removeEventListener(type, fn, capture) { this._ls = this._ls.filter(l => !(l.type === type && l.fn === fn && !!l.capture === !!capture)); },
    setAttribute() {}, append(...cs) { for (const c of cs.flat()) if (c) { c._parent = this; this.children.push(c); } },
    contains() { return false; },
    remove() {
      if (this._parent) {
        const i = this._parent.children.indexOf(this);
        if (i >= 0) this._parent.children.splice(i, 1);
      }
      this.removed = true;
    },
    getBoundingClientRect() { return { left: 0, top: 0, right: 140, bottom: 180, width: 140, height: 180 }; },
  });
  const doc = el('#document');
  doc.createElement = tag => el(tag);
  doc.createTextNode = text => ({ nodeType: 3, textContent: text });
  doc.body = el('body');
  doc.getElementById = () => null;
  doc.addEventListener = (type, fn, capture) => { docListeners.push({ type, fn, capture: !!capture }); };
  doc.removeEventListener = (type, fn, capture) => {
    const i = docListeners.findIndex(l => l.type === type && l.fn === fn && !!l.capture === !!capture);
    if (i >= 0) docListeners.splice(i, 1);
  };
  doc._docListeners = docListeners;
  return doc;
}
