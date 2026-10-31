// syncui.test.js —— build-91-varispeed 三合一优化 node 单测（无浏览器依赖）：
//   F1 syncForwardPositions 纯函数：单选/多选/末队形无后续/越界 id/facing 保留/缺位跳过；
//   F2 grip 钳制纯函数：clampStagePaneSize 界内钳制/非法输入 null + 三尺寸记忆键与折叠键独立；
//   F3 标注自适应公式：不同镜头宽/采样率 → 字号图上界内、css 侧随采样率缩放、极窄镜头宽度
//      兜底、覆盖率口径；annot-size.js 为 lab/manual-shots-v5.mjs 的唯一尺寸源（不在打包序）；
//   静态断言：三区 grip / 三尺寸记忆键 / 说明书无「数拍」残留 / 说明书无「上场门」残留。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, syncForwardPositions } from '../js/model.js';
import { selectionMenuSpec, clampStagePaneSize, STAGE_PANE_LIMITS, STAGE_PANE_KEYS } from '../js/main.js';
import { annotSizing, annotCoverageRatio } from '../js/annot-size.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

// ---------- F1：syncForwardPositions ----------
function mkProject(n = 4) {
  const p = createProject({ title: 't', pairs: 3, grouping: 'gender' });
  // 队形 0：全员横排 x=i；队形 1..n-1：全员同一占位（x=0,y=0，facing 逐队形不同）
  const ids = p.dancers.map(d => d.id);
  for (let i = 1; i < n; i++) {
    const f = { id: 'f' + i, name: 'F' + i, positions: {}, merges: [] };
    for (const id of ids) f.positions[id] = { x: 0, y: 0, facing: 90 + i };
    p.formations.push(f);
  }
  const f0 = p.formations[0];
  ids.forEach((id, i) => { f0.positions[id] = { x: i, y: 5, facing: 180 }; });
  return { p, ids };
}

test('F1 syncForwardPositions：单选——只同步该舞者 x/y 到后续全部队形，facing 保留目标队形原值', () => {
  const { p, ids } = mkProject();
  const r = syncForwardPositions(p, 0, [ids[2]]);
  assert.equal(r.dancers, 1);
  assert.equal(r.formations, 3, '后续 3 个队形全写入');
  for (let i = 1; i < 4; i++) {
    const pos = p.formations[i].positions[ids[2]];
    assert.equal(pos.x, 2, `队形 ${i} x 同步`);
    assert.equal(pos.y, 5, `队形 ${i} y 同步`);
    assert.equal(pos.facing, 90 + i, `队形 ${i} facing 保留原值（不被覆盖）`);
  }
});

test('F1 syncForwardPositions：多选=逐舞者同步；返回写入队形数', () => {
  const { p, ids } = mkProject();
  const r = syncForwardPositions(p, 0, [ids[0], ids[1], ids[5 - 1]]);
  assert.equal(r.dancers, 3);
  assert.equal(r.formations, 3);
  for (let i = 1; i < 4; i++) {
    assert.equal(p.formations[i].positions[ids[0]].x, 0);
    assert.equal(p.formations[i].positions[ids[1]].x, 1);
  }
});

test('F1 syncForwardPositions：末队形（无后续）零写入；index 越界安全', () => {
  const { p, ids } = mkProject();
  const before = JSON.stringify(p.formations[3].positions);
  const last = syncForwardPositions(p, 3, [ids[0]]);
  assert.deepEqual(last, { formations: 0, dancers: 1 }, '无后续 → 0 队形');
  assert.equal(JSON.stringify(p.formations[3].positions), before, '数据零变化');
  assert.deepEqual(syncForwardPositions(p, 99, [ids[0]]), { formations: 0, dancers: 0 }, 'index 越界安全');
  assert.deepEqual(syncForwardPositions(p, -1, [ids[0]]), { formations: 0, dancers: 0 });
});

