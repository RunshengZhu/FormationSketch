// 队形编辑优化三合一 —— build-62-formations2 单测。
// F1：+13 种新预设（genSlots 几何：域内/数量/朝向合法 + 关键形状特征）
// F2：assignMinCost（匈牙利 O(n³)：与暴力全排列对拍 / 恒等映射 / 1D 非交叉 / 矩形分配 /
//     横排→V 总距离 ≤ 顺序对位）+ main.js 生成流接线静态断言（首队形不分派/非首队形分派）
// F3：显示层垂直镜像纯函数（mirrorFacing 关键角 / stageYToCanvas↔canvasYToStage 往返）+
//     区域绘制静态断言（wingM/后台统一标注——build-63-stageview2 F1 起上场门/下场门退役）+
//     观众上下切换接线静态断言
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, validateProject } from '../js/model.js';
import { genSlots, SHAPE_KINDS } from '../js/shapes.js';
import { assignMinCost, assignTotalCost } from '../js/assign.js';
import { stageBounds, mirrorFacing, stageYToCanvas, canvasYToStage, isViewMirrored } from '../js/stage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageSrc = readFileSync(join(root, 'js', 'stage.js'), 'utf8');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const modelSrc = readFileSync(join(root, 'js', 'model.js'), 'utf8');
const indexSrc = readFileSync(join(root, 'index.html'), 'utf8');
const assignSrc = readFileSync(join(root, 'js', 'assign.js'), 'utf8');
const buildSrc = readFileSync(join(root, 'scripts', 'build-single.mjs'), 'utf8');

const stage = { widthM: 16, depthM: 12, audience: 'bottom' };
const NEW_KINDS = ['grid', 'triangle', 'halfcircle', 'parallelogram', 'chevron', 'star', 'xpattern', 'center-surround', 'doublecircle', 'diagonal2', 'staggered', 'sline', 'heart'];

// ---------- F1：新预设几何 ----------
test('F1: SHAPE_KINDS 收录 13 新 kind 且旧 8 种 value 不变', () => {
  for (const k of ['rows', 'line', 'columns', 'circle', 'arc', 'v', 'diagonal', 'diamond']) {
    assert.ok(SHAPE_KINDS.includes(k), `旧 kind 保留: ${k}`);
  }
  for (const k of NEW_KINDS) assert.ok(SHAPE_KINDS.includes(k), `新 kind 收录: ${k}`);
  assert.equal(SHAPE_KINDS.length, 21);
});

test('F1: 新预设数量/域内/朝向合法（多尺寸场地 × 多人数，含极端人数）', () => {
  const stages = [
    { widthM: 16, depthM: 12, audience: 'bottom' },
    { widthM: 12, depthM: 16, audience: 'bottom' },
    { widthM: 8, depthM: 6, audience: 'bottom' },
    { widthM: 18, depthM: 10, audience: 'bottom' },
  ];
  for (const st of stages) {
    for (const kind of NEW_KINDS) {
      for (const n of [1, 2, 3, 5, 12, 16, 25, 40]) {
        const pts = genSlots(kind, n, st);
        assert.equal(pts.length, n, `${kind} n=${n} ${st.widthM}x${st.depthM}`);
        for (const p of pts) {
          assert.ok(p.x >= -0.01 && p.x <= st.widthM + 0.01, `${kind} x 越界 ${p.x} (${kind} ${st.widthM}x${st.depthM})`);
          assert.ok(p.y >= -0.01 && p.y <= st.depthM + 0.01, `${kind} y 越界 ${p.y}`);
          assert.ok(Number.isFinite(p.facing) && p.facing >= 0 && p.facing < 360, `${kind} facing ${p.facing}`);
        }
      }
    }
  }
});

test('F1: triangle 实心三角——顶点行最窄、底行最宽；flip 前后翻转', () => {
  const rowCounts = pts => {
    const rows = new Map();
    for (const p of pts) {
      const key = [...rows.keys()].find(k => Math.abs(k - p.y) < 1e-6) ?? p.y;
      rows.set(key, (rows.get(key) || 0) + 1);
    }
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  };
  assert.deepEqual(rowCounts(genSlots('triangle', 6, stage)), [1, 2, 3], 'n=6 标准三角');
  assert.deepEqual(rowCounts(genSlots('triangle', 9, stage)), [1, 2, 3, 3], 'n=9 四行（R=4）');
  const pts = genSlots('triangle', 9, stage);
  const flipped = genSlots('triangle', 9, stage, { flip: true });
  assert.ok(Math.abs(pts[0].y - Math.min(...pts.map(p => p.y))) < 1e-6, '正三角：首位舞者=顶点（y 最小，远离观众）');
  assert.ok(Math.abs(flipped[0].y - Math.max(...flipped.map(p => p.y))) < 1e-6, '倒三角（flip）：首位舞者=顶点朝观众');
});

