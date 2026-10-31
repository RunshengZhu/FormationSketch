// build-51-stageux：编舞播放直达音乐尾（F1）+ 索引避让侧栏（F2）+ 编舞三侧折叠（F3）+
// 时间轴底部导航滑块（F4）—— node 单测。
// F1：stage 有/无音频资产的 seek 钳制与 ended 域（用户指令「两种模式一致直达音乐尾」；
//     music-domain.test.js 已按同指令改写，本文件钉无音频口径与 formationIndex 越界钳制）；
// F2：面板避让定位纯函数（segIndexPlacement）+ 摆位挂点/单入口静态断言
//     —— build-56-indextab 改写：浮动面板与避让摆位随索引入侧栏 tab 整体退役，
//     F2 三条测试改写为退役注记静态断言（新守卫主责在 tests/indextab.test.js）；
// F3：三侧折叠记忆键（wuzhen:stageLeft/Right/Bottom）与 CSS stage 作用域静态断言 + 索引入口
//     （#bc-seg-index 复用 toggleSegIndexPanel，⌘⇧L 两模式通用）；
// F4：概览条拇指几何纯函数（tlnavThumb 比例/下限/禁用态、tlnavScrollForThumbPos 拖动换算、
//     tlnavScrollForBarClick 视口中心跳转）+ DOM 挂点/双同步源/Pointer Events 静态断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject, segmentsFromClips, beatToSec, secToBeat, musicDomainSec,
  tlnavThumb, tlnavScrollForThumbPos, tlnavScrollForBarClick, TLNAV_MIN_THUMB,
} from '../js/model.js';
import { Player } from '../js/player.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const playerSrc = readFileSync(join(root, 'js', 'player.js'), 'utf8');
const cssSrc = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const htmlSrc = readFileSync(join(root, 'index.html'), 'utf8');
const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');

// ---------- F1：stage 播放直达音乐尾 ----------
// 试金石：3 队形 16+8=64 拍（120BPM=32s clip 域）+ 64s 资产/全长 clip（音乐域 64s=128 拍）
// （build-70 夹具迁移：formation i startBeat=i*24、lenBeats=16 —— 旧 blocks hold16+travel8 等价域）
function stoneProject({ withAudio = true } = {}) {
  const p = createProject({ pairs: 1, grouping: 'none' });
  while (p.formations.length < 3) p.formations.push({ id: `f${p.formations.length}`, name: `F${p.formations.length}`, color: '#64748b', note: '', positions: {} });
  p.formations.forEach((f, i) => { f.startBeat = i * 24; f.lenBeats = 16; });
  if (withAudio) {
    p.media = { assets: [{ id: 'a1', name: 'long.wav', durationSec: 64, size: 1 }], activeAssetId: 'a1' };
    p.timeline.audioClips = [{ id: 'c1', assetId: 'a1', trackId: 'trk1', timelineStartSec: 0, srcStartSec: 0, lengthSec: 64, fadeInSec: 0, fadeOutSec: 0, gain: 1, name: 'long' }];
    p.audio.name = 'long.wav';
    p.audio.durationSec = 64;
  }
  return p;
}
function makePlayer(project, { mode = 'stage' } = {}) {
  const events = { states: [] };
  const audio = {
    ready: false, duration: 0, currentTime: 0,
    get playing() { return false; },
    play() {}, pause() {}, stop() {}, seek() {}, setRate() {}, click() {},
  };
  const p = new Player({
    audio, getProject: () => project, getMode: () => mode,
    onTick: () => {}, onStateChange: s => events.states.push(s), onCountin: () => {}, onPreviewEnd: () => {},
  });
  return { p, events };
}
function advance(pl, dtMs) {
  if (pl._virtual) pl._virtual.t0 -= dtMs;
  pl._tick();
}

