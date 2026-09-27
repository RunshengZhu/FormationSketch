// 应用编排：视图路由、状态订阅渲染、交互接线、快捷键
import * as store from './store.js';
import * as M from './model.js';
import * as shapes from './shapes.js';
import { StageView, drawScene } from './stage.js';
import { EditStrip, MusicTimeline } from './timeline.js';
import { AudioController } from './audio.js';
import { Player } from './player.js';
import { clipEnd, lastClipEndSec, clipEdgeStepSec, CLIP_COLORS } from './audio-clips.js';
import { uid } from './model.js';
import * as exp from './export.js';
import { renderLibrary, showNewProjectModal, showRosterModal, toast, h, createHistorySentinel,
  showMediaLibraryModal, showContextMenu, closeContextMenu, fmtSize } from './ui.js';
import { renderManual } from './manual.js';
import { iconHtml } from './icons.js';
// Node 单测直接 import 本模块（深链纯函数）：window 判存守卫；build-single.mjs 由此行正则解析版本号，勿改形态
if (typeof window !== 'undefined') window.__MAIN_BUILD = 'build-40-dragfix';
const BUILD_TAG = (typeof window !== 'undefined' ? window.__MAIN_BUILD : 'build-40-dragfix');

const $ = id => document.getElementById(id);
// Node 测试环境（tests/app-deeplink.test.js 直接 import 本模块的深链纯函数）没有 Audio 全局：
// 延迟判存——浏览器恒有 Audio，行为零变化；Node 下置 null（boot 不会执行，null 永不被使用）。
const audio = typeof Audio !== 'undefined' ? new AudioController() : null;
let player, stageView, leftStrip, musicTl;
let propsKey = '', audioPanelBuilt = false;

// ---------- 选择 ----------
// 单元原子性：点选/shift/多选/框选命中合并单元任一成员 = 整单元（两名成员）入选或移出；
// 拖动任一成员 = 整单元同步位移（仅当整单元已在多选中时才随整组选择一起拖）。
// 未合并舞者行为不变：选择只作用于其本身；共同移动仅来自框选/多选/编组。
function expandedSelection() {
  return [...store.getState().selection];
}
function selectIds(ids, { add = false, toggleOff = false } = {}) {
  const s = store.getState();
  let next;
  if (add) {
    const cur = new Set(s.selection);
    for (const id of ids) { if (toggleOff) cur.delete(id); else cur.add(id); }
    next = [...cur];
  } else next = ids;
  store.setUI({ selection: next });
}
function currentFormation() {
  const s = store.getState();
  return s.project?.formations[s.formationIndex] || null;
}
function stageScene() {
  const s = store.getState();
  const p = s.project;
  // 编辑开关（默认开）：编辑视图优先，舞台始终可拖动；真实播放期间临时切到回放画面
  // 查看模式（开关关）：舞台始终跟随时间轴播放头，只读
  const playing = !!(player && player.playing);
  const showPlayback = s.editMode ? playing : true;
  const pr = showPlayback && p ? M.posAt(p, player.beat) : null;
  return {
    project: p,
    formation: currentFormation(),
    merges: currentFormation()?.merges || [],
    formationIndex: s.formationIndex,
    selection: new Set(expandedSelection()),
    multiSelect: s.multiSelect,
    singleSelected: s.selection.length === 1, // 朝向把手按原始选择判定（单元联动会扩成 2 个）
    facingHandle: s.showFacingHandle,
    showGhost: s.showGhost,
    showPaths: s.showPaths,
    showGrid: s.showGrid,
    playbackPos: pr ? pr.positions : null,
    phase: pr ? pr.phase : 'hold',
    readOnly: s.editMode ? playing : true,
    theme: s.theme,
  };
}

// ---------- 单元浮窗（合并确认 / 单元操作）+ SelectionMenu（多选弹框，round46 Lane A·决策④） ----------
let unitMenuEl = null;
const UNIT_STYLE_LABEL = { capsule: '胶囊', single: '单编号' };
// SelectionMenu 条目推导（纯函数，node 可测）：按 selection 构成决定可见项（同一骨架、条件显隐）。
// 决策④操作集：朝向（恒有；「互相对齐」仅恰 2 人）、存为编组/移出队形（N≥2）、均布（N≥3，
// distributeAxis 模型语义 <3 人无效果，故呈示收在 N≥3）、删除（恒在末位，红色）；
// 恰 2 人未合并=「合并为单元」；涉及合并单元=「取消合并」（既有语义）。
// N=1 特例：showUnitMenu 对单人 context 载荷保持既有构成（title+删除+关闭图标）——page-r R-02/R-04
// 仪器断言单人菜单 ['删除','关闭']（关闭=✕ 图标化后的 aria-label 口径，汇合轮仪器同步改写）；
// spec 仍按同构口径给出，仅在呈示层收口。
export function selectionMenuSpec({ count, pairEligible = false, mergedInvolved = false }) {
  const items = [];
  if (count >= 1) items.push({ kind: 'facing', eachOther: count === 2 });
  if (count >= 2) items.push({ kind: 'saveGroup' });
  if (count === 2 && pairEligible) items.push({ kind: 'mergeUnit' });
  if (mergedInvolved) items.push({ kind: 'unmerge' });
  if (count >= 3) items.push({ kind: 'distribute' });
  if (count >= 2) items.push({ kind: 'removeFromFormation' });
  items.push({ kind: 'delete', label: count === 1 ? '删除' : `删除所选（${count} 人）` });
  return items;
}
function hideUnitMenu() {
  if (unitMenuEl) { unitMenuEl.remove(); unitMenuEl = null; }
  stageView?.gestureMenuClosed?.(); // 让手势状态机知道浮窗已关（否则下次按下会被 MENU 态吞掉）
}
function showUnitMenu(payload) {
  if (unitMenuEl) { unitMenuEl.remove(); unitMenuEl = null; } // 纯 DOM 替换，不通知状态机（弹出方是状态机自己）
  const wrap = document.getElementById('stage-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'unit-menu';
  // 删除（拆分/删除唯一入口之一）：复用名册删除的同一模型层逻辑 M.removeDancer——
  // 从 dancers/groups/所有队形 positions 与 merges 中移除，经 store.mutate 提交可 undo。
  const mkDeleteBtn = () => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = '删除';
    b.style.color = '#ef4444'; // 危险动作着色（内联样式，避免动样式表）
    b.addEventListener('click', () => {
      const label = payload.mode === 'unit' ? '删除单元（两名舞者）' : '删除舞者';
      store.mutate(p => { for (const id of payload.ids) M.removeDancer(p, id); }, label);
      store.setUI({ selection: store.getState().selection.filter(id => !payload.ids.includes(id)) });
      hideUnitMenu();
    });
    return b;
  };
  // DEFECT-R-1：context 载荷按有无 merge 分流菜单构成。状态机（gesture.js）对合并成员
  // 本就直接发 unit 载荷；此处再按 ids[0] 是否在当前队形 merges 中兜底，保证
  // 「context+无 merge=仅删除 / context+有 merge=单元按钮组」与合并状态一致。
  const ctxMerge = payload.mode === 'context'
    ? (currentFormation()?.merges || []).find(x => x.a === payload.ids[0] || x.b === payload.ids[0]) || null
    : null;
  if (ctxMerge && payload.ids.length < 2) {
    payload.ids = [ctxMerge.a, ctxMerge.b]; // 补全另一成员 id：样式/拆开按钮的模型操作需要两人
    payload.style = ctxMerge.style;         // 当前样式高亮与 unit 菜单一致
  }
  if (payload.mode === 'merge') {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = '合并为单元';
    el.append(title);
  } else if (payload.mode === 'multi') {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = `所选 ${payload.ids.length} 人`;
    el.append(title);
  } else if (payload.mode === 'context' && !ctxMerge) {
    // 未合并舞者的上下文菜单（触摸/笔长按、鼠标右键共用）：仅「删除」
    const d = M.dancerById(store.getState().project, payload.ids[0]);
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = `舞者 · ${d ? d.name : '?'}`;
    el.append(title);
    el.append(mkDeleteBtn());
  } else {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = '合并单元';
    el.append(title);
  }
  // 样式按钮（合并确认时点击即以该样式创建；单元操作时切换样式）
  const mkStyleBtn = sty => {
    const b = document.createElement('button');
    b.className = 'um-btn' + (payload.style === sty ? ' um-cur' : '');
    b.textContent = UNIT_STYLE_LABEL[sty] || sty;
    b.addEventListener('click', () => {
      if (payload.mode === 'merge') {
        store.mutate(p => {
          const f = p.formations[store.getState().formationIndex];
          if (!f) return;
          M.addMerge(f, payload.ids[0], payload.ids[1], sty);
          M.collapseUnit(f, payload.ids[0], payload.ids[1]);
        }, '合并单元');
      } else {
        store.mutate(q => { M.setMergeStyle(q.formations[store.getState().formationIndex], payload.ids[0], payload.ids[1], sty); }, '切换单元样式');
      }
      hideUnitMenu();
    });
    return b;
  };
  // 拆分按钮（即既有「拆开」入口，规格 #9：移除 merge 记录、两人原地保留）：
  // 按钮文案保持「拆开」——L2 仪器 page-l2 以文本匹配点击该按钮，改名留给 reviewer 同步
  const mkUntieBtn = () => {
    const untie = document.createElement('button');
    untie.className = 'um-btn';
    untie.innerHTML = iconHtml('razor') + ' 拆开'; // 图标化（决策⑤）：razor+文字，仪器按文本「拆开」匹配
    untie.addEventListener('click', () => {
      store.mutate(q => { M.removeMerge(q.formations[store.getState().formationIndex], payload.ids[0], payload.ids[1]); }, '拆开单元');
      // 拆开后两人成为独立舞者：清掉原单元选择，避免下一次拖动走组拖路径（拆开→各自拖动）
      store.setUI({ selection: store.getState().selection.filter(id => !payload.ids.includes(id)) });
      hideUnitMenu();
    });
    return untie;
  };
  // 多选菜单按钮（mode='multi'，round23 需求 1）：操作对象=整个 selection（N=展开单元后人数）。
  // 恰选 2 人且未合并 → 「合并为单元」（capsule 建单元，与面板按钮同语义）；
  // 涉及合并单元 → 「取消合并」（拆开所有涉及单元，成员原地保留，涉及成员移出选择防组拖残留）；
  // 「删除所选（N 人）」恒可用（替代单人「删除」）。样式按钮不在此出现——恰选一个单元时
  // 状态机已分流到既有单元浮窗（样式按钮唯一出现处）。
  const mkMultiMergeBtn = () => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = '合并为单元';
    b.addEventListener('click', () => {
      store.mutate(p => {
        const f = p.formations[store.getState().formationIndex];
        if (!f) return;
        M.addMerge(f, payload.ids[0], payload.ids[1], 'capsule');
        M.collapseUnit(f, payload.ids[0], payload.ids[1]);
      }, '合并单元');
      hideUnitMenu();
    });
    return b;
  };
  const mkMultiUntieBtn = involved => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.innerHTML = iconHtml('razor') + ' 取消合并';
    b.addEventListener('click', () => {
      store.mutate(p => {
        const f = p.formations[store.getState().formationIndex];
        for (const m of involved) M.removeMerge(f, m.a, m.b);
      }, '取消合并');
      const touched = new Set(involved.flatMap(m => [m.a, m.b]));
      store.setUI({ selection: store.getState().selection.filter(id => !touched.has(id)) });
      hideUnitMenu();
    });
    return b;
  };
  const mkMultiDeleteBtn = n => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = `删除所选（${n} 人）`;
    b.style.color = '#ef4444'; // 危险动作着色（同单人删除）
    b.addEventListener('click', () => {
      store.mutate(p => { for (const id of payload.ids) M.removeDancer(p, id); }, `删除所选（${n} 人）`);
      store.setUI({ selection: store.getState().selection.filter(id => !payload.ids.includes(id)) });
      hideUnitMenu();
    });
    return b;
  };
  // ---- SelectionMenu 群体项（round46·决策④）：与单人 .unit-menu 同骨架（.um-row/.um-btn），
  //      操作对象=整个 selection（单元原子展开后的 payload.ids）----
  // 朝向 ▸（观众/圆心复用 shapes.faceAll；「互相对齐」仅恰 2 人：各自面向对方）
  const mkFacingRow = ids => {
    const row = document.createElement('div');
    row.className = 'um-row';
    const mk = (label, target) => {
      const b = document.createElement('button');
      b.className = 'um-btn';
      b.textContent = label;
      b.title = target === 'eachOther' ? '两人各自面向对方' : '对所选全部舞者统一朝向';
      b.addEventListener('click', () => {
        store.mutate(p => {
          const f = p.formations[store.getState().formationIndex];
          if (!f) return;
          if (target === 'eachOther') {
            const [a, bb] = ids;
            const pa = f.positions[a], pb = f.positions[bb];
            if (pa && pb) { pa.facing = Math.round(shapes.angleTo(pa, pb)); pb.facing = Math.round(shapes.angleTo(pb, pa)); }
          } else {
            shapes.faceAll(f.positions, ids, target, { stage: p.stage });
          }
        }, target === 'eachOther' ? '互相对齐' : '统一朝向');
        hideUnitMenu();
      });
      return b;
    };
    row.append(h('span', { class: 'um-lab' }, '朝向'), mk('面向观众', 'audience'), mk('面向圆心', 'center'));
    if (ids.length === 2) row.append(mk('互相对齐', 'eachOther'));
    return row;
  };
  // 存为编组（与「＋ 存为编组」/Ctrl+N 自动命名路径同语义：createGroup，不覆盖既有组）
  const mkSaveGroupBtn = ids => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = `存为编组（${ids.length} 人）`;
    b.addEventListener('click', () => {
      let gname = '';
      store.mutate(p => { p.groups = p.groups || []; gname = M.createGroup(p, ids).name; }, '存为编组');
      toast(`已存为编组「${gname}」(${ids.length} 人)`);
      hideUnitMenu();
    });
    return b;
  };
  // 均布（N≥3）：纵/横双钮（模型语义 <3 人无效果，不呈示死入口；与工具栏「均布」同 shapes.distributeAxis）
  const mkDistributeRow = ids => {
    const row = document.createElement('div');
    row.className = 'um-row';
    const mk = (label, axis) => {
      const b = document.createElement('button');
      b.className = 'um-btn';
      b.textContent = label;
      b.title = axis === 'y' ? '按纵向（前后）等间距排开' : '按横向（左右）等间距排开';
      b.addEventListener('click', () => {
        store.mutate(p => {
          const f = p.formations[store.getState().formationIndex];
          shapes.distributeAxis(f.positions, ids, axis);
        }, '等间距');
        hideUnitMenu();
      });
      return b;
    };
    row.append(h('span', { class: 'um-lab' }, '均布'), mk('纵', 'y'), mk('横', 'x'));
    return row;
  };
  // 移出队形（=Del 键同语义：从当前队形清位，名册保留、可撤销）
  const mkRemoveBtn = ids => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = `移出队形（${ids.length} 人）`;
    b.title = '从当前队形清位（名册保留；Del 键同语义）';
    b.addEventListener('click', () => {
      store.mutate(p => {
        const f = p.formations[store.getState().formationIndex];
        for (const id of ids) delete f.positions[id];
      }, '移出队形');
      store.setUI({ selection: store.getState().selection.filter(id => !ids.includes(id)) });
      hideUnitMenu();
    });
    return b;
  };
  // 按钮区按 mode 分支（DEFECT-R-1 根因：原 else 同时覆盖 context 与 unit 两种 mode）：
  // merge → 样式×2；unit → 拆开+样式×2+删除（既有顺序不变）；context+有 merge → 样式×2+拆开+删除；
  // context+无 merge → 标题分支已加「删除」，此处不追加（N=1 特例：保持既有 ['删除','✕'] 构成，
  //   page-r R-02/R-04 仪器精确断言——SelectionMenu 群体项自 N≥2 起，见 selectionMenuSpec 注释）；
  // multi → SelectionMenu（决策④）：朝向▸ → 存为编组 → [合并为单元|取消合并] → [均布 纵/横] →
  //   移出队形 → 删除所选（N 人）。✕ 取消按钮在下方对所有形态统一追加。
  if (payload.mode === 'merge') {
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
  } else if (payload.mode === 'unit') {
    el.append(mkUntieBtn());
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
    el.append(mkDeleteBtn()); // 删除单元 = 两名成员一并从队形与名册移除
  } else if (payload.mode === 'multi') {
    const involved = (currentFormation()?.merges || []).filter(m => payload.ids.includes(m.a) || payload.ids.includes(m.b));
    el.append(mkFacingRow(payload.ids));
    el.append(mkSaveGroupBtn(payload.ids));
    if (payload.ids.length === 2 && !involved.length) el.append(mkMultiMergeBtn());
    if (involved.length) el.append(mkMultiUntieBtn(involved));
    if (payload.ids.length >= 3) el.append(mkDistributeRow(payload.ids));
    el.append(mkRemoveBtn(payload.ids));
    el.append(mkMultiDeleteBtn(payload.ids.length));
  } else if (ctxMerge) {
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
    el.append(mkUntieBtn());
    el.append(mkDeleteBtn());
  }
  const cancel = document.createElement('button');
  cancel.className = 'um-btn um-cancel';
  cancel.innerHTML = iconHtml('close'); // 图标化（决策⑤）：关闭钮呈 ✕ 图标，aria 语义供仪器/读屏
  cancel.setAttribute('aria-label', '关闭');
  cancel.title = '关闭';
  cancel.addEventListener('click', hideUnitMenu);
  el.append(cancel);
  wrap.append(el);
  unitMenuEl = el;
  // 定位并钳制在容器内
  const wr = wrap.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(payload.screen.x - 40, wr.width - el.offsetWidth - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(payload.screen.y + 10, wr.height - el.offsetHeight - 4)) + 'px';
}

// ---------- history 哨兵（F-04 / UX-04） + 右键策略（F-08 / UX-08） ----------
// 哨兵：进编辑器 pushState 恰一条（决策机在 ui.js，node 可测）；popstate 在编辑器内发生
// =应用内回库（与点「‹ 项目库」完全同语义：stop+closeProject），再次返回才真正离开；
// 前进到哨兵=重开该项目；应用内回库时决策机弹掉哨兵 → 库⇄编辑器往返不堆积条目。
const sentinel = createHistorySentinel({
  push: () => history.pushState({ fs: 'editor', pid: store.getState().projectId }, ''),
  back: () => history.back(),
  state: () => history.state,
});
let sentinelView = null;
function trackViewForSentinel(view) {
  if (view === sentinelView) return;
  const prev = sentinelView;
  sentinelView = view;
  if (view === 'editor' && prev !== 'editor') sentinel.enter();
  else if (view === 'library' && prev === 'editor') sentinel.exitUi();
}
function wireHistory() {
  window.addEventListener('popstate', e => {
    const act = sentinel.onPop(e.state, store.getState().view);
    if (act.action === 'toLibrary') { player?.stop(); store.closeProject(); }
    else if (act.action === 'reopen' && act.pid) {
      store.openProject(act.pid).then(ok => { if (!ok) history.replaceState(null, ''); }); // 项目已被删：摘掉标记防卡死条目
    }
  });
}
// 右键策略：编辑器视图内统一拦截浏览器原生菜单（与画布自定义菜单同一防御面，
// 消除时间轴/播放条/面板的漏拦拼盘）；输入框/文本域/下拉与名册表格豁免（保留系统
// 粘贴/拼写菜单）。项目库视图不在此拦（卡片右键有自己的显性菜单，见 ui.js F-09）。
function wireContextMenu() {
  document.addEventListener('contextmenu', e => {
    if (store.getState().view !== 'editor') return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, .roster-table')) return;
    e.preventDefault();
  });
}

