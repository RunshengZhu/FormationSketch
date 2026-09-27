// icons.test.js —— 图标系统（决策⑤：线性单色 SVG、currentColor、16/20 两档）静态验证（node --test）。
// 覆盖四类断言：
//   1) js/icons.js 结构：注册表齐全（A 组语义图标全收录）、iconHtml/iconEl 产物合规
//      （stroke=currentColor / fill=none / viewBox / 尺寸两档 / 未知名空串 / aria 语义 / data-icon 标识）；
//   2) 无 emoji 回流：js/ui.js 全文、js/manual.js 全文 A 组字符为零（LEGACY-CITE 引用区已随
//      W4 重拍收口退役，互锁的 manual.test.js 原文断言同轮移除），icons.js 本身零 emoji；
//   3) 接线形态（汇合轮改写，原「零漂移」哨兵约束随哨兵块退役）：ui.js 不得内嵌图标注册表
//      拷贝（单一事实源回归 icons.js），只经 import + re-export 取用；
//   4) 打包接线约束（汇合轮翻转）：scripts/build-single.mjs 的 ORDER 已含 'icons' 且置于
//      'ui' 之前，ui.js 静态 import './icons.js'；manual.js 仍经 ui.js 取 iconHtml（链路保持）。
// 浏览器侧（图标渲染对齐/主题联动视觉）由汇合点回归覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS, ICON_NAMES, SIZES, iconHtml, iconEl } from '../js/icons.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');

// A 组=语义 UI 图标字符（对照 docs/icon-mapping.md）；B 组（→ ≥ − ▾ ▸ ↔ ＋ 等）不在此列。
const A_GROUP = ['✂', '⚑', '📚', '📖', '🎵', '🗑', '✏', '☰', '⇋', '⇅', '⇤', '⏮', '⏭', '⏸', '⏹', '▶', '✕', '↺', '↻', '⟳', '⌃', '⌄', '↑', '↓', '☀', '🌙', '🔊', '🔇', '⇄', '↷'];
const REQUIRED_ICONS = [
  // A 组 15 核心（任务书点名）：
  'razor', 'flag', 'library', 'book', 'music', 'trash', 'pencil', 'menu', 'flip-h', 'flip-v', 'align-left', 'skip-back', 'skip-fwd', 'pause', 'stop',
  // 常用补集（播放/加减/关闭/上下移/对齐/磁吸等）：
  'play', 'close', 'undo', 'redo', 'rotate', 'plus', 'minus', 'arrow-up', 'arrow-down', 'chevron-up', 'chevron-down', 'swap', 'magnet', 'grip-h', 'volume', 'mute', 'sun', 'moon',
];

// ---------- 1) 结构与产物 ----------
test('icons.js：A 组语义图标 + 常用补集全收录，图标名稳定', () => {
  for (const n of REQUIRED_ICONS) assert.ok(ICONS[n], `缺图标：${n}`);
  assert.ok(ICON_NAMES.length >= 30, `应 ≥30 个图标，实得 ${ICON_NAMES.length}`);
  assert.deepEqual(SIZES, [16, 20], '尺寸仅 16/20 两档');
});

test('iconHtml：线性单色 currentColor / viewBox / 尺寸 / 未知名空串 / aria 语义 / data-icon 标识', () => {
  for (const n of ICON_NAMES) {
    for (const sz of SIZES) {
      const s = iconHtml(n, sz);
      assert.ok(s.startsWith('<svg') && s.endsWith('</svg>'), `${n}@${sz} 应为完整 svg 串`);
      assert.ok(s.includes('viewBox="0 0 24 24"'), `${n} 应有 viewBox`);
      assert.ok(s.includes('stroke="currentColor"') && s.includes('fill="none"'), `${n} 应线性单色随主题`);
      assert.ok(s.includes(`width="${sz}"`) && s.includes(`height="${sz}"`), `${n}@${sz} 尺寸应为 ${sz}`);
      assert.ok(s.includes('stroke-linecap="round"'), `${n} 应圆角线帽`);
      assert.ok(s.includes('aria-hidden="true"'), `${n} 无 label 时应 aria-hidden`);
      assert.ok(s.includes(`data-icon="${n}"`), `${n} 应带 data-icon 机器标识（E2E 仪器断言呈示态用）`);
    }
  }
  assert.equal(iconHtml('no-such-icon'), '', '未知图标名应返回空串（不裂图）');
  const big = iconHtml('music', 20);
  assert.ok(big.includes('width="20"') && big.includes('height="20"'), '20 档生效');
  assert.ok(iconHtml('music', 99).includes('width="16"'), '非法档位回落 16');
  const labeled = iconHtml('trash', 16, '删除"项目"<x>');
  assert.ok(labeled.includes('role="img"') && labeled.includes('aria-label="删除&quot;项目&quot;&lt;x&gt;"'), 'label 应 role=img 且转义');
  // iconEl：无 DOM 桩下不抛错（返回兜底容器）
  globalThis.document = { createElement: () => ({ set innerHTML(v) { this._h = v; }, get firstElementChild() { return { nodeType: 1 }; } }) };
  assert.equal(iconEl('play').nodeType, 1, 'iconEl 应返回元素');
  delete globalThis.document;
});