test('F1 stage 有音频：seek 钳音乐域（blocks 域之外可达）；无音频：钳 totalBeats（编舞排练语义）', () => {
  const { p: pl } = makePlayer(stoneProject({ withAudio: true }));
  pl.seekBeat(1000);
  assert.equal(pl.beat, 128, '钳 secToBeat(64s)=128 拍');
  pl.seekBeat(-5);
  assert.equal(pl.beat, 0, '负值钳 0');

  const { p: pl2 } = makePlayer(stoneProject({ withAudio: false }));
  pl2.seekBeat(1000);
  assert.equal(pl2.beat, 64, '无音频 → 钳 totalBeats=64');
});

test('F1 stage 有音频：ended=音乐域尾（33s 不掐断、64s 终态、无虚拟接管）；无音频：blocks 域 ended 保留', () => {
  const { p: pl, events } = makePlayer(stoneProject({ withAudio: true }));
  pl.play(0, { forceVirtual: true });
  advance(pl, 33 * 1000);
  assert.equal(pl.playing, true, '33s > blocks 域仍播放（用户指令：直达音乐尾）');
  advance(pl, 40 * 1000); // 累计 73s > 64s
  assert.equal(pl.playing, false);
  assert.equal(events.states.at(-1).ended, true);
  assert.equal(pl.beat, 128, '停音乐域尾拍');
  assert.equal(pl._audioEnded, false, '无虚拟接管');

  const { p: pl2, events: ev2 } = makePlayer(stoneProject({ withAudio: false }));
  pl2.play(0, { forceVirtual: true });
  advance(pl2, 33 * 1000);
  assert.equal(pl2.playing, false, '无音频 → 32s blocks 域照旧 ended');
  assert.equal(pl2.beat, 64);
  assert.equal(ev2.states.at(-1).ended, true);
});

test('F1 stage 无音频：_finish 虚拟接管语义保留（round30 #7——编舞排练跟队形走完）', () => {
  const { p: pl, events } = makePlayer(stoneProject({ withAudio: false }));
  pl._finish(true, 20); // 「音频」20s 先完，blocks 32s
  assert.equal(pl._audioEnded, true, '虚拟接管标记（无音频路径保留）');
  assert.equal(events.states.at(-1).reason, 'audio');
  assert.equal(pl.beat, 40, '钳音频末拍 20s=40 拍');
});

test('F1 formationIndex 越界防护：currentFormationIndexAt 域外恒 ≤ 末队形；main onTick 钳制链静态断言', () => {
  // 模型层：播放头越过 blocks 域（stage+音频场景）后 seg 派生索引不越界
  const p = stoneProject({ withAudio: true });
  const beyond = secToBeat(p, musicDomainSec(p)) + 10;
  const idx = currentFormationIndexAtSafe(p, beyond);
  assert.ok(idx < p.formations.length, `域外索引 ${idx} 不越界（< ${p.formations.length}）`);
  assert.equal(idx, p.formations.length - 1, '域外钳末队形');
  // main 层 onTick：越界钳制 + store.setUI 同步钳制（源码静态——onTick 闭包不可 node 直调）
  const i0 = mainSrc.indexOf('onTick: t =>');
  const i1 = mainSrc.indexOf('onPreviewEnd: () =>');
  const tick = mainSrc.slice(i0, i1);
  assert.match(tick, /Math\.min\(t\.formationIndex \?\? 0, fiMax\)/, 'formationIndex 钳末队形');
  assert.match(tick, /store\.setUI\(\{ formationIndex: fi \}\)/, 'store.setUI 同步钳制值');
  assert.match(tick, /fiMax = Math\.max\(0, \(store\.getState\(\)\.project\?\.formations\.length \|\| 1\) - 1\)/, 'fiMax=末队形下标');
});
function currentFormationIndexAtSafe(p, beat) {
  // 与 model.currentFormationIndexAt 同口径（避免再导出一个内部符号——直接复算 clip 派生）：
  // clip 内=该队形；变换段（clip 间空隙）=前队形；候场=0；越末 clip.end=末队形
  const { segments } = segmentsFromClips(p.formations);
  if (!segments.length) return 0;
  if (beat <= 0) return segments[0].i;
  for (let k = 0; k < segments.length; k++) {
    if (beat < segments[k].end) return segments[k].i;
    const next = segments[k + 1];
    if (next && beat < next.start) return segments[k].i; // 变换段（clip 间空隙）=前队形
  }
  return segments[segments.length - 1].i;
}

