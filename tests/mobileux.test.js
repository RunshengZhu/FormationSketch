// build-66-mobileux：移动端三优化——F1 循环/节拍器语义化、F2 模式切换常驻、F3 缩略图补缺。
// 覆盖面（375 真机实测——toggle 钮可辨识可点、模式切换首屏可见、观众区舞者入画——由主会话
// 浏览器探针覆盖，此处锁机器面）：
//   S1 F1 静态断言：#pb-loop/#pb-metro 裸 checkbox → 图标 toggle 按钮（.pb-toggle 类 +
//      aria-pressed 状态源 + data-icon + title/aria-label），桌面 .pb-txt 文字保留、store 接线
//      换线零残留（setPbToggle/pbLoopOn/pbMetroOn；无 .checked 读取残留）；CSS 热区 40px。
//   S2 F2 静态断言：顶栏两段结构——#topbar-scroll 滚动段包住其余工具（横滚兜底随迁），
//      #ui-mode-seg 固定段 flex:none 在滚动段之后（375 首屏恒可见）；main.js 横滚收起监听随容器搬家。
//   S3 F3 行为断言（纯函数，node 可测）：thumbBoxOf = stageBounds ∪ 全队形舞者包络(0.5m)——
//      全在域内 → =stageBounds（舞台观感不缩水）；观众区/后台深处舞者 → bbox 扩展入画；
//      fitBoundsView 同 fitView 数学期；EditStrip.thumbSize 按最终 bbox 反推纵横比 + 版本键缓存。
//   S4 版本：main.js 双处 build 号（build-67-mobilestage 起——build-67-mobilestage 改写注明）。
// 既有断言改写情况（均注明在原位）：indexux F3（横滚收起监听 → #topbar-scroll）、
// manual3 F4（横滚兜底规则 → #topbar-scroll）、mobilepb S3（build 号推进）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditStrip, thumbBoxOf, fitBoundsView } from '../js/timeline.js';
import { stageBounds } from '../js/stage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');

// 测试场地：首队形缺省 4:3（16×12）+ 后台 1 + 候场 2 → stageBounds {x0:-2,y0:-1,x1:18,y1:13}
const STAGE = { widthM: 16, depthM: 12, backstageM: 1, wingM: 2 };
const proj = formations => ({ stage: { ...STAGE }, formations });

// ---------- S1 F1：循环/节拍器 toggle 按钮结构与接线 ----------
test('S1a F1 结构：#pb-loop/#pb-metro 为 .pb-toggle 图标按钮（aria-pressed 状态源 + title + data-icon）', () => {
  for (const [id, icon, label] of [['pb-loop', 'loop', '循环'], ['pb-metro', 'metro', '节拍器']]) {
    const open = html.indexOf(`<button id="${id}" `);
    assert.ok(open > 0, `#${id} 按钮存在`);
    const close = html.indexOf('</button>', open);
    const blk = html.slice(open, close);
    const m = blk.match(new RegExp(`^<button id="${id}" class="([^\\"]*)" aria-pressed="false" title="([^\\"]*)">`));
    assert.ok(m, `#${id} 类含 btn ghost pb-toggle + aria-pressed 起始态 false + title`);
    assert.ok(m[1].includes('pb-toggle') && m[1].includes('btn') && m[1].includes('ghost'), `#${id} 类含 btn ghost pb-toggle（选中态走 .toggled-on accent 高亮）`);
    assert.ok(m[2].includes(label), `#${id} title 含「${label}」（移动端裸图标可辨识）`);
    assert.ok(blk.includes(`data-icon="${icon}"`), `#${id} 图标 data-icon=${icon}（机器可读）`);
    assert.ok(blk.includes('aria-hidden="true"'), `#${id} 装饰图标 aria-hidden（语义由 title 兜底）`);
  }
  // 行 2 容器契约保持：两钮仍在 #pb-row2 内且循环先于节拍器
  const r2 = html.indexOf('<div id="pb-row2">');
  const r2End = html.indexOf('</div>', r2);
  const r2blk = html.slice(r2, r2End);
  assert.ok(r2blk.includes('id="pb-loop"') && r2blk.includes('id="pb-metro"'), '两 toggle 钮在行 2 容器内');
  assert.ok(r2blk.indexOf('pb-loop') < r2blk.indexOf('pb-metro'), '循环先于节拍器（序稳定）');
  // 旧 checkbox 退役干净：全文档无 pb-loop/pb-metro 的 input checkbox
  assert.ok(!/<input[^>]*id="pb-(loop|metro)"/.test(html), '裸 checkbox 已退役（不再有 input#pb-loop/#pb-metro）');
});

