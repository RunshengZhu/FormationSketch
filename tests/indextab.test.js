// build-56-indextab：编舞舞台扩容（F1）+ 乐段索引入两模式侧栏 tab（F2）—— node 单测。
// F1：stage 缺省值扩容纯函数/静态断言——右列 wuzhen:stageRight 缺省视为折叠（仅缺省，有记忆按
//     记忆；resolveStageRightCollapsed）、时间轴桌面基线 150→112（内容地板 114 兜底；音乐模式
//     推导零变化、移动端 120 不动）、左列 180→150；音乐布局与移动端零变化守卫。
// F2：索引挂载点切换（stage=#props-index 第 5 页签 / music=#rsb-index-pane 媒体库段 tab 条，
//     两容器互斥激活、单挂载点 #si-playhead/#si-list 全文档唯一）、非激活容器渲染跳过、
//     块时长条/工具条/摘要条索引钮与 ⌘⇧L 分模式行为、宿主链先展开再切 tab。
// 退役：浮动面板（fixed 定位/拖宽高 grip/尺寸记忆键/避让摆位单入口及其挂点）——
//     siEnsureDom / siApplyPlacement / si-grip 零残留静态断言（含 model 纯函数与 CSS 规则）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStageRightCollapsed, resolveRsbClosed, resolveSegFold, applyRsbPaneState } from '../js/ui.js';
import { tlTotalHeight } from '../js/timeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const mainSrc = read('js/main.js');
const cssSrc = read('css/style.css');
const htmlSrc = read('index.html');
const modelSrc = read('js/model.js');
const uiSrc = read('js/ui.js');

// ---------- F1：编舞舞台缺省扩容 ----------
test('F1 resolveStageRightCollapsed 纯函数：无记忆=折叠（仅缺省）；显式 0=按记忆展开；1=折叠；storage 异常=折叠', () => {
  assert.equal(resolveStageRightCollapsed({ getItem: () => null }), true, '无记忆 → 缺省折叠（38px 细条，舞台多占视图）');
  assert.equal(resolveStageRightCollapsed({ getItem: () => '1' }), true, '记忆折叠');
  assert.equal(resolveStageRightCollapsed({ getItem: () => '0' }), false, '用户展开过 → 按记忆展开');
  assert.equal(resolveStageRightCollapsed({ getItem: () => { throw new Error('quota'); } }), true, 'storage 抛异常 → 安全侧=缺省');
  assert.equal(resolveStageRightCollapsed(null), true, '无 ls 句柄 → 缺省');
  // 与音乐右栏/段折叠解析同族：boot 读偏好不回写、仅显式 toggle 落盘的纪律不变
  assert.equal(resolveRsbClosed({ getItem: () => null }, false), false, '音乐右栏缺省展开（零变化对照组）');
  assert.equal(resolveSegFold({ getItem: () => null }, 'wuzhen:rsbLib', false), false, '段折叠缺省展开（零变化对照组）');
});

test('F1 boot 接线：右列走 resolveStageRightCollapsed；左列/底部仍纯记忆（无缺省折叠）', () => {
  assert.match(mainSrc, /applyStageRightCollapsed\(resolveStageRightCollapsed\(lsRef\(\)\)\);/, '右列 boot=缺省折叠解析');
  assert.match(mainSrc, /applyStageLeftCollapsed\(lsRef\(\)\?\.getItem\(STAGEUX_KEY\.left\) === '1'\);/, '左列 boot=纯记忆（缺省展开）');
  assert.match(mainSrc, /applyStageBottomCollapsed\(lsRef\(\)\?\.getItem\(STAGEUX_KEY\.bottom\) === '1'\);/, '底部 boot=纯记忆');
  assert.match(uiSrc, /export function resolveStageRightCollapsed\(ls\)/, '解析器在 ui.js（与 resolveRsbClosed 同族，node 可测）');
});

