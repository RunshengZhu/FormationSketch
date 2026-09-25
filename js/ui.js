// UI 辅助：DOM 构建、Toast、项目库、新建向导、名册弹窗
import * as M from './model.js';
import { ROLE_NAME } from './model.js';
import { subscribe } from './store.js';
import { drawScene } from './stage.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}
export function toast(msg, ms = 2200) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}
export function modal(title, bodyEl, footEls = [], { onClose } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  root.hidden = false;
  const close = () => { root.hidden = true; root.innerHTML = ''; onClose?.(); };
  const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) close(); } },
    h('div', { class: 'modal' },
      h('h3', {}, title),
      bodyEl,
      h('div', { class: 'm-foot' }, ...footEls, h('button', { class: 'btn', onclick: close }, '关闭'))));
  root.append(back);
  return { close, back };
}
export function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// ---------- F-04（UX-04）：history 哨兵决策机（纯逻辑，node 可测；main.js 负责接线） ----------
// 语义（与「‹ 项目库」按钮严格一致）：进编辑器压入恰一条哨兵条目；浏览器后退到哨兵
// → 应用内回库（等价点「‹ 项目库」），再次返回才真正离开；应用内回库（按钮路径）时
// 主动弹掉哨兵并吞掉随之而来的 popstate；前进到哨兵（曾后退过）=重开该项目；
// 哨兵消费/覆盖式重压 → 库⇄编辑器往返不堆积。
export function createHistorySentinel(io = {}) {
  const marked = () => !!(io.state && io.state() && io.state().fs === 'editor');
  let suppress = 0; // 自驱 history.back() 引发的 popstate 需吞掉的次数
  return {
    enter() { if (!marked()) io.push(); },                 // 进编辑器：无哨兵才压入（恢复/重载场景防重复）
    exitUi() { if (marked()) { suppress++; io.back(); } }, // 应用内回库（按钮路径）：弹掉哨兵条目
    onPop(st, view) {
      if (suppress > 0) { suppress--; return { action: 'none' }; }
      if (view === 'editor' && !(st && st.fs === 'editor')) return { action: 'toLibrary' };
      if (view === 'library' && st && st.fs === 'editor') return { action: 'reopen', pid: st.pid };
      return { action: 'none' }; // 已在库且无哨兵标记 → 再次后退由浏览器真实离开（不拦截）
    },
  };
}

// ---------- F-09（UX-09）：项目库卡片右键自定义菜单（隐藏手势显性化） ----------
// 原行为：卡片 contextmenu=preventDefault+静默复制项目（用户想调浏览器菜单时误复制）。
// 现行为：弹出与画布 .unit-menu 同风格的显式菜单 [打开/复制/删除]；左键行为不变。
let libMenuEl = null;
let libMenuDismiss = null;
let libMenuKeyClose = null; // DEFECT-R21-1：Esc 关闭监听（随菜单开合同生命周期，杜绝重复绑定/泄漏）
export function closeLibCardMenu() {
  if (libMenuEl) { libMenuEl.remove(); libMenuEl = null; }
  if (libMenuDismiss) { document.removeEventListener('pointerdown', libMenuDismiss, true); libMenuDismiss = null; }
  if (libMenuKeyClose) { document.removeEventListener('keydown', libMenuKeyClose, true); libMenuKeyClose = null; }
}
export function showLibCardMenu(x, y, p, acts) { // acts: {onOpen, onDuplicate, onDelete}（export 供 node 单测驱动真实监听路径）
  closeLibCardMenu();
  const mk = (label, fn, extra = {}) => {
    const b = h('button', { class: 'um-btn' + (extra.cls ? ' ' + extra.cls : '') }, label);
    if (extra.style) b.style.cssText = extra.style;
    b.addEventListener('click', () => { closeLibCardMenu(); fn(); });
    return b;
  };
  const menu = h('div', { class: 'unit-menu', id: 'lib-card-menu' },
    h('div', { class: 'um-title' }, `项目 · ${p.meta.title || '未命名'}`),
    mk('打开', () => acts.onOpen(p)),
    mk('复制', () => acts.onDuplicate(p)),
    mk('删除', () => acts.onDelete(p), { style: 'color:#ef4444' }),
    mk('✕', () => {}, { cls: 'um-cancel' }));
  menu.style.position = 'fixed'; // 覆盖 .unit-menu 的 absolute（相对卡片无意义，按光标定位）
  menu.style.zIndex = '150';
  libMenuDismiss = ev => { if (!menu.contains(ev.target)) closeLibCardMenu(); };
  document.addEventListener('pointerdown', libMenuDismiss, true);
  // DEFECT-R21-1：Esc 关闭，与编辑器 .unit-menu（gesture MENU 态 Esc=关菜单）行为对齐。
  // 一次性语义：绑定只发生在本函数（入口先 closeLibCardMenu 保证旧监听先解绑），所有关闭
  // 路径（Esc / 点外部 / 菜单项 / 重渲染清扫）统一经 closeLibCardMenu 解绑——多次开合监听数不增长。
  // 库视图下 wireKeyboard 早退（view!=='editor'），Escape 别无处理方，无需 preventDefault/stopPropagation。
  libMenuKeyClose = ev => { if (ev.key === 'Escape') closeLibCardMenu(); };
  document.addEventListener('keydown', libMenuKeyClose, true);
  document.body.append(menu);
  libMenuEl = menu;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
}

