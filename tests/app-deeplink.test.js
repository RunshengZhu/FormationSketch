// Phase 4 · 深链导入——node 可测层：URL 解析 / 参数剥离 / 同源https 分流 / 导入编排分流。
// 端到端（本地静态服务 + 断网 SW 带 query 打开）由 lab 探针 wuzhen-e2e-lab/probe-deeplink-import.mjs 覆盖。
// 直接 import js/main.js 的导出纯函数（浏览器专属副作用已判存守卫，Node 下不执行）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportParam, stripImportParam, resolveImportUrl, runDeeplinkImport } from '../js/main.js';
import { validateProject } from '../js/model.js';

const PAGE = 'http://localhost:8137/index.html';
const mkDeps = over => ({
  url: PAGE,
  baseUrl: PAGE,
  fetchImpl: async () => { throw new Error('no fetch configured'); },
  validate: validateProject,
  // 与 store.importProject 同语义（新建 id、标题加「（副本）」）——orchestrator 的 toast 取导入后标题
  importProject: p => { p.id = 'prj-fake'; p.meta = { ...p.meta, title: (p.meta?.title || '导入项目') + '（副本）' }; },
  onAudio: async () => {},
  toast: () => {},
  replaceState: () => {},
  ...over,
});
// 最小合法项目（v1）
const validProject = () => ({
  version: 1,
  meta: { title: '深链样例' },
  dancers: [{ id: 'd1', name: '一', short: '1', role: 'M' }],
  formations: [{ id: 'f1', name: '开场', color: '#64748b', positions: { d1: { x: 1, y: 1, facing: 0 } } }],
  timeline: { blocks: [{ formationId: 'f1', holdBeats: 16, travelBeats: 8 }] },
});

// ---------- parseImportParam ----------
test('DL-1 parse：编码 URL 解出原值（含嵌套 query/编码字符）', () => {
  const inner = 'https://files.example.com/p/wu.formation.json?a=1&b=2';
  const href = PAGE + '?import=' + encodeURIComponent(inner);
  assert.equal(parseImportParam(href), inner);
  const rel = '/files/demo.json';
  assert.equal(parseImportParam(PAGE + '?import=' + encodeURIComponent(rel)), rel);
});
test('DL-2 parse：无参数 / 空值 / 纯空白 / 无问号 → null（boot 静默跳过）', () => {
  assert.equal(parseImportParam(PAGE), null);
  assert.equal(parseImportParam(PAGE + '?import='), null);
  assert.equal(parseImportParam(PAGE + '?import=%20'), null);
  assert.equal(parseImportParam('import=x'), null, '无问号视为无 query');
  assert.equal(parseImportParam(''), null);
});
test('DL-3 parse：其他参数共存、hash 不混入值、import 空但带其他参数', () => {
  assert.equal(parseImportParam(PAGE + '?a=1&import=' + encodeURIComponent('/x.json')), '/x.json');
  assert.equal(parseImportParam(PAGE + '?import=' + encodeURIComponent('/x.json') + '#frag'), '/x.json');
});

// ---------- stripImportParam ----------
test('DL-4 strip：只摘 import，其余 query/hash 原样保留', () => {
  assert.equal(stripImportParam(PAGE + '?import=' + encodeURIComponent('/x.json')), '/index.html');
  assert.equal(stripImportParam(PAGE + '?a=1&import=' + encodeURIComponent('/x.json') + '&b=2#h'), '/index.html?a=1&b=2#h');
});
test('DL-5 strip：无参数原样返回；仅空 import 也摘净（不留 ?）', () => {
  assert.equal(stripImportParam(PAGE), PAGE);
  assert.equal(stripImportParam(PAGE + '?a=1'), PAGE + '?a=1');
  assert.equal(stripImportParam(PAGE + '?import='), '/index.html');
  assert.equal(stripImportParam('/apps/wuzhen/index.html?import=%2Fx.json'), '/apps/wuzhen/index.html');
});

// ---------- resolveImportUrl：安全分流 ----------
test('DL-6 分流：https 任意 host 放行；http 仅同源放行；相对地址按页面解析', () => {
  assert.equal(resolveImportUrl('https://cdn.example.com/a.json', PAGE)?.href, 'https://cdn.example.com/a.json');
  assert.equal(resolveImportUrl('http://localhost:8137/a.json', PAGE)?.href, 'http://localhost:8137/a.json');
  assert.equal(resolveImportUrl('/files/a.json', PAGE)?.href, 'http://localhost:8137/files/a.json');
  assert.equal(resolveImportUrl('../files/a.json', PAGE)?.href, 'http://localhost:8137/files/a.json');
});
test('DL-7 分流：跨源 http / data: / blob: / javascript: / 坏串 一律拒绝（不引入执行面）', () => {
  assert.equal(resolveImportUrl('http://evil.example.com/a.json', PAGE), null);
  assert.equal(resolveImportUrl('data:application/json,{"version":1}', PAGE), null);
  assert.equal(resolveImportUrl('javascript:alert(1)', PAGE), null);
  assert.equal(resolveImportUrl('blob:http://localhost:8137/x', PAGE), null);
  assert.equal(resolveImportUrl('file:///etc/a.json', PAGE), null);
  assert.equal(resolveImportUrl('https://[', PAGE), null, '无法解析的串 → 拒绝');
  // 相对引用语义（无害）： '::bad::' 是合法相对路径 → 解析为同源 URL，最终由 fetch 404 兜底
  assert.equal(resolveImportUrl('::bad::', PAGE)?.href, 'http://localhost:8137/::bad::');
});

