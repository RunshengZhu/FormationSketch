// build-79-wave1：时间轴四项（需求 2 / 7a / 8 / 9）+ 需求 1 的 timeline 半边——node 单测。
//   ① × 不再绘制（需求 2）：stub ctx 记录 fillText，drawTags 悬停/点选态均无 '×'；源静态兜底。
//   ② clipEdgeHit 命中分流纯函数（需求 7a）：'l'|'r'|'body'，边界热区钳制 ≤1/3 块宽；
//     桩实例：短 clip 块身单击=选中/拖动（fcMove）、缘仍可抓（clipL）。
//   ③ stageLaneHOf 钳制纯函数（需求 8）：clamp [STAGE_LANE_MIN_H, STAGE_LANE_MAX_H]=[56,160]。
//   ④ trackLaneHOf 读取回退（需求 9①）：缺省/非法 → 推导值；合法 → 钳 [24,240]；
//     桩实例逐轨几何（laneTopOf/audioBottom/laneIndexAt/预览钳）+ 轨头交界拖动落盘断言。
//   ⑤ description 编辑器读写走 mutate（需求 1 的 timeline 半边）：桩实例断言预填/落键/空串删键。
// DOM 桩沿用 tests/wavezoom.test.js 口径（无真实 canvas 2D）；document 桩仅本文件内安装/卸载。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MusicTimeline, clipEdgeHit, trackLaneHOf,
  STAGE_LANE_DEFAULT_H, TRACK_LANE_H_MIN, TRACK_LANE_H_MAX,
  FC_EDGE_HIT_PX, TAG_LANE_H,
} from '../js/timeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcTl = readFileSync(join(root, 'js/timeline.js'), 'utf8');

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
const winHs = {};
window.addEventListener = (t, fn) => { (winHs[t] = winHs[t] || []).push(fn); };

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
// 记录 fillText 文本的 2D 桩（①：断言无 '×' 呈示）
function recordingCtx() {
  const texts = [];
  const ctx = {
    texts,
    save() {}, restore() {},
    fillRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {},
    fillText(s) { texts.push(String(s)); },
    measureText: s => ({ width: String(s).length * 6 }),
    font: '', textBaseline: '', strokeStyle: '', fillStyle: '', lineWidth: 1,
  };
  return ctx;
}
function makeProj() {
  return {
    audio: { bpm: 120, beatsPerBar: 4, firstBeatSec: 0, name: '', durationSec: 40 },
    timeline: {
      tags: [],
      tracks: [{ id: 'trk1', name: '配乐', gain: 1, muted: false }, { id: 'trk2', name: '音效', gain: 1, muted: false }],
      audioClips: [],
    },
    formations: [{ id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [], startBeat: 0, lenBeats: 16 }],
    media: { assets: [{ id: 'a1', name: '曲一', durationSec: 40 }] },
  };
}
function makeTL(proj = makeProj(), { mode = 'stage' } = {}) {
  winHs.pointerup = [];
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  const rec = { muts: [], labels: [], seeks: [], commits: [], renders: 0, sel: [] };
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => proj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      canEdit: () => true,
      onSelectFormation: i => { rec.sel.push(i); },
      mutate: fn => { fn(proj); rec.muts.push(null); },
      mutateQuiet: fn => { fn(proj); rec.muts.push(null); },
      mutateLabeled: (fn, label) => { fn(proj); rec.labels.push(label); },
      commitEdit: label => { rec.commits.push(label); },
      seekBeat: b => { rec.seeks.push(b); },
      toast: () => {},
      pauseIfPlaying: () => {},
      onTimeSelection: () => {},
      onSegContextMenu: () => {},
    },
  });
  tl.mode = mode;
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; };
  return { tl, cv, sc, proj, rec };
}