test('F1: halfcircle 标准半圆——全部点等半径、张角 ≤180°+ε、开口朝观众（y 大侧）', () => {
  const pts = genSlots('halfcircle', 13, stage);
  const m = 1.5;
  const r = Math.min(stage.widthM / 2 - m, stage.depthM * 0.55);
  const ccyy = Math.min(stage.depthM - m, m + r + (stage.depthM - 2 * m - r) * 0.3);
  const cx = stage.widthM / 2;
  const angles = [];
  for (const p of pts) {
    const dx = p.x - cx, dy = ccyy - p.y;
    assert.ok(Math.abs(Math.hypot(dx, dy) - r) < 1e-6, '等半径');
    angles.push(Math.atan2(dy, dx) * 180 / Math.PI); // 0..180（上半圆）
  }
  assert.ok(Math.max(...angles) - Math.min(...angles) <= 180 + 1e-6, '张角 ≤180°');
  assert.ok(Math.min(...pts.map(p => p.y)) < ccyy - r * 0.9, '拱背朝后（y 小侧）');
});

test('F1: staggered 交错横排——恰好两排、后排与前排错位半间距', () => {
  const pts = genSlots('staggered', 9, stage);
  const ys = [...new Set(pts.map(p => Math.round(p.y * 1e6) / 1e6))];
  assert.equal(ys.length, 2, '两排');
  assert.ok(Math.abs(ys[1] - ys[0] - 1.6) < 1e-6, '排距 1.6');
  const back = pts.filter(p => Math.abs(p.y - ys[0]) < 1e-6).map(p => p.x).sort((a, b) => a - b);
  const front = pts.filter(p => Math.abs(p.y - ys[1]) < 1e-6).map(p => p.x).sort((a, b) => a - b);
  assert.equal(back.length, 5, 'ceil(9/2) 后排');
  const sp = (stage.widthM - 3) / (5 - 0.5);
  assert.ok(Math.abs((back[1] - back[0]) - (front[1] - front[0])) < 1e-6, '同排等距');
  assert.ok(Math.abs((back[0] - front[0]) - sp / 2) < 1e-6, '错位半间距');
});

test('F1: doublecircle 双圆——外圈 ceil(2n/3)、内圈其余，内外半径不同', () => {
  const pts = genSlots('doublecircle', 9, stage);
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  const R = Math.min(stage.widthM, stage.depthM) / 2 - 1.5;
  const outer = pts.filter(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - R) < 1e-6);
  const inner = pts.filter(p => Math.abs(Math.hypot(p.x - cx, p.y - cy) - R * 0.52) < 1e-6);
  assert.equal(outer.length, 6, '外圈 ceil(9·2/3)');
  assert.equal(inner.length, 3, '内圈其余');
});

test('F1: xpattern 四臂落在两条对角线上', () => {
  const pts = genSlots('xpattern', 16, stage);
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  const k = (stage.depthM - 3) / (stage.widthM - 3); // 对角线斜率（|dy/dx|）
  for (const p of pts) {
    const dx = Math.abs(p.x - cx), dy = Math.abs(p.y - cy);
    assert.ok(Math.abs(dy - k * dx) < 1e-6, `在对角线上 (${p.x},${p.y})`);
  }
});

test('F1: star 五角星——轮廓点在内外半径之间、含顶部外顶点', () => {
  const pts = genSlots('star', 20, stage);
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  const R = Math.min(stage.widthM, stage.depthM) / 2 - 1.5;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    assert.ok(d <= R + 1e-6 && d >= R * 0.42 - 1e-6, `轮廓半径 ${d}`);
  }
  const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
  assert.ok(Math.abs(top.y - (cy - R)) < 1e-6, '顶部外顶点被采样');
});

