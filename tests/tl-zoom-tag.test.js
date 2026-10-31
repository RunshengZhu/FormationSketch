// build-77-zoomsel/tagdel 回归：时间轴两项体验修复（node 可测：导出纯函数 + fakeEl/fakeCtx 桩实例）。
//   需求 1（缩放以选中 clip 为中心）：zoomAnchorSec 纯函数（有选中 clip=中心锚、无选中=既有锚
//     回退）+ 锚点屏幕位不变的补偿式数学断言 + 桩实例断言 zoom()/zoomAt() 的 scrollLeft 补偿
//     （±按钮直调 zoom、滚轮/捏合经 zoomAt——所有入口行为一致）。
//   需求 2（标签防误删）：tagHitAction 分流矩阵（单击绝不产生 'delete'）+ 桩实例断言 stage
//     点按 ×/单击旗=选中+编辑 popover（零删除零历史零 seek）、触摸长按/右键=tag 菜单入口、
//     music 区域单击=既有仅选中（build-49 F2 不回退）、拖旗移位既有提交不回退。
// DOM 桩沿用 tests/wavezoom.test.js 口径（无真实 canvas 2D；window 桩捕获 _up 派发）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicTimeline, zoomAnchorSec, tagHitAction } from '../js/timeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcTl = readFileSync(join(root, 'js/timeline.js'), 'utf8');

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
function fakeCtx() {
  return {
    save() {}, restore() {},
    fillRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {},
    fillText() {}, measureText: s => ({ width: String(s).length * 6 }),
    font: '', textBaseline: '', strokeStyle: '', fillStyle: '', lineWidth: 1,
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
    // build-70 夹具口径：队形 clip [0,16) 拍（bpm120 spb=0.5 → [0,8)s）
    formations: [{ id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [], startBeat: 0, lenBeats: 16 }],
    media: { assets: [{ id: 'a1', name: '曲一', durationSec: 40 }] },
  };
}
// 桩实例：secPerPx 显式（pps=20 绕开自适应几何）；render 桩计数；rec 记录 hooks 调用
function makeTL(proj = makeProj(), { mode = 'stage' } = {}) {
  winHs.pointerup = [];
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  const rec = { muts: [], labels: [], seeks: [], commits: [], renders: 0, segMenus: [] };
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
      onSegContextMenu: info => { rec.segMenus.push(info); },
    },
  });
  tl.mode = mode;
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; };
  return { tl, cv, ov, sc, rec, proj };
}

// ---------- 需求 1a：zoomAnchorSec 纯函数 ----------
test('zoomAnchorSec：有选中 clip → 中心时刻为锚（含退化零宽/负起点钳非负）', () => {
  assert.equal(zoomAnchorSec({ selectedClipRange: { start: 10, end: 18 } }), 14);
  assert.equal(zoomAnchorSec({ selectedClipRange: { start: 0, end: 8 } }), 4);
  assert.equal(zoomAnchorSec({ selectedClipRange: { start: 5, end: 5 } }), 5, '退化零宽=起点（clip 恒正宽，理论域）');
  assert.equal(zoomAnchorSec({ selectedClipRange: { start: -2, end: 4 } }), 1, '中心钳非负');
});

test('zoomAnchorSec：无选中 → 回退既有锚（fallbackSec 透传钳非负 / 视口中点 / 播放头 / 0）', () => {
  assert.equal(zoomAnchorSec({ selectedClipRange: null, fallbackSec: 7.5 }), 7.5, '滚轮/捏合=指针/质心时刻（既有锚透传）');
  assert.equal(zoomAnchorSec({ selectedClipRange: { start: 9, end: 2 }, fallbackSec: 4 }), 4, '非法区间视同无选中');
  assert.equal(zoomAnchorSec({ fallbackSec: -3 }), 0, '钳非负（与既有 max(0,…) 逐值一致）');
  assert.equal(zoomAnchorSec({ viewStart: 4, viewEnd: 12 }), 8, '±按钮既有锚=可视域中点（域口径）');
  assert.equal(zoomAnchorSec({ viewStart: 4, viewEnd: 12, scale: 0, playheadSec: 9 }), 9, 'scale 非正=时间域不可信 → 播放头兜底');
  assert.equal(zoomAnchorSec({ playheadSec: 3.3 }), 3.3);
  assert.equal(zoomAnchorSec({}), 0, '全缺省=域起点');
});

