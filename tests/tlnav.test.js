// build-44-tlnav：音乐模式触屏导航与触屏剪切入口 node 单测。
// 覆盖三缺陷的机器层：
//   D1 双指导航：质心平移/捏合缩放纯函数 + MusicTimeline 双指状态机（第二指中止单指、
//      平移写 #tl-scroll、缩放锚定质心；build-52-wavezoom F3 起 stage 同一手势语言——
//      原「编舞零进入 E-12 隔离」断言随双模式对齐裁定改写，见对应用例注）。
//   D2 触屏剪切：长按状态机（起按布防/移动取消/触发弹菜单/抬起与 pointercancel 取消）
//      + splitAtSec 接线（合法分割恰一条历史、非法落点零写入）+ 右键 info.timelineSec。
//   D3 音乐工具栏：style.css 静态断言（桌面 overflow-x + 细滚条、移动端隐藏滚条红线不破、
//      子项 flex:none、#tl-scroll 音乐模式作用域滚条）。
// DOM 桩沿用 tests/ux-conflict-fixes.test.js 的 fakeEl 口径（无真实 canvas 2D，render 桩替身）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MusicTimeline, clampNum, pinchCentroid, pinchDist, pinchZoomFactor, twoPointerGesture,
  TP_SLOP_PX, TP_LP_MS } from '../js/timeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
const winHs = {};
window.addEventListener = (t, fn) => { (winHs[t] = winHs[t] || []).push(fn); }; // _up 挂 window：捕获以便派发

function fakeEl() {
  const hs = {};
  return {
    _hs: hs,
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 200 }),
    style: {},
  };
}
const mkClip = (id, start, len) => ({
  id, timelineStartSec: start, srcStartSec: 0, lengthSec: len,
  gain: 1, fadeInSec: 0, fadeOutSec: 0,
});
function makeProj() {
  return {
    audio: { bpm: 120, beatsPerBar: 4, firstBeatSec: 0, name: '', durationSec: 40 },
    timeline: {
      blocks: [{ holdBeats: 16, travelBeats: 8 }],
      tags: [],
      tracks: [{ id: 'trk1', name: '配乐', gain: 1, muted: false }],
      audioClips: [mkClip('c1', 0, 10)],
    },
    formations: [{ id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [] }],
    media: { assets: [{ id: 'a1', name: '曲一', durationSec: 40 }] },
  };
}
// 标准音乐模式实例：secPerPx 显式设定（pps=20，绕开自适应几何）；render 桩计数
function makeTL(proj = makeProj()) {
  winHs.pointerup = []; // 每实例独立捕获 _up 派发口（防跨用例陈旧 handler）
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  const rec = { muts: [], labels: [], menus: [], toasts: [], seeks: [], commits: [], renders: 0, pauses: 0 };
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => proj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      canEdit: () => true,
      onSelectFormation: () => {},
      mutate: fn => { fn(proj); rec.muts.push(null); },
      mutateQuiet: fn => { fn(proj); rec.muts.push(null); }, // 生产=store.mutateQuiet（跳过 emit）
      mutateLabeled: (fn, label) => { fn(proj); rec.labels.push(label); },
      commitEdit: label => { rec.commits.push(label); },
      seekBeat: b => { rec.seeks.push(b); },
      toast: m => { rec.toasts.push(m); },
      pauseIfPlaying: () => { rec.pauses++; },
      onClipContextMenu: info => { rec.menus.push(info); },
      onTimeSelection: () => {},
    },
  });
  tl.mode = 'music';
  tl.secPerPx = 0.05; // pps=20
  tl.rulerH = 22;
  tl.render = () => { rec.renders++; };
  return { tl, cv, sc, proj, rec };
}