// ---------- ① 需求 2：× 不再绘制（stage 旗点纯旗） ----------
test('① drawTags 无 × 呈示：悬停/点选态均不画 ×（旗点纯旗）；名称尾命中几何 delX 保留（点按=编辑语义）', () => {
  const p = makeProj();
  p.timeline.tags = [{ id: 't1', name: '副歌', beat: 6 }];
  const { tl } = makeTL(p, { mode: 'stage' });
  tl.W = 800;
  // 常态
  let ctx = recordingCtx();
  tl.drawTags(ctx, p);
  assert.ok(!ctx.texts.some(s => s.includes('×')), '常态：无 × fillText');
  assert.ok(tl._tagGeom.get('t1')?.delX > 0, '名称尾命中几何仍登记（build-77 点按=编辑语义保留）');
  // 悬停 + 点选态（原 × 显示条件）也不再画 ×
  tl.hoverTag = 't1'; tl.activeTag = 't1';
  ctx = recordingCtx();
  tl.drawTags(ctx, p);
  assert.ok(!ctx.texts.some(s => s.includes('×')), 'hover/active 态：无 × fillText（选中态高亮保留在旗面）');
  // 源静态兜底：整文件无 fillText('×')
  assert.ok(!srcTl.includes("fillText('×'"), 'timeline.js 源无 fillText(\'×\')');
  assert.equal(TAG_LANE_H, 18, 'E-12：tag 道高不动');
});

// ---------- ② 需求 7a：clipEdgeHit 命中分流（边界钳制 1/3 块宽） ----------
test('② clipEdgeHit：l/r/body 分流 + 块外 ±e 抓缘带 + 1/3 块宽钳制（短块块身必存）', () => {
  // 长块（100px，e=8）：体/缘/块外抓缘带
  assert.equal(clipEdgeHit(0, 100, 50), 'body', '块身中部=body');
  assert.equal(clipEdgeHit(0, 100, 5), 'l', '左缘热区');
  assert.equal(clipEdgeHit(0, 100, -7), 'l', '块外 ±e 内仍算左缘（旧「空隙抓缘」保留）');
  assert.equal(clipEdgeHit(0, 100, -9), 'body', '块外超出 ±e=body（落空）');
  assert.equal(clipEdgeHit(0, 100, 96), 'r');
  assert.equal(clipEdgeHit(0, 100, 108), 'r');
  assert.equal(clipEdgeHit(0, 100, 109), 'body');
  // 1/3 块宽钳制：18px 块 e=min(8,6)=6 → 体=(6,12)
  assert.equal(clipEdgeHit(0, 18, 6), 'l', '钳制后左热区=6px（≤1/3 块宽）');
  assert.equal(clipEdgeHit(0, 18, 7), 'body', '热区外块身=body（旧 ±10 全宽命中会把这里吃掉）');
  assert.equal(clipEdgeHit(0, 18, 12), 'r');
  // 极窄块（6px）：e=min(8,2)=2 → 体=(2,4)——1/3 钳制下两侧热区对 w>0 恒不重叠（块身必存）
  assert.equal(clipEdgeHit(0, 6, 1), 'l');
  assert.equal(clipEdgeHit(0, 6, 3), 'body', '极窄块仍有 1/3 宽块身（需求 7a 不变量）');
  assert.equal(clipEdgeHit(0, 6, 5), 'r');
  // 退化/非法入参不抛、回 body
  assert.equal(clipEdgeHit(5, 5, 5), 'body', '零宽块=body');
  assert.equal(clipEdgeHit(0, 100, NaN), 'body', 'px 非有限=body');
  assert.equal(clipEdgeHit(0, 100, 5, 0), 'body', 'edgePx 非正=body（热区关）');
  assert.equal(clipEdgeHit(0, 100, 5, Number.NaN), 'body');
  assert.equal(FC_EDGE_HIT_PX, 8, '需求钉值：固定 8px');
});

