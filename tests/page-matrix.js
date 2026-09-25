// ⚠️ 已废弃归档（v1 仪器，round14-v3 起）——reviewer 裁定：本文件不再执行、仅作历史存档。
// 废弃原因：① v1 场景用「改名键」布置（A/B/C…非真实 dancer id），违反现行 G2 红线
//   （positions 键必须 === dancers id）；② 断言与场景读取已退役的 proj.pairs 舞伴语义，
//   在产品语义 v3（pairs 删除、groups 编组、单元样式 capsule/single）下必然抛错/误判。
// 后继者：L0 职责 → tests/page-l0.js；L1 动线 → tests/page-l1.js；R 组 → tests/page-r.js；
//   GR 编组 → tests/page-gr.js；L2 组合 → tests/page-l2.js。权威计划：tests/e2e-matrix.md（v3）。
//
// 全操作动线矩阵（浏览器端执行）：每条动线 = 硬件类别 + 注入器步骤 + 检查点。
// 运行：await import('/tests/page-matrix.js') → await window.__runMatrix()
// 结果：[{ id, hw, name, ok, detail }]
// 布置：A(2,1.5) B(2.7,1.5) C(2,4.2) D(2.7,4.2) E(6.5,1.5) F(7.2,1.5) G(6.5,4.2) H(7.2,4.2)，其余停靠右侧。
// 空白点 (4.6,2.8)；框选区 (1.6,0.9)-(3.2,4.8) 覆盖 A/B/C/D。

const CFG = {
  named: { A: [2, 1.5], B: [2.7, 1.5], C: [2, 4.2], D: [2.7, 4.2], E: [6.5, 1.5], F: [7.2, 1.5], G: [6.5, 4.2], H: [7.2, 4.2] },
  blank: [4.6, 2.8],
  box: [1.6, 0.9, 3.2, 4.8],
};

async function setup(fs) {
  const store = fs.store, M = fs.M, sv = fs.stageView();
  store.createNewProject({ title: '动线矩阵', pairs: 6 });
  const fmt = () => store.getState().project.formations[store.getState().formationIndex];
  store.mutate(p => {
    const f = p.formations[0];
    f.merges = [];
    p.stage.snap = false;
    const ids = Object.keys(f.positions);
    const map = {};
    ids.forEach((id, i) => { map[id] = 'ABCDEFGH'[i] || ('X' + i); });
    const np = {};
    for (const [old, nw] of Object.entries(map)) np[nw] = { ...f.positions[old] };
    f.positions = np;
    for (const [id, [x, y]] of Object.entries(CFG.named)) if (f.positions[id]) { f.positions[id].x = x; f.positions[id].y = y; }
    const rest = Object.keys(f.positions).filter(id => !CFG.named[id]);
    rest.forEach((id, i) => { f.positions[id].x = 9.3; f.positions[id].y = 0.8 + i * 0.55; });
  }, '矩阵布置');
  store.setUI({ selection: [], multiSelect: false });
  if (!store.getState().editMode) store.setUI({ editMode: true });
  sv.ensureView();
  return { store, M, sv, fmt };
}

