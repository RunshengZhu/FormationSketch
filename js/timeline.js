// 时间线：编辑模式队形条（缩略图+拖拽排序） / 音乐模式波形时间线（块拖拽、节拍吸附、播放头）
// v3（exp/audition-lite）：常驻音频轨（简单态 26px / 展开态 Audition Lite 72px）——
// clip 自由摆放（间隙=静音、重叠=自动等功率交叉淡化+菱形手柄）、Audition 式内容锚定 trim、
// 分割（Ctrl/Cmd+K / 剃刀）、淡化/增益把手、时间选区、右键菜单、磁吸（clip 缘/块边界/tag/
// 播放头/选区/零交叉）。纯 clip 模型操作在 audio-clips.js（node 可测），此处只做几何与手势。
import { drawScene } from './stage.js';
import { computeSegments, spb, beatToSec, secToBeat, beatLabel,
  addTag, removeTag, renameTag, moveTag, tagById, nextTagName, TAG_NAME_MAX,
  clipsOf } from './model.js';
import {
  clipEnd, computeOverlaps, applyAutoCrossfades, pruneAutoCrossfades,
  trimClipLeftAnchored, trimClipLeftBoundary, trimClipRightAnchored, trimClipRightBoundary,
  splitClipAt, rippleDeleteClips, trimClipsToRange,
  collectSnapCandidates, snapTime, nearestZeroCrossing, envAt, fadeEnvAt,
  MIN_CLIP_DUR, CLIP_DEFAULT_COLOR,
} from './audio-clips.js';

export const AUDIO_SIMPLE_H = 26;    // 简单态音轨高（常驻）
export const AUDIO_EXPANDED_H = 72;  // 展开态（Audition Lite）音轨高
const TRIM_TOL_PX = 6;               // clip 缘/把手命中半径
const SNAP_TOL_PX = 8;               // 磁吸阈值（像素，时间域换算）
const ZC_RADIUS_SEC = 0.004;         // 零交叉吸附半径（消切点咔哒）
const r6 = v => Math.round(v * 1e6) / 1e6;
function store_getProjectId(hooks) {
  try { return hooks.getProjectId?.() ?? null; } catch { return null; }
}
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(56,189,248,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- F-10（UX-10）：chip 触摸长按拖拽排序——纯几何决策（node 可测） ----------
// 触屏不产生 HTML5 dragstart（UX-10 根因），排序走 Pointer Events 长按路径：
// 长按 LP_MS 触发拿起态（lift 视觉 + 可选触觉反馈），此后 pointermove 实时预览插入位
// （transform 平移预览，不动数据），pointerup 才经 hooks.move 提交恰一条「调整队形顺序」历史；
// pointercancel（浏览器/系统接管）安全回滚：零数据写入、零历史。
// 鼠标路径不进此状态机（pointerType 判定分流），HTML5 DnD（C-07 既有）不受影响。
export const TOUCH_DRAG = {
  LP_MS: 300,     // 长按时长：超过即拿起（research-arrangeus 触摸动线口径 ~300ms）
  SLOP_PX: 10,    // 拿起前的位移阈值：超了视为滚动/误手势，解除长按（chip 铺满列表，不能吃掉原生滚动）
  EDGE_PX: 28,    // 拖拽中指针接近容器边缘的判定带
  EDGE_STEP: 10,  // 边缘自动滚动的每帧步长（px/frame，rAF 驱动）
};
// dy（相对拿起的位移，含自动滚动补偿）→ 目标插入位。slotH=chip 高+间距；跨半格换位（中点判定）。
export function dragTargetIndex(dy, slotH, from, count) {
  if (!(slotH > 0) || count < 2 || !Number.isFinite(dy)) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / slotH)));
}
// 预览位移（格数）：被拿起 chip 恒 0（自身位移单独算）；from→to 之间的 chip 让位一格。
export function shiftSlots(from, to, i) {
  if (i === from) return 0;
  if (from < to) return (i > from && i <= to) ? -1 : 0;
  if (from > to) return (i >= to && i < from) ? 1 : 0;
  return 0;
}