test('② 桩实例：短 clip（10px 宽）块身单击=选中+fcMove（不再被缘热区吃掉）；缘 ±8px 仍可抓', () => {
  const p = makeProj();
  p.formations = [{ id: 'f1', name: '短', color: '#64748b', positions: {}, merges: [], startBeat: 0, lenBeats: 0.5 }]; // 0.5 拍=10px
  const { tl, cv, rec } = makeTL(p, { mode: 'stage' });
  tl.blocksTop = 72; tl.blocksH = 36; // 手工落块区带（render 桩未跑）
  // 块身中部 x=5：旧 ±10px 缘命中=clipL（缺陷）；现 e=min(8,10/3)≈3.3 → body → 选中/拖动
  cv._hs.pointerdown[0]({ clientX: 5, clientY: 88, pointerId: 1, pointerType: 'mouse' });
  assert.equal(tl.drag && tl.drag.kind, 'fcMove', '块身=拖动待定（需求 7a 修复）');
  assert.deepEqual(rec.sel, [0], '块身单击选中队形');
  tl._up({ pointerId: 1 });
  // 缘仍可抓：x=1（距左缘 1px < 3.3）→ clipL 改长度
  cv._hs.pointerdown[0]({ clientX: 1, clientY: 88, pointerId: 2, pointerType: 'mouse' });
  assert.equal(tl.drag && tl.drag.kind, 'clipL', '左缘热区仍在（收窄不减功能）');
  tl._up({ pointerId: 2 });
});

// ---------- ③ build-91-varispeed：编舞道高恒定（需求 8 拖高联动整体退役） ----------
test('③ 编舞道高恒定：STAGE_LANE_DEFAULT_H=56（内容 128）；拖高联动函数已退役', async () => {
  const { STAGE_LANE_DEFAULT_H: DEF } = await import('../js/timeline.js');
  assert.equal(DEF, 56, '恒定道高钉值');
  const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');
  assert.ok(!tlSrc.includes('stageLaneHOf'), '容器联动推导函数已删除（残留清零）');
  assert.ok(!tlSrc.includes('STAGE_LANE_MIN_H') && !tlSrc.includes('STAGE_LANE_MAX_H'), '钳制常量已退役');
  assert.ok(!tlSrc.includes('_stageLaneH'), '实例推导方法已删除');
  const defAt = tlSrc.indexOf('totalHeightFor() {');
  const th = tlSrc.slice(defAt, defAt + 260); // 恰含本方法体（下一方法 totalHeightMusic 的合法 _containerH 不入窗）
  assert.ok(th.includes('return this.blocksTopFor() + STAGE_LANE_DEFAULT_H;'), 'totalHeightFor = 其它行 + 恒定道高');
  assert.ok(!th.includes('_containerH'), 'totalHeightFor 零 _containerH 引用（反馈环根除维持）');
});

// ---------- ④ 需求 9①：trackLaneHOf 读取回退 + 逐轨几何 + 轨头交界拖动落盘 ----------
test('④ trackLaneHOf：缺省/非法 → 推导值回退；合法数值钳 [24,240]', () => {
  assert.equal(TRACK_LANE_H_MIN, 24, '需求钉值下限');
  assert.equal(TRACK_LANE_H_MAX, 240, '需求钉值上限');
  assert.equal(trackLaneHOf({ laneH: 200 }, 90), 200, '合法数值原样（范围内）');
  assert.equal(trackLaneHOf({ laneH: 300 }, 90), 240, '超上界钳 240');
  assert.equal(trackLaneHOf({ laneH: -5 }, 90), 24, '负值钳 24');
  assert.equal(trackLaneHOf({}, 90), 90, '缺省 → 推导值回退');
  assert.equal(trackLaneHOf({ laneH: 'x' }, 88), 88, '非法 → 推导值回退');
  assert.equal(trackLaneHOf(null, 72), 72, '无轨 → 推导值回退');
});

