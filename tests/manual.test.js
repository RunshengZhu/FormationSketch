// 说明书页（manual）静态验证（node --test，无浏览器依赖）。
// build-57-manual2 按工作流 user story 重构改写：结构断言收口为「开场 + 五幕」
// （音乐导入 → 音乐编辑 → 节奏划分 → 队形编排 → 导出）；五幕结构完整性 / asset 键与
// outline 引用一一对应 / 体积上限断言移至 tests/manual2.test.js（本文件不再重复体积预算）。
// 其余四类断言保留：内容非空（user story 模板）、截图资产 base64 可解码且带标注、
// 顶栏入口与覆盖层接线存在（build-56-indextab 五页签 E2E 仪器断言）、构建包含。
// 浏览器侧行为（点顶栏钮开覆盖层/图片解码/Esc 关闭）由 lab 探针覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualOutline, manualIntro, manualImageKeys } from '../js/manual.js';
import { MANUAL_IMAGES, MANUAL_META } from '../js/manual-assets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

// ---------- 1. 内容非空：开场 + 五幕骨架 ----------
test('manualOutline：五幕工作流结构（导入→编辑→划分→编排→导出），标题/user story/步骤齐备', () => {
  const outline = manualOutline();
  assert.equal(outline.length, 5, `应为 5 幕（音乐导入/音乐编辑/节奏划分/队形编排/导出），实得 ${outline.length}`);
  assert.deepEqual(outline.map(s => s.id), ['import', 'music-edit', 'rhythm', 'choreo', 'export']);
  assert.deepEqual(outline.map(s => s.title), ['音乐导入', '音乐编辑', '节奏划分', '队形编排', '导出']);
  assert.deepEqual(outline.map(s => s.no), [1, 2, 3, 4, 5], '幕序号 1..5');
  for (const s of outline) {
    assert.ok(s.title.trim().length >= 2, `幕 ${s.id} 标题非空`);
    // user story 模板：「作为____，我要____，以便____。」
    assert.match(s.story, /^作为.+，我要.+，以便.+。$/, `幕 ${s.id} 应为 user story 模板`);
    assert.ok(s.steps >= 3, `幕 ${s.id} 步骤清单至少 3 条`);
    assert.ok(s.more && s.more.startsWith('延伸：'), `幕 ${s.id} 末尾应有「延伸」一行`);
  }
});

test('manualIntro：开场四步主流程 + 界面导览图（overview，四区域标注）', () => {
  const intro = manualIntro();
  assert.equal(intro.flow, 4, '开场应为四步主流程');
  assert.equal(intro.fig, 'overview', '界面导览图 = overview 全景');
  assert.equal(intro.annots.length, 4, '导览图应标注四大区域');
});

test('manual.js 源码：工作流入口文案保留实测原文（「＋ 载入音乐」「对齐到播放头」「导入项目文件…」等）', () => {
  const src = read('js/manual.js');
  for (const t of ['＋ 载入音乐', '媒体库', '＋ 新队形', '打点', '剃刀', '磁吸', '对齐到播放头', '导入项目文件…', '导出项目文件（含音乐）', '导航滑块', '层级折叠']) {
    assert.ok(src.includes(t), `应包含实测入口文案「${t}」`);
  }
  // 七场景旧标题退役（build-57-manual2 砍冗余）：旧场景标题不再出现
  // （「AI 辅助编创」是功能名不是场景标题，在延伸行合法保留，不入本列）
  for (const gone of ['从零编创', '排练现场演示', '分发与迁移', '离线 / 弱网赛场', '适用角色']) {
    assert.ok(!src.includes(gone), `旧七场景文案「${gone}」应已退役`);
  }
});

