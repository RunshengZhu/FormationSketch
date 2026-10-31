// Wave：变速/变调双旋钮（clip.speed 保音高 TSM + clip.pitchSemi 半音）timeline 半边 node 单测。
//   ① 读侧纯函数：clipSpeedOf/clipSemiOf 缺省/非法回退、界钉值；srcSampleAt（raw 回退路径内部
//     细节）倍率映射与防御；P 契约 needsProcess/clipProcessKey 消费面对拍。
//   ② 缓存键：raw 路径 waveTileKey 含 speed 百分子（无 speed=旧 3 段逐字节一致，既有套件零回退）。
//   ③ 波形 processed 1:1 集成（stub hooks.resolveProcessedClip 半长 buffer）：列极值=processed
//     数据直采对拍（不乘 speed）、超出 processed 时长的列=平线 [0,0]（有效波形列数减半）、memo
//     去重、thenable 到位自动补绘；raw 回退保留 ×speed 旧映射；无处理 clip 与旧链逐值一致。
//   ④ 编辑方法：setSpeedSelected（1=删键、越界钳制、两位小数量化、mutate 历史名、reschedule、
//     多选、未选中不牵连、非有限零写入）；setPitchSelected（整数钳 [-12,12]、0=删键）；
//     resetSpeedPitchSelected（双删键）；处理触发（hooks.processClipAudio 去重+完成 requestDraw）。
//   ⑤ 呈示：「×1.25 +3st」徽标、「处理中…」、缺省无徽标、窄盒不画。
//   ⑥ 契约静态：timeline 三方法/clip-process import 在案；main.js 双滑杆行/重置项在案。
// DOM 桩沿用 tests/tl-wave2.test.js 口径（无真实 canvas 2D）；document 桩仅渲染用例内安装/卸载。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MusicTimeline, columnMinMax, waveTileKey, srcSampleAt, channelData0Of,
  clipSpeedOf, clipSemiOf, CLIP_SPEED_MIN, CLIP_SPEED_MAX, CLIP_SEMI_MIN, CLIP_SEMI_MAX,
} from '../js/timeline.js';
import { needsProcess, clipProcessKey } from '../js/clip-process.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcTl = readFileSync(join(root, 'js/timeline.js'), 'utf8');
const srcMain = readFileSync(join(root, 'js/main.js'), 'utf8');

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
  const rec = { muts: [], labels: [], seeks: [], commits: [], renders: 0, toasts: [], reschedules: 0 };
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
  // live 生效链桩（reschedule 计数）：「gain 的 live 生效同款路径」hooks.audio.ensureTransport().reschedule
  tl.hooks.audio = { ensureTransport: () => ({ reschedule: () => { rec.reschedules++; } }) };
  return { tl, cv, ov, sc, proj, rec };
}
// 记录型 2D 桩（fillRect/fillText 计数——徽标/波形列断言用）
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
    font: '', textBaseline: '', textAlign: '', strokeStyle: '', fillStyle: '', lineWidth: 1,
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

// 4s @ 8kHz 正弦源（raw 侧列极值对拍数据；tl-wave2 同构造）
const WAVE_DATA = (() => {
  const d = new Float32Array(8000 * 4);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 7) * 0.8;
  return d;
})();
const fakeBuf = () => ({ sampleRate: 8000, duration: 4, getChannelData: () => WAVE_DATA });
// 2s @ 8kHz processed 源（speed=2 的 TSM 半长产物；内容独立自证，非 raw 抽点）
const PROC_DATA = (() => {
  const d = new Float32Array(8000 * 2);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin(i / 3.5) * 0.6;
  return d;
})();
// processClipAudio 结果对象形态（P 契约：{channels:[L,R], sampleRate, duration}；兼 AudioBuffer 形态）
const fakeProc = () => ({ sampleRate: 8000, duration: 2, channels: [PROC_DATA], getChannelData: () => PROC_DATA });

