// 极简单文件打包：把 index.html + css + 全部 JS 模块合并为一个可直接双击打开的 HTML；
// 同时产出 PWA 双文件包的另一半 dist/sw.js（离线缓存应用 HTML）。
// 用法：node scripts/build-single.mjs
//   → 产物 dist/formation-studio.html（应用本体，内联 manifest data-URI 与 SW 注册守卫）
//          dist/sw.js（Service Worker，缓存名 wuzhen-<__MAIN_BUILD>，随应用版本换新）
// 下载版时间戳副本（FormationStudio-vX.Y.Z-test.YYYYMMDD.html）由发布步骤另行拷贝，本脚本不触碰。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'dist', 'formation-studio.html');
const OUT_SW = join(root, 'dist', 'sw.js');

// 依赖拓扑序（被依赖者在前）
const ORDER = ['model', 'shapes', 'store', 'audio', 'player', 'gesture', 'stage', 'timeline', 'export', 'ui', 'main'];
// 'export' 是保留字，命名空间键用 exporter
const nsKey = mod => (mod === 'export' ? 'exporter' : mod);

function transformModule(mod) {
  const file = join(root, 'js', `${mod}.js`);
  let code = readFileSync(file, 'utf8');
  const NS = `FS.${nsKey(mod)}`;
  const prelude = [];
  const exportNames = [];

  // 1) 聚合 import：import * as X from './y.js' / import { A, B as C } from './y.js'
  const nsAliases = new Map(); // alias -> source
  const namedBySource = new Map(); // source -> Map(localName -> importedName)
  code = code.replace(/^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'\.\/([\w]+)\.js';?\s*$/gm,
    (m, starName, named, src) => {
      const key = nsKey(src);
      if (starName) nsAliases.set(starName, key);
      else {
        if (!namedBySource.has(key)) namedBySource.set(key, new Map());
        for (const spec of named.split(',')) {
          const t = spec.trim();
          if (!t) continue;
          const [imp, local = imp] = t.split(/\s+as\s+/);
          namedBySource.get(key).set(local.trim(), imp.trim());
        }
      }
      return `/* import from ${src} */`;
    });

  for (const [alias, key] of nsAliases) prelude.push(`const ${alias} = FS.${key};`);
  for (const [key, map] of namedBySource) {
    const specs = [...map.entries()].map(([local, imp]) => (local === imp ? imp : `${imp}: ${local}`)).join(', ');
    prelude.push(`const { ${specs} } = FS.${key};`);
  }

  // 2) 去掉 export 前缀，收集导出名（含 async function）
  code = code.replace(/^export\s+(async\s+function|function\*?|const|class)\s+(\w+)/gm, (m, kind, name) => {
    exportNames.push(name);
    return `${kind} ${name}`;
  });
  code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

  // 3) 组装 IIFE
  const assigns = exportNames.length ? `Object.assign(${NS}, { ${exportNames.join(', ')} });` : '';
  return `${NS} = FS.${nsKey(mod)} || {};\n(function(){\n'use strict';\n${prelude.join('\n')}\n${code}\n${assigns}\n})();`;
}

// ---- PWA 素材：build 号与图标（base64 常量，由 lab chromium canvas 一次性生成） ----
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const BUILD = (mainSrc.match(/window\.__MAIN_BUILD\s*=\s*'([^']+)';/) || [])[1];
if (!BUILD) throw new Error('未能从 js/main.js 解析 window.__MAIN_BUILD，sw.js 缓存名无法随之换版');

const ICON_FILE = join(root, 'scripts', 'icon-base64.json');
let icons = null;
if (existsSync(ICON_FILE)) {
  try { icons = JSON.parse(readFileSync(ICON_FILE, 'utf8')); } catch { icons = null; }
}
if (!icons || !icons[192] || !icons[512]) {
  icons = null;
  console.warn('[build] 缺少 scripts/icon-base64.json（192/512 base64），manifest 将不含图标（不影响离线能力，仅影响安装提示）');
}

