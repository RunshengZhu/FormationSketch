// 应用编排：视图路由、状态订阅渲染、交互接线、快捷键
import * as store from './store.js';
import * as M from './model.js';
import * as shapes from './shapes.js';
import { StageView, drawScene } from './stage.js';
import { EditStrip, MusicTimeline } from './timeline.js';
import { AudioController } from './audio.js';
import { Player } from './player.js';
import * as exp from './export.js';
import { renderLibrary, showNewProjectModal, showRosterModal, toast, h } from './ui.js';
window.__MAIN_BUILD = 'build-14-merges-popup';

const $ = id => document.getElementById(id);
const audio = new AudioController();
let player, stageView, leftStrip, musicTl;
let propsKey = '', audioPanelBuilt = false;

// ---------- 选择 ----------
// 选择只作用于被点中的舞者本身；共同移动仅来自框选/多选
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
    singleSelected: s.selection.length === 1, // 朝向把手按原始选择判定（舞对联动会扩成 2 个）
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
const UNIT_STYLE_LABEL = { capsule: '胶囊', diamond: '菱形', twin: '双圆' };
function hideUnitMenu() {
  if (unitMenuEl) { unitMenuEl.remove(); unitMenuEl = null; }
}
function showUnitMenu(payload) {
  hideUnitMenu();
  const wrap = document.getElementById('stage-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'unit-menu';
  if (payload.mode === 'merge') {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = '合并为单元';
    el.append(title);
  } else {
    const title = document.createElement('div');
    title.className = 'um-title';
    title.textContent = '舞对单元';
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
          const f = p.formations[st.formationIndex];
          if (!f) return;
          M.addMerge(f, payload.ids[0], payload.ids[1], sty);
          M.collapsePair(f, payload.ids[0], payload.ids[1]);
        }, '合并单元');
      } else {
        store.mutate(q => { M.setMergeStyle(q.formations[st.formationIndex], payload.ids[0], payload.ids[1], sty); }, '切换单元样式');
      }
      hideUnitMenu();
    });
    return b;
  };
  if (payload.mode === 'merge') {
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
  } else {
    // 拆开按钮
    const untie = document.createElement('button');
    untie.className = 'um-btn';
    untie.textContent = '✂ 拆开';
    untie.addEventListener('click', () => {
      store.mutate(q => { M.removeMerge(q.formations[payload.formationIndex], payload.ids[0], payload.ids[1]); }, '拆开单元');
      hideUnitMenu();
    });
    el.append(untie);
    for (const sty of M.UNIT_STYLES) el.append(mkStyleBtn(sty));
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
  wireLibrary();
  wireKeyboard();
  try {
    applyTheme(store.getState().theme);
    await store.init(localStorage.getItem('fs.lastProject') || undefined);
  } catch (e) {
    console.error('初始化失败', e);
    toast('本地存储不可用，已进入空项目库');
    store.setUI({ view: 'library' });
  }
  await restoreAudio(); // 自动恢复上次项目时同步恢复音频
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
      $('pb-pos').textContent = proj0 ? M.beatLabel(proj0, t.beat) : '—';
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
    onStateChange: ({ playing }) => {
      $('pb-play').textContent = playing ? '⏸' : '▶';
      if (!playing) renderUndoButtons();
    },
    onCountin: n => {
      const ov = $('countin-overlay');
      if (n > 0) { ov.hidden = false; ov.textContent = n; }
      else ov.hidden = true;
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
      commitEdit: label => store.commit(label),
      seekBeat: b => player.seekBeat(Math.max(0, b)),
    },
  });
}
// 手动切换队形帧：更新选中；若开启切帧预览，播放一段纯舞台 UI 动画（不经播放引擎、不动播放头/时间线）
function switchFormation(i) {
  player.pause(); // 无条件暂停（同时取消进行中的数拍入场）
  const s = store.getState();
  const changed = i !== s.formationIndex;
  store.setUI({ formationIndex: i, selection: [] });
  if (!s.editMode && player.beat > 0.001) player.seekFormation(i); // 查看模式：切换帧时播放头跟随所选队形
  if (changed && s.previewOnSwitch && i > 0) {
    stageView.startPositionsPreview(s.project.formations[i - 1], s.project.formations[i], 700);
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
  // 右面板 Tab 切换（队形/舞台）
  document.querySelectorAll('.ptab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.ptab').forEach(x => x.classList.toggle('active', x === b));
    $('props-formation').hidden = b.dataset.tab !== 'formation';
    $('props-stage').hidden = b.dataset.tab !== 'stage';
    $('props-style').hidden = b.dataset.tab !== 'style';
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
  const doExportJSON = async (includeAudio, share) => {
    const s = store.getState();
    let blob = null;
    if (includeAudio) {
      try { blob = await store.storage.getAudio(s.projectId); } catch {}
    }
    const res = await exp.exportProjectJSON(s.project, blob, { share });
    if (res === 'cancelled') return;
    const how = res === 'shared' ? '已通过系统分享发送' : '已导出';
    const what = includeAudio && blob ? '（含音乐）' : '';
    toast(`${how}项目文件${what}`);
  };
  $('exp-json-audio').addEventListener('click', async () => {
    const s = store.getState();
    if (!s.project.audio.name) { toast('当前项目未载入音乐，将导出不含音乐的项目文件'); }
    let blob = null;
    try { blob = await store.storage.getAudio(s.projectId); } catch {}
    if (!blob) { toast('本地未找到音乐文件，请重新载入后再导出含音乐版本'); }
    await doExportJSON(!!blob, true);
  });
  $('exp-json').addEventListener('click', async () => {
    const s = store.getState();
    let blob = null;
    try { blob = await store.storage.getAudio(s.projectId); } catch {}
    await doExportJSON(!!blob, false);
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
          await restoreAudio();
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
  // 当前队形的组队呈示切换（组队=菱形单元 / 拆开=独立圆点），含位置收拢/偏移与缺席顺延
  $('btn-combined').addEventListener('click', () => {
    const s = store.getState();
    const f = s.project.formations[s.formationIndex];
    const next = f.combined === false;
    store.mutate(p => M.setCombined(p, s.formationIndex, next), next ? '队形组队呈示' : '队形拆开呈示');
  });
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
    // 单元换位：把所选按"舞对/单人"分组，恰好 2 个单元时对调位置
    const s = store.getState();
    const units = [];
    const used = new Set();
    for (const id of s.selection) {
      if (used.has(id)) continue;
      const partner = M.partnerOf(s.project, id);
      if (partner && s.selection.includes(partner)) { units.push([id, partner]); used.add(partner); }
      else units.push([id]);
      used.add(id);
    }
    if (units.length !== 2) { toast('请选中两个单元（两名单人或两对舞伴）'); return; }
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
  // 组对 / 拆对（原始选择，不受舞对联动扩展影响）
  $('btn-pair-create').addEventListener('click', () => {
    const sel = store.getState().selection;
    if (sel.length !== 2) { toast('请先选中恰好 2 名舞者'); return; }
    const [a, b] = sel;
    if (M.pairOf(store.getState().project, a) || M.pairOf(store.getState().project, b)) { toast('所选舞者已有舞伴，请先拆对'); return; }
    const da = M.dancerById(store.getState().project, a), db = M.dancerById(store.getState().project, b);
    const leader = da.role === 'M' ? a : (db.role === 'M' ? b : a);
    const follower = leader === a ? b : a;
    store.mutate(p => { M.addPairByIds(p, leader, follower); }, '组成舞对');
    toast(`已组成舞伴：${da.name} × ${db.name}`);
  });
  $('btn-pair-split').addEventListener('click', () => {
    const s = store.getState();
    const targets = [...new Set(s.selection.map(id => M.pairOf(s.project, id)).filter(Boolean))];
    if (!targets.length) { toast('所选舞者没有舞伴绑定'); return; }
    store.mutate(p => {
      const ids = new Set(targets.map(t => t.id));
      p.pairs = p.pairs.filter(x => !ids.has(x.id));
    }, '拆开舞伴');
    toast(targets.length > 1 ? `已拆开 ${targets.length} 对舞伴` : '已拆开舞伴（两人保留在队形中）');
  });
  $('face-target').addEventListener('change', () => {
    const t = $('face-target').value;
    if (!t) return;
    const sel = store.getState().selection;
    const ids = sel.length ? expandedSelection() : [...currentFormation().positions.keys()];
    store.mutate(p => {
      const f = p.formations[store.getState().formationIndex];
      shapes.faceAll(f.positions, ids, t === 'partner' ? 'partner' : t, { stage: p.stage, project: p });
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
    else ids = M.orderedDancers(p, unit);
    const slots = shapes.genSlots(kind, ids.length, p.stage, { rows, unit });
    shapes.applySlots(f, ids, slots, { current: f.positions });
    M.applyFormationLayout(p, s.formationIndex); // 顺延缺席舞者 + 按组队/拆开呈示收拢或拆开
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
function togglePlay() {
  if (player.playing) { player.pause(); return; }
  const s = store.getState();
  const { segments } = M.computeSegments(s.project);
  const seg = segments[s.formationIndex];
  if (player.beat > 0.001 && !playerAtEnd()) {
    player.play(null, { countIn: false }); // 暂停后续播
  } else if (audio.ready) {
    player.play(seg ? seg.holdStart : 0); // 有音乐：按音乐时钟从当前队形播
  } else {
    // 无音乐：虚拟时钟，预览当前队形的保持+过渡
    player.play(seg ? seg.holdStart : 0, { previewStop: seg && seg.hasTravel ? seg.travelEnd : (seg ? seg.holdEnd : 0), countIn: false, forceVirtual: true });
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
  $('bpm-input').addEventListener('change', () => store.mutate(p => { p.audio.bpm = Math.max(30, Math.min(300, +$('bpm-input').value || 120)); }, null));
  $('btn-tap').addEventListener('click', () => {
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
  $('offset-input').addEventListener('change', () => store.mutate(p => { p.audio.firstBeatSec = Math.max(0, +$('offset-input').value || 0); }, null));
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
  try {
    await audio.loadBlob(file);
    const dur = audio.duration;
    store.mutate(p => { p.audio.name = file.name; p.audio.durationSec = dur; }, '载入音乐');
    await store.storage.putAudio(store.getState().projectId, file);
    toast(`音乐已载入：${file.name}`);
  } catch (e) {
    toast('音乐载入失败：' + e.message);
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

// ---------- 项目库 ----------
function wireLibrary() {
  $('btn-new-project').addEventListener('click', () => showNewProjectModal(opts => { store.createNewProject(opts); player.stop(); }));
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
  const key = `${s.project.formations.map(x => x.id).join(',')}|${s.formationIndex}|${s.selection.join(',')}|${durKey}|${f.combined !== false}`;
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
        const setDur = (key, v) => store.mutate(p => {
          const b = p.timeline.blocks[s.formationIndex];
          const n = Number(v);
          b[key] = Number.isFinite(n) ? Math.max(0.5, Math.min(999, n)) : b[key];
        }, key === 'holdBeats' ? '调整保持时长' : '调整过渡时长');
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
  store.mutate(p => { M.moveFormation(p, s.formationIndex, to); }, '调整队形顺序');
  store.setUI({ formationIndex: to, selection: [] });
}
function selectionProps(f, s) {
  const sel = s.selection;
  const group = h('div', { class: 'prop-group' });
  group.append(h('div', { class: 'pg-title' }, `选中 ${sel.length} 人`));
  if (!sel.length) {
    group.append(h('div', { class: 'dim' }, '点击/框选舞者进行编辑；舞对锁定时自动带上舞伴。'));
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
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo(); else store.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    if (e.key === 'Escape') { store.setUI({ selection: [] }); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 其余单键快捷键不与浏览器/系统修饰键冲突
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
}

// ---------- 移动端队形索引条 ----------
function fitThumbView(w, h, stage) {
  const b = { x0: -(stage.backstageM ?? 0), y0: -(stage.backstageM ?? 0), x1: stage.widthM + (stage.backstageM ?? 0), y1: stage.depthM + (stage.backstageM ?? 0) };
  const scale = Math.min((w - 8) / (b.x1 - b.x0), (h - 8) / (b.y1 - b.y0));
  return { scale, ox: (w - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale, oy: (h - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale };
}
let indexKey = '';
function renderFormationIndex(state) {
  const host = document.getElementById('formation-index');
  if (!host) return;
  const p = state.project;
  if (!p) { host.innerHTML = ''; return; }
  const key = p.formations.map(f => f.id).join(',') + '|' + state.formationIndex;
  if (key !== indexKey) {
    indexKey = key;
    host.innerHTML = '';
    p.formations.forEach((f, i) => {
      const chip = document.createElement('button');
      chip.className = 'fi-chip' + (i === state.formationIndex ? ' active' : '');
      chip.title = (i + 1) + ' ' + f.name;
      // 迷你缩略图（形状是最强的视觉记忆点）
      const cv = document.createElement('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = 128 * dpr; cv.height = 72 * dpr;
      cv.style.width = '64px'; cv.style.height = '36px';
      drawScene(cv.getContext('2d'), { x: 0, y: 0, w: 128 * dpr, h: 72 * dpr }, p, f.positions, { minimal: true, pad: 4, pairLines: false, view: fitThumbView(128 * dpr, 72 * dpr, p.stage) });
      const label = document.createElement('span');
      label.className = 'fi-label';
      label.textContent = (i + 1) + ' ' + f.name;
      chip.append(cv, label);
      chip.addEventListener('click', () => switchFormation(i));
      host.append(chip);
    });
  }
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

// ---------- 总渲染 ----------
let audioVals = {};
function render(state) {
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
  const combinedNow = curF ? curF.combined !== false : true;
  $('btn-combined').classList.toggle('toggled-on', combinedNow);
  $('btn-combined').textContent = combinedNow ? '⛓ 组队' : '⇱ 拆开';
  // 组对/拆对按钮可用性（按原始选择）
  $('btn-pair-create').disabled = state.selection.length !== 2;
  $('btn-pair-split').disabled = !state.selection.some(id => M.pairOf(p, id));
  $('formation-count').textContent = `${p.formations.length}`;
  renderFormationIndex(state);
  // 面板（统一时间线：编队条 + 波形时间线常驻）
  leftStrip.render();
  buildProps();
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
  $('pb-formation').textContent = currentFormation() ? `${state.formationIndex + 1}. ${currentFormation().name}` : '';
  // 播放暂停后按钮态
  $('pb-play').textContent = player.playing ? '⏸' : '▶';
  stageView.requestDraw();
}

boot();

// 自动化测试钩子（不影响正常使用）：注入音频、读取状态
window.__fs = {
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
      dancers: s.project?.dancers.length, pairs: s.project?.pairs.length,
      formations: s.project?.formations.map(f => ({ name: f.name, n: Object.keys(f.positions).length })),
      positions: currentFormation()?.positions,
      blocks: s.project?.timeline.blocks,
      audio: { name: s.project?.audio.name, bpm: s.project?.audio.bpm, ready: audio.ready, duration: audio.duration },
      beat: player?.beat, playing: player?.playing,
    };
  },
};
