// 淡化曲线单测（build-45-fadecurve）
// 覆盖：
//   F2 曲线引擎 —— fadePow 纯函数（k∈[-1,1]→p∈[0.5,2]、越界收界、非法=1）、fadeEnvAt
//     k=0 与旧等功率公式**逐位一致**（既有行为零漂移）、k=±1 形状方向（单调性与快慢）；
//   F1 同轨限定 —— computeOverlaps 跨轨不配对/同轨（含缺省 trackId）仍配对；这是**有意
//     的规格变更**：旧实现（裁定③）跨轨重叠也建自动淡化对，多轨叠层（垫底曲+点缀音效）
//     会被误干预——自 build-45 起跨轨重叠零自动干预；
//   F2 数据模型 —— sanitizeAudioClips 曲线字段：旧数据无字段不补写（deepEqual 往返）、
//     [-1,1] 外收界、非法值=0 省略、清洗幂等（JSON 往返无损）、validateProject 保留曲线；
//   F5 接缝双曲线同调 —— setSeamCurves 同写前缘 fadeOutCurve / 后缘 fadeInCurve、钳制、
//     不动时长与 auto 标志（交叉时间不变）；
//   F6 淡化归零 —— resetClipFades 模型效果：手动缘全清零、auto 对整对解绑（含对端回指缘
//     与双缘记录）、幽灵对端缘还原、混合形态（auto 出缘+手动入缘）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, validateProject, sanitizeAudioClips, DEFAULT_TRACK_ID,
} from '../js/model.js';
import {
  fadeEnvAt, fadePow, fadeEdgeEnv, clipGainAt,
  computeOverlaps, applyAutoCrossfades, pruneAutoCrossfades,
  setSeamCurves, resetClipFades,
} from '../js/audio-clips.js';

// ---------- 工厂 ----------
function mkClip(over = {}) {
  return {
    id: over.id || 'c1', assetId: over.assetId || 'a1',
    timelineStartSec: 0, srcStartSec: 0, lengthSec: 10,
    fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'clip',
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !['id', 'assetId'].includes(k))),
  };
}
// 旧版等功率包络（build-44 逐字拷贝）——k=0 逐位兼容的对照基准
function legacyEnv(c, t) {
  let v = 1;
  const fi = c.fadeInSec || 0, fo = c.fadeOutSec || 0;
  if (fi > 1e-4 && t < fi) v *= Math.sin((Math.max(0, t) / fi) * Math.PI / 2);
  if (fo > 1e-4) {
    const fromEnd = c.lengthSec - t;
    if (fromEnd < fo) v *= Math.sin((Math.max(0, fromEnd) / fo) * Math.PI / 2);
  }
  return v;
}

// ---------- F2：fadePow 纯函数 ----------
test('fadePow：k=0→1（等功率）、k=1→2、k=-1→0.5；[-1,1] 外收界；非法值=1', () => {
  assert.equal(fadePow(0), 1);
  assert.equal(fadePow(1), 2);
  assert.equal(fadePow(-1), 0.5);
  assert.equal(fadePow(0.5), Math.SQRT2);
  assert.equal(fadePow(3), 2, '正越界收到 +1 → p=2');
  assert.equal(fadePow(-7), 0.5, '负越界收到 -1 → p=0.5');
  assert.equal(fadePow(undefined), 1, '缺省（旧数据无字段）= 等功率');
  assert.equal(fadePow('garbage'), 1, '非法值=等功率');
});

// ---------- F2：k=0 逐位兼容（既有行为零漂移） ----------
test('fadeEnvAt k=0/无字段：与 build-44 等功率公式逐位一致（Object.is 扫描）', () => {
  const base = { lengthSec: 10, fadeInSec: 3, fadeOutSec: 4 };
  for (const curve of [undefined, 0, 0.0, -0]) {
    const c = { ...base };
    if (curve !== undefined) { c.fadeInCurve = curve; c.fadeOutCurve = curve; }
    for (let t = 0; t <= 10; t += 0.037) {
      const got = fadeEnvAt(c, t);
      const want = legacyEnv(base, t);
      assert.ok(Object.is(got, want), `t=${t} curve=${curve} got=${got} want=${want}`);
    }
  }
  // 无淡化段时恒 1（既有）
  assert.equal(fadeEnvAt(mkClip({ lengthSec: 5 }), 2), 1);
});