// ---------- runDeeplinkImport：编排分流（依赖注入） ----------
test('DL-8 无 import 参数：status none，零副作用（不 fetch/不导入/不 replaceState/不 toast）', async () => {
  let calls = 0;
  const r = await runDeeplinkImport(mkDeps({
    fetchImpl: () => { calls++; }, importProject: () => { calls++; },
    replaceState: () => { calls++; }, toast: () => { calls++; },
  }));
  assert.deepEqual({ status: r.status, calls }, { status: 'none', calls: 0 });
});
test('DL-9 合法项目：fetch→validate→importProject 恰一次；replaceState 用剥参 URL；toast「已导入项目 X」', async () => {
  const got = { imported: [], toasts: [], replaced: [], fetched: [] };
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('http://localhost:8137/demo/deep.json'),
    fetchImpl: async u => { got.fetched.push(u); return { ok: true, status: 200, text: async () => JSON.stringify(validProject()) }; },
    importProject: p => { got.imported.push(p); p.meta = { ...p.meta, title: p.meta.title + '（副本）' }; },
    toast: m => got.toasts.push(m),
    replaceState: u => got.replaced.push(u),
  }));
  assert.equal(r.status, 'imported');
  assert.equal(r.hasAudio, false);
  assert.equal(got.fetched[0], 'http://localhost:8137/demo/deep.json');
  assert.equal(got.imported.length, 1);
  assert.ok(got.imported[0].dancers.length === 1 && got.imported[0].timeline.blocks.length === 1, 'validateProject 净化后对象被导入');
  assert.equal(got.replaced[0], '/index.html');
  assert.equal(got.toasts[0], '已导入项目：深链样例（副本）');
});
test('DL-10 v2 内嵌音乐：dataBase64 还原为 Blob 交给 onAudio，validate 前已剥离，toast 带音乐注记', async () => {
  const seen = { onAudio: [], imported: [] };
  const proj = { ...validProject(), version: 2, audio: { name: 'a.mp3', dataBase64: Buffer.from('abc').toString('base64'), dataFormat: 'audio/mpeg' } };
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('/v2.json'),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(proj) }),
    importProject: p => seen.imported.push(p),
    onAudio: async b => seen.onAudio.push(b),
    toast: () => {},
  }));
  assert.equal(r.status, 'imported');
  assert.equal(r.hasAudio, true);
  assert.equal(seen.onAudio[0].type, 'audio/mpeg');
  assert.ok(seen.onAudio[0].size > 0);
  assert.equal(seen.imported[0].audio.dataBase64, undefined, '内嵌字段不得进入项目记录');
  assert.equal(seen.imported[0].audio.name, 'a.mp3');
});
test('DL-11 404：错误 toast、不导入、仍清参（刷新不重报错）', async () => {
  const got = { imported: 0, toasts: [], replaced: [] };
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('/missing.json'),
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
    importProject: () => got.imported++,
    toast: m => got.toasts.push(m),
    replaceState: u => got.replaced.push(u),
  }));
  assert.equal(r.status, 'error');
  assert.equal(r.reason, 'http');
  assert.equal(r.httpStatus, 404);
  assert.equal(got.imported, 0);
  assert.match(got.toasts[0], /深链导入失败.*404/);
  assert.equal(got.replaced[0], '/index.html');
});
test('DL-12 非 JSON 文件：reason=parse，不导入，错误 toast', async () => {
  const got = { imported: 0, toasts: [] };
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('/bad.json'),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>404 page</html>' }),
    importProject: () => got.imported++,
    toast: m => got.toasts.push(m),
  }));
  assert.equal(r.reason, 'parse');
  assert.equal(got.imported, 0);
  assert.match(got.toasts[0], /不是合法 JSON/);
});
test('DL-13 校验不过（未知版本）：reason=validate，不导入，toast 带首个校验错误', async () => {
  const got = { imported: 0, toasts: [] };
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('/v99.json'),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ version: 99, meta: { title: 'x' } }) }),
    importProject: () => got.imported++,
    toast: m => got.toasts.push(m),
  }));
  assert.equal(r.reason, 'validate');
  assert.equal(got.imported, 0);
  assert.match(got.toasts[0], /深链导入失败/);
  assert.ok(r.errors.length >= 1);
});
test('DL-14 网络异常（断网/Reject）：reason=network，不导入不 crash', async () => {
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('/a.json'),
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  }));
  assert.equal(r.status, 'error');
  assert.equal(r.reason, 'network');
});
test('DL-15 非法 scheme（跨源 http / data:）：在 fetch 前拒绝，fetch 一次都不发生', async () => {
  let fetched = 0;
  const r = await runDeeplinkImport(mkDeps({
    url: PAGE + '?import=' + encodeURIComponent('http://evil.example.com/a.json'),
    fetchImpl: async () => { fetched++; return { ok: true, status: 200, text: async () => '{}' }; },
  }));
  assert.equal(r.reason, 'scheme');
  assert.equal(fetched, 0);
});
test('DL-16 契约优先级锚点：深链 URL 形态端到端编码往返（publish.mjs 依赖此形态）', () => {
  const jsonUrl = 'https://host.example/apps/wuzhen-rel/v2/%E8%88%9E.formation.json?token=abc';
  const link = '/apps/wuzhen/index.html?import=' + encodeURIComponent(jsonUrl);
  assert.equal(parseImportParam(link), jsonUrl, '编码→解析无损（含中文路径与 token query）');
  assert.equal(stripImportParam(link), '/apps/wuzhen/index.html');
});