// ---------- D1 纯函数：质心 / 距离 / 钳制 / 捏合比 ----------
test('D1 纯函数：质心、指距、钳制', () => {
  assert.deepEqual(pinchCentroid(0, 0, 100, 40), { x: 50, y: 20 });
  assert.equal(pinchDist(0, 0, 3, 4), 5);
  assert.equal(clampNum(5, 0, 3), 3);
  assert.equal(clampNum(-1, 0, 3), 0);
  assert.equal(clampNum(2, 0, 3), 2);
});
test('D1 纯函数：捏合比钳制与异常退化为 1', () => {
  const lo = 1 / 1.35, hi = 1.35;
  assert.equal(pinchZoomFactor(100, 200), hi);  // 双倍张开 → 钳到单帧上限
  assert.equal(pinchZoomFactor(200, 100), lo);  // 收拢一半 → 钳到单帧下限
  assert.equal(pinchZoomFactor(120, 120), 1);   // 不动 → 1
  assert.equal(pinchZoomFactor(4, 8), 1);       // 起始指距低于最小值（抖动）→ 不缩放
  assert.equal(pinchZoomFactor(100, 0), 1);     // 零指距防除零
  assert.equal(pinchZoomFactor(NaN, 10), 1);
});
test('D1 纯函数：两指几何 → 单帧手势（位移 + 缩放）；缺指返回 null', () => {
  const g = twoPointerGesture({ ax: 0, ay: 0, bx: 100, by: 0 }, { ax: 30, ay: 10, bx: 130, by: 10 });
  assert.deepEqual({ dx: g.dx, dy: g.dy }, { dx: 30, dy: 10 });
  assert.equal(g.zoom, 1); // 指距不变（100→100）只平移
  assert.equal(twoPointerGesture(null, { ax: 0, ay: 0, bx: 1, by: 1 }), null);
});

// ---------- D1 双指状态机 ----------
test('D1 第二指落下：中止单指状态机（scrub 拖拽置空、不重复 seek），进入双指手势', () => {
  const { tl, cv, rec } = makeTL();
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 1, pointerType: 'touch' });
  assert.equal(tl.drag && tl.drag.kind, 'scrub'); // 单指先行语义不变
  assert.equal(rec.seeks.length, 1);
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 50, pointerId: 2, pointerType: 'touch' });
  assert.equal(tl.drag, null);                    // 与 pointercancel 同路径清理
  assert.ok(tl._tp, '双指手势应激活');
  assert.deepEqual([tl._tp.ax, tl._tp.ay, tl._tp.bx, tl._tp.by], [100, 10, 200, 50]);
  assert.equal(rec.seeks.length, 1, '第二指落下不得触发第二次 seek');
});

