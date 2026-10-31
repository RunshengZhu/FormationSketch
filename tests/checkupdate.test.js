// build-72-checkupdate F2：「检查更新」按钮——随时可见的两处入口 + 强制刷新行为（node --test，无浏览器依赖）。
// 覆盖四组：
//   A 结构静态断言：编辑器顶栏 #btn-check-update（名册前、#topbar-scroll 滚动段内）与项目库首页
//     #btn-lib-check-update（.lib-actions 内、#btn-library-manual 旁）——btn ghost 同款样式 +
//     title「强制刷新页面到最新版本」+ data-icon="rotate"（⟳ 刷新图标）+ 标签 hide-mobile
//     （移动端收纯图标靠 title 兜底语义，C-09a）。
//   B 行为断言（main.js 导出的 forceReloadToLatest，mock navigator.serviceWorker/caches/location）：
//     SW+缓存壳全清（getRegistrations→unregister→caches.keys→caches.delete 全部先于 reload）、
//     无 SW 环境（HTTP 部署常态）直接 reload、清壳异常不阻断 reload（catch 兜底）。
//   C 接线断言：两入口同走 forceReloadToLatest（wireTopbar/wireLibrary 各一条），location.reload
//     单实现零复制。
//   D 项目库可达：#btn-lib-check-update 在 #library-view 节区内（首页可见的 DOM 前提）；
//     构建产物进包断言（spawn 构建后核 dist HTML）。
// 浏览器侧真实点击/刷新链路（iOS Safari 地址栏 reload 语义）由主会话实测覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const html = read('index.html');
const mainSrc = read('js/main.js');

const BTN_TITLE = '强制刷新页面到最新版本';

// ---------- A1：顶栏入口（名册前、滚动段内、ghost 同款 + 移动端收纯图标） ----------
test('A1 顶栏 #btn-check-update：名册前、#topbar-scroll 滚动段内、ghost+title+⟳ 图标+hide-mobile 标签', () => {
  const open = html.indexOf('<button id="btn-check-update" class="btn ghost" title="强制刷新页面到最新版本">');
  assert.ok(open > 0, '按钮存在：btn ghost 同款样式 + title（移动端纯图标时的语义兜底）');
  const close = html.indexOf('</button>', open);
  const blk = html.slice(open, close);
  assert.ok(blk.includes('data-icon="rotate"'), '刷新图标 data-icon="rotate"（⟳，图标库既有名，机器可读）');
  assert.ok(blk.includes('aria-hidden="true"'), '装饰图标 aria-hidden（语义由 title 兜底）');
  assert.ok(blk.includes('<span class="hide-mobile"> 检查更新</span>'), '桌面文字「检查更新」+ 移动端 hide-mobile 收纯图标（C-09a）');
  // 位置契约：theme 之后、roster 之前（名册旁，名册前），且在 #topbar-scroll 滚动段内（可达性照旧）
  const themeAt = html.indexOf('id="btn-theme"');
  const rosterAt = html.indexOf('id="btn-roster"');
  assert.ok(themeAt > 0 && themeAt < open && open < rosterAt, '次序：btn-theme → btn-check-update → btn-roster');
  const scrollOpen = html.indexOf('<div id="topbar-scroll">');
  const scrollClose = html.indexOf('<!-- /#topbar-scroll -->');
  assert.ok(open > scrollOpen && open < scrollClose, '在 #topbar-scroll 滚动段内（移动端横滚兜底覆盖，C-09a 口径）');
  assert.equal((html.match(/id="btn-check-update"/g) || []).length, 1, '顶栏入口恰一份');
});

// ---------- A2：项目库入口（.lib-header .lib-actions 内、说明书钮旁、同款同文案） ----------
test('A2 项目库 #btn-lib-check-update：.lib-actions 内、#btn-library-manual 旁、与顶栏同款', () => {
  const open = html.indexOf('<button id="btn-lib-check-update" class="btn ghost" title="强制刷新页面到最新版本">');
  assert.ok(open > 0, '按钮存在：同款 btn ghost + 同款 title');
  const close = html.indexOf('</button>', open);
  const blk = html.slice(open, close);
  assert.ok(blk.includes('data-icon="rotate"') && blk.includes('aria-hidden="true"'), '⟳ 图标同款');
  assert.ok(blk.includes('<span class="hide-mobile"> 检查更新</span>'), '标签同款（移动端收纯图标）');
  // 位置契约：.lib-actions 行内，导入/导出与说明书之间（说明书钮旁）
  const actionsAt = html.indexOf('<div class="lib-actions">');
  const actionsEnd = html.indexOf('</div>', actionsAt);
  const ioAt = html.indexOf('id="btn-lib-io"');
  const manualAt = html.indexOf('id="btn-library-manual"');
  assert.ok(actionsAt > 0 && open > actionsAt && open < actionsEnd, '在 .lib-actions 行内');
  assert.ok(ioAt > 0 && ioAt < open && open < manualAt, '次序：btn-lib-io → btn-lib-check-update → btn-library-manual（说明书旁）');
  assert.equal((html.match(/id="btn-lib-check-update"/g) || []).length, 1, '项目库入口恰一份');
});

