// L1 测试仪器：原语手势动线 D-01~D-16 × 硬件矩阵（M=鼠标全量 / T=触摸子集 / P=笔子集）。
// 计划权威来源：tests/e2e-matrix.md §2。布置基线：真实 dancer id、12 人两行、snap 关、视图 fit；
// 每条动线后断言指针零残留 + state=IDLE + 无 .unit-menu（泄漏即停，§4.3）。
// 纪律：本文件属测试仪器，被测应用代码（js/*、index.html、css/*）零改动；场景搭建只走 store/M 公共 API。
// 结构纪律：每条动线「先执行/取证（手势必定收尾+清理），后断言」——失败即停（首败后后续断言作废）
// 时不会把指针/浮窗遗留在半途，避免把动线本身的失败污染成泄漏噪声。
// 运行前提：window.__fs、window.__input（page-injector.js v2）、window.__l1Shot（lab 驱动注入）。
// 入口：await import('/tests/page-l1.js') → await runL1({ phase: 'M'|'T'|'P', only?: 'D-06' })
//       返回 { phase, cases, shots, meta }；cases[i] = { id, name, ok, evidence, steps, log, snapAfter }。
import {
  raf2, sleep, TH_COLOR, TH_HL, TH_HL_DELTA, TH_BG, SCREEN_RATIO,
  makeCtx, dprOf, mean3x3, dist, rgb, hex, ringMinDist, innerMinDist, minDistOver, gridRegion,
  measureRadius, edgeMinDist, px1, decodeShot, screenCompare, runCases,
} from './page-kit.js';

const HW_OF = { M: 'mouse', T: 'touch', P: 'pen' };
const ACC = hex('#38bdf8');   // 框选矩形/朝向把手/浮窗边框主题蓝（dark 主题 --acc）
const HL = hex('#0ea5e9');    // 选中高亮

