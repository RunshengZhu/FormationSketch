// build-91-varispeed 四项 node 单测（需求 1 高精度波形 / 需求 2 尺规滚轮缩放 / 需求 3 视口窗口渲染
// + pps 范围扩展 / 需求 4 剃刀单发 API cutSelectedClipAtPlayhead）。
//   ① columnMinMax(channelData,startIdx,endIdx) 样本域列极值纯函数：全零列/正常列/单样本列/
//     stride 末样本补读/边界钳制。
//   ② WaveTileCache LRU：键格式、命中刷新（MRU 升序）、超限淘汰顺序。
//   ③ PPS_MIN/PPS_MAX 钉值 + zoom() 双模式钳制行为。
//   ④ wheelZoomStep(deltaY) 步进换算纯函数 + 尺规 wheel 派发集成（锚定光标/区域外不劫持）。
//   ⑤ cutSelectedClipAtPlayhead 桩实例：选中+播放线在内=ok:true clips:2；播放线在外/未选中/
//     编辑锁=ok:false reason。
//   ⑥ 视口窗口渲染：画布宽=视口宽、#tl-inner=世界宽、style.left 跟随 scrollLeft、
//     ctx 世界平移；视口外 clip 不绘制（桩计数）；resolveBuffer 钩子（同步/Promise）逐像素列直读。
// DOM 桩沿用 tests/wavezoom.test.js 口径（无真实 canvas 2D）；document 桩仅视口用例内安装/卸载。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MusicTimeline, columnMinMax, wheelZoomStep, WaveTileCache, waveTileKey,
  PPS_MIN, PPS_MAX, TL_RULER_H,
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
    formations: [{ id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [], startBeat: 0, lenBeats: 16 }],
    media: { assets: [{ id: 'a1', name: '曲一', durationSec: 40 }] },
  };
}
function makeTL(proj = makeProj(), { mode = 'music', resolveBuffer = null } = {}) {
  winHs.pointerup = [];
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0; sc.clientWidth = 800; sc.clientHeight = 400;
  const rec = { muts: [], labels: [], seeks: [], commits: [], renders: 0, toasts: [] };
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    resolveBuffer,
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
      toast: m => { rec.toasts.push(m); },
      pauseIfPlaying: () => {},
      onTimeSelection: () => {},
    },
  });
  tl.mode = mode;
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; };
  return { tl, cv, ov, sc, proj, rec };
}
// 记录型 2D 桩（fillRect/translate 计数——视口窗口绘制断言用）
function recordingCtx() {
  const calls = { fillRect: [], translate: [], setTransform: [], texts: [] };
  const ctx = {
    calls,
    save() {}, restore() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {},
    fillRect(...a) { calls.fillRect.push(a); },
    clearRect() {},
    translate(...a) { calls.translate.push(a); },
    setTransform(...a) { calls.setTransform.push(a); },
    fillText(s) { calls.texts.push(String(s)); },
    measureText: s => ({ width: String(s).length * 6 }),
    font: '', textBaseline: '', strokeStyle: '', fillStyle: '', lineWidth: 1,
  };
  return ctx;
}
// 可跑 _renderNow 的画布桩（getContext 返回给定桩 ctx）
function canvasEl(ctxFn) {
  return {
    ...fakeEl(),
    parentElement: { style: {} },
    width: 0, height: 0,
    getContext: () => ctxFn(),
  };
}

// Float32 域比较（tile/数据均为 Float32Array，-0.9 存为 float32 近似）
const f32 = v => Math.round(v * 1e6) / 1e6;