test('fadeEdgeEnv：k 缺省/0 = sin(θ·π/2) 逐位；[0,1] 外钳制', () => {
  for (let th = 0; th <= 1; th += 0.021) {
    assert.ok(Object.is(fadeEdgeEnv(th, undefined), Math.sin(th * Math.PI / 2)));
    assert.ok(Object.is(fadeEdgeEnv(th, 0), Math.sin(th * Math.PI / 2)));
  }
  assert.equal(fadeEdgeEnv(-0.5, 0), 0);
  assert.equal(fadeEdgeEnv(1.5, 0), 1);
});

// ---------- F2：k=±1 形状方向（听感「速度」） ----------
test('fadeIn 曲线方向：k=1 慢起（半程低于等功率）、k=-1 快起（半程高于等功率）；单调不减', () => {
  const half = { fadeInSec: 2 };
  const vEq = fadeEnvAt({ ...half, lengthSec: 10 }, 1);          // θ=0.5 等功率
  const vSlow = fadeEnvAt({ ...half, lengthSec: 10, fadeInCurve: 1 }, 1);
  const vFast = fadeEnvAt({ ...half, lengthSec: 10, fadeInCurve: -1 }, 1);
  assert.ok(vSlow < vEq, `k=1 慢起：${vSlow} < ${vEq}`);
  assert.ok(vFast > vEq, `k=-1 快起：${vFast} > ${vEq}`);
  // 单调性：曲线只弯相位不弯方向——任意 k 淡入包络仍不减
  for (const k of [-1, -0.5, 0.5, 1]) {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = fadeEnvAt({ fadeInSec: 2, lengthSec: 10, fadeInCurve: k }, 2 * i / 20);
      assert.ok(v >= prev - 1e-12, `k=${k} t=${2 * i / 20} 非单调`);
      prev = v;
    }
  }
});

test('fadeOut 曲线方向：k=1 起落更急（衰减前段低于等功率）、k=-1 拖尾更缓（前段高于等功率）', () => {
  // 淡出 4s 于 10s clip：τ=衰减进度（0=起落点），θ'=1-τ
  const base = { lengthSec: 10, fadeOutSec: 4 };
  for (const tau of [0.25, 0.5, 0.75]) {
    const t = 6 + 4 * tau; // 淡出起点 6s
    const vEq = fadeEnvAt({ ...base }, t);
    const vSharp = fadeEnvAt({ ...base, fadeOutCurve: 1 }, t);
    const vGentle = fadeEnvAt({ ...base, fadeOutCurve: -1 }, t);
    assert.ok(vSharp < vEq, `τ=${tau} k=1 急落：${vSharp} < ${vEq}`);
    assert.ok(vGentle > vEq, `τ=${tau} k=-1 拖尾：${vGentle} > ${vEq}`);
  }
});

test('clipGainAt 走同一包络：曲线经播放增益路径生效（含静音短路）', () => {
  const c = mkClip({ lengthSec: 10, fadeInSec: 2, fadeInCurve: 1, gain: 2 });
  assert.ok(Math.abs(clipGainAt(c, 1) - 2 * fadeEnvAt(c, 1)) < 1e-12);
  assert.equal(clipGainAt(mkClip({ muted: true, fadeInCurve: 1 }), 0), 0);
});

