// 导出视频（编排播放）单测 —— build-91-varispeed Mediabunny 方案重写
// 覆盖：
//   1) PRESETS 三档与码率、pickPreset 缺省回退；
//   2) stripLayout 几何（三轨条 130px）与 stripXAt 时间映射；
//   3) 三轨条带数据：队形段（computeSegments 同源）/音乐 clip+envAt 粗采样/tag 最深层区域；
//   4) 音频混音排布计划（mixPlan：静音跳过/越域钳制/轨增益）与逐样本增益与引擎 clipGainAt
//      一致性（mixClipInto 线性插值重采样，含单声道源展开）；
//   5) 文件名构造（项目名-YYYYMMDD.mp4，安全化同 export.safeName 口径）；
//   6) probeExportCapabilities 三态（globalThis 注入 dummy WebCodecs、注入/还原无泄漏）：
//      裸环境拒绝 / 原生 AAC / 原生 Opus / wasm 软编兜底；videoExportSupported 语义收窄
//      （VideoEncoder+VideoFrame 即可，音频不再否决）；
//   7) 残留清零 grep：js/ 全树无旧方案符号（vendored 上游文件放行，清单在案）+ 旧模块文件已删；
//   8) vendor 在场与 provenance（版本/license 头/wasm 内联体积证据/可加载/注册幂等）；
//   9) 构建 ORDER：mediabunny/aac-encoder 前置于 video-export、两旧模块清出、nsKey 连字符映射；
//  10) exportVideo 静态断言：Mediabunny 管线（MP4 in-memory/avc/背压 await add/三相位/
//      软编懒注册）/插值复用 posAt/结果契约字段/错误文案。
// 不 pin build 号（版本锥归主流程）；mp4 封装字节级断言随旧方案退役（封装交给 mediabunny 上游测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRESETS, DEFAULT_PRESET_ID, pickPreset, stripLayout, stripXAt, STRIP_H,
  formationBandData, musicBandData, tagBandData, mixPlan, mixClipInto,
  videoFileName, videoExportSupported, exportVideo, probeExportCapabilities,
} from '../js/video-export.js';
import { createProject, addTag, createFormationFrom, beatToSec, musicDomainSec } from '../js/model.js';
import { clipGainAt, envAt } from '../js/audio-clips.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// ---------- PRESETS / stripLayout ----------
test('PRESETS：三档定义与码率（视频码率域值 + 音频统一 80kbps）', () => {
  assert.deepEqual(PRESETS.map(p => p.id), ['small', 'standard', 'hd']);
  assert.deepEqual(PRESETS.map(p => p.width), [640, 960, 1280]);
  assert.deepEqual(PRESETS.map(p => p.height), [360, 540, 720]);
  assert.deepEqual(PRESETS.map(p => [p.fps, p.bitrate, p.audioBitrate]), [[15, 450000, 80000], [15, 800000, 80000], [15, 1300000, 80000]]);
  assert.equal(DEFAULT_PRESET_ID, 'standard');
  assert.equal(pickPreset('hd').width, 1280);
  assert.equal(pickPreset('不存在').id, 'standard', '非法 id 回退默认「标准」');
});

test('stripLayout：130px 三轨条几何（队形/音乐/标签行序、舞台区=高-130）', () => {
  for (const p of PRESETS) {
    const L = stripLayout(p);
    assert.equal(L.width, p.width);
    assert.equal(L.height, p.height);
    assert.equal(L.stripH, STRIP_H);
    assert.equal(L.stripY, p.height - STRIP_H);
    assert.equal(L.stageH, p.height - STRIP_H, '舞台区=上部剩余');
    const r = L.rows;
    assert.equal(r.formation.y, L.stripY + 4);
    assert.equal(r.music.y, r.formation.y + 46 + 4);
    assert.equal(r.tag.y, r.music.y + 40 + 4);
    assert.ok(r.tag.y + r.tag.h <= p.height, '标签行不出条');
    assert.deepEqual([r.formation.h, r.music.h, r.tag.h], [46, 40, 24]);
  }
  const L1 = stripLayout(PRESETS[0]), L2 = stripLayout(PRESETS[0]);
  assert.deepEqual(L1, L2, '同入参恒同输出（纯函数）');
});

