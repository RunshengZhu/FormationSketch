// 音频剪辑引擎单测（exp/audition-lite · 规格 docs/music-clip-ui-spec.md v3）
// 覆盖：数据模型清洗与 v1 迁移（零体验变化）、trim 语义（内容锚定/Shift 变体/源界钳制）、
// split/波纹删除/时间选区修剪、自动等功率交叉淡化（建立/拖开还原/手动淡化不受影响）、
// 淡化包络互补性、有效事件区间（段间静音）、磁吸候选与最近邻、零交叉、波形包络、
// 按队形段自动切（幂等）、ClipTransport 双时钟调度（假 AudioContext）与 Player clip 通道终态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, validateProject, migrateLegacyAudio, sanitizeMedia, sanitizeAudioClips,
} from '../js/model.js';
import {
  clipEnd, lastClipEndSec, effectiveRegions, capFades, fadeEnvAt, clipGainAt,
  computeOverlaps, applyAutoCrossfades, pruneAutoCrossfades,
  trimClipLeftAnchored, trimClipLeftBoundary, trimClipRightAnchored, trimClipRightBoundary,
  splitClipAt, rippleDeleteClips, trimClipsToRange,
  collectSnapCandidates, snapTime, nearestZeroCrossing,
  computeWaveEnvelope, envAt, autoSplitAtBoundaries, MIN_CLIP_DUR,
  ClipTransport,
} from '../js/audio-clips.js';
import { Player } from '../js/player.js';

// ---------- 工厂 ----------
function mkClip(over = {}) {
  return {
    id: over.id || 'c1', assetId: over.assetId || 'a1',
    timelineStartSec: 0, srcStartSec: 0, lengthSec: 10,
    fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'clip',
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !['id', 'assetId'].includes(k))),
  };
}

// ---------- 1) 数据模型：清洗与 v1 迁移 ----------
test('sanitizeMedia：剥离 dataBase64、id 补齐/去重、activeAssetId 回退首个', () => {
  const m = sanitizeMedia({
    assets: [
      { id: 'a1', name: 'x.mp3', durationSec: 60, size: 123, dataBase64: 'QUJD', dataFormat: 'audio/mpeg' },
      { name: 'y.wav', durationSec: -5, size: -1 },
      { id: 'a1', name: 'dup', durationSec: 1 },
      'junk', null,
    ],
    activeAssetId: 'missing',
  });
  assert.equal(m.assets.length, 2);
  assert.equal(m.assets[0].dataBase64, undefined, '内嵌数据不进项目记录');
  assert.equal(m.assets[0].id, 'a1');
  assert.notEqual(m.assets[1].id, 'a1', '重复 id（第3项）被弃，第2项无 id 补新 id');
  assert.equal(m.assets[1].durationSec, 0, '负时长钳 0');
  assert.equal(m.activeAssetId, m.assets[0].id, 'activeAssetId 失效回退首个');
  assert.equal(sanitizeMedia(null).assets.length, 0);
});

test('sanitizeAudioClips：引用有效资产、数值域钳制、淡化按比例收缩、gain 0..4', () => {
  const assets = [{ id: 'a1', durationSec: 60 }, { id: 'a2', durationSec: 5 }];
  const clips = sanitizeAudioClips([
    { id: 'k1', assetId: 'a1', timelineStartSec: -3, srcStartSec: -1, lengthSec: 999, fadeInSec: 2, fadeOutSec: 2, gain: 99 },
    { assetId: 'ghost' },                                     // 引用不存在资产 → 丢弃
    { assetId: 'a2', timelineStartSec: 0, srcStartSec: 4, lengthSec: 4 }, // 越素材尾 → length 钳 1
    { assetId: 'a2', timelineStartSec: 0, srcStartSec: 0, lengthSec: 0.001 }, // < MIN → 丢弃
    { id: 'z', assetId: 'a1', timelineStartSec: NaN, srcStartSec: 0, lengthSec: 1 }, // 非有限 → 丢弃
  ], assets);
  assert.equal(clips.length, 2);
  const c = clips[0];
  assert.equal(c.timelineStartSec, 0);
  assert.equal(c.srcStartSec, 0);
  assert.equal(c.lengthSec, 60, 'length 钳到素材剩余（60）');
  assert.equal(c.fadeInSec + c.fadeOutSec <= 60, true, '淡化总量 ≤ length');
  assert.equal(c.gain, 4, 'gain 上限 4');
  assert.equal(clips[1].lengthSec, 1, 'a2 剩余素材 1s（srcStart4 + 1）');
  assert.equal(sanitizeAudioClips('junk', assets).length, 0);
});