test('D1 双指质心平移写滚动容器 + 捏合比锚定质心缩放', () => {
  const { tl, cv, sc } = makeTL();
  const zooms = [];
  tl.zoomAt = (f, x) => zooms.push([f, x]);
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 1, pointerType: 'touch' });
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 50, pointerId: 2, pointerType: 'touch' });
  sc.scrollLeft = 100; sc.scrollTop = 5;
  // 仅第二指移动：质心 (+5, 0) → scrollLeft -= 5；指距 107.70→117.05，比 1.0865（未触顶）
  cv._hs.pointermove[0]({ clientX: 210, clientY: 50, pointerId: 2, pointerType: 'touch' });
  assert.equal(sc.scrollLeft, 95);
  assert.equal(sc.scrollTop, 5);
  assert.equal(zooms.length, 1);
  assert.ok(Math.abs(zooms[0][0] - (117.0470 / 107.7033)) < 1e-3, `捏合比实测 ${zooms[0][0]}`);
  assert.equal(zooms[0][1], 155, '缩放锚 = 双指质心 clientX');
  // 反向收拢过快：钳到单帧下限
  cv._hs.pointermove[0]({ clientX: 105, clientY: 50, pointerId: 2, pointerType: 'touch' });
  assert.equal(zooms[1][0], 1 / 1.35);
});
test('D1 双指手势中单指 move 被手势消费（不触发 scrub 二次 seek）；抬一指后手势结束', () => {
  const { tl, cv, sc } = makeTL();
  let seeks = 0;
  tl.hooks.seekBeat = () => { seeks++; };
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 1, pointerType: 'touch' });
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 50, pointerId: 2, pointerType: 'touch' });
  cv._hs.pointermove[0]({ clientX: 160, clientY: 10, pointerId: 1, pointerType: 'touch' }); // 第一指也喂手势
  assert.equal(seeks, 1, '手势进行中第一指 move 不得再 scrub');
  winHs.pointerup[0]({ pointerId: 1 });
  assert.equal(tl._tp, null, '抬一指（剩单指）手势结束');
  assert.equal(tl._tpPts.size, 1);
  // 残余指 move：不崩溃、不恢复单指拖拽语义（drag 已在中止时置空）
  cv._hs.pointermove[0]({ clientX: 170, clientY: 10, pointerId: 1, pointerType: 'touch' });
  assert.equal(tl.drag, null);
  assert.equal(seeks, 1);
  winHs.pointerup[0]({ pointerId: 2 }); // 残余指（第二指）抬起
  assert.equal(tl._tpPts.size, 0);
});
test('D1 编舞模式（stage）：双指进入手势=平移+捏合（build-52-wavezoom F3 对齐改写；单指语义不变）', () => {
  // 改写注明（build-52-wavezoom F3 双模式操作对齐裁定）：原断言「编舞模式不进双指手势
  // （E-12 隔离）」随对齐项「横滚（双指平移）/缩放（双指捏合）两模式同语言」退役——
  // _down 的 music 门控放开为两模式共用同一 _enterTp/_tpMove（零分叉复用）。
  // 单指语义原样保留（第一指仍走既有 scrub/拖拽，第二指落下才中止转手势——下方一并断言）。
  const { tl, cv } = makeTL();
  tl.mode = 'stage';
  let seeks = 0;
  tl.hooks.seekBeat = () => { seeks++; };
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 1, pointerType: 'touch' });
  assert.equal(seeks, 1, '第一指=既有单指语义（y=10 尺规 scrub seek）不受影响');
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 50, pointerId: 2, pointerType: 'touch' });
  assert.ok(tl._tp, '编舞模式第二指落下激活双指手势（与音乐模式同一实现）');
  assert.equal(tl.drag, null, '单指状态机按 pointercancel 同路径中止');
  const sl0 = 300;
  tl.scroll.scrollLeft = sl0;
  cv._hs.pointermove[0]({ clientX: 140, clientY: 10, pointerId: 1, pointerType: 'touch' });
  cv._hs.pointermove[0]({ clientX: 240, clientY: 50, pointerId: 2, pointerType: 'touch' });
  assert.equal(tl.scroll.scrollLeft, sl0 - 40, '质心平移跟手（两指同移 +40px → scrollLeft −40，指距不变零缩放）');
  winHs.pointerup[0]({ pointerId: 1 });
  assert.equal(tl._tp, null, '抬一指（剩单指）手势结束');
  assert.equal(seeks, 1, '手势进行中残余指 move 不再 scrub');
});
test('D1 pointercancel：双指手势与长按一并作废（脏指针防护）', () => {
  const { tl, cv } = makeTL();
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 1, pointerType: 'touch' });
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 50, pointerId: 2, pointerType: 'touch' });
  tl._armLongPress({ pointerId: 9, clientX: 0, clientY: 0 }, { clip: { id: 'c1' } }, 1);
  cv._hs.pointercancel[0]();
  assert.equal(tl._tp, null);
  assert.equal(tl._tpPts.size, 0);
  assert.equal(tl._lp, null);
});