test('stripXAt：时间轴范围=音乐域、线性映射、零域托底', () => {
  const L = stripLayout(PRESETS[1]);
  assert.equal(stripXAt(L, 20, 0), 0);
  assert.equal(stripXAt(L, 20, 10), 480, '半域=半宽');
  assert.equal(stripXAt(L, 20, 20), 960, '满域=满宽');
  assert.equal(stripXAt(L, 20, 30), 960, '越域钳满宽');
  assert.equal(stripXAt(L, 0, 5), 960, '零域退化钳满宽（不产生 NaN/Infinity）');
});

// ---------- 三轨条带数据 ----------
function demoProject() {
  const p = createProject({ title: '导出演示', pairs: 2 });
  p.media.assets = [{ id: 'a1', name: 'test', durationSec: 20, size: 1 }];
  p.media.activeAssetId = 'a1';
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 2, srcStartSec: 1, lengthSec: 10, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'main' },
  ];
  return p;
}
const FAKE_ENV = { bucket: 512, count: 4, sampleRate: 8000, durationSec: 20, min: new Float32Array([0.1, 0.5, 0.5, 0.1]), max: new Float32Array([0.2, 0.9, 0.9, 0.2]), peak: 1 };

test('formationBandData：hold 实底块（队形色+名）+ travel 灰块，px=秒/域×宽', () => {
  const p = demoProject();
  const L = stripLayout(PRESETS[1]);
  const bands = formationBandData(p, L, 20);
  const hold = bands.find(b => b.kind === 'hold');
  assert.ok(hold);
  assert.equal(hold.color, p.formations[0].color);
  assert.equal(hold.name, '开场队形');
  assert.ok(/s$/.test(hold.label), '队形段时长秒呈示（beatToSec 差值，时间唯一标准）');
  // 单队形 holdStart=0..holdEnd=16 拍 → 0..beatToSec(16)=8s → x1=8/20*960=384
  assert.equal(hold.x0, 0);
  assert.equal(hold.x1, beatToSec(p, 16) / 20 * 960);
  // 双队形：travel 块夹在两 hold 块之间
  const p2 = demoProject();
  createFormationFrom(p2, 0); // 第二队形（内部 syncTimeline）
  const bands2 = formationBandData(p2, L, 20);
  const kinds = bands2.map(b => b.kind);
  assert.deepEqual(kinds, ['hold', 'travel', 'hold'], 'hold→travel→hold 顺序');
  assert.ok(bands2[1].x0 === bands2[0].x1 && bands2[2].x0 === bands2[1].x1, 'travel 恰夹两 hold 之间');
});

test('musicBandData：clip 色块 + envAt 粗粒度振幅条（3px 步进、源域取样、缺失回退 0.14 平线）', () => {
  const p = demoProject();
  const L = stripLayout(PRESETS[1]);
  const bands = musicBandData(p, L, 20, () => FAKE_ENV);
  assert.equal(bands.length, 1);
  const c = bands[0];
  assert.equal(c.color, '#38bdf8');
  assert.equal(c.muted, false);
  assert.equal(Math.round(c.x0 * 100) / 100, Math.round(2 / 20 * 960 * 100) / 100, 'clip 起点 px（timelineStart 2s）');
  assert.equal(Math.round(c.x1 * 100) / 100, Math.round(12 / 20 * 960 * 100) / 100, 'clip 终点 px');
  assert.ok(c.bars.length > 10, '振幅条已采样');
  // 每根条：srcSec=srcStart+rel → envAt 同口径；条在 clip 范围内
  for (const b of c.bars) {
    assert.ok(b.x >= Math.floor(c.x0) && b.x < c.x1, '条 x 在 clip 域内');
    const rel = (b.x + 1.5 - c.x0) / (960 / 20);
    assert.ok(rel >= 0 && rel <= 10, 'rel 在 clip 时长内');
    const v = envAt(FAKE_ENV, 1 + rel) * Math.min(1.6, 1) * 1; // srcStart=1s、gain=1、无淡化
    assert.ok(Math.abs(b.v - v) < 1e-9, '条幅值=envAt(env, srcStart+rel)×增益基线');
  }
  // env 缺失 → 0.14 平线兜底
  const fallback = musicBandData(p, L, 20, () => null)[0].bars;
  assert.ok(fallback.every(b => Math.abs(b.v - 0.14) < 1e-9), '包络缺失回退 0.14');
  // 静音 clip 照画（dim），越域 clip 裁剪
  p.timeline.audioClips[0].muted = true;
  assert.equal(musicBandData(p, L, 20, () => FAKE_ENV)[0].muted, true);
});

