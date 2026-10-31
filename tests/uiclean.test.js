// build-55-uiclean：UI 冗余清理静态验证（node --test，无浏览器依赖）。
// 覆盖四组断言（对应清理项 P1-1 / P1-2 / P2 / P3）：
//   P1-1  块时长条「打点」钮退役、音乐工具条唯一按钮入口
//   P1-2  右面板页签唯一组（调查结论：本就单组、桌面/移动双布局共用同一节点；
//         以「恰一组 + 组内恰 4 钮 + data-tab↔页容器一一对应」锁定，防未来残留重复回归）
//   P2    说明书顶栏入口 + 页签无说明书 + 覆盖层接线
//   P3    「显示…」下拉三项与 store 字段（showGhost/showPaths/previewOnSwitch）接线
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const html = read('index.html');
const mainSrc = read('js/main.js');
const cssSrc = read('css/style.css');

// ---------- P1-1：打点钮唯一入口归音乐工具条 ----------
test('P1-1 块时长条无「打点」钮（btn-tag-drop 退役），音乐工具条 mtb-tag-drop 唯一在', () => {
  assert.ok(!html.includes('btn-tag-drop'), 'index.html 不应再有块时长条打点钮（btn-tag-drop）');
  assert.ok(!mainSrc.includes('btn-tag-drop'), 'main.js 不应再接线 btn-tag-drop');
  assert.match(html, /id="mtb-tag-drop"/, '音乐工具条打点钮应在（唯一按钮入口）');
  assert.equal((html.match(/⚑ 打点/g) || []).length, 1, '「⚑ 打点」文案全应用恰 1 处（音乐工具条）');
  // 打点行为接线不丢：mtb-tag-drop → musicTl.stampTag（音乐域节奏区域）
  assert.match(mainSrc, /\$\('mtb-tag-drop'\)\.addEventListener\('click', \(\) => musicTl\?\.stampTag\(\)\)/,
    'mtb-tag-drop 应接 musicTl.stampTag（打点语义不变）');
  // 同高防位移 CSS 规则随钮退役（块栏行高几何不受残留规则影响）
  assert.ok(!cssSrc.includes('#btn-tag-drop'), 'css 不应残留 btn-tag-drop 规则');
});

// ---------- P1-2：右面板页签唯一组 ----------
test('P1-2 右面板页签唯一组：恰一组 panel-tabs、恰 5 钮、data-tab↔页容器一一对应（build-56-indextab 改写）', () => {
  // build-56-indextab 改写：索引入栏为第 5 页签（data-tab="index" → #props-index），组仍恰 1 组
  const groups = html.match(/<div class="panel-tabs">[\s\S]*?<\/div>/g) || [];
  assert.equal(groups.length, 1, 'panel-tabs 组应恰 1 个（桌面/移动双布局共用同一节点组，无残留重复）');
  const buttons = groups[0].match(/<button[^>]*>/g) || [];
  assert.equal(buttons.length, 5, '页签组内应恰 5 钮（队形/舞台/样式/编组/索引）');
  const tabs = [...groups[0].matchAll(/data-tab="([\w-]+)"/g)].map(m => m[1]);
  assert.deepEqual(tabs, ['formation', 'stage', 'style', 'groups', 'index'], 'data-tab 应恰五页且顺序稳定');
  for (const t of tabs) {
    assert.match(html, new RegExp(`id="props-${t}"`), `页签 ${t} 应有配对页容器 props-${t}`);
  }
  assert.equal((html.match(/class="props-page[ "]/g) || []).length, 5, 'props-page 页容器应恰 5 个（与页签等数；索引页容器带 si-page 修饰类）');
  // 双布局事实：移动端「更多」复用同一 #right-panel（CSS 显示切换），不另设第二组页签
  assert.match(cssSrc, /body\[data-mtab="more"\] #right-panel\{display:flex/, '移动端更多页应复用右面板（单组页签服务双布局）');
});

