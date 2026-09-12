// GR 组测试仪器（v3 新增）：RTS 编组动线 GR-01~GR-07（权威计划 tests/e2e-matrix.md §3.6）。
// 背景：舞对绑定退役后新增编组 groups=[{id,name,memberIds[]}]——纯选择辅助，可与合并单元交叉叠加；
//   入口 = Ctrl/Cmd+1..9 存（覆盖）/ 1..9 选（替换）/ Shift+1..9 追加（e.code=DigitN 判定）、
//   右侧「编组」tab（选择/重命名/删除组/＋存为编组；删除组≠删人）、名册 chips、createProject grouping gender|none。
// 结构复用 page-r 纪律：每条动线独立场景（真实 id / 12 人两行 / snap 关 / 视图 fit；除 GR-05 外
//   以 grouping:'none' 建项目取得干净 groups 起点）、先执行后断言、失败即停、每动线后泄漏断言。
// 快捷键注入约定：真实键盘 Shift+数字产生 "!@#" 等字符，应用按 e.code=DigitN 判定——
//   注入器 key() 缺省推导为 Key1，必须显式传 { code: 'Digit1' }（L0·I8 已验证 code 透传）。
// 纪律：本文件属测试仪器，被测应用代码（js/*、index.html、css/*）零改动；场景搭建只走 store/M 公共 API。
// 运行前提：window.__fs、window.__input（page-injector.js）、window.__l1Shot（lab 驱动注入；page-kit 兼容 __l0Shot 兜底）。
// 入口：await import('/tests/page-gr.js') → await runGR({ only?: 'GR-04' })
//       返回 { phase:'M', cases:[{id,name,ok,evidence,steps,log,snapAfter}], shots, meta }。
import {
  raf2, sleep, TH_COLOR, TH_HL, SCREEN_RATIO,
  makeCtx, dprOf, mean3x3, hex, ringMinDist, innerMinDist,
  screenCompare, runCases,
} from './page-kit.js';

const HL = hex('#0ea5e9'); // 选中高亮
// 框选区（与 page-l2·C-03 同一坐标系：第 1 行 y=7.2，x=2.25+1.5i）
const BOX = {
  two: [0.8, 6.4, 4.5, 7.95],   // ids[0..1]
  three: [0.8, 6.4, 6.0, 7.95], // ids[0..2]
  right: [4.6, 6.4, 7.4, 7.95], // ids[2..3]
};