// ---------- D：项目库视图可达（首页可见的 DOM 前提） ----------
test('D 项目库可达：#btn-lib-check-update 在 #library-view 节区内（.lib-header 随视图显隐，首页即见）', () => {
  const libAt = html.indexOf('id="library-view"');
  const libEnd = html.indexOf('</section>', libAt);
  const btnAt = html.indexOf('id="btn-lib-check-update"');
  assert.ok(libAt > 0 && btnAt > libAt && btnAt < libEnd, '入口在项目库节区内（library 视图可见即按钮可见）');
  const headAt = html.indexOf('<header class="lib-header">', libAt);
  const headEnd = html.indexOf('</header>', headAt);
  assert.ok(headAt > libAt && btnAt > headAt && btnAt < headEnd, '入口在 .lib-header 内（首页顶行，随时可见）');
});

// ---------- B：点击行为（forceReloadToLatest 调用序列，mock SW/caches/location） ----------
// main.js 顶层 PWA 注册守卫链：'serviceWorker' in navigator → location.protocol http 判定 →
// document manifest 门控。桩 navigator 不带 serviceWorker → 守卫在 location 前短路，
// 模块顶层零 DOM 访问，node 可安全 import（iomenu.test.js 同款先例）。
const navStub = {}; // 行为测试按用例挂/摘 navigator.serviceWorker
Object.defineProperty(globalThis, 'navigator', { value: navStub, configurable: true, writable: true });
const reloadCalls = [];
globalThis.location = { protocol: 'https:', reload: () => { reloadCalls.push('reload'); } };

const main = await import('../js/main.js');

function setup({ swRegs = null, cacheKeys = null, fail = null } = {}) {
  const events = [];
  reloadCalls.length = 0;
  delete globalThis.caches;
  delete navStub.serviceWorker;
  if (swRegs) {
    navStub.serviceWorker = {
      getRegistrations: async () => {
        if (fail === 'regs') throw new Error('stub getRegistrations failure');
        events.push('getRegistrations');
        return swRegs.map(name => ({ unregister: async () => { if (fail === 'unreg') throw new Error('stub unregister failure'); events.push(`unregister:${name}`); } }));
      },
    };
  }
  if (cacheKeys) {
    globalThis.caches = {
      keys: async () => {
        if (fail === 'keys') throw new Error('stub caches.keys failure');
        events.push('caches.keys');
        return cacheKeys;
      },
      delete: async k => { if (fail === 'del') throw new Error('stub caches.delete failure'); events.push(`caches.delete:${k}`); return true; },
    };
  }
  return events;
}

test('B1 SW+缓存壳场景：注销全部 SW → 删尽 Cache Storage → 最后才 reload（次序严格）', async () => {
  const events = setup({ swRegs: ['sw-a', 'sw-b'], cacheKeys: ['wuzhen-build-71-iomenu', 'other-v1'] });
  await main.forceReloadToLatest();
  assert.deepEqual(events, [
    'getRegistrations',
    'unregister:sw-a', 'unregister:sw-b',
    'caches.keys',
    'caches.delete:wuzhen-build-71-iomenu', 'caches.delete:other-v1',
  ], '清理序列：SW 注册表 → 逐个 unregister → 缓存名 → 逐个 delete');
  assert.deepEqual(reloadCalls, ['reload'], 'reload 恰一次，且在全部清理完成之后（await 语义保证）');
});

test('B2 无 SW/无 caches（HTTP 部署常态）：直接 reload，零探测零报错', async () => {
  const events = setup();
  await main.forceReloadToLatest();
  assert.deepEqual(events, [], '无 SW 无缓存壳 → 无任何清理动作（无网络探测/版本比对，极简语义）');
  assert.deepEqual(reloadCalls, ['reload'], '裸 reload 一次（no-cache+etag 即拉最新）');
});

test('B3 清壳异常不阻断刷新：getRegistrations/unregister/caches 拒绝仍 reload（catch 兜底）', async () => {
  for (const fail of ['regs', 'unreg', 'keys', 'del']) {
    setup({ swRegs: ['sw-x'], cacheKeys: ['k1'], fail });
    await main.forceReloadToLatest();
    assert.deepEqual(reloadCalls, ['reload'], `fail=${fail}：清理链任一步失败仍完成刷新（裸 reload 兜底）`);
  }
});