// ---------- F1：computeOverlaps 同轨限定（规格变更） ----------
test('computeOverlaps 同轨限定：跨轨不配对（规格变更：跨轨重叠零自动干预）；同轨仍配对', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10, trackId: 'trk1' }),
    mkClip({ id: 'b', timelineStartSec: 8, lengthSec: 10, trackId: 'trk2' }),  // 与 a 时间重叠但跨轨
    mkClip({ id: 'c', timelineStartSec: 16, lengthSec: 10, trackId: 'trk2' }), // 与 b 同轨重叠
    mkClip({ id: 'd', timelineStartSec: 24, lengthSec: 10 }),                  // 无 trackId（缺省轨）
    mkClip({ id: 'e', timelineStartSec: 30, lengthSec: 10 }),                  // 无 trackId（缺省轨）
  ];
  const ovs = computeOverlaps(clips);
  assert.equal(ovs.length, 2, '只有 b-c（同轨）与 d-e（缺省轨）两对');
  assert.equal(ovs[0].a.id, 'b'); assert.equal(ovs[0].b.id, 'c');
  assert.equal(ovs[1].a.id, 'd'); assert.equal(ovs[1].b.id, 'e');
});

test('applyAutoCrossfades 跨轨不建对（F1 规格变更：多轨叠层不受自动淡化干预）；同轨照旧', () => {
  const clips = [
    mkClip({ id: 'x', timelineStartSec: 0, lengthSec: 10, trackId: 'trk1' }),
    mkClip({ id: 'y', timelineStartSec: 8, lengthSec: 10, trackId: 'trk2' }), // 跨轨重叠：不干预
    mkClip({ id: 'z', timelineStartSec: 20, lengthSec: 10, trackId: 'trk2' }),
    mkClip({ id: 'w', timelineStartSec: 28, lengthSec: 10, trackId: 'trk2' }), // z-w 同轨重叠
  ];
  const touched = applyAutoCrossfades(clips, ['x', 'y', 'z', 'w']);
  assert.equal(touched.has('x'), false, '跨轨对 x 不被触碰');
  assert.equal(touched.has('y'), false);
  assert.equal(clips[0].fadeOutSec, 0, '跨轨叠层不设自动淡化');
  assert.equal(clips[1].fadeInSec, 0);
  assert.equal(clips[2].fadeOutSec, 2, '同轨对 z-w 照常建对');
  assert.equal(clips[3].fadeInSec, 2);
  assert.equal(clips[2].fadeOutAuto, true);
  // 拖开（跨轨对无对可拆；同轨对随拖开还原）——prune 用自身时间重叠判定，跨轨陈旧缘亦可清
  clips[1].fadeOutAuto = true; clips[1].autoPairOut = 'z'; clips[1].fadeOutSec = 2; // 模拟旧版跨轨陈旧缘
  clips[3].timelineStartSec = 60;
  const cleared = pruneAutoCrossfades(clips, 'w');
  assert.ok(cleared.has('w') && cleared.has('z'), '同轨对拖开整体还原');
  assert.equal(clips[2].fadeOutSec, 0);
  assert.equal(clips[3].fadeInSec, 0);
});

// ---------- F2 数据模型：sanitize 缺省/钳制/往返 ----------
test('sanitizeAudioClips 曲线：旧数据无字段不补写；[-1,1] 外收界；非法值省略；0 省略', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const clips = sanitizeAudioClips([
    { id: 'old', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10 },
    { id: 'hi', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10, fadeInCurve: 3, fadeOutCurve: -7 },
    { id: 'bad', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10, fadeInCurve: 'oops', fadeOutCurve: NaN },
    { id: 'zero', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10, fadeInCurve: 0, fadeOutCurve: 0.4 },
    { id: 'frac', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10, fadeInCurve: 0.333333 },
  ], assets);
  assert.equal(clips[0].fadeInCurve, undefined, '旧数据零迁移：不新增键');
  assert.equal(clips[0].fadeOutCurve, undefined);
  assert.equal(clips[1].fadeInCurve, 1, '越界收 +1');
  assert.equal(clips[1].fadeOutCurve, -1, '越界收 -1');
  assert.equal(clips[2].fadeInCurve, undefined, '非法=0=省略');
  assert.equal(clips[2].fadeOutCurve, undefined);
  assert.equal(clips[3].fadeInCurve, undefined, '0 省略（与缺省形态一致）');
  assert.equal(clips[3].fadeOutCurve, 0.4, '合法非 0 落盘');
  assert.equal(clips[4].fadeInCurve, 0.333333, 'r6 舍入同时长字段规矩');
});

