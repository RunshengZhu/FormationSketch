// L0 测试仪器（v3）：环境门禁 G2-G6 + 注入器元测试 I1-I10 + 像素探针 P1-P4。
// （G1 的"单标签/服务器 200/磁盘 build 一致"由 lab 驱动脚本在 node 侧判定；本文件补 build-tag 读取证据。）
// v3（round14）：产品语义裁定——pairs 退役（orderedDancers 无 unit 参数）、单元样式收敛为
//   capsule/single（P3 改两样式：single=中点单圆 + 1.45r 虚线环强调色 + ×2 角标）。
// round11（需求1）：×2 角标移除（保留虚线环）；round22 仪器同步：P3 角标断言改「原角标圆心
//   3×3 非强调色」口径——旧「角标区最小单像素色距<TH_RING」采样带与保留虚线环相交 → 恒绿假绿；
//   新口径双向验证（git stash 旧实现 live：角标存在圆心色距 72.4<90 绿 / 移除后 170.2≥90 红；
//   旁路参照 drawScene±旧实心盘自检内置 P3 随轮复核）。
// 纪律：
//   - 场景搭建只走 store/M 公共 API（createNewProject 等）：12 名舞者（M/F 交替生成）两行布置，
//     positions 键 = 真实 dancer id，禁止改名键（G2 红线，v1 仪器 page-matrix.js 在此违规）。
//   - 本文件属测试仪器，被测应用代码（js/*、index.html、css/*）零改动。
// 运行前提：window.__fs（main.js 测试钩子）、window.__input（page-injector.js v2）、
//           window.__l0Shot（lab 驱动注入：page.screenshot → base64）。
// 入口：await import('/tests/page-l0.js') → await runL0()
//       返回 { gates, injectors, pixels, shots, meta }，每项 { id, ok, evidence, steps }。
// 探针/比对/用例引擎公共实现已抽到 tests/page-kit.js（L0/L1 共用）。
import {
  raf2, sleep, TH_PRESENT, TH_COLOR, TH_HL, TH_HL_DELTA, TH_BG, SCREEN_TOL, SCREEN_RATIO,
  makeCtx, dprOf, mean3x3, dist, rgb, hex, ringMinDist, innerMinDist, minDistOver, gridRegion, px1,
  decodeShot, screenCompare, shotSample, leakCheck, runCases,
} from './page-kit.js';