// ---------- Phase 4 · 深链导入（docs/choreo-skill-plan.md Phase 4，与 skill 线 publish.mjs 的契约） ----------
// 契约 URL：GET /apps/wuzhen/index.html?import=<encodeURIComponent(项目 JSON 的 URL)>
// 行为：boot（store init 完成后）解析 import 参数 → fetch（仅同源 http / 任意 https，见
// resolveImportUrl）→ JSON → M.validateProject → store.importProject（新建 id、标题加「（副本）」，
// 不覆盖既有项目）→ history.replaceState 剥掉 import 参数（防刷新重导入）→ toast「已导入项目 X」。
// 显式深链优先于 lastProject 自动恢复（深链在 init 之后执行、整体覆盖状态）；失败路径 toast 明确
// 错误并正常进应用既有视图，不 crash、无未捕获异常（本函数全部错误都在内部转成结果对象）。
// SW 侧配套：dist/sw.js 对导航请求 cache.match(..., {ignoreSearch:true}) + './' 回退——带 query
// 的深链在断网时也能打开（scripts/build-single.mjs swSource）。
// 纯函数 + 依赖注入（fetchImpl/validate/importProject/toast/replaceState），node 可测。
export function parseImportParam(hrefOrSearch) {
  if (typeof hrefOrSearch !== 'string' || !hrefOrSearch) return null;
  const qi = hrefOrSearch.indexOf('?');
  if (qi === -1) return null;
  let search = hrefOrSearch.slice(qi);
  const hi = search.indexOf('#');
  if (hi !== -1) search = search.slice(0, hi); // hash 不属于 query 值
  try {
    const v = new URLSearchParams(search).get('import');
    return v && v.trim() ? v : null;
  } catch { return null; }
}
export function stripImportParam(href) { // 只摘 import 参数，其余 query/hash 原样保留
  if (typeof href !== 'string' || !href) return href;
  const hi = href.indexOf('#');
  const hash = hi === -1 ? '' : href.slice(hi);
  const noHash = hi === -1 ? href : href.slice(0, hi);
  const qi = noHash.indexOf('?');
  if (qi === -1) return href;
  let sp;
  try { sp = new URLSearchParams(noHash.slice(qi)); } catch { return href; }
  if (!sp.has('import')) return href;
  sp.delete('import');
  const rest = sp.toString();
  let head = noHash.slice(0, qi);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(head)) { // 绝对 URL → 同文档相对形态（pathname 起，replaceState 更稳）
    try { head = new URL(head).pathname; } catch {}
  }
  return head + (rest ? '?' + rest : '') + hash;
}
export function resolveImportUrl(raw, baseUrl) { // 仅 https（任意 host）或 http 同源；其余拒绝
  try {
    const u = new URL(raw, baseUrl || undefined);
    if (u.protocol === 'https:') return u;
    if (u.protocol === 'http:') {
      const origin = (typeof location !== 'undefined' && location.origin) || (baseUrl ? new URL(baseUrl).origin : '');
      if (origin && u.origin === origin) return u;
    }
    return null;
  } catch { return null; }
}
export async function runDeeplinkImport(deps) {
  const url = typeof deps.url === 'string' ? deps.url : '';
  const raw = parseImportParam(url);
  if (raw == null) return { status: 'none' };
  const cleaned = stripImportParam(url);
  const done = res => {
    try { deps.replaceState?.(cleaned); } catch {} // 成败都清参：刷新不再重导入/重报错
    if (res.status === 'error' && res.message) deps.toast?.(res.message);
    return res;
  };
  const u = resolveImportUrl(raw, deps.baseUrl || url);
  if (!u) return done({ status: 'error', reason: 'scheme', message: '深链导入失败：项目文件地址仅支持同源或 https' });
  let resp;
  try { resp = await deps.fetchImpl(u.href, { redirect: 'follow' }); }
  catch (e) { return done({ status: 'error', reason: 'network', message: `深链导入失败：无法获取项目文件（${e?.message || '网络异常'}）` }); }
  if (!resp.ok) return done({ status: 'error', reason: 'http', httpStatus: resp.status, message: `深链导入失败：项目文件无法获取（HTTP ${resp.status}）` });
  let json;
  try { json = JSON.parse(await resp.text()); }
  catch { return done({ status: 'error', reason: 'parse', message: '深链导入失败：文件不是合法 JSON' }); }
  // v2 项目文件可内嵌音乐：v3 多资产（media.assets[i].dataBase64）+ 旧单音频（audio.dataBase64）。
  // validateProject 会剥离内嵌字段，先还原为 Blob，导入后回填。
  let audioBlob = null;
  const assetBlobs = [];
  try {
    for (const a of (json?.media?.assets || [])) {
      if (a && a.dataBase64) {
        const bin = atob(String(a.dataBase64));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        assetBlobs.push({ id: typeof a.id === 'string' ? a.id : null, name: String(a.name || 'audio'), blob: new Blob([bytes], { type: a.dataFormat || 'audio/mpeg' }) });
        delete a.dataBase64;
        delete a.dataFormat;
      }
    }
    if (json && json.audio && json.audio.dataBase64) {
      const bin = atob(String(json.audio.dataBase64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      audioBlob = new Blob([bytes], { type: json.audio.dataFormat || 'audio/mpeg' });
      delete json.audio.dataBase64;
      delete json.audio.dataFormat;
    }
  } catch { audioBlob = audioBlob || null; }
  const r = deps.validate(json);
  if (!r.ok) return done({ status: 'error', reason: 'validate', errors: r.errors, message: `深链导入失败：${r.errors[0] || '项目校验未通过'}` });
  deps.importProject(r.project);
  if (assetBlobs.length) {
    try { await deps.onAssets?.(assetBlobs, r.project); } catch {}
  }
  if (audioBlob) { try { await deps.onAudio?.(audioBlob); } catch {} }
  const title = r.project.meta.title || '导入项目';
  const restored = assetBlobs.length ? true : !!audioBlob;
  deps.toast?.(`已导入项目：${title}${restored ? '（音乐已恢复）' : ''}`);
  return done({ status: 'imported', title, hasAudio: restored, project: r.project });
}
async function wireDeeplinkImport() {
  try {
    await runDeeplinkImport({
      url: location.href,
      baseUrl: location.href,
      fetchImpl: (u, o) => fetch(u, o),
      validate: M.validateProject,
      importProject: p => { player?.stop(); store.importProject(p); },
      onAssets: assetBlobs => restoreProjectAudio(assetBlobs, null), // v3 多资产内嵌回填（id 保持）
      onAudio: async blob => { // 与「导入项目文件…」同语义：内嵌音乐回填到新项目 id
        await restoreProjectAudio([], blob);
      },
      toast,
      replaceState: cleaned => history.replaceState(null, '', cleaned),
    });
  } catch (e) {
    console.error('深链导入异常', e);
    toast('深链导入失败：应用内部错误');
  }
}

// ---------- 启动 ----------
// E2E 就绪信号（确定性完成信号，替代 boot 盲等）：boot 全流程（store init + lastProject 恢复
// + 深链 + 首帧渲染 + 订阅挂载）完成后 resolve；消费方重复读取返回同一 Promise；
// boot 已完成后再读取即为 resolved 态。Node 导入（无 document）不 boot，永不 resolve（无害）。
let __fsReadyResolve;
const __fsReady = new Promise(res => { __fsReadyResolve = res; });
async function boot() {
  buildStage();
  buildPlayer();
  buildStrips();
  applyUiMode(musicTl?.mode || 'stage'); // 双 UI 模式：boot 即套用（localStorage 记忆/旧展开键迁移）
  wireTopbar();
  wireStageTools();
  wirePlaybar();
  wireAudioPanel();
  wireMusicToolbar();   // W1：音乐工具条（资产组/打点/BPM/首拍/尺规组/自动划分）
  wireMusicPreview();   // W1：队形 mini-preview 栏（只读画布 + 块 ±1 拍步进 + 对齐到播放头）
  wireMobileTabs();
  wireManual();
  wireLibrary();
  wireOfflineNote();
  wireKeyboard();
  wireHistory();
  wireContextMenu();
  try {
    applyTheme(store.getState().theme);
    await store.init(localStorage.getItem('fs.lastProject') || undefined);
  } catch (e) {
    console.error('初始化失败', e);
    toast('本地存储不可用，已进入空项目库');
    store.setUI({ view: 'library' });
  }
  await restoreAudio(); // 自动恢复上次项目时同步恢复音频
  await wireDeeplinkImport(); // Phase 4 深链：在 init 之后执行 → 显式 import 参数优先于 lastProject 自动恢复
  render(store.getState());
  store.subscribe(render);
  __fsReadyResolve(); // E2E 信号：boot 完成（首帧已渲染、订阅已挂）
}
function buildStage() {
  const cv = $('stage-canvas');
  stageView = new StageView(cv, cv.getContext('2d'), stageScene, {
    select: selectIds,
    mutateLive: fn => store.mutate(fn, null),
    commit: commitWithThumbs,
    showUnitMenu: showUnitMenu,
    hideUnitMenu: hideUnitMenu,
  });
  new ResizeObserver(() => stageView.requestDraw()).observe($('stage-wrap'));
}
// 提交历史并刷新队形缩略图
function commitWithThumbs(label) {
  store.commit(label);
  leftStrip?.drawThumbs();
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f1f5f9' : '#0f172a';
}
// 播放键呈示态（图标化·决策⑤）：全部播放/数拍/结束分支共用此出口，保证 svg[data-icon]
// 恒为 play|pause 二态之一（E2E 仪器按 data-icon 断言，替代原 ▶/⏸ 文本口径）。
function setPlayBtn(playing) {
  const b = $('pb-play');
  if (b) b.innerHTML = iconHtml(playing ? 'pause' : 'play');
}
function buildPlayer() {
  player = new Player({
    audio,
    getProject: () => store.getState().project,
    getMode: () => musicTl?.mode || 'stage', // M1 风险 R1：引擎按 UI 模式分域（music=秒域自由，stage=编舞域不变）
    onTick: t => {
      const proj0 = store.getState().project;
      // 任务#20：数拍期播放头呈「入场」（beatLabel 会把负拍钳成 1.1，这里不覆写 onCountin 的呈示）
      if (!player.countin) $('pb-pos').textContent = proj0 ? M.beatLabel(proj0, t.beat) : '—';
      const f = store.getState().project?.formations[t.formationIndex];
      $('pb-formation').textContent = f ? `${t.formationIndex + 1}. ${f.name}` : '';
      // 真实播放中高亮跟随节拍；切帧预览/seek 不抢占用户选择的队形
      if (player.playing && !player.previewing && store.getState().formationIndex !== t.formationIndex) {
        store.setUI({ formationIndex: t.formationIndex });
        if (document.getElementById('pb-loop').checked) updateLoop();
      }
      stageView?.requestDraw();
      musicTl?.drawPlayhead();
      siTick(); // W4：面板开着时播放头行/当前行高亮实时跟随（关着零开销）
      drawMusicPreview(); // W1：preview 栏随播放头同步（formationIndex 高亮 + 当前块信息，IR-W1-5）
    },
    onPreviewEnd: () => {
      // 预览结束回到编辑视图：播放头归零，舞台显示当前所选队形
      player.seekBeat(0);
      stageView?.requestDraw();
      musicTl?.drawPlayhead();
    },
    onStateChange: ({ playing, reason }) => {
      setPlayBtn(playing);
      if (!playing) renderUndoButtons();
      // 任务#7（报告#8）：音频先于时间轴自然结束——一次性 toast，播放头停在音频末拍
      if (reason === 'audio') toast('音乐已结束');
      updateMusicLock(); // 任务#2：播放/暂停切换即刷新 BPM/首拍锁
    },
    onCountin: n => {
      const ov = $('countin-overlay');
      // W3（C17 修 P12）：音乐模式舞台隐藏（#editor-main display:none），挂在 #stage-wrap 的
      // overlay 在该模式不可见——数拍入场大字改落音乐 preview 条（#mp-countin，两模式互斥呈示）。
      // 编舞模式 overlay 行为零变化（既有仪器口径）。
      const mc = $('mp-countin');
      const inMusic = musicTl?.mode === 'music';
      if (n > 0) {
        ov.hidden = false; ov.textContent = n;
        if (mc) {
          if (inMusic) { mc.hidden = false; mc.textContent = n; }
          else mc.hidden = true;
        }
        // 任务#20（P3 cosmetic）：数拍期播放头显示「入场」、播放键呈 ⏸（可点击=取消倒计）
        $('pb-pos').textContent = '入场';
        setPlayBtn(true);
      } else {
        ov.hidden = true;
        if (mc) mc.hidden = true;
        setPlayBtn(player.playing);
      }
      updateMusicLock();
    },
  });
}
function buildStrips() {
  const hooks = {
    getProject: () => store.getState().project,
    getIndex: () => store.getState().formationIndex,
    select: i => switchFormation(i),
    add: () => addFormation(),
    duplicate: i => addFormation(i),
    delete: () => deleteFormation(),
    move: (from, to) => { player.pause(); store.mutate(p => M.moveFormation(p, from, to), '调整队形顺序'); },
  };
  leftStrip = new EditStrip($('formation-list'), hooks);
  musicTl = new MusicTimeline({
    canvas: $('tl-canvas'), overlay: $('tl-overlay'), scroll: $('tl-scroll'),
    hooks: {
      getProject: () => store.getState().project,
      getProjectId: () => store.getState().projectId,
      getPlayer: () => player,
      audio,
      getIndex: () => store.getState().formationIndex,
      ripple: () => store.getState().ripple,
      canEdit: () => store.getState().editMode, // 编辑锁：关闭=clip 编辑禁用（选择/预览可用）
      pauseIfPlaying: () => { if (player.playing || player.countin) player.pause(); }, // 守卫：播放中先自动暂停
      onSelectFormation: i => switchFormation(i),
      mutate: fn => store.mutate(fn, null),
      mutateLabeled: (fn, label) => store.mutate(fn, label), // 标记打点/改名/删除：单操作即时一条历史
      commitEdit: label => { store.commit(label); syncLoopAfterBlockEdit(); }, // 拖边改时长后循环区间跟随（DEFECT-R26-4）
      seekBeat: b => player.seekBeat(Math.max(0, b)),
      toast,
      onTimeSelection: applyTimeSelLoop,   // C11：播放限制在选区=临时循环
      previewClip,                          // C12：双击 clip=选中并循环预览
      onClipContextMenu: showClipMenu,      // §4：右键菜单
      onSegContextMenu: showSegMenu,        // W1 §2.2.1：节奏划分轨段右键（拆分/合并/删除/换色）
    },
  });
}
// ---- v3：时间选区临时循环 / clip 循环预览 ----
function applyTimeSelLoop(range) {
  if (!player) return;
  const p = store.getState().project;
  if (!p) return;
  if (range && range.end - range.start > 0.05) {
    player.setLoop(true, Math.max(0, M.secToBeat(p, range.start)), Math.max(0, M.secToBeat(p, range.end)));
  } else if ($('pb-loop')?.checked) updateLoop();
  else player.setLoop(false, 0, 0);
}
function previewClip(clip) {
  if (!clip) return;
  player.pause();
  const p = store.getState().project;
  if (!p) return;
  const b0 = Math.max(0, M.secToBeat(p, clip.timelineStartSec));
  const b1 = Math.max(b0 + 0.01, M.secToBeat(p, clipEnd(clip)));
  player.setLoop(true, b0, b1);
  player.play(b0, { countIn: false });
  toast(`循环预览「${clip.name || '音频剪辑'}」——停止后恢复循环设置`);
}
// ---- v3：音频剪辑右键菜单（规格 §4）----
// W2（修 E-10）：编舞模式简单道只读——右键不再出满血剪辑菜单（分割/修剪/淡化），
// 仅留「在音乐模式中编辑」跳转项；满血菜单为音乐模式专属。
function showClipMenu({ clipId, screenX, screenY }) {
  const p = store.getState().project;
  if (!p) return;
  if (musicTl.mode !== 'music') {
    showContextMenu([
      { label: '在音乐模式中编辑', fn: () => setUiMode('music') },
      { label: '取消', fn: () => {} },
    ], { x: screenX, y: screenY });
    return;
  }
  if (!clipId) {
    showContextMenu([{ label: '取消选择', fn: () => musicTl.clearClipSelection() }], { x: screenX, y: screenY });
    return;
  }
  if (!musicTl.clipSel.has(clipId)) { musicTl.clipSel = new Set([clipId]); musicTl.render(); }
  const clip = M.clipById(p, clipId);
  if (!clip) return;
  const swatches = h('div', { class: 'ctx-swatches' },
    ...CLIP_COLORS.map(c => h('button', { class: 'ctx-sw', style: `background:${c}`, title: '剪辑颜色', onclick: () => { closeContextMenu(); musicTl.setSelectedColor(c); } })));
  showContextMenu([
    { label: '分割于播放头(K)', fn: () => musicTl.splitAtPlayhead() },
    { label: '修剪到时间选区', fn: () => musicTl.trimSelectedToTimeSel() },
    { label: clip.muted ? '取消静音' : '静音', fn: () => musicTl.toggleMuteSelected() },
    { label: '波纹删除', fn: () => musicTl.deleteSelected(true) },
    { label: '删除', danger: true, fn: () => musicTl.deleteSelected(false) },
    { sep: true },
    { label: '重命名', fn: () => { const n = prompt('剪辑名称', clip.name || ''); if (n && n.trim()) musicTl.renameSelected(n); } },
    { el: swatches },
    { label: '增益重置', fn: () => musicTl.resetGainSelected() },
  ], { x: screenX, y: screenY });
}
// 手动切换队形帧：更新选中；若开启切帧预览，播放一段纯舞台 UI 动画（不经播放引擎、不动播放头/时间线）
function switchFormation(i) {
  player.pause(); // 无条件暂停（同时取消进行中的数拍入场）
  const s = store.getState();
  const changed = i !== s.formationIndex;
  // DEFECT-L2-2：getState() 是活引用，setUI 会原地覆盖 formationIndex——动画端点必须
  // 在 setUI 前暂存（from=切换前帧、to=目标帧，前后切换双向皆然），否则 from===to。
  const fromF = s.project?.formations[s.formationIndex] || null;
  const toF = s.project?.formations[i] || null;
  const { previewOnSwitch: previewOn, editMode } = s;
  store.setUI({ formationIndex: i, selection: [] });
  if (!editMode && player.beat > 0.001) player.seekFormation(i); // 查看模式：切换帧时播放头跟随所选队形
  if (changed && previewOn) {
    // 双向过渡动画：从切换前的帧插值到目标帧（此前只有向后切才播动画）
    stageView.startPositionsPreview(fromF, toF, 700);
  }
}
async function addFormation(after = null) {
  player.pause();
  const s = store.getState();
  const idx = after ?? s.formationIndex;
  const prevPos = M.clone(s.project.formations[idx]?.positions || {});
  store.mutate(p => { M.createFormationFrom(p, idx); }, '新队形');
  const ni = store.getState().formationIndex + 1;
  store.setUI({ formationIndex: ni, selection: [] });
  if (s.previewOnSwitch && ni > 0) {
    // 新帧动效：从上一帧流动到新帧（动线靠插入中间帧表达）
    const pf = store.getState().project;
    stageView.startPositionsPreview(pf.formations[ni - 1] || pf.formations[ni], pf.formations[ni], 700);
  }
}
function deleteFormation() {
  player.pause(); // 停掉进行中的预览/播放，避免 _stopAt 指向已删除的段
  const s = store.getState();
  if (s.project.formations.length <= 1) { toast('至少保留一个队形'); return; }
  store.mutate(p => { M.deleteFormation(p, s.formationIndex); }, '删除队形');
  store.setUI({ formationIndex: Math.max(0, Math.min(s.formationIndex, s.project.formations.length - 1)), selection: [] });
}

// ---------- 双 UI 模式（round46 Lane A·决策②/③）：编舞（默认）⇄ 音乐 ----------
// 尺规刻度按钮呈示（拍/秒）：render 与点击路径共用，保证即时与兜底两面一致。
// W1：编舞面板与音乐工具条孪生钮（-music）同步同款呈示。
function syncScaleToggle() {
  if (!musicTl) return;
  const isSec = musicTl.rulerScale === 'sec';
  for (const id of ['tl-scale-toggle', 'tl-scale-toggle-music']) {
    const scaleBtn = $(id);
    if (!scaleBtn) continue;
    scaleBtn.textContent = isSec ? '秒刻度' : '拍刻度';
    scaleBtn.classList.toggle('toggled-on', isSec);
    scaleBtn.title = isSec
      ? '当前：秒刻度（变速曲/无节拍音乐的降级对齐刻度）。点击切回拍刻度'
      : '尺规刻度：拍（小节/8 拍，恒定 BPM 口径）与秒（变速曲或无节拍音乐的降级对齐）切换。选择会记住';
  }
}
// 编舞模式=既有布局零变化；音乐模式：#editor-view[data-uimode="music"]（CSS 收窄舞台、
// 余量给属性面板）+ #block-ctl[hidden]（块时长栏）+ timeline 画布块区不绘制。
// 状态保持：选择/队形帧/tag/播放位置/循环/时间轴缩放/clip 选择跨模式与跨往返零丢失
// （只动呈示面，不清任何编辑态）。播放/数拍中禁止切换（决策裁定，toast「暂停后可切换」）。
function applyUiMode(mode) {
  const ev = document.getElementById('editor-view');
  if (ev) ev.dataset.uimode = mode === 'music' ? 'music' : 'stage';
  const bc = document.getElementById('block-ctl');
  if (bc) bc.hidden = mode === 'music';
  const bStage = document.getElementById('ui-mode-stage');
  const bMusic = document.getElementById('ui-mode-music');
  if (bStage && bMusic) {
    bStage.classList.toggle('active', mode !== 'music');
    bMusic.classList.toggle('active', mode === 'music');
    bStage.setAttribute('aria-pressed', String(mode !== 'music'));
    bMusic.setAttribute('aria-pressed', String(mode === 'music'));
  }
}
function setUiMode(mode, { silent = false } = {}) {
  if (player && (player.playing || player.countin)) {
    if (!silent) toast('暂停后可切换');
    return false;
  }
  const next = musicTl ? musicTl.setMode(mode) : (mode === 'music' ? 'music' : 'stage');
  applyUiMode(next);
  // DEFECT-R63-1：⏮⏭ title 随切模式立即刷新（clip 缘步进 ⇄ 队形步进），不等下一次 store render
  $('pb-prev').title = next === 'music' ? '上一个 clip 缘（无缘=开头）' : '上一队形';
  $('pb-next').title = next === 'music' ? '下一个 clip 缘（无缘=结尾）' : '下一队形';
  // W3 分键刻度：setMode 已恢复该模式自己的刻度，这里同步两枚刻度钮呈示（拍刻度/秒刻度）
  syncScaleToggle();
  // 舞台画布尺寸随布局变化：复位视图重新适配（舞台平移/缩放不属跨模式保持面；
  // 时间轴缩放 pps、选择、播放头、循环均不动）
  stageView?.resetView();
  musicTl?.render();
  // 修 E-06：切音乐模式立即补建轨头 DOM（此前须任意一次数据变更触发 store render 才补建——
  // syncTracksHead 唯一挂点在 main render，setUiMode 路径漏调）
  syncTracksHead(store.getState().project);
  drawMusicPreview(); // preview 栏切换即呈示（不等下一次 store render）
  return true;
}

// ---------- 顶栏 ----------
function wireTopbar() {
  $('btn-back').addEventListener('click', async () => { player?.stop(); await store.closeProject(); });
  $('proj-title').addEventListener('change', () => store.mutate(p => { p.meta.title = $('proj-title').value || '未命名'; }, '重命名项目'));
  // 右面板 Tab 切换（队形/舞台/样式/编组 + 📖 说明书）：页签与页容器按 data-tab/props-<tab> 约定配对，
  // 说明书页签用独立 class（.mtab，不属于 .ptab 计数——E2E 仪器断言「四页签」）
  document.querySelectorAll('.panel-tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.panel-tabs button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('#right-panel .props-page').forEach(pg => { pg.hidden = pg.id !== 'props-' + b.dataset.tab; });
  }));
  $('btn-theme').addEventListener('click', () => {
    const next = store.getState().theme === 'light' ? 'dark' : 'light';
    store.setUI({ theme: next });
    applyTheme(next);
  });
  $('btn-roster').addEventListener('click', () => {
    showRosterModal({ mutate: (fn, label) => store.mutate(fn, label), toast, getProject: () => store.getState().project });
  });
  $('btn-undo').addEventListener('click', () => { store.undo(); });
  $('btn-redo').addEventListener('click', () => { store.redo(); });
  // 双 UI 模式分段开关（两入口同态；快捷键 M 在 wireKeyboard）
  $('ui-mode-stage')?.addEventListener('click', () => setUiMode('stage'));
  $('ui-mode-music')?.addEventListener('click', () => setUiMode('music'));
  // 导出菜单
  const dd = $('export-dd'), menu = dd.querySelector('.dd-menu');
  $('btn-export').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('exp-png').addEventListener('click', () => { const f = currentFormation(); if (f) exp.exportPNG(store.getState().project, f, store.getState().theme); });
  $('exp-print').addEventListener('click', () => {
    try { exp.printFormations(store.getState().project, 'light'); } catch (e) { toast(e.message); }
  });
  // 取「应当随项目导出」的音频 Blob：优先本地存储（在线=IndexedDB）；下载版（file://→localStorage）
  // 音频不落盘、getAudio 恒为 null → 回退当前会话 AudioController 手里的 Blob（DEFECT-R26-2：）
  async function getExportAudioBlob() {
    const s = store.getState();
    let blob = null;
    try { blob = await store.storage.getAudio(s.projectId); } catch {}
    if (!blob && audio?.ready && audio.blob) blob = audio.blob;
    return blob;
  }
  // v3：收集全部媒体资产 blob（存储层优先，会话兜底）——含乐导出 v2 内嵌全部资产
  async function getExportAssets() {
    const s = store.getState();
    const out = [];
    for (const a of s.project?.media?.assets || []) {
      let blob = null;
      try { blob = await store.storage.getAsset(s.projectId, a.id); } catch {}
      if (!blob) blob = audio?.assets?.get(a.id)?.blob || null;
      out.push({ id: a.id, name: a.name, durationSec: a.durationSec, size: a.size || blob?.size || 0, blob });
    }
    return out;
  }
  const doExportJSON = async (includeAudio, share) => {
    const s = store.getState();
    let blob = null, assets = null;
    if (includeAudio) {
      assets = await getExportAssets();
      const act = s.project?.media?.activeAssetId;
      blob = assets.find(a => a.id === act)?.blob || null;
      if (!blob) blob = await getExportAudioBlob(); // legacy 键兜底（如项目未经资产迁移）
    }
    // 多轨（R47 §12.5 一行接线）：v1（不含乐）剥离 timeline.tracks 与 clip.trackId——
    // 多轨数据不随轻量文件出户；v2（含乐）cloneBasic 全量克隆自动随行，无需处理。
    const payload = includeAudio ? s.project : M.stripTracksForV1(s.project);
    const res = await exp.exportProjectJSON(payload, blob, { share, assets });
    if (res === 'cancelled') return;
    const how = res === 'shared' ? '已通过系统分享发送' : '已导出';
    // 任务#1（报告#1）：按钮语义与行为严格对齐——不含乐导出在 toast 里明示可后补音乐
    const nAssets = (assets || []).filter(a => a.blob).length;
    const what = includeAudio && (blob || nAssets) ? `（含音乐${nAssets > 1 ? `：${nAssets} 个资产` : ''}）` : '（不含音乐，可稍后重新载入）';
    toast(`${how}项目文件${what}`);
  };
  $('exp-json-audio').addEventListener('click', async () => {
    const s = store.getState();
    if (!s.project.audio.name) { toast('当前项目未载入音乐，将导出不含音乐的项目文件'); }
    const blob = await getExportAudioBlob();
    if (!blob) { toast('本地未找到音乐文件，请重新载入后再导出含音乐版本'); }
    await doExportJSON(!!blob, true);
  });
  $('exp-json').addEventListener('click', async () => {
    // 任务#1（报告#1）：「不含音乐」按钮此前实际内嵌音乐（与含乐按钮字节相同）——
    // 现严格按文案导出 v1（无 dataBase64），交付意图不再被静默违背
    await doExportJSON(false, false);
  });
  $('imp-json').addEventListener('click', async () => {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      try {
        const { project, audioBlob, assetBlobs } = await exp.readProjectFile(inp.files[0]);
        store.importProject(project);
        player.stop();
        const restored = await restoreProjectAudio(assetBlobs || [], audioBlob);
        if (restored && (assetBlobs?.length || audioBlob)) toast('导入成功（音乐已一并恢复）');
        else toast('导入成功（该项目文件不含音乐，请重新载入音乐）');
      } catch (e) { toast('导入失败：' + e.message); }
    });
    inp.click();
  });
}
function renderUndoButtons() {
  $('btn-undo').disabled = !store.canUndo();
  $('btn-redo').disabled = !store.canRedo();
  $('btn-undo').style.opacity = store.canUndo() ? 1 : 0.4;
  $('btn-redo').style.opacity = store.canRedo() ? 1 : 0.4;
}