test('F1 syncForwardPositions：越界/缺位 id 忽略（源缺位、后续缺位均不臆造坐标）', () => {
  const { p, ids } = mkProject();
  const r = syncForwardPositions(p, 0, ['nope', ids[0]]);
  assert.equal(r.dancers, 1, '源队形缺位的 id 被过滤');
  // 后续队形移除该舞者 → 跳过不补位（ensureFormationComplete 是入场语义，不在此做）
  delete p.formations[2].positions[ids[0]];
  const r2 = syncForwardPositions(p, 0, [ids[0]]);
  assert.equal(r2.formations, 2, '缺位队形不计入写入数');
  assert.equal(p.formations[2].positions[ids[0]], undefined, '缺位不补');
  assert.deepEqual(syncForwardPositions(p, 0, []), { formations: 0, dancers: 0 }, '空 selection');
});

test('F1 selectionMenuSpec：方向语义——hasLater/hasEarlier 门控「同步后面/前面位置」，缺省双隐藏（旧快照兼容）', () => {
  // 缺省（不传 hasLater/hasEarlier）：既有快照断言零漂移（lane-a/roster 套件不改写的原因）
  assert.ok(!selectionMenuSpec({ count: 1 }).some(i => i.kind === 'syncForward' || i.kind === 'syncBackward'));
  const one = selectionMenuSpec({ count: 1, hasLater: true });
  assert.deepEqual(one.map(i => i.kind), ['facing', 'syncForward', 'removeFromFormation']);
  assert.equal(one[1].label, '同步后面位置');
  assert.equal(one[1].dir, 'forward');
  const many = selectionMenuSpec({ count: 3, hasLater: true, hasEarlier: true });
  const fwd = many.find(i => i.kind === 'syncForward');
  const bwd = many.find(i => i.kind === 'syncBackward');
  assert.equal(fwd.label, '同步后面位置（3 人）');
  assert.equal(fwd.dir, 'forward');
  assert.equal(bwd.label, '同步前面位置（3 人）');
  assert.equal(bwd.dir, 'backward');
  // 方向次序：后面（forward）在前、前面（backward）在后，均位于移出队形之前
  assert.ok(many.findIndex(i => i.kind === 'syncForward') < many.findIndex(i => i.kind === 'syncBackward'), 'forward 先于 backward');
  assert.ok(many.findIndex(i => i.kind === 'syncBackward') < many.length - 1, '同步项位于移出队形之前');
  // 单向门控：只有 hasEarlier → 仅前面项；双 false → 均不呈示
  const onlyBack = selectionMenuSpec({ count: 2, hasEarlier: true });
  assert.deepEqual(onlyBack.filter(i => i.kind.startsWith('sync')).map(i => i.kind), ['syncBackward']);
  const last = selectionMenuSpec({ count: 2, pairEligible: true, hasLater: false, hasEarlier: false });
  assert.ok(!last.some(i => i.kind === 'syncForward' || i.kind === 'syncBackward'), '首末队形（双 false）不呈示');
});

// ---------- F2：grip 钳制纯函数 + 记忆键 ----------
test('F2 clampStagePaneSize：三区界内钳制（左[120,400]/右[200,400]/底[80,320]），小数取整', () => {
  assert.equal(clampStagePaneSize('left', 100), 120);
  assert.equal(clampStagePaneSize('left', 150.4), 150);
  assert.equal(clampStagePaneSize('left', 999), 400);
  assert.equal(clampStagePaneSize('right', 100), 200, '右列下限 200');
  assert.equal(clampStagePaneSize('right', 300), 300);
  assert.equal(clampStagePaneSize('bottom', 40), 80, '底部下限 80');
  assert.equal(clampStagePaneSize('bottom', 500), 320, '底部上限 320');
});

test('F2 clampStagePaneSize：非法输入 → null（按「无记忆」处理）；未知 kind → null', () => {
  assert.equal(clampStagePaneSize('left', NaN), null);
  assert.equal(clampStagePaneSize('left', 'abc'), null);
  assert.equal(clampStagePaneSize('left', undefined), null);
  assert.equal(clampStagePaneSize('nope', 100), null);
});