// ---------- ① 读侧纯函数 ----------
test('① clipSpeedOf：缺省/非法/非正 → 1；合法值原样透传（clip.speed||1 契约）', () => {
  assert.equal(clipSpeedOf({}), 1, '缺省');
  assert.equal(clipSpeedOf({ speed: 1.25 }), 1.25);
  assert.equal(clipSpeedOf({ speed: 0.25 }), 0.25);
  assert.equal(clipSpeedOf({ speed: NaN }), 1);
  assert.equal(clipSpeedOf({ speed: 0 }), 1);
  assert.equal(clipSpeedOf(null), 1, '空 clip 防御');
});
test('① clipSemiOf：整数钳 [-12,12]；缺省/非整数/非法 → 0', () => {
  assert.equal(clipSemiOf({}), 0, '缺省');
  assert.equal(clipSemiOf({ pitchSemi: 3 }), 3);
  assert.equal(clipSemiOf({ pitchSemi: -5 }), -5);
  assert.equal(clipSemiOf({ pitchSemi: 99 }), 12, '上越界钳 12');
  assert.equal(clipSemiOf({ pitchSemi: -99 }), -12, '下越界钳 -12');
  assert.equal(clipSemiOf({ pitchSemi: 2.9 }), 0, '非整数（清洗域外）→ 0');
  assert.equal(clipSemiOf({ pitchSemi: NaN }), 0);
  assert.equal(clipSemiOf(null), 0, '空 clip 防御');
});
test('① 变速/变调界钉值：CLIP_SPEED 0.25–4、CLIP_SEMI ±12（与 model 清洗/滑杆量程同界）', () => {
  assert.equal(CLIP_SPEED_MIN, 0.25);
  assert.equal(CLIP_SPEED_MAX, 4);
  assert.equal(CLIP_SEMI_MIN, -12);
  assert.equal(CLIP_SEMI_MAX, 12);
});
test('① srcSampleAt（raw 回退路径内部细节）：倍率 1/2/0.5 线性外推；非法倍率回 1；非法入参 → 0', () => {
  // mult 1：与旧链 (srcStartSec+rel)*srcRate 逐值一致
  assert.equal(srcSampleAt(0, 0, 1, 8000), 0);
  assert.equal(srcSampleAt(8000, 0.5, 1, 8000), 8000 + 0.5 * 8000, 'mult=1：srcStart 1s + rel 0.5s');
  // mult 2：源消耗翻倍（raw 回退的 ×speed 磁带式近似）
  assert.equal(srcSampleAt(8000, 0.5, 2, 8000), 8000 + 0.5 * 2 * 8000, 'mult=2：线性×2');
  assert.equal(srcSampleAt(0, 1, 0.5, 8000), 4000, 'mult=0.5：rel 1s → src 0.5s');
  // 非法倍率回 1；非法入参 → 0（防御与 columnMinMax 哨兵同风格）
  assert.equal(srcSampleAt(8000, 1, undefined, 8000), 16000, 'mult 缺省=1');
  assert.equal(srcSampleAt(8000, 1, NaN, 8000), 16000, 'NaN=1');
  assert.equal(srcSampleAt(8000, 1, 0, 8000), 16000, '0=1（非正回退）');
  assert.equal(srcSampleAt(NaN, 1, 2, 8000), 0, 'srcStart 非有限 → 0');
  assert.equal(srcSampleAt(0, NaN, 2, 8000), 0, 'relSec 非有限 → 0');
  assert.equal(srcSampleAt(0, 1, 2, NaN), 0, 'srcRate 非有限 → 0');
});
test('① channelData0Of：AudioBuffer 与 processClipAudio 结果对象（{channels}）双形态兼容', () => {
  const data = new Float32Array([1, -2, 3]);
  assert.deepEqual([...channelData0Of({ sampleRate: 8000, getChannelData: () => data })], [1, -2, 3], 'AudioBuffer 形态');
  assert.deepEqual([...channelData0Of({ sampleRate: 8000, channels: [data] })], [1, -2, 3], '结果对象形态');
  assert.equal(channelData0Of({ channels: [] }), null, 'channels 空 → null');
  assert.equal(channelData0Of(null), null, '空防御');
});
test('① P 契约消费面对拍：needsProcess 判定、clipProcessKey 指纹（波形缓存键成分）', () => {
  assert.equal(needsProcess({}), false, '缺省不处理');
  assert.equal(needsProcess({ speed: 2 }), true);
  assert.equal(needsProcess({ pitchSemi: 3 }), true);
  assert.equal(needsProcess({ speed: 1, pitchSemi: 0 }), false, '1/0=不落键语义');
  assert.equal(clipProcessKey({ speed: 1.25, pitchSemi: 3 }), 's125|p3');
  assert.equal(clipProcessKey({}), 's100|p0', '缺省指纹');
});