test('F1: parallelogram 行间 shear 右移；grid 末行居中且方正', () => {
  const pp = genSlots('parallelogram', 12, stage); // rows=2 → cols=6
  const rows = [...new Set(pp.map(p => Math.round(p.y * 1e6) / 1e6))].sort((a, b) => a - b);
  assert.equal(rows.length, 2);
  const minX = r => Math.min(...pp.filter(p => Math.abs(p.y - r) < 1e-6).map(p => p.x));
  assert.ok(minX(rows[1]) > minX(rows[0]) + 0.4, '第二行整体右移（斜置）');
  // grid 12 → 尽量方正：3×4 或 4×3（行数×每行≤4）
  const gd = genSlots('grid', 12, stage);
  const gRows = [...new Set(gd.map(p => Math.round(p.y * 1e6) / 1e6))];
  assert.ok(gRows.length === 3 || gRows.length === 4, `方正 ${gRows.length} 行`);
  const perRow = Math.max(...gRows.map(ry => gd.filter(p => Math.abs(p.y - ry) < 1e-6).length));
  assert.ok(perRow <= 4, '每行 ≤4 人');
});

test('F1: sline 纵向推进 y 单调 + 蛇形摆动沿切线朝向；diagonal2 两条平行线端点成对', () => {
  const sl = genSlots('sline', 12, stage);
  const ys = sl.map(p => p.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1] - 1e-9, 'y 单调递增（后→前推进）');
  assert.ok(Math.max(...sl.map(p => Math.abs(p.x - stage.widthM / 2))) > 1, '横向摆动幅值非零');
  const cx = stage.widthM / 2, cy = stage.depthM / 2;
  const mid = sl.reduce((a, b) => (Math.abs(b.y - cy) < Math.abs(a.y - cy) ? b : a));
  assert.ok(Math.abs(mid.x - cx) < (stage.widthM / 2 - 1.5) * 0.81 + 1e-6, '端点居中（sin 端点为 0）');
  // 双斜线：偶数人 → 最低点恰好 2 个（两线各自下端）、最高点恰好 2 个
  const d2 = genSlots('diagonal2', 8, stage);
  const maxY = Math.max(...d2.map(p => p.y)), minY = Math.min(...d2.map(p => p.y));
  assert.equal(d2.filter(p => Math.abs(p.y - maxY) < 1e-6).length, 2, '两线底端');
  assert.equal(d2.filter(p => Math.abs(p.y - minY) < 1e-6).length, 2, '两线顶端');
  // 平行：各线内 dx/dy 恒定（两线同斜率）
  const slopeOf = group => {
    const s = [...group].sort((a, b) => a.y - b.y);
    return (s[1].x - s[0].x) / (s[1].y - s[0].y);
  };
  assert.ok(Math.abs(slopeOf(d2.slice(0, 4)) - slopeOf(d2.slice(4))) < 1e-6, '两线平行');
});

test('F1: heart 心形——心尖朝观众（y 大侧）、双瓣朝后；center-surround 内簇外环', () => {
  const ht = genSlots('heart', 16, stage);
  const cy = stage.depthM / 2;
  const cusp = ht.reduce((a, b) => (b.y > a.y ? b : a));
  assert.ok(cusp.y > cy, '心尖在观众半场');
  const top = ht.reduce((a, b) => (b.y < a.y ? b : a));
  assert.ok(top.y < cy, '瓣在远离观众半场');
  const cs = genSlots('center-surround', 9, stage);
  const cx = stage.widthM / 2, cyy = stage.depthM / 2;
  const R = Math.min(stage.widthM, stage.depthM) / 2 - 1.5;
  const outer = cs.filter(p => Math.abs(Math.hypot(p.x - cx, p.y - cyy) - R) < 1e-6);
  assert.equal(outer.length, 6, '外围环 ceil?=9−ceil(9/3)=6');
  const inner = cs.filter(p => Math.hypot(p.x - cx, p.y - cyy) < R * 0.5);
  assert.equal(inner.length, 3, '中心簇');
});