test('F2 三尺寸记忆键与 build-56 折叠键独立存储互不覆盖；limits 与键一一对应', () => {
  const mainSrc = read('js/main.js');
  assert.deepEqual(STAGE_PANE_KEYS, { left: 'wuzhen:stageLeftW', right: 'wuzhen:stageRightW', bottom: 'wuzhen:stageBottomH' });
  for (const k of Object.values(STAGE_PANE_KEYS)) {
    assert.ok(mainSrc.includes(`'${k}'`), `main.js 应有记忆键 ${k}`);
    assert.ok(!mainSrc.includes(`'${k}':`), `尺寸键不得混入折叠键表（独立存储）：${k}`);
  }
  assert.deepEqual(Object.keys(STAGE_PANE_LIMITS).sort(), ['bottom', 'left', 'right']);
});

// ---------- F3：标注自适应公式（lab/manual-shots-v5.mjs 的尺寸源） ----------
test('F3 annotSizing：不同镜头宽 → 图上字号恒在 [12,30]，effScale 越大字越大（同刻度不恒定 ×2）', () => {
  const cases = [
    { targetW: 1500, effScale: 1500 / 1280 },  // 全景降采样（overview 等）
    { targetW: 2560, effScale: 2 },            // 原生 2x 全景（不降采样路径）
    { targetW: 1400, effScale: 2 },            // clip-detail 级
    { targetW: 600, effScale: 2 },             // 导出菜单级
  ];
  for (const c of cases) {
    const s = annotSizing(c);
    assert.ok(s.fontImg >= 12 && s.fontImg <= 30, `fontImg=${s.fontImg} 应在 [12,30]`);
    assert.ok(s.css.fontSize >= 8 && s.css.fontSize <= 30, `css=${s.css.fontSize} 可用范围`);
    // 标注/UI 同刻度：图上字号 ≈ 1.25× UI 基准字（12css×effScale）——不再恒定放大 2 倍
    assert.ok(s.fontImg <= 30 * c.effScale + 1e-9, '图上字号不超过 30css 当量');
    assert.ok(s.fontImg >= 12, '图上字号下限 12px（可读性）');
  }
  const wide = annotSizing({ targetW: 1500, effScale: 1500 / 1280 });
  const native = annotSizing({ targetW: 2560, effScale: 2 });
  assert.ok(native.fontImg > wide.fontImg, '采样率越高（原生 2x）图上字号越大——随镜头缩放而非固定值');
});

test('F3 annotSizing：极窄镜头宽度兜底（0.05×targetW 生效）+ 非法输入回退 12', () => {
  const pane = annotSizing({ targetW: 558, effScale: 2 }); // 索引 pane ~279css
  assert.ok(pane.fontImg <= 0.05 * 558 + 1e-9, '窄镜头被宽度项封顶');
  assert.ok(pane.fontImg >= 12, '仍不低于可读下限');
  const bad = annotSizing({ targetW: NaN, effScale: 0 });
  assert.equal(bad.fontImg, 12, '非法输入回退缺省 12');
});

test('F3 annotSizing：箭头受 2×箭头长最小间距约束 + css 换算齐全', () => {
  const s = annotSizing({ targetW: 1500, effScale: 2 });
  assert.equal(s.arrowMinGapImg, s.arrowImg * 2, '最小间距 = 2×箭头长（超短距退化无箭头）');
  for (const k of ['fontSize', 'borderW', 'radius', 'padNear', 'padArrow', 'stroke', 'arrow', 'arrowMinGap']) {
    assert.ok(Number.isFinite(s.css[k]) && s.css[k] > 0, `css.${k} 应为正有限值`);
  }
  assert.ok(s.css.arrow <= 15, 'css 箭头长有界（9px 硬帽在拍摄侧取 min）');
});