// ---------- ② 缓存键（raw 路径） ----------
test('② waveTileKey（raw 回退路径）：speed=1/缺省=旧 3 段逐字节一致；speed≠1 追加「r+百分子」', () => {
  assert.equal(waveTileKey('a1', 0, 80), 'a1|0|80', '缺省=旧格式（既有套件零回退）');
  assert.equal(waveTileKey('a1', 0, 80, 1), 'a1|0|80', 'speed=1 显式=旧格式（不落键口径）');
  assert.equal(waveTileKey('a1', 8000, 80, 1.25), 'a1|8000|80|r125', 'speed 百分子无损量化');
  assert.equal(waveTileKey('a1', 0, 80, 0.25), 'a1|0|80|r25', '半速=25');
  assert.notEqual(waveTileKey('a1', 0, 80, 1.25), waveTileKey('a1', 0, 80, 2), '不同速必不同键');
  assert.notEqual(waveTileKey('a1', 0, 80, 2), waveTileKey('a1', 0, 80), '变速键≠原速键（陈旧 tile 不可能命中）');
});

// ---------- ③ 波形 processed 1:1 集成（stub buffer） ----------
test('③ processed 主路径 1:1 直采：半长 buffer 列极值对拍（不乘 speed）、超时长列平线、memo 去重', () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, speed: 2 }];
    const ctx = recordingCtx();
    const { tl, rec } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
    let hookCalls = 0;
    tl.hooks.resolveProcessedClip = () => { hookCalls++; return fakeProc(); };
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl._renderNow();
    // 列缓存键 = assetId|clipProcessKey|起点样本|列数（含 speed/semi 指纹）
    const c = p.timeline.audioClips[0];
    const key = `${c.assetId}|${clipProcessKey(c)}|0|80`; // 4s×20pps=80 列
    const tile = tl._tiles.get(key);
    assert.ok(tile, 'processed tile 已建（键含 clipProcessKey 指纹）');
    // 1:1 直采对拍：列 0=[0,400) processed 样本窗（不乘 speed——旧 ×2 映射退役）
    assert.deepEqual([tile.min[0], tile.max[0]], columnMinMax(PROC_DATA, 0, 400), '列 0=processed [0,400) 1:1');
    assert.deepEqual([tile.min[5], tile.max[5]], columnMinMax(PROC_DATA, 5 / 20 * 8000, 6 / 20 * 8000), '列 5=processed [2000,2400) 1:1');
    assert.notDeepEqual([tile.min[0], tile.max[0]], columnMinMax(WAVE_DATA, 0, 800), '≠ raw×2 旧映射（srcSampleAt 乘法在 processed 路径退役）');
    // processed 时长 2s=40 列：其后列越界钳 [0,0] 平线——4s 槽 80 列中有效波形列数减半
    assert.deepEqual([tile.min[45], tile.max[45]], [0, 0], '列 45（2.25s>processed 2s）=平线 [0,0]');
    assert.deepEqual([tile.min[79], tile.max[79]], [0, 0], '末列同平线');
    // memo：二次渲染不再询钩子（同步结果 memo 命中）
    tl._renderNow();
    assert.equal(hookCalls, 1, 'resolveProcessedClip 同步结果 memo（每键只询一次）');
    // 处理已就绪 → 徽标呈 ×2.00、无「处理中…」
    assert.ok(ctx.calls.texts.includes('×2.00'), '变速徽标 ×2.00');
    assert.ok(!ctx.calls.texts.includes('处理中…'), '就绪后无处理中徽标');
    assert.equal(rec.renders, 0, '就绪态不触发补绘');
  } finally {
    uninstallDoc();
  }
});
test('③ processed 主路径 srcStart≠0：起点=srcStartSec÷speed（processed 域），键含起点样本', () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 1, speed: 2 }];
    const ctx = recordingCtx();
    const { tl } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
    tl.hooks.resolveProcessedClip = () => fakeProc();
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl._renderNow();
    const c = p.timeline.audioClips[0];
    // processed[i] ≙ src[i×speed] ⇒ 内容起点（processed 域）= 1s÷2 = 4000 样本
    const tile = tl._tiles.get(`${c.assetId}|${clipProcessKey(c)}|4000|80`);
    assert.ok(tile, '键含 processed 域起点样本');
    assert.deepEqual([tile.min[0], tile.max[0]], columnMinMax(PROC_DATA, 4000, 4400), '列 0=processed [4000,4400) 对拍');
  } finally {
    uninstallDoc();
  }
});
test('③ thenable resolveProcessedClip：处理中呈「处理中…」+raw 回退，到位 requestDraw 补绘升 processed', async () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, speed: 2 }];
    const ctx = recordingCtx();
    const { tl, rec } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
    let resolveP;
    tl.hooks.resolveProcessedClip = () => new Promise(r => { resolveP = r; });
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl._renderNow();
    // 处理中帧：raw 回退（×speed 旧映射）+「处理中…」徽标
    const rawTile = tl._tiles.get(waveTileKey('a1', 0, 80, 2));
    assert.ok(rawTile, '处理中帧回退 raw tile（r200 键）');
    assert.deepEqual([rawTile.min[0], rawTile.max[0]], columnMinMax(WAVE_DATA, 0, 800), 'raw 回退=×2 磁带式近似映射');
    assert.ok(ctx.calls.texts.includes('处理中…'), '「处理中…」小字（既有徽标位置）');
    assert.ok(!ctx.calls.texts.some(s => s.startsWith('×')), '处理中无 × 徽标');
    // 到位：Promise.then 里恰一次 requestDraw → 补绘升 processed
    const r0 = rec.renders;
    resolveP(fakeProc());
    await new Promise(r => setTimeout(r, 0));
    assert.equal(rec.renders, r0 + 1, 'Promise 到位补绘恰一帧（requestDraw）');
    tl._renderNow();
    const c = p.timeline.audioClips[0];
    const tile = tl._tiles.get(`${c.assetId}|${clipProcessKey(c)}|0|80`);
    assert.deepEqual([tile.min[0], tile.max[0]], columnMinMax(PROC_DATA, 0, 400), '补绘后=processed 1:1');
  } finally {
    uninstallDoc();
  }
});
test('③ raw 回退与无处理兼容：needsProcess 未就绪=×speed 旧映射；无处理 clip=旧 3 段键逐值一致', () => {
  installDoc();
  try {
    // needsProcess 且钩子未中（null）→ raw 回退保留 ×speed 旧映射（瞬态近似）
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, speed: 2 }];
    const ctx = recordingCtx();
    const { tl } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
    tl.hooks.resolveProcessedClip = () => null;
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl._renderNow();
    const rawTile = tl._tiles.get('a1|0|80|r200');
    assert.deepEqual([rawTile.min[0], rawTile.max[0]], columnMinMax(WAVE_DATA, 0, 800), 'raw 回退列 0=[0,800)（×speed）');
    // 无处理 clip（无 speed/pitchSemi、无钩子）→ 与旧链逐值一致（tl-wave2/wavezoom 兼容锚）
    const p2 = makeProj();
    p2.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
    const ctx2 = recordingCtx();
    const t2 = makeTL(p2, { mode: 'music', resolveBuffer: () => fakeBuf() }).tl;
    t2.cv = canvasEl(() => ctx2); t2.ov = canvasEl(() => ctx2); t2.inner = t2.cv.parentElement;
    t2._renderNow();
    const tile = t2._tiles.get('a1|0|80');
    assert.ok(tile, '无处理=旧 3 段键');
    assert.deepEqual([tile.min[0], tile.max[0]], columnMinMax(WAVE_DATA, 0, 400), '列 0=[0,400) 与现状逐值一致');
    assert.deepEqual([tile.min[5], tile.max[5]], columnMinMax(WAVE_DATA, 5 / 20 * 8000, 6 / 20 * 8000), '列 5 对拍一致');
  } finally {
    uninstallDoc();
  }
});

