// 纯手势状态机：不依赖 DOM/渲染/存储，可在 node 中用假时钟直接驱动（tests/gesture.test.js）。
// stage.js 是它的薄客户端：把 PointerEvent 翻译成 down/move/up 事件对象，
// 并执行状态机通过 host 吐出的命令（选择/移动/回滚/浮窗/框选/平移缩放）。
//
// 状态转移总览：
//   IDLE  --down(把手)--> FACE      --up(有变化)--> 提交"调整朝向"
//   IDLE  --down(舞者)--> PENDING   --位移>晋升阈值--> DRAG --up--> 提交"移动舞者"（落点重叠→合并确认浮窗）
//                                    --按住长按时长且位移小--> MENU（单元浮窗）
//                                    --up--> TAP（仅选择；落点重叠同样弹合并确认）
//   IDLE  --down(空白·鼠标)--> BOX  --up--> 框内全选（<最小边长视为点击=清空）
//   IDLE  --down(空白·触摸)--> PAN  --move--> panBy
//   任意  --第二指按下--> PINCH（进行中的 DRAG 立即回滚）
//   MENU  --任意按下--> 退出浮窗并吞掉该次按下（点外部=取消）
//   DRAG/PENDING --Escape(cancel)--> 回滚到按下前快照，不产生历史

// 所有手势阈值唯一出处（单位：米 / 毫秒 / client 像素）
export const TH = {
  promoteM: 0.06,  // PENDING→DRAG 晋升位移
  mergeM: 0.55,    // 松手落点与他人触发合并确认的距离
  showM: 0.8,      // 组队徽标呈示距离（与渲染 MERGE_DIST 一致，长按浮窗要求两人在此距离内）
  lpMs: 500,       // 长按触发时长
  lpCancelPx: 8,   // 长按取消位移（client px）
  boxMinPx: 6,     // 框选最小边长（client px），小于视为点击
};