export async function runL1(opts = {}) {
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
  for (const op of ['down', 'move', 'up', 'cancel', 'click', 'dblclick', 'press', 'drag', 'pinch', 'wheel', 'key', 'keyUp']) {
    const orig = inp[op].bind(inp);
    inp[op] = (...a) => {
      inLog.push({ t: Math.round(performance.now()), op, args: a.map(v => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v)) });
      return orig(...a);
    };
  }

  // ---- 每条动线独立场景：真实 id / 12 人两行 / snap 关 / 视图 fit / 历史仅剩基线 ----
  async function setup(title) {
    store.createNewProject({ title, pairs: 6 });
    store.setUI({ selection: [], multiSelect: false, editMode: true, showFacingHandle: false });
    store.mutate(p => { p.stage.snap = false; }); // 无 label：不产生历史
    sv.resetView();
    await raf2();
    const ids = M.orderedDancers(state().project, 'pair');
    const dancerOf = id => state().project.dancers.find(d => d.id === id);
    const posOf = id => ({ ...fmt().positions[id] });
    const ptOf = id => { const p = posOf(id); return ctx.toClient(p.x, p.y); };
    const blank = ctx.toClient(5.85, 12.45); // 空白采样点（远离舞者/网格线/中心线）
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
    return { el, rect: r, title: el.querySelector('.um-title')?.textContent || '', text: el.textContent.slice(0, 60) };
  };
  const rectDist = (r, pt) => Math.hypot(Math.max(r.left - pt.x, 0, pt.x - r.right), Math.max(r.top - pt.y, 0, pt.y - r.bottom));
  async function closeMenu() { // 点浮窗 ✕（DOM 路径，不经过画布手势）
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
  const canvasCenter = () => { const r = cv.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };
  async function dragPts(from, to, { n = 4, stepMs = 30 } = {}) { // 3+ 渐进 move，每步 stepMs
    const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }));
    await inp.drag(pts, { hw: HW, stepMs });
    return pts;
  }
  async function cmpShot(tag, mask = null) { // 截图归档 + 回注比对（返回证据，不直接断言）；mask=需剔除的 DOM 覆盖区
    const b64 = await (window.__l1Shot || window.__l0Shot)();
    shots[tag] = b64;
    const cmp = await screenCompare(2, mask);
    return { b64, cmp, tag };
  }
  const inflate = (r, n = 32) => ({ x0: r.left - n, y0: r.top - n, x1: r.right + n, y1: r.bottom + n }); // 含浮窗阴影
  const cmpStep = (step, r) => step('[SCREEN] 屏幕=位图（差异<0.5%）', r.cmp.best < SCREEN_RATIO,
    `raw=${(r.cmp.raw * 100).toFixed(4)}% best±1px=${(r.cmp.best * 100).toFixed(4)}%@off[${r.cmp.bestOff}] → ${r.tag}.png`, 'SCREEN');
  async function menuBorder(b64, m) { // 截图上浮窗边框色采样（§0.1.5 交叉验证：DOM rect 处应见 #38bdf8 边框）
    const { img, w } = await decodeShot(b64);
    const r = m.rect, d = dprOf();
    return edgeMinDist((x, y) => {
      const px = Math.round(x * d), py = Math.round(y * d);
      if (px < 0 || py < 0 || px >= w || py >= img.height) return null;
      const i = (py * w + px) * 4;
      return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
    }, r.left, r.top, r.right, r.bottom, ACC, 3, 3);
  }
  async function setupMerge(t, style = 'capsule') { // 合并场景装配（D-04/D-05/D-05n 共用，无 label 不动历史）
    const idA = t.ids[0], idB = t.ids[1];
    store.mutate(p => {
      const f = p.formations[state().formationIndex];
      M.addMerge(f, idA, idB, style);
      M.collapsePair(f, idA, idB);
    });
    await raf2();
    return { idA, idB, mid: t.mergePt(idA, idB) };
  }

  // =====================================================================
  // 动线定义（hw: 适用硬件位）
  // =====================================================================
  const defs = [

    // ---------- D-01 单击选择 [M/T/P] ----------
    {
      id: 'D-01', hw: 'MTP', name: '单击选择',
      async run(t, { step }) {
        const A = t.ids[0], other = t.ids[3];
        const pA = t.ptOf(A), pO = t.ptOf(other);
        const preHL = ringMinDist(cv, pA.x, pA.y, t.rpx, HL);
        await inp.click(pA.x, pA.y, { hw: HW });
        await raf2();
        const r = await cmpShot('d01-selected');
        const postHL = ringMinDist(cv, pA.x, pA.y, t.rpx, HL);
        const hlO = ringMinDist(cv, pO.x, pO.y, t.rpx, HL);
        step('[STATE] selection==[A]', JSON.stringify(t.sel()) === JSON.stringify([A]), `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[STATE] undo 栈不变', !store.canUndo() && !store.canRedo(), t.hist());
        step('[PIXEL] A 圆环出现选中高亮', postHL.d < TH_HL && preHL.d - postHL.d >= TH_HL_DELTA,
          `选中后最小色距 ${postHL.d.toFixed(1)}@${JSON.stringify(postHL.at)}（选中前 ${preHL.d.toFixed(1)}，下降 ${(preHL.d - postHL.d).toFixed(1)}）`, 'PIXEL');
        step('[PIXEL] 其他舞者无高亮', hlO.d >= TH_HL, `他人圆环最小色距 ${hlO.d.toFixed(1)} ≥ ${TH_HL}`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-02 单击空白 [M/T] ----------
    {
      id: 'D-02', hw: 'MT', name: '单击空白取消选择',
      async run(t, { step }) {
        const A = t.ids[0], pA = t.ptOf(A);
        await inp.click(pA.x, pA.y, { hw: HW });
        await raf2();
        const preOK = JSON.stringify(t.sel()) === JSON.stringify([A]);
        await inp.click(t.blank.x, t.blank.y, { hw: HW });
        await raf2();
        const r = await cmpShot('d02-blank');
        const hlA = ringMinDist(cv, pA.x, pA.y, t.rpx, HL);
        step('[前置] 已选中 A', preOK, `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[STATE] 单击空白后 selection 清空', t.sel().length === 0, `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[PIXEL] 高亮消失', hlA.d >= TH_HL, `A 圆环最小色距 ${hlA.d.toFixed(1)} ≥ ${TH_HL}`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-03 Shift 多选/移出 [M] ----------
    {
      id: 'D-03', hw: 'M', name: 'Shift 多选/移出',
      async run(t, { step }) {
        const A = t.ids[0], C = t.ids[2], pA = t.ptOf(A), pC = t.ptOf(C);
        await inp.click(pA.x, pA.y, { hw: HW, shift: true });
        await raf2();
        const s1 = t.sel().slice();
        await inp.click(pC.x, pC.y, { hw: HW, shift: true });
        await raf2();
        const s2 = t.sel().slice();
        const r2 = await cmpShot('d03-two');
        const hlA2 = ringMinDist(cv, pA.x, pA.y, t.rpx, HL), hlC2 = ringMinDist(cv, pC.x, pC.y, t.rpx, HL);
        await inp.click(pA.x, pA.y, { hw: HW, shift: true });
        await raf2();
        const s3 = t.sel().slice();
        const r3 = await cmpShot('d03-one');
        const hlA3 = ringMinDist(cv, pA.x, pA.y, t.rpx, HL), hlC3 = ringMinDist(cv, pC.x, pC.y, t.rpx, HL);
        step('[STATE] shift+click A → [A]', JSON.stringify(s1) === JSON.stringify([A]), `selection=[${s1.map(i => i.slice(0, 8))}]`);
        step('[STATE] shift+click C → 2 人', s2.length === 2 && s2.includes(A) && s2.includes(C), `selection=[${s2.map(i => i.slice(0, 8))}]`);
        step('[PIXEL] 高亮跟随（2 人）', hlA2.d < TH_HL && hlC2.d < TH_HL, `A=${hlA2.d.toFixed(1)} C=${hlC2.d.toFixed(1)} 均 < ${TH_HL}`, 'PIXEL');
        cmpStep(step, r2);
        step('[STATE] shift+click A 再按 → 移出剩 1 人', JSON.stringify(s3) === JSON.stringify([C]), `selection=[${s3.map(i => i.slice(0, 8))}]`);
        step('[PIXEL] 高亮跟随（移出）', hlA3.d >= TH_HL && hlC3.d < TH_HL, `A=${hlA3.d.toFixed(1)}(≥${TH_HL}) C=${hlC3.d.toFixed(1)}(<${TH_HL})`, 'PIXEL');
        cmpStep(step, r3);
      },
    },

    // ---------- D-04 双击合并单元 [M/T/P] ----------
    {
      id: 'D-04', hw: 'MTP', name: '双击合并单元弹浮窗',
      async run(t, { step }) {
        const { idA, idB, mid } = await setupMerge(t, 'capsule');
        const preOK = fmt().merges?.length === 1 && Math.hypot(t.posOf(idA).x - t.posOf(idB).x, t.posOf(idA).y - t.posOf(idB).y) < 1e-9;
        const data0 = t.data(), hist0 = t.hist();
        await inp.dblclick(mid.x, mid.y, { hw: HW });
        await raf2();
        const m = menu();
        const dataOK = t.data() === data0 && t.hist() === hist0;
        const d = m ? rectDist(m.rect, mid) : Infinity;
        let border = null, r = null;
        if (m) { r = await cmpShot('d04-menu', inflate(m.rect)); border = await menuBorder(r.b64, m); }
        await closeMenu();
        step('[前置] 合并单元已建立（两人收拢）', preOK, `merges=[${(fmt().merges || []).map(x => x.style)}]`);
        step('[STATE] 无数据变更', dataOK, `data 不变=${dataOK}; ${hist0}`);
        step('[DOM] 弹窗出现', !!m, m ? `title="${m.title}" text="${m.text}"` : '无 .unit-menu', 'DOM');
        if (m) step('[DOM] rect 距单元 <150px', d < 150, `单元(${Math.round(mid.x)},${Math.round(mid.y)}) → rect 最近距离 ${d.toFixed(1)}px`, 'DOM');
        if (m) cmpStep(step, r);
        if (m) step('[SCREEN] 弹窗边框色可检出（≈#38bdf8）且位置与 DOM rect 一致', border.d < 140,
          `边框最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}（DOM rect ${Math.round(m.rect.width)}×${Math.round(m.rect.height)}@${Math.round(m.rect.left)},${Math.round(m.rect.top)}）`, 'SCREEN');
      },
    },

    // ---------- D-05 长按合并单元 [T/P]（mouse 明确不触发 → D-05n） ----------
    {
      id: 'D-05', hw: 'TP', name: '长按 700ms 合并单元弹浮窗',
      async run(t, { step }) {
        const { mid } = await setupMerge(t, 'capsule');
        const data0 = t.data();
        await inp.down(mid.x, mid.y, { hw: HW });
        await sleep(750); // lpMs=500 → 按住中段取证
        const shotHold = await (window.__l1Shot || window.__l0Shot)();
        shots['d05-hold-menu'] = shotHold;
        await inp.up(mid.x, mid.y, { hw: HW });
        await raf2();
        const m = menu(); // MENU 态吞掉抬起 → 长按弹出的浮窗松手后保留（若从未弹出则此处为空）
        const dataOK = t.data() === data0;
        let border = null, r = null;
        if (m) { r = await cmpShot('d05-menu', inflate(m.rect)); border = await menuBorder(r.b64, m); }
        await closeMenu();
        step('[STATE] 无数据变更', dataOK, `data 不变=${dataOK}`);
        step('[DOM] 长按（≥lpMs, <lpCancelPx 位移）触发浮窗且松手后保留', !!m,
          m ? `title="${m.title}"（中段截图 d05-hold-menu.png 为按住未松手时取证）` : '无 .unit-menu', 'DOM');
        if (m) cmpStep(step, r);
        if (m) step('[SCREEN] 浮窗边框色可检出（≈#38bdf8）', border.d < 140, `最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}`, 'SCREEN');
      },
    },

    // ---------- D-05n 桌面负断言 [M]：mouse 按住 800ms 不得弹浮窗 ----------
    {
      id: 'D-05n', hw: 'M', name: 'D-05 负断言：桌面长按不触发',
      async run(t, { step }) {
        const { mid } = await setupMerge(t, 'capsule');
        const data0 = t.data();
        await inp.down(mid.x, mid.y, { hw: 'mouse' });
        await sleep(800);
        const shotHold = await (window.__l1Shot || window.__l0Shot)();
        shots['d05n-hold'] = shotHold;
        await inp.up(mid.x, mid.y, { hw: 'mouse' });
        await raf2();
        const m = menu(); // 关键推理：MENU 态下抬起被吞、浮窗保留 —— 松手后无浮窗 ⟹ 按住期间从未弹出
        const r = await cmpShot('d05n-no-menu');
        step('[STATE] 无数据变更且零历史', t.data() === data0 && !store.canUndo(), `data 不变=${t.data() === data0}; ${t.hist()}`);
        step('[DOM] 按住 800ms 全程无浮窗（松手后复核）', !m, m ? `意外出现 title="${m.title}"` : '无 .unit-menu（含按住期间，见 d05n-hold.png）', 'DOM');
        cmpStep(step, r);
      },
    },

    // ---------- D-06 拖拽移动+松开 [M/T/P] ----------
    {
      id: 'D-06', hw: 'MTP', name: '拖拽移动+松开',
      async run(t, { step }) {
        const A = t.ids[0], orig = t.posOf(A), colA = t.col(A);
        const target = { x: orig.x + 1.0, y: orig.y - 2.0 }; // 空旷区（无重叠）
        const others0 = t.data();
        await dragPts(t.ptOf(A), ctx.toClient(target.x, target.y));
        await raf2();
        const p1 = t.posOf(A);
        const movedOK = Math.abs(p1.x - target.x) < 1e-6 && Math.abs(p1.y - target.y) < 1e-6;
        const a0 = JSON.parse(others0), a1 = JSON.parse(t.data()); delete a0.p[A]; delete a1.p[A];
        const othersOK = JSON.stringify(a0) === JSON.stringify(a1);
        const histOK = store.canUndo() && store.undoLabel() === '移动舞者' && !store.canRedo();
        store.undo(); await raf2();
        const pU = t.posOf(A);
        const undoOK = !store.canUndo() && Math.abs(pU.x - orig.x) < 1e-9 && Math.abs(pU.y - orig.y) < 1e-9;
        store.redo(); await raf2();
        const pR = t.posOf(A);
        const redoOK = store.canUndo() && store.undoLabel() === '移动舞者' && !store.canRedo() && Math.abs(pR.x - target.x) < 1e-6;
        const noMenu = !menu();
        const oldPt = ctx.toClient(orig.x, orig.y), newPt = t.ptOf(A);
        const oldC = mean3x3(cv, oldPt.x, oldPt.y);
        const inNew = innerMinDist(cv, newPt.x, newPt.y, t.rpx, colA);
        const r = await cmpShot('d06-moved');
        step('[STATE] 仅该舞者位移 delta=精确值（snap 关）', movedOK, `pos=(${p1.x.toFixed(6)},${p1.y.toFixed(6)}) 期望 (${target.x},${target.y})`);
        step('[STATE] 其他舞者零位移', othersOK, '');
        step('[STATE] 恰一条「移动舞者」历史', histOK, t.hist());
        step('[STATE] undo 一次即回基线（证历史恰一条）', undoOK, `undo 后 pos=(${pU.x},${pU.y})`);
        step('[STATE] redo 重放到目标', redoOK, `redo 后 pos=(${pR.x.toFixed(6)},${pR.y.toFixed(6)}) ${t.hist()}`);
        step('[DOM] 松手点无重叠 → 无弹窗', noMenu, '', 'DOM');
        step('[PIXEL] 旧圆心回基线色', dist(oldC, t.base) < TH_BG, `旧圆心 ${rgb(oldC)} 距基线 ${dist(oldC, t.base).toFixed(1)} < ${TH_BG}`, 'PIXEL');
        step('[PIXEL] 新圆心出现舞者色', inNew.d < TH_COLOR, `0.55r 8 向最小色距 ${inNew.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-07 拖拽驻留合并 [M/T/P] ----------
    {
      id: 'D-07', hw: 'MTP', name: '拖拽驻留合并（dwell≥1.5s 不松手弹窗）',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        const posB = t.posOf(B);
        const end = ctx.toClient(posB.x, posB.y);
        const pts = [t.ptOf(A)];
        for (let i = 1; i <= 3; i++) pts.push({ x: pts[0].x + (end.x - pts[0].x) * i / 3, y: pts[0].y + (end.y - pts[0].y) * i / 3 });
        // ---- 执行（无断言）：拖到 B 上 → 驻留 300ms（<dwellMs）→ 再驻留 1700ms → 松手 → 取消浮窗 ----
        const pid = await inp.down(pts[0].x, pts[0].y, { hw: HW });
        for (let i = 1; i < pts.length; i++) { await sleep(30); await inp.move(pts[i].x, pts[i].y, { hw: HW, pid }); }
        await sleep(300);
        await inp.move(pts[3].x, pts[3].y, { hw: HW, pid });
        const preDwell = { committed: store.canUndo(), state: sv.gesture.state() };
        await sleep(1700);
        await inp.move(pts[3].x, pts[3].y, { hw: HW, pid }); // 驻留判定在 move 中评估：≥dwellMs → 提交 + 弹窗
        await raf2();
        const m = menu();
        const during = {
          menu: !!m && m.title === '合并为单元',
          committed: store.canUndo() && store.undoLabel() === '移动舞者',
        };
        let border = null, r = null;
        if (m) { r = await cmpShot('d07-dwell-menu', inflate(m.rect)); border = await menuBorder(r.b64, m); }
        await inp.up(pts[3].x, pts[3].y, { hw: HW, pid });
        await raf2();
        const menuAfterUp = !!menu();
        await closeMenu();
        const pA = t.posOf(A);
        const keepOK = Math.hypot(pA.x - posB.x, pA.y - posB.y) < 1e-6 && !(fmt().merges || []).length && store.undoLabel() === '移动舞者';
        // ---- 断言 ----
        step('[STATE] 驻留 <dwellMs 时未提交且仍在拖拽', !preDwell.committed && preDwell.state === 'DRAG', `驻留 300ms 后 ${preDwell.state} canUndo=${preDwell.committed}`);
        step('[DOM] 驻留 ≥dwellMs（未松手）弹窗出现', during.menu, m ? `title="${m.title}"` : `无 .unit-menu（state=${sv.gesture.state()}）`, 'DOM');
        step('[STATE] 位移已提交（松手前，取消确认也保留）', during.committed, `松手前 ${t.hist()}`);
        if (m) cmpStep(step, r);
        if (m) step('[SCREEN] 弹窗边框色可检出（≈#38bdf8）', border.d < 140, `最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}`, 'SCREEN');
        step('[DOM] 松手后浮窗保留（待确认）', menuAfterUp, '', 'DOM');
        step('[STATE] 取消确认后位移保留', keepOK, `A=(${pA.x.toFixed(6)},${pA.y.toFixed(6)}) ≈ B 位；merges=${(fmt().merges || []).length}; ${t.hist()}`);
      },
    },

    // ---------- D-08 框选 [M] ----------
    {
      id: 'D-08', hw: 'M', name: '框选（拖动中蓝框可见、松手消失）',
      async run(t, { step }) {
        const f = v => ({ x: Math.floor(v.x) + 0.3, y: Math.floor(v.y) + 0.3 }); // 像素对齐分数偏移：1px 描边最近像素覆盖 ≥70%
        const p1 = f(ctx.toClient(0.9, 6.1)), p2 = f(ctx.toClient(5.6, 9.7));
        // 周边扫描点集（四边 ±3px）：pre/mid/post 三次采样同一组点
        const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x), top = Math.min(p1.y, p2.y), bot = Math.max(p1.y, p2.y);
        const pts = [];
        for (let x = left + 2; x <= right - 2; x += 4) for (let o = -3; o <= 3; o++) pts.push([x, top + o], [x, bot + o]);
        for (let y = top + 2; y <= bot - 2; y += 4) for (let o = -3; o <= 3; o++) pts.push([left + o, y], [right + o, y]);
        const sampleAll = () => pts.map(([x, y]) => px1(cv, x, y));
        const prePx = sampleAll();
        const preArr = prePx.map(p => (p ? dist(p, ACC) : Infinity));
        // ---- 执行：空白处按下 → 拖出矩形（拖动中取证）→ 松手 ----
        const pid = await inp.down(p1.x, p1.y, { hw: 'mouse' });
        await sleep(30);
        await inp.move((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, { hw: 'mouse', pid });
        await sleep(30);
        await inp.move(p2.x, p2.y, { hw: 'mouse', pid });
        await raf2();
        const midPx = sampleAll();
        const midArr = midPx.map(p => (p ? dist(p, ACC) : Infinity));
        let midMin = Infinity, midIdx = -1;
        midArr.forEach((d, i) => { if (d < midMin) { midMin = d; midIdx = i; } });
        const rDrag = await cmpShot('d08-box-drag');
        await inp.up(p2.x, p2.y, { hw: 'mouse', pid });
        await raf2();
        const sP1 = sv.toStage(p1.x, p1.y), sP2 = sv.toStage(p2.x, p2.y);
        const x0 = Math.min(sP1.x, sP2.x), x1 = Math.max(sP1.x, sP2.x), y0 = Math.min(sP1.y, sP2.y), y1 = Math.max(sP1.y, sP2.y);
        const expect = Object.entries(fmt().positions).filter(([, p]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map(([id]) => id).sort();
        const selOK = JSON.stringify(t.sel().slice().sort()) === JSON.stringify(expect);
        const postPx = sampleAll();
        const restored = dist(postPx[midIdx], prePx[midIdx]);
        const rUp = await cmpShot('d08-box-up');
        // ---- 断言 ----
        step('[PIXEL] 拖动中蓝色边框可见', midMin < 80 && Math.min(...preArr) - midMin > 60,
          `边框单像素最小色距 ${midMin.toFixed(1)}@${JSON.stringify(pts[midIdx])}（拖动前同点集最小 ${Math.min(...preArr).toFixed(1)}）矩形 (${Math.round(p1.x)},${Math.round(p1.y)})-(${Math.round(p2.x)},${Math.round(p2.y)})`, 'PIXEL');
        cmpStep(step, rDrag);
        step('[STATE] 矩形内全选', selOK, `selection ${t.sel().length} 人=[${t.sel().map(i => i.slice(0, 8))}] 期望 ${expect.length} 人`);
        step('[PIXEL] 松手边框消失（描边点位恢复按下前颜色）', restored < 15,
          `拖动中蓝框最强点 ${JSON.stringify(pts[midIdx])} 松手后与按下前色差 ${restored.toFixed(1)} < 15`, 'PIXEL');
        cmpStep(step, rUp);
      },
    },

    // ---------- D-09 双指捏合 [T] ----------
    {
      id: 'D-09', hw: 'T', name: '双指捏合缩放',
      async run(t, { step }) {
        const A = t.ids[0], colA = t.col(A), c = canvasCenter(), s0 = sv.view.scale;
        const pA = t.ptOf(A);
        const rad0 = measureRadius(cv, pA.x, pA.y, t.rpx * 2.5, colA);
        await inp.pinch(c.x, c.y, 120, 220, { hw: 'touch' });
        await raf2();
        const s1 = sv.view.scale, k = s1 / s0;
        const rpx1 = 0.38 * s1, pA2 = t.ptOf(A);
        const rad1 = measureRadius(cv, pA2.x, pA2.y, rpx1 * 2, colA);
        const r = await cmpShot('d09-pinch');
        sv.resetView(); await raf2();
        step('[前置] 基线半径采样', Math.abs(rad0.median - t.rpx) <= 2, `采样半径 ${rad0.median}px ≈ rpx ${t.rpx.toFixed(1)} rays=[${rad0.rays}]`);
        step('[STATE] scale 变化 |Δ|>1（注入 120→220px）', k > 1.2 && Math.abs(k - 220 / 120) < 0.15, `scale ${s0.toFixed(2)}→${s1.toFixed(2)} ×${k.toFixed(3)}（理论 ×1.833）`);
        step('[PIXEL] 舞者直径等比变大', Math.abs(rad1.median - rpx1) <= 2 && rad1.median > rad0.median,
          `采样半径 ${rad1.median}px ≈ 预测 ${rpx1.toFixed(1)}px（×${(rad1.median / rad0.median).toFixed(2)} vs 视图 ×${k.toFixed(2)}）`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-10 滚轮缩放 [M] ----------
    {
      id: 'D-10', hw: 'M', name: '滚轮缩放锚点',
      async run(t, { step }) {
        const A = t.ids[0], colA = t.col(A), c = canvasCenter(), s0 = sv.view.scale;
        const sp = sv.toStage(c.x, c.y);
        const pA = t.ptOf(A);
        const rad0 = measureRadius(cv, pA.x, pA.y, t.rpx * 2.5, colA);
        inp.wheel(c.x, c.y, -240);
        await raf2();
        const s1 = sv.view.scale, k = s1 / s0;
        const sp2 = sv.toStage(c.x, c.y);
        const rpx1 = 0.38 * s1, pA2 = t.ptOf(A);
        const rad1 = measureRadius(cv, pA2.x, pA2.y, rpx1 * 2, colA);
        const r = await cmpShot('d10-zoom');
        sv.resetView(); await raf2();
        step('[前置] 基线半径采样', Math.abs(rad0.median - t.rpx) <= 2, `采样半径 ${rad0.median}px ≈ rpx ${t.rpx.toFixed(1)}`);
        step('[STATE] scale ≥20% 变化', Math.abs(k - 1) >= 0.2, `scale ${s0.toFixed(2)}→${s1.toFixed(2)} ×${k.toFixed(3)}（Δ${((k - 1) * 100).toFixed(0)}%）`);
        step('[STATE] 缩放锚点下舞台点不漂移（<0.02m）', Math.hypot(sp2.x - sp.x, sp2.y - sp.y) < 0.02,
          `锚点舞台点 (${sp.x.toFixed(4)},${sp.y.toFixed(4)}) → (${sp2.x.toFixed(4)},${sp2.y.toFixed(4)}) 漂移 ${Math.hypot(sp2.x - sp.x, sp2.y - sp.y).toFixed(5)}m`);
        step('[PIXEL] 舞者半径等比放大', Math.abs(rad1.median - rpx1) <= 2,
          `采样半径 ${rad1.median}px ≈ 预测 ${rpx1.toFixed(1)}px（×${(rad1.median / rad0.median).toFixed(2)} vs 视图 ×${k.toFixed(2)}）`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-11 平移 [M/T] ----------
    // 裁定语义（round4）：左键空白拖动=框选不变（D-08 回归点）；桌面平移=中键空白拖动
    // 或 空格+左键空白拖动；触摸单指空白拖动=平移（点按清选归 D-02）。
    // 负断言：空格单独短按仍=播放/暂停（仅参与过指针手势的空格才吞掉切换）；
    // 中键/空格+左键按在舞者上=零动作（不平移、不选择、不编辑、零历史）。
    {
      id: 'D-11', hw: 'MT', name: '空白拖动平移（不改数据不改选择）',
      async run(t, { step }) {
        const player = () => window.__fs.player();
        const playBtn = () => document.getElementById('pb-play')?.textContent;
        const A = t.ids[0], B = t.ids[6];
        const data0 = t.data(), sel0 = t.sel();
        const v0 = { ...sv.view };
        const preA = t.ptOf(A), preB = t.ptOf(B);
        const p1 = ctx.toClient(1.5, 12.0), p2 = ctx.toClient(3.5, 12.6); // 空白走廊
        const arrEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const panCheck = async tag => { // 平移取证（子动线共用）：view Δ + 全体舞者等量平移 + SCREEN；取证后复位视图
          const v1 = { ...sv.view };
          const dView = { x: v1.ox - v0.ox, y: v1.oy - v0.oy };
          const postA = t.ptOf(A), postB = t.ptOf(B); // 复位前取证（ptOf 依赖当前 view）
          const okA = Math.abs((postA.x - preA.x) - dView.x) < 2 && Math.abs((postA.y - preA.y) - dView.y) < 2;
          const okB = Math.abs((postB.x - preB.x) - dView.x) < 2 && Math.abs((postB.y - preB.y) - dView.y) < 2;
          const r = await cmpShot(tag);
          sv.resetView(); await raf2();
          return { dView, v1, postA, postB, okA, okB, r };
        };

        if (HW === 'mouse') {
          // ---- 子动线 1：中键按住空白拖动 = 平移 ----
          const pidM = await inp.down(p1.x, p1.y, { hw: 'mouse', button: 1 });
          await sleep(30);
          await inp.move((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, { hw: 'mouse', pid: pidM });
          await sleep(30);
          await inp.up(p2.x, p2.y, { hw: 'mouse', pid: pidM });
          await raf2();
          const mid = await panCheck('d11-pan-middle');

          // ---- 子动线 2：空格按住 + 左键拖空白 = 平移 ----
          inp.key(' ', { code: 'Space' });
          await sleep(30);
          await dragPts(p1, p2);
          await sleep(30);
          inp.keyUp(' ', { code: 'Space' });
          await raf2();
          const spc = await panCheck('d11-pan-space');
          const spaceHeldAfter = sv.spaceHeld;                  // keyup 清掉修饰键（取证于松开当时）
          const spaceReleased = spaceHeldAfter === false;
          const noPlayAfterPan = player()?.playing === false;   // 空格参与过指针手势 → keyup 不切播放

          // ---- 子动线 3：左键拖空白 = 仍框选（D-08 回归点；view 不动） ----
          const f = v => ({ x: Math.floor(v.x) + 0.3, y: Math.floor(v.y) + 0.3 });
          const b1 = f(ctx.toClient(0.9, 6.1)), b2 = f(ctx.toClient(5.6, 9.7));
          await dragPts(b1, b2);
          await raf2();
          const sP1 = sv.toStage(b1.x, b1.y), sP2 = sv.toStage(b2.x, b2.y);
          const bx0 = Math.min(sP1.x, sP2.x), bx1 = Math.max(sP1.x, sP2.x), by0 = Math.min(sP1.y, sP2.y), by1 = Math.max(sP1.y, sP2.y);
          const expect = Object.entries(fmt().positions).filter(([, p]) => p.x >= bx0 && p.x <= bx1 && p.y >= by0 && p.y <= by1).map(([id]) => id).sort();
          const boxSelOK = expect.length > 0 && arrEq(t.sel().slice().sort(), expect);
          const vBox = { ...sv.view };
          const boxNoPan = Math.abs(vBox.ox - v0.ox) < 0.5 && Math.abs(vBox.oy - v0.oy) < 0.5;
          const rBox = await cmpShot('d11-box');
          store.setUI({ selection: [] }); await raf2(); // 清理（仪器布置，走 store 公共 API）

          // ---- 负断言 1：空格单独短按 = 播放/暂停（不被平移语义吞掉，readOnly 不被误置） ----
          inp.key(' ', { code: 'Space' }); await sleep(90); inp.keyUp(' ', { code: 'Space' }); await raf2();
          const playOnEv = `playing=${player()?.playing} pb-play="${playBtn()}"`;
          const playOn = player()?.playing === true && playBtn() === '⏸';
          inp.key(' ', { code: 'Space' }); await sleep(90); inp.keyUp(' ', { code: 'Space' }); await raf2();
          const playOffEv = `pb-play="${playBtn()}" editMode=${state().editMode} playing=${player()?.playing}`;
          const playOff = player()?.playing === false && playBtn() === '▶' && state().editMode !== false;
          const rPlay = await cmpShot('d11-space-play');

          // ---- 负断言 2：中键 / 空格+左键 按在舞者上 = 零动作 ----
          const vD = { ...sv.view }, dataD = t.data(), selD = t.sel(), posA0 = t.posOf(A);
          const pA0 = t.ptOf(A), pA1 = { x: pA0.x + 40, y: pA0.y - 30 };
          const pidZ = await inp.down(pA0.x, pA0.y, { hw: 'mouse', button: 1 });
          await sleep(30);
          await inp.move(pA1.x, pA1.y, { hw: 'mouse', pid: pidZ });
          await sleep(30);
          await inp.up(pA1.x, pA1.y, { hw: 'mouse', pid: pidZ });
          await raf2();
          inp.key(' ', { code: 'Space' }); await sleep(30);
          const pidZ2 = await inp.down(pA0.x, pA0.y, { hw: 'mouse' });
          await sleep(30);
          await inp.move(pA1.x, pA1.y, { hw: 'mouse', pid: pidZ2 });
          await sleep(30);
          await inp.up(pA1.x, pA1.y, { hw: 'mouse', pid: pidZ2 });
          inp.keyUp(' ', { code: 'Space' });
          await raf2();
          const vD2 = { ...sv.view }, posA2 = t.posOf(A);
          const zeroOK = t.data() === dataD && arrEq(t.sel(), selD) &&
            Math.abs(vD2.ox - vD.ox) < 0.5 && Math.abs(vD2.oy - vD.oy) < 0.5 &&
            Math.abs(posA2.x - posA0.x) < 1e-9 && Math.abs(posA2.y - posA0.y) < 1e-9 &&
            !store.canUndo() && !store.canRedo() && player()?.playing === false;
          const rZero = await cmpShot('d11-dancer-zero');

          // ---- 断言 ----
          step('[STATE] 中键空白拖动：view.ox/oy 变化（平移发生）', Math.hypot(mid.dView.x, mid.dView.y) > 5,
            `view ox ${v0.ox.toFixed(1)}→${mid.v1.ox.toFixed(1)}, oy ${v0.oy.toFixed(1)}→${mid.v1.oy.toFixed(1)}（Δ=${Math.hypot(mid.dView.x, mid.dView.y).toFixed(1)}px）`);
          step('[STATE] 中键平移：数据不变、选择不变、零历史', t.data() === data0 && arrEq(t.sel(), sel0) && !store.canUndo(),
            `selection=[${t.sel().map(i => i.slice(0, 8))}] ${t.hist()}`);
          step('[PIXEL] 中键平移：全体舞者等量平移', mid.okA && mid.okB,
            `A Δ=(${(mid.postA.x - preA.x).toFixed(1)},${(mid.postA.y - preA.y).toFixed(1)}) B Δ=(${(mid.postB.x - preB.x).toFixed(1)},${(mid.postB.y - preB.y).toFixed(1)}) view Δ=(${mid.dView.x.toFixed(1)},${mid.dView.y.toFixed(1)})`, 'PIXEL');
          cmpStep(step, mid.r);
          step('[STATE] 空格+左键空白拖动：view.ox/oy 变化（平移发生）', Math.hypot(spc.dView.x, spc.dView.y) > 5,
            `view Δ=${Math.hypot(spc.dView.x, spc.dView.y).toFixed(1)}px；keyup 后 spaceHeld=${spaceHeldAfter}`);
          step('[STATE] 空格平移：数据不变、选择不变；keyup 清修饰键', t.data() === data0 && arrEq(t.sel(), sel0) && spaceReleased,
            `spaceHeld 复位=${spaceReleased}；${t.hist()}`);
          step('[STATE] 参与过指针手势的空格 keyup 不切换播放/暂停', noPlayAfterPan,
            `playing=${player()?.playing}（期望 false，▶ 按钮不被触发）`);
          step('[PIXEL] 空格平移：全体舞者等量平移', spc.okA && spc.okB,
            `view Δ=(${spc.dView.x.toFixed(1)},${spc.dView.y.toFixed(1)})`, 'PIXEL');
          cmpStep(step, spc.r);
          step('[STATE] 左键空白拖动仍=框选：矩形内全选（D-08 回归点）', boxSelOK,
            `selection ${t.sel().length} 人 期望 ${expect.length} 人（矩形 (${bx0.toFixed(1)},${by0.toFixed(1)})-(${bx1.toFixed(1)},${by1.toFixed(1)})）`);
          step('[STATE] 左键空白拖动不平移（view 不动）', boxNoPan,
            `view Δox=${(vBox.ox - v0.ox).toFixed(2)} Δoy=${(vBox.oy - v0.oy).toFixed(2)}`);
          cmpStep(step, rBox);
          step('[STATE] 空格单独短按：播放开始（⏸）', playOn, playOnEv);
          step('[STATE] 空格再次短按：暂停（▶），编辑开关未被误改', playOff, playOffEv);
          cmpStep(step, rPlay);
          step('[STATE] 中键/空格+左键按在舞者上=零动作（零平移/零选择/零数据/零历史/零播放）', zeroOK,
            `selection=[${t.sel().map(i => i.slice(0, 8))}] A=(${posA2.x.toFixed(6)},${posA2.y.toFixed(6)}) view Δox=${(vD2.ox - vD.ox).toFixed(2)} playing=${player()?.playing} ${t.hist()}`);
          cmpStep(step, rZero);
          return;
        }

        // ---- 触摸：单指空白拖动 = 平移（原语义保持） ----
        await dragPts(p1, p2);
        await raf2();
        const d11 = await panCheck('d11-pan');
        step('[STATE] view.ox/oy 变化（平移发生）', Math.hypot(d11.dView.x, d11.dView.y) > 5,
          `view ox ${v0.ox.toFixed(1)}→${d11.v1.ox.toFixed(1)}, oy ${v0.oy.toFixed(1)}→${d11.v1.oy.toFixed(1)}（Δ=${Math.hypot(d11.dView.x, d11.dView.y).toFixed(1)}px）`);
        step('[STATE] 数据不变', t.data() === data0, '');
        step('[STATE] 选择不变', arrEq(t.sel(), sel0), `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[PIXEL] 全体舞者等量平移', d11.okA && d11.okB,
          `A Δ=(${(d11.postA.x - preA.x).toFixed(1)},${(d11.postA.y - preA.y).toFixed(1)}) B Δ=(${(d11.postB.x - preB.x).toFixed(1)},${(d11.postB.y - preB.y).toFixed(1)}) view Δ=(${d11.dView.x.toFixed(1)},${d11.dView.y.toFixed(1)})`, 'PIXEL');
        cmpStep(step, d11.r);
      },
    },

    // ---------- D-12 Escape 取消 [M] ----------
    {
      id: 'D-12', hw: 'M', name: 'Escape 拖拽回滚零历史',
      async run(t, { step }) {
        const A = t.ids[0], orig = t.posOf(A), colA = t.col(A);
        const from = t.ptOf(A), to = ctx.toClient(orig.x + 1.0, orig.y - 2.0);
        // ---- 执行：按下 → 3 渐进 move → 拖动中途 Escape → 松手 ----
        const pid = await inp.down(from.x, from.y, { hw: 'mouse' });
        for (let i = 1; i <= 3; i++) {
          const q = { x: from.x + (to.x - from.x) * i / 3, y: from.y + (to.y - from.y) * i / 3 };
          await sleep(30);
          await inp.move(q.x, q.y, { hw: 'mouse', pid });
        }
        inp.key('Escape');
        await raf2();
        const pEsc = t.posOf(A);
        await inp.up(to.x, to.y, { hw: 'mouse', pid });
        await raf2();
        const histOK = !store.canUndo() && !store.canRedo() && store.undoLabel() === '';
        const inA = innerMinDist(cv, from.x, from.y, t.rpx, colA);
        const r = await cmpShot('d12-escape');
        // ---- 断言 ----
        step('[STATE] 拖动中途 Escape → 位置精确还原', Math.abs(pEsc.x - orig.x) < 1e-9 && Math.abs(pEsc.y - orig.y) < 1e-9, `pos=(${pEsc.x},${pEsc.y})`);
        step('[STATE] 松手后 undo 栈零增长', histOK, t.hist());
        step('[PIXEL] 位图还原（原圆心舞者色）', inA.d < TH_COLOR, `0.55r 8 向最小色距 ${inA.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-13 方向键微调 [M] ----------
    {
      id: 'D-13', hw: 'M', name: '方向键微调（snap 关=+0.1 / 开=对齐 0.5）',
      async run(t, { step }) {
        const A = t.ids[0], colA = t.col(A);
        await inp.click(t.ptOf(A).x, t.ptOf(A).y, { hw: 'mouse' });
        await raf2();
        const preOK = JSON.stringify(t.sel()) === JSON.stringify([A]);
        const orig = t.posOf(A);
        inp.key('ArrowRight');
        await raf2();
        const p1 = t.posOf(A);
        const inNew = innerMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, colA);
        const r1 = await cmpShot('d13-snap-off');
        // snap 开子检查：先吸到网格点（仪器布置，无 label 不动历史），再按方向键
        store.mutate(p => { p.stage.snap = true; const q = p.formations[state().formationIndex].positions[A]; q.x = 2.0; q.y = 6.0; });
        await raf2();
        inp.key('ArrowRight');
        await raf2();
        const p2 = t.posOf(A);
        const r2 = await cmpShot('d13-snap-on');
        store.mutate(p => { p.stage.snap = false; });
        await raf2();
        step('[前置] 已选中 A', preOK, `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[STATE] snap 关：ArrowRight = +0.1 精确', Math.abs(p1.x - (orig.x + 0.1)) < 1e-9 && p1.y === orig.y, `x ${orig.x} → ${p1.x}（期望 ${orig.x + 0.1}）`);
        step('[PIXEL] 新位置出现舞者色', inNew.d < TH_COLOR, `最小色距 ${inNew.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, r1);
        step('[STATE] snap 开：+0.5 且对齐 0.5 网格', Math.abs(p2.x - 2.5) < 1e-9 && Math.abs(p2.x % 0.5) < 1e-9 && p2.y === 6.0, `x 2.0 → ${p2.x}（期望 2.5，网格 0.5）`);
        cmpStep(step, r2);
      },
    },

    // ---------- D-14 朝向把手 [M] ----------
    {
      id: 'D-14', hw: 'M', name: '朝向把手拖动',
      async run(t, { step }) {
        const A = t.ids[0];
        store.setUI({ showFacingHandle: true });
        await inp.click(t.ptOf(A).x, t.ptOf(A).y, { hw: 'mouse' });
        await raf2();
        const h0 = sv.handlePx;
        const histPre = t.hist();
        const histPreOK = !store.canUndo() && !store.canRedo();
        if (!h0) { step('[DOM] 单选后朝向把手出现', false, '无 handlePx（无法继续把手拖动）', 'DOM'); return; }
        const orig = t.posOf(A);
        const at = ang => { const r = ang * Math.PI / 180; return ctx.toClient(orig.x + 0.9 * Math.sin(r), orig.y - 0.9 * Math.cos(r)); };
        // ---- 执行：按住把手 → 经 135° 拖到 90° → 松手 ----
        const h135 = at(135), h90 = at(90);
        const pid = await inp.down(h0.x, h0.y, { hw: 'mouse' });
        await sleep(30);
        await inp.move(h135.x, h135.y, { hw: 'mouse', pid });
        await sleep(30);
        await inp.move(h90.x, h90.y, { hw: 'mouse', pid });
        await inp.up(h90.x, h90.y, { hw: 'mouse', pid });
        await raf2();
        const p = t.posOf(A);
        const histMid = t.hist();
        store.undo(); await raf2();
        const fUndo = t.posOf(A).facing, histUndo = t.hist();
        store.redo(); await raf2();
        const fRedo = t.posOf(A).facing, histRedo = t.hist();
        const hNew = sv.handlePx;
        const dotNew = hNew ? mean3x3(cv, hNew.x, hNew.y) : null;
        const oldPt = at(180);
        const dotOld = mean3x3(cv, oldPt.x, oldPt.y);
        const r = await cmpShot('d14-facing');
        store.setUI({ showFacingHandle: false });
        await raf2();
        // ---- 断言 ----
        step('[DOM] 单选后朝向把手出现', !!h0, h0 ? `把手@(${Math.round(h0.x)},${Math.round(h0.y)})` : '无 handlePx', 'DOM');
        step('[STATE] 不拖不动零历史', histPreOK, histPre);
        step('[STATE] facing 更新为 90', p.facing === 90, `facing=${p.facing}（180→90）`);
        step('[STATE] x/y 未动', p.x === orig.x && p.y === orig.y, `pos=(${p.x},${p.y})`);
        step('[STATE] 恰一条「调整朝向」历史', histMid.includes('canUndo=true') && histMid.includes('label="调整朝向"') && histMid.includes('canRedo=false'), histMid);
        step('[STATE] undo 还原朝向', fUndo === 180 && histUndo.includes('canUndo=false'), `facing=${fUndo} ${histUndo}`);
        step('[STATE] redo 重放朝向', fRedo === 90 && histRedo.includes('canRedo=false'), `facing=${fRedo} ${histRedo}`);
        step('[PIXEL] 朝向线/把手转向（新把位蓝点）', !!dotNew && dist(dotNew, ACC) < 40,
          `新把位 ${dotNew ? rgb(dotNew) : '无把手'} 距 #38bdf8 ${dotNew ? dist(dotNew, ACC).toFixed(1) : '—'} < 40`, 'PIXEL');
        step('[PIXEL] 旧把位蓝点消失', dist(dotOld, ACC) >= 80, `旧把位(180°) ${rgb(dotOld)} 距 #38bdf8 ${dist(dotOld, ACC).toFixed(1)} ≥ 80`, 'PIXEL');
        cmpStep(step, r);
      },
    },

    // ---------- D-15 撤销/重做 [M] ----------
    {
      id: 'D-15', hw: 'M', name: '撤销/重做（移动+合并逐帧还原/重放）',
      async run(t, { step }) {
        // 快捷键绑定事实（js/main.js L800-805）：(ctrlKey||metaKey)+Z 撤销，+Shift / Ctrl+Y 重做 —— Ctrl 与 Meta 均可，仪器用 Ctrl
        // 历史模型（store.commit 每次手势提交一条）：F1=拖 A（移动舞者）→ F2=拖 B 到 C 重叠（另一条移动舞者）→ F3=点「胶囊」（合并单元）
        const A = t.ids[0], B = t.ids[1], C = t.ids[2], colB = t.col(B), colC = t.col(C);
        const origA = t.posOf(A), origB = t.posOf(B);
        const targetA = { x: origA.x + 1.0, y: origA.y - 2.0 };
        const CP = t.posOf(C); // collapsePair 中点 = C 原位（B 被拖到 C 上）
        const CPc = ctx.toClient(CP.x, CP.y); // CP 的 client 像素（像素采样用）
        // ---- 执行：三次提交 ----
        await dragPts(t.ptOf(A), ctx.toClient(targetA.x, targetA.y));
        await raf2();
        const labels1 = [store.undoLabel()];
        await dragPts(t.ptOf(B), t.ptOf(C));
        await raf2();
        const m = menu();
        if (m) {
          const btn = m.el.querySelector('.um-btn');
          const br = btn.getBoundingClientRect();
          await inp.click(br.left + br.width / 2, br.top + br.height / 2, { hw: 'mouse' });
          await raf2();
        }
        const merge = (fmt().merges || [])[0];
        const mergeOK = !!m && m.title === '合并为单元' && !!merge && merge.style === 'capsule' && store.undoLabel() === '合并单元' && !store.canRedo();
        const labelsAll = [labels1[0], '移动舞者', store.undoLabel()];
        // 帧期望（undo ×3 → F2/F1/F0；redo ×3 → F1r/F2r/F3r）
        const F3 = { A: targetA, B: CP, C: CP, merges: 1, label: '合并单元', canUndo: true, canRedo: false, bPt: CPc, bCol: colB };
        const F2 = { A: targetA, B: CP, C: CP, merges: 0, label: '移动舞者', canUndo: true, canRedo: true, bPt: CPc, bCol: colC };
        const F1 = { A: targetA, B: origB, C: CP, merges: 0, label: '移动舞者', canUndo: true, canRedo: true, bPt: ctx.toClient(origB.x, origB.y), bCol: colB };
        const F0 = { A: origA, B: origB, C: CP, merges: 0, label: '', canUndo: false, canRedo: true, bPt: ctx.toClient(origB.x, origB.y), bCol: colB };
        const frames = [];
        const checkFrame = async tag => { // 取证（无断言）：STATE + PIXEL 采样 + SCREEN
          const expect = { F2, F1, F0, F1r: F1, F2r: F2, F3r: F3 }[tag];
          const pA = t.posOf(A), pB = t.posOf(B), pC = t.posOf(C);
          const nMerge = (fmt().merges || []).length;
          const posOK = Math.abs(pA.x - expect.A.x) < 1e-6 && Math.abs(pA.y - expect.A.y) < 1e-6 &&
            Math.abs(pB.x - expect.B.x) < 1e-6 && Math.abs(pB.y - expect.B.y) < 1e-6 &&
            Math.abs(pC.x - expect.C.x) < 1e-6 && Math.abs(pC.y - expect.C.y) < 1e-6;
          const histOK = store.undoLabel() === expect.label && store.canUndo() === expect.canUndo && store.canRedo() === expect.canRedo;
          const ptA = ctx.toClient(expect.A.x, expect.A.y);
          const inA = innerMinDist(cv, ptA.x, ptA.y, t.rpx, t.col(A));
          const inB = innerMinDist(cv, expect.bPt.x, expect.bPt.y, t.rpx, expect.bCol);
          const r = await cmpShot(tag.toLowerCase() + '-frame');
          frames.push({ tag, expect, posOK, histOK, hist: t.hist(), label: store.undoLabel(), nMerge, actual: `A=(${pA.x.toFixed(3)},${pA.y.toFixed(3)}) B=(${pB.x.toFixed(3)},${pB.y.toFixed(3)}) C=(${pC.x.toFixed(3)},${pC.y.toFixed(3)})`, inA: inA.d, inB: inB.d, r });
        };
        inp.key('z', { ctrl: true }); await raf2(); await checkFrame('F2');
        inp.key('z', { ctrl: true }); await raf2(); await checkFrame('F1');
        inp.key('z', { ctrl: true }); await raf2(); await checkFrame('F0');
        inp.key('z', { ctrl: true, shift: true }); await raf2(); await checkFrame('F1r');
        inp.key('z', { ctrl: true, shift: true }); await raf2(); await checkFrame('F2r');
        inp.key('z', { ctrl: true, shift: true }); await raf2(); await checkFrame('F3r');
        // ---- 断言 ----
        step('[F1] 移动 A 已提交（历史=移动舞者）', labels1[0] === '移动舞者', `label="${labels1[0]}"`);
        step('[F3] 重叠松手弹合并确认 → 点「胶囊」提交（历史=合并单元）', mergeOK,
          m ? `title="${m.title}"; merges=[${(fmt().merges || []).map(x => x.style)}]` : '无 .unit-menu');
        step('[F3] 历史恰 3 条且标签序列正确', labelsAll.join(',') === '移动舞者,移动舞者,合并单元' && !store.canRedo(),
          `labels=[${labelsAll.join(',')}]`);
        for (const fr of frames) {
          const e = fr.expect;
          step(`[STATE] ${fr.tag} 状态逐帧还原/重放`, fr.posOK && fr.nMerge === e.merges && fr.histOK,
            `实际 ${fr.actual} merges=${fr.nMerge} label="${fr.label}" ${fr.hist} ｜ 期望 A=(${e.A.x},${e.A.y}) B=(${e.B.x},${e.B.y}) C=(${e.C.x},${e.C.y}) merges=${e.merges} label="${e.label}"`);
          step(`[PIXEL] ${fr.tag} 位图逐帧一致`, fr.inA < TH_COLOR && fr.inB < TH_COLOR,
            `A@期望位 最小色距 ${fr.inA.toFixed(1)}；B 位最小色距 ${fr.inB.toFixed(1)} 均 < ${TH_COLOR}`, 'PIXEL');
          cmpStep(step, fr.r);
        }
      },
    },

    // ---------- D-16 编辑锁 [M/T] ----------
    {
      id: 'D-16', hw: 'MT', name: '编辑锁（关=全手势负断言+面板可用，开=恢复）',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1], colA = t.col(A);
        const origA = t.posOf(A);
        const preC = mean3x3(cv, t.ptOf(A).x, t.ptOf(A).y);
        // ---- 执行：锁下尝试全部手势（拖拽/点击/空白拖动），面板操作，再解锁复测 ----
        await clickBtn('btn-edit-mode');
        const locked = state().editMode === false;
        const data0 = t.data(), sel0 = t.sel();
        await dragPts(t.ptOf(A), ctx.toClient(origA.x + 1.0, origA.y - 2.0));
        await raf2();
        const pA = t.posOf(A);
        const dragOK = Math.abs(pA.x - origA.x) < 1e-9 && Math.abs(pA.y - origA.y) < 1e-9;
        const histLocked = t.hist();
        await inp.click(t.ptOf(B).x, t.ptOf(B).y, { hw: HW });
        await raf2();
        const selAfterClick = t.sel().slice();
        await dragPts(t.blank, { x: t.blank.x + 40, y: t.blank.y + 30 });
        await raf2();
        const blankOK = t.sel().length === 0 && t.data() === data0;
        await clickBtn('btn-multi');
        const multiOn = state().multiSelect === true;
        await clickBtn('btn-multi');
        const multiOff = state().multiSelect === false;
        const postC = mean3x3(cv, t.ptOf(A).x, t.ptOf(A).y);
        const rL = await cmpShot('d16-locked');
        await clickBtn('btn-edit-mode');
        const unlocked = state().editMode === true;
        await inp.click(t.ptOf(B).x, t.ptOf(B).y, { hw: HW });
        await raf2();
        const selRe = t.sel().slice();
        const rU = await cmpShot('d16-unlocked');
        // ---- 断言 ----
        step('[STATE] 锁生效（editMode=false）', locked, `editMode=${state().editMode}`);
        step('[STATE] 锁下拖拽零位移', dragOK, `pos=(${pA.x},${pA.y})`);
        step('[STATE] 锁下零历史', histLocked.includes('canUndo=false') && histLocked.includes('canRedo=false'), histLocked);
        step('[STATE] 锁下点击不改变选择', JSON.stringify(selAfterClick) === JSON.stringify(sel0), `selection=[${selAfterClick.map(i => i.slice(0, 8))}]`);
        step('[STATE] 锁下空白拖动零选择/零数据变更', blankOK, `selection=${t.sel().length} data 不变=${t.data() === data0}`);
        step('[DOM] 面板仍可用（多选开关切换成功）', multiOn, `multiSelect=${multiOn}`, 'DOM');
        step('[DOM] 面板还原（多选关闭）', multiOff, '', 'DOM');
        step('[PIXEL] 锁下位图不变', dist(postC, preC) < 8 && innerMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, colA).d < TH_COLOR,
          `A 圆心色变 ${dist(postC, preC).toFixed(1)} < 8`, 'PIXEL');
        cmpStep(step, rL);
        step('[STATE] 解锁（editMode=true）', unlocked, '');
        step('[STATE] 解锁后恢复：点击选中', JSON.stringify(selRe) === JSON.stringify([B]), `selection=[${selRe.map(i => i.slice(0, 8))}]`);
        cmpStep(step, rU);
      },
    },
  ];

  // ---- 按硬件过滤 + 包装（输入流水/数据快照/每线独立场景） ----
  const selected = defs.filter(d => d.hw.includes(phase) && (!only || d.id === only));
  const wrapped = selected.map(d => ({
    id: d.id, name: d.name,
    async run(kitArgs) {
      const t = await setup(`L1 ${phase}·${d.id}`);
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
    shortcuts: 'undo/redo 绑定见 js/main.js L800-805：(ctrlKey||metaKey)+Z（Shift=重做，Ctrl/Cmd+Y 亦重做）',
  };
  return { phase, cases: results, shots, meta };
}
