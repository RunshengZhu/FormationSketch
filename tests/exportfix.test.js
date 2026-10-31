// 视频导出链路修复单测（build-91-varispeed Mediabunny 单路）
// 覆盖：
//   1) probeExportCapabilities stub 三态（dummy AudioEncoder/VideoEncoder 注入 globalThis，
//      async 探测；注入/还原无泄漏）；
//   2) main.js 接线静态断言：单路接线（probe 在 flow、busy 先置位）、三相相位文案、菜单项
//      恒可点、ensureAssetBuffer 接线、wasm-aac 显示映射、note 红色着色、
//      recordVideo/video-recorder/MediaRecorder/实时录制/兼容模式/exportRouteOf 全量清零、
//      build-single ORDER（mediabunny 在，mp4-muxer/video-recorder 移除）；
//   3) video-export.audioPreflight：全就绪/部分缺失/全缺失三态、抛错兜底、同 id 去重、
//      同步 resolveBuffer 兼容、真实 mixPlan 条目接入；
//   4) formationBandData 队形段秒标签（时间唯一标准：秒呈示，去拍值）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { audioPreflight, mixPlan, mixClipInto, formationBandData, stripLayout, PRESETS } from '../js/video-export.js';
import { createProject, createFormationFrom, beatToSec, musicDomainSec } from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// ---------- 1) probeExportCapabilities stub 三态（globalThis 注入/还原无泄漏） ----------
const stubEncoder = () => class FakeEncoder { static isConfigSupported = async cfg => ({ supported: true, config: cfg }); };

test('R5 probeExportCapabilities：缺 WebCodecs（Node 裸环境）→ ok=false + 面向用户 reason', async () => {
  const { probeExportCapabilities } = await import('../js/video-export.js');
  assert.equal(typeof probeExportCapabilities, 'function', 'probe 导出面在场（async）');
  const caps = await probeExportCapabilities();
  assert.equal(caps.ok, false, '裸环境无编码器 → 拒绝');
  assert.equal(typeof caps.reason, 'string', 'ok=false 必带 reason');
  assert.ok(caps.reason.length >= 4, 'reason 是面向用户的一句话（非空短串）');
  assert.equal(caps.audioCodec ?? null, null, '拒绝态无音频编解码承诺');
});

test('R5 probeExportCapabilities：仅 VideoEncoder（缺 VideoFrame）→ 视频门拒绝', async t => {
  const { probeExportCapabilities } = await import('../js/video-export.js');
  globalThis.VideoEncoder = stubEncoder();
  try {
    const caps = await probeExportCapabilities();
    assert.equal(caps.ok, false, '缺 VideoFrame → 视频门拒绝');
    assert.ok(typeof caps.reason === 'string' && caps.reason.length >= 4, '拒绝态带用户可读 reason');
  } finally {
    delete globalThis.VideoEncoder; // 还原无泄漏
  }
  assert.equal(globalThis.VideoEncoder, undefined, 'VideoEncoder 桩已还原');
});

test('R5 probeExportCapabilities：视频门齐备+无原生音频编码 → T2 wasm-aac', async t => {
  const { probeExportCapabilities } = await import('../js/video-export.js');
  globalThis.VideoEncoder = stubEncoder();
  globalThis.VideoFrame = class FakeFrame {};
  try {
    const caps = await probeExportCapabilities();
    assert.equal(caps.ok, true, 'T2：视频门齐备 + aac-encoder vendor 在场 → 可导出');
    assert.equal(caps.audioCodec, 'wasm-aac', '无原生 AudioEncoder → wasm-aac 兜底（iOS16/Firefox/无AAC Chromium）');
  } finally {
    delete globalThis.VideoEncoder;
    delete globalThis.VideoFrame;
  }
});

test('R5 probeExportCapabilities：AudioEncoder+VideoEncoder 齐备 → ok=true + audioCodec 承诺', async t => {
  const { probeExportCapabilities } = await import('../js/video-export.js');
  globalThis.VideoEncoder = stubEncoder();
  globalThis.VideoFrame = class FakeFrame {};
  globalThis.AudioEncoder = stubEncoder();
  try {
    const caps = await probeExportCapabilities();
    assert.equal(caps.ok, true, '双编码器齐备 → 可导出');
    assert.ok(['aac', 'opus', 'wasm-aac'].includes(caps.audioCodec), `audioCodec ∈ 冻结契约三值（得 ${caps.audioCodec}）`);
    assert.equal(caps.reason, undefined, 'ok=true 无 reason');
  } finally {
    delete globalThis.VideoEncoder;
    delete globalThis.VideoFrame;
    delete globalThis.AudioEncoder; // 还原无泄漏
  }
  assert.equal(globalThis.VideoEncoder, undefined, 'VideoEncoder 桩已还原');
  assert.equal(globalThis.AudioEncoder, undefined, 'AudioEncoder 桩已还原');
});

