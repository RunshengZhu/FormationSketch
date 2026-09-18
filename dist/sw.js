/* 舞阵 WuZhen Service Worker —— 由 scripts/build-single.mjs 生成，勿手改。
   缓存名随应用 build 号换版：发新版 → 新 sw.js 字节 → 安装预缓存新 HTML →
   skipWaiting + clients.claim 立即接管 → activate 清理旧缓存。缓存对象只有页面自身。
   深链契约：/apps/wuzhen/index.html?import=<encodeURIComponent(JSON URL)> ——
   导航 match 带 ignoreSearch:true + './' 回退，带 query 的深链离线可开。 */
const CACHE = 'wuzhen-build-29-tags';

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
