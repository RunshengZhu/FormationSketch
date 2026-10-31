// 舞台视图区域重设计 —— build-63-stageview2 单测。
// F1：后台/候场瘦身统一——新项目缺省 backstageM 1、wingM 1（既有项目显式数值零迁移；
//     范围 [0,10]/[0,5] 不变）；画布标签统一「后台」（上场门/下场门退役）；填充降弱静态断言。
// F2：舞台界限强化——主舞台 2px accent 实线边框 + 四角 L 形角标静态断言；
//     镜像稳健 fillRect（yTop 归一，修复 build-62 audience='top' 底色错位一个舞台高度）。
// F3：全域舞者自由 + 视野包络扩展——dancerEnvelope/unionBounds 纯函数（含舞者在观众区用例）；
//     fitView = stageBounds ∪ 舞者位置外扩 0.5m（无人越界时与旧口径完全一致的回归）；
//     拖拽钳制退役（gesture.js computeTargets 无舞台+后台 clamp）、生成槽位域内 clamp 不受影响；
//     视频导出合成器 / drawScene 缺省 view / ensureView / clampPan 同链接线静态断言。
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, validateProject } from '../js/model.js';
import { genSlots } from '../js/shapes.js';
import { stageBounds, fitView, dancerEnvelope, unionBounds } from '../js/stage.js';
import { createGestureMachine } from '../js/gesture.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageSrc = readFileSync(join(root, 'js', 'stage.js'), 'utf8');
const gestureSrc = readFileSync(join(root, 'js', 'gesture.js'), 'utf8');
const vxSrc = readFileSync(join(root, 'js', 'video-export.js'), 'utf8');

const stage = { widthM: 16, depthM: 12, audience: 'bottom', backstageM: 1, wingM: 1 };

// ---------- F1：缺省 1/1 + 标签统一 ----------
test('F1: createProject 缺省 backstageM=1、wingM=1（瘦身；旧缺省 2/1.5 退役）', () => {
  const p = createProject();
  assert.equal(p.stage.backstageM, 1, '后台缺省 1');
  assert.equal(p.stage.wingM, 2, '候场缺省 2（build-64 侧翼扩容）');
});

test('F1: validateProject 缺省回填 1/2（build-64 侧翼扩容）；既有项目显式数值保留（零迁移）；范围 [0,10]/[0,5] 不变', () => {
  const back = validateProject({ stage: {} }).project.stage;
  assert.equal(back.backstageM, 1, '后台回填 1');
  assert.equal(back.wingM, 2, '候场回填 2（build-64 侧翼扩容）');
  assert.equal(validateProject({ stage: { backstageM: 2, wingM: 1.5 } }).project.stage.backstageM, 2, '旧项目后台 2 保留');
  assert.equal(validateProject({ stage: { wingM: 1.5 } }).project.stage.wingM, 1.5, '旧项目候场 1.5 保留');
  assert.equal(validateProject({ stage: { backstageM: 99 } }).project.stage.backstageM, 10, '后台越上限钳 10');
  assert.equal(validateProject({ stage: { backstageM: -4 } }).project.stage.backstageM, 0, '后台负值钳 0');
  assert.equal(validateProject({ stage: { wingM: 9 } }).project.stage.wingM, 5, '候场越上限钳 5');
});