test('F3 annotCoverageRatio：标签整块 + 框描边带（周长×borderW）口径；空/非法保守回 1', () => {
  const a = [{ box: { width: 100, height: 50 }, label: { width: 100, height: 30 } }];
  assert.equal(annotCoverageRatio(a, 1000, 1000), 8000 / 1e6); // (5000+3000)/1e6（无 borderW=整框保守）
  const b = [{ box: { width: 100, height: 50, borderW: 3 }, label: { width: 100, height: 30 } }];
  assert.equal(annotCoverageRatio(b, 1000, 1000), 3900 / 1e6); // 2×(100+50)×3 + 3000（描边带口径）
  assert.equal(annotCoverageRatio([], 100, 100), 0);
  assert.equal(annotCoverageRatio(null, 100, 100), 1, '非法输入保守回 1（必然超标报警）');
  assert.equal(annotCoverageRatio(a, 0, 100), 1);
});

// ---------- 静态断言 ----------
test('静态：三区 grip DOM + CSS 呈示门控（桌面 ≥1024 且 stage 模式；grip 不入移动端）', () => {
  const html = read('index.html');
  for (const id of ['lp-grip', 'rp-grip', 'ba-grip']) {
    assert.ok(html.includes(`id="${id}"`), `index.html 应有 #${id}`);
    assert.ok(html.includes('class="stage-grip'), 'grip 走 stage-grip 类族');
  }
  const css = read('css/style.css');
  assert.match(css, /@media \(min-width:1024px\)\{\s*#editor-view\[data-uimode="stage"\] \.stage-grip\{display:block\}/, 'grip 仅桌面 stage 模式呈示');
  assert.match(css, /\.stage-grip\{[^}]*touch-action:none/, '触屏可拖（touch-action:none）');
  assert.match(css, /#bottom-area\.ba-sized #tl-scroll\{flex:1 1 auto;min-height:0\}/, '底区自定义高经 .ba-sized 放开 #tl-scroll 吃余高');
  // 折叠引导强化：细条 chevron + hover 提亮
  assert.ok(html.includes('class="chev"'), '三条折叠细条带 chevron 图标');
  assert.match(css, /\.col-strip:hover\{color:var\(--acc\);background:var\(--bg3\)\}/, '细条 hover 提亮');
  assert.match(css, /#bottom-strip:hover\{color:var\(--acc\);background:var\(--bg3\)\}/, '底部细条 hover 提亮');
});

test('静态：main.js grip 接线（Pointer Events+setPointerCapture+拖中不落盘/up 落盘）与模式清场', () => {
  const src = read('js/main.js');
  assert.match(src, /function wireStageGrips\(/, 'wireStageGrips 接线存在');
  assert.match(src, /setPointerCapture\(e\.pointerId\)/, 'setPointerCapture 捕获指针');
  assert.match(src, /localStorage\.setItem\(STAGE_PANE_KEYS\[kind\]/, 'pointerup 才写记忆键');
  assert.match(src, /function applyStagePaneSizes\(/, 'applyStagePaneSizes 统一套/清内联宽高');
  assert.match(src, /applyStagePaneSizes\(\); \/\/ build-91-varispeed F2/, '折叠切换与模式切换均重套尺寸');
  assert.match(src, /matchMedia\('\(max-width: 1023\.5px\)'\)\.addEventListener\?\.\('change', \(\) => applyStagePaneSizes\(\)\)/, '跨断点清场');
});

test('静态：说明书无「数拍」残留、无「上场门/下场门」残留（build-68/build-63 退役口径进说明书）', () => {
  for (const f of ['js/manual.js', 'js/manual-boards.js']) {
    const src = read(f);
    assert.ok(!/数拍|倒计/.test(src), `${f} 无数拍/倒计时残留`);
    assert.ok(!/上场门|下场门/.test(src), `${f} 无上场门/下场门残留`);
  }
  // 说明书正文应覆盖 build-72 新语义关键词
  const manual = read('js/manual.js') + read('js/manual-boards.js');
  for (const kw of ['同步后面/前面位置', '检查更新', '观众在下/在上', '候场区', '4:3', '移出队形', '[媒体库|索引]']) {
    assert.ok(manual.includes(kw), `说明书应覆盖 build-72 语义「${kw}」`);
  }
});
