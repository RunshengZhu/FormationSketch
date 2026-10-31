// manual2.test.js —— build-57-manual2 新增：说明书五幕重构的结构完整性验证。
// 覆盖三类断言：
//   1) 五幕结构完整性：幕标题 / user story 模板（作为…我要…以便…）/ 每幕有图 / 延伸一行；
//   2) asset 键与 outline 引用一一对应（manualImageKeys ↔ MANUAL_IMAGES ↔ outline figs∪intro）；
//   3) 体积上限断言（build-59-manual4 改写：单张 ≤150KB、总体 ≤900KB —— v4 DPR2 高清新预算；
//      旧 v3 52KB/352KB 预算退役；manual4.test.js 同口径复断并加 9 键对应）。
// 纯数据验证（manualOutline/manualIntro/manualImageKeys + MANUAL_IMAGES），无浏览器依赖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualOutline, manualIntro, manualImageKeys } from '../js/manual.js';
import { MANUAL_IMAGES, MANUAL_META } from '../js/manual-assets.js';

const kb = uri => Buffer.byteLength(uri.slice('data:image/jpeg;base64,'.length), 'base64');

// ---------- 1. 五幕结构完整性 ----------
test('五幕完整性：每幕有图、每图标注要点 1..4 条、标注与截图红框同源（≤4 不糊图纪律）', () => {
  const outline = manualOutline();
  const titles = ['音乐导入', '音乐编辑', '节奏划分', '队形编排', '导出'];
  assert.deepEqual(outline.map(a => a.title), titles, '五幕按工作流顺序：音乐导入→音乐编辑→节奏划分→队形编排→导出');
  for (const a of outline) {
    assert.ok(a.figs.length >= 1, `幕 ${a.id} 至少一张截图`);
    assert.ok(a.annots.length >= 1 && a.annots.length <= 4 * a.figs.length, `幕 ${a.id} 标注要点数量异常`);
    for (const t of a.annots) assert.ok(t.trim().length >= 2, `幕 ${a.id} 标注要点「${t}」非空`);
    // 关键幕的关键元素必须有标注覆盖（任务书镜头清单的验收口径）
    const all = a.annots.join('|');
    if (a.id === 'import') assert.ok(/载入音乐/.test(all) && /媒体库/.test(all), '第 1 幕应标注载入入口与媒体库');
    if (a.id === 'music-edit') assert.ok(/clip 区域块/.test(all) && /导航滑块/.test(all), '第 2 幕应标注 clip 区域块与导航滑块');
    if (a.id === 'rhythm') assert.ok(/L1/.test(all) && /L2/.test(all), '第 3 幕应标注 L1/L2 分层');
    if (a.id === 'choreo') assert.ok(/队形列表/.test(all) && /块时长条/.test(all), '第 4 幕应标注队形列表与块时长条');
    if (a.id === 'export') assert.ok(/含音乐/.test(all), '第 5 幕应标注含音乐导出语义');
  }
});

test('开场完整性：四步主流程按工作流措辞（音乐导入→音乐编辑→节奏划分→队形编排→导出）', () => {
  const intro = manualIntro();
  assert.equal(intro.flow, 4);
  assert.equal(intro.fig, 'overview');
  assert.equal(intro.annots.length, 4, '界面导览一图标注四大区域');
  const flow = (intro.flowTexts || []).join('\n');
  ['音乐导入', '音乐编辑', '节奏划分'].forEach((kw, i) => {
    assert.ok(flow.includes(kw), `主流程第 ${i + 1} 步应含「${kw}」`);
  });
  assert.ok(flow.includes('队形编排') && flow.includes('导出'), '主流程第 4 步应含队形编排与导出');
});

// ---------- 2. asset 键 ↔ outline 引用一一对应 ----------
test('asset 键与 outline 引用一一对应：无孤儿资产、无缺图引用（截图管线与说明书接线同源）', () => {
  const outline = manualOutline();
  const intro = manualIntro();
  const referenced = [...new Set([...outline.flatMap(a => a.figs), intro.fig])].sort();
  assert.deepEqual(manualImageKeys(), referenced, 'manualImageKeys 应恰为 outline figs ∪ intro fig');
  assert.deepEqual(Object.keys(MANUAL_IMAGES).sort(), referenced, 'MANUAL_IMAGES 键应与引用集合完全一致（无孤儿/无缺失）');
  for (const k of referenced) {
    assert.ok(MANUAL_META.captions?.[k], `资产 ${k} 应有 caption`);
  }
});

// ---------- 3. 体积上限 ----------
// build-59-manual4 改写注明：截图 v4 高清重拍（DPR2 / q80 首选），旧 v3 预算（单张 ≤52KB、
// 总 ≤352KB）随之退役；新预算「单张 ≤150KB、总 ≤900KB」为 2x 高清合理范围（任务书口径，
// manual4.test.js 同口径复断）。capture 管线见 lab manual-shots-v4.mjs（v3 存档）。
test('体积上限（v4 高清）：单张 ≤150KB、总体 ≤900KB（DPR2 重拍预算；v3 52KB/352KB 退役）', () => {
  const sizes = Object.entries(MANUAL_IMAGES).map(([k, uri]) => [k, kb(uri)]);
  for (const [k, bytes] of sizes) assert.ok(bytes <= 150 * 1024, `${k} ${bytes}B 超过单张 150KB 上限`);
  const total = sizes.reduce((a, [, b]) => a + b, 0);
  assert.ok(total <= 900 * 1024, `总体积 ${total}B 超过 900KB 预算`);
});