// ---------- 2) main.js 接线静态断言（build-91-varispeed 单路） ----------
test('R5 main.js 清零断言：无 recordVideo/video-recorder/MediaRecorder/实时录制/兼容模式/exportRouteOf', () => {
  const mainSrc = read('js/main.js');
  for (const banned of ['recordVideo', 'video-recorder', 'MediaRecorder', '实时录制', '兼容模式', 'exportRouteOf', 'exportCapabilities']) {
    assert.ok(!mainSrc.includes(banned), `main.js 无残留「${banned}」`);
  }
  const order = read('scripts/build-single.mjs');
  assert.ok(order.includes("'mediabunny'"), 'build-single ORDER 已含 mediabunny（dist 打包面）');
  assert.ok(!order.includes("'mp4-muxer'"), 'build-single ORDER 已移除 mp4-muxer');
  assert.ok(!order.includes("'video-recorder'"), 'build-single ORDER 已移除 video-recorder');
});

test('R5 main.js flow 接线：probe 先行（busy 先置位）、caps.ok 门、单路 exportVideo、三相相位文案', () => {
  const mainSrc = read('js/main.js');
  const flowAt = mainSrc.indexOf('async function startVideoExportFlow');
  const flowEnd = mainSrc.indexOf('// ---------- build-72-checkupdate');
  assert.ok(flowAt > 0 && flowEnd > flowAt, 'startVideoExportFlow 区段在场');
  const flow = mainSrc.slice(flowAt, flowEnd);
  const probeAt = flow.indexOf('await vx.probeExportCapabilities()');
  const busyAt = flow.indexOf('videoExportBusy = true');
  assert.ok(probeAt > 0, 'flow 内接线 probeExportCapabilities（async）');
  assert.ok(busyAt > 0 && busyAt < probeAt, 'busy 先置位再 await probe（probe 期间双击被门挡下）');
  assert.ok(flow.includes('if (!caps.ok)'), 'caps.ok 不过 → toast(reason) 即返（不开进度弹窗）');
  assert.ok(flow.includes('caps.reason'), '拒绝态透出 reason');
  assert.ok(flow.includes('await vx.exportVideo('), '唯一导出路径=vx.exportVideo（无兜底路分支）');
  assert.ok(!flow.includes('recordVideo') && !flow.includes('confirm('), '无慢路征询 confirm（单路无此环节）');
  assert.ok(flow.includes('id => audio.ensureAssetBuffer(id)'), 'resolveBuffer=ensureAssetBuffer（重解码兜底）');
  assert.ok(flow.includes('envOf: id => audio.assets.get(id)?.env || null'), 'envOf 接线同旧');
  assert.ok(flow.includes('isCancelled: () => cancelled'), '取消旗接线');
  assert.ok(flow.includes('finally {'), 'finally 复位 busy（probe 失败路径也不卡门）');
  // 相位文案三相：render/audio/mux；无 record/encode/audio-encode 分支
  const phAt = mainSrc.indexOf('function videoExportPhaseText');
  const phEnd = mainSrc.indexOf('// 设置弹窗：');
  const ph = mainSrc.slice(phAt, phEnd);
  assert.ok(ph.includes("phase === 'render'") && ph.includes('渲染帧'), 'render 相：渲染帧 N/total');
  assert.ok(ph.includes("phase === 'audio'") && ph.includes('音频编码中'), 'audio 相：音频编码中');
  assert.ok(ph.includes('封装 MP4'), 'mux 相：封装 MP4');
  assert.ok(!ph.includes("'record'") && !ph.includes("'encode'") && !ph.includes("'audio-encode'"), '旧四相分支清零');
  // 菜单项：恒可点（不设 disabled），title 静态两态
  const itemAt = mainSrc.indexOf('function syncVideoExportItem');
  const itemEnd = mainSrc.indexOf('function videoExportPhaseText');
  const item = mainSrc.slice(itemAt, itemEnd);
  assert.ok(!item.includes('.disabled'), 'syncVideoExportItem 恒可点（不设 disabled）');
  assert.ok(item.includes('导出编排播放视频（本机渲染 .mp4）'), '有资产态 title（单路口径）');
  assert.ok(item.includes('导出视频需要先载入音乐'), '无资产态 title 提示保留');
  assert.ok(!item.includes('exportRouteOf') && !item.includes('exportCapabilities'), 'sig 门控只有 hasAssets 一维');
  // 完成弹窗：wasm-aac 显示映射 + name 拼 .ext + 帧数
  const doneAt = mainSrc.indexOf('function showVideoExportDone');
  const doneEnd = mainSrc.indexOf('async function startVideoExportFlow');
  const done = mainSrc.slice(doneAt, doneEnd);
  assert.ok(done.includes("result.audioCodec === 'wasm-aac' ? 'AAC'"), 'wasm-aac → AAC 显示映射');
  assert.ok(done.includes("replace(/\\.mp4$/i, '')") && done.includes("result.ext || 'mp4'"), 'name 拼扩展名（恒 mp4）');
  assert.ok(done.includes('if (result.frames)'), 'frames 有则显帧数');
  assert.ok(done.includes('color:#f87171'), 'note 行红色着色（内联 style）');
  assert.ok(done.includes('result.note'), '备注透出保留');
});

