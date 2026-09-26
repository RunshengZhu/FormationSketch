// DEFECT-W3-D1 回归断言（W3 复验缺陷：音乐模式双轨拖 clip 松手 moved 提交路径，
// dragHoverLane 状态已清零但目标 lane 淡蓝填充+青缘驻留画布，直至下一次任意重渲染）。
// 根因口径（实测确认，与 reviewer 假设的差异见 js/timeline.js _up 注释）：松手路径上
// commitEdit→store.commit 只入历史**不触发渲染**（无 emit），松手前画布最后一帧仍是拖移中
// 带高亮的画面；原代码 moved 路径跳过补绘 → 残留。修复=hadHover 时清零后无条件补绘。
// 测试方式：node 无真实 canvas 2D——用软件光栅化 2D stub（source-over 合成、RGBA 直存，
// 仅实现 drawAudioLane 用到的 fillRect/stroke/save/restore 子集）真实重绘 tl.drawAudioLane，
// 以「像素级」断言收口（非仅状态断言——本缺陷正是状态对而画布残留）。
// _up 与 hooks 均为真实代码路径；commitEdit 桩忠实镜像 store.commit（只记账、不重绘）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicTimeline } from '../js/timeline.js';

// ---- 假 DOM（同 tests/ux-conflict-fixes.test.js F-02 口径） ----
function fakeEl() {
  const hs = {};
  return {
    _hs: hs,
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 260 }),
    style: {},
  };
}

// ---- 软件光栅化 2D stub：drawAudioLane 的绘制子集 ----
function makeRasterCtx(W, H) {
  const buf = new Uint8ClampedArray(W * H * 4); // 缺省全 0（透明）；首帧 paint 的 #0b1220 底即铺满
  const rgba = s => {
    if (s[0] === '#') {
      const h = s.length === 4 ? s.slice(1).split('').map(c => c + c).join('') : s.slice(1);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    const m = /rgba?\(([^)]+)\)/.exec(s);
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return [r, g, b, a];
  };
  const composite = (x, y, w, h, style) => {
    const [r, g, b, a] = rgba(style);
    if (a <= 0) return;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4, ba = buf[i + 3] / 255, oa = a + ba * (1 - a);
      buf[i] = Math.round((r * a + buf[i] * ba * (1 - a)) / oa);
      buf[i + 1] = Math.round((g * a + buf[i + 1] * ba * (1 - a)) / oa);
      buf[i + 2] = Math.round((b * a + buf[i + 2] * ba * (1 - a)) / oa);
      buf[i + 3] = Math.round(oa * 255);
    }
  };
  let subpaths = [];
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textBaseline: 'alphabetic',
    save() {}, restore() {},
    setTransform() {},
    fillRect: (x, y, w, h) => composite(x, y, w, h, ctx.fillStyle),
    fillText() {},
    beginPath() { subpaths = []; },
    moveTo(x, y) { subpaths.push([[x, y]]); },
    lineTo(x, y) { subpaths[subpaths.length - 1]?.push([x, y]); },
    stroke() {
      const lw = Math.max(1, Math.round(ctx.lineWidth));
      for (const sp of subpaths) for (let i = 1; i < sp.length; i++) {
        const [x0, y0] = sp[i - 1], [x1, y1] = sp[i];
        composite(Math.min(x0, x1), (y0 + y1) / 2 - lw / 2, Math.abs(x1 - x0), lw, ctx.strokeStyle); // 水平线足矣（lane 缘全部水平）
      }
    },
  };
  return { ctx, buf, px: (x, y) => { const i = (y * W + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; } };
}