test('migrateLegacyAudio：v1 单音频 → 1 asset + 全长 clip（零体验变化）；幂等；无音乐不迁移', () => {
  const p = createProject({});
  p.audio.name = 'song.mp3';
  p.audio.durationSec = 64;
  assert.equal(migrateLegacyAudio(p), true);
  assert.equal(p.media.assets.length, 1);
  assert.equal(p.media.activeAssetId, p.media.assets[0].id);
  const clip = p.timeline.audioClips[0];
  assert.equal(clip.timelineStartSec, 0);
  assert.equal(clip.srcStartSec, 0);
  assert.equal(clip.lengthSec, 64, '全长 clip：与旧整曲播放逐拍等价');
  assert.equal(clip.fadeInSec + clip.fadeOutSec, 0);
  assert.equal(clip.gain, 1);
  const before = JSON.stringify(p.timeline.audioClips.map(c => c.id));
  assert.equal(migrateLegacyAudio(p), false, '已有 assets 不重复迁移');
  assert.equal(JSON.stringify(p.timeline.audioClips.map(c => c.id)), before);
  const q = createProject({});
  assert.equal(migrateLegacyAudio(q), false, '无音乐不迁移');
});

test('validateProject：迁移幂等、往返无损、media 内嵌字段剥离', () => {
  const p = createProject({ pairs: 1 });
  p.audio.name = 'a.wav';
  p.audio.durationSec = 30;
  const r1 = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(r1.ok, true);
  assert.equal(r1.project.timeline.audioClips.length, 1);
  const r2 = validateProject(JSON.parse(JSON.stringify(r1.project)));
  assert.deepEqual(r2.project.timeline.audioClips, r1.project.timeline.audioClips, '二次校验幂等');
  assert.deepEqual(r2.project.media.assets.map(a => a.id), r1.project.media.assets.map(a => a.id));
  // 带内嵌数据的导入形态：dataBase64 被剥离
  const imported = JSON.parse(JSON.stringify(r1.project));
  imported.media.assets[0].dataBase64 = 'QUJD';
  const r3 = validateProject(imported);
  assert.equal(r3.project.media.assets[0].dataBase64, undefined);
});

// ---------- 2) trim 语义 ----------
test('trim 左缘内容锚定：srcStart 与 timelineStart 同步前进（内容锚定源时间）', () => {
  const c = mkClip({ timelineStartSec: 10, srcStartSec: 4, lengthSec: 8 });
  assert.equal(trimClipLeftAnchored(c, 12), true);
  assert.equal(c.srcStartSec, 6, 'srcStart 随边界同步 +2（露出更晚的源内容）');
  assert.equal(c.timelineStartSec, 12);
  assert.equal(c.lengthSec, 6);
  // 锚定不变式：srcStart − timelineStart 恒定
  assert.equal(Math.round((c.srcStartSec - c.timelineStartSec) * 1e6) / 1e6, -6);
});

test('trim 左缘 Shift 变体：只改边界，srcStart 不动', () => {
  const c = mkClip({ timelineStartSec: 10, srcStartSec: 4, lengthSec: 8 });
  assert.equal(trimClipLeftBoundary(c, 13), true);
  assert.equal(c.srcStartSec, 4, 'srcStart 不动（老语义）');
  assert.equal(c.timelineStartSec, 13);
  assert.equal(c.lengthSec, 5);
});