// ---------- F2：assignMinCost ----------
function* permutations(arr) {
  if (arr.length <= 1) { yield arr.slice(); return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}
const bruteMin = (from, to) => {
  let best = Infinity;
  for (const p of permutations([...to.keys()])) {
    let s = 0;
    for (let i = 0; i < from.length; i++) s += Math.hypot(from[i].x - to[p[i]].x, from[i].y - to[p[i]].y);
    if (s < best) best = s;
  }
  return best;
};

test('F2: assignMinCost 与暴力全排列对拍（n ≤ 7 随机 60 例）', () => {
  let seed = 20261002;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(rnd() * 7);
    const from = Array.from({ length: n }, () => ({ x: rnd() * 16, y: rnd() * 12 }));
    const to = Array.from({ length: n }, () => ({ x: rnd() * 16, y: rnd() * 12 }));
    const asg = assignMinCost(from, to);
    assert.equal(asg.length, n);
    assert.deepEqual([...asg].sort((a, b) => a - b), [...to.keys()], '双射');
    const got = assignTotalCost(from, to, asg);
    const want = bruteMin(from, to);
    assert.ok(Math.abs(got - want) < 1e-6, `trial ${trial}: ${got} vs ${want}`);
  }
});

test('F2: 恒等映射（from=to）与 1D 非交叉性', () => {
  const to = Array.from({ length: 8 }, (_, i) => ({ x: 2 + i * 1.5, y: 5 }));
  const asg = assignMinCost(to, to);
  assert.deepEqual(asg, [...to.keys()], '零成本唯一最优=恒等');
  // 1D：乱序起点 → 有序终点，最优指派保持顺序（不交叉）；
  // assignment[起点序] = 终点序：按起点 x 排序后其目标 x 必须递增
  const from = [...to].sort(() => Math.random() - 0.5);
  const asg2 = assignMinCost(from, to);
  const pairs = from.map((p, fi) => ({ fx: p.x, tx: to[asg2[fi]].x })).sort((a, b) => a.fx - b.fx);
  for (let i = 1; i < pairs.length; i++) assert.ok(pairs[i].tx > pairs[i - 1].tx, '顺序保持（非交叉）');
});

test('F2: 矩形分配（行<列）——每行得一列、互不相同、代价最优', () => {
  const from = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }];
  const to = Array.from({ length: 5 }, (_, i) => ({ x: i * 2, y: i % 2 ? 1 : 0 }));
  const asg = assignMinCost(from, to);
  assert.equal(asg.length, 3);
  assert.equal(new Set(asg).size, 3, '列互不相同');
  assert.ok(asg.every(c => c >= 0 && c < 5), '列在域内');
  // 与「行=列扩充 3 列哨兵 + 暴力 C(5,3)·3!」比较：直接枚举全部注入
  let best = Infinity;
  for (const p of permutations([0, 1, 2, 3, 4])) {
    const pick = p.slice(0, 3);
    let s = 0;
    for (let i = 0; i < 3; i++) s += Math.hypot(from[i].x - to[pick[i]].x, from[i].y - to[pick[i]].y);
    if (s < best) best = s;
  }
  assert.ok(Math.abs(assignTotalCost(from, to, asg) - best) < 1e-6, '矩形分配代价最优');
});

test('F2: 场景用例——横排→V 形的总距离 ≤ 顺序对位', () => {
  const from = genSlots('line', 10, stage);   // 上一队形：一字横排
  const to = genSlots('v', 10, stage);        // 新队形：V 形
  const asg = assignMinCost(from, to);
  const sequential = from.map((_, i) => i);
  assert.ok(assignTotalCost(from, to, asg) <= assignTotalCost(from, to, sequential) + 1e-9,
    '最优分派不劣于顺序对位');
});

