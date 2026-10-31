// build-65-mobilepb：移动端播放条重排——主按钮触屏热区 + 双行布局 node 单测。
// 覆盖面（375 真机实测——行 1 全可见、44px 热区命中、双行换行实摆——由主会话浏览器探针
// 覆盖，此处锁机器面）：
//   S1 结构静态断言（index.html）：#pb-row2 行 2 容器包住循环/节拍器、行 1 元素序完整、
//      「速度/循环/节拍器」文字包 .pb-txt（移动端隐藏单位）、id 与 title 接线零迁移。
//   S2 CSS 静态断言（style.css）：
//      F1 主按钮热区（移动 #pb-play/#pb-stop min 44、#pb-prev/#pb-next min 40、flex:none
//          防收缩压回 18px；桌面 .btn.round 34px 与 #playbar 基础规则逐字节不变）；
//      F2 双行布局（移动 #playbar flex-wrap + overflow-x 退役——DEFECT-L2-3 旧兜底收敛；
//          #pb-row2 桌面 display:contents / 移动 flex-basis:100% 强制换行 + 仅行 2 横滚；
//          .pb-txt 仅移动端隐藏）；
//      F3 行高联动（移动 :root --pb-h 96px 两行总高覆盖；移动抽屉 bottom:var(--pb-h)
//          同源自适应；toast 底锚随播放条抬高；桌面 44px 根定义原样）。
//   S3 版本：main.js 双处 build-65-mobilepb（__MAIN_BUILD 正则源 + BUILD_TAG 兜底）。
// 既有断言受影响情况：无改写——layout-merge S2b 锁的抽屉锚 `bottom:var(--pb-h)` 原样保留
// （自适应改在 :root 变量值上，不动锚点写法）；无既有断言引用旧 #playbar overflow-x 兜底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');

// 移动断点切片：以行 2 容器规则为锚，回溯最近的移动媒体查询头、前行尾（勿用文件尾查询，
// 同 layout-merge S2b 纪律）
const row2Anchor = css.indexOf('#pb-row2{display:flex');
assert.ok(row2Anchor > 0, '行 2 容器移动规则存在（切片锚）');
const mobStart = css.lastIndexOf('@media (max-width:1023.5px)', row2Anchor);
const mobEnd = css.indexOf('\n}', row2Anchor);
const mob = css.slice(mobStart, mobEnd);

// ---------- S1 结构静态断言（index.html） ----------
test('S1a 行 2 容器：#pb-row2 包住循环/节拍器两 label，id 接线零迁移（main.js 按 id 取用）', () => {
  const r2 = html.indexOf('<div id="pb-row2">');
  assert.ok(r2 > 0, '#pb-row2 容器存在');
  const r2End = html.indexOf('</div>', r2);
  const r2blk = html.slice(r2, r2End);
  assert.ok(r2blk.includes('id="pb-loop"'), 'pb-loop 在行 2 容器内');
  assert.ok(r2blk.includes('id="pb-metro"'), 'pb-metro 在行 2 容器内');
  assert.ok(r2blk.indexOf('pb-loop') < r2blk.indexOf('pb-metro'), '循环先于节拍器（行 2 序稳定）');
  // 容器外不再有游离的 pb-loop/pb-metro（防复制粘贴双份）
  const outside = html.slice(0, r2) + html.slice(r2End);
  assert.ok(!outside.includes('id="pb-loop"') && !outside.includes('id="pb-metro"'), '两 checkbox 只出现一次');
});

test('S1b 行 1 主控序：⏮▶⏹⏭+时间+队形名+撑杆+速度 全在 #pb-row2 之前（375 主控行不滚出）', () => {
  const pb = html.indexOf('<div id="playbar">');
  const r2 = html.indexOf('<div id="pb-row2">');
  assert.ok(pb > 0 && r2 > pb, 'playbar 在前、row2 在后');
  const row1 = html.slice(pb, r2);
  for (const id of ['pb-prev', 'pb-play', 'pb-stop', 'pb-next', 'pb-pos', 'pb-speed']) {
    assert.ok(row1.includes(`id="${id}"`), `${id} 在行 1`);
  }
  const seq = ['pb-prev', 'pb-play', 'pb-stop', 'pb-next', 'pb-pos', 'pb-speed']
    .map(id => row1.indexOf(`id="${id}"`));
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b), '行 1 元素序：前跳/播放/停止/后跳/时间/速度');
  assert.ok(row1.includes('class="spacer"'), '撑杆在行 1（速度靠右）');
});

