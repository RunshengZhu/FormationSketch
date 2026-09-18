// 应用编排：视图路由、状态订阅渲染、交互接线、快捷键
import * as store from './store.js';
import * as M from './model.js';
import * as shapes from './shapes.js';
import { StageView, drawScene } from './stage.js';
import { EditStrip, MusicTimeline } from './timeline.js';
import { AudioController } from './audio.js';
import { Player } from './player.js';
import * as exp from './export.js';
import { renderLibrary, showNewProjectModal, showRosterModal, toast, h, createHistorySentinel } from './ui.js';
import { renderManual } from './manual.js';
// Node 单测直接 import 本模块（深链纯函数）：window 判存守卫；build-single.mjs 由此行正则解析版本号，勿改形态
if (typeof window !== 'undefined') window.__MAIN_BUILD = 'build-28-music';
const BUILD_TAG = (typeof window !== 'undefined' ? window.__MAIN_BUILD : 'build-28-music');

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

// ---------- 单元浮窗（合并确认 / 单元操作） ----------
let unitMenuEl = null;
const UNIT_STYLE_LABEL = { capsule: '胶囊', single: '单编号' };
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
    untie.textContent = '✂ 拆开';
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
    b.textContent = '✂ 取消合并';
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
  // 按钮区按 mode 分支（DEFECT-R-1 根因：原 else 同时覆盖 context 与 unit 两种 mode）：
  // merge → 样式×2；unit → 拆开+样式×2+删除（既有顺序不变）；context+有 merge → 样式×2+拆开+删除；
  // context+无 merge → 标题分支已加「删除」，此处不追加；multi → 合并/取消合并（按态）+删除所选（N 人）。
  // ✕ 取消按钮在下方对所有形态统一追加。
  if (payload.mode === 'merge') {
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
  } else if (payload.mode === 'unit') {
    el.append(mkUntieBtn());
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
    el.append(mkDeleteBtn()); // 删除单元 = 两名成员一并从队形与名册移除
  } else if (payload.mode === 'multi') {
    const involved = (currentFormation()?.merges || []).filter(m => payload.ids.includes(m.a) || payload.ids.includes(m.b));
    if (payload.ids.length === 2 && !involved.length) el.append(mkMultiMergeBtn());
    if (involved.length) el.append(mkMultiUntieBtn(involved));
    el.append(mkMultiDeleteBtn(payload.ids.length));
  } else if (ctxMerge) {
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
    el.append(mkUntieBtn());
    el.append(mkDeleteBtn());
  }
  const cancel = document.createElement('button');
  cancel.className = 'um-btn um-cancel';
  cancel.textContent = '✕';
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
  // v2 项目文件可内嵌音乐（dataBase64）：validateProject 会剥离该字段，先还原为 Blob，导入后回填
  let audioBlob = null;
  try {
    if (json && json.audio && json.audio.dataBase64) {
      const bin = atob(String(json.audio.dataBase64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      audioBlob = new Blob([bytes], { type: json.audio.dataFormat || 'audio/mpeg' });
      delete json.audio.dataBase64;
      delete json.audio.dataFormat;
    }
  } catch { audioBlob = null; }
  const r = deps.validate(json);
  if (!r.ok) return done({ status: 'error', reason: 'validate', errors: r.errors, message: `深链导入失败：${r.errors[0] || '项目校验未通过'}` });
  deps.importProject(r.project);
  if (audioBlob) { try { await deps.onAudio?.(audioBlob); } catch {} }
  const title = r.project.meta.title || '导入项目';
  deps.toast?.(`已导入项目：${title}${audioBlob ? '（音乐已恢复）' : ''}`);
  return done({ status: 'imported', title, hasAudio: !!audioBlob, project: r.project });
}
async function wireDeeplinkImport() {
  try {
    await runDeeplinkImport({
      url: location.href,
      baseUrl: location.href,
      fetchImpl: (u, o) => fetch(u, o),
      validate: M.validateProject,
      importProject: p => { player?.stop(); store.importProject(p); },
      onAudio: async blob => { // 与「导入项目文件…」同语义：内嵌音乐回填到新项目 id
        await store.storage.putAudio(store.getState().projectId, blob);
        // DEFECT-R26-3 同源：下载版存储往返不可用，直接回填会话音频（在线通道行为不变）
        await audio.loadBlob(blob, store.getState().project?.audio?.name || blob.name || '').catch(() => {});
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
async function boot() {
  buildStage();
  buildPlayer();
  buildStrips();
  wireTopbar();
  wireStageTools();
  wirePlaybar();
  wireAudioPanel();
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
function buildPlayer() {
  player = new Player({
    audio,
    getProject: () => store.getState().project,
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
    },
    onPreviewEnd: () => {
      // 预览结束回到编辑视图：播放头归零，舞台显示当前所选队形
      player.seekBeat(0);
      stageView?.requestDraw();
      musicTl?.drawPlayhead();
    },
    onStateChange: ({ playing, reason }) => {
      $('pb-play').textContent = playing ? '⏸' : '▶';
      if (!playing) renderUndoButtons();
      // 任务#7（报告#8）：音频先于时间轴自然结束——一次性 toast，播放头停在音频末拍
      if (reason === 'audio') toast('音乐已结束');
      updateMusicLock(); // 任务#2：播放/暂停切换即刷新 BPM/首拍锁
    },
    onCountin: n => {
      const ov = $('countin-overlay');
      if (n > 0) {
        ov.hidden = false; ov.textContent = n;
        // 任务#20（P3 cosmetic）：数拍期播放头显示「入场」、播放键呈 ⏸（可点击=取消倒计）
        $('pb-pos').textContent = '入场';
        $('pb-play').textContent = '⏸';
      } else {
        ov.hidden = true;
        $('pb-play').textContent = player.playing ? '⏸' : '▶';
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
      getPlayer: () => player,
      audio,
      getIndex: () => store.getState().formationIndex,
      ripple: () => store.getState().ripple,
      onSelectFormation: i => switchFormation(i),
      mutate: fn => store.mutate(fn, null),
      commitEdit: label => { store.commit(label); syncLoopAfterBlockEdit(); }, // 拖边改时长后循环区间跟随（DEFECT-R26-4）
      seekBeat: b => player.seekBeat(Math.max(0, b)),
    },
  });
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
  // 导出菜单
  const dd = $('export-dd'), menu = dd.querySelector('.dd-menu');
  $('btn-export').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('exp-png').addEventListener('click', () => { const f = currentFormation(); if (f) exp.exportPNG(store.getState().project, f, store.getState().theme); });
  $('exp-print').addEventListener('click', () => {
    try { exp.printFormations(store.getState().project, 'light'); } catch (e) { toast(e.message); }
  });
  // 取「应当随项目导出」的音频 Blob：优先本地存储（在线=IndexedDB）；下载版（file://→localStorage）
  // 音频不落盘、getAudio 恒为 null → 回退当前会话 AudioController 手里的 Blob（DEFECT-R26-2：
  // 否则下载版「含音乐导出」永远导不出音乐，文档承诺的「含乐导出兜底配乐不持久」失效）。
  async function getExportAudioBlob() {
    const s = store.getState();
    let blob = null;
    try { blob = await store.storage.getAudio(s.projectId); } catch {}
    if (!blob && audio?.ready && audio.blob) blob = audio.blob;
    return blob;
  }
  const doExportJSON = async (includeAudio, share) => {
    const s = store.getState();
    const blob = includeAudio ? await getExportAudioBlob() : null; // 任务#1：不含乐=明确不取 blob，导出 v1
    const res = await exp.exportProjectJSON(s.project, blob, { share });
    if (res === 'cancelled') return;
    const how = res === 'shared' ? '已通过系统分享发送' : '已导出';
    // 任务#1（报告#1）：按钮语义与行为严格对齐——不含乐导出在 toast 里明示可后补音乐
    const what = includeAudio && blob ? '（含音乐）' : '（不含音乐，可稍后重新载入）';
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
        const { project, audioBlob } = await exp.readProjectFile(inp.files[0]);
        store.importProject(project);
        player.stop();
        if (audioBlob) {
          await store.storage.putAudio(store.getState().projectId, audioBlob);
          // DEFECT-R26-3：直接回填当前会话音频通道，不再依赖存储往返——下载版（file://→localStorage）
          // putAudio/getAudio 均为 no-op，只走 restoreAudio 会导致「含乐文件导入后音乐仍丢失」，
          // 与文档「导入成功（音乐已一并恢复）」承诺相悖；在线通道经此路径行为不变。
          await audio.loadBlob(audioBlob, store.getState().project.audio.name || audioBlob.name || '').catch(() => {});
          toast('导入成功（音乐已一并恢复）');
        } else {
          toast('导入成功（该项目文件不含音乐，请重新载入音乐）');
        }
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
    const ids = sel.length ? expandedSelection() : [...currentFormation().positions.keys()];
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
    const ids = sel.length ? expandedSelection() : [...currentFormation().positions.keys()];
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
    const slots = shapes.genSlots(kind, ids.length, p.stage, { rows, unit });
    shapes.applySlots(f, ids, slots, { current: f.positions });
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
  if (playerAtEnd()) {
    // 任务#6/#7（报告#6/#7）：全曲播完后再按 ▶ 从头播（不再只重播最后一段/静默归 0）
    if (audio.ready) player.play(0);
    else player.play(0, { countIn: false, forceVirtual: true });
  } else if (player.beat > 0.001) {
    player.play(null, { countIn: false }); // 暂停后续播（音频结束态经 useAudio=false 由虚拟时钟接管）
  } else if (audio.ready) {
    player.play(seg ? seg.holdStart : 0); // 有音乐：按音乐时钟从当前队形播
  } else {
    // 无音乐：虚拟时钟（任务#6 终态统一）——不再单段预览，同音乐档一样播到 totalBeats
    // 并置 ended；循环开启时在当前队形段内回绕（虚拟时钟原生支持）
    player.play(seg ? seg.holdStart : 0, { countIn: false, forceVirtual: true });
  }
  updateLoop();
}
function playerAtEnd() {
  const { totalBeats } = M.computeSegments(store.getState().project);
  return player.beat >= totalBeats - 0.001;
}
function stepFormation(d) {
  const s = store.getState();
  const ni = Math.max(0, Math.min(s.formationIndex + d, s.project.formations.length - 1));
  switchFormation(ni);
  if (player.beat > 0.001 && !player.playing) player.seekFormation(ni);
  if ($('pb-loop').checked) updateLoop(); // 循环区间跟随队形切换
}

// ---------- 音乐面板 ----------
let tapTimes = [];
// 任务#2（报告#2）：播放/数拍中 BPM 与首拍禁改——UI disabled（title 提示「暂停后可修改」）
// + 改变路径（输入 change / 点拍写回）一律拦截，双保险消除播放头跳变与切分点脱钩
const musicLocked = () => !!(player && (player.playing || player.countin));
const MUSIC_LOCK_TIP = '暂停后可修改';
// [元素, 名称, 未锁定时的常态 title]（常态 title 与 index.html 一致，锁定时替换为统一提示）
const MUSIC_LOCK_TARGETS = [
  ['bpm-input', 'BPM', ''],
  ['offset-input', '首拍', ''],
  ['btn-tap', '点拍', '连点 3 次起算，取最近 8 次平均（停 2.5s 重新起算）'],
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
function rejectLockedMusicEdit() {
  if (!musicLocked()) return false;
  toast(`播放中不可修改，${MUSIC_LOCK_TIP}`);
  // 还原输入框显示值（change 事件已把键入值留在框里）
  const p = store.getState().project;
  if (p) {
    $('bpm-input').value = Math.round(p.audio.bpm);
    $('offset-input').value = p.audio.firstBeatSec || 0;
  }
  return true;
}
function wireAudioPanel() {
  audioPanelBuilt = true;
  // 移动端默认收起音乐设置面板，节省纵向空间
  if (window.matchMedia('(max-width: 1023.5px)').matches) $('audio-disc').open = false;
  $('btn-load-audio').addEventListener('click', () => $('audio-file').click());
  $('audio-file').addEventListener('change', async () => {
    const file = $('audio-file').files[0];
    if (!file) return;
    await loadAudioFile(file);
  });
  $('bpm-input').addEventListener('change', () => {
    if (rejectLockedMusicEdit()) return; // 任务#2：播放中拦截（含程序化 change 路径）
    store.mutate(p => { p.audio.bpm = Math.max(30, Math.min(300, +$('bpm-input').value || 120)); }, null);
  });
  $('btn-tap').addEventListener('click', () => {
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
      store.mutate(p => { p.audio.bpm = bpm; }, null);
    }
    if (tapTimes.length > 10) tapTimes = tapTimes.slice(-8);
  });
  $('offset-input').addEventListener('change', () => {
    if (rejectLockedMusicEdit()) return; // 任务#2：播放中拦截
    const v = Math.max(0, +$('offset-input').value || 0);
    store.mutate(p => { p.audio.firstBeatSec = v; }, null);
    // 任务#10（报告#10）：首拍越界（≥音频时长）一次性 toast 告警，不阻断——
    // 让「按播放没反应」的配置错误可诊断
    if (audio.ready && audio.duration && v >= audio.duration) {
      toast(`首拍（${v}s）已超出音频时长（${audio.duration.toFixed(1)}s），请确认单位为秒`);
    }
  });
  $('btn-offset-test').addEventListener('click', () => {
    if (!audio.ready) { toast('请先载入音乐'); return; }
    player.pause();
    const p = store.getState().project;
    const from = Math.max(0, (p.audio.firstBeatSec || 0) - 2);
    audio.play(from, 1);
    setTimeout(() => { if (!player.playing) audio.pause(); }, 4500);
  });
  $('bpb-select').addEventListener('change', () => store.mutate(p => { p.audio.beatsPerBar = +$('bpb-select').value; }, null));
  $('countin-input').addEventListener('change', () => store.mutate(p => { p.timeline.countInBeats = Math.max(0, Math.min(32, +$('countin-input').value || 0)); }, null));
  // 把当前队形块的起点对齐到播放头时间戳（调整前一段过渡时长）
  $('btn-align-playhead').addEventListener('click', () => {
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
  });
  $('ripple-check').addEventListener('change', () => store.setUI({ ripple: $('ripple-check').checked }));
  // 块时长快捷步进（±1拍，钳制 0.5–999）
  const stepBlock = (key, delta) => {
    const s = store.getState();
    if (key === 'travelBeats' && s.formationIndex >= s.project.formations.length - 1) return;
    store.mutate(p => {
      const b = p.timeline.blocks[s.formationIndex];
      if (!b) return;
      b[key] = Math.max(0.5, Math.min(999, (b[key] || 0) + delta));
    }, key === 'holdBeats' ? '调整保持时长' : '调整过渡时长');
    syncLoopAfterBlockEdit(); // 步进改时长后循环区间跟随（DEFECT-R26-4）
  };
  $('bc-hold-minus').addEventListener('click', () => stepBlock('holdBeats', -1));
  $('bc-hold-plus').addEventListener('click', () => stepBlock('holdBeats', 1));
  $('bc-travel-minus').addEventListener('click', () => stepBlock('travelBeats', -1));
  $('bc-travel-plus').addEventListener('click', () => stepBlock('travelBeats', 1));
  $('tl-zoom-in').addEventListener('click', () => musicTl.zoom(1.3));
  $('tl-zoom-out').addEventListener('click', () => musicTl.zoom(1 / 1.3));
  $('tl-zoom-fit').addEventListener('click', () => musicTl.zoomFit());
  window.addEventListener('resize', () => { stageView?.requestDraw(); musicTl?.render(); });
}
async function loadAudioFile(file) {
  // 任务#21（报告#21）：换曲前先停——旧实现播放中换曲会静默中断且无提示
  const wasPlaying = !!(player.playing || player.countin);
  if (wasPlaying) player.pause();
  try {
    await audio.loadBlob(file); // 任务#3：失败时旧会话原样保留（audio.js 非破坏载入），项目 audio 字段不推进
    const dur = audio.duration;
    store.mutate(p => { p.audio.name = file.name; p.audio.durationSec = dur; }, '载入音乐');
    await store.storage.putAudio(store.getState().projectId, file);
    toast(`音乐已载入：${file.name}${wasPlaying ? '（播放已停止）' : ''}`);
  } catch (e) {
    // 任务#3（报告#3）：损坏音频不再僵死——播放已停、按钮经 onStateChange 复位 ▶、
    // 项目 audio 字段保持载入前状态（可继续编辑/重新选择）
    toast('音频无法播放，已忽略');
  }
}
async function restoreAudio() {
  const s = store.getState();
  if (!s.project?.audio?.name) return;
  try {
    const blob = await store.storage.getAudio(s.projectId);
    if (blob) await audio.loadBlob(blob, s.project.audio.name);
  } catch {}
}

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
        h('button', { class: 'btn small', onclick: () => moveFormationRel(-1), disabled: s.formationIndex === 0 }, '↑ 上移'),
        h('button', { class: 'btn small', onclick: () => moveFormationRel(1), disabled: s.formationIndex === s.project.formations.length - 1 }, '↓ 下移')),
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
function stageChange(k, v) {
  // number input 的 value 是字符串：必须转数值，否则坐标拼接/钳制/网格全部损坏
  stageView.view = null; // 先复位视图，再触发重绘
  store.mutate(p => {
    p.stage[k] = STAGE_NUMERIC_KEYS.has(k) ? (Number(v) || p.stage[k]) : v;
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
    // 说明书全屏覆盖层开着时 Esc=先关层（不穿透到舞台手势/选择）
    if (e.key === 'Escape') {
      const ov = $('manual-overlay');
      if (ov && !ov.hidden) { ov.hidden = true; return; }
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
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 其余单键快捷键不与浏览器/系统修饰键冲突
    // 1..9 = 快速选中编组 N；Shift+1..9 = 追加选择编组 N（e.code 判定兼容 Shift 产生的 !@# 等字符）
    if (digit && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!s.editMode) return;
      e.preventDefault();
      selectGroupN(+digit[1], { add: e.shiftKey });
      return;
    }
    if (e.key.toLowerCase() === 'e') { store.setUI({ editMode: !s.editMode }); return; } // 编辑开关
    if (!s.editMode) return; // 查看模式下禁用编辑类快捷键
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
      const ids = s.selection.length ? expandedSelection() : [...currentFormation().positions.keys()];
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
  $('btn-theme').textContent = state.theme === 'light' ? '☀️' : '🌙';
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
  updateMusicLock(); // 任务#2：随渲染同步 BPM/首拍/点拍锁态（暂停/播放切换的兜底刷新面）
  $('pb-formation').textContent = currentFormation() ? `${state.formationIndex + 1}. ${currentFormation().name}` : '';
  // 播放/数拍中按钮态（任务#20：数拍期同样呈 ⏸，点击=取消倒计）
  $('pb-play').textContent = (player.playing || player.countin) ? '⏸' : '▶';
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
  async loadAudioUrl(url, name = 'test.wav') {
    const r = await fetch(url);
    const b = await r.blob();
    await loadAudioFile(new File([b], name, { type: b.type || 'audio/wav' }));
    return audio.ready;
  },
  drawScene: (ctx, rect, project, positions, opts) => drawScene(ctx, rect, project, positions, opts || {}),
  snapshot() {
    const s = store.getState();
    return {
      view: s.view, formationIndex: s.formationIndex,
      selection: s.selection,
      dancers: s.project?.dancers.length, groups: (s.project?.groups || []).length,
      formations: s.project?.formations.map(f => ({ name: f.name, n: Object.keys(f.positions).length })),
      positions: currentFormation()?.positions,
      blocks: s.project?.timeline.blocks,
      audio: { name: s.project?.audio.name, bpm: s.project?.audio.bpm, ready: audio.ready, duration: audio.duration },
      beat: player?.beat, playing: player?.playing,
    };
  },
};