// ---------- 舞台工具 ----------
function wireStageTools() {
  $('btn-edit-mode').addEventListener('click', () => store.setUI({ editMode: !store.getState().editMode }));
  $('btn-multi').addEventListener('click', () => store.setUI({ multiSelect: !store.getState().multiSelect }));
  // 当前队形的合并单元呈示切换（胶囊/单编号样式切换经单元浮窗），含位置收拢/偏移与缺席顺延
  $('btn-add-formation').addEventListener('click', () => addFormation());
  $('btn-del-formation').addEventListener('click', () => deleteFormation());
  $('gen-kind').addEventListener('change', () => {
    const kind = $('gen-kind').value;
    if (!kind) return;
    applyGenerator(kind);
    $('gen-kind').value = '';
  });
  $('btn-mirror-h').addEventListener('click', () => store.mutate(p => {
    const f = p.formations[store.getState().formationIndex];
    shapes.mirrorH(f, p.stage);
  }, '水平镜像'));
  $('btn-mirror-v').addEventListener('click', () => store.mutate(p => {
    const f = p.formations[store.getState().formationIndex];
    shapes.mirrorV(f, p.stage);
  }, '垂直镜像'));
  const rot = $('rot-slider');
  rot.addEventListener('input', () => {
    const deg = +rot.value;
    $('rot-val').textContent = deg + '°';
    const sel = store.getState().selection;
    // DEFECT-R37-1：positions 是普通对象（无 .keys() 方法）——无选择=全体时原写法直接 TypeError，
    // 整体旋转/统一朝向/F 键的「无选择=全体」路径全部静默失效。改 Object.keys，空帧安全。
    const ids = sel.length ? expandedSelection() : [...Object.keys(currentFormation()?.positions || {})];
    const center = centroid(currentFormation().positions, ids);
    store.mutate(p => {
      const f = p.formations[store.getState().formationIndex];
      shapes.rotateSelected(f.positions, ids, deg - (stageView._lastRot || 0), center);
    }, null);
    stageView._lastRot = deg;
  });
  rot.addEventListener('change', () => { commitWithThumbs('整体旋转'); stageView._lastRot = 0; rot.value = 0; $('rot-val').textContent = '0°'; });
  $('btn-distribute').addEventListener('click', () => {
    const sel = store.getState().selection;
    const ids = sel.length >= 3 ? expandedSelection() : [];
    if (ids.length < 3) { toast('请先框选至少 3 名舞者'); return; }
    store.mutate(p => {
      const f = p.formations[store.getState().formationIndex];
      shapes.distributeAxis(f.positions, ids, store.getState().distributeAxis || 'y');
    }, '等间距');
  });
  $('btn-distribute').addEventListener('contextmenu', e => {
    e.preventDefault();
    store.setUI({ distributeAxis: store.getState().distributeAxis === 'y' ? 'x' : 'y' });
    toast('均布方向：' + (store.getState().distributeAxis === 'y' ? '纵向' : '横向') + '（右键切换）');
  });
  $('btn-swap').addEventListener('click', () => {
    // 单元换位：把所选按"合并单元或单人"分组，恰好 2 个单元时对调位置
    const s = store.getState();
    const merges = s.project.formations[s.formationIndex]?.merges || [];
    const units = [];
    const used = new Set();
    for (const id of s.selection) {
      if (used.has(id)) continue;
      const m = merges.find(x => x.a === id || x.b === id);
      const unit = m ? [m.a, m.b] : [id];
      unit.forEach(u => used.add(u));
      units.push(unit);
    }
    if (units.length !== 2) { toast('请选中两个单元（合并单元或单人）'); return; }
    store.mutate(p => {
      const f = p.formations[s.formationIndex];
      const [u1, u2] = units;
      u1.forEach((id, k) => {
        const other = u2[k];
        if (!other) return;
        const pa = f.positions[id], pb = f.positions[other];
        if (pa && pb) { f.positions[id] = pb; f.positions[other] = pa; }
      });
    }, '单元换位');
  });
  // 合并为单元 / 取消合并（与右键/长按浮窗同语义；原始选择，不受单元联动扩展影响）
  $('btn-merge-create').addEventListener('click', () => {
    const sel = store.getState().selection;
    if (sel.length !== 2) { toast('请先选中恰好 2 名舞者'); return; }
    const [a, b] = sel;
    const f = currentFormation();
    if (f && (f.merges || []).some(m => (m.a === a && m.b === b) || (m.a === b && m.b === a))) { toast('所选两人已是一个单元'); return; }
    store.mutate(p => {
      const ff = p.formations[store.getState().formationIndex];
      M.addMerge(ff, a, b, 'capsule');
      M.collapseUnit(ff, a, b);
    }, '合并单元');
    const da = M.dancerById(store.getState().project, a), db = M.dancerById(store.getState().project, b);
    toast(`已合并为单元：${da?.name || '?'} + ${db?.name || '?'}`);
  });
  $('btn-merge-cancel').addEventListener('click', () => {
    const s = store.getState();
    const f = s.project.formations[s.formationIndex];
    const targets = [];
    for (const id of s.selection) {
      const m = (f?.merges || []).find(x => x.a === id || x.b === id);
      if (m && !targets.some(t => t === m)) targets.push(m);
    }
    if (!targets.length) { toast('所选舞者不在任何合并单元中'); return; }
    store.mutate(p => {
      const ff = p.formations[s.formationIndex];
      for (const m of targets) M.removeMerge(ff, m.a, m.b);
    }, '取消合并');
    toast(targets.length > 1 ? `已取消 ${targets.length} 个单元（成员原地保留）` : '已取消合并（两人保留在队形中）');
  });
  $('face-target').addEventListener('change', () => {
    const t = $('face-target').value;
    if (!t) return;
    const sel = store.getState().selection;
    // DEFECT-R37-1：同整体旋转——无选择=全体走 Object.keys（positions 为普通对象，.keys() 不存在）
    const ids = sel.length ? expandedSelection() : [...Object.keys(currentFormation()?.positions || {})];
    store.mutate(p => {
      const f = p.formations[store.getState().formationIndex];
      shapes.faceAll(f.positions, ids, t, { stage: p.stage });
    }, '统一朝向');
    $('face-target').value = '';
  });
  $('btn-ghost').addEventListener('click', () => { store.setUI({ showGhost: !store.getState().showGhost }); });
  $('btn-paths').addEventListener('click', () => { store.setUI({ showPaths: !store.getState().showPaths }); });
  $('btn-switch-anim').addEventListener('click', () => { store.setUI({ previewOnSwitch: !store.getState().previewOnSwitch }); });
  $('btn-fit').addEventListener('click', () => stageView.resetView());
}
function centroid(positions, ids) {
  let x = 0, y = 0, n = 0;
  for (const id of ids) { const p = positions[id]; if (p) { x += p.x; y += p.y; n++; } }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}
function applyGenerator(kind) {
  const s = store.getState();
  const unit = $('gen-unit').value;
  const rows = Number($('gen-rows')?.value) || undefined;
  store.mutate(p => {
    const f = p.formations[s.formationIndex];
    let ids;
    if (unit === 'men') ids = p.dancers.filter(d => d.role === 'M').map(d => d.id);
    else if (unit === 'women') ids = p.dancers.filter(d => d.role === 'F').map(d => d.id);
    else ids = M.orderedDancers(p);
    // DEFECT-R37-3：粒度=子集编排——「仅男士/仅女士」只应改变所选粒度的位置，其余舞者留在本帧现位。
    // 原 applySlots 整表替换会把子集外舞者清位、再由 carryPositionsForward 兜底扔到舞台中心（首帧），
    // 造成「只生成了男士、女士却全员瞬移」的位置丢失。全员生成语义不变（整体替换）。
    const subset = new Set(ids);
    const kept = {};
    if (subset.size > 0 && subset.size < p.dancers.length) {
      for (const [id, pos] of Object.entries(f.positions)) if (!subset.has(id)) kept[id] = pos;
    }
    const slots = shapes.genSlots(kind, ids.length, p.stage, { rows, unit });
    shapes.applySlots(f, ids, slots, { current: f.positions });
    for (const [id, pos] of Object.entries(kept)) if (!f.positions[id]) f.positions[id] = pos;
    M.applyFormationLayout(p, s.formationIndex); // 顺延缺席舞者位置（合并单元仅由手动操作创建）
  }, `生成队形(${kind})`);
}

// ---------- 播放条 ----------
function wirePlaybar() {
  $('pb-play').addEventListener('click', () => togglePlay());
  $('pb-stop').addEventListener('click', () => { player.stop(); store.setUI({}); });
  $('pb-prev').addEventListener('click', () => stepFormation(-1));
  $('pb-next').addEventListener('click', () => stepFormation(1));
  $('pb-speed').addEventListener('change', () => player.setSpeed(+$('pb-speed').value));
  $('pb-loop').addEventListener('change', () => updateLoop());
  $('pb-metro').addEventListener('change', () => store.mutate(p => { p.timeline.metronome = $('pb-metro').checked; }, null));
}
function updateLoop() {
  const on = $('pb-loop').checked;
  const s = store.getState();
  const { segments } = M.computeSegments(s.project);
  const seg = segments[s.formationIndex];
  player.setLoop(!!(on && seg), seg ? seg.holdStart : 0, seg ? seg.travelEnd : 0);
  if (on && seg && player.beat < seg.holdStart) player.seekBeat(seg.holdStart);
}
// DEFECT-R26-4：播放中改块时长（时间轴拖边 / ± 步进 / 面板输数）不暂停，循环区间若不跟随
// 新段长，会一直在旧边界内打转（实测 loopEnd=72 vs 新 travelEnd=99）。仅在播放+循环开启时刷新。
function syncLoopAfterBlockEdit() {
  if (player?.playing && $('pb-loop')?.checked) updateLoop();
}
function togglePlay() {
  // 任务#5（报告#5）：数拍进行中 ▶/空格 = 取消倒计，回到停止态（不重开倒计、不直接起播）
  if (player.countin) { player.cancelCountin(); return; }
  if (player.playing) { player.pause(); return; }
  const s = store.getState();
  const { segments } = M.computeSegments(s.project);
  const seg = segments[s.formationIndex];
  // 决策①（M1）：音乐模式 ▶ 恒从播放头起播（播放头≈0 时从 0，不再跳到当前队形段起点——
  // 起播点由播放头决定、不由队形决定）；stage 模式从当前队形段起播（逐值不动）。
  const inMusic = musicTl?.mode === 'music';
  const freshFrom = inMusic ? 0 : (seg ? seg.holdStart : 0);
  if (playerAtEnd()) {
    // 任务#6/#7（报告#6/#7）：全曲播完后再按 ▶ 从头播（不再只重播最后一段/静默归 0）
    if (audio.ready) player.play(0);
    else player.play(0, { countIn: false, forceVirtual: true });
  } else if (player.beat > 0.001) {
    player.play(null, { countIn: false }); // 暂停后续播（音频结束态经 useAudio=false 由虚拟时钟接管）
  } else if (audio.ready) {
    player.play(freshFrom); // 有音乐：按音乐时钟（music=从播放头 0；stage=从当前队形段）
  } else {
    // 无音乐：虚拟时钟（任务#6 终态统一）——不再单段预览，同音乐档一样播到终点
    // 并置 ended；循环开启时在当前队形段内回绕（虚拟时钟原生支持）
    player.play(freshFrom, { countIn: false, forceVirtual: true });
  }
  updateLoop();
}
function playerAtEnd() {
  // M1 模式感知：终点域 music=音乐域换算拍（音频播完才算完）；stage=totalBeats（逐值不动）
  const p = store.getState().project;
  const endBeat = musicTl?.mode === 'music'
    ? Math.max(0, M.secToBeat(p, M.musicDomainSec(p)))
    : M.computeSegments(p).totalBeats;
  return player.beat >= endBeat - 0.001;
}
function stepFormation(d) {
  // 决策①（M3 正式实装，M1 占位退役）：音乐模式 ⏮/⏭ = 前后 clip 缘步进（经典 DAW 语义）——
  // 播放头跳到上一个/下一个 clip 边缘（缘秒位升序取严格前/后近邻；无缘=域首 0/域尾）；
  // stage 模式队形步进逐值不动。
  if (musicTl?.mode === 'music') {
    const p = store.getState().project;
    if (!p) return;
    if (player.countin) player.cancelCountin();
    const curSec = M.beatToSec(p, Math.max(0, player.beat || 0));
    const targetSec = clipEdgeStepSec(M.clipsOf(p), curSec, M.musicDomainSec(p), d);
    player.seekBeat(Math.max(0, M.secToBeat(p, targetSec)));
    musicTl.drawPlayhead();
    return;
  }
  const s = store.getState();
  const ni = Math.max(0, Math.min(s.formationIndex + d, s.project.formations.length - 1));
  switchFormation(ni);
  if (player.beat > 0.001 && !player.playing) player.seekFormation(ni);
  if ($('pb-loop').checked) updateLoop(); // 循环区间跟随队形切换
}

