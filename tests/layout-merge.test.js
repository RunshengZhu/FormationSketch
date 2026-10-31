// build-46-layout：音乐模式 Layout 合并 + 交互改造 node 单测。
// 覆盖面（浏览器全管线——真实拖宽/折叠/抽屉手势/数拍大字——由 lab CDP 探针覆盖，此处锁
// 机器面）：
//   S1 结构静态断言（index.html）：#right-sidebar 合并栏存在、#music-preview/#media-sidebar
//      id 原样迁入（main.js/timeline.js 按 id 取用）、段折叠钮/grip/收起钮、旧 id 退役。
//   S2 CSS 静态断言（style.css）：编舞模式不可见（E-12 作用域）、整栏收起细条/移动抽屉形态、
//      拖宽 grip touch-action:none、轨头收起 16px/拖宽 grip、单行资产行（~32px、不换行）。
//   S3 JS 静态断言：F3 淡化把手无条件绘制/命中门控移除、F5 drawBlocks 门控与 edgeHits
//      stage-only 门控移除、六枚 wuzhen: 记忆键、拖宽走 Pointer Events（setPointerCapture）。
//   S4 纯函数：clampSidebarWidth / clampHeadWidth 钳制、musicLaneH/musicContentH extraH
//      （F5 块区 42px 开销）、resolveRsbClosed / resolveSegFold 偏好解析。
//   S5 几何/命中（MusicTimeline 实例，render 桩替身）：blocksTopFor 模式感知（编舞逐值不动）、
//      音乐模式块边命中（F5）、常驻淡化把手命中（F3：fade=0 缘把手命中 + trim 全高不侵占）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MusicTimeline, clampSidebarWidth, clampHeadWidth,
  musicLaneH, musicContentH, TRACKS_OPS_H,
  MUSIC_BLOCKS_H, MUSIC_BLOCKS_GAP_H, MUSIC_BLOCKS_TOTAL_H,
} from '../js/timeline.js';
import { resolveRsbClosed, resolveSegFold } from '../js/ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function mobMiniBar(css) {
  return css.includes('grid-template-columns:88px') || css.includes('#rsb-closed #rsb-body{display:flex}');
}
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const tlSrc = readFileSync(join(root, 'js', 'timeline.js'), 'utf8');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const uiSrc = readFileSync(join(root, 'js', 'ui.js'), 'utf8');

if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {} };
const winHs = {};
window.addEventListener = (t, fn) => { (winHs[t] = winHs[t] || []).push(fn); };

// ---------- S1 结构静态断言 ----------
test('L46 S1a 合并栏结构：#right-sidebar 容器内含预览段+媒体库段，子件 id 原样保留', () => {
  const side = html.slice(html.indexOf('id="right-sidebar"'), html.indexOf('</aside>', html.indexOf('id="right-sidebar"')));
  assert.ok(side.includes('id="music-preview"'), '#music-preview 迁入合并栏（id 保留）');
  assert.ok(side.includes('id="media-sidebar"'), '#media-sidebar 迁入合并栏（id 保留）');
  assert.ok(side.includes('id="msb-body"'), '#msb-body 渲染挂载点保留');
  assert.ok(side.includes('id="mp-canvas"'), 'mp 子件 id 保留（mp-countin 已随 build-68-nocountin 退役）');
  assert.ok(side.includes('id="rsb-preview-seg"') && side.includes('id="rsb-lib-seg"'), '两段 section 存在');
  assert.ok(side.includes('id="rsb-preview-toggle"') && side.includes('id="rsb-lib-toggle"'), '段折叠钮存在');
  assert.ok(side.includes('id="rsb-grip"') && side.includes('id="rsb-collapse"'), '拖宽 grip 与整栏收起钮存在');
});
test('L46 S1b 旧交互件退役：#mp-collapse/#msb-collapse/#msb-head 不再出现', () => {
  assert.ok(!html.includes('id="mp-collapse"'), 'mp-collapse 退役（由 rsb-preview-toggle 承担）');
  assert.ok(!html.includes('id="msb-collapse"'), 'msb-collapse 退役（由 rsb-lib-toggle 承担）');
  assert.ok(!html.includes('id="msb-head"'), 'msb-head 抽屉把手退役（手势迁移到整栏）');
});