// ---------- 媒体库弹窗（v3 音乐剪辑 · 规格 §3） ----------
// 多文件导入 / 列表（名称·时长·大小）/ 用作配乐 / 重命名 / 删除（当前配乐删除需 confirm）；
// 拖音频文件入弹窗=导入；资产行可拖到音轨落点生成 clip（dataTransfer: text/x-wuzhen-asset）。
export function showMediaLibraryModal({ getProject, acts, toast: t }) {
  // acts: { importFiles(files), setActive(id), rename(id, name), remove(id) }
  const wrap = h('div', {});
  let dragDepth = 0;
  const render = () => {
    const p = getProject();
    if (!p) return;
    wrap.innerHTML = '';
    const assets = p.media?.assets || [];
    const tb = assets.map(a => {
      const active = p.media.activeAssetId === a.id;
      const missing = !acts.hasBlob?.(a.id);
      return h('div', { class: 'mlib-row' + (active ? ' mlib-active' : ''), draggable: 'true', title: missing ? '该资产音频数据缺失（重新导入文件可恢复）' : '拖到时间轴音轨可在落点生成剪辑' },
        h('span', { class: 'mlib-name' }, (active ? '🎵 ' : '') + a.name),
        h('span', { class: 'dim' }, `${(a.durationSec || 0).toFixed(1)}s · ${fmtSize(a.size)}${missing ? ' · 数据缺失' : ''}`),
        h('span', { class: 'grp-ops' },
          active ? h('span', { class: 'chip chip-on' }, '配乐') : h('button', { class: 'btn small', onclick: () => { acts.setActive(a.id); render(); } }, '用作配乐'),
          h('button', { class: 'btn small', onclick: () => { acts.rename(a.id); } }, '重命名'),
          h('button', { class: 'btn small danger', onclick: () => { acts.remove(a.id); render(); } }, '删除')));
    });
    wrap.append(
      h('div', { class: 'prop-group' },
        h('div', { class: 'pg-title' }, `音乐资产（${assets.length}）`),
        assets.length ? tb : h('div', { class: 'dim' }, '还没有音频：点下方「导入音频」，或把音频文件直接拖进本弹窗。'),
        h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
          h('button', { class: 'btn small primary', onclick: () => acts.pickFiles() }, '＋ 导入音频…')),
        h('div', { class: 'dim', style: 'margin-top:6px' }, '「配乐」= 时间轴播放使用的资产；其余资产可被 clip 引用。删除当前配乐需确认。')),
    );
  };
  render();
  const m = modal('📚 媒体库 · 音乐资产', wrap, [], { onClose: () => { dragDepth = 0; } });
  // 拖音频文件入弹窗 = 导入（dragover/drop，忽略非音频）
  const back = m.back;
  back.addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  back.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); });
  back.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    const files = [...(e.dataTransfer?.files || [])].filter(f => !f.type || f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name));
    if (files.length) { acts.importFiles(files); }
    const assetId = e.dataTransfer?.getData('text/x-wuzhen-asset');
    void assetId; // 弹窗内落点不生成 clip（落点在时间轴音轨）
    setTimeout(render, 600); // 导入是异步的：稍后刷新列表（订阅更新另有兜底）
  });
  const unsub = subscribe(() => { const np = getProject(); if (np) render(); });
  const oldClose = m.close;
  m.close = () => { unsub?.(); oldClose(); };
  // modal 的关闭按钮走内部 close()——统一包一层
  return m;
}
export function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + 'KB';
  return b + 'B';
}