test('tagBandData：呈示规则与编舞模式一致=最深层；色板/取色同源 MusicTimeline', () => {
  const p = demoProject();
  const L = stripLayout(PRESETS[1]);
  addTag(p, 8, '主歌');              // level 0
  const deep = addTag(p, 24, '副歌'); // level 2 → 最深层
  p.timeline.tags[0].level = 0;
  deep.level = 2;
  const bands = tagBandData(p, L, 20);
  assert.equal(bands.length, 1, '只呈示最深层（level 2）');
  assert.equal(bands[0].name, '副歌');
  const px = beatToSec(p, 24) / 20 * 960;
  assert.equal(Math.round(bands[0].x0 * 100) / 100, Math.round(px * 100) / 100, '区域起点 px（beat→sec→px）');
  // 全部 level 0 → 都呈示
  deep.level = 0;
  assert.equal(tagBandData(p, L, 20).length, 2, '同层全部呈示');
  // 无 tag → 空
  assert.deepEqual(tagBandData(demoProject(), L, 20), []);
});

// ---------- 混音排布与引擎一致性 ----------
test('mixPlan：静音 clip/静音轨跳过、越域钳制、轨增益乘入、左缘出域源同步前进', () => {
  const p = demoProject();
  const plan = mixPlan(p, { domainSec: musicDomainSec(p), rate: 48000 });
  assert.equal(plan.length, 1);
  const e = plan[0];
  assert.equal(e.startSample, 2 * 48000, 'clip 起点 2s');
  assert.equal(e.endSample, 12 * 48000, 'clip 终点 12s');
  assert.equal(e.trackGain, 1, '默认轨增益');
  assert.equal(e.srcStartSec, 1, '源入点=srcStart');
  // 越域钳制：clip 超过域尾 → endSample 钳 domainSec；域前 clip 跳过
  p.timeline.audioClips[0].lengthSec = 30;
  const plan2 = mixPlan(p, { domainSec: 20, rate: 48000 });
  assert.equal(plan2[0].endSample, 20 * 48000, '终点钳域尾');
  // 静音 clip / 静音轨跳过
  p.timeline.audioClips[0].muted = true;
  assert.equal(mixPlan(p, { domainSec: 20, rate: 48000 }).length, 0, '静音 clip 跳过');
  p.timeline.audioClips[0].muted = false;
  p.timeline.tracks[0].muted = true;
  assert.equal(mixPlan(p, { domainSec: 20, rate: 48000 }).length, 0, '静音轨跳过');
  p.timeline.tracks[0].muted = false;
  // 轨增益 0.8 乘入 + 左缘出域（timelineStart=-2 → 源前进）
  p.timeline.tracks[0].gain = 0.8;
  p.timeline.audioClips[0].timelineStartSec = -2;
  p.timeline.audioClips[0].srcStartSec = 4;
  const plan3 = mixPlan(p, { domainSec: 20, rate: 48000 });
  assert.equal(plan3[0].trackGain, 0.8);
  assert.equal(plan3[0].startSample, 0, '域前部分钳 0');
  assert.equal(plan3[0].srcStartSec, 6, '源入点随左缘出域前进（内容锚定）');
});