// ---------- D2 长按状态机与剪切入口 ----------
test('D2 起按布防：触屏命中 clip 布长按并冻结拖拽（pending）；鼠标/剃刀不布', () => {
  const { tl, proj } = makeTL();
  tl._audioHit = () => ({ clip: proj.timeline.audioClips[0], part: 'body' });
  const ev = { clientX: 100, clientY: 82, pointerId: 1, pointerType: 'touch' };
  tl._audioDown(ev, 100, 82, proj.timeline.audioClips);
  assert.ok(tl._lp, '触屏应布长按');
  assert.equal(tl._lp.clipId, 'c1');
  assert.equal(tl._lp.sec, 5, '长按记录按压点秒位（100px / pps20）');
  assert.equal(tl.drag.pending, true, '拖拽待定冻结');
  // 鼠标：不布长按、无 pending（先清上一子用例的 LP——鼠标按下本就不该接管他指的计时）
  tl._lpCancel();
  tl._audioDown({ clientX: 100, clientY: 82, pointerId: 2, pointerType: 'mouse' }, 100, 82, proj.timeline.audioClips);
  assert.equal(tl._lp, null);
  assert.equal(tl.drag.pending, undefined);
  // 剃刀：点击即分割，不布长按
  tl._lpCancel();
  tl.razor = true;
  tl._audioDown(ev, 100, 82, proj.timeline.audioClips);
  assert.equal(tl._lp, null);
});
test('D2 待定拖拽：slop 内静止不动数据；超阈取消长按并转正拖拽（clip 实移）', () => {
  const { tl, cv, proj } = makeTL();
  tl._audioHit = () => ({ clip: proj.timeline.audioClips[0], part: 'body' });
  tl._audioDown({ clientX: 100, clientY: 82, pointerId: 1, pointerType: 'touch' }, 100, 82, proj.timeline.audioClips);
  const start0 = proj.timeline.audioClips[0].timelineStartSec;
  // 位移 4.5px ≤ 8：仍待定，长按存活，数据零写入
  cv._hs.pointermove[0]({ clientX: 103, clientY: 84, pointerId: 1, pointerType: 'touch' });
  assert.equal(tl.drag.pending, true);
  assert.ok(tl._lp, 'slop 内长按不得取消');
  assert.equal(proj.timeline.audioClips[0].timelineStartSec, start0, '静止微抖不偷移 clip');
  // 位移 > TP_SLOP_PX：长按取消、拖拽转正并真正移动 clip
  cv._hs.pointermove[0]({ clientX: 130, clientY: 90, pointerId: 1, pointerType: 'touch' });
  assert.equal(tl.drag.pending, false);
  assert.equal(tl._lp, null, '超阈=拖拽意图，长按取消');
  assert.ok(proj.timeline.audioClips[0].timelineStartSec !== start0, '转正后拖移生效');
});
test('D2 长按触发：弹剪辑菜单（clipId + timelineSec），拖拽状态机作废；真实计时器端到端', async () => {
  const { tl, proj, rec } = makeTL();
  tl._audioHit = () => ({ clip: proj.timeline.audioClips[0], part: 'body' });
  tl._audioDown({ clientX: 100, clientY: 82, pointerId: 1, pointerType: 'touch' }, 100, 82, proj.timeline.audioClips);
  assert.ok(tl._lp.timer > 0, '已布真实计时器');
  await new Promise(r => setTimeout(r, TP_LP_MS + 60));
  assert.equal(tl._lp, null);
  assert.equal(rec.menus.length, 1);
  assert.equal(rec.menus[0].clipId, 'c1');
  assert.equal(rec.menus[0].timelineSec, 5);
  assert.equal(tl.drag, null, '触发后该指拖拽语义作废');
  // 触发后的抬起不再产生任何单指行为（不 seek 不提交）
  const seeks = rec.seeks.length, commits = rec.commits.length;
  winHs.pointerup[0]({ pointerId: 1 });
  assert.equal(rec.seeks.length, seeks);
  assert.equal(rec.commits.length, commits);
});
test('D2 取消路径：抬起作废长按；过期计时器（已换手势）不生效', () => {
  const { tl, cv, proj, rec } = makeTL();
  tl._audioHit = () => ({ clip: proj.timeline.audioClips[0], part: 'body' });
  tl._audioDown({ clientX: 100, clientY: 82, pointerId: 1, pointerType: 'touch' }, 100, 82, proj.timeline.audioClips);
  const lp = tl._lp;
  winHs.pointerup[0]({ pointerId: 1 }); // 快速点按：< 550ms 抬起
  assert.equal(tl._lp, null, '抬起取消长按（点按语义不受影响）');
  lp.timer = 0; lp.clipId = 'stale';
  tl._lpFire(lp); // 手工触发已取消的旧上下文：应被身份比对拦截
  assert.equal(rec.menus.length, 0);
  // 短点按 clip = 仅选中、不定位播放头（build-46 验收反馈三：定位与 clip 点击解耦，C12 保留于 lane 空白）
  const s0 = rec.seeks.length;
  tl._audioDown({ clientX: 100, clientY: 82, pointerId: 2, pointerType: 'touch' }, 100, 82, proj.timeline.audioClips);
  winHs.pointerup[0]({ pointerId: 2 });
  assert.equal(rec.seeks.length, s0, '短点按 clip 不定位播放头（定位语义已解耦）');
});
test('D2 右键菜单：info 携带 timelineSec；长按触发后短窗吞原生 contextmenu 防双菜单', () => {
  const { tl, cv, rec } = makeTL();
  // 长按刚触发（_lpFiredAt=now）→ 紧随的原生 contextmenu 被吞
  tl._lpFiredAt = performance.now();
  let prevented = 0;
  cv._hs.contextmenu[0]({ clientX: 100, clientY: 82, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(rec.menus.length, 0, '抑制窗内不重复弹菜单');
  // 无长按：正常走右键菜单且 info.timelineSec = 画布 x → 秒（100px / pps20 = 5s）
  tl._lpFiredAt = -1e9;
  cv._hs.contextmenu[0]({ clientX: 100, clientY: 82, preventDefault: () => { prevented++; } });
  assert.equal(rec.menus.length, 1);
  assert.equal(rec.menus[0].clipId, 'c1');
  assert.equal(rec.menus[0].timelineSec, 5);
});

// ---------- D2 splitAtSec 接线 ----------
test('D2 splitAtSec：合法落点恰一条「分割音频剪辑」；非法落点/编辑锁零写入', () => {
  const { tl, proj, rec } = makeTL();
  assert.equal(tl.splitAtSec('c1', 4), true);
  assert.deepEqual(rec.labels, ['分割音频剪辑']);
  assert.equal(proj.timeline.audioClips.length, 2, 'clip 一分为二');
  assert.equal(proj.timeline.audioClips[1].timelineStartSec, 4);
  // 落点贴左缘（≤ start+MIN_CLIP_DUR）：toast + 零历史 + 零写入
  const labels = rec.labels.length;
  const nClips = proj.timeline.audioClips.length;
  assert.equal(tl.splitAtSec(proj.timeline.audioClips[0].id, 0.001), false);
  assert.equal(rec.labels.length, labels, '不产生空历史');
  assert.equal(proj.timeline.audioClips.length, nClips);
  assert.ok(rec.toasts.length >= 1, '给出不可分割提示');
  // 编辑锁：拒绝 + 零写入
  tl.hooks.canEdit = () => false;
  assert.equal(tl.splitAtSec(proj.timeline.audioClips[0].id, 3), false);
  assert.equal(rec.labels.length, labels);
  // 未知 clip：静默拒绝
  assert.equal(tl.splitAtSec('nope', 3), false);
});
test('D2 模式切换/项目切换：长按计时与双指手势作废', () => {
  const { tl, cv } = makeTL();
  cv._hs.pointerdown[0]({ clientX: 100, clientY: 10, pointerId: 1, pointerType: 'touch' });
  cv._hs.pointerdown[0]({ clientX: 200, clientY: 50, pointerId: 2, pointerType: 'touch' });
  tl._armLongPress({ pointerId: 9, clientX: 0, clientY: 0 }, { clip: { id: 'c1' } }, 1);
  tl.setMode('stage');
  assert.equal(tl._lp, null, '切模式清长按');
  assert.equal(tl._tp, null, '切模式清双指');
  assert.equal(tl._tpPts.size, 0);
});

// ---------- D3 音乐工具栏溢出可达（style.css 静态断言） ----------
test('D3 style.css：桌面工具条 overflow-x + 子项 flex:none + 桌面细滚条（min-width 互补区间）', () => {
  const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
  assert.match(css, /#music-toolbar\{[^}]*overflow-x:auto/, '桌面也内滚（iPad 裁切根因）');
  assert.match(css, /#music-toolbar > \*\{flex:none\}/, '子项防挤压');
  assert.match(css, /#music-toolbar > \.spacer\{flex:1 1 0px/, '收尾撑杆溢出时自然收 0');
  // 桌面可见细滚条必须收在 min-width:1024px（与移动端 max-width:1023.5px 互补，
  // 避免同特异度后写规则覆盖移动端隐藏滚条红线）
  const mw = css.match(/@media \(min-width:1024px\)\{([\s\S]*?)\n\}/);
  assert.ok(mw, '应存在 min-width:1024px 桌面滚条块');
  assert.match(mw[1], /#editor-view\[data-uimode="music"\] #music-toolbar\{scrollbar-width:thin/);
  assert.match(mw[1], /#editor-view\[data-uimode="music"\] #music-toolbar::-webkit-scrollbar\{width:8px;height:8px\}/);
});
test('D3 style.css：移动端隐藏滚条红线不破（C-09a 口径）+ 工具条下拉 fixed 逃逸裁切', () => {
  const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
  assert.match(css, /#editor-view\[data-uimode="music"\] #music-toolbar\{overflow-x:auto;scrollbar-width:none\}/);
  assert.match(css, /#editor-view\[data-uimode="music"\] #music-toolbar::-webkit-scrollbar\{display:none\}/);
  assert.match(css, /#music-toolbar \.dd-menu\{position:fixed\}/, '内滚容器会裁 absolute 下拉，改 fixed 摆位');
});
test('D1-b style.css：#tl-scroll 细滚条全模式常显（build-81：编舞侧滚动条可见性修复）', () => {
  const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
  assert.match(css, /#tl-scroll\{scrollbar-width:thin;scrollbar-color:var\(--dim\) transparent\}/);
  assert.match(css, /#tl-scroll::-webkit-scrollbar\{width:12px;height:12px\}/); // build-83 加高
  assert.match(css, /#tl-scroll::-webkit-scrollbar-thumb\{background:var\(--line\);border-radius:4px\}/);
  // 旧 music-only 作用域退役（overlay 滚动条环境下编舞侧滚动条闲置隐形——用户实测）
  assert.doesNotMatch(css, /#editor-view\[data-uimode="music"\] #tl-scroll\{scrollbar-width/);
});

// ---------- D2 main.js 接线静态断言 ----------
test('D2 main.js：showClipMenu 接收 timelineSec 并提供「在此处分割」项', () => {
  const main = readFileSync(join(root, 'js', 'main.js'), 'utf8');
  assert.match(main, /function showClipMenu\(\{ clipId, screenX, screenY, timelineSec \}\)/);
  assert.match(main, /timelineSec != null \? \[\{ label: '在此处分割', fn: \(\) => musicTl\.splitAtSec\(clipId, timelineSec\) \}\]/);
  assert.match(main, /分割于播放头\(K\)/, '既有播放头分割入口保留');
});
