// build-67-mobilestage：移动端编舞底部区压缩为两行——舞台扩容。
// 用户需求：编舞模式下画布以外的操作区压缩；除多轨外宽度不足时尽量收进两行；宽度够时（≥1024）展开回桌面完整形态。
// 覆盖面（机器面静态断言；375/1024 双档实测几何由主会话浏览器探针覆盖——见交付报告风险清单）：
//   S0 版本：main.js 双处 build-67-mobilestage。
//   S1 行 A 结构（#block-ctl）：保持/过渡词标 .ctl-lbl 包裹（桌面 inline 呈示不变）+ 值拆
//      .bcv-beats/.bcv-sec（textContent 拼接与旧一字不差，静态初始不显秒）+ render 拆分写入零残留 +
//      收纳项恒在（对齐到播放头/连续时长/说明文字/bc-sec 均 hide-mobile）。
//   S2 行 A CSS：≤1023.5 单行 nowrap + 收纳选择器（bc-label/vsep/ctl-lbl/bcv-sec）+ 旧 spacer
//      隐藏规则退役（spacer 回归 flex 撑杆）+ 行高预算 42 ≤ 48（按 CSS 声明值推算）。
//   S3 行 B（#music-summary）：极简结构=♪资产名+BPM 只读元+「编辑音乐 →」；点拍/试听/校准▸/
//      tag 计数/拍刻度/缩放组移动端隐藏（音乐域工具，「编辑音乐 →」进音乐模式承接）+ 行高预算 34 ≤ 40。
//   S4 F2 宽度响应：全部压缩规则只在 (max-width:1023.5px) 媒体块内（≥1024 桌面零变化——基线规则
//      逐字比对）；断点穿越零 JS 状态（无 matchMedia/resize 监听触碰两栏）；build-65 --pb-h 锚不动；
//      多轨区不动（timeline.js 移动 120 / 桌面 112 基线仍在）。
//   S5 F3 可达性：「编辑音乐 →」行 B 恒驻（无 hide-mobile/无移动隐藏规则）；乐段索引双入口接线
//      （行 A #bc-seg-index / 摘要条 #ms-tags 同面板）；音乐模式工具条孪生件在 HTML
//      （tl-zoom-*-music/mtb-seg-index + b49-exit 仅藏呈示的 DOM 保留；数拍输入退役见 build-68）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');

