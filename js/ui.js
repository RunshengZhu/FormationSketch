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
  const grouping = h('select', { style: 'width:120px' },
    h('option', { value: 'gender' }, '男士 / 女士'),
    h('option', { value: 'none' }, '不分组'));
  const body = h('div', {},
    h('div', { class: 'prop-row' }, h('label', {}, '项目名称'), title),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '对数（男女各半）'), pairs),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '额外男舞者'), extraM),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '额外女舞者'), extraF),
    h('div', { class: 'prop-row', style: 'margin-top:8px' }, h('label', {}, '初始编组'), grouping),
    h('p', { class: 'dim', style: 'margin-top:10px' }, '先建好名单进入编辑器，之后可随时在「名册」中增删舞者、加入编组。'));
  const m = modal('新建项目', body, [
    h('button', { class: 'btn primary', onclick: () => {
      onCreate({
        title: title.value.trim() || '未命名队列舞',
        pairs: Math.max(0, +pairs.value || 0),
        extraM: Math.max(0, +extraM.value || 0),
        extraF: Math.max(0, +extraF.value || 0),
        grouping: grouping.value,
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
        h('td', {}, h('span', { style: `display:inline-block;width:16px;height:16px;border-radius:50%;background:${d.color};vertical-align:middle` })),
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