test('F1: 画布标签（build-64 观点回归）——无「上场门/下场门」、后台条带专属「后台通道」、侧翼标「后台」、观众居中显著', () => {
  assert.ok(!/上场门|下场门/.test(stageSrc), '上场门/下场门概念退役');
  assert.ok(!/wingName/.test(stageSrc), 'wingName 指派逻辑退役');
  assert.match(stageSrc, /后台通道/, '后台条带专属标记「后台通道」');
  assert.match(stageSrc, /vLabel\('后台'/, '左右侧翼竖排「后台」标记（两侧都有）');
  assert.match(stageSrc, /观 众/, '观众核心标记居中显著');
});

test('F1: 视觉静态断言（build-64）——环带淡底/淡斜纹/侧翼 tint 增强/观众居中显著', () => {
  assert.match(stageSrc, /fillStyle = '#eef2f7'/, '环带底色暗一档（低对比）');
  assert.ok(!/'#e2e8f0'/.test(stageSrc), 'build-62 slate 大面积底色退役');
  assert.match(stageSrc, /rgba\(100,116,139,\.14\)/, '斜纹（build-63 降弱保留）');
  assert.match(stageSrc, /rgba\(148,163,184,\.10\)/, '后台 tint');
  assert.match(stageSrc, /rgba\(148,163,184,\.10\)/, '侧翼 tint 增强（build-64 F1/F2）');
  assert.match(stageSrc, /观 众/, '观众核心标记居中显著（build-64 观点回归）');
  // build-64 观点回归：「观 众」居中显著标记回归（撤销 build-63 角部降弱）
  assert.ok(/观 众/.test(stageSrc), '观众居中显著标记回归');
  assert.match(stageSrc, /ctx.fillText\('观 众'/, '观众标记居中显著（build-64 观点回归）');
});

// ---------- F2：舞台界限强化 ----------
test('F2: 主舞台 2px accent 实线边框 + 四角 L 形角标（minimal 缩略图同享，界限处处清晰）', () => {
  assert.match(stageSrc, /ctx\.lineWidth = 2;\s*\n\s*ctx\.strokeRect\(bx, by, bw, bh\);/, '舞台实线边框 2px');
  assert.match(stageSrc, /const acc = dark \? '#38bdf8' : '#0284c7';\s*\n\s*const bx = X\(0\)/, '边框用主题 accent 色');
  assert.match(stageSrc, /Math\.max\(6, Math\.min\(14, s \* 0\.5\)\)/, '四角角标长度随缩放 clamp');
  assert.ok(!/#cbd5e1/.test(stageSrc), '旧 minimal 灰细边框退役（统一 accent 边框）');
  // 边框块内无 setLineDash（实线；角标同一次 stroke）
  const border = stageSrc.slice(stageSrc.indexOf('舞台实线边框 + 四角角标'), stageSrc.indexOf('Ghost（上一/下一队形）'));
  assert.ok(!/setLineDash/.test(border), '边框/角标为实线（无虚线）');
});

test('F2: 镜像稳健 fillRect——yTop 归一（修复 build-62 audience=top 底色错位一个舞台高度）', () => {
  assert.match(stageSrc, /const yTop = \(y0, hM\) => Math\.min\(Y\(y0\), Y\(y0 \+ hM\)\);/, '矩形上缘取镜像两端较小者');
  assert.match(stageSrc, /ctx\.fillRect\(X\(-bs\), yTop\(-bs, H \+ 2 \* bs\)/, '环带底色走 yTop');
  assert.match(stageSrc, /ctx\.fillRect\(X\(0\), yTop\(0, H\), W \* s, H \* s\)/, '舞台白底走 yTop');
  assert.match(stageSrc, /yTop\(chRect\.y, chRect\.h\)/, '后台 tint 走 yTop');
  // 数值佐证：镜像下 Y(0) > Y(H)，旧写法 fillRect 顶=Y(0) 恰好整体下移一个舞台高度
  const H = 12, s = 30, oy = 100;
  const Ymir = y => oy + (H - y) * s;
  assert.ok(Ymir(0) > Ymir(H), '镜像时 Y(0) 在画面更低处（旧 fillRect 必错位的根因）');
  assert.equal(Math.min(Ymir(0), Ymir(H)), oy, 'yTop 归一后上缘=oy（正确台面上缘）');
});

test('F2: 网格/中心线仅在舞台区域内（域回归——线网不出台面）', () => {
  const grid = stageSrc.slice(stageSrc.indexOf('// 网格'), stageSrc.indexOf('// ---------- build-63-stageview2 F2'));
  assert.match(grid, /for \(let x = g; x < W; x \+= g\)/, '竖网格线 x∈(0,W)');
  assert.match(grid, /ctx\.moveTo\(X\(x\), Y\(0\)\); ctx\.lineTo\(X\(x\), Y\(H\)\);/, '竖线两端锚在台面 y∈[0,H]');
  assert.match(grid, /for \(let y = g; y < H; y \+= g\)/, '横网格线 y∈(0,H)');
  assert.match(grid, /ctx\.moveTo\(X\(0\), Y\(y\)\); ctx\.lineTo\(X\(W\), Y\(y\)\);/, '横线两端锚在台面 x∈[0,W]');
  assert.match(grid, /ctx\.moveTo\(X\(W \/ 2\), Y\(0\)\); ctx\.lineTo\(X\(W \/ 2\), Y\(H\)\);/, '中心线限于台面');
});

// ---------- F3：全域舞者自由 + 视野包络扩展 ----------
test('F3: dancerEnvelope 纯函数——bbox 外扩 0.5m；空/无有效坐标 → null', () => {
  assert.deepEqual(dancerEnvelope({ a: { x: 2, y: 3 } }), { x0: 1.5, y0: 2.5, x1: 2.5, y1: 3.5 }, '单舞者外扩 0.5');
  assert.deepEqual(dancerEnvelope({ a: { x: 2, y: 3 }, b: { x: 5, y: 1 } }), { x0: 1.5, y0: 0.5, x1: 5.5, y1: 3.5 }, '多舞者取 bbox 再外扩');
  assert.equal(dancerEnvelope({}), null, '空对象 → null');
  assert.equal(dancerEnvelope(null), null, 'null → null');
  assert.equal(dancerEnvelope({ a: { x: NaN, y: 3 } }), null, '无效坐标过滤后为空 → null');
  assert.deepEqual(dancerEnvelope({ a: { x: 2, y: 3 } }, 1), { x0: 1, y0: 2, x1: 3, y1: 4 }, 'pad 可调');
});

test('F3: unionBounds 纯函数——null 恒等、逐边取并', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 6 };
  assert.equal(unionBounds(a, null), a, '右空 → 左恒等');
  assert.equal(unionBounds(null, a), a, '左空 → 右恒等');
  assert.equal(unionBounds(null, null), null, '双空 → null');
  assert.deepEqual(unionBounds(a, { x0: -2, y0: 1, x1: 8, y1: 9 }), { x0: -2, y0: 0, x1: 10, y1: 9 }, '逐边 min/max');
});

test('F3: fitView 包络 ∪ 舞者——舞者在观众区（y>depthM）时视野包含不裁切', () => {
  const W = 800, H = 600;
  const base = fitView(W, H, stage, 16);
  // 舞者深入观众区（depthM=12 之下 4 米）
  const v = fitView(W, H, stage, 16, { a: { x: 8, y: 16 } });
  assert.ok(v.scale < base.scale, '视野扩大（scale 更小）');
  // 舞者数据点必须落在可视画布内（不被裁）
  const px = v.ox + 8 * v.scale, py = v.oy + 16 * v.scale;
  assert.ok(px > 0 && px < W && py > 0 && py < H, `舞者画布位 (${px.toFixed(0)},${py.toFixed(0)}) 在视口内`);
  // 舞者在侧翼深处（x<0）同样纳入
  const vl = fitView(W, H, stage, 16, { a: { x: -4, y: 6 } });
  assert.ok(vl.ox + -4 * vl.scale > 0, '侧翼外舞者在视口内');
});

test('F3: 回归——无人越界时 fitView 与旧口径（stageBounds）完全一致', () => {
  const W = 800, H = 600;
  assert.deepEqual(fitView(W, H, stage, 16), fitView(W, H, stage, 16, null), 'positions=null 恒等');
  assert.deepEqual(fitView(W, H, stage, 16), fitView(W, H, stage, 16, {}), 'positions={} 恒等');
  // 全员在台面内（离边界 ≥0.5m）→ 包络不被舞者撑大
  const inside = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`d${i}`, { x: 2 + (i % 4) * 3, y: 2 + Math.floor(i / 4) * 3 }]));
  assert.deepEqual(fitView(W, H, stage, 16), fitView(W, H, stage, 16, inside), '场内舞者不改变视野');
  // 边界舞者（台缘上）允许外扩半个身位——语义正确而非回归（超出即「越界」）
  assert.deepEqual(unionBounds(stageBounds(stage), dancerEnvelope({ a: { x: 8, y: 6 } })), stageBounds(stage), '台心舞者并集=stageBounds');
});

