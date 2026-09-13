// 纯手势状态机：不依赖 DOM/渲染/存储，可在 node 中用假时钟直接驱动（tests/gesture.test.js）。
// stage.js 是它的薄客户端：把 PointerEvent 翻译成 down/move/up 事件对象，
// 并执行状态机通过 host 吐出的命令（选择/移动/回滚/浮窗/框选/平移缩放）。
//
// 状态转移总览：
//   IDLE  --down(把手)--> FACE      --up(有变化)--> 提交"调整朝向"
//   IDLE  --down(舞者)--> PENDING   --位移>晋升阈值--> DRAG --up--> 提交"移动舞者"（落点重叠→合并确认浮窗）
//                                    --按住长按时长且位移小--> MENU（合并=单元浮窗；未合并=删除菜单）
//                                    --up--> TAP（仅选择；落点重叠同样弹合并确认）
//   单元原子性：合并单元是一切操作的原子——点选/shift/多选/框选命中任一成员=整单元
//   （两名成员）入选或移出；拖动任一成员=整单元同步位移（不存在单人拉伸/拆分拖拽路径，
//   分离呈示不可经拖拽产生）；仅当整单元已在多选中时才随整组选择一起拖（组拖路径）。
//   Escape/双指中断=整单元回滚。
//   IDLE  --down(空白·鼠标左键)--> BOX  --up--> 框内全选（<最小边长视为点击=清空；命中单元成员=整单元入选）
//   IDLE  --down(空白·触摸)--> PAN  --位移>晋升阈值--> panBy；未晋升抬起=清空选择（点按）
//                                    --静止 lpMs（位移<lpCancelPx）--> BOX(长按框选 lpBox)：拖动画框、
//                                     松手复用桌面框选结算；期间忽略新增手指（不转 PINCH，直到松手）
//   IDLE  --down(空白·中键/空格+左键)--> PAN --move--> panBy（桌面平移；全程不改选择/数据/历史）
//   IDLE  --contextmenu(右键·stage 层翻译进来)--> MENU（多选中命中=整 selection 菜单（恰一单元=
//            单元浮窗）；命中者不在多选中=先选中再弹（合并=单元菜单/未合并=删除菜单）；仅 IDLE 响应）
//   任意  --第二指按下--> PINCH（进行中的 DRAG 立即回滚）
//   MENU  --任意按下--> 退出浮窗并吞掉该次按下（点外部=取消）
//   DRAG/PENDING --Escape(cancel)--> 回滚到按下前快照（整单元），不产生历史

