// build-50-indexux：索引面板宽高拖拽（F1）+ 层级折叠（F2）+ 导出菜单遮挡修复（F3）—— node 单测。
// build-56-indextab 改写注记：F1 拖宽/拖高与 wuzhen:siW/siH 记忆随浮动面板退役（索引进两模式
// 侧栏 tab，尺寸/摆位由宿主容器 flex 决定）——F1 两条原测试（钳制纯函数/grip 拖拽/height 锚定）
// 改写为退役零残留静态断言（退役守卫主责在 tests/indextab.test.js，此处只钉「本 build 引入的
// 面板拖宽高面已清场」）；F2 折叠/行渲染断言全量保留（语义未动，仅 siState 形状随退役注记微调）。
// F3：export-dd fixed + z-index 静态断言 + 打开时摆位纯函数（placeDropdownBelow）行为断言 +
//     顶栏横滚/resize 收起；同批排查：index.html 全部 .dropdown 均已有 fixed 规则（无残余同病）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeDropdownBelow, nestSegmentsByLevel, filterCollapsedRows } from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const cssSrc = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8');

// ---------- F1：索引面板宽高拖拽（build-56-indextab 退役改写） ----------
test('F1 退役改写：拖宽/拖高与尺寸记忆随浮动面板退役——main.js/css 无残留，model 无钳制纯函数', () => {
  // build-56-indextab：索引进两模式侧栏 tab 后尺寸/摆位由宿主容器 flex 决定——
  // siWireResize/siStoredSize/SI_KEY 记忆键与 css grip 规则整体清场（主守卫在 indextab.test.js）
  assert.ok(!mainSrc.includes('siWireResize'), '拖宽高接线已退役');
  assert.ok(!mainSrc.includes('siStoredSize'), '记忆尺寸读取入口已退役');
  assert.ok(!mainSrc.includes('siEnsureDom'), '浮动面板建立入口已退役');
  assert.ok(!mainSrc.includes("wuzhen:siW") && !mainSrc.includes("wuzhen:siH"), '尺寸记忆键已退役');
  assert.ok(!cssSrc.includes('.si-grip-x') && !cssSrc.includes('.si-grip-y'), 'grip 样式已退役');
  // 拖拽纪律不随退役消失：侧栏拖宽（rsb-grip）仍是 Pointer Events + setPointerCapture
  assert.match(mainSrc, /grip\.setPointerCapture\(e\.pointerId\)/, 'rsb-grip 拖宽捕获指针');
  assert.ok(!/mousemove/.test(mainSrc.slice(mainSrc.indexOf('function wireRsbResize'), mainSrc.indexOf('function wireRsbSwipe'))), 'rsb-grip 禁 mousemove 混用');
});

// ---------- F2：层级折叠 ----------
test('F2 filterCollapsedRows：收起父隐藏其范围覆盖的全部后代（递归）；兄弟子树不受累；折叠行自身可见', () => {
  const mk = (id, start, end, depth, level = 0) => ({ seg: { i: 0, tag: { id, name: id, ...(level ? { level } : {}) } }, start, end, depth });
  // 与 tests/tag-hier.test.js 同构的时间序（=先序）行表
  const rows = [
    mk('s1', 0, 64, 0),   // A
    mk('s2', 16, 40, 1),  // A1（s1 的子行）
    mk('s3', 20, 30, 2),  // A1a（s2 的子行——递归后代）
    mk('s4', 50, 60, 1),  // A2（s1 的子行，L2 回落）
    mk('s5', 64, 96, 0),  // B（s1 的兄弟）
    mk('s6', 70, 90, 1),  // B1（s5 的子行）
  ];
  const flags = (list) => list.map(r => r.hidden);
  // 空折叠集：缺省全展开
  assert.deepEqual(flags(filterCollapsedRows(rows, new Set())), [false, false, false, false, false, false]);
  assert.deepEqual(flags(filterCollapsedRows(rows, null)), [false, false, false, false, false, false], 'null 折叠集=全展开');
  // 收起 s1：其全部后代（s2/s3/s4，含递归孙代 s3）隐藏；自身与兄弟子树（s5/s6）可见
  assert.deepEqual(flags(filterCollapsedRows(rows, new Set(['s1']))), [false, true, true, true, false, false],
    '收起 A → A1/A1a/A2 全藏，B 子树不受累');
  // 收起 s2：仅直接+更深后代（s3）隐藏
  assert.deepEqual(flags(filterCollapsedRows(rows, new Set(['s2']))), [false, false, true, false, false, false],
    '收起 A1 → 只藏 A1a');
  // 同时收起 s1+s2：s2 虽自身折叠但已被 s1 遮蔽（hidden）；展开语义不越过被遮蔽的父级
  assert.deepEqual(flags(filterCollapsedRows(rows, new Set(['s1', 's2']))), [false, true, true, true, false, false],
    '父级折叠优先：子级折叠集在父级展开前不生效面');
  // 折叠行自身永不 hidden（它是 ▸ 钮面），深层折叠（s6 叶）=无后代可藏=无变化
  assert.deepEqual(flags(filterCollapsedRows(rows, new Set(['s6']))), [false, false, false, false, false, false],
    '叶行折叠=无操作');
  // 入参不被改写；同序附加 hidden
  const out = filterCollapsedRows(rows, new Set(['s1']));
  assert.deepEqual(out.map(r => r.seg.tag.id), ['s1', 's2', 's3', 's4', 's5', 's6'], '同序输出');
  assert.deepEqual(filterCollapsedRows(null, new Set(['x'])) ?? [], [], 'null 行表 → 空数组');
});