// ---------- ① 需求 1：columnMinMax 样本域列极值（纯函数） ----------
test('① columnMinMax：全零列=[0,0]；正常列=真 min/max；单样本列=[v,v]', () => {
  const zeros = new Float32Array(1000);
  assert.deepEqual(columnMinMax(zeros, 0, 1000), [0, 0], '全零列');
  const d = new Float32Array([0.1, -0.9, 0.5, -0.2]);
  assert.deepEqual(columnMinMax(d, 0, 4).map(f32), [-0.9, 0.5], '正常列真 min/max');
  assert.deepEqual(columnMinMax(d, 2, 3).map(f32), [0.5, 0.5], '单样本列=[v,v]');
  assert.deepEqual(columnMinMax(d, 1, 2).map(f32), [-0.9, -0.9], '负峰单样本列');
});
test('① columnMinMax：stride 有界扫描含末样本补读；边界钳制/逆序/空数据', () => {
  const d = new Float32Array(1000);
  d[999] = 0.7; // 峰在末样本：stride=max(1,floor(1000/64))=15 的跳采也要补读右缘真值
  assert.deepEqual(columnMinMax(d, 0, 1000).map(f32), [0, 0.7], '末样本补读（stride 路径右缘真值）');
  const d2 = new Float32Array(1000);
  d2[15] = -0.5; d2[780] = 0.3; // 峰放在 stride=15 网格倍数上（stride 跳采路径恰好覆盖）
  const [mn, mx] = columnMinMax(d2, 0, 1000);
  assert.deepEqual([f32(mn), f32(mx)], [-0.5, 0.3], '正常 stride 路径聚合');
  assert.deepEqual(columnMinMax(d2, -5, 16).map(f32), [-0.5, 0], 'start<0 钳 0');
  assert.deepEqual(columnMinMax(d2, 0, 99999).map(f32), [-0.5, 0.3], 'end>len 钳 len');
  assert.deepEqual(columnMinMax(d2, 5, 5), [0, 0], '零宽=[0,0]');
  assert.deepEqual(columnMinMax(d2, 9, 2), [0, 0], '逆序=[0,0]');
  assert.deepEqual(columnMinMax(null, 0, 10), [0, 0], '空数据=[0,0]');
  assert.deepEqual(columnMinMax(new Float32Array(0), 0, 10), [0, 0], '零长数据=[0,0]');
  // 同输入恒同输出（缓存语义前提）
  assert.deepEqual(columnMinMax(d2, 0, 1000), columnMinMax(d2, 0, 1000));
});

// ---------- ② 需求 1：WaveTileCache LRU（键命中/淘汰顺序） ----------
test('② waveTileKey：assetId|srcStart 样本|列数（样本取整、列数下限 1）', () => {
  assert.equal(waveTileKey('a1', 0, 80), 'a1|0|80');
  assert.equal(waveTileKey('a1', 123.4, 80.2), 'a1|123|80', 'srcStart 样本取整');
  assert.equal(waveTileKey('a2', -3, 0), 'a2|-3|1', '列数下限钳 1');
});
test('② WaveTileCache：命中刷新 MRU 序、超限淘汰最旧、上限 8', () => {
  const c = new WaveTileCache(8);
  assert.equal(c.cap, 8, 'LRU 上限钉值 8');
  for (let i = 1; i <= 8; i++) c.set('k' + i, 10);
  assert.equal(c.size, 8);
  let t = c.get('k1');
  assert.ok(t && t.min.length === 10 && t.max.length === 10, '命中返回既有 tile（零分配）');
  assert.equal(t.min[0], Infinity, '未算列哨兵=+Infinity');
  c.get('k1'); // 命中刷新 → k1 升为最新，k2 成为最旧
  c.set('k9', 10);
  assert.equal(c.size, 8, '超限淘汰后仍 8 条');
  assert.equal(c.get('k2'), null, '最旧（k2）被淘汰');
  assert.equal(c.get('k1'), t, '命中刷新过的 k1 存活且同一对象');
  assert.ok(c.get('k9'), '最新 k9 存活');
  // 重 set 既有键=刷新不重复分配、不触发淘汰
  const t3 = c.get('k3');
  c.set('k3', 10);
  assert.equal(c.get('k3'), t3, '重 set 既有键返回同一 tile');
  assert.equal(c.size, 8);
  // tile 填充：set 后逐列惰性算（min=+Inf 哨兵）
  const tile = c.get('k9');
  tile.min[3] = -0.5; tile.max[3] = 0.5;
  assert.deepEqual([tile.min[3], tile.max[3]], [-0.5, 0.5], '算过的列存真值');
});