test('R5 main.js/audio.js 接线保留面：ensureAssetBuffer 提供、exportVideo 内部自持预检', () => {
  const mainSrc = read('js/main.js');
  assert.ok(mainSrc.includes('id => audio.ensureAssetBuffer(id)'), 'resolveBuffer 换 ensureAssetBuffer（重解码兜底）');
  const vxSrc = read('js/video-export.js');
  const evAt = vxSrc.indexOf('export async function exportVideo');
  assert.ok(evAt > 0, 'exportVideo 导出在场');
  const evBody = vxSrc.slice(evAt);
  assert.ok(evBody.includes('mixPlan(') && evBody.includes('audioPreflight('), '预检（mixPlan+audioPreflight）保留在 exportVideo 内部，flow 不再重复');
  const audioSrc = read('js/audio.js');
  assert.ok(audioSrc.includes('async ensureAssetBuffer(assetId)'), 'audio.js 提供 ensureAssetBuffer');
  assert.ok(audioSrc.includes('OfflineAudioContext'), '重解码走 OfflineAudioContext（不依赖手势/运行态）');
});

// ---------- 3) audioPreflight ----------
const entry = id => ({ clip: { assetId: id } });
const BUF = { sampleRate: 48000, numberOfChannels: 2 };

test('audioPreflight：全就绪 / 部分缺失 / 全缺失 三态', async () => {
  const all = async () => BUF;
  assert.deepEqual(await audioPreflight([entry('a'), entry('b')], all), { resolvedCount: 2, missingIds: [] }, '全就绪');
  const some = async id => (id === 'a' ? BUF : null);
  assert.deepEqual(await audioPreflight([entry('a'), entry('b')], some), { resolvedCount: 1, missingIds: ['b'] }, '部分缺失');
  const none = async () => null;
  assert.deepEqual(await audioPreflight([entry('a'), entry('b')], none), { resolvedCount: 0, missingIds: ['a', 'b'] }, '全缺失');
});
test('audioPreflight：resolveAsync 抛错=缺失（不冒泡）；空计划；同步 resolveBuffer 兼容', async () => {
  const boom = async () => { throw new Error('decode boom'); };
  assert.deepEqual(await audioPreflight([entry('a')], boom), { resolvedCount: 0, missingIds: ['a'] });
  const none = async () => null;
  assert.deepEqual(await audioPreflight([], none), { resolvedCount: 0, missingIds: [] }, '空计划平凡态');
  assert.deepEqual(await audioPreflight([entry('a')], () => BUF), { resolvedCount: 1, missingIds: [] }, '同步返回值兼容');
});
test('audioPreflight：同 id 多 clip 去重（唯一 id 各解析一次，保序）', async () => {
  let calls = [];
  const counting = async id => { calls.push(id); return id === 'a' ? BUF : null; };
  const r = await audioPreflight([entry('a'), entry('a'), entry('b'), entry('a')], counting);
  assert.deepEqual(calls, ['a', 'b'], '唯一 id 各一次');
  assert.deepEqual(r, { resolvedCount: 1, missingIds: ['b'] });
});
test('audioPreflight × mixPlan：真实排布条目（entry.clip.assetId）走通', async () => {
  const p = demoProject();
  const plan = mixPlan(p, { domainSec: musicDomainSec(p), rate: 48000 });
  assert.ok(plan.length >= 1, '排布非空前置');
  assert.deepEqual(await audioPreflight(plan, async () => BUF), { resolvedCount: 1, missingIds: [] });
  assert.deepEqual(await audioPreflight(plan, async () => null), { resolvedCount: 0, missingIds: ['a1'] });
});