// ---------- 音乐面板 ----------
let tapTimes = [];
// 任务#2（报告#2）→ 决策④（M1 重定位）：音乐模式以秒制走带，播放中改 BPM/首拍只平移
// 「拍↔秒映射」、音频秒位一个字节不动（applyTempoEdit 重定虚拟时钟基准）——播放锁对 BPM/首拍
// 解除（实时校准体验质变）；锁收缩到点拍（采样类校准件：播放中点击无意义且写回会造成拍位抖动）。
const musicLocked = () => !!(player && (player.playing || player.countin));
const MUSIC_LOCK_TIP = '暂停后可修改';
// [元素, 名称, 未锁定时的常态 title]（常态 title 与 index.html 一致，锁定时替换为统一提示；
// W1 起含音乐工具条孪生件 ——music 后缀，同锁同还原。M1 起仅点拍在列——BPM/首拍播放中可改）
const MUSIC_LOCK_TARGETS = [
  ['btn-tap', '点拍', '连点 3 次起算，取最近 8 次平均（停 2.5s 重新起算）'],
  ['btn-tap-music', '点拍', '连点 3 次起算，取最近 8 次平均（停 2.5s 重新起算）'],
];
function updateMusicLock() {
  const locked = musicLocked();
  for (const [id, label, tip] of MUSIC_LOCK_TARGETS) {
    const el = $(id);
    if (!el) continue;
    el.disabled = locked;
    el.title = locked ? `${label}：${MUSIC_LOCK_TIP}` : tip;
  }
}
// BPM/首拍的播放中安全写路径（决策④）：记录写前播放头秒位 → mutate → 虚拟时钟按秒位重定基准
// （音频通道 _tick 每帧由秒反推拍位，天然秒位不变）；秒制走带下播放头无跳变。
function applyTempoEdit(mut) {
  const p0 = store.getState().project;
  const secAt = p0 && player ? M.beatToSec(p0, Math.max(0, player.beat || 0)) : 0;
  store.mutate(mut, null);
  player?.remapBeatToSec(secAt);
}
function wireAudioPanel() {
  audioPanelBuilt = true;
  // ---- W2 C14：编舞摘要条（#music-summary）。旧「🎵 音乐与节拍」面板（C1）退役：
  //      载入/媒体库/按队形段自动切不入编舞（音乐工具条 mtb-* 孪生件承接）；其余锁定 id 保留
  //      （#audio-name 文本、#bpm-input/#offset-input 只读输入、#btn-tap/#btn-offset-test、
  //       #calib-disc 内 #bpb-select/#countin-input）。播放/数拍锁（updateMusicLock）覆盖不变。
  $('audio-file').addEventListener('change', async () => {
    const file = $('audio-file').files[0];
    if (!file) return;
    await loadAudioFile(file);
  });
  $('bpm-input').addEventListener('change', () => {
    applyTempoEdit(p => { p.audio.bpm = Math.max(30, Math.min(300, +$('bpm-input').value || 120)); }); // 决策④：播放中可改（秒位不变）
  });
  // 点拍（编舞摘要条 + 音乐工具条孪生同源）：BPM 改变路径，播放/数拍中禁用（任务#2）
  $('btn-tap').addEventListener('click', tapTempo);
  $('offset-input').addEventListener('change', () => {
    const v = Math.max(0, +$('offset-input').value || 0);
    applyTempoEdit(p => { p.audio.firstBeatSec = v; }); // 决策④：播放中可改（秒位不变）
    // 任务#10（报告#10）：首拍越界（≥音频时长）一次性 toast 告警，不阻断——
    // 让「按播放没反应」的配置错误可诊断
    if (audio.ready && audio.duration && v >= audio.duration) {
      toast(`首拍（${v}s）已超出音频时长（${audio.duration.toFixed(1)}s），请确认单位为秒`);
    }
  });
  $('btn-offset-test').addEventListener('click', auditionFirstBeat);
  $('bpb-select').addEventListener('change', () => store.mutate(p => { p.audio.beatsPerBar = +$('bpb-select').value; }, null));
  $('countin-input').addEventListener('change', () => store.mutate(p => { p.timeline.countInBeats = Math.max(0, Math.min(32, +$('countin-input').value || 0)); }, null));
  // 把当前队形块的起点对齐到播放头时间戳（调整前一段过渡时长）——W2 起按钮驻块时长栏（编舞域）
  $('btn-align-playhead').addEventListener('click', () => alignCurrentToPlayhead());
  $('ripple-check').addEventListener('change', () => store.setUI({ ripple: $('ripple-check').checked }));
  // 块时长快捷步进（±1拍，钳制 0.5–999）——W1 起编舞块栏（bc-*）与音乐模式 preview 栏（mp-*）共用
  $('bc-hold-minus').addEventListener('click', () => stepBlockBeats('holdBeats', -1));
  $('bc-hold-plus').addEventListener('click', () => stepBlockBeats('holdBeats', 1));
  $('bc-travel-minus').addEventListener('click', () => stepBlockBeats('travelBeats', -1));
  $('bc-travel-plus').addEventListener('click', () => stepBlockBeats('travelBeats', 1));
  // ⚑ 打点：在当前播放头/scrub 位置打音乐标记（不打断播放；命名 Enter/失焦提交、Esc 取消）
  $('btn-tag-drop').addEventListener('click', () => musicTl?.stampTag());
  // 尺规刻度切换（决策⑥）：拍⇄秒，MusicTimeline 记忆（localStorage）；按钮呈示即时同步
  $('tl-scale-toggle').addEventListener('click', () => {
    musicTl?.setRulerScale(musicTl.rulerScale === 'sec' ? 'beat' : 'sec');
    syncScaleToggle();
  });
  $('tl-zoom-in').addEventListener('click', () => musicTl.zoom(1.3));
  $('tl-zoom-out').addEventListener('click', () => musicTl.zoom(1 / 1.3));
  $('tl-zoom-fit').addEventListener('click', () => musicTl.zoomFit());
  // ---- W2 C14 摘要条专属：「编辑音乐 →」显性入口（IR-W2-3，与 M 键等效）+ 段索引面板 + 空态灰字 ----
  // W4：段索引入口升级为完整面板（原弹出列表退役）；按钮文案/禁用态同步逻辑不变
  $('ms-edit').addEventListener('click', () => setUiMode('music'));
  $('ms-tags').addEventListener('click', toggleSegIndexPanel);
  $('tl-audio-empty').addEventListener('click', () => setUiMode('music')); // C12：空态灰字点击跳音乐模式
  $('media-files').addEventListener('change', async () => {
    const files = [...$('media-files').files];
    $('media-files').value = '';
    if (files.length) await importMediaFiles(files);
  });
  // C13：拖资产/音频文件到时间轴音轨 = 落点生成 clip
  const tlScroll = $('tl-scroll');
  tlScroll.addEventListener('dragover', e => {
    if (e.dataTransfer && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/x-wuzhen-asset'))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  tlScroll.addEventListener('drop', async e => {
    const hasFiles = [...(e.dataTransfer?.types || [])].includes('Files');
    const assetId = e.dataTransfer?.getData('text/x-wuzhen-asset');
    if (!hasFiles && !assetId) return;
    e.preventDefault();
    await createClipFromDropAt(assetId || null, e.clientX, e.clientY, hasFiles ? (e.dataTransfer?.files?.[0] || null) : null);
  });
  // W4 GOLD-DEFECT-1 残留（方案 b 桥接收端）：媒体库弹窗打开期间 .modal-back 盖满视口，
  // 资产行 drop 落不到本元素——ui.js 遮罩 drop 判定落点在 #tl-scroll 矩形内时经此 custom
  // event 转发（ui.js 反向 import main.js 是环）。sec/lane 换算与建 clip 与上方直落入口
  // 共用同一份 createClipFromDropAt——两个入口一条消费链，不重复造轮子。
  window.addEventListener('wuzhen:tl-asset-drop', async ev => {
    const d = ev.detail || {};
    if (!d.assetId) return;
    const before = store.getState().project?.timeline?.audioClips?.length ?? 0;
    await createClipFromDropAt(d.assetId, d.clientX, d.clientY, null);
    // 弹窗盖着时间轴，成功反馈走 toast（失败路径 createClipFromDrop 内已有各自 toast）
    if ((store.getState().project?.timeline?.audioClips?.length ?? 0) > before) toast('已在时间轴落点放置剪辑');
  });
  window.addEventListener('resize', () => { stageView?.requestDraw(); musicTl?.render(); syncTracksHead(store.getState().project); }); // M2：resize 后轨头行高跟随重建（无需数据变更，IR-M2-2）
}

// 点拍（摘要条 #btn-tap 与音乐工具条 #btn-tap-music 孪生同源）：
// 连点 3 次起算、取最近 8 次平均；播放/数拍中拒绝（任务#2）；结果写回 twin 输入框
function tapTempo() {
  if (musicLocked()) { toast(`播放中不可点拍，${MUSIC_LOCK_TIP}`); return; } // 任务#2：点拍也是 BPM 改变路径
  const now = performance.now();
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2500) tapTimes = [];
  tapTimes.push(now);
  if (tapTimes.length >= 3) {
    const win = tapTimes.slice(-8);
    const ivals = [];
    for (let i = 1; i < win.length; i++) ivals.push(win[i] - win[i - 1]);
    const avg = ivals.reduce((a, b) => a + b, 0) / ivals.length;
    const bpm = Math.round(60000 / avg);
    $('bpm-input').value = bpm;
    $('bpm-input-music').value = bpm;
    store.mutate(p => { p.audio.bpm = bpm; }, null);
  }
  if (tapTimes.length > 10) tapTimes = tapTimes.slice(-8);
}
// 试听（摘要条 #btn-offset-test 与音乐工具条 #btn-offset-test-music 孪生同源）：
// 从首拍前 2s 起播 4.5s 自动停，检查对齐；不占用播放器
function auditionFirstBeat() {
  if (!audio.ready) { toast('请先载入音乐'); return; }
  player.pause();
  const p = store.getState().project;
  const from = Math.max(0, (p.audio.firstBeatSec || 0) - 2);
  audio.play(from, 1);
  setTimeout(() => { if (!player.playing) audio.pause(); }, 4500);
}
// ---- W4 §2.5 乐段索引面板（双模式共用快速乐段索引，替代原摘要条段索引弹出列表）----
// 三层层级：段行（色块 4 色循环与节奏划分轨同色序 + 段名 + 拍区间 + 秒区间）▸ 展开段内小节格
//（按全局 audio.beatsPerBar 折算，每行=1 小节）+ 顶部播放头行（▶ 当前拍/秒/小节，onTick 实时）。
// 数据源零新 schema：段=相邻 tags 派生（M.sectionSegmentsOf）；点击行=播放头跳转（播放中续播，
// seekBeat 既有语义）。同一组件两处挂载：编舞=摘要条「tag N 个」钮 / 音乐=工具条「索引」钮 / ⌘⇧L。
// 无 tags 空态「无节奏划分——到音乐模式自动划分」。长曲虚拟滚动本轮降级为全量渲染（200+ 行可接受）。
const siState = { open: false, root: null, list: null, ph: null, rows: [], expanded: new Set() }; // expanded: 已展开段的 tagId 集（跨重渲染保持）
function siEnsureDom() {
  if (siState.root) return;
  siState.root = h('div', {
    id: 'seg-index-panel',
    style: 'position:fixed;right:8px;top:calc(var(--tb-h) + 8px);bottom:calc(var(--pb-h) + 8px);width:min(280px,78vw);'
      + 'background:var(--bg2);border:1px solid var(--line);border-radius:var(--rad);box-shadow:0 8px 24px rgba(0,0,0,.45);'
      + 'z-index:70;display:none;flex-direction:column;overflow:hidden',
  },
    h('div', { style: 'display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line);flex:none' },
      h('span', { style: 'font-weight:600;font-size:13px;flex:1' }, '乐段索引'),
      h('button', { class: 'btn small', title: '关闭（Esc / ⌘⇧L）', onclick: closeSegIndexPanel }, '✕')),
    h('div', { id: 'si-playhead', class: 'mono', style: 'padding:4px 10px;font-size:12px;color:var(--acc);border-bottom:1px solid var(--line);flex:none;white-space:nowrap;overflow:hidden' }, '▶ 当前 0.0 拍'),
    h('div', { id: 'si-list', style: 'flex:1;overflow-y:auto;overscroll-behavior:contain' }));
  siState.list = siState.root.querySelector('#si-list');
  siState.ph = siState.root.querySelector('#si-playhead');
  document.body.append(siState.root);
}
// 全量重建面板行（打开时与 store render 兜底时调用；expanded 集保证展开态不丢）
function renderSegIndexPanel() {
  siEnsureDom();
  const p = store.getState().project;
  const list = siState.list;
  list.innerHTML = '';
  siState.rows = [];
  // M1 D4：music 模式划分域=音乐域（末段延到音频末）；stage=blocks 域（现状）
  const { segs } = p ? M.sectionSegmentsOf(p, sectionEndBeatOf(p)) : { segs: [] };
  if (!segs.length) {
    list.append(h('div', { id: 'si-empty', style: 'padding:18px 12px;color:var(--dim);font-size:13px;text-align:center' },
      '无节奏划分——到音乐模式自动划分'));
    return;
  }
  const bpb = p.audio.beatsPerBar || 4;
  const COLORS = MusicTimeline.SEG_COLORS;
  segs.forEach((s, k) => {
    // 色序与节奏划分轨一致：tag.color 覆盖，缺省按段序 4 色循环（timeline.js 同式）
    const color = COLORS[((s.tag.color ?? k) % COLORS.length + COLORS.length) % COLORS.length];
    const open = siState.expanded.has(s.tag.id);
    const row = h('div', {
      class: 'si-seg', 'data-start': String(s.start), 'data-end': String(s.end),
      style: 'display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--line);font-size:13px',
      onclick: e => { if (e.target.closest('.si-tw')) return; siSeek(s.start); },
    },
      h('button', {
        class: 'si-tw btn small', style: 'padding:0 6px;min-width:22px;flex:none',
        title: open ? '收起小节格' : '展开小节格',
        onclick: () => { if (open) siState.expanded.delete(s.tag.id); else siState.expanded.add(s.tag.id); renderSegIndexPanel(); siTick(); },
      }, open ? '▾' : '▸'),
      h('span', { style: `width:10px;height:18px;border-radius:3px;background:${color};flex:none` }),
      h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.tag.name),
      h('span', { class: 'mono', style: 'color:var(--dim);font-size:11px;flex:none' },
        `${Math.round(s.start * 10) / 10}→${Math.round(s.end * 10) / 10}拍 · ${M.beatToSec(p, s.start).toFixed(1)}→${M.beatToSec(p, s.end).toFixed(1)}s`));
    list.append(row);
    siState.rows.push({ el: row, start: s.start, end: s.end });
    if (!open) return;
    // 段内小节格：段拍数/beatsPerBar 向上取整（末行可为不满小节）；拍号=全局（拍号 v1 不建模，§2.5 已裁定）
    const nBars = Math.ceil((s.end - s.start) / bpb);
    for (let j = 0; j < nBars; j++) {
      const bs = Math.round((s.start + j * bpb) * 100) / 100;
      const bLen = Math.min(bpb, s.end - bs);
      const bar = h('div', {
        class: 'si-bar', 'data-beat': String(bs),
        style: 'display:flex;align-items:center;gap:6px;padding:3px 8px 3px 34px;cursor:pointer;font-size:12px;color:var(--dim)',
        onclick: () => siSeek(bs),
      },
        h('span', { class: 'mono', style: 'flex:1' }, `小节 ${Math.floor(bs / bpb) + 1}`),
        h('span', { class: 'mono' }, `${Math.round(bLen * 10) / 10}拍 @${M.beatToSec(p, bs).toFixed(1)}s`));
      list.append(bar);
      siState.rows.push({ el: bar, start: bs, end: Math.min(s.end, bs + bpb) });
    }
  });
}
// 点击行=播放头跳转（播放中续播：seekBeat 既有语义），播放头行即时跟进
function siSeek(beat) {
  player?.seekBeat(beat);
  musicTl?.drawPlayhead();
  siTick();
}
// 播放头跟随行（简化实现 §2.5：顶部固定一行实时呈示 + 当前行高亮，不强求滚动跟随）
function siTick() {
  if (!siState.open || !siState.root) return;
  const p = store.getState().project;
  if (!p) return;
  const b = Math.max(0, player ? player.beat : 0);
  siState.ph.textContent = `▶ 当前 ${Math.round(b * 10) / 10} 拍 · ${M.beatToSec(p, b).toFixed(1)}s（${M.beatLabel(p, b)} 小节）`;
  // 段行与其当前小节行同时高亮（两者区间都命中播放头；未展开时仅段行亮）
  for (const r of siState.rows) r.el.style.background = (b >= r.start && b < r.end) ? 'var(--bg3)' : '';
}
function openSegIndexPanel() {
  siEnsureDom();
  siState.open = true;
  siState.root.style.display = 'flex';
  renderSegIndexPanel();
  siTick();
}
function closeSegIndexPanel() {
  siState.open = false;
  if (siState.root) siState.root.style.display = 'none';
}
function toggleSegIndexPanel() { siState.open ? closeSegIndexPanel() : openSegIndexPanel(); }

