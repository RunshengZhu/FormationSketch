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
//   6. 键位/修饰：down/move/up 支持 button（0=左 1=中 2=右，buttons 掩码与
//      auxclick 派发跟随，中键不派生 click——Chrome 行为）；键盘 key()/keyUp()
//      支持 code（缺省按物理键位推导：' '→Space、单字符→KeyX、其余同名）。
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
// 按键掩码（W3C PointerEvent.buttons）：左=1、右=2、中=4
const BTN_MASK = { 0: 1, 1: 4, 2: 2 };
function pointerOpts(pid, hw, x, y, { down = false, up = false, second = false, button = 0 } = {}) {
  return {
    pointerId: pid,
    pointerType: hw,
    isPrimary: hw === 'mouse' || hw === 'pen' || !second,
    clientX: x, clientY: y,
    button: down || up ? button : -1,
    buttons: up ? 0 : down ? (BTN_MASK[button] ?? 1) : 0,
    pressure: hw === 'pen' ? (down ? 0.5 : 0) : (down ? 0.5 : 0),
    tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0,
    width: hw === 'touch' ? 12 : 1, height: hw === 'touch' ? 12 : 1,
  };
}
function allocPid(hw, second) {
  if (hw === 'touch') return ++state.touchSeq;
  return hw === 'pen' ? 2 : 1;
}

async function pdown(x, y, { hw = 'mouse', shift = false, pid, button = 0 } = {}) {
  const el = hit(x, y);
  const second = [...state.active.values()].some(p => p.hw === hw);
  const id = pid ?? allocPid(hw, second);
  state.active.set(id, { id, hw, x, y, btn: button, downEl: el, capturedEl: el?.tagName === 'CANVAS' ? el : null });
  const o = pointerOpts(id, hw, x, y, { down: true, second, button });
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
  // 修正 buttons：拖动中=按下键位掩码（左 1 / 中 4）、悬停 0
  fire(target, 'pointermove', PointerEvent, { ...o, buttons: dragging ? (BTN_MASK[rec?.btn ?? 0] ?? 1) : 0, shiftKey: shift });
  if (hw !== 'touch') fire(target, 'mousemove', MouseEvent, { clientX: x, clientY: y, buttons: dragging ? (BTN_MASK[rec?.btn ?? 0] ?? 1) : 0, shiftKey: shift });
  if (rec) { rec.x = x; rec.y = y; }
  return id;
}
async function pup(x, y, { hw = 'mouse', pid, shift = false, button } = {}) {
  const rec = pid != null ? state.active.get(pid) : [...state.active.entries()].find(([, p]) => p.hw === hw)?.[1];
  const id = pid ?? rec?.id ?? allocPid(hw);
  const target = rec?.capturedEl || hit(x, y); // 指针捕获语义：up 派发给捕获目标
  const btn = button ?? rec?.btn ?? 0; // 松开键位=按下时记录的键位（忠实硬件）
  const o = pointerOpts(id, hw, x, y, { up: true, button: btn });
  fire(target, 'pointerup', PointerEvent, { ...o, shiftKey: shift });
  if (hw !== 'touch') fire(target, 'mouseup', MouseEvent, { ...o, shiftKey: shift });
  // 派生 click/auxclick：与真实浏览器一致，click 只属主键（button 0）且派发给
  // "按下时命中的目标"（捕获目标），绝不在抬起时重新命中测试——否则拖拽释放瞬间
  // 弹出的浮窗会被误点；中/右键派发 auxclick（Chrome 行为）。
  const clickEl = rec?.downEl || target;
  if (clickEl) {
    if (btn === 0) fire(clickEl, 'click', MouseEvent, { button: 0, buttons: 0, clientX: x, clientY: y, detail: 1, shiftKey: shift });
    else fire(clickEl, 'auxclick', MouseEvent, { button: btn, buttons: 0, clientX: x, clientY: y, detail: 1, shiftKey: shift });
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
// 右键（Chrome 桌面序列）：pointerdown(button=2) → mousedown(button=2) → contextmenu →
// pointerup/mouseup(button=2) + auxclick。应用在 canvas 上拦 contextmenu 弹上下文菜单；
// 手势机对 button=2 的 down 早退（不进 pointers），故该链不会启动任何手势。
async function contextMenu(x, y, opt = {}) {
  const id = await pdown(x, y, { ...opt, button: 2 });
  await sleep(opt.holdMs ?? 40);
  fire(hit(x, y), 'contextmenu', MouseEvent, { button: 2, buttons: 2, clientX: x, clientY: y });
  await sleep(opt.holdMs ?? 40);
  await pup(x, y, { ...opt, button: 2, pid: id });
  return id;
}
function contextEvent(x, y) { // 仅派发 contextmenu 事件（无按键链）——「左键手势进行中」子情形专用：
  // 真实鼠标同 pointerId 复用会污染进行中的左键拖拽记录，此处只送菜单事件本身。
  fire(hit(x, y), 'contextmenu', MouseEvent, { button: 2, buttons: 2, clientX: x, clientY: y });
}
async function drag(points, { hw = 'mouse', dwellMs = 0, stepMs = 30, shift = false, button = 0 } = {}) {
  if (!points.length) return;
  const pid = await pdown(points[0].x, points[0].y, { hw, shift, button });
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
function key(key, { shift = false, ctrl = false, meta = false, code } = {}) {
  keyEv('keydown', key, { shift, ctrl, meta, code });
}
function keyUp(key, { shift = false, ctrl = false, meta = false, code } = {}) {
  keyEv('keyup', key, { shift, ctrl, meta, code });
}
function keyEv(type, key, { shift, ctrl, meta, code } = {}) {
  const target = document.activeElement || document.body;
  // code 缺省按物理键位推导：单字符 → 'KeyX'；空格 → 'Space'；其余（Escape/ArrowRight…）同名
  const cd = code ?? (key === ' ' ? 'Space' : key.length === 1 ? 'Key' + key.toUpperCase() : key);
  fire(target, type, KeyboardEvent, { key, code: cd, shiftKey: shift, ctrlKey: ctrl, metaKey: meta, bubbles: true });
}
function reset() {
  state.active.clear();
}

window.__input = {
  get activeCount() { return state.active.size; },
  down: pdown, move: pmove, up: pup, cancel: pcancel,
  click, dblclick, press, drag, pinch, wheel, key, keyUp, contextMenu, contextEvent, reset, hit,
  sleep,
};
