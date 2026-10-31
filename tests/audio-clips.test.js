// 音频剪辑引擎单测（exp/audition-lite · 规格 docs/music-clip-ui-spec.md v3）
// 覆盖：数据模型清洗与 v1 迁移（零体验变化）、trim 语义（内容锚定/Shift 变体/源界钳制）、
// split/波纹删除/时间选区修剪、自动等功率交叉淡化（建立/拖开还原/手动淡化不受影响）、
// 淡化包络互补性、有效事件区间（段间静音）、磁吸候选与最近邻、零交叉、波形包络、
// 按队形段自动切（幂等）、ClipTransport 双时钟调度（假 AudioContext）与 Player clip 通道终态。
// 多轨（R47）：tracks 数据形态与 trk1 迁移（旧项目零体验变化）、轨操作 API（removeTrack
// 拒绝非空轨）、双轨同时调度与每轨 Gain 子链路由、轨静音/gain 实时语义、autoPair 双缘
// 升级（链式 A-B、B-C 共享 B 场景）与旧单字段迁移、导出导入往返含 tracks / v1 剥离。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, validateProject, migrateLegacyAudio, sanitizeMedia, sanitizeAudioClips,
  sanitizeTracks, defaultTrack, DEFAULT_TRACK_ID, TRACK_MAX,
  addTrack, removeTrack, renameTrack, setTrackGain, setTrackMuted, moveClipToTrack,
  trackById, trackOfClip, stripTracksForV1,
} from '../js/model.js';
import {
  clipEnd, lastClipEndSec, clipEdgeStepSec, effectiveRegions, capFades, fadeEnvAt, clipGainAt,
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

// ---------- 滑动变速（varispeed · clip.rate 磁带式，slot 域恒定） ----------
test('ClipTransport per-clip rate：组合乘 clip.rate×transport、源消耗=durTl×组合速率、缺省=1 零变化', () => {
  const clips = [
    mkClip({ id: 'v125', timelineStartSec: 0, srcStartSec: 1, lengthSec: 4, rate: 1.25 }),
    mkClip({ id: 'vdef', timelineStartSec: 10, srcStartSec: 0, lengthSec: 4 }), // 无 rate 键（旧数据形态）
  ];
  const { ctx, t } = setupTransport(clips);
  try {
    t.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 30 }) });
    assert.equal(ctx.sources.length, 1, '前瞻内只调度第一个 clip');
    const s1 = ctx.sources[0];
    assert.equal(s1.playbackRate.value, 1.25, 'playbackRate = clip.rate × transport.rate');
    assert.equal(s1.started.off, 1, 'srcOffset=srcStart（skip=0）');
    assert.ok(Math.abs(s1.started.dur - 5) < 1e-6, `源消耗 = durTl×clipRate×transportRate（4×1.25）：${s1.started.dur}`);
    // 时间轴 slot 恒定：clip 结束域不变（4s）——gain 自动化仍按时间轴相对时刻（slot 域）
    assert.equal(clipEnd(clips[0]), 4, 'slot 长度不受 rate 影响');
    // 推进时钟 → 无 rate 键的 clip 照常调度（行为不变）
    ctx.currentTime += 10.5;
    t.tick();
    assert.equal(ctx.sources.length, 2);
    const s2 = ctx.sources[1];
    assert.equal(s2.playbackRate.value, 1, '无 rate 键 → playbackRate 不写（缺省 1，逐字节旧行为）');
    assert.equal(s2.started.off, 0.5, '中途入点：srcOffset = srcStart + skip×rate');
    assert.ok(Math.abs(s2.started.dur - 3.5) < 1e-6, '源消耗 = 剩余 slot 时长×1');
  } finally { t.stopInternal(); }
  // 组合乘：clip 1.5 × transport 2 = 3
  const clips2 = [mkClip({ id: 'vx', timelineStartSec: 0, srcStartSec: 0, lengthSec: 2, rate: 1.5 })];
  const st2 = setupTransport(clips2);
  try {
    st2.t.play(clips2, { from: 0, rate: 2, resolveBuffer: () => ({ duration: 30 }) });
    const sx = st2.ctx.sources[0];
    assert.equal(sx.playbackRate.value, 3, '组合乘 clip1.5×transport2=3');
    assert.ok(Math.abs(sx.started.dur - 6) < 1e-6, '源消耗 = 2×1.5×2=6');
  } finally { st2.t.stopInternal(); }
});