// ---------- W1 音乐模式主区化：新接线 ----------
// 块时长 ±1 拍步进（钳制 0.5–999）：编舞块栏（bc-*）与音乐 preview 栏（mp-*）共用；
// mutate 带标签 = 恰一条历史（IR-W1-5）。播放中允许（循环区间跟随，DEFECT-R26-4 口径不变）。
function stepBlockBeats(key, delta) {
  const s = store.getState();
  if (key === 'travelBeats' && s.formationIndex >= s.project.formations.length - 1) return;
  store.mutate(p => {
    const b = p.timeline.blocks[s.formationIndex];
    if (!b) return;
    b[key] = Math.max(0.5, Math.min(999, (b[key] || 0) + delta));
  }, key === 'holdBeats' ? '调整保持时长' : '调整过渡时长');
  syncLoopAfterBlockEdit(); // 步进改时长后循环区间跟随（DEFECT-R26-4）
  drawMusicPreview();       // preview 栏步进即时反映（块数据变更 → 画布/标签同步）
}
// 对齐到播放头（W1 起 preview 栏镜像同款按钮）
function alignCurrentToPlayhead() {
  const s = store.getState();
  if (s.formationIndex === 0) { toast('第一个队形从 0 拍开始，无需对齐'); return; }
  const target = player.beat;
  store.mutate(p => { M.alignBlockStart(p, s.formationIndex, target); }, '对齐到播放头');
  const actual = M.computeSegments(s.project).segments[s.formationIndex].holdStart;
  if (Math.abs(actual - target) > 0.5) {
    toast(`目标不可达：起点已尽量前移到 ${M.beatLabel(s.project, actual)}（${actual.toFixed(1)} 拍）`);
  } else {
    toast(`队形 ${s.formationIndex + 1} 起点已对齐到 ${M.beatLabel(s.project, actual)}（${actual.toFixed(1)} 拍）`);
  }
  drawMusicPreview();
}
// ---- 音乐工具条（40px，音乐模式专属；#audio-disc 在该模式的职责替代，编舞模式不动） ----
function wireMusicToolbar() {
  // 资产组（C2 迁移语义：音乐模式入口；底层走同一 audio-file/media-files/媒体库管线）。
  // 决策③（M1 重定位）：「按队形段自动切」从音乐模式移除（队形驱动音频剪辑的反向路径，
  // 违背「音乐为底层」）——按钮与接线一并退役，autoSplitAtBoundaries 引擎保留（模型层无涉）。
  $('mtb-load-audio').addEventListener('click', () => $('audio-file').click());
  $('mtb-media-library').addEventListener('click', openMediaLibrary);
  // ⚑ 打点（修 E-08：音乐模式打 tag 入口）
  $('mtb-tag-drop').addEventListener('click', () => musicTl?.stampTag());
  // 乐段索引（W4 §2.5：音乐模式唤出同一面板，与编舞摘要条「tag N 个」钮同组件同数据）
  $('mtb-seg-index').addEventListener('click', toggleSegIndexPanel);
  // BPM/首拍（与块栏同名控件同模型；决策④：播放中可改——秒位不变、拍位重映射，实时校准）
  $('bpm-input-music').addEventListener('change', () => {
    applyTempoEdit(p => { p.audio.bpm = Math.max(30, Math.min(300, +$('bpm-input-music').value || 120)); });
  });
  $('offset-input-music').addEventListener('change', () => {
    const v = Math.max(0, +$('offset-input-music').value || 0);
    applyTempoEdit(p => { p.audio.firstBeatSec = v; });
    if (audio.ready && audio.duration && v >= audio.duration) {
      toast(`首拍（${v}s）已超出音频时长（${audio.duration.toFixed(1)}s），请确认单位为秒`);
    }
  });
  // 节拍组孪生件（W2 C3 收尾：点拍/小节/数拍入场/试听 与编舞摘要条同源同守卫）
  $('btn-tap-music').addEventListener('click', tapTempo);
  $('bpb-select-music').addEventListener('change', () => store.mutate(p => { p.audio.beatsPerBar = +$('bpb-select-music').value; }, null));
  $('countin-input-music').addEventListener('change', () => store.mutate(p => { p.timeline.countInBeats = Math.max(0, Math.min(32, +$('countin-input-music').value || 0)); }, null));
  $('btn-offset-test-music').addEventListener('click', auditionFirstBeat);
  // 尺规组（C5 迁移语义）：刻度切换/缩放与 #audio-disc 内同源。M4：－/＋ 改中心锚定
  //（zoomCenter——以视口 lane 区中点为锚，缩放前后中心秒不变；⤢=fit 适配音频域不变）
  $('tl-scale-toggle-music').addEventListener('click', () => {
    musicTl?.setRulerScale(musicTl.rulerScale === 'sec' ? 'beat' : 'sec');
    syncScaleToggle();
  });
  $('tl-zoom-in-music').addEventListener('click', () => musicTl?.zoomCenter(1.3));
  $('tl-zoom-out-music').addEventListener('click', () => musicTl?.zoomCenter(1 / 1.3));
  $('tl-zoom-fit-music').addEventListener('click', () => musicTl?.zoomFit());
  // 磁吸/剃刀开关钮（M5 §2.5 工具条补齐：原仅 S/R 键盘入口——可发现性补全；键位保持）
  $('tl-snap-toggle-music').addEventListener('click', () => { musicTl?.toggleSnap(); syncMusicToggles(); });
  $('tl-razor-toggle-music').addEventListener('click', () => { musicTl?.setRazor(); syncMusicToggles(); });
  // 自动划分 ▸（节奏划分轨三来源，§2.2.1 ①）：落标=批量写 timeline.tags，恰一条历史
  const dd = $('auto-seg-dd'), menu = dd.querySelector('.dd-menu');
  $('btn-auto-segments').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('seg-auto-even').addEventListener('click', () => autoSegmentsEven());
  $('seg-auto-bars').addEventListener('click', () => autoSegmentsBars());
  $('seg-auto-import').addEventListener('click', () => autoSegmentsTable());
}
// 磁吸/剃刀开关钮呈示同步（M5）：键盘 S/R 与按钮两路入口同态；render 兜底刷新
function syncMusicToggles() {
  const snap = $('tl-snap-toggle-music'), rz = $('tl-razor-toggle-music');
  if (snap) snap.classList.toggle('toggled-on', !!musicTl?.snapOn);
  if (rz) rz.classList.toggle('toggled-on', !!musicTl?.razor);
}
// 划分域（M1 D4）：music 模式=音乐域换算拍（自动划分/末段覆盖到音频末——blocks 短于音频时
// 后半也能划分）；stage=blocks 域 totalBeats（现状口径，零变化）。搭 sectionSegmentsOf 的
// endBeatOverride 参数（缺省=现状）。
function sectionEndBeatOf(p) {
  if (musicTl?.mode === 'music') return Math.max(1, M.secToBeat(p, M.musicDomainSec(p)));
  return M.computeSegments(p).totalBeats;
}
// 自动划分来源①：均分 N 段（默认提示 8 的倍数；整表替换现有标记，undo 一键还原）
function autoSegmentsEven() {
  const p = store.getState().project;
  if (!p) return;
  const totalBeats = sectionEndBeatOf(p);
  if (!(totalBeats > 0)) { toast('曲长为 0，无法划分'); return; }
  const ans = prompt(`均分 N 段（全曲 ${Math.round(totalBeats * 10) / 10} 拍；建议 8 的倍数，贴合乐段结构）\n将替换现有标记，可撤销`, '8');
  if (ans == null) return;
  const beats = M.evenSectionBeats(totalBeats, Number(ans));
  if (!beats.length) { toast('段数需为 1–64 的整数'); return; }
  store.mutate(pl => {
    M.applySectionEntries(pl, beats.map((b, i) => ({ name: `段落 ${i + 1}`, beat: b })));
  }, '自动划分节奏段');
  toast(`已均分 ${beats.length} 段（原标记已替换；撤销可还原）`);
}
// 自动划分来源②：按小节规则（主歌 16 拍 → 副歌 8 拍 交替循环到曲终；规则表后续接 DENSITY_RULES）
function autoSegmentsBars() {
  const p = store.getState().project;
  if (!p) return;
  const entries = M.barRuleSections(sectionEndBeatOf(p));
  if (!entries.length) { toast('曲长为 0，无法划分'); return; }
  store.mutate(pl => { M.applySectionEntries(pl, entries); }, '自动划分节奏段');
  toast(`已按小节规则落 ${entries.length} 段（主歌16拍/副歌8拍 交替；撤销可还原）`);
}
// 自动划分来源③：导入段落表（「前奏8 主歌32 副歌32…」文本解析；任一项不合法整表拒绝）
function autoSegmentsTable() {
  const p = store.getState().project;
  if (!p) return;
  const text = prompt('粘贴/输入段落表（每项「名称+拍数」，空格/逗号/换行分隔）\n例：前奏8 主歌32 副歌32 间奏16 尾奏8\n将替换现有标记，可撤销', '');
  if (text == null) return;
  const parsed = M.parseSectionTable(text);
  if (!parsed.length) { toast('段落表无法解析：每项需为「名称+拍数」，如「主歌32」'); return; }
  const entries = M.sectionTableToEntries(parsed, sectionEndBeatOf(p));
  if (!entries.length) { toast('曲长为 0，无法划分'); return; }
  store.mutate(pl => { M.applySectionEntries(pl, entries); }, '自动划分节奏段');
  toast(`已按段落表落 ${entries.length} 段（超出曲尾的条目自动截断；撤销可还原）`);
}
// ---- 节奏划分轨段右键菜单（§2.2.1 ②：于此拆分/合并相邻/删除/换色 4 色） ----
function showSegMenu({ tagId, beat, screenX, screenY }) {
  if (!tagId) {
    showContextMenu([{ label: '未划分区域（划分轨双击空白可打段起点）', fn: () => {} }], { x: screenX, y: screenY });
    return;
  }
  const p = store.getState().project;
  const t = M.tagById(p, tagId);
  if (!t) return;
  // 于此拆分：点击处拍位吸附小节线（与拖界同一吸附口径）
  const [splitBeat, snapped] = musicTl.snapTagBeatToBar(beat);
  const splitLabel = `于此拆分（${Math.round(splitBeat * 10) / 10} 拍${snapped ? '，已吸小节线' : ''}）`;
  const swatches = h('div', { class: 'ctx-swatches' },
    ...MusicTimeline.SEG_COLORS.map((c, ci) => h('button', {
      class: 'ctx-sw', style: `background:${c}`, title: '段颜色',
      onclick: () => { closeContextMenu(); musicTl.setSegColor(tagId, ci); },
    })));
  showContextMenu([
    { label: splitLabel, fn: () => musicTl.splitSegAt(tagId, splitBeat) },
    { label: '与下一段合并', fn: () => musicTl.mergeSegWithNext(tagId) },
    { label: '删除本段', danger: true, fn: () => musicTl.deleteSeg(tagId) },
    { sep: true },
    { el: swatches },
  ], { x: screenX, y: screenY });
}
// ---- 队形 mini-preview 栏（W1 C15）：只读画布随播放头同步 + 块 ±1 拍步进 + 对齐到播放头 ----
// M5（决策②）：可折叠、默认展开——wuzhen:mpCollapsed 记忆（'1'=折叠）；仅桌面形态有折叠钮
//（移动 88px 横条 CSS 不呈示头部），记忆键在移动端不生效（样式隔离）。
let mpRefs = null;
const MP_COLLAPSED_KEY = 'wuzhen:mpCollapsed';
function applyPreviewCollapsed(collapsed) {
  const root = $('music-preview');
  if (!root) return;
  root.classList.toggle('mp-collapsed', !!collapsed);
  const btn = $('mp-collapse');
  if (btn) {
    btn.textContent = collapsed ? '▸' : '▾';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开预览栏（记忆）' : '折叠预览栏（记忆）';
  }
  if (!collapsed) drawMusicPreview(); // 展开即补绘（折叠期间 drawMusicPreview 跳过，防陈旧首帧）
}
function wireMusicPreview() {
  if (mpRefs) return;
  $('mp-hold-minus').addEventListener('click', () => stepBlockBeats('holdBeats', -1));
  $('mp-hold-plus').addEventListener('click', () => stepBlockBeats('holdBeats', 1));
  $('mp-travel-minus').addEventListener('click', () => stepBlockBeats('travelBeats', -1));
  $('mp-travel-plus').addEventListener('click', () => stepBlockBeats('travelBeats', 1));
  $('mp-align').addEventListener('click', () => alignCurrentToPlayhead());
  let collapsed = false;
  try { collapsed = localStorage.getItem(MP_COLLAPSED_KEY) === '1'; } catch {}
  applyPreviewCollapsed(collapsed);
  $('mp-collapse').addEventListener('click', () => {
    const next = !$('music-preview').classList.contains('mp-collapsed');
    try { localStorage.setItem(MP_COLLAPSED_KEY, next ? '1' : '0'); } catch {}
    applyPreviewCollapsed(next);
  });
  mpRefs = { root: $('music-preview'), cv: $('mp-canvas'), name: $('mp-name'), hold: $('mp-hold'), travel: $('mp-travel') };
}
// preview 绘制（复用 drawScene minimal，同 formation-index 缩略图管线；只读，无新渲染管线）。
// 调用点：render()（编辑态兜底）与 player.onTick（播放中 formationIndex/播放头推进同步，IR-W1-5）。
function drawMusicPreview() {
  if (!mpRefs || mpRefs.root.offsetParent === null) return; // 非音乐模式（display:none）不画
  if (mpRefs.root.classList.contains('mp-collapsed')) return; // M5 决策②：折叠态不绘（展开时补绘）
  const s = store.getState();
  const p = s.project;
  const f = p?.formations[s.formationIndex];
  if (!f) return;
  const cv = mpRefs.cv;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 258, hgt = cv.clientHeight || 170;
  const W = Math.round(w * dpr), H = Math.round(hgt * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  drawScene(ctx, { x: 0, y: 0, w, h: hgt }, p, f.positions, { minimal: true, pad: 10, merges: f.merges || [] });
  const label = `${s.formationIndex + 1}. ${f.name}`;
  if (mpRefs.name.textContent !== label) mpRefs.name.textContent = label;
  const blk = p.timeline.blocks[s.formationIndex];
  if (blk) {
    const spbv = M.spb(p);
    // W3 移动端 preview 条：值拆两段 span（拍数 + 「·秒」），移动端 CSS 隐 .mp-s 防横溢（§2.3）；
    // 桌面渲染文本与旧 fmt 完全一致（textContent 不变，仪器兼容）。
    const fmtB = v => `${String(Math.round(v * 10) / 10)}拍`;
    const fmtS = v => `·${(v * spbv).toFixed(1).replace(/\.0$/, '')}s`;
    const setVal = (el, v) => {
      const b = `${fmtB(v)}`, sv = `${fmtS(v)}`;
      if (el._b !== b || el._s !== sv) {
        el._b = b; el._s = sv;
        el.replaceChildren(document.createTextNode(b), Object.assign(document.createElement('span'), { className: 'mp-s', textContent: sv }));
      }
    };
    setVal(mpRefs.hold, blk.holdBeats);
    setVal(mpRefs.travel, blk.travelBeats);
    const isLast = s.formationIndex >= p.formations.length - 1;
    $('mp-travel-minus').disabled = isLast || blk.travelBeats <= 0.5;
    $('mp-travel-plus').disabled = isLast;
    $('mp-hold-minus').disabled = blk.holdBeats <= 0.5;
  }
}
// ---- 多轨轨头与轨操作（汇合轮，仅音乐模式呈示；对接 Lane B 引擎 R47 §12.4-12.6） ----
// 每轨：轨名（双击改名）+ 音量滑杆（setTrackGainById）+ 静音（setTrackMutedById）+ 删轨（仅空轨）；
// 底部加轨条（TRACK_MAX=4 UI 把守：到限呈禁用态+点击 toast）。四条裁定落地：
// ①上限 UI 把守；②removeTrack 仅空轨、无删最后一轨入口；③跨轨重叠维持自动交叉淡化（引擎现状）；
// ④轨静音不参与 ended/effectiveRegions（引擎现状）。
// W1（C7 退役）：旧展开态单轨表头 #tl-head（master 总控 buildAudioHead/updateAudioHead/
// wuzhen:audioTrackMix）整体删除——轨头只看音乐模式多轨（C16 简化）。
let tracksHeadSig = null;
let tracksHeadDirty = false;
function tracksSigOf(p) {
  const ts = p?.timeline?.tracks || [];
  const clipTracks = M.clipsOf(p).map(c => c.trackId || M.DEFAULT_TRACK_ID);
  // M2：签名含几何（laneH / 模式呈示态）——resize/切模式后行高跟随重建，无需任何数据变更
  // （E58-14/F2b「数据签名不含几何 → resize 后永不重建 → 逐行漂移」根因消除）
  return JSON.stringify(ts) + '|' + clipTracks.join(',') + '|' + trackLaneH() + '|' + (musicTl ? musicTl.expanded : true);
}
function trackLaneH() { return musicTl ? musicTl.audioLaneH() : 72; }
function syncTracksHead(p) {
  const box = $('tl-tracks-head');
  if (!box || box.hidden) { tracksHeadSig = null; return; }
  const sig = tracksSigOf(p);
  // 仅滑杆拖拽中（active=input）推迟重建，防打断拖动；按钮点击（加/删/静音）立即重建——
  // 否则「加轨后轨头不出现新行、要点别处才刷新」的体验裂缝（探针 B6 实测抓到）。
  const ae = document.activeElement;
  const dragging = !!ae && box.contains(ae) && ae.tagName === 'INPUT';
  if (sig !== tracksHeadSig) {
    if (dragging) { tracksHeadDirty = true; return; } // 滑杆拖拽中不重建 DOM（防打断），失焦后下一次渲染重建
    tracksHeadSig = sig;
    tracksHeadDirty = false;
    buildTracksHead(box, p);
  } else if (tracksHeadDirty && !dragging) {
    tracksHeadDirty = false;
    buildTracksHead(box, p);
  }
}
function buildTracksHead(box, p) {
  box.innerHTML = '';
  // M2 container 化结构：角格行×2（对齐画布尺规 22px / 节奏划分轨 28px）+ 轨行×N（高=laneH，
  // 与 lane 逐行同高按构造成立）+ 加轨条 26px（紧贴末行，与画布 ops 带同位）
  box.append(h('div', { class: 'tlh-corner' }, '音轨'), h('div', { class: 'tlh-corner2' }));
  const ts = p?.timeline?.tracks || [];
  const expanded = musicTl ? musicTl.expanded : true;
  const laneH = trackLaneH();
  const usedOf = tid => M.clipsOf(p).filter(c => (c.trackId || M.DEFAULT_TRACK_ID) === tid).length;
  for (const t of ts) {
    const sole = ts.length <= 1;
    const used = usedOf(t.id);
    const name = h('div', { class: 'tlt-name', title: `「${t.name}」（双击重命名）` }, t.name);
    name.addEventListener('dblclick', () => inlineRenameTrack(name, t.id)); // M2：内联改名（prompt 退役）
    const del = h('button', {
      class: 'btn tlt-del', 'aria-label': `删除音轨 ${t.name}`,
      title: sole ? '至少保留一条音轨' : used ? `轨上还有 ${used} 个音频块——先移动或删除后再删轨` : `删除空轨「${t.name}」`,
    });
    del.innerHTML = iconHtml('trash');
    del.disabled = sole || !!used; // 裁定②：仅空轨可删、无删最后一轨入口（模型 removeTrack 亦拒绝非空）
    del.addEventListener('click', () => removeTrackFlow(t.id));
    const mute = h('button', {
      class: 'btn tlt-mut', 'aria-label': `${t.muted ? '取消静音' : '静音'}音轨 ${t.name}`, 'aria-pressed': String(!!t.muted),
      title: t.muted ? '取消静音本轨（该轨全部剪辑实时恢复出声）' : '静音本轨（该轨全部剪辑实时静音，播放不中断）',
    });
    mute.innerHTML = iconHtml(t.muted ? 'mute' : 'volume');
    mute.classList.toggle('toggled-on', !!t.muted);
    mute.addEventListener('click', () => toggleTrackMutedFlow(t.id));
    const block = h('div', { class: 'tlh-track', style: `height:${laneH}px` },
      h('div', { class: 'tlt-row' }, name, mute, del));
    if (expanded) {
      const vol = h('input', {
        type: 'range', min: '0', max: '1.5', step: '0.01', value: String(t.gain ?? 1),
        title: `「${t.name}」音量（0–1.5，仅本轨；拖动实时平滑）`, 'aria-label': `音轨 ${t.name} 音量`,
      });
      vol.addEventListener('input', () => setTrackGainFlow(t.id, +vol.value));
      block.append(
        h('div', { class: 'tlt-row tlt-vol' }, h('span', { class: 'dim', style: 'font-size:10px' }, '音量'), vol),
        h('div', { class: 'tlt-row tlt-info dim', style: 'font-size:10px' }, used ? `${used} 个剪辑` : '空轨（可删除）'));
    }
    box.append(block);
  }
  // 加轨条：上限由 UI 把守（模型层 addTrack 不设限）——到限呈禁用态，点击 toast 说明（裁定①）
  const full = ts.length >= M.TRACK_MAX;
  const add = h('button', {
    class: 'btn small', 'aria-label': full ? `音轨已满（最多 ${M.TRACK_MAX} 条）` : '加音轨', 'aria-disabled': String(full),
    title: full ? `最多 ${M.TRACK_MAX} 条音轨` : '新增一条空音轨（新轨可拖入 clip）',
  });
  add.innerHTML = iconHtml('plus') + (full ? ` 已满 ${M.TRACK_MAX} 轨` : ' 加轨');
  if (full) add.style.opacity = '.45';
  add.addEventListener('click', () => addTrackFlow());
  box.append(h('div', { class: 'tlh-ops' }, add));
}
// 轨名内联重命名（M2，修 G6-e）：双击 → 行内 input（Enter/失焦提交、Esc 取消），
// 交互范式与时间轴 tag 道 _openTagInput 一致；原生 prompt() 退役。
function inlineRenameTrack(nameEl, trackId) {
  const t = M.trackById(store.getState().project, trackId);
  if (!t || nameEl.querySelector('input')) return;
  const inp = h('input', {
    type: 'text', value: t.name, maxlength: String(M.TRACK_NAME_MAX), spellcheck: 'false',
    'aria-label': `重命名音轨 ${t.name}`,
  });
  nameEl.textContent = '';
  nameEl.append(inp);
  let done = false;
  const finish = commit => {
    if (done) return;
    done = true;
    const v = String(inp.value ?? '').trim().slice(0, M.TRACK_NAME_MAX);
    // 先摘输入框再提交：syncTracksHead 的滑杆/输入防打断门控（activeElement=INPUT defer）
    // 才不会把后续重建永久挂起（输入框驻留焦点 → 签名永不落地，E-06 类连锁）
    inp.remove();
    nameEl.textContent = t.name; // 缺省还原呈示；提交成功时随下方重建回显新名
    if (commit && v && v !== t.name) {
      store.mutate(pr => { M.renameTrack(pr, trackId, v); }, '重命名音轨'); // 数据变更 → 签名变化 → 轨头重建回显新名
    }
  };
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('pointerdown', ev => ev.stopPropagation()); // 输入框点击不透给画布
  requestAnimationFrame(() => { try { inp.focus(); inp.select(); } catch {} });
}
function addTrackFlow() {
  const p = store.getState().project;
  if (!p) return;
  if ((p.timeline.tracks || []).length >= M.TRACK_MAX) { toast(`最多 ${M.TRACK_MAX} 条音轨`); return; }
  store.mutate(pr => { M.addTrack(pr, {}); }, '加音轨');
  const nt = (store.getState().project.timeline.tracks || []).at(-1);
  toast(`已新增「${nt?.name || '新轨'}」——把剪辑拖到新 lane 即可换轨`);
  afterTracksStructureChange();
}
function removeTrackFlow(trackId) {
  const p = store.getState().project;
  const t = M.trackById(p, trackId);
  if (!t) return;
  if ((p.timeline.tracks || []).length <= 1) { toast('至少保留一条音轨'); return; }
  const used = M.clipsOf(p).filter(c => (c.trackId || M.DEFAULT_TRACK_ID) === trackId).length;
  if (used) { toast(`「${t.name}」上还有 ${used} 个音频块——请先移动或删除，再删轨`); return; }
  store.mutate(pr => { M.removeTrack(pr, trackId); }, '删音轨');
  toast(`已删除空轨「${t.name}」`);
  afterTracksStructureChange();
}
// 轨音量滑杆：模型态即时写回（不进历史，同 clip 增益把手口径）+ 引擎 setTrackGainById 平滑实时
function setTrackGainFlow(trackId, g) {
  store.mutate(pr => { M.setTrackGain(pr, trackId, g); }, null);
  audio?.ensureTransport().setTrackGainById(trackId, g);
}
// 轨静音：进历史（可撤销）+ 引擎 setTrackMutedById 实时生效（轨静音=子链增益 0，无需 reschedule）
function toggleTrackMutedFlow(trackId) {
  const t = M.trackById(store.getState().project, trackId);
  if (!t) return;
  const m = !t.muted;
  store.mutate(pr => { M.setTrackMuted(pr, trackId, m); }, m ? '静音音轨' : '取消静音音轨');
  audio?.ensureTransport().setTrackMutedById(trackId, m);
}
function afterTracksStructureChange() {
  // 轨结构变化（加/删轨）：引擎 _tracks 重指向项目轨数组 + 轨子链增删；播放中重调度（裁定）
  syncTransportTracks(store.getState().project);
  if (player.playing) audio.ensureTransport().reschedule();
}
// 引擎 _tracks 持久性（R47 §12.3）：载入/undo/redo 换项目对象、轨结构原地增删、gain/muted 原地
// 改写——render 每帧比「数组引用+内容签名」，变了就 syncTracks（幂等；setTargetAtTime 平滑实时）。
let tracksSyncRef = null, tracksSyncSig = '';
function syncTransportTracks(p) {
  if (!audio) return;
  const tracks = p?.timeline?.tracks || [];
  const sig = JSON.stringify(tracks);
  if (tracks === tracksSyncRef && sig === tracksSyncSig) return;
  tracksSyncRef = tracks;
  tracksSyncSig = sig;
  audio.ensureTransport().syncTracks(tracks);
}
async function loadAudioFile(file) {
  // 任务#21（报告#21）：换曲前先停——旧实现播放中换曲会静默中断且无提示
  const wasPlaying = !!(player.playing || player.countin);
  if (wasPlaying) player.pause();
  try {
    // v3：走资产库——解码入会话资产 Map（buffer+波形包络），并设为配乐；项目记录登记
    // 元数据，首个音频若无任何 clip 则补全长 clip（与 v1 迁移语义逐拍等价，零体验变化）。
    const asset = await audio.addAsset(file, file.name);
    if (!asset.durationSec) throw new Error('音频无法解码');
    const prevActiveId = audio.activeId;
    audio.setActiveAsset(asset.id);
    store.mutate(p => {
      p.audio.name = file.name;
      p.audio.durationSec = asset.durationSec;
      p.media = p.media || { assets: [], activeAssetId: null };
      let meta = p.media.assets.find(a => a.id === asset.id);
      if (!meta) { meta = { id: asset.id, name: file.name, durationSec: asset.durationSec, size: file.size }; p.media.assets.push(meta); }
      p.media.activeAssetId = asset.id;
      // 「载入音乐」=替换配乐（旧语义）：移除引用旧配乐的 clip，补新资产全长 clip
      //（媒体库导入不在此列，不动既有剪辑）
      p.timeline.audioClips = p.timeline.audioClips.filter(c => c.assetId !== prevActiveId);
      if (asset.durationSec > 0.005) {
        p.timeline.audioClips.push({ id: uid('clip'), assetId: asset.id, timelineStartSec: 0, srcStartSec: 0, lengthSec: Math.round(asset.durationSec * 1e6) / 1e6, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: file.name });
      }
    }, '载入音乐');
    await store.storage.putAsset(store.getState().projectId, asset.id, file);
    await store.storage.putAudio(store.getState().projectId, file); // legacy 键兜底（旧语义保留）
    maybeVarispeedHint(asset.durationSec); // 决策⑥：恒定 BPM 假设显性化（一次性软提示）
    toast(`音乐已载入：${file.name}${wasPlaying ? '（播放已停止）' : ''}`);
  } catch (e) {
    // 任务#3（报告#3）：损坏音频不再僵死——播放已停、按钮经 onStateChange 复位 ▶、
    // 项目 audio 字段保持载入前状态（可继续编辑/重新选择）
    toast('音频无法播放，已忽略');
  }
}
// ---- 恒定 BPM 假设显性化（决策⑥）----
// 纯函数（node 可测）：音频实际时长与拍模型（firstBeatSec + totalBeats×spb）偏差 >10% 视为
// 「可能非恒定 BPM」（软口径：按模型默认参数误配也会触发，文案用「可能」）。参照优化方案
// R2 §2.1 实证：变速曲偏移线性累积（60s 双速曲最大 9.875s/19.75 拍），任何单值 BPM 折中不可救。
export function varispeedMismatch(durationSec, totalBeats, spbVal, firstBeatSec = 0) {
  if (!(durationSec > 0) || !(totalBeats > 0) || !(spbVal > 0)) return false;
  const modelSec = (firstBeatSec || 0) + totalBeats * spbVal;
  return Math.abs(durationSec - modelSec) / durationSec > 0.10;
}
const VARISPEED_LS_KEY = 'wuzhen:varispeedHint'; // 已读记忆：每标签页会话只提示一次（sessionStorage）
// 呈现口径（round46 裁定）：记忆落在 sessionStorage 而非 localStorage——既有仪器（run-ir06.mjs
// A9/B9、userflows-p1 TC-P1-15）把 localStorage 键集合钉在白名单上（新键=红线红），而本提示的
// 载入音频动线正是这些套件的必经路径；sessionStorage 跨刷新保留（同一工作会话不重复打扰）、
// 新开会话最多再提示一次，代价可接受。任务书原文「localStorage 记忆已读」据此降一档，已记入报告遗留。
function maybeVarispeedHint(durationSec) {
  try {
    if (sessionStorage.getItem(VARISPEED_LS_KEY) === '1') return;
    const p = store.getState().project;
    if (!p) return;
    const { totalBeats } = M.computeSegments(p);
    if (!varispeedMismatch(durationSec, totalBeats, M.spb(p), p.audio.firstBeatSec)) return;
    // W3（§4.3②）：音乐模式载入变速嫌疑音频 → toast 追加「切秒刻度」动作钮，一键 setRulerScale('sec')；
    // 编舞模式只出文字提示（刻度切换入口在摘要条尺规组，不在提示里代劳——仅音乐模式显钮）。
    // 时长 6200ms 给动作钮留出可点击窗口；文本读取型仪器（includes 口径）不受动作钮影响。
    const inMusic = musicTl?.mode === 'music';
    toast('音频节奏与拍线可能不一致（变速曲），可用秒刻度对齐', inMusic ? 6200 : 2200,
      inMusic ? {
        label: '切秒刻度',
        fn: () => {
          if (!musicTl) return;
          musicTl.setRulerScale('sec');
          syncScaleToggle();
          toast('已切到秒刻度（变速曲按秒对齐；Alt+←/→ 播放头 ±0.5s 步进）');
        },
      } : null);
    sessionStorage.setItem(VARISPEED_LS_KEY, '1');
  } catch {} // 隐私模式 storage 不可用：静默跳过（不提示也不记）
}
// 自动恢复上次项目时同步恢复音频：v3 先逐个还原媒体资产（clip 通道需要各资产 buffer），
// 再设活动资产；旧档（legacy audio 键）兜底。
async function restoreAudio() {
  const s = store.getState();
  const p = s.project;
  if (!p?.audio?.name) return;
  const assets = p.media?.assets || [];
  for (const a of assets) {
    if (audio.assets.has(a.id)) continue;
    try {
      const blob = await store.storage.getAsset(s.projectId, a.id);
      if (blob) await audio.addAsset(blob, a.name, a.id);
    } catch {}
  }
  const act = assets.find(a => a.id === p.media?.activeAssetId) || assets[0] || null;
  if (act && audio.assets.get(act.id)?.buffer) { audio.setActiveAsset(act.id); return; }
  if (act && audio.assets.has(act.id)) { audio.setActiveAsset(act.id); return; } // 元数据兜底（解码失败的资产照常展示）
  try {
    const blob = await store.storage.getAudio(s.projectId);
    if (blob) await audio.loadBlob(blob, p.audio.name);
  } catch {}
}
// ---- v3 媒体资产往返（导入文件/深链/媒体库共用）----
// assetBlobs=[{id,name,blob}]；legacyBlob=旧 v2 单音频。资产 id 保持项目记录引用一致。
async function restoreProjectAudio(assetBlobs, legacyBlob) {
  const s = store.getState();
  const pid = s.projectId;
  const p = s.project;
  const assets = p?.media?.assets || [];
  for (const ab of assetBlobs) {
    if (!ab.blob) continue;
    try {
      const meta = assets.find(a => a.id === ab.id);
      await audio.addAsset(ab.blob, meta?.name || ab.name, ab.id || undefined);
      if (ab.id) await store.storage.putAsset(pid, ab.id, ab.blob);
    } catch {}
  }
  if (!assetBlobs.length && legacyBlob) {
    // 旧 v2 单音频：还原为项目记录里那个资产（v1 迁移产物）的同 id；无资产记录时走 legacy
    if (assets.length === 1) {
      try {
        await audio.addAsset(legacyBlob, assets[0].name, assets[0].id);
        await store.storage.putAsset(pid, assets[0].id, legacyBlob);
        await store.storage.putAudio(pid, legacyBlob);
      } catch {}
    } else {
      try { await store.storage.putAudio(pid, legacyBlob); } catch {}
      await audio.loadBlob(legacyBlob, p?.audio?.name || legacyBlob.name || '').catch(() => {});
    }
  }
  const act = assets.find(a => a.id === p?.media?.activeAssetId) || assets[0] || null;
  if (act && audio.assets.has(act.id)) audio.setActiveAsset(act.id);
  return !!(act || legacyBlob);
}

// ---- v3 媒体库（规格 §3）----
function openMediaLibrary() {
  showMediaLibraryModal({
    getProject: () => store.getState().project,
    toast,
    acts: {
      importFiles: files => importMediaFiles(files),
      setActive: id => setActiveAssetFlow(id),
      rename: id => {
        const a = store.getState().project?.media?.assets?.find(x => x.id === id);
        if (!a) return;
        const n = prompt('资产名称', a.name);
        if (n && n.trim()) {
          store.mutate(p => { const m = p.media.assets.find(x => x.id === id); if (m) m.name = n.trim().slice(0, 120); }, '重命名音频资产');
          const sa = audio.assets.get(id); if (sa) sa.name = n.trim().slice(0, 120);
        }
      },
      remove: id => removeAssetFlow(id),
      hasBlob: id => !!audio.assets.get(id)?.blob,
      pickFiles: () => $('media-files').click(),
    },
  });
}
async function importMediaFiles(files) {
  const list = [...files].filter(f => !f.type || f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name));
  if (!list.length) { toast('未识别到音频文件'); return; }
  const wasPlaying = !!(player.playing || player.countin);
  if (wasPlaying) player.pause();
  let first = null;
  for (const f of list) {
    try {
      const asset = await audio.addAsset(f, f.name);
      if (!asset.durationSec) throw new Error('无法解码');
      first = first || asset;
      store.mutate(p => {
        p.media = p.media || { assets: [], activeAssetId: null };
        if (!p.media.assets.some(a => a.id === asset.id)) {
          p.media.assets.push({ id: asset.id, name: f.name, durationSec: asset.durationSec, size: f.size });
        }
        // 项目原本无配乐：首个导入资产成为配乐并补全长 clip（等价 v1 迁移语义）
        if (!p.audio.name) {
          p.audio.name = f.name;
          p.audio.durationSec = asset.durationSec;
          p.media.activeAssetId = asset.id;
          if (!p.timeline.audioClips.length) {
            p.timeline.audioClips.push({ id: uid('clip'), assetId: asset.id, timelineStartSec: 0, srcStartSec: 0, lengthSec: Math.round(asset.durationSec * 1e6) / 1e6, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: f.name });
          }
        }
      }, '导入音频资产');
      await store.storage.putAsset(store.getState().projectId, asset.id, f);
    } catch { toast(`「${f.name}」无法解码，已跳过`); }
  }
  if (first && !audio.activeId) { try { audio.setActiveAsset(first.id); } catch {} }
  toast(`已导入 ${list.length} 个音频文件到媒体库`);
}
function setActiveAssetFlow(id) {
  const a = audio.assets.get(id);
  const meta = store.getState().project?.media?.assets?.find(x => x.id === id);
  if (!a && !meta) return;
  if (a) audio.setActiveAsset(id);
  store.mutate(p => {
    p.media.activeAssetId = id;
    if (a) { p.audio.name = a.name; p.audio.durationSec = a.durationSec; }
  }, '切换配乐');
  toast(`配乐已切换：${a?.name || meta?.name}`);
}
function removeAssetFlow(id) {
  const s = store.getState();
  const p = s.project;
  const a = p?.media?.assets?.find(x => x.id === id);
  if (!a) return;
  const isActive = p.media.activeAssetId === id;
  if (isActive && !confirm(`删除当前配乐「${a.name}」？其全部剪辑将一并移除（可用撤销恢复）。`)) return;
  store.mutate(pr => {
    pr.media.assets = pr.media.assets.filter(x => x.id !== id);
    pr.timeline.audioClips = pr.timeline.audioClips.filter(c => c.assetId !== id);
    if (pr.media.activeAssetId === id) pr.media.activeAssetId = pr.media.assets[0]?.id ?? null;
    if (!pr.media.assets.length) { pr.audio.name = ''; pr.audio.durationSec = 0; }
    else if (pr.media.activeAssetId === pr.media.assets[0].id && !pr.audio.name) {
      pr.audio.name = pr.media.assets[0].name;
      pr.audio.durationSec = pr.media.assets[0].durationSec;
    }
  }, '删除音频资产');
  audio.assets.delete(id);
  if (audio.activeId === id) {
    const next = store.getState().project?.media?.activeAssetId;
    if (next && audio.assets.has(next)) audio.setActiveAsset(next);
    else { audio.dispose(); audio.activeId = null; }
  }
  toast(`已删除资产「${a.name}」`);
}
// C13 落点换算共用件：clientX/Y → sec + lane→trackId → createClipFromDrop。
// 两个 drop 入口共用：#tl-scroll 直落（弹窗关）与媒体库弹窗遮罩转发（弹窗开，
// 'wuzhen:tl-asset-drop' 事件，见 wireAudioPanel）——换算只此一份，不重复造轮子。
async function createClipFromDropAt(assetId, clientX, clientY, file) {
  const sec = musicTl.secFromClientX(clientX);
  // 多轨（汇合轮）：落点在哪个 lane 就归属哪条轨（画布坐标 → lane → trackId）
  const cvR = musicTl.cv.getBoundingClientRect();
  const laneTrack = musicTl.trackAtLane(store.getState().project, musicTl.laneIndexAt(store.getState().project, clientY - cvR.top));
  await createClipFromDrop(assetId, sec, file, laneTrack?.id || null);
}
// 媒体资产 → 音轨落点生成 clip（C13：媒体库拖入 / 文件拖入时间轴；trackId=落点 lane 所在轨）
async function createClipFromDrop(assetId, sec, file, trackId = null) {
  const s = store.getState();
  if (!s.editMode) { toast('编辑已关闭，无法放置剪辑'); return; }
  if (player.playing || player.countin) player.pause();
  let assetIdFinal = assetId;
  if (file) {
    try {
      const asset = await audio.addAsset(file, file.name);
      if (!asset.durationSec) throw new Error('无法解码');
      assetIdFinal = asset.id;
      store.mutate(p => {
        p.media = p.media || { assets: [], activeAssetId: null };
        if (!p.media.assets.some(a => a.id === asset.id)) p.media.assets.push({ id: asset.id, name: file.name, durationSec: asset.durationSec, size: file.size });
        if (!p.audio.name) { p.audio.name = file.name; p.audio.durationSec = asset.durationSec; p.media.activeAssetId = asset.id; }
      }, '导入音频资产');
      await store.storage.putAsset(s.projectId, asset.id, file);
    } catch { toast('音频无法解码，已忽略'); return; }
  }
  const p = store.getState().project;
  const meta = p.media?.assets?.find(a => a.id === assetIdFinal);
  if (!meta) { toast('资产不存在'); return; }
  const sameCount = M.clipsOf(p).filter(c => c.assetId === assetIdFinal).length;
  store.mutate(pr => {
    pr.timeline.audioClips.push({
      id: uid('clip'), assetId: assetIdFinal,
      ...(trackId ? { trackId } : {}),
      timelineStartSec: Math.max(0, Math.round(sec * 1e6) / 1e6), srcStartSec: 0,
      lengthSec: meta.durationSec, fadeInSec: 0, fadeOutSec: 0, gain: 1,
      name: `${meta.name}${sameCount ? ' ' + (sameCount + 1) : ''}`,
    });
  }, '放置音频剪辑');
  const created = M.clipsOf(store.getState().project).at(-1);
  if (created) { musicTl.clipSel = new Set([created.id]); musicTl.render(); }
}
// 「按队形段自动切」（P1 · C18）已随决策③从音乐模式移除（M1）——原 autoSplitByFormations
// 与 mtb-auto-split 接线退役；autoSplitAtBoundaries 纯函数保留在 audio-clips.js（模型层，单测覆盖）。

