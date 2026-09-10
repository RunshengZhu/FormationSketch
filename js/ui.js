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

// ---------- 项目库 ----------
export function renderLibrary(container, { projects, onOpen, onNew, onDelete, onDuplicate }) {
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('library-empty');
  grid.innerHTML = '';
  empty.hidden = projects.length > 0;
  for (const p of projects) {
    const cv = h('canvas', { width: 440, height: Math.round(440 * p.stage.depthM / p.stage.widthM) });
    const f0 = p.formations[0];
    if (f0) drawScene(cv.getContext('2d'), { x: 0, y: 0, w: cv.width, h: cv.height }, p, f0.positions, { minimal: true, pad: 10, pairLines: false });
    const card = h('div', { class: 'lib-card' },
      cv,
      h('div', { class: 'lc-body' },
        h('div', { class: 'lc-title' }, p.meta.title || '未命名'),
        h('div', { class: 'lc-meta' },
          h('span', {}, `${p.pairs.length}对 · ${p.dancers.length}人 · ${p.formations.length}队形`),
          h('span', {}, fmtDate(p.meta.updatedAt))),
        h('div', { class: 'lc-meta' },
          h('span', {}, p.audio?.name ? '🎵 ' + p.audio.name : '无音乐'),
          h('button', { class: 'lc-del', title: '删除项目', onclick: e => { e.stopPropagation(); onDelete(p); } }, '🗑'))));
    card.addEventListener('click', () => onOpen(p));
    card.addEventListener('contextmenu', e => { e.preventDefault(); onDuplicate(p); });
    grid.append(card);
  }
}

// ---------- 新建项目向导 ----------
export function showNewProjectModal(onCreate) {
  const title = h('input', { type: 'text', value: '未命名队列舞', style: 'width:100%' });
  const pairs = h('input', { type: 'number', min: '0', max: '30', value: '6', style: 'width:80px' });
  const extraM = h('input', { type: 'number', min: '0', max: '30', value: '0', style: 'width:80px' });
  const extraF = h('input', { type: 'number', min: '0', max: '30', value: '0', style: 'width:80px' });
  const body = h('div', {},
    h('div', { class: 'prop-row' }, h('label', {}, '项目名称'), title),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '舞对数（男女搭档）'), pairs),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '额外男舞者'), extraM),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '额外女舞者'), extraF),
    h('p', { class: 'dim', style: 'margin-top:10px' }, '先建好名单进入编辑器，之后可随时在「名册」中增删舞者、重组舞对。'));
  const m = modal('新建项目', body, [
    h('button', { class: 'btn primary', onclick: () => {
      onCreate({
        title: title.value.trim() || '未命名队列舞',
        pairs: Math.max(0, +pairs.value || 0),
        extraM: Math.max(0, +extraM.value || 0),
        extraF: Math.max(0, +extraF.value || 0),
      });
      m.close();
    } }, '创建'),
  ]);
  title.focus(); title.select();
}