test('trim 右缘：内容锚定与 Shift 变体等价（length 变化）；越素材尾被拒', () => {
  const c = mkClip({ timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 });
  assert.equal(trimClipRightAnchored(c, 15, 20), true);
  assert.equal(c.lengthSec, 15);
  assert.equal(trimClipRightAnchored(c, 25, 20), false, 'srcStart+len 越素材尾 → 拒绝');
  const d = mkClip({ timelineStartSec: 0, srcStartSec: 10, lengthSec: 5 });
  assert.equal(trimClipRightBoundary(d, 10, 20), true);
  assert.equal(d.lengthSec, 10, '边界变体同样受素材尾约束（srcStart10+len10=20）');
  assert.equal(trimClipLeftAnchored(mkClip({ timelineStartSec: 5, srcStartSec: 0, lengthSec: 5 }), 2), false, '左缘不能越出素材头部');
  assert.equal(trimClipRightAnchored(mkClip({ lengthSec: 5 }), 0.001), false, 'length ≥ MIN');
});

test('trim 后淡化按比例收缩（capFades）', () => {
  const c = mkClip({ lengthSec: 10, fadeInSec: 4, fadeOutSec: 4 });
  trimClipRightAnchored(c, 5);
  assert.equal(c.fadeInSec + c.fadeOutSec <= c.lengthSec + 1e-9, true);
  assert.ok(c.fadeInSec < 4 && c.fadeOutSec < 4, '总超限 → 等比收缩');
});

// ---------- 3) split / ripple / 时间选区 ----------
test('split：源连续（左.src+左.len == 右.src）；切在缘外返回 null', () => {
  const clips = [mkClip({ id: 'c1', timelineStartSec: 0, srcStartSec: 3, lengthSec: 10, fadeInSec: 2, fadeOutSec: 2 })];
  const right = splitClipAt(clips, 'c1', 4);
  assert.ok(right);
  const left = clips[0];
  assert.equal(left.lengthSec, 4);
  assert.equal(right.timelineStartSec, 4);
  assert.equal(right.lengthSec, 6);
  assert.equal(right.srcStartSec, 7, '左.src+左.len == 右.src（源内容连续）');
  assert.notEqual(right.id, left.id);
  assert.ok(Math.abs(right.fadeInSec) >= 0);
  assert.equal(splitClipAt(clips, 'c1', 0.001), null, '太靠左缘');
  assert.equal(splitClipAt(clips, 'ghost', 4), null);
});

test('rippleDelete：右侧 clip 左移补位（跨度=maxEnd−minStart）', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 4 }),
    mkClip({ id: 'b', timelineStartSec: 6, lengthSec: 4 }),
    mkClip({ id: 'c', timelineStartSec: 12, lengthSec: 4 }),
  ];
  const kept = rippleDeleteClips(clips, ['b']);
  assert.equal(kept, 2);
  assert.equal(clips.find(c => c.id === 'c').timelineStartSec, 8, '右邻左移=被删跨度（10−6=4）：12→8；左邻留下的空隙 4..6 不回填');
});

test('trimClipsToRange：交集修剪；完全在外删除', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'b', timelineStartSec: 20, srcStartSec: 0, lengthSec: 5 }),
  ];
  const dropped = trimClipsToRange(clips, ['a', 'b'], 3, 8);
  assert.deepEqual(dropped, ['b']);
  assert.equal(clips[0].timelineStartSec, 3);
  assert.equal(clipEnd(clips[0]), 8);
  assert.equal(clips[0].srcStartSec, 3, '内容锚定');
});