// ---------- P2：说明书顶栏入口 ----------
test('P2 说明书顶栏钮在（名册旁）、页签无说明书、覆盖层与 renderManual 接线保留', () => {
  // 顶栏入口：紧跟「名册」钮之后（build-55-uiclean P2），book 图标 + 文字（build-58-manual3 F3 起
  // 两模式恒显「图标+文字」，不再 hide-mobile 图标化）。窗 400→900 改写注明：两钮间新增 F3 取舍注释
  assert.match(html, /id="btn-roster"[\s\S]{0,900}?id="btn-manual-open"/, '说明书入口应紧跟顶栏「名册」钮');
  assert.match(html, /id="btn-manual-open"[^>]*>[\s\S]{0,240}?data-icon="book"/, '入口应带 book 图标');
  assert.ok(!/class="mtab"/.test(html) && !/data-tab="manual"/.test(html), '页签组不应再有说明书页签');
  assert.ok(!html.includes('props-manual'), '说明书页容器不应再在 index.html');
  // 覆盖层机制复用（既有 overlay + renderManual），Esc 先关覆盖层语义保留
  assert.match(html, /id="manual-overlay"[^>]*hidden>/, '全屏覆盖层应保留（默认隐藏）');
  assert.match(mainSrc, /body\.append\(renderManual\(\{ build: BUILD_TAG \}\)\)/, '覆盖层应挂载 renderManual 内容');
  assert.match(mainSrc, /if \(ov && !ov\.hidden\) \{ ov\.hidden = true; return; \}/, 'Esc 应先关说明书覆盖层');
  // 顶栏说明书钮样式随顶栏 ghost 钮（无独立 display 规则残留）
  assert.ok(!cssSrc.includes('.manual-entry'), 'css 不应残留 manual-entry 规则');
});

// ---------- P3：显示…下拉收纳三开关 ----------
test('P3 stage-tools 收纳为「显示…」下拉：三菜单项与 store 字段接线、fixed 摆位、单弹窗不变式', () => {
  // 行内三钮退役
  for (const id of ['btn-ghost', 'btn-paths', 'btn-switch-anim']) {
    assert.ok(!html.includes(id) && !mainSrc.includes(id), `${id} 应已从 index.html/main.js 退役`);
  }
  // 下拉结构（与导出菜单同款 dropdown/dd-menu）+ 触发钮
  assert.match(html, /<div class="dropdown" id="view-dd">/, '应有 view-dd 下拉（dropdown 结构）');
  assert.match(html, /id="btn-view-dd"[^>]*>显示…<\/button>/, '触发钮文案应为「显示…」');
  for (const id of ['vw-ghost', 'vw-paths', 'vw-anim']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="menuitemcheckbox"`), `${id} 菜单项应为 checkbox 语义`);
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-checked="true"`), `${id} 菜单项应带 aria-checked 勾选态`);
  }
  // store 字段接线不变（点击切换既有 UI 状态）
  assert.match(mainSrc, /\$\('vw-ghost'\)\?\.addEventListener\('click', \(\) => \{ store\.setUI\(\{ showGhost: !store\.getState\(\)\.showGhost \}\); \}\)/);
  assert.match(mainSrc, /\$\('vw-paths'\)\?\.addEventListener\('click', \(\) => \{ store\.setUI\(\{ showPaths: !store\.getState\(\)\.showPaths \}\); \}\)/);
  assert.match(mainSrc, /\$\('vw-anim'\)\?\.addEventListener\('click', \(\) => \{ store\.setUI\(\{ previewOnSwitch: !store\.getState\(\)\.previewOnSwitch \}\); \}\)/);
  // 勾选态随渲染同步（✓ 前缀 + aria-checked，store 字段不变）
  assert.match(mainSrc, /function syncViewMenu\(/, '应有 syncViewMenu 渲染同步');
  assert.match(mainSrc, /syncViewMenu\(state\);/, 'render 应调用 syncViewMenu');
  // 单弹窗不变式：开本下拉前先关已开弹层；document 点击收起
  assert.match(mainSrc, /if \(vmenu\.hidden\) closeContextMenu\(\);/, '开显示…下拉前应先关既有弹层（单弹窗不变式）');
  assert.match(mainSrc, /document\.addEventListener\('click', \(\) => \{ if \(vmenu\) vmenu\.hidden = true; \}\)/, 'document 点击应收起显示…菜单');
  // fixed 摆位（build-44/50 同构：工具行 overflow 裁切豁免 + placeDropdownBelow）
  assert.match(cssSrc, /#view-dd \.dd-menu\{position:fixed;z-index:200\}/, 'view-dd 菜单应有 fixed 规则');
  assert.match(mainSrc, /M\.placeDropdownBelow\(r, window\.innerWidth \|\| 0\)/, '摆位应走 placeDropdownBelow 纯函数');
});