test('B4 仅 caches 无 SW：缓存壳照删（降级场景自洽）', async () => {
  const events = setup({ cacheKeys: ['stale-shell'] });
  await main.forceReloadToLatest();
  assert.deepEqual(events, ['caches.keys', 'caches.delete:stale-shell'], '无 SW 也清 caches（半残环境不留死壳）');
  assert.deepEqual(reloadCalls, ['reload']);
});

// ---------- C：接线（两入口同函数，单实现零复制） ----------
test('C 接线：wireTopbar/wireLibrary 各接一入口，同走 forceReloadToLatest；location.reload 单实现', () => {
  assert.match(mainSrc, /export async function forceReloadToLatest\(\)/, '实现导出（node 单测直测先例同 ioSource）');
  assert.match(mainSrc, /\$\('btn-check-update'\)\?\.addEventListener\('click', \(\) => \{ forceReloadToLatest\(\); \}\);/, '顶栏入口接线');
  assert.match(mainSrc, /\$\('btn-lib-check-update'\)\?\.addEventListener\('click', \(\) => \{ forceReloadToLatest\(\); \}\);/, '项目库入口接线');
  assert.equal((mainSrc.match(/\n  location\.reload\(\);/g) || []).length, 1, 'location.reload 全模块恰一处代码行（单实现非复制；注释提及不计）');
  assert.match(mainSrc, /navigator\.serviceWorker\?\.getRegistrations/, 'SW 判存守卫（HTTP 部署下 serviceWorker 缺省直接跳过）');
  assert.match(mainSrc, /caches\.keys\(\)/, '缓存壳清理：caches.keys');
  assert.match(mainSrc, /caches\.delete\(k\)/, '缓存壳清理：caches.delete');
});

// ---------- 构建产物：两入口进 dist 单文件包（build 号随版本推进） ----------
// build-91-varispeed 改写注明：build 号随版本推进 build-72-checkupdate → build-91-varispeed。
test('E dist 产物：#btn-check-update/#btn-lib-check-update 进包，build 号 build-91-varispeed', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-single.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `构建应成功：${r.stderr}`);
  const dist = read('dist/formation-studio.html');
  assert.ok(dist.includes('id="btn-check-update"') && dist.includes('id="btn-lib-check-update"'), '两入口进包');
  assert.match(dist, /forceReloadToLatest/, '实现进包');
  const BUILD = (mainSrc.match(/window\.__MAIN_BUILD\s*=\s*'([^']+)';/) || [])[1];
  assert.equal(BUILD, 'build-91-varispeed', 'main.js 版本号已 bump');
  assert.ok(dist.includes(`window.__MAIN_BUILD = '${BUILD}'`), 'dist 内嵌当前 build 号');
});

// build-79 白屏防线：dist bundle 必须能通过 classic 编译（new Function 只编译不执行）。
// 根因样本：build-78 nsKey 漏 video-recorder 映射 → 产物 `FS.video-recorder` 非法标识符
// → classic 整包语法错误 → 单文件版全平台白屏（源码模式 e2e 测不到，唯编译冒烟可挡）。
// build-86 白屏防线②：bundle 引用的 FS.<命名空间> 必须全部由 ORDER 预建——
// ORDER 漏项时 import 聚合照常、编译照常过，仅运行期解构 undefined（全平台白屏，mp3-encoder 实测）。
test('E3 dist 命名空间覆盖：bundle 引用的 FS.<ns> 全部由 ORDER 预建（漏项白屏防线）', () => {
  const dist = read('dist/formation-studio.html');
  const bundles = [...dist.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.length > 10000);
  const b = bundles.join('');
  const created = new Set([...b.matchAll(/FS\.(\w+) = FS\.\1 \|\| \{\};/g)].map(m => m[1]));
  const referenced = new Set([...b.matchAll(/FS\.(\w+)/g)].map(m => m[1]));
  const missing = [...referenced].filter(k => !created.has(k));
  assert.deepEqual(missing, [], `未预建的命名空间（ORDER 漏项，运行期白屏）: ${missing.join(', ')}`);
});
test('E2 dist bundle 编译冒烟：整包 classic 可编译（白屏防线）', () => {
  const dist = read('dist/formation-studio.html');
  const bundles = [...dist.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.length > 10000);
  assert.ok(bundles.length >= 1, 'bundle 脚本在场');
  for (const b of bundles) {
    assert.doesNotThrow(() => new Function(b), `bundle 必须可编译（长度 ${b.length}）`);
  }
  assert.ok(!/FS\.[\w$]*-/.test(bundles.join('')), '命名空间键全部为合法标识符（无连字符残留）');
});