// ---------- 4) 自动等功率交叉淡化 ----------
test('重叠 → 等功率淡化对（auto 标记）；拖开 → auto 淡化还原；手动淡化不受影响', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'b', timelineStartSec: 8, lengthSec: 10 }),
  ];
  const touched = applyAutoCrossfades(clips, ['a', 'b']);
  assert.equal(touched.has('a') && touched.has('b'), true);
  const a = clips[0], b = clips[1];
  assert.equal(a.fadeOutSec, 2);
  assert.equal(b.fadeInSec, 2);
  assert.equal(a.fadeOutAuto && b.fadeInAuto, true);
  // 拖开（不再重叠）
  b.timelineStartSec = 12;
  const cleared = pruneAutoCrossfades(clips, 'b');
  assert.ok(cleared.has('b'));
  assert.equal(b.fadeInSec, 0);
  assert.equal(a.fadeOutSec, 0, '同一交叉对随拖开整体还原（对侧 auto 淡出一并清）；手动淡化不受影响（下组验证）');
  // 手动淡化不被清除
  const m1 = mkClip({ id: 'm1', timelineStartSec: 0, lengthSec: 10, fadeOutSec: 3 });
  const m2 = mkClip({ id: 'm2', timelineStartSec: 30, lengthSec: 10, fadeInSec: 1 });
  m2.timelineStartSec = 20;
  pruneAutoCrossfades([m1, m2], 'm2');
  assert.equal(m2.fadeInSec, 1, '手动（无 auto 标记）淡化不清');
});

test('等功率互补性：重叠区 fadeOut(env)² + fadeIn(env)² == 1', () => {
  const a = mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10, fadeOutSec: 2 });
  const b = mkClip({ id: 'b', timelineStartSec: 8, lengthSec: 10, fadeInSec: 2 });
  for (let t = 8; t <= 10; t += 0.1) {
    const ga = fadeEnvAt(a, t - a.timelineStartSec);
    const gb = fadeEnvAt(b, t - b.timelineStartSec);
    const p = ga * ga + gb * gb;
    assert.ok(Math.abs(p - 1) < 1e-6, `t=${t} 功率和=${p}`);
  }
  assert.equal(clipGainAt(mkClip({ muted: true, gain: 2 }), 0), 0, '静音 → 0');
});

// R41-D1 回归：prune 只处理与 target 构成对的 clip——拖动/trim 无关第三方不清既有对
test('R41-D1：拖动/trim 无关第三方 clip，既有交叉淡化对原封不动', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'b', timelineStartSec: 9, lengthSec: 3 }),
    mkClip({ id: 'c', timelineStartSec: 20, lengthSec: 2 }),
  ];
  applyAutoCrossfades(clips, ['a', 'b']);
  assert.equal(clips[0].fadeOutSec, 1);
  assert.equal(clips[1].fadeInSec, 1);
  // 无关 c 拖到远处（与 a/b 均不重叠；旧实现此处按先后序误清 a.fadeOut）
  clips[2].timelineStartSec = 30;
  const cleared = pruneAutoCrossfades(clips, 'c');
  assert.equal(cleared.size, 0, '无关第三方不产生任何清除');
  assert.equal(clips[0].fadeOutSec, 1, 'a.fadeOut 不被误铲');
  assert.equal(clips[0].fadeOutAuto, true);
  assert.equal(clips[1].fadeInSec, 1, 'b.fadeIn 不留陈旧半边');
  assert.equal(clips[1].fadeInAuto, true);
  assert.equal(clips[0].autoPair, 'b');
  assert.equal(clips[1].autoPair, 'a');
  // trim 无关 clip 同理
  clips[2].lengthSec = 1;
  pruneAutoCrossfades(clips, 'c');
  assert.equal(clips[0].fadeOutSec, 1);
  assert.equal(clips[1].fadeInSec, 1);
});

