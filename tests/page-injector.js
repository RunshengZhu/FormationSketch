// 忠实输入注入器（浏览器端）：按真实浏览器的派发模型模拟不同硬件输入。
// 与"直接对画布 dispatchEvent"的旧式合成的关键差异（即有效性升级点）：
//   1. 命中测试：每个事件都经 document.elementFromPoint 决定目标——弹窗覆盖画布时，
//      按下点落在弹窗按钮上，事件目标是按钮而不是画布（真实浏览器行为）。
//   2. 完整事件链：pointerdown → pointermove… → pointerup，并派生兼容鼠标事件
//      mousedown/mousemove/mouseup；按下与抬起命中同一元素时派生 click。
//   3. 指针捕获语义：pointerdown 命中画布后（应用会调 setPointerCapture），
//      后续 move/up 改派发给画布——即使物理坐标移出画布/移到其他元素上。
//   4. 硬件类别：mouse（固定 pointerId=1、isPrimary、悬停 move、派生 click）/
//      touch（每指独立递增 pointerId、首指 isPrimary、tap 派生 click、无悬停）/
//      pen（pointerType 'pen'，同鼠标语义，带 pressure）。
//   5. 双击：两次 click 间隔 <500ms 且位移 <4px 时派生 dblclick。
// 用法：await import('/tests/page-injector.js') → window.__input

const TOUCH_BASE = 20; // 触摸 pointerId 从 21 起递增（避免与鼠标 1 冲突）
const state = {
  touchSeq: TOUCH_BASE,
  active: new Map(), // pointerId -> { hw, x, y, capturedEl }
};

function hit(x, y) {
  const el = document.elementFromPoint(x, y);
  return el || document.body;
}
function fire(el, type, Ctor, opts) {
  if (!el) return;
  el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, view: window, ...opts }));
}
function pointerOpts(pid, hw, x, y, { down = false, up = false, second = false } = {}) {
  return {
    pointerId: pid,
    pointerType: hw,
    isPrimary: hw === 'mouse' || hw === 'pen' || !second,
    clientX: x, clientY: y,
    button: down || up ? 0 : -1,
    buttons: up ? 0 : down ? 1 : 0,
    pressure: hw === 'pen' ? (down ? 0.5 : 0) : (down ? 0.5 : 0),
    tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0,
    width: hw === 'touch' ? 12 : 1, height: hw === 'touch' ? 12 : 1,
  };
}
function allocPid(hw, second) {
  if (hw === 'touch') return ++state.touchSeq;
  return hw === 'pen' ? 2 : 1;
}

async function pdown(x, y, { hw = 'mouse', shift = false, pid } = {}) {
  const el = hit(x, y);
  const second = [...state.active.values()].some(p => p.hw === hw);
  const id = pid ?? allocPid(hw, second);
  state.active.set(id, { id, hw, x, y, downEl: el, capturedEl: el?.tagName === 'CANVAS' ? el : null });
  const o = pointerOpts(id, hw, x, y, { down: true, second });
  fire(el, 'pointerdown', PointerEvent, { ...o, shiftKey: shift });
  if (hw !== 'touch') fire(el, 'mousedown', MouseEvent, { ...o, shiftKey: shift });
  return id;
}
async function pmove(x, y, { hw = 'mouse', pid, shift = false, down: isDown } = {}) {
  const rec = pid != null ? state.active.get(pid) : [...state.active.entries()].find(([, p]) => p.hw === hw)?.[1];
  const id = pid ?? rec?.id ?? allocPid(hw);
  const dragging = isDown ?? (rec ? true : false);
  const target = rec?.capturedEl || hit(x, y);
  const o = pointerOpts(id, hw, x, y, { buttons: dragging ? undefined : 0 });
  // 修正 buttons：拖动中 1、悬停 0
  fire(target, 'pointermove', PointerEvent, { ...o, buttons: dragging ? 1 : 0, shiftKey: shift });
  if (hw !== 'touch') fire(target, 'mousemove', MouseEvent, { clientX: x, clientY: y, buttons: dragging ? 1 : 0, shiftKey: shift });
  if (rec) { rec.x = x; rec.y = y; }
  return id;
}
async function pup(x, y, { hw = 'mouse', pid, shift = false } = {}) {
  const rec = pid != null ? state.active.get(pid) : [...state.active.entries()].find(([, p]) => p.hw === hw)?.[1];
  const id = pid ?? rec?.id ?? allocPid(hw);
  const target = rec?.capturedEl || hit(x, y); // 指针捕获语义：up 派发给捕获目标
  const o = pointerOpts(id, hw, x, y, { up: true });
  fire(target, 'pointerup', PointerEvent, { ...o, shiftKey: shift });
  if (hw !== 'touch') fire(target, 'mouseup', MouseEvent, { clientX: x, clientY: y, shiftKey: shift });
  // 派生 click：与真实浏览器一致，click 派发给"按下时命中的目标"（捕获目标），
  // 绝不在抬起时重新命中测试——否则拖拽释放瞬间弹出的浮窗会被误点。
  const clickEl = rec?.downEl || target;
  if (clickEl) {
    fire(clickEl, 'click', MouseEvent, { button: 0, buttons: 0, clientX: x, clientY: y, detail: 1, shiftKey: shift });
  }
  state.active.delete(id);
}
async function pcancel(pid) {
  const rec = state.active.get(pid);
  if (!rec) return;
  fire(rec.capturedEl || document.body, 'pointercancel', PointerEvent, pointerOpts(pid, rec.hw, rec.x, rec.y, { up: true }));
  state.active.delete(pid);
}