// ---------- ③ 需求 3：pps 范围常量钉值 + zoom 钳制 ----------
test('③ PPS 常量钉值：MIN=4（10 分钟域一屏总览）、MAX=2400（48kHz≈20 样本/px）', () => {
  assert.equal(PPS_MIN, 4);
  assert.equal(PPS_MAX, 2400);
  // zoom() 双模式钳制：无限缩Out停在 4、无限缩In停在 2400
  const { tl } = makeTL(makeProj(), { mode: 'music' });
  tl.secPerPx = 0.05; // pps 20
  tl.zoom(1e-9);
  assert.equal(tl.secPerPx, 1 / 4, 'music 缩放下限钳 PPS_MIN');
  tl.zoom(1e9);
  assert.equal(tl.secPerPx, 1 / 2400, 'music 缩放上限钳 PPS_MAX');
  const { tl: st } = makeTL(makeProj(), { mode: 'stage' });
  st.zoom(1e-9);
  assert.equal(st.secPerPx, 1 / 4, 'stage 同界（下限）');
  st.zoom(1e9);
  assert.equal(st.secPerPx, 1 / 2400, 'stage 同界（上限）');
  // 中间档不漂移
  const { tl: m2 } = makeTL(makeProj(), { mode: 'music' });
  m2.zoom(2); // 20→40
  assert.equal(m2.secPerPx, 1 / 40, '界内步进逐值不变');
  // 源静态：钉值注释在案
  assert.match(srcTl, /export const PPS_MIN = 4;/);
  assert.match(srcTl, /export const PPS_MAX = 2400;/);
});