test('ClipTransport per-clip rate：源提前耗尽=调度面不截断（WebAudio 自然停）+ 中途入点越源尾不调度（静音）', () => {
  // 3s 源、rate 2、4s slot：起播调度 dur=8（>源余量）→ 真机 WebAudio 到源尾自然停止（slot 剩余静音）
  const clips = [mkClip({ id: 'tape', timelineStartSec: 0, srcStartSec: 0, lengthSec: 4, rate: 2 })];
  const a = setupTransport(clips);
  try {
    a.t.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 3 }) });
    assert.equal(a.ctx.sources.length, 1);
    assert.equal(a.ctx.sources[0].started.dur, 8, '调度面传 durTl×clipRate（不按源长截断，自然停止语义）');
  } finally { a.t.stopInternal(); }
  // 播放头从 slot 中途进入、源读取位已越源尾（skip=2 → 0+2×2=4 > 3s 源）→ 不调度（磁带放完）
  const b = setupTransport(clips);
  try {
    b.ctx.currentTime += 2; // 从时间轴 2s 起播
    b.t.play(clips, { from: 2, rate: 1, resolveBuffer: () => ({ duration: 3 }) });
    assert.equal(b.ctx.sources.length, 0, '源耗尽段不调度 → slot 剩余=静音');
  } finally { b.t.stopInternal(); }
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
  project.audio.name = 'a.wav';
  project.audio.durationSec = 6;
  project.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 6, size: 1 }], activeAssetId: 'a1' };
  project.timeline.audioClips = [mkClip({ id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 6 })];
  const audio = makeClipAudioStub();
  const { p, events } = makeClipPlayer(project, audio);
  p.play(0);
  assert.equal(p.playing, true);
  assert.deepEqual(audio.calls.playClips[0], { from: 0, rate: 1, n: 1 }, 'clip 调度通道起播');
  // build-51-stageux F1（用户指令改写）：stage 有音频资产 → clip/音频终点先到=播放整体终态
  //（直达音乐尾、无虚拟接管）。原「_audioEnded 虚拟接管 + 续播至 totalBeats」断言随用户指令退役。
  audio._pos = 6; // 越过最后 clip 终点（6s=音乐资产全长）
  p._tick();
  assert.equal(p.playing, false, '音频终点=播放整体终点（两种模式一致）');
  assert.equal(p._audioEnded, false, '无虚拟接管标记');
  assert.equal(Math.abs(p.beat - 12) < 1e-6, true, `播放头钳在末 clip 终点拍（6s@120bpm=12 拍）：${p.beat}`);
  const ended = events.states.find(s => s.ended);
  assert.ok(ended && ended.reason === 'audio');
  p.stop();
});
test('Player clip 通道（stage+音频）：blocks 域不再终局——越 totalBeats 续走，音频终点才 ended；seek 走 seekClips', () => {
  const project = createProject({ pairs: 1 });
  project.audio.name = 'a.wav';
  project.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 60, size: 1 }], activeAssetId: 'a1' };
  project.timeline.audioClips = [mkClip({ id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 60 })];
  const audio = makeClipAudioStub();
  const { p, events } = makeClipPlayer(project, audio);
  p.play(0);
  // build-51-stageux F1（用户指令改写）：beat 越过 totalBeats（16 拍=8s）不再 ended——
  // 播放直达音乐尾（60s 域），音频通道继续驱动
  audio._pos = 8.01;
  p._tick();
  assert.equal(p.playing, true, '越 blocks 域继续走（用户指令：直达音乐尾）');
  assert.equal(Math.abs(p.beat - 16.02) < 1e-6, true, `播放头跟音频秒位（8.01s=16.02 拍）：${p.beat}`);
  // 音频将尽（进入 endSec−0.02 判定窗）→ _finish 音频终态：reason:audio、播放头钳音频末拍
  audio._pos = 59.99;
  p._tick();
  assert.equal(p.playing, false, '音频终点=播放整体终点');
  const last = events.states.at(-1);
  assert.equal(last.ended, true);
  assert.equal(last.reason, 'audio', '音频自然终了 reason:audio');
  assert.equal(Math.abs(p.beat - 119.98) < 1e-6, true, `停在音频末拍（59.99s@120bpm=119.98 拍）：${p.beat}`);
  // seek 播放中 → seekClips 重调度
  p.play(2);
  audio.calls.seekClips.length = 0;
  p.seekBeat(4);
  assert.deepEqual(audio.calls.seekClips, [2], 'seekBeat=4 拍 → 2s');
  p.stop();
  assert.equal(audio.calls.stopClips >= 1, true, 'stop 停 clip 通道');
});