// ---------- ④ 编辑方法（桩实例） ----------
test('④ setSpeedSelected：写选中 clip.speed、越界钳 [0.25,4]、两位小数量化、多选作用全部、未选中不牵连', () => {
  const p = makeProj();
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 },
    { id: 'c2', assetId: 'a1', name: 'C2', timelineStartSec: 5, lengthSec: 4, srcStartSec: 0 },
  ];
  const { tl, proj, rec } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  tl.setSpeedSelected(1.5);
  assert.equal(proj.timeline.audioClips[0].speed, 1.5);
  assert.deepEqual(rec.labels, ['剪辑变速'], 'mutate 历史名「剪辑变速」');
  assert.equal(rec.reschedules, 1, 'reschedule live 链已触发');
  tl.setSpeedSelected(99);   // 越界上钳 4
  assert.equal(proj.timeline.audioClips[0].speed, 4, '上越界钳 4');
  tl.setSpeedSelected(0.1);  // 越界下钳 0.25
  assert.equal(proj.timeline.audioClips[0].speed, 0.25, '下越界钳 0.25');
  tl.setSpeedSelected(1.234); // 两位小数量化
  assert.equal(proj.timeline.audioClips[0].speed, 1.23, '两位小数量化');
  tl.setSpeedSelected(1.235);
  assert.equal(proj.timeline.audioClips[0].speed, 1.24, '量化取整（round 半升）');
  assert.equal(proj.timeline.audioClips[1].speed, undefined, '未选中 clip 不受牵连');
  assert.ok(rec.labels.every(l => l === '剪辑变速'), '历次均为同名恰一条');
  // 多选=作用于全部选中（同 swatches 口径）
  tl.clipSel = new Set(['c1', 'c2']);
  tl.setSpeedSelected(0.5);
  assert.equal(proj.timeline.audioClips[0].speed, 0.5);
  assert.equal(proj.timeline.audioClips[1].speed, 0.5, '多选全部生效');
});
test('④ setSpeedSelected(1)=删键；非有限/无选中=零写入零历史', () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, speed: 2 }];
  const { tl, proj, rec } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  tl.setSpeedSelected(1);
  assert.equal('speed' in proj.timeline.audioClips[0], false, '1=删键（不落键缺省口径）');
  assert.deepEqual(rec.labels, ['剪辑变速'], '删键同走「剪辑变速」恰一条');
  assert.equal(rec.reschedules, 1, '每次都触发 reschedule（未播放由 transport 自身空操作兜底）');
  // 非有限=零写入零历史
  tl.setSpeedSelected(NaN);
  tl.setSpeedSelected('abc');
  assert.equal(rec.labels.length, 1, '非有限 speed 零历史');
  // 无选中=零写入
  tl.clipSel = new Set();
  tl.setSpeedSelected(2);
  assert.equal(rec.labels.length, 1, 'clipSel 空=零历史');
});
test('④ setPitchSelected：整数钳 [-12,12]、0=删键、历史名「剪辑变调」、非有限零写入', () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
  const { tl, proj, rec } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  tl.setPitchSelected(3);
  assert.equal(proj.timeline.audioClips[0].pitchSemi, 3);
  assert.deepEqual(rec.labels, ['剪辑变调'], 'mutate 历史名「剪辑变调」');
  tl.setPitchSelected(15);
  assert.equal(proj.timeline.audioClips[0].pitchSemi, 12, '上越界钳 12');
  tl.setPitchSelected(-99);
  assert.equal(proj.timeline.audioClips[0].pitchSemi, -12, '下越界钳 -12');
  tl.setPitchSelected(2.6);
  assert.equal(proj.timeline.audioClips[0].pitchSemi, 3, '非整数输入取整');
  tl.setPitchSelected(-2.4);
  assert.equal(proj.timeline.audioClips[0].pitchSemi, -2, '负向取整');
  tl.setPitchSelected(0);
  assert.equal('pitchSemi' in proj.timeline.audioClips[0], false, '0=删键（不落键）');
  assert.ok(rec.labels.every(l => l === '剪辑变调'), '历次均为「剪辑变调」恰一条');
  const n = rec.labels.length;
  tl.setPitchSelected(NaN);
  tl.setPitchSelected('abc');
  assert.equal(rec.labels.length, n, '非有限 semi 零历史');
});
test('④ resetSpeedPitchSelected：speed/pitchSemi 双删键 + 恰一条「变速变调重置」历史', () => {
  const p = makeProj();
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, speed: 2, pitchSemi: -3 },
    { id: 'c2', assetId: 'a1', name: 'C2', timelineStartSec: 5, lengthSec: 4, srcStartSec: 0, speed: 0.5 },
  ];
  const { tl, proj, rec } = makeTL(p, { mode: 'music' });
  tl.clipSel = new Set(['c1']);
  tl.resetSpeedPitchSelected();
  const c1 = proj.timeline.audioClips[0];
  assert.equal('speed' in c1, false, 'speed 删键');
  assert.equal('pitchSemi' in c1, false, 'pitchSemi 删键');
  assert.deepEqual(rec.labels, ['变速变调重置'], '双删键恰一条「变速变调重置」');
  assert.equal(proj.timeline.audioClips[1].speed, 0.5, '未选中 clip 不受牵连');
  tl.clipSel = new Set(['c1', 'c2']);
  tl.resetSpeedPitchSelected();
  assert.equal('speed' in proj.timeline.audioClips[1], false, '多选双删键全部生效');
});
test('④ 处理触发：needsProcess 选中经 hooks.processClipAudio 触发并按指纹去重，完成 requestDraw 恰一次', async () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
  const { tl, rec } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
  const procCalls = [];
  tl.hooks.resolveProcessedClip = () => null; // 未就绪
  tl.hooks.processClipAudio = (buf, params) => { procCalls.push(params); return Promise.resolve({ channels: [], sampleRate: 8000, duration: 2 }); };
  tl.clipSel = new Set(['c1']);
  tl.setSpeedSelected(2);
  assert.deepEqual(procCalls, [{ speed: 2, pitchSemi: 0 }], '触发离线处理（speed 入参）');
  assert.deepEqual(rec.labels, ['剪辑变速']);
  const r0 = rec.renders;
  tl.setSpeedSelected(2); // 同参数（同指纹）在途 → 去重不再触发
  assert.equal(procCalls.length, 1, '同键在途去重');
  await new Promise(r => setTimeout(r, 0));
  // renders = r0 + 2：第二次调用的同步补绘 1 次 + 在途 Promise 完成的 requestDraw 恰 1 次
  assert.equal(rec.renders, r0 + 2, '处理完成 requestDraw 恰一次（异步增量）');
  // 加变调 → 新指纹再触发（入参携带当前 speed+新 semi）
  tl.setPitchSelected(3);
  assert.deepEqual(procCalls, [{ speed: 2, pitchSemi: 0 }, { speed: 2, pitchSemi: 3 }], '新指纹再触发');
  // processed 已就绪 → 不再触发
  const calls2 = procCalls.length;
  tl.hooks.resolveProcessedClip = () => fakeProc();
  tl.setSpeedSelected(1.5);
  assert.equal(procCalls.length, calls2, '已就绪不重复触发');
});
test('④ 处理触发零异常外泄：hooks.processClipAudio 未接线/raw 未就绪 → 静默跳过不抛', () => {
  const p = makeProj();
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
  // 未接线 processClipAudio（调度方待接）：静默跳过
  const a = makeTL(p, { mode: 'music' });
  a.tl.clipSel = new Set(['c1']);
  a.tl.setSpeedSelected(2);
  assert.equal(p.timeline.audioClips[0].speed, 2, '写键不受影响');
  assert.deepEqual(a.rec.labels, ['剪辑变速']);
  // 接线但 raw 未就绪：静默跳过
  const p2 = makeProj();
  p2.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0 }];
  const b = makeTL(p2, { mode: 'music', resolveBuffer: null }); // raw 解析链空
  b.tl.hooks.processClipAudio = () => { throw new Error('不应触发'); };
  b.tl.clipSel = new Set(['c1']);
  b.tl.setSpeedSelected(2);
  assert.equal(p2.timeline.audioClips[0].speed, 2, 'raw 未就绪静默跳过');
});