test('④ 桩实例逐轨几何：无覆写=推导值逐值不变；track.laneH 覆写→laneTopOf/audioBottom/laneIndexAt 逐轨生效；预览钳 [24,240]', () => {
  const p = makeProj(); // 2 轨
  const { tl } = makeTL(p, { mode: 'music' });
  tl._mLaneH = 90; // 推导值（musicLaneH 产出桩定）
  // 无覆写：逐轨=推导值（回退路径）
  assert.equal(tl.trackLaneHPx(p, 0), 90, '缺省 track.laneH → 推导值');
  assert.equal(tl.trackLaneHPx(p, 1), 90);
  // 轨 2 覆写 laneH=200 → 逐轨生效
  p.timeline.tracks[1].laneH = 200;
  const audioTop = tl.audioTop(); // 22+28=50
  assert.equal(audioTop, 50);
  assert.equal(tl.laneTopOf(p, 0), 50, '首 lane 顶=audioTop');
  assert.equal(tl.laneTopOf(p, 1), 50 + 90 + 12, 'lane1 顶=audioTop+lane0 高+gap');
  assert.equal(tl.audioBottom(p), 50 + 90 + 200 + 12, 'audioBottom=逐轨求和+gap');
  assert.equal(tl.laneIndexAt(p, 100), 0, 'lane0 内→0');
  assert.equal(tl.laneIndexAt(p, 40), 0, 'audioTop 之上钳首 lane');
  assert.equal(tl.laneIndexAt(p, 200), 1, 'lane1 内→1');
  assert.equal(tl.laneIndexAt(p, 9999), 1, '越界钳末 lane');
  // 拖动中预览（内存）优先且钳 [24,240]
  tl._laneHPreview.set('trk2', 260);
  assert.equal(tl.trackLaneHPx(p, 1), 240, '预览钳上界');
  tl._laneHPreview.set('trk2', 10);
  assert.equal(tl.trackLaneHPx(p, 1), 24, '预览钳下界');
  tl._laneHPreview.delete('trk2');
  assert.equal(tl.trackLaneHPx(p, 1), 200, '预览清除后回模型值');
});

// 轨头桩：行几何可控的 #tl-tracks-head（_wireTracksHeadLaneGrip 容器级监听驱动）
function headStub(heights) {
  const hs = {};
  const rows = heights.map((h, i) => ({
    getBoundingClientRect: () => ({ top: 100 + i * (h + 12), bottom: 100 + i * (h + 12) + h, height: h }),
    style: {},
  }));
  const box = {
    _hs: hs, style: {},
    classList: { contains: () => false },
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    querySelectorAll: sel => (sel === '.tlh-track' ? rows : []),
  };
  return { box, rows, hs };
}
// document 桩安装/卸载（本文件内安全；node --test 每文件独立进程不外溢）
const realDoc = globalThis.document;
let realRaf = null;
function installDom(getById) {
  globalThis.document = {
    getElementById: getById,
    createElement: () => { throw new Error('本套件 document 桩不承载 createElement'); },
    addEventListener() {}, removeEventListener() {},
    body: { append() {}, children: [] },
  };
}
function uninstallDom() { if (realDoc === undefined) delete globalThis.document; else globalThis.document = realDoc; }

test('④ 轨头交界拖动（需求 9①）：预览内存值实时反馈；pointerup 恰一条「调整轨道高度」写 track.laneH；取消零写入', () => {
  const p = makeProj();
  const { box, rows, hs } = headStub([90, 90]);
  installDom(id => (id === 'tl-tracks-head' ? box : null));
  let tl = null;
  let rec = null;
  try {
    const inst = makeTL(p, { mode: 'music' });
    tl = inst.tl; rec = inst.rec;
    tl._mLaneH = 90;
    assert.ok(hs.pointerdown?.length, '容器级监听已挂（buildTracksHead 重建不丢）');
    // 按下行 0 底缘上方 3px（交界热区）→ 开始拖动
    hs.pointerdown[0]({ pointerId: 7, pointerType: 'mouse', clientY: 100 + 90 - 3, target: { closest: () => null }, preventDefault() {} });
    assert.equal(tl._laneHDrag?.trackId, 'trk1', '交界命中=轨 1');
    // 拖 +60 → 预览 150（内存，未落盘）
    hs.pointermove[0]({ pointerId: 7, clientY: 100 + 90 - 3 + 60 });
    assert.equal(tl._laneHPreview.get('trk1'), 150, '预览=内存值');
    assert.equal(rows[0].style.height, '150px', '轨头卡片行内高即时反馈');
    assert.equal(p.timeline.tracks[0].laneH, undefined, '拖动中零落盘');
    // 抬起 → mutateLabeled 恰一条历史 + track.laneH 落盘
    hs.pointerup[0]({ pointerId: 7, type: 'pointerup' });
    assert.deepEqual(rec.labels, ['调整轨道高度'], '恰一条「调整轨道高度」历史（既有 mutate/commit 通道）');
    assert.equal(tl._laneHDrag, null, '拖动态清理');
    assert.equal(tl._laneHPreview.size, 0, '预览清零（模型为唯一事实源）');
  } finally {
    uninstallDom();
  }
  assert.equal(p.timeline.tracks[0].laneH, 150, 'pointerup 落盘 track.laneH（数值 px）');
  // pointercancel：回滚零写入
  const p2 = makeProj();
  const h2 = headStub([90, 90]);
  installDom(id => (id === 'tl-tracks-head' ? h2.box : null));
  try {
    const t2 = makeTL(p2, { mode: 'music' }).tl;
    t2._mLaneH = 90;
    h2.hs.pointerdown[0]({ pointerId: 8, pointerType: 'mouse', clientY: 187, target: { closest: () => null }, preventDefault() {} });
    h2.hs.pointermove[0]({ pointerId: 8, clientY: 300 }); // 拖到 203（>240 也无妨，取消不落盘）
    h2.hs.pointercancel[0]({ pointerId: 8, type: 'pointercancel' });
    assert.equal(t2._laneHDrag, null, '拖动态清理');
    assert.equal(t2._laneHPreview.size, 0, '预览清零');
  } finally {
    uninstallDom();
  }
  assert.equal(p2.timeline.tracks[0].laneH, undefined, '取消零写入（无历史无模型变更）');
});