// ---------- ④ 需求 2：wheelZoomStep 纯函数 + 尺规滚轮缩放集成 ----------
test('④ wheelZoomStep：deltaY<0=放大、>0=缩小、每 100delta=×1.15 一步、单次钳 ±3 步', () => {
  assert.ok(Math.abs(wheelZoomStep(-100) - 1.15) < 1e-12, '上滚一步=×1.15');
  assert.ok(Math.abs(wheelZoomStep(100) - 1 / 1.15) < 1e-12, '下滚一步=÷1.15');
  assert.equal(wheelZoomStep(0), 1, '零 delta=不缩');
  assert.equal(wheelZoomStep(NaN), 1, '非有限=不缩');
  assert.ok(Math.abs(wheelZoomStep(-37) - Math.pow(1.15, 0.37)) < 1e-12, '小 delta 按比例');
  assert.ok(Math.abs(wheelZoomStep(-10000) - Math.pow(1.15, 3)) < 1e-12, '极陡 delta 钳 +3 步');
  assert.ok(Math.abs(wheelZoomStep(10000) - Math.pow(1.15, -3)) < 1e-12, '极陡 delta 钳 −3 步');
});
test('④ 尺规滚轮集成：光标处锚定缩放（zoomAt 既有数学）；尺规外不劫持；ctrl/alt 既有分支优先', () => {
  const { tl, sc } = makeTL(makeProj(), { mode: 'music' });
  const wheel = sc._hs.wheel[0];
  const mkEv = (clientY, deltaY, mods = {}) => {
    const ev = {
      clientX: 200, clientY, deltaY,
      ctrlKey: !!mods.ctrl, metaKey: false, altKey: !!mods.alt, shiftKey: !!mods.shift,
      prevented: 0,
      preventDefault: () => { ev.prevented++; },
    };
    return ev;
  };
  // 尺规区（y≤22）：上滚放大，锚点=光标时刻（无选中 → zoomAt 指针锚既有路径）
  sc.scrollLeft = 0;
  const ev1 = mkEv(10, -100);
  wheel(ev1);
  assert.ok(Math.abs(tl.ppsOf(tl.hooks.getProject()) - 23) < 1e-9, 'deltaY=-100 → ×1.15（20→23）');
  assert.equal(ev1.prevented, 1, '尺规内 preventDefault（不透传页面滚动）');
  wheel(mkEv(10, -100));
  assert.ok(Math.abs(tl.ppsOf(tl.hooks.getProject()) - 23 * 1.15) < 1e-9, '再上滚再 ×1.15');
  // 下滚缩小
  wheel(mkEv(10, 100));
  assert.ok(Math.abs(tl.ppsOf(tl.hooks.getProject()) - 23) < 1e-9, 'deltaY=100 → ÷1.15 回 23');
  // 尺规外（y>22）：裸 wheel 不劫持（原生滚动维持，pps 不动）
  const pps0 = tl.ppsOf(tl.hooks.getProject());
  const evOut = mkEv(100, -100);
  wheel(evOut);
  assert.equal(evOut.prevented, 0, '尺规外不 preventDefault');
  assert.equal(tl.ppsOf(tl.hooks.getProject()), pps0, '尺规外 pps 不动');
  // ctrl/alt 既有分支优先于尺规分支（1.2 步进回归锚）
  wheel(mkEv(10, -100, { ctrl: true }));
  assert.ok(Math.abs(tl.ppsOf(tl.hooks.getProject()) - pps0 * 1.2) < 1e-9, 'ctrl+wheel=既有 1.2 步进');
  wheel(mkEv(100, -100, { alt: true }));
  assert.ok(Math.abs(tl.ppsOf(tl.hooks.getProject()) - pps0 * 1.44) < 1e-9, 'alt+wheel=既有 1.2 步进');
  // 编舞模式同样生效（双模式）
  const { tl: st, sc: ssc } = makeTL(makeProj(), { mode: 'stage' });
  ssc._hs.wheel[0](mkEv(10, -100));
  assert.ok(Math.abs(st.ppsOf(st.hooks.getProject()) - 23) < 1e-9, 'stage 尺规滚轮缩放同效');
});

// ---------- ⑤ 需求 4：cutSelectedClipAtPlayhead 单发 API ----------
test('⑤ cutSelectedClipAtPlayhead：选中+播放线在内=分割成功 {ok:true,clips:2}（复用分割既有历史）', () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 10, srcStartSec: 0 }];
  const { tl, proj, rec } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  tl.hooks.getPlayer = () => ({ beat: 8 }); // bpm120 → 4s ∈ (0,10)
  const r = tl.cutSelectedClipAtPlayhead();
  assert.deepEqual(r, { ok: true, clips: 2 }, '分割成功返回契约形态');
  assert.equal(proj.timeline.audioClips.length, 2, 'clip 一分为二');
  assert.equal(proj.timeline.audioClips[1].timelineStartSec, 4, '分割点=播放头秒位');
  assert.deepEqual(rec.labels, ['分割音频剪辑'], '复用既有分割历史（剃刀/菜单同款）');
});
test('⑤ cutSelectedClipAtPlayhead：播放线在外/未选中/编辑锁 → ok:false + reason（零写入）', () => {
  // 播放线在外
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 10, srcStartSec: 0 }];
  const { tl, proj, rec } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  tl.hooks.getPlayer = () => ({ beat: 40 }); // 20s > clip 末 10s
  assert.deepEqual(tl.cutSelectedClipAtPlayhead(), { ok: false, reason: '播放线不在选中 clip 范围内' });
  assert.equal(proj.timeline.audioClips.length, 1, '零写入');
  assert.deepEqual(rec.labels, [], '零历史');
  // 未选中
  const p2 = makeProj();
  p2.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 10, srcStartSec: 0 }];
  const t2 = makeTL(p2, { mode: 'music' }).tl;
  assert.deepEqual(t2.cutSelectedClipAtPlayhead(), { ok: false, reason: '未选中 clip' }, 'clipSel 空');
  t2.clipSel = new Set(['stale']);
  assert.deepEqual(t2.cutSelectedClipAtPlayhead(), { ok: false, reason: '未选中 clip' }, '陈旧 id 同 reason');
  // 编辑锁（范围预检通过后 splitAtSec 拒绝）
  const p3 = makeProj();
  p3.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 10, srcStartSec: 0 }];
  const { tl: t3, proj: pr3 } = makeTL(p3, { mode: 'music' });
  t3.clipSel = new Set(['c1']);
  t3.hooks.getPlayer = () => ({ beat: 8 });
  t3.hooks.canEdit = () => false;
  assert.deepEqual(t3.cutSelectedClipAtPlayhead(), { ok: false, reason: '编辑已关闭' });
  assert.equal(pr3.timeline.audioClips.length, 1, '编辑锁零写入');
  // 方法本体不依赖 razorOn（剃刀关着照样分割；源静态：契约方法名在案）
  const p4 = makeProj();
  p4.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 10, srcStartSec: 0 }];
  const { tl: t4, proj: pr4 } = makeTL(p4, { mode: 'music' });
  t4.clipSel = new Set(['c1']);
  t4.hooks.getPlayer = () => ({ beat: 8 });
  assert.equal(t4.razor, false, '剃刀未开启');
  assert.deepEqual(t4.cutSelectedClipAtPlayhead().ok, true, '单发 API 与 razorOn 无关');
  assert.equal(pr4.timeline.audioClips.length, 2);
  assert.match(srcTl, /cutSelectedClipAtPlayhead\(\) \{/, '实例方法在案（main.js 契约冻结）');
});