// ---------- 10) 多轨数据模型（R47：timeline.tracks + clip.trackId） ----------
test('多轨迁移：旧项目（无 tracks）载入 → 缺省补建 trk1「配乐」，clip.trackId 缺省/悬挂 → trk1（零体验变化）', () => {
  const p = createProject({ pairs: 1 });
  assert.deepEqual(p.timeline.tracks, [defaultTrack()], '新建项目恒带默认轨 trk1');
  assert.equal(DEFAULT_TRACK_ID, 'trk1');
  assert.equal(TRACK_MAX, 4, '上限常量=4（UI 层把守，模型不强制）');
  // 旧项目形态：timeline 无 tracks 字段、clip 无 trackId（v0.9.x 存量数据）
  const legacy = JSON.parse(JSON.stringify(p));
  delete legacy.timeline.tracks;
  legacy.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 30, size: 1 }], activeAssetId: 'a1' };
  legacy.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 },                  // 无 trackId
    { id: 'c2', assetId: 'a1', timelineStartSec: 10, srcStartSec: 0, lengthSec: 5, trackId: 'trk9' }, // 悬挂引用
  ];
  const r = validateProject(legacy);
  assert.equal(r.ok, true);
  assert.deepEqual(r.project.timeline.tracks, [defaultTrack()], '缺省补建 trk1「配乐」');
  assert.equal(r.project.timeline.audioClips[0].trackId, 'trk1', '缺省迁移 → trk1');
  assert.equal(r.project.timeline.audioClips[1].trackId, 'trk1', '悬挂 trackId 回落 trk1');
  // 幂等：二次校验逐字节一致
  const r2 = validateProject(JSON.parse(JSON.stringify(r.project)));
  assert.deepEqual(r2.project.timeline.tracks, r.project.timeline.tracks);
  assert.deepEqual(r2.project.timeline.audioClips, r.project.timeline.audioClips);
  // 旧 clip 播放语义零变化：trackId 不进增益数学（clipGainAt 不含轨增益）
  assert.equal(clipGainAt(r.project.timeline.audioClips[0], 1), 1);
});

test('sanitizeTracks / validateProject 轨清洗：去重保首个、非法项丢弃、gain 0..2 钳制、空列表缺省补建', () => {
  const ts = sanitizeTracks([
    { id: 'trk1', name: '  配乐改名  ', gain: 9, muted: 1 },
    { id: 'trk1', name: '重复id', gain: 1 },   // 重复 id → 弃
    { id: '', name: '无id' },                  // 空 id → 补 uid
    'junk', null,
    { name: '' },                              // 无 id 无名 → 补 uid + 默认名
  ]);
  assert.equal(ts.length, 3);
  assert.equal(ts[0].name, '配乐改名', 'name trim');
  assert.equal(ts[0].gain, 2, 'gain 钳 0..2');
  assert.equal(ts[0].muted, true);
  assert.notEqual(ts[1].id, 'trk1', '重复项已弃，后续照常入库');
  assert.equal(ts[1].name, '无id');
  assert.ok(ts[2].id);
  assert.equal(ts[2].name, '轨 3', '缺省名按入库序号');
  assert.equal(sanitizeTracks(null).length, 0);
  // validate 入口：空 tracks → 补建默认轨
  const raw = createProject({ pairs: 1 });
  raw.timeline.tracks = [];
  const r = validateProject(raw);
  assert.deepEqual(r.project.timeline.tracks, [defaultTrack()]);
});

test('多轨操作 API：addTrack/renameTrack/setTrackGain/setTrackMuted/moveClipToTrack', () => {
  const p = createProject({ pairs: 1 });
  p.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 60, size: 1 }], activeAssetId: 'a1' };
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 }];
  const t2 = addTrack(p, { name: '音效' });
  assert.equal(p.timeline.tracks.length, 2);
  assert.equal(t2.gain, 1);
  assert.equal(addTrack(p).name, '轨 3', '缺省名避开占用');
  assert.equal(renameTrack(p, t2.id, ''), null, '空名不改');
  assert.equal(renameTrack(p, t2.id, '环境声').name, '环境声');
  assert.equal(setTrackGain(p, t2.id, 5).gain, 2, '钳上限 2');
  assert.equal(setTrackGain(p, t2.id, -1).gain, 0, '钳下限 0');
  assert.equal(setTrackGain(p, 'ghost', 1), null, '未知轨返回 null');
  assert.equal(setTrackMuted(p, t2.id, true).muted, true);
  assert.equal(trackById(p, t2.id).name, '环境声');
  // moveClipToTrack：成功 / clip 不存在 / 轨不存在
  assert.equal(moveClipToTrack(p, 'c1', t2.id).ok, true);
  assert.equal(p.timeline.audioClips[0].trackId, t2.id);
  assert.equal(moveClipToTrack(p, 'ghost', t2.id).ok, false);
  assert.equal(moveClipToTrack(p, 'c1', 'ghost').ok, false);
  // trackOfClip：悬挂/缺失回落 trk1 → 首轨
  p.timeline.audioClips[0].trackId = 'trk9';
  assert.equal(trackOfClip(p, p.timeline.audioClips[0]).id, 'trk1');
  delete p.timeline.audioClips[0].trackId;
  assert.equal(trackOfClip(p, p.timeline.audioClips[0]).id, 'trk1');
  assert.equal(trackOfClip(p, null).id, 'trk1', '无 clip 也回落默认轨（引擎路由兜底）');
});