// ---------- 4) formationBandData 秒标签 ----------
function demoProject() {
  const p = createProject({ title: '导出演示', pairs: 2 });
  p.media.assets = [{ id: 'a1', name: 'test', durationSec: 20, size: 1 }];
  p.media.activeAssetId = 'a1';
  p.timeline.audioClips = [
    { id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 2, srcStartSec: 1, lengthSec: 10, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'main' },
  ];
  return p;
}
test('formationBandData：队形段 label 秒呈示（beatToSec 差值 toFixed(1)s），不再出「拍」', () => {
  const p = demoProject();
  const L = stripLayout(PRESETS[1]);
  const bands = formationBandData(p, L, 20);
  const hold = bands.find(b => b.kind === 'hold');
  assert.ok(hold);
  assert.equal(hold.label, (beatToSec(p, 16) - beatToSec(p, 0)).toFixed(1) + 's', 'label=段起止秒差');
  assert.ok(/s$/.test(hold.label));
  assert.ok(!hold.label.includes('拍'), '时间唯一标准：去拍值');
  // 多队形：travel 空隙段 label 仍为空串（灰块不标注）
  const p2 = demoProject();
  createFormationFrom(p2, 0); // 第二队形（startBeat=16、lenBeats=16，内部规约同 createProject）
  const bands2 = formationBandData(p2, L, 20);
  const travel = bands2.find(b => b.kind === 'travel');
  assert.ok(travel && travel.label === '', 'travel 段无 label');
  const hold2 = bands2.filter(b => b.kind === 'hold')[1];
  assert.equal(hold2.label, (beatToSec(p2, 32) - beatToSec(p2, 16)).toFixed(1) + 's', '第二段同样秒差');
});

// ---------- build-91-varispeed：仅导出音频 ----------
test('R6 仅导出音频：exportAudio/audioFileName/pickAudioCodec 导出面 + 菜单接线静态断言', async () => {
  const ve = await import('../js/video-export.js');
  assert.equal(typeof ve.exportAudio, 'function', 'exportAudio 导出');
  assert.equal(typeof ve.pickAudioCodec, 'function', 'pickAudioCodec 导出（音频选路抽离）');
  assert.equal(typeof ve.audioFileName, 'function', 'audioFileName 导出');
  const proj = createProject({ title: '音频命名' });
  assert.match(ve.audioFileName(proj), /-audio\.m4a$/, '文件名 -audio.m4a 后缀（防与视频同名）');
  const mainSrc2 = read('js/main.js');
  // build-89 回归钉：有限同步 N 必须传调用结果（曾漏 `()` → 恒 Infinity 同步全部）
  assert.ok(mainSrc2.includes('count: countNow()'), '有限同步传 countNow() 调用结果');
  assert.ok(!mainSrc2.includes('count: countNow }') && !mainSrc2.includes('count: countNow,'), '无未调用残留');
  assert.ok(mainSrc2.includes('startAudioExportFlow'), 'flow 在场');
  assert.ok(mainSrc2.includes('showAudioFormatPicker'), '格式选择弹窗接线（build-86 双格式）');
  assert.ok(mainSrc2.includes('format,'), 'format 参透传 exportAudio');
  assert.ok(!/recordVideo|video-recorder|MediaRecorder/.test(mainSrc2), '旧方案零残留（维持）');
  const html = read('index.html');
  assert.ok(html.includes('id="exp-audio"'), '菜单项进包');
  assert.ok(html.includes('>仅导出音频<'), '菜单文案不再硬编码 M4A（build-86 双格式）');
  const veSrc = read('js/video-export.js');
  assert.ok(veSrc.includes("registerMp3Encoder"), 'MP3 软编注册接线');
  assert.ok(veSrc.includes('Mp3OutputFormat'), 'Mp3OutputFormat 分支');
  assert.ok(veSrc.includes("format = 'm4a'"), 'exportAudio format 参数（m4a 默认）');
  const enc = read('js/mp3-encoder.js');
  assert.ok(enc.includes('vendor: @mediabunny/mp3-encoder'), 'mp3-encoder provenance 头');
  assert.ok(!/from "mediabunny"/.test(enc), 'vendor bare specifier 已 patch');
  const bs = read('scripts/build-single.mjs');
  assert.ok(bs.includes("'mp3-encoder'") && bs.includes("'mp3Encoder'"), 'ORDER+nsKey 含 mp3-encoder');
  const order = html.indexOf('id="exp-video"') < html.indexOf('id="exp-audio"') && html.indexOf('id="exp-audio"') < html.indexOf('id="exp-print"');
  assert.ok(order, 'exp-audio 位于视频与打印之间');
  const iom = read('tests/iomenu.test.js');
  assert.ok(iom.includes("'exp-audio', 'exp-png'"), 'iomenu 禁用清单锚含 exp-audio');
  const order2 = read('scripts/build-single.mjs');
  assert.ok(order2.includes("'video-recorder'") === false, '打包 ORDER 无旧模块残留（维持）');
});