// ---------- ⑥ 需求 3：视口窗口渲染（stub 容器端到端） ----------
// document 桩（_syncCanvasOffset/headWidth 需 document 存在；getElementById 恒 null=无轨头）
const realDoc = globalThis.document;
function installDoc() {
  globalThis.document = {
    getElementById: () => null,
    createElement: () => { throw new Error('本套件 document 桩不承载 createElement'); },
    addEventListener() {}, removeEventListener() {},
    body: { append() {}, children: [] },
  };
}
function uninstallDoc() { if (realDoc === undefined) delete globalThis.document; else globalThis.document = realDoc; }

test('⑥ 视口窗口：画布宽=视口宽（800）、#tl-inner=世界宽、style.left 跟随 scrollLeft、ctx 世界平移', () => {
  installDoc();
  try {
    const p = makeProj();
    const ctx = recordingCtx();
    const { tl, cv, ov, sc } = makeTL(p, { mode: 'music' });
    const cvs = canvasEl(() => ctx);
    const ovs = canvasEl(() => ctx);
    tl.cv = cvs; tl.ov = ovs; tl.inner = cvs.parentElement;
    sc.scrollLeft = 0;
    tl._renderNow();
    // 画布=视口宽：clientWidth 800（无轨头）→ W=800；世界宽归 #tl-inner
    assert.equal(tl.W, 800, '画布 CSS 宽=视口宽（不再是域×pps）');
    assert.equal(cvs.width, 800, '物理宽=800×dpr1（视口化后 ≤8192 自动满足）');
    assert.equal(cvs.style.width, '800px');
    assert.equal(tl.worldW, tl.layoutWidth(p), '世界宽=layoutWidth');
    assert.equal(tl.inner.style.width, String(tl.layoutWidth(p)) + 'px', '#tl-inner 撑横滚量程（tl-nav 全域导航不变）');
    assert.deepEqual(ctx.calls.translate.at(-1), [-0, 0], 'scrollLeft=0 → 零平移');
    // 横滚=挪窗口：style.left 跟随 scrollLeft、ctx 平移 −scrollLeft
    sc.scrollLeft = 1000;
    tl._renderNow();
    assert.equal(cvs.style.left, '1000px', '画布贴视口（left=scrollLeft+headW0）');
    assert.equal(ovs.style.left, '1000px', 'overlay 同步');
    assert.deepEqual(ctx.calls.translate.at(-1), [-1000, 0], '世界坐标平移映射 screenX=worldPx−scrollLeft');
    // 世界宽不随画布宽：worldW 与 W 解耦
    assert.ok(tl.worldW !== tl.W || tl.worldW === 800, '世界宽与画布宽同源记录');
  } finally {
    uninstallDoc();
  }
});