// ---------- ⑤ 徽标呈示 ----------
test('⑤ 双旋钮徽标：×1.25 与 +3st 分节拼接；只变调呈 -2st；缺省无徽标；窄盒不画', () => {
  installDoc();
  try {
    const render = (clip) => {
      const p = makeProj();
      p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, ...clip }];
      const ctx = recordingCtx();
      const t = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() }).tl;
      t.hooks.resolveProcessedClip = () => fakeProc(); // 就绪（否则呈「处理中…」）
      t.cv = canvasEl(() => ctx); t.ov = canvasEl(() => ctx); t.inner = t.cv.parentElement;
      t._renderNow();
      return ctx.calls.texts;
    };
    assert.deepEqual(render({ speed: 1.25, pitchSemi: 3 }).filter(s => s.includes('st') || s.startsWith('×')), ['×1.25 +3st'], '双旋钮拼接徽标');
    assert.deepEqual(render({ pitchSemi: -2 }).filter(s => s.includes('st') || s.startsWith('×')), ['-2st'], '只变调：负向 -2st');
    assert.deepEqual(render({ speed: 2 }).filter(s => s.includes('st') || s.startsWith('×')), ['×2.00'], '只变速');
    assert.ok(!render({}).some(s => s.includes('st') || s.startsWith('×')), '缺省=无徽标');
    // 退化窄盒（w≤20px）不画徽标（同名牌宽度门，防文本糊邻道）
    const p3 = makeProj();
    p3.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 0.5, srcStartSec: 0, speed: 2 }];
    const ctx3 = recordingCtx();
    const t3 = makeTL(p3, { mode: 'music', resolveBuffer: () => fakeBuf() }).tl;
    t3.hooks.resolveProcessedClip = () => fakeProc();
    t3.cv = canvasEl(() => ctx3); t3.ov = canvasEl(() => ctx3); t3.inner = t3.cv.parentElement;
    t3._renderNow();
    assert.ok(!ctx3.calls.texts.some(s => s.startsWith('×') || s.includes('st')), '窄盒（10px<20px）无徽标');
    // 源静态：× 徽标走模板字面量（tl-wave1「无 fillText('×'」静态锚不回退）
    assert.ok(!srcTl.includes("fillText('×'"), '不引入单引号 × 字面量（tl-wave1 静态兜底兼容）');
  } finally {
    uninstallDoc();
  }
});
test('⑤ 处理中呈示：needsProcess 且 processed 未就绪 → 「处理中…」小字', () => {
  installDoc();
  try {
    const p = makeProj();
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', name: 'C1', timelineStartSec: 0, lengthSec: 4, srcStartSec: 0, speed: 2 }];
    const ctx = recordingCtx();
    const { tl } = makeTL(p, { mode: 'music', resolveBuffer: () => fakeBuf() });
    tl.hooks.resolveProcessedClip = () => null; // 未就绪且无钩子呈示
    tl.cv = canvasEl(() => ctx); tl.ov = canvasEl(() => ctx); tl.inner = tl.cv.parentElement;
    tl._renderNow();
    assert.ok(ctx.calls.texts.includes('处理中…'), '「处理中…」10px 小字（既有徽标位置）');
    assert.ok(!ctx.calls.texts.some(s => s.startsWith('×')), '处理中不呈 × 徽标');
  } finally {
    uninstallDoc();
  }
});

