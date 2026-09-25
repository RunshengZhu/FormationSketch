// icons.js —— 零依赖内联 SVG 图标库（决策⑤：线性单色、stroke=currentColor、与主题色联动）
// 单一事实源。js/ui.js 内嵌同体拷贝（ICONS-BEGIN/END 哨兵块，tests/icons.test.js 强制逐字
// 零漂移）——因为 scripts/build-single.mjs 的 ORDER 常量固定（本文件暂不在其中，不能被
// ui.js 静态 import，否则单文件包运行时 FS.icons 未定义必炸）。汇合点接入：ORDER 数组加
// 'icons'（置于 'ui' 之前）→ ui.js 改回 `import … from './icons.js'` 并删除哨兵块。
// 用法：
//   iconHtml(name, size?, label?) → SVG 字符串（innerHTML/模板串直接拼；manual.js 正文用）
//   iconEl(name, size?, label?)   → SVG 元素（ui.js 的 h() 子节点用；无 DOM 环境返回兜底 span）
//   size 仅 16/20 两档；label 给出时 role="img"+aria-label（语义图标），否则 aria-hidden（装饰）。
// 图标名与 UI emoji 的对照见 docs/icon-mapping.md（A 组=语义图标；空态插画字符保留）。

export const ICONS = {
  // —— 播放条 ——
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  'skip-back': '<path d="M7 5v14"/><path d="M19 6.5v11L10 12z"/>',
  'skip-fwd': '<path d="M17 5v14"/><path d="M5 6.5v11L14 12z"/>',
  // —— 编辑操作 ——
  pencil: '<path d="M4 20l1.2-4.2L16.6 4.4a2 2 0 0 1 2.9 2.9L8.2 18.7 4 20z"/><path d="M13.6 7.4l3 3"/>',
  razor: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.3 7.8L20 19.5M8.3 16.2L20 4.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M8 5L4 9l4 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H9"/>',
  redo: '<path d="M16 5l4 4-4 4"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H15"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  // —— 箭头 / 撑条 ——
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'chevron-up': '<path d="M6 14l6-6 6 6"/>',
  'chevron-down': '<path d="M6 10l6 6 6-6"/>',
  'grip-h': '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M4 12h16"/>',
  // —— 变换 / 对齐 ——
  'flip-h': '<path d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  'flip-v': '<path d="M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4"/>',
  swap: '<path d="M4 9h13M14 5.5L17.5 9 14 12.5M20 15H7M10 11.5L6.5 15l3.5 3.5"/>',
  'align-left': '<path d="M5 4v16M20 12H9M12.5 8.5L9 12l3.5 3.5"/>',
  magnet: '<path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0V3z"/><path d="M6 7h4M14 7h4"/>',
  // —— 音乐 / 媒体 / 标记 ——
  flag: '<path d="M6 21V4"/><path d="M6 5c2-1.3 4-1.3 6 0s4 1.3 6 0v8c-2 1.3-4 1.3-6 0s-4-1.3-6 0"/>',
  music: '<path d="M9 18V5.5L20 3.5V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  library: '<path d="M5 4v16M9 4v16"/><path d="M12.5 4.2l4.4-1.2 3.8 14.4-4.4 1.2z"/>',
  book: '<path d="M2.5 5H8a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2.5zM21.5 5H16a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h6.5z"/>',
  volume: '<path d="M11 5.5L6.5 9H3.5v6h3L11 18.5z"/><path d="M15 9a4.5 4.5 0 0 1 0 6M17.8 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M11 5.5L6.5 9H3.5v6h3L11 18.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  // —— 主题 ——
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
  moon: '<path d="M12 3a6.3 6.3 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
};
export const ICON_NAMES = Object.keys(ICONS);
export const SIZES = [16, 20];
export const VA_PX = { 16: '-2px', 20: '-3px' }; // 基线视觉对齐（内联 style 呈现，不动样式表）

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// iconHtml(name, size?, label?) → 内联 SVG 字符串；线性单色 stroke=currentColor（主题色联动）。
// data-icon=name：机器可读图标标识（E2E 仪器按它断言按钮呈示态，如 pb-play 的 play/pause）。
export function iconHtml(name, size = 16, label = '') {
  const body = ICONS[name];
  if (!body) return ''; // 未知图标名静默空串（不产生裂图）
  const sz = SIZES.includes(size) ? size : 16;
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<svg class="ic" viewBox="0 0 24 24" width="${sz}" height="${sz}"` +
    ` fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` +
    ` data-icon="${name}"` +
    `${a11y} style="vertical-align:${VA_PX[sz]}">${body}</svg>`;
}

// iconEl(name, size?, label?) → SVG 元素（DOM 构建）；无 DOM/桩环境返回兜底 span（不抛错）。
export function iconEl(name, size = 16, label = '') {
  const holder = document.createElement('span');
  holder.innerHTML = iconHtml(name, size, label);
  return holder.firstElementChild || holder;
}