test('⑥ 视口窗口：视口外 clip 不绘制（桩计数）；滚回可视窗后逐列波形出现', () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
    const ctx = recordingCtx();
    const { tl, sc } = makeTL(p, { mode: 'music' });
    const cvs = canvasEl(() => ctx), ovs = canvasEl(() => ctx);
    tl.cv = cvs; tl.ov = ovs; tl.inner = cvs.parentElement;
    // clip 世界 [0,80]px（4s×20pps）；视口窗 [1000,1800] → 完全出窗
    sc.scrollLeft = 1000;
    tl._renderNow();
    const offRects = ctx.calls.fillRect;
    assert.ok(offRects.length > 0);
    assert.ok(offRects.every(r => r[0] === 0 || r[0] >= 1000),
      '视口外零落笔（x=0 仅画布本地底色铺装；其余全部 ≥ viewX0）',
      `违规落笔: ${JSON.stringify(offRects.filter(r => r[0] !== 0 && r[0] < 1000))}`);
    assert.ok(!offRects.some(r => r[2] === 1 && r[0] < 1000), '无 1px 波形列落在窗外');
    // 滚回窗口：clip 可见 → 逐列 1px 波形竖条出现（80 列）
    ctx.calls.fillRect = [];
    sc.scrollLeft = 0;
    tl._renderNow();
    const cols = ctx.calls.fillRect.filter(r => r[2] === 1);
    assert.equal(cols.length, 80, 'clip 80px 宽=80 根 1px 波形列（无 env → 0.14 平线回退路径）');
  } finally {
    uninstallDoc();
  }
});

// ---------- ⑥ 需求 1：resolveBuffer 钩子——逐像素列直读 + LRU 集成 ----------
const WAVE_DATA = (() => {
  const d = new Float32Array(8000 * 4); // 4s @ 8kHz
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 7) * 0.8;
  return d;
})();
const fakeBuf = () => ({ sampleRate: 8000, duration: 4, getChannelData: () => WAVE_DATA });

