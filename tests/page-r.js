// R 组测试仪器：单元语义 v2 动线 R-01~R-07（权威计划 tests/e2e-matrix.md §3.5）。
// 背景：合并单元语义简化为「单元原子化 + 右键/长按统一上下文菜单」——本组专测该语义；
// 结构复用 page-l1 的纪律：每条动线独立场景（真实 id / 12 人两行 / snap 关 / 视图 fit）、
// 先执行后断言、失败即停、每动线后泄漏断言（page-kit.runCases 内置）。
// 纪律：本文件属测试仪器，被测应用代码（js/*、index.html、css/*）零改动；场景搭建只走 store/M 公共 API。
// 运行前提：window.__fs、window.__input（page-injector.js，含 contextMenu/contextEvent 原语）、
//       window.__l1Shot（lab 驱动注入；page-kit 的 shotFn 兼容 __l0Shot 兜底）。
// 入口：await import('/tests/page-r.js') → await runR({ phase: 'M'|'T'|'P', only?: 'R-05' })
//       返回 { phase, cases:[{id,name,ok,evidence,steps,log,snapAfter}], shots, meta }。
import {
  raf2, sleep, TH_COLOR, TH_HL, TH_BG, TH_PRESENT, SCREEN_RATIO,
  makeCtx, dprOf, mean3x3, dist, rgb, hex, ringMinDist, innerMinDist, minDistOver, gridRegion,
  edgeMinDist, decodeShot, screenCompare, runCases,
} from './page-kit.js';

const HW_OF = { M: 'mouse', T: 'touch', P: 'pen' };
const ACC = hex('#38bdf8');   // 浮窗边框主题蓝
const HL = hex('#0ea5e9');    // 选中高亮

