// L2 测试仪器：组合功能动线 C-01~C-10（权威计划 tests/e2e-matrix.md §3，四层验证 §0）。
// 本文件属测试仪器，被测应用代码（js/*、index.html、css/*）零改动；场景搭建只走 store/M 公共 API。
// v3（round14）：pairs 退役——C-08 从「名册舞对联动」重写为「名册与编组管理」（chips/存组/删人联动）；
//   样式断言 capsule/single 两样式（菱形/双圆退役）；浮窗标题「舞对单元」→「合并单元」；
//   collapsePair→collapseUnit；orderedDancers 无 unit 参数；C-10 不变式加入 groups 引用有效。
// 结构：
//   runL2({part:'desktop'})            → C-01..C-08 + C-10 前半（reload 前取证；快照经驱动回传）
//   runL2({part:'desktop', c10pre})    → C-10 后半（同 context 同页 reload 后深等比对，IndexedDB 同源持久化）
//   runL2({part:'mobile'})             → C-09（375×667 + hasTouch 独立 context，由 lab/run-l2.mjs 提供）
// 复用：C-04 / C-09b 经 runL1({only, setupView}) 重放 L1 用例子集（setupView 钩子为本轮在 page-l1.js
//       新增的仪器扩展，向后兼容：不传即维持原行为）。
// 运行前提：window.__fs、window.__input（page-injector.js v2）、window.__l2Shot（lab 驱动注入；
//       入口处别名到 __l1Shot 供 page-kit / page-l1 复用）。
// 入口：await import('/tests/page-l2.js') → await runL2({ part, c10pre? })
//       返回 { part, cases:[{id,name,ok,evidence,steps,log,snapAfter}], shots, meta, c10pre? }。
import {
  raf2, sleep, TH_COLOR, TH_HL, TH_BG, SCREEN_RATIO,
  makeCtx, dprOf, mean3x3, dist, rgb, hex, ringMinDist, innerMinDist, minDistOver, gridRegion,
  edgeMinDist, px1, decodeShot, screenCompare, runCases,
} from './page-kit.js';
import { runL1 } from './page-l1.js';

const ACC = hex('#38bdf8');   // 主题蓝（浮窗边框/框选矩形）
const HL = hex('#0ea5e9');    // 选中高亮
const RED = hex('#f43f5e');   // 时间线播放头
const eq = (a, b, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
const sortedEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const stableStr = o => JSON.stringify(o, (k, v) => (k === 'updatedAt' ? undefined : (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((acc, k2) => { acc[k2] = v[k2]; return acc; }, {}) : v)));

export async function runL2(opts = {}) {
  window.__l1Shot = window.__l1Shot || window.__l2Shot; // 别名：page-kit/page-l1 的截图钩子
  if (!window.__input) throw new Error('注入器未注册 window.__input');
  if (!window.__l1Shot && !window.__l0Shot) throw new Error('截图钩子未注入（window.__l2Shot）');
  if (opts.part === 'mobile') return runMobile(opts);
  return runDesktop(opts);
}

// =====================================================================
// 公共仪器环境（desktop / mobile 共用；hw 决定手势注入的 pointerType）
// =====================================================================
function makeEnv(shots, hw) {
  const ctx = makeCtx();
  const { store, M, sv, state, fmt } = ctx;
  const cv = sv.canvas;
  const inp = window.__input;

  // ---- 注入调用流水（失败复推证据） ----
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
    const ids = M.orderedDancers(state().project); // 真实 dancer id（名册顺序，v3 无 unit 参数）
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
    return { el, rect: r, title: el.querySelector('.um-title')?.textContent || '', text: el.textContent.slice(0, 60) };
  };
  async function clickMenuBtn(m, text) {
    const btn = m && [...m.el.querySelectorAll('.um-btn')].find(b => b.textContent.includes(text));
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    await inp.click(r.left + r.width / 2, r.top + r.height / 2, { hw });
    await raf2();
    return true;
  }
  async function closeMenu() {
    const m = menu();
    if (!m) return;
    const c = m.el.querySelector('.um-cancel').getBoundingClientRect();
    await inp.click(c.left + c.width / 2, c.top + c.height / 2, { hw });
    await raf2();
  }
  async function clickBtn(id) {
    const r = document.getElementById(id).getBoundingClientRect();
    await inp.click(r.left + r.width / 2, r.top + r.height / 2, { hw });
    await raf2();
  }
  async function dragPts(from, to, { n = 4, stepMs = 30 } = {}) {
    const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }));
    await inp.drag(pts, { hw, stepMs });
    return pts;
  }
  async function dwellDrag(from, to, { dwellMs = 1700 } = {}) { // 拖到重叠点驻留（D-07 时序：≥dwellMs 弹窗，不松手）
    const pts = [from];
    for (let i = 1; i <= 3; i++) pts.push({ x: from.x + (to.x - from.x) * i / 3, y: from.y + (to.y - from.y) * i / 3 });
    const pid = await inp.down(pts[0].x, pts[0].y, { hw });
    for (let i = 1; i < pts.length; i++) { await sleep(30); await inp.move(pts[i].x, pts[i].y, { hw, pid }); }
    await sleep(300);
    await inp.move(pts[3].x, pts[3].y, { hw, pid });
    await sleep(dwellMs);
    await inp.move(pts[3].x, pts[3].y, { hw, pid }); // 驻留判定在 move 中评估
    await raf2();
    await inp.up(pts[3].x, pts[3].y, { hw, pid });   // MENU 态吞掉抬起
    await raf2();
    return pts;
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
  async function setupMergeT(t, style = 'capsule') { // 数据级合并装配（无 label 不动历史）
    const idA = t.ids[0], idB = t.ids[1];
    store.mutate(p => {
      const f = p.formations[state().formationIndex];
      M.addMerge(f, idA, idB, style);
      M.collapseUnit(f, idA, idB);
    });
    await raf2();
    return { idA, idB, mid: t.mergePt(idA, idB) };
  }
  // v3 单元呈示探针（两样式）：
  //   capsule=圆角矩形双半色采样（unitHalves）；single=中点单圆填充 + 1.45r 虚线环强调色 + ×2 角标
  //   （环/角标为 1~2px 线条/小徽标，3×3 均色会被背景稀释 → 用单像素 px1 扫描，独立阈值 TH_RING）
  const unitProbe = (t, style, mid, colA, colB) => {
    if (style === 'single') {
      const ACC2 = hex(state().theme === 'dark' ? '#38bdf8' : '#0284c7');
      const TH_RING = 90;
      const pxLive = (x, y) => px1(cv, x, y) || { r: 255, g: 255, b: 255 };
      const band = (cx, cy, R) => {
        const pts = [];
        for (let a = 0; a < 360; a += 5) for (const rr of [R - 1.5, R - 0.5, R + 0.5, R + 1.5])
          pts.push([cx + Math.cos(a * Math.PI / 180) * rr, cy + Math.sin(a * Math.PI / 180) * rr]);
        return pts;
      };
      const fill = minDistOver((x, y) => mean3x3(cv, x, y), colA, gridRegion(mid.x - t.rpx * 0.55, mid.y - t.rpx * 0.55, mid.x + t.rpx * 0.55, mid.y + t.rpx * 0.55, 2));
      const ring = minDistOver(pxLive, ACC2, band(mid.x, mid.y, 1.45 * t.rpx));
      const bc = { x: mid.x + 1.15 * t.rpx, y: mid.y - 1.15 * t.rpx }, br = Math.max(5, t.rpx * 0.5);
      const badge = minDistOver(pxLive, ACC2, gridRegion(bc.x - br * 0.42, bc.y - br * 0.42, bc.x + br * 0.42, bc.y + br * 0.42, 1));
      return {
        d: Math.max(fill.d, ring.d, badge.d),
        ok: fill.d < TH_COLOR && ring.d < TH_RING && badge.d < TH_RING,
        why: `单圆填充 ${fill.d.toFixed(1)}(<${TH_COLOR})、虚线环 ${ring.d.toFixed(1)}、×2 角标 ${badge.d.toFixed(1)}（环/角标 <90，ACC=${state().theme === 'dark' ? '#38bdf8' : '#0284c7'}）`,
      };
    }
    const h = unitHalves(style, mid, t.rpx, colA, colB); // capsule
    return { d: Math.max(h.sA.d, h.sB.d), ok: h.sA.d < TH_COLOR && h.sB.d < TH_COLOR, why: `A 半 ${h.sA.d.toFixed(1)} / B 半 ${h.sB.d.toFixed(1)} < ${TH_COLOR}` };
  };
  // capsule 徽标双半色采样（§0.2：中点两侧各取纯填充色区域；v3 仅保留 capsule——diamond/twin 退役）
  function unitHalves(style, mid, rpx, colA, colB) {
    const w = 3.4 * rpx, h = 1.5 * rpx;
    const regA = gridRegion(mid.x - w * 0.46, mid.y - h * 0.3, mid.x - w * 0.08, mid.y + h * 0.3, 2);
    const regB = gridRegion(mid.x + w * 0.08, mid.y - h * 0.3, mid.x + w * 0.46, mid.y + h * 0.3, 2);
    return {
      sA: minDistOver((x, y) => mean3x3(cv, x, y), colA, regA),
      sB: minDistOver((x, y) => mean3x3(cv, x, y), colB, regB),
    };
  }
  // 缩略图取证：抓全量像素 + 逐像素差（120×68 徽标仅数像素，哈希法会漏检 → 用全量绝对差）
  const thumbData = () => [...document.querySelectorAll('#formation-list .es-chip canvas')].map(c => {
    try { return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); } catch { return null; }
  });
  const thumbDiff = (a, b) => {
    if (!a || !b || a.length !== b.length) return -1;
    return a.map((da, i) => {
      const db = b[i];
      if (!da || !db || da.length !== db.length) return -1;
      let s = 0;
      for (let k = 0; k < da.length; k += 4) s += Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]);
      return s;
    });
  };

  return { ctx, store, M, sv, state, fmt, cv, inp, inLog, menu, clickMenuBtn, closeMenu, clickBtn, dragPts, dwellDrag, cmpShot, cmpStep, menuBorder, setup, setupMergeT, unitProbe, unitHalves, thumbData, thumbDiff, inflate };
}