test('S1b F1 桌面文字保留：.pb-txt 三处不减（速度/循环/节拍器，桌面渲染语义不变）', () => {
  assert.ok(html.includes('<span class="pb-txt">速度</span>'), '「速度」文字包保留');
  assert.ok(html.includes('<span class="pb-txt">循环</span>'), '「循环」文字包保留（桌面图标+文字）');
  assert.ok(html.includes('<span class="pb-txt">节拍器</span>'), '「节拍器」文字包保留（桌面图标+文字）');
  assert.equal((html.match(/class="pb-txt"/g) || []).length, 3, '.pb-txt 恰好 3 处');
});

test('S1c F1 接线换线零残留：setPbToggle/pbLoopOn/pbMetroOn 上岗，无 .checked 读取残留；功能链不变', () => {
  assert.match(mainSrc, /function setPbToggle\(id, on\) \{/, 'setPbToggle（aria-pressed + .toggled-on 同步）');
  assert.match(mainSrc, /b\.classList\.toggle\('toggled-on', !!on\)/, '选中态 .toggled-on accent 高亮由类驱动');
  assert.match(mainSrc, /const pbLoopOn = \(\) => \$\('pb-loop'\)\?\.getAttribute\('aria-pressed'\) === 'true';/, '循环态读 aria-pressed');
  assert.match(mainSrc, /const pbMetroOn = \(\) => \$\('pb-metro'\)\?\.getAttribute\('aria-pressed'\) === 'true';/, '节拍器态读 aria-pressed');
  // 事件接线：click 翻转 + 既有功能链（updateLoop / store.mutate metronome）
  assert.match(mainSrc, /\$\('pb-loop'\)\.addEventListener\('click', \(\) => \{ setPbToggle\('pb-loop', !pbLoopOn\(\)\); updateLoop\(\); \}\);/, '循环钮 click 翻转并刷新循环区间');
  assert.match(mainSrc, /\$\('pb-metro'\)\.addEventListener\('click', \(\) => \{ setPbToggle\('pb-metro', !pbMetroOn\(\)\); store\.mutate\(p => \{ p\.timeline\.metronome = pbMetroOn\(\); \}, null\); \}\);/, '节拍器钮 click 翻转并写 store');
  // 渲染回写（播放/切歌后的状态刷新链）：store → aria-pressed
  assert.match(mainSrc, /setPbToggle\('pb-metro', !!p\.timeline\.metronome\);/, 'render 按 store 回写节拍器态');
  // 旧 .checked 读取点零残留（6 处全部换线）
  assert.ok(!/\$\('pb-loop'\)\??\.checked/.test(mainSrc), 'pb-loop 无 .checked 残留');
  assert.ok(!/getElementById\('pb-loop'\)\.checked/.test(mainSrc), 'pb-loop 无 getElementById().checked 残留');
  assert.ok(!/\$\('pb-metro'\)\.checked\s*=/.test(mainSrc), 'pb-metro 无 .checked 赋值残留');
  // 换线覆盖计数：pbLoopOn 读取点（定义行除外）≥5（播放帧/时间选区/updateLoop/syncLoopAfterBlockEdit/stepFormation）
  const reads = (mainSrc.match(/pbLoopOn\(\)/g) || []).length;
  assert.ok(reads >= 6, `pbLoopOn 调用 ≥6 处（定义+点击+5 读取点，实测 ${reads}）`);
});

test('S1d F1 CSS：.pb-toggle 桌面基线 + 移动 40px 触屏热区（原 checkbox 20px 规则退役）', () => {
  assert.match(css, /\.pb-toggle\{gap:4px;flex:none\}/, '桌面基线（图标+文字 gap，flex:none 防压缩）');
  const anchor = css.indexOf('.pb-toggle{min-width:40px');
  assert.ok(anchor > 0, '移动热区规则存在');
  const mobStart = css.lastIndexOf('@media (max-width:1023.5px)', anchor);
  assert.ok(mobStart > 0, '热区规则在移动断点内');
  assert.ok(!css.includes('#pb-row2 input[type=checkbox]'), '旧 checkbox 20px 规则退役');
});

// ---------- S2 F2：顶栏两段结构（模式切换常驻） ----------
test('S2a F2 结构：#topbar-scroll 滚动段包住其余工具，#ui-mode-seg 固定段在滚动段之后（375 首屏恒可见）', () => {
  const tb = html.indexOf('<header id="topbar">');
  const tbEnd = html.indexOf('</header>', tb);
  const blk = html.slice(tb, tbEnd);
  const scrollOpen = blk.indexOf('<div id="topbar-scroll">');
  const scrollClose = blk.indexOf('<!-- /#topbar-scroll -->');
  const seg = blk.indexOf('id="ui-mode-seg"');
  assert.ok(scrollOpen > 0, '滚动段容器存在');
  assert.ok(scrollClose > scrollOpen, '滚动段有闭合注释锚');
  assert.ok(seg > scrollClose, '#ui-mode-seg 在滚动段之后（固定段，DOM 上移出滚动流）');
  // 滚动段成员完整：返回/名册/说明书/撤销/重做/导出全在滚动流内（可达性照旧）
  for (const id of ['btn-back', 'proj-title', 'btn-theme', 'btn-roster', 'btn-manual-open', 'btn-undo', 'btn-redo', 'export-dd']) {
    const at = blk.indexOf(`id="${id}"`);
    assert.ok(at > scrollOpen && at < scrollClose, `${id} 在滚动段内`);
  }
  assert.ok(seg > tb && seg < tbEnd && !blk.slice(scrollClose, seg).includes('<div id="topbar-scroll"'), '固定段是 topbar 直接子元素（不被再包一层滚动容器）');
});

test('S2b F2 CSS：固定段 flex:none 契约 + 滚动段桌面同构/移动横滚兜底随迁（C-09a 口径）', () => {
  assert.match(css, /#topbar-scroll\{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px\}/, '桌面滚动段与旧直挂布局同构（无 overflow，单行照旧）');
  assert.match(css, /#ui-mode-seg\{flex:none\}/, '固定段 flex:none 显式契约');
  // 移动横滚兜底在 #topbar-scroll（原 #topbar{overflow-x:auto} 退役）
  const anchor = css.indexOf('#topbar-scroll{overflow-x:auto;scrollbar-width:none}');
  assert.ok(anchor > 0, '滚动段横滚兜底存在');
  const mobStart = css.lastIndexOf('@media (max-width:1023.5px)', anchor);
  assert.ok(mobStart > 0, '横滚兜底在移动断点内');
  assert.ok(!/#topbar\{overflow-x:auto/.test(css), '#topbar 自身不再横滚（固定段语义成立的前提）');
  assert.match(css, /#topbar-scroll\{gap:4px\}/, '移动滚动段间距沿用紧凑值');
});

test('S2c F2 接线：导出菜单横滚收起监听随容器搬家到 #topbar-scroll', () => {
  assert.match(mainSrc, /\$\('topbar-scroll'\)\.addEventListener\('scroll', \(\) => \{ menu\.hidden = true; \}, \{ passive: true \}\);/, '横滚收起监听在滚动段上');
  assert.ok(!mainSrc.includes("$('topbar').addEventListener('scroll'"), '#topbar 旧监听零残留');
});

// ---------- S3 F3：缩略图视口含全队形舞者包络（纯函数） ----------
test('S3a thumbBoxOf：全舞者在舞台域内 → bbox=stageBounds（舞台观感不缩水）', () => {
  const p = proj([
    { id: 'f1', positions: { a: { x: 0, y: 0 }, b: { x: 16, y: 12 } } },   // 舞台两角
    { id: 'f2', positions: { a: { x: 8, y: 6 } } },                        // 台中
  ]);
  assert.deepEqual(thumbBoxOf(p), stageBounds(p.stage), '全在域内 → bbox 恰为 stageBounds（下限语义）');
});

test('S3b thumbBoxOf：观众区舞者（y>depthM）→ bbox 纵向扩展入画；后台深处（y<0）→ y0 扩展', () => {
  const sb = stageBounds({ ...STAGE });
  const pAud = proj([{ id: 'f1', positions: { a: { x: 8, y: 14.6 } } }]); // 观众区（depth 12 之外 2.6m）
  const boxAud = thumbBoxOf(pAud);
  assert.equal(boxAud.y1, 15.1, 'y1=14.6+0.5（外扩 0.5m 入画）');
  assert.equal(boxAud.y0, sb.y0, 'y0 不越 stageBounds 下限');
  assert.deepEqual([boxAud.x0, boxAud.x1], [sb.x0, sb.x1], 'x 向不因台内 x 变（仍在舞台横向域内）');

  const pBack = proj([{ id: 'f1', positions: { a: { x: 3, y: -2.5 } } }]); // 后台深处
  const boxBack = thumbBoxOf(pBack);
  assert.equal(boxBack.y0, -3, 'y0=-2.5-0.5 入画');
  assert.equal(boxBack.y1, sb.y1, 'y1 不越下限');

  // 多队形取并集：任一队形的越界舞者都计入（同一 bbox，缩略图间可比对位置）
  const pMulti = proj([
    { id: 'f1', positions: { a: { x: 0, y: 0 } } },
    { id: 'f2', positions: { a: { x: 8, y: 16 } } },
  ]);
  assert.equal(thumbBoxOf(pMulti).y1, 16.5, '跨队形并集取最远舞者');
});

test('S3c fitBoundsView：fitView 同式数学（pad 内缩/双轴 min/居中）+ 退化尺寸回退正值', () => {
  const v = fitBoundsView(120, 96, { x0: -2, y0: -1, x1: 18, y1: 14 }, 4);
  // scale = min((120-8)/20, (96-8)/15) = min(5.6, 5.866) = 5.6
  assert.equal(v.scale, 5.6, '双轴 min 比例');
  assert.equal(v.ox, (120 - 20 * 5.6) / 2 - (-2) * 5.6, 'ox 居中 + bbox 原点回移');
  assert.equal(v.oy, (96 - 15 * 5.6) / 2 - (-1) * 5.6, 'oy 居中 + bbox 原点回移');
  const deg = fitBoundsView(0, 0, { x0: 0, y0: 0, x1: 10, y1: 10 }, 4);
  assert.ok(Number.isFinite(deg.scale) && deg.scale > 0, '退化画布回退保守正值（不产负 scale）');
});

test('S3d EditStrip.thumbSize：纵横比按最终 bbox 反推（观众区舞者 → 变扁仍 96 档）+ 绘制走共享视口', () => {
  const strip = new EditStrip({ clientWidth: 164, addEventListener() {} }, {});
  const inSide = proj([{ id: 'f1', positions: { a: { x: 8, y: 6 } } }]);
  const s1 = strip.thumbSize(inSide); // bbox=stageBounds：bw=20 bh=14 → w=min(138, 96*20/14)=137 h=96
  assert.equal(s1.w, 137);
  assert.equal(s1.h, 96);

  const withAud = proj([{ id: 'f1', positions: { a: { x: 8, y: 14.6 } } }]);
  const s2 = strip.thumbSize(withAud); // bh=16.1 → w=min(138, 96*20/16.1)=119 h=96（不同宽高比自动适配）
  assert.equal(s2.w, 119);
  assert.equal(s2.h, 96);
  assert.ok(s2.w < s1.w, '纵向扩展 → 宽度收窄（纵横比跟随 bbox，舞者不缺位）');

  // 绘制链静态：drawThumbs 一次计算共享视口并传给 drawScene（全 chip 同一 bbox）
  assert.match(tlSrc, /const view = fitBoundsView\(w, h, this\.thumbBox\(p\), 4\);/, '共享视口一次计算');
  assert.match(tlSrc, /\{ minimal: true, pad: 4, view, merges: f\.merges \|\| \[\] \}/, 'drawScene 收共享 view（跳过内部 fitView）');
});

test('S3e thumbBox 缓存：版本键命中零重算（同对象），拖舞者/改场地失效重算', () => {
  const strip = new EditStrip({ clientWidth: 164, addEventListener() {} }, {});
  const p = proj([{ id: 'f1', positions: { a: { x: 8, y: 6 } } }]);
  const b1 = strip.thumbBox(p);
  assert.ok(strip.thumbBox(p) === b1, '同签名命中缓存（同对象）');
  // 拖舞者（观众区）→ 失效重算
  p.formations[0].positions.a = { x: 8, y: 14.6 };
  const b2 = strip.thumbBox(p);
  assert.ok(b2 !== b1 && b2.y1 === 15.1, 'positions 变化 → 重算入画');
  // 改场地 → 失效重算（depth 12→20：新 stageBounds y1=21，舞者包络被下限盖过）
  p.stage.depthM = 20;
  const b3 = strip.thumbBox(p);
  assert.ok(b3 !== b2 && b3.y1 === 21, '场地变化 → 重算（新 stageBounds 下限 y1=21）');
});

test('S3f drawThumbs 绘制端到端（stub ctx）：观众区舞者圆心落在缩略图画布内——「缺失」缺陷的绘制面证据', () => {
  const calls = [];
  const ctxStub = new Proxy({}, { get: (t, k) => {
    if (k === 'arc') return (x, y, r) => calls.push([x, y, r]);
    if (k === 'measureText') return () => ({ width: 10 });
    return typeof k === 'string' ? (() => {}) : undefined;
  }, set: () => true });
  const mkCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctxStub });
  const chips = [mkCanvas(), mkCanvas()];
  const container = {
    clientWidth: 164, addEventListener() {}, innerHTML: '',
    querySelectorAll: () => chips.map(cv => ({ querySelector: () => cv })),
    append() {}, scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 100 }),
  };
  const savedWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 }; // drawThumbs 读 dpr（node 无 window）
  try {
    const p = {
      stage: { ...STAGE },
      dancers: [{ id: 'a', color: '#f00', short: 'A' }, { id: 'b', color: '#00f', short: 'B' }],
      formations: [
        { id: 'f1', name: 'F1', merges: [], positions: { a: { x: 8, y: 3, facing: 0 }, b: { x: 8, y: 14.6, facing: 0 } } }, // b=观众区
        { id: 'f2', name: 'F2', merges: [], positions: { a: { x: 3, y: 3, facing: 0 }, b: { x: 5, y: 5, facing: 0 } } },
      ],
    };
    const strip = new EditStrip(container, { getProject: () => p, getIndex: () => 0 });
    strip.drawThumbs();
    const { w, h } = strip.thumbSize(p);
    const dancerCircles = calls.filter(([x, y, r]) => r > 2); // 舞者主圆（r=DANCER_R×scale，其余 arc 均 ≤2px 角标/虚影）
    assert.ok(dancerCircles.length >= 4, `4 个舞者主圆都有绘制（实测 ${dancerCircles.length}）`);
    for (const [x, y] of dancerCircles.slice(0, 2)) { // chip 1：台内舞者 + 观众区舞者
      assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `舞者圆心 (${x.toFixed(1)},${y.toFixed(1)}) 在画布 ${w}×${h} 内`);
    }
    const audY = dancerCircles[1][1];
    assert.ok(audY > h * 0.7, `观众区舞者呈现在画面下部（y=${audY.toFixed(1)} > 0.7h=${h * 0.7}）——拖出舞台的舞者不再从缩略图消失`);
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
  }
});

// ---------- S4 版本 ----------
// build-91-varispeed 改写注明：build 号随版本推进（原 build-71-iomenu），断言语义不变（双处 bump）
test('S4 build 双处 bump：__MAIN_BUILD 与 BUILD_TAG 兜底均 build-91-varispeed', () => {
  assert.ok(mainSrc.includes("window.__MAIN_BUILD = 'build-91-varispeed'"), 'main.js:__MAIN_BUILD');
  assert.ok(mainSrc.includes("? window.__MAIN_BUILD : 'build-91-varispeed'"), 'main.js:BUILD_TAG 兜底');
});