// ---- 被测环境：双轨（trk1/trk2）音乐模式；几何与 app 一致的换算（rulerH 22 + segLane 28 + lane 64 + gap 12） ----
function makeEnv() {
  if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
  const proj = {
    meta: { title: 'd1' }, dancers: [], groups: [],
    stage: { widthM: 10, depthM: 6, backstageM: 0, gridM: 0.5, snap: false, audience: 'bottom' },
    audio: { bpm: 120, beatsPerBar: 4, firstBeatSec: 0, name: '', durationSec: 40 },
    timeline: {
      blocks: [{ holdBeats: 16, travelBeats: 8 }, { holdBeats: 16, travelBeats: 8 }, { holdBeats: 16, travelBeats: 0 }],
      countInBeats: 8, metronome: false,
      tracks: [{ id: 'trk1', name: '配乐', gain: 1, muted: false }, { id: 'trk2', name: '轨 2', gain: 1, muted: false }],
      audioClips: [],
    },
    formations: [
      { id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [] },
      { id: 'f2', name: 'B', color: '#64748b', positions: { a: { x: 2, y: 1 } }, merges: [] },
    ],
    media: {},
  };
  const W = 800, H = 260;
  const { ctx, px } = makeRasterCtx(W, H);
  const rec = { commits: 0, renders: 0, seeks: 0 };
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => proj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      onSelectFormation: () => {},
      mutate: () => {},
      // 忠实镜像 app 链路：commitEdit → store.commit 只入历史，不 emit、不渲染（js/store.js commit()）
      commitEdit: () => { rec.commits++; },
      seekBeat: () => { rec.seeks++; },
    },
  });
  const paint = () => { // 与 render() 的底色铺装同源（#0b1220 → drawAudioLane）
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);
    tl.drawAudioLane(ctx, proj, H);
  };
  // render 桩：node 无真实 canvas 2D——记录调用次数 + 同一光栅化器重绘（像素可比）
  tl.render = () => { rec.renders++; paint(); };
  tl.mode = 'music'; tl.rulerH = 22; tl._mLaneH = 64; tl.W = W; tl.H = H;
  // 采样点：lane0/lane1 中部（y=top+32，避开 ±1 缘线与 gain 把手带）；x=640 画布右段空白（无 clip）
  const S = { x: 640, y0: 50 + 32, y1: 126 + 32 }; // laneTopOf(i)=50+i*76
  return { tl, proj, rec, px, paint, S };
}

// 标定：同一光栅化器下「基线帧」与「hover 帧」的目标 lane 像素（自洽期望值，无舍入口径歧义）
function calibrate(e) {
  e.tl.dragHoverLane = null;
  e.paint();
  const base = e.px(e.S.x, e.S.y1);
  e.tl.dragHoverLane = 1; // 模拟 _applyClipMove 跨轨拖移中留下的目标 lane 高亮（=松手前画布最后一帧）
  e.paint();
  const hover = e.px(e.S.x, e.S.y1);
  assert.ok(hover[2] - base[2] > 8, `标定失败：hover 帧 B 通道应显著抬升（base=${base} hover=${hover}）`);
  return { base, hover };
}

test('G3D1-1 moved 跨轨提交：清零后必须补绘一帧，提交后画布=基线色（像素级，DEFECT-W3-D1 回归）', () => {
  const e = makeEnv();
  const { base, hover } = calibrate(e);
  // 松手：moved 提交路径（拖移中最后一帧已带高亮上画布；commitEdit 只入历史不渲染）
  e.tl.drag = { kind: 'clipMove', moved: true };
  e.tl._up();
  assert.equal(e.rec.commits, 1, 'moved 提交恰一次 commitEdit（历史语义不变）');
  // 补绘桩（根因口径）：moved 路径也必须补一帧——修复前跳过（renders=0），残留驻留画布
  assert.equal(e.rec.renders, 1, 'moved 路径清零后必须补一帧 render（修复前=0：无任何重绘）');
  assert.equal(e.tl.dragHoverLane, null, '松手后状态清零（伴随断言，非充分）');
  // 像素断言（本缺陷核心口径）：提交后的画布=基线色；修复前该处=hover 残留（reviewer 实测 [18,25,39]→[22,45,65]）
  assert.deepEqual(e.px(e.S.x, e.S.y1), base, `目标 lane 像素应回基线 ${JSON.stringify(base)}（残留则为 hover 色 ${JSON.stringify(hover)}）`);
  assert.deepEqual(e.px(e.S.x, e.S.y0).slice(0, 3), base.slice(0, 3), '非目标 lane0 恒基线（hover 只影响目标 lane）');
});

test('G3D1-2 非 moved 路径语义保持：hover 清零仍补一帧 render 回基线；单击不提交、定位播放头（C12）', () => {
  const e = makeEnv();
  const { base } = calibrate(e);
  e.tl.drag = { kind: 'clipMove', moved: false };
  e.tl._up();
  assert.equal(e.rec.commits, 0, '单击 clip 不提交历史');
  assert.equal(e.rec.seeks, 1, '单击 clip=定位播放头（既有 C12 语义保持）');
  assert.equal(e.rec.renders, 1, '非 moved 路径仍补一帧 render（既有语义保持）');
  assert.equal(e.tl.dragHoverLane, null);
  assert.deepEqual(e.px(e.S.x, e.S.y1), base, '补绘后目标 lane 回基线');
});