// ---------- 2) 无 emoji 回流（LEGACY-CITE 引用区已退役，manual.js 全文检查） ----------
test('无 emoji 回流：ui.js 全文 / manual.js 全文 / icons.js 的 A 组字符为零', () => {
  const uiSrc = read('js/ui.js');
  for (const ch of A_GROUP) assert.ok(!uiSrc.includes(ch), `js/ui.js 不应再含 A 组字符 ${ch}`);
  const manSrc = read('js/manual.js');
  for (const ch of A_GROUP) assert.ok(!manSrc.includes(ch), `js/manual.js 不应含 A 组字符 ${ch}`);
  const iconsSrc = read('js/icons.js');
  for (const ch of [...A_GROUP, '💃']) assert.ok(!iconsSrc.includes(ch), `js/icons.js 不应含 emoji 字符 ${ch}（→ ← 等文本箭头注释不在此限）`);
  for (const rel of ['js/ui.js', 'js/manual.js', 'js/icons.js']) {
    assert.ok(!read(rel).includes('\uFE0F'), `${rel} 不应含 VS16 变体选择符`);
  }
});

// ---------- 3) 接线形态（汇合轮：哨兵块退役，单一事实源回归 icons.js） ----------
test('接线形态：ui.js 无哨兵块/无本地图标表，经 import + re-export 取用 icons.js', () => {
  const uiSrc = read('js/ui.js');
  assert.ok(!uiSrc.includes('ICONS-BEGIN'), '哨兵块已退役：ui.js 不应再有 ICONS-BEGIN');
  assert.ok(!uiSrc.includes('ICONS-END'), '哨兵块已退役：ui.js 不应再有 ICONS-END');
  assert.ok(!/^export const ICONS = \{/m.test(uiSrc), '单一事实源=icons.js：ui.js 不得内嵌图标注册表拷贝');
  assert.match(uiSrc, /import\s*\{\s*iconHtml,\s*iconEl\s*\}\s*from\s*'\.\/icons\.js';/, 'ui.js 应静态 import icons.js');
  assert.match(uiSrc, /export\s*\{\s*iconHtml,\s*iconEl\s*};/, 'ui.js 应 re-export iconHtml/iconEl（manual.js 取用链保持）');
});

// ---------- 4) 打包接线约束（汇合轮翻转：ORDER 已含 icons 且置于全部取用方之前） ----------
test('接线约束：icons.js 零依赖；ORDER 含 icons→timeline/ui 有序；manual.js 经 ui.js 取用', () => {
  assert.ok(!/^\s*import\s/m.test(read('js/icons.js')), 'icons.js 应零依赖（无 import）');
  const order = read('scripts/build-single.mjs').match(/const ORDER = \[([^\]]+)\]/);
  assert.ok(order, '应能解析 build-single.mjs 的 ORDER');
  const mods = order[1].match(/'([\w-]+)'/g).map(s => s.slice(1, -1));
  const iIc = mods.indexOf('icons'), iTl = mods.indexOf('timeline'), iUi = mods.indexOf('ui');
  assert.ok(iIc >= 0 && iTl > iIc && iUi > iIc, `ORDER 应含 'icons' 且置于取用方 'timeline'/'ui' 之前（单文件包依赖拓扑），实得 ${mods.join(',')}`);
  assert.match(read('js/manual.js'), /import\s*\{\s*h,\s*iconHtml\s*\}\s*from\s*'\.\/ui\.js';/, 'manual.js 应从 ui.js 取 iconHtml');
});