// ---------- 2. 截图资产：base64 可解码 + 带标注 ----------
test('manual-assets：9 张图、全部可按 base64 解码为合法 JPEG（FF D8 FF 魔数）且带视觉标注', () => {
  const keys = manualImageKeys();
  assert.equal(keys.length, 9, `应为 9 张截图（v3 九镜头：overview+导入/编辑/划分/编排/导出五幕），实得 ${keys.length}`);
  assert.deepEqual(keys, ['align', 'export', 'formation-stage', 'index-music', 'music-clip-detail', 'music-edit', 'music-import', 'overview', 'rhythm-lane']);
  assert.equal(MANUAL_META.annotated, true, 'meta.annotated 应为 true（v3 资产带 .ux-annot 视觉标注）');
  assert.equal(MANUAL_META.count, 9, 'meta.count 应为 9');
  // build-91-varispeed 改写注明：截图按 build-72 现状重拍 + 标注尺寸自适应（v4 DPR 恒定 ×2 缺陷），
  // generator 由 manual-shots-v4.mjs → v5（预算断言见 manual2/manual4）
  assert.equal(MANUAL_META.generator, 'manual-shots-v5.mjs', 'meta.generator 应为 v5 拍摄脚本');
  for (const k of keys) {
    const uri = MANUAL_IMAGES[k];
    assert.ok(uri.startsWith('data:image/jpeg;base64,'), `${k} 应为 image/jpeg base64 data URI`);
    const bin = Buffer.from(uri.slice('data:image/jpeg;base64,'.length), 'base64');
    assert.deepEqual([...bin.subarray(0, 3)], [0xff, 0xd8, 0xff], `${k} 解码后应为 JPEG 魔数（FF D8 FF）`);
    assert.ok(MANUAL_META.captions?.[k], `${k} 应有截图说明文字`);
  }
});

test('manual-assets.js 与单一事实源 scripts/manual-assets.json 一致（生成物未漂移）', () => {
  const json = JSON.parse(read('scripts/manual-assets.json'));
  assert.deepEqual(manualImageKeys(), Object.keys(json.images).sort(), '键集合一致');
  for (const k of manualImageKeys()) assert.equal(MANUAL_IMAGES[k], json.images[k], `${k} data URI 应逐字节一致`);
  assert.match(read('js/manual-assets.js'), /由 scripts\/gen-manual-assets\.mjs 从 scripts\/manual-assets\.json 生成/);
});

// ---------- 3. tab 接线存在 ----------
test('index.html：说明书顶栏入口/全屏覆盖层齐备，页签恰 5 个且无说明书页签（build-56-indextab 改写）', () => {
  // build-55-uiclean P2 改写：原「.mtab 页签 + props-manual 页容器 + 移动端 manual-entry」断言退役——
  // 说明书入口迁顶栏（名册旁，btn-manual-open → manual-overlay）。
  // build-56-indextab 再改写：页签组 4→5（索引入栏 data-tab="index"，说明书仍不在页签组）。
  const html = read('index.html');
  assert.match(html, /id="btn-manual-open"[^>]*>[\s\S]{0,240}?data-icon="book"/, '顶栏应有「说明书」入口按钮（book 图标）');
  // build-58-manual3 改写注明：窗 400→900——两钮之间新增 F3 取舍注释（编舞右面板页签区/rsb 区
  // 不加说明书入口的说明），相邻关系断言保持（说明书入口仍在「名册」钮之后的顶栏内）
  assert.match(html, /id="btn-roster"[\s\S]{0,900}?id="btn-manual-open"/, '说明书入口应紧跟「名册」钮之后（顶栏）');
  assert.ok(!/class="mtab"/.test(html), '说明书页签（.mtab）应已退役');
  assert.ok(!html.includes('props-manual'), 'props-manual 页容器应已退役');
  assert.ok(!/manual-entry/.test(html), '旧右面板 manual-entry 入口应已退役');
  assert.match(html, /id="manual-overlay"[^>]*hidden>/, '应有全屏覆盖层（默认隐藏）');
  assert.match(html, /id="btn-manual-close"/, '覆盖层应有关闭按钮');
  assert.match(html, /id="manual-overlay-body"/, '覆盖层应有内容容器');
  const ptabCount = (html.match(/class="ptab[ "]/g) || []).length;
  assert.equal(ptabCount, 5, `.ptab 必须恰 5 个（四页签 + build-56 索引页签），实得 ${ptabCount}`);
  const panelTabs = html.match(/<div class="panel-tabs">[\s\S]*?<\/div>/) || [''];
  assert.equal((panelTabs[0].match(/<button/g) || []).length, 5, 'panel-tabs 组内应恰 5 个页签钮（build-56 索引入栏后）');
});