function makeCtx(fs, input) {
  const sv = fs.stageView();
  const fmt = () => fs.store.getState().project.formations[fs.store.getState().formationIndex];
  const toClient = (x, y) => {
    const r = sv.canvas.getBoundingClientRect(), v = sv.view;
    return { x: r.left + v.ox + x * v.scale, y: r.top + v.oy + y * v.scale };
  };
  const pos = id => ({ ...fmt().positions[id] });
  const merges = () => fmt().merges || [];
  const mergeOf = (a, b) => merges().find(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  const menu = () => document.querySelector('.unit-menu');
  // 汇合轮改写（图标化）：纯图标钮（✕→关闭）textContent 为空——按 aria-label 兜底匹配
  const menuBtn = tx => [...(menu()?.querySelectorAll('button') || [])].find(b => b.textContent.includes(tx) || (b.getAttribute('aria-label') || '').includes(tx));
  const pt = (id) => { const p = pos(id); return toClient(p.x, p.y); };
  return { sv, fmt, toClient, pos, merges, mergeOf, menu, menuBtn, pt };
}

export function buildCases() {
  const cases = [];
  const add = (id, hw, name, run) => cases.push({ id, hw, name, run });

  // ============ 桌面·鼠标 ============
  add('M01', 'mouse', '单击舞者=仅其入选，位置不变', async ({ input, c, step }) => {
    await input.click(c.pt('A').x, c.pt('A').y);
    step('选择=A', JSON.stringify([...window.__fs.store.getState().selection]));
    step('位置不变', Math.abs(c.pos('A').x - 2) < 1e-9);
  });
  add('M02', 'mouse', '单击空白=清空选择', async ({ input, c, step }) => {
    const b = c.toClient(...CFG.blank);
    await input.click(b.x, b.y);
    step('选择已清空', window.__fs.store.getState().selection.length === 0);
  });
  add('M03', 'mouse', 'Shift+单击 追加/移出', async ({ input, c, step }) => {
    const a = c.pt('A'), e = c.pt('E');
    await input.click(a.x, a.y, { shift: true });
    await input.click(e.x, e.y, { shift: true });
    step('追加为2人', window.__fs.store.getState().selection.length === 2);
    await input.click(e.x, e.y, { shift: true });
    step('移出后余1人', window.__fs.store.getState().selection.length === 1);
  });
  add('M04', 'mouse', '拖拽单舞者=精确位移', async ({ input, c, step }) => {
    const before = c.pos('E');
    const from = c.pt('E');
    await input.drag([from, { x: from.x + 0.9 * c.sv.view.scale, y: from.y }]);
    step('位移≈0.9m', Math.abs(c.pos('E').x - before.x - 0.9) < 0.01);
    step('A 未被带動', Math.abs(c.pos('A').x - 2) < 1e-9);
  });
  add('M05', 'mouse', '拖到他人上松手→确认→点样式=合并成组', async ({ input, c, step }) => {
    const from = c.pt('C'), to = c.pt('D');
    await input.drag([from, { x: (from.x + to.x) / 2, y: from.y }, to]);
    step('弹窗出现', !!c.menu() && c.menu().textContent.includes('合并为单元'));
    const btn = c.menuBtn('胶囊');
    const r = btn.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2);
    step('点胶囊=合并建立', !!c.mergeOf('C', 'D') && c.mergeOf('C', 'D').style === 'capsule');
    step('两人收拢为一点', Math.hypot(c.pos('C').x - c.pos('D').x, c.pos('C').y - c.pos('D').y) < 0.01);
    step('弹窗关闭', !c.menu());
  });
  add('M06', 'mouse', '弹窗✕/点外部=取消且不合并', async ({ input, c, step }) => {
    const from = c.pt('A'), to = c.pt('B');
    await input.drag([from, to]); // A 拖到 B 上（A-B 未合并状态）
    step('弹窗出现', !!c.menu());
    const x = c.menuBtn('关闭');
    const r = x.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2);
    step('✕关闭且未合并', !c.menu() && !c.mergeOf('A', 'B'));
    // 再来一次：点外部取消
    await input.drag([c.pt('A'), c.pt('B')]);
    const blank = c.toClient(...CFG.blank);
    await input.click(blank.x, blank.y);
    step('点外部取消且未合并', !c.menu() && !c.mergeOf('A', 'B'));
  });
  add('M07', 'mouse', '驻留1.6s不松手即弹窗，可继续点样式', async ({ input, c, step }) => {
    const e = c.pt('E'), f = c.pt('F');
    await input.drag([e, { x: (e.x + f.x) / 2, y: e.y }, f], { dwellMs: 1700 });
    step('驻留期间弹窗（未松手已触发）', !!c.menu());
    const btn = c.menuBtn('菱形');
    const r = btn.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2);
    step('菱形建组', c.mergeOf('E', 'F')?.style === 'diamond');
  });
  add('M08', 'mouse', '双击已合并单元→浮窗→拆开/换样式', async ({ input, c, step }) => {
    const mid = { x: (c.pt('E').x + c.pt('F').x) / 2, y: c.pt('E').y };
    await input.dblclick(mid.x, mid.y);
    step('双击弹单元浮窗', !!c.menu() && c.menu().textContent.includes('舞对单元'));
    const untie = c.menuBtn('拆开');
    const r = untie.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2);
    step('拆开移除绑定', !c.mergeOf('E', 'F'));
    // 重建 E-F 并换样式
    window.__fs.M.addMerge(c.fmt(), 'E', 'F', 'capsule');
    await input.dblclick(mid.x, mid.y);
    const btn = c.menuBtn('菱形');
    const r2 = btn.getBoundingClientRect();
    await input.click(r2.x + r2.width / 2, r2.y + r2.height / 2);
    step('换样式=菱形', c.mergeOf('E', 'F')?.style === 'diamond');
  });
  add('M09', 'mouse', '鼠标按住800ms不动=无长按弹窗（长按仅触摸端）', async ({ input, c, step }) => {
    const a = c.pt('A');
    await input.press(a.x, a.y, 800);
    step('无弹窗', !c.menu());
    step('单击语义生效', window.__fs.store.getState().selection.includes('A'));
  });
  add('M10', 'mouse', '双击未合并舞者=无弹窗', async ({ input, c, step }) => {
    const g = c.pt('G');
    await input.dblclick(g.x, g.y);
    step('无弹窗', !c.menu());
  });
  add('M11', 'mouse', '框选=矩形内全选；组拖=同步位移', async ({ input, c, step }) => {
    const [x0, y0, x1, y1] = CFG.box;
    const p0 = c.toClient(x0, y0), p1 = c.toClient(x1, y1);
    await input.drag([p0, { x: p1.x, y: p1.y }]);
    step('框选 A/B/C/D', window.__fs.store.getState().selection.length === 4);
    const b0 = c.pos('B'), c0 = c.pos('C');
    const from = c.pt('B');
    await input.drag([from, { x: from.x + 0.5 * c.sv.view.scale, y: from.y }]);
    const dxB = c.pos('B').x - b0.x, dxC = c.pos('C').x - c0.x;
    step('组拖同步位移', Math.abs(dxB - dxC) < 0.01 && Math.abs(dxB) > 0.2);
  });
  add('M12', 'mouse', '滚轮缩放', async ({ input, c, step }) => {
    const center = c.toClient(5, 3);
    const s0 = c.sv.view.scale;
    input.wheel(center.x, center.y, -240);
    await input.sleep(50);
    step('放大生效', c.sv.view.scale > s0 * 1.2);
    c.sv.resetView();
    await input.sleep(60);
  });
  add('M13', 'mouse', '拖拽中 Escape=回滚且零历史', async ({ input, c, step }) => {
    const store = window.__fs.store;
    const d = c.pt('D');
    const before = c.pos('D');
    await input.down(d.x, d.y);
    await input.sleep(30);
    await input.move(d.x + 0.5 * c.sv.view.scale, d.y, { pid: 1 });
    await input.sleep(30);
    input.key('Escape');
    await input.sleep(60);
    await input.up(d.x + 0.5 * c.sv.view.scale, d.y, { pid: 1 });
    step('位置回滚', Math.abs(c.pos('D').x - before.x) < 1e-9 && Math.abs(c.pos('D').y - before.y) < 1e-9);
  });
  add('M14', 'mouse', '方向键微调（snap 关=0.1m）', async ({ input, c, step }) => {
    const before = c.pos('H');
    window.__fs.store.setUI({ selection: ['H'] });
    input.key('ArrowRight');
    await input.sleep(50);
    step('右移0.1', Math.abs(c.pos('H').x - (before.x + 0.1)) < 1e-9);
  });
  add('M15', 'mouse', '编辑开关：关=舞者锁死，时间轴仍可用；开=恢复', async ({ input, c, step }) => {
    document.getElementById('btn-edit-mode').click();
    await input.sleep(50);
    const d = c.pt('G');
    const before = c.pos('G');
    await input.drag([d, { x: d.x + 40, y: d.y }]);
    step('关闭后拖不动', Math.abs(c.pos('G').x - before.x) < 1e-9);
    const chips = document.querySelectorAll('#formation-list .es-chip');
    step('队形条仍在文档', chips.length >= 1);
    document.getElementById('btn-edit-mode').click();
    await input.sleep(50);
    await input.drag([d, { x: d.x + 0.5 * c.sv.view.scale, y: d.y }]);
    step('开启后可拖', Math.abs(c.pos('G').x - (before.x + 0.5)) < 0.01);
  });

  // ============ 触摸 ============
  add('T01', 'touch', '触摸单击=选择', async ({ input, c, step }) => {
    const a = c.pt('A');
    await input.click(a.x, a.y, { hw: 'touch' });
    step('选择=A', window.__fs.store.getState().selection.includes('A'));
  });
  add('T02', 'touch', '触摸拖拽=移动舞者', async ({ input, c, step }) => {
    const before = c.pos('D');
    const d = c.pt('D');
    await input.drag([d, { x: d.x + 0.6 * c.sv.view.scale, y: d.y }], { hw: 'touch' });
    step('位移≈0.6m', Math.abs(c.pos('D').x - before.x - 0.6) < 0.02);
  });
  add('T03', 'touch', '触摸拖到重叠松手→点样式=合并', async ({ input, c, step }) => {
    const a = c.pt('A'), b = c.pt('B');
    await input.drag([a, b], { hw: 'touch' });
    step('弹窗出现', !!c.menu());
    const btn = c.menuBtn('双圆');
    const r = btn.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2, { hw: 'touch' });
    step('双圆建组', c.mergeOf('A', 'B')?.style === 'twin');
  });
  add('T04', 'touch', '触摸长按700ms=单元浮窗', async ({ input, c, step }) => {
    const mid = { x: (c.pt('A').x + c.pt('B').x) / 2, y: c.pt('A').y };
    await input.press(mid.x, mid.y, 700, { hw: 'touch' });
    step('弹窗出现', !!c.menu() && c.menu().textContent.includes('舞对单元'));
    const x = c.menuBtn('关闭');
    const r = x.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2, { hw: 'touch' });
  });
  add('T05', 'touch', '触摸双击=单元浮窗', async ({ input, c, step }) => {
    const mid = { x: (c.pt('A').x + c.pt('B').x) / 2, y: c.pt('A').y };
    await input.dblclick(mid.x, mid.y, { hw: 'touch' });
    step('弹窗出现', !!c.menu());
    const x = c.menuBtn('关闭');
    const r = x.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2, { hw: 'touch' });
  });
  add('T06', 'touch', '单指空白拖动=平移', async ({ input, c, step }) => {
    const ox0 = c.sv.view.ox;
    const p0 = c.toClient(5, 2.8), p1 = c.toClient(6.2, 2.8);
    await input.drag([p0, p1], { hw: 'touch' });
    step('视图平移', Math.abs(c.sv.view.ox - ox0) > 15);
  });
  add('T07', 'touch', '双指捏合=缩放', async ({ input, c, step }) => {
    const s0 = c.sv.view.scale;
    const center = c.toClient(5, 3);
    await input.pinch(center.x, center.y, 120, 220);
    await input.sleep(80);
    step('缩放生效', Math.abs(c.sv.view.scale - s0) > 1);
    c.sv.resetView();
    await input.sleep(60);
  });

  // ============ 笔 ============
  add('P01', 'pen', '笔拖拽=同鼠标语义', async ({ input, c, step }) => {
    const before = c.pos('H');
    const h = c.pt('H');
    await input.drag([h, { x: h.x + 0.4 * c.sv.view.scale, y: h.y }], { hw: 'pen' });
    step('位移≈0.4m', Math.abs(c.pos('H').x - before.x - 0.4) < 0.02);
  });
  add('P02', 'pen', '笔长按=单元浮窗（笔按触摸端处理）', async ({ input, c, step }) => {
    const mid = { x: (c.pt('A').x + c.pt('B').x) / 2, y: c.pt('A').y };
    await input.press(mid.x, mid.y, 700, { hw: 'pen' });
    step('弹窗出现', !!c.menu() && c.menu().textContent.includes('舞对单元'));
    const x = c.menuBtn('关闭');
    const r = x.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2);
  });

  // ============ 移动端视口 ============
  add('V01', 'viewport', '窄屏 375×667：无横向溢出', async ({ input, c, step }) => {
    step('scrollWidth≤viewport', document.documentElement.scrollWidth <= window.innerWidth + 1,
      `scrollW=${document.documentElement.scrollWidth} innerW=${window.innerWidth}`);
  });
  add('V02', 'viewport', '窄屏触摸选择+拖拽', async ({ input, c, step }) => {
    const a = c.pt('A');
    await input.click(a.x, a.y, { hw: 'touch' });
    step('选择生效', window.__fs.store.getState().selection.includes('A'));
    const d = c.pt('D');
    const before = c.pos('D');
    await input.drag([d, { x: d.x + 0.5 * c.sv.view.scale, y: d.y }], { hw: 'touch' });
    step('拖拽生效', Math.abs(c.pos('D').x - before.x - 0.5) < 0.02);
  });
  add('V03', 'viewport', '窄屏弹窗钳制在视口内', async ({ input, c, step }) => {
    const a = c.pt('A'), b = c.pt('B');
    window.__fs.M.removeMerge(c.fmt(), 'A', 'B');
    await input.drag([a, b], { hw: 'touch' });
    const mr = c.menu()?.getBoundingClientRect();
    step('弹窗在视口内', !!mr && mr.x >= 0 && mr.y >= 0 && mr.right <= window.innerWidth && mr.bottom <= window.innerHeight,
      mr ? JSON.stringify({ x: Math.round(mr.x), y: Math.round(mr.y), r: Math.round(mr.right), b: Math.round(mr.bottom) }) : '无弹窗');
    const x = c.menuBtn('关闭');
    const r = x.getBoundingClientRect();
    await input.click(r.x + r.width / 2, r.y + r.height / 2, { hw: 'touch' });
  });
  return cases;
}

export async function runMatrix(filterHw) {
  const fs = window.__fs;
  const input = window.__input;
  const { store, M, sv, fmt } = await setup(fs);
  const ctx = makeCtx(fs, input);
  const results = [];
  for (const c of buildCases().filter(k => !filterHw || k.hw === filterHw)) {
    const steps = [];
    const step = (name, ok, detail) => steps.push({ name, ok: !!ok, detail: detail ?? '' });
    try {
      await c.run({ input, c: ctx, step, fs });
    } catch (err) {
      steps.push({ name: '(异常)', ok: false, detail: String(err && err.message || err) });
    }
    const bad = steps.filter(s => !s.ok);
    const leaked = sv.gesture.debugPointers ? sv.gesture.debugPointers() : [];
    if (leaked.length) steps.push({ name: '(指针泄漏)', ok: false, detail: '残留 pointerId=' + leaked.join(',') });
    const ok = bad.length === 0 && leaked.length === 0;
    results.push({ id: c.id, hw: c.hw, name: c.name, ok, steps });
  }
  // 恢复视口与干净状态
  try { window.__fs.stageView().resetView(); } catch {}
  return results;
}