test('zoomAnchorSec：屏幕位不变数学断言——补偿式 scrollLeft\'=scrollLeft+anchor·Δpps 下锚点视口 x 缩放前后相等', () => {
  const anchor = zoomAnchorSec({ selectedClipRange: { start: 10, end: 18 } }); // 14s
  // （oldPps,newPps,scrollLeft,headW）全取二进制精确值，断言恒等式零浮点噪声
  for (const [oldPps, newPps, scrollLeft, headW] of [[20, 40, 120, 64], [40, 20, 300, 64], [16, 25, 0, 0], [20, 21.5, 77, 148]]) {
    const xBefore = headW + anchor * oldPps - scrollLeft;                  // 缩放前锚点视口 x
    const slAfter = Math.max(0, scrollLeft + anchor * (newPps - oldPps)); // _zoomAnchorCommit 补偿式
    const xAfter = headW + anchor * newPps - slAfter;
    assert.equal(xAfter, xBefore, `pps ${oldPps}→${newPps}、scrollLeft ${scrollLeft}、headW ${headW}：该时刻保持在同一屏幕 x`);
  }
  // 与 zoomAt 既有锚定式（anchorOff 形式）代数等价：headW+anchor·newPps−anchorOff ≡ delta 形式
  const oldPps = 20, newPps = 55, scrollLeft = 90, headW = 64;
  const anchorOff = headW + anchor * oldPps - scrollLeft;
  assert.equal(headW + anchor * newPps - anchorOff, scrollLeft + anchor * (newPps - oldPps));
});

// ---------- 需求 1b：桩实例——所有缩放入口一致锚定选中中心 ----------
test('zoomAt（滚轮/捏合入口）：music 选中 clip → 锚=clip 中心 14s，指针锚入参忽略', () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 10, lengthSec: 8, srcStartSec: 0 }];
  const { tl, sc } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  sc.scrollLeft = 120;
  tl.zoomAt(2, 9999); // 指针 clientX 故意远离选中区——选中锚应忽略它
  assert.equal(tl.secPerPx, 1 / 40, 'pps 20→40');
  assert.equal(sc.scrollLeft, 120 + 14 * (40 - 20), '补偿式：120+14·20=400（14s 屏幕位不变）');
});

test('zoomAt（滚轮/捏合入口）：无选中 → 既有指针锚逐值不变（回退路径）', () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 10, lengthSec: 8, srcStartSec: 0 }];
  const { tl, sc } = makeTL(p, { mode: 'music' }); // clipSel 空 → 无选中
  tl.zoomAt(2, 200); // rect.left=0、headW=0（无 document）→ anchorSec=(200−0−0+0)/20=10
  assert.equal(tl.secPerPx, 1 / 40);
  assert.equal(sc.scrollLeft, Math.max(0, 0 + 10 * 40 - 200), '既有式 headW+anchorSec·newPps−(clientX−rect.left)');
});

test('zoom（±按钮直调入口）：stage 选中队形 clip → 中心 4s 锚定；music 无选中 → scrollLeft 不动（既有）', () => {
  const p = makeProj(); // formations clip [0,16) 拍 → [0,8)s → 中心 4s
  const { tl, sc } = makeTL(p, { mode: 'stage' });
  sc.scrollLeft = 100;
  tl.zoom(2);
  assert.equal(tl.secPerPx, 1 / 40);
  assert.equal(sc.scrollLeft, 100 + 4 * (40 - 20), '选中锚：100+4·20=180（编舞模式恒有 formationIndex 选中对象）');
  // 无选中回退（music 模式 clipSel 空）：既有行为——zoom 只改 pps、不碰 scrollLeft
  const { tl: m2, sc: sc2 } = makeTL(p, { mode: 'music' });
  sc2.scrollLeft = 100;
  m2.zoom(2);
  assert.equal(sc2.scrollLeft, 100, '无选中：既有行为 scrollLeft 不动');
  assert.equal(m2.secPerPx, 1 / 40);
});