// ---------- F2：索引面板避让侧栏（build-56-indextab 退役改写） ----------
test('F2 退役改写：浮动面板避让摆位与挂点随索引入侧栏 tab 整体退役——model/main 无残留', () => {
  // build-51 F2 的「索引不遮侧栏」需求由挂载点本身满足（索引=侧栏 tab/pane，与媒体库/属性
  // 共生不重叠）——避让定位纯函数与摆位单入口及其全部挂点清场（新守卫在 tests/indextab.test.js）
  const modelSrc = readFileSync(join(root, 'js', 'model.js'), 'utf8');
  assert.ok(!modelSrc.includes('segIndexPlacement'), '避让定位纯函数已从 model 退役');
  assert.ok(!modelSrc.includes('SI_AVOID'), '避让常量组已退役');
  assert.ok(!mainSrc.includes('siApplyPlacement'), '摆位单入口已退役');
  assert.ok(!mainSrc.includes('siAvoidTarget'), '避让物占位读取已退役');
  // 「索引不遮侧栏」不变量换由挂载结构钉住：stage 索引在右面板页容器内 / music 索引在 rsb 段 pane 内
  assert.ok(htmlSrc.includes('id="props-index"'), 'stage 索引=右面板页容器');
  assert.ok(htmlSrc.includes('id="rsb-index-pane"'), 'music 索引=rsb 段 pane');
});