// R41-D2 回归：对的一侧曾被污染（半边铲除）后，拖开原对无陈旧 auto 淡化残留
test('R41-D2：对侧半边被污染后拖开原对，陈旧 auto 淡化整体还原', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'b', timelineStartSec: 9, lengthSec: 3 }),
  ];
  applyAutoCrossfades(clips, ['a', 'b']);
  // 模拟污染现场：a 侧 fadeOut 已被误清，b 侧残留陈旧 fadeIn（autoPair 仍指向 a）
  clips[0].fadeOutSec = 0;
  clips[0].fadeOutAuto = false;
  clips[0].autoPair = null;
  // 拖开原对 → b 侧陈旧 fadeIn 应随对级记录一并还原
  clips[0].timelineStartSec = 20;
  const cleared = pruneAutoCrossfades(clips, 'a');
  assert.ok(cleared.has('b'), 'b 侧陈旧 fadeIn 被还原');
  assert.equal(clips[1].fadeInSec, 0);
  assert.equal(clips[1].fadeInAuto, false);
  assert.equal(clips[1].autoPair ?? null, null, '对级记录一并清空');
  assert.equal(clips[0].fadeInSec, 0);
  assert.equal(clips[0].fadeOutSec, 0);
  // 另一半污染形态：a 残留陈旧 fadeOut、b 侧被清 → 拖 b 同样整体还原
  const clips2 = [
    mkClip({ id: 'x', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'y', timelineStartSec: 9, lengthSec: 3 }),
  ];
  applyAutoCrossfades(clips2, ['x', 'y']);
  clips2[1].fadeInSec = 0; clips2[1].fadeInAuto = false; clips2[1].autoPair = null;
  clips2[1].timelineStartSec = 25;
  const cleared2 = pruneAutoCrossfades(clips2, 'y');
  assert.ok(cleared2.has('x'), 'x 侧陈旧 fadeOut 被还原');
  assert.equal(clips2[0].fadeOutSec, 0);
  assert.equal(clips2[0].fadeOutAuto, false);
});

// ---------- 5) 有效事件区间（段间静音） ----------
test('effectiveRegions：合并重叠、保留间隙；muted 跳过', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 4 }),
    mkClip({ id: 'b', timelineStartSec: 3, lengthSec: 4 }),
    mkClip({ id: 'c', timelineStartSec: 20, lengthSec: 2 }),
    mkClip({ id: 'd', timelineStartSec: 30, lengthSec: 2, muted: true }),
  ];
  const regions = effectiveRegions(clips);
  assert.deepEqual(regions, [[0, 7], [20, 22]], '间隙=静音；muted 不算事件');
  assert.equal(lastClipEndSec(clips), 32, '末 clip 终点含 muted（ended 判定用全长）');
});

// ---------- 6) 磁吸 / 零交叉 / 波形包络 ----------
test('snapTime：最近邻候选 + 阈值；collectSnapCandidates 排除自身', () => {
  const clips = [mkClip({ id: 'a', timelineStartSec: 5, lengthSec: 2 })];
  const cands = collectSnapCandidates({ clips, excludeId: 'a', playheadSec: 9, blockSecs: [4], tagSecs: [] });
  assert.ok(!cands.includes(5) && !cands.includes(7), '被拖 clip 自身缘不作候选');
  assert.ok(cands.includes(9) && cands.includes(4));
  assert.equal(snapTime(5.9, [4, 6, 9], 0.2).t, 6);
  assert.equal(snapTime(5.85, [4, 6, 9], 0.1).line, null, '超阈值不吸');
});

test('nearestZeroCrossing：噪声数据中找最近过零点', () => {
  const sr = 1000;
  const data = new Float32Array(sr);
  for (let i = 0; i < sr; i++) data[i] = Math.sin(2 * Math.PI * 5 * i / sr);
  // 5Hz@1000sr：周期 200 样本，过零点在 0/100/200/300…
  const zc = nearestZeroCrossing(data, 260, 50); // 搜索 210..310 → 命中 300（±1 浮点容差）
  assert.ok(Math.abs(zc - 300) <= 1, `zc=${zc}`);
  assert.ok(data[zc - 1] * data[zc] <= 0, '命中点为方向变化处');
  const zc2 = nearestZeroCrossing(data, 250, 40); // 搜索 210..290：无过零 → 返回原位
  assert.equal(zc2, 250);
});

