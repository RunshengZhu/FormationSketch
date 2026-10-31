// UI 辅助：DOM 构建、Toast、项目库、新建向导、名册弹窗
import * as M from './model.js';
import { ROLE_NAME } from './model.js';
import { subscribe } from './store.js';
import { drawScene } from './stage.js';

// ---------- 图标库（决策⑤：线性单色 SVG，stroke=currentColor，16/20 两档） ----------
// 单一事实源 js/icons.js；汇合轮已把 'icons' 加入 scripts/build-single.mjs 的 ORDER（置于
// 'ui' 之前），本文件改回静态 import 并删除原哨兵拷贝（docs/icon-mapping.md §5）。
// re-export 保持「manual.js 从 ui.js 取 iconHtml」的既有链（tests/icons.test.js 钉死）。
import { iconHtml, iconEl } from './icons.js';
export { iconHtml, iconEl };

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
// toast(msg, ms, action)：action={label, fn} 时在条内追加动作钮（W3 变速 toast「切秒刻度」；
// 点击即执行并收条）。既有调用方零影响（第 3 参缺省 null，无钮）；
// 文本读取型仪器（textContent.includes 口径）不受影响——钮文案追加在消息之后。
export function toast(msg, ms = 2200, action = null) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast' },
    h('span', { class: 'toast-msg' }, msg),
    action ? h('button', {
      class: 'toast-act',
      onclick: () => { try { action.fn?.(); } finally { t.remove(); } },
    }, action.label) : null);
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
// 哨兵消费/覆盖式重压 → 库与编辑器往返不堆积。
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
// 名册「＋」编组弹层单例（build-75-rosterchip）：同一时刻至多一个，随开随收
let rosterPop = null;
export function closeLibCardMenu() {
  if (libMenuEl) { libMenuEl.remove(); libMenuEl = null; }
  if (libMenuDismiss) { document.removeEventListener('pointerdown', libMenuDismiss, true); libMenuDismiss = null; }
  if (libMenuKeyClose) { document.removeEventListener('keydown', libMenuKeyClose, true); libMenuKeyClose = null; }
}
export function showLibCardMenu(x, y, p, acts) { // acts: {onOpen, onDuplicate, onDelete}（export 供 node 单测驱动真实监听路径）
  closeLibCardMenu();
  const mk = (label, fn, extra = {}) => {
    const b = h('button', {
      class: 'um-btn' + (extra.cls ? ' ' + extra.cls : ''),
      ...(extra.aria ? { 'aria-label': extra.aria, title: extra.aria } : {}),
    }, label);
    if (extra.style) b.style.cssText = extra.style;
    b.addEventListener('click', () => { closeLibCardMenu(); fn(); });
    return b;
  };
  const menu = h('div', { class: 'unit-menu', id: 'lib-card-menu' },
    h('div', { class: 'um-title' }, `项目 · ${p.meta.title || '未命名'}`),
    mk('打开', () => acts.onOpen(p)),
    mk('复制', () => acts.onDuplicate(p)),
    mk('删除', () => acts.onDelete(p), { style: 'color:#ef4444' }),
    mk(iconEl('close'), () => {}, { cls: 'um-cancel', aria: '关闭' }));
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

// ---------- 媒体库（v3 音乐剪辑 · 规格 §3）----------
// build-42-sidebar 起呈示面退役弹窗、改为音乐模式专属可收起侧边栏（#media-sidebar，main.js
// 接线）：内容渲染抽成共享渲染器 renderMediaLibraryContent，侧边栏（主路径）与弹窗（兜底）
// 共用同一份行构建——资产列表（名称/时长/用作配乐/重命名/删除）＋「＋ 导入音频」＋资产行
// 可拖拽（dragstart 写 text/x-wuzhen-asset，与 main.js #tl-scroll drop 消费端配对）＋行内
// 「＋ 添加」点击快速放置（acts.addToTimeline 提供时呈示；放到第一轨末尾，零拖拽精度依赖）。
// 弹窗退役理由（用户裁定）：.modal-back（fixed inset:0 z-index:100）盖满视口、吞掉 #tl-scroll
// 的 drop，是「拖资产到时间轴不生成 clip」（GOLD-DEFECT-1）的深层根因——侧边栏与 lane 区
// flex 并排、零遮挡，遮罩按构造不复存在。showMediaLibraryModal 保留为兜底实现（生产代码
// 不再调用；tests/mlib-drop-forward.test.js 钉其遮罩转发机械面，防未来入口复现时转发链失达）。
// 桥接：ui.js 反向 import main.js 是环，取 window CustomEvent('wuzhen:tl-asset-drop')
// ——最小可测（判定纯函数 + node 桩断言派发，浏览器全管线由 CDP 真实拖拽探针覆盖）。
// 纯判定：落点是否位于 #tl-scroll 矩形内（rect 缺失或零宽高=元素不存在/display:none，
// 如移动端队形页签隐藏时间轴——一律不转发，文件导入等既有路径不受影响）。
export function isAssetDropOverTimeline(clientX, clientY, tlRect) {
  if (!tlRect || tlRect.width <= 0 || tlRect.height <= 0) return false;
  return clientX >= tlRect.left && clientX <= tlRect.right
    && clientY >= tlRect.top && clientY <= tlRect.bottom;
}
// 共享渲染器（弹窗兜底与侧边栏主路径共用）：容器中立，不自带弹层。
// acts: { importFiles(files), setActive(id), rename(id, name), remove(id), hasBlob?(id),
//         pickFiles(), addToTimeline?(id) }；rerender：行内操作后容器自己的即时刷新钩子
//（弹窗传 render；侧边栏由 store 订阅 → 签名变化重建，无需传）。
// F4（build-46-layout）单行化：每资产一行 [名(ellipsis) 时长·大小] [配乐chip] [… ]——
// 其余操作（添加到第一轨/用作配乐/重命名/删除）收进行尾「…」的 showContextMenu 菜单
//（复用既有 handler，菜单 fixed 定位+视口钳制，移动抽屉形态不溢出视口）；行 draggable
// 拖到音轨落点生成剪辑的 dragstart 生产者与空态/导入按钮原样保留。
export function renderMediaLibraryContent(wrap, { getProject, acts, rerender = null }) {
  const p = getProject();
  if (!p) return;
  wrap.innerHTML = '';
  const assets = p.media?.assets || [];
  const tb = assets.map(a => {
    const active = p.media.activeAssetId === a.id;
    const missing = !acts.hasBlob?.(a.id);
    // GOLD-DEFECT-1（金动线 1.6 实测）：行 draggable=true 必须真实派发 dragstart 写入
    // text/x-wuzhen-asset——拖到时间轴 drop 处才能读到资产 id（与 main.js 消费端配对）。
    const row = h('div', { class: 'mlib-row' + (active ? ' mlib-active' : ''), draggable: 'true', title: missing ? '该资产音频数据缺失（重新导入文件可恢复）' : '拖到时间轴音轨可在落点生成剪辑；行尾「…」有更多操作' },
      h('span', { class: 'mlib-name' }, ...(active ? [iconEl('music'), ' '] : []), a.name),
      h('span', { class: 'dim mlib-dur' }, `${(a.durationSec || 0).toFixed(1)}s · ${fmtSize(a.size)}${missing ? ' · 数据缺失' : ''}`),
      ...(active ? [h('span', { class: 'chip chip-on' }, '配乐')] : []),
      h('button', {
        class: 'btn small mlib-more', 'aria-haspopup': 'menu', 'aria-label': `「${a.name}」更多操作`,
        title: '更多操作（添加到第一轨 / 用作配乐 / 重命名 / 删除）',
        onclick: e => showContextMenu([
          ...(acts.addToTimeline ? [{ label: '添加到第一轨末尾', fn: () => acts.addToTimeline(a.id) }] : []),
          ...(active ? [] : [{ label: '用作配乐', fn: () => { acts.setActive(a.id); rerender?.(); } }]),
          { label: '重命名', fn: () => acts.rename(a.id) },
          { label: '删除', danger: true, fn: () => { acts.remove(a.id); rerender?.(); } },
        ], { x: e?.clientX ?? 0, y: e?.clientY ?? 0 }),
      }, '…'));
    row.addEventListener('dragstart', e => {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData('text/x-wuzhen-asset', a.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    return row;
  });
  wrap.append(
    h('div', { class: 'prop-group' },
      h('div', { class: 'pg-title' }, `音乐资产（${assets.length}）`),
      assets.length ? tb : h('div', { class: 'dim' }, '还没有音频：点下方「导入音频」，或把音频文件直接拖进时间轴（落点生成剪辑）。'),
      h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
        h('button', { class: 'btn small primary', onclick: () => acts.pickFiles() }, '＋ 导入音频…')),
      h('div', { class: 'dim', style: 'margin-top:6px' }, '「配乐」= 时间轴播放使用的资产；其余资产可被 clip 引用。删除当前配乐需确认。行尾「…」= 添加/配乐/重命名/删除。')),
  );
}
// 媒体库侧边栏开合偏好（'0'=收起，缺省开；wuzhen:mediaSidebar）。仅显式 toggle 落盘——
// boot 读偏好不回写，避免「未动过设置也新增 LS 键」踩既有仪器（run-ir06 A9/B9）的键白名单。
// storage 不可用（隐私模式/异常）恒开。
// build-46-layout：生产接线已迁往 resolveRsbClosed（合并侧边栏整栏开合），本函数保留导出
//（tests/media-sidebar.test.js S2 钉其语义；与 showMediaLibraryModal 同属防御性兜底面）。
export function resolveMediaSidebarOpen(ls) {
  try { return !(ls && ls.getItem('wuzhen:mediaSidebar') === '0'); }
  catch { return true; }
}
// build-46-layout：右侧合并侧边栏偏好解析（纯函数，node 可测）。仅显式 toggle 落盘
//（'1'/'0'），boot 读偏好不回写（键白名单纪律同上）。
// rsbClosed：'1'=整栏收起、'0'=展开、未写=按形态缺省（移动端收成 88px 迷你条 / 桌面展开）。
export function resolveRsbClosed(ls, isMobile = false) {
  try {
    const v = ls?.getItem?.('wuzhen:rsbClosed') ?? null;
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return !!isMobile;
}
// 段折叠偏好：key 为 wuzhen:rsbPreview / wuzhen:rsbLib；'1'=折叠、'0'=展开、
// 未写=调用方缺省（媒体库段在窄桌面 <1280 缺省折叠，F1 自适应）。
export function resolveSegFold(ls, key, defaultFolded = false) {
  try {
    const v = ls?.getItem?.(key) ?? null;
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return !!defaultFolded;
}
// build-56-indextab F2（round2 修复）：媒体库段 pane 状态写入（元素入参，node 可测）——
// parts={tabs(.rtab 列表), libPane, indexPane}，pane='lib'|'index'。active 态恰落目标 tab
// （其余全清），两 pane hidden 恒互斥（验收缺陷回归：点「媒体库」须显示媒体库并隐藏索引 pane）。
export function applyRsbPaneState(parts, pane) {
  const { tabs, libPane, indexPane } = parts || {};
  for (const t of tabs || []) {
    const on = t?.dataset?.pane === pane;
    t.classList?.toggle('active', on);
    t.setAttribute?.('aria-selected', String(on));
  }
  if (libPane) libPane.hidden = pane !== 'lib';
  if (indexPane) indexPane.hidden = pane !== 'index';
}
// build-56-indextab F1：编舞右列（wuzhen:stageRight）缺省态解析（纯函数，node 可测）。
// 仅缺省值变化：无记忆 → 折叠（38px 细条，舞台缺省占更多视图）；用户展开后 '0' 按记忆，
// 再折叠落 '1'。与 resolveRsbClosed 同纪律：boot 读偏好不回写，仅显式 toggle 落盘。
export function resolveStageRightCollapsed(ls) {
  try {
    const v = ls?.getItem?.('wuzhen:stageRight') ?? null;
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return true; // 缺省折叠（仅缺省；F1 编舞舞台扩容）
}
// 弹窗兜底实现（生产主路径=侧边栏，见上注）：结构与行为保持退役前原样——遮罩 drop 转发
//（落点在 #tl-scroll 矩形内 → 'wuzhen:tl-asset-drop'，弹窗保持打开）与拖文件入弹窗=导入。
export function showMediaLibraryModal({ getProject, acts, toast: t }) {
  const wrap = h('div', {});
  let dragDepth = 0;
  const render = () => renderMediaLibraryContent(wrap, { getProject, acts, rerender: render });
  render();
  const m = modal([iconEl('library', 20), ' 媒体库 · 音乐资产'], wrap, [], { onClose: () => { dragDepth = 0; } });
  // 拖音频文件入弹窗 = 导入（dragover/drop，忽略非音频）
  const back = m.back;
  back.addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  back.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); });
  back.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    // 资产 drop 转发（裁定与桥接见 isAssetDropOverTimeline 上方注释）：
    // 携带 text/x-wuzhen-asset 且落点在 #tl-scroll 矩形内 → 按落点转发，弹窗保持打开。
    const dt = e.dataTransfer;
    const assetId = dt && dt.types.includes('text/x-wuzhen-asset') ? dt.getData('text/x-wuzhen-asset') : '';
    if (assetId && isAssetDropOverTimeline(e.clientX, e.clientY, document.getElementById('tl-scroll')?.getBoundingClientRect?.() || null)) {
      window.dispatchEvent(new CustomEvent('wuzhen:tl-asset-drop', { detail: { assetId, clientX: e.clientX, clientY: e.clientY } }));
      return; // 不走文件导入刷新——clip 创建由 main.js 消费端完成（store 订阅兜底重渲染）
    }
    const files = [...(dt?.files || [])].filter(f => !f.type || f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name));
    if (files.length) { acts.importFiles(files); }
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
          ...(p.audio?.name ? [h('span', {}, iconEl('music'), ' ' + p.audio.name)] : [h('span', {}, '无音乐')]),
          h('button', { class: 'lc-del', title: '删除项目', 'aria-label': '删除项目', onclick: e => { e.stopPropagation(); onDelete(p); } }, iconEl('trash')))));
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

