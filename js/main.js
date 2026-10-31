// 应用编排：视图路由、状态订阅渲染、交互接线、快捷键
import * as store from './store.js';
import * as M from './model.js';
import * as shapes from './shapes.js';
// build-62-formations2 F2：最小总移动距离槽位分派（匈牙利 O(n³)；行尾不可带注释——打包器 import 正则锚定行尾）
import { assignMinCost } from './assign.js';
import { StageView, drawScene, GRID_PRESETS, GRID_MINOR_DIV } from './stage.js';
import { EditStrip, MusicTimeline, clampSidebarWidth, clampHeadWidth, SEG_LANE_H_MUSIC } from './timeline.js';
import { AudioController } from './audio.js';
import { Player } from './player.js';
import { clipEnd, lastClipEndSec, clipEdgeStepSec, trackEndSec, CLIP_COLORS } from './audio-clips.js';
import { uid } from './model.js';
import * as exp from './export.js';
import * as CP from './clip-process.js';
// build-91-varispeed：导出视频（编排播放）——Mediabunny 单路离线渲染（video-export.js 封装，随 export 之后聚合）
import * as vx from './video-export.js';
import { renderLibrary, showNewProjectModal, showRosterModal, toast, h, createHistorySentinel,
  renderMediaLibraryContent, resolveRsbClosed, resolveSegFold, resolveStageRightCollapsed,
  applyRsbPaneState, showContextMenu, closeContextMenu, fmtSize, modal } from './ui.js';
import { renderManual } from './manual.js';
import { iconHtml } from './icons.js';
// Node 单测直接 import 本模块（深链纯函数）：window 判存守卫；build-single.mjs 由此行正则解析版本号，勿改形态
if (typeof window !== 'undefined') window.__MAIN_BUILD = 'build-91-varispeed';
const BUILD_TAG = (typeof window !== 'undefined' ? window.__MAIN_BUILD : 'build-91-varispeed');

const $ = id => document.getElementById(id);
// Node 测试环境（tests/app-deeplink.test.js 直接 import 本模块的深链纯函数）没有 Audio 全局：
// 延迟判存——浏览器恒有 Audio，行为零变化；Node 下置 null（boot 不会执行，null 永不被使用）。
const audio = typeof Audio !== 'undefined' ? new AudioController() : null;
// build-92-stretch：clip 变速/变调处理产物会话缓存（键=clipProcessKey|源长；LRU 模块级另有上限，
// 此处 Map 随会话存续，量级=变速 clip 数 × 定长 PCM，数量有界）
const processedBufs = new Map();
// (clip) → processed AudioBuffer|Promise<AudioBuffer>|null：needsProcess 的 clip 经
// Signalsmith 离线管线（保音高 TSM + 半音变调一体）；缺省 clip 返 null 走 raw 原样。
function processedAudioFor(clip) {
  if (!audio || !CP.needsProcess(clip)) return null;
  const raw = audio.ensureAssetBuffer(clip.assetId);
  if (!raw) return null;
  const key = CP.clipProcessKey(clip) + '|' + raw.length;
  const hit = processedBufs.get(key);
  if (hit) return hit;
  const p = CP.processClipAudio(raw, { speed: clip.speed || 1, pitchSemi: clip.pitchSemi || 0 }).then(res => {
    const oac = new OfflineAudioContext(2, res.channels[0].length, res.sampleRate);
    const abuf = oac.createBuffer(2, res.channels[0].length, res.sampleRate);
    abuf.copyToChannel(res.channels[0], 0);
    abuf.copyToChannel(res.channels[1], 1);
    processedBufs.set(key, abuf);
    return abuf;
  });
  processedBufs.set(key, p);
  return p;
}
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
    // build-78-recorder（细粒度吸附）：UI 级偏好随场景透传——StageView 手势 host 的 fineSnap
    // 查询读这里，gesture.js computeTargets 据此选粗/细（gridM/5）档；Alt/Option 取反在事件层
    fineSnap: fineSnapOn(),
    playbackPos: pr ? pr.positions : null,
    phase: pr ? pr.phase : 'hold',
    readOnly: s.editMode ? playing : true,
    theme: s.theme,
  };
}
// ---- 细粒度吸附偏好（build-78-recorder，W2 接线清单 #5）----
// localStorage 'wuzhen:fineSnap'（默认关）；不入项目数据（跨项目保持用户偏好，与
// wuzhen:rulerScale.* 同族）。惰性读一次+写时同步缓存；隐私模式 try/catch 兜底为关。
let FINE_SNAP = null;
function fineSnapOn() {
  if (FINE_SNAP === null) {
    try { FINE_SNAP = localStorage.getItem('wuzhen:fineSnap') === '1'; } catch { FINE_SNAP = false; }
  }
  return FINE_SNAP;
}
function setFineSnap(on) {
  FINE_SNAP = !!on;
  try { localStorage.setItem('wuzhen:fineSnap', FINE_SNAP ? '1' : '0'); } catch {}
}