test('_zoomSelRangeSec：music 多选=并集跨度；stage=当前队形 clip；空/陈旧选择=null', () => {
  const p = makeProj();
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', timelineStartSec: 10, lengthSec: 8, srcStartSec: 0 },
    { id: 'c2', assetId: 'a1', timelineStartSec: 30, lengthSec: 4, srcStartSec: 0 },
  ];
  const { tl } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1', 'c2']);
  assert.deepEqual(tl._zoomSelRangeSec(p), { start: 10, end: 34 }, '多选并集 [min start, max end]');
  tl.clipSel = new Set(['gone']);
  assert.equal(tl._zoomSelRangeSec(p), null, '陈旧 id → null（回退既有锚）');
  const { tl: st } = makeTL(p, { mode: 'stage' });
  assert.deepEqual(st._zoomSelRangeSec(p), { start: 0, end: 8 }, 'stage=formationIndex 队形 clip（16 拍×0.5s）');
});

// ---------- 需求 2a：tagHitAction 纯函数 ----------
test('tagHitAction：分流矩阵——单击 tag=edit、长按/右键=menu、region 单击/blank=none', () => {
  assert.equal(tagHitAction('tag', {}), 'edit', 'stage 单击旗/×=选中+编辑 popover（原删除路径）');
  assert.equal(tagHitAction('tag', { isLongPress: true }), 'menu');
  assert.equal(tagHitAction('tag', { isContextMenu: true }), 'menu');
  assert.equal(tagHitAction('tag', { isLongPress: true, isContextMenu: true }), 'menu');
  assert.equal(tagHitAction('region', {}), 'none', 'region 单击=既有仅选中（build-49 F2 无附加动作）');
  assert.equal(tagHitAction('region', { isLongPress: true }), 'menu');
  assert.equal(tagHitAction('region', { isContextMenu: true }), 'menu');
  assert.equal(tagHitAction('blank', {}), 'none', '空白单击=既有 scrub');
  assert.equal(tagHitAction('blank', { isLongPress: true }), 'none', '空白长按=新建区域流程，不经本函数');
  assert.equal(tagHitAction('blank', { isContextMenu: true }), 'none');
});

test('tagHitAction：不变量——任何 kind×手势组合都不产生 delete，且返回值恒在枚举内', () => {
  for (const kind of ['tag', 'region', 'blank', '', undefined, null]) {
    for (const sig of [{}, { isLongPress: true }, { isContextMenu: true }, { isLongPress: true, isContextMenu: true }]) {
      const act = tagHitAction(kind, sig);
      assert.notEqual(act, 'delete', `${String(kind)} ${JSON.stringify(sig)}：单击/点按删除路径不存在`);
      assert.ok(['menu', 'edit', 'none'].includes(act), `${String(kind)} ${JSON.stringify(sig)} → ${act}`);
    }
  }
});

// ---------- 需求 2b：桩实例——stage 点按 ×/单击旗=选中+编辑（零删除） ----------
test('点按 ×（stage）：不再删除——零 mutate 零历史；选中并打开编辑 popover', () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: '副歌', beat: 6 }];
  const { tl, cv, rec } = makeTL(p, { mode: 'stage' });
  tl.W = 800;
  tl.drawTags(fakeCtx(), p);
  const g = tl._tagGeom.get('t1');
  assert.ok(g && g.delX > 0, '× 几何登记（glyph 保留）');
  let editOpened = 0;
  tl.openTagEditor = () => { editOpened++; };
  cv._hs.pointerdown[0]({ clientX: g.delX, clientY: 31, pointerId: 1, pointerType: 'mouse' });
  assert.equal(editOpened, 1, '点按 ×=打开既有改名/编辑 popover（_openTagInput 系）');
  assert.equal(tl.activeTag, 't1', '选中（点选态）');
  assert.deepEqual(rec.labels, [], '零历史（原「删标记」路径退役）');
  assert.deepEqual(rec.muts, [], '零数据写入');
  assert.equal(p.timeline.tags.length, 1, 'tag 仍在');
});

test('单击旗点（stage）：=选中+编辑 popover，不再定位播放线；拖旗移位提交既有不回退', () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: 'A', beat: 6 }];
  const { tl, cv, rec } = makeTL(p, { mode: 'stage' });
  let editOpened = 0;
  tl.openTagEditor = () => { editOpened++; };
  cv._hs.pointerdown[0]({ clientX: 60, clientY: 31, pointerId: 1, pointerType: 'mouse' }); // beat6 → x=60
  assert.equal(tl.drag && tl.drag.kind, 'tag', '按下=拖旗预备（既有）');
  assert.deepEqual(rec.seeks, [], '按下不 seek（既有）');
  tl._up({ pointerId: 1 });
  assert.equal(editOpened, 1, '抬起未移动=打开编辑 popover');
  assert.equal(tl.activeTag, 't1');
  assert.deepEqual(rec.seeks, [], '「单击跳转」退役：零 seek');
  assert.deepEqual(rec.commits, [], '零历史');
  // 拖旗移位（moved）既有提交不回退
  cv._hs.pointerdown[0]({ clientX: 60, clientY: 31, pointerId: 2, pointerType: 'mouse' });
  cv._hs.pointermove[0]({ clientX: 42, clientY: 31, pointerId: 2, pointerType: 'mouse' }); // 4.2 拍 → 吸小节线 4
  tl._up({ pointerId: 2 });
  assert.equal(p.timeline.tags[0].beat, 4, '磁吸小节线（既有）');
  assert.deepEqual(rec.commits, ['移动标记'], '恰一条历史（既有）');
});