// ---------- 移动端 Tab ----------
function wireMobileTabs() {
  document.querySelectorAll('#mobile-tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#mobile-tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.body.dataset.mtab = b.dataset.mtab;
      setTimeout(() => { stageView?.requestDraw(); musicTl?.render(); }, 60);
    });
  });
  document.body.dataset.mtab = 'stage';
}

// ---------- 说明书（桌面页签内容 + 移动端全屏覆盖层，同一 renderManual） ----------
function wireManual() {
  const panel = $('props-manual'), body = $('manual-overlay-body');
  if (!panel || !body) return;
  panel.append(renderManual({ build: BUILD_TAG }));
  body.append(renderManual({ build: BUILD_TAG }));
  $('btn-manual-open')?.addEventListener('click', () => { $('manual-overlay').hidden = false; body.scrollTop = 0; });
  $('btn-manual-close')?.addEventListener('click', () => { $('manual-overlay').hidden = true; });
}

// ---------- 项目库 ----------
function wireLibrary() {
  $('btn-new-project').addEventListener('click', () => showNewProjectModal(opts => { store.createNewProject(opts); player.stop(); }));
}
// 离线档（file://）一次性提示：仅 file 源显示，关闭后 localStorage 记住已读（file 下持久）
function wireOfflineNote() {
  const note = $('offline-note');
  if (!note) return;
  let show = false;
  try {
    show = store.isFileOrigin() && localStorage.getItem('wuzhen:offlineNoteDismissed') !== '1';
  } catch { show = store.isFileOrigin(); } // 隐私模式下 localStorage 不可用则每次都提示
  note.hidden = !show;
  $('offline-note-close').addEventListener('click', () => {
    note.hidden = true;
    try { localStorage.setItem('wuzhen:offlineNoteDismissed', '1'); } catch {}
  });
}
function renderLibraryView() {
  const s = store.getState();
  renderLibrary($('library-grid'), {
    projects: s.library,
    onOpen: p => store.openProject(p.id).then(ok => { if (ok) { player.stop(); restoreAudio(); } }),
    onDelete: p => { if (confirm(`删除项目「${p.meta.title}」？不可恢复`)) store.deleteProjectById(p.id); },
    onDuplicate: p => store.duplicateProject(p.id),
    onNew: () => showNewProjectModal(opts => { store.createNewProject(opts); player.stop(); }),
  });
}