test('main.js 接线：import renderManual、wireManual 单挂载覆盖层、通用页签切换、Esc 先关覆盖层', () => {
  const src = read('js/main.js');
  assert.match(src, /import \{ renderManual \} from '\.\/manual\.js';/, '应 import renderManual');
  assert.match(src, /wireManual\(\);/, 'boot 应调用 wireManual');
  // build-55-uiclean P2 改写：页容器挂载退役——同一 renderManual 只挂 #manual-overlay-body 一处
  assert.ok(!src.includes('props-manual'), 'main.js 不应再引用 props-manual 页容器');
  assert.match(src, /body\.append\(renderManual\(\{ build: BUILD_TAG \}\)\)/, '覆盖层应挂载说明书内容');
  assert.match(src, /querySelectorAll\('\.panel-tabs button'\)/, '页签切换应覆盖 .panel-tabs 全部按钮');
  assert.match(src, /querySelectorAll\('#right-panel \.props-page'\)/, '页可见性应按 props-page 通用切换');
  assert.match(src, /manual-overlay'/, 'Esc 应处理说明书覆盖层');
});

test('css：说明书覆盖层样式存在，五幕版式类（man-story/man-annots/man-more）齐备', () => {
  const css = read('css/style.css');
  assert.ok(!/\.mtab\{/.test(css), '.mtab 页签样式应随页签退役');
  assert.match(css, /\.manual\{/, '说明书排版样式');
  assert.match(css, /#manual-overlay\{position:fixed/, '覆盖层全屏样式');
  // build-57-manual2：user story 版式（story 引用块 / 标注要点行 / 延伸一行）
  assert.match(css, /\.manual \.man-story\{/, 'user story 引用块样式');
  assert.match(css, /\.manual \.man-annots\{/, '标注要点行样式');
  assert.match(css, /\.manual \.man-more\{/, '延伸一行样式');
  assert.ok(!css.includes('.manual-entry'), '.manual-entry 入口样式应随入口迁移退役');
});

// ---------- 4. 构建包含 ----------
test('build-single.mjs：ORDER 含 manual-assets/manual（ui 之后 main 之前），nsKey 连字符映射', () => {
  const src = read('scripts/build-single.mjs');
  const m = src.match(/const ORDER = \[([^\]]+)\]/);
  assert.ok(m, '应能解析 ORDER');
  const order = m[1].match(/'([\w-]+)'/g).map(s => s.slice(1, -1));
  const iUi = order.indexOf('ui'), iMa = order.indexOf('manual-assets'), iMn = order.indexOf('manual'), iMain = order.indexOf('main');
  assert.ok(iUi < iMa && iMa < iMn && iMn < iMain, `顺序应为 ui → manual-assets → manual → main，实得 ${order}`);
  assert.match(src, /'manual-assets' \? 'manualAssets'/, 'nsKey 应把 manual-assets 映射为 manualAssets 命名空间');
});

test('dist/formation-studio.html：重新构建后包含说明书模块、资产与接线（打包零遗漏）', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-single.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `构建应成功：${r.stderr}`);
  const html = read('dist/formation-studio.html');
  assert.match(html, /module: manual-assets/, 'bundle 应含 manual-assets 模块');
  assert.match(html, /module: manual\b/, 'bundle 应含 manual 模块');
  assert.match(html, /data:image\/jpeg;base64,\/9j\//, 'bundle 应内嵌 JPEG 资产（/9j/ 为 base64 JPEG 头）');
  // build-55-uiclean P2 改写：页容器退役断言 → 顶栏入口断言
  assert.ok(!html.includes('props-manual'), '不应再含说明书页容器（已退役）');
  assert.ok(html.includes('btn-manual-open'), '应含顶栏说明书入口');
});