test('removeTrack：仅允许空轨（非空拒绝、缺 trackId 的 clip 视为归属 trk1）、不存在报错', () => {
  const p = createProject({ pairs: 1 });
  p.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 60, size: 1 }], activeAssetId: 'a1' };
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 },
    { id: 'c2', assetId: 'a1', timelineStartSec: 20, srcStartSec: 0, lengthSec: 5 }, // 无 trackId → 视为 trk1
  ];
  const t2 = addTrack(p, { name: '音效' });
  moveClipToTrack(p, 'c2', t2.id);
  let r = removeTrack(p, t2.id);
  assert.equal(r.ok, false, '非空轨拒绝');
  assert.match(r.error, /仍有音频块/);
  assert.equal(p.timeline.tracks.length, 2, '拒绝时不删');
  moveClipToTrack(p, 'c2', 'trk1');
  r = removeTrack(p, t2.id);
  assert.equal(r.ok, true, '空轨可删');
  assert.equal(p.timeline.tracks.length, 1);
  r = removeTrack(p, 'trk1');
  assert.equal(r.ok, false, 'trk1 上有 clip → 拒绝（含缺 trackId 视同归属）');
  r = removeTrack(p, 'ghost');
  assert.equal(r.ok, false, '轨不存在');
});

// ---------- 11) autoPair 双缘升级（R47：链式三 clip 场景） ----------
test('R47 链式 autoPair：A-B、B-C 共享 B 建对后拖走 C，A-B 对不受扰（双缘精确匹配）', () => {
  const clips = [
    mkClip({ id: 'A', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'B', timelineStartSec: 8, lengthSec: 10 }),
    mkClip({ id: 'C', timelineStartSec: 16, lengthSec: 10 }),
  ];
  applyAutoCrossfades(clips, ['A', 'B', 'C']);
  const [A, B, C] = clips;
  assert.equal(A.fadeOutSec, 2);
  assert.equal(B.fadeInSec, 2, 'A-B 对（B 淡入缘）');
  assert.equal(B.fadeOutSec, 2, 'B-C 对（B 淡出缘）——两条缘并存');
  assert.equal(C.fadeInSec, 2);
  assert.equal(A.autoPairOut, 'B');
  assert.equal(B.autoPairIn, 'A');
  assert.equal(B.autoPairOut, 'C', '中段 clip 双缘各自记录（旧单字段此处被覆写为 C）');
  assert.equal(C.autoPairIn, 'B');
  // 拖走 C：只清 B-C 对，A-B 对逐字节不受扰
  C.timelineStartSec = 30;
  const cleared = pruneAutoCrossfades(clips, 'C');
  assert.ok(cleared.has('C') && cleared.has('B'));
  assert.equal(C.fadeInSec, 0);
  assert.equal(B.fadeOutSec, 0, 'B 侧淡出缘随 C 拖开还原');
  assert.equal(B.fadeOutAuto, false);
  assert.equal(B.fadeInSec, 2, 'A-B 对不受扰（旧实现此处被误清）');
  assert.equal(B.fadeInAuto, true);
  assert.equal(B.autoPairIn, 'A');
  assert.equal(A.fadeOutSec, 2, 'A 侧淡出保留');
  assert.equal(A.fadeOutAuto, true);
  // 再拖走 A：A-B 对整体还原
  A.timelineStartSec = 40;
  const cleared2 = pruneAutoCrossfades(clips, 'A');
  assert.ok(cleared2.has('A') && cleared2.has('B'));
  assert.equal(A.fadeOutSec, 0);
  assert.equal(B.fadeInSec, 0);
  assert.equal(B.fadeInAuto, false);
});