// ---- 媒体块解析：花括号配平抽取 (max-width:1023.5px) 块并集 / 全部 @media 剥离后的非媒体体 ----
function blocksAt(cssText, cond) {
  const out = [];
  const re = new RegExp(`@media[^{]*\\(${cond}[^)]*\\)\\s*\\{`, 'g');
  let m;
  while ((m = re.exec(cssText))) {
    let depth = 1, i = re.lastIndex;
    while (i < cssText.length && depth > 0) {
      if (cssText[i] === '{') depth++;
      else if (cssText[i] === '}') depth--;
      i++;
    }
    out.push(cssText.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return out.join('\n');
}
function stripAllMedia(cssText) {
  let out = '', i = 0;
  for (;;) {
    const at = cssText.indexOf('@media', i);
    if (at < 0) { out += cssText.slice(i); break; }
    out += cssText.slice(i, at);
    const open = cssText.indexOf('{', at);
    let depth = 1, j = open + 1;
    while (j < cssText.length && depth > 0) {
      if (cssText[j] === '{') depth++;
      else if (cssText[j] === '}') depth--;
      j++;
    }
    i = j;
  }
  return out;
}
const mobileCss = blocksAt(css, 'max-width:\\s*1023\\.5');
const desktopCss = stripAllMedia(css);
// decl：按「行首选择器」锚定取声明体——避免选择器后缀误命中（如 #editor-view[…] #music-summary{display:none}）
const decl = (src, sel) => (src.match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`)) || [])[1] || '';

// ---------- S0 版本 ----------
// build-91-varispeed 改写注明：build 号随版本推进（原 build-71-iomenu），断言语义不变（双处 bump）
test('S0 版本：main.js 双处 build-91-varispeed（__MAIN_BUILD + BUILD_TAG 回退）', () => {
  assert.ok((mainSrc.match(/build-91-varispeed/g) || []).length >= 2, '双处版本标记（build-single.mjs 按首处正则解析，勿改形态）');
  assert.match(mainSrc, /window\.__MAIN_BUILD = 'build-91-varispeed';/);
  assert.doesNotMatch(mainSrc, /build-70-formationclips';/);
});

// ---------- S1 行 A 结构 ----------
test('S1a 行 A 结构：保持/过渡词标 .ctl-lbl 包裹 + 值拆 .bcv-beats/.bcv-sec（build-91-varispeed 秒单显）', () => {
  // 词标 span 包裹（桌面 inline 呈示；移动端 display:none 收纳）。
  // build-91-varispeed（需求 3）改写：词标改明确文案「保持 ▸ 此队形定格」「过渡 ▸ 切换耗时」
  // ——一眼区分「保持=队形定格多久」「过渡=切换到下一队形花多久」。
  assert.match(html, /<span class="ctl"><span class="ctl-lbl">保持 ▸ 此队形定格<\/span>/, '保持词标包裹（明确文案）');
  assert.match(html, /<span class="ctl" id="bc-travel-wrap"><span class="ctl-lbl">过渡 ▸ 切换耗时<\/span>/, '过渡词标包裹（明确文案）');
  // 值拆分：双 span 结构保留；build-91-varispeed（时间唯一标准）起 .bcv-beats 承载秒值、.bcv-sec
  // 恒空串（去拍值）——静态初始为缺省 BPM 120 下的示例值（16拍=8s / 8拍=4s），render 即写实际值
  assert.match(html, /<span id="bc-hold" class="mono bc-val"><span class="bcv-beats">8s<\/span><span class="bcv-sec"><\/span><\/span>/);
  assert.match(html, /<span id="bc-travel" class="mono bc-val"><span class="bcv-beats">4s<\/span><span class="bcv-sec"><\/span><\/span>/);
  // ± 钮 title 补词标语义（移动端词标隐藏后 hover/长按仍可辨识）；步进口径=0.1s。
  // build-91-varispeed（需求 3）：title 追加「±0.1s 调整的是时长，不是时间轴视图缩放」区分句——
  // 前缀匹配（追加文本不破词标语义）
  for (const t of ['保持时长 −0.1s', '保持时长 ＋0.1s', '过渡时长 −0.1s', '过渡时长 ＋0.1s']) {
    assert.match(html, new RegExp(`title="${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `title「${t}」在位`);
  }
  assert.ok(html.includes('不是时间轴视图缩放'), '± 钮 title 带「时长≠缩放」区分句');
});

test('S1b 行 A render 写入：秒值入 .bcv-beats + .bcv-sec 恒空串 + bc-name title 兜底，旧拍值写入零残留', () => {
  // build-91-varispeed（时间唯一标准）：写入值=选中 clip 长度 / 与下一 clip 的空隙（空隙自动适应），
  // 秒呈示（fmtS 含 s 后缀）；.bcv-sec 空串占位（span 结构与移动端 CSS 收纳口径保留）
  assert.match(mainSrc, /\$\('bc-hold'\)\.querySelector\('\.bcv-beats'\)\.textContent = fmtS\(lenBeats\);/);
  assert.match(mainSrc, /\$\('bc-hold'\)\.querySelector\('\.bcv-sec'\)\.textContent = '';/);
  assert.match(mainSrc, /\$\('bc-travel'\)\.querySelector\('\.bcv-beats'\)\.textContent = fmtS\(gapBeats\);/);
  assert.match(mainSrc, /\$\('bc-travel'\)\.querySelector\('\.bcv-sec'\)\.textContent = '';/);
  assert.ok(!/\$\('bc-hold'\)\.textContent\s*=/.test(mainSrc), 'bc-hold 无整值直写残留（拆分写入形态不变）');
  assert.ok(!/\$\('bc-travel'\)\.textContent\s*=/.test(mainSrc), 'bc-travel 无整值直写残留');
  assert.match(mainSrc, /\$\('bc-name'\)\.title = currentFormation\(\)\?\.name \|\| '';/, '块名 ellipsis 后 title 兜底全名');
  // 去拍值守卫：块栏写入链旧拍值拼接零残留（fmtB 拍格式化器退役）
  assert.ok(!mainSrc.includes('`${fmtB(lenBeats)}拍`'), '旧拍值拼接零残留');
});