// ---------- 通用右键菜单（音频剪辑用；与 .unit-menu 同风格，fixed 定位跟光标） ----------
export function showContextMenu(items, { x, y, id = '' } = {}) {
  // items: [{ label, fn, danger?, sep? }]；{ sep: true } 为分隔线
  closeContextMenu();
  const menu = h('div', { class: 'unit-menu', id: id || 'clip-ctx-menu' });
  for (const it of items) {
    if (it.sep) { menu.append(h('div', { style: 'border-top:1px solid var(--line);margin:2px 0' })); continue; }
    if (it.el) { menu.append(it.el); continue; }
    const b = h('button', { class: 'um-btn' }, it.label);
    if (it.danger) b.style.color = '#ef4444';
    b.addEventListener('click', () => { closeContextMenu(); it.fn?.(); });
    menu.append(b);
  }
  menu.style.position = 'fixed';
  menu.style.zIndex = '150';
  document.body.append(menu);
  const dismiss = ev => { if (!menu.contains(ev.target)) closeContextMenu(); };
  const keyClose = ev => { if (ev.key === 'Escape') closeContextMenu(); };
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('keydown', keyClose, true);
  ctxMenuCleanup = () => {
    menu.remove();
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', keyClose, true);
  };
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
}
let ctxMenuCleanup = null;
export function closeContextMenu() {
  if (ctxMenuCleanup) { ctxMenuCleanup(); ctxMenuCleanup = null; }
}

// ---------- 项目库 ----------
export function renderLibrary(container, { projects, onOpen, onNew, onDelete, onDuplicate }) {
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('library-empty');
  closeLibCardMenu(); // 重渲染（打开/复制/删除后）时收走残留菜单
  grid.innerHTML = '';
  empty.hidden = projects.length > 0;
  for (const p of projects) {
    const cv = h('canvas', { width: 440, height: Math.round(440 * p.stage.depthM / p.stage.widthM) });
    const f0 = p.formations[0];
    if (f0) drawScene(cv.getContext('2d'), { x: 0, y: 0, w: cv.width, h: cv.height }, p, f0.positions, { minimal: true, pad: 10, merges: f0.merges || [] });
    const card = h('div', { class: 'lib-card' },
      cv,
      h('div', { class: 'lc-body' },
        h('div', { class: 'lc-title' }, p.meta.title || '未命名'),
        h('div', { class: 'lc-meta' },
          h('span', {}, `${p.dancers.length}人 · ${p.formations.length}队形`),
          h('span', {}, fmtDate(p.meta.updatedAt))),
        h('div', { class: 'lc-meta' },
          h('span', {}, p.audio?.name ? '🎵 ' + p.audio.name : '无音乐'),
          h('button', { class: 'lc-del', title: '删除项目', onclick: e => { e.stopPropagation(); onDelete(p); } }, '🗑'))));
    card.addEventListener('click', () => onOpen(p));
    card.addEventListener('contextmenu', e => {
      e.preventDefault(); // 原生菜单不再静默复制：隐藏手势并入显式菜单（左键打开不变）
      showLibCardMenu(e.clientX, e.clientY, p, { onOpen, onDuplicate, onDelete });
    });
    grid.append(card);
  }
}