test('mixClipInto：逐样本增益与引擎 clipGainAt 一致（含淡化段）、线性插值重采样、单声道源展开', () => {
  const p = demoProject();
  p.timeline.audioClips[0] = { id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 20, fadeInSec: 2, fadeOutSec: 2, gain: 1, name: 't' };
  p.timeline.tracks[0].gain = 0.8;
  const rate = 48000;
  const plan = mixPlan(p, { domainSec: 20, rate });
  const out = { L: new Float32Array(rate * 21), R: new Float32Array(rate * 21) };
  const buf = { sampleRate: rate, numberOfChannels: 2, getChannelData: ch => { const a = new Float32Array(rate * 21).fill(ch === 0 ? 0.5 : 0.25); return a; } };
  mixClipInto(out, plan[0], buf, { rate });
  const clip = p.timeline.audioClips[0];
  for (const sec of [0, 0.5, 1, 1.999, 3, 10, 18.001, 19.5, 20 - 1 / rate]) {
    const n = Math.round(sec * rate);
    const expectL = 0.8 * clipGainAt(clip, n / rate) * 0.5;
    const expectR = 0.8 * clipGainAt(clip, n / rate) * 0.25;
    // 累加目标为 Float32Array：允许 float32 存储精度（1e-6 远小于可听差异）
    assert.ok(Math.abs(out.L[n] - expectL) < 1e-6, `L@${sec}s 与 clipGainAt×trackGain 一致`);
    assert.ok(Math.abs(out.R[n] - expectR) < 1e-6, `R@${sec}s 立体声展开一致`);
  }
  // 域外（clip 之外）零
  assert.equal(out.L[rate * 20], 0, 'clip 尾后不加值');
  // 线性插值：48k→24k 半速率源（源 pos=0.5 → i0=0 frac=0.5）
  const src2 = { sampleRate: 24000, numberOfChannels: 1, getChannelData: () => { const a = new Float32Array(24000 * 21); a[0] = 1; a[1] = 0; return a; } };
  const out2 = { L: new Float32Array(rate), R: new Float32Array(rate) };
  const e2 = { clip: { ...clip, fadeInSec: 0, fadeOutSec: 0, gain: 1, muted: false }, trackGain: 1, startSample: 0, endSample: rate, srcStartSec: 0 };
  mixClipInto(out2, e2, src2, { rate });
  assert.ok(Math.abs(out2.L[0] - 1) < 1e-9, 'pos=0 恰取 src[0]');
  assert.ok(Math.abs(out2.L[1] - 0.5) < 1e-9, 'pos=0.5 → 线性插值 (1+0)/2×gain');
});

// ---------- 文件名 ----------
test('videoFileName：项目名-YYYYMMDD.mp4，安全化与 safeName 同口径', () => {
  const p = demoProject();
  assert.equal(videoFileName(p, new Date('2026-10-02T10:00:00')), '导出演示-20261002.mp4');
  p.meta.title = 'A/B:C*舞?阵';
  assert.equal(videoFileName(p, new Date('2026-01-05T00:00:00')), 'A_B_C_舞_阵-20260105.mp4', '非法文件名字符替换为下划线');
  const d = new Date('2026-03-08T23:59:59');
  assert.ok(/-20260308\.mp4$/.test(videoFileName(p, d)), '月/日两位补零');
});

// ---------- 能力门与探测（build-91-varispeed：三态异步探测 + 语义收窄） ----------
// globalThis 注入/还原工具：定义表全量暂存，await fn 完成后再还原（原本不存在则删除），
// 不留测试泄漏；异步 fn 不还原早退（probe 多轮 await 期间 stub 必须持续在场）。
async function withStubs(defs, fn) {
  const saved = new Map();
  const existed = new Set();
  for (const [k, v] of Object.entries(defs)) {
    existed.add(Object.prototype.hasOwnProperty.call(globalThis, k));
    saved.set(k, globalThis[k]);
    globalThis[k] = v;
  }
  try { return await fn(); }
  finally {
    for (const [k, v] of saved) {
      if (existed.has(k)) globalThis[k] = v;
      else delete globalThis[k];
    }
  }
}
// dummy WebCodecs：VideoEncoder/VideoFrame 只需「存在」（探测门）；AudioEncoder 走静态
// isConfigSupported 表（codec → supported）模拟原生编码器支持面
function stubAudioEncoder(table) {
  const Stub = function StubAudioEncoder() {};
  Stub.isConfigSupported = async cfg => ({ supported: !!table[cfg.codec] });
  return Stub;
}

test('probeExportCapabilities：node 裸环境 → ok:false（reason 面向用户、audioCodec null）', async () => {
  const caps = await probeExportCapabilities();
  assert.equal(caps.ok, false);
  assert.match(caps.reason, /不支持视频导出/, 'reason 为面向用户的一句话');
  assert.equal(caps.audioCodec, null);
  await assert.rejects(() => exportVideo({ project: demoProject() }), /不支持视频导出/, 'exportVideo 经探测门显式拒绝（无实时录制兜底）');
});