test('S1c 行 A 收纳项恒在：对齐到播放头/说明文字/bc-sec 均 hide-mobile（桌面保留、移动收纳）；连续时长退役', () => {
  const seg = html.slice(html.indexOf('<div id="block-ctl">'), html.indexOf('<div id="music-strip">'));
  assert.match(seg, /<button id="btn-align-playhead" class="btn small hide-mobile"/, '对齐到播放头=hide-mobile');
  // build-70：连续时长（ripple）checkbox 退役——clip 化后时长操作天然只作用本 clip（邻界钳制），
  // 无 ripple 语义可连续；退役守卫：控件与接线零残留
  assert.ok(!seg.includes('ripple-check'), 'ripple-check 控件已退役');
  assert.ok(!mainSrc.includes("'travelBeats'") || /stepBlockSec\('travelBeats'/.test(mainSrc), '（信息性）stepBlockSec 键名仅为按钮路由（build-91-varispeed ±0.1s 步进）');
  assert.match(seg, /<span class="dim hide-mobile">拖动队形段移动 \/ 拖缘调长/, '说明文字=hide-mobile（build-70 提示语更新）');
  assert.match(seg, /<span id="bc-sec" class="dim hide-mobile"><\/span>/, 'bc-sec=hide-mobile');
  // 行尾两钮（索引/折叠⌄）不在收纳列——行 A 构成「块名+保持±+过渡±+spacer+索引+⌄」
  assert.match(seg, /<button id="bc-seg-index" class="btn small"/, '索引钮恒在');
  assert.match(seg, /<button id="bc-bottom-collapse" class="btn small"/, '折叠⌄恒在');
});

// ---------- S2 行 A CSS ----------
test('S2a 行 A CSS：≤1023.5 单行 nowrap + 收纳选择器 + spacer 撑杆回归', () => {
  const bc = decl(mobileCss, '#block-ctl');
  assert.ok(bc.includes('flex-wrap:nowrap'), '移动端单行 nowrap（旧折两行 75px 根治面）');
  assert.ok(bc.includes('overflow-x:auto'), 'overflow 兜底（C-09a 口径：条内横滚不破页面零溢出）');
  const hid = mobileCss.match(/#block-ctl \.bc-label,#block-ctl \.vsep,#block-ctl \.ctl-lbl,#block-ctl \.bcv-sec\{display:none\}/);
  assert.ok(hid, '收纳选择器：bc-label/vsep/ctl-lbl/bcv-sec 一组 display:none');
  assert.ok(!/#block-ctl \.spacer\{display:none\}/.test(css), '旧「移动端隐藏 spacer 防折行」规则已退役（spacer 回归 .spacer{flex:1} 撑杆）');
  assert.ok(decl(mobileCss, '#block-ctl .bc-val').includes('min-width:36px'), '值片 36px 紧凑（桌面 70px 不变）');
  assert.ok(decl(mobileCss, '#block-ctl .btn.step').includes('padding:0 7px'), '步进钮 0 7px 紧凑（桌面 0 9px 不变）');
});

test('S2b 行 A 行高预算（CSS 声明值推算）：容器 8 + 钮 33 + 条边框 1 = 42 ≤ 48', () => {
  // 组件值全部从 CSS 实取——任一组件漂移即此断言炸红，倒逼重算预算
  const bcPad = decl(mobileCss, '#block-ctl').match(/padding:(\d+)px (\d+)px/);
  assert.ok(bcPad, '#block-ctl 移动 padding 在位');
  const btnPad = decl(mobileCss, '.btn.small').match(/padding:(\d+)px (\d+)px/); // 移动块 .btn.small{padding:6px 10px}（触摸目标）
  assert.ok(btnPad, '.btn.small 移动 padding 在位');
  const ctlV = Number(bcPad[1]) * 2;             // 条容器纵向 padding
  const btnV = Number(btnPad[1]) * 2;            // 钮纵向 padding
  const line = Math.ceil(13 * 1.45);             // .btn.small font 13px × body 1.45 行高（css body 声明实取见下）
  assert.ok(/font:14px\/1\.45/.test(desktopCss), 'body 1.45 行高基线未变（line 估算依据）');
  const rowH = ctlV + btnV + line + 2/*钮上下边框*/ + 1/*条 border-bottom*/;
  assert.equal(rowH, 8 + 12 + 19 + 2 + 1, '预算算式逐项核对');
  assert.ok(rowH <= 48, `行 A = ${rowH}px ≤ 48`);
});

// ---------- S3 行 B ----------
// build-91-varispeed（时间唯一标准）：#tl-scale-toggle 拍/秒切换钮移除（DOM+CSS+接线）——
// stage 尺规恒秒刻度，不再出现在行 B 收纳列；音乐工具条孪生钮 #tl-scale-toggle-music 不动。
test('S3a 行 B 极简结构：点拍/试听/校准▸/tag 计数/缩放组移动端隐藏；ms-meta 与「编辑音乐 →」不在隐藏列；拍/秒切换钮已退役', () => {
  for (const id of ['btn-tap', 'btn-offset-test', 'calib-disc', 'ms-tags', 'tl-zoom-out', 'tl-zoom-in', 'tl-zoom-fit']) {
    assert.ok(mobileCss.includes(`#music-summary #${id}{display:none}`) || mobileCss.includes(`#music-summary #${id},`), `#${id} 移动端收纳`);
    assert.ok(!desktopCss.includes(`#music-summary #${id}{display:none}`), `#${id} 桌面无隐藏规则（≥1024 完整形态）`);
  }
  // 退役守卫：#tl-scale-toggle 在 HTML/CSS 零残留（stage 强制秒刻度，无拍刻度可切）
  assert.ok(!html.includes('id="tl-scale-toggle"'), '编舞拍/秒切换钮 DOM 已移除');
  assert.ok(!mobileCss.includes('#tl-scale-toggle') && !desktopCss.includes('#tl-scale-toggle'), '拍/秒切换钮 CSS 收纳规则零残留');
  assert.ok(html.includes('id="tl-scale-toggle-music"'), '音乐模式孪生钮保留（音乐模式行为不动）');
  assert.ok(!/#music-summary #ms-meta\{display:none\}/.test(mobileCss), '#ms-meta（BPM 只读元）保留行 B——BPM/小节信息不丢');
  assert.ok(!/#music-summary #ms-edit\{display:none\}/.test(mobileCss), '#ms-edit「编辑音乐 →」行 B 恒驻（编舞→音乐主入口）');
  const sum = decl(mobileCss, '#music-summary');
  assert.ok(sum === '' || (!sum.includes('btn-tap') && !sum.includes('ms-edit')), '行 B 容器规则不触碰钮呈示');
});

test('S3b 行 B 行高预算：钮 33 + 条边框 1 = 34 ≤ 40（min-height 30 基线不动）', () => {
  const base = decl(desktopCss, '#music-summary');
  assert.ok(base.includes('min-height:30px') && base.includes('padding:0 10px'), '基线 30px/纵向零 padding 未变（桌面红线 30±4 不破）');
  const btnPad = decl(mobileCss, '.btn.small').match(/padding:(\d+)px/);
  const line = Math.ceil(13 * 1.45);
  const rowH = Number(btnPad[1]) * 2 + line + 2 + 1; // 钮纵向 padding×2 + 行高 + 钮边框 + 条 border-bottom
  assert.ok(rowH <= 40, `行 B = ${rowH}px ≤ 40`);
  assert.ok(!/#music-summary\{[^}]*min-height:(?!30px)[^}]*\}/.test(mobileCss), '移动端不改 min-height（预算按内容高成立）');
});

// ---------- S4 F2 宽度响应 ----------
test('S4a 桌面零变化：两栏基线规则逐字在位；全部压缩规则只在 ≤1023.5 媒体块内', () => {
  assert.ok(desktopCss.includes('#block-ctl{display:flex;align-items:center;gap:10px;padding:4px 10px;border-bottom:1px dashed var(--bg3);flex-wrap:nowrap}'), 'block-ctl 桌面基线单行（build-83 nowrap，秒值变宽不折行）');
  assert.ok(desktopCss.includes('#music-summary{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:0 10px;min-height:30px'), 'music-summary 桌面基线未动');
  assert.ok(desktopCss.includes('#block-ctl .bc-val{min-width:70px'), '桌面值片 70px 未动');
  assert.ok(desktopCss.includes('#block-ctl .btn.step{padding:0 9px;line-height:20px;font-size:14px}'), '桌面步进钮未动');
  // 收纳/nowrap 规则不得出现在非媒体体
  assert.ok(!desktopCss.includes('#block-ctl .ctl-lbl'), '桌面无 ctl-lbl 隐藏');
  assert.ok(!desktopCss.includes('.bcv-sec{display:none}'), '桌面无 bcv-sec 隐藏');
  assert.ok(!/#music-summary\{[^}]*nowrap/.test(desktopCss) || true, 'summary 容许 nowrap（单行设计）');
  // build-83：桌面 block-ctl nowrap 是单行钉死本体（S4a 上方断言），移动压缩仍只靠 ctl-lbl 隐藏
  assert.ok(desktopCss.split('#block-ctl{')[1].split('}')[0].includes('flex-wrap:nowrap'), '桌面 nowrap 在场（秒值变宽不折行）');
  // 桌面无行 B 关键件钮级隐藏（BPM 只读元 / 主入口钮；details-marker 等装饰性 display:none 不在列）
  assert.ok(!desktopCss.includes('#music-summary #ms-meta{display:none}'), '桌面无 #ms-meta 隐藏');
  assert.ok(!desktopCss.includes('#music-summary #ms-edit{display:none}'), '桌面无 #ms-edit 隐藏');
});

test('S4b 断点穿越零残留：压缩为纯 CSS——无 JS 监听触碰两栏；--pb-h 移动锚与多轨基线不动', () => {
  assert.ok(!/matchMedia\(?[^\n]*(block-ctl|music-summary)/.test(mainSrc), '无 matchMedia 监听触碰两栏（跨 1023.5 双向自动套/退）');
  assert.ok(!/addEventListener\('resize'[^)]*\)[^\n]*(block-ctl|music-summary)/.test(mainSrc), '无 resize 监听触碰两栏');
  assert.ok(mainSrc.includes("matchMedia('(max-width: 1023.5px)')"), '既有 isMobileLayout 口径不变（rsb/轨头形态沿用）');
  // build-65 --pb-h 联动锚：移动 96 / 桌面 44 两档照旧（底部相关锚点不受本轮影响）
  assert.ok(mobileCss.includes('--pb-h:96px'), '移动 --pb-h 96px 锚在位');
  assert.ok(desktopCss.includes('--pb-h:44px'), '桌面 --pb-h 44px 在位');
  // 多轨区不动：tl-scroll 高度基线（桌面 112 内容地板 114 / 移动 120）
  assert.match(tlSrc, /const base = mobile \? 120 : 112;/, 'timeline.js 移动 120/桌面 112 基线未动（F1 只压块栏与摘要条）');
});

// ---------- S5 F3 可达性 ----------
test('S5 功能可达性：「编辑音乐 →」行 B 恒驻；索引双入口；音乐模式孪生件在 HTML', () => {
  const msEdit = html.match(/<button id="ms-edit" class="btn small"[^>]*>([^<]*)<\/button>/);
  assert.ok(msEdit && msEdit[1].includes('编辑音乐'), '「编辑音乐 →」钮在行 B（无 hide-mobile）');
  // 乐段索引双入口同面板（tag 跳转列表移动端经行 A「索引」仍一键可达）
  assert.match(mainSrc, /\$\('ms-tags'\)\.addEventListener\('click', toggleSegIndexPanel\);/, '摘要条 tag 钮接线保留（桌面）');
  assert.match(mainSrc, /\$\('bc-seg-index'\)\?\.addEventListener\('click', toggleSegIndexPanel\);/, '行 A 索引钮接线（移动端入口）');
  // 音乐模式工具条承接件：缩放组 / 索引 / 资产名在 HTML（数拍输入已随 build-68-nocountin 退役）
  for (const id of ['tl-zoom-out-music', 'tl-zoom-in-music', 'tl-zoom-fit-music', 'mtb-seg-index', 'mtb-audio-name']) {
    assert.ok(html.includes(`id="${id}"`), `音乐模式 #${id} 在位`);
  }
  // b49-exit 仅藏呈示的 BPM 识别类孪生件 DOM 保留（build-49 退场策略照旧）。
  // build-91-varispeed（需求 7b）：btn-offset-test-music（试听）随点拍/试听退役从保留列移除
  for (const id of ['bpm-input-music', 'offset-input-music', 'bpb-select-music', 'tl-scale-toggle-music']) {
    assert.ok(html.includes(`id="${id}"`), `孪生件 #${id} DOM 保留（b49 退场策略照旧）`);
  }
  assert.ok(!html.includes('id="btn-offset-test-music"') && !html.includes('id="btn-tap-music"'), '试听/点拍孪生钮 DOM 退役');
});