// ---------- 单元浮窗（合并确认 / 单元操作）+ SelectionMenu（多选弹框，round46 Lane A·决策④） ----------
let unitMenuEl = null;
const UNIT_STYLE_LABEL = { capsule: '胶囊', single: '单编号' };
// SelectionMenu 条目推导（纯函数，node 可测）：按 selection 构成决定可见项（同一骨架、条件显隐）。
// 决策④操作集：朝向（恒有；「互相对齐」仅恰 2 人）、存为编组/移出队形（N≥2）、均布（N≥3，
// distributeAxis 模型语义 <3 人无效果，故呈示收在 N≥3）；
// 恰 2 人未合并=「合并为单元」；涉及合并单元=「取消合并」（既有语义）。
// build-69-roster R1：末位删除项改「移出队形」（removeDancerFromFormation 语义，名册保留）——
// 画布不再是删除舞者的入口（唯一入口收归名册），原 'delete' kind 退役、单项收口。
// build-73-syncui F1：新增「同步后面所有位置」（syncForwardPositions 语义）——count≥1 即可用
//（单选/多选均可，多选=逐舞者同步），仅当 hasLater=true（当前帧之后还有队形）呈示；
// hasLater 缺省 false（保守隐藏）：既有调用方/快照断言零改写，应用内菜单显式传参。
// build-79-tlui（需求 4 方向语义）：sync 项扩为方向两项——{kind:'syncForward',dir:'forward'}
// 与 {kind:'syncBackward',dir:'backward'}（label「同步后面/前面位置（N 人）」）；backward 由
// hasEarlier（当前帧之前还有队形=index>0）门控，缺省同样 false 保守隐藏（旧快照零漂移）。
// N=1 特例：showUnitMenu 对单人 context 载荷保持既有构成（title+同步+移出队形+关闭图标）——
// page-r R-02/R-04 仪器单人菜单口径（build-69 起为 ['移出队形','关闭']，需与仪器同步改写）；
// spec 仍按同构口径给出，仅在呈示层收口。
export function selectionMenuSpec({ count, pairEligible = false, mergedInvolved = false, hasLater = false, hasEarlier = false }) {
  const items = [];
  if (count >= 1) items.push({ kind: 'facing', eachOther: count === 2 });
  if (count >= 2) items.push({ kind: 'saveGroup' });
  if (count === 2 && pairEligible) items.push({ kind: 'mergeUnit' });
  if (mergedInvolved) items.push({ kind: 'unmerge' });
  if (count >= 3) items.push({ kind: 'distribute' });
  if (count >= 1 && hasLater) items.push({ kind: 'syncForward', dir: 'forward', label: count === 1 ? '同步后面位置' : `同步后面位置（${count} 人）` });
  if (count >= 1 && hasEarlier) items.push({ kind: 'syncBackward', dir: 'backward', label: count === 1 ? '同步前面位置' : `同步前面位置（${count} 人）` });
  items.push({ kind: 'removeFromFormation', label: count === 1 ? '移出队形' : `移出队形（${count} 人）` });
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
  // build-69-roster R1：画布删除入口改语义——「移出队形」（名册保留）。删除舞者的唯一入口
  // 收归名册（R2，带确认）；此处只从当前队形清位 + 该帧 merges 引用清理
  //（M.removeDancerFromFormation），经 store.mutate 提交单条「移出队形」历史，可撤销。
  const mkDeleteBtn = () => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = '移出队形';
    b.title = '仅从当前队形移除，名册保留（彻底删除请去名册）';
    b.style.color = '#ef4444'; // 危险动作着色（内联样式，避免动样式表）
    b.addEventListener('click', () => {
      const label = payload.mode === 'unit' ? `移出队形（${payload.ids.length} 人）` : '移出队形';
      store.mutate(p => M.removeDancerFromFormation(p, store.getState().formationIndex, payload.ids), label);
      store.setUI({ selection: store.getState().selection.filter(id => !payload.ids.includes(id)) });
      hideUnitMenu();
    });
    return b;
  };
  // build-79-tlui（需求 4）→ build-80 收口改版：同步位置 UI 重做——
  //   ① 方向按钮恒两枚、边界态置灰可见（旧版直接隐藏不可用方向，用户误以为只有单方向）；
  //   ② 关键语义（留空=全部/朝向保留/可撤销）改为浮窗内可见文字，不再只藏 title（触屏无 hover）；
  //   ③ 标题行「同步位置」+ 方向钮 + 范围输入 + 提示一行成组，层级清晰。
  // 点击走 M.syncPositionsRange(p, idx, ids, { dir, count })，toast 报实际写入队形数；
  // 单条「同步前面/后面位置（N 人）」历史，可撤销。与 spec（selectionMenuSpec）同口径。
  // 位置纪律：必须先于下方 context/multi 分支定义（context 单人标题分支直接调用，const 有 TDZ）。
  const hasLaterFormations = () => {
    const s = store.getState();
    return s.formationIndex < ((s.project?.formations?.length) || 0) - 1;
  };
  const hasEarlierFormations = () => store.getState().formationIndex > 0;
  const SYNC_N_MIN = 1, SYNC_N_MAX = 50; // 相邻队形数输入域（越界自动钳制）
  const mkSyncRows = ids => {
    if (!hasLaterFormations() && !hasEarlierFormations()) return null; // 首末且仅一帧：无方向可同步
    const box = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = '同步位置';
    box.append(title);
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = String(SYNC_N_MIN);
    inp.max = String(SYNC_N_MAX);
    inp.placeholder = '全部';
    inp.title = '相邻队形数：留空=全部；1..50，越界自动钳制';
    inp.setAttribute('aria-label', '同步范围：相邻队形数（留空=全部）');
    inp.style.cssText = 'width:58px';
    inp.addEventListener('keydown', e => e.stopPropagation()); // 输入不落画布/全局快捷键
    const clampN = n => Math.max(SYNC_N_MIN, Math.min(SYNC_N_MAX, n));
    const countNow = () => {
      const n = Number.parseInt(inp.value, 10);
      return Number.isFinite(n) ? clampN(n) : Infinity; // 空/非法=全部（Infinity）
    };
    const mkDirBtn = dir => {
      const can = dir === 'forward' ? hasLaterFormations() : hasEarlierFormations();
      const b = document.createElement('button');
      b.className = 'um-btn';
      b.textContent = dir === 'forward' ? '同步到后面 ▾' : '同步到前面 ▴';
      if (!can) {
        b.disabled = true;
        b.style.opacity = '.45';
        b.title = dir === 'forward' ? '已是最后一个队形：后面没有可同步的队形' : '已是第一个队形：前面没有可同步的队形';
      } else {
        const dirTxt = dir === 'forward' ? '后面' : '前面';
        b.title = `把当前摆位同步到${dirTxt}所选范围队形的同名舞者（只同步位置，朝向保留）`;
        b.addEventListener('click', () => {
          let r = null;
          store.mutate(p => { r = M.syncPositionsRange(p, store.getState().formationIndex, ids, { dir, count: countNow() }); },
            `同步${dirTxt}位置（${ids.length} 人）`);
          toast(r && r.formations ? `已同步到${dirTxt} ${r.formations} 个队形` : '范围内没有可同步的队形');
          hideUnitMenu();
        });
      }
      return b;
    };
    const dirRow = document.createElement('div');
    dirRow.className = 'um-row';
    dirRow.append(mkDirBtn('forward'), mkDirBtn('backward'));
    const scopeRow = document.createElement('div');
    scopeRow.className = 'um-row';
    scopeRow.append(h('span', { class: 'um-lab' }, '范围'), inp);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:var(--dim);line-height:1.5;max-width:190px;white-space:normal';
    hint.textContent = '把所选舞者当前摆位同步到前方/后方的队形；范围留空=全部。只同步位置，朝向保留，可撤销。';
    box.append(dirRow, scopeRow, hint);
    return box;
  };
  // build-76-pbcollapse：「显示」横排选择行——右键/长按单人菜单与单元浮窗（含合并确认）共用。
  // 选项=自动（跟随项目「舞者标签」设置）/编号/简称/姓名，按各自实际值呈示便于点选；
  // 点选写舞者级 d.labelMode 覆盖（'自动'=delete 清除键），单条历史可撤销。单元呈示的
  // 作用对象=主成员（名册序号较小者，与 stage.js single 单元取标同则；capsule 双标各随各员）。
  const projectOrd = id => M.dancerOrdinal(store.getState().project, id);
  const primOf = ids => (ids || []).map(id => M.dancerById(store.getState().project, id)).filter(Boolean)
    .sort((a, b) => projectOrd(a.id) - projectOrd(b.id))[0] || null;
  const mkLabelRow = d => {
    const ord = projectOrd(d.id) || 0;
    const noVal = ord > 0 ? String(ord) : String(d.short ?? '?');
    const opts = [
      { mode: '', label: '自动', title: '跟随项目「舞者标签」设置' },
      { mode: 'no', label: noVal, title: `编号序号：${noVal}` },
      { mode: 'short', label: M.truncateLabel(String(d.short ?? '') || noVal), title: `简称：${d.short || '（未设，回退编号）'}` },
      { mode: 'name', label: M.truncateLabel(String(d.name ?? '').trim() || String(d.short ?? '') || noVal), title: `姓名：${d.name || '（未设，回退简称→编号）'}` },
    ];
    const override = M.LABEL_MODES.includes(d.labelMode) ? d.labelMode : '';
    const row = document.createElement('div');
    row.className = 'um-row';
    row.append(h('span', { class: 'um-lab' }, '显示'));
    for (const o of opts) {
      const b = document.createElement('button');
      b.className = 'um-btn' + ((o.mode === '' && !override) || o.mode === override ? ' um-cur' : '');
      b.textContent = o.label;
      b.title = o.title;
      b.addEventListener('click', () => {
        store.mutate(pp => {
          const dd = (pp.dancers || []).find(x => x.id === d.id);
          if (!dd) return;
          if (o.mode === '') delete dd.labelMode;
          else dd.labelMode = o.mode;
        }, o.mode === '' ? '清除显示覆盖' : '设置显示名称');
        hideUnitMenu();
      });
      row.append(b);
    }
    return row;
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
    const pd = primOf(payload.ids); // build-76-pbcollapse：合并确认即可选单编号呈示的显示名称
    if (pd) el.append(mkLabelRow(pd));
  } else if (payload.mode === 'multi') {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = `所选 ${payload.ids.length} 人`;
    el.append(title);
  } else if (payload.mode === 'context' && !ctxMerge) {
    // 未合并舞者的上下文菜单（触摸/笔长按、鼠标右键共用）：「同步后面/前面位置」（build-79-tlui
    // 方向语义，末队形藏后面钮、首队形藏前面钮）+「移出队形」（build-69-roster R1）
    const d = M.dancerById(store.getState().project, payload.ids[0]);
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = `舞者 · ${d ? d.name : '?'}`;
    el.append(title);
    if (d) el.append(mkLabelRow(d)); // build-76-pbcollapse：单人右键/长按即可横排点选显示名称
    const syncBlk = mkSyncRows(payload.ids);
    if (syncBlk) el.append(syncBlk);
    el.append(mkDeleteBtn());
  } else {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = '合并单元';
    el.append(title);
    const pd = primOf(payload.ids); // build-76-pbcollapse：单元浮窗亦可切主成员显示名称（单编号取标来源）
    if (pd) el.append(mkLabelRow(pd));
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
  // 「移出队形（N 人）」恒可用（build-69-roster R1：原「删除所选（N 人）」改语义——名册保留）。样式按钮不在此出现——恰选一个单元时
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
  // build-69-roster R1：多选删除改语义——「移出队形（N 人）」（danger，名册保留），取代原
  // 「移出队形 + 删除所选」双钮（语义合并为同一动作：removeDancerFromFormation）。
  const mkMultiDeleteBtn = n => {
    const b = document.createElement('button');
    b.className = 'um-btn';
    b.textContent = `移出队形（${n} 人）`;
    b.title = '仅从当前队形移除，名册保留（彻底删除请去名册）';
    b.style.color = '#ef4444'; // 危险动作着色（同单人删除）
    b.addEventListener('click', () => {
      store.mutate(p => M.removeDancerFromFormation(p, store.getState().formationIndex, payload.ids), `移出队形（${n} 人）`);
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
  // 按钮区按 mode 分支（DEFECT-R-1 根因：原 else 同时覆盖 context 与 unit 两种 mode）：
  // merge → 样式×2；unit → 拆开+样式×2+移出队形（build-69-roster R1 改名，名册保留）；
  // context+有 merge → 样式×2+拆开+移出队形；
  // context+无 merge → 标题分支已加「移出队形」，此处不追加（N=1 特例：保持既有 ['移出队形','✕'] 构成，
  //   page-r R-02/R-04 仪器口径——SelectionMenu 群体项自 N≥2 起，见 selectionMenuSpec 注释）；
// multi → SelectionMenu（决策④）：朝向▸ → 存为编组 → [合并为单元|取消合并] → [均布 纵/横] →
//   [同步后面/前面位置（N 人）]（build-79-tlui 方向语义，末队形藏后面钮/首队形藏前面钮）→
//   移出队形（N 人）。✕ 取消按钮在下方对所有形态统一追加。
  //   （build-69-roster R1：原「移出队形 + 删除所选」双钮语义合并——画布删除只含「移出队形」，彻底删除唯一入口在名册。）
  if (payload.mode === 'merge') {
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
  } else if (payload.mode === 'unit') {
    el.append(mkUntieBtn());
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
    const syncUnit = mkSyncRows(payload.ids);
    if (syncUnit) el.append(syncUnit); // build-79-tlui 方向语义（单元=两名成员逐人同步）
    el.append(mkDeleteBtn()); // 移出队形（build-69-roster R1）= 两名成员从当前队形清位，名册保留
  } else if (payload.mode === 'multi') {
    const involved = (currentFormation()?.merges || []).filter(m => payload.ids.includes(m.a) || payload.ids.includes(m.b));
    el.append(mkFacingRow(payload.ids));
    el.append(mkSaveGroupBtn(payload.ids));
    if (payload.ids.length === 2 && !involved.length) el.append(mkMultiMergeBtn());
    if (involved.length) el.append(mkMultiUntieBtn(involved));
    if (payload.ids.length >= 3) el.append(mkDistributeRow(payload.ids));
    const syncMulti = mkSyncRows(payload.ids);
    if (syncMulti) el.append(syncMulti); // build-79-tlui 方向语义（多选=逐舞者同步）
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
// ---------- 深链 URL 取参（纯函数，tests/app-deeplink.test.js 的 node 入口） ----------
// 通用 query 取参：只看 ?..# 区段；值为原始编码串（由 encodeURIComponent 侧保证往返无损）。
function parseParam(hrefOrSearch, name) {
  if (typeof hrefOrSearch !== 'string' || !hrefOrSearch) return null;
  const qi = hrefOrSearch.indexOf('?');
  if (qi === -1) return null;
  let search = hrefOrSearch.slice(qi);
  const hi = search.indexOf('#');
  if (hi !== -1) search = search.slice(0, hi); // hash 不属于 query 值
  try {
    const v = new URLSearchParams(search).get(name);
    return v && v.trim() ? v : null;
  } catch { return null; }
}
// 只摘指定参数，其余 query/hash 原样保留（history.replaceState 清参用，刷新不重导入）。
function stripParam(href, name) {
  if (typeof href !== 'string' || !href) return href;
  const hi = href.indexOf('#');
  const hash = hi === -1 ? '' : href.slice(hi);
  const noHash = hi === -1 ? href : href.slice(0, hi);
  const qi = noHash.indexOf('?');
  if (qi === -1) return href;
  let sp;
  try { sp = new URLSearchParams(noHash.slice(qi)); } catch { return href; }
  if (!sp.has(name)) return href;
  sp.delete(name);
  const rest = sp.toString();
  let head = noHash.slice(0, qi);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(head)) { // 绝对 URL → 同文档相对形态（pathname 起，replaceState 更稳）
    try { head = new URL(head).pathname; } catch {}
  }
  return head + (rest ? '?' + rest : '') + hash;
}
// 深链导入参数（Phase 4 契约）：?import=<encodeURIComponent(项目 JSON 的 URL)>。
export function parseImportParam(hrefOrSearch) { return parseParam(hrefOrSearch, 'import'); }
export function stripImportParam(href) { return stripParam(href, 'import'); }
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
      importProject: p => { player?.stop(); clearIoSource(); store.importProject(p); }, // clearIoSource：build-71-iomenu F2（深链导入非文件来源）
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

// ---------- build-71-iomenu F2 · 保存覆盖（导入副本的回写） ----------
// 会话级导入来源态：句柄不持久化（File System Access API 句柄本就无法序列化进 IndexedDB
// 而不失效），刷新后失效是可接受的降级——刷新后 save-back 条目隐藏，仅剩导出下载。
// hadAudio=原文件是否带音乐（含乐覆盖组装按它决定）；baseline=导入完成后的项目快照
// （JSON 串比对即 dirty：mutate/mutateQuiet 都会改 updatedAt，undo/redo 还原历史快照
// 内容也不同——「导入后有任何变化即 dirty」，取实现简者）。
export const ioSource = { handle: null, name: '', hadAudio: false, baseline: '' };
export function markIoSource(handle, name, hadAudio, project) {
  ioSource.handle = handle || null;
  ioSource.name = String(name || '');
  ioSource.hadAudio = !!hadAudio;
  ioSource.baseline = JSON.stringify(project);
}
export function clearIoSource() {
  ioSource.handle = null; ioSource.name = ''; ioSource.hadAudio = false; ioSource.baseline = '';
}
export function isIoDirty(project) {
  return !!ioSource.handle && !!ioSource.baseline && JSON.stringify(project) !== ioSource.baseline;
}
// 从项目文件导入（编排层，DI 纯函数供 node 单测——tests/iomenu.test.js；浏览器侧经
// picker/input 拿到 file+handle 后调本函数）。file 需有 .text() 与 .name（File/Blob 桩均可）。
export async function importProjectFile(file, deps) {
  // deps: { readFile, importProject, restoreAudio, toast }
  try {
    const { project, audioBlob, assetBlobs } = await deps.readFile(file);
    deps.importProject(project);
    const restored = await deps.restoreAudio(assetBlobs || [], audioBlob);
    if (restored && (assetBlobs?.length || audioBlob)) deps.toast('导入成功（音乐已一并恢复）');
    else deps.toast('导入成功（该项目文件不含音乐，请重新载入音乐）');
    return { status: 'ok', hadAudio: !!(audioBlob || assetBlobs?.length) };
  } catch (e) {
    deps.toast?.('导入失败：' + e.message);
    return { status: 'error', message: e?.message || String(e) };
  }
}
// 保存覆盖到原文件（编排层，DI 纯函数供 node 单测）。含/不含音乐按原文件是否有音乐决定
//（hadAudio）：有乐但本地取不到音频 blob → 降级不含乐并在 toast 明示。写回前 confirm 确认。
export async function saveBackToSourceFile(deps) {
  // deps: { handle, fileName, hadAudio, project, dirty, assemble, confirmImpl, write, toast, onSaved }
  if (!deps.handle) return { status: 'no-handle' };
  if (!deps.dirty) return { status: 'clean' };
  let audioBlob = null, assets = null;
  if (deps.hadAudio) {
    const got = await deps.assemble();
    assets = got.assets || null;
    audioBlob = got.blob || null;
    if (!audioBlob && !(assets || []).some(a => a.blob)) {
      deps.toast?.('本地未找到音乐文件，将覆盖保存为不含音乐的版本');
      audioBlob = null; assets = null;
    }
  }
  const withAudio = !!(audioBlob || (assets || []).some(a => a.blob));
  if (deps.confirmImpl && !deps.confirmImpl(`将当前项目覆盖保存到原文件「${deps.fileName}」？（${withAudio ? '含音乐' : '不含音乐'}）`)) {
    return { status: 'cancelled' };
  }
  const r = await deps.write(deps.handle, deps.project, audioBlob, { assets });
  deps.toast?.(`已覆盖保存到原文件（${withAudio ? '含音乐' : '不含音乐'}）`);
  deps.onSaved?.(); // 写回成功即重置 dirty 基线（调用方 rebaseline）
  return { status: 'saved', withAudio, bytes: r?.bytes ?? null };
}

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
  wireRightSidebar();   // build-46-layout：右侧合并侧边栏（预览上+媒体库下；开合/段折叠/拖宽记忆+移动抽屉手势）
  wireStageux();        // build-51-stageux F3：编舞三侧折叠（左列表/右属性/底部区；记忆+stage 作用域）
  wireTlNav();          // build-51-stageux F4：时间轴底部导航滑块（两模式恒显概览条）
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
// 播放键呈示态（图标化·决策⑤）：全部播放/结束分支共用此出口，保证 svg[data-icon]
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
      // build-49 F3：音乐模式播放条位置=秒显示（时间轴=唯一对齐规范，BPM 退场）；stage 拍标签不动（E-12）
      $('pb-pos').textContent = !proj0 ? '—'
        : (musicTl?.mode === 'music' ? `${Math.max(0, t.sec).toFixed(1)}s` : M.beatLabel(proj0, t.beat));
      // build-51-stageux F1：stage 播放直达音乐尾后播放头可越过 blocks 域——formationIndex
      // 越界防护：高亮/名称钳到最后队形（播放不中断），store.setUI 同步钳制（下游
      // render/blocks[formationIndex] 读数链不越界；formationIndex 越过末队形=原地高亮末队形）。
      const fiMax = Math.max(0, (store.getState().project?.formations.length || 1) - 1);
      const fi = Math.min(t.formationIndex ?? 0, fiMax);
      const f = store.getState().project?.formations[fi];
      $('pb-formation').textContent = f ? `${fi + 1}. ${f.name}` : '';
      // 真实播放中高亮跟随节拍；切帧预览/seek 不抢占用户选择的队形
      if (player.playing && !player.previewing && store.getState().formationIndex !== fi) {
        store.setUI({ formationIndex: fi });
        if (pbLoopOn()) updateLoop(); // build-66-mobileux F1：.checked → aria-pressed 换线
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
    resolveBuffer: id => audio.ensureAssetBuffer(id), // build-88：缺失时异步重解码（Promise 到位自动补绘） // build-91-varispeed（需求 1）：assetId→AudioBuffer，高精度波形取样（J 契约冻结）
    resolveProcessedClip: clip => processedAudioFor(clip), // build-92-stretch：变速/变调处理产物（波形 1:1 直采）
    processClipAudio: (raw, opts) => CP.processClipAudio(raw, opts), // build-92-stretch：编辑方法触发离线处理
    hooks: {
      getProject: () => store.getState().project,
      getProjectId: () => store.getState().projectId,
      getPlayer: () => player,
      audio,
      getIndex: () => store.getState().formationIndex,
      // build-70：连续时长（ripple）checkbox 随 blocks 模型退役——clip 模型下时长操作天然
      // 只作用本 clip（邻界钳制），无 ripple 语义，hook 一并移除。
      canEdit: () => store.getState().editMode, // 编辑锁：关闭=clip 编辑禁用（选择/预览可用）
      pauseIfPlaying: () => { if (player.playing) player.pause(); }, // 守卫：播放中先自动暂停
      onSelectFormation: i => switchFormation(i),
      mutate: fn => store.mutate(fn, null),
      mutateQuiet: fn => store.mutateQuiet(fn), // 拖拽高频路径：跳过全 App render 订阅链
      mutateLabeled: (fn, label) => store.mutate(fn, label), // 标记打点/改名/删除：单操作即时一条历史
      commit: label => store.commit(label), // build-91-varispeed：变速滑杆松手恰一条历史
      commitEdit: label => { store.commit(label); syncLoopAfterBlockEdit(); }, // 拖边改时长后循环区间跟随（DEFECT-R26-4）
      seekBeat: b => player.seekBeat(Math.max(0, b)),
      toast,
      onTimeSelection: applyTimeSelLoop,   // C11：播放限制在选区=临时循环
      previewClip,                          // C12：双击 clip=选中并循环预览
      onClipContextMenu: showClipMenu,      // §4：右键菜单
      onSegContextMenu: showSegMenu,        // W1 §2.2.1：节奏划分轨段右键（拆分/合并/删除/换色）
      onFormationClipContextMenu: showFormationClipMenu, // build-70 M2：队形 clip 右键/长按菜单（分割/删除/对齐）
      onAfterRender: () => syncTlNav(),     // build-51-stageux F4：render 尾部同步概览条拇指（mt.W 变化源）
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
  } else if (pbLoopOn()) updateLoop(); // build-66-mobileux F1：换线
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
  player.play(b0);
  toast(`循环预览「${clip.name || '音频剪辑'}」——停止后恢复循环设置`);
}
// ---- v3：音频剪辑右键菜单（规格 §4）----
// W2（修 E-10）：编舞模式简单道只读——右键不再出满血剪辑菜单（分割/修剪/淡化），
// 仅留「在音乐模式中编辑」跳转项；满血菜单为音乐模式专属。
function showClipMenu({ clipId, screenX, screenY, timelineSec }) {
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
  // 变速/变调双旋钮滑杆行（Wave；el 行内嵌，与 swatches 同法；css 归属菜单区外故全部内联样式）：
  // 变速 range 0.25–4 step 0.01（% 呈示）、变调 range −12..12 step 1（+3st/−2st 呈示）。拖动
  // （input）只更新行内数值——变速/变调走离线 TSM 处理（processed buffer 1:1 播放），逐 tick
  // 提交历史/触发重处理代价过高；松手（change）才调 setSpeedSelected/setPitchSelected 恰一条
  // 历史并触发离线处理（完成自动补绘）。初值=右键所指 clip 当前值（clip.speed||1、
  // clip.pitchSemi||0；多选时松手作用于全部选中 clip，与换色/增益重置同口径）。
  const speedNow = Number(clip.speed) || 1;
  const semiNow = Math.round(Number(clip.pitchSemi)) || 0;
  const stLabel = v => `${v > 0 ? '+' : ''}${v}st`;
  const speedVal = h('span', { class: 'dim', style: 'font-size:11px;min-width:38px;text-align:right;font-variant-numeric:tabular-nums' }, `${Math.round(speedNow * 100)}%`);
  const speedRow = h('div', { class: 'ctx-swatches', style: 'align-items:center;gap:6px' },
    h('span', { class: 'dim', style: 'font-size:11px' }, '变速'),
    h('input', {
      type: 'range', min: '0.25', max: '4', step: '0.01', value: String(speedNow),
      style: 'flex:1;min-width:110px', 'aria-label': '剪辑变速',
      title: '剪辑变速（0.25–4×，保音高；离线处理完成后生效，处理中呈「处理中…」）',
      oninput: e => { speedVal.textContent = `${Math.round(+e.target.value * 100)}%`; },
      onchange: e => { musicTl.setSpeedSelected(+e.target.value); }, // 松手恰一条「剪辑变速」历史+触发处理
    }),
    speedVal);
  const semiVal = h('span', { class: 'dim', style: 'font-size:11px;min-width:38px;text-align:right;font-variant-numeric:tabular-nums' }, stLabel(semiNow));
  const pitchRow = h('div', { class: 'ctx-swatches', style: 'align-items:center;gap:6px' },
    h('span', { class: 'dim', style: 'font-size:11px' }, '变调'),
    h('input', {
      type: 'range', min: '-12', max: '12', step: '1', value: String(semiNow),
      style: 'flex:1;min-width:110px', 'aria-label': '剪辑变调',
      title: '剪辑变调（±12 半音，整体音高；离线处理完成后生效，处理中呈「处理中…」）',
      oninput: e => { semiVal.textContent = stLabel(Math.round(+e.target.value)); },
      onchange: e => { musicTl.setPitchSelected(+e.target.value); }, // 松手恰一条「剪辑变调」历史+触发处理
    }),
    semiVal);
  showContextMenu([
    // D2（build-44）：触屏长按/右键落点分割——菜单由长按触发时播放头往往不在手指处，
    // 「在此处分割」按按压点裁剪；timelineSec 缺省（老调用方）不呈示，播放头入口保留
    ...(timelineSec != null ? [{ label: '在此处分割', fn: () => musicTl.splitAtSec(clipId, timelineSec) }] : []),
    { label: '分割于播放头(K)', fn: () => musicTl.splitAtPlayhead() },
    { label: '修剪到时间选区', fn: () => musicTl.trimSelectedToTimeSel() },
    { label: clip.muted ? '取消静音' : '静音', fn: () => musicTl.toggleMuteSelected() },
    { label: '波纹删除', fn: () => musicTl.deleteSelected(true) },
    { label: '删除', danger: true, fn: () => musicTl.deleteSelected(false) },
    { sep: true },
    { label: '重命名', fn: () => { const n = prompt('剪辑名称', clip.name || ''); if (n && n.trim()) musicTl.renameSelected(n); } },
    { el: swatches },
    { label: '增益重置', fn: () => musicTl.resetGainSelected() },
    { el: speedRow },
    { el: pitchRow },
    // 变速/变调重置（Wave 双旋钮）=resetSpeedPitchSelected：speed/pitchSemi 双删键不落盘，
    // 进历史同增益重置口径
    { label: '变速/变调重置', fn: () => musicTl.resetSpeedPitchSelected() },
    // F6（build-45-fadecurve）：淡化归零——选中 clip 淡化长度+曲线全清零；auto 配对缘
    // 走引擎 resetClipFades 的既有解除配对路径（不绕过簿记）
    { label: '淡化归零', fn: () => musicTl.resetFadesSelected() },
  ], { x: screenX, y: screenY });
}
// 手动切换队形帧：更新选中；播放线对齐该队形 clip 开头（build-70 M3 需求 5：缩略图↔轴
// 导航映射——chip 点击/块单击同链）；若开启切帧预览，播放一段纯舞台 UI 动画（不经播放引擎）
function switchFormation(i) {
  player.pause(); // 无条件暂停
  const s = store.getState();
  const changed = i !== s.formationIndex;
  // DEFECT-L2-2：getState() 是活引用，setUI 会原地覆盖 formationIndex——动画端点必须
  // 在 setUI 前暂存（from=切换前帧、to=目标帧，前后切换双向皆然），否则 from===to。
  const fromF = s.project?.formations[s.formationIndex] || null;
  const toF = s.project?.formations[i] || null;
  const { previewOnSwitch: previewOn, editMode } = s;
  store.setUI({ formationIndex: i, selection: [] });
  // build-70 M3：选中即把播放线对齐所选队形 clip 开头（编辑/查看模式同链——缩略图导航映射）
  player.seekFormation(i);
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
  // build-70 M2：＋新队形=追加到末 clip.end 之后（len=16 拍缺省）——clip 模型下不再有
  // 「插入中间」语义；内容仍复制当前队形（after 参数仅决定复制谁）。
  store.mutate(p => { M.createFormationFrom(p, idx); }, '新队形');
  const ni = store.getState().project.formations.length - 1;
  store.setUI({ formationIndex: ni, selection: [] });
  if (s.previewOnSwitch && ni > 0) {
    // 新帧动效：从上一帧流动到新帧（动线靠插入中间帧表达）
    const pf = store.getState().project;
    stageView.startPositionsPreview(pf.formations[ni - 1] || pf.formations[ni], pf.formations[ni], 700);
  }
}
function deleteFormation(index = null) {
  player.pause(); // 停掉进行中的预览/播放，避免 _stopAt 指向已删除的段
  const s = store.getState();
  const target = index ?? s.formationIndex;
  if (target < 0 || target >= s.project.formations.length) return;
  if (s.project.formations.length <= 1) { toast('至少保留一个队形'); return; }
  // build-70 M2：删除队形=移除 formation+clip，**空位保留**（后续 clip 的 startBeat/lenBeats
  // 一个字节不动——需求 2「删除不把后续队形移过来」）。
  store.mutate(p => { M.deleteFormation(p, target); }, '删除队形');
  store.setUI({ formationIndex: Math.max(0, Math.min(target, s.project.formations.length - 1)), selection: [] });
}
// ---- build-70 M2：队形 clip 右键/长按菜单（分割于此/删除队形/对齐到播放头）----
// 与音频 clip 菜单同构（showContextMenu 单弹窗不变式）；mutateLabeled=恰一条历史。
function showFormationClipMenu({ index, beat, screenX, screenY }) {
  const s = store.getState();
  const p = s.project;
  if (!p) return;
  if (index == null || index < 0 || index >= p.formations.length) {
    showContextMenu([{ label: '空白区域（拖动/缩放队形 clip；单击对齐播放线）', fn: () => {} }], { x: screenX, y: screenY });
    return;
  }
  const segs = M.segmentsFromClips(p.formations).segments;
  const seg = segs[index];
  const canSplit = !!seg && beat > seg.start + M.FORM_CLIP_LEN_MIN && beat < seg.end - M.FORM_CLIP_LEN_MIN;
  const items = [
    ...(canSplit ? [{
      label: `分割于此（${M.beatLabel(p, beat)}）`,
      fn: () => {
        // 分割=深拷贝队形内容为两个 clip（缩略图同位形）；恰一条「分割队形」历史可撤销
        store.mutate(q => { M.splitFormationClip(q, index, beat); }, '分割队形');
      },
    }] : [{ label: '分割点需落在 clip 内部（两端各留 1 拍）', fn: () => toast('分割点需落在队形 clip 内部（两端各留 1 拍）') }]),
    {
      label: '对齐到播放头',
      fn: () => {
        if (index === 0) { toast('第一个队形从 0 拍开始，无需对齐'); return; }
        store.mutate(q => { M.alignFormationClipStart(q, index, Math.max(0, player.beat)); }, '对齐到播放头');
      },
    },
    { sep: true },
    { label: `删除队形 ${index + 1}（空位保留）`, danger: true, fn: () => deleteFormation(index) },
  ];
  showContextMenu(items, { x: screenX, y: screenY });
}
// build-91-varispeed 改写注明：splitFormationAtPlayhead（stage 模式 ⌘K 分割队形）随 ⌘K 收敛为
// 音乐模式单发剪切而退役——编舞侧分割入口保留队形 clip 右键/长按菜单「分割于此」。

// ---------- 双 UI 模式（round46 Lane A·决策②/③）：编舞（默认）⇄ 音乐 ----------
// 尺规刻度按钮呈示（拍/秒）：render 与点击路径共用，保证即时与兜底两面一致。
// build-78-recorder（时间唯一标准）：编舞侧 #tl-scale-toggle 随 stage 强制秒刻度移除——
// 只同步音乐工具条孪生钮（-music）；stage 模式下本函数照常运行但元素不存在即跳过。
function syncScaleToggle() {
  if (!musicTl) return;
  const isSec = musicTl.rulerScale === 'sec';
  for (const id of ['tl-scale-toggle-music']) {
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
// （只动呈示面，不清任何编辑态）。播放中禁止切换（决策裁定，toast「暂停后可切换」）。
function applyUiMode(mode) {
  const ev = document.getElementById('editor-view');
  if (ev) ev.dataset.uimode = mode === 'music' ? 'music' : 'stage';
  // build-73-syncui F2：三区自定义宽高只在编舞模式生效——切音乐先清场（#bottom-area 音乐模式
  // flex:1 吃余高，残留行内高会当 flex-basis 扰动布局；左/右列音乐模式 display:none 本不受累，
  // 一并统一清/套），切回编舞按记忆回套
  applyStagePaneSizes();
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
  if (player && player.playing) {
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
  // build-43-accept：侧边栏呈示随模式切换按记忆态就位（CSS 按 data-uimode 门控可见性，
  // 这里只负责内容新鲜——防「关着时导入、切模式后首帧空列表」的时序缝）
  syncMediaSidebar(store.getState().project);
  drawMusicPreview(); // preview 栏切换即呈示（不等下一次 store render）
  // build-56-indextab：索引挂载随模式迁移——清旧模式容器、挂新模式容器（#si-playhead/#si-list
  // 全文档唯一）；目标模式索引容器处于激活位才补渲染一次（非激活容器零 DOM 写）
  siMount(next);
  if (siIndexActive()) { renderSegIndexPanel(); siTick(); }
  return true;
}

// ---------- 导出视频（编排播放）· build-91-varispeed Mediabunny 单路 ----------
// 唯一路径=离线渲染（快、帧精确）：入口先 probeExportCapabilities 异步探测（缺失能力给
// 面向用户的一句话 reason），通过后设置弹窗 → 进度弹窗 → vx.exportVideo（渲染/音频/封装
// 三相位，ratio 恒全局 0..1）。旧慢路（耗时≈视频时长的边录边编码方案）已整体废除。
let videoExportBusy = false;      // 导出期间禁止重复触发
let vexpItemSig = null;           // 菜单项提示签名门控（DOM 写去抖）
function syncVideoExportItem() {
  const btn = $('exp-video');
  if (!btn) return;
  const hasAssets = !!store.getState().project?.media?.assets?.length;
  const sig = `${hasAssets}`;
  if (sig === vexpItemSig) return;
  vexpItemSig = sig;
  // 触屏无 hover：菜单项恒可点，无资产态只留 title 提示；不支持的场景（probe 失败）
  // 由 startVideoExportFlow 内 toast(caps.reason) 给文字反馈。
  if (!hasAssets) { btn.title = '导出视频需要先载入音乐（音乐模式工具条「＋ 载入音乐」或媒体库导入）'; return; }
  btn.title = '导出编排播放视频（本机渲染 .mp4）';
}
function videoExportPhaseText(phase, ratio, project, preset) {
  const pct = Math.round(ratio * 100);
  if (phase === 'render') {
    const total = Math.max(1, Math.ceil(M.musicDomainSec(project) * preset.fps));
    const done = Math.min(total, Math.round(ratio / 0.6 * total));
    return `渲染帧 ${done}/${total}（${pct}%）`;
  }
  if (phase === 'audio') return `音频编码中（${pct}%）`;
  return `封装 MP4（${pct}%）`;
}
// 设置弹窗：三档单选（默认「标准」）；Promise resolve 所选档 id，取消=resolve(null)
function showVideoExportSettings() {
  return new Promise(resolve => {
    let picked = vx.DEFAULT_PRESET_ID;
    const radios = vx.PRESETS.map(p => h('label', {},
      h('input', {
        type: 'radio', name: 'vexp-preset', value: p.id,
        ...(p.id === vx.DEFAULT_PRESET_ID ? { checked: true } : {}),
        onchange: () => { picked = p.id; },
      }),
      `${p.name}档 · ${p.width}×${p.height} · ${p.fps}fps`));
    const body = h('div', {},
      h('div', { class: 'vexp-preset' }, ...radios),
      h('div', { class: 'vexp-note' }, '导出编排播放视图（舞台插值动画 + 队形/音乐/节奏三轨条 + 配乐），全程本机渲染，时长=音乐长度。'));
    const m = modal('导出视频（编排播放）', body, [
      // 先 resolve 再 close（close 触发 onClose→resolve(null)，Promise 首次 settle 优先）
      h('button', { class: 'btn primary', onclick: () => { resolve(picked); m.close(); } }, '开始导出'),
    ], { onClose: () => resolve(null) });
  });
}
// 进度弹窗（自制骨架：无固定「关闭」钮；取消钮置取消标志，导出每帧检查）
function showVideoExportProgress(onCancel) {
  const fill = h('div', { class: 'vexp-fill' });
  const meta = h('div', { class: 'vexp-meta' }, '准备中…');
  const back = h('div', { class: 'modal-back' },
    h('div', { class: 'modal' },
      h('h3', {}, '正在导出视频'),
      h('div', { class: 'vexp-bar' }, fill),
      meta,
      h('div', { class: 'm-foot' }, h('button', { class: 'btn', onclick: onCancel }, '取消'))));
  const root = $('modal-root');
  root.innerHTML = '';
  root.hidden = false;
  root.append(back);
  return {
    set: (ratio, text) => { fill.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%'; meta.textContent = text; },
    close() { back.remove(); if (!root.children.length) root.hidden = true; },
  };
}
// 完成弹窗：<video> 预览 + 下载（a[download]）+ 备注（Opus 回退/静音片段——警示语红色着色，
// 内联 style：css 归属他处，此处只做点刹）
function showVideoExportDone(result) {
  const url = URL.createObjectURL(result.blob);
  const name = `${vx.videoFileName(store.getState().project).replace(/\.mp4$/i, '')}.${result.ext || 'mp4'}`;
  const noteText = result.note
    || (result.audioSilent ? '本次导出未混入任何音频（全部音乐片段被静音或缺失），视频无声音' : '');
  const metaBits = [`${(result.bytes / 1024 / 1024).toFixed(1)}MB`, `${Math.round(result.durationSec)}s`];
  if (result.frames) metaBits.push(`${result.frames} 帧`);
  // build-91-varispeed：wasm-aac（软编 AAC）对用户只呈示「AAC」；硬编 aac/opus 原样大写
  if (result.audioCodec) metaBits.push(`音频 ${result.audioCodec === 'wasm-aac' ? 'AAC' : String(result.audioCodec).toUpperCase()}`);
  const body = h('div', {},
    h('video', { class: 'vexp-done-video', controls: true, src: url }),
    h('div', { class: 'vexp-meta' }, `${name} · ${metaBits.join(' · ')}`),
    noteText ? h('div', { class: 'vexp-note', style: 'color:#f87171' }, noteText) : null);
  const save = h('button', { class: 'btn primary', onclick: () => {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    toast('已开始下载视频文件');
  } }, '保存视频');
  modal('视频导出完成', body, [save], { onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
}
async function startVideoExportFlow() {
  if (videoExportBusy) return; // 导出期间禁止重复触发
  const s = store.getState();
  if (!s.project) { toast('先打开一个项目（项目库点卡片）再导出'); return; } // 菜单项目库视图也可点（恒可点方案），给文字反馈
  if (!s.project.media?.assets?.length) { toast('导出视频需要先载入音乐'); return; }
  if (player?.playing) player.pause(); // 导出前停走带（快照语义，避免声音串扰）
  // build-91-varispeed：busy 先置位再 await probe——probe 期间双击第二发直接被门挡下；
  // probe 不过不开进度弹窗，toast 一句话 reason 即返（finally 复位 busy）
  videoExportBusy = true;
  let cancelled = false;
  let prog = null;
  try {
    const caps = await vx.probeExportCapabilities();
    if (!caps.ok) { toast(caps.reason || '当前浏览器不支持视频导出'); return; }
    const presetId = await showVideoExportSettings();
    if (!presetId) return;
    const project = s.project;
    const preset = vx.pickPreset(presetId);
    prog = showVideoExportProgress(() => { cancelled = true; });
    const result = await vx.exportVideo({
      project, preset: presetId, theme: s.theme,
      resolveBuffer: id => audio.ensureAssetBuffer(id), // 异步兜底：buffer 缺失时 OfflineAudioContext 重解码
      resolveProcessed: clip => processedAudioFor(clip), // build-92-stretch：变速/变调 clip 混音换 processed 源
      envOf: id => audio.assets.get(id)?.env || null,
      onProgress: ({ phase, ratio }) => prog.set(ratio, videoExportPhaseText(phase, ratio, project, preset)),
      isCancelled: () => cancelled,
    });
    prog.close();
    showVideoExportDone(result);
  } catch (e) {
    prog?.close();
    toast(e?.cancelled ? '已取消视频导出' : ('视频导出失败：' + (e?.message || e)));
  } finally {
    videoExportBusy = false;
  }
}

// ---------- 仅导出音频（build-91-varispeed）：离线混音 → M4A（Mediabunny 音频轨） ----------
// 与视频导出同门（probe 选路/预检/toast 语义），无设置弹窗（无可选参数）；进度三相
// mix/encode/mux 恒全局 0..1。完成弹窗 <audio> 预览 + 下载（-audio.m4a）。
let audioExportBusy = false; // 与视频导出共斥：同一弹窗体系，互斥最稳
async function startAudioExportFlow() {
  if (audioExportBusy || videoExportBusy) return;
  const s = store.getState();
  if (!s.project) { toast('先打开一个项目（项目库点卡片）再导出'); return; }
  if (!s.project.media?.assets?.length) { toast('导出音频需要先载入音乐'); return; }
  if (player?.playing) player.pause();
  // build-91-varispeed：格式选择（M4A=AAC 优选；MP3=LAME 软编，通用兼容）
  const format = await showAudioFormatPicker();
  if (!format) return;
  audioExportBusy = true;
  let cancelled = false;
  const prog = showVideoExportProgress(() => { cancelled = true; });
  try {
    const result = await vx.exportAudio({
      project: s.project, format,
      resolveProcessed: clip => processedAudioFor(clip), // build-92-stretch：变速/变调混音换 processed
      resolveBuffer: id => audio.ensureAssetBuffer(id),
      onProgress: ({ phase, ratio }) => {
        const label = phase === 'mix' ? '音频混音中' : phase === 'encode' ? '音频编码中' : (format === 'mp3' ? '封装 MP3' : '封装 M4A');
        prog.set(ratio, `${label}（${Math.round(ratio * 100)}%）`);
      },
      isCancelled: () => cancelled,
    });
    prog.close();
    showAudioExportDone(result);
  } catch (e) {
    prog.close();
    toast(e?.cancelled ? '已取消音频导出' : ('音频导出失败：' + (e?.message || e)));
  } finally {
    audioExportBusy = false;
  }
}
// 音频格式选择（build-91-varispeed）：Promise resolve 'm4a'|'mp3'，取消=resolve(null)
function showAudioFormatPicker() {
  return new Promise(resolve => {
    let picked = 'm4a';
    const mk = (val, label, desc) => h('label', { class: 'vexp-preset-item', style: 'display:flex;gap:8px;align-items:center;padding:6px 4px;cursor:pointer' },
      h('input', { type: 'radio', name: 'aexp-format', value: val, ...(picked === val ? { checked: true } : {}), onchange: () => { picked = val; } }),
      h('span', {}, h('b', {}, label), h('span', { class: 'dim' }, ' — ' + desc)));
    const body = h('div', {},
      h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
        mk('m4a', 'M4A（AAC）', '质量优选，iTunes/iOS/现代播放器通认'),
        mk('mp3', 'MP3', '最通用兼容（LAME 软编，任意设备/微信/老播放器）')),
      h('div', { class: 'vexp-note' }, '导出当前时间轴的完整混音（多 clip/淡化/增益全生效），全程本机渲染。'));
    const m = modal('仅导出音频', body, [
      h('button', { class: 'btn primary', onclick: () => { resolve(picked); m.close(); } }, '开始导出'),
    ], { onClose: () => resolve(null) });
  });
}
function showAudioExportDone(result) {
  const url = URL.createObjectURL(result.blob);
  const name = vx.audioFileName(store.getState().project).replace(/\.m4a$/, result.ext === 'mp3' ? '.mp3' : '.m4a');
  const body = h('div', {},
    h('audio', { controls: true, src: url, style: 'width:100%' }),
    h('div', { class: 'vexp-meta' },
      `${name} · ${(result.bytes / 1024 / 1024).toFixed(1)}MB · ${Math.round(result.durationSec)}s · 音频 ${String(result.audioCodec).toUpperCase()}`),
    result.note ? h('div', { class: 'vexp-note', style: 'color:#f87171' }, result.note) : null);
  const save = h('button', { class: 'btn primary', onclick: () => {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    toast('已开始下载音频文件');
  } }, '保存音频');
  modal('音频导出完成', body, [save], { onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
}

// ---------- build-72-checkupdate F1 · 检查更新（强制刷新到最新版） ----------
// 用户诉求：随时可见的「检查更新」入口（编辑器顶栏 #btn-check-update + 项目库首页
// #btn-lib-check-update，两入口同走本函数），一键克服浏览器缓存滞留更新到最新版本。
// 极简语义（无网络探测/无版本比对）：本应用 HTTP 托管 no-cache+etag，reload 主文档即拉最新；
// SW（HTTPS 场景）的 sw.js 对导航请求 ignoreSearch 缓存优先，须先注销全部 SW + 删尽
// Cache Storage 壳再 reload，否则旧 HTML 原地循环。iOS Safari 无 reload(true)，
// 「清壳 + location.reload()」即其现代等价（地址栏 reload 对主文档 revalidate）。
// 清壳失败不阻断刷新（catch 兜底——裸 reload 仍靠 no-cache+etag 校验拉新）。
// export 供 node 单测直测调用序列（ioSource 同款先例）。
export async function forceReloadToLatest() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.serviceWorker?.getRegistrations === 'function') {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {} // 清壳异常（半开环境/权限等）不吞掉刷新本身
  location.reload();
}

// ---------- 顶栏 ----------
function wireTopbar() {
  $('btn-back').addEventListener('click', async () => { player?.stop(); await store.closeProject(); });
  $('proj-title').addEventListener('change', () => store.mutate(p => { p.meta.title = $('proj-title').value || '未命名'; }, '重命名项目'));
  // 右面板 Tab 切换（队形/舞台/样式/编组/索引；build-55-uiclean P2 起说明书走顶栏钮；
  // build-56-indextab 起索引入栏为第 5 页签）。页签与页容器按 data-tab/props-<tab> 约定配对，
  // 显隐收口 activatePropsTab 单入口（⌘⇧L/索引钮同走，防两套 DOM 写法漂移）：
  document.querySelectorAll('.panel-tabs button').forEach(b => b.addEventListener('click', () => {
    activatePropsTab(b.dataset.tab);
    // 索引页签激活即补挂载+渲染一次（此前非激活期零 DOM 写的补偿；其余页签容器由各自 render 填充）
    if (b.dataset.tab === 'index') { siMount('stage'); renderSegIndexPanel(); siTick(); }
  }));
  $('btn-theme').addEventListener('click', () => {
    const next = store.getState().theme === 'light' ? 'dark' : 'light';
    store.setUI({ theme: next });
    applyTheme(next);
  });
  // build-72-checkupdate F1：检查更新（名册旁；项目库首页入口在 wireLibrary，两处同走 forceReloadToLatest）
  $('btn-check-update')?.addEventListener('click', () => { forceReloadToLatest(); });
  $('btn-roster').addEventListener('click', () => {
    // build-69-roster R2：syncSelection——名册删除舞者后清掉画布残留选中态（名册=唯一身份源）
    // build-79-tlui（需求 6 名册状态列启用）：传 getFormationIndex——行内「上场」状态列随当前
    // 队形呈示（ui.js 缺省 null=隐藏，行为面自此接线启用）
    showRosterModal({
      mutate: (fn, label) => store.mutate(fn, label),
      toast,
      getProject: () => store.getState().project,
      syncSelection: ids => store.setUI({ selection: store.getState().selection.filter(id => !ids.includes(id)) }),
      getFormationIndex: () => store.getState().formationIndex,
    });
  });
  $('btn-undo').addEventListener('click', () => { store.undo(); });
  $('btn-redo').addEventListener('click', () => { store.redo(); });
  // 双 UI 模式分段开关（两入口同态；快捷键 M 在 wireKeyboard）
  $('ui-mode-stage')?.addEventListener('click', () => setUiMode('stage'));
  $('ui-mode-music')?.addEventListener('click', () => setUiMode('music'));
  // build-71-iomenu F1：导入/导出统一菜单——#app 级共享 #io-menu，两视图入口同组件：
  // 编辑器顶栏 #btn-export（id 保留，文案改「导入/导出 ▾」）+ 项目库 #btn-lib-io。
  // 开菜单刷新两件事：视频导出项启停态（能力/音频资产）+ 保存覆盖条目显隐（F2 条件）。
  const menu = $('io-menu');
  const sub = $('exp-submenu'), subBtn = $('exp-sub-toggle');
  const openIoMenu = anchorBtn => {
    if (menu.hidden) closeContextMenu(); // 单弹窗不变式（F2）：开本下拉前先关已开的弹层
    menu.hidden = !menu.hidden;
    // build-50 F3：顶栏 ≤1023.5px overflow-x:auto 会把 absolute 下拉裁进 48px 顶栏（iPad
    // 竖屏「无法显示和操作」）——与 #music-toolbar .dd-menu 的 build-44 方案同构：菜单改
    // fixed（css #io-menu，build-71 自 #export-dd .dd-menu 随迁），打开时按触发钮视口坐标
    // 摆位（右对齐按钮、top=按钮底 +4px、视口钳制）。摆位算术抽 model.placeDropdownBelow
    // 纯函数（node 可测）。
    if (!menu.hidden) {
      const r = anchorBtn.getBoundingClientRect();
      const pos = M.placeDropdownBelow(r, window.innerWidth || 0);
      menu.style.left = 'auto';
      menu.style.top = pos.top + 'px';
      menu.style.right = pos.right + 'px';
      sub.hidden = true; // 重开收起二级子菜单（从首层开始）
      subBtn.setAttribute('aria-expanded', 'false');
      // build-71-iomenu：菜单现两视图可见——项目库视图无打开项目（closeProject 置 null），
      // 导出组全部禁用并给出去处提示（导出语义需在编辑器内）；「从项目文件导入…」不受限
      //（恰是项目库页的核心用途），保存覆盖条目由 syncSaveBackItem 的 project 判空自然隐藏。
      // exp-video 不在此列：启停态由 syncVideoExportItem 独管（sig 缓存，回编辑器自动恢复）。
      const hasProj = !!store.getState().project;
      for (const id of ['exp-audio', 'exp-png', 'exp-print', 'exp-json-audio', 'exp-json', 'exp-sub-toggle']) {
        const b = $(id);
        if (b) { b.disabled = !hasProj; b.title = hasProj ? '' : '先打开一个项目（项目库点卡片）再导出'; }
      }
      syncVideoExportItem(); // 开菜单即刷新启停态（能力探测/音频资产有无）
      syncSaveBackItem();    // build-71-iomenu F2：保存覆盖条目条件显隐
    }
  };
  $('btn-export').addEventListener('click', e => { e.stopPropagation(); openIoMenu($('btn-export')); });
  $('btn-lib-io').addEventListener('click', e => { e.stopPropagation(); openIoMenu($('btn-lib-io')); });
  document.addEventListener('click', () => { menu.hidden = true; });
  // F3 连带（取简单者）：顶栏横滚（fixed 菜单不随按钮走）与窗口 resize 时直接收起，重开重摆
  // build-66-mobileux F2：横滚容器改为滚动段 #topbar-scroll（#ui-mode-seg 移出滚动流后顶栏自身不再滚）
  $('topbar-scroll').addEventListener('scroll', () => { menu.hidden = true; }, { passive: true });
  window.addEventListener('resize', () => { menu.hidden = true; });
  // 二级子菜单（导出 ▸）：点击切换 + 悬停展开（触屏无 hover，点击为准；stopPropagation 防
  // document 级「点任意处收菜单」把切换吞掉）。子项点击不拦——既触发动作业收起整组菜单。
  subBtn.addEventListener('click', e => {
    e.stopPropagation();
    sub.hidden = !sub.hidden;
    subBtn.setAttribute('aria-expanded', String(!sub.hidden));
  });
  subBtn.addEventListener('mouseenter', () => {
    if (menu.hidden || !sub.hidden) return;
    sub.hidden = false;
    subBtn.setAttribute('aria-expanded', 'true');
  });
  $('exp-png').addEventListener('click', () => { const f = currentFormation(); if (f) exp.exportPNG(store.getState().project, f, store.getState().theme); });
  // 导出视频（编排播放）· build-60-videoexport：菜单项随能力/音频资产态启停（开菜单时刷新）
  $('exp-video').addEventListener('click', () => { menu.hidden = true; startVideoExportFlow(); });
  $('exp-audio').addEventListener('click', () => { menu.hidden = true; startAudioExportFlow(); }); // build-91-varispeed
  syncVideoExportItem();
  $('exp-print').addEventListener('click', () => {
    try { exp.printFormations(store.getState().project, 'light'); } catch (e) { toast(e.message); }
  });
  // 多轨（R47 §12.5 一行接线）：v1（不含乐）剥离 timeline.tracks 与 clip.trackId——
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
  // build-71-iomenu F1/F2：从项目文件导入——root 级条目（原「导出」菜单末项平移）。
  // Chromium（window.showOpenFilePicker 存在）优先走句柄路径：拿到 FileSystemHandle 记入
  // ioSource，会话内即可「保存覆盖到原文件」；Safari/旧浏览器无此 API → 降级既有 input
  // 路径（无句柄，保存覆盖条目自然隐藏，语义同现状）。选择器异常（权限等）也降级 input。
  const doImport = async (file, handle) => {
    const r = await importProjectFile(file, {
      readFile: exp.readProjectFile,
      importProject: p => { player.stop(); store.importProject(p); },
      restoreAudio: restoreProjectAudio,
      toast,
    });
    if (r.status === 'ok') markIoSource(handle, file.name, r.hadAudio, store.getState().project);
  };
  $('imp-json').addEventListener('click', async () => {
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: '舞阵项目文件', accept: { 'application/json': ['.json'] } }],
        });
        await doImport(await handle.getFile(), handle);
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // 用户取消选择器：静默
        // 其他异常（权限/安全错误等）：降级 input 路径继续可导入
      }
    }
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      await doImport(inp.files[0], null);
    });
    inp.click();
  });
  // build-71-iomenu F2：保存覆盖——写回导入时的原文件句柄。含/不含音乐按原文件是否有乐
  // 决定（ioSource.hadAudio）；组装与导出下载同源（exp.writeProjectToHandle → buildProjectFile）。
  $('save-back').addEventListener('click', async () => {
    menu.hidden = true;
    await saveBackToSourceFile({
      handle: ioSource.handle,
      fileName: ioSource.name,
      hadAudio: ioSource.hadAudio,
      project: store.getState().project,
      dirty: isIoDirty(store.getState().project),
      assemble: async () => { // 与含乐导出同源：资产优先（v3），legacy 单音频兜底
        const assets = await getExportAssets();
        const act = store.getState().project?.media?.activeAssetId;
        let blob = assets.find(a => a.id === act)?.blob || null;
        if (!blob) blob = await getExportAudioBlob();
        return { assets, blob };
      },
      confirmImpl: msg => confirm(msg),
      write: (hdl, project, blob, opts) => exp.writeProjectToHandle(hdl, project, blob, opts),
      toast,
      onSaved: () => markIoSource(ioSource.handle, ioSource.name, ioSource.hadAudio, store.getState().project),
    });
  });
}
// build-71-iomenu F2：保存覆盖条目条件显隐——仅当「本会话从文件导入过（有句柄）且内容已修改」
// 时可见；项目库视图（无打开项目）自然隐藏。开菜单时刷新（openIoMenu）+ 导入成功后即时刷新。
function syncSaveBackItem() {
  const b = $('save-back');
  if (!b) return;
  const p = store.getState().project;
  b.hidden = !(ioSource.handle && p && isIoDirty(p));
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
  // build-62-formations2 F3：观众方向快捷钮——bottom↔top 一键切换（单条「观众方向」历史，
  // 可撤销）。只写 stage.audience：显示层垂直镜像由 drawScene/toStage 经同一纯函数对生效，
  // 舞者/队形数据零变化；四向（左/右）仍在舞台页签 select。文字随状态在 render 同步。
  $('btn-audience-dir').addEventListener('click', () => {
    const cur = store.getState().project.stage.audience;
    const nxt = cur === 'top' ? 'bottom' : 'top';
    store.mutate(p => { p.stage.audience = nxt; }, '观众方向');
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
  // 显示…下拉（build-55-uiclean P3）：幽灵/路径/切帧预览三状态开关收纳（原 stage-tools 行内三钮退役）。
  // store 字段不变（showGhost/showPaths/previewOnSwitch）；勾选态在 render 里同步（✓ 前缀 + aria-checked）
  const vdd = $('view-dd'), vmenu = vdd?.querySelector('.dd-menu');
  $('btn-view-dd')?.addEventListener('click', e => {
    e.stopPropagation();
    if (vmenu.hidden) closeContextMenu(); // 单弹窗不变式（F2）：开本下拉前先关已开的弹层
    vmenu.hidden = !vmenu.hidden;
    // build-44/50 同构：工具行 overflow-x:auto 会裁 absolute 菜单——改 fixed 按按钮视口坐标摆位
    // （右对齐按钮、top=按钮底+4、视口钳制，M.placeDropdownBelow 纯函数）
    if (!vmenu.hidden) {
      const r = $('btn-view-dd').getBoundingClientRect();
      const pos = M.placeDropdownBelow(r, window.innerWidth || 0);
      vmenu.style.left = 'auto';
      vmenu.style.top = pos.top + 'px';
      vmenu.style.right = pos.right + 'px';
    }
  });
  document.addEventListener('click', () => { if (vmenu) vmenu.hidden = true; });
  $('vw-ghost')?.addEventListener('click', () => { store.setUI({ showGhost: !store.getState().showGhost }); });
  $('vw-paths')?.addEventListener('click', () => { store.setUI({ showPaths: !store.getState().showPaths }); });
  $('vw-anim')?.addEventListener('click', () => { store.setUI({ previewOnSwitch: !store.getState().previewOnSwitch }); });
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
  // build-79-tlui（需求 5 生成队形只作用在场）：unit ids 与 M.onStageIds(p, f) 求交集
  //（onStageIds 按名册序返回，交集保留名册序）——缺席（后台/候场/已移出）舞者不参与生成，
  // 其本帧位置由 applySlots 子集模式原样保留。全员在场=全集，几何与旧路径逐值一致。
  const onStage = new Set(M.onStageIds(s.project, s.project.formations[s.formationIndex]));
  let ids;
  if (unit === 'men') ids = s.project.dancers.filter(d => d.role === 'M').map(d => d.id);
  else if (unit === 'women') ids = s.project.dancers.filter(d => d.role === 'F').map(d => d.id);
  else ids = M.orderedDancers(s.project);
  ids = ids.filter(id => onStage.has(id));
  if (!ids.length) { toast('当前队形没有在场舞者——生成器不作用（先把舞者加回本队形）'); return; }
  store.mutate(p => {
    const f = p.formations[s.formationIndex];
    const slots = shapes.genSlots(kind, ids.length, p.stage, { rows, unit });
    // build-62-formations2 F2 智能分配：全项目第一个队形（简化判定 = formations.length===1）
    // 保持现状顺序对位（就近保持贪心）；否则以「上一队形同舞者坐标」为起点做最小总移动距离
    // 分派（assignMinCost：匈牙利 O(n³)，cost=欧氏距离）——显著减少交叉与过远移动
    // （度量成本下 1D 可证非交叉；2D 经验性大幅减少，不承诺零交叉）。朝向仍由 genSlots 决定。
    const prev = (p.formations.length > 1 && s.formationIndex > 0) ? p.formations[s.formationIndex - 1] : null;
    let effSlots = slots;
    if (prev) {
      const prevPos = prev.positions || {};
      // 编队粒度=子集时，起点取同子集舞者在上一队形的坐标；缺位回退 本帧现位 → 上队形质心 → 场地中心
      const prevIds = Object.keys(prevPos);
      const fallback = prevIds.length
        ? centroid(prevPos, prevIds)
        : { x: p.stage.widthM / 2, y: p.stage.depthM / 2 };
      const fromPts = ids.map(id => prevPos[id] || f.positions[id] || fallback);
      const order = assignMinCost(fromPts, slots); // order[舞者序] = slot 序
      if (order.length === ids.length) effSlots = order.map(si => slots[si]);
    }
    // applySlots 子集模式（opts.ids）内建「子集外舞者原位保留」——原 kept 手工保留 hack 退役
    if (prev) shapes.applySlots(f, ids, effSlots, { ids }); // 已按指派定序：直配
    else shapes.applySlots(f, ids, slots, { current: f.positions, ids }); // 首队形：现状就近对位
    M.applyFormationLayout(p, s.formationIndex); // 顺延缺席舞者位置（合并单元仅由手动操作创建）
  }, `生成队形(${kind})`);
}

// ---------- 播放条 ----------
// build-66-mobileux F1：循环/节拍器裸 checkbox → 图标 toggle 按钮——aria-pressed 为状态源，
// setPbToggle 同步 .toggled-on 类（accent 选中态呈示）。读取统一走 pbLoopOn()/pbMetroOn()
// （原 6 处 .checked 读取点全部换线，行为等价）；写入链不变：
// 循环=player.setLoop（DOM 态，不入 store），节拍器=project.timeline.metronome（store，render 回写）
function setPbToggle(id, on) {
  const b = $(id);
  if (!b) return;
  b.setAttribute('aria-pressed', String(!!on));
  b.classList.toggle('toggled-on', !!on);
}
const pbLoopOn = () => $('pb-loop')?.getAttribute('aria-pressed') === 'true';
const pbMetroOn = () => $('pb-metro')?.getAttribute('aria-pressed') === 'true';
function wirePlaybar() {
  $('pb-play').addEventListener('click', () => togglePlay());
  $('pb-stop').addEventListener('click', () => { player.stop(); store.setUI({}); });
  $('pb-prev').addEventListener('click', () => stepFormation(-1));
  $('pb-next').addEventListener('click', () => stepFormation(1));
  $('pb-speed').addEventListener('change', () => player.setSpeed(+$('pb-speed').value));
  $('pb-loop').addEventListener('click', () => { setPbToggle('pb-loop', !pbLoopOn()); updateLoop(); });
  $('pb-metro').addEventListener('click', () => { setPbToggle('pb-metro', !pbMetroOn()); store.mutate(p => { p.timeline.metronome = pbMetroOn(); }, null); });
}
function updateLoop() {
  const on = pbLoopOn();
  const s = store.getState();
  // build-70 M3 换源：循环区间=选中 clip 的 [start, 下一 clip.start)（变换段=空隙自动含入；
  // 末 clip 无下一 clip → 到末 clip.end）。
  const { segments } = M.segmentsFromClips(s.project.formations);
  const seg = segments[s.formationIndex];
  const loopEnd = seg ? (segments[s.formationIndex + 1] ? segments[s.formationIndex + 1].start : seg.end) : 0;
  player.setLoop(!!(on && seg), seg ? seg.start : 0, seg ? loopEnd : 0);
  if (on && seg && player.beat < seg.start) player.seekBeat(seg.start);
}
// DEFECT-R26-4：播放中改块时长（时间轴拖边 / ± 步进 / 面板输数）不暂停，循环区间若不跟随
// 新段长，会一直在旧边界内打转（实测 loopEnd=72 vs 新 travelEnd=99）。仅在播放+循环开启时刷新。
function syncLoopAfterBlockEdit() {
  if (player?.playing && pbLoopOn()) updateLoop(); // build-66-mobileux F1：换线
}
function togglePlay() {
  if (player.playing) { player.pause(); return; }
  const s = store.getState();
  const { segments } = M.segmentsFromClips(s.project.formations);
  const seg = segments[s.formationIndex];
  // 决策①（M1）：音乐模式 ▶ 恒从播放头起播（播放头≈0 时从 0，不再跳到当前队形段起点——
  // 起播点由播放头决定、不由队形决定）；stage 模式从当前队形段起播（逐值不动）。
  const inMusic = musicTl?.mode === 'music';
  const freshFrom = inMusic ? 0 : (seg ? seg.start : 0);
  if (playerAtEnd()) {
    // 任务#6/#7（报告#6/#7）：全曲播完后再按 ▶ 从头播（不再只重播最后一段/静默归 0）
    if (audio.ready) player.play(0);
    else player.play(0, { forceVirtual: true });
  } else if (player.beat > 0.001) {
    player.play(null); // 暂停后续播（音频结束态经 useAudio=false 由虚拟时钟接管）
  } else if (audio.ready) {
    player.play(freshFrom); // 有音乐：按音乐时钟（music=从播放头 0；stage=从当前队形段）
  } else {
    // 无音乐：虚拟时钟（任务#6 终态统一）——不再单段预览，同音乐档一样播到终点
    // 并置 ended；循环开启时在当前队形段内回绕（虚拟时钟原生支持）
    player.play(freshFrom, { forceVirtual: true });
  }
  updateLoop();
}
function playerAtEnd() {
  // M1 模式感知：终点域 music=音乐域换算拍（音频播完才算完）；stage=totalBeats（逐值不动）
  const p = store.getState().project;
  const endBeat = musicTl?.mode === 'music'
    ? Math.max(0, M.secToBeat(p, M.musicDomainSec(p)))
    : M.segmentsFromClips(p.formations).totalBeats;
  return player.beat >= endBeat - 0.001;
}
function stepFormation(d) {
  // 决策①（M3 正式实装，M1 占位退役）：音乐模式 ⏮/⏭ = 前后 clip 缘步进（经典 DAW 语义）——
  // 播放头跳到上一个/下一个 clip 边缘（缘秒位升序取严格前/后近邻；无缘=域首 0/域尾）；
  // stage 模式队形步进逐值不动。
  if (musicTl?.mode === 'music') {
    const p = store.getState().project;
    if (!p) return;
    const curSec = M.beatToSec(p, Math.max(0, player.beat || 0));
    const targetSec = clipEdgeStepSec(M.clipsOf(p), curSec, M.musicDomainSec(p), d);
    player.seekBeat(Math.max(0, M.secToBeat(p, targetSec)));
    musicTl.drawPlayhead();
    return;
  }
  const s = store.getState();
  const ni = Math.max(0, Math.min(s.formationIndex + d, s.project.formations.length - 1));
  switchFormation(ni); // build-70 M3：switchFormation 内含 seekFormation（播放线对齐 clip 开头）
  if (pbLoopOn()) updateLoop(); // 循环区间跟随队形切换（build-66-mobileux F1：换线）
}

// ---------- 音乐面板 ----------
// 任务#2（报告#2）→ 决策④（M1 重定位）：音乐模式以秒制走带，播放中改 BPM/首拍只平移
// 「拍↔秒映射」、音频秒位一个字节不动（applyTempoEdit 重定虚拟时钟基准）——播放锁对 BPM/首拍
// 解除（实时校准体验质变）；锁收缩到点拍（采样类校准件：播放中点击无意义且写回会造成拍位抖动）。
const musicLocked = () => !!(player && player.playing);
const MUSIC_LOCK_TIP = '暂停后可修改';
// [元素, 名称, 未锁定时的常态 title]（常态 title 与 index.html 一致，锁定时替换为统一提示；
// W1 起含音乐工具条孪生件 ——music 后缀，同锁同还原。M1 起仅点拍在列——BPM/首拍播放中可改）
// build-79-tlui（需求 7b）：点拍/试听钮退役——锁列清空（点拍是唯一采样类校准件）。机械保留：
// 未来若有播放中须锁的控件，回填本表即恢复锁定呈示（updateMusicLock 挂点不动）。
const MUSIC_LOCK_TARGETS = [];
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
  //      载入/媒体库/按队形段自动切不入编舞（音乐工具条 mtb-* 孪生件承接）。
  //      build-79-tlui（需求 7b）：「点拍/试听」钮删除、「校准」折叠 HTML 注释隐藏（暂留代码
  //      便于恢复）——#bpm-input/#offset-input/#bpb-select 元素缺席，接线 ?. 守卫
  //     （恢复 HTML 注释即整链恢复：监听/锁定/回显全在）。播放锁（updateMusicLock）挂点不变。
  $('audio-file').addEventListener('change', async () => {
    const file = $('audio-file').files[0];
    if (!file) return;
    await loadAudioFile(file);
  });
  $('bpm-input')?.addEventListener('change', () => {
    applyTempoEdit(p => { p.audio.bpm = Math.max(30, Math.min(300, +$('bpm-input').value || 120)); }); // 决策④：播放中可改（秒位不变）
  });
  $('offset-input')?.addEventListener('change', () => {
    const v = Math.max(0, +$('offset-input').value || 0);
    applyTempoEdit(p => { p.audio.firstBeatSec = v; }); // 决策④：播放中可改（秒位不变）
    // 任务#10（报告#10）：首拍越界（≥音频时长）一次性 toast 告警，不阻断——
    // 让「按播放没反应」的配置错误可诊断
    if (audio.ready && audio.duration && v >= audio.duration) {
      toast(`首拍（${v}s）已超出音频时长（${audio.duration.toFixed(1)}s），请确认单位为秒`);
    }
  });
  $('bpb-select')?.addEventListener('change', () => store.mutate(p => { p.audio.beatsPerBar = +$('bpb-select').value; }, null));
  // 把当前队形块的起点对齐到播放头时间戳（调整前一段过渡时长）——W2 起按钮驻块时长栏（编舞域）
  $('btn-align-playhead').addEventListener('click', () => alignCurrentToPlayhead());
  // build-70：连续时长（ripple）checkbox 退役（clip 模型下无意义）——入口与接线一并移除
  // 块时长快捷步进（build-78-recorder：±0.1s，时间唯一标准）——编舞块栏（bc-*）与音乐模式 preview 栏（mp-*）共用
  $('bc-hold-minus').addEventListener('click', () => stepBlockSec('holdBeats', -0.1));
  $('bc-hold-plus').addEventListener('click', () => stepBlockSec('holdBeats', 0.1));
  $('bc-travel-minus').addEventListener('click', () => stepBlockSec('travelBeats', -0.1));
  $('bc-travel-plus').addEventListener('click', () => stepBlockSec('travelBeats', 0.1));
  // ⚑ 打点（build-55-uiclean P1-1）：块时长条打点钮副本退役——打点建的是音乐节奏区域，
  // 唯一按钮入口归音乐工具条（wireMusicToolbar 内接线不变）；tag 道双击空白仍可打点
  // build-78-recorder（时间唯一标准）：编舞尺规组「拍/秒切换」钮 #tl-scale-toggle 及其接线
  // 移除（stage 尺规恒秒刻度，drawRuler stage 分支强制 sec）；缩放组保留。
  // 音乐模式工具条孪生钮 #tl-scale-toggle-music 保留切换（wireMusicToolbar 内，行为不动）。
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
  // GOLD-DEFECT-1 兜底（build-43-accept 起为防御性保留）：媒体库已退役弹窗改为音乐模式
  // 侧边栏（#media-sidebar 与 lane 区 flex 并排，资产行 drop 直落 #tl-scroll——主路径），
  // .modal-back 盖满视口的遮挡问题随弹窗退役从结构上根除。本转发监听为兜底：防未来入口
  // 复现「资产行栖身覆盖层」形态时拖拽链静默失达——ui.js 遮罩 drop 判定落点在 #tl-scroll
  // 矩形内时经此 custom event 转发（ui.js 反向 import main.js 是环）。sec/lane 换算与建 clip
  // 与上方直落入口共用同一份 createClipFromDropAt——多个入口一条消费链，不重复造轮子。
  window.addEventListener('wuzhen:tl-asset-drop', async ev => {
    const d = ev.detail || {};
    if (!d.assetId) return;
    const before = store.getState().project?.timeline?.audioClips?.length ?? 0;
    await createClipFromDropAt(d.assetId, d.clientX, d.clientY, null);
    // 弹窗盖着时间轴，成功反馈走 toast（失败路径 createClipFromDrop 内已有各自 toast）
    if ((store.getState().project?.timeline?.audioClips?.length ?? 0) > before) toast('已在时间轴落点放置剪辑');
  });
  window.addEventListener('resize', () => { stageView?.requestDraw(); musicTl?.render(); syncTracksHead(store.getState().project); syncTlNav(); }); // M2：resize 后轨头行高跟随重建（无需数据变更，IR-M2-2）；F4：概览条重同步（build-56 起索引进侧栏 tab，无重摆挂点）
}

// build-79-tlui（需求 7b）：点拍（tapTimes/tapTempo）与试听（auditionFirstBeat）整体退役——
// 摘要条/工具条四处按钮入口删除后无调用方，状态与函数一并清理（恢复=回填本函数 + 按钮 HTML）。
// ---- W4 §2.5 乐段索引面板（双模式共用快速乐段索引，替代原摘要条段索引弹出列表）----
// 三层层级：区域行（色块 4 色循环与划分轨同色序 + 段名 + 秒区间）▸ 展开段内小节格
// + 顶部播放头行（▶ 当前位置，onTick 实时）。
// build-49 F1/F3 区域块化 + 名称优先：音乐模式「段」=tag 区域本身（[beat,endBeat) 直接读，
// 空白=无区域，不经 sectionSegmentsOf 推导；stage 仍走旧语义）。行布局=名称 flex:1 ellipsis
// 优先完整显示，节奏标注（tagRhythmLabel，仅用户标注）排其后不换行，秒位区间再后——
// 「xx拍」显示与任何拍位推算删除（时间轴秒=唯一对齐规范；BPM 估计全面退场）。
// 行尾「…」钮 → 弹出与轨道长按/右键完全相同的菜单（同一渲染函数 segMenuItems，含「删除标记」）。
// 数据源零新 schema；点击行=播放头跳转（播放中续播，seekBeat 既有语义）。
// 同一组件两处挂载（build-56-indextab 起=两模式侧栏 tab）：stage=右面板第 5 页签容器
// #props-index / music=媒体库段索引 pane #rsb-index-pane；入口=块时长条「索引」钮 / 摘要条
// 「tag N 个」钮（stage）、工具条「索引」钮（music）、⌘⇧L。
// 无 tags 空态「无节奏划分——到音乐模式 ⚑ 打点或划分轨双击落区域」。长曲虚拟滚动本轮降级为全量渲染。
// build-50 F2：expanded=小节格展开集（底层行专用，缺省收起——点 ▸ 才画格，语义不变）；
// 新增 collapsed=层级折叠集（非底层行的 ▸/▾：收起=隐藏其范围覆盖的全部后代行（递归），
// 展开=显示直接子行，子行自身若也在折叠集则保持收起。缺省全展开）。两集均跨重渲染/重开面板保持。
// 判定有子行的纯函数=「全量行序中下一行 depth=本行+1」（nestSegmentsByLevel 出参为时间序=先序：
// 父行后紧跟首子行；先按全量行算 hasKids 再过滤隐藏，防「收起后钮面消失无法再展开」）。
// 后代隐藏过滤抽 model.filterCollapsedRows 纯函数（node 可测）。
// build-56-indextab 退役注记：浮动索引面板（fixed 浮层 + 拖宽高 grip + 尺寸记忆键）与
// 避让摆位单入口（build-51）及其全部挂点退役——索引内容高度跟随宿主容器（stage 页容器
// flex 撑满右面板；music pane 吃 rsb 余量），列表 overflow-y 既有。零残留由 tests/indextab.test.js 钉住。
const siState = { root: null, list: null, ph: null, rows: [], expanded: new Set(), collapsed: new Set() };
// build-79-tlui（需求 1a）：行「描述」展开集（内存 Set，跨重渲染/重开面板保持）——独立于
// siState 双集（expanded=小节格 / collapsed=层级折叠），键=tag id。
const siDescOpen = new Set();
// 模式定位：索引容器按当前 UI 模式二选一（stage 页容器 / music 索引 pane）
function siCurrentMode() { return musicTl?.mode === 'music' ? 'music' : 'stage'; }
function siHostFor(mode) {
  return document.getElementById(mode === 'music' ? 'rsb-index-pane' : 'props-index');
}
// 单挂载点：siState.root 恒指向当前激活容器；切换时清旧容器（#si-playhead/#si-list 全文档唯一）。
// 渲染性能（沿用 build-50 折叠期跳更思路）：renderSegIndexPanel 只写激活容器，非激活容器零 DOM
// 写；激活切换（页签/pane/模式切换）时补挂载+补渲染一次。
function siMount(mode) {
  const host = siHostFor(mode || siCurrentMode());
  if (siState.root && siState.root !== host) siState.root.innerHTML = ''; // 旧容器退役（id 唯一性）
  if (!host) { siState.root = null; siState.list = null; siState.ph = null; return false; }
  siState.root = host;
  siState.ph = h('div', { id: 'si-playhead', class: 'mono', style: 'padding:4px 10px;font-size:12px;color:var(--acc);border-bottom:1px solid var(--line);flex:none;white-space:nowrap;overflow:hidden' }, '▶ 当前 0 秒');
  siState.list = h('div', { id: 'si-list', style: 'flex:1;overflow-y:auto;overscroll-behavior:contain;min-height:0' });
  host.innerHTML = '';
  host.append(siState.ph, siState.list);
  return true;
}
// 全量重建面板行（打开时与 store render 兜底时调用；expanded/collapsed 两集保证展开/折叠态不丢）
// build-47 分层：跨层区域展平后按层级归属嵌套呈示（nestSegmentsByLevel 纯函数）——level 0 为
// 顶层行，level 1 缩进为子行（子区域起点落入父区域范围即归属，不强制完全包含），以此类推；
// 只有 level 0 标记时行序/色序/观感与现状一致。build-50 F2：非底层行 ▸/▾ 接活=层级折叠
// （收起隐藏全部后代行，model.filterCollapsedRows 过滤），底层行钮=小节格展开（原语义）。
function renderSegIndexPanel() {
  if (!siState.root || !siState.list || !siIndexActive()) return; // 非激活容器零 DOM 写（激活切换方补渲染）
  const p = store.getState().project;
  const list = siState.list;
  list.innerHTML = '';
  siState.rows = [];
  const allSegs = [];
  if (p) {
    if (musicTl?.mode === 'music') {
      // 音乐模式：区域即段——显式层内 tags 的 [beat,endBeat) 直接成行（空白天然不列）
      const tlc = M.tagLevelCountOf(p);
      for (let lv = 0; lv < tlc; lv++) {
        for (const t of p.timeline.tags || []) {
          if (M.tagLevelOf(t) !== lv) continue;
          allSegs.push({ i: 0, tag: t, start: t.beat, end: M.tagEndBeatOf(t) });
        }
      }
    } else {
      // stage（编舞）：旧语义派生（sectionSegmentsOf 邻接成段——build-49 起仅 stage 路径使用）
      const endBeat = sectionEndBeatOf(p);
      for (const lv of M.tagLevelsOf(p)) allSegs.push(...M.sectionSegmentsOf(p, endBeat, lv).segs);
    }
  }
  const rows = M.nestSegmentsByLevel(allSegs);
  if (!rows.length) {
    list.append(h('div', { id: 'si-empty', style: 'padding:18px 12px;color:var(--dim);font-size:13px;text-align:center' },
      '无节奏划分——到音乐模式用 ⚑ 打点或划分轨双击落区域'));
    return;
  }
  // build-50 F2：先按全量行算「有子行」（先序下=下一行 depth 为本行+1），再过滤折叠隐藏——
  // 顺序不可反：收起的父行后代全藏，若先过滤再判会误判成底层行，▸ 钮面消失无法再展开。
  // 行序=父行后紧跟其可见子行（时间序即先序，深度优先）；缩进=8+depth*16（build-47 既有）。
  const hasKids = rows.map((r, i) => !!rows[i + 1] && rows[i + 1].depth === r.depth + 1);
  const visible = M.filterCollapsedRows(rows, siState.collapsed);
  // F2（build-52-wavezoom）：行首色块颜色单一出处——MusicTimeline.tagColorMap（层内拍序缺省、
  // tag.color 覆盖），与划分轨 drawSegLane / 编舞 tag 道 drawTags 同源 → 同 tag 同色三处对应。
  // 旧式 s.i 缺省序在 music 路径恒 0、stage 为全局段序，均与轨道的层内拍序错位（未换色 tag
  // 索引色≠轨道色），本行收口后消除。
  const colorMap = MusicTimeline.tagColorMap(p);
  rows.forEach(({ seg: s, depth }, i) => {
    if (visible[i].hidden) return; // F2：被收起祖先遮蔽的后代行（递归）不渲染
    const color = colorMap.get(s.tag.id) || MusicTimeline.tagColorAt(s.tag, s.i);
    const indent = 8 + depth * 16;
    const shut = siState.collapsed.has(s.tag.id);   // 层级折叠态（非底层行）
    const open = siState.expanded.has(s.tag.id);    // 小节格展开态（底层行，语义不变）
    const kids = hasKids[i];
    const rhythm = M.tagRhythmLabel(s.tag); // 仅用户手动标注（无则不显示）
    // F1：小节格仅按 tag.bars 标注展开（无标注 → 格钮禁用提示，不推算）
    const bars = (Number.isInteger(s.tag.bars) && s.tag.bars > 0) ? s.tag.bars : 0;
    // F2 裁定：行首钮一位两用——非底层行=层级折叠 ▸/▾（钮位让给层级，小节格仅底层行提供，
    // 非底层行的 bars 标注仍可在「…→编辑内容」查看）；底层行=小节格钮（无标注=禁用占位，
    // 保持行首对齐——选实现简单者）。
    const twBtn = kids
      ? h('button', {
          class: 'si-tw btn small', style: 'padding:0 6px;min-width:22px;flex:none',
          title: shut ? '展开子区域' : '收起子区域', 'aria-expanded': String(!shut),
          onclick: () => { if (shut) siState.collapsed.delete(s.tag.id); else siState.collapsed.add(s.tag.id); renderSegIndexPanel(); siTick(); },
        }, shut ? '▸' : '▾')
      : h('button', {
          class: 'si-tw btn small', style: 'padding:0 6px;min-width:22px;flex:none',
          ...(bars ? {} : { disabled: true, title: '无小节数标注（编辑标记填「小节数」后可展开）', 'aria-disabled': 'true' }),
          ...(bars ? { title: open ? '收起小节格' : `展开小节格（标注 ${bars} 小节）` } : {}),
          onclick: () => { if (open) siState.expanded.delete(s.tag.id); else siState.expanded.add(s.tag.id); renderSegIndexPanel(); siTick(); },
        }, open ? '▾' : '▸');
    // 行尾「…」钮：与轨道长按/右键完全相同的菜单（同一渲染函数 segMenuItems——菜单一致性裁定）
    const moreBtn = h('button', {
      class: 'btn small si-more', style: 'padding:0 7px;min-width:26px;flex:none',
      title: '标记操作（编辑/换色/升降级/删除）', 'aria-label': `「${s.tag.name}」操作菜单`,
      onclick: e => {
        e.stopPropagation(); // 不触发行跳转
        closeContextMenu(); musicTl?.closeTagPopover?.(); // 单弹窗不变式
        const r = e.currentTarget.getBoundingClientRect();
        showContextMenu(segMenuItems(s.tag.id), {
          x: Math.max(8, Math.min(r.left, (window.innerWidth || 360) - 170)),
          y: Math.min(r.bottom + 4, (window.innerHeight || 640) - 40),
        });
      },
    }, '…');
    // build-79-tlui（需求 1a）：行尾「…」之前的「描述」toggle——与行首层级钮（▸/▾ 层级折叠）
    // 视觉区分（本钮文字面「描述」）。无描述=点击 toast 引导到「…→编辑内容」填写；有描述=
    // 展开/收起描述文本块，展开态存 siDescOpen（内存 Set，重渲染保持）。
    const desc = String(s.tag.description || '').trim(); // sanitizeTags 已 trim+slice200，此处再兜底
    const descOpen = siDescOpen.has(s.tag.id);
    const descBtn = h('button', {
      class: 'btn small si-desc' + (descOpen && desc ? ' toggled-on' : ''),
      style: 'padding:0 6px;min-width:30px;flex:none;font-size:11px',
      title: desc ? (descOpen ? '收起描述' : '展开描述') : '无描述——行尾「…→编辑内容」可填写区域备注',
      'aria-expanded': String(!!desc && descOpen),
      onclick: e => {
        e.stopPropagation(); // 不触发行跳转
        if (!desc) { toast('该标记无描述——「…→编辑内容」可填写区域备注'); return; }
        if (descOpen) siDescOpen.delete(s.tag.id); else siDescOpen.add(s.tag.id);
        renderSegIndexPanel();
        siTick();
      },
    }, '描述');
    const row = h('div', {
      class: 'si-seg', 'data-start': String(s.start), 'data-end': String(s.end),
      style: `display:flex;align-items:center;gap:6px;padding:6px 8px 6px ${indent}px;cursor:pointer;border-bottom:1px solid var(--line);font-size:13px`,
      onclick: e => { if (e.target.closest('.si-tw') || e.target.closest('.si-desc') || e.target.closest('.si-more')) return; siSeek(s.start); },
    },
      twBtn,
      h('span', { style: `width:10px;height:18px;border-radius:3px;background:${color};flex:none` }),
      // 名称优先完整显示（flex:1 ellipsis——不被节奏标注挤占）；节奏标注与秒区间排其后不换行
      h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: s.tag.name }, s.tag.name),
      ...(rhythm ? [h('span', { style: 'color:var(--dim);font-size:11px;flex:none;white-space:nowrap' }, rhythm)] : []),
      h('span', { class: 'mono', style: 'color:var(--dim);font-size:11px;flex:none;white-space:nowrap' },
        `${M.beatToSec(p, s.start).toFixed(1)}→${M.beatToSec(p, s.end).toFixed(1)}s`),
      descBtn,
      moreBtn);
    list.append(row);
    siState.rows.push({ el: row, start: s.start, end: s.end });
    if (desc && descOpen) {
      // 描述文本块：行下缩进展开（pre-wrap 保换行）；不参与播放头行高亮（无独立时域）
      list.append(h('div', {
        class: 'si-desc-text',
        style: `padding:4px 8px 6px ${26 + indent}px;font-size:12px;color:var(--dim);white-space:pre-wrap;word-break:break-word;border-bottom:1px solid var(--line)`,
      }, desc));
    }
    if (kids || !open || !bars) return; // F2：小节格仅底层行展开（非底层行钮位=层级折叠）
    // 段内小节格（纯标注制）：格数=bars 标注；每格拍宽=区域拍跨度/bars 均分（标注语义，无 BPM 推算）；
    // 行内只呈示起点秒（秒=唯一对齐规范）
    const segLen = s.end - s.start;
    for (let j = 0; j < bars; j++) {
      const bs = Math.round((s.start + (segLen * j) / bars) * 100) / 100;
      const bar = h('div', {
        class: 'si-bar', 'data-beat': String(bs),
        style: `display:flex;align-items:center;gap:6px;padding:3px 8px 3px ${26 + indent}px;cursor:pointer;font-size:12px;color:var(--dim)`,
        onclick: () => siSeek(bs),
      },
        h('span', { class: 'mono', style: 'flex:1' }, `小节 ${j + 1}/${bars}`),
        h('span', { class: 'mono' }, `@${M.beatToSec(p, bs).toFixed(1)}s`));
      list.append(bar);
      siState.rows.push({ el: bar, start: bs, end: Math.min(s.end, bs + (segLen / bars)) });
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
// build-79-tlui（需求 1b）：两分支统一分秒读数——stage 旧「N.N 拍 · N.Ns」与 music 旧「N.Ns」
// 一并收进 fmtMinSec（x分x秒；不含任何 BPM 推算小节数，build-48 F1 口径延续）。仅时间轴读数
// 面：换算仍走 beatToSec，模型与播放零变化。
// 秒→分秒定稿：整数秒（四舍五入）；<60s 呈「37 秒」、≥60s 呈「1分23秒」（中文分秒面，
// 与块时长「8s」时长输入口径区分——本行是导航读数非时长编辑）。
function fmtMinSec(sec) {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  const mnt = Math.floor(t / 60);
  return mnt > 0 ? `${mnt}分${t % 60}秒` : `${t} 秒`;
}
function siTick() {
  if (!siState.ph || !siIndexActive()) return; // 非激活零开销（tab 切走/容器隐藏不读写 DOM）
  const p = store.getState().project;
  if (!p) return;
  const b = Math.max(0, player ? player.beat : 0);
  siState.ph.textContent = `▶ 当前 ${fmtMinSec(M.beatToSec(p, b))}`;
  // 区域行与其当前小节行同时高亮（两者区间都命中播放头；未展开时仅区域行亮）
  for (const r of siState.rows) r.el.style.background = (b >= r.start && b < r.end) ? 'var(--bg3)' : '';
}
// ---- build-56-indextab F2：激活/开合（tab 化语义） ----
// stage 右面板页签激活（与 wireTopbar 页签点击同一 DOM 面约定：data-tab → props-<tab> 显隐）
function activatePropsTab(tab) {
  document.querySelectorAll('.panel-tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('#right-panel .props-page').forEach(pg => { pg.hidden = pg.id !== 'props-' + tab; });
}
// music 媒体库段 pane 激活（段头 tab 条 [媒体库|索引]；两 pane 互斥显隐）——
// 状态写入收口 ui.applyRsbPaneState（元素入参，node 可测；round2 修复回归面）
function activateRsbPane(pane) {
  applyRsbPaneState({
    tabs: document.querySelectorAll('#rsb-lib-seg .rtab'),
    libPane: document.getElementById('media-sidebar'),
    indexPane: document.getElementById('rsb-index-pane'),
  }, pane);
}
// 索引容器处于激活位（内容应保持新鲜的最小判定面——右列/侧栏折叠不影响，照常跳更）
function siIndexActive() {
  const host = siHostFor(siCurrentMode());
  return !!host && !host.hidden;
}
// 「正看着索引」=激活位 + 宿主链可见（music 侧栏展开且段未折叠 / stage 右列展开——
// 右列折叠态仅桌面存在（38px 细条是 ≥1024 形态），移动端全屏「更多」页不受缺省折叠影响）
function siIndexShowing() {
  if (!siIndexActive()) return false;
  if (siCurrentMode() === 'music') return !rsbClosed() && !segFolded('rsb-lib-seg');
  return !stageRightCollapsed() || isMobileLayout();
}
// 打开=宿主链先就位（折叠/收起先展开）→ 切到索引 tab/pane → 挂载+渲染一次。
// music 侧栏整栏展开落盘（与「媒体库」钮同语义）；段折叠只揭幕不落盘（不改用户折叠记忆）；
// stage 右列展开落盘（与 rp-strip 同语义；移动端无右列折叠形态，不写记忆）。
function openSegIndexPanel() {
  const mode = siCurrentMode();
  if (mode === 'music') {
    if (rsbClosed()) applyRsbClosed(false, { persist: true });
    if (segFolded('rsb-lib-seg')) applySegFold('rsb-lib-seg', false);
    activateRsbPane('index');
  } else {
    if (!isMobileLayout() && stageRightCollapsed()) applyStageRightCollapsed(false, { persist: true });
    activatePropsTab('index');
  }
  siMount(mode);
  renderSegIndexPanel();
  siTick();
}
// 关闭（Esc / ⌘⇧L 再按）=让位缺省视图：stage→队形页签；music→媒体库 pane（内容留容器，重开重挂）
function closeSegIndexPanel() {
  if (siCurrentMode() === 'music') activateRsbPane('lib');
  else activatePropsTab('formation');
}
function toggleSegIndexPanel() { siIndexShowing() ? closeSegIndexPanel() : openSegIndexPanel(); }

// ---------- W1 音乐模式主区化：新接线 ----------
// build-70 M2：块时长 ±1 拍步进——保持±=选中 clip 长度（右缘动，setFormationClipLen 邻界钳制）；
// 过渡±=选中 clip 与**下一 clip** 的空隙（移动下一 clip 的 start，钳制不越下下个，setFormationGap）。
// 编舞块栏（bc-*）与音乐 preview 栏（mp-*）共用；mutate 带标签 = 恰一条历史（IR-W1-5）。
// 播放中允许（循环区间跟随，DEFECT-R26-4 口径不变）。
// build-78-recorder（时间唯一标准）：± 步进去拍值改 0.1s（deltaSec），模型层仍按拍存——
// sec→beat 就地换算（spb 动态取值，BPM 变化后换算自然生效，零迁移）；
// 最小值口径：保持受模型 FORM_CLIP_LEN_MIN（1 拍）钳制、过渡 ≥0 语义不变。
function stepBlockSec(key, deltaSec) {
  const s = store.getState();
  if (key === 'travelBeats' && s.formationIndex >= s.project.formations.length - 1) return;
  const spbv = M.spb(s.project);
  store.mutate(p => {
    if (key === 'holdBeats') {
      const f = p.formations[s.formationIndex];
      if (!f) return;
      M.setFormationClipLen(p, s.formationIndex, M.clipLenOf(f) + deltaSec / spbv);
    } else {
      const segs = M.segmentsFromClips(p.formations).segments;
      const cur = segs[s.formationIndex], next = segs[s.formationIndex + 1];
      if (!cur || !next) return;
      M.setFormationGap(p, s.formationIndex, Math.max(0, next.start - cur.end) + deltaSec / spbv);
    }
  }, key === 'holdBeats' ? '调整保持时长' : '调整过渡时长');
  syncLoopAfterBlockEdit(); // 步进改时长后循环区间跟随（DEFECT-R26-4）
  drawMusicPreview();       // preview 栏步进即时反映（块数据变更 → 画布/标签同步）
}
// 对齐到播放头（W1 起 preview 栏镜像同款按钮；build-70 M2=选中 clip 的 start 对齐播放头，
// moveFormationClip 邻界钳制——钳在左右邻 clip 之间，不再压缩上一块/改过渡）
function alignCurrentToPlayhead() {
  const s = store.getState();
  if (s.formationIndex === 0) { toast('第一个队形从 0 拍开始，无需对齐'); return; }
  const target = Math.max(0, player.beat);
  store.mutate(p => { M.alignFormationClipStart(p, s.formationIndex, target); }, '对齐到播放头');
  const actual = M.segmentsFromClips(s.project.formations).segments[s.formationIndex].start;
  if (Math.abs(actual - target) > 0.5) {
    toast(`目标不可达：起点已尽量移到 ${M.beatLabel(s.project, actual)}（${actual.toFixed(1)} 拍）`);
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
  // 媒体库（build-43-accept）：弹窗退役，改为 toggle 音乐模式侧边栏（开合记忆 wuzhen:mediaSidebar）
  $('mtb-media-library').addEventListener('click', toggleMediaSidebar);
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
  // 节拍组孪生件（W2 C3 收尾）：小节 select 保留；build-79-tlui（需求 7b）点拍/试听钮退役——
  // 对应孪生接线一并移除（摘要条侧同口径，见 wireAudioPanel）
  $('bpb-select-music').addEventListener('change', () => store.mutate(p => { p.audio.beatsPerBar = +$('bpb-select-music').value; }, null));
  // 尺规组（C5 迁移语义）：刻度切换/缩放与 #audio-disc 内同源。M4：－/＋ 改中心锚定
  //（zoomCenter——以视口 lane 区中点为锚，缩放前后中心秒不变；⤢=fit 适配音频域不变）
  $('tl-scale-toggle-music').addEventListener('click', () => {
    musicTl?.setRulerScale(musicTl.rulerScale === 'sec' ? 'beat' : 'sec');
    syncScaleToggle();
  });
  $('tl-zoom-in-music').addEventListener('click', () => musicTl?.zoomCenter(1.3));
  $('tl-zoom-out-music').addEventListener('click', () => musicTl?.zoomCenter(1 / 1.3));
  $('tl-zoom-fit-music').addEventListener('click', () => musicTl?.zoomFit());
  // 磁吸开关钮（M5 §2.5 工具条补齐：原仅 S 键盘入口——可发现性补全；键位保持）。
  // build-91-varispeed（需求 2）：剃刀钮改单发执行——点击立即以播放线剪切选中 clip（同 ⌘K
  // 语义，对齐 Adobe Audition），不再有 razorOn toggle/aria-pressed 态（指针模式由
  // timeline.js 保留休眠，UI 层不再进入）。
  $('tl-snap-toggle-music').addEventListener('click', () => { musicTl?.toggleSnap(); syncMusicToggles(); });
  $('tl-razor-toggle-music').addEventListener('click', () => cutSelectedClipAtPlayheadUI());
  // 自动划分 ▸（节奏划分轨三来源，§2.2.1 ①）：落标=批量写 timeline.tags，恰一条历史
  const dd = $('auto-seg-dd'), menu = dd.querySelector('.dd-menu');
  const toggleSegMenu = () => {
    // 单弹窗不变式（F2）：开本下拉前先关已开的段/剪辑菜单与标记编辑器
    if (menu.hidden) { closeContextMenu(); musicTl?.closeTagPopover(); }
    menu.hidden = !menu.hidden;
    // D3（build-44）：工具条 overflow-x:auto 会把 absolute 下拉裁进 40px 条内——改按按钮
    // 视口坐标 fixed 摆位（先解除 hidden 再量宽），横向钳在视口内；他处下拉不走此链路
    if (!menu.hidden) {
      const r = $('btn-auto-segments').getBoundingClientRect();
      menu.style.right = 'auto';
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.left = Math.max(8, Math.min(r.left, (window.innerWidth || 0) - menu.offsetWidth - 8)) + 'px';
    }
  };
  $('btn-auto-segments').addEventListener('click', e => { e.stopPropagation(); toggleSegMenu(); });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('seg-auto-even').addEventListener('click', () => autoSegmentsEven());
  $('seg-auto-bars').addEventListener('click', () => autoSegmentsBars());
  $('seg-auto-import').addEventListener('click', () => autoSegmentsTable());
}
// 磁吸开关钮呈示同步（M5）：键盘 S 与按钮两路入口同态；render 兜底刷新。
// build-91-varispeed：剃刀改单发（无 toggle 态可同步），本函数只管磁吸。
function syncMusicToggles() {
  const snap = $('tl-snap-toggle-music');
  if (snap) snap.classList.toggle('toggled-on', !!musicTl?.snapOn);
}
// build-91-varispeed（需求 2，对齐 Adobe Audition 单发剪切）：剃刀动作唯一执行面——剃刀钮 /
// Ctrl/Cmd+K / R 三入口共用：以当前播放线剪切当前选中音频 clip。契约 {ok,reason}：
// ok=true →「已在播放线处剪切」；ok=false → 透出面向用户的 reason（无选中/落点非法等）。
function cutSelectedClipAtPlayheadUI() {
  const r = musicTl?.cutSelectedClipAtPlayhead?.();
  if (r) toast(r.ok ? '已在播放线处剪切' : r.reason);
}
// 划分域（M1 D4）：music 模式=音乐域换算拍（自动划分/末段覆盖到音频末——blocks 短于音频时
// 后半也能划分）；stage=blocks 域 totalBeats（现状口径，零变化）。搭 sectionSegmentsOf 的
// endBeatOverride 参数（缺省=现状）。
function sectionEndBeatOf(p) {
  if (musicTl?.mode === 'music') return Math.max(1, M.secToBeat(p, M.musicDomainSec(p)));
  return M.segmentsFromClips(p.formations).totalBeats;
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
// ---- 区域菜单（build-49 区域模型）----
// 菜单一致性（F2/F3 裁定）：轨道长按/右键菜单与索引行「…」菜单共用同一渲染函数 segMenuItems——
// 单弹窗不变式沿用（showContextMenu 开新关旧）。菜单项=「编辑内容 / 换色 / 升一级 / 降一级 /
// 删除标记(danger)」；build-49 去掉「于此拆分/与下一段合并」（区域模型下无意义，模型函数一并退役）。
// F4：升降级界限随显式层数 tagLevelCount（顶层 0 无升、count-1 无降）。
function segMenuItems(tagId) {
  const p = store.getState().project;
  const t = p ? M.tagById(p, tagId) : null;
  if (!t) return [];
  const lv = M.tagLevelOf(t);
  const maxLv = M.tagLevelCountOf(p) - 1;
  const swatches = h('div', { class: 'ctx-swatches' },
    ...MusicTimeline.SEG_COLORS.map((c, ci) => h('button', {
      class: 'ctx-sw', style: `background:${c}`, title: '标记颜色',
      onclick: () => { closeContextMenu(); musicTl.setSegColor(tagId, ci); },
    })));
  return [
    { label: '编辑内容', fn: () => musicTl.openTagEditor(tagId) },
    { el: swatches },
    ...(lv > 0 ? [{ label: '升一级', fn: () => musicTl.bumpSegLevel(tagId, -1) }] : []),
    ...(lv < maxLv ? [{ label: '降一级', fn: () => musicTl.bumpSegLevel(tagId, +1) }] : []),
    ...(lv > 0 || lv < maxLv ? [{ sep: true }] : []),
    { label: '删除标记', danger: true, fn: () => musicTl.deleteSeg(tagId) },
  ];
}
function showSegMenu({ tagId, screenX, screenY }) {
  if (!tagId) {
    showContextMenu([{ label: '空白区域（双击/长按可新建标记）', fn: () => {} }], { x: screenX, y: screenY });
    return;
  }
  const items = segMenuItems(tagId);
  if (items.length) showContextMenu(items, { x: screenX, y: screenY });
}
// ---- 队形 mini-preview 栏（W1 C15）：只读画布随播放头同步 + 块 ±1 拍步进 + 对齐到播放头 ----
// build-46-layout：预览段折叠改由合并侧边栏段头箭头承担（wuzhen:rsbPreview；applySegFold），
// 旧 wuzhen:mpCollapsed / #mp-collapse 折叠钮退役；#music-preview id 与子件 id 全部保留。
let mpRefs = null;
function wireMusicPreview() {
  if (mpRefs) return;
  $('mp-hold-minus').addEventListener('click', () => stepBlockSec('holdBeats', -0.1));
  $('mp-hold-plus').addEventListener('click', () => stepBlockSec('holdBeats', 0.1));
  $('mp-travel-minus').addEventListener('click', () => stepBlockSec('travelBeats', -0.1));
  $('mp-travel-plus').addEventListener('click', () => stepBlockSec('travelBeats', 0.1));
  $('mp-align').addEventListener('click', () => alignCurrentToPlayhead());
  mpRefs = { root: $('music-preview'), cv: $('mp-canvas'), name: $('mp-name'), hold: $('mp-hold'), travel: $('mp-travel') };
}
// preview 绘制（复用 drawScene minimal，同 formation-index 缩略图管线；只读，无新渲染管线）。
// 调用点：render()（编辑态兜底）与 player.onTick（播放中 formationIndex/播放头推进同步，IR-W1-5）。
function drawMusicPreview() {
  if (!mpRefs || mpRefs.root.offsetParent === null) return; // 非音乐模式（display:none）不画
  if (segFolded('rsb-preview-seg')) return; // 预览段折叠不绘（展开时 applySegFold 补绘）
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
  // build-70 M3 换源：保持读数=选中 clip 长度（lenBeats）；过渡读数=与下一 clip 的空隙
  //（自动适应，可为 0=瞬时切换；末 clip 无变换呈 0 并禁用 ±）。
  const segsMp = p ? M.segmentsFromClips(p.formations).segments : [];
  const mpSeg = segsMp[s.formationIndex];
  const mpNext = segsMp[s.formationIndex + 1];
  if (mpSeg && f) {
    const spbv = M.spb(p);
    // build-78-recorder（时间唯一标准）：读数去拍值——秒单显（旧「N拍·Ss」双段 span 退役，
    // .mp-s span 不再产出；css 收纳规则对不存在的节点无害，layout-merge 静态断言不动）。
    const fmtS = v => `${(v * spbv).toFixed(1).replace(/\.0$/, '')}s`;
    const setVal = (el, v) => {
      const t = fmtS(v);
      if (el._t !== t) { el._t = t; el.textContent = t; }
    };
    const lenBeats = mpSeg.end - mpSeg.start;
    const gapBeats = mpNext ? Math.max(0, mpNext.start - mpSeg.end) : 0;
    setVal(mpRefs.hold, lenBeats);
    setVal(mpRefs.travel, gapBeats);
    const isLast = !mpNext;
    $('mp-travel-minus').disabled = isLast || gapBeats <= 0;
    $('mp-travel-plus').disabled = isLast;
    $('mp-hold-minus').disabled = lenBeats <= M.FORM_CLIP_LEN_MIN;
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
  // F4（build-48-tagui）：签名含 tag 显式层数与各层 tag 数——加/删层、层内建删标记后轨头
  // 层区（corner2 行）跟随重建；含几何（laneH / 模式呈示态）同既有口径
  const tlc = M.tagLevelCountOf(p);
  const lvCounts = Array.from({ length: tlc }, (_, li) => (p?.timeline?.tags || []).filter(t => M.tagLevelOf(t) === li).length);
  // M2：签名含几何（laneH / 模式呈示态）——resize/切模式后行高跟随重建，无需任何数据变更
  // （E58-14/F2b「数据签名不含几何 → resize 后永不重建 → 逐行漂移」根因消除）
  // build-79-laneh（E 轨头对齐点）：签名纳入逐轨 laneH——轨级拖高落盘（track.laneH 写入）后
  // 签名变化使轨头重建，行高与 lane 逐行重新对齐。
  return JSON.stringify(ts) + '|' + clipTracks.join(',') + '|' + trackLaneH() + '|' + (musicTl ? musicTl.expanded : true)
    + '|tlc:' + tlc + '|tgc:' + lvCounts.join(',')
    + '|lh:' + ts.map(t => Number(t.laneH) || 0).join(',');
}
function trackLaneH() { return musicTl ? musicTl.audioLaneH() : 72; }
function syncTracksHead(p) {
  const box = $('tl-tracks-head');
  if (!box) return;
  // build-89：不再因 box.hidden 跳过建卡——hidden 只是显隐呈现（timeline 按模式翻转），
  // 旧早退会让「切模式首帧 hidden 尚未翻转」时卡片缺失直到下一次渲染（窄屏实测）。
  // 建卡本身廉价（行数=轨数，sig 门控去重），恒建。
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
  // M2 container 化结构：角格行（对齐画布尺规 22px）+ tag 层区（对齐画布划分轨 28×N px，F4）
  // + 轨行×N（高=laneH，与 lane 逐行同高按构造成立）+ 加轨条 26px（紧贴末行，与画布 ops 带同位）
  box.append(h('div', { class: 'tlh-corner' }, '音轨'));
  // F4（build-48-tagui）：tag 层区（corner2）=显式 tagLevelCount 行 × 28px，与画布划分轨逐行对齐：
  // 每行 `层N·tag数` + 删层钮（该层有 tag / 仅剩一层 → aria-disabled+点击 toast 说明）；
  // 「＋ 加层」钮置于末行（上限 3，到限呈禁用态）——全部收在 corner2 区内，音频行 1:1 对齐不变式不破。
  const tlc = M.tagLevelCountOf(p);
  const tagsAll = p?.timeline?.tags || [];
  const c2 = h('div', { class: 'tlh-corner2', style: `height:${SEG_LANE_H_MUSIC * tlc}px` });
  for (let li = 0; li < tlc; li++) {
    const cnt = tagsAll.filter(t => M.tagLevelOf(t) === li).length;
    const last = li === tlc - 1;
    const full = tlc >= M.TAG_LEVEL_COUNT_MAX;
    let addBtn = null;
    if (last) {
      addBtn = h('button', {
        class: 'btn tlh-lvl-add', 'aria-label': full ? `划分轨已满（最多 ${M.TAG_LEVEL_COUNT_MAX} 层）` : '加一层划分轨',
        'aria-disabled': String(full),
        title: full ? `划分轨最多 ${M.TAG_LEVEL_COUNT_MAX} 层` : '加一层划分轨（最多 3 层；空层可直接双击落段起点）',
      }, '＋层');
      addBtn.addEventListener('click', () => addTagLayerFlow());
    }
    const del = h('button', {
      class: 'btn tlh-lvl-del', 'aria-label': `删除划分层 第${li + 1}层`,
      'aria-disabled': String(tlc <= 1 || !!cnt),
      title: tlc <= 1 ? '仅剩一层划分轨，不可删除'
        : cnt ? `第 ${li + 1} 层仍有 ${cnt} 个标记——先删除或移动到其他层，再删层`
        : `删除空层「第 ${li + 1} 层」（更深层号依次上移）`,
    }, '✕');
    del.addEventListener('click', () => removeTagLayerFlow(li));
    c2.append(h('div', { class: 'tlh-lvl' },
      h('span', { class: 'tlh-lvl-name', title: `第 ${li + 1} 层划分轨 · ${cnt} 个标记` }, `层${li + 1}·${cnt}`),
      ...(last ? [addBtn] : []),
      del));
  }
  box.append(c2);
  const ts = p?.timeline?.tracks || [];
  const expanded = musicTl ? musicTl.expanded : true;
  const laneHFallback = trackLaneH(); // 缺省回退：musicTl 缺席（早期 boot/桩环境）时的统一推导值
  const usedOf = tid => M.clipsOf(p).filter(c => (c.trackId || M.DEFAULT_TRACK_ID) === tid).length;
  for (let ti = 0; ti < ts.length; ti++) {
    const t = ts[ti];
    // build-79-tlui（E 轨头对齐点）：行高逐行读 musicTl.trackLaneHPx（拖动预览 > track.laneH >
    // 推导值回退）——轨级拖高后轨头行与 lane 逐行同高按构造成立；musicTl 缺席回退统一推导值。
    const laneH = musicTl ? musicTl.trackLaneHPx(p, ti) : laneHFallback;
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
  // F2（build-46-layout）：轨头侧边栏化——右缘拖宽 grip + 收起钮（innerHTML 清空后重挂，幂等）
  wireTracksHeadChrome(box);
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
// ---- 划分轨显式层管理（build-48-tagui F4，轨头 tag 层区入口）----
// 加层/删层=显式 tagLevelCount 变更（恰一条历史，可撤销）；守卫先行（有 tag 的层/仅剩一层/
// 到上限 → toast 说明、零写入零历史，同 removeTrackFlow 口径）。轨头层区随签名变化自动重建。
function addTagLayerFlow() {
  const p = store.getState().project;
  if (!p) return;
  if (M.tagLevelCountOf(p) >= M.TAG_LEVEL_COUNT_MAX) { toast(`划分轨最多 ${M.TAG_LEVEL_COUNT_MAX} 层`); return; }
  store.mutate(pr => { M.addTagLayer(pr); }, '加划分层');
  toast(`已加一层划分轨（共 ${M.tagLevelCountOf(store.getState().project)} 层）——空层可直接双击落段起点`);
}
function removeTagLayerFlow(level) {
  const p = store.getState().project;
  if (!p) return;
  if (M.tagLevelCountOf(p) <= 1) { toast('仅剩一层划分轨，不可删除'); return; }
  const cnt = (p.timeline.tags || []).filter(t => M.tagLevelOf(t) === level).length;
  if (cnt) { toast(`第 ${level + 1} 层仍有 ${cnt} 个标记——先删除或移动到其他层，再删层`); return; }
  store.mutate(pr => { M.removeTagLayer(pr, level); }, '删划分层');
  toast(`已删除空层「第 ${level + 1} 层」`);
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
  const wasPlaying = !!player.playing;
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
    const { totalBeats } = M.segmentsFromClips(p.formations);
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

// ---- v3 媒体库（规格 §3）——build-43-accept 起呈示面=音乐模式专属可收起侧边栏 ----
// 弹窗退役（用户裁定）：showMediaLibraryModal 的 .modal-back（fixed inset:0 z-index:100）
// 盖满视口、吞掉 #tl-scroll 的 drop，是「拖资产到时间轴不生成 clip」（GOLD-DEFECT-1）的
// 深层根因。结构性解法=#media-sidebar 与多轨 lane 区 flex 并排（非覆盖非浮层），生产代码
// 不再构造任何弹窗 DOM/遮罩——遮罩吞 drop 按构造不复存在。ui.js showMediaLibraryModal 与
// wireAudioPanel 的 'wuzhen:tl-asset-drop' 遮罩转发监听保留为兜底（防御性：防未来入口复现
// 覆盖层形态时拖拽链失达；tests/mlib-drop-forward.test.js 钉弹窗机械面）。侧边栏是主路径。
// 行为：资产行拖到音轨=落点生成 clip（dragstart 写 text/x-wuzhen-asset，既有管线）；
// 行内「＋ 添加」=点击快速放置到第一轨末尾（零拖拽精度依赖，addAssetAtTrackEnd）。
function mediaSidebarActs() {
  return {
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
    addToTimeline: id => addAssetAtTrackEnd(id), // 点击快速添加（与拖拽并存，用户自选）
  };
}
// 内容随资产态重建（签名门控，同 buildGroupsPanel 模式）：列表/激活配乐/数据缺失态任一变化
// 才重建 DOM；收起/折叠期间不重建（展开时强制刷新一次），store render 每帧调用成本趋零。
let msbSig = null;
function syncMediaSidebar(p) {
  const body = $('msb-body');
  if (!body || !mediaSidebarOpen()) return;
  const assets = p?.media?.assets || [];
  const sig = JSON.stringify(assets) + '|' + (p?.media?.activeAssetId || '')
    + '|' + assets.map(a => (audio?.assets.get(a.id)?.blob ? 1 : 0)).join(',');
  if (sig === msbSig) return;
  msbSig = sig;
  renderMediaLibraryContent(body, { getProject: () => store.getState().project, acts: mediaSidebarActs() });
}
// ---- 右侧合并侧边栏（build-46-layout）：预览段（上）+ 媒体库段（下）----
// 旧 #music-preview 折叠钮（wuzhen:mpCollapsed）与 #media-sidebar 独立开合（wuzhen:mediaSidebar）
// 退役，统一为四枚记忆键（全部 wuzhen: 前缀；仅显式 toggle 落盘，boot 读偏好不回写——
// run-ir06 A9/B9 键白名单纪律）：
//   wuzhen:rsbClosed   整栏收起（桌面 16px 细条 / 移动 88px 迷你预览条）
//   wuzhen:rsbW        整栏宽度（180–480px=max(480,容器40%)，桌面拖宽 grip）
//   wuzhen:rsbPreview  预览段折叠   wuzhen:rsbLib  媒体库段折叠
function mediaSidebarOpen() {
  const sb = document.getElementById('right-sidebar');
  const lib = document.getElementById('rsb-lib-seg');
  return !!sb && !sb.classList.contains('rsb-closed') && !!lib && !lib.classList.contains('rsb-folded');
}
const RSB_KEY = {
  closed: 'wuzhen:rsbClosed', w: 'wuzhen:rsbW',
  foldPrev: 'wuzhen:rsbPreview', foldLib: 'wuzhen:rsbLib',
};
const TRK_KEY = { closed: 'wuzhen:trkHeadClosed', w: 'wuzhen:trkHeadW' };
const isMobileLayout = () => !!window.matchMedia?.('(max-width: 1023.5px)').matches;
const rsbEl = () => document.getElementById('right-sidebar');
function rsbClosed() { return !!rsbEl()?.classList.contains('rsb-closed'); }
function segFolded(id) { return !!document.getElementById(id)?.classList.contains('rsb-folded'); }
const lsRef = () => (typeof localStorage !== 'undefined' ? localStorage : null);

function updateMediaLibBtn() {
  const btn = $('mtb-media-library');
  if (!btn) return;
  const open = !rsbClosed();
  btn.classList.toggle('toggled-on', open);
  btn.setAttribute('aria-pressed', String(open));
  btn.title = open ? '收起右侧边栏（记忆）' : '打开媒体库侧边栏（拖资产到音轨落点生成剪辑；或行尾「…」菜单添加到第一轨）';
}
// 整栏开合呈示：桌面=16px 细条退场/回归（lane 区 flex 自动回占/让位）；移动=88px 迷你预览条
// ⇄ 50vh 抽屉（.rsb-open 仅移动端有样式语义）。
function applyRsbClosed(closed, { persist = false } = {}) {
  const sb = rsbEl();
  if (!sb) return;
  sb.classList.toggle('rsb-closed', !!closed);
  sb.classList.toggle('rsb-open', !closed && isMobileLayout());
  const cb = $('rsb-collapse');
  if (cb) {
    cb.textContent = closed ? '«' : '»';
    cb.setAttribute('aria-expanded', String(!closed));
    cb.title = closed ? '展开侧边栏（预览 + 媒体库；记忆）' : '收起侧边栏（记忆）';
  }
  if (persist) { try { localStorage.setItem(RSB_KEY.closed, closed ? '1' : '0'); } catch {} }
  updateMediaLibBtn();
}
// 段折叠呈示 + 余量再分配（F1「一侧收起时另一侧吃余量」）：两段全开=预览自然高、媒体库吃余量；
// 任一折叠=展开侧吃余量；媒体库段展开即刷新内容（折叠期间 syncMediaSidebar 跳更），
// 预览段展开即补绘（折叠期间 drawMusicPreview 跳绘，防陈旧首帧）。
function updateRsbGrow() {
  const prev = document.getElementById('rsb-preview-seg'), lib = document.getElementById('rsb-lib-seg');
  if (!prev || !lib) return;
  const prevFolded = prev.classList.contains('rsb-folded');
  const libFolded = lib.classList.contains('rsb-folded');
  lib.classList.toggle('rsb-grow', !libFolded);
  prev.classList.toggle('rsb-grow', !prevFolded && libFolded);
}
function applySegFold(segId, folded, { persist = false, key = '' } = {}) {
  const seg = document.getElementById(segId);
  if (!seg) return;
  seg.classList.toggle('rsb-folded', !!folded);
  const btn = seg.querySelector('.rsb-seg-toggle');
  if (btn) {
    btn.textContent = folded ? '▸' : '▾';
    btn.setAttribute('aria-expanded', String(!folded));
    btn.title = folded ? '展开本段（记忆）' : '折叠本段（另一侧吃余量；记忆）';
  }
  if (persist && key) { try { localStorage.setItem(key, folded ? '1' : '0'); } catch {} }
  updateRsbGrow();
  if (segId === 'rsb-lib-seg' && !folded) { msbSig = null; syncMediaSidebar(store.getState().project); }
  if (segId === 'rsb-preview-seg' && !folded) drawMusicPreview();
}
// 桌面拖宽：宽度写入内联 style（flex 让位实时生效），钳制走 timeline.clampSidebarWidth 纯函数；
// 移动端抽屉全宽，宽度记忆不适用（内联宽度不写）。
function applyRsbWidth(w, { persist = false } = {}) {
  const sb = rsbEl();
  if (!sb || isMobileLayout()) return;
  const cont = document.getElementById('timeline-area')?.clientWidth || window.innerWidth || 960;
  const cw = clampSidebarWidth(w, cont);
  sb.style.width = cw + 'px';
  if (persist) { try { localStorage.setItem(RSB_KEY.w, String(Math.round(cw))); } catch {} }
}
function toggleMediaSidebar() { applyRsbClosed(!rsbClosed(), { persist: true }); }
// 左侧轨头列（F2）：收起（16px 细条，headWidth() 读数链路自动吃余量）+ 桌面拖宽（96–240）。
// 编舞模式轨头本就 hidden，收起/宽度仅音乐模式作用域（E-12）。
function trkHeadClosed() { return !!document.getElementById('tl-tracks-head')?.classList.contains('tlh-collapsed'); }
function applyTrkHeadCollapsed(collapsed, { persist = false, render = true } = {}) {
  const th = document.getElementById('tl-tracks-head');
  if (!th) return;
  th.classList.toggle('tlh-collapsed', !!collapsed);
  // 收起态/移动端清内联宽：CSS 缺省宽（148/96）或 .tlh-collapsed 16px 接管——offsetWidth 恒
  // 反映真实列宽，laneVisibleW/zoomAt/zoomCenter 锚定公式自动成立。
  if (!collapsed && !isMobileLayout()) {
    const saved = parseInt(localStorage.getItem(TRK_KEY.w) || '', 10);
    if (Number.isFinite(saved) && saved > 0) th.style.width = clampHeadWidth(saved) + 'px';
    else th.style.width = '';
  } else {
    th.style.width = '';
  }
  const btn = $('tlh-collapse');
  if (btn) {
    btn.textContent = collapsed ? '»' : '«';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开轨头列（记忆）' : '收起轨头列（记忆）';
  }
  if (persist) { try { localStorage.setItem(TRK_KEY.closed, collapsed ? '1' : '0'); } catch {} }
  if (render) musicTl?.render(); // 列宽变化 → lane 几何重采样
}
// 轨头 chrome（右缘拖宽 grip + 收起钮）：buildTracksHead 每次重建 innerHTML 清空后重挂
// （幂等，监听随元素重建重绑），故由 buildTracksHead 末尾调用。
function wireTracksHeadChrome(box) {
  const grip = h('div', { id: 'tlh-grip', title: '拖拽调整轨头宽度（96–240px，记忆）' });
  const btn = h('button', { id: 'tlh-collapse', 'aria-label': '收起/展开轨头列' });
  box.append(grip, btn);
  // 收起态整条细条任意点击=重开（验收反馈「收起后找不到打开通道」；不依赖收起钮小命中区）。
  // box 是持久元素（innerHTML 重建不换壳），dataset 旗防 rebuild 重复绑定。
  if (!box.dataset.tlhStripBound) {
    box.dataset.tlhStripBound = '1';
    box.addEventListener('click', e => {
      if (!box.classList.contains('tlh-collapsed')) return;
      if (e.target.closest('button,input,select')) return; // 收起钮自身走自己的 toggle，不双跳
      applyTrkHeadCollapsed(false, { persist: true });
    });
  }
  applyTrkHeadCollapsed(trkHeadClosed(), { render: false }); // 重建后同步钮呈示/内联宽（不触发渲染）
  let drag = null;
  grip.addEventListener('pointerdown', e => {
    if (isMobileLayout() || trkHeadClosed()) return;
    drag = { x0: e.clientX, w0: box.getBoundingClientRect().width, id: e.pointerId };
    try { grip.setPointerCapture(e.pointerId); } catch { drag = null; }
    e.preventDefault();
  });
  grip.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    box.style.width = clampHeadWidth(drag.w0 + (e.clientX - drag.x0)) + 'px'; // 左缘列：右拖=加宽
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    try { grip.releasePointerCapture(drag.id); } catch {}
    const w = clampHeadWidth(box.getBoundingClientRect().width);
    box.style.width = w + 'px';
    try { localStorage.setItem(TRK_KEY.w, String(Math.round(w))); } catch {}
    drag = null;
    musicTl?.render();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', () => { drag = null; });
  btn.addEventListener('click', () => applyTrkHeadCollapsed(!trkHeadClosed(), { persist: true }));
}
// 合并栏拖宽（桌面）：左缘 grip，Pointer Events + setPointerCapture（禁 mousemove 混用）；
// 拖拽中 #music-strip flex 自然让位（#tl-scroll 的 ResizeObserver 实时重采样），松手落盘并
// 兜底 render + preview 重绘。
function wireRsbResize() {
  const sb = rsbEl(), grip = $('rsb-grip');
  if (!sb || !grip) return;
  let drag = null;
  grip.addEventListener('pointerdown', e => {
    if (isMobileLayout() || rsbClosed()) return;
    drag = { x0: e.clientX, w0: sb.getBoundingClientRect().width, id: e.pointerId };
    try { grip.setPointerCapture(e.pointerId); } catch { drag = null; }
    e.preventDefault();
  });
  grip.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    applyRsbWidth(drag.w0 + (drag.x0 - e.clientX)); // 右缘栏：指针左移=加宽
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    try { grip.releasePointerCapture(drag.id); } catch {}
    applyRsbWidth(sb.getBoundingClientRect().width, { persist: true });
    drag = null;
    musicTl?.render();
    drawMusicPreview();
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', () => { drag = null; });
}
// 移动抽屉手势：下滑收起（阈值 32px；按钮/输入/画布不参与）。上滑呼出与轻点收起条呼出
// 随 88px 迷你条退役（build-46 验收反馈二：完全收起=零占位，无收起条表面）——重开唯一
// 通道=工具条「媒体库」钮（与桌面一致）。
function wireRsbSwipe() {
  const sb = rsbEl();
  if (!sb) return;
  let y0 = null, pid = null, swiped = false;
  sb.addEventListener('pointerdown', e => {
    swiped = false;
    if (!isMobileLayout() || e.target.closest('button,input,select,canvas')) { y0 = null; return; }
    y0 = e.clientY; pid = e.pointerId;
  });
  sb.addEventListener('pointerup', e => {
    if (y0 == null || e.pointerId !== pid) return;
    const dy = e.clientY - y0; y0 = null;
    if (Math.abs(dy) < 32) return;
    swiped = true; // 已消费的滑动：随后 click 不再呼出（防「滑收又点开」双跳）
    if (dy < 0 && rsbClosed()) applyRsbClosed(false, { persist: true });
    else if (dy > 0 && !rsbClosed()) applyRsbClosed(true, { persist: true });
  });
  sb.addEventListener('pointercancel', () => { y0 = null; });
}
function wireRightSidebar() {
  $('rsb-collapse')?.addEventListener('click', () => applyRsbClosed(!rsbClosed(), { persist: true }));
  $('rsb-preview-toggle')?.addEventListener('click', () =>
    applySegFold('rsb-preview-seg', !segFolded('rsb-preview-seg'), { persist: true, key: RSB_KEY.foldPrev }));
  $('rsb-lib-toggle')?.addEventListener('click', () =>
    applySegFold('rsb-lib-seg', !segFolded('rsb-lib-seg'), { persist: true, key: RSB_KEY.foldLib }));
  // build-56-indextab F2：段头 tab 条 [媒体库|索引]——按 data-pane 委托接线（round2 修复：
  // 原按按钮 id 取钮，HTML 未带 id → 两钮监听全空装、点「媒体库」切不回去；委托后钮面增删不挂）。
  // 索引 pane 激活即补挂载+渲染（非激活期跳更的补偿）
  document.querySelectorAll('#rsb-lib-seg .rtab').forEach(b => b.addEventListener('click', () => {
    activateRsbPane(b.dataset.pane);
    if (b.dataset.pane === 'index') { siMount('music'); renderSegIndexPanel(); siTick(); }
  }));
  wireRsbResize();
  wireRsbSwipe();
  // boot 偏好（不回写）：整栏开合按形态缺省（移动端收成迷你条）；窄桌面（<1280）媒体库段
  // 缺省折叠（F1 自适应）；桌面按记忆恢复宽度。跨断点（旋转/缩放跨 1023.5）即重套形态。
  applyRsbClosed(resolveRsbClosed(lsRef(), isMobileLayout()));
  const narrow = (typeof window !== 'undefined' && (window.innerWidth || 1280) < 1280);
  applySegFold('rsb-preview-seg', resolveSegFold(lsRef(), RSB_KEY.foldPrev, false));
  applySegFold('rsb-lib-seg', resolveSegFold(lsRef(), RSB_KEY.foldLib, narrow));
  const savedW = parseInt(localStorage.getItem(RSB_KEY.w) || '', 10);
  if (Number.isFinite(savedW) && savedW > 0) applyRsbWidth(savedW);
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(max-width: 1023.5px)');
    mq.addEventListener?.('change', () => {
      applyRsbClosed(rsbClosed()); // 重套形态类（rsb-open 仅移动端）
      applyTrkHeadCollapsed(trkHeadClosed()); // 移动端清轨头内联宽（96px CSS 接管）
    });
  }
}
// ---- build-51-stageux F3：编舞模式三侧折叠（左队形列表列 / 右属性列 / 底部时间轴区） ----
// 细条形态：列收成 38px 竖排字细条（队形/属性）、底部收成 28px「时间轴」细条（舞台 canvas
// 吃满余高——#stage-wrap 的 ResizeObserver 重绘链自动生效）。折叠态只存在于 stage 模式：
// CSS 规则全部 [data-uimode="stage"] 作用域——切音乐模式后音乐布局恒按自身状态呈现（音乐
// #right-sidebar / #bottom-area 不受 stage 折叠记忆影响），记忆键保留、切回编舞即恢复。
// 记忆键沿用 wuzhen: 前缀纪律；boot 读偏好不回写，仅显式 toggle 落盘。
const STAGEUX_KEY = { left: 'wuzhen:stageLeft', right: 'wuzhen:stageRight', bottom: 'wuzhen:stageBottom' };
function stageLeftCollapsed() { return !!document.getElementById('left-panel')?.classList.contains('lp-collapsed'); }
function stageRightCollapsed() { return !!document.getElementById('right-panel')?.classList.contains('rp-collapsed'); }
function stageBottomCollapsed() { return !!document.getElementById('bottom-area')?.classList.contains('ba-collapsed'); }
// 左列（队形列表）折叠：lp-collapsed ⇄ 细条（#lp-strip 竖排「队形」）；列表列是舞台画布的
// flex 兄弟列，收/展由 flex 自然回占/让位（requestDraw 即时补绘，ResizeObserver 兜底）。
function applyStageLeftCollapsed(collapsed, { persist = false } = {}) {
  const lp = document.getElementById('left-panel');
  if (!lp) return;
  lp.classList.toggle('lp-collapsed', !!collapsed);
  const btn = document.getElementById('lp-collapse');
  if (btn) {
    btn.textContent = collapsed ? '»' : '«';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开队形列表（记忆）' : '收起队形列表（记忆）';
  }
  if (persist) { try { localStorage.setItem(STAGEUX_KEY.left, collapsed ? '1' : '0'); } catch {} }
  applyStagePaneSizes(); // build-91-varispeed F2：折叠⇄展开时内联宽清场/回套（展开态宽度记忆）
  stageView?.requestDraw();
}
// 右列（props 页签列，build-56 起含「索引」页签）折叠：rp-collapsed ⇄ 细条（#rp-strip 竖排「属性」）
function applyStageRightCollapsed(collapsed, { persist = false } = {}) {
  const rp = document.getElementById('right-panel');
  if (!rp) return;
  rp.classList.toggle('rp-collapsed', !!collapsed);
  const btn = document.getElementById('rp-collapse');
  if (btn) {
    btn.textContent = collapsed ? '«' : '»';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开属性列（记忆）' : '收起属性列（记忆）';
  }
  if (persist) { try { localStorage.setItem(STAGEUX_KEY.right, collapsed ? '1' : '0'); } catch {} }
  applyStagePaneSizes(); // build-91-varispeed F2：折叠⇄展开时内联宽清场/回套（展开态宽度记忆）
  stageView?.requestDraw();
}
// 底部（#bottom-area 整体）折叠：ba-collapsed（stage 作用域 display:none）+ #bottom-strip
// 细条（bs-on）——细条与折叠类同一函数成对切换，两模式互不串场由 CSS 属性作用域兜底。
function applyStageBottomCollapsed(collapsed, { persist = false } = {}) {
  const ba = document.getElementById('bottom-area');
  const strip = document.getElementById('bottom-strip');
  if (!ba) return;
  ba.classList.toggle('ba-collapsed', !!collapsed);
  strip?.classList.toggle('bs-on', !!collapsed);
  const btn = document.getElementById('bc-bottom-collapse');
  if (btn) {
    btn.textContent = collapsed ? '⌃' : '⌄';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展开底部时间轴区（记忆）' : '收起底部时间轴区（记忆）';
  }
  if (persist) { try { localStorage.setItem(STAGEUX_KEY.bottom, collapsed ? '1' : '0'); } catch {} }
  applyStagePaneSizes(); // build-91-varispeed F2：折叠⇄展开时内联高清场/回套（.ba-sized 门控同步）
  stageView?.requestDraw(); // 底部收起 → 舞台吃满余高（ResizeObserver 重绘链 + 即时补绘）
}
function wireStageux() {
  $('lp-collapse')?.addEventListener('click', () => applyStageLeftCollapsed(!stageLeftCollapsed(), { persist: true }));
  // 细条整条点击=重开（与轨头细条同纪律：不依赖收起钮小命中区）
  $('lp-strip')?.addEventListener('click', () => applyStageLeftCollapsed(false, { persist: true }));
  $('rp-collapse')?.addEventListener('click', () => applyStageRightCollapsed(!stageRightCollapsed(), { persist: true }));
  $('rp-strip')?.addEventListener('click', () => applyStageRightCollapsed(false, { persist: true }));
  $('bc-bottom-collapse')?.addEventListener('click', () => applyStageBottomCollapsed(!stageBottomCollapsed(), { persist: true }));
  $('bottom-strip')?.addEventListener('click', () => applyStageBottomCollapsed(false, { persist: true }));
  // F3 索引入口：stage 块时长条行尾「索引」钮（与音乐工具条 #mtb-seg-index 同组件同快捷键 ⌘⇧L）
  $('bc-seg-index')?.addEventListener('click', toggleSegIndexPanel);
  // boot 偏好（不回写）：左列/底部按记忆恢复；右列 build-56-indextab F1 起缺省折叠（无记忆=收成
  // 38px 细条，舞台缺省占更多视图；用户展开/再折叠后按记忆 wuzhen:stageRight）；CSS stage 作用域
  // 保证音乐模式启动不受影响
  applyStageLeftCollapsed(lsRef()?.getItem(STAGEUX_KEY.left) === '1');
  applyStageRightCollapsed(resolveStageRightCollapsed(lsRef()));
  applyStageBottomCollapsed(lsRef()?.getItem(STAGEUX_KEY.bottom) === '1');
  wireStageGrips(); // build-73-syncui F2：三区拖拽调宽/高（折叠态/移动端自动失效）
  applyStagePaneSizes();
  // 跨断点（旋转/缩放穿越 1023.5）：移动端垂直堆叠布局无 grip、不保内联宽高——清场防串味
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(max-width: 1023.5px)').addEventListener?.('change', () => applyStagePaneSizes());
  }
}

// ---- build-73-syncui F2：编舞三区拖拽调宽/高（左列宽/右列宽/底部高） ----
// 纯函数（node 可测）：钳制边界与记忆键集中此处；DOM 接线（Pointer Events+setPointerCapture）
// 在 wireStageGrips。与 build-56 缺省折叠键（STAGEUX_KEY.*）独立存储互不覆盖：折叠键记开/合，
// 尺寸键记展开态尺寸——折叠态宽度固定 38px 不随尺寸键走（applyStagePaneSizes 折叠早退）。
// 生效面：桌面 ≥1024 且编舞模式（CSS .stage-grip 显示门控同口径）；移动端垂直堆叠布局
// 不呈示 grip、内联宽高一概清场（跨断点 mq change 重套）。无记忆=完全既有布局（零变化）。
export const STAGE_PANE_LIMITS = { left: { min: 120, max: 400 }, right: { min: 200, max: 400 }, bottom: { min: 80, max: 320 } };
export const STAGE_PANE_KEYS = { left: 'wuzhen:stageLeftW', right: 'wuzhen:stageRightW', bottom: 'wuzhen:stageBottomH' };
// 尺寸钳制：非有限输入 → null（调用方按「无记忆」处理）；小数取整（style 写入整数 px）。
export function clampStagePaneSize(kind, px) {
  const lim = STAGE_PANE_LIMITS[kind];
  if (!lim) return null;
  const v = Math.round(Number(px));
  if (!Number.isFinite(v)) return null;
  return Math.max(lim.min, Math.min(lim.max, v));
}
// 记忆读取：空值/越界（历史脏数据）一律按「无记忆」处理——不静默钳到界内，保持缺省布局
//（与折叠键「读到 '1' 才折叠」同款保守纪律）。
function stagePaneMem(kind) {
  const raw = lsRef()?.getItem(STAGE_PANE_KEYS[kind]);
  if (!raw) return null;
  const v = clampStagePaneSize(kind, parseInt(raw, 10));
  return Number.isFinite(v) ? v : null;
}
// 把记忆尺寸套到 DOM（展开态才套；折叠态清内联值交还 CSS 38px 细条规则；音乐模式/移动端
// 一概清场）。底部自定义高走 .ba-sized 门控类：#timeline-area/#tl-scroll 放开 flex 吃余高
//（timeline.render 在 stage 模式写 #tl-scroll 行内高 112/114——flex 容器下只作 flex-basis
// 基数，grow/shrink 照常接管，渲染链零改动）。
function applyStagePaneSizes() {
  const desktop = typeof window !== 'undefined' && !window.matchMedia?.('(max-width: 1023.5px)')?.matches;
  const stage = document.getElementById('editor-view')?.dataset.uimode !== 'music';
  const active = desktop && stage;
  const lp = document.getElementById('left-panel');
  const rp = document.getElementById('right-panel');
  const ba = document.getElementById('bottom-area');
  if (!lp || !rp || !ba) return;
  const lw = active && !stageLeftCollapsed() ? stagePaneMem('left') : null;
  const rw = active && !stageRightCollapsed() ? stagePaneMem('right') : null;
  const bh = active && !stageBottomCollapsed() ? stagePaneMem('bottom') : null;
  lp.style.width = lw != null ? lw + 'px' : '';
  rp.style.width = rw != null ? rw + 'px' : '';
  ba.style.height = bh != null ? bh + 'px' : '';
  ba.classList.toggle('ba-sized', bh != null);
  stageView?.requestDraw(); // 尺寸变化 → 舞台画布让位/回占（ResizeObserver 兜底 + 即时补绘）
}
// 三区 grip 接线：内缘 7px 命中带（CSS .stage-grip，视觉触达热区 > 视觉线），拖中实时套尺寸
//（不落盘），pointerup 才写记忆键——中断（pointercancel）不落盘。双击 grip=清除记忆回缺省。
function wireStageGrips() {
  const wire = (id, kind, calc) => {
    const grip = document.getElementById(id);
    if (!grip) return;
    let drag = null; // {id, start, startSize}
    grip.addEventListener('pointerdown', e => {
      if (stageLeftCollapsed() && kind === 'left') return;
      if (stageRightCollapsed() && kind === 'right') return;
      if (stageBottomCollapsed() && kind === 'bottom') return;
      drag = { id: e.pointerId, start: calc.start(e), startSize: calc.size() };
      try { grip.setPointerCapture(e.pointerId); } catch { drag = null; return; }
      grip.classList.add('dragging');
      e.preventDefault();
    });
    grip.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const v = clampStagePaneSize(kind, calc.drag(drag, e));
      if (v != null) calc.apply(v);
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      try { grip.releasePointerCapture(drag.id); } catch {}
      grip.classList.remove('dragging');
      const v = clampStagePaneSize(kind, calc.drag(drag, e));
      if (v != null) { calc.apply(v); try { localStorage.setItem(STAGE_PANE_KEYS[kind], String(v)); } catch {} }
      drag = null;
      stageView?.requestDraw();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', () => { if (drag) { grip.classList.remove('dragging'); drag = null; } });
    // 双击=回缺省（清记忆 + 清内联值，交还 CSS 基线宽/内容高）
    grip.addEventListener('dblclick', () => {
      try { localStorage.removeItem(STAGE_PANE_KEYS[kind]); } catch {}
      applyStagePaneSizes();
    });
  };
  wire('lp-grip', 'left', {
    start: e => e.clientX,
    size: () => document.getElementById('left-panel')?.getBoundingClientRect().width || 0,
    drag: (d, e) => d.startSize + (e.clientX - d.start), // 左列内缘在右侧：右拖=加宽
    apply: v => { const lp = document.getElementById('left-panel'); if (lp) lp.style.width = v + 'px'; stageView?.requestDraw(); },
  });
  wire('rp-grip', 'right', {
    start: e => e.clientX,
    size: () => document.getElementById('right-panel')?.getBoundingClientRect().width || 0,
    drag: (d, e) => d.startSize - (e.clientX - d.start), // 右列内缘在左侧：左拖=加宽
    apply: v => { const rp = document.getElementById('right-panel'); if (rp) rp.style.width = v + 'px'; stageView?.requestDraw(); },
  });
  wire('ba-grip', 'bottom', {
    start: e => e.clientY,
    size: () => document.getElementById('bottom-area')?.getBoundingClientRect().height || 0,
    drag: (d, e) => d.startSize - (e.clientY - d.start), // 底区顶缘：上拖=加高
    apply: v => {
      const ba = document.getElementById('bottom-area');
      if (!ba) return;
      ba.style.height = v + 'px';
      ba.classList.add('ba-sized');
      stageView?.requestDraw();
    },
  });
}

// ---- build-51-stageux F4：时间轴底部导航滑块（视口概览条，两模式恒显） ----
// 用户需求：不论哪种模式，时间轴最下方加一个滑块方便拖动导航。拇指=当前可视窗口占全时域
// 比例（≥24px 下限），拖拇指=平移（Pointer Events+setPointerCapture，拖中实时 scrollLeft），
// 点条身空白=视口中心跳到该处；内容不溢出=拇指满宽禁用态（tlnav-off）。几何全部走模型纯函数
//（tlnavThumb / tlnavScrollForThumbPos / tlnavScrollForBarClick，node 可测）。
// 同步源（统一收口 syncTlNav 单入口）：#tl-scroll scroll 事件（滚轮/双指/按钮缩放/锚定缩放
// 的程序性 scrollLeft 写入均触发）+ MusicTimeline render 尾部 hooks.onAfterRender（mt.W 变化）。
// 原生细滚条保留不删——概览条是导航增强，不替代滚动能力；两模式同一组件零分叉。
function syncTlNav() {
  const nav = document.getElementById('tl-nav'), thumb = document.getElementById('tl-nav-thumb');
  const sc = document.getElementById('tl-scroll');
  if (!nav || !thumb || !sc) return;
  const g = M.tlnavThumb({ clientW: sc.clientWidth, scrollW: sc.scrollWidth, scrollLeft: sc.scrollLeft, barW: nav.clientWidth });
  nav.classList.toggle('tlnav-off', g.disabled);
  thumb.style.width = g.w + 'px';
  thumb.style.transform = `translateX(${g.x}px)`;
}
function wireTlNav() {
  const nav = document.getElementById('tl-nav'), thumb = document.getElementById('tl-nav-thumb');
  const sc = $('tl-scroll');
  if (!nav || !thumb || !sc) return;
  sc.addEventListener('scroll', syncTlNav, { passive: true });
  let drag = null; // {id, startLeft(按下时拇指左缘), startX, barW}
  const thumbLeftNow = () => (parseFloat(thumb.style.transform.replace(/[^0-9.\-]/g, '')) || 0);
  thumb.addEventListener('pointerdown', e => {
    if (nav.classList.contains('tlnav-off')) return;
    drag = { id: e.pointerId, startLeft: thumbLeftNow(), startX: e.clientX, barW: nav.getBoundingClientRect().width };
    try { thumb.setPointerCapture(e.pointerId); } catch { drag = null; }
    e.preventDefault();
  });
  thumb.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    sc.scrollLeft = M.tlnavScrollForThumbPos({
      thumbLeft: drag.startLeft + (e.clientX - drag.startX),
      thumbW: parseFloat(thumb.style.width) || 24, barW: drag.barW,
      clientW: sc.clientWidth, scrollW: sc.scrollWidth,
    }); // 拖中实时平移（程序性滚动触发 scroll 事件 → 拇指回写，闭环无抖动源）
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    try { thumb.releasePointerCapture(drag.id); } catch {}
    drag = null;
  };
  thumb.addEventListener('pointerup', end);
  thumb.addEventListener('pointercancel', () => { drag = null; });
  // 点条身空白（非拇指）=视口中心跳到该处（禁用态整条不响应）
  nav.addEventListener('pointerdown', e => {
    if (e.target === thumb || nav.classList.contains('tlnav-off')) return;
    const barR = nav.getBoundingClientRect();
    sc.scrollLeft = M.tlnavScrollForBarClick({
      clickX: e.clientX - barR.left, barW: barR.width,
      clientW: sc.clientWidth, scrollW: sc.scrollWidth, scrollLeft: sc.scrollLeft,
    });
  });
  syncTlNav(); // 首帧同步（此后 scroll/render 双源维持）
}

// 点击快速添加（build-43-accept；不依赖拖拽精度的可靠放置路径）：
// sec=第一轨（tracks[0]）最后 clip 终点（空轨=0，audio-clips.trackEndSec 纯函数）、
// 轨=第一轨；与拖拽通路共用 createClipFromDrop（建 clip/选中高亮一条消费链，勿重复造）。
async function addAssetAtTrackEnd(assetId) {
  const p = store.getState().project;
  if (!p) return false;
  const firstTrack = (p.timeline?.tracks || [])[0] || null;
  const trackId = firstTrack?.id || M.DEFAULT_TRACK_ID;
  const sec = trackEndSec(M.clipsOf(p), trackId);
  const before = M.clipsOf(p).length;
  await createClipFromDrop(assetId, sec, null, trackId);
  const ok = M.clipsOf(store.getState().project).length > before;
  if (ok) toast('已添加到第一轨末尾'); // 失败原因（编辑锁/资产缺失/解码失败）由 createClipFromDrop 内各自 toast
  return ok;
}
async function importMediaFiles(files) {
  const list = [...files].filter(f => !f.type || f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name));
  if (!list.length) { toast('未识别到音频文件'); return; }
  const wasPlaying = !!player.playing;
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
// 入口：#tl-scroll 直落（侧边栏资产行/桌面文件拖入——build-42 起的主路径）＋ 'wuzhen:tl-asset-drop'
// 遮罩转发兜底（见 wireAudioPanel）＋「＋ 添加」点击路径（直接传 sec/trackId）——换算只此一份。
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
  if (player.playing) player.pause();
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

// ---------- 说明书（顶栏「说明书」钮 → 全屏覆盖层；build-55-uiclean P2 起页签容器退役，同一 renderManual） ----------
// build-58-manual3 F2/F3：入口共两处——编辑器顶栏 #btn-manual-open（两模式恒显图标+文字）
// 与项目库首页 #btn-library-manual（显著 accent 大钮）；两钮共用 #manual-overlay，打开即回开场。
// 取舍（与 index.html 注释同源）：编舞右面板页签区 / 音乐模式 rsb 区不加说明书入口，避免重复。
function wireManual() {
  const body = $('manual-overlay-body');
  if (!body) return;
  body.append(renderManual({ build: BUILD_TAG }));
  const open = () => {
    $('manual-overlay').hidden = false;
    body.scrollTop = 0;
    markManualSeen(); // 首次访问高亮用后即清（无论从哪个入口打开）
  };
  $('btn-manual-open')?.addEventListener('click', open);
  $('btn-library-manual')?.addEventListener('click', open); // F2：首页显著入口
  $('btn-manual-close')?.addEventListener('click', () => { $('manual-overlay').hidden = true; });
  wireManualFirstRun();
}
// F2 一次性高亮：无 wuzhen:manualSeen 记忆 → 首页入口加脉冲提示；打开过说明书即记住不再提示
//（隐私模式 localStorage 不可用时 try/catch 兜底：每次都提示，行为同 wireOfflineNote 既有口径）
function wireManualFirstRun() {
  const btn = $('btn-library-manual');
  if (!btn) return;
  let first = true;
  try { first = localStorage.getItem('wuzhen:manualSeen') !== '1'; } catch {}
  btn.classList.toggle('first-run', first);
}
function markManualSeen() {
  try { localStorage.setItem('wuzhen:manualSeen', '1'); } catch {}
  $('btn-library-manual')?.classList.remove('first-run');
}

// ---------- 项目库 ----------
function wireLibrary() {
  // build-71-iomenu F2：换项目即清导入来源句柄——打开/新建的是另一项目时，旧句柄不再
  // 指向「当前内容的原文件」，残留会让保存覆盖写错文件（安全 > 便利）。
  $('btn-new-project').addEventListener('click', () => showNewProjectModal(opts => { clearIoSource(); store.createNewProject(opts); player.stop(); }));
  // build-72-checkupdate F1：项目库同款「检查更新」入口（编辑器顶栏入口在 wireTopbar，同走一个函数）
  $('btn-lib-check-update')?.addEventListener('click', () => { forceReloadToLatest(); });
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
    onOpen: p => store.openProject(p.id).then(ok => { if (ok) { clearIoSource(); player.stop(); restoreAudio(); } }), // clearIoSource：build-71-iomenu F2（换项目清旧句柄）
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
  // build-70 M3 换源：props 签名改读队形 clip 字段（startBeat/lenBeats；旧 blocks 时长签名退役）
  const durKey = s.project.formations.map(x => `${x.startBeat ?? 0}:${x.lenBeats ?? 16}`).join(',');
  // 场地签名入 key（build-61 验收修复）：场地预设/尺寸变更后预设高亮与米数输入框须刷新
  const st0 = s.project.stage;
  const key = `${s.project.formations.map(x => x.id).join(',')}|${s.formationIndex}|${s.selection.join(',')}|${durKey}|${f.combined !== false}|${M.labelModeOf(s.project)}|${st0.widthM}x${st0.depthM}@${st0.backstageM}:${st0.audience}:${st0.gridM}`;
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
      // build-70 M2 时间轴时长（clip 口径）：保持=选中 clip 长度（右缘动）；
      // 变换=与下一 clip 的空隙（min 0=瞬时切换；移动下一 clip 的 start，钳制不越下下个）。
      // build-78-recorder（时间唯一标准）：入读/输写一律秒（0.1s 步进）——模型层仍按拍存，
      // 秒⇄拍经 spb 就地换算（BPM 变化后换算自然生效，零迁移）；保持下限仍受模型
      // FORM_CLIP_LEN_MIN（1 拍）钳制，重渲染回显实际生效值。
      (() => {
        const segs = M.segmentsFromClips(s.project.formations).segments;
        const seg = segs[s.formationIndex];
        const next = segs[s.formationIndex + 1];
        const spbv = M.spb(s.project);
        const lenSec = seg ? (seg.end - seg.start) * spbv : 0;
        const gapSec = next ? Math.max(0, next.start - seg.end) * spbv : 0;
        const r1 = v => Math.round(v * 10) / 10; // 0.1s 口径呈示
        const setDur = (key, v) => {
          store.mutate(p => {
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            const beats = n / spbv; // 秒→拍（唯一换算点；setFormationClipLen/Gap 内钳制照旧）
            if (key === 'holdBeats') M.setFormationClipLen(p, s.formationIndex, beats);
            else M.setFormationGap(p, s.formationIndex, Math.max(0, beats));
          }, key === 'holdBeats' ? '调整保持时长' : '调整过渡时长');
          syncLoopAfterBlockEdit(); // 面板输数改时长后循环区间跟随（DEFECT-R26-4）
        };
        return h('div', { class: 'prop-group' },
          h('div', { class: 'pg-title' }, '时间轴时长（秒）'),
          h('div', { class: 'prop-row' }, h('label', {}, '保持到下一队形前'),
            h('input', { type: 'number', min: '0.1', max: '999', step: '0.1', value: r1(lenSec), title: '保持时长（秒）——此队形定格多久。±0.1s 调整的是队形时长，不是时间轴视图缩放（缩放用尺规 －/＋ 或滚轮）', onchange: e => setDur('holdBeats', e.target.value) })),
          next ? h('div', { class: 'prop-row' }, h('label', {}, '变换到下一队形'),
            h('input', { type: 'number', min: '0', max: '999', step: '0.1', value: r1(gapSec), title: '过渡时长（秒）——切换到下一队形花多久。±0.1s 调整的是队形时长，不是时间轴视图缩放（缩放用尺规 －/＋ 或滚轮）', onchange: e => setDur('travelBeats', e.target.value) }))
            : h('div', { class: 'dim' }, '最后一个队形，无过渡'),
          h('div', { class: 'dim' }, '变换时长=两段队形 clip 之间的空隙（自动适应拖动/缩放；0=瞬时切换）；与切帧预览的界面动画互不影响'));
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
    // build-61-stageaspect F2：场地预设快捷行（尺寸输入框上方）——点按套用宽深（applyStagePreset：
    // 一条「调整场地」历史 + 复位视口自动 fitView）；高亮 = stagePresetHit(当前宽深) 命中档
    // （精确宽深优先，同比档 8×6/16×12 不混亮；宽深比兜底；自由输入不命中全不亮）。
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '场地预设'),
      h('div', { class: 'prop-row', style: 'flex-wrap:wrap;justify-content:flex-start;gap:4px' },
        ...M.STAGE_PRESETS.map(p => h('button', {
          class: 'btn small stage-preset' + (M.stagePresetHit(st.widthM, st.depthM) === p.id ? ' active' : ''),
          title: `${p.label}（${p.widthM}×${p.depthM} 米）· ${p.kind}`,
          onclick: () => applyStagePreset(p),
        }, p.label))),
      h('div', { class: 'dim' }, '按场地类型一键套用宽深；也可在下方自由输入任意场地尺寸。')),
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '舞台尺寸（米）'),
      h('div', { class: 'prop-row' }, h('label', {}, '宽'), h('input', { type: 'number', min: '4', max: '50', step: '0.5', value: st.widthM, onchange: e => stageChange('widthM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '深'), h('input', { type: 'number', min: '4', max: '50', step: '0.5', value: st.depthM, onchange: e => stageChange('depthM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '后台区'), h('input', { type: 'number', min: '0', max: '10', step: '0.5', value: st.backstageM, onchange: e => stageChange('backstageM', e.target.value) })),
      // build-63-stageview2 F1：左右候场区宽（侧翼后台条带宽度，纯视觉标记不改位置域；画布内统一标「后台」）
      h('div', { class: 'prop-row' }, h('label', {}, '左右候场区宽'), h('input', { type: 'number', min: '0', max: '5', step: '0.5', value: st.wingM ?? 0, onchange: e => stageChange('wingM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '观众方向'),
        h('select', { onchange: e => stageChange('audience', e.target.value) },
          ...['bottom', 'top', 'left', 'right'].map(v => h('option', { value: v, ...(st.audience === v ? { selected: true } : {}) }, { bottom: '下方', top: '上方', left: '左侧', right: '右侧' }[v]))))),
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, '网格'),
      // build-78-recorder：GRID_PRESETS 快捷粒度芯片（0.5/0.25/0.1/0.05m）——点按即 stageChange('gridM', v)
      //（一条「舞台设置」历史 + 视口复位，与场地预设芯片同链）；高亮=当前 gridM 精确命中档
      h('div', { class: 'prop-row', style: 'flex-wrap:wrap;justify-content:flex-start;gap:4px' },
        ...GRID_PRESETS.map(g => h('button', {
          class: 'btn small stage-preset' + (Math.abs(st.gridM - g.v) < 1e-9 ? ' active' : ''),
          title: `网格间距 ${g.label}`,
          onclick: () => stageChange('gridM', g.v),
        }, g.label))),
      h('div', { class: 'prop-row' }, h('label', {}, '网格间距'), h('input', { type: 'number', min: '0.05', max: '2', step: '0.05', value: st.gridM, onchange: e => stageChange('gridM', e.target.value) })),
      h('div', { class: 'prop-row' }, h('label', {}, '拖动吸附'), h('input', { type: 'checkbox', ...(st.snap ? { checked: true } : {}), onchange: e => stageChange('snap', e.target.checked) })),
      // build-78-recorder（W2 接线清单 #5）：细粒度吸附=gridM/5 档（与次级网格线同频）——
      // UI 级偏好（wuzhen:fineSnap，默认关），经 scene.fineSnap 透传手势 host；桌面拖动中
      // 按住 Alt/Option 临时取反（gesture.js 事件层）
      h('div', { class: 'prop-row' }, h('label', {}, '细粒度吸附'), h('input', { type: 'checkbox', ...(fineSnapOn() ? { checked: true } : {}), onchange: e => setFineSnap(e.target.checked) }))),
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
const STAGE_NUMERIC_KEYS = new Set(['widthM', 'depthM', 'backstageM', 'wingM', 'gridM']);
// build-78-recorder（W2 接线清单 #6/#7）：gridM 下界 0.1→0.05（model.js validateProject 同步放宽，
// 0.05m 档进 GRID_PRESETS 芯片）
const STAGE_RANGE = { widthM: [4, 50], depthM: [4, 50], backstageM: [0, 10], wingM: [0, 5], gridM: [0.05, 2] }; // 与输入框 min/max 同域
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
// build-61-stageaspect F2：场地预设一键套用——宽深一次写入（单条「调整场地」历史；数值输入
// 分键 mutate 的口径对预设不适用）；stageView.view=null 复位视口 → 下次绘制自动 fitView
// （与 stageChange 数值输入同链：stage.js view 空则 fit 兜底）；propsKey='' 强制重建
// 舞台页签 → 预设钮高亮随新宽深刷新（自由输入后同理，stageChange 对数值键已同法处理）。
function applyStagePreset(p) {
  stageView.view = null;
  propsKey = '';
  store.mutate(pr => {
    pr.stage.widthM = p.widthM;
    pr.stage.depthM = p.depthM;
  }, '调整场地');
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
    h('div', { class: 'dim' }, '提示：以上均为显示样式，不影响队形数据。舞台工具行「显示…」菜单的幽灵/路径开关与本面板同步。'));
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
      if (siIndexShowing()) { closeSegIndexPanel(); return; } // W4 语义保留：索引 tab 激活时 Esc=先让位缺省页
    }
    // v3 音频轨：Esc=清 clip 选择/时间选区（规格 §5）。build-91-varispeed：剃刀改单发后无
    // razor 模式可退（指针模式由 timeline.js 保留休眠，UI 层不再进入），分支随之收窄。
    if (e.key === 'Escape' && musicTl) {
      if (musicTl.clipSel.size || musicTl.timeSel) { musicTl.clearClipSelection(); return; }
    }
    // build-91-varispeed（需求 2，对齐 Adobe Audition 实践）：Ctrl/Cmd+K = 以当前播放线剪切
    // 当前选中音频 clip（MusicTimeline 契约 cutSelectedClipAtPlayhead()→{ok,reason}）——
    // 仅音乐模式响应；编舞模式按下不处理不 toast（避免误触打扰）。编舞侧分割保留队形
    // clip 右键/长按菜单「分割于此」入口（showFormationClipMenu）。
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (musicTl?.mode === 'music') cutSelectedClipAtPlayheadUI();
      return;
    }
    if (e.key === 'Escape') {
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
    // M = 双 UI 模式切换（编舞⇄音乐）；播放中禁止（setUiMode 内 toast「暂停后可切换」）。
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
    if (e.key.toLowerCase() === 'r' && musicTl?.mode === 'music') { e.preventDefault(); cutSelectedClipAtPlayheadUI(); return; }   // R（音乐模式）=剃刀单发剪切（build-91-varispeed 改写：原 razorOn toggle）
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
          : Math.min(M.beatToSec(p, M.segmentsFromClips(p.formations).totalBeats), lastClipEndSec(M.clipsOf(p)));
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
        // build-69-roster R1：Del 键与浮窗入口同语义（removeDancerFromFormation）——
        // positions 清位 + 该帧 merges 引用清理（原裸 delete 不清 merges，选区含单元成员时留悬挂）
        store.mutate(p => M.removeDancerFromFormation(p, s.formationIndex, s.selection), '移出队形');
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
      // build-78-recorder（W2 接线清单 #8）：方向键微调接细粒度档——细粒度吸附开（wuzhen:fineSnap）
      // 时步长=gridM/GRID_MINOR_DIV（与拖动 fine 吸附同频）；Shift=1m 粗调、吸附关=0.1m 不变。
      // Alt 不参与（Alt+←/→ 已被播放头/clip 微移占用）。
      const gs = s.project.stage.gridM;
      const step = e.shiftKey ? 1 : (s.project.stage.snap ? (fineSnapOn() ? gs / GRID_MINOR_DIV : gs) : 0.1);
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
// 显示…下拉勾选态呈示（build-55-uiclean P3）：开=「✓ 」前缀，关=全宽空格占位（列对齐）；
// aria-checked 同步给仪器/读屏。store 字段（showGhost/showPaths/previewOnSwitch）不变
const VIEW_MENU_ITEMS = [
  ['vw-ghost', '幽灵（前后队形虚影）', s => s.showGhost],
  ['vw-paths', '路径（移动轨迹虚线）', s => s.showPaths],
  ['vw-anim', '切帧预览（换帧过渡动画）', s => s.previewOnSwitch],
];
function syncViewMenu(state) {
  for (const [id, label, get] of VIEW_MENU_ITEMS) {
    const el = $(id);
    if (!el) continue;
    const on = !!get(state);
    el.textContent = (on ? '✓ ' : '\u3000') + label;
    el.setAttribute('aria-checked', String(on));
  }
}
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
  // build-62 F3：观众方向快捷钮文字随状态同步（观众在下=正面视角 / 观众在上=背面镜像视角）
  const adir = $('audience-dir-label');
  if (adir) adir.textContent = p.stage.audience === 'top' ? '观众在上' : '观众在下';
  // 显示…下拉勾选态（build-55-uiclean P3）：✓ 前缀 + aria-checked 随 store 同步（原三行内钮 toggled-on 退役）
  syncViewMenu(state);
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
  syncMediaSidebar(p);    // 媒体库侧边栏（build-43-accept）：资产态签名变化时重建（收起时零开销）
  // 音频面板
  // build-79-tlui（需求 7b）：校准件（#bpm-input/#offset-input/#bpb-select）随「校准」折叠
  // 注释隐藏后元素缺席——判存守卫（恢复 HTML 注释即恢复回显）
  const bpmInp = $('bpm-input');
  if (bpmInp && document.activeElement !== bpmInp) bpmInp.value = Math.round(p.audio.bpm);
  const offInp = $('offset-input');
  if (offInp && document.activeElement !== offInp) offInp.value = p.audio.firstBeatSec || 0;
  const bpbSel = $('bpb-select');
  if (bpbSel) bpbSel.value = String(p.audio.beatsPerBar || 4);
  setPbToggle('pb-metro', !!p.timeline.metronome); // build-66-mobileux F1：toggle 钮回写（原 .checked）
  // 块时长快捷栏（build-70 M3 换源）：保持=选中 clip 长度；过渡=与下一 clip 的空隙（自动适应）
  // build-78-recorder（时间唯一标准）：呈示去拍值——秒单显（± 步进同步改 0.1s，见 stepBlockSec）；
  // .bcv-beats/.bcv-sec 双 span 结构保留（mobilestage S1/S2 仪器口径），.bcv-sec 恒空串。
  {
    const bcSegs = M.segmentsFromClips(p.formations).segments;
    const bcSeg = bcSegs[state.formationIndex];
    const bcNext = bcSegs[state.formationIndex + 1];
    if (bcSeg) {
      const spbv = M.spb(p);
      const fmtS = v => `${(v * spbv).toFixed(1).replace(/\.0$/, '')}s`;
      const lenBeats = bcSeg.end - bcSeg.start;
      const gapBeats = bcNext ? Math.max(0, bcNext.start - bcSeg.end) : 0;
      const isLast = !bcNext;
      $('bc-name').textContent = `${state.formationIndex + 1}. ${currentFormation()?.name || ''}`;
      $('bc-name').title = currentFormation()?.name || ''; // 移动端块名 ellipsis 后 title 兜底全名（桌面无感）
      $('bc-hold').querySelector('.bcv-beats').textContent = fmtS(lenBeats);
      $('bc-hold').querySelector('.bcv-sec').textContent = '';
      $('bc-travel').querySelector('.bcv-beats').textContent = fmtS(gapBeats);
      $('bc-travel').querySelector('.bcv-sec').textContent = '';
      $('bc-travel-wrap').style.display = isLast ? 'none' : '';
      $('bc-hold-minus').disabled = lenBeats <= M.FORM_CLIP_LEN_MIN;
      $('bc-travel-minus').disabled = isLast || gapBeats <= 0;
      $('bc-travel-plus').disabled = isLast;
      $('bc-sec').textContent = `（共 ${M.totalDurationSec(p).toFixed(1)}s）`;
    }
  }
  $('audio-name').textContent = audio.ready ? `${p.audio.name} (${(p.audio.durationSec || 0).toFixed(1)}s)` : (p.audio.name ? `${p.audio.name}（重新选择文件）` : '未载入音乐');
  // 摘要条只读元（W2 C14）：BPM/小节在编舞呈只读文本（修改进音乐模式——BPM 是节拍划分产物）
  const msMeta = `BPM${Math.round(p.audio.bpm)} ${p.audio.beatsPerBar || 4}/4`;
  if ($('ms-meta').textContent !== msMeta) $('ms-meta').textContent = msMeta;
  const nTags = (p.timeline.tags || []).length;
  const msTags = nTags ? `tag ${nTags} 个 · 跳转列表` : 'tag 0 个';
  if ($('ms-tags').textContent !== msTags) $('ms-tags').textContent = msTags;
  $('ms-tags').disabled = !nTags;
  // W4：索引容器激活时随数据变更重建（tags/BPM/首拍/拍号改动即时反映；expanded 集保展开态；
  // 非激活容器跳更——build-56 单挂载点纪律，激活切换时补渲染一次）
  if (siIndexActive()) { renderSegIndexPanel(); siTick(); }
  // 音乐工具条镜像（音乐模式呈示面；与编舞面板同模型同步）
  $('mtb-audio-name').textContent = audio.ready ? `${p.audio.name} · ${(p.audio.durationSec || 0).toFixed(1)}s` : (p.audio.name ? `${p.audio.name}（重新选择文件）` : '未载入音乐');
  if (document.activeElement !== $('bpm-input-music')) $('bpm-input-music').value = Math.round(p.audio.bpm);
  if (document.activeElement !== $('offset-input-music')) $('offset-input-music').value = p.audio.firstBeatSec || 0;
  if (document.activeElement !== $('bpb-select-music')) $('bpb-select-music').value = String(p.audio.beatsPerBar || 4);
  drawMusicPreview(); // W1：preview 栏随渲染同步（队形/块数据变更兜底；播放中另有 onTick 驱动）
  syncMusicToggles(); // M5：磁吸/剃刀开关钮呈示随渲染同步（键盘 S/R 路径的兜底刷新面）
  updateMusicLock(); // 任务#2：随渲染同步 BPM/首拍/点拍锁态（暂停/播放切换的兜底刷新面）
  syncVideoExportItem(); // build-60-videoexport：随渲染同步导出视频菜单项启停态（签名门控零 DOM 抖动）
  $('pb-formation').textContent = currentFormation() ? `${state.formationIndex + 1}. ${currentFormation().name}` : '';
  // 播放中按钮态
  setPlayBtn(player.playing);
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
  syncTracksHead, // build-89：timeline 翻转轨头可见性后回调建卡（切模式首帧缝隙）
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
      // build-70：blocks 退役——快照改出 clips（队形 clip 字段；页级仪器断言随本重构漂移，已知）
      clips: p?.formations.map(f => ({ id: f.id, startBeat: f.startBeat ?? 0, lenBeats: f.lenBeats ?? 16 })),
      audio: { name: p?.audio.name, bpm: p?.audio.bpm, ready: audio.ready, duration: audio.duration },
      media: { assets: (p?.media?.assets || []).map(a => ({ ...a })), activeAssetId: p?.media?.activeAssetId ?? null },
      clips: (p?.timeline?.audioClips || []).map(c => ({ ...c })),
      tracks: (p?.timeline?.tracks || []).map(t => ({ ...t })), // 多轨（汇合轮探针用）：轨态快照
      clipSel: [...(musicTl?.clipSel || [])],
      timeSel: musicTl?.timeSel ? { ...musicTl.timeSel } : null,
      audioTrack: { expanded: musicTl?.expanded, snap: musicTl?.snapOn }, // build-91-varispeed：razor 读数随剃刀单发退役（指针模式休眠于 timeline.js）
      uiMode: musicTl?.mode || 'stage',
      rulerScale: musicTl?.rulerScale || 'beat',
      beat: player?.beat, playing: player?.playing,
    };
  },
};