test('F1 时间轴：stage 桌面基线 112（内容地板 114 兜底）/移动 120；音乐模式不走固定公式（推导零变化）', () => {
  assert.equal(tlTotalHeight('stage', 66, false), 114, '桌面=max(112, 22+18+26+6+36+6=114)——较旧 150 省 36px');
  assert.equal(tlTotalHeight('stage', 66, true), 120, '移动端 120 不动（<1024 不受缺省影响）');
  assert.equal(tlTotalHeight('stage', 112, false), 160, '富余域不变');
  // 时间轴内容高写入口按模式区分：stage=固定公式写行内高；music=清行内高交 flex + 容器实测推导
  const tlSrc = read('js/timeline.js');
  assert.match(tlSrc, /h = this\.totalHeightFor\(\);/, 'stage 写入口=totalHeightFor（固定公式）');
  assert.match(tlSrc, /const base = mobile \? 120 : 112;/, 'stage 基线 150→112（移动 120 不动）');
  assert.match(tlSrc, /this\.scroll\.style\.height = '';/, 'music 先清行内高（容器推导，零变化）');
  assert.match(cssSrc, /#tl-scroll\{overflow:auto;height:112px;position:relative\}/, 'CSS 缺省占位同步 112');
});

test('F1 左列 180→150（桌面）；移动端 mtab 全屏层与音乐布局不受缺省影响', () => {
  assert.match(cssSrc, /#left-panel\{display:none;flex-direction:column;width:150px;/, '基础规则 150');
  assert.match(cssSrc, /#left-panel\{width:150px\} \/\* build-56 F1/, '≥1024 桌面规则 150');
  assert.match(cssSrc, /body\[data-mtab="more"\] #right-panel\{display:flex;position:absolute;inset:var\(--tb-h\) 0 0 0;z-index:40;background:var\(--bg\);width:auto\}/,
    '移动端「更多」右列全屏层原样（width:auto，缺省折叠/列宽不影响 <1024）');
  // 音乐右栏宽度缺省零变化（280/180-480 链路原样）
  assert.match(cssSrc, /#editor-view\[data-uimode="music"\] #right-sidebar\{/, '音乐右栏规则在（E-12 音乐零变化）');
});

// ---------- F2：索引入侧栏 tab ----------
test('F2 stage 宿主：右面板第 5 页签 data-tab="index" + #props-index 页容器（props-page 机制复用、缺省隐藏）', () => {
  assert.match(htmlSrc, /<button class="ptab" data-tab="index">索引<\/button>/, '第 5 页签');
  assert.match(htmlSrc, /<div id="props-index" class="props-page si-page" hidden><\/div>/, '页容器（props-page 机制 + 缺省隐藏）');
  assert.match(cssSrc, /#props-index\.si-page\{padding:0;gap:0\}/, '索引页通栏（去页容器缺省内边距，列表撑满右面板）');
  // 页签显隐收口单入口（⌘⇧L/索引钮/页签点击同走，防两套 DOM 写法漂移）
  assert.match(mainSrc, /function activatePropsTab\(tab\) \{/, 'activatePropsTab 单入口');
  assert.match(mainSrc, /pg\.hidden = pg\.id !== 'props-' \+ tab;/, 'data-tab ↔ props-<tab> 配对显隐');
  assert.match(mainSrc, /if \(b\.dataset\.tab === 'index'\) \{ siMount\('stage'\); renderSegIndexPanel\(\); siTick\(\); \}/,
    '索引页签激活=补挂载+补渲染一次（非激活期跳更的补偿）');
});

test('F2 music 宿主：#rsb-lib-seg 段头 tab 条 [媒体库|索引] + 两 pane 互斥（媒体库缺省激活、索引缺省隐藏）', () => {
  const seg = htmlSrc.slice(htmlSrc.indexOf('<section id="rsb-lib-seg"'), htmlSrc.indexOf('</section>', htmlSrc.indexOf('<section id="rsb-lib-seg"')));
  assert.match(seg, /<nav class="rsb-tabs"/, '段头 tab 条');
  assert.match(seg, /<button class="rtab active" data-pane="lib"[^>]*>媒体库<\/button>/, '媒体库 pane 钮（缺省激活）');
  assert.match(seg, /<button class="rtab" data-pane="index"[^>]*>索引<\/button>/, '索引 pane 钮');
  assert.match(seg, /<div id="rsb-index-pane" class="rsb-seg-body rsb-index-pane" hidden><\/div>/, '索引 pane（缺省隐藏；rsb-seg-body 共用段折叠规则）');
  assert.match(seg, /<div id="media-sidebar" class="rsb-seg-body"/, '既有媒体库 pane 原位');
  assert.doesNotMatch(seg, /hidden><\/div>\s*<div id="media-sidebar"/, '媒体库 pane 不带 hidden（缺省激活）');
  // tab 条独立类（不入 .panel-tabs——stage 右面板页签组专用，全局选择器互不串场）
  assert.ok(!/class="panel-tabs"/.test(seg), 'rsb 段内无 .panel-tabs 组（两套页签互不串扰）');
  assert.match(mainSrc, /function activateRsbPane\(pane\) \{/, 'activateRsbPane 单入口');
  assert.match(mainSrc, /document\.querySelectorAll\('#rsb-lib-seg \.rtab'\)\.forEach\(b => b\.addEventListener\('click', \(\) => \{\s*\n\s*activateRsbPane\(b\.dataset\.pane\);/,
    'rtab 点击按 data-pane 委托接线（round2 修复：不依赖按钮 id——id 缺位曾致两钮监听全空装）');
  assert.match(mainSrc, /if \(b\.dataset\.pane === 'index'\) \{ siMount\('music'\); renderSegIndexPanel\(\); siTick\(\); \}/,
    '索引 pane 点击激活=补挂载+补渲染');
  assert.ok(!mainSrc.includes("$('rsb-tab-"), '无 id 依赖的 rtab 接线残留（round2 缺陷根因清零）');
  assert.match(mainSrc, /function activateRsbPane\(pane\) \{[\s\S]{0,220}?applyRsbPaneState\(\{\s*\n\s*tabs: document\.querySelectorAll\('#rsb-lib-seg \.rtab'\),/,
    'pane 状态写入收口 ui.applyRsbPaneState（元素入参 node 可测）');
  // 预览段纵排不动（F2 约束：#rsb-preview-seg 保持原位原语义）
  assert.match(htmlSrc, /<section id="rsb-preview-seg" class="rsb-seg">/, '预览段原样（不受 tab 化影响）');
});

test('F2 回归（round2）：pane 双向切换——active 恰落一钮、两 pane hidden 恒互斥（点「媒体库」切得回去）', () => {
  // 验收缺陷复现路径：index tab → index pane 可见 → 点「媒体库」→ 媒体库内容可见、si-list 隐藏
  const stubEl = () => {
    const classes = new Set();
    const el = {
      classes, dataset: {}, hidden: false, attrs: {},
      classList: {
        toggle: (n, f) => { ((f === undefined) ? !classes.has(n) : !!f) ? classes.add(n) : classes.delete(n); },
        contains: n => classes.has(n),
      },
      setAttribute: (k, v) => { el.attrs[k] = String(v); },
    };
    return el;
  };
  const tabLib = stubEl(); tabLib.dataset.pane = 'lib';
  const tabIdx = stubEl(); tabIdx.dataset.pane = 'index';
  const libPane = stubEl(), idxPane = stubEl();
  const parts = () => ({ tabs: [tabLib, tabIdx], libPane, indexPane: idxPane });
  applyRsbPaneState(parts(), 'index');
  assert.equal(tabIdx.classes.has('active'), true, 'active 落「索引」钮');
  assert.equal(tabLib.classes.has('active'), false, '「媒体库」钮 active 清除');
  assert.equal(libPane.hidden, true, '媒体库内容隐藏');
  assert.equal(idxPane.hidden, false, '索引 pane 可见');
  applyRsbPaneState(parts(), 'lib'); // round2 缺陷路径：点「媒体库」切回
  assert.equal(tabLib.classes.has('active'), true, 'active 恰落「媒体库」钮（唯一）');
  assert.equal(tabIdx.classes.has('active'), false, '「索引」钮 active 清除（恰一钮）');
  assert.equal(libPane.hidden, false, '媒体库内容重新可见（rects>0 的前提）');
  assert.equal(idxPane.hidden, true, '索引 pane（si-list 宿主）隐藏');
  assert.equal(tabLib.attrs['aria-selected'], 'true', 'aria-selected 与 active 同步');
  assert.equal(tabIdx.attrs['aria-selected'], 'false');
});

test('F2 单挂载点：siMount 清旧容器（#si-playhead/#si-list 全文档唯一）；容器按模式二选一互斥', () => {
  assert.match(mainSrc, /function siHostFor\(mode\) \{\s*\n\s*return document\.getElementById\(mode === 'music' \? 'rsb-index-pane' : 'props-index'\);/,
    '宿主定位=两容器按模式二选一（互斥激活的结构面）');
  assert.match(mainSrc, /if \(siState\.root && siState\.root !== host\) siState\.root\.innerHTML = '';/, '切换时清旧容器（id 唯一性）');
  // 播放头行 + 列表由挂载器建立（列表渲染器/折叠集/播放头行全保留，换挂载点不换内容）
  assert.match(mainSrc, /id: 'si-playhead'/, '播放头行挂载建立');
  assert.match(mainSrc, /id: 'si-list'/, 'si-list 挂载建立');
  // 模式切换即重挂载（清旧模式容器 → 挂新模式容器；激活位才补渲染）
  assert.match(mainSrc, /siMount\(next\);\s*\n\s*if \(siIndexActive\(\)\) \{ renderSegIndexPanel\(\); siTick\(\); \}/,
    'setUiMode：挂载随模式迁移 + 激活位补渲染');
});

test('F2 渲染跳过：renderSegIndexPanel/siTick 只写激活容器；store render 挂点按激活位门控', () => {
  assert.match(mainSrc, /function renderSegIndexPanel\(\) \{\s*\n\s*if \(!siState\.root \|\| !siState\.list \|\| !siIndexActive\(\)\) return;/,
    '非激活容器零 DOM 写（build-50 折叠期跳更同思路）');
  assert.match(mainSrc, /function siTick\(\) \{\s*\n\s*if \(!siState\.ph \|\| !siIndexActive\(\)\) return;/, '播放头跟随非激活零开销');
  assert.match(mainSrc, /if \(siIndexActive\(\)\) \{ renderSegIndexPanel\(\); siTick\(\); \}/, 'store render 挂点=激活位门控');
  assert.match(mainSrc, /function siIndexActive\(\) \{/, '激活位判定单入口（宿主 hidden 读数）');
  assert.match(mainSrc, /function siIndexShowing\(\) \{/, '「正看着」判定=激活位+宿主链可见');
});

test('F2 索引钮与 ⌘⇧L 分模式：三入口同一开合；打开=宿主链先展开再切 tab/pane；关闭=让位缺省视图', () => {
  // 三入口（stage 块时长条 / stage 摘要条 / music 工具条）同一 toggle
  assert.match(mainSrc, /\$\('bc-seg-index'\)\?\.addEventListener\('click', toggleSegIndexPanel\);/, '块时长条「索引」钮');
  assert.match(mainSrc, /\$\('ms-tags'\)\.addEventListener\('click', toggleSegIndexPanel\);/, '摘要条「tag N 个」钮');
  assert.match(mainSrc, /\$\('mtb-seg-index'\)\.addEventListener\('click', toggleSegIndexPanel\);/, '音乐工具条「索引」钮');
  assert.match(mainSrc, /e\.shiftKey && e\.key\.toLowerCase\(\) === 'l'/, '⌘⇧L 接线（两模式通用）');
  // 打开=先展开宿主链：music 侧栏收起先展开（记忆）+ 段折叠先展开（不落盘）；stage 右列折叠先展开（记忆）
  assert.match(mainSrc, /if \(mode === 'music'\) \{\s*\n\s*if \(rsbClosed\(\)\) applyRsbClosed\(false, \{ persist: true \}\);/,
    'music：侧栏收起先展开（落盘，与「媒体库」钮同语义）');
  assert.match(mainSrc, /if \(segFolded\('rsb-lib-seg'\)\) applySegFold\('rsb-lib-seg', false\);/, 'music：段折叠先展开（只揭幕不落盘）');
  assert.match(mainSrc, /if \(!isMobileLayout\(\) && stageRightCollapsed\(\)\) applyStageRightCollapsed\(false, \{ persist: true \}\);/,
    'stage：右列折叠先展开（落盘；移动端无折叠形态不写记忆）');
  assert.match(mainSrc, /return !stageRightCollapsed\(\) \|\| isMobileLayout\(\);/,
    'stage 显隐判定豁免移动端（缺省折叠类在 <1024 无形态，不得误判「正看着」）');
  assert.match(mainSrc, /activateRsbPane\('index'\);/, 'music 切索引 pane');
  assert.match(mainSrc, /activatePropsTab\('index'\);/, 'stage 切索引页签');
  // 关闭=让位缺省视图（stage→队形页签；music→媒体库 pane）
  assert.match(mainSrc, /function closeSegIndexPanel\(\) \{\s*\n\s*if \(siCurrentMode\(\) === 'music'\) activateRsbPane\('lib'\);\s*\n\s*else activatePropsTab\('formation'\);\s*\n\s*\}/,
    '关闭=让位缺省视图');
  // Esc：索引「正看着」时先让位（W4 语义保留）；toggle 按 siIndexShowing 分模式判定
  assert.match(mainSrc, /if \(siIndexShowing\(\)\) \{ closeSegIndexPanel\(\); return; \}/, 'Esc 先关索引视图');
  assert.match(mainSrc, /function toggleSegIndexPanel\(\) \{ siIndexShowing\(\) \? closeSegIndexPanel\(\) : openSegIndexPanel\(\); \}/,
    'toggle=siIndexShowing 分模式判定');
});

// ---------- 退役：浮动面板零残留 ----------
test('退役零残留：浮动面板定位/拖宽高 grip/尺寸记忆/避让摆位在 main/model/css/html 四文件无一处残留', () => {
  const retired = [
    'siEnsureDom',        // 浮动面板建立入口
    'siApplyPlacement',   // 避让摆位单入口（build-51）
    'si-grip',            // 拖宽高 grip（DOM + CSS）
    'siWireResize',       // 拖宽高接线
    'siStoredSize',       // 记忆尺寸读取
    'wuzhen:siW',         // 宽度记忆键
    'wuzhen:siH',         // 高度记忆键
    'segIndexPlacement',  // 避让定位纯函数（model）
    'SI_AVOID',           // 避让常量组（model）
    'clampSegIndex',      // 宽高钳制纯函数（model）
    'seg-index-panel',    // 浮动面板 DOM id
    'baseHeight',         // 避让压缩还原链字段
    'hCompressed',        // 同上
  ];
  for (const id of retired) {
    assert.ok(!mainSrc.includes(id), `main.js 无残留：${id}`);
    assert.ok(!modelSrc.includes(id), `model.js 无残留：${id}`);
    assert.ok(!cssSrc.includes(id), `style.css 无残留：${id}`);
    assert.ok(!htmlSrc.includes(id), `index.html 无残留：${id}`);
  }
});

test('F2 保留面：列表渲染器/折叠集/播放头行/单弹窗不变式换挂载点不换内容', () => {
  // 内容三件套在渲染器内原样（折叠过滤、层级折叠集、行「…」菜单）
  assert.match(mainSrc, /const visible = M\.filterCollapsedRows\(rows, siState\.collapsed\);/, '折叠过滤走纯函数');
  assert.match(mainSrc, /siState\.collapsed\.delete\(s\.tag\.id\); else siState\.collapsed\.add\(s\.tag\.id\)/, '层级折叠集读写');
  assert.match(mainSrc, /showContextMenu\(segMenuItems\(s\.tag\.id\)/, '行「…」菜单（segMenuItems 同源）');
  assert.match(mainSrc, /closeContextMenu\(\); musicTl\?\.closeTagPopover\?\.\(\);/, '单弹窗不变式');
  // 播放头行语义：build-91-varispeed 需求 1b——两分支统一分秒读数（fmtMinSec，旧「music 秒 /
  // stage 拍·秒」双分支收进单模板）
  assert.match(mainSrc, /siState\.ph\.textContent = `▶ 当前 \$\{fmtMinSec\(M\.beatToSec\(p, b\)\)\}`;/, '播放头行=分秒读数模板在');
  assert.match(mainSrc, /function fmtMinSec\(sec\)/, '分秒格式化器在（<60s「N 秒」/≥60s「N分N秒」）');
  // 列表 overflow-y:auto 既有（siMount 内联样式）
  assert.match(mainSrc, /overflow-y:auto;overscroll-behavior:contain;min-height:0/, '列表滚动域随容器');
});