// ---------- ⑤ 需求 1（timeline 半边）：description 编辑器读写走 mutate ----------
// 极简 DOM 桩（只承载 _openTagInput 的 popover 构建路径）
function elStub(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], style: {}, attrs: {},
    className: '', value: '', textContent: '', _ls: listeners, _parent: null,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = v; if (k === 'value') el.value = v == null ? '' : String(v); },
    append(...cs) { for (const c of cs.flat()) if (c != null) { c._parent = el; el.children.push(c); } },
    contains() { return false; },
    remove() { if (el._parent) { const i = el._parent.children.indexOf(el); if (i >= 0) el._parent.children.splice(i, 1); } },
    focus() {}, select() {},
    get offsetWidth() { return 200; },
    get offsetHeight() { return 150; },
  };
  return el;
}
function collect(rootEl, out = []) {
  for (const c of rootEl.children || []) { out.push(c); collect(c, out); }
  return out;
}
function installPopoverDom() {
  realRaf = globalThis.requestAnimationFrame;
  if (typeof realRaf !== 'function') globalThis.requestAnimationFrame = () => {};
  const body = elStub('body');
  globalThis.document = {
    getElementById: () => null,
    createElement: t => elStub(t),
    createTextNode: s => ({ nodeType: 3, textContent: String(s) }),
    addEventListener() {}, removeEventListener() {},
    body,
  };
  return body;
}
function uninstallPopoverDom() {
  if (realDoc === undefined) delete globalThis.document; else globalThis.document = realDoc;
  if (typeof realRaf === 'function') globalThis.requestAnimationFrame = realRaf; else delete globalThis.requestAnimationFrame;
}