test('R47 autoPair 迁移：旧单字段 → 双缘等价（按缘归属精确迁移；双缘并存按末写=out 启发式）；清洗幂等', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const clips = sanitizeAudioClips([
    { id: 'i1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10, fadeInSec: 2, fadeInAuto: true, autoPair: 'prev' },
    { id: 'o1', assetId: 'a1', timelineStartSec: 20, srcStartSec: 0, lengthSec: 10, fadeOutSec: 2, fadeOutAuto: true, autoPair: 'next' },
    { id: 'mid', assetId: 'a1', timelineStartSec: 40, srcStartSec: 0, lengthSec: 10, fadeInSec: 1, fadeInAuto: true,
      fadeOutSec: 1, fadeOutAuto: true, autoPair: 'later' },
    { id: 'plain', assetId: 'a1', timelineStartSec: 60, srcStartSec: 0, lengthSec: 10 },
  ], assets);
  assert.equal(clips[0].autoPairIn, 'prev', '单 in 缘 → autoPairIn');
  assert.equal(clips[0].autoPairOut, undefined);
  assert.equal(clips[1].autoPairOut, 'next', '单 out 缘 → autoPairOut');
  assert.equal(clips[1].autoPairIn, undefined);
  assert.equal(clips[2].autoPairOut, 'later', '双缘并存：末次写入=淡出缘对端（启发式）');
  assert.equal(clips[2].autoPairIn, undefined, 'in 侧陈旧记录不可考，留待 prune 幽灵清理收口');
  assert.equal(clips[0].autoPair, 'prev', '旧字段保留为兼容镜像（旧版应用读新文件用）');
  assert.equal(clips[3].autoPair, undefined, '无对记录不虚构');
  const again = sanitizeAudioClips(JSON.parse(JSON.stringify(clips)), assets);
  assert.deepEqual(again, clips, '双缘形态清洗幂等');
  // 幽灵清理：双缘指向已删除的对端 → 该缘还原
  const duo = [
    mkClip({ id: 'x', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'y', timelineStartSec: 8, lengthSec: 10 }),
  ];
  applyAutoCrossfades(duo, ['x', 'y']);
  duo.splice(0, 1); // 删 x（未经 prune）
  const cleared = pruneAutoCrossfades(duo, 'y');
  assert.ok(cleared.has('y'), 'y 的 in 缘指向幽灵 x → 还原');
  assert.equal(duo[0].fadeInSec, 0);
  assert.equal(duo[0].fadeInAuto, false);
});

// ---------- 12) ClipTransport 多轨引擎（每轨 Gain 子链） ----------
test('ClipTransport 多轨：双轨同时调度（调度数学逐 clip 独立）、Gain 链挂每轨子链、轨静音/gain 实时', () => {
  const clips = [
    mkClip({ id: 't1a', timelineStartSec: 0, srcStartSec: 1, lengthSec: 4, trackId: 'trk1' }),
    mkClip({ id: 't2a', timelineStartSec: 0, srcStartSec: 2, lengthSec: 4, trackId: 'trk2' }),
  ];
  const tracks = [
    { id: 'trk1', name: '配乐', gain: 1, muted: false },
    { id: 'trk2', name: '音效', gain: 0.5, muted: true },
  ];
  const { ctx, t } = setupTransport(clips);
  try {
    assert.equal(t.play(clips, { from: 0, rate: 1, tracks, resolveBuffer: () => ({ duration: 30 }) }), true);
    assert.equal(ctx.sources.length, 2, '跨轨同时调度：双轨各一 clip 同一 tick 全部起调');
    // 调度数学逐 clip 独立（与单轨同式：off=srcStart、dur=时间线时长×rate）
    assert.equal(ctx.sources[0].started.off, 1);
    assert.ok(Math.abs(ctx.sources[0].started.dur - 4) < 0.02);
    assert.equal(ctx.sources[1].started.off, 2);
    assert.ok(Math.abs(ctx.sources[1].started.dur - 4) < 0.02);
    // Gain 链拓扑：master → [每轨持久子链] ← clip gain；创建序 master、clip1、trk1、clip2、trk2
    const [master, gClip1, gTrk1, gClip2, gTrk2] = ctx.gains;
    assert.equal(gTrk1._to, master, 'trk1 子链挂 master');
    assert.equal(gClip1._to, gTrk1, 'clip1 → trk1 子链');
    assert.equal(gClip2._to, gTrk2, 'clip2 → trk2 子链（按 clip.trackId 分组路由）');
    assert.equal(gTrk2.gain.value, 0, '静音轨=子链增益 0（照常调度、实时可逆）');
    assert.equal(gTrk1.gain.value, 1);
    // 实时语义：setTargetAtTime 平滑生效（无需 reschedule）
    assert.equal(t.setTrackGainById('trk1', 0.8), true);
    assert.ok(gTrk1.gain.ops.some(o => o[0] === 'target' && o[1] === 0.8), '轨 gain 实时');
    assert.equal(t.setTrackMutedById('trk2', false), true);
    assert.ok(gTrk2.gain.ops.some(o => o[0] === 'target' && o[1] === 0.5), '取消静音实时还原到轨增益');
    assert.equal(t.setTrackGainById('ghost', 1), false, '未知轨拒绝');
    assert.equal(t._tracks[0].gain, 0.8, '轨态写回（与项目模型同源）');
    assert.equal(t._tracks[1].muted, false);
    // legacy 总控不受多轨影响（master 恒直通）
    assert.equal(master.gain.value, 1);
  } finally { t.stopInternal(); }
});