// ---------- 属性面板 ----------
function buildProps() {
  const s = store.getState();
  const f = currentFormation();
  if (!f) return;
  const durKey = s.project.timeline.blocks.map(b => `${b.holdBeats}:${b.travelBeats}`).join(',');
  const key = `${s.project.formations.map(x => x.id).join(',')}|${s.formationIndex}|${s.selection.join(',')}|${durKey}|${f.combined !== false}|${M.labelModeOf(s.project)}`;
  if (key === propsKey) return;
  propsKey = key;
  // 队形页
  const page = $('props-formation');
  page.innerHTML = '';
  page.append(
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, `队形 ${s.formationIndex + 1} / ${s.project.formations.length}`),
      h('div', { class: 'prop-row' }, h('label', {}, '名称'),
        h('input', { type: 'text', value: f.name, onchange: e => store.mutate(p => { p.formations[s.formationIndex].name = e.target.value; }, '重命名队形') })),
      h('div', { class: 'prop-row' }, h('label', {}, '颜色'),
        h('input', { type: 'color', value: f.color, onchange: e => store.mutate(p => { p.formations[s.formationIndex].color = e.target.value; }, '队形颜色') })),
      // 时间轴时长：保持/过渡可独立调整（决定音乐里这段队形的快慢）
      (() => {
        const blk = s.project.timeline.blocks[s.formationIndex];
        const hasNext = s.formationIndex < s.project.formations.length - 1;
        const setDur = (key, v) => {
          store.mutate(p => {
            const b = p.timeline.blocks[s.formationIndex];
            const n = Number(v);
            b[key] = Number.isFinite(n) ? Math.max(0.5, Math.min(999, n)) : b[key];
          }, key === 'holdBeats' ? '调整保持时长' : '调整过渡时长');
          syncLoopAfterBlockEdit(); // 面板输数改时长后循环区间跟随（DEFECT-R26-4）
        };
        return h('div', { class: 'prop-group' },
          h('div', { class: 'pg-title' }, '时间轴时长（拍）'),
          h('div', { class: 'prop-row' }, h('label', {}, '保持到下一队形前'),
            h('input', { type: 'number', min: '0.5', max: '999', step: '1', value: blk.holdBeats, onchange: e => setDur('holdBeats', e.target.value) })),
          hasNext ? h('div', { class: 'prop-row' }, h('label', {}, '变换到下一队形'),
            h('input', { type: 'number', min: '0.5', max: '999', step: '1', value: blk.travelBeats, onchange: e => setDur('travelBeats', e.target.value) }))
            : h('div', { class: 'dim' }, '最后一个队形，无过渡'),
          h('div', { class: 'dim' }, '过渡越长变换越慢；与切帧预览的界面动画互不影响'));
      })(),
      h('div', { class: 'prop-row' },
        h('button', { class: 'btn small', onclick: () => moveFormationRel(-1), disabled: s.formationIndex === 0, title: '上移' }, h('span', { html: iconHtml('arrow-up') }), ' 上移'),
        h('button', { class: 'btn small', onclick: () => moveFormationRel(1), disabled: s.formationIndex === s.project.formations.length - 1, title: '下移' }, h('span', { html: iconHtml('arrow-down') }), ' 下移')),
      h('div', { class: 'prop-row' }, h('label', {}, '备注'), ),
      h('textarea', { class: 'note', placeholder: '这一段的动作要点…', onchange: e => store.mutate(p => { p.formations[s.formationIndex].note = e.target.value; }, '队形备注') }, f.note || '')),
    selectionProps(f, s));
  // 舞台页
  const st = s.project.stage;
  const sp = $('props-stage');
  sp.innerHTML = '';
  sp.append(
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '舞台尺寸（米）'),
      h('div', { class: 'prop-row' }, h('label', {}, '宽'), h('input', { type: 'number', min: '4', max: '50', step: '0.5', value: st.widthM, onchange: e => stageChange('widthM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '深'), h('input', { type: 'number', min: '4', max: '50', step: '0.5', value: st.depthM, onchange: e => stageChange('depthM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '后台区'), h('input', { type: 'number', min: '0', max: '10', step: '0.5', value: st.backstageM, onchange: e => stageChange('backstageM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '观众方向'),
        h('select', { onchange: e => stageChange('audience', e.target.value) },
          ...['bottom', 'top', 'left', 'right'].map(v => h('option', { value: v, ...(st.audience === v ? { selected: true } : {}) }, { bottom: '下方', top: '上方', left: '左侧', right: '右侧' }[v]))))),
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '网格'),
      h('div', { class: 'prop-row' }, h('label', {}, '网格间距'), h('input', { type: 'number', min: '0.1', max: '2', step: '0.1', value: st.gridM, onchange: e => stageChange('gridM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '拖动吸附'), h('input', { type: 'checkbox', ...(st.snap ? { checked: true } : {}), onchange: e => stageChange('snap', e.target.checked) }))),
    // 显示字段（round23 需求 2）：canvas 舞者标签与合并单元编号的呈示来源，persist 进 project.settings
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '舞者标签'),
      h('div', { class: 'prop-row' }, h('label', {}, '显示字段'),
        h('select', { onchange: e => store.mutate(p => {
          p.settings = p.settings || {};
          p.settings.labelMode = M.LABEL_MODES.includes(e.target.value) ? e.target.value : 'no';
        }, '显示字段') },
        ...M.LABEL_MODES.map(v => h('option', { value: v, ...(M.labelModeOf(s.project) === v ? { selected: true } : {}) },
          { no: '编号序号', short: '简称', name: '姓名' }[v])))),
      h('div', { class: 'dim' }, '作用于舞台画布、合并单元编号与全部缩略图；姓名缺失时回退简称→序号，长名自动截断。')),
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '背景图'),
      h('div', { class: 'prop-row' },
        h('button', { class: 'btn small', onclick: () => {
          const inp = h('input', { type: 'file', accept: 'image/*' });
          inp.addEventListener('change', () => {
            const file = inp.files[0]; if (!file) return;
            const rd = new FileReader();
            rd.onload = () => stageChange('bgImage', { src: rd.result });
            rd.readAsDataURL(file);
          });
          inp.click();
        } }, '上传背景…'),
        st.bgImage ? h('button', { class: 'btn small', onclick: () => stageChange('bgImage', null) }, '清除') : null)));
}
const STAGE_NUMERIC_KEYS = new Set(['widthM', 'depthM', 'backstageM', 'gridM']);
const STAGE_RANGE = { widthM: [4, 50], depthM: [4, 50], backstageM: [0, 10], gridM: [0.1, 2] }; // 与输入框 min/max 同域
function stageChange(k, v) {
  // number input 的 value 是字符串：必须转数值，否则坐标拼接/钳制/网格全部损坏。
  // DEFECT-R37-2：原 `Number(v) || 原值` 只挡 0/NaN——负数/超上限（如 -2、100）会原样写入，
  // 舞台几何随之损坏（宽为负、超域）。现按各字段文档域钳制：越界/非法一律回退原值，
  // 并强制重建舞台页让输入框回显实际生效值（不再停留非法键入）。
  let val = v;
  if (STAGE_NUMERIC_KEYS.has(k)) {
    const n = Number(v);
    const [lo, hi] = STAGE_RANGE[k] || [4, 50];
    val = (Number.isFinite(n) && n >= lo && n <= hi) ? n : store.getState().project.stage[k];
    propsKey = ''; // 强制 buildProps 重建（否则输入框停留在被拒的键入值）
  }
  stageView.view = null; // 先复位视图，再触发重绘
  store.mutate(p => {
    p.stage[k] = val;
  }, '舞台设置');
}
function moveFormationRel(d) {
  const s = store.getState();
  const to = s.formationIndex + d;
  if (to < 0 || to >= s.project.formations.length) return;
  player.pause(); // 任务#16（报告#16）：与左栏拖拽排序（hooks.move）同守卫——播放中重排先暂停，防内容在播放头下换位
  store.mutate(p => { M.moveFormation(p, s.formationIndex, to); }, '调整队形顺序');
  store.setUI({ formationIndex: to, selection: [] });
}
function selectionProps(f, s) {
  const sel = s.selection;
  const group = h('div', { class: 'prop-group' });
  group.append(h('div', { class: 'pg-title' }, `选中 ${sel.length} 人`));
  if (!sel.length) {
    group.append(h('div', { class: 'dim' }, '点击/框选舞者进行编辑；合并单元成员自动整单元入选。'));
    return group;
  }
  for (const id of sel.slice(0, 8)) {
    const d = M.dancerById(s.project, id);
    const p = f.positions[id];
    if (!d || !p) continue;
    group.append(h('div', { class: 'prop-row' },
      h('label', { style: `color:${d.color};font-weight:600` }, `${d.short} ${d.name}`),
      h('span', { class: 'ctl' }, '朝向',
        h('input', { type: 'number', min: '0', max: '359', value: Math.round(p.facing), style: 'width:56px', onchange: e => store.mutate(pr => { const ff = pr.formations[s.formationIndex]; if (ff.positions[id]) ff.positions[id].facing = +e.target.value || 0; }, '调整朝向') }))));
  }
  if (sel.length > 8) group.append(h('div', { class: 'dim' }, `…等 ${sel.length} 人`));
  return group;
}

// ---------- 编组（RTS 式：纯选择辅助，唯一用途=快速选中一组人一起移动/编辑/删除） ----------
// 组选择遵循轮4单元原子规则：组成员若在合并单元中，展开为整单元两人
function groupSelect(memberIds, { add = false } = {}) {
  const ids = M.expandUnits(currentFormation(), memberIds || []);
  selectIds(ids, { add });
}
function selectGroupN(n, { add = false } = {}) {
  const p = store.getState().project;
  const g = (p.groups || [])[n - 1];
  if (g) groupSelect(g.memberIds, { add });
}
function saveSelectionAsGroupN(n = null) {
  const s = store.getState();
  if (!s.editMode) return;
  const sel = [...s.selection];
  if (!sel.length) { toast('请先选中要存为编组的舞者'); return; }
  store.mutate(p => {
    p.groups = p.groups || [];
    const g = n != null ? p.groups[n - 1] : null;
    if (g) {
      g.memberIds = [...sel]; // Ctrl+N：覆盖第 N 组
      toast(`编组 ${n}（${g.name}）已更新为 ${sel.length} 人`);
    } else {
      const ng = M.createGroup(p, sel);
      toast(`已存为编组「${ng.name}」(${sel.length} 人)`);
    }
  }, n != null ? `覆盖编组 ${n}` : '存为编组');
}
let groupsKey = '';
function buildGroupsPanel() {
  const s = store.getState();
  const p = s.project;
  const host = $('props-groups');
  if (!host || !p) return;
  const groups = p.groups || [];
  const key = JSON.stringify(groups) + '|' + s.selection.join(',') + '|' + s.formationIndex;
  if (key === groupsKey) return;
  groupsKey = key;
  host.innerHTML = '';
  host.append(
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, `编组（${groups.length}）`),
      h('div', { class: 'dim' }, '编组只是快速选择辅助：1..9 选中、Shift+1..9 追加、Ctrl+1..9 把当前选择存入对应编号（覆盖）。可与合并交叉叠加，删除组不删除舞者。Safari 请用编组选项卡：Cmd+1..9 被浏览器保留用于切换标签页（事件不到页面），请改用本面板「选择」按钮。'),
      ...groups.map((g, i) => {
        const row = h('div', { class: 'grp-row', title: '点击选中该组（成员若在合并单元中会展开为整单元）' },
          h('span', { class: 'grp-name' }, `${i + 1}. ${g.name}`),
          h('span', { class: 'dim' }, `${g.memberIds.length}人`),
          h('span', { class: 'grp-ops' },
            h('button', { class: 'btn small', title: '选中该组成员', onclick: e => { e.stopPropagation(); selectGroupN(i + 1); } }, '选择'),
            h('button', { class: 'btn small', title: '重命名', onclick: e => {
              e.stopPropagation();
              const nn = prompt('新组名', g.name);
              if (nn && nn.trim()) store.mutate(p2 => { M.renameGroup(p2, g.id, nn); }, '重命名编组');
            } }, '重命名'),
            h('button', { class: 'btn small danger', title: '删除组（不影响舞者）', onclick: e => {
              e.stopPropagation();
              store.mutate(p2 => { M.removeGroup(p2, g.id); }, '删除编组');
            } }, '删除')));
        row.addEventListener('click', () => selectGroupN(i + 1));
        return row;
      }),
      !groups.length ? h('div', { class: 'dim' }, '暂无编组：框选舞者后点「＋ 存为编组」，或按 Ctrl+1..9 保存。') : null,
      h('div', { style: 'display:flex;gap:6px;margin-top:4px' },
        h('button', { class: 'btn small', disabled: !s.selection.length, title: '把当前选择捕获为新编组（自动命名）', onclick: () => saveSelectionAsGroupN() }, '＋ 存为编组'))));
}

// ---------- 样式面板 ----------
let stylePanelBuilt = false;
const styleRefs = {};
function buildStylePanel() {
  if (stylePanelBuilt) return;
  stylePanelBuilt = true;
  const host = $('props-style');
  host.append(
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '选中与把手'),
      h('div', { class: 'prop-row' }, h('label', {}, '朝向把手（选中单人时显示，拖动调整朝向）'),
        h('input', { type: 'checkbox', id: 'sty-facing', onchange: e => store.setUI({ showFacingHandle: e.target.checked }) }))),
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '舞台显示'),
      h('div', { class: 'prop-row' }, h('label', {}, 'Ghost 虚影（前后队形）'),
        h('input', { type: 'checkbox', id: 'sty-ghost', onchange: e => store.setUI({ showGhost: e.target.checked }) })),
      h('div', { class: 'prop-row' }, h('label', {}, '移动路径（虚线）'),
        h('input', { type: 'checkbox', id: 'sty-paths', onchange: e => store.setUI({ showPaths: e.target.checked }) })),
      h('div', { class: 'prop-row' }, h('label', {}, '网格'),
        h('input', { type: 'checkbox', id: 'sty-grid', onchange: e => store.setUI({ showGrid: e.target.checked }) }))),
    h('div', { class: 'dim' }, '提示：以上均为显示样式，不影响队形数据。工具栏的「幽灵 / 路径」按钮与本面板同步。'));
  styleRefs.facing = $('sty-facing');
  styleRefs.ghost = $('sty-ghost');
  styleRefs.paths = $('sty-paths');
  styleRefs.grid = $('sty-grid');
}