// ---------- 编辑模式：队形条 ----------
export class EditStrip {
  constructor(container, hooks) {
    this.el = container;
    this.hooks = hooks; // {select(i), add(), duplicate(), delete(), move(from,to), getProject(), getIndex(), names()}
    this._key = '';
    this._thumbTimer = null;
    this._td = null;               // F-10 触摸拖拽状态（null=空闲；active=false=长按未生效）
    this._suppressClickUntil = 0;  // 触摸落位后抑制合成 click 误选（落位=排序，不应改选队形）
    // round23 需求 3：缩略图按容器实测尺寸 × dpr 绘制——容器尺寸变化（窗口缩放、移动端
    // 队形 tab 从 display:none 展开）时按新尺寸重绘，保持舞台纵横比、不拉伸不裁切。
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.drawThumbs());
      this._ro.observe(container);
    }
    // F-10：拿起后必须掐断原生滚动接管（touch-action 在手势开始时已定型，改不回去）——
    // 拖拽中在容器上以非 passive 监听 touchmove 并 preventDefault；拿起前不拦（列表照常可滚）。
    container.addEventListener('touchmove', e => { if (this._td && this._td.active) e.preventDefault(); }, { passive: false });
  }
  // 缩略图盒尺寸（CSS px）：宽=列表可用宽（上限 160），高按舞台（含后台）纵横比反推。
  // 高度上限 96：保证 1280×800 桌面下前 3 个 chip 完整落在 #formation-list 可视区内
  // （既有动线依赖不滚动直点第 3 个 chip；round23 回归教训——148px 高会把 chip3 挤出可视区，
  // 使其中心坐标落进底部时间轴区，点击变成 scrub）。
  thumbSize(p) {
    const avail = Math.max(40, Math.min(160, (this.el.clientWidth || 164) - 26));
    const bs = p.stage.backstageM ?? 0;
    const bw = p.stage.widthM + bs * 2, bh = p.stage.depthM + bs * 2;
    const w = Math.round(Math.min(avail, 96 * bw / bh));
    return { w, h: Math.round(w * bh / bw) };
  }
  render() {
    const p = this.hooks.getProject();
    if (!p) return;
    const key = p.formations.map(f => f.id).join(',') + '|' + this.hooks.getIndex();
    if (key === this._key) { this.drawThumbs(); return; }
    this._key = key;
    this.el.innerHTML = '';
    p.formations.forEach((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'es-chip' + (i === this.hooks.getIndex() ? ' active' : '');
      chip.draggable = true;
      const cv = document.createElement('canvas');
      const nm = document.createElement('div');
      nm.className = 'es-name';
      nm.textContent = `${i + 1}. ${f.name}`;
      nm.title = f.name;
      chip.append(cv, nm);
      chip.addEventListener('click', () => {
        if (performance.now() < this._suppressClickUntil) return; // F-10：触摸排序落位后的合成 click 不改选队形
        this.hooks.select(i);
      });
      chip.addEventListener('dragstart', e => { this._dragFrom = i; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chip.addEventListener('dragover', e => { e.preventDefault(); });
      chip.addEventListener('drop', e => { e.preventDefault(); if (this._dragFrom != null && this._dragFrom !== i) this.hooks.move(this._dragFrom, i); this._dragFrom = null; });
      // F-10：触摸/笔长按拖拽排序（鼠标不进此路径，仍走上面的 HTML5 DnD）
      chip.addEventListener('pointerdown', e => this._chipPointerDown(e, chip, i));
      chip.addEventListener('pointermove', e => this._chipPointerMove(e));
      chip.addEventListener('pointerup', e => this._chipPointerUp(e));
      chip.addEventListener('pointercancel', e => this._chipPointerCancel(e));
      this.el.append(chip);
    });
    const add = document.createElement('button');
    add.className = 'btn small'; add.textContent = '＋';
    add.title = '新队形（复制当前）';
    add.addEventListener('click', () => this.hooks.add());
    this.el.append(add);
    this.drawThumbs();
  }
  drawThumbs() {
    const p = this.hooks.getProject();
    if (!p) return;
    const { w, h } = this.thumbSize(p);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    [...this.el.querySelectorAll('.es-chip')].forEach((chip, i) => {
      const f = p.formations[i];
      const cv = chip.querySelector('canvas');
      if (!cv) return;
      if (cv.width !== W || cv.height !== H) {
        cv.width = W; cv.height = H;
        // CSS 尺寸同步锁定（宽=实测可用宽、高=舞台纵横比），避免 100% 拉伸变形
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (f) drawScene(ctx, { x: 0, y: 0, w, h }, p, f.positions, { minimal: true, pad: 4, merges: f.merges || [] });
    });
  }

  // ---------- F-10：触摸长按拖拽排序（触摸/笔专用；鼠标走 HTML5 DnD） ----------
  _chipPointerDown(e, chip, i) {
    if (e.pointerType === 'mouse') return;          // 鼠标 = 既有 HTML5 DnD，零改动
    if (this._td) return;                            // 已有手势进行中（不可能双触摸排序）
    const td = this._td = {
      id: e.pointerId, chip, from: i, to: i,
      startX: e.clientX, startY: e.clientY, lastY: e.clientY,
      active: false, chips: null, slots: null, slotH: 0, scroll0: 0, raf: 0, lpTimer: 0,
    };
    // 捕获指针：后续 move/up/cancel 全部回到 chip，手指滑出列表也能继续拖
    try { chip.setPointerCapture(e.pointerId); } catch { this._td = null; return; }
    td.lpTimer = setTimeout(() => this._lift(td), TOUCH_DRAG.LP_MS);
  }
  _lift(td) { // 长按生效：拿起态（视觉抬升 + 可选触觉反馈），开始边缘自动滚动循环
    if (this._td !== td) return;
    const chips = [...this.el.querySelectorAll('.es-chip')];
    if (chips.length < 2 || chips[td.from] !== td.chip) { this._td = null; return; }
    td.active = true;
    td.chips = chips;
    // 基准几何（未加变换时的布局位）：此后换位判定与预览全部以此为参照
    td.slots = chips.map(c => { const r = c.getBoundingClientRect(); return { top: r.top, h: r.height }; });
    td.slotH = chips.length > 1
      ? (td.slots[1].top - td.slots[0].top)      // 相邻 chip 布局位差 = 高 + gap（均匀格）
      : (td.slots[0].h + 6);
    td.scroll0 = this.el.scrollTop;
    td.chip.classList.add('lift');
    [...chips].forEach(c => { if (c !== td.chip) c.classList.add('tshift'); });
    try { navigator.vibrate && navigator.vibrate(10); } catch {} // 触觉反馈：可选、失败静默
    const step = () => {  // 边缘自动滚动：拖拽中指针压住容器上/下边缘时按帧推进列表
      if (this._td !== td || !td.active) return;
      const r = this.el.getBoundingClientRect();
      let d = 0;
      if (td.lastY < r.top + TOUCH_DRAG.EDGE_PX) d = -TOUCH_DRAG.EDGE_STEP;
      else if (td.lastY > r.bottom - TOUCH_DRAG.EDGE_PX) d = TOUCH_DRAG.EDGE_STEP;
      if (d) {
        const before = this.el.scrollTop;
        this.el.scrollTop = before + d;
        const real = this.el.scrollTop - before;
        // scroll0 必须冻结为拿起时刻的 scrollTop：_applyPreview 的 dy=(lastY-startY)+(scrollTop-scroll0)
        // 本身已含增量 real（世界坐标补偿）；若再回写 scroll0 会把 real 双计，chip 以 2× 滚速脱手。
        if (real) this._applyPreview(td);
      }
      td.raf = requestAnimationFrame(step);
    };
    td.raf = requestAnimationFrame(step);
    this._applyPreview(td);
  }
  _chipPointerMove(e) {
    const td = this._td;
    if (!td || e.pointerId !== td.id) return;
    td.lastY = e.clientY;
    if (!td.active) {
      // 长按生效前位移超阈值：判定为滚动/误手势，解除长按（不拦原生滚动）
      if (Math.hypot(e.clientX - td.startX, e.clientY - td.startY) > TOUCH_DRAG.SLOP_PX) {
        clearTimeout(td.lpTimer);
        try { td.chip.releasePointerCapture(td.id); } catch {}
        this._td = null;
      }
      return;
    }
    this._applyPreview(td);
  }
  _applyPreview(td) { // 实时预览：只动 transform，不写数据
    if (!td.active || !td.chips) return;
    const n = td.chips.length;
    const dy = (td.lastY - td.startY) + (this.el.scrollTop - td.scroll0); // 含自动滚动补偿
    td.to = dragTargetIndex(dy, td.slotH, td.from, n);
    const maxDy = (n - 1 - td.from) * td.slotH, minDy = -td.from * td.slotH;
    const y = Math.max(minDy, Math.min(maxDy, dy));
    td.chip.style.transform = `translateY(${y}px)`;
    for (let k = 0; k < n; k++) {
      if (k === td.from) continue;
      const s = shiftSlots(td.from, td.to, k) * td.slotH;
      td.chips[k].style.transform = s ? `translateY(${s}px)` : '';
    }
  }
  _chipPointerUp(e) {  // 落位：提交恰一条「调整队形顺序」历史（render 经 store 订阅自动重建）
    const td = this._td;
    if (!td || e.pointerId !== td.id) return;
    const { from, to, chips, active } = td;
    this._teardown(td);
    const count = this.hooks.getProject()?.formations.length;
    if (active && chips && count === chips.length && to !== from) {
      this._suppressClickUntil = performance.now() + 400;
      this.hooks.move(from, to);
    }
  }
  _chipPointerCancel(e) { // 轮10纪律：浏览器/系统中途接管 → 安全回滚（零数据写入、零历史）
    const td = this._td;
    if (!td || e.pointerId !== td.id) return;
    this._teardown(td);
  }
  _teardown(td) {
    clearTimeout(td.lpTimer);
    cancelAnimationFrame(td.raf);
    if (td.active && td.chips) {
      for (const c of td.chips) { c.style.transform = ''; c.classList.remove('lift', 'tshift'); }
    }
    try { td.chip.releasePointerCapture(td.id); } catch {}
    if (this._td === td) this._td = null;
  }
}

// ---------- 音乐模式：波形时间线 ----------
// TAG_LANE_H：尺规与队形块之间的窄 tag 道（时间轴标记：打点/改名/拖动/删除/点击跳转，
// 纯拍位标记不改播放逻辑）。道内交互独立分区：单点旗=预备跳转、拖旗=移动、×=删除、
// 双击空白=打点、双击旗=改名；道内单击不 scrub 不选块（与尺规/块区互不越界）。
export const TAG_LANE_H = 18;
export class MusicTimeline {
  constructor({ canvas, overlay, scroll, hooks }) {
    this.cv = canvas; this.ov = overlay; this.scroll = scroll;
    this.inner = canvas.parentElement; // #tl-inner：tag 内联命名输入挂这里（随横向滚动移动）
    this.hooks = hooks; // {getProject(), getPlayer(), onSelectFormation(i), mutate(fn,label), mutateLabeled(fn,label), commitEdit(label), seekBeat(b), audio, canEdit(), pauseIfPlaying(), onTimeSelection(range|null), onClipContextMenu(info), toast(msg)}
    this.secPerPx = 0;  // 0 = 自适应
    this.drag = null;
    this.hoverTag = null;      // 悬停旗点 id（×删除钮 + title 提示）
    this.activeTag = null;     // 点选旗点 id：×保持可见（触屏无 hover 的删除路径）
    this._tagGeom = new Map(); // id → {x, delX}（drawTags 落笔几何，命中 × 用）
    this._tagInput = null;     // 内联命名输入 {el, beat, id, done}
    // ---- v3 音频轨（Audition Lite）状态 ----
    this.expanded = false;     // 展开态（localStorage 记忆，构造时读）
    this.snapOn = true;        // 磁吸（S 开关；localStorage 记忆）
    this.razor = false;        // 剃刀模式（R 开关；会话态）
    this.clipSel = new Set();  // 选中 clip id（单选/Ctrl 多选）
    this.timeSel = null;       // 时间选区 {start, end}（秒；空白拖拽/尺规 Shift 拖拽）
    this.hoverClipEdge = null; // {id, part} 悬停命中（光标 + 边缘高亮）
    this.hoverAudio = false;   // 悬停音频轨（S/R 快捷键作用域判定）
    this._projectId = null;    // 项目切换检测（清 clip 选择态）
    try { this.expanded = localStorage.getItem('wuzhen:audioTrackExpanded') === '1'; } catch {}
    try { this.snapOn = localStorage.getItem('wuzhen:audioSnap') !== '0'; } catch {}
    this._bind();
  }
  pxPerSec() { return this.secPerPx ? 1 / this.secPerPx : 0; }
  layoutWidth(p) {
    const { totalBeats } = computeSegments(p);
    const totalSec = beatToSec(p, totalBeats) || 10;
    const w0 = this.scroll.clientWidth || 600;
    return Math.max(w0, this.secPerPx ? totalSec / this.secPerPx : totalSec * Math.max(8, w0 / Math.max(totalSec, 30)));
  }
  // ---- v3 几何：音频轨夹在 tag 道与队形块区之间，块区改为紧随其后（不再底部锚定） ----
  audioTop() { return (this.rulerH ?? 22) + TAG_LANE_H; }
  audioLaneH() { return this.expanded ? AUDIO_EXPANDED_H : AUDIO_SIMPLE_H; }
  audioBottom() { return this.audioTop() + this.audioLaneH(); }
  blocksTopFor() { return this.audioBottom() + 6; }
  totalHeightFor() {
    // 兼容旧几何：简单态总高维持旧 #tl-scroll 高（桌面 150 / 移动 120），富余计入音轨与块区间隔——
    // 常驻音轨 26px 为规格 mandated 的新增道，不挤压舞台几何（L2 移动端半径基线依赖旧高）。
    // 展开态（72px）为新增布局，无旧几何可保：总高随内容（40+72+6+36+6=160）。
    const mobile = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 1023.5px)').matches;
    const base = mobile ? 120 : 150;
    return Math.max(base, this.blocksTopFor() + 36 + 6);
  } // 块 36 + 底边距 6
  hasMedia(p) { return !!(p?.media?.assets?.length); }
  assetDurOf(p, assetId) { return p?.media?.assets?.find(a => a.id === assetId)?.durationSec ?? Infinity; }
  render() {
    const p = this.hooks.getProject();
    if (!p) return;
    // 项目切换：清 clip 选择态（clip id 属于项目数据）
    const pid = store_getProjectId(this.hooks);
    if (pid !== this._projectId) {
      this._projectId = pid;
      this.clipSel = new Set();
      this.timeSel = null;
      this.razor = false;
    }
    const dpr = window.devicePixelRatio || 1;
    // 音频轨常驻：容器高度由 JS 按简单/展开态设定（简单 110 / 展开 156）
    const h = this.totalHeightFor();
    if (this.scroll && this.scroll.style && this.scroll.clientHeight !== h) this.scroll.style.height = h + 'px';
    const H = Math.max(h, this.scroll.clientHeight || h);
    const W = this.layoutWidth(p);
    for (const c of [this.cv, this.ov]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    this.W = W; this.H = H;
    const ctx = this.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);
    this.drawRuler(ctx, p, H);
    this.drawAudioLane(ctx, p, H);
    this.drawBlocks(ctx, p, H);
    this.drawTags(ctx, p);
    this.drawPlayhead();
    this.syncAudioDom(p);
  }
  // 音频轨 DOM 附属（轨左端展开/收起钮、展开态表头、空态入口）随几何同步
  syncAudioDom(p) {
    if (typeof document === 'undefined') return;
    const media = this.hasMedia(p);
    const tog = document.getElementById('tl-audio-toggle');
    if (tog) {
      tog.hidden = false;
      tog.style.top = Math.round(this.audioTop() + this.audioLaneH() / 2 - 11) + 'px';
      tog.textContent = this.expanded ? '⌃' : '⌄';
      tog.title = this.expanded ? '收起音频轨（简单态）' : '展开音频轨（Audition Lite 剪辑）';
      tog.setAttribute('aria-label', tog.title);
    }
    const head = document.getElementById('tl-head');
    if (head) {
      head.hidden = !(this.expanded && media);
      head.style.top = this.audioTop() + 'px';
      head.style.height = this.audioLaneH() + 'px';
    }
    const empty = document.getElementById('tl-audio-empty');
    if (empty) {
      empty.hidden = media;
      empty.style.top = this.audioTop() + 'px';
      empty.style.height = this.audioLaneH() + 'px';
    }
  }

  // ---- v3 音频轨绘制 ----
  drawAudioLane(ctx, p, h) {
    const top = this.audioTop(), lh = this.audioLaneH();
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,.05)';
    ctx.fillRect(0, top, this.W, lh);
    ctx.strokeStyle = 'rgba(148,163,184,.2)';
    ctx.beginPath();
    ctx.moveTo(0, top + lh + .5); ctx.lineTo(this.W, top + lh + .5);
    ctx.moveTo(0, top + .5); ctx.lineTo(this.W, top + .5);
    ctx.stroke();
    const clips = clipsOf(p);
    if (!this.hasMedia(p)) {
      if (this.expanded) {
        ctx.fillStyle = 'rgba(148,163,184,.55)';
        ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
        ctx.fillText('载入音乐后在此剪辑（左上「＋ 载入音乐」或「📚 媒体库」）', 10, top + lh / 2);
      }
      ctx.restore();
      return;
    }
    // 时间选区（蓝色高亮带，先画在底层）
    if (this.timeSel) {
      const pps0 = this.ppsOf(p);
      const x0 = this.timeSel.start * pps0, x1 = this.timeSel.end * pps0;
      ctx.fillStyle = 'rgba(56,189,248,.16)';
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), lh);
      ctx.strokeStyle = 'rgba(56,189,248,.7)';
      ctx.beginPath();
      ctx.moveTo(x0 + .5, top); ctx.lineTo(x0 + .5, top + lh);
      ctx.moveTo(x1 - .5, top); ctx.lineTo(x1 - .5, top + lh);
      ctx.stroke();
    }
    const pps = this.ppsOf(p);
    for (const c of clips) this.drawClipBox(ctx, p, c, top, lh, pps);
    // 重叠自动交叉淡化：交叠中点菱形手柄
    for (const ov of computeOverlaps(clips)) {
      const mx = ((ov.start + ov.end) / 2) * pps;
      const my = top + 10;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#e879f9';
      ctx.strokeStyle = 'rgba(232,121,249,.5)';
      ctx.lineWidth = 1;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
    }
    ctx.restore();
  }
  drawClipBox(ctx, p, c, top, lh, pps) {
    const x0 = c.timelineStartSec * pps, x1 = clipEnd(c) * pps, w = x1 - x0;
    if (x1 <= 0 || x0 >= this.W) return;
    const pad = this.expanded ? 3 : 3;
    const y0 = top + pad, y1 = top + lh - pad;
    const color = c.color || CLIP_DEFAULT_COLOR;
    const selected = this.clipSel.has(c.id);
    const visX0 = Math.max(-2, x0), visX1 = Math.min(this.W + 2, x1);
    ctx.save();
    // 盒底
    ctx.fillStyle = hexA(color, c.muted ? .05 : .13);
    ctx.fillRect(visX0, y0, visX1 - visX0, y1 - y0);
    // 波形（按淡化包络收窄、随增益缩放；静音置灰）
    const env = this.hooks.audio?.assets?.get(c.assetId)?.env || null;
    const mid = (y0 + y1) / 2;
    const amp = (y1 - y0) / 2 - (this.expanded ? 6 : 4);
    const step = Math.max(1, Math.floor(this.W / 2400));
    ctx.fillStyle = hexA(color, c.muted ? .22 : .58);
    for (let x = Math.ceil(visX0); x < visX1; x += step) {
      const rel = (x - x0) / pps;
      const src = c.srcStartSec + rel;
      let v = env ? envAt(env, src) : .14;
      v *= Math.min(1.6, c.gain ?? 1) * fadeEnvAt(c, rel);
      const a = Math.max(1, v * amp);
      ctx.fillRect(x, mid - a, step, a * 2);
    }
    // 名牌
    const nm = (c.name || '音频') + (c.muted ? '（静音）' : '');
    if (w > 34) {
      ctx.fillStyle = c.muted ? 'rgba(148,163,184,.8)' : '#e2e8f0';
      ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
      const maxChars = Math.floor((w - 8) / 6.2);
      if (maxChars > 1) ctx.fillText(nm.slice(0, maxChars), x0 + 4, y0 + 2);
    }
    if (this.expanded) {
      // 增益包络横线（黄，中线）
      ctx.strokeStyle = 'rgba(250,204,21,.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0 + 2, mid); ctx.lineTo(x1 - 2, mid); ctx.stroke();
      // 淡化把手（顶部方把手；auto 交叉淡化呈品红）
      const drawFh = (fx, isAuto) => {
        ctx.fillStyle = isAuto ? '#e879f9' : '#7dd3fc';
        ctx.fillRect(fx - 3.5, y0 - 1.5, 7, 7);
        ctx.strokeStyle = 'rgba(2,6,23,.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(fx - 3.5, y0 - 1.5, 7, 7);
      };
      if ((c.fadeInSec || 0) > 0.005) drawFh(x0 + c.fadeInSec * pps, !!c.fadeInAuto);
      if ((c.fadeOutSec || 0) > 0.005) drawFh(x1 - c.fadeOutSec * pps, !!c.fadeOutAuto);
      // trim 缘（红括号光标区）
      const hotL = this.hoverClipEdge?.id === c.id && this.hoverClipEdge.part === 'trimL';
      const hotR = this.hoverClipEdge?.id === c.id && this.hoverClipEdge.part === 'trimR';
      ctx.fillStyle = hotL ? '#f43f5e' : 'rgba(244,63,94,.5)';
      ctx.fillRect(x0 - 1.5, y0, 3, y1 - y0);
      ctx.fillStyle = hotR ? '#f43f5e' : 'rgba(244,63,94,.5)';
      ctx.fillRect(x1 - 1.5, y0, 3, y1 - y0);
    }
    // 选中高亮描边
    if (selected) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - 1, y0 - 1, w + 2, y1 - y0 + 2);
    }
    ctx.restore();
  }

  drawRuler(ctx, p, h) {
    const pps = this.ppsOf(p);
    const rulerH = 22;
    ctx.save();
    ctx.fillStyle = '#131c31';
    ctx.fillRect(0, 0, this.W, rulerH);
    ctx.strokeStyle = '#243049'; ctx.fillStyle = '#8ea2bd';
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    const bpb = p.audio.beatsPerBar || 4;
    const spbV = spb(p);
    const pxPerBar = bpb * spbV * pps;
    const barStep = pxPerBar < 26 ? 8 : pxPerBar < 60 ? 4 : 1;
    const { totalBeats } = computeSegments(p);
    const totalBars = Math.ceil(beatToSec(p, totalBeats) / spbV / bpb) + 2;
    ctx.beginPath();
    for (let bar = 0; bar <= totalBars; bar += barStep) {
      const x = beatToSec(p, bar * bpb) * pps;
      ctx.moveTo(x, rulerH - 8); ctx.lineTo(x, h);
      if (pxPerBar * barStep > 30) ctx.fillText(String(bar + 1), x + 3, rulerH / 2);
    }
    // 8拍刻度（舞蹈计数）
    const pxPer8 = 8 * spbV * pps;
    if (pxPer8 > 44) {
      ctx.strokeStyle = 'rgba(56,189,248,.35)';
      ctx.beginPath();
      for (let c8 = 0; ; c8++) {
        const x = beatToSec(p, c8 * 8) * pps;
        if (x > this.W) break;
        ctx.moveTo(x, rulerH); ctx.lineTo(x, h);
        if (pxPer8 > 70) ctx.fillText(`${c8 + 1}个8拍`, x + 3, h - 8);
      }
      ctx.stroke();
    }
    ctx.stroke();
    ctx.restore();
    this.rulerH = rulerH;
  }
  // 旧整曲波形道已由 v3 常驻音频轨取代（drawWave 移除）：波形按 clip 画在音轨内（drawClipBox）。
  drawBlocks(ctx, p, h) {
    const { segments } = computeSegments(p);
    const pps = this.ppsOf(p);
    const spbV = spb(p);
    const top = this.blocksTopFor(), bh = 36; // v3：块区紧随音频轨（不再底部锚定）
    const selIdx = this.hooks.getIndex();
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    for (const s of segments) {
      const f = p.formations[s.i];
      if (!f) continue;
      const x0 = beatToSec(p, s.holdStart) * pps;
      const x1 = beatToSec(p, s.holdEnd) * pps;
      const selected = s.i === selIdx;
      const hovered = this.hoverSeg === s.i;
      const holdSec = ((s.holdEnd - s.holdStart) * spbV).toFixed(1).replace(/\.0$/, '');
      // 保持块
      ctx.fillStyle = (f.color || '#64748b') + (hovered ? '77' : '55');
      ctx.fillRect(x0, top, Math.max(2, x1 - x0), bh);
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected ? '#38bdf8' : (f.color || '#64748b');
      ctx.strokeRect(x0, top, x1 - x0, bh);
      if (x1 - x0 > 34) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(f.name.slice(0, Math.floor((x1 - x0) / 7)), x0 + 4, top + 9);
      }
      // 保持时长徽标（拍 + 秒）
      if (x1 - x0 > 40) {
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(`${Math.round(s.holdEnd - s.holdStart)}拍·${holdSec}s`, x0 + 4, top + bh - 9);
        ctx.font = '10px sans-serif';
      } else if (x1 - x0 > 8) {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(`${Math.round(s.holdEnd - s.holdStart)}`, x0 + 2, top + bh - 9);
      }
      // 过渡块
      if (s.hasTravel) {
        const tx1 = beatToSec(p, s.travelEnd) * pps;
        const tw = Math.max(1, tx1 - x1);
        ctx.fillStyle = hovered ? 'rgba(56,189,248,.30)' : 'rgba(148,163,184,.25)';
        ctx.fillRect(x1, top, tw, bh);
        ctx.strokeStyle = 'rgba(148,163,184,.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, top, tw, bh);
        // 斜线纹理
        if (tw > 6 && bh > 10) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x1, top, tw, bh); ctx.clip();
          ctx.strokeStyle = 'rgba(148,163,184,.28)';
          for (let gx = x1 - bh; gx < x1 + tw; gx += 7) {
            ctx.moveTo(gx, top + bh); ctx.lineTo(gx + bh, top);
          }
          ctx.stroke();
          ctx.restore();
        }
        const travelBeats = Math.round((s.travelEnd - s.holdEnd) * 10) / 10;
        const travelSec = ((s.travelEnd - s.holdEnd) * spbV).toFixed(1).replace(/\.0$/, '');
        const label = `↷过渡${travelBeats}拍·${travelSec}s`;
        if (tw > label.length * 6 + 6) {
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText(label, x1 + 4, top + bh / 2);
        } else if (tw > 14) {
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText('↷' + travelBeats + '拍', x1 + 3, top + bh / 2);
        } else {
          // 太窄：标到块右侧外
          ctx.fillStyle = '#8ea2bd';
          ctx.fillText('↷' + travelBeats + '拍', tx1 + 3, top + bh / 2);
        }
        // 边缘把手（选中块或悬停时显示）
        if (selected || hovered) {
          this._drawGrip(ctx, x1, top, bh, 'hold');
          this._drawGrip(ctx, tx1, top, bh, 'travel');
        }
      }
      // 悬停高亮描边
      if (hovered && !selected) {
        ctx.strokeStyle = 'rgba(56,189,248,.8)';
        ctx.lineWidth = 1.5;
        const hx1 = s.hasTravel ? beatToSec(p, s.travelEnd) * pps : x1;
        ctx.strokeRect(x0, top, hx1 - x0, bh);
      }
    }
    ctx.restore();
    this.blocksTop = top; this.blocksH = bh;
  }
  _drawGrip(ctx, x, top, bh, kind) {
    ctx.save();
    ctx.fillStyle = kind === 'hold' ? '#38bdf8' : '#a78bfa';
    ctx.fillRect(x - 2, top - 2, 4, bh + 4);
    // 把手抓点
    ctx.fillRect(x - 5, top + bh / 2 - 7, 10, 14);
    ctx.restore();
  }
  // ---------- 时间轴标记 tag 道 ----------
  // 旗点=强调色系（主题蓝），细旗杆+旗面+名称胶囊；名称与前旗/后旗过近时只画旗点
  // （名称走 title 悬浮/点击跳转/双击改名可见）；悬停显 × 删除。播放头红色、块把手
  // 蓝/紫均在各自分区，视觉互不混淆。
  drawTags(ctx, p) {
    const tags = [...(p.timeline.tags || [])].sort((a, b) => a.beat - b.beat);
    const top = this.rulerH ?? 22;
    const pps = this.ppsOf(p);
    this._tagGeom = new Map();
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,.07)';
    ctx.fillRect(0, top, this.W, TAG_LANE_H);
    ctx.strokeStyle = 'rgba(148,163,184,.22)';
    ctx.beginPath(); ctx.moveTo(0, top + TAG_LANE_H + .5); ctx.lineTo(this.W, top + TAG_LANE_H + .5); ctx.stroke();
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    const ACC = '#38bdf8';
    let lastEnd = -1e9; // 前一旗名称胶囊右缘（名称防重叠：贪心左→右）
    for (let k = 0; k < tags.length; k++) {
      const tag = tags[k];
      const x = Math.max(1, Math.min(this.W - 1, beatToSec(p, tag.beat) * pps));
      const nextX = k + 1 < tags.length ? Math.max(1, Math.min(this.W - 1, beatToSec(p, tags[k + 1].beat) * pps)) : this.W;
      const hovered = this.hoverTag === tag.id;
      // 旗杆 + 旗面
      ctx.strokeStyle = ACC; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, top + TAG_LANE_H - 1); ctx.lineTo(x, top + 3); ctx.stroke();
      ctx.fillStyle = hovered ? '#7dd3fc' : ACC;
      ctx.beginPath();
      ctx.moveTo(x + 1, top + 3); ctx.lineTo(x + 9, top + 6.5); ctx.lineTo(x + 1, top + 10);
      ctx.closePath(); ctx.fill();
      // 名称胶囊：距前旗名称太近（<20px）或被后旗顶住 → 只画旗点（名称走 title/跳转/改名可见）
      const nameW = ctx.measureText(tag.name).width;
      const maxW = Math.min(nextX - x - 14, this.W - x - 2);
      let delX = x + 11;
      if (nameW > 0 && x - lastEnd >= 20 && nameW <= maxW) {
        ctx.fillStyle = 'rgba(56,189,248,.16)';
        ctx.fillRect(x + 3, top + 2, nameW + 8, TAG_LANE_H - 5);
        ctx.fillStyle = '#dbeafe';
        ctx.fillText(tag.name, x + 7, top + TAG_LANE_H / 2 + .5);
        delX = x + nameW + 13;
        lastEnd = x + nameW + 10;
      } else {
        lastEnd = Math.max(lastEnd, x + 6);
      }
      // 悬停/点选 ×（拖拽中不显，防误删）：hover 或 active 保持可见——鼠标移向 × 时
      // 已离旗点 hover 区（× 在名称末端），靠几何命中维持 hover 不消失（见 _tagGeomHit）
      if ((hovered || this.activeTag === tag.id) && this.drag?.kind !== 'tag') {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('×', delX, top + TAG_LANE_H / 2 + .5);
        ctx.font = '10px sans-serif';
      }
      this._tagGeom.set(tag.id, { x, delX });
    }
    ctx.restore();
  }
  tagAt(x) { // 旗点命中（±9px，取最近）；y 分区由调用方判定
    const p = this.hooks.getProject();
    if (!p) return null;
    const pps = this.ppsOf(p);
    let best = null;
    for (const tag of p.timeline.tags || []) {
      const tx = beatToSec(p, tag.beat) * pps;
      const d = Math.abs(x - tx);
      if (d <= 9 && (!best || d < best.d)) best = { tag, x: tx, d };
    }
    return best;
  }
  _tagGeomHit(x, tol = 6) { // × 落笔几何命中 → tag id（× 在名称末端，与旗点位置解耦）
    for (const [id, g] of this._tagGeom) if (Math.abs(x - g.delX) <= tol) return id;
    return null;
  }
  inTagLane(y) { return y > (this.rulerH ?? 22) && y <= (this.rulerH ?? 22) + TAG_LANE_H; }
  _tagTitle(x, y) { // 原生 title：旗点=名称+拍位；×=删除
    if (!this.inTagLane(y)) { if (this.cv.title) this.cv.title = ''; return; }
    const p = this.hooks.getProject();
    const delId = this._tagGeomHit(x, 6);
    if (delId) {
      const t = tagById(p, delId);
      if (t) { this.cv.title = `删除标记「${t.name}」`; return; }
    }
    const hit = this.tagAt(x);
    if (hit) this.cv.title = `${hit.tag.name} · ${beatLabel(p, hit.tag.beat)} 小节（${Math.round(hit.tag.beat * 10) / 10} 拍）· 单击跳转 / 双击改名 / 拖动移位`;
    else if (this.cv.title) this.cv.title = '';
  }
  // 内联命名输入（打点/改名共用）：Enter/失焦提交、Esc 取消；挂 #tl-inner 随横向滚动
  _openTagInput({ beat = 0, id = null, initial = '' }) {
    if (this._tagInput) { const st = this._tagInput; st.el.blur(); if (this._tagInput === st) { st.el.remove(); this._tagInput = null; } }
    const p = this.hooks.getProject();
    if (!p) return;
    const src = id ? tagById(p, id) : null;
    const x = beatToSec(p, (src ? src.beat : beat)) * this.ppsOf(p);
    const inp = document.createElement('input');
    inp.className = 'tl-tag-input';
    inp.type = 'text';
    inp.value = initial;
    inp.placeholder = nextTagName(p); // 空提交 → addTag 默认「标记 N」
    inp.spellcheck = false;
    inp.style.left = Math.max(0, x - 4) + 'px';
    const st = this._tagInput = { el: inp, beat, id, done: false };
    const commit = () => {
      if (st.done) return;
      st.done = true;
      const val = st.el.value.trim().slice(0, TAG_NAME_MAX);
      st.el.remove();
      if (this._tagInput === st) this._tagInput = null;
      if (st.id) {
        const cur = tagById(this.hooks.getProject(), st.id);
        if (cur && val && val !== cur.name) this.hooks.mutateLabeled?.(p2 => renameTag(p2, st.id, val), '改标记');
      } else {
        this.hooks.mutateLabeled?.(p2 => { addTag(p2, st.beat, val); }, '打标记');
      }
    };
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); st.done = true; st.el.remove(); if (this._tagInput === st) this._tagInput = null; }
    });
    inp.addEventListener('blur', commit);
    inp.addEventListener('pointerdown', ev => ev.stopPropagation()); // 输入框点击不透给画布
    this.inner.append(inp);
    requestAnimationFrame(() => { try { inp.focus(); inp.select(); } catch {} });
  }
  // ⚑ 打点：在当前播放头（或 scrub 位置）打标记——只开命名输入、不动播放状态
  stampTag() {
    const p = this.hooks.getProject();
    if (!p) return;
    const beat = Math.max(0, Math.round((this.hooks.getPlayer?.()?.beat || 0) * 100) / 100);
    const x = beatToSec(p, beat) * this.ppsOf(p);
    const sc = this.scroll;
    if (x < sc.scrollLeft + 8 || x > sc.scrollLeft + sc.clientWidth - 130) sc.scrollLeft = Math.max(0, x - 80);
    this._openTagInput({ beat });
  }
  drawPlayhead() {
    const p = this.hooks.getProject();
    if (!p) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ov.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const player = this.hooks.getPlayer();
    const pps = this.ppsOf(p);
    const x = beatToSec(p, Math.max(0, player.beat)) * pps;
    ctx.save();
    ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.H); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 8); ctx.closePath();
    ctx.fillStyle = '#f43f5e'; ctx.fill();
    ctx.restore();
  }
  ppsOf(p) {
    if (this.secPerPx) return 1 / this.secPerPx;
    const { totalBeats } = computeSegments(p);
    const totalSec = Math.max(beatToSec(p, totalBeats), 5);
    return this.W / (totalSec + 1);
  }
  secToX(sec) { return sec * this.ppsOf(this.hooks.getProject()); }
  xToBeat(x) {
    const p = this.hooks.getProject();
    const sec = x / this.ppsOf(p);
    return secToBeat(p, sec);
  }
  zoom(factor) {
    const p = this.hooks.getProject();
    const cur = this.ppsOf(p);
    const { totalBeats } = computeSegments(p);
    const totalSec = Math.max(beatToSec(p, totalBeats), 1);
    const maxPps = 4096 / totalSec; // 画布宽度上限，防止超出浏览器 canvas 尺寸限制
    this.secPerPx = 1 / Math.min(Math.max(cur * factor, 0.5), maxPps);
    this.render();
  }
  zoomFit() { this.secPerPx = 0; this.render(); }

  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => this._down(e));
    cv.addEventListener('pointermove', e => this._move(e));
    cv.addEventListener('dblclick', e => this._dblclick(e));
    // v3：clip 右键菜单（空白处=取消选择，规格 §4）
    cv.addEventListener('contextmenu', e => {
      const p = this.hooks.getProject();
      if (!p) return;
      const r = this.cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (y < this.audioTop() || y > this.audioBottom() || !clipsOf(p).length) return;
      e.preventDefault();
      const hit = this._audioHit(x, y, clipsOf(p));
      this.hooks.onClipContextMenu?.({
        clipId: hit ? hit.clip.id : null,
        screenX: e.clientX, screenY: e.clientY,
      });
    });
    window.addEventListener('pointerup', e => this._up(e), { passive: true });
    // F-02（UX-02）：浏览器中途接管（滚动接管/来电横幅/系统手势）会发 pointercancel 而后续
    // pointerup 不再来——不置 drag=null 则拖拽状态卡死，之后无按键的鼠标 hover 路过即持续
    // 改写块时长（数据损坏链）。即使 touch-action 已阻断滚动接管，其他接管源仍需此兜底。
    cv.addEventListener('pointercancel', () => { this.drag = null; });
    this.scroll.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
      } else if (e.altKey) {
        // C16：Alt+滚轮 锚定光标缩放（与左下 －/＋/⤢ 同义）
        e.preventDefault();
        this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX);
      } else if (e.shiftKey) {
        // C16：Shift+滚轮 横移
        e.preventDefault();
        this.scroll.scrollLeft += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      }
    }, { passive: false });
  }
  // 锚定缩放：anchorClientX（视口坐标）下的时间点在缩放后保持原屏幕位
  zoomAt(factor, anchorClientX) {
    const p = this.hooks.getProject();
    if (!p) return;
    const oldPps = this.ppsOf(p);
    const rect = this.scroll.getBoundingClientRect();
    const anchorSec = (anchorClientX - rect.left + this.scroll.scrollLeft) / oldPps;
    this.zoom(factor);
    const newPps = this.ppsOf(p);
    if (newPps > 0) this.scroll.scrollLeft = Math.max(0, anchorSec * newPps - (anchorClientX - rect.left));
  }
  // 视口坐标 → 时间线秒（C13 落点换算用）
  secFromClientX(clientX) {
    const p = this.hooks.getProject();
    const r = this.scroll.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + this.scroll.scrollLeft) / this.ppsOf(p));
  }
  edgeHits(x) {
    const p = this.hooks.getProject();
    const { segments } = computeSegments(p);
    const pps = this.ppsOf(p);
    const tol = 10;
    const hits = [];
    for (const s of segments) {
      const hx = beatToSec(p, s.holdEnd) * pps;
      const tx = beatToSec(p, s.travelEnd) * pps;
      if (s.hasTravel && Math.abs(x - hx) < tol) hits.push({ kind: 'hold', seg: s });
      if (s.hasTravel && Math.abs(x - tx) < tol) hits.push({ kind: 'travel', seg: s });
    }
    return hits;
  }
  _down(e) {
    const p = this.hooks.getProject();
    if (!p) return;
    // 任务#14：数拍入场期间摸时间线（scrub/拖块/切块）= 取消倒计——否则倒计 tick 会把
    // 播放头重写回负拍，与用户定位互相打架（报告 P3-#14：beat 20↔-6 弹回）
    const pl = this.hooks.getPlayer?.();
    if (pl?.countin && pl.cancelCountin) pl.cancelCountin();
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    // tag 道：× 命中=删除（一条「删标记」历史）；旗点命中=预备拖动/单击跳转；
    // 空白=留给双击打点（单击不动作，不 scrub 不选块）。恰在删除后 400ms 内的双击
    // 不再当「空白打点」（× 双击=删一次，不应删完又原地加回）。
    if (this.inTagLane(y)) {
      const delId = this._tagGeomHit(x, 6);
      if (delId) {
        this.hoverTag = null;
        this.activeTag = null;
        this._delAt = performance.now();
        this.hooks.mutateLabeled?.(p2 => removeTag(p2, delId), '删标记');
        return;
      }
      this.activeTag = null;
      const hit = this.tagAt(x);
      if (hit) {
        try { this.cv.setPointerCapture(e.pointerId); } catch {}
        this.drag = { kind: 'tag', id: hit.tag.id, startX: x, moved: false };
      }
      return;
    }
    // ---- v3 音频轨（Audition Lite / 简单态）----
    const clips = clipsOf(p);
    if (clips.length && y >= this.audioTop() && y <= this.audioBottom()) {
      this._audioDown(e, x, y, clips);
      return;
    }
    const edges = this.edgeHits(x);
    if (edges.length && y >= (this.blocksTop ?? 0) && y <= (this.blocksTop ?? 0) + (this.blocksH ?? 0)) {
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      this.drag = { ...edges[0], startX: x };
      return;
    }
    if (y <= this.rulerH) {
      // 尺规：点击/拖动定位（Shift+拖拽=时间选区，C11/C8；普通拖拽保持 scrub 兼容既有仪器）
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      if (e.shiftKey) {
        this.drag = { kind: 'timeSel', startSec: x / this.ppsOf(p), moved: false, fromRuler: true };
        this.timeSel = { start: x / this.ppsOf(p), end: x / this.ppsOf(p) };
      } else {
        this.drag = { kind: 'scrub' };
        this.hooks.seekBeat(this.xToBeat(x));
      }
      return;
    }
    if (y >= this.blocksTop && y <= this.blocksTop + this.blocksH) {
      const { segments } = computeSegments(p);
      const beat = this.xToBeat(x);
      for (const s of segments) {
        if (beat >= s.holdStart && beat < s.travelEnd) { this.hooks.onSelectFormation(s.i); return; }
      }
    }
  }
  // ---- v3 音频轨命中与手势 ----
  // 命中链（展开态）：fade 把手 → trim 缘 → 增益横线 → 盒体；简单态只有盒体（拖移/点击定位）
  _audioHit(x, y, clips) {
    const pps = this.ppsOf(this.hooks.getProject());
    const laneMid = this.audioTop() + this.audioLaneH() / 2;
    for (let i = clips.length - 1; i >= 0; i--) { // 数组顺序即 z 序，顶层优先
      const c = clips[i];
      const x0 = c.timelineStartSec * pps, x1 = clipEnd(c) * pps;
      if (x < x0 - TRIM_TOL_PX || x > x1 + TRIM_TOL_PX) continue;
      if (!this.expanded) return { clip: c, part: 'body' };
      if ((c.fadeInSec || 0) > 0.005 && Math.abs(x - (x0 + c.fadeInSec * pps)) <= TRIM_TOL_PX && y - this.audioTop() <= 12) return { clip: c, part: 'fadeIn' };
      if ((c.fadeOutSec || 0) > 0.005 && Math.abs(x - (x1 - c.fadeOutSec * pps)) <= TRIM_TOL_PX && y - this.audioTop() <= 12) return { clip: c, part: 'fadeOut' };
      if (Math.abs(x - x0) <= TRIM_TOL_PX) return { clip: c, part: 'trimL' };
      if (Math.abs(x - x1) <= TRIM_TOL_PX) return { clip: c, part: 'trimR' };
      if (Math.abs(y - laneMid) <= 5 && x >= x0 && x <= x1) return { clip: c, part: 'gain' };
      return { clip: c, part: 'body' };
    }
    return null;
  }
  _xFadeHit(x, y, clips) {
    if (!this.expanded) return null;
    const pps = this.ppsOf(this.hooks.getProject());
    for (const ov of computeOverlaps(clips)) {
      const mx = ((ov.start + ov.end) / 2) * pps;
      if (Math.abs(x - mx) <= 7 && Math.abs(y - (this.audioTop() + 10)) <= 9) return ov;
    }
    return null;
  }
  // 磁吸候选（规格 C17：clip 缘/块边界/tag/播放头/时间选区/零交叉）
  _snapCandidates(excludeId) {
    const p = this.hooks.getProject();
    const { segments } = computeSegments(p);
    const blockSecs = [];
    for (const s of segments) { blockSecs.push(beatToSec(p, s.holdStart), beatToSec(p, s.holdEnd), beatToSec(p, s.travelEnd)); }
    const tagSecs = (p.timeline.tags || []).map(t => beatToSec(p, t.beat));
    const player = this.hooks.getPlayer?.();
    return collectSnapCandidates({
      clips: clipsOf(p), excludeId,
      playheadSec: player ? beatToSec(p, Math.max(0, player.beat)) : null,
      selStartSec: this.timeSel?.start ?? null,
      selEndSec: this.timeSel?.end ?? null,
      blockSecs, tagSecs,
    });
  }
  _snap(sec, excludeId) {
    if (!this.snapOn) return { t: sec, line: null };
    const pps = this.ppsOf(this.hooks.getProject());
    return snapTime(sec, this._snapCandidates(excludeId), SNAP_TOL_PX / pps);
  }
  // 零交叉吸附（trim 缘；仅磁吸开启时）：把 src 侧端点吸到最近过零点（≤4ms 才生效）
  _snapZeroCross(clip, side) {
    if (!this.snapOn) return;
    const buf = this.hooks.audio?.resolveAssetBuffer?.(clip.assetId);
    if (!buf) return;
    const sr = buf.sampleRate;
    const ch0 = buf.getChannelData(0);
    const srcSample = (side === 'in' ? clip.srcStartSec : clip.srcStartSec + clip.lengthSec) * sr;
    const zc = nearestZeroCrossing(ch0, srcSample, ZC_RADIUS_SEC * sr);
    const delta = (zc / sr) - (side === 'in' ? clip.srcStartSec : clip.srcStartSec + clip.lengthSec);
    if (Math.abs(delta) > ZC_RADIUS_SEC) return;
    if (side === 'in') {
      clip.srcStartSec = r6(clip.srcStartSec + delta);
      clip.timelineStartSec = r6(clip.timelineStartSec + delta);
      clip.lengthSec = r6(clip.lengthSec - delta);
    } else {
      clip.lengthSec = r6(clip.lengthSec + delta);
    }
  }
  _audioDown(e, x, y, clips) {
    const p = this.hooks.getProject();
    const editable = this.hooks.canEdit?.() !== false;
    const pps = this.ppsOf(p);
    const sec = x / pps;
    this._lastX = x;
    try { this.cv.setPointerCapture(e.pointerId); } catch {}
    // 剃刀：点击 clip 即分割（C6）
    if (this.razor) {
      const hit = this._audioHit(x, y, clips);
      if (hit && editable) {
        this.hooks.pauseIfPlaying?.();
        this.hooks.mutateLabeled?.(pr => { splitClipAt(pr.timeline.audioClips, hit.clip.id, sec); }, '分割音频剪辑');
      }
      this.drag = null;
      return;
    }
    // 选择（C1）：单击=单选；Ctrl/Cmd=多选切换。空白拖拽=时间选区（C8）；空白单击=定位播放头（C12）
    const ov = this._xFadeHit(x, y, clips);
    if (ov && editable) {
      this.drag = { kind: 'xFade', a: ov.a, b: ov.b, startX: x, moved: false, ovStart: ov.start, ovEnd: ov.end };
      return;
    }
    const hit = this._audioHit(x, y, clips);
    if (hit) {
      if (e.ctrlKey || e.metaKey) {
        if (this.clipSel.has(hit.clip.id)) this.clipSel.delete(hit.clip.id);
        else this.clipSel.add(hit.clip.id);
      } else if (!this.clipSel.has(hit.clip.id)) {
        this.clipSel = new Set([hit.clip.id]);
      }
      const ids = [...this.clipSel];
      if (hit.part === 'body') {
        if (editable) {
          this.hooks.pauseIfPlaying?.(); // 守卫：播放中移动先自动暂停
          this.drag = { kind: 'clipMove', ids, primary: hit.clip, grabSec: sec - hit.clip.timelineStartSec, startX: x, moved: false };
        } else this.drag = null;
      } else if (editable) {
        const part = hit.part;
        const isTrim = part === 'trimL' || part === 'trimR';
        if (isTrim) this.hooks.pauseIfPlaying?.(); // 守卫：播放中 trim 先自动暂停（淡化/增益实时不暂停）
        this.drag = { kind: part === 'trimL' ? (e.shiftKey ? 'trimLB' : 'trimL') : part === 'trimR' ? (e.shiftKey ? 'trimRB' : 'trimR') : part, id: hit.clip.id, startX: x, moved: false };
      } else {
        this.drag = null;
      }
      this.render();
      return;
    }
    this.drag = { kind: 'timeSel', startSec: sec, startX: x, moved: false };
    this.timeSel = { start: sec, end: sec };
    this.render();
  }
  _dragX(e) {
    const r = this.cv.getBoundingClientRect();
    return e.clientX - r.left;
  }
  _applyClipMove(drag, x) {
    const p = this.hooks.getProject();
    const pps = this.ppsOf(p);
    let newStart = Math.max(0, x / pps - drag.grabSec);
    // 磁吸：起点/终点就近候选（取距离更小者；不吸自己）
    const snapS = this._snap(newStart, drag.primary.id);
    const snapE = this._snap(newStart + drag.primary.lengthSec, drag.primary.id);
    if (snapS.line !== null || snapE.line !== null) {
      const dS = snapS.line !== null ? Math.abs(snapS.line - newStart) : Infinity;
      const dE = snapE.line !== null ? Math.abs(snapE.line - (newStart + drag.primary.lengthSec)) : Infinity;
      if (dS <= dE) newStart = snapS.line ?? newStart; else newStart = Math.max(0, (snapE.line ?? (newStart + drag.primary.lengthSec)) - drag.primary.lengthSec);
    }
    const delta = newStart - drag.primary.timelineStartSec;
    if (!delta) return;
    this.hooks.mutate(pr => {
      for (const id of drag.ids) {
        const c = pr.timeline.audioClips.find(k => k.id === id);
        if (c) c.timelineStartSec = r6(Math.max(0, c.timelineStartSec + delta));
      }
      applyAutoCrossfades(pr.timeline.audioClips, drag.ids);
      for (const id of drag.ids) pruneAutoCrossfades(pr.timeline.audioClips, id);
    });
    drag.moved = true;
    this.render();
  }
  _move(e) {
    const drag = this.drag;
    const x0 = this._dragX(e);
    const r0 = this.cv.getBoundingClientRect();
    const y0 = e.clientY - r0.top;
    // 悬停反馈（无拖拽时）：clip 命中光标 + tag 旗点 + 块高亮
    if (!drag) {
      const x = x0, y = y0;
      const p = this.hooks.getProject();
      const edges = p ? this.edgeHits(x) : [];
      let hoverSeg = null;
      let hoverTag = null;
      this.hoverAudio = false;
      this.hoverClipEdge = null;
      if (p && this.inTagLane(y)) {
        // 旗点或 ×（几何）都算悬停该标记——× 在名称末端，鼠标移过去不能让 × 消失
        const hit = this.tagAt(x);
        hoverTag = hit ? hit.tag.id : this._tagGeomHit(x, 8);
      } else if (p && y >= this.audioTop() && y <= this.audioBottom() && clipsOf(p).length) {
        // v3 音频轨悬停：部件光标（trim/fade/gain/body/剃刀）
        this.hoverAudio = true;
        const clips = clipsOf(p);
        if (!this._xFadeHit(x, y, clips)) {
          const hit = this._audioHit(x, y, clips);
          if (hit) {
            this.hoverClipEdge = { id: hit.clip.id, part: hit.part };
            const cursors = { trimL: 'ew-resize', trimR: 'ew-resize', trimLB: 'ew-resize', trimRB: 'ew-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize', gain: 'ns-resize', body: this.razor ? 'crosshair' : 'grab' };
            this.cv.style.cursor = this.razor ? 'crosshair' : (cursors[hit.part] || 'default');
            this._tagTitle(x, y);
            this.render();
            return;
          }
        }
        this.cv.style.cursor = this.razor ? 'crosshair' : 'default';
        this._tagTitle(x, y);
        this.render();
        return;
      } else {
        for (const hit of edges) hoverSeg = hit.seg.i;
        if (hoverSeg === null && y >= (this.blocksTop ?? 0) && y <= (this.blocksTop ?? 0) + (this.blocksH ?? 0)) {
          if (p) {
            const beat = this.xToBeat(x);
            for (const s of computeSegments(p).segments) {
              if (beat >= s.holdStart && beat < s.travelEnd) { hoverSeg = s.i; break; }
            }
          }
        }
      }
      this.cv.style.cursor = hoverTag ? 'pointer' : (edges.length ? 'ew-resize' : 'default');
      this._tagTitle(x, y);
      if (this.hoverSeg !== hoverSeg || this.hoverTag !== hoverTag) {
        this.hoverSeg = hoverSeg;
        this.hoverTag = hoverTag;
        this.render();
      }
      return;
    }
    const p = this.hooks.getProject();
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const spbV = spb(p);
    const minBeats = 0.5;
    if (drag.kind === 'scrub') {
      this.hooks.seekBeat(this.xToBeat(x));
      return;
    }
    // ---- v3 音频轨拖拽族 ----
    const clips = clipsOf(p);
    if (drag.kind === 'clipMove') {
      this._applyClipMove(drag, x);
      return;
    }
    if (drag.kind === 'trimL' || drag.kind === 'trimLB' || drag.kind === 'trimR' || drag.kind === 'trimRB') {
      const c = clips.find(k => k.id === drag.id);
      if (!c) return;
      const assetDur = this.assetDurOf(p, c.assetId);
      let sec = x / this.ppsOf(p);
      const snapped = this._snap(sec, c.id);
      if (snapped.line !== null) sec = snapped.t;
      let ok = false;
      if (drag.kind === 'trimL') { ok = trimClipLeftAnchored(c, sec, assetDur); if (ok) this._snapZeroCross(c, 'in'); }
      else if (drag.kind === 'trimLB') ok = trimClipLeftBoundary(c, sec, assetDur);
      else if (drag.kind === 'trimR') { ok = trimClipRightAnchored(c, sec, assetDur); if (ok) this._snapZeroCross(c, 'out'); }
      else ok = trimClipRightBoundary(c, sec, assetDur);
      if (ok) {
        drag.moved = true;
        this.hooks.mutate(pr => {
          applyAutoCrossfades(pr.timeline.audioClips, [c.id]);
          pruneAutoCrossfades(pr.timeline.audioClips, c.id);
        });
        this.render();
      }
      return;
    }
    if (drag.kind === 'fadeIn' || drag.kind === 'fadeOut') {
      const c = clips.find(k => k.id === drag.id);
      if (!c) return;
      const pps = this.ppsOf(p);
      const x0c = c.timelineStartSec * pps, x1c = clipEnd(c) * pps;
      let f = drag.kind === 'fadeIn' ? (x - x0c) / pps : (x1c - x) / pps;
      f = Math.max(0, Math.min(c.lengthSec, f));
      c[drag.kind === 'fadeIn' ? 'fadeInSec' : 'fadeOutSec'] = r6(f);
      c[drag.kind === 'fadeIn' ? 'fadeInAuto' : 'fadeOutAuto'] = false; // 手动淡化（拖开不还原）
      drag.moved = true;
      this.hooks.mutate(() => {});
      this.render();
      return;
    }
    if (drag.kind === 'xFade') {
      // 菱形手柄：调交叉淡化比例（双方同步同一淡化时长，钳在重叠区间内）
      let f = (x / this.ppsOf(p)) - drag.ovStart;
      const span = drag.ovEnd - drag.ovStart;
      f = Math.max(MIN_CLIP_DUR * 2, Math.min(span, f));
      drag.a.fadeOutSec = r6(f); drag.b.fadeInSec = r6(f);
      drag.a.fadeOutAuto = false; drag.b.fadeInAuto = false;
      drag.moved = true;
      this.hooks.mutate(() => {});
      this.render();
      return;
    }
    if (drag.kind === 'gain') {
      const c = clips.find(k => k.id === drag.id);
      if (!c) return;
      const laneMid = this.audioTop() + this.audioLaneH() / 2;
      const g = Math.max(0, Math.min(2, 1 + (laneMid - y0) / (this.audioLaneH() / 2 - 6)));
      c.gain = r6(g);
      drag.moved = true;
      this.hooks.mutate(() => {});
      this.render();
      return;
    }
    if (drag.kind === 'timeSel') {
      const sec = Math.max(0, x / this.ppsOf(p));
      drag.moved = drag.moved || Math.abs(x - drag.startX) > 3 || !!drag.fromRuler;
      this.timeSel = { start: Math.min(drag.startSec, sec), end: Math.max(drag.startSec, sec) };
      this.hooks.onTimeSelection?.(this.timeSel);
      this.render();
      return;
    }
    if (drag.kind === 'tag') {
      // 拖旗移位：实时预览（mutate(fn,null) 不进历史），松手在 _up 提交恰一条「移动标记」
      drag.moved = drag.moved || Math.abs(x - drag.startX) > 2;
      if (drag.moved) {
        this.hooks.mutate(proj => { moveTag(proj, drag.id, this.xToBeat(x)); });
        this.hoverTag = drag.id;
      }
      return;
    }
    let beat = this.xToBeat(x);
    // 吸附到整拍
    beat = Math.round(beat);
    this.hooks.mutate(proj => {
      const blk = proj.timeline.blocks[drag.seg.i];
      const next = proj.timeline.blocks[drag.seg.i + 1];
      if (drag.kind === 'hold') {
        const newHold = Math.max(minBeats, beat - drag.seg.holdStart);
        if (this.hooks.ripple()) {
          blk.holdBeats = newHold;
        } else {
          const d = newHold - (drag.seg.holdEnd - drag.seg.holdStart);
          blk.holdBeats = newHold;
          blk.travelBeats = Math.max(0, blk.travelBeats - d); // 压缩自身过渡，后续块不动
        }
      } else if (drag.kind === 'travel' && next) {
        blk.travelBeats = Math.max(minBeats, beat - drag.seg.holdEnd);
      }
    });
    // 更新缓存的 seg 边界，避免累积误差
    const { segments } = computeSegments(p);
    drag.seg = segments[drag.seg.i];
  }
  _up() {
    if (this.drag && this.drag.kind === 'tag') {
      const { id, moved } = this.drag;
      this.drag = null;
      if (moved) this.hooks.commitEdit?.('移动标记'); // 预览已写入，提交恰一条历史
      else {
        // 单击旗点：播放头跳到该拍（对齐用途）；点选态保持 × 可见（触屏无 hover 的删除路径）
        const t = tagById(this.hooks.getProject(), id);
        if (t) {
          this.activeTag = id;
          this.hooks.seekBeat(t.beat);
        }
      }
      this.render();
      return;
    }
    if (this.drag && (this.drag.kind === 'hold' || this.drag.kind === 'travel')) {
      this.hooks.commitEdit?.('调整时长');
    }
    // ---- v3 音频轨拖拽提交 ----
    const d = this.drag;
    if (d && (d.kind === 'clipMove' || d.kind === 'trimL' || d.kind === 'trimR' || d.kind === 'trimLB' || d.kind === 'trimRB')) {
      if (d.moved) this.hooks.commitEdit?.(d.kind.startsWith('trim') ? '修剪音频剪辑' : '移动音频剪辑');
      else if (d.kind === 'clipMove') this.hooks.seekBeat(this.xToBeat(this._lastX ?? 0)); // 单击 clip=定位播放头（C12）
    } else if (d && (d.kind === 'fadeIn' || d.kind === 'fadeOut' || d.kind === 'xFade')) {
      if (d.moved) this.hooks.commitEdit?.('调整淡化');
    } else if (d && d.kind === 'gain') {
      if (d.moved) this.hooks.commitEdit?.('剪辑增益');
    } else if (d && d.kind === 'timeSel') {
      if (!d.moved) { // 空白单击：清选区+定位播放头（C12）
        this.timeSel = null;
        this.hooks.onTimeSelection?.(null);
        this.hooks.seekBeat(this.xToBeat(this._lastX ?? 0));
      }
    }
    this._lastX = null;
    this.drag = null;
  }
  // ---- v3 clip 原子操作（键盘/右键菜单入口；守卫：编辑锁 + 播放中先自动暂停） ----
  _guard(editableOnly = true) {
    const p = this.hooks.getProject();
    if (!p || !clipsOf(p).length) return false;
    if (editableOnly && this.hooks.canEdit?.() === false) {
      this.hooks.toast?.('编辑已关闭，无法修改（选择/预览可用）');
      return false;
    }
    return true;
  }
  _pauseIfPlaying() { this.hooks.pauseIfPlaying?.(); }
  playheadSec() {
    const p = this.hooks.getProject();
    const player = this.hooks.getPlayer?.();
    return p && player ? beatToSec(p, Math.max(0, player.beat || 0)) : 0;
  }
  // C6：播放头处分割（Ctrl/Cmd+K）。有选中切选中；无选中切所有跨播放头的 clip（Razor All）
  splitAtPlayhead() {
    if (!this._guard()) return;
    this._pauseIfPlaying();
    const t = this.playheadSec();
    this.hooks.mutateLabeled?.(pr => {
      const clips = pr.timeline.audioClips;
      const ids = this.clipSel.size ? [...this.clipSel] : clips.map(c => c.id);
      for (const id of ids) splitClipAt(clips, id, t);
    }, '分割音频剪辑');
    this.render();
  }
  // C10：删除/波纹删除选中（有时间选区时无选中=删除选区内 clip？——规格把选区作为
  // 「修剪到时间选区」的作用域；删除始终以选中 clip 为对象）
  deleteSelected(ripple = false) {
    if (!this._guard()) return;
    if (!this.clipSel.size) return;
    this._pauseIfPlaying();
    const ids = [...this.clipSel];
    this.hooks.mutateLabeled?.(pr => {
      const clips = pr.timeline.audioClips;
      if (ripple) rippleDeleteClips(clips, ids);
      const set = new Set(ids);
      pr.timeline.audioClips = clips.filter(c => !set.has(c.id));
    }, ripple ? '波纹删除音频剪辑' : '删除音频剪辑');
    this.clipSel = new Set();
    this.render();
  }
  // C9：静音/取消静音选中 clip（实时，可播放中操作）
  toggleMuteSelected() {
    if (!this._guard(false)) return;
    if (!this.clipSel.size) return;
    const p = this.hooks.getProject();
    const sel = clipsOf(p).filter(c => this.clipSel.has(c.id));
    const anyAudible = sel.some(c => !c.muted);
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) { if (anyAudible) c.muted = true; else delete c.muted; }
    }, anyAudible ? '静音音频剪辑' : '取消静音音频剪辑');
    this.render();
  }
  resetGainSelected() {
    if (!this._guard(false) || !this.clipSel.size) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) c.gain = 1;
    }, '增益重置');
    this.render();
  }
  renameSelected(name) {
    if (!this._guard(false) || !this.clipSel.size) return false;
    const n = String(name || '').trim().slice(0, 80);
    if (!n) return false;
    const p = this.hooks.getProject();
    const first = clipsOf(p).find(c => this.clipSel.has(c.id));
    if (!first) return false;
    this.hooks.mutateLabeled?.(pr => {
      const c = pr.timeline.audioClips.find(k => k.id === first.id);
      if (c) c.name = n;
    }, '重命名音频剪辑');
    this.render();
    return true;
  }
  setSelectedColor(color) {
    if (!this._guard(false) || !this.clipSel.size) return;
    this.hooks.mutateLabeled?.(pr => {
      for (const c of pr.timeline.audioClips) if (this.clipSel.has(c.id)) c.color = color;
    }, '剪辑颜色');
    this.render();
  }
  // 修剪到时间选区（右键菜单；作用域=选中 clip ∩ [start,end]）
  trimSelectedToTimeSel() {
    if (!this._guard()) return;
    if (!this.timeSel || !this.clipSel.size) { this.hooks.toast?.('先框出时间选区并选中 clip'); return; }
    this._pauseIfPlaying();
    const ids = [...this.clipSel];
    const { start, end } = this.timeSel;
    this.hooks.mutateLabeled?.(pr => {
      const dropped = trimClipsToRange(pr.timeline.audioClips, ids, start, end);
      if (dropped.length) pr.timeline.audioClips = pr.timeline.audioClips.filter(c => !dropped.includes(c.id));
    }, '修剪到时间选区');
    this.render();
  }
  // C3：←/→ 微移（plain=逐帧 10ms；Shift=按网格步进即整拍）
  nudgeSelected(deltaSec, { grid = false } = {}) {
    if (!this._guard()) return;
    if (!this.clipSel.size) return;
    this._pauseIfPlaying();
    const p = this.hooks.getProject();
    const gridSec = grid ? spb(p) : 0.01;
    const step = (deltaSec >= 0 ? 1 : -1) * gridSec;
    const ids = [...this.clipSel];
    this.hooks.mutate(pr => {
      for (const id of ids) {
        const c = pr.timeline.audioClips.find(k => k.id === id);
        if (!c) continue;
        let ns = c.timelineStartSec + step;
        if (grid) ns = Math.round(ns / gridSec) * gridSec;
        c.timelineStartSec = r6(Math.max(0, ns));
      }
      applyAutoCrossfades(pr.timeline.audioClips, ids);
      for (const id of ids) pruneAutoCrossfades(pr.timeline.audioClips, id);
    }, null);
    this.hooks.commitEdit?.('微移音频剪辑');
    this.render();
  }
  clearClipSelection() {
    this.clipSel = new Set();
    this.timeSel = null;
    this.hooks.onTimeSelection?.(null);
    this.render();
  }
  setExpanded(v) {
    this.expanded = !!v;
    try { localStorage.setItem('wuzhen:audioTrackExpanded', this.expanded ? '1' : '0'); } catch {}
    this.render();
  }
  toggleSnap() {
    this.snapOn = !this.snapOn;
    try { localStorage.setItem('wuzhen:audioSnap', this.snapOn ? '1' : '0'); } catch {}
    this.hooks.toast?.(`磁吸${this.snapOn ? '开' : '关'}（clip 缘/块边界/tag/播放头/选区/零交叉）`);
    this.render();
  }
  setRazor(v) {
    this.razor = v == null ? !this.razor : !!v;
    this.hooks.toast?.(this.razor ? '剃刀模式：点击 clip 分割（R/Esc 退出）' : '剃刀模式关闭');
    this.render();
    return this.razor;
  }
  // C12：双击 clip=选中并循环预览（范围循环至手动停止）
  previewSelectedClipAt(x, y, clips) {
    const hit = this._audioHit(x, y, clips);
    if (!hit) return false;
    this.clipSel = new Set([hit.clip.id]);
    this.hooks.previewClip?.(hit.clip);
    this.render();
    return true;
  }
  // 双击：tag 道=打点/改名；音频轨=clip 循环预览（选中）或空白取消全选（C1/C12）。
  // × 删除后 400ms 内的双击忽略（双击 × 只删一次，不应原地加回）。
  _dblclick(e) {
    const p = this.hooks.getProject();
    if (!p) return;
    if (performance.now() - (this._delAt || 0) < 400) return;
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const clips = clipsOf(p);
    if (clips.length && y >= this.audioTop() && y <= this.audioBottom()) {
      // 双击空白=取消全选；双击 clip=选中并循环预览
      if (!this.previewSelectedClipAt(x, y, clips)) this.clearClipSelection();
      return;
    }
    if (!this.inTagLane(y)) return;
    const hit = this.tagAt(x);
    if (hit) this._openTagInput({ id: hit.tag.id, initial: hit.tag.name });
    else this._openTagInput({ beat: Math.max(0, Math.round(this.xToBeat(x) * 100) / 100) });
  }
}