test('probeExportCapabilities：原生 AAC 在 → ok + aac（Safari/Chrome 形态）', async () => {
  await withStubs({
    VideoEncoder: function Stub() {}, VideoFrame: function Stub() {},
    AudioEncoder: stubAudioEncoder({ 'mp4a.40.2': true, opus: false }),
  }, async () => {
    const caps = await probeExportCapabilities();
    assert.deepEqual({ ok: caps.ok, audioCodec: caps.audioCodec }, { ok: true, audioCodec: 'aac' });
  });
});

test('probeExportCapabilities：AAC 缺、Opus 在 → ok + opus；opus 提示文案保留在源', async () => {
  await withStubs({
    VideoEncoder: function Stub() {}, VideoFrame: function Stub() {},
    AudioEncoder: stubAudioEncoder({ 'mp4a.40.2': false, opus: true }),
  }, async () => {
    const caps = await probeExportCapabilities();
    assert.deepEqual({ ok: caps.ok, audioCodec: caps.audioCodec }, { ok: true, audioCodec: 'opus' });
  });
  assert.ok(read('js/video-export.js').includes('当前浏览器音频编码回退为 Opus（Chrome 产物 iOS 相册可能不认）'), 'iOS 相册提示保留');
});

test('probeExportCapabilities：原生 AAC/Opus 皆缺 → wasm-aac 软编兜底（iOS16/Firefox/无 AAC Chromium 通吃）', async () => {
  await withStubs({
    VideoEncoder: function Stub() {}, VideoFrame: function Stub() {},
    AudioEncoder: stubAudioEncoder({ 'mp4a.40.2': false, opus: false }),
  }, async () => {
    const caps = await probeExportCapabilities();
    assert.deepEqual({ ok: caps.ok, audioCodec: caps.audioCodec }, { ok: true, audioCodec: 'wasm-aac' });
  });
  // 注入/还原无泄漏
  assert.equal(typeof globalThis.VideoEncoder, 'undefined', 'VideoEncoder 已还原');
  assert.equal(typeof globalThis.VideoFrame, 'undefined', 'VideoFrame 已还原');
  assert.equal(typeof globalThis.AudioEncoder, 'undefined', 'AudioEncoder 已还原');
});

test('probeExportCapabilities：VideoEncoder 在、VideoFrame 缺 → ok:false（视频门双件套必备）', async () => {
  await withStubs({ VideoEncoder: function Stub() {} }, async () => {
    const caps = await probeExportCapabilities();
    assert.equal(caps.ok, false);
    assert.ok(typeof caps.reason === 'string' && caps.reason.length > 4, 'reason 面向用户');
    assert.equal(caps.audioCodec, null);
  });
});

test('videoExportSupported：语义收窄——VideoEncoder+VideoFrame 即可，AudioEncoder 缺席不再否决', async () => {
  assert.equal(videoExportSupported(), false, 'node 裸环境 false');
  await withStubs({ window: { VideoEncoder: function Stub() {}, VideoFrame: function Stub() {} } }, async () => {
    assert.equal(videoExportSupported(), true, '音频可 wasm 兜底（软编在场），不再三件套齐才放行');
  });
  assert.equal(typeof globalThis.window, 'undefined', 'window 已还原（无泄漏）');
});

// ---------- 残留清零（旧方案退役验收） ----------
test('残留清零：js/ 全树无旧方案符号（vendored 上游文件放行，放行清单在案）；旧模块文件已删', () => {
  // 放行清单：vendored 上游原样文件（mediabunny 库本体、wasm 软编 AAC 扩展）——
  // 上游文本不在本仓库掌控内，出现任何字样均不算本仓库残留。
  const ALLOWLIST = new Set(['mediabunny.js', 'aac-encoder.js']);
  const banned = /MediaRecorder|mp4-muxer|video-recorder|aacAscConfig|videoCodecLadder/;
  const files = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js') && !ALLOWLIST.has(f));
  assert.ok(files.includes('video-export.js'), '扫描面覆盖 video-export.js');
  const hits = [];
  for (const f of files) {
    if (banned.test(readFileSync(join(root, 'js', f), 'utf8'))) hits.push(f);
  }
  assert.deepEqual(hits, [], `残留文件：${hits.join(', ')}`);
  // 旧模块与旧测试文件物理删除
  for (const gone of ['js/mp4-muxer.js', 'js/video-recorder.js', 'tests/video-recorder.test.js']) {
    assert.equal(existsSync(join(root, gone)), false, `${gone} 已删除`);
  }
});