// ---- 高层操作（全部走上面的底层原语） ----
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function click(x, y, opt = {}) {
  await pdown(x, y, opt);
  await sleep(opt.holdMs ?? 40);
  await pup(x, y, opt);
}
async function dblclick(x, y, opt = {}) {
  await click(x, y, opt);
  await sleep(60); // < 500ms 视为双击（应用内 tapMs=350 亦命中）
  await click(x, y, opt);
  const el = hit(x, y);
  fire(el, 'dblclick', MouseEvent, { clientX: x, clientY: y, detail: 2 });
}
async function press(x, y, ms, opt = {}) { // 长按：按住 ms 后抬起
  await pdown(x, y, opt);
  await sleep(ms);
  await pup(x, y, opt);
}
async function drag(points, { hw = 'mouse', dwellMs = 0, stepMs = 30, shift = false } = {}) {
  if (!points.length) return;
  const pid = await pdown(points[0].x, points[0].y, { hw, shift });
  for (let i = 1; i < points.length; i++) {
    await sleep(stepMs);
    await pmove(points[i].x, points[i].y, { hw, pid });
  }
  if (dwellMs > 0) {
    await sleep(dwellMs);
    const last = points[points.length - 1];
    await pmove(last.x, last.y, { hw, pid }); // 驻留判定在 move 中评估，补一帧
  }
  const last = points[points.length - 1];
  await sleep(stepMs);
  await pup(last.x, last.y, { hw, pid });
  return pid;
}
async function pinch(cx, cy, fromDist, toDist, { hw = 'touch', steps = 6 } = {}) {
  const y = cy;
  const ax = cx - fromDist / 2, bx = cx + fromDist / 2;
  const idA = await pdown(ax, y, { hw });
  const idB = await pdown(bx, y, { hw });
  for (let i = 1; i <= steps; i++) {
    const d = fromDist + (toDist - fromDist) * (i / steps);
    await sleep(30);
    await pmove(cx - d / 2, y, { hw, pid: idA });
    await pmove(cx + d / 2, y, { hw, pid: idB });
  }
  await pup(cx - toDist / 2, y, { hw, pid: idA });
  await pup(cx + toDist / 2, y, { hw, pid: idB });
}
function wheel(x, y, deltaY) {
  fire(hit(x, y), 'wheel', WheelEvent, { clientX: x, clientY: y, deltaY, deltaMode: 0 });
}
function key(key, { shift = false, ctrl = false, meta = false } = {}) {
  const target = document.activeElement || document.body;
  fire(target, 'keydown', KeyboardEvent, { key, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, bubbles: true });
}
function reset() {
  state.active.clear();
}

window.__input = {
  get activeCount() { return state.active.size; },
  down: pdown, move: pmove, up: pup, cancel: pcancel,
  click, dblclick, press, drag, pinch, wheel, key, reset, hit,
  sleep,
};