test('sanitize 曲线幂等 + JSON 往返无损 + validateProject 保留', () => {
  const assets = [{ id: 'a1', durationSec: 60 }];
  const first = sanitizeAudioClips([
    { id: 'c1', assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 10,
      fadeInSec: 2, fadeInCurve: -0.75, fadeOutSec: 1, fadeOutCurve: 0.5 },
  ], assets);
  const again = sanitizeAudioClips(JSON.parse(JSON.stringify(first)), assets);
  assert.deepEqual(again, first, '清洗幂等（含曲线键形态）');
  // validateProject 全链路：导入旧项目（带曲线）→ 曲线保留
  const p = createProject();
  p.media = { assets: [{ id: 'a1', name: 'x', durationSec: 60, size: 0 }], activeAssetId: 'a1' };
  p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', trackId: DEFAULT_TRACK_ID,
    timelineStartSec: 0, srcStartSec: 0, lengthSec: 10, fadeInSec: 1, fadeInCurve: 0.25 }];
  const r = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(r.ok, true, JSON.stringify(r.errors || []));
  assert.equal(r.project.timeline.audioClips[0].fadeInCurve, 0.25, 'validate 往返保留曲线');
});

// ---------- F5：接缝双曲线同调（模型层纯函数） ----------
test('setSeamCurves：前缘 fadeOutCurve 与后缘 fadeInCurve 同写同一 k；钳制；时长与 auto 标志不动', () => {
  const a = mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10, fadeOutSec: 2, fadeOutAuto: true, autoPairOut: 'b' });
  const b = mkClip({ id: 'b', timelineStartSec: 8, lengthSec: 10, fadeInSec: 2, fadeInAuto: true, autoPairIn: 'a' });
  const k = setSeamCurves(a, b, 0.7);
  assert.equal(k, 0.7);
  assert.equal(a.fadeOutCurve, 0.7, '前 clip 渐弱曲线');
  assert.equal(b.fadeInCurve, 0.7, '后 clip 渐强曲线（同调）');
  assert.equal(a.fadeOutSec, 2, '交叉时长不动');
  assert.equal(b.fadeInSec, 2);
  assert.equal(a.fadeOutAuto, true, '曲线调整不解除配对');
  assert.equal(b.fadeInAuto, true);
  setSeamCurves(a, b, 42);
  assert.equal(a.fadeOutCurve, 1, '钳 +1');
  assert.equal(b.fadeInCurve, 1);
  setSeamCurves(a, b, -42);
  assert.equal(a.fadeOutCurve, -1, '钳 -1');
  assert.equal(b.fadeInCurve, -1);
  // 包络随即反映：交叉区内 a 渐弱变急（k>0）、b 渐强变缓（k>0）——同调后缝两侧「速度」同步
  setSeamCurves(a, b, 1);
  const va = fadeEnvAt({ ...a }, 9);   // a 相对时刻 9（淡出 2s 带内，θ'=0.5）
  const vb = fadeEnvAt({ ...b }, 1);   // b 相对时刻 1（淡入 2s 带内，θ=0.5）
  assert.ok(va < fadeEnvAt({ ...a, fadeOutCurve: 0 }, 9), 'k=1 前缘衰减更急');
  assert.ok(vb < fadeEnvAt({ ...b, fadeInCurve: 0 }, 1), 'k=1 后缘爬升更慢（快慢同调，听感方向相反是曲线本性）');
});

