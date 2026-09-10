// 导出：PNG 截图 / 打印 PDF / 项目 JSON 导入导出
import { drawScene } from './stage.js';
import { validateProject, beatLabel, computeSegments } from './model.js';

function download(blob, filename) {
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
function safeName(s) { return (s || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60); }
function blobToBase64(blob) {
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
  drawScene(ctx, { x: 0, y: 0, w: cv.width, h: cv.height }, project, formation.positions, { minimal: false, pad: 20, pairLocked: formation.pairLocked !== false, theme });
  return cv;
}
export function exportPNG(project, formation, theme = 'dark') {
  const cv = renderFormation(project, formation, { theme });
  cv.toBlob(blob => download(blob, `${safeName(project.meta.title)}-${safeName(formation.name)}.png`));
}
// includeAudio=true 时把音乐以 base64 内嵌进项目文件（格式 v2），导入后无需重新找音乐
export async function exportProjectJSON(project, audioBlob, { share = false } = {}) {
  const data = cloneBasic(project);
  if (audioBlob) {
    data.version = 2;
    data.audio.dataBase64 = await blobToBase64(audioBlob);
    data.audio.dataFormat = audioBlob.type || 'audio/mpeg';
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const filename = `${safeName(project.meta.title)}.formation.json`;
  if (share) await shareOrDownload(blob, filename);
  else download(blob, filename);
  return { withAudio: !!audioBlob, bytes: blob.size };
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
  let audioBlob = null;
  if (json.audio && json.audio.dataBase64) {
    audioBlob = base64ToBlob(String(json.audio.dataBase64), json.audio.dataFormat || 'audio/mpeg');
    delete json.audio.dataBase64;
    delete json.audio.dataFormat;
  }
  const r = validateProject(json);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return { project: r.project, audioBlob };
}

// 打印 / PDF：每队形一页
export function printFormations(project) {
  const { segments } = computeSegments(project);
  const pages = project.formations.map((f, i) => {
    const cv = renderFormation(project, f, { width: 900, theme: 'light' });
    const seg = segments[i];
    const bars = seg ? `第 ${Math.floor(seg.holdStart / 8) + 1} 个8拍 · 保持${Math.round(seg.holdEnd - seg.holdStart)}拍${seg.hasTravel ? ` · 过渡${Math.round(seg.travelEnd - seg.holdEnd)}拍` : ''}` : '';
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