test('ClipTransport 多轨：trackId 悬挂回落首轨；syncTracks(null) 回 legacy（clipGain 直连 master）', () => {
  const clips = [{ ...mkClip({ id: 'd1', timelineStartSec: 0, lengthSec: 4 }), trackId: 'trk9' }];
  const tracks = [{ id: 'trkA', name: '唯一', gain: 0.6, muted: false }];
  const { ctx, t } = setupTransport(clips);
  try {
    t.play(clips, { from: 0, tracks, resolveBuffer: () => ({ duration: 30 }) });
    assert.equal(ctx.sources.length, 1);
    const [master, gClip, gTrkA] = ctx.gains;
    assert.equal(gClip._to, gTrkA, '悬挂 trackId → 首轨子链');
    assert.equal(gTrkA.gain.value, 0.6, '子链初值=轨增益');
    assert.equal(gTrkA._to, master);
    // 拆多轨 → 回 legacy 单链：后续调度直连 master（master 持久复用，不重建）
    t.syncTracks(null);
    ctx.sources.length = 0; ctx.gains.length = 0;
    t.reschedule(clips);
    assert.equal(ctx.sources.length, 1);
    assert.equal(ctx.gains.length, 1, '仅新建 clip gain（master 复用）');
    assert.equal(ctx.gains[0]._to, master, 'clipGain 直连 master（旧链路逐字节兼容）');
  } finally { t.stopInternal(); }
});

// ---------- 13) 导出导入往返含 tracks / v1 剥离 ----------
test('导出导入往返含 tracks（轨态/clip 归属无损）；stripTracksForV1 剥离多轨数据（原项目不动）', () => {
  const p = createProject({ pairs: 1 });
  const t2 = addTrack(p, { name: '音效' });
  setTrackGain(p, t2.id, 0.75);
  setTrackMuted(p, 'trk1', true);
  p.media = { assets: [{ id: 'a1', name: 'a.wav', durationSec: 60, size: 1 }], activeAssetId: 'a1' };
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 },
    { id: 'c2', assetId: 'a1', trackId: t2.id, timelineStartSec: 5, srcStartSec: 0, lengthSec: 5 },
  ];
  const r1 = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(r1.ok, true);
  assert.equal(r1.project.timeline.tracks.length, 2);
  assert.equal(r1.project.timeline.tracks[0].muted, true);
  assert.equal(r1.project.timeline.tracks[1].gain, 0.75);
  const r2 = validateProject(JSON.parse(JSON.stringify(r1.project)));
  assert.deepEqual(r2.project.timeline.tracks, r1.project.timeline.tracks, '轨往返无损');
  assert.deepEqual(r2.project.timeline.audioClips.map(c => c.trackId), r1.project.timeline.audioClips.map(c => c.trackId), 'clip 归属往返无损');
  // v1（不含音乐）轻量文件剥离：tracks/trackId 不出户，autoPair 双缘保留，原项目不被修改
  const v1 = stripTracksForV1(r1.project);
  assert.equal(v1.timeline.tracks, undefined);
  assert.equal(v1.timeline.audioClips.every(c => c.trackId === undefined), true);
  assert.equal(r1.project.timeline.tracks.length, 2, 'strip 返回深拷贝，原项目不动');
  assert.equal(r1.project.timeline.audioClips[0].trackId, 'trk1');
});