// ---------- build-87：混音总长自动适配（实测裁尾） ----------
test('R7 tailFitSamples：尾部静音裁剪 + 0.2s 余量 + 全静音 0 + 边界', async () => {
  const { tailFitSamples } = await import('../js/video-export.js');
  const mk = (arr, n) => { const b = new Float32Array(n); b.set(arr); return b; };
  // 内容恰在末尾 → 全长
  const L1 = mk([0, 0, 0.5, 0.3], 4), R1 = mk([0, 0, 0, 0], 4);
  assert.equal(tailFitSamples(L1, R1, 100, { padSec: 0 }), 4, '末尾有声=全长（pad 0）');
  // 尾部静音 → 截到最后有声 + pad（钳内容长）
  const L2 = mk([0.5, 0, 0, 0], 4);
  assert.equal(tailFitSamples(L2, mk([0, 0, 0, 0], 4), 100, { padSec: 0 }), 1, '裁到 1（无 pad）');
  assert.equal(tailFitSamples(L2, mk([0, 0, 0, 0], 4), 100, { padSec: 0.2 }), 4, 'pad 0.2s=20 样本@100Hz → 钳到全长 4');
  // eps 边界：≤eps 视为静音
  const L3 = mk([0.5, 0.00005, 0, 0], 4);
  assert.equal(tailFitSamples(L3, mk([0, 0, 0, 0], 4), 100, { padSec: 0 }), 1, '1e-4 以下=静音');
  // 右声道有声也算
  assert.equal(tailFitSamples(mk([0, 0, 0, 0], 4), mk([0, 0, 0.5, 0], 4), 100, { padSec: 0 }), 3);
  // 全静音 → 0（调用方报错）；rate 非法回退后单样本有声 → 1（钳全长）
  assert.equal(tailFitSamples(mk([0.5], 1), mk([0], 1), 0, { padSec: 0 }), 1);
  // 非法 rate 回退 48000（不炸）
  assert.equal(tailFitSamples(mk([0.5], 1), mk([0], 1), 0, { padSec: 0 }), 1);
});

// ---------- build-91-varispeed：⌘K 单发剪切 / 剃刀钮单发执行 / resolveBuffer 构造接线 ----------
// 契约冻结：MusicTimeline 实例新增 cutSelectedClipAtPlayhead()→{ok,reason}（并行 agent J
// 交付 timeline.js），构造 opts 新增可选 resolveBuffer（assetId→AudioBuffer）。本组只断
// main.js/index.html 接线面，不锁 timeline.js 内部（J 占用中，全量由调度方收口后统一跑）。
test('build-88 需求 2 ⌘K 接线：Ctrl/Cmd+K=以播放线剪切选中 clip（仅音乐模式响应，编舞侧不处理不 toast）', () => {
  const mainSrc = read('js/main.js');
  assert.ok(mainSrc.includes("(e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')"), 'K 键判定形态：meta/ctrl + k/K 双大小写');
  const kbAt = mainSrc.indexOf('function wireKeyboard');
  const kbEnd = mainSrc.indexOf('// ---------- 移动端队形索引条');
  assert.ok(kbAt > 0 && kbEnd > kbAt, 'wireKeyboard 区段在场');
  const kb = mainSrc.slice(kbAt, kbEnd);
  const kAt = kb.indexOf("(e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')");
  assert.ok(kAt >= 0, 'K 分支在 wireKeyboard 内');
  const kBody = kb.slice(kAt, kAt + 400);
  assert.ok(kBody.includes('e.preventDefault()'), 'K 分支先 preventDefault（压浏览器缺省 K 语义）');
  assert.ok(kBody.includes("if (musicTl?.mode === 'music') cutSelectedClipAtPlayheadUI();"), '仅音乐模式调 cutSelectedClipAtPlayheadUI（单发剪切唯一执行面）');
  assert.ok(!kBody.includes('splitAtPlayhead'), 'K 分支不再直调旧 splitAtPlayhead');
  assert.ok(!mainSrc.includes('function splitFormationAtPlayhead'), 'stage 模式 ⌘K 分割队形函数随需求退役（编舞侧保留右键「分割于此」）');
});