test('S1c 文字包 span：速度/循环/节拍器 三处 .pb-txt（移动端隐藏单位），id 与 title 提示零迁移', () => {
  assert.ok(html.includes('<span class="pb-txt">速度</span>'), '「速度」文字包 .pb-txt');
  assert.ok(html.includes('<span class="pb-txt">循环</span>'), '「循环」文字包 .pb-txt');
  assert.ok(html.includes('<span class="pb-txt">节拍器</span>'), '「节拍器」文字包 .pb-txt');
  // select 保留在速度 label 内（title 提示 + change 接线按 id 不变）
  const speedLab = html.slice(html.indexOf('title="播放速度"'), html.indexOf('</label>', html.indexOf('title="播放速度"')));
  assert.ok(speedLab.includes('id="pb-speed"'), 'pb-speed select 留在速度 label 内');
  assert.ok(html.includes('title="循环当前队形段（播放到段尾自动回绕）"'), '循环 toggle 钮 title 保留（build-66-mobileux F1 改写注明：label→图标按钮，title 语义沿用并补回绕说明）');
  assert.ok(html.includes('title="节拍器（播放时每拍一声，小节首拍高音）"'), '节拍器 toggle 钮 title 保留');
  // .pb-txt 恰好三处（速度/循环/节拍器），不扩散到其他控件
  assert.equal((html.match(/class="pb-txt"/g) || []).length, 3, '.pb-txt 恰好 3 处');
});