// ---------- ⑥ 契约静态 ----------
test('⑥ 契约静态：clip-process import、三方法/历史名、波形双链、菜单双滑杆行在案', () => {
  // timeline：import 与三方法（main.js 菜单冻结调用面）
  assert.match(srcTl, /import \{ needsProcess, clipProcessKey \} from '\.\/clip-process\.js';/, 'P 契约 import 在案');
  assert.match(srcTl, /setSpeedSelected\(speed\) \{/, 'timeline 方法在案');
  assert.match(srcTl, /setPitchSelected\(semi\) \{/, 'timeline 方法在案');
  assert.match(srcTl, /resetSpeedPitchSelected\(\) \{/, 'timeline 方法在案');
  assert.match(srcTl, /'剪辑变速'/, '历史名「剪辑变速」在案');
  assert.match(srcTl, /'剪辑变调'/, '历史名「剪辑变调」在案');
  assert.match(srcTl, /'变速变调重置'/, '历史名「变速变调重置」在案');
  assert.match(srcTl, /requestDraw\(\) \{ this\.render\(\); \}/, '补绘入口在案');
  // 波形双链：processed 1:1 主路径 + raw 回退（srcSampleAt 形态锚保持）
  const box = srcTl.slice(srcTl.indexOf('  drawClipBox(ctx, p, c, top, lh, pps) {'));
  assert.match(box, /needsProcess\(c\) \? this\._resolveProcessedClip\(c\) : null/, 'processed 优先（无处理不询钩子）');
  assert.match(box, /const sA = srcSampleAt\(srcStartSamples, rel, mult, srcRate\);/, '列左缘=srcSampleAt(mult)');
  assert.match(box, /srcSampleAt\(srcStartSamples, \(x \+ 1 - x0\) \/ pps, mult, srcRate\)/, '列右缘=srcSampleAt(mult)');
  assert.match(box, /clipProcessKey\(c\)/, 'processed tile 键含 clipProcessKey 指纹');
  assert.match(box, /处理中…/, '处理中呈示在案');
  // main.js：变速滑杆行（0.25–4 step 0.01）+ 变调滑杆行（-12..12 step 1）+ 重置项
  assert.match(srcMain, /musicTl\.setSpeedSelected\(\+e\.target\.value\)/, '变速松手经 setSpeedSelected');
  assert.match(srcMain, /musicTl\.setPitchSelected\(\+e\.target\.value\)/, '变调松手经 setPitchSelected');
  assert.match(srcMain, /musicTl\.resetSpeedPitchSelected\(\)/, '重置项经 resetSpeedPitchSelected');
  assert.match(srcMain, /type: 'range', min: '0\.25', max: '4', step: '0\.01'/, '变速滑杆量程契约');
  assert.match(srcMain, /type: 'range', min: '-12', max: '12', step: '1'/, '变调滑杆量程契约');
  assert.match(srcMain, /label: '变速\/变调重置'/, '菜单重置项在案');
  assert.match(srcMain, /stLabel/, '行内 +3st/-2st 呈示在案');
  // 旧 rate 乘法消费面退役（波形侧不再读 clip.rate）
  assert.ok(!srcTl.includes('clipRateOf'), 'clipRateOf 已退役');
  assert.ok(!srcTl.includes('setRateSelected'), 'setRateSelected 已退役');
});