test('build-88 需求 2 剃刀单发语义：按钮即点即剪，无 toggle/aria-pressed/toggled-on 态，razorOn 指针模式 UI 入口清零', () => {
  const mainSrc = read('js/main.js');
  assert.ok(mainSrc.includes("$('tl-razor-toggle-music').addEventListener('click', () => cutSelectedClipAtPlayheadUI());"), '剃刀钮 click=立即单发剪切（不再切 razorOn 态）');
  assert.ok(!mainSrc.includes('setRazor'), 'main.js 无 setRazor 调用残留（指针模式休眠于 timeline.js）');
  const syncFn = mainSrc.match(/function syncMusicToggles\(\) \{[\s\S]*?\n\}/);
  assert.ok(syncFn, 'syncMusicToggles 在场');
  assert.ok(!syncFn[0].includes('razor'), 'syncMusicToggles 只管磁吸（razor toggled-on class 挂钩已拆）');
  assert.ok(!mainSrc.includes('razor: musicTl?.razor'), 'snapshot 不再出 razor 读数');
  // 三入口（剃刀钮 / ⌘K / R）收敛到同一执行面，toast 口径统一
  const calls = (mainSrc.match(/cutSelectedClipAtPlayheadUI\(\)/g) || []).length;
  assert.ok(calls >= 3, `剃刀动作三入口共用 cutSelectedClipAtPlayheadUI，实得 ${calls} 处调用`);
  assert.ok(mainSrc.includes("r.ok ? '已在播放线处剪切' : r.reason"), 'toast 口径：ok=已在播放线处剪切 / 否则透出契约 reason');
  const html = read('index.html');
  const btn = html.match(/<button id="tl-razor-toggle-music"[^>]*>/);
  assert.ok(btn, '剃刀钮在包');
  assert.ok(btn[0].includes('title="以播放线剪切选中的 clip（⌘K / Ctrl+K）"'), '剃刀钮 title=单发口径');
  assert.ok(!btn[0].includes('aria-pressed'), '剃刀钮无 aria-pressed（非 toggle 钮）');
  assert.ok(!html.includes('剃刀模式'), 'index.html 无「剃刀模式」toggle 口径残留');
});

test('build-88 需求 1 resolveBuffer 构造接线：new MusicTimeline 挂 audio.resolveAssetBuffer（高精度波形契约）', () => {
  const mainSrc = read('js/main.js');
  const mtAt = mainSrc.indexOf('musicTl = new MusicTimeline({');
  const mtEnd = mainSrc.indexOf('hooks: {', mtAt);
  assert.ok(mtAt > 0 && mtEnd > mtAt, 'MusicTimeline 构造区段在场');
  const mt = mainSrc.slice(mtAt, mtEnd);
  assert.ok(mt.includes('resolveBuffer: id => audio.ensureAssetBuffer(id),'), '构造 opts 挂 resolveBuffer（build-88 收口：ensureAssetBuffer 异步重解码兜底）');
  const audioSrc = read('js/audio.js');
  assert.ok(audioSrc.includes('resolveAssetBuffer(assetId)'), 'audio.js 提供 resolveAssetBuffer（接线目标在场）');
});

