// grid-granularity：舞台网格主/次两级线 + 细粒度吸附 + 粒度快捷档（纯函数，node 直测）。
// 覆盖：gridLines 主线既有口径 / 次级线阈值内·外 / 条数超限退化 / 阈值边界；
//       snapToGrid 粗档与现行 computeTargets 同式、fine 1/5 档、gridM 非法回退；
//       GRID_PRESETS 形态；另以记录型桩 ctx 冒烟 drawScene 网格段（次级铺底 + 主线/中心线
//       样式不变 + minimal/showGrid 关闭整段跳过）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridLines, snapToGrid, GRID_PRESETS,
  GRID_MINOR_DIV, GRID_MINOR_MIN_PX, GRID_MINOR_MAX_LINES,
  drawScene,
} from '../js/stage.js';
import { createProject } from '../js/model.js';

// ---------- gridLines：主线（既有 gridM 网格口径） ----------
test('G1 主线：内部线（台缘不含）、0.5 网格逐条正确；gridM 缺失回退 0.5', () => {
  const gl = gridLines({ widthM: 10, depthM: 6, gridM: 0.5 }, { scale: 10 });
  assert.deepEqual(gl.major.x, Array.from({ length: 19 }, (_, i) => (i + 1) * 0.5), '竖线 x∈(0,10)');
  assert.deepEqual(gl.major.y, Array.from({ length: 11 }, (_, i) => (i + 1) * 0.5), '横线 y∈(0,6)');
  assert.deepEqual(gl.minor, { x: [], y: [] }, '0.1m×10px=1px < 12px 阈值 → 无次级线');
  // gridM 缺失/0 → 0.5 回退（与 drawScene 既有 `|| 0.5` 口径一致）
  const fb = gridLines({ widthM: 4, depthM: 4 }, { scale: 10 });
  assert.equal(fb.major.x.length, 7);
  assert.equal(fb.major.y.length, 7);
});

// ---------- gridLines：次级线（/5 档、12px 阈值内/外、跳过主线位） ----------
test('G2 次级线：间距 ≥12px 阈值出现，=/5 档，不与主线重合；阈值外整段缺席', () => {
  const st = { widthM: 3, depthM: 2, gridM: 0.5 };
  const below = gridLines(st, { scale: 119 }); // 0.1m×119px=11.9px < 12px
  assert.equal(below.minor.x.length + below.minor.y.length, 0, '阈值外：无次级线');
  const at = gridLines(st, { scale: GRID_MINOR_MIN_PX / 0.1 }); // 恰 12px（含边界）
  assert.ok(at.minor.x.length > 0 && at.minor.y.length > 0, '阈值边界即出现');
  // =/5 档且全部落在主线之间（浮点尘埃容忍比较）
  for (const v of at.minor.x) assert.ok(!at.major.x.some(m => Math.abs(m - v) < 1e-9), '次级竖线不压主线');
  for (const v of at.minor.y) assert.ok(!at.major.y.some(m => Math.abs(m - v) < 1e-9), '次级横线不压主线');
  // 计数：x∈(0,3) 0.1 步 29 条去掉 5 个主线位=24；y∈(0,2) 19-3=16
  assert.equal(at.minor.x.length, 24);
  assert.equal(at.minor.y.length, 16);
  assert.equal(GRID_MINOR_DIV, 5, '分档常量钉住（与 snapToGrid fine 同频）');
  assert.equal(GRID_MINOR_MIN_PX, 12);
});