// ---------- 名册弹窗（v3：普通表格 + 重编号码 + 编组 chips；build-69-roster：名册=唯一身份源） ----------
// build-69-roster R2/R3 职责收口（画布删除已改「移出队形」语义，见 main.js）：
//   · 删除舞者的唯一入口——confirm 确认后走 M.removeDancer（全局语义：dancers/groups/
//     所有队形 positions+merges 一并清理；名册中不可恢复，但可 Undo）；
//   · 「重新入队」小钮：曾被移出队形（缺席若干队形）的舞者一键补齐（M.rejoinFormations，
//     补位语义与新增舞者一致；全勤时 disabled）；
//   · 批量添加：按对（M/F + 自动建「第k对」编组）/按数量（角色可选）/预设（6/8 对标准）；
//   · 对信息 badge：属「第k对」编组的舞者行呈示 badge + 「删整对」入口（confirm 后对两成员
//     各走 removeDancer，随后移除空的对编组；读 groups 即可，不新增数据字段）。
// Wave1 需求 6：可选参数 getFormationIndex（调用方传 () => 当前队形下标）——提供时每行多一列
// 「上场状态」toggle 芯片（复用 .chip/.chip-on）：在场=「已上场」（chip-on），点击=下场
// （removeDancerFromFormation 当前队形，历史「下场」）；不在场=「未上场」，点击=上场
// （admitToFormation：最近有位队形位置顺延/无则舞台中央，历史「上场」）。缺省 null=整个
// 状态列隐藏（现调用零破坏）。「重新入队」仅在 缺席>0 且未上场 时可用。
export function showRosterModal({ mutate, toast: t, getProject, syncSelection = null, getFormationIndex = null }) {
  const wrap = h('div', {});
  // 「＋」编组弹层（build-75-rosterchip）：fixed 定位于按钮下方（挂 body，免表格裁剪）；
  // 列出该舞者未加入的编组（点=加入），底部「新编组名称＋新建」行（留空=自动命名）。
  // 单例（rosterPop 模块级）；外点 capture 关、输入框 Esc 关；任何 render 前先收起。
  const closeRosterPop = () => {
    rosterPop?.remove(); rosterPop = null;
    document.removeEventListener('click', closeRosterPop, true);
  };
  const openGroupPicker = (anchor, dancerId) => {
    closeRosterPop();
    const project = getProject();
    const pop = h('div', { class: 'roster-pop', onclick: e => e.stopPropagation() });
    for (const g of (project.groups || []).filter(g => !(g.memberIds || []).includes(dancerId))) {
      pop.append(h('button', { onclick: () => {
        mutate(p => { (p.groups || []).find(x => x.id === g.id)?.memberIds.push(dancerId); }, '加入编组');
        closeRosterPop(); render();
      } }, g.name));
    }
    const nameInp = h('input', { type: 'text', placeholder: '新编组名称', maxlength: '40' });
    const createBtn = h('button', { title: '创建编组并加入该舞者（名称留空=自动命名）', onclick: () => {
      mutate(p => { M.createGroup(p, [dancerId], nameInp.value.trim()); }, '新建编组');
      closeRosterPop(); render();
    } }, '＋ 新建');
    nameInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') createBtn.click();
      else if (e.key === 'Escape') closeRosterPop();
    });
    pop.append(h('div', { class: 'rp-new' }, nameInp, createBtn));
    document.body.append(pop);
    rosterPop = pop;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    setTimeout(() => document.addEventListener('click', closeRosterPop, true), 0);
    setTimeout(() => nameInp.focus(), 0);
  };
  const render = () => {
    closeRosterPop(); // 重渲染前收起「＋」弹层（弹层锚点随表格重建失效）
    const project = getProject(); // 每次实时取，撤销/重做后引用不会失效
    wrap.innerHTML = '';
    const groups = project.groups || [];
    // 对信息：舞者所属「第k对」编组（名册 badge 与「删整对」共用此查找）
    const coupleOf = pid => groups.find(g => /^第\d+对$/.test(g.name || '') && (g.memberIds || []).includes(pid)) || null;
    const tb = h('tbody', {});
    project.dancers.forEach(d => {
      const roleSel = h('select', { onchange: () => mutate(p => { const dd = p.dancers.find(x => x.id === d.id); dd.role = roleSel.value; dd.color = { M: '#3b82f6', F: '#ec4899', X: '#10b981' }[roleSel.value]; }, '修改舞者') },
        ...Object.entries(ROLE_NAME).map(([v, n]) => h('option', { value: v, ...(d.role === v ? { selected: true } : {}) }, n)));
      const nameInp = h('input', { type: 'text', value: d.name, onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).name = nameInp.value; }, '重命名舞者') });
      const shortInp = h('input', { type: 'text', value: d.short, maxlength: '3', style: 'width:44px', onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).short = shortInp.value; }, '修改简称') });
      // 颜色可编辑（round23 需求 2 补全）：取色器即改即存；改角色仍会重置为角色默认色（既有语义）
      const colorInp = h('input', { type: 'color', value: d.color || '#64748b', title: '舞者颜色', style: 'width:34px;height:26px;padding:0;border:none;background:none', onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).color = colorInp.value; }, '修改颜色') });
      // 编组呈现（build-75-rosterchip 收敛）：行内只呈示已加入的编组芯片（含「第k对」badge，
      // 点芯片=移出，单条历史可撤销）；未加入的编组不再整列铺陈——「＋」弹层是唯一新增入口
      //（选既有编组 / 新建编组），保持名册行干净。
      const couple = coupleOf(d.id);
      const coupleNames = couple ? couple.memberIds.map(id => project.dancers.find(x => x.id === id)?.name || '?').join(' & ') : '';
      const joinedGroups = groups.filter(g => (g.memberIds || []).includes(d.id));
      const groupCell = h('td', { class: 'roster-groups' },
        ...joinedGroups.map(g => h('button', {
          class: 'chip chip-on',
          title: g === couple ? `移出「${g.name}」（${coupleNames}）` : `移出「${g.name}」`,
          onclick: () => {
            mutate(p => {
              const g2 = (p.groups || []).find(x => x.id === g.id);
              if (g2) g2.memberIds = g2.memberIds.filter(x => x !== d.id);
            }, '移出编组');
            render();
          },
        }, g.name)),
        h('button', { class: 'chip roster-add', title: '加入 / 新建编组…', onclick: e => { e.stopPropagation(); openGroupPicker(e.currentTarget, d.id); } }, '＋'));
      // Wave1 需求 6：上场状态 toggle 芯片（getFormationIndex 缺省 null → 整列隐藏）。
      // 在场=有当前队形位置：「已上场」（chip-on），点击=下场（removeDancerFromFormation）；
      // 不在场：「未上场」，点击=上场（admitToFormation——最近有位队形顺延/无则舞台中央）。
      const fi = getFormationIndex ? getFormationIndex() : null;
      const curFormation = (fi != null) ? project.formations[fi] : null;
      const onStage = curFormation ? !!curFormation.positions[d.id] : null;
      const statusChip = (onStage == null) ? null : h('button', {
        class: onStage ? 'chip chip-on' : 'chip',
        title: onStage ? '已上场——点击下场（从当前队形移出，可撤销）' : '未上场——点击上场（位置顺延自最近有位队形，无则舞台中央）',
        onclick: () => {
          mutate(p => {
            const cur = getFormationIndex();
            if (onStage) M.removeDancerFromFormation(p, cur, [d.id]);
            else M.admitToFormation(p, cur, d.id);
          }, onStage ? '下场' : '上场');
          render();
        },
      }, onStage ? '已上场' : '未上场');
      // 缺席队形数（「重新入队」小钮的可用性依据：0=全勤 disabled；Wave1 需求 6：已上场亦不可用——
      // 上/下场交给状态芯片，避免两个入口打架；缺席数信息保留为 title）
      const missing = project.formations.filter(f => !f.positions[d.id]).length;
      const rejoinTitle = missing === 0 ? '该舞者在所有队形均有位'
        : onStage ? '该舞者已在当前队形上场（如需全局补齐，先用「上场状态」芯片下场）'
        : `该舞者缺席 ${missing} 个队形，点击补齐（补位语义与新增舞者一致）`;
      tb.append(h('tr', {},
        h('td', {}, nameInp), h('td', {}, shortInp), h('td', {}, roleSel),
        h('td', {}, colorInp),
        ...(statusChip ? [h('td', {}, statusChip)] : []),
        groupCell,
        h('td', { style: 'display:flex;gap:4px;white-space:nowrap' },
          // 删除舞者（唯一入口，R2）：两步确认——确认框明示全局删除语义与 Undo 逃生口
          h('button', { class: 'btn small danger', onclick: () => {
            if (!confirm(`删除舞者「${d.name}」？将从所有队形移除并删除名册记录（不可撤销于名册，但可 Undo）。`)) return;
            mutate(p => {
              M.removeDancer(p, d.id);
            }, '删除舞者');
            syncSelection?.([d.id]); // 名册删除后清掉画布残留选中态（名册=唯一身份源）
            render();
          } }, '删除'),
          // 删整对（R3）：属「第k对」编组的行呈示；confirm 后两成员各走 removeDancer + 空对编组移除
          //（不用 .danger 类、置于「删除」之后：行内首个 .danger 恒为单人删除，仪器口径稳定）
          ...(couple ? [h('button', { class: 'btn small', style: 'color:#ef4444', title: `删除整对「${couple.name}」（${coupleNames}）`, onclick: () => {
            if (!confirm(`删除整对「${couple.name}」（${coupleNames}）？两人将从所有队形移除并删除名册记录（不可撤销于名册，但可 Undo）。`)) return;
            mutate(p => {
              const g = (p.groups || []).find(x => x.id === couple.id);
              for (const id of (g ? [...g.memberIds] : [d.id])) M.removeDancer(p, id);
              p.groups = (p.groups || []).filter(x => x.id !== couple.id);
            }, '删除整对');
            syncSelection?.(couple.memberIds);
            render();
          } }, '删整对')] : []),
          // 重新入队（R2）：补齐全部缺席队形（曾被「移出队形」者）；全勤或已上场 disabled
          //（Wave1 需求 6：`missing === 0`（全勤）之外叠加「已上场」禁用，保留旧字面便于静态钉住）
          h('button', { class: 'btn small', disabled: missing === 0 || !!onStage, title: rejoinTitle, onclick: () => {
            mutate(p => { M.rejoinFormations(p, d.id); }, '重新入队');
            render();
          } }, '重新入队'))));
    });
    // ---- 批量添加（R3）：按对 / 按数量 / 预设。全部走名册身份源（addDancer 自动补进全部队形） ----
    const coupleN = h('input', { type: 'number', min: '1', max: '30', value: '1', style: 'width:64px' });
    const coupleBtn = h('button', { class: 'btn small primary', title: '每对新增男+女舞者（延续 M_i/F_i 序号）并建「第k对」编组', onclick: () => {
      const n = Math.max(1, Math.floor(+coupleN.value || 0));
      mutate(p => { M.addCouples(p, n); }, `添加 ${n} 对`);
      render();
    } }, '＋1 对');
    coupleN.addEventListener('input', () => { coupleBtn.textContent = `＋${Math.max(1, Math.floor(+coupleN.value || 0))} 对`; });
    const batchN = h('input', { type: 'number', min: '1', max: '60', value: '1', style: 'width:64px' });
    const batchRole = h('select', { title: '新增舞者角色' },
      h('option', { value: 'X' }, '不限'),
      h('option', { value: 'M' }, '男士'),
      h('option', { value: 'F' }, '女士'));
    const batchBtn = h('button', { class: 'btn small primary', title: '按所选角色批量添加（命名延续 M_i/F_i/舞者n 序列）', onclick: () => {
      const n = Math.max(1, Math.floor(+batchN.value || 0));
      mutate(p => { M.addDancersBatch(p, n, batchRole.value); }, `批量添加 ${n} 人`);
      render();
    } }, '＋ 添加');
    const presetBtn = n => h('button', { class: 'btn small', title: `追加 ${n} 对（createProject 同款 pairs 语义，不重建项目）`, onclick: () => {
      mutate(p => { M.addCouples(p, n); }, `添加 ${n} 对（预设）`);
      render();
    } }, `${n} 对标准`);
    wrap.append(
      h('div', { class: 'prop-group' },
        h('div', { class: 'pg-title' }, `舞者（${project.dancers.length}）`),
        h('table', { class: 'roster-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '姓名'), h('th', { title: '舞台呈示简称；重合时自动加 1..n 角标去重，可用下方「生成简称」按姓名生成' }, '简称'), h('th', {}, '角色'), h('th', {}, '颜色'),
            // Wave1 需求 6：上场状态列——仅 getFormationIndex 接线时出现（缺省整列隐藏）
            ...(getFormationIndex ? [h('th', {}, '上场')] : []),
            h('th', {}, '编组'), h('th', {}, ''))),
          tb),
        h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
          h('button', { class: 'btn small', onclick: () => { mutate(p => { M.addDancer(p, `舞者${p.dancers.length + 1}`, 'X'); }, '添加舞者'); render(); } }, '＋ 单人'),
          h('button', { class: 'btn small', title: '按名册当前列表顺序重编（第 n 人 = n）', onclick: () => { mutate(p => { M.renumberShorts(p); }, '重编号码'); render(); } }, '重编号码'),
          // 生成简称（build-74-labelname）：默认档案名（M1/F1）原名即简称，其余取姓名首字；
          // 重合不在数据层消解——舞台呈示按 labelTableOf 自动加 1..n 角标去重
          h('button', { class: 'btn small', title: '按姓名一键生成简称（M1/F1 档案名原名即简称，其余取首字；重合由舞台角标去重）', onclick: () => { let n = 0; mutate(p => { n = M.autoShorts(p); }, '生成简称'); render(); t?.(`已生成 ${n} 个简称`); } }, '生成简称')),
        h('div', { class: 'pg-title', style: 'margin-top:12px' }, '批量添加'),
        h('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:4px' },
          h('span', { class: 'dim', style: 'width:52px' }, '按对'), coupleN, coupleBtn),
        h('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:4px' },
          h('span', { class: 'dim', style: 'width:52px' }, '按数量'), batchN, batchRole, batchBtn),
        h('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:4px' },
          h('span', { class: 'dim', style: 'width:52px' }, '预设'), presetBtn(6), presetBtn(8)),
        h('div', { class: 'dim', style: 'margin-top:6px' }, '「按对」每对新增男+女舞者并自动建「第k对」编组（命名延续 M_i/F_i 序列与既有「第k对」最大序）。「移出队形」（画布）不影响名册；缺席的舞者可用行内「重新入队」补齐。'),
        !project.dancers.length ? h('div', { class: 'dim', style: 'margin-top:6px' }, '名单为空：点「＋ 单人」或上方「批量添加」。') : null,
        h('div', { class: 'dim', style: 'margin-top:8px' }, groups.length
          ? `编组：${groups.map(g => `${g.name}(${g.memberIds.length})`).join('、')}。行内芯片=已加入，点芯片移出；「＋」加入既有或新建编组（一名舞者可属多组）。`
          : '尚无编组：点每行「＋」新建第一个编组（一名舞者可属多组）。')));
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