test('⑤ 描述编辑器（需求 1）：popover 预填既有描述；确定经 mutateLabeled「编辑标记」写 tag.description（trim）；清空=删键', () => {
  const p = makeProj();
  p.timeline.tracks = [p.timeline.tracks[0]]; // 单轨即可
  p.timeline.tags = [{ id: 't1', name: '副歌', beat: 6, endBeat: 22, description: '  旧描述  ' }];
  const { tl, rec } = makeTL(p, { mode: 'stage' });
  const body = installPopoverDom();
  try {
    tl._openTagInput({ id: 't1' });
    const pop = body.children.at(-1);
    const inputs = collect(pop).filter(e => e.tagName === 'INPUT');
    const desc = inputs.find(e => e.attrs.maxlength === '200');
    assert.ok(desc, '描述输入存在（maxlength 200，随名称/节奏骨架同构）');
    assert.equal(desc.value, '  旧描述  ', '读：popover 预填既有 tag.description');
    desc.value = '  副歌入口 · 面向观众席  ';
    const ok = collect(pop).find(e => e.tagName === 'BUTTON' && String(e.className).includes('um-cur'));
    assert.ok(ok, '确定钮存在');
    ok._ls.click[0]();
    assert.deepEqual(rec.labels, ['编辑标记'], '恰一条既有「编辑标记」历史（mutate 提交通道）');
    assert.equal(p.timeline.tags[0].description, '副歌入口 · 面向观众席', '写：trim 后落键');
    // 清空 → 删键（缺省 shape 不落盘）
    tl._openTagInput({ id: 't1' });
    const pop2 = body.children.at(-1);
    const desc2 = collect(pop2).find(e => e.tagName === 'INPUT' && e.attrs.maxlength === '200');
    assert.equal(desc2.value, '副歌入口 · 面向观众席', '复开预填上次值');
    desc2.value = '   ';
    collect(pop2).find(e => e.tagName === 'BUTTON' && String(e.className).includes('um-cur'))._ls.click[0]();
    assert.ok(!('description' in p.timeline.tags[0]), '空串=删键（sanitizeTags 语义对齐）');
    assert.equal(p.timeline.tags[0].name, '副歌', '名称不受描述清空影响');
  } finally {
    uninstallPopoverDom();
  }
});

// ---------- 需求 9②：空白=兜底 seek（块区之下留白单击/拖动=定位播放线） ----------
test('⑨② music 空白兜底 seek：块区之下留白单击=scrub+定位；既有命中优先级不回退', () => {
  const p = makeProj();
  p.timeline.tracks = [p.timeline.tracks[0]];
  const { tl, cv, rec } = makeTL(p, { mode: 'music' });
  tl.blocksTop = 72; tl.blocksH = 36; tl._mLaneH = 120; // audioBottom=50+120=170；块区带 72..108
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 200, pointerId: 1, pointerType: 'mouse' }); // 块区之下留白
  assert.equal(tl.drag && tl.drag.kind, 'scrub', '空白按下=scrub 拖拽态（兜底命中面）');
  assert.deepEqual(rec.seeks, [20], 'x=200px/pps20=10s → beat 20（秒制基座换算）');
  tl._up({ pointerId: 1 });
  // 优先级不回退：音频 lane 空白仍是时间选区语义（music 满血，不经兜底分支）
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 100, pointerId: 2, pointerType: 'mouse' }); // y=100 ∈ 音频 lane（50..170）
  assert.equal(tl.drag && tl.drag.kind, 'timeSel', '音频 lane 空白=时间选区（既有优先级，不被兜底吞）');
  tl._up({ pointerId: 2 });
  // stage 同享兜底：块区之下留白单击=scrub
  const { tl: st, cv: scv, rec: srec } = makeTL(makeProj(), { mode: 'stage' });
  st.blocksTop = 72; st.blocksH = 36;
  scv._hs.pointerdown[0]({ clientX: 100, clientY: 150, pointerId: 3, pointerType: 'mouse' });
  assert.equal(st.drag && st.drag.kind, 'scrub', 'stage 留白兜底 seek（两模式对齐）');
  assert.equal(srec.seeks[0], 10, 'x=100px/pps20=5s → beat 10');
});

// ---------- 静态：新出口与接线在源 ----------
test('静态：clipEdgeHit/stageLaneHOf/trackLaneHOf 导出（node 可测）+ 轨头拖动走 mutateLabeled「调整轨道高度」', () => {
  assert.match(srcTl, /export function clipEdgeHit/, '命中分流导出');
  assert.match(srcTl, /export const STAGE_LANE_DEFAULT_H = 56/, 'stage 道高恒定常量（build-83）');
  assert.match(srcTl, /export function trackLaneHOf/, '轨级 laneH 回退导出');
  assert.match(srcTl, /'调整轨道高度'/, '拖动提交历史名');
  assert.match(srcTl, /t\.laneH = hh;/, 'pointerup 写 track.laneH（数值 px）');
  assert.match(srcTl, /this\._wireTracksHeadLaneGrip\(\);/, '轨头交界接线（_bind 尾部）');
  assert.match(srcTl, /if \(desc\) t\.description = desc; else delete t\.description;/, '描述空串删键语义');
});