test('computeWaveEnvelope：归一化到峰值 1；envAt 取样', () => {
  const buf = {
    sampleRate: 1000, duration: 1,
    getChannelData: () => {
      const d = new Float32Array(1000);
      for (let i = 0; i < 1000; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 10 * i / 1000);
      return d;
    },
  };
  const env = computeWaveEnvelope(buf, 100);
  assert.equal(env.count, 10);
  let peak = 0;
  for (let i = 0; i < env.count; i++) peak = Math.max(peak, env.max[i], -env.min[i]);
  assert.ok(Math.abs(peak - 1) < 0.01, `峰值归一 ${peak}`);
  assert.ok(envAt(env, 0.05) > 0);
  assert.equal(envAt(env, 99), 0, '越界取样=0');
  assert.equal(envAt(null, 0), 0);
});

// ---------- 7) 按队形段自动切（C18/P1） ----------
test('autoSplitAtBoundaries：块边界分割 + 过渡拍交叉淡化；重复执行幂等', () => {
  const clips = [mkClip({ id: 'c1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 60 })];
  const times = [{ t: 20, fade: 2 }, { t: 40, fade: 2 }];
  const r1 = autoSplitAtBoundaries(clips, times, () => 60);
  assert.equal(r1.splits, 2);
  assert.equal(r1.fades, 2);
  assert.equal(clips.length, 3);
  const [s1, s2, s3] = clips;
  assert.equal(clipEnd(s1), 21, '前段右延 fade/2=1s');
  assert.equal(s2.timelineStartSec, 19, '后段左移 fade/2（淡化中点恰在边界 20）');
  assert.equal(s1.fadeOutSec, 2);
  assert.equal(s2.fadeInSec, 2);
  assert.equal(s1.srcStartSec + s1.lengthSec, s2.srcStartSec, '源内容连续');
  const r2 = autoSplitAtBoundaries(clips, times, () => 60);
  assert.equal(r2.splits, 0, '已切边界跳过');
  assert.equal(r2.fades, 0, '已有淡化跳过');
});

// ---------- 8) ClipTransport（假 AudioContext：双时钟调度） ----------
function fakeParam() {
  const ops = [];
  return {
    ops,
    value: 1,
    setValueAtTime(v, t) { ops.push(['set', v, t]); },
    setValueCurveAtTime(arr, t, dur) { ops.push(['curve', Array.from(arr), t, dur]); },
    setTargetAtTime(v, t) { ops.push(['target', v, t]); },
  };
}
function fakeCtx() {
  const ctx = {
    currentTime: 100,
    destination: { kind: 'dest' },
    sources: [], gains: [],
    createBufferSource() {
      const s = {
        buffer: null, playbackRate: { value: 1 }, started: null, stopped: false,
        start(when, off, dur) { s.started = { when, off, dur }; },
        stop() { s.stopped = true; },
        connect(n) { s._to = n; }, disconnect() {},
      };
      ctx.sources.push(s);
      return s;
    },
    createGain() {
      const g = { gain: fakeParam(), context: ctx, connect(n) { g._to = n; }, disconnect() {} };
      ctx.gains.push(g);
      return g;
    },
  };
  return ctx;
}
function setupTransport(clips, bufferDur = 30) {
  const ctx = fakeCtx();
  const t = new ClipTransport({ getContext: () => ctx, destination: () => ctx.destination });
  const resolve = id => (id === 'a1' ? { duration: bufferDur } : null);
  return { ctx, t, resolve };
}
test('ClipTransport：play 起调度（源偏移=srcStart、时长=剩余区间）、gain 分段自动化、段间静音不调度', () => {
  const clips = [
    mkClip({ id: 'g1', timelineStartSec: 0, srcStartSec: 2, lengthSec: 5 }),
    mkClip({ id: 'g2', timelineStartSec: 20, srcStartSec: 0, lengthSec: 5, fadeInSec: 1, fadeOutSec: 1 }), // 前瞻外
  ];
  const { ctx, t, resolve } = setupTransport(clips);
  try {
    assert.equal(t.play(clips, { from: 0, rate: 1, resolveBuffer: r => resolve(r) }), true);
    assert.equal(t.playing, true);
    assert.equal(ctx.sources.length, 1, '前瞻 120ms：只调度当前可及 clip');
    const s = ctx.sources[0];
    assert.ok(Math.abs(s.started.dur - 5) < 0.02);
    assert.equal(s.started.off, 2, 'srcStart+偏移');
    const gOps = ctx.gains[1].gain.ops; // gains[0] 是 master，clip gain 是第 2 个
    assert.equal(gOps[0][0], 'set');
    assert.equal(gOps.filter(o => o[0] === 'curve').length, 0, '无淡化 → 无曲线段');
    assert.ok(gOps.some(o => o[0] === 'set' && o[1] === 1), '常量段 gain=1');
    // 推进 ctx 时钟越过 g2 起点 → 下一 tick 调度 g2（含 fade 曲线）
    ctx.currentTime += 20.5;
    t.tick();
    assert.equal(ctx.sources.length, 2);
    const g2gain = ctx.gains[ctx.gains.length - 1].gain.ops;
    assert.equal(g2gain.filter(o => o[0] === 'curve').length, 2, 'fadeIn/fadeOut 两条 setValueCurveAtTime 曲线');
    assert.equal(ctx.sources[1].playbackRate.value, 1);
    t.stop();
    assert.equal(t.playing, false);
    assert.ok(ctx.sources.every(x => x.stopped), '统一 stop()');
  } finally { t.stopInternal(); }
});
test('ClipTransport：rate 换算（源消耗=时长×rate）、muted 不调度、buffer 缺失跳过、position 双时钟', () => {
  const clips = [
    mkClip({ id: 'r1', timelineStartSec: 0, lengthSec: 4 }),
    mkClip({ id: 'm1', timelineStartSec: 0, lengthSec: 4, muted: true }),
    mkClip({ id: 'n1', assetId: 'ghost', timelineStartSec: 0, lengthSec: 4 }),
  ];
  const { ctx, t } = setupTransport(clips);
  try {
    t.play(clips, { from: 0, rate: 2, resolveBuffer: id => (id === 'a1' ? { duration: 30 } : null) });
    assert.equal(ctx.sources.length, 1, 'muted/无 buffer 不调度');
    assert.equal(ctx.sources[0].started.dur, 8, '源时长=时间线时长×rate');
    assert.equal(ctx.sources[0].playbackRate.value, 2);
    ctx.currentTime = 100.5; // 越过 START_DELAY
    const pos = t.position;
    assert.ok(Math.abs(pos - 0.5) < 0.02, `position = startPos + (ctx.currentTime − clockCtxTime)：${pos}`);
    const stopped = t.stop();
    assert.ok(stopped > 0.4);
  } finally { t.stopInternal(); }
});

// ---------- 9) Player clip 通道终态（ended=min(末 clip 终点, totalBeats)） ----------
function makeClipAudioStub() {
  return {
    ready: true, duration: 30, bufferReady: true, currentTime: 0, _playing: false,
    calls: { playClips: [], seekClips: [], stopClips: 0 },
    get playing() { return this._playing; },
    play() {}, pause() {}, stop() {}, seek() {}, setRate() {}, click() {},
    playClips(clips, from, rate) { this.calls.playClips.push({ from, rate, n: clips.length }); this._clipFrom = from; this._rate = rate; this._clipPos = undefined; this._playing = true; },
    seekClips(sec, rate) { this.calls.seekClips.push(sec); this._clipFrom = sec; this._rate = rate; this._clipPos = undefined; },
    stopClips() { this.calls.stopClips++; this._playing = false; },
    get clipsPlaying() { return this._playing; },
    get clipsPosition() { return this._clipPos ?? this._clipFrom ?? 0; },
    set _pos(v) { this._clipPos = v; },
  };
}
function makeClipPlayer(project, audio) {
  const events = { states: [] };
  const p = new Player({
    audio, getProject: () => project,
    onTick: () => {}, onStateChange: s => events.states.push(s), onCountin: () => {}, onPreviewEnd: () => {},
  });
  return { p, events };
}
test('Player clip 通道：起播走 playClips；末 clip 终点 < totalBeats → _audioEnded 虚拟接管（#7 混合语义）', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 0;
  project.audio.name = 'a.wav';
  project.audio.durationSec = 6;
  project.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 6, size: 1 }], activeAssetId: 'a1' };
  project.timeline.audioClips = [mkClip({ id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 6 })];
  const audio = makeClipAudioStub();
  const { p, events } = makeClipPlayer(project, audio);
  p.play(0);
  assert.equal(p.playing, true);
  assert.deepEqual(audio.calls.playClips[0], { from: 0, rate: 1, n: 1 }, 'clip 调度通道起播');
  audio._pos = 6; // 越过最后 clip 终点（6s < 时间轴 40 拍）
  p._tick();
  assert.equal(p.playing, false);
  assert.equal(p._audioEnded, true, '音频终态=末 clip 终点先到 → 虚拟接管标记');
  assert.equal(Math.abs(p.beat - 12) < 1e-6, true, `播放头钳在末 clip 终点拍（6s@120bpm=12 拍）：${p.beat}`);
  const ended = events.states.find(s => s.ended);
  assert.ok(ended && ended.reason === 'audio');
  // 续播：虚拟时钟接管到 totalBeats
  p.play(null, { countIn: false });
  assert.equal(p.playing, true);
  assert.equal(audio.calls.playClips.length, 1, '接管后不再驱动 clip 通道');
  for (let i = 0; i < 200 && p.playing; i++) { if (p._virtual) p._virtual.t0 -= 500; p._tick(); }
  assert.equal(p.playing, false);
  assert.equal(p.beat, 16, '虚拟时钟接管直至 totalBeats（单队形块=16 拍）');
  p.stop();
});
test('Player clip 通道：totalBeats 先到 → 统一终态（beat=totalBeats、ended 无 reason）；seek 走 seekClips', () => {
  const project = createProject({ pairs: 1 });
  project.timeline.countInBeats = 0;
  project.audio.name = 'a.wav';
  project.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 60, size: 1 }], activeAssetId: 'a1' };
  project.timeline.audioClips = [mkClip({ id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 60 })];
  const audio = makeClipAudioStub();
  const { p, events } = makeClipPlayer(project, audio);
  p.play(0);
  audio._pos = 20.5; // 41 拍 @120bpm > totalBeats 40（24 拍=12s…此处 totalBeats=24 拍=12s）
  void audio._pos;
  // 直接构造 beat 越过 totalBeats 的 tick（single formation: totalBeats=16 拍=8s）
  audio._pos = 8.01;
  p._tick();
  assert.equal(p.playing, false);
  assert.equal(p.beat, p.segments().totalBeats, '时间轴先到 → 停在 totalBeats');
  const last = events.states.at(-1);
  assert.equal(last.ended, true);
  assert.equal(last.reason, undefined, '时间轴自然终了无 reason');
  // seek 播放中 → seekClips 重调度
  p.play(2, { countIn: false });
  audio.calls.seekClips.length = 0;
  p.seekBeat(4);
  assert.deepEqual(audio.calls.seekClips, [2], 'seekBeat=4 拍 → 2s');
  p.stop();
  assert.equal(audio.calls.stopClips >= 1, true, 'stop 停 clip 通道');
});