test('F2: 生成流接线静态断言——首队形保持顺序对位、非首队形按上一队形最小距离分派', () => {
  assert.match(mainSrc, /import \{ assignMinCost \} from '\.\/assign\.js';/, '引入 assign 模块');
  assert.match(mainSrc, /const prev = \(p\.formations\.length > 1 && s\.formationIndex > 0\) \? p\.formations\[s\.formationIndex - 1\] : null;/, '首队形判定（formations.length>1 且有前队形）');
  // build-91-varispeed（需求 5）改写：applySlots 传 { ids }（子集模式内建「子集外舞者原位保留」，
  // 原 kept 手工保留 hack 退役）；直配/就近对位的两路分流不变
  assert.match(mainSrc, /if \(prev\) shapes\.applySlots\(f, ids, effSlots, \{ ids \}\);/, '非首队形：按指派直配（子集模式）');
  assert.match(mainSrc, /else shapes\.applySlots\(f, ids, slots, \{ current: f\.positions, ids \}\);/, '首队形：现状就近对位（子集模式）');
  assert.match(mainSrc, /M\.onStageIds\(/, '生成器只作用在场舞者（onStageIds 交集）');
  assert.match(mainSrc, /assignMinCost\(fromPts, slots\)/, '最小总移动距离分派');
  assert.match(mainSrc, /`生成队形\(\$\{kind\}\)`/, '单条历史标签不变');
  assert.match(assignSrc, /不承诺零交叉/, '注释：交叉声明在场');
  assert.match(buildSrc, /'shapes', 'assign', 'store'/, '单文件打包 ORDER 收录 assign');
});

// ---------- F3：镜像纯函数 + 区域标记 + 观众上下切换 ----------
test('F3: mirrorFacing 关键角（0↔180 对翻、90/270 不变、对合）', () => {
  assert.equal(mirrorFacing(0), 180);
  assert.equal(mirrorFacing(180), 0);
  assert.equal(mirrorFacing(90), 90);
  assert.equal(mirrorFacing(270), 270);
  assert.equal(mirrorFacing(45), 135);
  assert.equal(mirrorFacing(359), 181);
  assert.equal(mirrorFacing(-90), 270);
  assert.equal(mirrorFacing(400), 140);
  for (let f = 0; f < 360; f++) assert.equal(mirrorFacing(mirrorFacing(f)), f, `对合 ${f}`);
});

test('F3: stageYToCanvas/canvasYToStage——bottom 恒等、top 镜像、往返恒等、同一变换函数', () => {
  const bottom = { widthM: 16, depthM: 12, audience: 'bottom' };
  const top = { widthM: 16, depthM: 12, audience: 'top' };
  assert.equal(isViewMirrored(bottom), false);
  assert.equal(isViewMirrored(top), true);
  for (const y of [0, 3.5, 12]) {
    assert.equal(stageYToCanvas(y, bottom), y, 'bottom 恒等');
    assert.equal(stageYToCanvas(y, top), 12 - y, 'top 镜像 y=depthM−y');
  }
  for (const y of [0, 2, 7.25, 12]) {
    assert.equal(canvasYToStage(stageYToCanvas(y, top), top), y, 'top 往返');
    assert.equal(canvasYToStage(stageYToCanvas(y, bottom), bottom), y, 'bottom 往返');
    assert.equal(canvasYToStage(y, top), stageYToCanvas(y, top), '对合：两函数同式');
  }
  assert.equal(canvasYToStage(5, null), 5, 'stage 缺省=不镜像（防御）');
});

test('F3: faceAudience 数据约定——top 与 bottom 同为 180（显示镜像后面向画面上方观众）', () => {
  assert.match(modelSrc, /\{ bottom: 180, top: 180, left: 270, right: 90 \}/, 'faceAudience top:180（注释含语义修订说明）');
});

test('F3: 区域绘制静态断言——候场区/后台标注（build-63-stageview2 F1 改写：上场门/下场门退役，统一「后台」）', () => {
  assert.ok(!/上场门|下场门/.test(stageSrc), '上场门/下场门文字退役');
  assert.match(stageSrc, /'后台'/, '后台条带统一标注「后台」');
  assert.match(stageSrc, /const wing = project\.stage\.wingM \?\? 0;/, 'wingM 参与绘制');
  assert.ok(!/wingName/.test(stageSrc), '左右翼标签互换逻辑随概念一并退役');
  assert.match(stageSrc, /audience === 'left' \? \{ x: W, y: -bs, w: bs, h: H \+ 2 \* bs \}/, 'left 观众的后台通道=对面条带');
  assert.match(stageSrc, /hatch/, '斜纹填充（降弱版）');
  assert.match(stageSrc, /vLabel/, '竖排标签');
  assert.ok(/if \(!opts\.minimal\) \{\s*\n\s*const zoneFont/.test(stageSrc), '区域标记仅在非 minimal 呈示');
});

test('F3: 镜像接线静态断言——drawScene/朝向/指针/浮窗共用同一变换函数，无第二手写镜像', () => {
  assert.match(stageSrc, /Y = y => oy \+ stageYToCanvas\(y, project\.stage\) \* s/, 'drawScene 全场景走镜像 Y()');
  assert.match(stageSrc, /ctx\.rotate\(\(mirrored \? mirrorFacing\(p\.facing \|\| 0\) : \(p\.facing \|\| 0\)\) \* Math\.PI \/ 180\)/, '舞者朝向随镜像');
  assert.match(stageSrc, /y: canvasYToStage\(\(py - rect\.top - v\.oy\) \/ v\.scale, stage\)/, '指针换算经 canvasYToStage');
  assert.match(stageSrc, /stageYToCanvas\(at\.y, st\) \* v\.scale/, '单元浮窗屏幕位随镜像');
  assert.match(stageSrc, /stageYToCanvas\(p\.y - Math\.cos\(fr\) \* 0\.9, project\.stage\)/, '朝向把手随镜像');
  assert.equal((stageSrc.match(/depthM - y/g) || []).length, 2, '镜像公式仅存在于纯函数一处');
  assert.match(stageSrc, /Math\.max\(b, stage\.wingM \?\? 0\)/, '候场区超出后台时纳入视图包络');
});

test('F3: 观众上下切换静态断言——快捷钮/单条「观众方向」历史/render 文字同步/四向 select 保留', () => {
  assert.match(indexSrc, /id="btn-audience-dir"/, '快捷钮在场');
  assert.match(indexSrc, /id="audience-dir-label">观众在下</, '缺省文字=观众在下');
  assert.match(mainSrc, /store\.mutate\(p => \{ p\.stage\.audience = nxt; \}, '观众方向'\)/, '单条「观众方向」历史');
  assert.match(mainSrc, /adir\.textContent = p\.stage\.audience === 'top' \? '观众在上' : '观众在下';/, 'render 同步文字');
  assert.match(mainSrc, /cur === 'top' \? 'bottom' : 'top'/, 'bottom↔top 切换');
  assert.match(mainSrc, /\['bottom', 'top', 'left', 'right'\]\.map/, '舞台页签四向 select 保留');
  assert.match(mainSrc, /'左右候场区宽'/, '舞台页签候场区宽输入');
  assert.match(mainSrc, /wingM: \[0, 5\]/, 'STAGE_RANGE [0,5]');
});

test('F3: wingM 模型校验——createProject 缺省 2（build-64 侧翼扩容；build-63 曾 1）、validateProject 钳 [0,5]', () => {
  const p = createProject();
  assert.equal(p.stage.wingM, 2, '缺省 2（build-64 侧翼扩容）');
  assert.equal(validateProject({ stage: { wingM: 9 } }).project.stage.wingM, 5, '越上限钳 5');
  assert.equal(validateProject({ stage: { wingM: -3 } }).project.stage.wingM, 0, '负值钳 0');
  assert.equal(validateProject({ stage: {} }).project.stage.wingM, 2, '缺省回填');
  // 既有项目显式数值保留（零迁移）
  assert.equal(validateProject({ stage: { wingM: 1.5, backstageM: 2 } }).project.stage.wingM, 1.5, '旧项目 wingM 1.5 保留');
  const v = validateProject({ stage: { wingM: 'abc' } });
  assert.equal(v.project.stage.wingM, 2, '非数值回退缺省（build-64）');
});

test('F3: stageBounds 视图包络——缺省不变（E-12）、候场区超出后台时扩展 x 包络', () => {
  const def = stageBounds({ widthM: 16, depthM: 12, backstageM: 2, wingM: 1.5 });
  assert.deepEqual(def, { x0: -2, y0: -2, x1: 18, y1: 14 }, 'wingM ≤ backstageM 包络不变');
  const wide = stageBounds({ widthM: 16, depthM: 12, backstageM: 2, wingM: 3 });
  assert.deepEqual(wide, { x0: -3, y0: -2, x1: 19, y1: 14 }, 'wingM > backstageM 扩 x');
});

test('F3: 视频导出合成器无独立坐标假设（逐帧 drawScene+fitView，镜像自动获益）', () => {
  const vxSrc = readFileSync(join(root, 'js', 'video-export.js'), 'utf8');
  assert.match(vxSrc, /drawScene\(ctx, \{ x: 0, y: 0, w: layout\.stageW, h: layout\.stageH \}, project, positions, \{/,
    '上部舞台逐帧 drawScene');
  assert.ok(!/stageYToCanvas|mirrorFacing|depthM - /.test(vxSrc), '合成器不做二次坐标变换');
});
