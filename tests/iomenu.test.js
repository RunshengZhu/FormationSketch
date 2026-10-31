// build-71-iomenu F3：顶栏「导入/导出」统一菜单 + 保存覆盖（node --test，无浏览器依赖）。
// 覆盖三组：
//   A 菜单结构静态断言：顶栏按钮改名（#btn-export id 保留）、#app 级共享 #io-menu（两视图
//     可见——顶栏在 #editor-view 内、项目库无顶栏，hidden 祖先会连 fixed 后代一起隐藏）、
//     root=保存覆盖（条件条目）→ 从项目文件导入… → 导出 ▸ 子菜单五项、项目库 #btn-lib-io
//     同款入口共用同一菜单组件、保存覆盖条件显隐接线。
//   B 保存覆盖写入逻辑（export.js 纯层，mock handle）：writeProjectToHandle 的
//     createWritable→write→close 调用次序与写入内容（与导出下载同一 buildProjectFile 组装）。
//   C 导入编排/会话态（main.js 导出 DI 纯函数）：importProjectFile 编排与 hadAudio 派生、
//     markIoSource/isIoDirty 基线比对、saveBackToSourceFile 分流（no-handle/clean/cancelled/
//     saved，含乐按原文件决定、写回后 rebaseline）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjectFile, writeProjectToHandle, readProjectFile } from '../js/export.js';
import { ioSource, markIoSource, clearIoSource, isIoDirty, importProjectFile, saveBackToSourceFile } from '../js/main.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const html = read('index.html');
const mainSrc = read('js/main.js');
const cssSrc = read('css/style.css');
const expSrc = read('js/export.js');

// ---------- A1：顶栏按钮改名 + 旧 id 保留 ----------
test('A1 顶栏钮「导入/导出 ▾」（#btn-export id 保留，#export-dd 容器保留减少接线搬迁）', () => {
  assert.match(html, /<button id="btn-export" class="btn ghost">导入\/导出 ▾<\/button>/, '顶栏按钮文案改为导入/导出');
  assert.match(html, /<div class="dropdown" id="export-dd">/, '#export-dd 容器 id 保留');
  assert.ok(!/<div class="dd-menu"[^>]*>\s*<button id="exp-png"/.test(html), '旧「菜单内联在 #export-dd 里」的结构不再在');
});

// ---------- A2：#app 级共享菜单（两视图可见的结构前提） ----------
test('A2 #io-menu 为 #app 级共享（在 library/editor 两个 .view 节区之外）', () => {
  const at = html.indexOf('id="io-menu"');
  assert.ok(at > 0, '#io-menu 存在');
  const lastSectionEnd = html.lastIndexOf('</section>');
  assert.ok(at > lastSectionEnd, '#io-menu 在全部 .view 节区之后（#app 直接子级）——否则 hidden 祖先连 fixed 后代一起隐藏，项目库不可见');
  assert.match(html, /<div class="dd-menu" id="io-menu" hidden>/, '沿用 dd-menu 外观类 + 默认收起');
});

// ---------- A3：root 结构（保存覆盖→导入→导出▸子菜单五项） ----------
test('A3 root 结构：保存覆盖（默认 hidden）→ 从项目文件导入… → 导出 ▸ 子菜单（五项次序保留）', () => {
  const mStart = html.indexOf('id="io-menu"');
  const mEnd = html.indexOf('<!-- 弹窗与提示 -->', mStart);
  const blk = html.slice(mStart, mEnd);
  const saveAt = blk.indexOf('id="save-back"');
  const impAt = blk.indexOf('id="imp-json"');
  const subBtnAt = blk.indexOf('id="exp-sub-toggle"');
  const subAt = blk.indexOf('id="exp-submenu"');
  assert.ok(saveAt > 0 && impAt > saveAt && subBtnAt > impAt && subAt > subBtnAt,
    'root 次序：保存覆盖（F2 条目，置首）→ 从项目文件导入… → 导出 ▸ → 子菜单容器');
  assert.match(blk, /<button id="save-back" hidden /, '保存覆盖条目默认 hidden（条件显隐）');
  assert.match(blk, /<button id="imp-json">从项目文件导入…<\/button>/, 'root 导入项文案');
  assert.match(blk, /id="exp-submenu" hidden>/, '子菜单默认收起');
  const ids = ['exp-png', 'exp-video', 'exp-audio', 'exp-print', 'exp-json-audio', 'exp-json'];
  let prev = subAt;
  for (const id of ids) {
    const at = blk.indexOf(`id="${id}"`, prev);
    assert.ok(at > prev, `子菜单项 ${id} 在导出子菜单内且次序保持`);
    prev = at;
  }
  assert.match(blk, /<button id="exp-json">导出项目文件（不含音乐）<\/button>\s*<\/div>\s*<\/div>\s*$/, '子菜单五项后闭合（无旧「导入项目文件…」残留在导出组）');
  assert.ok(!blk.includes('导入项目文件…'), '旧文案「导入项目文件…」不再出现（改为 root「从项目文件导入…」）');
});