// 所有手势阈值唯一出处（单位：米 / 毫秒 / client 像素）
export const TH = {
  promoteM: 0.06,  // PENDING→DRAG 晋升位移
  mergeM: 0.55,    // 拖动重叠触发合并确认的距离
  showM: 0.8,      // 合并单元徽标呈示距离（与渲染 MERGE_DIST 一致）
  dwellMs: 1500,   // 拖动重叠驻留时长：拖到位停住一段时间即弹合并确认（无需松手）
  lpMs: 500,       // 长按触发时长（仅触摸端；桌面端为双击）
  lpCancelPx: 12,  // 长按取消位移（client px，放宽以容忍手指抖动）
  tapMs: 350,      // 双击间隔上限
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
  let lpTimer = null;        // 长按定时器句柄（触摸端）
  let lastTap = null;        // {id,t} 双击检测

  const firstTwo = () => [...pointers.values()].slice(0, 2);
  // id 所属合并单元（单元原子性唯一出处）：合并成员=两人，否则=其一人
  function unitOf(fmt, id) {
    const m = fmt && (fmt.merges || []).find(x => x.a === id || x.b === id);
    return m ? [m.a, m.b] : [id];
  }
  // 单元浮窗统一载荷：收拢同点呈示时锚定中点，分离呈示时锚定首成员
  function unitMenuPayload(fmt, m) {
    const a = fmt.positions[m.a], b = fmt.positions[m.b];
    return {
      mode: 'unit', ids: [m.a, m.b], style: m.style,
      at: a && b && Math.hypot(a.x - b.x, a.y - b.y) <= TH.showM ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      formationIndex: host.fmtIndex(),
    };
  }
  // 多选上下文菜单载荷：菜单操作对象=整个 selection（单元原子展开、去重、保持选择顺序）。
  // 命中者仅作锚点（浮窗弹在其旁），不影响操作范围。
  function expandedIds(fmt, sel) {
    const out = [];
    const seen = new Set();
    for (const id of sel) {
      for (const u of unitOf(fmt, id)) {
        if (!seen.has(u)) { seen.add(u); out.push(u); }
      }
    }
    return out;
  }
  // ids 恰为一个合并单元（样式按钮/单元浮窗的唯一形态）
  function singleUnitOf(fmt, ids) {
    if (!fmt || ids.length !== 2) return null;
    return (fmt.merges || []).find(m => (m.a === ids[0] && m.b === ids[1]) || (m.a === ids[1] && m.b === ids[0])) || null;
  }
  // 多选触发（右键/长按命中者已在 selection≥2 中）的统一分流：
  // 恰好选中一个单元 → 既有单元浮窗（样式按钮仅此处出现）；其余 → multi 载荷（整 selection 操作）。
  function menuPayloadForSelection(fmt, sel, anchorId) {
    const ids = expandedIds(fmt, sel);
    if (ids.length >= 2) {
      const unit = singleUnitOf(fmt, ids);
      if (unit) return unitMenuPayload(fmt, unit);
      return {
        mode: 'multi', ids,
        at: fmt?.positions[anchorId] || { x: 0, y: 0 },
        formationIndex: host.fmtIndex(),
      };
    }
    return null; // 展开后 <2 人：调用方落回单人/单元菜单
  }
  function armLP() {
    clearT(lpTimer); lpTimer = null;
    lpTimer = setT(() => {
      lpTimer = null;
      if (state !== 'PENDING' || !g) return;
      const fmt = host.formation();
      // 多选中长按命中者（selection≥2 且含命中者）：菜单操作对象=整个 selection
      const sel = host.selection();
      if (sel.length >= 2 && sel.includes(g.id)) {
        const payload = menuPayloadForSelection(fmt, sel, g.id);
        if (payload) { enterMenu(payload); return; }
      }
      const m = fmt && (fmt.merges || []).find(x => x.a === g.id || x.b === g.id);
      if (m) { enterMenu(unitMenuPayload(fmt, m)); return; } // 合并成员长按：单元浮窗
      // 未合并舞者长按：同款上下文菜单（仅「删除」入口）
      enterMenu({ mode: 'context', ids: [g.id], at: fmt?.positions[g.id] || { x: 0, y: 0 }, formationIndex: host.fmtIndex() });
    }, TH.lpMs);
  }
  function disarmLP() { if (lpTimer) { clearT(lpTimer); lpTimer = null; } }

  // 触摸/笔空白长按：静止 lpMs 且未晋升平移 → 转 BOX（长按框选，lpBox 标记）。
  // 与舞者长按菜单（armLP）共用 lpTimer 槽位——同一时刻至多一个待决长按。
  // 锚点取触发时指位（非按下点）：容忍长按等待期内的手部微漂，反馈点落在指下。
  function armLPBox() {
    clearT(lpTimer); lpTimer = null;
    lpTimer = setT(() => {
      lpTimer = null;
      if (state !== 'PAN' || !g || !g.touch || g.promoted) return; // 已晋升平移/手势已断=放弃
      // 锚点=当前指位（pointers 表由 move 持续更新；未晋升的抖动也反映在此）
      const p = pointers.get(g.pointerId) || { x: g.lastX, y: g.lastY };
      g.kind = 'BOX';
      g.lpBox = true; // 长按框选标记：期间忽略新增手指、抬起只认发起指
      g.x0 = p.x; g.y0 = p.y; g.x1 = p.x; g.y1 = p.y;
      g.lastX = p.x; g.lastY = p.y;
      state = 'BOX';
      host.box({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 }, { origin: true }); // 零尺寸矩形+起点反馈
    }, TH.lpMs);
  }

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

  // id 与他人重叠（<mergeM）且尚未合并 → 返回对方 id
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

  // e = { pointerId, px, py, shift, touch, button, space }（px/py 为 client 坐标；
  //      button=按下时的 PointerEvent.button，space=宿主跟踪的空格按住状态——桌面平移修饰键）
  function down(e) {
    if (state === 'MENU') { exitMenu(); return; } // 点外部=取消，并吞掉这次按下
    if (e.button === 2) return; // 右键：交给 contextmenu 事件（仅 IDLE 响应），不启动任何手势
    if (state === 'BOX' && g && g.lpBox) return; // 长按框选进行中：忽略新增手指（不转 PINCH/缩放），其抬起同样无效
    pointers.set(e.pointerId, { x: e.px, y: e.py });
    if (pointers.size === 2) { abortToPinch(); return; }
    if (pointers.size > 2) return;
    if (host.readOnly()) return;
    // 桌面平移修饰键：中键（button=1）或空格按住+左键。仅在空白起手=平移；
    // 命中把手/舞者时不启动任何编辑手势（平移意图优先，宁可不动作也不误编辑）。
    const panMod = e.button === 1 || !!e.space;
    // 命中优先级：朝向把手 > 舞者 > 空白
    if (host.hitHandle(e.px, e.py)) {
      if (panMod) return;
      g = { kind: 'FACE', id: host.selection()[0], changed: false };
      state = 'FACE';
      return;
    }
    const s = host.toStage(e.px, e.py);
    const hit = host.hitDancer(s.x, s.y);
    if (hit) {
      if (panMod) return;
      const fmt = host.formation();
      // 单元原子性：命中合并成员即视作整单元——点选/shift/多选一律以两名成员为单位
      // 加入或移出；拖拽快照同样恒为整单元（不存在单人拉伸路径）。仅当整单元本就
      // 在选择中（多选组拖场景）时保持现有组拖语义：快照=整个选择。
      const unit = unitOf(fmt, hit);
      const sel = host.selection();
      const unitInSel = unit.every(id => sel.includes(id));
      let selectMod = false;
      if (!unitInSel) { host.select(unit, { add: !!(e.shift || host.multiSelect()) }); selectMod = true; }
      else if (e.shift) { host.select(unit, { add: true, toggleOff: true }); return; } // 原子移出整单元，不进入拖拽
      const start = {};
      for (const id of host.selection()) {
        const p = fmt?.positions[id];
        if (p) start[id] = { x: p.x, y: p.y };
      }
      g = { kind: 'PENDING', id: hit, startS: s, startPx: { x: e.px, y: e.py }, start, selectMod };
      state = 'PENDING';
      if (e.touch) armLP(); // 长按仅触摸端；桌面端用双击/右键
    } else if (panMod) {
      g = { kind: 'PAN', lastX: e.px, lastY: e.py, touch: false, promoted: true };
      state = 'PAN';
    } else if (!e.touch) {
      g = { kind: 'BOX', x0: e.px, y0: e.py, x1: e.px, y1: e.py };
      state = 'BOX';
      host.box({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
    } else {
      // 触摸/笔空白：先以点按待定；位移超晋升阈值→转平移；静止达 lpMs→长按框选（lpBox）。
      // 未晋升抬起=清空选择（点按语义不变）。
      g = { kind: 'PAN', lastX: e.px, lastY: e.py, touch: true, promoted: false, startS: s, startPx: { x: e.px, y: e.py }, pointerId: e.pointerId };
      state = 'PAN';
      armLPBox();
    }
  }

  function move(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.px, y: e.py });
    if (state === 'MENU') return;
    if (g && g.lpBox && e.pointerId !== g.pointerId) return; // 长按框选中：非发起指的移动不画框
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
      // 重叠驻留：拖到他人身上停住 dwellMs 即弹合并确认（无需松手）
      const fmt = host.formation();
      const other = fmt ? overlapOther(fmt, g.id) : null;
      if (!other) { g.dwell = null; return; }
      if (!g.dwell || g.dwell.other !== other) g.dwell = { other, start: host.now() };
      else if (host.now() - g.dwell.start >= TH.dwellMs) {
        const anchor = fmt.positions[g.id];
        host.commit('移动舞者'); // 停在当前位置（取消确认也保留该次移动）
        const ids = [g.id, other];
        enterMenu({ mode: 'merge', ids, at: anchor, formationIndex: host.fmtIndex() });
      }
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
      if (!g.promoted) {
        // 长按框选意图：位移超取消阈值即解除长按（维持平移语义）
        if (Math.hypot(e.px - g.startPx.x, e.py - g.startPx.y) > TH.lpCancelPx) disarmLP();
        // 触摸空白：位移超过晋升阈值才转平移（阈值与拖拽晋升一致）
        const sNow = host.toStage(e.px, e.py);
        if (Math.hypot(sNow.x - g.startS.x, sNow.y - g.startS.y) <= TH.promoteM) return;
        disarmLP();
        g.promoted = true; // 晋升当次即补齐自按下起的全部位移（平移量=手指位移，无滞后）
      }
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
    if (state === 'BOX' && g && g.lpBox && e.pointerId !== g.pointerId) return; // 长按框选中：非发起指抬起不结算
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    disarmLP();
    if (state === 'MENU') { g = null; return; } // 浮窗期间抬起：无操作（按钮自会处理）
    if (state === 'PENDING') {
      // 纯点击（未转正、位置未动）：仅选择语义，不做重叠合并判定——
      // 静止队形里本就相邻的两个未合并舞者，点击不应误弹合并确认
      const sel = host.selection();
      if (!g.selectMod && !host.multiSelect() && sel.length > 1 && sel.includes(g.id)) {
        // 多选中单击其一（未拖动、按下时未改选择）：单元感知收拢——目标是整单元而非单人；
        // 选择已恰为整单元时不重发 select（无闪烁，选择零抖动）
        const unit = unitOf(host.formation(), g.id);
        if (unit.length !== sel.length || !unit.every(id => sel.includes(id))) host.select(unit);
      }
      // 双击（tapMs 内二次单击同一舞者）：已合并 → 单元浮窗（桌面端替代长按/右键）
      const t = host.now();
      const dbl = lastTap && lastTap.id === g.id && (t - lastTap.t) <= TH.tapMs;
      lastTap = dbl ? null : { id: g.id, t };
      if (dbl) {
        const fmt = host.formation();
        const m = fmt && (fmt.merges || []).find(x => x.a === g.id || x.b === g.id);
        if (m) {
          endGesture();
          enterMenu(unitMenuPayload(fmt, m));
          return;
        }
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
        const found = Object.entries(host.formation()?.positions || {})
          .filter(([, p]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
          .map(([id]) => id);
        // 框选原子性：矩形命中合并单元任一成员 → 整单元入选
        const seen = new Set();
        for (const id of found) {
          for (const uid of unitOf(host.formation(), id)) {
            if (!seen.has(uid)) { seen.add(uid); ids.push(uid); }
          }
        }
      }
      host.select(ids, { add: !!e.shift });
      host.box(null);
      endGesture();
      return;
    }
    if (state === 'PAN') {
      // 触摸空白未晋升抬起 = 点按语义：清空选择（平移本身永不改选择）
      if (g && g.touch && !g.promoted) host.select([]);
      endGesture();
      return;
    }
    if (state === 'PINCH') { endGesture(); return; }
  }

  // 鼠标右键（stage 层把 contextmenu 事件翻译进来）：与触摸/笔长按同款上下文菜单——
  // 多选中命中（selection≥2 且含命中者）=整 selection 菜单（multi 载荷；恰一单元=单元浮窗）；
  // 命中者不在 selection=先（单元原子）选中它再出菜单；未合并单人=仅「删除」菜单。
  // 仅手势机 IDLE 且非只读时响应。返回 true 表示已弹出（调用方可据此忽略后续处理）。
  function contextMenu(e) {
    if (state !== 'IDLE' || host.readOnly()) return false;
    const s = host.toStage(e.px, e.py);
    const hit = host.hitDancer(s.x, s.y);
    if (!hit) return false;
    const fmt = host.formation();
    const sel = host.selection();
    if (!(sel.length >= 2 && sel.includes(hit))) {
      // 命中者不在多选中：先选中它（整单元）再出菜单——已恰为该单元时不重发（零抖动）
      const unit = unitOf(fmt, hit);
      if (!(unit.length === sel.length && unit.every(id => sel.includes(id)))) host.select(unit);
    }
    const sel2 = host.selection();
    const payload = sel2.length >= 2 && sel2.includes(hit) ? menuPayloadForSelection(fmt, sel2, hit) : null;
    if (payload) { enterMenu(payload); return true; }
    const m = fmt && (fmt.merges || []).find(x => x.a === hit || x.b === hit);
    if (m) { enterMenu(unitMenuPayload(fmt, m)); return true; }
    enterMenu({ mode: 'context', ids: [hit], at: fmt?.positions[hit] || { x: s.x, y: s.y }, formationIndex: host.fmtIndex() });
    return true;
  }

  // Escape / pointercancel：进行中手势取消；DRAG 回滚到按下前快照。
  // 返回 true 表示消费了该次取消（调用方可据此决定是否再清空选择）。
  function cancel() {
    disarmLP();
    // F-01（UX-01）：cancel 后浏览器接管，该批指针不会再有 pointerup——pointers 表若不清，
    // 脏残留会让下一次单指按下凑成 size===2 被误判 PINCH（以脏坐标跳变缩放，且不自愈）。
    // 全清是安全保守解：cancel 语义=整批指针作废；pinch 上下文一并作废。
    pointers.clear(); pinch = null;
    if (state === 'DRAG' && g) { host.rollback(g.start); host.requestDraw(); endGesture(); return true; }
    if (state === 'BOX') host.box(null);
    if (state === 'MENU') { exitMenu(); return true; }
    if (state !== 'IDLE') { endGesture(); return true; }
    return false;
  }

  function reset() { // 场景切换等场景的强制复位（不回滚数据）
    disarmLP();
    pointers.clear(); pinch = null; g = null; lastTap = null; state = 'IDLE';
  }

  return {
    down, move, up, cancel, reset, contextMenu,
    state: () => state,
    debugPointers: () => [...pointers.keys()], // 调试钩子：当前机器内的活跃指针
  };
}
