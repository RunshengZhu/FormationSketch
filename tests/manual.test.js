// 说明书页（manual）静态验证（node --test，无浏览器依赖）。
// 覆盖四类断言：内容非空（manualOutline 七场景）、截图资产 base64 可解码且体积受控、
// tab 接线存在（index.html/main.js/css，且既有四页签 .ptab 数量不被破坏——E2E 仪器断言）、
// 构建包含（build-single 产物 dist/formation-studio.html 含说明书模块与资产）。
// 浏览器侧行为（点页签切换/图片解码/覆盖层开合）由 lab 探针 manual-probe.mjs 覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualOutline, manualImageKeys } from '../js/manual.js';
import { MANUAL_IMAGES, MANUAL_META } from '../js/manual-assets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

// ---------- 1. 内容非空：七场景骨架 ----------
test('manualOutline：七个典型场景，标题/角色/步骤齐备且各配截图', () => {
  const outline = manualOutline();
  assert.equal(outline.length, 7, '应为 7 个场景（从零编创/编辑修改/排练演示/音乐适配/分发迁移/离线弱网/skill 辅助）');
  const ids = outline.map(s => s.id);
  assert.deepEqual(ids, ['create', 'edit', 'rehearsal', 'music', 'share', 'offline', 'skill']);
  for (const s of outline) {
    assert.ok(s.title.trim().length >= 2, `场景 ${s.id} 标题非空`);
    assert.ok(s.role.includes('：') && s.role.length >= 8, `场景 ${s.id} 应有「适用角色一句话」`);
    assert.ok(s.steps >= 3, `场景 ${s.id} 步骤清单至少 3 条`);
  }
  // 离线/弱网与 skill 辅助两个场景以文字动线为主，可无截图；其余五个必须配图
  const withFigs = outline.filter(s => s.figs.length);
  assert.equal(withFigs.length, 5, '应有 5 个场景配截图');
});

test('manual.js 源码：入口文案保留实测原文（「合并为单元」「⇤ 对齐到播放头」「✂ 拆开」等）', () => {
  const src = read('js/manual.js');
  for (const t of ['＋ 新建项目', '生成队形…', '合并为单元', '✂ 拆开', '＋ 新队形', '✏ 编辑', '🎵 音乐与节拍', '载入音乐…', '点拍', '试听', '⇤ 对齐到播放头', '导入项目文件…', '数拍入场', '☰ 多选', '项目文件 · 含音乐']) {
    assert.ok(src.includes(t), `应包含实测入口文案「${t}」`);
  }
});

// ---------- 2. 截图资产：base64 可解码 + 体积受控 ----------
test('manual-assets：≥6 张图、全部可按 base64 解码为合法 JPEG（FF D8 FF 魔数）', () => {
  const keys = manualImageKeys();
  assert.ok(keys.length >= 6, `应至少 6 张截图，实得 ${keys.length}`);
  for (const k of keys) {
    const uri = MANUAL_IMAGES[k];
    assert.ok(uri.startsWith('data:image/jpeg;base64,'), `${k} 应为 image/jpeg base64 data URI`);
    const bin = Buffer.from(uri.slice('data:image/jpeg;base64,'.length), 'base64');
    assert.equal(bin.length, Math.floor(bin.length), '解码后应有确定字节数');
    assert.deepEqual([...bin.subarray(0, 3)], [0xff, 0xd8, 0xff], `${k} 解码后应为 JPEG 魔数（FF D8 FF）`);
    assert.ok(MANUAL_META.captions?.[k], `${k} 应有截图说明文字`);
  }
});

test('manual-assets：单张 ≤48KB、总体 ≤400KB（压缩预算）', () => {
  const sizes = Object.entries(MANUAL_IMAGES).map(([k, uri]) => [k, Buffer.byteLength(uri.slice('data:image/jpeg;base64,'.length), 'base64')]);
  for (const [k, bytes] of sizes) assert.ok(bytes <= 48 * 1024, `${k} ${bytes}B 超过单张 48KB 上限`);
  const total = sizes.reduce((a, [, b]) => a + b, 0);
  assert.ok(total <= 400 * 1024, `总体积 ${total}B 超过 400KB 预算`);
});

test('manual-assets.js 与单一事实源 scripts/manual-assets.json 一致（生成物未漂移）', () => {
  const json = JSON.parse(read('scripts/manual-assets.json'));
  assert.deepEqual(manualImageKeys(), Object.keys(json.images).sort(), '键集合一致');
  for (const k of manualImageKeys()) assert.equal(MANUAL_IMAGES[k], json.images[k], `${k} data URI 应逐字节一致`);
  assert.match(read('js/manual-assets.js'), /由 scripts\/gen-manual-assets\.mjs 从 scripts\/manual-assets\.json 生成/);
});

// ---------- 3. tab 接线存在 ----------
test('index.html：说明书页签/页容器/移动端入口/全屏覆盖层齐备，且既有 .ptab 恰 4 个（仪器断言保护）', () => {
  const html = read('index.html');
  assert.match(html, /<button class="mtab" data-tab="manual"[^>]*>📖 说明书<\/button>/, '应有 .mtab 说明书页签（与四页签平齐）');
  assert.match(html, /<div id="props-manual" class="props-page" hidden><\/div>/, '应有 props-manual 页容器');
  assert.match(html, /id="btn-manual-open"/, '应有移动端「更多」入口按钮');
  assert.match(html, /id="manual-overlay"[^>]*hidden>/, '应有全屏覆盖层（默认隐藏）');
  assert.match(html, /id="btn-manual-close"/, '覆盖层应有关闭按钮');
  assert.match(html, /id="manual-overlay-body"/, '覆盖层应有内容容器');
  const ptabCount = (html.match(/class="ptab[ "]/g) || []).length;
  assert.equal(ptabCount, 4, `.ptab 必须恰 4 个（lab 仪器断言「四页签在」），实得 ${ptabCount}`);
});

test('main.js 接线：import renderManual、wireManual 挂载两处、通用页签切换、Esc 先关覆盖层', () => {
  const src = read('js/main.js');
  assert.match(src, /import \{ renderManual \} from '\.\/manual\.js';/, '应 import renderManual');
  assert.match(src, /wireManual\(\);/, 'boot 应调用 wireManual');
  assert.match(src, /panel\.append\(renderManual\(\{ build: BUILD_TAG \}\)\)/, '右面板页容器应挂载说明书');
  assert.match(src, /body\.append\(renderManual\(\{ build: BUILD_TAG \}\)\)/, '覆盖层应挂载同一份内容');
  assert.match(src, /querySelectorAll\('\.panel-tabs button'\)/, '页签切换应覆盖 .panel-tabs 全部按钮（含说明书）');
  assert.match(src, /querySelectorAll\('#right-panel \.props-page'\)/, '页可见性应按 props-page 通用切换');
  assert.match(src, /manual-overlay'/, 'Esc 应处理说明书覆盖层');
});

test('css：说明书页签/排版/覆盖层样式存在', () => {
  const css = read('css/style.css');
  assert.match(css, /\.mtab\{/, '说明书页签样式');
  assert.match(css, /\.manual\{/, '说明书排版样式');
  assert.match(css, /#manual-overlay\{position:fixed/, '覆盖层全屏样式');
  assert.match(css, /body\[data-mtab="more"\] \.manual-entry\{display:block/, '移动端「更多」入口仅在更多 tab 显示');
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
  assert.ok(html.includes('props-manual'), '应含说明书页容器');
  assert.ok(html.includes('btn-manual-open'), '应含移动端入口');
});