export async function runGR(opts = {}) {
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

  // ---- 每条动线独立场景：grouping 可选（默认 none=干净 groups 起点） ----
  async function setup(title, { grouping = 'none' } = {}) {
    const stale = document.querySelector('.unit-menu');
    if (stale) { stale.remove(); sv.gesture.reset(); }
    const staleToasts = document.getElementById('toasts');
    if (staleToasts) staleToasts.innerHTML = ''; // 仪器卫生：上一动线的 toast 通知气泡会跨用例残留叠升入画布（GR-03 实证）
    store.createNewProject({ title, pairs: 6, grouping });
    store.setUI({ selection: [], multiSelect: false, editMode: true, showFacingHandle: false });
    store.mutate(p => { p.stage.snap = false; });
    sv.resetView();
    await raf2();
    const ids = M.orderedDancers(state().project);
    const dancerOf = id => state().project.dancers.find(d => d.id === id);
    const posOf = id => ({ ...fmt().positions[id] });
    const ptOf = id => { const p = posOf(id); return ctx.toClient(p.x, p.y); };
    const blank = ctx.toClient(5.7, 12.2);
    return {
      ids, dancerOf, posOf, ptOf, blank, grouping,
      base: mean3x3(cv, blank.x, blank.y),
      rpx: 0.38 * sv.view.scale,
      col: id => hex(dancerOf(id).color),
      sel: () => [...state().selection],
      groups: () => state().project.groups || [],
      hist: () => `canUndo=${store.canUndo()} canRedo=${store.canRedo()} label="${store.undoLabel()}"`,
      data: () => JSON.stringify({ p: fmt().positions, m: fmt().merges || [] }),
      // 编组快捷键（e.code 判定）：存=N with ctrl；选=N；追加=N with shift
      keySave: n => inp.key(String(n), { code: 'Digit' + n, ctrl: true }),
      keySel: n => inp.key(String(n), { code: 'Digit' + n }),
      keyAdd: n => inp.key(String(n), { code: 'Digit' + n, shift: true }),
      boxSel: async which => {
        const [x0, y0, x1, y1] = BOX[which];
        const a = ctx.toClient(x0, y0), b = ctx.toClient(x1, y1);
        const pts = Array.from({ length: 5 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / 4, y: a.y + (b.y - a.y) * i / 4 }));
        await inp.drag(pts, { hw: 'mouse', stepMs: 30 });
        await raf2();
      },
    };
  }

  // ---- 通用小工具 ----
  async function clickBtn(id) {
    const r = document.getElementById(id).getBoundingClientRect();
    await inp.click(r.left + r.width / 2, r.top + r.height / 2, { hw: 'mouse' });
    await raf2();
  }
  async function clickDom(el) {
    const r = el.getBoundingClientRect();
    await inp.click(r.left + r.width / 2, r.top + r.height / 2, { hw: 'mouse' });
    await raf2();
  }
  async function openGroupsTab() { // 切右侧面板「编组」tab 并返回宿主容器
    const tab = document.querySelector('.ptab[data-tab="groups"]');
    await clickDom(tab);
    return document.getElementById('props-groups');
  }
  const grpRow = i => document.querySelectorAll('#props-groups .grp-row')[i] || null;
  const grpBtn = (i, text) => {
    const row = grpRow(i);
    return row ? [...row.querySelectorAll('button')].find(b => b.textContent.trim() === text) || null : null;
  };
  async function dragPts(from, to, { n = 4, stepMs = 30 } = {}) {
    const pts = Array.from({ length: n + 1 }, (_, i) => ({ x: from.x + (to.x - from.x) * i / n, y: from.y + (to.y - from.y) * i / n }));
    await inp.drag(pts, { hw: 'mouse', stepMs });
    return pts;
  }
  const sortedEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  // 共享不变式（v3，同 R 组）：positions 键===dancers id + merges/groups 引用有效
  function invariants() {
    const proj = state().project;
    const ids = proj.dancers.map(d => d.id).sort();
    const keyOK = proj.formations.every(f => JSON.stringify(Object.keys(f.positions).sort()) === JSON.stringify(ids));
    const mergeOK = proj.formations.every(f => (f.merges || []).every(m => ids.includes(m.a) && ids.includes(m.b) && m.a !== m.b));
    const groupsOK = (proj.groups || []).every(g => (g.memberIds || []).every(id => ids.includes(id)));
    return { keyOK, mergeOK, groupsOK };
  }
  async function cmpShot(tag) {
    const b64 = await (window.__l1Shot || window.__l0Shot)();
    shots[tag] = b64;
    // Toast 是画布之上的 DOM 通知（存组等操作触发、滞留数秒）：SCREEN 逐像素比对须剔除其区域，
    // 否则气泡像素全算差异（GR-03 实证：toast 叠升入画布 → 确定性 1.17% 差异、重建 context 亦复现）
    const tt = document.getElementById('toasts');
    const mask = tt && tt.children.length ? (() => { const q = tt.getBoundingClientRect(); return { x0: q.left, y0: q.top, x1: q.right, y1: q.bottom }; })() : null;
    const cmp = await screenCompare(2, mask);
    return { b64, cmp, tag };
  }
  const cmpStep = (step, r) => step('[SCREEN] 屏幕=位图（差异<0.5%）', r.cmp.best < SCREEN_RATIO,
    `raw=${(r.cmp.raw * 100).toFixed(4)}% best±1px=${(r.cmp.best * 100).toFixed(4)}%@off[${r.cmp.bestOff}] → ${r.tag}.png`, 'SCREEN');

  // =====================================================================
  // 动线定义（GR-01..GR-07，M 批次）
  // =====================================================================
  const defs = [

    // ---------- GR-01 快捷键定义/选择/追加/覆盖 ----------
    {
      id: 'GR-01', name: '快捷键：Ctrl+1 存组 → 1 选组（替换）→ Shift+1 追加 → Ctrl+1 覆盖',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1], C = t.ids[2], D = t.ids[3], F = t.ids[5];

        // ---- 步1 框选 2 人 → Ctrl+1 存组 ----
        await t.boxSel('two');
        const sel2 = t.sel().slice().sort();
        step('[前置] 框选 2 人', sortedEq(sel2, [A, B]), `selection=[${t.sel().map(i => i.slice(0, 6))}]`);
        t.keySave(1);
        await raf2();
        const g1 = t.groups()[0];
        // 应用语义（js/main.js saveSelectionAsGroupN）：Ctrl+N 定向槽位保存——槽位为空=新建、非空=覆盖，
        // 历史标签统一为「覆盖编组 N」（与「＋存为编组」的自动命名路径区分）
        const savedOK = t.groups().length === 1 && g1 && g1.name === '组1' && sortedEq(g1.memberIds, [A, B]) && store.undoLabel() === '覆盖编组 1';
        step('[STATE] Ctrl+1：groups=[组1(2人)] 成员=所选（选择保留）、历史「覆盖编组 1」（Ctrl+N 定向槽位统一标签）', savedOK,
          `groups=${JSON.stringify(t.groups().map(g => [g.name, g.memberIds.length]))} ${t.hist()}`);

        // ---- 步2 点空白 → 按 1 选中组（PIXEL 高亮）----
        await inp.click(t.blank.x, t.blank.y, { hw: 'mouse' });
        await raf2();
        const cleared = t.sel().length === 0;
        t.keySel(1);
        await raf2();
        const selAfter1 = t.sel().slice().sort();
        const hlA = ringMinDist(cv, t.ptOf(A).x, t.ptOf(A).y, t.rpx, HL);
        const r1 = await cmpShot('gr01-select');
        step('[STATE] 前置：点空白清选成功', cleared, `selection=[${t.sel().map(i => i.slice(0, 6))}]`);
        step('[STATE] 按 1：selection==组1 成员（替换语义）', sortedEq(selAfter1, [A, B]), `selection=[${selAfter1.map(i => i.slice(0, 6))}]`);
        step('[PIXEL] 组选中：成员圆环高亮呈示', hlA.d < TH_HL, `A 最小色距 ${hlA.d.toFixed(1)} < ${TH_HL}`, 'PIXEL');
        cmpStep(step, r1);

        // ---- 步3 选他人后按 1：组选择覆盖当前选择 ----
        await inp.click(t.ptOf(F).x, t.ptOf(F).y, { hw: 'mouse' });
        await raf2();
        const preOK = JSON.stringify(t.sel()) === JSON.stringify([F]);
        t.keySel(1);
        await raf2();
        step('[STATE] 前置：单击选中他人', preOK, `selection=[${t.sel().map(i => i.slice(0, 6))}]`);
        step('[STATE] 再按 1：替换为组1 成员（不残留他人）', sortedEq(t.sel(), [A, B]), `selection=[${t.sel().map(i => i.slice(0, 6))}]`);

        // ---- 步4 Shift+1：追加组员到当前选择（先单击 F 使 selection=[F]）----
        await inp.click(t.ptOf(F).x, t.ptOf(F).y, { hw: 'mouse' });
        await raf2();
        const preAdd = JSON.stringify(t.sel()) === JSON.stringify([F]);
        t.keyAdd(1);
        await raf2();
        step('[STATE] Shift+1：[F] ∪ 组1 = [A,B,F]', preAdd && sortedEq(t.sel(), [A, B, F]), `前置单选F=${preAdd} selection=[${t.sel().map(i => i.slice(0, 6))}]`);

        // ---- 步5 框选另 2 人 → Ctrl+1 覆盖 ----
        await inp.click(t.blank.x, t.blank.y, { hw: 'mouse' });
        await raf2();
        await t.boxSel('right');
        t.keySave(1);
        await raf2();
        const g1b = t.groups()[0];
        const coverOK = t.groups().length === 1 && g1b.name === '组1' && sortedEq(g1b.memberIds, [C, D]) && store.undoLabel() === '覆盖编组 1';
        step('[STATE] Ctrl+1 覆盖：组1 memberIds=[C,D]（旧成员被替换）、历史「覆盖编组 1」', coverOK,
          `groups=${JSON.stringify(t.groups().map(g => g.memberIds.map(i => i.slice(0, 6))))} ${t.hist()}`);
        const rEnd = await cmpShot('gr01-cover');
        cmpStep(step, rEnd);
      },
    },

    // ---------- GR-02 编组选项卡 ----------
    {
      id: 'GR-02', name: '编组 tab：行点击选中 → 重命名（prompt 注入）→ 删除组（≠删人）→ undo/redo',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1], C = t.ids[2];

        // ---- 前置：建 3 人组 ----
        await t.boxSel('three');
        t.keySave(1);
        await raf2();
        step('[前置] 组1(3人) 已建', t.groups().length === 1 && t.groups()[0].memberIds.length === 3, `${t.hist()}`);

        // ---- 步1 切「编组」tab：DOM 结构 ----
        const host = await openGroupsTab();
        const row = grpRow(0);
        const btnsOK = !!row && ['选择', '重命名', '删除'].every(x => [...row.querySelectorAll('button')].some(b => b.textContent.trim() === x));
        step('[DOM] 编组 tab 行结构（1. 组1 · 3人 · 选择/重命名/删除）', host && !host.hidden && btnsOK &&
          (row.textContent.includes('组1') || row.textContent.includes('1.')) && row.textContent.includes('3人'),
          `row="${row ? row.textContent.slice(0, 40) : '无 .grp-row'}"`, 'DOM');

        // ---- 步2 行点击 = 选中该组 ----
        await clickDom(row);
        await raf2();
        step('[STATE] 行点击选中：selection==组1 成员', sortedEq(t.sel(), [A, B, C]), `selection=[${t.sel().map(i => i.slice(0, 6))}]`);

        // ---- 步3 重命名（prompt 由仪器放行 →「左翼」）----
        const oldPrompt = window.prompt;
        window.prompt = () => '左翼';
        await clickDom(grpBtn(0, '重命名'));
        window.prompt = oldPrompt;
        await raf2();
        const rnOK = t.groups().length === 1 && t.groups()[0].name === '左翼' && store.undoLabel() === '重命名编组';
        step('[STATE] 重命名：组1→「左翼」、历史「重命名编组」、舞者数量不变', rnOK && state().project.dancers.length === 12,
          `name="${t.groups()[0]?.name}" ${t.hist()}`);

        // ---- 步4 删除组：组消失、人不动 ----
        const data0 = t.data();
        await clickDom(grpBtn(0, '删除'));
        await raf2();
        const inv = invariants();
        const delOK = t.groups().length === 0 && state().project.dancers.length === 12 && t.data() === data0 &&
          inv.keyOK && inv.mergeOK && inv.groupsOK && store.undoLabel() === '删除编组';
        step('[STATE] 删除组：groups=[]、dancers/positions 全部不变（删除组≠删人）、历史「删除编组」', delOK,
          `groups=${t.groups().length} dancers=${state().project.dancers.length} ${t.hist()}`);

        // ---- 步5 undo 还原组 / redo 重放删除 ----
        store.undo();
        await raf2();
        const undoneName = t.groups()[0]?.name; // 先取证再 redo（redo 后 groups=[] 防空引用）
        const backOK = t.groups().length === 1 && undoneName === '左翼' && t.groups()[0].memberIds.length === 3;
        store.redo();
        await raf2();
        step('[STATE] undo 还原组（名/成员完整）、redo 重放删除', backOK && t.groups().length === 0, `undo 后="${undoneName}" ${t.hist()}`);
        const rEnd = await cmpShot('gr02-panel');
        cmpStep(step, rEnd);
      },
    },

    // ---------- GR-03 交叉组 ----------
    {
      id: 'GR-03', name: '交叉组：一人多组、组间选择互不污染、Shift 追加',
      async run(t, { step }) {
        const A = t.ids[0], B = t.ids[1], C = t.ids[2];

        // ---- 建 组1=[A,B]、组2=[B,C]（共享 B）----
        await t.boxSel('two');
        t.keySave(1);
        await raf2();
        await inp.click(t.ptOf(B).x, t.ptOf(B).y, { hw: 'mouse' });
        await raf2();
        await inp.click(t.ptOf(C).x, t.ptOf(C).y, { hw: 'mouse', shift: true });
        await raf2();
        const preOK = sortedEq(t.sel(), [B, C]);
        t.keySave(2);
        await raf2();
        const [g1, g2] = t.groups();
        const mkOK = preOK && t.groups().length === 2 && sortedEq(g1.memberIds, [A, B]) && sortedEq(g2.memberIds, [B, C]);
        step('[STATE] 建 组1=[A,B] / 组2=[B,C]（B 交叉同属两组）', mkOK,
          `groups=${JSON.stringify(t.groups().map(g => g.memberIds.map(i => i.slice(0, 6))))}`);

        // ---- 组间切换互不污染 ----
        t.keySel(1);
        await raf2();
        const s1 = sortedEq(t.sel(), [A, B]);
        t.keySel(2);
        await raf2();
        const s2 = sortedEq(t.sel(), [B, C]);
        const dataSafe = sortedEq(g1.memberIds, [A, B]) && sortedEq(g2.memberIds, [B, C]); // 选择操作不改组数据
        step('[STATE] 选组1→[A,B]、选组2→[B,C]（组1独有成员被替换、组数据零污染）', s1 && s2 && dataSafe,
          `选1=[${s1}] 选2=[${s2}] groups 不变=${dataSafe}`);

        // ---- Shift 追加：[B,C] ∪ 组1 = [A,B,C] ----
        t.keyAdd(1);
        await raf2();
        const addOK = sortedEq(t.sel(), [A, B, C]);
        step('[STATE] Shift+1：[B,C] ∪ [A,B] = [A,B,C]', addOK, `selection=[${t.sel().map(i => i.slice(0, 6))}]`);
        const r = await cmpShot('gr03-cross');
        cmpStep(step, r);
      },
    },

    // ---------- GR-04 组操作组合 ----------
    {
      id: 'GR-04', name: '组选中后：整组移动 → 统一朝向（面向圆心）→ 右键删除组内一员（既有路径+引用联动）',
      async run(t, { step }) {
        const G = [t.ids[0], t.ids[1], t.ids[2]];
        const outsiders = t.ids.slice(3);

        // ---- 前置：建组并选中 ----
        await t.boxSel('three');
        t.keySave(1);
        await raf2();
        await inp.click(t.blank.x, t.blank.y, { hw: 'mouse' });
        await raf2();
        t.keySel(1);
        await raf2();
        step('[前置] 组1(3人) 已选中', sortedEq(t.sel(), G), `selection=[${t.sel().map(i => i.slice(0, 6))}]`);

        // ---- 步1 整组移动：拖组内一人，3 人同 delta ----
        const g0 = G.map(id => t.posOf(id));
        const o0 = outsiders.map(id => t.posOf(id));
        const gd = { x: 0, y: 3.6 };
        await dragPts(t.ptOf(G[1]), ctx.toClient(g0[1].x + gd.x, g0[1].y + gd.y));
        await raf2();
        const g1 = G.map(id => t.posOf(id));
        const o1 = outsiders.map(id => t.posOf(id));
        const moveOK = g1.every((p, i) => Math.abs(p.x - g0[i].x - gd.x) < 1e-6 && Math.abs(p.y - g0[i].y - gd.y) < 1e-6);
        const outOK = o1.every((p, i) => Math.hypot(p.x - o0[i].x, p.y - o0[i].y) < 1e-9);
        const colMax = Math.max(...g1.map((p, i) => {
          const c = ctx.toClient(p.x, p.y);
          // 0.55r 8 向采样（圆心 3×3 含白色编号/朝向指针，直采均值会被污染——同 P2 探针口径）
          return innerMinDist(cv, c.x, c.y, t.rpx, t.col(G[i])).d < TH_COLOR ? 0 : 1;
        }).filter(Boolean).concat([0]));
        step('[STATE] 整组移动：3 人同 delta=（0,+3.6）、历史「移动舞者」', moveOK && store.undoLabel() === '移动舞者',
          G.map((id, i) => `Δ${i}=(${(g1[i].x - g0[i].x).toFixed(3)},${(g1[i].y - g0[i].y).toFixed(3)})`).join(' '));
        step('[STATE] 组外 9 人零位移', outOK, `最大漂移 ${Math.max(...o1.map((p, i) => Math.hypot(p.x - o0[i].x, p.y - o0[i].y))).toExponential(2)}m`);
        step('[PIXEL] 新位置呈成员色（3/3 命中）', colMax === 0, `未命中数=${colMax}`, 'PIXEL');

        // ---- 步2 统一朝向（面向圆心）：#face-target → center ----
        const faceSel = document.getElementById('face-target');
        faceSel.value = 'center';
        faceSel.dispatchEvent(new Event('change', { bubbles: true }));
        await raf2();
        const cx = state().project.stage.widthM / 2, cy = state().project.stage.depthM / 2;
        const ang = p => Math.round(((Math.atan2(cx - p.x, -(cy - p.y)) * 180 / Math.PI) % 360 + 360) % 360); // shapes.angleTo 同式（0=上 顺时针）
        const faceOK = G.every(id => t.posOf(id).facing === ang(t.posOf(id)));
        step('[STATE] 统一朝向：组内 3 人 facing=面向圆心角度（逐人精确）、历史「统一朝向」', faceOK && store.undoLabel() === '统一朝向',
          G.map(id => `facing=${t.posOf(id).facing} 期望=${ang(t.posOf(id))}`).join(' '));

        // ---- 步3 右键删除组内一员（既有 removeDancer 路径 → 组引用联动清理）----
        const victim = G[2];
        const n0 = state().project.dancers.length;
        const vicPt = t.ptOf(victim);
        await inp.contextMenu(vicPt.x, vicPt.y, { hw: 'mouse' });
        await raf2();
        const menuEl = document.querySelector('.unit-menu');
        const delBtn = menuEl && [...menuEl.querySelectorAll('.um-btn')].find(b => b.textContent === '删除');
        step('[DOM] 右键组员弹「删除」菜单（未合并=舞者菜单）', !!menuEl && !!delBtn && menuEl.textContent.includes('舞者 · '), menuEl ? menuEl.textContent.slice(0, 30) : '无 .unit-menu', 'DOM');
        if (delBtn) await clickDom(delBtn);
        await raf2();
        const inv = invariants();
        const delOK = state().project.dancers.length === n0 - 1 && !state().project.dancers.some(d => d.id === victim) &&
          t.groups().length === 1 && t.groups()[0].memberIds.length === 2 && !t.groups()[0].memberIds.includes(victim) &&
          !t.sel().includes(victim) && inv.keyOK && inv.mergeOK && inv.groupsOK && !document.querySelector('.unit-menu');
        step('[STATE] 删除：舞者移除、组 memberIds 联动清理（3→2）、选择残留清理、不变式成立', delOK,
          `dancers=${state().project.dancers.length} 组员=${t.groups()[0]?.memberIds.length} sel含victim=${t.sel().includes(victim)} ${t.hist()}`);
        const r = await cmpShot('gr04-after-del');
        cmpStep(step, r);

        // ---- 步4 undo：删除还原、组复原 3 人 ----
        store.undo();
        await raf2();
        const backOK = state().project.dancers.length === n0 && t.groups()[0].memberIds.length === 3 &&
          Math.abs(t.posOf(victim).x - g0[2].x - gd.x) < 1e-9;
        step('[STATE] undo：删除还原（组复原 3 人、被删者回组内新位置）', backOK, `dancers=${state().project.dancers.length} ${t.hist()}`);
      },
    },

    // ---------- GR-05 初始化预定义组 ----------
    {
      id: 'GR-05', name: '初始化预定义组：gender 默认两组（男士/女士按角色划分、数字键可选）/ grouping:none 无组',
      async run(t, { step }) {
        // ---- 子1 默认 gender：本动线场景即 grouping:'gender'（setup 默认 none，这里重建）----
        store.createNewProject({ title: 'GR-05 gender', pairs: 6 });
        store.setUI({ selection: [], multiSelect: false, editMode: true, showFacingHandle: false });
        sv.resetView();
        await raf2();
        const p = state().project;
        const men = p.groups[0], women = p.groups[1];
        const roleOf = id => p.dancers.find(d => d.id === id).role;
        const genderOK = p.groups.length === 2 && men.name === '男士' && women.name === '女士' &&
          men.memberIds.length === 6 && women.memberIds.length === 6 &&
          men.memberIds.every(id => roleOf(id) === 'M') && women.memberIds.every(id => roleOf(id) === 'F') &&
          new Set([...men.memberIds, ...women.memberIds]).size === 12;
        step('[STATE] gender：groups=[男士(6·M)/女士(6·F)] 全员入组、无交叉', genderOK,
          `groups=${JSON.stringify(p.groups.map(g => [g.name, g.memberIds.length]))}`);

        // 数字键选中预定义组
        t.keySel(1);
        await raf2();
        const selMen = sortedEq(t.sel(), men.memberIds);
        t.keySel(2);
        await raf2();
        const selWomen = sortedEq(t.sel(), women.memberIds);
        step('[STATE] 按 1/2：分别选中 男士 6 人 / 女士 6 人', selMen && selWomen, `选1=${selMen} 选2=${selWomen}`);
        const host = await openGroupsTab();
        const rows = [...document.querySelectorAll('#props-groups .grp-row')].map(r => r.textContent);
        step('[DOM] 编组 tab 两行（男士/女士）', rows.length === 2 && rows[0].includes('男士') && rows[1].includes('女士'), `rows=[${rows.map(r2 => r2.slice(0, 12)).join(' | ')}]`, 'DOM');
        const r1 = await cmpShot('gr05-gender');
        cmpStep(step, r1);

        // ---- 子2 grouping:'none'：无组、数字键无副作用 ----
        store.createNewProject({ title: 'GR-05 none', pairs: 3, grouping: 'none' });
        store.setUI({ selection: [], multiSelect: false, editMode: true, showFacingHandle: false });
        sv.resetView();
        await raf2();
        const p2 = state().project;
        const noneOK = p2.groups.length === 0 && p2.dancers.length === 6;
        step('[STATE] none：groups==[]、dancers=6', noneOK, `groups=${p2.groups.length} dancers=${p2.dancers.length}`);
        // 无组时按 1 零副作用：先选中一人，再按 1，选择不变
        const q = p2.formations[0].positions[p2.dancers[0].id];
        const pt = ctx.toClient(q.x, q.y);
        await inp.click(pt.x, pt.y, { hw: 'mouse' });
        await raf2();
        const selBefore = t.sel().slice();
        t.keySel(1);
        await raf2();
        step('[STATE] 无组按 1：零副作用（selection 保持单人）', JSON.stringify(t.sel()) === JSON.stringify(selBefore) && selBefore.length === 1,
          `selection=[${t.sel().map(i => i.slice(0, 6))}]`);
        const r2 = await cmpShot('gr05-none');
        cmpStep(step, r2);
      },
    },

    // ---------- GR-06 名册组管理 ----------
    {
      id: 'GR-06', name: '名册 chips：加入/移出（chip-on 类切换、历史正确）+ undo/redo 往返、positions 全程不变',
      async run(t, { step }) {
        const A = t.ids[0], D = t.ids[3];

        // ---- 前置：建 组1=[A,B] ----
        await t.boxSel('two');
        t.keySave(1);
        await raf2();
        step('[前置] 组1(2人) 已建', t.groups().length === 1 && t.groups()[0].memberIds.length === 2, t.hist());

        // ---- 步1 打开名册：chip 状态断言 ----
        await clickBtn('btn-roster');
        const modalEl = document.querySelector('#modal-root .modal');
        const rowChip = i => document.querySelectorAll('#modal-root .roster-table tbody tr')[i]?.querySelector('.roster-groups .chip');
        const chip0 = rowChip(0), chip3 = rowChip(3);
        step('[DOM] 名册弹窗 + chips（组员行 chip-on、非组员行普通）', !!modalEl && chip0?.classList.contains('chip-on') === true && chip3?.classList.contains('chip-on') === false,
          `row0="${chip0?.className}" row3="${chip3?.className}"`, 'DOM');

        // ---- 步2 加入：ids[3] 行点 chip ----
        const data0 = t.data();
        await clickDom(chip3);
        await raf2();
        const joinOK = t.groups()[0].memberIds.length === 3 && t.groups()[0].memberIds.includes(D) && store.undoLabel() === '加入编组';
        const chip3On = rowChip(3)?.classList.contains('chip-on') === true;
        step('[STATE] chip 加入：组1=3 人含 ids[3]、历史「加入编组」', joinOK, `members=${t.groups()[0].memberIds.length} ${t.hist()}`);
        step('[DOM] chip-on 类随加入切换', chip3On, `row3="${rowChip(3)?.className}"`, 'DOM');
        store.undo(); await raf2();
        const undoJoin = t.groups()[0].memberIds.length === 2;
        store.redo(); await raf2();
        step('[STATE] 加入 undo/redo 往返', undoJoin && t.groups()[0].memberIds.length === 3, t.hist());

        // ---- 步3 移出：ids[0] 行再点 chip ----
        await clickDom(rowChip(0));
        await raf2();
        const leaveOK = t.groups()[0].memberIds.length === 2 && !t.groups()[0].memberIds.includes(A) && store.undoLabel() === '移出编组';
        step('[STATE] chip 移出：组1 不含 ids[0]、历史「移出编组」', leaveOK, `members=${JSON.stringify(t.groups()[0].memberIds.map(i => i.slice(0, 6)))} ${t.hist()}`);
        store.undo(); await raf2();
        const undoLeave = t.groups()[0].memberIds.includes(A);
        store.redo(); await raf2();
        step('[STATE] 移出 undo/redo 往返', undoLeave && !t.groups()[0].memberIds.includes(A), t.hist());

        // ---- 步4 chips 全程不改舞台数据 ----
        step('[STATE] chips 操作零舞台数据变更（positions/merges 深等）', t.data() === data0 && state().project.dancers.length === 12,
          `data 不变=${t.data() === data0}`);
        const closeBtn = [...document.querySelectorAll('#modal-root .m-foot button')].find(b => b.textContent === '关闭');
        closeBtn.scrollIntoView({ block: 'center' });
        await sleep(80);
        await clickDom(closeBtn);
        await raf2();
        const r = await cmpShot('gr06-roster');
        cmpStep(step, r);
      },
    },

    // ---------- GR-07 组选择的单元展开 ----------
    {
      id: 'GR-07', name: '组选择×单元原子：组成员在合并单元中 → 整单元两人入选（Shift 追加同理展开）',
      async run(t, { step }) {
        const A = t.ids[0], E = t.ids[6], F = t.ids[7], H = t.ids[8], I = t.ids[9];

        // ---- 前置：数据级合并 E|F、H|I（收拢）+ 组1=[A,E]（半单元成员）、组2=[H] ----
        store.mutate(p => {
          const f = p.formations[state().formationIndex];
          M.addMerge(f, E, F, 'capsule');
          M.collapseUnit(f, E, F);
          M.addMerge(f, H, I, 'capsule');
          M.collapseUnit(f, H, I);
        });
        store.setUI({ selection: [A, E] }); // 仪器构造半单元选择（公共 API）
        await raf2();
        t.keySave(1);
        await raf2();
        store.setUI({ selection: [H] });
        await raf2();
        t.keySave(2);
        await raf2();
        const mkOK = t.groups().length === 2 && sortedEq(t.groups()[0].memberIds, [A, E]) && sortedEq(t.groups()[1].memberIds, [H]);
        step('[前置] 合并 E|F、H|I 收拢；组1=[A,E]、组2=[H]（存组保存原始选择）', mkOK,
          `merges=${(fmt().merges || []).length} groups=${JSON.stringify(t.groups().map(g => g.memberIds.map(i => i.slice(0, 6))))}`);

        // ---- 步1 按 1 选组1：E 展开 → [A,E,F] ----
        await inp.click(t.blank.x, t.blank.y, { hw: 'mouse' });
        await raf2();
        t.keySel(1);
        await raf2();
        const exp1 = sortedEq(t.sel(), [A, E, F]);
        step('[STATE] 按 1：组1 选择展开为整单元 [A,E,F]（无 [A,E] 半单元中间态）', exp1, `selection=[${t.sel().map(i => i.slice(0, 6))}]`);

        // ---- 步2 Shift+2 追加组2：H 展开 → [A,E,F,H,I] ----
        t.keyAdd(2);
        await raf2();
        const exp2 = sortedEq(t.sel(), [A, E, F, H, I]);
        step('[STATE] Shift+2：追加组2 同样展开 → [A,E,F,H,I]', exp2, `selection=[${t.sel().map(i => i.slice(0, 6))}]`);

        // ---- 步3 原子性 + 不变式 ----
        const sel = t.sel();
        const atomic = sel.includes(E) === sel.includes(F) && sel.includes(H) === sel.includes(I);
        const inv = invariants();
        step('[STATE] 单元原子不变式（含 E ⇔ 含 F；含 H ⇔ 含 I）+ 共享数据不变式', atomic && inv.keyOK && inv.mergeOK && inv.groupsOK,
          `原子=${atomic} 不变式=${inv.keyOK}/${inv.mergeOK}/${inv.groupsOK}`);
        const r = await cmpShot('gr07-expand');
        cmpStep(step, r);
      },
    },
  ];

  // ---- 过滤 + 包装（输入流水/数据快照/每线独立场景） ----
  const selected = defs.filter(d => !only || d.id === only);
  const wrapped = selected.map(d => ({
    id: d.id, name: d.name,
    async run(kitArgs) {
      const t = await setup(`GR ${d.id}`, { grouping: d.id === 'GR-05' ? 'gender' : 'none' }); // GR-05 首场景走默认 gender
      const mark = inLog.length;
      try {
        await d.run(t, kitArgs);
      } finally {
        d.log = inLog.slice(mark);
        d.snapAfter = { positions: JSON.parse(JSON.stringify(fmt().positions)), merges: fmt().merges || [], groups: JSON.parse(JSON.stringify(state().project.groups || [])), selection: t.sel(), hist: t.hist(), gesture: sv.gesture.state() };
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
    phase: 'M', hw: 'mouse', build: window.__MAIN_BUILD, dpr: dprOf(),
    view: { ...sv.view }, rpx: 0.38 * sv.view.scale,
    canvas: { left: r.left, top: r.top, w: r.width, h: r.height },
    idsCount: (store.getState().project?.dancers || []).length,
    groupsCount: (store.getState().project?.groups || []).length,
  };
  return { phase: 'M', cases: results, shots, meta };
}