// =====================================================================
// desktop 部分：C-01..C-08 + C-10（C-10 跨 reload，前半取证 / 后半比对）
// =====================================================================
async function runDesktop(opts) {
  const shots = {};
  const env = makeEnv(shots, 'mouse');
  const { ctx, store, M, sv, state, fmt, cv, inp, inLog, menu, clickMenuBtn, closeMenu, clickBtn, dragPts, dwellDrag, cmpShot, cmpStep, menuBorder, setup, setupMergeT, unitProbe, unitHalves, thumbData, thumbDiff, inflate } = env;
  let c10preCaptured = null;

  const defs = [

    // ---------- C-01 编排全链 ----------
    {
      id: 'C-01', name: '编排全链：选→拖→驻留合并→换样式→撤销×4→重做×4（每步 STATE+PIXEL+SCREEN，终态=初始重放）',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        const origA = t.posOf(A), origB = t.posOf(B);
        const target = { x: origA.x + 1.0, y: origA.y - 2.0 };
        const colA = t.col(A), colB = t.col(B);
        const snap0 = t.data();

        // ---- 步1 选 ----
        await inp.click(t.ptOf(A).x, t.ptOf(A).y, { hw: 'mouse' });
        await raf2();
        let r = await cmpShot('c01-1-selected');
        const hl = ringMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, HL);
        step('[STATE] 选：selection==[A]', JSON.stringify(t.sel()) === JSON.stringify([A]), `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[PIXEL] 选：A 圆环高亮', hl.d < TH_HL, `最小色距 ${hl.d.toFixed(1)} < ${TH_HL}`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步2 拖 ----
        await dragPts(t.ptOf(A), ctx.toClient(target.x, target.y));
        await raf2();
        r = await cmpShot('c01-2-dragged');
        const pA1 = t.posOf(A);
        const oldPt = ctx.toClient(origA.x, origA.y);
        const oldC = mean3x3(cv, oldPt.x, oldPt.y);
        const inNew = innerMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, colA);
        step('[STATE] 拖：A 精确位移 + 恰一条「移动舞者」', eq(pA1, target) && store.undoLabel() === '移动舞者' && !store.canRedo(), `pos=(${pA1.x.toFixed(6)},${pA1.y.toFixed(6)}) ${t.hist()}`);
        step('[PIXEL] 拖：旧点回背景、新点呈 A 色', dist(oldC, t.base) < TH_BG && inNew.d < TH_COLOR, `旧点距基线 ${dist(oldC, t.base).toFixed(1)}、新点色距 ${inNew.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步3 驻留合并（A→B 上驻留 ≥1.5s → 浮窗 → 「胶囊」）----
        await dwellDrag(t.ptOf(A), t.ptOf(B));
        const m3 = menu();
        let border3 = null;
        if (m3) {
          const r3m = await cmpShot('c01-3-menu', inflate(m3.rect));
          border3 = await menuBorder(r3m.b64, m3);
        }
        await clickMenuBtn(m3, '胶囊');
        r = await cmpShot('c01-3-merged');
        const mg = (fmt().merges || [])[0];
        const midC = t.mergePt(A, B);
        const halves = unitHalves('capsule', midC, t.rpx, colA, colB);
        step('[DOM] 驻留：浮窗出现（合并为单元）', !!m3 && m3.title === '合并为单元', m3 ? m3.title : '无 .unit-menu', 'DOM');
        if (m3) step('[SCREEN] 浮窗边框色可检出', border3.d < 140, `色距 ${border3.d.toFixed(1)}@${JSON.stringify(border3.at)}`, 'SCREEN');
        step('[STATE] 合并：merges=[A|B capsule] 两人收拢 + 历史「合并单元」',
          !!mg && mg.style === 'capsule' && sortedEq([mg.a, mg.b], [A, B]) && eq(t.posOf(A), t.posOf(B)) && store.undoLabel() === '合并单元',
          `merges=${JSON.stringify((fmt().merges || []).map(x => x.style))} ${t.hist()}`);
        step('[PIXEL] 合并：徽标双半色呈示', halves.sA.d < TH_COLOR && halves.sB.d < TH_COLOR, `A 半 ${halves.sA.d.toFixed(1)} / B 半 ${halves.sB.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步4 换样式（双击徽标 → 单元浮窗 → 「单编号」；v3 两样式 capsule/single）----
        await inp.dblclick(midC.x, midC.y, { hw: 'mouse' });
        await raf2();
        const m4 = menu();
        await clickMenuBtn(m4, '单编号');
        r = await cmpShot('c01-4-styled');
        const mg4 = (fmt().merges || [])[0];
        const sp = unitProbe(t, 'single', midC, colA, colB);
        step('[DOM] 换样式：单元浮窗出现（v3 标题=合并单元）', !!m4 && m4.title === '合并单元', m4 ? m4.title : '无 .unit-menu', 'DOM');
        step('[STATE] 换样式：style=single + 历史「切换单元样式」', !!mg4 && mg4.style === 'single' && store.undoLabel() === '切换单元样式', `style=${mg4 ? mg4.style : '无'} ${t.hist()}`);
        step('[PIXEL] 换样式：单编号呈示（单圆+虚线环+角标）', sp.ok, sp.why, 'PIXEL');
        cmpStep(step, r);

        // ---- 步5 撤销×4（逐帧 STATE+PIXEL+SCREEN）----
        // 历史恰 4 条提交：#1 移动舞者(拖) → #2 移动舞者(驻留位移，取消确认也保留) → #3 合并单元 → #4 切换单元样式
        const snapFinal = t.data();
        const midS = { x: origB.x, y: origB.y }; // 收拢点 = B 原位
        const uFrames = [
          { tag: 'u1', label: '合并单元', merges: 1, style: 'capsule', aAt: midS, bAt: midS, px: 'badge:capsule' },
          { tag: 'u2', label: '移动舞者', merges: 0, aAt: midS, bAt: midS, px: 'bTop' }, // A、B 同点未合并：B 后绘在上层，A 被遮挡
          { tag: 'u3', label: '移动舞者', merges: 0, aAt: target, bAt: origB, px: 'aSolo' },
          { tag: 'u4', label: '', merges: 0, aAt: origA, bAt: origB, px: 'aSolo' },
        ];
        for (const uf of uFrames) {
          inp.key('z', { ctrl: true });
          await raf2();
          const rr = await cmpShot(`c01-5-${uf.tag}`);
          const mgu = (fmt().merges || [])[0];
          const posOK = eq(t.posOf(A), uf.aAt) && eq(t.posOf(B), uf.bAt) && (fmt().merges || []).length === uf.merges && (uf.merges === 0 || (mgu && mgu.style === uf.style));
          const histOK = uf.label === '' ? !store.canUndo() : store.undoLabel() === uf.label;
          const aCu = ctx.toClient(uf.aAt.x, uf.aAt.y);
          let pxProbe;
          if (uf.px.startsWith('badge:')) {
            const b = unitProbe(t, uf.px.slice(6), aCu, colA, colB);
            pxProbe = { d: b.d, why: `单元呈示 ${b.why}` };
          } else if (uf.px === 'bTop') {
            pxProbe = { d: innerMinDist(cv, aCu.x, aCu.y, t.rpx, colB).d, why: `同点顶层 B 色距 ${innerMinDist(cv, aCu.x, aCu.y, t.rpx, colB).d.toFixed(1)}（A 被遮挡）` };
          } else {
            pxProbe = { d: innerMinDist(cv, aCu.x, aCu.y, t.rpx, colA).d, why: `A 位色距 ${innerMinDist(cv, aCu.x, aCu.y, t.rpx, colA).d.toFixed(1)}` };
          }
          step(`[STATE] 撤销 ${uf.tag}：状态逐帧还原`, posOK && histOK,
            `A=(${t.posOf(A).x.toFixed(3)},${t.posOf(A).y.toFixed(3)}) merges=${(fmt().merges || []).length} ${t.hist()} ｜ 期望 label="${uf.label}" merges=${uf.merges} style=${uf.style || '—'}`);
          step(`[PIXEL] 撤销 ${uf.tag}：位图一致`, pxProbe.d < TH_COLOR, pxProbe.why, 'PIXEL');
          cmpStep(step, rr);
        }
        step('[STATE] 撤销×4 终点=初始快照（逐字节）', t.data() === snap0 && !store.canUndo(), `data===snap0: ${t.data() === snap0} ${t.hist()}`);

        // ---- 步6 重做×4（自基线正向重放：#1 拖拽 → #2 驻留位移 → #3 合并 → #4 换样式）----
        const rFrames = [
          { tag: 'r1', label: '移动舞者', merges: 0, style: null, aAt: target, bAt: origB, px: 'aSolo' },
          { tag: 'r2', label: '移动舞者', merges: 0, style: null, aAt: midS, bAt: midS, px: 'bTop' },
          { tag: 'r3', label: '合并单元', merges: 1, style: 'capsule', aAt: midS, bAt: midS, px: 'badge:capsule' },
          { tag: 'r4', label: '切换单元样式', merges: 1, style: 'single', aAt: midS, bAt: midS, px: 'badge:single' },
        ];
        for (const rf of rFrames) {
          inp.key('z', { ctrl: true, shift: true });
          await raf2();
          const rr = await cmpShot(`c01-6-${rf.tag}`);
          const mgr = (fmt().merges || [])[0];
          const posOK = eq(t.posOf(A), rf.aAt) && eq(t.posOf(B), rf.bAt) && (fmt().merges || []).length === rf.merges && (rf.merges === 0 || (mgr && mgr.style === rf.style));
          const aCr = ctx.toClient(rf.aAt.x, rf.aAt.y);
          let pxProbe;
          if (rf.px.startsWith('badge:')) {
            const b = unitProbe(t, rf.px.slice(6), aCr, colA, colB);
            pxProbe = { d: b.d, why: `单元呈示 ${b.why}` };
          } else if (rf.px === 'bTop') {
            pxProbe = { d: innerMinDist(cv, aCr.x, aCr.y, t.rpx, colB).d, why: `同点顶层 B 色距 ${innerMinDist(cv, aCr.x, aCr.y, t.rpx, colB).d.toFixed(1)}` };
          } else {
            pxProbe = { d: innerMinDist(cv, aCr.x, aCr.y, t.rpx, colA).d, why: `A 位色距 ${innerMinDist(cv, aCr.x, aCr.y, t.rpx, colA).d.toFixed(1)}` };
          }
          step(`[STATE] 重做 ${rf.tag}：状态重放`, posOK && store.undoLabel() === rf.label,
            `A=(${t.posOf(A).x.toFixed(3)},${t.posOf(A).y.toFixed(3)}) merges=${JSON.stringify((fmt().merges || []).map(x => x.style))} ${t.hist()}`);
          step(`[PIXEL] 重做 ${rf.tag}：位图一致`, pxProbe.d < TH_COLOR, pxProbe.why, 'PIXEL');
          cmpStep(step, rr);
        }
        step('[STATE] 终态=撤销前快照重放（逐字节）', t.data() === snapFinal && !store.canRedo(), `data===snapFinal: ${t.data() === snapFinal} ${t.hist()}`);
      },
    },

    // ---------- C-02 单元生命周期 ----------
    {
      id: 'C-02', name: '单元生命周期：建单元→拖徽标（两人同步位移）→拆开→各自拖动（PIXEL 徽标出现/消失）',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        const colA = t.col(A), colB = t.col(B);

        // ---- 步1 建单元：拖 A 至 B 驻留 → 浮窗 → 「胶囊」 ----
        await dwellDrag(t.ptOf(A), t.ptOf(B));
        const m1 = menu();
        await clickMenuBtn(m1, '胶囊');
        const r = await cmpShot('c02-1-unit');
        const mid0 = t.mergePt(A, B);
        const h1 = unitHalves('capsule', mid0, t.rpx, colA, colB);
        step('[STATE] 建单元：merges=[A|B capsule] 两人收拢', (fmt().merges || []).length === 1 && eq(t.posOf(A), t.posOf(B)), `merges=${(fmt().merges || []).length} ${t.hist()}`);
        step('[PIXEL] 建单元：徽标出现（双半色）', h1.sA.d < TH_COLOR && h1.sB.d < TH_COLOR, `A 半 ${h1.sA.d.toFixed(1)} / B 半 ${h1.sB.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步2 拖徽标：按住徽标中点拖 Δ=(+1.2,+2.4)，期望两人同步位移（计划 §3 C-02）----
        const d = { x: 1.2, y: 2.4 };
        const stA = t.posOf(A), stB = t.posOf(B);
        await dragPts(mid0, ctx.toClient(stA.x + d.x, stA.y + d.y));
        await raf2();
        const r2 = await cmpShot('c02-2-badge-drag');
        const pa2 = t.posOf(A), pb2 = t.posOf(B);
        const mid1 = t.mergePt(A, B);
        const syncOK = eq(pa2, { x: stA.x + d.x, y: stA.y + d.y }) && eq(pb2, { x: stB.x + d.x, y: stB.y + d.y });
        const h2 = unitHalves('capsule', mid1, t.rpx, colA, colB);
        step('[STATE] 拖徽标：两人同步位移（各移动同一 delta）', syncOK,
          `A Δ=(${(pa2.x - stA.x).toFixed(3)},${(pa2.y - stA.y).toFixed(3)}) B Δ=(${(pb2.x - stB.x).toFixed(3)},${(pb2.y - stB.y).toFixed(3)}) ｜ 期望同步 Δ=(${d.x},${d.y})（计划 §3 C-02「徽标期拖动两人同步位移」）`);
        step('[PIXEL] 拖徽标：徽标仍呈示于新中点', h2.sA.d < TH_COLOR && h2.sB.d < TH_COLOR, `A 半 ${h2.sA.d.toFixed(1)} / B 半 ${h2.sB.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r2);

        // ---- 步3 拆开：双击徽标 → 单元浮窗 → 「✂ 拆开」 ----
        await inp.dblclick(mid1.x, mid1.y, { hw: 'mouse' });
        await raf2();
        const m3 = menu();
        await clickMenuBtn(m3, '拆开');
        const r3 = await cmpShot('c02-3-split');
        const edgeL = { x: mid1.x - 1.7 * t.rpx - 4, y: mid1.y };
        const edgeR = { x: mid1.x + 1.7 * t.rpx + 4, y: mid1.y };
        const inB = innerMinDist(cv, mid1.x, mid1.y, t.rpx, colB);
        step('[DOM] 拆开：单元浮窗出现（v3 标题=合并单元）', !!m3 && m3.title === '合并单元', m3 ? m3.title : '无 .unit-menu', 'DOM');
        step('[STATE] 拆开：merges 空、位置不变（仍重叠）', (fmt().merges || []).length === 0 && eq(t.posOf(A), pa2) && eq(t.posOf(B), pb2), `merges=${(fmt().merges || []).length} ${t.hist()}`);
        step('[PIXEL] 拆开：徽标消失（旧徽标边缘回背景）、原地呈独立圆',
          dist(mean3x3(cv, edgeL.x, edgeL.y), t.base) < 40 && dist(mean3x3(cv, edgeR.x, edgeR.y), t.base) < 40 && inB.d < TH_COLOR,
          `左缘距基线 ${dist(mean3x3(cv, edgeL.x, edgeL.y), t.base).toFixed(1)}、右缘 ${dist(mean3x3(cv, edgeR.x, edgeR.y), t.base).toFixed(1)}、中点 B 色 ${inB.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r3);

        // ---- 步4 各自拖动（重叠点顶层为后绘者 B → 先拖 B，再拖 A）----
        const pMid = ctx.toClient(pa2.x, pa2.y);
        await dragPts(pMid, ctx.toClient(pa2.x - 1.5, pa2.y));
        await raf2();
        const afterB = t.posOf(B);
        await dragPts(ctx.toClient(pa2.x, pa2.y), ctx.toClient(pa2.x + 1.5, pa2.y));
        await raf2();
        const afterA = t.posOf(A);
        const r4 = await cmpShot('c02-4-independent');
        const inA = innerMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, colA);
        const inB2 = innerMinDist(cv, t.ptOf(B).x, t.ptOf(B).y, t.rpx, colB);
        step('[STATE] 各自拖动：A、B 独立位移（两条「移动舞者」）',
          eq(afterB, { x: pa2.x - 1.5, y: pa2.y }) && eq(afterA, { x: pa2.x + 1.5, y: pa2.y }) && store.undoLabel() === '移动舞者' && store.canUndo(),
          `A=(${afterA.x.toFixed(3)},${afterA.y.toFixed(3)}) B=(${afterB.x.toFixed(3)},${afterB.y.toFixed(3)}) ${t.hist()}`);
        step('[PIXEL] 各自新圆点呈各自颜色', inA.d < TH_COLOR && inB2.d < TH_COLOR, `A 色距 ${inA.d.toFixed(1)} / B 色距 ${inB2.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r4);
      },
    },

    // ---------- C-03 批量流 ----------
    {
      id: 'C-03', name: '批量流：框选4人→组拖→组内驻留合并→样式切换→替换合并→撤销（组外不动/替换语义/缩略图像素变化）',
      async run(t, { step }) {
        const G = t.ids.slice(0, 4);
        const outsiders = t.ids.slice(4);

        // ---- 步1 框选 4 人（第 1 行前 4：x∈[1.5,6.9] y=7.2）----
        const b1 = ctx.toClient(0.8, 6.4), b2 = ctx.toClient(7.4, 7.95);
        await dragPts(b1, b2);
        await raf2();
        let r = await cmpShot('c03-1-boxed');
        step('[STATE] 框选：selection==G（恰 4 人）', sortedEq(t.sel(), G), `selection=${t.sel().length} 人 [${t.sel().map(i => i.slice(6, 10))}]`);
        cmpStep(step, r);

        // ---- 步2 组拖：按住组内一人向下 3.6m（整组同步；起手/落点均避开第 2 行）----
        const gd = { x: 0, y: 3.6 };
        const g0 = G.map(id => t.posOf(id));
        const o0 = outsiders.map(id => t.posOf(id));
        await dragPts(t.ptOf(G[1]), ctx.toClient(g0[1].x + gd.x, g0[1].y + gd.y));
        await raf2();
        r = await cmpShot('c03-2-groupdrag');
        const g1 = G.map(id => t.posOf(id));
        const o1 = outsiders.map(id => t.posOf(id));
        const groupOK = g1.every((p, i) => eq(p, { x: g0[i].x + gd.x, y: g0[i].y + gd.y }));
        const outOK = o1.every((p, i) => eq(p, o0[i]));
        const pxMax = Math.max(...g1.map((p, i) => innerMinDist(cv, ctx.toClient(p.x, p.y).x, ctx.toClient(p.x, p.y).y, t.rpx, t.col(G[i])).d));
        step('[STATE] 组拖：4 人同 delta 位移', groupOK, g1.map((p, i) => `Δ${i}=(${(p.x - g0[i].x).toFixed(3)},${(p.y - g0[i].y).toFixed(3)})`).join(' '));
        step('[STATE] 组拖：组外 8 人零位移', outOK, `组外最大漂移 ${Math.max(...o1.map((p, i) => Math.hypot(p.x - o0[i].x, p.y - o0[i].y))).toExponential(2)}m`);
        step('[PIXEL] 组拖：新位置呈 4 色', pxMax < TH_COLOR, `最大色距 ${pxMax.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步3 组内驻留合并：先单击 G2 收拢选择，再拖 G2→G3 驻留 → 「胶囊」 ----
        const sigPreMerge = thumbData(); // 组拖提交后取证 → 隔离出「合并提交」本身的缩略图刷新
        await inp.click(t.ptOf(G[2]).x, t.ptOf(G[2]).y, { hw: 'mouse' });
        await raf2();
        await dwellDrag(t.ptOf(G[2]), t.ptOf(G[3]));
        const m3 = menu();
        await clickMenuBtn(m3, '胶囊');
        const td = thumbDiff(sigPreMerge, thumbData());
        r = await cmpShot('c03-3-merged');
        const mg3 = (fmt().merges || [])[0];
        const unitPt = t.posOf(G[3]);
        step('[STATE] 组内驻留合并：merges=[G2|G3 capsule] 收拢', !!mg3 && mg3.style === 'capsule' && sortedEq([mg3.a, mg3.b], [G[2], G[3]]) && eq(t.posOf(G[2]), unitPt) && store.undoLabel() === '合并单元', `merges=${JSON.stringify((fmt().merges || []).map(x => x.style))} ${t.hist()}`);
        step('[PIXEL] 缩略图像素变化（合并提交后 chip 画布逐像素差>0）', td[0] > 0, `chip0 全量像素绝对差=${td[0]}（合并徽标 vs 两圆）`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步4 样式切换：双击单元 → 「单编号」（v3 两样式）----
        const mid4 = t.mergePt(G[2], G[3]);
        await inp.dblclick(mid4.x, mid4.y, { hw: 'mouse' });
        await raf2();
        const m4 = menu();
        await clickMenuBtn(m4, '单编号');
        r = await cmpShot('c03-4-styled');
        const mg4 = (fmt().merges || [])[0];
        const sp4 = unitProbe(t, 'single', mid4, t.col(G[2]), t.col(G[3]));
        step('[STATE] 样式切换：single + 历史「切换单元样式」', !!mg4 && mg4.style === 'single' && store.undoLabel() === '切换单元样式', `style=${mg4 ? mg4.style : '无'} ${t.hist()}`);
        step('[PIXEL] 单编号呈示（单圆+虚线环+角标）', sp4.ok, sp4.why, 'PIXEL');
        cmpStep(step, r);

        // ---- 步5 替换语义：拖 G0 绕行至单元上驻留 → 「胶囊」→ G0|G2 替换 G2|G3 ----
        const uPt = t.posOf(G[3]);
        const wpts = [t.ptOf(G[0]), ctx.toClient(uPt.x, 13.5), ctx.toClient(uPt.x, uPt.y)];
        const pid5 = await inp.down(wpts[0].x, wpts[0].y, { hw: 'mouse' });
        for (let i = 1; i < wpts.length; i++) { await sleep(30); await inp.move(wpts[i].x, wpts[i].y, { hw: 'mouse', pid: pid5 }); }
        await sleep(300);
        await inp.move(wpts[2].x, wpts[2].y, { hw: 'mouse', pid: pid5 });
        await sleep(1700);
        await inp.move(wpts[2].x, wpts[2].y, { hw: 'mouse', pid: pid5 });
        await raf2();
        const m5 = menu();
        await inp.up(wpts[2].x, wpts[2].y, { hw: 'mouse', pid: pid5 });
        await raf2();
        await clickMenuBtn(m5, '胶囊');
        await raf2();
        r = await cmpShot('c03-5-replaced');
        const mgs = fmt().merges || [];
        const replOK = mgs.length === 1 && sortedEq([mgs[0].a, mgs[0].b], [G[0], G[2]]) && mgs[0].style === 'capsule' && store.undoLabel() === '合并单元';
        step('[STATE] 替换语义：G0|G2 替换旧 G2|G3（一人只属一个单元）', replOK,
          `merges=${JSON.stringify(mgs.map(x => [x.a.slice(6, 10), x.b.slice(6, 10), x.style]))} ${t.hist()}`);
        const rp = unitProbe(t, 'capsule', t.mergePt(G[0], G[2]), t.col(G[0]), t.col(G[2]));
        step('[PIXEL] 替换后胶囊徽标呈示', rp.ok, rp.why, 'PIXEL');
        cmpStep(step, r);

        // ---- 步6 撤销：回退替换合并 → merges 复原为 G2|G3 single（其前一条提交是 G0 的驻留位移）----
        inp.key('z', { ctrl: true });
        await raf2();
        r = await cmpShot('c03-6-undone');
        const mgu = (fmt().merges || [])[0];
        const o2 = outsiders.map(id => t.posOf(id));
        step('[STATE] 撤销：替换合并回退（merges=[G2|G3 single]，label=移动舞者 即替换前的驻留位移提交）',
          !!mgu && mgu.style === 'single' && sortedEq([mgu.a, mgu.b], [G[2], G[3]]) && store.undoLabel() === '移动舞者',
          `merges=${JSON.stringify((fmt().merges || []).map(x => x.style))} ${t.hist()}`);
        step('[STATE] 组外 8 人全程零位移（终态复核）', o2.every((p, i) => eq(p, o0[i])), `最大漂移 ${Math.max(...o2.map((p, i) => Math.hypot(p.x - o0[i].x, p.y - o0[i].y))).toExponential(2)}m`);
        cmpStep(step, r);
      },
    },

    // ---------- C-04 视图变换回归 ----------
    {
      id: 'C-04', name: '视图变换回归：缩放 2×+平移后重放 D-01/D-06/D-08/D-04（复用 L1 用例，命中与拖拽零偏移）',
      async run(t, { step }) {
        // 视图变换（每条子动线独立场景上重放同一变换）：2× 缩放锚定工作区中心 + 平移。
        // 工作区约束：D-06 目标 y≥5.2、D-08 框 y≤9.7、基线空白点 (5.85,12.45) —— 变换后须全部在画布内。
        const setupView = svv => {
          const rect = svv.canvas.getBoundingClientRect();
          const s2 = svv.view.scale * 2;
          const ax = 4.0, ay = 8.85; // 工作区 (0.5~7.5, 4.6~13.1) 的中心
          const v = { scale: s2, ox: rect.width / 2 - ax * s2, oy: rect.height / 2 - ay * s2 };
          v.ox += 24; v.oy += 12;    // 平移分量
          svv.view = v;
          svv.clampPan();
          svv.requestDraw();
        };
        const scale0 = sv.view.scale;
        const subs = ['D-01', 'D-06', 'D-08', 'D-04'];
        for (const id of subs) {
          const r = await runL1({ phase: 'M', only: id, setupView });
          for (const [k, v] of Object.entries(r.shots || {})) shots[`c04-${id.toLowerCase()}-${k}`] = v;
          for (const c of r.cases) for (const s of c.steps) step(`[${c.id}] ${s.name}`, s.ok, s.detail, s.layer);
          if (r.cases.some(c => !c.ok)) { step(`[子动线] ${id} 失败 → 停止后续子集（失败即停）`, false, '', 'META'); break; }
        }
        // 变换后坐标往返零偏移 + 变换生效 + 整页 SCREEN
        const probe = ctx.toClient(3.3, 7.2);
        const back = sv.toStage(probe.x, probe.y);
        step('[STATE] 变换生效：scale ×2', Math.abs(sv.view.scale / scale0 - 2) < 1e-9, `scale ${scale0.toFixed(2)}→${sv.view.scale.toFixed(2)}`);
        step('[STATE] 命中换算零偏移（toClient→toStage 往返 <1e-9）', Math.abs(back.x - 3.3) < 1e-9 && Math.abs(back.y - 7.2) < 1e-9, `往返误差 (${Math.abs(back.x - 3.3).toExponential(2)},${Math.abs(back.y - 7.2).toExponential(2)})m`);
        const rEnd = await cmpShot('c04-final');
        cmpStep(step, rEnd);
      },
    },

    // ---------- C-05 编辑锁穿越 ----------
    {
      id: 'C-05', name: '编辑锁穿越（单元语义 v2）：关锁负断言集{点击/拖拽/框选/双击弹窗/中键平移}→开锁正断言重放{P1=点选原子两人 P2=整单元同步位移 P3=框选原子 P4=浮窗锚定新位置}',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        const { mid } = await setupMergeT(t, 'capsule');
        const midStage = { x: t.posOf(A).x, y: t.posOf(A).y };
        const data0 = t.data();
        const preCA = mean3x3(cv, t.ptOf(A).x, t.ptOf(A).y);

        // ---- 关锁 ----
        await clickBtn('btn-edit-mode');
        step('[STATE] 锁生效（editMode=false）', state().editMode === false, `editMode=${state().editMode}`);
        const v0 = { ...sv.view };

        // ---- 负断言集（锁下尝试 5 类手势）----
        await inp.click(t.ptOf(B).x, t.ptOf(B).y, { hw: 'mouse' });
        await raf2();
        step('[STATE][N1·D-01] 锁下点击不改变选择', t.sel().length === 0, `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        await dragPts(t.ptOf(A), ctx.toClient(t.posOf(A).x + 1.0, t.posOf(A).y - 2.0));
        await raf2();
        step('[STATE][N2·D-06] 锁下拖拽零位移零历史', eq(t.posOf(A), midStage) && !store.canUndo() && !store.canRedo(), `A=(${t.posOf(A).x},${t.posOf(A).y}) ${t.hist()}`);
        await dragPts(t.blank, { x: t.blank.x + 60, y: t.blank.y + 40 });
        await raf2();
        step('[STATE][N3·D-08] 锁下空白框选零选择零数据', t.sel().length === 0 && t.data() === data0, `selection=${t.sel().length} data 不变=${t.data() === data0}`);
        await inp.dblclick(mid.x, mid.y, { hw: 'mouse' });
        await raf2();
        step('[DOM][N4·D-04] 锁下双击单元无浮窗', !menu(), menu() ? `意外出现 "${menu().title}"` : '无 .unit-menu', 'DOM');
        const pid = await inp.down(t.blank.x, t.blank.y, { hw: 'mouse', button: 1 });
        await sleep(30);
        await inp.move(t.blank.x + 50, t.blank.y + 30, { hw: 'mouse', pid });
        await sleep(30);
        await inp.up(t.blank.x + 50, t.blank.y + 30, { hw: 'mouse', pid });
        await raf2();
        step('[STATE][N5·D-11] 锁下中键空白拖动 view 不动（不平移）', Math.abs(sv.view.ox - v0.ox) < 0.5 && Math.abs(sv.view.oy - v0.oy) < 0.5, `Δox=${(sv.view.ox - v0.ox).toFixed(2)} Δoy=${(sv.view.oy - v0.oy).toFixed(2)}`);
        await clickBtn('btn-multi');
        const multiOn = state().multiSelect === true;
        await clickBtn('btn-multi');
        const multiOff = state().multiSelect === false;
        step('[DOM][面板·D-16] 锁下面板可用（多选开关切换成功并还原）', multiOn && multiOff, `multiSelect ${multiOn}→${multiOff}`, 'DOM');
        const postCA = mean3x3(cv, t.ptOf(A).x, t.ptOf(A).y);
        let r = await cmpShot('c05-locked');
        step('[PIXEL] 锁下位图不变', dist(postCA, preCA) < 8, `A 圆心色变 ${dist(postCA, preCA).toFixed(1)} < 8`, 'PIXEL');
        cmpStep(step, r);

        // ---- 开锁正断言重放（单元语义 v2：P1=点选原子两人 / P2=整单元同步位移 / P4=浮窗锚定随单元新位置）----
        await clickBtn('btn-edit-mode');
        step('[STATE] 解锁（editMode=true）', state().editMode === true, '');
        await inp.click(t.ptOf(B).x, t.ptOf(B).y, { hw: 'mouse' });
        await raf2();
        const hlB = ringMinDist(cv, t.ptOf(B).x, t.ptOf(B).y, t.rpx, HL);
        step('[STATE][P1·D-01] 解锁后点选收拢徽标=整单元两人入选（selection==[A,B]）', sortedEq(t.sel(), [A, B]), `selection=[${t.sel().map(i => i.slice(0, 8))}]`);
        step('[PIXEL][P1·D-01] 选中高亮出现', hlB.d < TH_HL, `色距 ${hlB.d.toFixed(1)} < ${TH_HL}`, 'PIXEL');
        const dragTarget = { x: t.posOf(B).x + 1.0, y: t.posOf(B).y - 2.0 };
        await dragPts(t.ptOf(B), ctx.toClient(dragTarget.x, dragTarget.y));
        await raf2();
        r = await cmpShot('c05-p2-drag');
        step('[STATE][P2·D-06] 解锁后拖拽=整单元同步位移（单元原子；单人拉伸语义已退役）',
          eq(t.posOf(A), dragTarget) && eq(t.posOf(B), dragTarget) && store.undoLabel() === '移动舞者',
          `A=(${t.posOf(A).x.toFixed(6)},${t.posOf(A).y.toFixed(6)}) B=(${t.posOf(B).x.toFixed(6)},${t.posOf(B).y.toFixed(6)}) ｜ 期望两者均=(${dragTarget.x.toFixed(6)},${dragTarget.y.toFixed(6)}) ${t.hist()}`);
        cmpStep(step, r);
        await dragPts(ctx.toClient(1.6, 4.4), ctx.toClient(4.9, 7.9));
        await raf2();
        step('[STATE][P3·D-08] 解锁后框选 [A,B]（单元在框内→整单元原子入选）', sortedEq(t.sel(), [A, B]), `selection=[${t.sel().map(i => i.slice(6, 10))}]`);
        const mid2 = t.mergePt(A, B); // 拖拽后单元新位置（旧 mid 已失效——整单元随拖同步位移）
        await inp.dblclick(mid2.x, mid2.y, { hw: 'mouse' });
        await raf2();
        const m = menu();
        const dRect = m ? Math.hypot(Math.max(m.rect.left - mid2.x, 0, mid2.x - m.rect.right), Math.max(m.rect.top - mid2.y, 0, mid2.y - m.rect.bottom)) : Infinity;
        let border = null;
        if (m) {
          const rm = await cmpShot('c05-p4-menu', inflate(m.rect));
          border = await menuBorder(rm.b64, m);
        }
        await closeMenu();
        r = await cmpShot('c05-unlocked');
        step('[DOM][P4·D-04] 解锁后双击单元弹浮窗（锚定单元 <150px）', !!m && dRect < 150, m ? `title="${m.title}" 距离 ${dRect.toFixed(1)}px` : '无 .unit-menu', 'DOM');
        if (m) step('[SCREEN][P4·D-04] 浮窗边框色可检出', border.d < 140, `色距 ${border.d.toFixed(1)}`, 'SCREEN');
        cmpStep(step, r);
      },
    },

    // ---------- C-06 划帧与动画 ----------
    {
      id: 'C-06', name: '划帧与动画：建4帧（合并交替）→切帧预览→动画中点击打断→时间轴播放跨帧',
      async run(t, { step }) {
        const ids = t.ids;
        const ease = window.__fs.M.easeInOut;
        const fPos = i => store.getState().project.formations[i].positions;
        // ---- 建 4 帧（store/M 公共 API）：F0 合并(0,1)；F1 无合并 ids6→(9,4)；F2 合并(2,3) ids6→(3,12)；F3 合并(4,5) ids6→(9,12)
        store.mutate(p => {
          const f0 = p.formations[state().formationIndex];
          M.addMerge(f0, ids[0], ids[1], 'capsule');
          M.collapseUnit(f0, ids[0], ids[1]);
          const mk = () => { const f = M.createFormationFrom(p, p.formations.length - 1); f.merges = []; return f; }; // createFormationFrom 会克隆 src.merges → 新帧清空后再按需建合并
          const f1 = mk(), f2 = mk(), f3 = mk();
          f1.positions[ids[6]] = { x: 9, y: 4, facing: 180 };
          f2.positions[ids[6]] = { x: 3, y: 12, facing: 180 };
          f3.positions[ids[6]] = { x: 9, y: 12, facing: 180 };
          M.addMerge(f2, ids[2], ids[3], 'capsule');
          M.collapseUnit(f2, ids[2], ids[3]);
          M.addMerge(f3, ids[4], ids[5], 'capsule');
          M.collapseUnit(f3, ids[4], ids[5]);
        }, 'C06 布置四帧');
        await raf2();
        const fms = store.getState().project.formations;
        step('[STATE] 建 4 帧且合并状态交替（有/无/有/有）', fms.length === 4 &&
          (fms[0].merges || []).length === 1 && !(fms[1].merges || []).length &&
          (fms[2].merges || []).length === 1 && (fms[3].merges || []).length === 1,
          `帧数=${fms.length} merges=${fms.map(f => (f.merges || []).length).join(',')}`);

        // ---- 切帧预览动画 ----
        step('[前置] 切帧预览开启', state().previewOnSwitch === true, `previewOnSwitch=${state().previewOnSwitch}`);
        const chip = i => document.querySelectorAll('#formation-list .es-chip')[i];
        const clickChip = async i => {
          const cr = chip(i).getBoundingClientRect();
          await inp.click(cr.left + cr.width / 2, cr.top + cr.height / 2, { hw: 'mouse' });
        };
        await clickChip(1);
        await sleep(80);
        const anim = sv.anim;
        const fromJSON = anim ? JSON.stringify(anim.from) : '';
        const toJSON = anim ? JSON.stringify(anim.to) : '';
        const fromIdx = anim ? store.getState().project.formations.findIndex(f => f.positions === anim.from) : -1; // 引用定位：anim.from 到底是哪一帧
        const toIdx = anim ? store.getState().project.formations.findIndex(f => f.positions === anim.to) : -1;
        const fromOK = !!anim && fromJSON === JSON.stringify(fPos(0));
        const toOK = !!anim && toJSON === JSON.stringify(fPos(1));
        let mid = null;
        if (anim) {
          const el = performance.now() - anim.t0;
          const tt = ease(Math.min(1, el / anim.dur));
          const a = anim.from[ids[6]], b = anim.to[ids[6]];
          const cpt = ctx.toClient(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
          mid = { tt, el, got: minDistOver((x, y) => mean3x3(cv, x, y), t.col(ids[6]), gridRegion(cpt.x - 14, cpt.y - 14, cpt.x + 14, cpt.y + 14, 2)) };
        }
        const w0 = performance.now();
        while (sv.anim && performance.now() - w0 < 2000) await sleep(40);
        await raf2();
        const f1pt = ctx.toClient(9, 4);
        const atF1 = innerMinDist(cv, f1pt.x, f1pt.y, t.rpx, t.col(ids[6]));
        const rEnd = await cmpShot('c06-anim-end');
        step('[STATE] 切帧触发舞台动画（anim.from=F0 → to=F1）', fromOK && toOK,
          anim ? `formationIndex=${state().formationIndex}；anim.from=帧${fromIdx}、anim.to=帧${toIdx}（引用定位）；JSON from 命中=${fromOK} to 命中=${toOK} —— from 应为切换前帧（main.js switchFormation：setUI 后读 s.formationIndex，getState 为同一活状态对象 → 被覆盖为新帧）`
            : '无 anim');
        step('[PIXEL] 动画进行中舞者位于插值点（非跳变）', !!mid && mid.got.d < TH_COLOR, mid ? `t=${mid.tt.toFixed(2)}@${Math.round(mid.el)}ms 最小色距 ${mid.got.d.toFixed(1)}` : '未捕获', 'PIXEL');
        step('[STATE] 插值有限：动画自然结束', !sv.anim, `等待 ${Math.round(performance.now() - w0)}ms 后 anim=null`);
        step('[STATE] 终点=目标帧（formationIndex==1）', state().formationIndex === 1, `formationIndex=${state().formationIndex}`);
        step('[PIXEL] 终点=目标帧（F1 位置呈舞者色）', atF1.d < TH_COLOR, `色距 ${atF1.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        cmpStep(step, rEnd);

        // ---- 动画中点击打断（不吞输入）----
        await clickChip(2);
        await sleep(150);
        const anim2 = !!sv.anim;
        const tgt = ctx.toClient(3, 12); // ids[6] 的 F2 位置（命中走 formation 数据，不依赖动画画面）
        await inp.click(tgt.x, tgt.y, { hw: 'mouse' });
        await raf2();
        const selOK = JSON.stringify(t.sel()) === JSON.stringify([ids[6]]);
        const w1 = performance.now();
        while (sv.anim && performance.now() - w1 < 2000) await sleep(40);
        await raf2();
        const atF2 = innerMinDist(cv, tgt.x, tgt.y, t.rpx, t.col(ids[6]));
        const r2 = await cmpShot('c06-interrupted');
        step('[STATE] 动画中点击不吞输入（selection==[ids6]）', selOK, `点击时 anim 活跃=${anim2}`);
        step('[STATE] 打断后动画仍有限结束且终点=F2', !sv.anim && state().formationIndex === 2, `formationIndex=${state().formationIndex}`);
        step('[PIXEL] F2 终点呈舞者色', atF2.d < TH_COLOR, `色距 ${atF2.d.toFixed(1)}`, 'PIXEL');
        cmpStep(step, r2);

        // ---- 时间轴播放跨帧（无音乐虚拟时钟：当前块 hold2+travel2，play→travel 插值→previewStop 复位）----
        store.mutate(p => { const b = p.timeline.blocks[2]; b.holdBeats = 2; b.travelBeats = 2; }, 'C06 缩短块2');
        await raf2();
        const pb = document.getElementById('pb-play');
        const pbr = pb.getBoundingClientRect();
        await inp.click(pbr.left + pbr.width / 2, pbr.top + pbr.height / 2, { hw: 'mouse' });
        await sleep(1350); // hold 2拍=1s → travel 中段（120BPM=0.5s/拍）
        const player = window.__fs.player();
        const playing = player.playing, beatSnap = player.beat;
        const segs = M.computeSegments(store.getState().project).segments;
        const seg = segs[2];
        let travel = null;
        if (playing && seg && beatSnap > seg.holdEnd && beatSnap < seg.travelEnd) {
          const tt = ease((beatSnap - seg.holdEnd) / (seg.travelEnd - seg.holdEnd));
          const a = fPos(2)[ids[6]], b = fPos(3)[ids[6]];
          const cpt = ctx.toClient(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
          travel = { tt, beatSnap, got: minDistOver((x, y) => mean3x3(cv, x, y), t.col(ids[6]), gridRegion(cpt.x - 14, cpt.y - 14, cpt.x + 14, cpt.y + 14, 2)) };
        }
        const w2 = performance.now();
        while (player.playing && performance.now() - w2 < 6000) await sleep(50);
        await raf2();
        const r3 = await cmpShot('c06-play-end');
        step('[STATE] 播放启动且进入跨帧过渡（travel 中段）', playing && !!travel, `playing=${playing} beat=${beatSnap != null ? beatSnap.toFixed(2) : '—'} seg=[${seg ? seg.holdEnd : '—'},${seg ? seg.travelEnd : '—'}]`);
        step('[PIXEL] 播放跨帧：插值位置呈舞者色', !!travel && travel.got.d < TH_COLOR, travel ? `beat=${travel.beatSnap.toFixed(2)} t=${travel.tt.toFixed(2)} 色距 ${travel.got.d.toFixed(1)}` : '未捕获', 'PIXEL');
        step('[STATE] 播放连续：有限段播放到达终点并复位（playing=false, beat=0）', !player.playing && player.beat === 0, `等待 ${Math.round(performance.now() - w2)}ms; playing=${player.playing} beat=${player.beat}`);
        cmpStep(step, r3);
      },
    },

    // ---------- C-07 时间轴组合 ----------
    {
      id: 'C-07', name: '时间轴组合：拖块边缘改时长→拖拽重排 chip→播放→暂停→编辑（时长重算/缩略图刷新/播放头联动）',
      async run(t, { step }) {
        const ids = t.ids;
        // 布置 3 帧（ids[0] 各帧位置不同 → 缩略图可分辨）
        store.mutate(p => {
          const f1 = M.createFormationFrom(p, p.formations.length - 1);
          const f2 = M.createFormationFrom(p, p.formations.length - 1);
          f1.positions[ids[0]] = { x: 9, y: 6, facing: 180 };
          f2.positions[ids[0]] = { x: 6, y: 12, facing: 180 };
        }, 'C07 布置三帧');
        store.setUI({ formationIndex: 0 });
        await raf2();
        const tl = window.__fs.musicTl();
        const p0 = store.getState().project;
        const rect = tl.cv.getBoundingClientRect();
        const yC = rect.top + tl.blocksTop + tl.blocksH / 2;
        const xB = (proj, beat) => rect.left + (beat * (60 / (proj.audio.bpm || 120))) * tl.ppsOf(proj); // firstBeatSec=0

        // ---- 步1 拖块边缘：seg0 hold 右缘（beat16）→ beat18（自动吸附整拍）----
        step('[前置] 连续时长（ripple）开启', state().ripple === true, `ripple=${state().ripple}`);
        const totalSec0 = M.totalDurationSec(p0); // 拖块会原地 mutate p0 → 先取数值
        const x16 = xB(p0, 16), x18 = xB(p0, 18);
        const sigBefore = px1(tl.cv, xB(p0, 17), yC);
        const pid = await inp.down(x16, yC, { hw: 'mouse' });
        await sleep(30);
        await inp.move((x16 + x18) / 2, yC, { hw: 'mouse', pid });
        await sleep(30);
        await inp.move(x18, yC, { hw: 'mouse', pid });
        await inp.up(x18, yC, { hw: 'mouse', pid });
        await raf2();
        const p1 = store.getState().project;
        const hold1 = p1.timeline.blocks[0].holdBeats;
        const segs1 = M.computeSegments(p1).segments;
        const r1 = await cmpShot('c07-1-edge');
        const sigAfter = px1(tl.cv, xB(p1, 17), yC);
        step('[STATE] 拖块边缘：hold 16→18 拍（吸附整拍）', hold1 === 18, `holdBeats=${hold1}`);
        step('[STATE] 段落时长重算：后段顺延 + 总时长变化', segs1[1].holdStart === 26 && M.totalDurationSec(p1) - totalSec0 > 0.1,
          `seg1.holdStart=${segs1[1].holdStart}（期望 26）总时长 ${totalSec0.toFixed(1)}→${M.totalDurationSec(p1).toFixed(1)}s`);
        step('[STATE] 历史=「调整时长」', store.undoLabel() === '调整时长', t.hist());
        step('[DOM] 块时长栏联动（18拍）', document.getElementById('bc-hold').textContent.includes('18拍'), `bc-hold="${document.getElementById('bc-hold').textContent}"`, 'DOM');
        step('[PIXEL] 时间线边界面刷新（beat17 点：过渡纹理→保持块色）', !!sigBefore && !!sigAfter && dist(sigAfter, sigBefore) > 12,
          `before=${sigBefore ? rgb(sigBefore) : 'null'} after=${sigAfter ? rgb(sigAfter) : 'null'} 色差 ${sigBefore && sigAfter ? dist(sigAfter, sigBefore).toFixed(1) : '—'}`, 'PIXEL');
        cmpStep(step, r1);

        // ---- 步2 拖拽重排 chip（HTML5 DnD 事件序列：dragstart→dragover→drop）----
        const order0 = p1.formations.map(f => f.id);
        const chips = () => [...document.querySelectorAll('#formation-list .es-chip')];
        const dt = new DataTransfer();
        chips()[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        chips()[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        chips()[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await raf2();
        const p2 = store.getState().project;
        const order1 = p2.formations.map(f => f.id);
        const blkOf = id => p2.timeline.blocks[p2.formations.findIndex(f => f.id === id)];
        const names = chips().map(c => c.querySelector('.es-name').textContent);
        const r2 = await cmpShot('c07-2-reorder');
        step('[STATE] 重排：[f0,f1,f2]→[f1,f2,f0]', JSON.stringify(order1) === JSON.stringify([order0[1], order0[2], order0[0]]), `order=${order1.map(i => i.slice(0, 6)).join(',')}`);
        step('[STATE] 时间轴块随 formationId 同步（时长保留）', p2.timeline.blocks.length === 3 && order1.every((id, i) => p2.timeline.blocks[i].formationId === id) && blkOf(order0[0]).holdBeats === 18,
          `blocks.formationId=${p2.timeline.blocks.map(b => b.formationId.slice(0, 6)).join(',')} f0.hold=${blkOf(order0[0]).holdBeats}`);
        step('[DOM] chip 重新渲染（名称顺序=队形2/队形3/开场队形）', /队形 2/.test(names[0]) && /队形 3/.test(names[1]) && /开场队形/.test(names[2]), `names=${names.map(n => n.replace(/^\d+\.\s*/, '')).join('/')}`, 'DOM');
        cmpStep(step, r2);

        // ---- 步3 播放 → 播放头联动 + 播放锁定编辑 ----
        const pb = document.getElementById('pb-play');
        const clickPb = async () => {
          const pr = pb.getBoundingClientRect();
          await inp.click(pr.left + pr.width / 2, pr.top + pr.height / 2, { hw: 'mouse' });
        };
        const player = window.__fs.player();
        await clickPb();
        await sleep(900);
        const ovR = tl.ov.getBoundingClientRect();
        const phGot = b => {
          const x = rect.left + (b * (60 / (store.getState().project.audio.bpm || 120))) * tl.ppsOf(store.getState().project);
          return minDistOver((px, py) => px1(tl.ov, px, py), RED, gridRegion(x - 5, ovR.top + 50, x + 5, ovR.top + 100, 2));
        };
        const beat1 = player.beat;
        const got1 = phGot(beat1);
        step('[STATE] 播放中（虚拟时钟推进）', player.playing && beat1 > 0.5, `playing=${player.playing} beat=${beat1.toFixed(2)}`);
        step('[PIXEL] 播放头红线在播放头位置可见', got1.d < 80, `beat=${beat1.toFixed(2)} 最小色距 ${got1.d.toFixed(1)}@${JSON.stringify(got1.at)}`, 'PIXEL');
        await sleep(500);
        const beat2 = player.beat;
        const got2 = phGot(beat2);
        step('[PIXEL] 播放头联动前移（beat 增大且红线跟随）', beat2 > beat1 + 0.3 && got2.d < 80, `beat ${beat1.toFixed(2)}→${beat2.toFixed(2)} 色距 ${got2.d.toFixed(1)}`, 'PIXEL');
        const posBefore = t.posOf(ids[0]);
        await dragPts(t.ptOf(ids[0]), { x: t.ptOf(ids[0]).x + 30, y: t.ptOf(ids[0]).y - 20 });
        await raf2();
        step('[STATE] 播放中舞台只读：拖拽零位移', eq(t.posOf(ids[0]), posBefore) && store.undoLabel() !== '移动舞者', `Δ=(${(t.posOf(ids[0]).x - posBefore.x).toFixed(4)},${(t.posOf(ids[0]).y - posBefore.y).toFixed(4)})`);
        await clickPb(); // 暂停
        await raf2();
        step('[STATE] 暂停：playing=false 且播放头位置保留', !player.playing && player.beat > 0.5, `beat=${player.beat.toFixed(2)}`);

        // ---- 步4 暂停后编辑 + 缩略图刷新 ----
        const sigT0 = thumbData();
        await dragPts(t.ptOf(ids[0]), { x: t.ptOf(ids[0]).x + 40, y: t.ptOf(ids[0]).y });
        await raf2();
        const posAfter = t.posOf(ids[0]);
        const tdEdit = thumbDiff(sigT0, thumbData());
        const r3 = await cmpShot('c07-3-edit');
        step('[STATE] 暂停后编辑：位移提交（移动舞者）', !eq(posAfter, posBefore) && store.undoLabel() === '移动舞者', `pos=(${posAfter.x.toFixed(3)},${posAfter.y.toFixed(3)}) ${t.hist()}`);
        step('[PIXEL] 缩略图刷新（编辑提交后 chip 画布逐像素差>0）', tdEdit[0] > 0, `chip0 全量像素绝对差=${tdEdit[0]}`, 'PIXEL');
        cmpStep(step, r3);
      },
    },

    // ---------- C-08 名册与编组管理（v3 重写：原「名册联动」的舞对语义随 pairs 退役） ----------
    {
      id: 'C-08', name: '名册与编组管理：存组→名册 chips 加入/移出→＋单人→删组员（组引用联动清理）→回舞台验证→undo/redo 全链',
      async run(t, { step }) {
        const projStr = () => stableStr(store.getState().project);
        const ids = t.ids;
        const n0 = store.getState().project.dancers.length; // 12
        const groupsOf = () => store.getState().project.groups || [];
        const nGroups0 = groupsOf().length; // 默认 gender 项目预置 男士/女士 两组——按名定位「组1」，不依赖位次
        const g1 = () => groupsOf().find(g => g.name === '组1');
        const snapBase = projStr(); // 基线（存组前；undo 栈底还原后按布置约定复位 snap 再深等）

        // ---- 步1 框选 2 人（第 1 行前 2）→ 右侧「编组」tab → ＋存为编组 ----
        await dragPts(ctx.toClient(0.8, 6.4), ctx.toClient(4.5, 7.95));
        await raf2();
        const sel2 = t.sel().slice().sort();
        const ptab = document.querySelector('.ptab[data-tab="groups"]');
        const tr = ptab.getBoundingClientRect();
        await inp.click(tr.left + tr.width / 2, tr.top + tr.height / 2, { hw: 'mouse' });
        await raf2();
        const addGrpBtn = [...document.querySelectorAll('#props-groups button')].find(b => b.textContent.includes('存为编组'));
        const agr = addGrpBtn.getBoundingClientRect();
        await inp.click(agr.left + agr.width / 2, agr.top + agr.height / 2, { hw: 'mouse' });
        await raf2();
        const savedOK = groupsOf().length === nGroups0 + 1 && g1() && g1().memberIds.length === 2 &&
          JSON.stringify(g1().memberIds.slice().sort()) === JSON.stringify(sel2) &&
          store.undoLabel() === '存为编组' && store.getState().project.dancers.length === n0;
        step('[STATE] ＋存为编组：新增「组1(2人)」成员=所选、舞者数量不变', savedOK,
          `groups=${JSON.stringify(groupsOf().map(g => [g.name, g.memberIds.length]))} ${t.hist()}`);
        const snap0 = projStr();

        // ---- 步2 打开名册：v3 标题/编组列/chip 状态（组员行的「组1」chip 呈 chip-on）----
        await clickBtn('btn-roster');
        let modalEl = document.querySelector('#modal-root .modal');
        step('[DOM] 名册弹窗出现（v3 标题=名册 · 舞者与编组）', !!modalEl && modalEl.textContent.includes('名册 · 舞者与编组'),
          modalEl ? 'title=名册 · 舞者与编组' : '无 .modal', 'DOM');
        const chipOf = (i, name = '组1') => { // 第 i 行中名为 name 的编组芯片（行内含预置组+新建组多枚 chip）
          const row = document.querySelectorAll('#modal-root .roster-table tbody tr')[i];
          return row ? [...row.querySelectorAll('.roster-groups .chip')].find(c => c.textContent === name) || null : null;
        };
        step('[DOM] 组员行「组1」chip-on、非组员行普通 chip', chipOf(0)?.classList.contains('chip-on') === true && chipOf(2)?.classList.contains('chip-on') === false,
          `row0="${chipOf(0)?.className}" row2="${chipOf(2)?.className}"`, 'DOM');

        // ---- 步3 chips 加入：ids[2] 行点「组1」 → 组1=3 人 ----
        const c3 = chipOf(2).getBoundingClientRect();
        await inp.click(c3.left + c3.width / 2, c3.top + c3.height / 2, { hw: 'mouse' });
        await raf2();
        const joinOK = g1().memberIds.length === 3 && g1().memberIds.includes(ids[2]) && store.undoLabel() === '加入编组';
        step('[STATE] chip 加入：组1=3 人含 ids[2]，历史「加入编组」', joinOK, `members=${g1().memberIds.length} ${t.hist()}`);
        const snapJoin = projStr();

        // ---- 步4 chips 移出：ids[0] 行再点 → 组1=2 人 ----
        const c0 = chipOf(0).getBoundingClientRect();
        await inp.click(c0.left + c0.width / 2, c0.top + c0.height / 2, { hw: 'mouse' });
        await raf2();
        const leaveOK = g1().memberIds.length === 2 && !g1().memberIds.includes(ids[0]) && store.undoLabel() === '移出编组';
        step('[STATE] chip 移出：组1=2 人不含 ids[0]，历史「移出编组」', leaveOK, `members=${g1().memberIds.length} ${t.hist()}`);
        const snapLeave = projStr();

        // ---- 步5 ＋ 单人（出缺席处理保持）----
        const addBtn = [...document.querySelectorAll('#modal-root button')].find(b => b.textContent === '＋ 单人');
        const ar = addBtn.getBoundingClientRect();
        await inp.click(ar.left + ar.width / 2, ar.top + ar.height / 2, { hw: 'mouse' });
        await raf2();
        const p1 = store.getState().project;
        const dNew = p1.dancers[p1.dancers.length - 1];
        const addOK = p1.dancers.length === n0 + 1 && p1.formations.every(f => !!f.positions[dNew.id]) && !g1().memberIds.includes(dNew.id);
        step('[STATE] 增：舞者 +1 且全部队形补位（ensureDancerInFormation）、新舞者不在组1', addOK,
          `dancers=${p1.dancers.length} 新id=${dNew.id.slice(0, 8)} 各帧补位=${p1.formations.every(f => !!f.positions[dNew.id])}`);
        const snapAdd = projStr();

        // ---- 步6 删组内一员 ids[1]（删除走既有 removeDancer 路径 → 组引用联动清理；确认弹窗由仪器放行）----
        const victim = ids[1];
        const victimPos = { ...fmt().positions[victim] };
        const oldConfirm = window.confirm;
        window.confirm = () => true;
        const victimIdx = p1.dancers.findIndex(d => d.id === victim);
        const delBtn = document.querySelectorAll('#modal-root .roster-table tbody tr')[victimIdx].querySelector('button.danger');
        const dr = delBtn.getBoundingClientRect();
        await inp.click(dr.left + dr.width / 2, dr.top + dr.height / 2, { hw: 'mouse' });
        await raf2();
        window.confirm = oldConfirm;
        const p3 = store.getState().project;
        const victimGone = p3.dancers.length === n0 && !p3.dancers.some(d => d.id === victim) &&
          p3.formations.every(f => !(victim in f.positions));
        const keysOK = p3.formations.every(f => sortedEq(Object.keys(f.positions), p3.dancers.map(d => d.id)));
        const grpClean = g1().memberIds.length === 1 && !g1().memberIds.includes(victim);
        step('[STATE] 删组员：舞者移除、全队形 positions 键同步', victimGone, `dancers=${p3.dancers.length} victim 位置残留=${p3.formations.some(f => victim in f.positions)}`);
        step('[STATE] 数据不变式：positions 键==dancers id、组引用联动清理（memberIds 不含被删者）', keysOK && grpClean, `键一致=${keysOK} 组1 剩 ${g1().memberIds.length} 人`);
        const snapDel = projStr();

        // ---- 步7 回舞台 PIXEL ----
        const closeBtn = [...document.querySelectorAll('#modal-root .m-foot button')].find(b => b.textContent === '关闭');
        closeBtn.scrollIntoView({ block: 'center' }); // 名册内容超高：footer 在滚动折叠线下，须先滚入视口
        await sleep(80);
        const cr = closeBtn.getBoundingClientRect();
        await inp.click(cr.left + cr.width / 2, cr.top + cr.height / 2, { hw: 'mouse' });
        await raf2();
        const np = fmt().positions[dNew.id];
        const newPt = ctx.toClient(np.x, np.y);
        const inNewD = innerMinDist(cv, newPt.x, newPt.y, t.rpx, hex(dNew.color));
        const vicPt = ctx.toClient(victimPos.x, victimPos.y);
        const vicC = mean3x3(cv, vicPt.x, vicPt.y);
        const r = await cmpShot('c08-stage');
        step('[PIXEL] 回舞台：新舞者在其补位呈示（X 绿）', inNewD.d < TH_COLOR, `色距 ${inNewD.d.toFixed(1)} < ${TH_COLOR}`, 'PIXEL');
        step('[PIXEL] 回舞台：被删组员原位回背景（缺席处理）', dist(vicC, t.base) < TH_BG, `原位距基线 ${dist(vicC, t.base).toFixed(1)} < ${TH_BG}`, 'PIXEL');
        cmpStep(step, r);

        // ---- 步8 undo 全链：删→增→移出→加入→存组 逐级深等还原，redo×5 重放 ----
        const levels = [
          { tag: 'undo1(删还原)', want: snapAdd, label: '添加舞者' },
          { tag: 'undo2(移出还原)', want: snapLeave, label: '移出编组' },
          { tag: 'undo3(加入还原)', want: snapJoin, label: '加入编组' },
          { tag: 'undo4(存组还原)', want: snap0, label: '存为编组' },
          { tag: 'undo5(基线还原)', want: snapBase, label: '', snapFix: true }, // 栈底快照含 snap:true → 复位后按布置约定深等
        ];
        for (const lv of levels) {
          inp.key('z', { ctrl: true });
          await raf2();
          if (lv.snapFix) store.mutate(p => { p.stage.snap = false; }); // 无 label：不产生历史
          await raf2();
          const got = projStr();
          const labelOK = lv.label === '' ? !store.canUndo() : store.undoLabel() === lv.label;
          step(`[STATE] ${lv.tag}：项目深等还原`, got === lv.want && labelOK, `深等=${got === lv.want} ${t.hist()}`);
        }
        for (let i = 0; i < 5; i++) {
          inp.key('z', { ctrl: true, shift: true });
          await raf2();
        }
        const gotTip = projStr();
        step('[STATE] redo×5 重放至删除后终态（深等，含组数据）', gotTip === snapDel && !store.canRedo(), `深等=${gotTip === snapDel} ${t.hist()}`);
        const rEnd = await cmpShot('c08-final');
        cmpStep(step, rEnd);
      },
    },

    // ---------- C-10 数据完整性（前半：reload 前取证；后半由驱动 reload 后以 c10pre 续跑）----------
    {
      id: 'C-10', name: '数据完整性：positions 键==dancers id / merges 引用有效 / undo 深度≤上限 / 载入-保存-reload 往返深等',
      async run(_t, { step }) { // 注意：C-10 不重建场景（延续 C-08 之后的会话数据），_t=null
        const projNow = () => store.getState().project;
        const fmtData = () => JSON.stringify({ p: fmt().positions, m: fmt().merges || [] });

        if (opts.c10pre) {
          // ===== reload 后半段（同 context 同页，IndexedDB 同源持久化）=====
          const pre = opts.c10pre;
          const proj = projNow();
          step('[STATE] reload 后自动载入同一项目（fs.lastProject）', !!proj && proj.id === pre.projectId,
            `id=${proj ? proj.id.slice(0, 12) : 'null'}（title=${proj ? proj.meta.title : '—'}）期望 ${pre.projectId ? pre.projectId.slice(0, 12) : 'null'}（title=${pre.title}）；localStorage fs.lastProject=${localStorage.getItem('fs.lastProject')} library[0]=${(store.getState().library[0] || {}).id}/${(store.getState().library[0] || {}).meta?.title}`);
          const now = stableStr(proj);
          const diffAt = now === pre.stable ? -1 : [...now].findIndex((ch, i) => ch !== pre.stable[i]);
          step('[STATE] 载入-保存-reload 往返深等（稳定化 JSON 逐键相等）', now === pre.stable,
            now === pre.stable ? `字节一致（${now.length} chars，剔除 meta.updatedAt）` : `长度 ${pre.stable.length}→${now.length}；首差异@${diffAt}: ...${pre.stable.slice(Math.max(0, diffAt - 40), diffAt + 40)}... vs ...${now.slice(Math.max(0, diffAt - 40), diffAt + 40)}...`);
          // 细项深等（防"整体相等"掩盖单项）
          const idsNow = proj.dancers.map(d => d.id).sort();
          const posEq = pre.pos.every((pp, i) => JSON.stringify(pp) === JSON.stringify(proj.formations[i].positions));
          const mgEq = pre.mg.every((mm, i) => JSON.stringify(mm) === JSON.stringify(proj.formations[i].merges || null));
          const blkEq = JSON.stringify(pre.blocks) === JSON.stringify(proj.timeline.blocks);
          step('[STATE] 细项：dancers id 序列一致', JSON.stringify(idsNow) === JSON.stringify(pre.ids), `${proj.dancers.length} 人`);
          step('[STATE] 细项：各帧 positions 深等', posEq, `${proj.formations.length} 帧`);
          step('[STATE] 细项：各帧 merges 深等', mgEq, `${proj.formations.length} 帧`);
          step('[STATE] 细项：timeline blocks 深等', blkEq, `${proj.timeline.blocks.length} 块`);
          const r = await cmpShot('c10-reloaded');
          cmpStep(step, r);
          return;
        }

        // ===== reload 前半段 =====
        const proj = projNow();
        // 不变式 1/2/3：键一致 + merges 引用有效 + groups 引用有效（v3）
        const inv = (() => {
          const ids = proj.dancers.map(d => d.id).sort();
          let keysOK = true, mergesOK = true, groupsOK = true;
          const det = [], det2 = [], det3 = [];
          proj.formations.forEach((f, i) => {
            const ks = Object.keys(f.positions).sort();
            if (JSON.stringify(ks) !== JSON.stringify(ids)) { keysOK = false; det.push(`帧${i + 1}: ${ks.length} 键 vs ${ids.length} 舞者`); }
            const seen = new Set();
            for (const m of f.merges || []) {
              const key = m.a < m.b ? `${m.a}|${m.b}` : `${m.b}|${m.a}`;
              if (!proj.dancers.some(d => d.id === m.a) || !proj.dancers.some(d => d.id === m.b) || m.a === m.b || !M.UNIT_STYLES.includes(m.style) || seen.has(key)) {
                mergesOK = false; det2.push(`帧${i + 1}: 无效合并 ${JSON.stringify(m).slice(0, 80)}`);
              }
              seen.add(key);
            }
          });
          const seenG = new Set();
          for (const g of proj.groups || []) {
            if (!g || !g.id || seenG.has(g.id) || (g.memberIds || []).some(id => !ids.includes(id))) { groupsOK = false; det3.push(`无效编组 ${JSON.stringify(g).slice(0, 80)}`); }
            seenG.add(g && g.id);
          }
          return { keysOK, mergesOK, groupsOK, det: det.join('; ') || `全部 ${proj.formations.length} 帧键一致（${ids.length} 舞者）`, det2: det2.join('; ') || '全部 merges 引用有效', det3: det3.join('; ') || `全部 ${(proj.groups || []).length} 组引用有效` };
        })();
        step('[STATE] positions 键==dancers id（全部队形）', inv.keysOK, inv.det);
        step('[STATE] merges 引用有效（a/b 存在、a≠b、样式合法、无重复键）', inv.mergesOK, inv.det2);
        step('[STATE] groups 引用有效（v3：组 id 唯一、memberIds ⊆ dancers）', inv.groupsOK, inv.det3);

        // 不变式 3：undo 深度≤上限（70 次微调压测 60 层截断）
        const firstId = M.orderedDancers(proj)[0]; // v3：名册顺序首人
        store.mutate(p => { p.stage.snap = false; }); // 防御：前置动线若停在基线快照会带回 snap:true（0.5m 步进触发舞台钳制 → commit 去重跳过）
        store.setUI({ selection: [firstId] });
        await raf2();
        const snaps = [];
        for (let i = 0; i < 70; i++) {
          inp.key('ArrowRight');
          if (i === 9) await raf2();
          snaps.push(JSON.stringify(fmt().positions));
        }
        await raf2();
        const tipData = fmtData(); // 栈顶快照（压测后）—— undo→redo 往返应无损回到这里
        let depth = 0;
        while (store.canUndo() && depth < 200) { store.undo(); depth++; }
        const bottomOK = JSON.stringify(fmt().positions) === snaps[10];
        let redoN = 0;
        while (store.canRedo()) { store.redo(); redoN++; }
        await raf2();
        step('[STATE] undo 深度≤上限 60（70 次变更后栈满截断、最旧 10 条微调被丢弃）', depth <= 60 && bottomOK,
          `实测深度=${depth}（redo 复原 ${redoN} 层）底部=第 10 次微调快照: ${bottomOK}`);
        step('[STATE] redo 全部复原（往返无损回到栈顶）', redoN === depth && fmtData() === tipData, `redoN=${redoN} tip 深等=${fmtData() === tipData}`);

        // 不变式复核 + 深快照 → 显式落盘 → 交驱动 reload
        const pNow0 = projNow();
        const keysStillOK = pNow0.formations.every(f => sortedEq(Object.keys(f.positions), pNow0.dancers.map(d => d.id)));
        step('[STATE] 压测后键一致不变式仍成立', keysStillOK, '');
        await window.__fs.store.storage.putProject(pNow0); // 显式落盘（不等 400ms debounce）
        await sleep(200);
        const pNow = projNow();
        c10preCaptured = {
          projectId: pNow.id,
          title: pNow.meta.title,
          stable: stableStr(pNow),
          ids: pNow.dancers.map(d => d.id).sort(),
          pos: pNow.formations.map(f => JSON.parse(JSON.stringify(f.positions))),
          mg: pNow.formations.map(f => JSON.parse(JSON.stringify(f.merges || null))),
          blocks: JSON.parse(JSON.stringify(pNow.timeline.blocks)),
          undoDepth: depth,
        };
        step('[STATE] 已深快照并显式落盘（reload 后半段由驱动续跑）', !!c10preCaptured.stable, `快照 ${c10preCaptured.stable.length} chars`);
      },
    },
  ];

  // ---- 包装（C-10 不重建场景：延续 C-08 之后的会话数据）----
  // reload 后半段（opts.c10pre）只跑 C-10：其余动线若在 pass 2 重放，其 setup 会另建项目并
  // 改写 fs.lastProject，破坏「reload 后自动载入同一项目」的前置状态。
  const activeDefs = opts.c10pre ? defs.filter(d => d.id === 'C-10') : defs;
  const wrapped = activeDefs.map(d => ({
    id: d.id, name: d.name,
    async run(kitArgs) {
      const t = d.id === 'C-10' ? null : await setup(`L2 ${d.id}`);
      const mark = inLog.length;
      try {
        await d.run(t, kitArgs);
      } finally {
        d.log = inLog.slice(mark);
        d.snapAfter = t
          ? { positions: JSON.parse(JSON.stringify(fmt().positions)), merges: fmt().merges || [], selection: [...state().selection], hist: t.hist(), gesture: sv.gesture.state() }
          : { hist: `canUndo=${store.canUndo()} canRedo=${store.canRedo()} label="${store.undoLabel()}"`, gesture: sv.gesture.state(), note: 'C-10 延续会话数据（不重建场景）' };
      }
    },
  }));

  const results = await runCases(wrapped, shots, { failFast: true });
  for (let i = 0; i < results.length; i++) {
    results[i].log = activeDefs[i].log || [];
    results[i].snapAfter = activeDefs[i].snapAfter || null;
  }
  const r = cv.getBoundingClientRect();
  const meta = {
    part: 'desktop', build: window.__MAIN_BUILD, dpr: dprOf(),
    view: { ...sv.view }, rpx: 0.38 * sv.view.scale,
    canvas: { left: r.left, top: r.top, w: r.width, h: r.height },
    idsCount: (store.getState().project?.dancers || []).length,
  };
  return { part: 'desktop', cases: results, shots, meta, c10pre: c10preCaptured };
}

// =====================================================================
// mobile 部分：C-09（375×667 + hasTouch 独立 context）
// =====================================================================
async function runMobile(opts) {
  const shots = {};
  const env = makeEnv(shots, 'touch');
  const { ctx, store, M, sv, state, fmt, cv, inp, inLog, menu, clickMenuBtn, cmpShot, cmpStep, menuBorder, setup, unitHalves } = env;

  const defs = [
    {
      id: 'C-09a', name: 'C-09 移动端 375×667：无横向溢出 + 基础布局',
      async run(t, { step }) {
        const de = document.documentElement, bd = document.body;
        step('[STATE] 视口与视图（editor + 舞台 Tab）', window.innerWidth === 375 && window.innerHeight === 667 && state().view === 'editor' && document.body.dataset.mtab === 'stage',
          `viewport=${window.innerWidth}×${window.innerHeight} mtab=${document.body.dataset.mtab}`);
        const over = [...document.querySelectorAll('#editor-view *')]
          .filter(el => el.getBoundingClientRect().right > 375.5 && el.children.length === 0)
          .slice(0, 5)
          .map(el => `${el.tagName}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}@right=${Math.round(el.getBoundingClientRect().right)}`);
        step('[DOM] 无横向溢出（scrollWidth ≤ 375）', de.scrollWidth <= 375 && bd.scrollWidth <= 375,
          `html=${de.scrollWidth} body=${bd.scrollWidth}；溢出视口右缘的叶子元素：${over.join('; ') || '无'}`, 'DOM');
        const r = cv.getBoundingClientRect();
        const inVp = r.left >= -1 && r.top >= -1 && r.right <= 376 && r.bottom <= 668;
        step('[DOM] 舞台画布在视口内', inVp, `rect=(${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)})`, 'DOM');
        const rs = await cmpShot('c09a-layout');
        cmpStep(step, rs);
      },
    },
    {
      id: 'C-09b', name: 'C-09 移动端：T 组核心重放 D-01 选择 / D-06 拖拽 / D-07 驻留合并 / D-09 捏合缩放（复用 L1 T 用例）',
      async run(t, { step }) {
        const subs = ['D-01', 'D-06', 'D-07', 'D-09'];
        for (const id of subs) {
          const r = await runL1({ phase: 'T', only: id });
          for (const [k, v] of Object.entries(r.shots || {})) shots[`c09b-${id.toLowerCase()}-${k}`] = v;
          for (const c of r.cases) for (const s of c.steps) step(`[${c.id}] ${s.name}`, s.ok, s.detail, s.layer);
          if (r.cases.some(c => !c.ok)) { step(`[子动线] ${id} 失败 → 停止后续子集（失败即停）`, false, '', 'META'); break; }
        }
      },
    },
    {
      id: 'C-09c', name: 'C-09 移动端：右缘驻留合并 → 弹窗钳制视口/stage-wrap 内',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1];
        // 舞者放到右缘后台带 + 缩放 3× 平移到右缘工作位（迫使浮窗触发钳制）
        store.mutate(p => {
          const f = p.formations[state().formationIndex];
          f.positions[A] = { x: 13.0, y: 8, facing: 180 };
          f.positions[B] = { x: 13.8, y: 8, facing: 180 };
        });
        await raf2();
        const wrap = document.getElementById('stage-wrap').getBoundingClientRect();
        const s = sv.view.scale * 3;
        sv.view = { scale: s, ox: (wrap.width - 34) - 13.8 * s, oy: wrap.height * 0.45 - 8 * s };
        sv.clampPan();
        sv.requestDraw();
        await raf2();
        const pA = t.ptOf(A), pB = t.ptOf(B);
        step('[前置] 右缘工作位（B 距视口右缘 <40px、×3 缩放）', wrap.right - pB.x < 40 && sv.view.scale > t.rpx / 0.38 * 2.5,
          `B=(${Math.round(pB.x)},${Math.round(pB.y)}) wrap.right=${Math.round(wrap.right)} scale=${sv.view.scale.toFixed(1)}`);
        // 驻留合并（touch 时序同 D-07）
        const pts = [pA];
        for (let i = 1; i <= 3; i++) pts.push({ x: pA.x + (pB.x - pA.x) * i / 3, y: pA.y });
        const pid = await inp.down(pts[0].x, pts[0].y, { hw: 'touch' });
        for (let i = 1; i < pts.length; i++) { await sleep(30); await inp.move(pts[i].x, pts[i].y, { hw: 'touch', pid }); }
        await sleep(300);
        await inp.move(pts[3].x, pts[3].y, { hw: 'touch', pid });
        await sleep(1700);
        await inp.move(pts[3].x, pts[3].y, { hw: 'touch', pid });
        await raf2();
        const m = menu();
        await inp.up(pts[3].x, pts[3].y, { hw: 'touch', pid });
        await raf2();
        step('[DOM] 驻留合并浮窗出现', !!m && m.title === '合并为单元', m ? m.title : '无 .unit-menu', 'DOM');
        if (m) {
          const wr = document.getElementById('stage-wrap').getBoundingClientRect();
          const rr = m.rect;
          const inVp = rr.left >= -0.5 && rr.top >= -0.5 && rr.right <= window.innerWidth + 0.5 && rr.bottom <= window.innerHeight + 0.5;
          const inWrap = rr.left >= wr.left - 1 && rr.right <= wr.right + 1 && rr.top >= wr.top - 1 && rr.bottom <= wr.bottom + 1;
          const clampLeft = wr.width - rr.width - 4; // showUnitMenu 钳制公式（main.js L132）
          step('[DOM] 弹窗钳制在视口（375×667）内', inVp, `rect=(${Math.round(rr.left)},${Math.round(rr.top)})-(${Math.round(rr.right)},${Math.round(rr.bottom)})`, 'DOM');
          step('[DOM] 弹窗钳制在 stage-wrap 内且钳制公式生效（left=wrap宽-浮窗宽-4）', inWrap && Math.abs(rr.left - wr.left - clampLeft) <= 2,
            `left=${Math.round(rr.left)} 钳制期望=${Math.round(wr.left + clampLeft)}（右缘自由定位 300px 会被钳回）`, 'DOM');
          const b64 = await (window.__l1Shot || window.__l0Shot)();
          shots['c09c-menu'] = b64;
          const border = await menuBorder(b64, m);
          step('[SCREEN] 浮窗边框色可检出（≈#38bdf8）', border.d < 140, `最小单像素色距 ${border.d.toFixed(1)}@${JSON.stringify(border.at)}`, 'SCREEN');
          const btn = [...m.el.querySelectorAll('.um-btn')].find(b => b.textContent === '胶囊');
          const br = btn.getBoundingClientRect();
          await inp.click(br.left + br.width / 2, br.top + br.height / 2, { hw: 'touch' });
          await raf2();
        }
        const midC = t.mergePt(A, B);
        const halves = unitHalves('capsule', midC, t.rpx, t.col(A), t.col(B));
        const r2 = await cmpShot('c09c-merged');
        step('[STATE] 合并提交（capsule、两人收拢）', (fmt().merges || []).length === 1 && eq(t.posOf(A), t.posOf(B), 1e-9), `merges=${(fmt().merges || []).length}`);
        step('[PIXEL] 徽标在视口内呈示（双半色）', halves.sA.d < TH_COLOR && halves.sB.d < TH_COLOR, `A 半 ${halves.sA.d.toFixed(1)} / B 半 ${halves.sB.d.toFixed(1)}@(${Math.round(midC.x)},${Math.round(midC.y)})`, 'PIXEL');
        cmpStep(step, r2);
      },
    },
  ];

  const wrapped = defs.map(d => ({
    id: d.id, name: d.name,
    async run(kitArgs) {
      const t = await setup(`L2 ${d.id}`);
      const mark = inLog.length;
      try {
        await d.run(t, kitArgs);
      } finally {
        d.log = inLog.slice(mark);
        d.snapAfter = { positions: JSON.parse(JSON.stringify(fmt().positions)), merges: fmt().merges || [], selection: [...state().selection], hist: t.hist(), gesture: sv.gesture.state() };
      }
    },
  }));
  const results = await runCases(wrapped, shots, { failFast: true });
  for (let i = 0; i < results.length; i++) {
    results[i].log = defs[i].log || [];
    results[i].snapAfter = defs[i].snapAfter || null;
  }
  const r = cv.getBoundingClientRect();
  const meta = {
    part: 'mobile', build: window.__MAIN_BUILD, dpr: dprOf(),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    view: { ...sv.view }, rpx: 0.38 * sv.view.scale,
    canvas: { left: r.left, top: r.top, w: r.width, h: r.height },
    idsCount: (store.getState().project?.dancers || []).length,
  };
  return { part: 'mobile', cases: results, shots, meta };
}