// ---------- 滑动变速（varispeed · mixClipInto 源读取位 ×clip.rate） ----------
test('mixClipInto per-clip rate：1s slot + rate2 + 2s 源 → 源索引 ×2 映射、输出后半读到源后半内容', () => {
  const p = createProject({ title: 'varispeed', pairs: 1 });
  p.media.assets = [{ id: 'a1', name: 't', durationSec: 2, size: 1 }];
  p.media.activeAssetId = 'a1';
  p.timeline.audioClips = [
    // 1s 时间轴 slot（lengthSec 不动）+ rate 2：slot 内消费 2s 源内容
    { id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 1,
      rate: 2, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'v' },
  ];
  const rate = 1000; // 混音率=源率 → frac=0 精确命中样本，手工断言零浮点噪声
  const plan = mixPlan(p, { domainSec: 1, rate });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].startSample, 0);
  assert.equal(plan[0].endSample, 1000, 'slot 域排布不变（1s timeline slot = 1000 样本）');
  // 源：前 1s（样本 0..999）=0.2、后 1s（样本 1000..1999）=0.6
  const data = new Float32Array(2000);
  for (let i = 0; i < 1000; i++) data[i] = 0.2;
  for (let i = 1000; i < 2000; i++) data[i] = 0.6;
  const buf = { sampleRate: rate, numberOfChannels: 1, duration: 2, getChannelData: () => data };
  const out = { L: new Float32Array(1000), R: new Float32Array(1000) };
  mixClipInto(out, plan[0], buf, { rate });
  // ×2 索引映射：pos = (srcStart + rel×2)×srcRate → out[n] == src[2n]
  assert.ok(Math.abs(out.L[250] - 0.2) < 1e-6, `前半读源前 1s：out[250]=${out.L[250]}`);
  assert.ok(Math.abs(out.L[750] - 0.6) < 1e-6, `后半读到源 1..2s 内容：out[750]=${out.L[750]}`);
  assert.ok(out.L[900] > 0.5, '输出后半有内容（无 rate 时该处恒为 0.2）');
  assert.ok(Math.abs(out.L[999] - data[1998]) < 1e-6, 'slot 末样本=源近尾（2s 源被完整消费）');
  assert.ok(Math.abs(out.R[750] - 0.6) < 1e-6, '单声道源 → 双声道同值');
  // 对照：无 rate 的同 slot 只读源前 1s（后半 0.6 永不进产物）
  delete p.timeline.audioClips[0].rate;
  const out0 = { L: new Float32Array(1000), R: new Float32Array(1000) };
  mixClipInto(out0, mixPlan(p, { domainSec: 1, rate })[0], buf, { rate });
  assert.ok(Math.abs(out0.L[750] - 0.2) < 1e-6, 'rate 缺省=1 行为不变');
});

