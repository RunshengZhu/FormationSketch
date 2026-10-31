// manual4.test.js —— build-59-manual4：说明书 v4（正文瘦身纯 user story + 附录承载板块详解 + 高清截图重拍）。
// 用户反馈（2026-09 二轮）：① 正文仍过于繁琐 → 每幕只留 story+steps+截图+延伸，板块卡片全部
//   后置；② 细节功能应放到每个功能模块的详细说明（章节后置）；③ 截图清晰度低 → v4 高清重拍。
// 五组断言：
//   F1 正文瘦身：manualOutline 每幕零板块字段、渲染源码幕内无板块小节、延伸行带「附录 A」引导、
//      manual.js 体积 ≤ 基线 build-57 13656B×1.2≈16387B（18 板块数据整体迁 js/manual-boards.js）；
//   F2 附录 A · 功能模块详解：渲染顺序（开场→五幕→附录A→附录B→数据与限制）+ 分组 details
//      默认收起（点击展开）+ summary 分组文案 + fig 引用跨组解析（→ 见第 N 幕图 M）；
//   F3 资产 v4：9 键对应 + manual-shots-v4.mjs 元数据 + 新体积预算（单张 ≤150KB、总 ≤900KB，
//      DPR2 高清口径，取代 manual2 的 v3 52KB/352KB 旧预算）；
//   F4 数据完整性：附录 A 18 板块分组与幕序一致（3/5/4/4/2）、板块字段齐备（与 manual3 既有
//      口径同源，此处钉「组序=幕序」与「数据在独立模块」）；
//   F5 构建包含：manual-boards 模块进包、附录 A 文案进包、build-59-manual4 进包。
// 改写注明：manual3.test.js 的幕内 boards 断言整体改写为附录 A 口径；manual2.test.js 体积预算
//   改写为 v4 新预算；manual.test.js generator 断言改写为 manual-shots-v4.mjs。
// 纯数据 + 源码/构建静态验证，无浏览器依赖（浏览器侧点击展开/滚动动线由主会话 C-09a 实测清单覆盖）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualOutline, manualBoardGroups, manualImageKeys, manualIntro } from '../js/manual.js';
import { MANUAL_IMAGES, MANUAL_META } from '../js/manual-assets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const kb = uri => Buffer.byteLength(uri.slice('data:image/jpeg;base64,'.length), 'base64');

// ---------- F1 正文瘦身 ----------
test('F1 正文无 boards：outline 每幕零板块字段，渲染源码幕内不再插入板块小节', () => {
  const outline = manualOutline();
  assert.equal(outline.length, 5, '五幕骨架不变');
  for (const a of outline) {
    assert.ok(!('boards' in a), `幕 ${a.id} 不应再有 boards 字段（板块详解后置附录 A）`);
    assert.ok(a.figs.length >= 1 && a.steps >= 3 && a.more, `幕 ${a.id} 正文=story+steps+图+延伸 仍齐备`);
  }
  const src = read('js/manual.js');
  assert.ok(!src.includes('boardsSection'), 'v3 的 boardsSection（幕内板块小节）应已退役');
  // 幕渲染循环体内不出现板块类（板块卡片只在 appendixBoards 里渲染）
  const loop = src.match(/ACTS\.forEach\(a => \{[\s\S]*?\}\);/);
  assert.ok(loop, '应能截取五幕渲染循环');
  assert.ok(!loop[0].includes('man-board'), '幕内渲染不应产出板块卡片');
  assert.match(src, /appendixBoards\(\)/, '附录 A 由 appendixBoards() 渲染');
});

test('F1 延伸行末尾引导附录 A：每幕 more 以「延伸：」开头且含「附录 A」', () => {
  for (const a of manualOutline()) {
    assert.ok(a.more.startsWith('延伸：'), `幕 ${a.id} 延伸行开头不变`);
    assert.ok(a.more.includes('附录 A'), `幕 ${a.id} 延伸行应引导「详见附录 A」`);
  }
});