// ---------- A4：项目库可见性（同款入口共用同一菜单组件） ----------
test('A4 项目库 #btn-lib-io 在 .lib-header 内，与顶栏共用 #io-menu（单组件非复制）', () => {
  const libAt = html.indexOf('id="library-view"');
  const libEnd = html.indexOf('</section>', libAt);
  const btnAt = html.indexOf('id="btn-lib-io"');
  assert.ok(btnAt > libAt && btnAt < libEnd, '#btn-lib-io 在项目库节区内（.lib-actions 行）');
  assert.match(html, /<button id="btn-lib-io" class="btn ghost">导入\/导出 ▾<\/button>/, '项目库同款「导入/导出 ▾」文案');
  // 接线：两入口同组件（main.js openIoMenu 以触发钮为锚摆位）
  assert.match(mainSrc, /const menu = \$\('io-menu'\);/, '菜单组件唯一来源 #io-menu');
  assert.match(mainSrc, /openIoMenu\(\$\(\'btn-export\'\)\)/, '编辑器顶栏入口接线');
  assert.match(mainSrc, /openIoMenu\(\$\(\'btn-lib-io\'\)\)/, '项目库入口接线');
  assert.ok((html.match(/id="io-menu"/g) || []).length === 1, '菜单组件恰一份（非每视图复制）');
});

// ---------- A5：保存覆盖条件显隐 + 导入句柄路径接线 ----------
test('A5 保存覆盖条件显隐接线 + showOpenFilePicker 优先/降级 + 换项目清句柄', () => {
  assert.match(mainSrc, /function syncSaveBackItem\(\)/, 'syncSaveBackItem 在');
  assert.match(mainSrc, /b\.hidden = !\(ioSource\.handle && p && isIoDirty\(p\)\);/, '显隐条件=有句柄且有项目且已修改');
  assert.match(mainSrc, /syncSaveBackItem\(\);    \/\/ build-71-iomenu F2：保存覆盖条目条件显隐/, '开菜单即刷新显隐');
  assert.match(mainSrc, /typeof window\.showOpenFilePicker === 'function'/, 'Chromium 句柄路径优先');
  assert.match(mainSrc, /e\?\.name === 'AbortError'\) return;/, '用户取消选择器静默');
  assert.match(mainSrc, /await doImport\(inp\.files\[0\], null\);/, 'Safari/旧浏览器降级 input 路径（无句柄）');
  assert.ok(mainSrc.split('clearIoSource()').length >= 4, '换项目三路径清句柄（新建/库打开/深链导入）——防旧句柄写错文件');
  assert.match(mainSrc, /markIoSource\(handle, file\.name, r\.hadAudio, store\.getState\(\)\.project\);/, '导入成功记来源（句柄/文件名/原文件有无音乐/基线）');
  // 两视图可见的连带：项目库（无打开项目）导出组禁用——防 null project 导出项 TypeError
  assert.match(mainSrc, /const hasProj = !!store\.getState\(\)\.project;/, '开菜单判项目在否');
  assert.match(mainSrc, /'exp-audio', 'exp-png', 'exp-print', 'exp-json-audio', 'exp-json', 'exp-sub-toggle'/, '导出组（含子菜单开关）无项目时禁用；导入/保存覆盖不受限');
});

// ---------- A6：CSS（fixed 摆位随迁 + 子菜单缩进） ----------
test('A6 CSS：#io-menu fixed+z-index 200（自 #export-dd .dd-menu 随迁）+ 子菜单缩进', () => {
  assert.match(cssSrc, /#io-menu\{position:fixed;z-index:200\}/, 'fixed 摆位契约在（不受滚动容器裁切）');
  assert.ok(!/#export-dd \.dd-menu\{/.test(cssSrc), '旧选择器退役（菜单已迁出 #export-dd）');
  assert.match(cssSrc, /#exp-submenu button\{padding-left:26px\}/, '二级子菜单层级缩进');
  assert.match(cssSrc, /#exp-sub-toggle::after\{content:' ▸'\}/, '子菜单展开指示符');
});

// ---------- B1：buildProjectFile 组装（含乐/不含乐） ----------
const mkProject = () => ({
  id: 'prj-x', // cloneBasic 应剥掉
  version: 1,
  meta: { title: '覆盖样例' },
  dancers: [{ id: 'd1', name: '一', short: '1', role: 'M' }],
  formations: [{ id: 'f1', name: '开场', color: '#64748b', positions: { d1: { x: 1, y: 1, facing: 0 } } }],
  timeline: { clips: [] },
  audio: { name: '' },
  media: { assets: [] },
});
const mkBlob = bytes => new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' });

test('B1 buildProjectFile：不含乐=v1 无 dataBase64；含乐（legacy blob）=v2 内嵌 audio.dataBase64', async () => {
  const p = mkProject();
  const noAudio = await buildProjectFile(p, null, { assets: null });
  assert.equal(noAudio.withAudio, false);
  const j1 = JSON.parse(noAudio.text);
  assert.equal(j1.version, 1);
  assert.ok(!j1.audio?.dataBase64, '不含乐无内嵌音频');
  assert.ok(!('id' in j1), 'cloneBasic 剥 id（与导出下载同构）');
  assert.equal(noAudio.bytes, Buffer.byteLength(noAudio.text), 'bytes=文本字节数');

  const blob = mkBlob([1, 2, 3, 4]);
  const withAudio = await buildProjectFile(p, blob, { assets: null });
  assert.equal(withAudio.withAudio, true);
  const j2 = JSON.parse(withAudio.text);
  assert.equal(j2.version, 2);
  assert.ok(j2.audio?.dataBase64, 'legacy 单音频内嵌');
  assert.equal(j2.audio.dataFormat, 'audio/mpeg');
});

test('B1b buildProjectFile：v3 多资产内嵌（assets 带 blob）+ withAudio 判定', async () => {
  const p = mkProject();
  p.media.assets = [{ id: 'a1', name: '曲一' }];
  const assets = [{ id: 'a1', name: '曲一', blob: mkBlob([9, 9]) }];
  const r = await buildProjectFile(p, null, { assets });
  assert.equal(r.withAudio, true);
  const j = JSON.parse(r.text);
  assert.equal(j.media.assets[0].dataBase64, Buffer.from([9, 9]).toString('base64'), '资产 blob 内嵌');
  // 缺 blob 的资产：仅元数据随行，不算含乐
  const r2 = await buildProjectFile(p, null, { assets: [{ id: 'a1', name: '曲一', blob: null }] });
  assert.equal(r2.withAudio, false);
});

// ---------- B2：writeProjectToHandle（mock handle 写入调用与内容） ----------
test('B2 writeProjectToHandle：createWritable→write→close 次序，写入内容=组装 JSON（含乐内嵌）', async () => {
  const calls = [];
  let written = null;
  const handle = {
    kind: 'file', name: '样例.formation.json',
    createWritable: async () => ({
      write: async b => { calls.push('write'); written = b; },
      close: async () => { calls.push('close'); },
    }),
  };
  const p = mkProject();
  const r = await writeProjectToHandle(handle, p, mkBlob([5, 6, 7]), {});
  assert.deepEqual(calls, ['write', 'close'], '写后必关（close 缺失=句柄泄漏）');
  assert.equal(r.ok, true);
  assert.equal(r.withAudio, true);
  assert.ok(written instanceof Blob, '写入 Blob');
  const j = JSON.parse(await written.text());
  assert.equal(j.meta.title, '覆盖样例');
  assert.equal(j.version, 2);
  assert.ok(j.audio.dataBase64, '写回内容含内嵌音乐（与导出下载同一组装层）');
  assert.ok(!('id' in j), '写回剥 id');
});

// ---------- C1：importProjectFile 编排（DI） ----------
const mkFileStub = (text, name = '样例.formation.json') => ({ name, text: async () => text });

test('C1 importProjectFile：读→导入→音乐回填→返回 hadAudio；失败路径 toast 明确错误', async () => {
  const seq = [];
  let imported = null, restoredWith = null;
  const deps = {
    readFile: async f => {
      seq.push('read');
      return { project: mkProject(), audioBlob: mkBlob([1]), assetBlobs: [] };
    },
    importProject: p => { seq.push('import'); imported = p; },
    restoreAudio: async (a, b) => { seq.push('restore'); restoredWith = { a, b }; return true; },
    toast: msg => seq.push(`toast:${msg.slice(0, 6)}`),
  };
  const r = await importProjectFile(mkFileStub('{}'), deps);
  assert.equal(r.status, 'ok');
  assert.equal(r.hadAudio, true, '有音频 → hadAudio=true（保存覆盖含乐依据）');
  assert.deepEqual(seq, ['read', 'import', 'restore', 'toast:导入成功（音'], '次序：读→导入→回填→提示');
  assert.ok(imported, '导入被调用');
  assert.ok(restoredWith, '回填被调用');

  // 失败路径：readFile 抛错 → toast「导入失败：…」+ status=error，不抛出
  const toasts = [];
  const r2 = await importProjectFile(mkFileStub('{}'), {
    readFile: async () => { throw new Error('不是合法的 JSON 文件'); },
    importProject: () => { throw new Error('不应到达'); },
    restoreAudio: async () => true,
    toast: m => toasts.push(m),
  });
  assert.equal(r2.status, 'error');
  assert.match(toasts[0], /^导入失败：不是合法的 JSON 文件$/);
});

test('C1b importProjectFile 全链（真 readProjectFile）：v2 文件剥离内嵌并派生 hadAudio', async () => {
  const p = mkProject();
  p.audio = { name: '曲一.mp3' };
  const text = JSON.stringify({ ...p, id: undefined, audio: { ...p.audio, dataBase64: Buffer.from([7, 8]).toString('base64'), dataFormat: 'audio/mpeg' } });
  const seen = { imported: null, blob: null };
  const r = await importProjectFile(mkFileStub(text), {
    readFile: readProjectFile,
    importProject: pj => { seen.imported = pj; },
    restoreAudio: async (a, b) => { seen.blob = b; return !!b; },
    toast: () => {},
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.hadAudio, true);
  assert.equal(seen.imported.meta.title, '覆盖样例', '校验通过后的项目回传导入');
  assert.ok(seen.blob instanceof Blob, '内嵌音频还原为 Blob 回填');
});

// ---------- C2：ioSource 会话态 + dirty 基线 ----------
test('C2 markIoSource/isIoDirty：基线比对——无句柄恒 false；有句柄改内容 true；rebaseline/clear 复位', () => {
  clearIoSource();
  const p = mkProject();
  assert.equal(isIoDirty(p), false, '无句柄（未从文件导入）恒 false——入口隐藏依据');
  markIoSource({ kind: 'file' }, '样例.formation.json', true, p);
  assert.equal(isIoDirty(p), false, '基线刚建：未修改');
  const q = JSON.parse(JSON.stringify(p));
  q.meta.title = '改过的标题';
  assert.equal(isIoDirty(q), true, '导入后有变化 → dirty（保存覆盖可用依据）');
  markIoSource({ kind: 'file' }, '样例.formation.json', true, q); // 写回成功后 rebaseline
  assert.equal(isIoDirty(q), false, 'rebaseline 后复位');
  clearIoSource();
  assert.equal(ioSource.handle, null);
  assert.equal(isIoDirty(q), false, 'clear 后复位（换项目防误写）');
});

// ---------- C3：saveBackToSourceFile 分流 ----------
test('C3 saveBackToSourceFile：no-handle/clean 早退；cancelled 不写；saved 按原文件含乐组装并 onSaved', async () => {
  clearIoSource();
  // no-handle
  const r0 = await saveBackToSourceFile({ handle: null, dirty: true, write: async () => { throw new Error('不应到达'); } });
  assert.equal(r0.status, 'no-handle');
  // clean
  const r1 = await saveBackToSourceFile({ handle: { kind: 'file' }, dirty: false, write: async () => { throw new Error('不应到达'); } });
  assert.equal(r1.status, 'clean');
  // cancelled（组装先于确认——确认弹窗要如实写含乐/不含乐，故取消前会组装，但绝不写回）
  let writeCalls = 0;
  const r2 = await saveBackToSourceFile({
    handle: { kind: 'file' }, fileName: '样例.formation.json', hadAudio: true, dirty: true,
    assemble: async () => ({ assets: [{ id: 'a1', blob: mkBlob([1]) }], blob: null }),
    confirmImpl: () => false,
    write: async () => { writeCalls++; },
  });
  assert.equal(r2.status, 'cancelled');
  assert.equal(writeCalls, 0, '取消后不写回');
  // saved（原文件有乐、本地取得到 → 含乐写回）
  const toasts = [];
  let writeArgs = null, confirmMsg = '', savedCalled = false;
  const blob = mkBlob([1]);
  const r3 = await saveBackToSourceFile({
    handle: { kind: 'file' }, fileName: '样例.formation.json', hadAudio: true, dirty: true,
    project: mkProject(),
    assemble: async () => ({ assets: [{ id: 'a1', blob }], blob: null }),
    confirmImpl: m => { confirmMsg = m; return true; },
    write: async (h, p, ab, opts) => { writeCalls++; writeArgs = { p, ab, opts }; return { ok: true, withAudio: true, bytes: 10 }; },
    toast: m => toasts.push(m),
    onSaved: () => { savedCalled = true; },
  });
  assert.equal(r3.status, 'saved');
  assert.equal(r3.withAudio, true);
  assert.equal(writeCalls, 1);
  assert.equal(writeArgs.ab, null, 'legacy 单音频为空（音频随 v3 资产出户）');
  assert.equal(writeArgs.opts.assets.find(a => a.id === 'a1').blob, blob, '资产 blob 透传写回层（v3 内嵌）');
  assert.match(confirmMsg, /覆盖保存到原文件「样例\.formation\.json」？（含音乐）/);
  assert.ok(savedCalled, '写回成功回调（调用方 rebaseline）');
  assert.match(toasts[toasts.length - 1], /已覆盖保存到原文件（含音乐）/);
});

test('C3b saveBackToSourceFile：原文件有乐但本地取不到 → 降级不含乐并明示；原文件无乐不组装', async () => {
  const toasts = [];
  const msgs = [];
  const r = await saveBackToSourceFile({
    handle: { kind: 'file' }, fileName: 'b.formation.json', hadAudio: true, dirty: true,
    project: mkProject(),
    assemble: async () => ({ assets: [{ id: 'a1', blob: null }], blob: null }),
    confirmImpl: m => { msgs.push(m); return true; },
    write: async () => ({ ok: true, withAudio: false, bytes: 5 }),
    toast: m => toasts.push(m),
  });
  assert.equal(r.status, 'saved');
  assert.equal(r.withAudio, false);
  assert.ok(toasts.some(m => m.includes('本地未找到音乐文件')), '降级 toast 明示');
  assert.match(msgs[0], /（不含音乐）/, '确认弹窗如实说明不含乐');
  // 原文件无乐：不调用 assemble（组装层零调用）
  let assembled = 0;
  const r2 = await saveBackToSourceFile({
    handle: { kind: 'file' }, fileName: 'c.formation.json', hadAudio: false, dirty: true,
    project: mkProject(),
    assemble: async () => { assembled++; return { assets: null, blob: null }; },
    confirmImpl: m => { msgs.push(m); return true; },
    write: async () => ({ ok: true, withAudio: false, bytes: 5 }),
    toast: () => {},
  });
  assert.equal(r2.status, 'saved');
  assert.equal(assembled, 0, '原文件无乐 → 不走音频组装');
  assert.match(msgs[1], /（不含音乐）/, '确认弹窗如实说明不含乐');
});

// ---------- A7：构建产物（build 号随双处 bump 进包；改写注明：build 号随版本推进，断言语义不变） ----------
// build-91-varispeed 改写注明：build 号随版本推进（原 build-71-iomenu），断言语义不变
test('A7 版本：main.js 双处 build-91-varispeed（__MAIN_BUILD + BUILD_TAG 回退）+ exp.writeProjectToHandle 接线', () => {
  assert.match(mainSrc, /window\.__MAIN_BUILD = 'build-91-varispeed';/);
  assert.match(mainSrc, /\? window\.__MAIN_BUILD : 'build-91-varispeed'/);
  assert.match(mainSrc, /exp\.writeProjectToHandle\(hdl, project, blob, opts\)/, '保存覆盖写回经 export.js 组装层');
  assert.match(expSrc, /export async function buildProjectFile\(/, '组装层抽出（导出下载/保存覆盖同源）');
});