// ---------- vendor 在场与 provenance ----------
test('vendor provenance：mediabunny/aac-encoder 头注（版本/license/勿手改）、wasm 内联、可加载、注册幂等', async () => {
  const mbSrc = read('js/mediabunny.js');
  assert.match(mbSrc, /^\/\/ vendor: mediabunny v\d+\.\d+\.\d+/, '版本串在头注首位');
  assert.ok(mbSrc.includes('github.com/Vanilagy/mediabunny') && mbSrc.includes('MPL-2.0') && mbSrc.includes('勿手改'), '来源/license/勿手改三件齐');
  assert.ok(!/^import\s/m.test(mbSrc), 'mediabunny 单文件零外部 import（静态可打包）');
  const aacSrc = read('js/aac-encoder.js');
  assert.match(aacSrc, /^\/\/ vendor: @mediabunny\/aac-encoder v\d+\.\d+\.\d+/, 'aac 扩展版本串在头注首位');
  assert.ok(aacSrc.includes('MPL-2.0') && aacSrc.includes('勿手改') && aacSrc.includes('build-80 patch'), 'license/勿手改/加载点 patch 注释齐');
  assert.ok(statSync(join(root, 'js', 'aac-encoder.js')).size > 500000, 'wasm 内联在场（体积证据，源码本体仅 ~7KB）');
  // 加载冒烟：全 API 面在场 + registerAacEncoder 真注册且幂等
  const mb = await import('../js/mediabunny.js');
  const aac = await import('../js/aac-encoder.js');
  for (const k of ['Output', 'Mp4OutputFormat', 'BufferTarget', 'CanvasSource', 'AudioBufferSource', 'registerEncoder', 'canEncodeVideo', 'canEncodeAudio']) {
    assert.equal(typeof mb[k], 'function', `mediabunny.${k} 在场`);
  }
  assert.equal(typeof aac.registerAacEncoder, 'function', 'aac.registerAacEncoder 在场');
  aac.registerAacEncoder();
  aac.registerAacEncoder(); // 二次调用走 registered 旗标早退（幂等，无重复注册警告路径）
});

// ---------- 构建 ORDER（build-single.mjs 静态断言） ----------
test('构建 ORDER：mediabunny/aac-encoder 前置于 video-export；两旧模块清出；nsKey 含连字符映射', () => {
  const buildSrc = read('scripts/build-single.mjs');
  const orderAt = buildSrc.indexOf('const ORDER = [');
  const orderLine = buildSrc.slice(orderAt, buildSrc.indexOf('];', orderAt));
  const at = m => orderLine.indexOf(`'${m}'`);
  assert.ok(at('mediabunny') > 0, 'mediabunny 在 ORDER');
  assert.ok(at('aac-encoder') > at('mediabunny'), 'aac-encoder 依赖 mediabunny，紧随其后');
  assert.ok(at('video-export') > at('aac-encoder'), 'video-export 消费两 vendor，置于其后');
  assert.equal(at('mp4-muxer'), -1, '旧封装模块已清出 ORDER');
  assert.equal(at('video-recorder'), -1, '旧录制模块已清出 ORDER');
  assert.ok(at('video-export') < at('main'), 'video-export 在 main 前');
  assert.ok(at('video-export') > at('export') && at('video-export') > at('timeline') && at('video-export') > at('stage'), '依赖前置于 ORDER');
  // nsKey 连字符映射（build-79 白屏防线：漏配即构建失败）
  assert.ok(buildSrc.includes("mod === 'aac-encoder' ? 'aacEncoder'"), 'aac-encoder → aacEncoder 映射在场');
  assert.ok(buildSrc.includes("mod === 'video-export' ? 'videoExport'"), 'video-export → videoExport 映射在场');
});