test('F2 filterCollapsedRows 与 nestSegmentsByLevel 串联：真实现场（跨层段→嵌套→折叠过滤）', () => {
  const s = (id, name, start, end, level) => ({ i: 0, tag: { id, name, ...(level ? { level } : {}) }, start, end });
  const rows = nestSegmentsByLevel([
    s('a', '第一段', 0, 64, 0), s('a1', 'A1', 16, 40, 1), s('a1a', 'A1a', 20, 30, 2),
    s('b', '第二段', 64, 96, 0), s('b1', 'B1', 70, 90, 1),
  ]);
  const vis = filterCollapsedRows(rows, new Set(['a'])).filter(r => !r.hidden);
  assert.deepEqual(vis.map(r => r.seg.tag.id), ['a', 'b', 'b1'],
    '收起第一段 → 仅其自身与第二段子树可见（父行后紧跟可见子行=深度优先）');
});

test('F2 静态：折叠集状态、有子行判定（先过滤防钮面丢失）、缩进呈示、钮面一位两用、小节格收敛到底层行', () => {
  // siState 双集：expanded=小节格展开（底层行，缺省收起，原语义）；collapsed=层级折叠（缺省全展开）。
  // build-56-indextab 改写：浮动面板避让字段（baseHeight/hCompressed）随退役移除，折叠集形状不变。
  assert.match(mainSrc, /const siState = \{ root: null, list: null, ph: null, rows: \[\], expanded: new Set\(\), collapsed: new Set\(\) \};/,
    'siState 双集在（expanded 小节格 / collapsed 层级折叠；build-56 起单挂载点 root/list/ph）');
  assert.match(mainSrc, /const hasKids = rows\.map\(\(r, i\) => !!rows\[i \+ 1\] && rows\[i \+ 1\]\.depth === r\.depth \+ 1\);/,
    '有子行判定=全量行序中下一行 depth 为本行+1（先序）');
  assert.match(mainSrc, /const visible = M\.filterCollapsedRows\(rows, siState\.collapsed\);/, '折叠过滤走纯函数');
  assert.match(mainSrc, /if \(visible\[i\]\.hidden\) return;/, '被遮蔽后代行不渲染');
  // 行渲染区（renderSegIndexPanel..siSeek）静态断言
  const i0 = mainSrc.indexOf('function renderSegIndexPanel');
  const i1 = mainSrc.indexOf('function siSeek');
  assert.ok(i0 > 0 && i1 > i0, 'renderSegIndexPanel 定位到');
  const si = mainSrc.slice(i0, i1);
  assert.match(si, /const indent = 8 \+ depth \* 16;/, '层级缩进（每层 16px）');
  assert.match(si, /title: shut \? '展开子区域' : '收起子区域', 'aria-expanded': String\(!shut\)/,
    '非底层行钮=层级折叠（▸/▾ 接活 + aria-expanded）');
  assert.match(si, /if \(shut\) siState\.collapsed\.delete\(s\.tag\.id\); else siState\.collapsed\.add\(s\.tag\.id\)/,
    '钮点击改折叠集并重渲染');
  assert.match(si, /if \(kids \|\| !open \|\| !bars\) return;/, '小节格仅底层行展开（非底层行钮位让给层级折叠）');
  assert.match(si, /aria-disabled/, '底层行无标注=禁用占位（保持行首对齐）');
  assert.match(si, /siSeek\(s\.start\)/, '行点击跳转播放头语义不变');
  assert.match(si, /showContextMenu\(segMenuItems\(s\.tag\.id\)/, '「…」菜单不变（segMenuItems 同源）');
  // 行点击守卫同时放行层级钮与小节格钮（同类名 si-tw）
  assert.match(si, /e\.target\.closest\('\.si-tw'\)/, '钮区点击不触发行跳转');
});

// ---------- F3：导出菜单遮挡修复 ----------
// build-71-iomenu 改写注明：菜单本体自 #export-dd 内联迁出为 #app 级共享 #io-menu（两视图
// 共用同一组件），fixed + z-index 契约随迁到 #io-menu 选择器，断言语义不变
test('F3 静态：io-menu（原 export-dd 菜单）fixed + z-index 200（高于索引面板 70/弹窗 150）+ 打开时摆位 + 横滚/resize 收起', () => {
  assert.match(cssSrc, /#io-menu\{position:fixed;z-index:200\}/, 'fixed + z-index 200（脱离顶栏裁剪）');
  // 打开时按按钮视口坐标摆位（右对齐按钮、top=按钮底+4px）——摆位算术抽纯函数
  assert.match(mainSrc, /const pos = M\.placeDropdownBelow\(r, window\.innerWidth \|\| 0\);/, '摆位走 placeDropdownBelow');
  assert.match(mainSrc, /menu\.style\.top = pos\.top \+ 'px';/, 'top=按钮底+4px');
  assert.match(mainSrc, /menu\.style\.right = pos\.right \+ 'px';/, '右对齐按钮（视口钳制在纯函数内）');
  assert.match(mainSrc, /menu\.style\.left = 'auto';/, '右锚定（left 让位）');
  // 取简单者：顶栏横滚（fixed 菜单不随按钮走）与窗口 resize 直接收起
  // build-66-mobileux F2 改写注明：横滚容器自 #topbar 移到滚动段 #topbar-scroll（#ui-mode-seg
  // 移出滚动流为固定段），收起监听随容器搬家，语义不变
  assert.match(mainSrc, /\$\('topbar-scroll'\)\.addEventListener\('scroll', \(\) => \{ menu\.hidden = true; \}/, '顶栏横滚收起');
  assert.match(mainSrc, /window\.addEventListener\('resize', \(\) => \{ menu\.hidden = true; \}\);/, '窗口 resize 收起');
  // 单弹窗不变式保持（开本下拉前先关已开弹层——原行原样）
  assert.match(mainSrc, /if \(menu\.hidden\) closeContextMenu\(\); \/\/ 单弹窗不变式（F2）：开本下拉前先关已开的弹层/);
});

test('F3 placeDropdownBelow 行为：右对齐按钮、top=底+4px、右缘钳 ≥8px', () => {
  assert.deepEqual(placeDropdownBelow({ bottom: 48, right: 980 }, 1024), { top: 52, right: 44 },
    '常规：top=按钮底+4，right=视口宽-按钮右缘');
  assert.deepEqual(placeDropdownBelow({ bottom: 48, right: 1020 }, 1024), { top: 52, right: 8 },
    '按钮贴视口右缘 → 钳 ≥8px');
  assert.deepEqual(placeDropdownBelow({ bottom: 48, right: 40 }, 320), { top: 52, right: 280 },
    '窄视口照常右锚定（菜单 min-width 200 有左侧余量）');
});

test('F3 同批排查：index.html 各 .dropdown 均已有 fixed 规则（无残余 absolute 同病）', () => {
  // build-55-uiclean P3 改写（原「恰两处」）：新增 stage-tools「显示…」下拉 #view-dd，
  // 与 export-dd/auto-seg-dd 同构（fixed 摆位 + placeDropdownBelow），故恰三处且各有 fixed 规则
  const dds = htmlSrc.match(/class="dropdown"/g) || [];
  assert.equal(dds.length, 3, '下拉共三处：export-dd（顶栏）/ auto-seg-dd（音乐工具条）/ view-dd（stage-tools 显示…）');
  assert.match(cssSrc, /#music-toolbar \.dd-menu\{position:fixed\}/, 'auto-seg-dd：build-44 既有 fixed 规则在');
  // build-71-iomenu 改写注明：#export-dd .dd-menu → #app 级 #io-menu（两视图共用），fixed 规则随迁
  assert.match(cssSrc, /#io-menu\{position:fixed;z-index:200\}/, 'io-menu（原 export-dd 菜单）：build-50 fixed 规则随迁在');
  assert.match(cssSrc, /#view-dd \.dd-menu\{position:fixed;z-index:200\}/, 'view-dd：build-55 同构 fixed 规则在');
  // 其余弹层（context menu / lib-card menu / tag popover）均为 body 挂载 fixed（ui.js/timeline.js）
  assert.match(cssSrc, /\.tl-tag-pop\{position:fixed;z-index:150/, '标记编辑 popover=fixed z150（无裁剪问题）');
});