test('F3: 拖拽钳制退役——gesture 静态断言无舞台+后台 clamp；状态机行为：拖入观众区原样落点', () => {
  assert.ok(!/Math\.min\(stg\.widthM \+ bs/.test(gestureSrc), 'x 向舞台+后台钳制退役');
  assert.ok(!/Math\.min\(stg\.depthM \+ bs/.test(gestureSrc), 'y 向舞台+后台钳制退役');
  // 最小假世界直接驱动状态机：A(1,1) 拖到 (3,20)——观众区深处（depthM=6）原样落点
  const pos = { A: { x: 1, y: 1 } };
  const applied = [];
  const machine = createGestureMachine({
    readOnly: () => false,
    hitHandle: () => false,
    hitDancer: (x, y) => (Math.hypot(x - 1, y - 1) < 0.3 ? 'A' : null),
    toStage: (px, py) => ({ x: px, y: py }),
    selection: () => ['A'],
    multiSelect: () => false,
    formation: () => ({ positions: pos, merges: [] }),
    fmtIndex: () => 0,
    now: () => 0,
    stage: () => ({ widthM: 10, depthM: 6, snap: false, gridM: 0.5, backstageM: 1 }),
    select: () => {},
    applyPositions: map => { applied.push(map); for (const [id, v] of Object.entries(map)) Object.assign(pos[id], v); },
    rollback: () => {},
    commit: () => {},
    showMenu: () => {},
    hideMenu: () => {},
    box: () => {},
    panBy: () => {},
    zoomAt: () => {},
    requestDraw: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  machine.down({ pointerId: 1, px: 1, py: 1, touch: false, button: 0, space: false });
  machine.move({ pointerId: 1, px: 3, py: 20, touch: false, button: 0, space: false });
  machine.up({ pointerId: 1, px: 3, py: 20, touch: false, button: 0, space: false });
  assert.deepEqual(applied.at(-1), { A: { x: 3, y: 20 } }, '目标 (3,20) 原样落点（旧版 y 钳到 6+1=7）');
});

test('F3: 生成槽位域内 clamp 不受影响——genSlots 全落舞台域内（手动拖动自由、生成算法守域）', () => {
  for (const kind of ['rows', 'line', 'columns', 'circle', 'grid', 'heart']) {
    const pts = genSlots(kind, 12, { widthM: 16, depthM: 12, audience: 'bottom' });
    assert.ok(pts.length === 12, `${kind} 数量`);
    for (const p of pts) {
      assert.ok(p.x >= 0 && p.x <= 16 && p.y >= 0 && p.y <= 12, `${kind} 槽位 (${p.x.toFixed(2)},${p.y.toFixed(2)}) 在舞台域内`);
    }
  }
});

test('F3: 同链接线静态断言——drawScene 缺省 view / ensureView / clampPan / 视频合成器全部 ∪ 舞者包络', () => {
  assert.match(stageSrc, /fitView\(rect\.w, rect\.h, project\.stage, opts\.pad \?\? 14, positions\)/, 'drawScene 缺省 view 传 positions');
  assert.match(stageSrc, /fitView\(W, H, scene\.project\.stage, 16, scene\.playbackPos \|\| scene\.formation\?\.positions \|\| null\)/, 'ensureView fit 同链');
  assert.match(stageSrc, /unionBounds\(stageBounds\(scene\.project\.stage\), dancerEnvelope\(scene\.playbackPos \|\| scene\.formation\?\.positions \|\| null\)\)/, 'clampPan 软钳制同链');
  assert.match(vxSrc, /fitView\(layout\.stageW, layout\.stageH, project\.stage, 16, positions\)/, '视频导出合成器逐帧传舞者位置');
  assert.match(stageSrc, /export function dancerEnvelope/, '纯函数导出（node 可测）');
  assert.match(stageSrc, /export function unionBounds/, '纯函数导出（node 可测）');
});