// ---------- gridLines：条数超限退化（性能护栏，纯视觉降级） ----------
test('G3 次级线总条数 >400 → 整体退化只画主线；恰 400 保留（护栏边界）', () => {
  const S = 130; // 次级 0.1m→13px ≥12px 阈值（先过清晰度门，再论条数护栏）
  // 50×50 网格 0.5、次级 0.1：每轴 400 条、合计 800 > 400 → 退化
  const over = gridLines({ widthM: 50, depthM: 50, gridM: 0.5 }, { scale: S });
  assert.ok(over.major.x.length > 0 && over.major.y.length > 0, '主线不受影响');
  assert.equal(over.minor.x.length + over.minor.y.length, 0, '超限整体退化，无报错');
  // 25×25：每轴 200 条、合计恰 400 → 保留（≤ 上限不退化）
  const edge = gridLines({ widthM: 25, depthM: 25, gridM: 0.5 }, { scale: S });
  assert.equal(edge.minor.x.length + edge.minor.y.length, GRID_MINOR_MAX_LINES);
  // 26×26 → 合计 416 > 400 → 退化
  const past = gridLines({ widthM: 26, depthM: 26, gridM: 0.5 }, { scale: S });
  assert.equal(past.minor.x.length + past.minor.y.length, 0);
});

// ---------- snapToGrid：粗档（与现行 computeTargets 同式） ----------
test('S1 粗档（fine 缺省/false）：按 gridM 取整，与 Math.round(v/g)*g 同式', () => {
  assert.deepEqual(snapToGrid(1.3, 0.6, { gridM: 0.5 }), { x: 1.5, y: 0.5 });
  assert.deepEqual(snapToGrid(1.3, 0.6, { gridM: 0.5 }, {}), { x: 1.5, y: 0.5 }, 'opts 整体缺省');
  assert.deepEqual(snapToGrid(1.3, 0.6, { gridM: 0.5 }, { fine: false }), { x: 1.5, y: 0.5 });
  const s = snapToGrid(1.14, 1.16, { gridM: 0.1 }); // 0.1 网格（容忍同式 FP 尘埃）
  assert.ok(Math.abs(s.x - 1.1) < 1e-9 && Math.abs(s.y - 1.2) < 1e-9);
  // 公式回归：一连串值上与既有实现逐点一致（防止单边「修尘埃」造成两路分叉）
  for (let i = 0; i < 40; i++) {
    const v = i * 0.137;
    const r = snapToGrid(v, v, { gridM: 0.3 });
    assert.equal(r.x, Math.round(v / 0.3) * 0.3);
    assert.equal(r.y, Math.round(v / 0.3) * 0.3);
  }
});

// ---------- snapToGrid：细档（gridM/5） ----------
test('S2 细档 fine=true：0.5 网格步 0.1、0.1 网格步 0.02（1/5 分档）', () => {
  const f = snapToGrid(1.14, 0.62, { gridM: 0.5 }, { fine: true });
  assert.ok(Math.abs(f.x - 1.1) < 1e-9 && Math.abs(f.y - 0.6) < 1e-9, '0.5 网格 → 0.1 步');
  const f2 = snapToGrid(0.109, 0.137, { gridM: 0.1 }, { fine: true });
  assert.ok(Math.abs(f2.x - 0.1) < 1e-9 && Math.abs(f2.y - 0.14) < 1e-9, '0.1 网格 → 0.02 步');
  // 细档与粗档确有区分（同输入不同档不重合）
  const c = snapToGrid(1.14, 0.62, { gridM: 0.5 });
  assert.ok(Math.abs(f.x - c.x) > 1e-3 || Math.abs(f.y - c.y) > 1e-3);
  // gridM 非法/缺失 → 0.5 回退（防御性；model.js clamp 域内不可达）
  assert.deepEqual(snapToGrid(1.2, 0.8, {}), { x: 1, y: 1 });
  assert.deepEqual(snapToGrid(1.2, 0.8, { gridM: 0 }), { x: 1, y: 1 });
});

