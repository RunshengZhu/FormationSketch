// 导出：PNG 截图 / 打印 PDF / 项目 JSON 导入导出
import { drawScene } from './stage.js';
import { validateProject, beatLabel, segmentsFromClips } from './model.js';

function download(blob, filename) {
  if (typeof document === 'undefined') return; // Node 单测环境（经 main.js import 链载入本模块）：下载是浏览器专属动作，静默跳过
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
// 移动端优先走系统分享（可存入文件/云盘/发送给队友），不支持时回退下载
async function shareOrDownload(blob, filename) {
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  download(blob, filename);
  return 'downloaded';
}
// build-60-videoexport：文件名安全化收口为导出（视频导出「项目名-YYYYMMDD.mp4」同规矩复用）
export function safeName(s) { return (s || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }
function blobToBase64(blob) {
  // Node 单测环境无 FileReader：走 arrayBuffer + Buffer 等价路径；浏览器恒有 FileReader，主路径行为不变。
  if (typeof FileReader === 'undefined' && typeof Buffer !== 'undefined') {
    return blob.arrayBuffer().then(ab => Buffer.from(ab).toString('base64'));
  }
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(',')[1] || '');
    rd.onerror = () => reject(new Error('音频读取失败'));
    rd.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, type = 'audio/mpeg') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// 渲染单个队形为离屏画布
export function renderFormation(project, formation, { width = 1000, theme = 'light' } = {}) {
  const ratio = project.stage.depthM / project.stage.widthM;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = Math.round(width * ratio);
  const ctx = cv.getContext('2d');
  drawScene(ctx, { x: 0, y: 0, w: cv.width, h: cv.height }, project, formation.positions, { minimal: false, pad: 20, merges: formation.merges || [], theme });
  return cv;
}
export function exportPNG(project, formation, theme = 'dark') {
  const cv = renderFormation(project, formation, { theme });
  cv.toBlob(blob => download(blob, `${safeName(project.meta.title)}-${safeName(formation.name)}.png`));
}
// build-71-iomenu F2：项目文件组装纯层（自 exportProjectJSON 抽出）——「导出下载」与
// 「保存覆盖写回原文件」共用同一套内嵌规则（v3 多资产 / v2 legacy 单音频），两路径字节同源。
// includeAudio 由调用方决定：audioBlob=null 且 assets 无 blob → v1（不含乐，无 dataBase64）。
// opts.assets = [{ id, name, durationSec, size, blob }]（缺失 blob 的资产跳过内嵌，仅元数据随行）。
// 返回 { text, withAudio, bytes }；node 可测（tests/iomenu.test.js）。
export async function buildProjectFile(project, audioBlob, { assets = null } = {}) {
  const data = cloneBasic(project);
  let embeddedActive = false;
  if (assets && assets.some(a => a.blob)) {
    data.version = 2;
    if (data.media && Array.isArray(data.media.assets)) {
      for (const a of data.media.assets) {
        const src = (assets || []).find(x => x.id === a.id);
        if (src?.blob) {
          a.dataBase64 = await blobToBase64(src.blob);
          a.dataFormat = src.blob.type || 'audio/mpeg';
          if (!a.size) a.size = src.blob.size;
          if (src.blob === audioBlob) embeddedActive = true;
        }
      }
    }
  }
  if (audioBlob && !embeddedActive) {
    data.version = 2;
    data.audio.dataBase64 = await blobToBase64(audioBlob);
    data.audio.dataFormat = audioBlob.type || 'audio/mpeg';
  }
  const text = JSON.stringify(data);
  const bytes = new Blob([text]).size;
  const withAudio = !!(audioBlob || (assets && assets.some(a => a.blob)));
  return { text, withAudio, bytes };
}
// includeAudio=true 时把音乐以 base64 内嵌进项目文件（格式 v2），导入后无需重新找音乐。
// v3：内嵌**全部媒体资产**（data.media.assets[i].dataBase64/dataFormat）；audio.dataBase64
// 仅在活动资产 blob 未随资产内嵌时兜底写入（避免单资产项目体积翻倍）。旧版本应用导入
// 新 v2 文件会丢配乐（实验分支接受；本应用读旧 v2/v1 文件全兼容）。
export async function exportProjectJSON(project, audioBlob, { share = false, assets = null } = {}) {
  const { text, withAudio, bytes } = await buildProjectFile(project, audioBlob, { assets });
  const blob = new Blob([text], { type: 'application/json' });
  const filename = `${safeName(project.meta.title)}.formation.json`;
  if (share) await shareOrDownload(blob, filename);
  else download(blob, filename);
  return { withAudio, bytes };
}
// build-71-iomenu F2：保存覆盖——把组装结果写回导入时的原文件句柄（File System Access API，
// 浏览器原生，Chromium 支持；Safari 无句柄 → 调用方隐藏入口，仅走导出下载）。node 可测：
// mock handle = { createWritable: async () => ({ write, close }) }。
export async function writeProjectToHandle(handle, project, audioBlob, opts = {}) {
  const { text, withAudio, bytes } = await buildProjectFile(project, audioBlob, opts);
  const w = await handle.createWritable();
  await w.write(new Blob([text], { type: 'application/json' }));
  await w.close();
  return { ok: true, withAudio, bytes };
}
function cloneBasic(project) {
  // 音频不内嵌（体积大），仅记录元信息
  const p = JSON.parse(JSON.stringify(project));
  delete p.id;
  return p;
}
export async function readProjectFile(file) {
  const text = await file.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('不是合法的 JSON 文件'); }
  // v2 格式：先提取内嵌音乐（validate 会剥离内嵌字段），还原为 Blob
  // v3：data.media.assets[i].dataBase64 = 多资产内嵌；audio.dataBase64 = 旧单音频内嵌（兼容读）
  const assetBlobs = [];
  for (const a of (json.media && Array.isArray(json.media.assets) ? json.media.assets : [])) {
    if (a && a.dataBase64) {
      try {
        assetBlobs.push({
          id: typeof a.id === 'string' ? a.id : null,
          name: String(a.name || 'audio'),
          blob: base64ToBlob(String(a.dataBase64), a.dataFormat || 'audio/mpeg'),
        });
      } catch {}
      delete a.dataBase64;
      delete a.dataFormat;
    }
  }
  let audioBlob = null;
  if (json.audio && json.audio.dataBase64) {
    audioBlob = base64ToBlob(String(json.audio.dataBase64), json.audio.dataFormat || 'audio/mpeg');
    delete json.audio.dataBase64;
    delete json.audio.dataFormat;
  }
  const r = validateProject(json);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return { project: r.project, audioBlob, assetBlobs };
}