// ---------- 14) ⏮⏭ clip 缘步进（音乐模式重定位 M3 · 决策①正式实装） ----------
test('clipEdgeStepSec：前/后缘步进取严格近邻；恰在缘上跳过自身；无缘=0/域尾；去重不撞重合缘', () => {
  const clips = [
    { timelineStartSec: 0, lengthSec: 8 },   // 缘 0 / 8
    { timelineStartSec: 8, lengthSec: 6 },   // 缘 8 / 14（与前一 clip 终点重合，去重不重复命中）
    { timelineStartSec: 20, lengthSec: 4 },  // 缘 20 / 24
  ];
  const edgesAsc = [0, 8, 14, 20, 24];
  // ⏭（dir>0）：严格后的最近缘
  for (const [cur, want] of [[0, 8], [3, 8], [8, 14], [9, 14], [14, 20], [24, 64]]) {
    assert.equal(clipEdgeStepSec(clips, cur, 64, 1), want, `⏭ @${cur} → ${want}`);
  }
  // ⏮（dir<0）：严格前的最近缘；无缘=0
  for (const [cur, want] of [[0, 0], [3, 0], [8, 0], [9, 8], [14, 8], [15, 14], [21, 20], [30, 24], [64, 24]]) {
    assert.equal(clipEdgeStepSec(clips, cur, 64, -1), want, `⏮ @${cur} → ${want}`);
  }
  // 全部缘序核对（试金石：从域外 -1 起步，⏭ 连跳恰好遍历 0/8/14/20/24）
  let cur = -1;
  for (const want of edgesAsc) { cur = clipEdgeStepSec(clips, cur, 64, 1); assert.equal(cur, want); }
  // 无 clip：⏮=0、⏭=域尾
  assert.equal(clipEdgeStepSec([], 10, 64, -1), 0);
  assert.equal(clipEdgeStepSec([], 10, 64, 1), 64);
  // 单 clip 全长（载入音乐缺省形态）：⏮=0、⏭=域尾（终点已是末缘）
  const single = [{ timelineStartSec: 0, lengthSec: 64 }];
  assert.equal(clipEdgeStepSec(single, 30, 64, -1), 0);
  assert.equal(clipEdgeStepSec(single, 30, 64, 1), 64);
  // 浮点噪声缘规约：8.100000000001 与 8.1 视为同缘（r6）
  const noisy = [{ timelineStartSec: 0, lengthSec: 8.1 }, { timelineStartSec: 8.100000000001, lengthSec: 2 }];
  assert.equal(clipEdgeStepSec(noisy, 8.1000000001, 64, 1), 10.1);
});

// ---------- 15) ClipTransport processed 消费（clip.speed/pitchSemi 变速变调 · 1:1 播放） ----------
// 语义契约（clip-process.js · 并行交付）：needsProcess(clip)=speed≠1||semi≠0；processed buffer
// 时长=源/speed（变速已烘焙）→ 1:1 消费（playbackRate 恒 1）、processed 域=源域÷speed
//（入点=srcStartSec/speed）、slot 时长恒定；processed 比slot 短 → 截断调度，slot 剩余静音。
test('ClipTransport processed：needsProcess+同步 buffer → 1:1 消费（playbackRate 恒 1、入点=srcStart/speed、processed 短于 slot 截断静音）', () => {
  const pbuf1 = { duration: 1 };   // 1s processed（< slot 2s：磁带放完语义）
  const pbuf4 = { duration: 4 };
  const clips = [
    mkClip({ id: 'pc1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 2, speed: 2 }),
    mkClip({ id: 'pc2', assetId: 'a2', timelineStartSec: 10, srcStartSec: 1, lengthSec: 2, speed: 2 }),
    mkClip({ id: 'pc3', assetId: 'a3', timelineStartSec: 20, srcStartSec: 2, lengthSec: 2, pitchSemi: 3 }), // 仅变调
  ];
  const ctx = fakeCtx();
  // processed=整资产 TSM 产物（同资产同参数共享一份）→ 桩按 assetId 供给，与传输侧缓存键口径一致
  const t = new ClipTransport({ getContext: () => ctx, destination: () => ctx.destination,
    resolveProcessed: c => ({ a1: pbuf1, a2: pbuf4, a3: pbuf4 }[c.assetId]) || null });
  try {
    t.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 30 }) });
    assert.equal(ctx.sources.length, 1, '前瞻内只调度 pc1');
    const s1 = ctx.sources[0];
    assert.equal(s1.buffer, pbuf1, '用 processed buffer 播放（非 raw）');
    assert.equal(s1.playbackRate.value, 1, 'playbackRate 恒 1（变速已烘焙，不再乘 speed）');
    assert.equal(s1.started.off, 0, '入点=srcStart/speed=0');
    assert.ok(Math.abs(s1.started.dur - 1) < 1e-6, `processed 1s < slot 2s → 截断调度 1s，slot 剩余静音：${s1.started.dur}`);
    // 推进时钟 → pc2（10.5s 中途入点，skip=0.5）：非零源入点按 ÷speed 映射、skip 1:1 直映射
    ctx.currentTime += 10.5;
    t.tick();
    const s2 = ctx.sources[1];
    assert.equal(s2.buffer, pbuf4);
    assert.equal(s2.started.off, 1, '入点 = srcStartSec/speed(0.5) + skip×1(0.5)');
    assert.ok(Math.abs(s2.started.dur - 1.5) < 1e-6, 'processed 足量 → 剩余 slot 1:1（dur=1.5s）');
    assert.equal(s2.playbackRate.value, 1);
    // pc3（仅 pitchSemi、无 speed）：speed 缺省 1 → 入点=srcStart+skip（21s 入点 skip=1）
    ctx.currentTime += 10.5;
    t.tick();
    const s3 = ctx.sources[2];
    assert.equal(s3.started.off, 3, 'speed 缺省 1 → 入点=srcStart(2)+skip(1)');
    assert.ok(Math.abs(s3.started.dur - 1) < 1e-6, '剩余 slot 1:1');
    assert.equal(s3.playbackRate.value, 1);
  } finally { t.stopInternal(); }
});