// ---------- S2 CSS 静态断言 ----------
test('L46 S2a 合并栏呈示作用域：编舞模式不可见（E-12），仅音乐模式 flex 呈示', () => {
  assert.ok(/#right-sidebar\{display:none\}/.test(css), '缺省 display:none');
  assert.ok(css.includes('#editor-view[data-uimode="music"] #right-sidebar{display:flex}'), '音乐模式呈示');
});
test('L46 S2b 整栏收起=零占位/拖宽/移动抽屉形态齐备（验收反馈二改版）', () => {
  // 验收反馈二：完全收起=display:none 零占位（16px 细条 / 88px 迷你条「半收起」态退役）
  assert.ok(/#editor-view\[data-uimode="music"\] #right-sidebar\.rsb-closed\{display:none\}/.test(css), '整栏收起=display:none（多轨区满幅）');
  assert.ok(!/\.rsb-closed\{width:16px/.test(css) && !mobMiniBar(css), '16px 细条/88px 迷你条半收起态已退役');
  assert.ok(/#rsb-grip\{[^}]*cursor:col-resize;touch-action:none/.test(css), '拖宽 grip 禁浏览器手势接管');
  assert.ok(/#rsb-collapse\{position:absolute/.test(css), '收起钮绝对定位（不占布局行）');
  // 抽屉形态规则位于 max-width 媒体查询内（取合并栏 position:fixed 块附近切片，勿用文件尾查询）
  const anchor = css.indexOf('position:fixed;left:0;right:0;bottom:var(--pb-h)');
  assert.ok(anchor > 0, '移动端抽屉固定定位存在');
  const mob = css.slice(css.lastIndexOf('@media', anchor), anchor + 1200);
  assert.ok(mob.includes('@media (max-width:1023.5px)'), '抽屉规则在移动断点内');
  assert.ok(/height:50vh;max-height:50vh/.test(mob), '抽屉展开=50vh');
  assert.ok(mob.includes('.mp-s{display:none}'), '375 横溢保护保留（mp-s 隐藏）');
  assert.ok(/max-width:min\(480px,60%\)/.test(css), '拖宽上限防破版');
});
test('L46 S2c 轨头侧边栏化：grip/收起钮/16px 收起态，移动端 grip 收纳（宽度记忆不破 375）', () => {
  assert.ok(/#tlh-grip\{[^}]*cursor:col-resize;touch-action:none/.test(css), '轨头拖宽 grip');
  // 18px：验收反馈「收起后找不到打开通道」整改——细条加宽 1 级并全高钮化（16px 触达过窄）
  assert.ok(/#tl-tracks-head\.tlh-collapsed\{width:18px/.test(css), '轨头收起=18px（headWidth 读数链路）');
  assert.ok(css.includes('#tl-tracks-head.tlh-collapsed .tlh-track{display:none}') || css.includes('.tlh-collapsed .tlh-track'), '收起态收纳轨行');
  // build-48-tagui 注：移动端媒体块内新增 tag 层区紧凑规则（.tlh-lvl*，C-09a），取窗 +300→+700；
  // 断言意图不变（#tlh-grip{display:none} 与 width:96px 仍同属一个媒体块）。
  const mobHead = css.slice(css.indexOf('#tl-tracks-head{width:96px}') - 200, css.indexOf('#tl-tracks-head{width:96px}') + 700);
  assert.ok(mobHead.includes('#tlh-grip{display:none}'), '移动端轨头 grip 隐藏（96px 恒定防横溢）');
});
test('L46 S2d F4 单行资产行：紧凑行高、名称 ellipsis、操作不换行（旧 wrap 布局退役）', () => {
  assert.ok(/#msb-body \.mlib-row\{display:flex;align-items:center;[^}]*min-height:32px/.test(css), '~32px 单行');
  assert.ok(/#msb-body \.mlib-row \.mlib-name\{[^}]*text-overflow:ellipsis/.test(css), '名称 ellipsis');
  const rowRule = css.match(/#msb-body \.mlib-row\{[^}]*\}/)[0];
  assert.ok(!rowRule.includes('flex-wrap:wrap'), '旧「名称独占一行+操作换行」布局退役');
});

// ---------- S3 JS 静态断言 ----------
test('L46 S3a F3：淡化把手无条件绘制 + 命中 0.005 门控移除（曲线绘制门控保留）', () => {
  assert.ok(!tlSrc.includes("if ((c.fadeInSec || 0) > 0.005) drawFh"), 'drawFh 淡入门控已删');
  assert.ok(!tlSrc.includes("if ((c.fadeOutSec || 0) > 0.005) drawFh"), 'drawFh 淡出门控已删');
  assert.ok(/drawFh\(x0 \+ \(c\.fadeInSec \|\| 0\) \* pps/.test(tlSrc), '淡入把手贴左缘无条件绘制');
  assert.ok(!/\(c\.fadeInSec \|\| 0\) > 0\.005 && Math\.abs\(x - \(x0 \+ c\.fadeInSec/.test(tlSrc), '命中 fadeIn 门控已删');
  assert.ok(!/\(c\.fadeOutSec \|\| 0\) > 0\.005 && Math\.abs\(x - \(x1 - c\.fadeOutSec/.test(tlSrc), '命中 fadeOut 门控已删');
  assert.ok(tlSrc.includes("if ((c.fadeInSec || 0) > 0.005) drawFadeCurve('in')"), '淡化曲线仍按既有阈值绘制（无淡化不画曲线）');
});
test('L46 S3b F5：块区两模式常显（render 门控/edgeHits stage-only 门控移除）', () => {
  assert.ok(!tlSrc.includes("if (this.mode === 'stage') this.drawBlocks"), 'render 块区 stage 门控已删');
  assert.ok(!tlSrc.includes("if (this.mode !== 'stage') return []; // 音乐模式"), 'edgeHits stage-only 早退已删');
  assert.ok(tlSrc.includes('const ops = this.mode === \'music\' ? TRACKS_OPS_H : 0;'), 'blocksTopFor 模式感知（音乐让过加轨条）');
  assert.ok(tlSrc.includes('MUSIC_BLOCKS_TOTAL_H'), '块区常显开销常量接线');
});
test('L46 S3c 记忆键白名单 + Pointer Events 纪律', () => {
  for (const key of ['wuzhen:rsbClosed', 'wuzhen:rsbW', 'wuzhen:rsbPreview', 'wuzhen:rsbLib', 'wuzhen:trkHeadClosed', 'wuzhen:trkHeadW']) {
    assert.ok(mainSrc.includes(`'${key}'`), `记忆键 ${key} 落码`);
  }
  assert.ok(!mainSrc.includes("'wuzhen:mpCollapsed'") && !mainSrc.includes("'wuzhen:mediaSidebar'"), '旧键退役（不再写入）');
  assert.ok((mainSrc.match(/setPointerCapture/g) || []).length >= 2, '拖宽走 Pointer Events + setPointerCapture（栏 grip + 轨头 grip）');
  assert.ok(uiSrc.includes("resolveRsbClosed"), 'ui.js 导出 resolveRsbClosed（合并栏开合偏好）');
});

// ---------- S4 纯函数 ----------
test('L46 S4a clampSidebarWidth：min 180、max min(480, 容器40%)、容器极窄 floor 胜出、非法入参兜底', () => {
  assert.equal(clampSidebarWidth(280, 1000), 280, '区间内原样');
  assert.equal(clampSidebarWidth(50, 1000), 180, '低于下限钳 180');
  assert.equal(clampSidebarWidth(600, 1000), 400, '超上限钳 min(480, 400)=400');
  assert.equal(clampSidebarWidth(600, 2000), 480, '大容器封顶 480');
  assert.equal(clampSidebarWidth(200, 300), 180, '容器 40%<min → floor 胜出（不破版）');
  assert.equal(clampSidebarWidth('x', 1000), 400, '非法入参回上限');
  assert.equal(clampSidebarWidth(NaN, undefined), 180, '无容器宽 → max=180=floor');
});
test('L46 S4b clampHeadWidth：96–240、非法回桌面缺省 148', () => {
  assert.equal(clampHeadWidth(120), 120);
  assert.equal(clampHeadWidth(50), 96, '下限 96（移动端信息密度）');
  assert.equal(clampHeadWidth(500), 240, '上限 240');
  assert.equal(clampHeadWidth('x'), 148, '非法回缺省');
});
test('L46 S4c F5 laneH/contentH extraH：缺省 0=旧四参调用逐值不变；42 开销下 floor 56 不破', () => {
  // 旧口径（extraH 缺省 0）——w1/w3 既有断言不回退
  assert.equal(musicLaneH(727, 1), 120);
  assert.equal(musicLaneH(336, 4), 56);
  assert.equal(musicContentH(120, 1), 22 + 28 + 120 + TRACKS_OPS_H);
  // 新口径（块区常显 42px 开销）
  assert.equal(MUSIC_BLOCKS_TOTAL_H, MUSIC_BLOCKS_H + MUSIC_BLOCKS_GAP_H);
  assert.equal(MUSIC_BLOCKS_TOTAL_H, 42, '块区 36 + 间距 6');
  assert.equal(musicLaneH(336 + 42, 4, TRACKS_OPS_H, 120, 42), 56, '+42 容器=旧 336 容器同结果（下限不破）');
  assert.equal(musicContentH(56, 4, TRACKS_OPS_H, 42), 22 + 28 + 4 * 56 + 3 * 12 + 26 + 42, '内容高含块区');
});
test('L46 S4d 偏好解析：resolveRsbClosed 按形态缺省（移动收/桌面开）、resolveSegFold 未写用缺省', () => {
  assert.equal(resolveRsbClosed(null, false), false, '桌面缺省展开');
  assert.equal(resolveRsbClosed(null, true), true, '移动缺省收成迷你条');
  assert.equal(resolveRsbClosed({ getItem: () => '0' }, true), false, '显式 "0"=展开（记忆优先于形态缺省）');
  assert.equal(resolveRsbClosed({ getItem: () => '1' }, false), true, '显式 "1"=收起');
  assert.equal(resolveRsbClosed({ getItem: () => { throw new Error('隐私模式'); } }, false), false, 'storage 异常回缺省');
  assert.equal(resolveSegFold(null, 'wuzhen:rsbLib', true), true, '未写=调用方缺省（窄桌面媒体库段折叠）');
  assert.equal(resolveSegFold({ getItem: () => '0' }, 'wuzhen:rsbLib', true), false, '显式展开优先');
  assert.equal(resolveSegFold({ getItem: () => '1' }, 'wuzhen:rsbPreview', false), true);
});

// ---------- S5 几何/命中（MusicTimeline 实例） ----------
function fakeEl() {
  const hs = {};
  return {
    _hs: hs,
    addEventListener: (t, fn) => { (hs[t] = hs[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    style: {},
  };
}
const mkClip = (id, start, len, extra = {}) => ({
  id, timelineStartSec: start, srcStartSec: 0, lengthSec: len,
  gain: 1, fadeInSec: 0, fadeOutSec: 0, ...extra,
});
function makeProj() {
  return {
    audio: { bpm: 120, beatsPerBar: 4, firstBeatSec: 0, name: '', durationSec: 40 },
    timeline: {
      tags: [],
      tracks: [{ id: 'trk1', name: '配乐', gain: 1, muted: false }],
      audioClips: [mkClip('c1', 0, 10)],
    },
    // build-70 夹具迁移：旧 blocks [hold16+travel8, hold16] → clip [0,16)/[24,40)（拍）
    formations: [
      { id: 'f1', name: 'A', color: '#64748b', positions: { a: { x: 1, y: 1 } }, merges: [], startBeat: 0, lenBeats: 16 },
      { id: 'f2', name: 'B', color: '#64748b', positions: { a: { x: 2, y: 1 } }, merges: [], startBeat: 24, lenBeats: 16 },
    ],
    media: { assets: [{ id: 'a1', name: '曲一', durationSec: 40 }] },
  };
}
function makeTL(proj = makeProj()) {
  winHs.pointerup = [];
  const cv = fakeEl(), ov = fakeEl(), sc = fakeEl();
  sc.scrollLeft = 0; sc.scrollTop = 0;
  const tl = new MusicTimeline({
    canvas: cv, overlay: ov, scroll: sc,
    hooks: {
      getProject: () => proj,
      getPlayer: () => ({ beat: 0 }),
      audio: null,
      getIndex: () => 0,
      ripple: () => true,
      onSelectFormation: () => {},
      mutate: fn => fn(proj),
      commitEdit: () => {},
      seekBeat: () => {},
    },
  });
  tl.secPerPx = 0.05; // pps=20（绕开自适应几何）
  return { tl, cv, sc, proj };
}

test('L46 S5a blocksTopFor 模式感知：编舞=audioBottom+6（逐值不动）；音乐=+加轨条26+6（F5）', () => {
  const { tl, proj } = makeTL();
  tl.mode = 'stage';
  const stageBottom = tl.audioBottom(proj);
  assert.equal(tl.blocksTopFor(), stageBottom + 6, '编舞块区顶逐值不动（E-12）');
  tl.mode = 'music';
  const musicBottom = tl.audioBottom(proj);
  assert.equal(tl.blocksTopFor(), musicBottom + TRACKS_OPS_H + MUSIC_BLOCKS_GAP_H, '音乐块区让过加轨条再留 6px');
  // 常显开销接线：内容高恰含块区（audioBottom+32+36 ≤ musicContentH）
  const content = musicContentH(tl.audioLaneH(), tl.trackCount(proj), TRACKS_OPS_H, MUSIC_BLOCKS_TOTAL_H);
  assert.ok(tl.blocksTopFor() + MUSIC_BLOCKS_H <= content + 1e-9, '块区完整落在内容高内');
});

test('L46 S5b F5 音乐模式块边可命中（edgeHits 门控移除）+ 块身命中域在块区带', () => {
  const { tl } = makeTL();
  tl.mode = 'music';
  tl.rulerH = 22; tl.W = 800; tl.H = 400;
  // clip0 右缘（beat 16 × 0.5s = 8s → x=160；左邻空隙使左缘 x=240 不在此）
  const edges = tl.edgeHits(160);
  assert.equal(edges.length, 1, '音乐模式块边命中不再 stage-only');
  assert.equal(edges[0].kind, 'clipR', 'build-70 M2：块缘=clip 左/右缘（旧 hold 把手退役）');
  assert.equal(edges[0].seg.i, 0);
  // 贴合形态（空隙 0）：同一点=前 clip 右缘+后 clip 左缘双命中（clipL 优先=拖动改前段）
  const p2 = makeProj();
  p2.formations[1].startBeat = 16; // clip1 贴住 clip0.end=8s
  const { tl: tl2 } = makeTL(p2);
  const both = tl2.edgeHits(160);
  assert.equal(both.length, 2, '贴合处双缘同点命中');
  assert.deepEqual(both.map(h => h.kind), ['clipR', 'clipL']);
  // 块身选择路径：_down 的块区带由 blocksTop/blocksH 划定（render 桩外手工设定等价状态）
  tl.blocksTop = tl.blocksTopFor(); tl.blocksH = MUSIC_BLOCKS_H;
  const yIn = tl.blocksTop + 10, yOut = tl.blocksTop + MUSIC_BLOCKS_H + 20;
  assert.ok(yIn <= tl.blocksTop + tl.blocksH && yOut > tl.blocksTop + tl.blocksH, '块区带边界成立');
});

test('L46 S5c F3 常驻淡化把手命中：fade=0 缘把手可命中；顶部 16px 带外 trim 全高不变', () => {
  const { tl, proj } = makeTL();
  tl.mode = 'music';
  const clips = proj.timeline.audioClips; // c1: 0–10s，fadeIn/fadeOut=0（常驻「未设置」态）
  const pps = 20;
  const laneTop = tl.audioTop(); // music: 22+28=50
  // 缘把手（x0=0，顶部 16px 带内）→ fadeIn（旧门控下此处会漏成 trimL）
  const fadeHit = tl._audioHit(0, laneTop + 6, clips, false);
  assert.equal(fadeHit && fadeHit.part, 'fadeIn', 'fade=0 缘把手命中=fadeIn（可从 0 拖出淡化）');
  const fadeOutHit = tl._audioHit(10 * pps, laneTop + 6, clips, false);
  assert.equal(fadeOutHit && fadeOutHit.part, 'fadeOut', '右缘同理=fadeOut');
  // 带外（y 中部）→ trim 缘（全高命中不变，先缘后 trim 次序即让步规则）
  const trimHit = tl._audioHit(0, laneTop + 60, clips, false);
  assert.equal(trimHit && trimHit.part, 'trimL', '顶部带外 trim 缘命中不变');
  // 有淡化时命中位随既有公式（回归护栏）
  clips[0].fadeInSec = 2;
  const setHit = tl._audioHit(2 * pps, laneTop + 6, clips, false);
  assert.equal(setHit && setHit.part, 'fadeIn', '有淡化把手命中位=缘+fadeSec');
  const bodyHit = tl._audioHit(5 * pps, laneTop + 80, clips, false); // 避开中线 ±5px 增益带
  assert.equal(bodyHit && bodyHit.part, 'body', '盒体命中不回归');
});

test('L46 S5d F3 绘制面：drawFh 以 idle 半明度参数无条件调用（静态口径 + 调用点成对）', () => {
  assert.ok(tlSrc.includes("drawFh(x0 + (c.fadeInSec || 0) * pps, !!c.fadeInAuto, !((c.fadeInSec || 0) > 0.005))"), '淡入把手无条件调用（idle=未设置）');
  assert.ok(tlSrc.includes("drawFh(x1 - (c.fadeOutSec || 0) * pps, !!c.fadeOutAuto, !((c.fadeOutSec || 0) > 0.005))"), '淡出把手无条件调用');
  assert.ok(tlSrc.includes("'rgba(125,211,252,.45)'"), '未设置态半档明度配色');
});

// 回归（build-46 验收发现）：轨头收起钮 handler 引用了不存在的 trkHeadCollapsed（正字 trkHeadClosed）
// → 点击 ReferenceError、类永不切换。静态断言锁死：main.js 不得再出现未定义的 trkHeadCollapsed 调用。
test('轨头收起钮 handler 函数名正字（trkHeadClosed，无 trkHeadCollapsed 幽灵引用）', () => {
  const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('trkHeadCollapsed('), 'main.js 出现 trkHeadCollapsed( —— 正字为 trkHeadClosed()');
  assert.ok(src.includes('function trkHeadClosed()'), 'trkHeadClosed 定义缺失');
});

// ---------- 性能护栏（build-46 验收反馈四：移动端放大卡顿/崩溃根因） ----------
test('P1 画布物理像素钳制：backing store 宽 ≤8192（dprEff=min(dpr, 8192/W)），drawPlayhead 同刻度', () => {
  assert.ok(tlSrc.includes('const MAX_PHYS_W = 8192'), '物理宽上限常量');
  assert.ok(tlSrc.includes('Math.min(window.devicePixelRatio || 1, MAX_PHYS_W / Math.max(1, W)))'), 'dprEff 钳制公式');
  assert.ok(tlSrc.includes('this._dpr = dpr'), 'render 存钳制后刻度');
  assert.ok(/drawPlayhead\(\) \{[\s\S]{0,200}this\._dpr \|\| window\.devicePixelRatio/.test(tlSrc), '播放线覆盖层用同刻度');
});
test('P2 渲染合帧与拖拽降噪：render 走 rAF 队列；音乐拖拽高频路径走 mutateQuiet（跳过全 App render 订阅）', () => {
  assert.ok(tlSrc.includes('this._renderQueued'), 'render rAF 合帧队列');
  assert.ok(mainSrc.includes('mutateQuiet: fn => store.mutateQuiet(fn)'), 'hooks 挂 mutateQuiet');
  const storeSrc = readFileSync(join(root, 'js', 'store.js'), 'utf8');
  assert.ok(storeSrc.includes('export function mutateQuiet'), 'store 导出 mutateQuiet（不 emit）');
  const quietSites = (tlSrc.match(/mutateQuiet\?\.\(/g) || []).length;
  assert.ok(quietSites >= 5, `音乐拖拽高频路径接 mutateQuiet（实际 ${quietSites} 处，需含 fade/xFade/gain/clipMove/trim）`);
});
test('P3 悬停渲染守卫：同部件重复移动跳过重绘；离件翻转恢复', () => {
  assert.ok(tlSrc.includes("if (hs !== this._hoverSig) { this._hoverSig = hs; this.render(); }"), '同部件跳过重绘');
});
