// PWA 双文件包构建与 SW 注册守卫的静态验证（node --test，无浏览器依赖）。
// 浏览器侧真实离线/降级行为由 lab run-offline.mjs 覆盖（真实 Chromium + setOffline），
// 本文件只测构建产物与源码守卫这些可静态断言的项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const BUILD = (mainSrc.match(/window\.__MAIN_BUILD\s*=\s*'([^']+)';/) || [])[1];

test('js/main.js 携带 SW 注册守卫：http(s) 协议判定 + manifest 门控 + 失败静默', () => {
  // 注册调用本身
  assert.match(mainSrc, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/, '应注册 ./sw.js（相对页面目录）');
  // 硬性要求：注册失败被静默吞掉（catch 空函数），file:// 等场景零影响
  assert.match(mainSrc, /register\('\.\/sw\.js'\)\.catch\(\(\)\s*=>\s*\{\}\)/, 'register 失败必须 .catch(() => {}) 静默');
  // 守卫条件 1：仅 http(s)（file:// 下载版一行不执行）
  assert.match(mainSrc, /location\.protocol\.indexOf\('http'\)\s*===\s*0/, '协议守卫：仅 http(s) 注册');
  // 守卫条件 2：页面带 PWA manifest link（dist 构建注入；dev 源码树无 → 不注册，console 零噪音）
  assert.match(mainSrc, /querySelector\('link\[rel="manifest"\]'\)/, 'manifest 门控：仅 dist 双文件包注册');
  // 守卫条件 3：能力检测
  assert.match(mainSrc, /'serviceWorker' in navigator/, '能力检测守卫');
});

test('缓存名规则 = wuzhen-<__MAIN_BUILD>，随应用版本换新', () => {
  assert.ok(BUILD, 'main.js 应定义 window.__MAIN_BUILD');
  const sw = readFileSync(join(root, 'dist', 'sw.js'), 'utf8');
  assert.ok(sw.includes(`const CACHE = 'wuzhen-${BUILD}';`), `sw.js 缓存名应为 wuzhen-${BUILD}`);
  assert.doesNotMatch(sw, /__MAIN_BUILD/, 'sw.js 不得残留未替换的占位符');
});

test('build-single.mjs 产出 dist/sw.js：极简策略（预缓存页面 + 缓存优先/回写更新 + 立即接管 + 清旧缓存）', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-single.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `构建应成功：${r.stderr}`);
  const sw = readFileSync(join(root, 'dist', 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('install'/, 'install：预缓存');
  assert.ok(sw.includes("addAll(['./'])"), '预缓存对象为页面自身（相对路径 ./）');
  assert.match(sw, /skipWaiting\(\)/, '新版本立即激活');
  assert.match(sw, /clients\.claim\(\)/, '接管已打开页面');
  assert.match(sw, /addEventListener\('activate'/, 'activate：清旧缓存');
  assert.match(sw, /caches\.delete\(k\)/, '清理非当前版本缓存');
  assert.match(sw, /req\.mode !== 'navigate'\s*\)\s*return/, 'fetch 只接管页面导航，其余直连');
  assert.match(sw, /cache\.match\(req, \{ ignoreSearch: true \}\)/, '缓存优先：命中即返回');
  assert.ok(sw.includes("cache.put('./', copy)"), '网络回写更新缓存');
  assert.match(sw, /caches\.open\(CACHE\)/, '');
  assert.ok(!sw.includes('</' + 'script>'), 'sw.js 不得含 </script>');
});

test('dist/formation-studio.html 内联 data-URI manifest（名称/形态/颜色/图标齐全）', () => {
  const html = readFileSync(join(root, 'dist', 'formation-studio.html'), 'utf8');
  const m = html.match(/<link rel="manifest" href="data:application\/manifest\+json,([^"]+)">/);
  assert.ok(m, 'head 中应有 data-URI manifest link');
  const manifest = JSON.parse(decodeURIComponent(m[1]));
  assert.equal(manifest.name, '舞阵 WuZhen');
  assert.equal(manifest.short_name, '舞阵');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#0f172a');
  assert.equal(manifest.background_color, '#0f172a');
  const sizes = manifest.icons.map(i => i.sizes);
  assert.deepEqual(sizes.sort(), ['192x192', '512x512']);
  for (const i of manifest.icons) {
    assert.match(i.src, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/, '图标应为内联 PNG base64');
    assert.equal(i.type, 'image/png');
  }
  // 图标 base64 与 scripts/icon-base64.json 一致（单一事实源）
  const icons = JSON.parse(readFileSync(join(root, 'scripts', 'icon-base64.json'), 'utf8'));
  assert.equal(manifest.icons[0].src, `data:image/png;base64,${icons[192]}`);
  assert.equal(manifest.icons[1].src, `data:image/png;base64,${icons[512]}`);
});

test('dist HTML 携带应用本体的注册守卫与版本号；下载时间戳副本不被触碰', () => {
  const html = readFileSync(join(root, 'dist', 'formation-studio.html'), 'utf8');
  assert.ok(html.includes(`window.__MAIN_BUILD = '${BUILD}'`), 'dist 内嵌当前 build 号');
  assert.match(html, /location\.protocol\.indexOf\('http'\)\s*===\s*0/, 'bundle 内含协议守卫');
  assert.match(html, /register\('\.\/sw\.js'\)\.catch\(\(\)\s*=>\s*\{\}\)/, 'bundle 内含静默注册');
});

test('构建确定性：连跑两次产物字节一致（缓存名稳定，不产生假新版本）', () => {
  const before = {
    html: readFileSync(join(root, 'dist', 'formation-studio.html')),
    sw: readFileSync(join(root, 'dist', 'sw.js')),
  };
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-single.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = {
    html: readFileSync(join(root, 'dist', 'formation-studio.html')),
    sw: readFileSync(join(root, 'dist', 'sw.js')),
  };
  assert.deepEqual(before, after);
});