// ---------- GRID_PRESETS 形态（wave2 接 props 快捷钮的契约） ----------
test('P1 GRID_PRESETS：四档、标签=值、降序、恰为任务书序列', () => {
  assert.deepEqual(GRID_PRESETS, [
    { label: '0.5m', v: 0.5 },
    { label: '0.25m', v: 0.25 },
    { label: '0.1m', v: 0.1 },
    { label: '0.05m', v: 0.05 },
  ]);
  for (const p of GRID_PRESETS) assert.equal(p.label, `${p.v}m`);
  for (let i = 1; i < GRID_PRESETS.length; i++) assert.ok(GRID_PRESETS[i].v < GRID_PRESETS[i - 1].v, '细→更细降序');
});

// ---------- drawScene 网格段冒烟（记录型桩 ctx，round23 stubCtx 同思路扩展） ----------
function recCtx() {
  const styles = [], dashes = [], texts = [], counts = { moveTo: 0, lineTo: 0, stroke: 0 };
  const noop = () => {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop === '__rec') return { styles, dashes, texts, counts };
      if (prop === 'moveTo') return () => counts.moveTo++;
      if (prop === 'lineTo') return () => counts.lineTo++;
      if (prop === 'stroke') return () => counts.stroke++;
      if (prop === 'fillText') return (...a) => texts.push(String(a[0]));
      if (prop === 'setLineDash') return (...a) => dashes.push(a[0]);
      if (prop === 'measureText') return s => ({ width: String(s).length * 10 });
      if (!target[prop]) target[prop] = noop;
      return target[prop];
    },
    set(target, prop, v) {
      if (prop === 'strokeStyle') styles.push(v);
      target[prop] = v;
      return true;
    },
  });
}

test('D1 drawScene 两级线：大视口出次级铺底（.12）+ 主线（.25）/中心线样式不变', () => {
  const p = createProject({ pairs: 1 }); // 缺省台面 16×12、gridM 0.5
  const view = { scale: 150, ox: 20, oy: 20 }; // 次级 0.1m→15px ≥12px；16×12 次级 128+96=224 ≤400
  const ctx = recCtx();
  drawScene(ctx, { x: 0, y: 0, w: 800, h: 600 }, p, {}, { view, theme: 'light', merges: [] });
  const rec = ctx.__rec;
  assert.ok(rec.styles.includes('rgba(148,163,184,.12)'), '次级线内联低透明度色');
  assert.ok(rec.styles.includes('rgba(148,163,184,.25)'), '主线样式不变');
  assert.ok(rec.styles.includes('rgba(100,116,139,.4)'), '中心线样式不变');
  assert.ok(rec.dashes.some(d => Array.isArray(d) && d[0] === 10 && d[1] === 6), '中心线虚线规整不变');
  assert.ok(rec.counts.stroke >= 3, '次级/主线/中心线各自成笔');
  // 小视口：次级间距 0.1×20=2px < 12px → 无次级色（主线照常）
  const ctx2 = recCtx();
  drawScene(ctx2, { x: 0, y: 0, w: 800, h: 600 }, p, {}, { view: { scale: 20, ox: 20, oy: 20 }, theme: 'light', merges: [] });
  assert.ok(!ctx2.__rec.styles.includes('rgba(148,163,184,.12)'), '阈值外无次级线');
  assert.ok(ctx2.__rec.styles.includes('rgba(148,163,184,.25)'), '主线不受影响');
});

test('D2 drawScene 网格开关：minimal 与 showGrid:false 均整段跳过（零网格笔触）', () => {
  const p = createProject({ pairs: 1 });
  for (const opts of [{ minimal: true, pad: 4, theme: 'light', merges: [] }, { showGrid: false, theme: 'light', merges: [] }]) {
    const ctx = recCtx();
    drawScene(ctx, { x: 0, y: 0, w: 800, h: 600 }, p, {}, opts);
    const rec = ctx.__rec;
    assert.ok(!rec.styles.includes('rgba(148,163,184,.12)'), '无次级线');
    assert.ok(!rec.styles.includes('rgba(148,163,184,.25)'), '无主线');
    assert.ok(!rec.styles.includes('rgba(100,116,139,.4)'), '无中心线');
  }
});