export async function runR(opts = {}) {
  const phase = opts.phase || 'M';
  const HW = HW_OF[phase];
  const only = opts.only || null;
  const shots = {};
  const ctx = makeCtx();
  const { store, M, sv, state, fmt } = ctx;
  const cv = sv.canvas;
  const inp = window.__input;

  // ---- 注入调用流水（复推动线证据） ----
  const inLog = [];
  for (const op of ['down', 'move', 'up', 'cancel', 'click', 'dblclick', 'press', 'drag', 'pinch', 'wheel', 'key', 'keyUp', 'contextMenu', 'contextEvent']) {
    const orig = inp[op].bind(inp);
    inp[op] = (...a) => {
      inLog.push({ t: Math.round(performance.now()), op, args: a.map(v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)) });
      return orig(...a);
    };
  }

  // ---- 每条动线独立场景（与 page-l1 setup 同基线） ----
  async function setup(title) {
    // 仪器卫生：上一动线「失败即停」可能遗留浮窗+MENU 态（其泄漏已在该动线记录在案），
    // 新场景强制清理，防陈旧浮窗/MENU 态级联污染后续动线（等价应用 hideUnitMenu+gestureMenuClosed 路径）
    const stale = document.querySelector('.unit-menu');
    if (stale) { stale.remove(); sv.gesture.reset(); }
    store.createNewProject({ title, pairs: 6 });
    store.setUI({ selection: [], multiSelect: false, editMode: true, showFacingHandle: false });
    store.mutate(p => { p.stage.snap = false; });
    sv.resetView();
    await raf2();
    const ids = M.orderedDancers(state().project, 'pair');
    const dancerOf = id => state().project.dancers.find(d => d.id === id);
    const posOf = id => ({ ...fmt().positions[id] });
    const ptOf = id => { const p = posOf(id); return ctx.toClient(p.x, p.y); };
    const blank = ctx.toClient(5.85, 12.45);
    return {
      ids, dancerOf, posOf, ptOf, blank,
      base: mean3x3(cv, blank.x, blank.y),
      rpx: 0.38 * sv.view.scale,
      col: id => hex(dancerOf(id).color),
      sel: () => [...state().selection],
      hist: () => `canUndo=${store.canUndo()} canRedo=${store.canRedo()} label="${store.undoLabel()}"`,
      data: () => JSON.stringify({ p: fmt().positions, m: fmt().merges || [] }),
      mergePt: (a, b) => { const pa = posOf(a), pb = posOf(b); return ctx.toClient((pa.x + pb.x) / 2, (pa.y + pb.y) / 2); },
    };
  }

  // ---- 通用小工具 ----
  const menu = () => {
    const el = document.querySelector('.unit-menu');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      el, rect: r,
      title: el.querySelector('.um-title')?.textContent || '',
      btns: [...el.querySelectorAll('.um-btn')].map(b => b.textContent.trim()),
      text: el.textContent.slice(0, 60),
    };
  };
  const rectDist = (r, pt) => Math.hypot(Math.max(r.left - pt.x, 0, pt.x - r.right), Math.max(r.top - pt.y, 0, pt.y - r.bottom));
  async function clickMenuBtn(m, text) {
    const btn = m && [...m.el.querySelectorAll('.um-btn')].find(b => b.textContent.includes(text));
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    await inp.click(r.left + r.width / 2, r.top + r.height / 2, { hw: HW });
    await raf2();
    return true;
  }
  async function closeMenu() {
    const m = menu();
    if (!m) return;
    const c = m.el.querySelector('.um-cancel').getBoundingClientRect();
    await inp.click(c.left + c.width / 2, c.top + c.height / 2, { hw: HW });
    await raf2();
  }
  async function clickBtn(id) {
    const r = document.getElementById(id).getBoundingClientRect();
    await inp.click(r.left + r.width / 2, r.top + r.height / 2, { hw: HW });
    await raf2();
  }
  async function dragPts(from, to, { n = 4, stepMs = 30 } = {}) {
    const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }));
    await inp.drag(pts, { hw: HW, stepMs });
    return pts;
  }
  // 上下文菜单呼出（按硬件选入口：M=右键；T/P=长按 700ms，与 D-05 时序一致）
  async function openCtxMenu(pt) {
    if (HW === 'mouse') { await inp.contextMenu(pt.x, pt.y, { hw: HW }); await raf2(); return; }
    await inp.down(pt.x, pt.y, { hw: HW });
    await sleep(750); // lpMs=500
    await inp.up(pt.x, pt.y, { hw: HW }); // MENU 态吞掉抬起，浮窗保留
    await raf2();
  }
  const inflate = (r, n = 32) => ({ x0: r.left - n, y0: r.top - n, x1: r.right + n, y1: r.bottom + n });
  async function cmpShot(tag, mask = null) {
    const b64 = await (window.__l1Shot || window.__l0Shot)();
    shots[tag] = b64;
    const cmp = await screenCompare(2, mask);
    return { b64, cmp, tag };
  }
  const cmpStep = (step, r) => step('[SCREEN] 屏幕=位图（差异<0.5%）', r.cmp.best < SCREEN_RATIO,
    `raw=${(r.cmp.raw * 100).toFixed(4)}% best±1px=${(r.cmp.best * 100).toFixed(4)}%@off[${r.cmp.bestOff}] → ${r.tag}.png`, 'SCREEN');
  async function menuBorder(b64, m) {
    const { img, w } = await decodeShot(b64);
    const r = m.rect, d = dprOf();
    return edgeMinDist((x, y) => {
      const px = Math.round(x * d), py = Math.round(y * d);
      if (px < 0 || py < 0 || px >= w || py >= img.height) return null;
      const i = (py * w + px) * 4;
      return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
    }, r.left, r.top, r.right, r.bottom, ACC, 3, 3);
  }
  async function setupMerge(t, style = 'capsule', { label = '' } = {}) { // 合并装配；label 非空时入历史（R-05 需要 undo 链含合并提交）
    const idA = t.ids[0], idB = t.ids[1];
    store.mutate(p => {
      const f = p.formations[state().formationIndex];
      M.addMerge(f, idA, idB, style);
      M.collapsePair(f, idA, idB);
    }, label || undefined);
    await raf2();
    return { idA, idB, mid: t.mergePt(idA, idB) };
  }
  // 徽标双半色采样（capsule；从 page-l2.unitHalves 精简，R-05 undo 后呈示断言用）
  function badgeHalves(t, mid, colA, colB) {
    const w = 3.4 * t.rpx, h = 1.5 * t.rpx;
    const regA = gridRegion(mid.x - w * 0.46, mid.y - h * 0.3, mid.x - w * 0.08, mid.y + h * 0.3, 2);
    const regB = gridRegion(mid.x + w * 0.08, mid.y - h * 0.3, mid.x + w * 0.46, mid.y + h * 0.3, 2);
    return {
      sA: minDistOver((x, y) => mean3x3(cv, x, y), colA, regA),
      sB: minDistOver((x, y) => mean3x3(cv, x, y), colB, regB),
    };
  }
  // 数据不变式：positions 键===dancers id（全部队形）+ merges/pairs 引用有效
  function invariants(t) {
    const proj = state().project;
    const ids = proj.dancers.map(d => d.id).sort();
    const keyOK = proj.formations.every(f => JSON.stringify(Object.keys(f.positions).sort()) === JSON.stringify(ids));
    const mergeOK = proj.formations.every(f => (f.merges || []).every(m =>
      ids.includes(m.a) && ids.includes(m.b) && m.a !== m.b));
    const pairOK = proj.pairs.every(p => ids.includes(p.leader) && ids.includes(p.follower));
    return { keyOK, mergeOK, pairOK };
  }

  // =====================================================================
  // 动线定义（hw: 适用硬件位）
  // =====================================================================
  const defs = [

    // ---------- R-01 右键合并单元 [M] ----------
    {
      id: 'R-01', hw: 'M', name: '右键合并单元：菜单三操作可点+定位钳制',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        let { mid } = await setupMerge(t, 'capsule');
        const styleOf = () => (fmt().merges || [])[0]?.style;
        const btnWrap = document.getElementById('stage-wrap').getBoundingClientRect();

        // ---- 子1 右键 → 结构+定位断言 → 点「菱形」 ----
        await inp.contextMenu(mid.x, mid.y, { hw: 'mouse' });
        await raf2();
        const m1 = menu();
        let border = null, r1 = null;
        if (m1) { r1 = await cmpShot('r01-menu', inflate(m1.rect)); border = await menuBorder(r1.b64, m1); }
        step('[DOM] 右键徽标弹单元菜单（title=舞对单元）', !!m1 && m1.title === '舞对单元', m1 ? `title="${m1.title}" btns=[${m1.btns}]` : '无 .unit-menu', 'DOM');
        step('[DOM] 按钮齐备（✂ 拆开/胶囊/菱形/双圆/删除/✕）', !!m1 && ['✂ 拆开', '胶囊', '菱形', '双圆', '删除'].every(x => m1.btns.includes(x)) && m1.btns.includes('✕'),
          m1 ? `btns=[${m1.btns}]` : '—', 'DOM');
        if (m1) {
          // 定位钳制断言：应用公式（main.js showUnitMenu）= left=max(4,min(screen.x-40, wrapW-w-4))，
          // top=max(4,min(screen.y+10, wrapH-h-4))；screen=client - wrap 左上。无钳制时退化为锚定 mid-40/mid+10。
          const sx = mid.x - btnWrap.left, sy = mid.y - btnWrap.top;
          const expLeft = btnWrap.left + Math.max(4, Math.min(sx - 40, btnWrap.width - m1.rect.width - 4));
          const expTop = btnWrap.top + Math.max(4, Math.min(sy + 10, btnWrap.height - m1.rect.height - 4));
          const inWrap = m1.rect.left >= btnWrap.left - 0.5 && m1.rect.top >= btnWrap.top - 0.5 && m1.rect.right <= btnWrap.right + 0.5 && m1.rect.bottom <= btnWrap.bottom + 0.5;
          step('[DOM] 定位钳制：left/top 符合钳制公式（锚定 mid-40/mid+10，越界钳回 wrap 内）',
            Math.abs(m1.rect.left - expLeft) <= 2 && Math.abs(m1.rect.top - expTop) <= 2 && inWrap,
            `rect=(${Math.round(m1.rect.left)},${Math.round(m1.rect.top)}) 期望=(${Math.round(expLeft)},${Math.round(expTop)})（wrap ${Math.round(btnWrap.width)}×${Math.round(btnWrap.height)} 菜单 ${Math.round(m1.rect.width)}×${Math.round(m1.rect.height)}${expTop !== btnWrap.top + sy + 10 ? '，top 已钳制' : ''}）`, 'DOM');
        }
        if (m1) step('[DOM] rect 距单元 <150px', rectDist(m1.rect, mid) < 150, `距离 ${rectDist(m1.rect, mid).toFixed(1)}px`, 'DOM');
        if (m1) cmpStep(step, r1);
        if (m1) step('[SCREEN] 浮窗边框色可检出（≈#38bdf8）', border.d < 140, `最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}`, 'SCREEN');
        const style0 = styleOf();
        const clickedStyle = await clickMenuBtn(m1, '菱形');
        step('[STATE] 操作①样式：菱形可点 → style 变更 + 历史「切换单元样式」+ 菜单关闭', clickedStyle && styleOf() === 'diamond' && style0 === 'capsule' && store.undoLabel() === '切换单元样式' && !menu(),
          `style ${style0}→${styleOf()} ${t.hist()}`);

        // ---- 子2 重建单元 → 右键 → 点「✂ 拆开」 ----
        await setupMerge(t, 'capsule'); mid = t.mergePt(A, B);
        await inp.contextMenu(mid.x, mid.y, { hw: 'mouse' });
        await raf2();
        const m2 = menu();
        const posA2 = t.posOf(A), posB2 = t.posOf(B);
        const clickedSplit = await clickMenuBtn(m2, '拆开');
        step('[STATE] 操作②拆开：可点 → merges 清空、两人原地保留、菜单关闭', clickedSplit && (fmt().merges || []).length === 0 &&
          Math.hypot(t.posOf(A).x - posA2.x, t.posOf(A).y - posA2.y) < 1e-9 && Math.hypot(t.posOf(B).x - posB2.x, t.posOf(B).y - posB2.y) < 1e-9 && !menu(),
          `merges=${(fmt().merges || []).length} ${t.hist()}`);

        // ---- 子3 重建单元 → 右键 → 点「删除」（重删除全链断言归 R-05，此处证可点） ----
        await setupMerge(t, 'capsule'); mid = t.mergePt(A, B);
        const n0 = state().project.dancers.length;
        await inp.contextMenu(mid.x, mid.y, { hw: 'mouse' });
        await raf2();
        const m3 = menu();
        const clickedDel = await clickMenuBtn(m3, '删除');
        const inv3 = invariants(t);
        step('[STATE] 操作③删除：可点 → 两人移除、菜单关闭、不变式成立', clickedDel &&
          state().project.dancers.length === n0 - 2 && !state().project.dancers.some(d => d.id === A || d.id === B) && !menu() &&
          inv3.keyOK && inv3.mergeOK && inv3.pairOK, `dancers ${n0}→${state().project.dancers.length} ${t.hist()}`);
      },
    },

    // ---------- R-02 右键未合并舞者 [M] ----------
    {
      id: 'R-02', hw: 'M', name: '右键未合并舞者：仅「删除」菜单',
      async run(t, { step }) {
        const E = t.ids[6]; // 未合并
        const n0 = state().project.dancers.length;
        const data0 = t.data();
        await inp.contextMenu(t.ptOf(E).x, t.ptOf(E).y, { hw: 'mouse' });
        await raf2();
        const m = menu();
        let border = null, r = null;
        if (m) { r = await cmpShot('r02-menu', inflate(m.rect)); border = await menuBorder(r.b64, m); }
        const btnsSnapshot = m ? m.btns.slice() : null; // 组成断言放用例末尾：防单一缺陷吞掉删除/undo 功能验证
        step('[DOM] 弹「舞者 · 名」菜单', !!m && m.title.startsWith('舞者 · '), m ? `title="${m.title}"` : '无 .unit-menu', 'DOM');
        if (m) cmpStep(step, r);
        if (m) step('[SCREEN] 浮窗边框色可检出（≈#38bdf8）', border.d < 140, `最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}`, 'SCREEN');
        const clicked = await clickMenuBtn(m, '删除');
        await raf2();
        const inv = invariants(t);
        const delOK = clicked && state().project.dancers.length === n0 - 1 && !state().project.dancers.some(d => d.id === E) &&
          !(E in fmt().positions) && inv.keyOK && inv.mergeOK && inv.pairOK && store.undoLabel() === '删除舞者';
        step('[STATE] 点删除：该舞者移除、不变式成立、历史=「删除舞者」', delOK, `dancers ${n0}→${state().project.dancers.length} ${t.hist()}`);
        store.undo(); await raf2();
        const backOK = state().project.dancers.length === n0 && state().project.dancers.some(d => d.id === E) && E in fmt().positions;
        store.redo(); await raf2();
        step('[STATE] undo 还原舞者、redo 重放删除', backOK && store.undoLabel() === '删除舞者' && state().project.dancers.length === n0 - 1, `undo 后 dancers=${state().project.dancers.length}`);
        step('[DOM] 菜单组成=仅「删除」+✕（无拆开/样式入口）', !!btnsSnapshot && JSON.stringify(btnsSnapshot) === JSON.stringify(['删除', '✕']), `btns=[${btnsSnapshot ? btnsSnapshot.join(',') : '—'}]`, 'DOM');
      },
    },

    // ---------- R-03 右键拒绝集 [M] ----------
    {
      id: 'R-03', hw: 'M', name: '右键拒绝：空白 / 手势进行中 / 只读',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];

        // ---- 子1 空白右键：拒绝（不弹、零副作用） ----
        const data0 = t.data(), sel0 = t.sel();
        await inp.contextMenu(t.blank.x, t.blank.y, { hw: 'mouse' });
        await raf2();
        step('[DOM] 空白右键无菜单', !menu(), '', 'DOM');
        step('[STATE] 空白右键零副作用（选择/数据/历史不变，机器 IDLE）', t.data() === data0 && JSON.stringify(t.sel()) === JSON.stringify(sel0) && !store.canUndo() && sv.gesture.state() === 'IDLE',
          `selection=[${t.sel().map(i => i.slice(0, 8))}] ${t.hist()} state=${sv.gesture.state()}`);

        // ---- 子2 左键拖拽进行中右键：拒绝且不打断手势 ----
        const target = { x: t.posOf(A).x + 0.5, y: t.posOf(A).y - 1.2 }; // (2.0,6.0)：避开 B(3.3,7.2) 与第二行
        const pts = [t.ptOf(A)];
        for (let i = 1; i <= 3; i++) pts.push({ x: pts[0].x + (ctx.toClient(target.x, target.y).x - pts[0].x) * i / 3, y: pts[0].y + (ctx.toClient(target.x, target.y).y - pts[0].y) * i / 3 });
        const pid = await inp.down(pts[0].x, pts[0].y, { hw: 'mouse' });
        for (let i = 1; i < pts.length; i++) { await sleep(30); await inp.move(pts[i].x, pts[i].y, { hw: 'mouse', pid }); }
        const stDuring = sv.gesture.state();
        inp.contextEvent(t.ptOf(B).x, t.ptOf(B).y); // 手势进行中送菜单事件（命中舞者 B；若 IDLE 守卫失效即会弹）
        await raf2();
        const noMenuDuring = !menu();
        await inp.up(pts[3].x, pts[3].y, { hw: 'mouse', pid });
        await raf2();
        const pA = t.posOf(A);
        step('[STATE] 拖拽进行中（DRAG）右键不弹菜单', stDuring === 'DRAG' && noMenuDuring, `state=${stDuring} menu=${!!menu()}`, 'DOM');
        step('[STATE] 拖拽中右键不打断：松手仍精确提交「移动舞者」', Math.abs(pA.x - target.x) < 1e-6 && Math.abs(pA.y - target.y) < 1e-6 && store.undoLabel() === '移动舞者',
          `A=(${pA.x.toFixed(6)},${pA.y.toFixed(6)}) ${t.hist()}`);

        // ---- 子3 只读（关编辑）右键舞者：拒绝 ----
        await clickBtn('btn-edit-mode');
        const locked = state().editMode === false;
        const dataL = t.data(), selL = t.sel(), histL = t.hist(); // 子2 的「移动舞者」提交在栈上：零副作用=三者均不变
        await inp.contextMenu(t.ptOf(B).x, t.ptOf(B).y, { hw: 'mouse' });
        await raf2();
        step('[STATE] 只读生效（editMode=false）', locked, `editMode=${state().editMode}`);
        step('[DOM] 只读下右键舞者无菜单', !menu(), '', 'DOM');
        step('[STATE] 只读右键零副作用（选择/数据/历史不变）', t.data() === dataL && JSON.stringify(t.sel()) === JSON.stringify(selL) && t.hist() === histL, `selection=[${t.sel().map(i => i.slice(0, 8))}] ${t.hist()}`);
        const r = await cmpShot('r03-readonly');
        await clickBtn('btn-edit-mode');
        step('[STATE] 复位：重新解锁', state().editMode === true, '');
        cmpStep(step, r);
      },
    },

    // ---------- R-04 长按未合并舞者 [T/P] ----------
    {
      id: 'R-04', hw: 'TP', name: '长按未合并舞者：删除菜单（触摸/笔），关闭后拖动照常',
      async run(t, { step }) {
        const E = t.ids[6];
        const data0 = t.data();
        await inp.down(t.ptOf(E).x, t.ptOf(E).y, { hw: HW });
        await sleep(750); // lpMs=500 → 按住中段取证
        shots['r04-hold'] = await (window.__l1Shot || window.__l0Shot)();
        await inp.up(t.ptOf(E).x, t.ptOf(E).y, { hw: HW });
        await raf2();
        const m = menu(); // MENU 态吞掉抬起 → 长按弹出的浮窗松手后保留
        let border = null, r = null;
        if (m) { r = await cmpShot('r04-menu', inflate(m.rect)); border = await menuBorder(r.b64, m); }
        step('[STATE] 长按无数据变更', t.data() === data0, '');
        step('[DOM] 长按弹「舞者 · 名」菜单且松手后保留', !!m && m.title.startsWith('舞者 · '), m ? `title="${m.title}" btns=[${m.btns}]` : '无 .unit-menu（中段截图 r04-hold.png）', 'DOM');
        const btnsSnapshot = m ? m.btns.slice() : null; // 组成断言放用例末尾：防单一缺陷吞掉关闭/拖动功能验证
        if (m) cmpStep(step, r);
        if (m) step('[SCREEN] 浮窗边框色可检出（≈#38bdf8）', border.d < 140, `最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}`, 'SCREEN');
        await closeMenu(); // ✕ 关闭 → gestureMenuClosed 解锁路径
        step('[DOM] ✕ 关闭后无菜单（解锁路径）', !menu(), '', 'DOM');
        // 菜单不排挤输入：关闭后正常拖动该舞者
        const target = { x: t.posOf(E).x + 0.6, y: t.posOf(E).y - 1.2 };
        await dragPts(t.ptOf(E), ctx.toClient(target.x, target.y));
        await raf2();
        const pE = t.posOf(E);
        step('[STATE] 关闭后拖动照常：精确位移 +「移动舞者」', Math.abs(pE.x - target.x) < 1e-6 && Math.abs(pE.y - target.y) < 1e-6 && store.undoLabel() === '移动舞者',
          `E=(${pE.x.toFixed(6)},${pE.y.toFixed(6)}) ${t.hist()}`);
        const r2 = await cmpShot('r04-dragged');
        cmpStep(step, r2);
        step('[DOM] 菜单组成=仅「删除」+✕（无拆开/样式入口）', !!btnsSnapshot && JSON.stringify(btnsSnapshot) === JSON.stringify(['删除', '✕']), `btns=[${btnsSnapshot ? btnsSnapshot.join(',') : '—'}]`, 'DOM');
      },
    },

    // ---------- R-05 删除单元 [M/T/P] ----------
    {
      id: 'R-05', hw: 'MTP', name: '删除单元：两人消失+undo 恢复+数据一致',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        // 合并以「合并单元」提交入历史（真实用户动线）：删除的 undo 恢复点=合并态
        const { mid } = await setupMerge(t, 'capsule', { label: '合并单元' });
        const midStage = { x: t.posOf(A).x, y: t.posOf(A).y };
        const n0 = state().project.dancers.length;
        const hist0 = t.hist();
        // ---- 呼出单元菜单（M=右键 / T/P=长按）→ 点「删除」 ----
        await openCtxMenu(mid);
        const m = menu();
        step('[DOM] 单元菜单呼出（title=舞对单元，含「删除」）', !!m && m.title === '舞对单元' && m.btns.includes('删除'), m ? `title="${m.title}" btns=[${m.btns}]` : '无 .unit-menu', 'DOM');
        const clicked = await clickMenuBtn(m, '删除');
        await raf2();
        const inv = invariants(t);
        const goneOK = clicked && state().project.dancers.length === n0 - 2 &&
          !state().project.dancers.some(d => d.id === A || d.id === B) &&
          !(A in fmt().positions) && !(B in fmt().positions) &&
          inv.keyOK && inv.mergeOK && inv.pairOK && !menu();
        step('[STATE] 删除：两名成员移除、全帧 positions 键===dancers id、merges/pairs 引用清理、菜单关闭', goneOK,
          `dancers ${n0}→${state().project.dancers.length} merges=${JSON.stringify(fmt().merges || [])} ${t.hist()}`);
        step('[STATE] 历史=「删除单元（两名舞者）」叠于「合并单元」之上且可 undo', store.canUndo() && store.undoLabel() === '删除单元（两名舞者）' && hist0.includes('label="合并单元"'),
          `before=${hist0} after=${t.hist()}`);
        const midPt = ctx.toClient(midStage.x, midStage.y);
        const afterDel = mean3x3(cv, midPt.x, midPt.y);
        const r = await cmpShot('r05-deleted');
        step('[PIXEL] 收拢点回基线色（徽标消失）', dist(afterDel, t.base) < TH_BG, `收拢点 ${rgb(afterDel)} 距基线 ${dist(afterDel, t.base).toFixed(1)} < ${TH_BG}`, 'PIXEL');
        cmpStep(step, r);
        // ---- undo：两人还原（id/位置/merges/pairs，恢复点=合并提交）----
        store.undo(); await raf2();
        const invU = invariants(t);
        const backOK = store.undoLabel() === '合并单元' && state().project.dancers.length === n0 &&
          state().project.dancers.some(d => d.id === A) && state().project.dancers.some(d => d.id === B) &&
          Math.abs(t.posOf(A).x - midStage.x) < 1e-9 && Math.abs(t.posOf(A).y - midStage.y) < 1e-9 &&
          Math.abs(t.posOf(B).x - midStage.x) < 1e-9 && Math.abs(t.posOf(B).y - midStage.y) < 1e-9 && invU.keyOK && invU.mergeOK && invU.pairOK;
        const halves = badgeHalves(t, t.mergePt(A, B), t.col(A), t.col(B));
        const r2 = await cmpShot('r05-undone');
        step('[STATE] undo：两人还原（同 id、收拢位不变、merges/pairs 复原，恢复点=「合并单元」提交）', backOK, `dancers=${state().project.dancers.length} ${t.hist()}`);
        step('[PIXEL] undo：徽标双半色重新呈示', halves.sA.d < TH_COLOR && halves.sB.d < TH_COLOR, `A 半 ${halves.sA.d.toFixed(1)} / B 半 ${halves.sB.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, r2);
        // ---- redo：再次删除 ----
        store.redo(); await raf2();
        const invR = invariants(t);
        step('[STATE] redo：重放删除（两人再移除、不变式成立）', state().project.dancers.length === n0 - 2 && invR.keyOK && invR.mergeOK && invR.pairOK && !store.canRedo(),
          `dancers=${state().project.dancers.length} ${t.hist()}`);
      },
    },

    // ---------- R-06 拆开清选 [M] ----------
    {
      id: 'R-06', hw: 'M', name: '拆开后 selection 清空 + 拆开双方可独立拖动',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        const { mid } = await setupMerge(t, 'capsule');
        const midStage = { x: t.posOf(A).x, y: t.posOf(A).y };
        await inp.click(mid.x, mid.y, { hw: 'mouse' }); // 单元语义 v2：点选=整单元
        await raf2();
        const selAfterClick = t.sel().slice();
        step('[前置] 点选徽标=整单元两人入选（selection==[A,B]）', JSON.stringify(selAfterClick.slice().sort()) === JSON.stringify([A, B].sort()), `selection=[${selAfterClick.map(i => i.slice(0, 8))}]`);
        // 呼出单元菜单用右键（统一上下文菜单入口）：前置单击会设置 lastTap，紧接 dblclick 的首击
        // 会被判成双击（tapMs=350）→ 弹窗即开即吞，属仪器时序伪影；双击入口已由 D-04/C-02/C-05 覆盖
        await openCtxMenu(mid);
        await raf2();
        const m = menu();
        const clicked = await clickMenuBtn(m, '拆开');
        await raf2();
        step('[DOM] 上下文菜单点「✂ 拆开」（右键入口）', !!m && m.title === '舞对单元' && clicked, m ? `title="${m.title}"` : '无 .unit-menu', 'DOM');
        step('[STATE] 拆开后 selection 清空（规格外补充：防原子选择残留）', clicked && t.sel().length === 0 && (fmt().merges || []).length === 0,
          `selection=[${t.sel().map(i => i.slice(0, 8))}] merges=${(fmt().merges || []).length} ${t.hist()}`);
        step('[STATE] 拆开位置不变（仍重叠于收拢点）', Math.abs(t.posOf(A).x - midStage.x) < 1e-9 && Math.abs(t.posOf(B).x - midStage.x) < 1e-9 && Math.abs(t.posOf(A).y - midStage.y) < 1e-9,
          `A=(${t.posOf(A).x},${t.posOf(A).y}) B=(${t.posOf(B).x},${t.posOf(B).y})`);
        // 呈示断言：徽标消失（左右缘回背景）+ 独立圆（顶层 B 色）
        const edgeL = { x: mid.x - 1.7 * t.rpx - 4, y: mid.y }, edgeR = { x: mid.x + 1.7 * t.rpx + 4, y: mid.y };
        const inB = innerMinDist(cv, mid.x, mid.y, t.rpx, t.col(B));
        const r = await cmpShot('r06-split');
        step('[PIXEL] 徽标消失、原地呈独立圆', dist(mean3x3(cv, edgeL.x, edgeL.y), t.base) < 40 && dist(mean3x3(cv, edgeR.x, edgeR.y), t.base) < 40 && inB.d < TH_COLOR,
          `左缘距基线 ${dist(mean3x3(cv, edgeL.x, edgeL.y), t.base).toFixed(1)} 右缘 ${dist(mean3x3(cv, edgeR.x, edgeR.y), t.base).toFixed(1)} 中点 B 色 ${inB.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r);
        // ---- 拆开双方独立拖动（重叠点顶层为后绘者 B → 先拖 B 再拖 A） ----
        const pMid = ctx.toClient(midStage.x, midStage.y);
        await dragPts(pMid, ctx.toClient(midStage.x - 1.5, midStage.y));
        await raf2();
        const afterB = t.posOf(B);
        await dragPts(ctx.toClient(midStage.x, midStage.y), ctx.toClient(midStage.x + 1.5, midStage.y));
        await raf2();
        const afterA = t.posOf(A);
        const inA2 = innerMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, t.col(A));
        const inB2 = innerMinDist(cv, t.ptOf(B).x, t.ptOf(B).y, t.rpx, t.col(B));
        const r2 = await cmpShot('r06-independent');
        step('[STATE] 双方可独立拖动（各 ±1.5m，两条「移动舞者」）',
          Math.abs(afterB.x - (midStage.x - 1.5)) < 1e-6 && Math.abs(afterA.x - (midStage.x + 1.5)) < 1e-6 && store.undoLabel() === '移动舞者' && store.canUndo(),
          `A=(${afterA.x.toFixed(3)},${afterA.y.toFixed(3)}) B=(${afterB.x.toFixed(3)},${afterB.y.toFixed(3)}) ${t.hist()}`);
        step('[PIXEL] 分离后两圆呈各自颜色', inA2.d < TH_COLOR && inB2.d < TH_COLOR, `A 色距 ${inA2.d.toFixed(1)} / B 色距 ${inB2.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r2);
      },
    },

    // ---------- R-07 单元原子性抽查 [M] ----------
    {
      id: 'R-07', hw: 'M', name: '单元原子性抽查：点选/shift/框选 全部整单元',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1], E = t.ids[6];
        const { mid } = await setupMerge(t, 'capsule');
        const unitStage = { x: t.posOf(A).x, y: t.posOf(A).y }; // 收拢点（舞台坐标）
        // ① 点选徽标 → [A,B]
        await inp.click(mid.x, mid.y, { hw: 'mouse' });
        await raf2();
        const s1 = t.sel().slice();
        const hlMid = ringMinDist(cv, mid.x, mid.y, t.rpx, HL);
        const r1 = await cmpShot('r07-1-click-unit');
        step('[STATE] ①点选徽标 → [A,B]（整单元，无单人中间态）', JSON.stringify(s1.slice().sort()) === JSON.stringify([A, B].sort()), `selection=[${s1.map(i => i.slice(0, 8))}]`);
        step('[PIXEL] ①徽标高亮出现', hlMid.d < TH_HL, `最小色距 ${hlMid.d.toFixed(1)} < ${TH_HL}`, 'PIXEL');
        cmpStep(step, r1);
        // ② shift+点他人 → 追加整单元
        await inp.click(t.ptOf(E).x, t.ptOf(E).y, { hw: 'mouse', shift: true });
        await raf2();
        const s2 = t.sel().slice();
        step('[STATE] ②shift+点他人 → [A,B,E]（单元原子追加）', JSON.stringify(s2.slice().sort()) === JSON.stringify([A, B, E].sort()), `selection=[${s2.map(i => i.slice(0, 8))}]`);
        // ③ shift+点徽标再按 → 整单元原子移出
        await inp.click(mid.x, mid.y, { hw: 'mouse', shift: true });
        await raf2();
        const s3 = t.sel().slice();
        const hlE = ringMinDist(cv, t.ptOf(E).x, t.ptOf(E).y, t.rpx, HL);
        const hlMidOff = ringMinDist(cv, mid.x, mid.y, t.rpx, HL);
        const r3 = await cmpShot('r07-3-shift-off');
        step('[STATE] ③shift+点徽标 → 整单元原子移出剩 [E]', JSON.stringify(s3) === JSON.stringify([E]), `selection=[${s3.map(i => i.slice(0, 8))}]`);
        step('[PIXEL] ③高亮跟随（徽标高亮消失、E 高亮保留）', hlMidOff.d >= TH_HL && hlE.d < TH_HL, `徽标 ${hlMidOff.d.toFixed(1)}(≥${TH_HL}) E ${hlE.d.toFixed(1)}(<${TH_HL})`, 'PIXEL');
        cmpStep(step, r3);
        // ④ 框选仅罩徽标 → [A,B]（B/A 同点，矩形命中任一成员即整单元）
        const b1 = ctx.toClient(unitStage.x - 0.55, unitStage.y - 0.55), b2 = ctx.toClient(unitStage.x + 0.55, unitStage.y + 0.55);
        await dragPts(b1, b2);
        await raf2();
        const s4 = t.sel().slice();
        const r4 = await cmpShot('r07-4-box');
        step('[STATE] ④框选罩徽标 → [A,B]（框选原子）', JSON.stringify(s4.slice().sort()) === JSON.stringify([A, B].sort()), `selection=[${s4.map(i => i.slice(0, 8))}]`);
        cmpStep(step, r4);
        // ⑤ 点空白 → 清空
        await inp.click(t.blank.x, t.blank.y, { hw: 'mouse' });
        await raf2();
        step('[STATE] ⑤点空白 → 清空', t.sel().length === 0, `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
      },
    },
  ];

  // ---- 按硬件过滤 + 包装（输入流水/数据快照/每线独立场景） ----
  const selected = defs.filter(d => d.hw.includes(phase) && (!only || d.id === only));
  const wrapped = selected.map(d => ({
    id: d.id, name: d.name,
    async run(kitArgs) {
      const t = await setup(`R ${phase}·${d.id}`);
      const mark = inLog.length;
      try {
        await d.run(t, kitArgs);
      } finally {
        d.log = inLog.slice(mark);
        d.snapAfter = { positions: JSON.parse(JSON.stringify(fmt().positions)), merges: fmt().merges || [], selection: t.sel(), hist: t.hist(), gesture: sv.gesture.state() };
      }
    },
  }));

  const results = await runCases(wrapped, shots, { failFast: true });
  for (let i = 0; i < results.length; i++) {
    results[i].log = selected[i].log || [];
    results[i].snapAfter = selected[i].snapAfter || null;
  }

  const r = cv.getBoundingClientRect();
  const meta = {
    phase, hw: HW, build: window.__MAIN_BUILD, dpr: dprOf(),
    view: { ...sv.view }, rpx: 0.38 * sv.view.scale,
    canvas: { left: r.left, top: r.top, w: r.width, h: r.height },
    idsCount: (store.getState().project?.dancers || []).length,
    snap: store.getState().project?.stage.snap,
  };
  return { phase, cases: results, shots, meta };
}