export function createGestureMachine(host) {
  // host 查询：readOnly() hitHandle(px,py) hitDancer(x,y) toStage(px,py)
  //            selection():string[] multiSelect():bool
  //            formation():{positions,merges}|null stage() fmtIndex():number now():ms
  // host 命令：select(ids,{add,toggleOff}) applyPositions({id:{x,y,facing?}})
  //            rollback({id:{x,y}}) commit(label) showMenu({mode,ids,style,at,formationIndex})
  //            hideMenu() box(rect|null) panBy(dx,dy) zoomAt(cx,cy,f) requestDraw()
  const setT = host.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = host.clearTimeout || (id => clearTimeout(id));

  let state = 'IDLE';
  let g = null;              // 当前手势上下文
  let pinch = null;          // {dist,cx,cy}
  const pointers = new Map(); // pointerId -> {x,y} client px
  let lpTimer = null;        // 长按定时器句柄

  const firstTwo = () => [...pointers.values()].slice(0, 2);
  function armLP() {
    clearT(lpTimer); lpTimer = null;
    lpTimer = setT(() => {
      lpTimer = null;
      if (state !== 'PENDING' || !g) return;
      const fmt = host.formation();
      const m = fmt && (fmt.merges || []).find(x => x.a === g.id || x.b === g.id);
      if (!m) return; // 未合并舞者长按：无动作，保持等待拖动/单击
      const a = fmt.positions[m.a], b = fmt.positions[m.b];
      enterMenu({
        mode: 'unit', ids: [m.a, m.b], style: m.style,
        at: a && b && Math.hypot(a.x - b.x, a.y - b.y) <= TH.showM ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
        formationIndex: host.fmtIndex(),
      });
    }, TH.lpMs);
  }
  function disarmLP() { if (lpTimer) { clearT(lpTimer); lpTimer = null; } }

  function enterMenu(payload) {
    state = 'MENU'; g = null;
    host.showMenu(payload);
    host.requestDraw();
  }
  function exitMenu() { host.hideMenu(); state = 'IDLE'; g = null; }
  function endGesture() { state = 'IDLE'; g = null; }

  // 拖拽中按 snap 网格计算整组目标位置（含舞台+后台钳制）
  function computeTargets(start, dx, dy) {
    const stg = host.stage();
    const bs = stg.backstageM ?? 0;
    let ddx = dx, ddy = dy;
    if (stg.snap) {
      const gs = stg.gridM;
      const base = start[Object.keys(start)[0]];
      if (base) {
        ddx = Math.round((base.x + dx) / gs) * gs - base.x;
        ddy = Math.round((base.y + dy) / gs) * gs - base.y;
      }
    }
    const out = {};
    for (const [id, s0] of Object.entries(start)) {
      out[id] = {
        x: Math.min(stg.widthM + bs, Math.max(-bs, s0.x + ddx)),
        y: Math.min(stg.depthM + bs, Math.max(-bs, s0.y + ddy)),
      };
    }
    return out;
  }

  // id 与他人重叠（<mergeM）且尚未结成舞伴 → 返回对方 id
  function overlapOther(fmt, id) {
    const p = fmt.positions[id];
    if (!p) return null;
    for (const [oid, q] of Object.entries(fmt.positions)) {
      if (oid === id) continue;
      if (Math.hypot(q.x - p.x, q.y - p.y) < TH.mergeM) {
        const already = (fmt.merges || []).some(m => (m.a === id && m.b === oid) || (m.a === oid && m.b === id));
        if (!already) return oid;
      }
    }
    return null;
  }

  function abortToPinch() {
    disarmLP();
    if (state === 'DRAG' && g) host.rollback(g.start); // 半途拖拽回滚，不产生历史
    if (state === 'BOX') host.box(null);
    const [a, b] = firstTwo();
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    g = null; state = 'PINCH';
  }

  // e = { pointerId, px, py, shift, touch }（px/py 为 client 坐标）
  function down(e) {
    if (state === 'MENU') { exitMenu(); return; } // 点外部=取消，并吞掉这次按下
    pointers.set(e.pointerId, { x: e.px, y: e.py });
    if (pointers.size === 2) { abortToPinch(); return; }
    if (pointers.size > 2) return;
    if (host.readOnly()) return;
    // 命中优先级：朝向把手 > 舞者 > 空白
    if (host.hitHandle(e.px, e.py)) {
      g = { kind: 'FACE', id: host.selection()[0], changed: false };
      state = 'FACE';
      return;
    }
    const s = host.toStage(e.px, e.py);
    const hit = host.hitDancer(s.x, s.y);
    if (hit) {
      const sel = host.selection();
      let selectMod = false;
      if (!sel.includes(hit)) { host.select([hit], { add: !!(e.shift || host.multiSelect()) }); selectMod = true; }
      else if (e.shift) { host.select([hit], { add: true, toggleOff: true }); return; }
      const fmt = host.formation();
      const start = {};
      for (const id of host.selection()) {
        const p = fmt?.positions[id];
        if (p) start[id] = { x: p.x, y: p.y };
      }
      g = { kind: 'PENDING', id: hit, startS: s, startPx: { x: e.px, y: e.py }, start, selectMod };
      state = 'PENDING';
      armLP();
    } else if (!e.touch) {
      g = { kind: 'BOX', x0: e.px, y0: e.py, x1: e.px, y1: e.py };
      state = 'BOX';
      host.box({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
    } else {
      g = { kind: 'PAN', lastX: e.px, lastY: e.py };
      state = 'PAN';
    }
  }

  function move(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.px, y: e.py });
    if (state === 'MENU') return;
    if (state === 'PINCH') {
      if (pointers.size < 2 || !pinch) return;
      const [a, b] = firstTwo();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (pinch.dist > 8 && d > 0) host.zoomAt(cx, cy, d / pinch.dist); // 防零距离产生 Infinity
      host.panBy(cx - pinch.cx, cy - pinch.cy);
      pinch = { dist: d, cx, cy };
      return;
    }
    if (!g) return;
    if (g.kind === 'PENDING') {
      if (Math.hypot(e.px - g.startPx.x, e.py - g.startPx.y) > TH.lpCancelPx) disarmLP();
      const sNow = host.toStage(e.px, e.py);
      if (Math.hypot(sNow.x - g.startS.x, sNow.y - g.startS.y) > TH.promoteM) {
        g.kind = 'DRAG'; state = 'DRAG'; // 转正，落到下方 DRAG 分支立即响应
      } else return;
    }
    if (g.kind === 'DRAG') {
      const sNow = host.toStage(e.px, e.py);
      host.applyPositions(computeTargets(g.start, sNow.x - g.startS.x, sNow.y - g.startS.y));
      return;
    }
    if (g.kind === 'FACE') {
      const p = host.formation()?.positions[g.id];
      if (p) {
        const s = host.toStage(e.px, e.py);
        const ang = Math.round(((Math.atan2(s.x - p.x, -(s.y - p.y)) * 180 / Math.PI) % 360 + 360) % 360);
        if (ang !== (p.facing || 0)) { g.changed = true; host.applyPositions({ [g.id]: { x: p.x, y: p.y, facing: ang } }); }
      }
      return;
    }
    if (g.kind === 'PAN') {
      host.panBy(e.px - g.lastX, e.py - g.lastY);
      g.lastX = e.px; g.lastY = e.py;
      return;
    }
    if (g.kind === 'BOX') {
      g.x1 = e.px; g.y1 = e.py;
      host.box({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
    }
  }

  function up(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    disarmLP();
    if (state === 'MENU') { g = null; return; } // 浮窗期间抬起：无操作（按钮自会处理）
    if (state === 'PENDING') {
      // 纯点击（未转正、位置未动）：仅选择语义，不做重叠合并判定——
      // 静止队形里本就相邻的两个未组队舞者，点击不应误弹合并确认
      const sel = host.selection();
      if (!g.selectMod && !host.multiSelect() && sel.length > 1 && sel.includes(g.id)) {
        host.select([g.id]); // 多选中单击其一（未拖动、按下时未改选择）：收拢为单人
      }
      endGesture();
      return;
    }
    if (state === 'DRAG') {
      const ctx = g;
      const fmt = host.formation();
      const other = fmt && overlapOther(fmt, ctx.id);
      const anchor = fmt?.positions[ctx.id];
      host.commit('移动舞者');
      endGesture();
      if (other) {
        enterMenu({ mode: 'merge', ids: [ctx.id, other], at: anchor, formationIndex: host.fmtIndex() });
      }
      return;
    }
    if (state === 'FACE') {
      if (g.changed) host.commit('调整朝向');
      endGesture();
      return;
    }
    if (state === 'BOX') {
      const ctx = g;
      const tiny = Math.abs(ctx.x1 - ctx.x0) < TH.boxMinPx && Math.abs(ctx.y1 - ctx.y0) < TH.boxMinPx;
      let ids = [];
      if (!tiny) {
        const p1 = host.toStage(ctx.x0, ctx.y0), p2 = host.toStage(ctx.x1, ctx.y1);
        const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
        const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
        ids = Object.entries(host.formation()?.positions || {})
          .filter(([, p]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
          .map(([id]) => id);
      }
      host.select(ids, { add: !!e.shift });
      host.box(null);
      endGesture();
      return;
    }
    if (state === 'PAN' || state === 'PINCH') { endGesture(); return; }
  }

  // Escape / pointercancel：进行中手势取消；DRAG 回滚到按下前快照。
  // 返回 true 表示消费了该次取消（调用方可据此决定是否再清空选择）。
  function cancel() {
    disarmLP();
    if (state === 'DRAG' && g) { host.rollback(g.start); host.requestDraw(); endGesture(); return true; }
    if (state === 'BOX') host.box(null);
    if (state === 'MENU') { exitMenu(); return true; }
    if (state !== 'IDLE') { endGesture(); return true; }
    return false;
  }

  function reset() { // 场景切换等场景的强制复位（不回滚数据）
    disarmLP();
    pointers.clear(); pinch = null; g = null; state = 'IDLE';
  }

  return {
    down, move, up, cancel, reset,
    state: () => state,
  };
}