// ---------- F6：淡化归零（resetClipFades 模型效果） ----------
test('resetClipFades 手动缘：长度+曲线全清零；无对记录可清', () => {
  const c = mkClip({ id: 'm', lengthSec: 10, fadeInSec: 2, fadeInCurve: 0.5, fadeOutSec: 3, fadeOutCurve: -0.5 });
  const cleared = resetClipFades([c], 'm');
  assert.ok(cleared.has('m'));
  assert.equal(c.fadeInSec, 0);
  assert.equal(c.fadeOutSec, 0);
  assert.equal(c.fadeInCurve, 0);
  assert.equal(c.fadeOutCurve, 0);
  assert.equal(c.fadeInAuto, false);
  assert.equal(c.fadeOutAuto, false);
});

test('resetClipFades auto 对：整对解绑（自身缘+对端回指缘+双缘记录/兼容镜像）', () => {
  const clips = [
    mkClip({ id: 'a', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'b', timelineStartSec: 8, lengthSec: 10 }),
  ];
  applyAutoCrossfades(clips, ['a', 'b']);
  const [a, b] = clips;
  a.fadeOutCurve = 0.8; b.fadeInCurve = 0.8; // 缝把手调过曲线
  const cleared = resetClipFades(clips, 'a'); // 只归零 a → 整对解绑（含 b 侧回指缘）
  assert.ok(cleared.has('a') && cleared.has('b'));
  assert.equal(a.fadeOutSec, 0); assert.equal(a.fadeOutAuto, false);
  assert.equal(a.fadeOutCurve, 0); assert.equal(a.autoPairOut, null); assert.equal(a.autoPair, null);
  assert.equal(b.fadeInSec, 0); assert.equal(b.fadeInAuto, false, '对端回指缘随整对还原');
  assert.equal(b.fadeInCurve, 0);
  assert.equal(b.autoPairIn, null); assert.equal(b.autoPair, null);
  // 仍重叠也解绑（显式用户动作，区别于 prune 的「仍重叠=对仍成立」）
});

test('resetClipFades 幽灵对端 + 混合形态：陈旧缘一并还原；另一缘的无关对不受扰', () => {
  // 幽灵：对端已删（未 prune），归零应顺带清掉幽灵缘
  const duo = [
    mkClip({ id: 'x', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'y', timelineStartSec: 8, lengthSec: 10 }),
  ];
  applyAutoCrossfades(duo, ['x', 'y']);
  duo.splice(0, 1); // 删 x
  const cleared = resetClipFades(duo, 'y');
  assert.ok(cleared.has('y'));
  assert.equal(duo[0].fadeInSec, 0);
  assert.equal(duo[0].fadeInCurve, 0);
  assert.equal(duo[0].autoPairIn, null);
  // 混合：链式中段 b（in 缘对 a、out 缘对 c），只归零 b → b 双缘清，a/c 各自保留
  const chain = [
    mkClip({ id: 'A', timelineStartSec: 0, lengthSec: 10 }),
    mkClip({ id: 'B', timelineStartSec: 8, lengthSec: 10 }),
    mkClip({ id: 'C', timelineStartSec: 16, lengthSec: 10 }),
  ];
  applyAutoCrossfades(chain, ['A', 'B', 'C']);
  const cleared2 = resetClipFades(chain, 'B');
  assert.ok(cleared2.has('B') && cleared2.has('A') && cleared2.has('C'), '两侧回指缘都随中段归零还原');
  assert.equal(chain[1].fadeInSec, 0);
  assert.equal(chain[1].fadeOutSec, 0);
  assert.equal(chain[1].fadeInCurve, 0);
  assert.equal(chain[1].fadeOutCurve, 0);
  assert.equal(chain[0].fadeOutSec, 0, 'A 侧对端缘还原');
  assert.equal(chain[2].fadeInSec, 0, 'C 侧对端缘还原');
  // 归零后重建对：时长回来、曲线保持缺省 0（归零语义=回等功率）
  applyAutoCrossfades(chain, ['A', 'B', 'C']);
  assert.equal(chain[1].fadeInSec, 2);
  assert.equal(chain[1].fadeInCurve || 0, 0, '重建对不复活已归零曲线');
});