test('F1 manual.js 体积 ≤ 基线 13656B×1.2≈16387B（板块数据已迁 js/manual-boards.js）', () => {
  const bytes = Buffer.byteLength(read('js/manual.js'));
  assert.ok(bytes <= 16387, `manual.js ${bytes}B 超 16387B 上限（基线 build-57 13656B×1.2；板块数据须留在 manual-boards.js）`);
  assert.ok(existsSync(join(root, 'js', 'manual-boards.js')), '附录 A 板块数据模块应存在');
  const boards = read('js/manual-boards.js');
  assert.match(boards, /export const BOARD_GROUPS/, 'manual-boards.js 应导出 BOARD_GROUPS（18 板块唯一数据源）');
  assert.match(read('js/manual.js'), /import \{ BOARD_GROUPS \} from '\.\/manual-boards\.js';/, 'manual.js 应静态 import 板块数据');
});

// ---------- F2 附录结构：顺序 + 收起 + 跨组 fig 引用 ----------
test('F2 渲染顺序：开场 → 五幕（纯 story）→ 附录 A → 附录 B → 数据与限制', () => {
  const src = read('js/manual.js');
  const iIntro = src.indexOf("'man-intro'");
  const iLoop = src.indexOf('ACTS.forEach(');
  const iA = src.indexOf('append(appendixBoards())'); // 渲染调用点（函数定义在五幕循环之前，不能用作顺序标记）
  const iB = src.indexOf("id: 'man-appendix-b'");
  const iLim = src.indexOf('数据与限制（诚实清单）');
  for (const [name, i] of [['man-intro', iIntro], ['acts', iLoop], ['appendix-a', iA], ['appendix-b', iB], ['limits', iLim]]) {
    assert.ok(i > 0, `渲染源码应含 ${name}`);
  }
  assert.ok(iIntro < iLoop && iLoop < iA && iA < iB && iB < iLim,
    `渲染顺序应为 开场→五幕→附录A→附录B→数据与限制，实得 ${iIntro},${iLoop},${iA},${iB},${iLim}`);
  assert.match(src, /附录 A · 功能模块详解/, '附录 A 标题');
  assert.match(src, /附录 B · 手势与快捷键速查/, '附录 B 标题（原「附录 · 手势与快捷键速查」改名前移）');
});