// ---------- 新建项目向导 ----------
// 「初始方案」预设：std6=现状默认（6 对独立）；merged6/merged8=建档即两两合并为胶囊单元
// （经 opts.presetMerged 走 store/M 既有合并数据形态，拖动/拆开语义不变）；custom=保持既有
// 能力（「对数」可编辑）。「对数」输入可用性随预设切换：仅自定义可编辑；「初始编组」
// gender/none 照旧适用于所有预设。
export function showNewProjectModal(onCreate) {
  const title = h('input', { type: 'text', value: '未命名队列舞', style: 'width:100%' });
  const PRESET_PAIRS = { std6: 6, merged6: 6, merged8: 8 }; // 预设 → 固定对数（custom 才可编辑）
  const preset = h('select', { style: 'width:160px' },
    h('option', { value: 'std6' }, '标准 · 6 对（独立）'),
    h('option', { value: 'merged6' }, '6 对 · 已组合'),
    h('option', { value: 'merged8' }, '8 对 · 已组合'),
    h('option', { value: 'custom' }, '自定义'));
  const pairs = h('input', { type: 'number', min: '0', max: '30', value: '6', style: 'width:80px' });
  const extraM = h('input', { type: 'number', min: '0', max: '30', value: '0', style: 'width:80px' });
  const extraF = h('input', { type: 'number', min: '0', max: '30', value: '0', style: 'width:80px' });
  const grouping = h('select', { style: 'width:120px' },
    h('option', { value: 'gender' }, '男士 / 女士'),
    h('option', { value: 'none' }, '不分组'));
  const applyPreset = () => {
    if (preset.value === 'custom') { pairs.disabled = false; return; }
    pairs.value = String(PRESET_PAIRS[preset.value] ?? 6);
    pairs.disabled = true;
  };
  preset.addEventListener('change', applyPreset);
  applyPreset(); // 默认 std6：对数=6 且不可编辑
  const body = h('div', {},
    h('div', { class: 'prop-row' }, h('label', {}, '项目名称'), title),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '初始方案'), preset),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '对数（男女各半）'), pairs),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '额外男舞者'), extraM),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '额外女舞者'), extraF),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '初始编组'), grouping),
    h('p', { class: 'dim', style: 'margin-top:10px' }, '先建好名单进入编辑器，之后可随时在「名册」中增删舞者、加入编组。「已组合」方案会把每对男女合并为一个单元建档，之后可随时拆开。'));
  const m = modal('新建项目', body, [
    h('button', { class: 'btn primary', onclick: () => {
      onCreate({
        title: title.value.trim() || '未命名队列舞',
        pairs: Math.max(0, +pairs.value || 0),
        extraM: Math.max(0, +extraM.value || 0),
        extraF: Math.max(0, +extraF.value || 0),
        grouping: grouping.value,
        presetMerged: preset.value === 'merged6' || preset.value === 'merged8',
      });
      m.close();
    } }, '创建'),
  ]);
  title.focus(); title.select();
}