// 打印 / PDF：每队形一页
// build-70 M3 换源：segmentsFromClips——「保持 N 拍」=clip 长度；「变换 N 拍」=与下一 clip 的
// 空隙（自动适应，无下一 clip=无变换）。
export function printFormations(project) {
  const { segments } = segmentsFromClips(project.formations);
  const pages = project.formations.map((f, i) => {
    const cv = renderFormation(project, f, { width: 900, theme: 'light' });
    const seg = segments[i];
    const next = segments[i + 1];
    const bars = seg ? `第 ${Math.floor(seg.start / 8) + 1} 个8拍 · 保持${Math.round(seg.end - seg.start)}拍${next ? ` · 变换${Math.round(Math.max(0, next.start - seg.end))}拍` : ''}` : '';
    return `<div class="print-page">
      <h2>${i + 1}. ${escapeHtml(f.name)}</h2>
      <div class="p-meta">${bars}${f.note ? '\n备注：' + escapeHtml(f.note) : ''}</div>
      <img src="${cv.toDataURL('image/png')}" alt="${escapeHtml(f.name)}">
    </div>`;
  });
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(project.meta.title)} - 队形图</title>
  <style>
    body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a;margin:24px}
    h1{font-size:20px}
  </style></head><body>
  <h1>${escapeHtml(project.meta.title)}</h1>
  ${pages.join('\n')}
  <script>window.onload=()=>{setTimeout(()=>window.print(),300)}<\/script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { throw new Error('弹窗被拦截，请允许弹出窗口后重试'); }
  w.document.write(html);
  w.document.close();
  return w;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