// ---------- 快捷键 ----------
function wireKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (store.getState().view !== 'editor') return;
    const s = store.getState();
    if (e.code === 'Space') {
      // 空格按住=平移修饰键（空格+左键空白拖动=平移）；原"空格=播放/暂停"延迟到
      // keyup：若按住期间空格参与了指针手势（平移），则不触发播放切换
      e.preventDefault();
      stageView.setSpaceHeld(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    // ⌘⇧L = 乐段索引面板开/关（W4 §2.5 可选项；两模式同组件）
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault(); toggleSegIndexPanel(); return;
    }
    // 说明书全屏覆盖层开着时 Esc=先关层（不穿透到舞台手势/选择）
    if (e.key === 'Escape') {
      const ov = $('manual-overlay');
      if (ov && !ov.hidden) { ov.hidden = true; return; }
      if (siState.open) { closeSegIndexPanel(); return; } // W4：乐段索引面板 Esc=先关面板
    }
    // v3 音频轨：Esc=退出剃刀 → 清 clip 选择/时间选区（规格 §5）
    if (e.key === 'Escape' && musicTl) {
      if (musicTl.razor) { musicTl.setRazor(false); syncMusicToggles(); return; }
      if (musicTl.clipSel.size || musicTl.timeSel) { musicTl.clearClipSelection(); return; }
    }
    // v3：Ctrl/Cmd+K = 播放头处分割选中 clip（规格 §5/C6）——W2 起剪辑编辑归音乐模式
    //（编舞简单道只读，同 E-10 口径；编舞按 K 无动作）
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (musicTl?.mode === 'music') musicTl.splitAtPlayhead();
      return;
    }
    if (e.key === 'Escape') {
      if (player?.countin && player.cancelCountin()) return; // 任务#5：数拍入场中 Esc=取消倒计（先于其它取消语义）
      if (stageView?.gestureCancel()) return; store.setUI({ selection: [] }); return;
    }
    // RTS 编组快捷键：Ctrl/Cmd+1..9 = 把当前选择存为编组 N（覆盖）——先于其余修饰键放行
    const digit = /^Digit([1-9])$/.exec(e.code || '');
    if (digit && (e.ctrlKey || e.metaKey) && !e.altKey) {
      if (!s.editMode) return;
      e.preventDefault();
      saveSelectionAsGroupN(+digit[1]);
      return;
    }
    // Alt+←/→ = 播放头秒步进 ±0.5s（决策⑥：变速曲的降级对齐手段——不依赖拍线，按秒推播放头）。
    // M3 T8：音乐模式有选中 clip 时改义为选中 clip 微移 ±0.1s（Alt 步进语义延伸到 clip）。
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); // 同步阻断 Alt+←/→ 的浏览器历史导航语义
      if (musicTl?.mode === 'music' && musicTl.clipSel?.size) {
        musicTl.nudgeSelected(e.key === 'ArrowRight' ? 1 : -1, { step: 0.1 });
        return;
      }
      const p = store.getState().project;
      if (p && player) {
        const cur = M.beatToSec(p, Math.max(0, player.beat || 0));
        const next = Math.max(0, cur + (e.key === 'ArrowRight' ? 0.5 : -0.5));
        player.seekBeat(Math.max(0, M.secToBeat(p, next)));
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 其余单键快捷键不与浏览器/系统修饰键冲突
    // M = 双 UI 模式切换（编舞⇄音乐）；播放/数拍中禁止（setUiMode 内 toast「暂停后可切换」）。
    // 视图级动作，编辑锁关闭时同样可用；输入框焦点已在函数入口排除。
    if (e.key.toLowerCase() === 'm' && musicTl) { e.preventDefault(); setUiMode(musicTl.mode === 'music' ? 'stage' : 'music'); return; }
    // 1..9 = 快速选中编组 N；Shift+1..9 = 追加选择编组 N（e.code 判定兼容 Shift 产生的 !@# 等字符）
    if (digit && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!s.editMode) return;
      e.preventDefault();
      selectGroupN(+digit[1], { add: e.shiftKey });
      return;
    }
    if (e.key.toLowerCase() === 'e') { store.setUI({ editMode: !s.editMode }); return; } // 编辑开关
    if (!s.editMode) return; // 查看模式下禁用编辑类快捷键
    // ---- v3 音频轨快捷键（规格 §5）----
    if (e.key.toLowerCase() === 's' && musicTl?.hoverAudio) { e.preventDefault(); musicTl.toggleSnap(); syncMusicToggles(); return; } // S（hover 音轨）=磁吸开关
    if (e.key.toLowerCase() === 'r' && musicTl?.hoverAudio) { e.preventDefault(); musicTl.setRazor(); syncMusicToggles(); return; }   // R（hover 音轨）=剃刀
    if ((e.key === 'Delete' || e.key === 'Backspace') && musicTl?.clipSel?.size && !s.selection.length && musicTl.mode === 'music') {
      e.preventDefault();
      musicTl.deleteSelected(e.altKey); // Alt+Delete=波纹删除
      return;
    }
    if (e.key === 'Home' && musicTl) { e.preventDefault(); player.seekBeat(0); return; }
    if (e.key === 'End' && musicTl) {
      e.preventDefault();
      const p = store.getState().project;
      if (p) {
        // M1 模式感知：End 键域 music=音乐域尾（音频全长可达）；stage=取小者（逐值不动）
        const endSec = musicTl.mode === 'music'
          ? M.musicDomainSec(p)
          : Math.min(M.beatToSec(p, M.computeSegments(p).totalBeats), lastClipEndSec(M.clipsOf(p)));
        player.seekBeat(M.secToBeat(p, endSec));
      }
      return;
    }
    if (e.key.startsWith('Arrow') && musicTl?.clipSel?.size && !s.selection.length && musicTl.mode === 'music') {
      e.preventDefault(); // C3：选中 clip 微移（plain=逐帧 10ms；Shift=按网格步进整拍）——剪辑编辑归音乐模式
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (dir) musicTl.nudgeSelected(dir, { grid: e.shiftKey });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (s.selection.length) {
        e.preventDefault();
        store.mutate(p => {
          const f = p.formations[s.formationIndex];
          for (const id of s.selection) delete f.positions[id];
        }, '移出队形');
        store.setUI({ selection: [] });
      }
      return;
    }
    if (e.key.toLowerCase() === 'd') { addFormation(); return; }
    if (e.key.toLowerCase() === 'g') { store.mutate(p => { p.stage.snap = !p.stage.snap; }, '切换吸附'); return; }
    if (e.key.toLowerCase() === 'f') {
      // DEFECT-R37-1：同整体旋转——无选择=全体走 Object.keys
      const ids = s.selection.length ? expandedSelection() : [...Object.keys(currentFormation()?.positions || {})];
      store.mutate(p => {
        shapes.faceAll(p.formations[s.formationIndex].positions, ids, 'audience', { stage: p.stage, project: p });
      }, '面向观众');
      return;
    }
    if (e.key.startsWith('Arrow') && s.selection.length) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : (s.project.stage.snap ? s.project.stage.gridM : 0.1);
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      const bs = s.project.stage.backstageM ?? 0;
      store.mutate(p => {
        const f = p.formations[s.formationIndex];
        for (const id of expandedSelection()) {
          const q = f.positions[id];
          if (q) {
            q.x = Math.min(p.stage.widthM + bs, Math.max(-bs, q.x + dx));
            q.y = Math.min(p.stage.depthM + bs, Math.max(-bs, q.y + dy));
          }
        }
      }, '微调位置');
    }
  });
  // 空格 keyup：结束平移修饰键状态；按住期间未参与指针手势 → 维持原"空格=播放/暂停"
  document.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (store.getState().view !== 'editor') return;
    if (!stageView?.spaceHeld) return;
    const used = stageView.setSpaceHeld(false);
    if (!used) togglePlay();
  });
  window.addEventListener('blur', () => stageView?.setSpaceHeld(false)); // 焦点丢失防修饰键卡住
}

// ---------- 移动端队形索引条（round23 需求 3 重设计） ----------
// chip 画布按舞台（含后台）纵横比定宽 × dpr 绘制（不拉伸不裁切、高分屏清晰）；当前帧
// 高亮强化（主题色描边+光晕+编号着色）；条尾 ＋/－ 直达加减队形（移动端舞台 tab 无需切 tab）；
// 每次 render 全量重绘缩略图——队形编辑提交后像素即时跟随（红线 C-03 同源语义）。
let indexKey = '';
let indexThumbs = []; // 与队形顺序对齐的 chip canvas 列表
function renderFormationIndex(state) {
  const host = document.getElementById('formation-index');
  if (!host) return;
  const p = state.project;
  if (!p) { host.innerHTML = ''; indexThumbs = []; return; }
  const key = p.formations.map(f => f.id).join(',') + '|' + state.formationIndex;
  if (key !== indexKey) {
    indexKey = key;
    host.innerHTML = '';
    indexThumbs = [];
    p.formations.forEach((f, i) => {
      const chip = document.createElement('button');
      chip.className = 'fi-chip' + (i === state.formationIndex ? ' active' : '');
      chip.title = (i + 1) + ' ' + f.name;
      const num = document.createElement('span');
      num.className = 'fi-num';
      num.textContent = String(i + 1);
      const cv = document.createElement('canvas');
      const label = document.createElement('span');
      label.className = 'fi-label';
      label.textContent = f.name;
      chip.append(num, cv, label);
      chip.addEventListener('click', () => switchFormation(i));
      host.append(chip);
      indexThumbs.push(cv);
    });
    // 加/减操作直达：＋ 新队形（复制当前后插）、－ 删除当前队形（守卫同面板按钮）
    const mkBtn = (txt, title, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'fi-btn' + (cls ? ' ' + cls : '');
      b.textContent = txt;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    host.append(
      mkBtn('＋', '新队形（复制当前）', '', () => addFormation()),
      mkBtn('－', '删除当前队形', 'fi-danger', () => deleteFormation()));
  }
  drawIndexThumbs(p);
  // 当前帧滚入可视区
  const active = host.children[state.formationIndex];
  if (active) {
    const hr = host.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    if (ar.left < hr.left || ar.right > hr.right) {
      host.scrollLeft += ar.left - (hr.left + hr.width / 2) + ar.width / 2;
    }
  }
}
function drawIndexThumbs(p) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const H = 44; // 紧凑版固定高；宽按舞台纵横比反推（画布即舞台，无 letterbox）
  const bs = p.stage.backstageM ?? 0;
  const bw = p.stage.widthM + bs * 2, bh = p.stage.depthM + bs * 2;
  const w = Math.max(24, Math.round(H * bw / bh));
  indexThumbs.forEach((cv, i) => {
    const f = p.formations[i];
    if (!f) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = w + 'px'; cv.style.height = H + 'px';
    }
    drawScene(cv.getContext('2d'), { x: 0, y: 0, w, h: H }, p, f.positions, { minimal: true, pad: 2, merges: f.merges || [] });
  });
}

// ---------- 总渲染 ----------
let audioVals = {};
function render(state) {
  trackViewForSentinel(state.view); // F-04：视图迁移驱动哨兵压入/弹出（含按钮与 popstate 双路径）
  const isLib = state.view === 'library';
  $('library-view').hidden = isLib ? false : true;
  $('editor-view').hidden = isLib ? true : false;
  if (isLib) { renderLibraryView(); return; }
  const p = state.project;
  if (!p) return;
  // 顶栏
  if (document.activeElement !== $('proj-title')) $('proj-title').value = p.meta.title;
  renderUndoButtons();
  // 工具按钮状态
  $('btn-edit-mode').classList.toggle('toggled-on', state.editMode);
  $('btn-multi').classList.toggle('toggled-on', state.multiSelect);
  $('btn-ghost').classList.toggle('toggled-on', state.showGhost);
  $('btn-paths').classList.toggle('toggled-on', state.showPaths);
  $('btn-switch-anim').classList.toggle('toggled-on', state.previewOnSwitch);
  $('btn-theme').innerHTML = iconHtml(state.theme === 'light' ? 'sun' : 'moon'); // 图标化（决策⑤）：data-icon=sun|moon 供仪器断言
  applyUiMode(musicTl?.mode || 'stage'); // 双 UI 模式：随渲染同步（往返一致性兜底）
  // 决策①（M3 正式实装）：⏮⏭ 按模式呈示语义（music=前后 clip 缘步进，无缘=域首/域尾；
  // stage=队形步进不动）。刷新点两处：本 render 与 setUiMode（DEFECT-R63-1——切模式立即生效）
  const pbInMusic = (musicTl?.mode || 'stage') === 'music';
  $('pb-prev').title = pbInMusic ? '上一个 clip 缘（无缘=开头）' : '上一队形';
  $('pb-next').title = pbInMusic ? '下一个 clip 缘（无缘=结尾）' : '下一队形';
  syncScaleToggle(); // 尺规刻度按钮呈示（决策⑥）
  buildStylePanel();
  styleRefs.facing.checked = state.showFacingHandle;
  styleRefs.ghost.checked = state.showGhost;
  styleRefs.paths.checked = state.showPaths;
  styleRefs.grid.checked = state.showGrid;
  const curF = state.project?.formations[state.formationIndex];
  // 合并/取消合并按钮可用性（按原始选择与当前帧 merges）
  const curMerges = curF?.merges || [];
  $('btn-merge-create').disabled = state.selection.length !== 2;
  $('btn-merge-cancel').disabled = !state.selection.some(id => curMerges.some(m => m.a === id || m.b === id));
  $('formation-count').textContent = `${p.formations.length}`;
  renderFormationIndex(state);
  // 面板（统一时间线：编队条 + 波形时间线常驻）
  leftStrip.render();
  buildProps();
  buildGroupsPanel();
  musicTl.render();
  syncTransportTracks(p); // 多轨：引擎 _tracks 持久同步（载入/undo/redo/轨结构变化兜底，幂等）
  syncTracksHead(p);      // 多轨：音乐模式轨头 DOM（轨名/音量/静音/删轨/加轨）随轨态重建
  // 音频面板
  if (document.activeElement !== $('bpm-input')) $('bpm-input').value = Math.round(p.audio.bpm);
  if (document.activeElement !== $('offset-input')) $('offset-input').value = p.audio.firstBeatSec || 0;
  $('bpb-select').value = String(p.audio.beatsPerBar || 4);
  if (document.activeElement !== $('countin-input')) $('countin-input').value = p.timeline.countInBeats ?? 8;
  $('ripple-check').checked = state.ripple;
  $('pb-metro').checked = !!p.timeline.metronome;
  // 块时长快捷栏
  const blk = p.timeline.blocks[state.formationIndex];
  if (blk) {
    const fmtB = v => String(Math.round(v * 10) / 10);
    const spbv = M.spb(p);
    const fmtS = v => (v * spbv).toFixed(1).replace(/\.0$/, '');
    const isLast = state.formationIndex >= p.formations.length - 1;
    $('bc-name').textContent = `${state.formationIndex + 1}. ${currentFormation()?.name || ''}`;
    $('bc-hold').textContent = `${fmtB(blk.holdBeats)}拍·${fmtS(blk.holdBeats)}s`;
    $('bc-travel').textContent = `${fmtB(blk.travelBeats)}拍·${fmtS(blk.travelBeats)}s`;
    $('bc-travel-wrap').style.display = isLast ? 'none' : '';
    $('bc-hold-minus').disabled = blk.holdBeats <= 0.5;
    $('bc-travel-minus').disabled = !isLast && blk.travelBeats <= 0.5;
    $('bc-travel-plus').disabled = isLast;
    $('bc-sec').textContent = `（${M.beatLabel(p, 0)} 起 · 共 ${M.totalDurationSec(p).toFixed(1)}s）`;
  }
  $('audio-name').textContent = audio.ready ? `${p.audio.name} (${(p.audio.durationSec || 0).toFixed(1)}s)` : (p.audio.name ? `${p.audio.name}（重新选择文件）` : '未载入音乐');
  // 摘要条只读元（W2 C14）：BPM/小节在编舞呈只读文本（修改进音乐模式——BPM 是节拍划分产物）
  const msMeta = `BPM${Math.round(p.audio.bpm)} ${p.audio.beatsPerBar || 4}/4`;
  if ($('ms-meta').textContent !== msMeta) $('ms-meta').textContent = msMeta;
  const nTags = (p.timeline.tags || []).length;
  const msTags = nTags ? `tag ${nTags} 个 · 跳转列表` : 'tag 0 个';
  if ($('ms-tags').textContent !== msTags) $('ms-tags').textContent = msTags;
  $('ms-tags').disabled = !nTags;
  // W4：乐段索引面板开着时随数据变更重建（tags/BPM/首拍/拍号改动即时反映；expanded 集保展开态）
  if (siState.open) { renderSegIndexPanel(); siTick(); }
  // 音乐工具条镜像（音乐模式呈示面；与编舞面板同模型同步）
  $('mtb-audio-name').textContent = audio.ready ? `${p.audio.name} · ${(p.audio.durationSec || 0).toFixed(1)}s` : (p.audio.name ? `${p.audio.name}（重新选择文件）` : '未载入音乐');
  if (document.activeElement !== $('bpm-input-music')) $('bpm-input-music').value = Math.round(p.audio.bpm);
  if (document.activeElement !== $('offset-input-music')) $('offset-input-music').value = p.audio.firstBeatSec || 0;
  if (document.activeElement !== $('bpb-select-music')) $('bpb-select-music').value = String(p.audio.beatsPerBar || 4);
  if (document.activeElement !== $('countin-input-music')) $('countin-input-music').value = p.timeline.countInBeats ?? 8;
  drawMusicPreview(); // W1：preview 栏随渲染同步（队形/块数据变更兜底；播放中另有 onTick 驱动）
  syncMusicToggles(); // M5：磁吸/剃刀开关钮呈示随渲染同步（键盘 S/R 路径的兜底刷新面）
  updateMusicLock(); // 任务#2：随渲染同步 BPM/首拍/点拍锁态（暂停/播放切换的兜底刷新面）
  $('pb-formation').textContent = currentFormation() ? `${state.formationIndex + 1}. ${currentFormation().name}` : '';
  // 播放/数拍中按钮态（任务#20：数拍期同样呈 ⏸，点击=取消倒计）
  setPlayBtn(player.playing || player.countin);
  stageView.requestDraw();
}

// Node 单测直接 import 本模块（深链纯函数）：以下浏览器专属副作用一律判存后再执行
if (typeof document !== 'undefined') boot();
// 可见版本徽标：防止旧缓存页面误导验证
if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
  const bt = document.getElementById('build-tag');
  if (bt) bt.textContent = BUILD_TAG;
});

// PWA：http(s) 托管且页面带有构建注入的 manifest（dist 双文件包才注入）时注册 Service Worker →
// 断网后用 SW 缓存的 HTML 继续工作，数据由 IndexedDB 本地持久。file:// 下载版协议不符、
// dev 源码树（index.html 无 manifest link）条件不符，均一行不执行；注册失败（如宿主缺 sw.js）
// 静默吞掉——优雅降级为普通网页，应用行为与无 SW 完全一致（硬性要求）。
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && location.protocol.indexOf('http') === 0
    && document.querySelector('link[rel="manifest"]')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// 自动化测试钩子（不影响正常使用）：注入音频、读取状态
if (typeof window !== 'undefined') window.__fs = {
  store, player: () => player, audio, M, shapes, exp,
  stageView: () => stageView,
  musicTl: () => musicTl,
  // ---- E2E 就绪信号三件套（纯加法，既有字段不动）----
  // ready：boot（store init + lastProject 恢复 + 首帧渲染）完成信号；await window.__fs.ready
  ready: __fsReady,
  // renderSeq：状态驱动重绘计数（只读语义，消费方勿写）。计点两处：MusicTimeline.render()
  // 出口与 StageView.requestDraw() 出口各 +1（一次完整 render() 故 +2）；rAF/切帧动效逐帧
  // 直调 draw() 不计、drawPlayhead 局部重绘不计。waitForRender 即轮询本值变化。
  renderSeq: 0,
  // flushNow：清防抖定时器并立即 storage.putProject（幂等；无项目/无挂起写时只等在途写），
  // 供测试在断言持久化前确定性落盘，替代「盲等 400ms 防抖」
  flushNow: () => store.flushNow(),
  async loadAudioUrl(url, name = 'test.wav') {
    const r = await fetch(url);
    const b = await r.blob();
    await loadAudioFile(new File([b], name, { type: b.type || 'audio/wav' }));
    return audio.ready;
  },
  drawScene: (ctx, rect, project, positions, opts) => drawScene(ctx, rect, project, positions, opts || {}),
  snapshot() {
    const s = store.getState();
    const p = s.project;
    return {
      view: s.view, formationIndex: s.formationIndex,
      selection: s.selection,
      dancers: p?.dancers.length, groups: (p?.groups || []).length,
      formations: p?.formations.map(f => ({ name: f.name, n: Object.keys(f.positions).length })),
      positions: currentFormation()?.positions,
      blocks: p?.timeline.blocks,
      audio: { name: p?.audio.name, bpm: p?.audio.bpm, ready: audio.ready, duration: audio.duration },
      media: { assets: (p?.media?.assets || []).map(a => ({ ...a })), activeAssetId: p?.media?.activeAssetId ?? null },
      clips: (p?.timeline?.audioClips || []).map(c => ({ ...c })),
      tracks: (p?.timeline?.tracks || []).map(t => ({ ...t })), // 多轨（汇合轮探针用）：轨态快照
      clipSel: [...(musicTl?.clipSel || [])],
      timeSel: musicTl?.timeSel ? { ...musicTl.timeSel } : null,
      audioTrack: { expanded: musicTl?.expanded, snap: musicTl?.snapOn, razor: musicTl?.razor },
      uiMode: musicTl?.mode || 'stage',
      rulerScale: musicTl?.rulerScale || 'beat',
      beat: player?.beat, playing: player?.playing,
    };
  },
};