// ---------- 名册弹窗 ----------
export function showRosterModal({ mutate, toast: t, getProject }) {
  const wrap = h('div', {});
  const render = () => {
    const project = getProject(); // 每次实时取，撤销/重做后引用不会失效
    wrap.innerHTML = '';
    // 舞者表
    const tb = h('tbody', {});
    project.dancers.forEach(d => {
      const roleSel = h('select', { onchange: () => mutate(p => { const dd = p.dancers.find(x => x.id === d.id); dd.role = roleSel.value; dd.color = { M: '#3b82f6', F: '#ec4899', X: '#10b981' }[roleSel.value]; }, '修改舞者') },
        ...Object.entries(ROLE_NAME).map(([v, n]) => h('option', { value: v, ...(d.role === v ? { selected: true } : {}) }, n)));
      const nameInp = h('input', { type: 'text', value: d.name, onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).name = nameInp.value; }, '重命名舞者') });
      const shortInp = h('input', { type: 'text', value: d.short, maxlength: '3', style: 'width:44px', onchange: () => mutate(p => { p.dancers.find(x => x.id === d.id).short = shortInp.value; }, '修改简称') });
      tb.append(h('tr', {},
        h('td', {}, nameInp), h('td', {}, shortInp), h('td', {}, roleSel),
        h('td', {}, h('span', { style: `display:inline-block;width:16px;height:16px;border-radius:50%;background:${d.color};vertical-align:middle` })),
        h('td', {}, pairLabel(project, d.id)),
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
          h('thead', {}, h('tr', {}, h('th', {}, '姓名'), h('th', {}, '简称'), h('th', {}, '角色'), h('th', {}, '颜色'), h('th', {}, '舞伴'), h('th', {}, ''))),
          tb),
        h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
          h('button', { class: 'btn small', onclick: () => { mutate(p => { M.addDancer(p, `舞者${p.dancers.length + 1}`, 'X'); }, '添加舞者'); render(); } }, '＋ 单人'),
          h('button', { class: 'btn small', onclick: () => { mutate(p => { M.addPair(p, `M${p.pairs.length + 1}`, `F${p.pairs.length + 1}`); }, '添加舞对'); render(); } }, '＋ 舞对（男女）'))),
      // 舞对
      h('div', { class: 'prop-group', style: 'margin-top:10px' },
        h('div', { class: 'pg-title' }, `舞对（${project.pairs.length}）`),
        ...project.pairs.map(pr => {
          const opts = sel => project.dancers.map(d => h('option', { value: d.id, ...(sel === d.id ? { selected: true } : {}) }, `${d.name}（${ROLE_NAME[d.role]} ${d.short}）`));
          const lSel = h('select', { onchange: () => mutate(p => { p.pairs.find(x => x.id === pr.id).leader = lSel.value; }, '调整舞对') }, ...opts(pr.leader));
          const fSel = h('select', { onchange: () => mutate(p => { p.pairs.find(x => x.id === pr.id).follower = fSel.value; }, '调整舞对') }, ...opts(pr.follower));
          return h('div', { class: 'pair-row' }, h('span', { class: 'dim' }, '对'), lSel, h('span', {}, '—'), fSel,
            h('button', { class: 'btn small', title: '拆对', onclick: () => { mutate(p => { M.removePair(p, pr.id); }, '拆对'); render(); } }, '拆对'));
        }),
        ...unpairedRows(project, mutate, render),
        h('div', { style: 'display:flex;gap:6px;margin-top:8px' },
          h('button', { class: 'btn small', onclick: () => { mutate(p => { autoPair(p); }, '自动配对'); render(); } }, '自动配对剩余单人'),
          h('button', { class: 'btn small', onclick: () => { mutate(p => { M.renameShortsByPair(p); }, '重编号码'); render(); } }, '按舞对重编号码'))));
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
  const m = modal('名册 · 舞者与舞对', wrap, [], { onClose: () => unsub?.() });
  return m;
}
function pairLabel(project, dancerId) {
  const p = project.pairs.find(q => q.leader === dancerId || q.follower === dancerId);
  if (!p) return '—';
  const otherId = p.leader === dancerId ? p.follower : p.leader;
  const other = project.dancers.find(d => d.id === otherId);
  return other ? other.name : '—';
}
function unpairedRows(project, mutate, render) {
  const unpaired = project.dancers.filter(d => !project.pairs.some(q => q.leader === d.id || q.follower === d.id));
  if (!unpaired.length) return [];
  return [h('div', { class: 'dim', style: 'margin-top:6px' }, `未配对：${unpaired.map(d => d.name).join('、')}`)];
}
function autoPair(project) {
  const unM = project.dancers.filter(d => d.role === 'M' && !project.pairs.some(q => q.leader === d.id || q.follower === d.id));
  const unF = project.dancers.filter(d => d.role === 'F' && !project.pairs.some(q => q.leader === d.id || q.follower === d.id));
  const n = Math.min(unM.length, unF.length);
  for (let i = 0; i < n; i++) {
    project.pairs.push({ id: `p_${Date.now().toString(36)}_${i}${Math.random().toString(36).slice(2, 5)}`, leader: unM[i].id, follower: unF[i].id });
  }
}