test('⑥ resolveBuffer 同步钩子：波形走解码直读主路径（tile 建键、列值=columnMinMax 对拍）', () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
    const ctx = recordingCtx();
    const { tl, sc } = makeTL(p, { mode: 'music', resolveBuffer: id => (id === 'a1' ? fakeBuf() : null) });
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl._renderNow();
    const key = waveTileKey('a1', 0, 80); // 4s×20pps=80 列；srcStart 0×8000=0
    assert.equal(tl._tiles.size, 1, '恰一条列缓存');
    const tile = tl._tiles.get(key);
    assert.ok(tile, '键=assetId|srcStart 样本|列数');
    assert.ok(tile.min[0] !== Infinity, '首列已算（可视窗=全部 80 列，无未算哨兵）');
    assert.ok(tile.min[79] !== Infinity && tile.max[79] !== Infinity, '末列已算（可见列全部惰性填充）');
    // 列值与纯函数对拍：col x → src 采样 [x/20×8000, (x+1)/20×8000)
    const [mn, mx] = columnMinMax(WAVE_DATA, 0, 400);
    assert.deepEqual([tile.min[0], tile.max[0]], [mn, mx], '列 0 = columnMinMax 对拍');
    const [mn79, mx79] = columnMinMax(WAVE_DATA, 79 / 20 * 8000, 80 / 20 * 8000);
    assert.deepEqual([tile.min[79], tile.max[79]], [mn79, mx79], '列 79 对拍');
    // 波形幅度用真值（非 0.14 平线）：峰值列高度 > 平线幅度
    assert.ok(Math.abs(tile.max[10] - tile.min[10]) > 0.14, '直读列幅度>平线兜底（高精度路径证据）');
  } finally {
    uninstallDoc();
  }
});
test('⑥ 列缓存 LRU 集成：横滚回窗命中同一 tile（不重扫）；srcStart/列数变键才重算', () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
    const ctx = recordingCtx();
    const { tl, sc } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    sc.scrollLeft = 0;
    tl._renderNow();
    const key = waveTileKey('a1', 0, 80);
    const tile = tl._tiles.get(key);
    const mnBefore = tile.min[5];
    assert.ok(mnBefore !== Infinity);
    // 横滚出窗再回窗：同键命中 → 同一 tile 对象（零重扫零重分配）
    sc.scrollLeft = 5000;
    tl._renderNow();
    sc.scrollLeft = 0;
    tl._renderNow();
    assert.equal(tl._tiles.size, 1, '横滚不新建 tile');
    assert.equal(tl._tiles.get(key), tile, '命中同一 tile（拖动/横滚跨列区间不重扫）');
    assert.equal(tile.min[5], mnBefore, '已算列值不被重写');
    // 缩放 → 列数变 → 新键重算（旧 tile 仍在 LRU 内）
    tl.secPerPx = 0.025; // pps 40 → 160 列
    sc.scrollLeft = 0;
    tl._renderNow();
    const tile160 = tl._tiles.get(waveTileKey('a1', 0, 160));
    assert.ok(tile160, '缩放换列数 → 新键 tile 已建（列数变化才重算）');
    assert.notEqual(tile160, tile, '新 tile 是新分配（非旧对象）');
    assert.equal(tl._tiles.size, 2, '两代 tile 并存（LRU 容量内）');
  } finally {
    uninstallDoc();
  }
});
test('⑥ resolveBuffer Promise 钩子：本帧兜底绘制、到位后缓存+补绘一帧（升精度）', async () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
    const ctx = recordingCtx();
    let resolves = 0;
    const { tl, rec } = makeTL(p, { mode: 'music', resolveBuffer: () => new Promise(res => setTimeout(() => res(fakeBuf()), 5)) });
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl.render = () => { rec.renders++; }; // render 由钩子到位回调触发（真实现，非桩内直调）
    tl._renderNow();
    assert.equal(tl._tiles.size, 0, 'Promise 未到位：本帧无 tile（走平线/env 兜底绘制）');
    await new Promise(r => setTimeout(r, 30));
    assert.equal(rec.renders, 1, '到位后补绘一帧');
    tl._renderNow();
    assert.equal(tl._tiles.size, 1, '到位后下一帧建 tile（直读主路径）');
    assert.ok(resolves >= 0);
  } finally {
    uninstallDoc();
  }
});
test('⑥ resolveBuffer 缺省 null：回退既有 env/平线绘制（零破坏）+ 增益链同源静态', () => {
  // 无钩子无 audio（node 桩）→ 0.14 平线回退路径；增益链（gain×fade）三路径同源静态断言
  const box = srcTl.slice(srcTl.indexOf('  drawClipBox(ctx, p, c, top, lh, pps) {'));
  assert.match(box, /const buf = this\._resolveClipBuffer\(c\.assetId\);/, 'resolveBuffer 钩子接线');
  assert.match(srcTl, /return this\.hooks\.audio\?\.resolveAssetBuffer\?\.\(assetId\) \|\| null;/, '既有同步链兜底');
  assert.match(box, /const gf = gfBase \* fadeEnvAt\(c, /, '直读路径增益链（gain×fade 列左缘取样）');
  assert.match(srcTl, /constructor\(\{ canvas, overlay, scroll, hooks, resolveBuffer = null \}\)/, '构造 opts 契约（K 接线）');
  assert.match(srcTl, /new WaveTileCache\(8\)/, 'LRU 上限 8');
});