// ---------- exportVideo 静态断言（Mediabunny 管线 / 契约面） ----------
test('exportVideo 静态断言：管线形态/背压纪律/三相位/软编懒注册/结果契约/错误文案', () => {
  const vxSrc = read('js/video-export.js');
  // 导入面：打包器聚合的两形态
  assert.ok(vxSrc.includes("import * as mb from './mediabunny.js'"), 'mediabunny 命名空间导入（bundle 内转 const mb = FS.mediabunny）');
  assert.ok(vxSrc.includes("import { registerAacEncoder } from './aac-encoder.js'"), 'aac 扩展具名导入');
  // 输出管线：MP4 + 内存快起 + BufferTarget
  assert.ok(vxSrc.includes('new mb.Output({'), 'Output 编排');
  assert.ok(vxSrc.includes("new mb.Mp4OutputFormat({ fastStart: 'in-memory' })"), 'MP4 fastStart=in-memory（moov 前置）');
  assert.ok(vxSrc.includes('new mb.BufferTarget()'), 'BufferTarget 内存产物');
  // 视频源：avc + 码率 + 2s 关键帧间隔；帧率经 track 元数据透出
  assert.ok(vxSrc.includes('new mb.CanvasSource(canvas') && vxSrc.includes("codec: 'avc'") && vxSrc.includes('keyFrameInterval: 2'), 'CanvasSource avc + 2s 关键帧');
  assert.ok(vxSrc.includes('output.addVideoTrack(videoSource, { frameRate: P.fps })'), '帧率元数据');
  // 音频源与软编兜底
  assert.ok(vxSrc.includes('new mb.AudioBufferSource({'), 'AudioBufferSource');
  assert.ok(vxSrc.includes("caps.audioCodec === 'wasm-aac'") && vxSrc.includes('registerAacEncoder()'), '软编兜底在 exportVideo 内注册');
  // 背压纪律：逐帧/逐块 await add（mediabunny 以 add Promise 传播编码器/写入器背压）
  assert.ok(vxSrc.includes('await videoSource.add(sec, frameSec)'), '逐帧 await add（禁无界堆积）');
  assert.ok(vxSrc.includes('await audioSource.add(chunk)'), '音频分块 await add');
  // 三相位进度契约（ratio 恒为全局 0..1）
  assert.ok(vxSrc.includes("phase: 'render'") && vxSrc.includes("phase: 'audio'") && vxSrc.includes("phase: 'mux'"), '三相位 render/audio/mux');
  // 取消与异常清理：Output.cancel 兜底
  assert.ok(vxSrc.includes('await output.cancel()'), '取消/异常时 cancel 管线');
  // 插值复用（不复制数学）
  assert.ok(vxSrc.includes('posAt('), '逐帧位置复用 model.posAt（播放路径同源）');
  assert.ok(!/\beaseInOut\b/.test(vxSrc) && !/\blerpAngle\b/.test(vxSrc), '不含自写插值数学');
  // 结果契约
  assert.ok(vxSrc.includes("mime: 'video/mp4'") && vxSrc.includes("ext: 'mp4'"), 'mime/ext 字段');
  assert.ok(vxSrc.includes("videoCodec: 'avc'"), 'videoCodec=mediabunny 实际命中编码');
  assert.ok(vxSrc.includes('audioSilent'), 'audioSilent 布尔（全静音路径）');
  // 错误/提示文案（与入口弹窗契约耦合）
  assert.ok(vxSrc.includes('音频素材未能解码，无法导出带声音的视频——请重新导入音乐后重试'), '全缺失显式失败文案');
  assert.ok(vxSrc.includes('个音频片段解码失败已静音'), '部分缺失续导注明文案');
  // probe 无副作用：probeExportCapabilities 函数体内不注册软编（wasm 懒启动纪律）
  const probeAt = vxSrc.indexOf('export async function probeExportCapabilities');
  const probeEnd = vxSrc.indexOf('export function videoFileName');
  assert.ok(probeAt > 0 && probeEnd > probeAt, 'probe 函数定位');
  assert.ok(!vxSrc.slice(probeAt, probeEnd).includes('registerAacEncoder()'), 'probe 只读探测、不触发 wasm 注册');
});