// ---------- S2 CSS 静态断言：F1 主按钮触屏热区 ----------
test('F1a 移动端主按钮热区：pb-play/pb-stop min 44×44、pb-prev/pb-next min 40×40，flex:none 防收缩', () => {
  assert.ok(mob.includes('#pb-play,#pb-stop{min-width:44px;min-height:44px;flex:none}'),
    '主播放钮/停止钮 44px 底线（.btn.round 34px 被 min-* 抬高）');
  assert.ok(mob.includes('#pb-prev,#pb-next{min-width:40px;min-height:40px'),
    '前后跳钮 ≥40px');
  assert.ok(/#pb-prev,#pb-next\{[^}]*align-items:center/.test(mob), '前后跳钮 min-height 下内容垂直居中');
  // 44/40 规则必须在移动断点内（切片锚已保证），且规则不在断点外泄漏
  const head = css.slice(0, mobStart);
  assert.ok(!head.includes('min-width:44px;min-height:44px'), '44px 规则不泄漏到移动断点之前（桌面零变化）');
});

test('F1b 桌面零变化：.btn.round 34px、#playbar 基础规则逐字节原样', () => {
  assert.ok(css.includes('.btn.round{border-radius:50%;width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center}'),
    '.btn.round 基础尺寸未动（桌面 34px）');
  assert.ok(css.includes('#playbar{height:var(--pb-h);display:flex;align-items:center;gap:8px;padding:0 10px}'),
    '#playbar 桌面基础规则逐字节不变');
  assert.ok(css.includes('--rad:8px; --tb-h:48px; --pb-h:44px;'), '根变量桌面 --pb-h:44px 原样');
});

// ---------- S2 CSS 静态断言：F2 双行布局 ----------
test('F2a 行 2 容器双形态：桌面 display:contents（label 直参 playbar flex，零变化）；移动 flex-basis:100% 强制换行+仅行 2 横滚', () => {
  const dAnchor = css.indexOf('#pb-row2{display:contents}');
  assert.ok(dAnchor > 0, '桌面 display:contents 规则存在');
  assert.ok(css.lastIndexOf('@media', dAnchor) === -1 ||
    css.slice(css.lastIndexOf('@media', dAnchor), dAnchor).includes('}'),
    'display:contents 不在媒体查询内（全局桌面形态）');
  assert.ok(mob.includes('#pb-row2{display:flex;flex:0 0 100%'), '移动行 2 满幅强制换行');
  assert.ok(/#pb-row2\{[^}]*min-height:44px/.test(mob), '行 2 触控行高 44');
  assert.ok(/#pb-row2\{[^}]*overflow-x:auto/.test(mob), '仅行 2 允许内部横滚');
});

test('F2b 整体 overflow-x 退役：移动 #playbar 规则 flex-wrap 换行、无 overflow-x（DEFECT-L2-3 旧兜底收敛）', () => {
  const pbRule = mob.match(/#playbar\{[^}]*\}/);
  assert.ok(pbRule, '移动 #playbar 规则存在');
  assert.ok(pbRule[0].includes('flex-wrap:wrap'), '移动 flex-wrap 换行');
  assert.ok(pbRule[0].includes('align-content:center'), '两行垂直居中');
  assert.ok(!pbRule[0].includes('overflow-x'), '#playbar 整体 overflow-x 移除（行 1 不可滚）');
  assert.ok(pbRule[0].includes('#playbar{gap:5px;padding:0 6px'), '旧兜底的 gap/padding 收敛值保留（防回归纪律）');
});

test('F2c label 文字隐藏：.pb-txt 仅移动端 display:none（桌面 span 默认 inline 渲染不变）', () => {
  const txtAnchor = css.indexOf('#playbar .pb-txt{display:none}');
  assert.ok(txtAnchor > 0, '隐藏规则存在');
  assert.ok(txtAnchor > mobStart && txtAnchor < mobEnd, '隐藏规则在移动断点内');
  assert.ok(!/#pb-row2 \.pb-txt\{display:inline/.test(css) && !/\.pb-txt\{display:inline/.test(css),
    '无桌面态 .pb-txt 显式规则（默认 inline，零变化）');
  // build-66-mobileux F1 改写注明：行 2 裸 checkbox → 图标 toggle 按钮，触屏热区规则随之换代
  //（原 input[type=checkbox] 20px 规则退役，40px 底线不低于旧 20px 视觉+44px 行高热区）
  assert.ok(/\.pb-toggle\{min-width:40px;min-height:40px/.test(mob), '行 2 toggle 钮 40px 触屏热区（build-66-mobileux F1）');
});

// ---------- S2 CSS 静态断言：F3 行高与联动 ----------
test('F3a --pb-h 两行总高：移动 :root 96px 后置覆盖 44px 根定义；#playbar 高度与抽屉/toast 锚同源自适应', () => {
  const root96 = css.indexOf(':root{--pb-h:96px}');
  assert.ok(root96 > 0, '移动 96px 覆盖存在');
  assert.ok(root96 > mobStart && root96 < mobEnd, '96px 覆盖在移动断点内');
  assert.ok(root96 > css.indexOf('--pb-h:44px'), '后置覆盖根定义（同特异性源序取胜）');
  // 抽屉锚仍是 var(--pb-h) 写法（layout-merge S2b 已锁存在性，此处锁「同源」自适应语义）
  assert.ok(css.includes('position:fixed;left:0;right:0;bottom:var(--pb-h)'), '移动抽屉 bottom 锚 var(--pb-h) 原样（随 96px 自适应）');
  const toastMob = css.slice(mobStart, css.indexOf('}', css.indexOf('#toasts{bottom:calc(var(--pb-h) + 12px)')));
  assert.ok(css.slice(mobStart, mobEnd).includes('#toasts{bottom:calc(var(--pb-h) + 12px)}'),
    'toast 底锚移动端随 --pb-h 抬高（96px 播放条不盖提示）');
  assert.ok(css.includes('#toasts{position:fixed;bottom:70px'), '桌面 toast 70px 原样');
});
test('F3b 两行总高算术：44（行 1）+4（row-gap）+44（行 2 min-height）≤ 96（--pb-h）', () => {
  const row1 = Math.max(
    Number(mob.match(/#pb-play,#pb-stop\{min-width:44px;min-height:(\d+)/)?.[1] || 0),
    Number(mob.match(/#pb-prev,#pb-next\{min-width:40px;min-height:(\d+)/)?.[1] || 0));
  const row2 = Number(mob.match(/#pb-row2\{[^}]*min-height:(\d+)/)?.[1] || 0);
  const gap = Number(mob.match(/row-gap:(\d+)/)?.[1] || 0);
  const pbH = Number(css.match(/:root\{--pb-h:(\d+)px\}/)?.[1] || 0);
  assert.ok(row1 === 44 && row2 === 44, `两行行高 44/44（实测 ${row1}/${row2}）`);
  assert.ok(row1 + gap + row2 <= pbH, `两行总高 ${row1}+${gap}+${row2} ≤ --pb-h ${pbH}（撑满不溢出）`);
  assert.ok(pbH >= 90 && pbH <= 100, `--pb-h ≈96 两行总高档位（实测 ${pbH}）`);
});

// ---------- S3 版本 ----------
// build-91-varispeed 改写注明：build 号随版本推进（原 build-71-iomenu），断言语义不变（双处 bump）
test('S3 build 双处 bump：__MAIN_BUILD 与 BUILD_TAG 兜底均 build-91-varispeed（build-single/sw 缓存名源）', () => {
  assert.ok(mainSrc.includes("window.__MAIN_BUILD = 'build-91-varispeed'"), 'main.js:__MAIN_BUILD = build-91-varispeed');
  assert.ok(mainSrc.includes("? window.__MAIN_BUILD : 'build-91-varispeed'"), 'main.js:BUILD_TAG 兜底 build-91-varispeed');
  assert.ok(!mainSrc.includes('build-63-stageview2\';') || mainSrc.indexOf('build-63-stageview2') > 1e5,
    '旧版本号不再作为版本标记出现（历史注释不受限）');
});