// manifest 以 data-URI 内联进应用 HTML：托管侧无需第三个文件；
// 相对 start_url 在 data-URI 下由 Chromium 回退为文档 URL（实测解析零报错，见 PWA 验证报告）。
function manifestJson() {
  const m = {
    name: '舞阵 WuZhen',
    short_name: '舞阵',
    description: '舞蹈队形编排与音乐对齐',
    display: 'standalone',
    start_url: './',
    scope: './',
    theme_color: '#0f172a',
    background_color: '#0f172a',
    icons: [
      { src: `data:image/png;base64,${icons[192]}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `data:image/png;base64,${icons[512]}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  if (!icons) delete m.icons;
  return JSON.stringify(m);
}
const MANIFEST_LINK = icons
  ? `<link rel="manifest" href="data:application/manifest+json,${encodeURIComponent(manifestJson())}">`
  : '';

// dist/sw.js：极简 Service Worker——缓存对象只有页面自身。
// 策略：页面导航缓存优先、网络回写更新（stale-while-revalidate）；新版本经
// skipWaiting + clients.claim 立即接管，下次加载即新版；activate 清掉旧版缓存。
//
// 深链契约（Phase 4，与 skill 线 publish.mjs 约定）：
//   GET /apps/wuzhen/index.html?import=<encodeURIComponent(项目 JSON 的完整 URL)>
// 带 query 的导航必须离线可用：match(req,{ignoreSearch:true}) 先按去参 URL 命中，
// 再以 cache.match('./') 兜底目录/子路径形态——断网点开 ?import=… 深链仍能拿到页面本体
// （JSON 本体走网络，离线时由应用内失败路径 toast 提示，不 crash）。
function swSource() {
  return `/* 舞阵 WuZhen Service Worker —— 由 scripts/build-single.mjs 生成，勿手改。
   缓存名随应用 build 号换版：发新版 → 新 sw.js 字节 → 安装预缓存新 HTML →
   skipWaiting + clients.claim 立即接管 → activate 清理旧缓存。缓存对象只有页面自身。
   深链契约：/apps/wuzhen/index.html?import=<encodeURIComponent(JSON URL)> ——
   导航 match 带 ignoreSearch:true + './' 回退，带 query 的深链离线可开。 */
const CACHE = 'wuzhen-${BUILD}';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode !== 'navigate') return; // 只接管页面导航；子资源/下载直连网络
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./'));
    const refresh = fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        // 双写：请求 URL 形态与目录形态各存一份，两种托管路径都能命中
        cache.put('./', copy);
        if (new URL(req.url).pathname !== new URL('./', self.registration.scope).pathname) cache.put(req.url, copy);
      }
      return res;
    }).catch(() => null);
    if (cached) return cached; // 缓存优先：立即返回；refresh 在后台回写最新版
    const net = await refresh; // 首次无缓存：等网络
    return net || new Response('舞阵：离线且本地缓存为空', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
`;
}

// ---- 组装 ----
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');

// 深链契约（Phase 4 · 与 dancesport-choreo skill 线 publish.mjs 的约定，写入产物注释）：
//   链接形态  /apps/wuzhen/index.html?import=<encodeURIComponent(项目 JSON 的完整 https 同源/https URL)>
//   行为      打开即 fetch 该 URL → JSON → validateProject → importProject（新建 id + 标题加「（副本）」，
//             不覆盖既有项目）→ 清掉 import 参数（刷新不重导入）→ toast「已导入项目 X」；
//             失败（404/非 JSON/校验不过/断网）toast 明确错误，正常进应用，不 crash。
//   优先级    显式 import 深链 > lastProject 自动恢复。音乐：v2 内嵌 dataBase64 会被还原回填。
// 生成侧注意：SW 对带 query 的导航 match({ignoreSearch:true}) + './' 回退，深链离线可开（见 swSource）。

let bundle = `/* Formation Studio 单文件版 —— 由 scripts/build-single.mjs 生成，勿手改
   深链契约（Phase 4）：/apps/wuzhen/index.html?import=<encodeURIComponent(项目 JSON 的 URL)>
   打开即导入（同源或 https；新建副本 id 不覆盖既有项目；query 用后即清）。
   由 runDeeplinkImport（main 模块）实现，publish.mjs 按此形态产出深链。 */
window.FS = window.FS || {};
`;
for (const mod of ORDER) {
  bundle += `\n/* ===== module: ${mod} ===== */\n`;
  bundle += `FS.${nsKey(mod)} = FS.${nsKey(mod)} || {};\n`;
  bundle += transformModule(mod);
  bundle += `\n`;
}
if (/<\/script>/i.test(bundle)) throw new Error('bundle 中含有 </script>，需转义');

html = html.replace('<link rel="stylesheet" href="css/style.css">', `${MANIFEST_LINK}<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>', `<script>\n${bundle}\n</script>`);
if (html.includes('css/style.css') || html.includes('js/main.js')) throw new Error('仍有外部资源引用未替换');
if (icons && !html.includes('rel="manifest"')) throw new Error('manifest 注入失败');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
writeFileSync(OUT_SW, swSource());
console.log(`已生成 ${OUT}（${(html.length / 1024).toFixed(1)} KB，build ${BUILD}，manifest=data-URI${icons ? '+icons' : '-icons'}）`);
console.log(`已生成 ${OUT_SW}（${(swSource().length / 1024).toFixed(1)} KB，缓存 wuzhen-${BUILD}）`);
console.log('深链契约：/apps/wuzhen/index.html?import=<encodeURIComponent(项目 JSON URL)>');