// ---------- clip 变速/变调（clip.speed/pitchSemi）processed 混音消费 ----------
// 语义契约（clip-process.js · 并行交付）：processed buffer 时长=源/speed（TSM 已烘焙）→
// mixdown 1:1 消费：源读取位=(srcStartSec/speed + rel)×srcRate，不乘 clip.rate（playbackRate
// 恒 1 的离线等价）；无 bufferOverride（含无 speed/semi 的 clip）→ 既有 raw+rate 数学原样。
test('mixClipInto bufferOverride 优先：processed 1:1 消费（不乘 rate、入点=srcStart/speed、processed 耗尽 slot 剩余静音）', () => {
  const mkRaw = () => ({ sampleRate: 1000, numberOfChannels: 1, duration: 9,
    getChannelData: () => new Float32Array(9000).fill(0.2) });
  // ① 优先级 + 不乘 rate：clip.speed=2 且 clip.rate=3 → override 内容以 1:1 进产物
  //   （若乘 rate：pos=(0+rel×3)×1000 ∈ [0,3000] 全落 raw → 恒 0.2；1:1 则恒 0.7）
  const proc1 = { channels: [new Float32Array(1000).fill(0.7)], sampleRate: 1000, duration: 1 };
  const clip1 = { assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 1,
    speed: 2, rate: 3, fadeInSec: 0, fadeOutSec: 0, gain: 1 };
  const e1 = { clip: clip1, trackGain: 1, startSample: 0, endSample: 1000, srcStartSec: 0, bufferOverride: proc1 };
  const o1 = { L: new Float32Array(1000), R: new Float32Array(1000) };
  mixClipInto(o1, e1, mkRaw(), { rate: 1000 });
  assert.ok(Math.abs(o1.L[250] - 0.7) < 1e-6, `override 优先于 raw（raw 恒 0.2）：${o1.L[250]}`);
  assert.ok(Math.abs(o1.L[999] - 0.7) < 1e-6, 'slot 内 1:1（不乘 rate=3）全程 processed 内容');
  assert.ok(Math.abs(o1.R[250] - 0.7) < 1e-6, '单声道 processed → 双声道同值');
  // ② ÷speed 入点映射：srcStart=1s、speed=2 → processed 域入点 0.5s；processed 1s →
  //   slot 前 0.5s 读 processed[500..999]，后 0.5s 越尾静音（磁带放完同语义）
  const proc2 = { channels: [new Float32Array(1000).fill(0.7)], sampleRate: 1000, duration: 1 };
  const clip2 = { assetId: 'a1', timelineStartSec: 0, srcStartSec: 1, lengthSec: 1,
    speed: 2, fadeInSec: 0, fadeOutSec: 0, gain: 1 };
  const e2 = { clip: clip2, trackGain: 1, startSample: 0, endSample: 1000, srcStartSec: 1, bufferOverride: proc2 };
  const o2 = { L: new Float32Array(1000), R: new Float32Array(1000) };
  mixClipInto(o2, e2, mkRaw(), { rate: 1000 });
  assert.ok(Math.abs(o2.L[499] - 0.7) < 1e-6, `入点=srcStart/speed=0.5 → 前半有内容：${o2.L[499]}`);
  assert.ok(Math.abs(o2.L[500]) < 1e-9, `processed 耗尽 → slot 剩余静音：${o2.L[500]}`);
  // ③ AudioBuffer 同构形态（getChannelData+numberOfChannels）同样消费，双声道各自独立
  const L = new Float32Array(2000).fill(0.7), R = new Float32Array(2000).fill(0.3);
  const proc3 = { sampleRate: 1000, numberOfChannels: 2, duration: 2, getChannelData: ch => (ch === 0 ? L : R) };
  const clip3 = { ...clip1, rate: undefined };
  const e3 = { clip: clip3, trackGain: 1, startSample: 0, endSample: 1000, srcStartSec: 0, bufferOverride: proc3 };
  const o3 = { L: new Float32Array(1000), R: new Float32Array(1000) };
  mixClipInto(o3, e3, mkRaw(), { rate: 1000 });
  assert.ok(Math.abs(o3.L[100] - 0.7) < 1e-6 && Math.abs(o3.R[100] - 0.3) < 1e-6, 'getChannelData 形态 override 双声道直读');
});

test('mixClipInto 门控：无 bufferOverride（needsProcess 未供给）→ raw+rate 数学原样、speed 不折叠', () => {
  // clip.speed=2 但无 override：同 slot 只读源前 1s（0.2）——速度/变调未经 processed 消费前
  // 不进混音数学（与引擎 raw 路径降级口径一致）
  const data = new Float32Array(2000);
  for (let i = 0; i < 1000; i++) data[i] = 0.2;
  for (let i = 1000; i < 2000; i++) data[i] = 0.6;
  const buf = { sampleRate: 1000, numberOfChannels: 1, duration: 2, getChannelData: () => data };
  const clip = { assetId: 'a1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 1,
    speed: 2, fadeInSec: 0, fadeOutSec: 0, gain: 1 };
  const entry = { clip, trackGain: 1, startSample: 0, endSample: 1000, srcStartSec: 0 };
  const out = { L: new Float32Array(1000), R: new Float32Array(1000) };
  mixClipInto(out, entry, buf, { rate: 1000 });
  assert.ok(Math.abs(out.L[750] - 0.2) < 1e-6, `无 override → speed 不消费（若折叠应为 0.6）：${out.L[750]}`);
  assert.ok(Math.abs(out.L[999] - 0.2) < 1e-6, 'slot 末样本同 raw 1:1');
});

test('processed 消费接线静态断言：exportVideo/exportAudio opts.resolveProcessed + needsProcess 门控预填 bufferOverride', () => {
  const veSrc = read('js/video-export.js');
  assert.ok(veSrc.includes('resolveProcessed = null'), 'exportVideo/exportAudio opts 带 resolveProcessed（缺省 null=静默降级 raw）');
  const fillSites = veSrc.match(/needsProcess\(plan\[k\]\.clip\)/g) || [];
  assert.ok(fillSites.length >= 2, `两条导出链（视频+仅音频）混音循环前 needsProcess 门控预填，实得 ${fillSites.length} 处`);
  assert.ok(veSrc.includes('plan[k].bufferOverride'), 'plan entry bufferOverride 预填通道在场');
});