// ---------- 名册弹窗（v3：普通表格 + 重编号码 + 编组 chips，无舞对概念） ----------
export function showRosterModal({ mutate, toast: t, getProject }) {
  const wrap = h('div', {});
  const render = () => {
    const project = getProject(); // 每次实时取，撤销/重做后引用不会失效
    wrap.innerHTML = '';
    const groups = project.groups || [];
    const tb = h('tbody', {});
    project.dancers.forEach(d => {
      const roleSel = h('select', { onchange: () => mutate(p => { const dd = p.dancers.find(x => x.id === d.id); dd.role = roleSel.value; dd.color = { M: '#3b82f6', F: '#ec4899', X: '#10b981' }[roleSel.value]; }, '修改舞者') },
        ...Object.entries(ROLE_NAME).map(([v, n]) => h('option', { value: v, ...(d.role === v ? { selected: true } : {}) }, n)));
      const nameInp = h('input', { type: 'text', value: d.name, onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).name = nameInp.value; }, '重命名舞者') });
      const shortInp = h('input', { type: 'text', value: d.short, maxlength: '3', style: 'width:44px', onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).short = shortInp.value; }, '修改简称') });
      // 颜色可编辑（round23 需求 2 补全）：取色器即改即存；改角色仍会重置为角色默认色（既有语义）
      const colorInp = h('input', { type: 'color', value: d.color || '#64748b', title: '舞者颜色', style: 'width:34px;height:26px;padding:0;border:none;background:none', onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).color = colorInp.value; }, '修改颜色') });
      // 编组 chips：每枚可点 = 加入/移出该组（一名舞者可属多组）
      const groupCell = h('td', { class: 'roster-groups' },
        ...groups.map(g => {
          const inG = (g.memberIds || []).includes(d.id);
          return h('button', { class: 'chip' + (inG ? ' chip-on' : ''), title: `${inG ? '移出' : '加入'}「${g.name}」`, onclick: () => {
            mutate(p => {
              const g2 = (p.groups || []).find(x => x.id === g.id);
              if (!g2) return;
              if (inG) g2.memberIds = g2.memberIds.filter(x => x !== d.id);
              else g2.memberIds.push(d.id);
            }, inG ? '移出编组' : '加入编组');
            render();
          } }, g.name);
        }),
        groups.length ? null : h('span', { class: 'dim' }, '—'));
      tb.append(h('tr', {},
        h('td', {}, nameInp), h('td', {}, shortInp), h('td', {}, roleSel),
        h('td', {}, colorInp),
        groupCell,
        h('td', {}, h('button', { class: 'btn small danger', onclick: () => {
          if (!confirm(`删除舞者「${d.name}」？（将从所有队形移除）`)) return;
          mutate(p => {
            M.removeDancer(p, d.id);
          }, '删除舞者');
          render();
        } }, '删除'))));
    });
    wrap.append(
      h('div', { class: 'prop-group' },
        h('div', { class: 'pg-title' }, `舞者（${project.dancers.length}）`),
        h('table', { class: 'roster-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '姓名'), h('th', {}, '简称'), h('th', {}, '角色'), h('th', {}, '颜色'), h('th', {}, '编组'), h('th', {}, ''))),
          tb),
        h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
          h('button', { class: 'btn small', onclick: () => { mutate(p => { M.addDancer(p, `舞者${p.dancers.length + 1}`, 'X'); }, '添加舞者'); render(); } }, '＋ 单人'),
          h('button', { class: 'btn small', title: '按名册当前列表顺序重编（第 n 人 = n）', onclick: () => { mutate(p => { M.renumberShorts(p); }, '重编号码'); render(); } }, '重编号码')),
        !project.dancers.length ? h('div', { class: 'dim', style: 'margin-top:6px' }, '名单为空：点「＋ 单人」添加舞者。') : null,
        groups.length ? h('div', { class: 'dim', style: 'margin-top:8px' }, `编组：${groups.map(g => `${g.name}(${g.memberIds.length})`).join('、')}。点击每行编组芯片加入/移出，一名舞者可属多组。`) : null));
  };
  render();
  // 撤销/重做会替换 project 对象：引用变化时重渲染弹窗；关闭时退订
  let unsub = null;
  if (getProject) {
    let lastProj = getProject();
    unsub = subscribe(() => {
      const np = getProject();
      if (np && np !== lastProj) { lastProj = np; render(); }
    });
  }
  const m = modal('名册 · 舞者与编组', wrap, [], { onClose: () => unsub?.() });
  return m;
}