test('触摸长按旗点（stage）：满 550ms → tag 菜单（onSegContextMenu；删除唯二轨道入口之一）', async () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: 'A', beat: 6 }];
  const { tl, cv, rec } = makeTL(p, { mode: 'stage' });
  cv._hs.pointerdown[0]({ clientX: 60, clientY: 31, pointerId: 1, pointerType: 'touch' });
  await new Promise(r => setTimeout(r, 650));
  assert.equal(rec.segMenus.length, 1, '长按弹 tag 菜单（与右键同源）');
  assert.equal(rec.segMenus[0].tagId, 't1');
  assert.equal(tl.drag, null, '长按生效：待定拖拽作废（既有口径）');
});

test('触摸短按旗点（stage）：未满时长抬起 → 不弹菜单（单击编辑走 _up 分支）', async () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: 'A', beat: 6 }];
  const { tl, cv, rec } = makeTL(p, { mode: 'stage' });
  cv._hs.pointerdown[0]({ clientX: 60, clientY: 31, pointerId: 1, pointerType: 'touch' });
  winHs.pointerup[0]({ pointerId: 1 });
  await new Promise(r => setTimeout(r, 650));
  assert.equal(rec.segMenus.length, 0, '抬起取消长按计时（既有口径）');
  assert.equal(tl.activeTag, 't1', '短按=选中+编辑（_up 分支）');
});

test('右键旗点（stage）：=tag 菜单（preventDefault+onSegContextMenu）；空白右键保持浏览器默认', () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: 'A', beat: 6 }];
  const { tl, cv, rec } = makeTL(p, { mode: 'stage' });
  let prevented = 0;
  const ev = x => ({ clientX: x, clientY: 31, preventDefault: () => { prevented++; } });
  cv._hs.contextmenu[0](ev(60)); // 旗点 x=60
  assert.equal(prevented, 1);
  assert.equal(rec.segMenus.length, 1);
  assert.equal(rec.segMenus[0].tagId, 't1');
  cv._hs.contextmenu[0](ev(400)); // 空白（beat 20 无 tag）
  assert.equal(prevented, 1, '空白右键不 preventDefault（浏览器默认保留）');
  assert.equal(rec.segMenus.length, 1, '空白不弹 tag 菜单');
});

test('music 区域单击（回归）：仍=仅选中（零 seek 零历史零删除；build-49 F2 不回退）', () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't', beat: 16, name: 'T', endBeat: 32 }];
  const { tl, cv, rec } = makeTL(p, { mode: 'music' });
  cv._hs.pointerdown[0]({ clientX: 210, clientY: 30, pointerId: 1, pointerType: 'mouse' }); // 拍 21 ∈ T[16,32)
  tl._up({ pointerId: 1 });
  assert.equal(tl.selSegId, 't', '单击区域=仅选中');
  assert.deepEqual(rec.seeks, [], '不定位播放线');
  assert.deepEqual(rec.commits, [], '零历史');
  assert.deepEqual(rec.labels, [], '零删除（区域本无点按删除路径）');
});

// ---------- 静态断言：删除入口收敛 ----------
test('静态断言：_down 划分轨分支不再有 removeTag 直删；× 点按分流经 tagHitAction 纯函数', () => {
  assert.ok(!srcTl.includes('removeTag(p2, delId)'), '点按即删除路径已退役');
  assert.match(srcTl, /tagHitAction\('tag'\) === 'edit'/, '× 点按/单击旗分流经纯函数');
  assert.match(srcTl, /export function tagHitAction/, '分流函数导出（node 可测）');
  assert.match(srcTl, /export function zoomAnchorSec/, '缩放锚函数导出（node 可测）');
});