// =====================================================================
// 主入口
// =====================================================================
export async function runL0() {
  const shots = {};
  const ctx = makeCtx();
  const { store, M, sv, state, fmt, toClient } = ctx;

  // ---- 场景搭建：真实 API 建 12 名舞者（M/F 交替）两行布置，真实 id，不改名键 ----
  store.createNewProject({ title: 'L0 层', pairs: 6 });
  store.setUI({ selection: [], multiSelect: false, editMode: true, showFacingHandle: false });
  sv.resetView(); // 视图复位 = fit
  await raf2();
  const ids = M.orderedDancers(state().project); // 真实 dancer id（名册顺序 = M/F 交替）
  const dancerOf = id => state().project.dancers.find(d => d.id === id);
  const posOf = id => ({ ...fmt().positions[id] });
  const ptOf = id => { const p = posOf(id); return toClient(p.x, p.y); };
  const rpx = 0.38 * sv.view.scale; // 舞者圆半径（CSS px）
  const blankPt = toClient(5.85, 12.45); // 空白采样点（远离舞者/网格线/中心线）
  const meta = {
    url: location.href, build: window.__MAIN_BUILD,
    tag: document.getElementById('build-tag')?.textContent ?? null,
    view: { ...sv.view }, dpr: dprOf(), rpx,
    canvas: (() => { const r = sv.canvas.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, backing: { w: sv.canvas.width, h: sv.canvas.height } }; })(),
    ids, roles: { A: dancerOf(ids[0])?.role, B: dancerOf(ids[1])?.role, D: dancerOf(ids[3])?.role },
    colors: { A: dancerOf(ids[0])?.color, B: dancerOf(ids[1])?.color },
    selection: state().selection, snap: state().project.stage.snap,
  };
  const ROLE_M = hex(meta.colors.A || '#3b82f6'), ROLE_F = hex(meta.colors.B || '#ec4899'), HL = hex('#0ea5e9');

  // ============ G 组门禁 ============
  const gates = [];

  // G2 positions 键 === dancers id（禁孤儿键/改名键）
  {
    const ks = Object.keys(fmt().positions).sort();
    const ds = [...ids].sort();
    const orphan = ks.filter(k => !ds.includes(k));
    const missing = ds.filter(d => !ks.includes(d));
    gates.push({
      id: 'G2', ok: ks.length === 12 && ks.join() === ds.join(),
      evidence: `dancers=12, positions 键数=${ks.length}, 孤儿键=[${orphan}], 缺失=[${missing}], 键===id 排序一致=${ks.join() === ds.join()}, 样例键="${ks[0]}"`,
      steps: [{ name: '键===id', ok: ks.join() === ds.join(), detail: `${ks.length} 键 vs ${ds.length} id` }],
    });
  }

  // G3 全部舞者 client 坐标 ∈ 画布矩形+8px
  {
    const r = sv.canvas.getBoundingClientRect(), pad = 8;
    const pts = ids.map(id => ({ id, p: ptOf(id) }));
    const out = pts.filter(({ p }) => p.x < r.left - pad || p.x > r.right + pad || p.y < r.top - pad || p.y > r.bottom + pad);
    gates.push({
      id: 'G3', ok: out.length === 0,
      evidence: `画布 rect=(${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}×${Math.round(r.height)}), 舞者 12 点全部视口内, 越界=[${out.map(o => o.id).join(',')}]`,
      steps: [{ name: '12/12 在画布+8px 内', ok: out.length === 0, detail: out.map(o => o.id).join(',') || '全部通过' }],
    });
  }

  // G5 初始手势机零残留
  {
    const leak = leakCheck();
    gates.push({ id: 'G5', ok: leak.ok, evidence: leak.detail, steps: [{ name: '初始零残留', ok: leak.ok, detail: leak.detail }] });
  }

  // G4 合成器健康：SCREEN 自动比对（§0.1）；G6 基线截图归档（同一帧）
  {
    const cmp = await screenCompare();
    shots.baseline = cmp.b64;
    const ok = cmp.best < SCREEN_RATIO;
    gates.push({
      id: 'G4', ok,
      evidence: `舞台区 ${cmp.region.w}×${cmp.region.h}px 逐像素比对（通道容差${SCREEN_TOL}）：差异比 raw=${(cmp.raw * 100).toFixed(4)}%, best±1px=${(cmp.best * 100).toFixed(4)}%@off[${cmp.bestOff}] < 0.5% → 屏幕=位图`,
      steps: [{ name: '差异比<0.5%', ok, detail: `raw=${(cmp.raw * 100).toFixed(4)}% best=${(cmp.best * 100).toFixed(4)}%` }],
    });
    gates.push({
      id: 'G6', ok: !!cmp.b64 && cmp.b64.length > 1000,
      evidence: `基线全页截图已归档（PNG base64 ${((cmp.b64.length) / 1024).toFixed(0)}KB，截图尺寸 ${cmp.shotSize.w}×${cmp.shotSize.h}）→ out/<roundTag>/baseline.png（由 lab 驱动按 roundTag 落盘）`,
      steps: [{ name: '基线归档', ok: true, detail: 'baseline.png' }],
    });
  }

  // ============ I 组 · 注入器元测试 ============
  // 临时事件记录仪：canvas + 覆盖层 fixture（测试自己搭建的遮挡层，非应用代码）
  const cv = sv.canvas;
  const canvasLog = [];
  const unbinds = [];
  const recEv = e => canvasLog.push({
    type: e.type, target: e.target.id || e.target.tagName, pointerType: e.pointerType,
    id: e.pointerId, primary: e.isPrimary, x: Math.round(e.clientX), y: Math.round(e.clientY),
    detail: e.detail, def: e.defaultPrevented, deltaY: e.deltaY, t: Math.round(performance.now()),
  });
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel'])
    cv.addEventListener(t, recEv), unbinds.push(() => cv.removeEventListener(t, recEv));
  const docLog = [];
  const recDoc = e => docLog.push({ type: e.type, key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, target: e.target.id || e.target.tagName, t: Math.round(performance.now()) });
  document.addEventListener('keydown', recDoc); unbinds.push(() => document.removeEventListener('keydown', recDoc));

  let fixture = null;
  function installFixture(pt) {
    const el = document.createElement('div');
    el.id = 'l0-fixture';
    el.style.cssText = `position:fixed;left:${pt.x - 40}px;top:${pt.y - 40}px;width:80px;height:80px;z-index:99999;background:rgba(255,0,0,.35);border:1px solid #f00;`;
    const log = [];
    const rec = e => log.push({ type: e.type, target: e.target.id, pointerType: e.pointerType, id: e.pointerId, primary: e.isPrimary, detail: e.detail, t: Math.round(performance.now()) });
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick']) el.addEventListener(t, rec);
    document.body.append(el);
    fixture = { el, log };
    return fixture;
  }
  function removeFixture() { if (fixture) { fixture.el.remove(); fixture = null; } }
  const fmtLog = (log, from = 0) => JSON.stringify(log.slice(from));
  const marker = () => canvasLog.length;

  const ipt = ctx.toClient(5.85, 12.45);  // fixture 覆盖点（画布空白区）
  const b1 = ctx.toClient(3.2, 12.4);     // 空白点 1
  const b2 = ctx.toClient(7.6, 12.45);    // 空白点 2

  const injectors = await runCases([
    {
      id: 'I1', name: 'click 事件链完整性',
      async run({ step }) {
        installFixture(ipt);
        const from = fixture.log.length;
        await window.__input.click(ipt.x, ipt.y);
        const evs = fixture.log.slice(from).map(e => e.type);
        const want = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        step('链完整且有序', JSON.stringify(evs) === JSON.stringify(want), `fixture 收到 [${evs}] 期望 [${want}]`);
        step('target===命中元素', fixture.log.slice(from).every(e => e.target === 'l0-fixture'), fmtLog(fixture.log, from));
      },
    },
    {
      id: 'I2', name: '遮挡命中：覆盖层压画布时注入点按遮挡层',
      async run({ step }) {
        if (!fixture) installFixture(ipt);
        const fFrom = fixture.log.length, cFrom = marker();
        await window.__input.click(ipt.x, ipt.y);
        const fEvs = fixture.log.slice(fFrom).map(e => e.type);
        const cEvs = canvasLog.slice(cFrom).filter(e => !e.type.startsWith('__'));
        step('事件落在遮挡层', fEvs.length === 5, `fixture 收到 [${fEvs.join(',')}]`);
        step('画布零泄漏', cEvs.length === 0, `canvas 收到 [${cEvs.map(e => e.type).join(',') || '无'}]`);
        step('hit() 返回遮挡层', window.__input.hit(ipt.x, ipt.y).id === 'l0-fixture', `hit=${window.__input.hit(ipt.x, ipt.y).id}`);
      },
    },
    {
      id: 'I3', name: '指针捕获语义：move/up 穿过遮挡层仍到达画布',
      async run({ step }) {
        const cFrom = marker(), fFrom = fixture ? fixture.log.length : 0;
        await window.__input.down(b1.x, b1.y);              // 按下画布（空白，mouse）
        await window.__input.move(ipt.x, ipt.y);            // 物理坐标移到 fixture 覆盖点
        await window.__input.up(ipt.x, ipt.y);              // 抬起于遮挡层上
        const evs = canvasLog.slice(cFrom);
        const at = (type, tgt) => evs.find(e => e.type === type && e.target === tgt && e.x === Math.round(ipt.x) && e.y === Math.round(ipt.y));
        step('move 到达画布（捕获）', !!at('pointermove', 'stage-canvas'), evs.map(e => `${e.type}@${e.target}(${e.x},${e.y})`).join(' → '));
        step('up 到达画布（捕获）', evs.some(e => e.type === 'pointerup' && e.target === 'stage-canvas'), '');
        step('遮挡层未截胡 pointer', !(fixture?.log.slice(fFrom) || []).some(e => e.type.startsWith('pointer')), `fixture 收到 [${(fixture?.log.slice(fFrom) || []).map(e => e.type).join(',') || '无'}]`);
      },
    },
    {
      id: 'I4', name: '派生 click 归属：click.target === downEl（不在抬起时重命中）',
      async run({ step }) {
        const fFrom = fixture ? fixture.log.length : 0;
        const cFrom = marker();
        await window.__input.down(ipt.x, ipt.y);            // 按下于 fixture（非画布，无捕获）
        await window.__input.move(b1.x, b1.y);              // 拖到画布空白点
        await window.__input.up(b1.x, b1.y);                // 抬起于画布
        const fEvs = fixture.log.slice(fFrom);
        const cEvs = canvasLog.slice(cFrom);
        step('click 归属 downEl(fixture)', fEvs.some(e => e.type === 'click'), `fixture 收到 [${fEvs.map(e => e.type).join(',')}]`);
        step('up 落在抬起点命中元素', cEvs.some(e => e.type === 'pointerup'), `canvas 收到 [${cEvs.map(e => e.type).join(',')}]`);
        step('设计语义确认', fEvs.filter(e => e.type === 'click').length === 1 && !cEvs.some(e => e.type === 'click'), 'click×1 于 fixture，canvas 无 click');
      },
    },
    {
      id: 'I5', name: '触摸多指 id：每指独立、首指 isPrimary、结束归零',
      async run({ step }) {
        removeFixture();
        const cFrom = marker();
        const idA = await window.__input.down(b1.x, b1.y, { hw: 'touch' });
        const idB = await window.__input.down(b2.x, b2.y, { hw: 'touch' });
        const downs = canvasLog.slice(cFrom).filter(e => e.type === 'pointerdown');
        step('每指独立 id', idA !== idB && downs.map(e => e.id).join() === `${idA},${idB}`, `ids=${idA},${idB} 事件=[${downs.map(e => e.id).join(',')}]`);
        step('首指 isPrimary', downs[0]?.primary === true && downs[1]?.primary === false, `primary=[${downs.map(e => e.primary)}]`);
        step('pointerType=touch', downs.every(e => e.pointerType === 'touch'), `[${downs.map(e => e.pointerType)}]`);
        await window.__input.up(b1.x, b1.y, { hw: 'touch', pid: idA });
        await window.__input.up(b2.x, b2.y, { hw: 'touch', pid: idB });
        const ups = canvasLog.slice(cFrom).filter(e => e.type === 'pointerup');
        step('结束归零', window.__input.activeCount === 0 && window.__fs.stageView().gesture.debugPointers().length === 0, `inj=${window.__input.activeCount} app=[${window.__fs.stageView().gesture.debugPointers()}] ups=${ups.length}`);
      },
    },
    {
      id: 'I6', name: '双击派生：两次 click <500ms → dblclick',
      async run({ step }) {
        const cFrom = marker();
        const t0 = performance.now();
        await window.__input.dblclick(b1.x, b1.y);
        const evs = canvasLog.slice(cFrom);
        const clicks = evs.filter(e => e.type === 'click'), dbl = evs.filter(e => e.type === 'dblclick');
        step('click×2', clicks.length === 2, `clicks=${clicks.length} 耗时=${Math.round(performance.now() - t0)}ms`);
        step('dblclick detail=2', dbl.length === 1 && dbl[0].detail === 2, dbl.length ? `detail=${dbl[0].detail}` : '未收到');
      },
    },
    {
      id: 'I7', name: '长按时序：press(ms) 实际持隔 ≥ ms（测量验证）',
      async run({ step }) {
        const cFrom = marker();
        const MS = 700;
        const wall0 = performance.now();
        await window.__input.press(b1.x, b1.y, MS);
        const wall = performance.now() - wall0;
        const evs = canvasLog.slice(cFrom);
        const dn = evs.find(e => e.type === 'pointerdown'), up = evs.find(e => e.type === 'pointerup');
        const held = dn && up ? up.t - dn.t : -1;
        step(`持隔≥${MS}ms（事件测量）`, held >= MS, `事件持隔=${held}ms（挂钟=${Math.round(wall)}ms）`);
        step('单次 down/up', evs.filter(e => e.type === 'pointerdown').length === 1 && evs.filter(e => e.type === 'pointerup').length === 1, '');
      },
    },
    {
      id: 'I8', name: '键盘派发：keydown 到达 document 且修饰键正确',
      async run({ step }) {
        const dFrom = docLog.length;
        window.__input.key('F15', { ctrl: true, shift: true });
        const evs = docLog.slice(dFrom);
        step('到达 document', evs.length === 1, `收到 [${evs.map(e => e.type + '@' + e.target).join(',') || '无'}]`);
        step('key 与修饰键正确', evs[0] && evs[0].key === 'F15' && evs[0].ctrl === true && evs[0].shift === true, evs[0] ? JSON.stringify(evs[0]) : '');
      },
    },
    {
      id: 'I9', name: '滚轮派发：wheel 到达画布且 deltaY 正确',
      async run({ step }) {
        const cFrom = marker();
        const s0 = sv.view.scale;
        window.__input.wheel((cv.getBoundingClientRect().left + cv.getBoundingClientRect().right) / 2, (cv.getBoundingClientRect().top + cv.getBoundingClientRect().bottom) / 2, -240);
        await sleep(60);
        const evs = canvasLog.slice(cFrom).filter(e => e.type === 'wheel');
        step('到达画布', evs.length === 1, evs.length ? `target=${evs[0].target}` : '未收到');
        step('deltaY 正确（−240）', evs[0] && evs[0].deltaY === -240, `deltaY=${evs[0]?.deltaY} defaultPrevented=${evs[0]?.def}`);
        const k = sv.view.scale / s0;
        step('应用响应缩放≈×1.33', Math.abs(k - 1.334) < 0.05, `scale ${s0.toFixed(2)}→${sv.view.scale.toFixed(2)} (×${k.toFixed(3)})`);
        sv.resetView(); await sleep(40);
      },
    },
    {
      id: 'I10', name: '三硬件 switch：mouse/touch/pen pointerType 正确传递',
      async run({ step }) {
        const cFrom = marker();
        await window.__input.click(b1.x, b1.y, { hw: 'mouse' });
        await window.__input.click(b2.x, b2.y, { hw: 'touch' });
        await window.__input.click(ipt.x, ipt.y, { hw: 'pen' });
        const downs = canvasLog.slice(cFrom).filter(e => e.type === 'pointerdown');
        const got = downs.map(e => `${e.pointerType}#${e.id}(primary=${e.primary})`);
        step('pointerType 三类正确', downs.map(e => e.pointerType).join() === 'mouse,touch,pen', `收到 [${got.join(', ')}]`);
        step('id 策略（mouse=1,pen=2,touch≥21）', downs[0].id === 1 && downs[2].id === 2 && downs[1].id >= 21, `ids=[${downs.map(e => e.id).join(',')}]`);
      },
    },
  ], shots).then(rs => { removeFixture(); return rs; });
  for (const u of unbinds) u();

  // ============ P 组 · 像素探针 ============
  const cvCtx = cv.getContext('2d');
  const pixels = await runCases([
    {
      id: 'P1', name: '背景基线采样',
      async run({ step }) {
        const base = mean3x3(cv, blankPt.x, blankPt.y);
        runL0._baseline = base;
        const bgRef = hex('#f8fafc');
        step('空白区基线已记录', true, `blank(${Math.round(blankPt.x)},${Math.round(blankPt.y)}) → ${rgb(base)}（与舞台底色 #f8fafc 色距 ${dist(base, bgRef).toFixed(1)}）`);
        step('采样点确为舞台底色', dist(base, bgRef) < 30, `色距=${dist(base, bgRef).toFixed(1)} < 30`);
      },
    },
    {
      id: 'P2', name: '舞者色标：男=蓝 / 女=粉 / 选中高亮',
      async run({ step }) {
        const base = runL0._baseline;
        const idM = ids[0], idF = ids[1], idF2 = ids[3];
        const dM = dancerOf(idM), dF = dancerOf(idF);
        step('布置为 [STATE] 证据', dM.role === 'M' && dF.role === 'F', `dancer[0].role=${dM.role} color=${dM.color}; dancer[1].role=${dF.role} color=${dF.color}`);
        const pM = ptOf(idM), pF = ptOf(idF), pF2 = ptOf(idF2);
        const mM = mean3x3(cv, pM.x, pM.y), mF = mean3x3(cv, pF.x, pF.y);
        step('男圆心可检出（≠基线）', dist(mM, base) > TH_PRESENT, `M 圆心 ${rgb(mM)} 距基线 ${dist(mM, base).toFixed(1)} > ${TH_PRESENT}`);
        const inM = innerMinDist(cv, pM.x, pM.y, rpx, ROLE_M);
        step('男=蓝 #3b82f6', inM.d < TH_COLOR, `0.55r 8 向最优采样距 ${dM.color} ${inM.d.toFixed(1)} < ${TH_COLOR}（圆心 3×3 含白色编号/朝向指针显 ${rgb(mM)}）`);
        step('女圆心可检出（≠基线）', dist(mF, base) > TH_PRESENT, `F 圆心 ${rgb(mF)} 距基线 ${dist(mF, base).toFixed(1)}`);
        const inF = innerMinDist(cv, pF.x, pF.y, rpx, ROLE_F);
        step('女=粉 #ec4899', inF.d < TH_COLOR, `0.55r 8 向最优采样距 ${dF.color} ${inF.d.toFixed(1)} < ${TH_COLOR}`);
        // 选中高亮
        const hlPreM = ringMinDist(cv, pM.x, pM.y, rpx, HL);
        await window.__input.click(pM.x, pM.y);
        await raf2();
        step('点击选中 [STATE]', JSON.stringify(state().selection) === JSON.stringify([idM]), `selection=[${state().selection.map(i => i.slice(0, 8) + '…')}] 期望 [${idM.slice(0, 8) + '…'}]`);
        const hlPost = ringMinDist(cv, pM.x, pM.y, rpx, HL);
        step('选中高亮 #0ea5e9 出现在圆环', hlPost.d < TH_HL && hlPreM.d - hlPost.d >= TH_HL_DELTA,
          `选中后最小色距 ${hlPost.d.toFixed(1)}@${JSON.stringify(hlPost.at)}（选中前 ${hlPreM.d.toFixed(1)}，下降 ${(hlPreM.d - hlPost.d).toFixed(1)} ≥ ${TH_HL_DELTA}），阈值 ${TH_HL}`);
        const hlOther = ringMinDist(cv, pF2.x, pF2.y, rpx, HL);
        step('未选中者无高亮', hlOther.d >= TH_HL, `F2 圆环最小色距 ${hlOther.d.toFixed(1)} ≥ ${TH_HL}`);
        shots['p2-selected'] = await window.__l0Shot();
        await window.__input.click(blankPt.x, blankPt.y); // 点空白取消
        await raf2();
        const hlAfter = ringMinDist(cv, pM.x, pM.y, rpx, HL);
        step('取消后高亮消失 [STATE]', state().selection.length === 0 && hlAfter.d >= TH_HL, `selection=[${state().selection}] 圆环最小色距 ${hlAfter.d.toFixed(1)}`);
      },
    },
    {
      id: 'P3', name: '单元两样式：capsule 双半色 / single=单圆+虚线环强调色（×2 角标已移除）（M.addMerge 建立）',
      async run({ step }) {
        const base = runL0._baseline;
        const idA = ids[0], idB = ids[1];
        const origA = posOf(idA), origB = posOf(idB);
        const origPtA = toClient(origA.x, origA.y);
        const midM = (() => { const mx = (origA.x + origB.x) / 2, my = (origA.y + origB.y) / 2; return toClient(mx, my); })();
        // v3 主题强调色（single 样式虚线环/角标）：stage.js drawUnitSymbol —— dark ? '#38bdf8' : '#0284c7'
        const ACC2 = hex(state().theme === 'dark' ? '#38bdf8' : '#0284c7');
        const TH_RING = 90; // 虚线环单像素扫阈值（1~2px 线条 AA 边缘，单像素取最小色距）；亦作角标圆心「非强调色」阈值
        // 虚线环扫描带：半径 1.45r 圆环 ±1.5px、5° 步长的单像素候选点
        const ringBand = (cx, cy, R) => {
          const pts = [];
          for (let a = 0; a < 360; a += 5) for (const rr of [R - 1.5, R - 0.5, R + 0.5, R + 1.5])
            pts.push([cx + Math.cos(a * Math.PI / 180) * rr, cy + Math.sin(a * Math.PI / 180) * rr]);
          return pts;
        };
        const pxLive = (x, y) => px1(cv, x, y) || { r: 255, g: 255, b: 255 };
        // 参照渲染器：直呼 __fs.drawScene（显式传 merges）画进离屏画布 —— 用于标定仪器采样点、
        // 并与实时舞台（StageView.draw 路径）区分责任。withBadge=true 时按 round11 前旧实现
        // （stage.js 被删 10 行中的实心盘：acc 填充 r=max(5,0.5r₀)@(cx+1.15r₀,cy−1.15r₀)，描边/
        // ×2 文字不落在圆心 3×3 口径内）补画角标 —— 供「角标存在→绿」的旁路有效性自检。
        const rect = cv.getBoundingClientRect();
        const mkRef = (withBadge = false) => {
          const oc = document.createElement('canvas');
          oc.width = cv.width; oc.height = cv.height;
          const octx = oc.getContext('2d', { willReadFrequently: true });
          const d = dprOf();
          octx.setTransform(d, 0, 0, d, 0, 0);
          ctx.fs.drawScene(octx, { x: 0, y: 0, w: rect.width, h: rect.height }, state().project, fmt().positions, {
            view: sv.view, merges: fmt().merges || [], selection: new Set(), showGrid: true, theme: state().theme,
          });
          if (withBadge) {
            octx.beginPath();
            octx.arc(midM.x - rect.left + 1.15 * rpx, midM.y - rect.top - 1.15 * rpx, Math.max(5, rpx * 0.5), 0, Math.PI * 2);
            octx.fillStyle = state().theme === 'dark' ? '#38bdf8' : '#0284c7';
            octx.fill();
          }
          const img = octx.getImageData(0, 0, oc.width, oc.height);
          const sample = (clientX, clientY) => {
            const px = Math.round((clientX - rect.left) * d), py = Math.round((clientY - rect.top) * d);
            let r = 0, g = 0, b = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const x = px + dx, y = py + dy;
              if (x < 0 || y < 0 || x >= oc.width || y >= oc.height) continue;
              const i = (y * oc.width + x) * 4;
              r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
            }
            return { r: r / n, g: g / n, b: b / n };
          };
          return { sample, url: oc.toDataURL('image/png') };
        };
        for (const style of ['capsule', 'single']) {
          store.mutate(p => {
            const f = p.formations[state().formationIndex];
            M.addMerge(f, idA, idB, style);
            M.collapseUnit(f, idA, idB);
          });
          await raf2();
          const merge = fmt().merges?.find(m => (m.a === idA && m.b === idB) || (m.b === idA && m.a === idB));
          const sceneMerges = (sv.getScene().merges || []).map(m => m.style).join(',') || '空';
          step(`${style} 合并已建立且 stageScene 可见 [STATE]`, !!merge && merge.style === style && sceneMerges.includes(style), `store.merges=[${(fmt().merges || []).map(m => m.style).join(',')}] getScene().merges=[${sceneMerges}]`);
          const zh = { capsule: '胶囊', single: '单编号' }[style];
          if (style === 'capsule') {
            // 胶囊：A/B 两个半区的内部候选点（避开描边；区域内含文字但取最小色距可穿透）
            const w = 3.4 * rpx, hh = 1.5 * rpx;
            const regions = [
              { n: '左半=A色', pts: gridRegion(midM.x - w / 2 + 2.5, midM.y - hh / 2 + 2.5, midM.x - 2, midM.y + hh / 2 - 2.5), c: ROLE_M },
              { n: '右半=B色', pts: gridRegion(midM.x + 2, midM.y - hh / 2 + 2.5, midM.x + w / 2 - 2.5, midM.y + hh / 2 - 2.5), c: ROLE_F },
            ];
            const ref = mkRef();
            shots['p3-capsule-ref'] = ref.url.split(',')[1];
            for (const q of regions) {
              const refMin = minDistOver(ref.sample, q.c, q.pts);
              step(`${zh}·参照渲染(drawScene+merges)·${q.n}`, refMin.d < TH_COLOR, `${refMin.n} 点中最小色距 ${refMin.d.toFixed(1)} < ${TH_COLOR}`);
            }
            for (const q of regions) {
              const liveMin = minDistOver((x, y) => mean3x3(cv, x, y), q.c, q.pts);
              step(`${zh}·实时舞台·${q.n}`, liveMin.d < TH_COLOR, `${liveMin.n} 点中最小色距 ${liveMin.d.toFixed(1)} < ${TH_COLOR}`);
            }
          } else {
            // 单编号：中点仍为一个圆（半径同单人；填充=编号较小成员色，此处 m.a=ids[0]）
            // + 1.45r 虚线外环（主题强调色）。round11 需求1：×2 角标已移除（保留虚线环）。
            const ref = mkRef();
            shots['p3-single-ref'] = ref.url.split(',')[1];
            const disc = gridRegion(midM.x - rpx * 0.55, midM.y - rpx * 0.55, midM.x + rpx * 0.55, midM.y + rpx * 0.55, 2);
            const refFill = minDistOver(ref.sample, ROLE_M, disc);
            step(`${zh}·参照渲染(drawScene+merges)·中点单圆=A色`, refFill.d < TH_COLOR, `圆盘区最小色距 ${refFill.d.toFixed(1)} < ${TH_COLOR}`);
            const liveFill = minDistOver((x, y) => mean3x3(cv, x, y), ROLE_M, disc);
            step(`${zh}·实时舞台·中点单圆=A色`, liveFill.d < TH_COLOR, `圆盘区最小色距 ${liveFill.d.toFixed(1)} < ${TH_COLOR}`);
            const ringMin = minDistOver(pxLive, ACC2, ringBand(midM.x, midM.y, 1.45 * rpx));
            step(`${zh}·实时舞台·1.45r 虚线环=主题强调色`, ringMin.d < TH_RING, `环带最小单像素色距 ${ringMin.d.toFixed(1)}@${JSON.stringify(ringMin.at)} < ${TH_RING}（ACC=${state().theme === 'dark' ? '#38bdf8' : '#0284c7'}）`);
            // round22 仪器修正（角标口径）：旧断言「角标区最小色距<TH_RING」采样带与保留虚线环相交 →
            // 角标移除后仍恒绿（假绿）。改口径=原角标圆心 3×3 均色：实心角标存在时圆心即强调色
            // （stash 旧实现 live 实测色距 72.4 < 90 绿），移除后圆心=背景（实测 170.2 ≥ 90 红）。
            const bc = { x: midM.x + 1.15 * rpx, y: midM.y - 1.15 * rpx };
            const bcMean = mean3x3(cv, bc.x, bc.y);
            const bcD = dist(bcMean, ACC2);
            const refNoB = dist(ref.sample(bc.x, bc.y), ACC2), refB = dist(mkRef(true).sample(bc.x, bc.y), ACC2);
            step(`${zh}·仪器自检·旁路参照（+角标→绿 / −角标→红）`, refB < TH_RING && refNoB >= TH_RING,
              `drawScene 真渲染补画旧实心盘后圆心色距 ${refB.toFixed(1)} < ${TH_RING}；不补画（现状几何）${refNoB.toFixed(1)} ≥ ${TH_RING}`);
            step(`${zh}·实时舞台·×2 角标已移除（圆心 3×3 非强调色）`, bcD >= TH_RING,
              `原角标圆心(${Math.round(bc.x)},${Math.round(bc.y)}) 3×3 ${rgb(bcMean)} 距强调色 ${bcD.toFixed(1)} ≥ ${TH_RING}（距基线 ${dist(bcMean, base).toFixed(1)}）`);
          }
          const oldA = mean3x3(cv, origPtA.x, origPtA.y);
          step(`${zh}·原圆心A回到背景`, dist(oldA, base) < TH_BG, `原圆心 ${rgb(oldA)} 距基线 ${dist(oldA, base).toFixed(1)} < ${TH_BG}（无独立圆点色）`);
          shots['p3-' + style] = await window.__l0Shot();
          // 拆掉本次样式再换下一个（也验证 removeMerge 生效）
          store.mutate(p => { M.removeMerge(p.formations[state().formationIndex], idA, idB); });
          await raf2();
        }
        store.mutate(p => {
          const f = p.formations[state().formationIndex];
          f.positions[idA] = origA; f.positions[idB] = origB;
        });
        await raf2();
        step('现场已还原 [STATE]', !fmt().merges?.length && Math.abs(posOf(idA).x - origA.x) < 1e-9, `merges=${(fmt().merges || []).length}, posA=(${posOf(idA).x},${posOf(idA).y})`);
      },
    },
    {
      id: 'P4', name: '像素探针 vs 截图交叉验证',
      async run({ step }) {
        const base = runL0._baseline;
        const idM = ids[0];
        const pM = ptOf(idM);
        await window.__input.click(pM.x, pM.y); // 注入器点击选中
        await raf2();
        // 实时位图结论
        const liveMean = mean3x3(cv, pM.x, pM.y);
        const liveHL = ringMinDist(cv, pM.x, pM.y, rpx, HL);
        const liveOK = dist(liveMean, base) > TH_PRESENT && liveHL.d < TH_HL;
        // 截图回注
        const cmp = await screenCompare();
        shots['p4-cross'] = cmp.b64;
        const { img, w } = await decodeShot(cmp.b64);
        const shotMean = shotSample(img, w, pM.x, pM.y);
        let shotHL = { d: Infinity };
        for (let a = 0; a < 360; a += 15) for (const rr of [rpx - 1, rpx, rpx + 1]) {
          const col = shotSample(img, w, pM.x + Math.cos(a * Math.PI / 180) * rr, pM.y + Math.sin(a * Math.PI / 180) * rr);
          const d = dist(col, HL);
          if (d < shotHL.d) shotHL = { d };
        }
        const agree = dist(liveMean, shotMean) < 8 && Math.abs(liveHL.d - shotHL.d) < 25;
        step('SCREEN 区域差异<0.5%', cmp.best < SCREEN_RATIO, `raw=${(cmp.raw * 100).toFixed(4)}% best=${(cmp.best * 100).toFixed(4)}%`);
        step('PIXEL 结论（实时位图）', liveOK, `圆心距基线 ${dist(liveMean, base).toFixed(1)}, 高亮最小色距 ${liveHL.d.toFixed(1)}`);
        step('同结论在截图中复现', dist(shotMean, base) > TH_PRESENT && shotHL.d < TH_HL, `截图圆心 ${rgb(shotMean)} 距基线 ${dist(shotMean, base).toFixed(1)}, 高亮最小色距 ${shotHL.d.toFixed(1)}`);
        step('两套证据一致', agree, `|圆心差|=${dist(liveMean, shotMean).toFixed(1)}, |高亮差|=${Math.abs(liveHL.d - shotHL.d).toFixed(1)}`);
        await window.__input.click(blankPt.x, blankPt.y);
        await raf2();
      },
    },
  ], shots);

  return { gates, injectors, pixels, shots, meta };
}