test('ClipTransport processed 缺失：resolveProcessed 返 null/构造未提供 → 既有 raw 路径原样（speed 不消费）', () => {
  const clips = [mkClip({ id: 'rc1', timelineStartSec: 0, srcStartSec: 1, lengthSec: 2, speed: 2 })];
  const ctx = fakeCtx();
  let calls = 0;
  const t = new ClipTransport({ getContext: () => ctx, destination: () => ctx.destination,
    resolveProcessed: () => { calls++; return null; } });
  try {
    t.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 30 }) });
    assert.ok(calls >= 1, 'provider 被询问');
    const s = ctx.sources[0];
    assert.equal(s.started.off, 1, 'raw 路径：off=srcStart');
    assert.ok(Math.abs(s.started.dur - 2) < 1e-6, 'raw 路径：dur=slot（speed 不折叠，行为与无 processed 供给一致）');
    assert.equal(s.playbackRate.value, 1);
  } finally { t.stopInternal(); }
  // 构造缺省（未传 resolveProcessed）同样 raw 原样（零变化承诺）
  const t2 = new ClipTransport({ getContext: () => ctx, destination: () => ctx.destination });
  try {
    t2.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 30 }) });
    const s2 = ctx.sources.at(-1);
    assert.equal(s2.started.off, 1);
    assert.equal(s2.started.dur, 2);
    assert.equal(s2.playbackRate.value, 1);
  } finally { t2.stopInternal(); }
});

test('ClipTransport processed 异步：Promise 未就绪先 raw@speed 应急起播，到位后 reschedule 一次换入（缓存防重复询问）', async () => {
  const pbuf = { duration: 4 };
  const clips = [mkClip({ id: 'ac1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 2, speed: 2 })];
  const ctx = fakeCtx();
  let calls = 0, fire = null;
  const t = new ClipTransport({ getContext: () => ctx, destination: () => ctx.destination,
    resolveProcessed: () => { calls++; return new Promise(r => { fire = r; }); } });
  try {
    t.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 30 }) });
    assert.equal(calls, 1);
    const gap = ctx.sources[0];
    assert.notEqual(gap.buffer, pbuf, '应急路用 raw buffer');
    assert.equal(gap.playbackRate.value, 2, '应急：raw 以 playbackRate=speed 磁带式先响（音高暂变，秒级切换）');
    assert.ok(Math.abs(gap.started.dur - 4) < 1e-6, '应急源消耗=slot×speed=4');
    assert.equal(gap.started.off, 0);
    assert.ok(ctx.gains.length >= 2, '应急路增益链照常（静音/淡化作用于调度后节点，不变）');
    // processed 到位 → 微任务内自动 reschedule 换入（_pendingProcessed 标记 + 缓存防循环）
    fire(pbuf);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(calls, 1, '缓存命中：provider 不被二次询问（无重复挂接/重调度循环）');
    const ps = ctx.sources[1];
    assert.equal(ps.buffer, pbuf, 'processed 到位后换入');
    assert.equal(ps.playbackRate.value, 1, '换入后 playbackRate 恒 1');
    assert.ok(Math.abs(ps.started.dur - 2) < 1e-6, '满槽 1:1（dur=slot 2s）');
    assert.equal(ps.started.off, 0);
    assert.ok(gap.stopped, '应急源已随重调度统一 stop()');
  } finally { t.stopInternal(); }
});

test('ClipTransport 门控：无 speed/pitchSemi 的 clip 不询问 provider（raw 原样，行为零变化）', () => {
  const clips = [mkClip({ id: 'gc1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 2 })];
  const ctx = fakeCtx();
  let calls = 0;
  const t = new ClipTransport({ getContext: () => ctx, destination: () => ctx.destination,
    resolveProcessed: () => { calls++; return { duration: 5 }; } });
  try {
    t.play(clips, { from: 0, rate: 1, resolveBuffer: () => ({ duration: 30 }) });
    assert.equal(calls, 0, 'needsProcess=false → provider 零询问');
    const s = ctx.sources[0];
    assert.equal(s.started.off, 0);
    assert.equal(s.started.dur, 2);
    assert.equal(s.playbackRate.value, 1);
  } finally { t.stopInternal(); }
});