// ---------- F3：stage 三侧折叠 + 索引入口 ----------
test('F3 记忆键与 stage 作用域：wuzhen:stageLeft/Right/Bottom；折叠类只对 data-uimode="stage" 生效', () => {
  assert.match(mainSrc, /const STAGEUX_KEY = \{ left: 'wuzhen:stageLeft', right: 'wuzhen:stageRight', bottom: 'wuzhen:stageBottom' \};/,
    '记忆键（wuzhen: 前缀纪律）');
  // 底部折叠类必须 stage 作用域（音乐模式 #bottom-area 恒按自身状态呈现）
  // build-91-varispeed：折叠不再整区隐藏——只藏播放条以外的行，播放条保留可用
  assert.match(cssSrc, /#editor-view\[data-uimode="stage"\] #bottom-area\.ba-collapsed > :not\(#playbar\)\{display:none\}/, '折叠只藏播放条以外各行（播放条保留）');
  assert.doesNotMatch(cssSrc, /#editor-view\[data-uimode="stage"\] #bottom-area\.ba-collapsed\{display:none\}/, '整区隐藏旧规则已退役');
  assert.match(cssSrc, /#editor-view\[data-uimode="stage"\] #bottom-strip\.bs-on\{display:flex\}/, '细条仅 stage+折叠态呈示');
  assert.doesNotMatch(cssSrc, /(^|;)#bottom-area\.ba-collapsed\{/, '无 stage 作用域的底部折叠规则不存在（不串场）');
  // 列折叠：桌面 stage 作用域（.col-fold/.col-strip 缺省 display:none，≥1024 stage 才放开）
  assert.match(cssSrc, /#editor-view\[data-uimode="stage"\] \.col-fold\{display:block\}/, '折叠钮仅桌面 stage 呈示');
  assert.match(cssSrc, /#editor-view\[data-uimode="stage"\] #left-panel\.lp-collapsed,\s*\n\s*#editor-view\[data-uimode="stage"\] #right-panel\.rp-collapsed\{width:38px;min-width:38px\}/, '列收成 38px 细条');
  assert.match(cssSrc, /#editor-view\[data-uimode="stage"\] #left-panel\.lp-collapsed #lp-strip,\s*\n\s*#editor-view\[data-uimode="stage"\] #right-panel\.rp-collapsed #rp-strip\{display:flex\}/, '细条态竖排字呈示');
  // boot 读偏好不回写（只显式 toggle 落盘）
  assert.match(mainSrc, /applyStageLeftCollapsed\(lsRef\(\)\?\.getItem\(STAGEUX_KEY\.left\) === '1'\);/, 'boot 偏好恢复（左列）');
  assert.match(mainSrc, /applyStageBottomCollapsed\(lsRef\(\)\?\.getItem\(STAGEUX_KEY\.bottom\) === '1'\);/, 'boot 偏好恢复（底部）');
  assert.match(mainSrc, /localStorage\.setItem\(STAGEUX_KEY\.left, collapsed \? '1' : '0'\)/, '显式 toggle 落盘');
});
test('F3 索引入口与底部折叠钮：块时长条行尾 #bc-seg-index 复用 toggleSegIndexPanel；#bottom-strip 成对切换', () => {
  assert.match(htmlSrc, /<button id="bc-seg-index" class="btn small" title="乐段索引面板（⌘⇧L）[^"]*">索引<\/button>/, 'stage 行尾索引钮（同款样式）');
  assert.match(mainSrc, /\$\('bc-seg-index'\)\?\.addEventListener\('click', toggleSegIndexPanel\);/, '复用同一开合函数（与音乐 #mtb-seg-index 同组件）');
  assert.match(htmlSrc, /<button id="bc-bottom-collapse" class="btn small" aria-expanded="true" title="收起底部时间轴区（记忆）">⌄<\/button>/, '行尾底部折叠钮（与索引钮相邻）');
  // build-91-varispeed F2 改写注明：细条加 chevron 展开引导图标（+hover 提亮见 F2 CSS），
  // 文本断言随之允许前导 svg（方向：左细条右向/右细条左向/底部细条上向）
  assert.match(htmlSrc, /<button id="bottom-strip" title="展开底部时间轴区（记忆）"[^>]*><svg class="chev"[\s\S]*?<path d="M5 15l7-7 7 7"\/>[\s\S]*?<\/svg>时间轴<\/button>/, '28px 细条（时间轴字样+上向 chevron+整条点击展开）');
  assert.match(mainSrc, /\$\('bottom-strip'\)\?\.addEventListener\('click', \(\) => applyStageBottomCollapsed\(false, \{ persist: true \}\)\);/, '细条整条点击=重开');
  assert.match(mainSrc, /ba\.classList\.toggle\('ba-collapsed', !!collapsed\);\s*\n\s*strip\?\.classList\.toggle\('bs-on', !!collapsed\);/, '折叠类与细条类成对切换');
  // ⌘⇧L 快捷键两模式通用（既有接线不动）
  assert.match(mainSrc, /e\.shiftKey && e\.key\.toLowerCase\(\) === 'l'/, '⌘⇧L 接线在');
});
test('F3 细条形态纪律：竖排字（writing-mode:vertical-rl）、列收细条仍可点、折叠钮 aria-expanded', () => {
  assert.match(cssSrc, /\.col-strip\{display:none;flex-direction:column;align-items:center;gap:8px;padding:10px 0;min-height:0;flex:1;/, '细条基础形态（flex 列、吃余高）');
  assert.match(cssSrc, /writing-mode:vertical-rl;letter-spacing:4px/, '竖排「队形/属性」字样');
  // build-91-varispeed F2 改写注明：列细条文本前加方向 chevron（左列 » / 右列 «，指向展开方向）
  assert.match(htmlSrc, /<button id="lp-strip" class="col-strip"[^>]*><svg class="chev"[\s\S]*?<path d="M9 5l7 7-7 7"\/>[\s\S]*?<\/svg>队形<\/button>/, '左细条=队形+右向 chevron');
  assert.match(htmlSrc, /<button id="rp-strip" class="col-strip"[^>]*><svg class="chev"[\s\S]*?<path d="M15 5l-7 7 7 7"\/>[\s\S]*?<\/svg>属性<\/button>/, '右细条=属性+左向 chevron');
  assert.match(mainSrc, /btn\.setAttribute\('aria-expanded', String\(!collapsed\)\);/, 'aria-expanded 同步');
});

// ---------- F4：时间轴底部导航滑块 ----------
test('F4 tlnavThumb 几何：拇指宽=可视/内容×条宽（≥24 下限）、位置=scrollLeft/溢出映射、不溢出=满宽禁用', () => {
  assert.equal(TLNAV_MIN_THUMB, 24, '拇指最小宽');
  const g = tlnavThumb({ clientW: 400, scrollW: 1600, scrollLeft: 600, barW: 400 });
  assert.equal(g.disabled, false);
  assert.equal(g.w, 100, '400/1600×400=100');
  assert.equal(g.x, 150, '600/1200×(400−100)=150');
  const gMin = tlnavThumb({ clientW: 400, scrollW: 8000, scrollLeft: 0, barW: 400 });
  assert.equal(gMin.w, 24, '极长内容取 24px 下限');
  const gFull = tlnavThumb({ clientW: 400, scrollW: 400, scrollLeft: 0, barW: 400 });
  assert.equal(gFull.disabled, true, '内容不溢出=禁用态');
  assert.equal(gFull.w, 400, '禁用态拇指满宽');
  const gClamp = tlnavThumb({ clientW: 400, scrollW: 1600, scrollLeft: 9999, barW: 400 });
  assert.equal(gClamp.x, 300, 'scrollLeft 越界钳量程（x 最大=条宽−拇指宽）');
  const gZero = tlnavThumb({ clientW: 0, scrollW: 0, scrollLeft: 0, barW: 0 });
  assert.equal(gZero.disabled, true, '零尺寸安全（禁用）');
});
test('F4 拖动换算与点条跳转：thumbPos 比例映射钳量程；barClick 视口中心对齐', () => {
  assert.equal(tlnavScrollForThumbPos({ thumbLeft: 0, thumbW: 100, barW: 400, clientW: 400, scrollW: 1600 }), 0, '拖到最左=0');
  assert.equal(tlnavScrollForThumbPos({ thumbLeft: 300, thumbW: 100, barW: 400, clientW: 400, scrollW: 1600 }), 1200, '拖到最右=溢出量 1200');
  assert.equal(tlnavScrollForThumbPos({ thumbLeft: 150, thumbW: 100, barW: 400, clientW: 400, scrollW: 1600 }), 600, '中点比例映射');
  assert.equal(tlnavScrollForThumbPos({ thumbLeft: 9999, thumbW: 100, barW: 400, clientW: 400, scrollW: 1600 }), 1200, '拖出条外钳量程');
  // 点条身：目标 scrollLeft = 当前 + 点击点 − 条宽/2（点击处内容滚到视口中心）
  assert.equal(tlnavScrollForBarClick({ clickX: 200, barW: 400, clientW: 400, scrollW: 1600, scrollLeft: 0 }), 0, '点条中心=不动');
  assert.equal(tlnavScrollForBarClick({ clickX: 400, barW: 400, clientW: 400, scrollW: 1600, scrollLeft: 0 }), 200, '点条尾=右移 200');
  assert.equal(tlnavScrollForBarClick({ clickX: 400, barW: 400, clientW: 400, scrollW: 1600, scrollLeft: 9999 }), 1200, '目标钳量程');
  assert.equal(tlnavScrollForBarClick({ clickX: 10, barW: 400, clientW: 400, scrollW: 1600, scrollLeft: 100 }), 0, '负目标钳 0');
});
test('F4 DOM 与接线：#tl-nav 在 #tl-scroll 之下；scroll+render 双同步源；Pointer Events 拖拽；原生滚条保留', () => {
  // 结构：#tl-scroll 闭 合 → #tl-nav 兄弟（时间轴区域内、播放条之上）
  const iScroll = htmlSrc.indexOf('<div id="tl-scroll">');
  const iNav = htmlSrc.indexOf('<div id="tl-nav"');
  assert.ok(iScroll > 0 && iNav > iScroll, '#tl-nav 在 #tl-scroll 之后');
  assert.match(htmlSrc, /<\/div><\/div>\s*<!-- build-51-stageux F4：时间轴底部导航滑块/, '紧随 #tl-scroll 闭合');
  assert.match(cssSrc, /#tl-nav\{position:relative;height:16px;flex:none;/, '16px 恒显条');
  assert.match(cssSrc, /#tl-nav\.tlnav-off\{opacity:\.5\}/, '禁用态减淡呈示');
  // 同步源：scroll 事件 + render 尾部 hooks.onAfterRender
  assert.match(mainSrc, /sc\.addEventListener\('scroll', syncTlNav, \{ passive: true \}\);/, 'scroll 事件同步');
  assert.match(tlSrc, /this\.hooks\.onAfterRender\?\.\(\);/, 'render 尾部钩子（mt.W 变化源）');
  assert.match(mainSrc, /onAfterRender: \(\) => syncTlNav\(\)/, 'main 侧挂 render 尾同步');
  assert.match(mainSrc, /function syncTlNav\(\)/, '同步单入口');
  assert.match(mainSrc, /M\.tlnavThumb\(\{ clientW: sc\.clientWidth, scrollW: sc\.scrollWidth, scrollLeft: sc\.scrollLeft, barW: nav\.clientWidth \}\)/, '几何走纯函数');
  // 拖拽纪律：Pointer Events + setPointerCapture（与 siWireResize/wireRsbResize 同规，无 mousemove 混用）
  const i0 = mainSrc.indexOf('function wireTlNav');
  const i1 = mainSrc.indexOf('// 点击快速添加（build-43-accept');
  const nav = mainSrc.slice(i0, i1);
  assert.match(nav, /thumb\.setPointerCapture\(e\.pointerId\)/, 'pointerdown 捕获');
  assert.match(nav, /thumb\.releasePointerCapture\(/, 'pointerup 释放');
  assert.match(nav, /addEventListener\('pointercancel'/, 'pointercancel 兜底');
  assert.ok(!nav.includes('mousemove'), '禁 mousemove 混用');
  assert.match(nav, /M\.tlnavScrollForThumbPos\(/, '拖动=纯函数换算');
  assert.match(nav, /M\.tlnavScrollForBarClick\(/, '点条身=纯函数换算');
  assert.match(nav, /e\.target === thumb \|\| nav\.classList\.contains\('tlnav-off'\)/, '点拇指不双跳；禁用态整条不响应');
  // 原生细滚条保留（概览导航不替代）：music 作用域滚条规则仍在
  assert.match(cssSrc, /#tl-scroll\{scrollbar-width:thin;scrollbar-color:var\(--dim\) transparent\}/, '原生细滚条保留不删（build-81 全模式化）');
  assert.match(cssSrc, /#tl-body\{position:relative;display:flex;flex-direction:column\}/, '#tl-body 纵向 flex（概览条居下）');
  assert.match(cssSrc, /#editor-view\[data-uimode="music"\] #tl-scroll\{flex:1 1 auto;min-height:0\}/, '音乐模式 flex 撑满（让位 16px 条）');
  // 两模式恒显：无 data-uimode 门控的 #tl-nav display:none 规则不得存在
  assert.doesNotMatch(cssSrc, /#tl-nav\{[^}]*display:none/, '概览条不随模式隐藏');
});