test('F2 附录 A 分组 details 默认收起（点击展开）：无 open 属性，summary 为幕分组文案', () => {
  const src = read('js/manual.js');
  assert.match(src, /h\('details', \{ class: 'man-boards' \}/, '附录 A 分组应为 details 且不带 open（默认收起，v3 幕内为 open:\'\'）');
  assert.ok(!/h\('details', \{ class: 'man-boards', open: '' \}/.test(src), '不应保留 v3 默认展开写法');
  assert.match(src, /第 \$\{g\.no\} 幕 · \$\{g\.title\} · \$\{g\.boards\.length\} 个板块/, 'summary 应为「第 N 幕 · 标题 · M 个板块」分组文案');
  // fig 引用跨组解析：板块不在幕内，figref 从「见本幕图 N」改为「见第 N 幕图 M」
  assert.match(src, /见第 \$\{g\.no\} 幕图 \$\{figNoOf\(g\.act, b\.fig\)\}/, 'figref 应指向对应幕的图号');
  const css = read('css/style.css');
  assert.match(css, /\.manual \.man-boards summary\{cursor:pointer/, 'summary 可点击样式（收起态的展开钮）');
  assert.match(css, /\.manual \.man-boards summary:hover\{color:var\(--fg\)\}/, '收起态 summary hover 强化（build-59 新增）');
});

test('F2 附录 A fig 引用全部命中对应幕截图（板块后置不新增/不重拍资产）', () => {
  const outline = manualOutline();
  for (const g of manualBoardGroups()) {
    const act = outline.find(a => a.id === g.act);
    assert.ok(act, `组 ${g.act} 应对应既有幕`);
    for (const b of g.boards) {
      if (b.fig) assert.ok(act.figs.includes(b.fig), `组 ${g.act} 板块「${b.name}」fig=${b.fig} 应是第 ${g.no} 幕截图键`);
    }
  }
  assert.equal(manualImageKeys().length, 9, '截图仍为 9 张（不重拍纪律）');
});

// ---------- F3 资产 v4：9 键对应 + 元数据 + 新体积预算 ----------
test('F3 资产 9 键对应 + v4 拍摄元数据（generator/annotated/count）', () => {
  const keys = manualImageKeys();
  assert.deepEqual(keys, ['align', 'export', 'formation-stage', 'index-music', 'music-clip-detail', 'music-edit', 'music-import', 'overview', 'rhythm-lane'], '9 键与 v3 镜头清单同源');
  const referenced = [...new Set([...manualOutline().flatMap(a => a.figs), manualIntro().fig])].sort();
  assert.deepEqual(keys, referenced, 'manualImageKeys 应恰为 outline figs ∪ intro fig（无孤儿资产）');
  // build-91-varispeed 改写注明：build-72 现状重拍 + v5 自适应标注（v4 DPR 恒定 ×2 巨箭头/遮挡退役）
  assert.equal(MANUAL_META.generator, 'manual-shots-v5.mjs', 'meta.generator 应为 v5 拍摄脚本（自适应标注重拍）');
  assert.equal(MANUAL_META.annotated, true, 'meta.annotated 应为 true（.ux-annot 视觉标注）');
  assert.equal(MANUAL_META.count, 9, 'meta.count 应为 9');
  for (const k of keys) {
    const uri = MANUAL_IMAGES[k];
    assert.ok(uri.startsWith('data:image/jpeg;base64,'), `${k} 应为 image/jpeg base64 data URI`);
    const bin = Buffer.from(uri.slice('data:image/jpeg;base64,'.length), 'base64');
    assert.deepEqual([...bin.subarray(0, 3)], [0xff, 0xd8, 0xff], `${k} 解码后应为 JPEG 魔数`);
  }
});

test('F3 高清新体积预算：单张 ≤150KB、总 ≤900KB（DPR2 口径，取代 v3 52KB/352KB 旧预算）', () => {
  const sizes = Object.entries(MANUAL_IMAGES).map(([k, uri]) => [k, kb(uri)]);
  assert.equal(sizes.length, 9, '九镜头');
  for (const [k, bytes] of sizes) assert.ok(bytes <= 150 * 1024, `${k} ${(bytes / 1024).toFixed(1)}KB 超单张 150KB 上限`);
  const total = sizes.reduce((a, [, b]) => a + b, 0);
  assert.ok(total <= 900 * 1024, `总体积 ${(total / 1024).toFixed(1)}KB 超 900KB 预算`);
  // 高清下限：2x 重拍后总体应显著大于 v3 旧预算的一半（防「清空资产骗预算」退化）
  assert.ok(total >= 300 * 1024, `总体积 ${(total / 1024).toFixed(1)}KB 异常偏小（v4 高清资产应远大于此）`);
});

// ---------- F4 数据完整性：附录 A 分组与幕序一致 ----------
test('F4 附录 A 18 板块分组与幕序一致（3/5/4/4/2），组 no/title 与五幕对齐', () => {
  const outline = manualOutline();
  const groups = manualBoardGroups();
  assert.equal(groups.length, 5, '附录 A 应按五幕分 5 组');
  assert.deepEqual(groups.map(g => g.act), outline.map(a => a.id), '组序=幕序');
  assert.deepEqual(groups.map(g => g.no), outline.map(a => a.no), '组幕号与幕序一致');
  assert.deepEqual(groups.map(g => g.title), outline.map(a => a.title), '组标题与幕标题一致');
  assert.deepEqual(groups.map(g => g.boards.length), [3, 5, 4, 4, 2], '分组板块数 3/5/4/4/2');
  assert.equal(groups.reduce((n, g) => n + g.boards.length, 0), 18, '全说明书恰 18 个板块（整体迁移，一字不改）');
});

// ---------- F5 构建包含 ----------
test('F5 构建包含：重建后 dist 含 manual-boards 模块/附录 A 文案/收起结构/build-59-manual4', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-single.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `构建应成功：${r.stderr}`);
  const html = read('dist/formation-studio.html');
  assert.ok(html.includes('module: manual-boards'), 'manual-boards 模块进包');
  assert.ok(html.includes('附录 A · 功能模块详解'), '附录 A 标题进包');
  assert.ok(html.includes('man-board-example'), '板块卡片渲染类进包');
  assert.ok(html.includes('个板块'), '附录 A 分组 summary 文案进包');
  assert.ok(!html.includes("class: 'man-boards', open"), '附录 A 不应带默认展开属性');
  // build-62-formations2 改写注明：build 号随版本推进（原 build-61-stageaspect），断言语义不变
  assert.match(html, /build-62-formations2/, 'build 号进包');
});
