// 舞台画布：渲染 + 命中测试 + 拖拽（拖一带一）/框选/平移缩放/朝向把手
import { faceAudience, partnerOf, posAt, computeSegments, easeInOut, lerpAngle } from './model.js';

export const DANCER_R = 0.38; // 舞者圆点半径（米）

// ---------- 场景绘制（舞台视图/缩略图/PNG/打印共用） ----------
export function stageBounds(stage) {
  const b = stage.backstageM ?? 0;
  return { x0: -b, y0: -b, x1: stage.widthM + b, y1: stage.depthM + b };
}
export function fitView(canvasW, canvasH, stage, pad = 14) {
  const b = stageBounds(stage);
  const scale = Math.min((canvasW - pad * 2) / (b.x1 - b.x0), (canvasH - pad * 2) / (b.y1 - b.y0));
  const ox = (canvasW - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale;
  const oy = (canvasH - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale;
  return { scale, ox, oy };
}
export function drawScene(ctx, rect, project, positions, opts = {}) {
  const { widthM: W, depthM: H } = project.stage;
  const MERGE_DIST = 0.8; // 配对舞者接近此间距内合为徽标
  const theme = opts.theme || (typeof document !== 'undefined' && document.documentElement.dataset.theme) || 'dark';
  const dark = theme !== 'light';
  const view = opts.view || fitView(rect.w, rect.h, project.stage, opts.pad ?? 14);
  const s = view.scale, ox = view.ox + rect.x, oy = view.oy + rect.y;
  const r = DANCER_R * s;
  const X = x => ox + x * s, Y = y => oy + y * s;
  const bs = project.stage.backstageM ?? 0;

  // 背景
  ctx.fillStyle = opts.bg || '#f8fafc';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (project.stage.bgImage && !opts.minimal) {
    ctx.save(); ctx.globalAlpha = 0.5;
    // bgImage 存为 {src, w, h}，按舞台区域拉伸
    if (drawScene._bg?.src !== project.stage.bgImage.src) {
      const img = new Image();
      img.onload = () => { drawScene._bg = { src: project.stage.bgImage.src, img }; if (opts.onImageLoad) opts.onImageLoad(); };
      img.src = project.stage.bgImage.src;
      drawScene._bg = { src: project.stage.bgImage.src, img, pending: true };
    }
    const bg = drawScene._bg;
    if (bg?.img?.complete) ctx.drawImage(bg.img, X(0), Y(0), W * s, H * s);
    ctx.restore();
  }

  // 后台区
  if (bs > 0 && !opts.minimal) {
    ctx.save();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(X(-bs), Y(-bs), (W + 2 * bs) * s, (H + 2 * bs) * s);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(X(0), Y(0), W * s, H * s);
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(X(0), Y(0), W * s, H * s);
    ctx.setLineDash([]);
    ctx.restore();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(X(0), Y(0), W * s, H * s);
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5;
    ctx.strokeRect(X(0), Y(0), W * s, H * s);
  }

  // 网格
  const g = opts.showGrid === false ? 0 : (project.stage.gridM || 0.5);
  if (!opts.minimal && g > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,.25)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = g; x < W; x += g) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(H)); }
    for (let y = g; y < H; y += g) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(W), Y(y)); }
    ctx.stroke();
    // 中心线
    ctx.strokeStyle = 'rgba(100,116,139,.4)'; ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(X(W / 2), Y(0)); ctx.lineTo(X(W / 2), Y(H));
    ctx.moveTo(X(0), Y(H / 2)); ctx.lineTo(X(W), Y(H / 2));
    ctx.stroke();
    ctx.restore();
  }

  // 观众方向标注
  if (!opts.minimal) {
    ctx.save();
    ctx.fillStyle = '#64748b'; ctx.font = `600 ${Math.max(11, s * 0.5)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t = '观 众';
    const pos = { bottom: [X(W / 2), Y(H + bs * 0.5)], top: [X(W / 2), Y(-bs * 0.5)], left: [X(-bs * 0.5), Y(H / 2)], right: [X(W + bs * 0.5), Y(H / 2)] }[project.stage.audience] || [X(W / 2), Y(H + bs * 0.5)];
    ctx.fillText(t, pos[0], pos[1]);
    ctx.restore();
  }

  // Ghost（上一/下一队形）：配对接近=圆角矩形虚影，分离=圆虚影
  if (opts.ghost) {
    function ghostBadge(cx, cy, w, hh, bothPresent) {
      ctx.save(); ctx.globalAlpha = 0.32;
      ctx.setLineDash([4, 4]);
      rrPath(cx - w / 2, cy - hh / 2, w, hh, hh * 0.45);
      if (bothPresent) { ctx.fillStyle = 'rgba(71,85,105,.12)'; ctx.fill(); }
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    };
    for (const gp of opts.ghost) {
      for (const pair of project.pairs) {
        const a = gp.positions[pair.leader], b = gp.positions[pair.follower];
        if (!a || !b) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) <= MERGE_DIST) {
          ghostBadge((X(a.x) + X(b.x)) / 2, (Y(a.y) + Y(b.y)) / 2, r * 3.4, r * 1.5, true);
        } else {
          ctx.save(); ctx.globalAlpha = 0.32;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.arc(X(a.x), Y(a.y), DANCER_R * s, 0, Math.PI * 2);
          ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), DANCER_R * s, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      for (const [id, p2] of Object.entries(gp.positions)) {
        if (project.pairs.some(pa => pa.leader === id || pa.follower === id)) continue;
        if (!positions[id]) continue;
        ctx.save(); ctx.globalAlpha = 0.32;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(X(p2.x), Y(p2.y), DANCER_R * s, 0, Math.PI * 2);
        ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
    }
  }
  // 移动路径（当前 → 下一队形）
  if (opts.paths && opts.nextPositions) {
    ctx.save();
    ctx.strokeStyle = 'rgba(14,165,233,.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([7, 6]);
    ctx.beginPath();
    for (const [id, p] of Object.entries(positions)) {
      const q = opts.nextPositions[id]; if (!q) continue;
      ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(q.x), Y(q.y));
    }
    ctx.stroke(); ctx.restore();
  }

  // 舞者与舞对单元渲染：
  //   配对舞者位置接近（≤0.8m）时合为【圆角矩形徽标】（一个视觉符号）；
  //   分开超过阈值时呈示为两个独立圆 + 虚线绑定（拖动编辑互不影响）。
  const dancerById = id => project.dancers.find(x => x.id === id);
  const inSel = id => opts.selection?.has(id);
  function drawOne(id, p, px, py, rr, sel) {
    const d = dancerById(id); if (!d) return;
    // 朝向指示（圆内指针）
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((p.facing || 0) * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -rr * 0.55); ctx.lineTo(rr * 0.42, rr * 0.38); ctx.lineTo(-rr * 0.42, rr * 0.38);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fillStyle = d.color || '#64748b'; ctx.fill();
    ctx.lineWidth = sel ? Math.max(2.5, s * 0.09) : Math.max(1, s * 0.04);
    ctx.strokeStyle = sel ? '#0ea5e9' : 'rgba(15,23,42,.55)'; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(8, rr * 0.95)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.short || '?', px, py + rr * 0.05);
  };
  function rrPath(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  // 合并单元符号：capsule=圆角矩形 / diamond=菱形 / twin=双圆，左右各色+编号
  function drawUnitSymbol(style, idA, idB, a, b, sel, alpha) {
    const cx = (X(a.x) + X(b.x)) / 2, cy = (Y(a.y) + Y(b.y)) / 2;
    const dA = dancerById(idA), dB = dancerById(idB);
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (style === 'diamond') {
      const h = r * 1.9;
      const T = [cx, cy - h], Rt = [cx + h, cy], B = [cx, cy + h], L = [cx - h, cy], C = [cx, cy];
      const poly = pts => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); };
      poly([T, L, C]); ctx.fillStyle = dA?.color || '#64748b'; ctx.fill();
      poly([T, C, B, Rt]); ctx.fillStyle = dB?.color || '#94a3b8'; ctx.fill();
      poly([T, Rt, B, L]);
      ctx.lineWidth = sel ? Math.max(3, s * 0.1) : 2;
      ctx.strokeStyle = sel ? '#0ea5e9' : '#f8fafc';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.max(8, h * 0.42)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dA?.short || '?', cx - h * 0.42, cy);
      ctx.fillText(dB?.short || '?', cx + h * 0.42, cy);
    } else if (style === 'twin') {
      const rr = r * 1.08;
      for (const [id, px, py] of [[idA, cx - rr * 0.62, cy], [idB, cx + rr * 0.62, cy]]) {
        const d = dancerById(id);
        ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.fillStyle = d?.color || '#64748b'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#f8fafc'; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.max(8, rr * 0.8)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d?.short || '?', px, py);
      }
    } else { // capsule 圆角矩形
      const w = r * 3.4, hh = r * 1.5;
      const x0 = cx - w / 2, y0 = cy - hh / 2, rad = hh * 0.45;
      ctx.save();
      rrPath(x0, y0, w, hh, rad); ctx.clip();
      ctx.fillStyle = dA?.color || '#64748b'; ctx.fillRect(x0, y0, w / 2, hh);
      ctx.fillStyle = dB?.color || '#94a3b8'; ctx.fillRect(x0 + w / 2, y0, w / 2, hh);
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(cx - 1, y0, 2, hh); // 中缝
      ctx.restore();
      rrPath(x0, y0, w, hh, rad);
      ctx.lineWidth = sel ? Math.max(3, s * 0.1) : 2;
      ctx.strokeStyle = sel ? '#0ea5e9' : (dark ? '#f8fafc' : '#334155');
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.max(8, hh * 0.62)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dA?.short || '?', cx - w * 0.25, cy + hh * 0.02);
      ctx.fillText(dB?.short || '?', cx + w * 0.25, cy + hh * 0.02);
    }
    ctx.restore();
  };
  function drawBond(a, b, alpha = 1) {
    ctx.save();
    ctx.strokeStyle = `rgba(56,189,248,${0.45 * alpha})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y));
    ctx.stroke();
    ctx.restore();
  };

  // 合并单元（帧级 merges）：接近=合并符号，分离=两圆+虚线（"拉伸的合并"）
  for (const m of opts.merges || []) {
    const a = positions[m.a], b = positions[m.b];
    if (!a || !b) continue;
    const sel = inSel(m.a) || inSel(m.b);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= MERGE_DIST) {
      drawUnitSymbol(m.style, m.a, m.b, a, b, sel);
    } else {
      drawBond(a, b);
      drawOne(m.a, a, X(a.x), Y(a.y), r, inSel(m.a));
      drawOne(m.b, b, X(b.x), Y(b.y), r, inSel(m.b));
    }
  }
  // 未合并舞者（单圆）
  const mergedIds = new Set((opts.merges || []).flatMap(m => [m.a, m.b]));
  for (const [id, p] of Object.entries(positions)) {
    if (mergedIds.has(id)) continue;
    drawOne(id, p, X(p.x), Y(p.y), r, inSel(id));
  }
  return view;
}

// ---------- 交互视图 ----------
export class StageView {
  constructor(canvas, ctx2d, getScene, hooks) {
    this.canvas = canvas;
    this.ctx = ctx2d;
    this.getScene = getScene;     // () => {project, positions, formation, selection:Set, showGhost, showPaths, playbackPos, readOnly}
    this.hooks = hooks;           // {select(ids,{add}), mutateLive(fn), commit(label), onStageClick()}
    this.view = null;
    this.pointers = new Map();
    this.drag = null;
    this.box = null;
    this._rafPending = false;
    this._bind();
    this._ro = new ResizeObserver(() => this.requestDraw());
    this._ro.observe(canvas.parentElement);
  }

  // ---- 坐标换算 ----
  toStage(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.view;
    return { x: (px - rect.left - v.ox) / v.scale, y: (py - rect.top - v.oy) / v.scale };
  }
  ensureView() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = rect.width, H = rect.height;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
      this.view = null;
    }
    const scene = this.getScene();
    const fit = fitView(W, H, scene.project.stage, 16);
    if (!this.view) this.view = fit;
    else {
      const min = fit.scale * 0.5, max = fit.scale * 8;
      this.view.scale = Math.min(max, Math.max(min, this.view.scale));
    }
    return { W, H, dpr };
  }
  requestDraw() {
    // 同步重绘：画布元素少开销低，且不受 rAF/定时器节流影响
    this.draw();
  }

  // ---- 切帧动效（纯舞台 UI 动画：不经过播放引擎、不动播放头/时间线） ----
  startPositionsPreview(fromFormation, toFormation, durationMs = 700) {
    if (!fromFormation || !toFormation) return;
    this.anim = {
      from: fromFormation.positions, to: toFormation.positions,
      t0: performance.now(), dur: Math.max(200, durationMs),
    };
    this.drag = null;
    this.box = null;
    this._animTick();
  }
  _animTick() {
    if (!this.anim) return;
    const elapsed = performance.now() - this.anim.t0;
    if (elapsed >= this.anim.dur) {
      this.anim = null;
      this.draw();
      this.hooks.onSwitchAnimEnd?.();
      return;
    }
    this.draw();
    setTimeout(() => this._animTick(), 16);
  }
  resetView() { this.view = null; this.requestDraw(); }
  zoomAt(cx, cy, factor) {
    this.ensureView();
    const rect = this.canvas.getBoundingClientRect();
    const px = cx - rect.left, py = cy - rect.top;
    const sx = (px - this.view.ox) / this.view.scale, sy = (py - this.view.oy) / this.view.scale;
    this.view.scale *= factor;
    this.view.ox = px - sx * this.view.scale;
    this.view.oy = py - sy * this.view.scale;
    this.clampPan();
    this.requestDraw();
  }
  // 平移软钳制：舞台始终保留 ≥80px 可见
  clampPan() {
    const scene = this.getScene();
    if (!scene?.project || !this.view) return;
    const rect = this.canvas.getBoundingClientRect();
    const b = stageBounds(scene.project.stage);
    const s = this.view.scale, W = rect.width, H = rect.height, m = 80;
    this.view.ox = Math.min(W - m - b.x0 * s, Math.max(m - b.x1 * s, this.view.ox));
    this.view.oy = Math.min(H - m - b.y0 * s, Math.max(m - b.y1 * s, this.view.oy));
  }

  draw() {
    const scene = this.getScene();
    if (!scene?.project) return;
    const { W, H, dpr } = this.ensureView();
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light') ? '#dfe6ee' : '#0b1220';
    ctx.fillRect(0, 0, W, H);
    const project = scene.project;
    // 切帧动效期间：插值位置优先（不影响编辑数据，仅绘制）
    let animPos = null;
    if (this.anim) {
      const t = easeInOut(Math.min(1, (performance.now() - this.anim.t0) / this.anim.dur));
      animPos = {};
      const ids = new Set([...Object.keys(this.anim.from), ...Object.keys(this.anim.to)]);
      for (const id of ids) {
        const a = this.anim.from[id] || this.anim.to[id], b = this.anim.to[id] || this.anim.from[id];
        if (a && b) animPos[id] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, facing: lerpAngle(a.facing || 0, b.facing || 0, t) };
      }
    }
    const positions = scene.playbackPos || animPos || scene.formation?.positions || {};

    // ghost / paths
    let ghost = null, nextPositions = null;
    if (!scene.playbackPos && !scene.readOnly) {
      const i = scene.formationIndex;
      if (scene.showGhost) {
        ghost = [];
        if (i > 0) ghost.push(project.formations[i - 1]);
        if (i < project.formations.length - 1) ghost.push(project.formations[i + 1]);
        if (!ghost.length) ghost = null;
      }
      if (scene.showPaths && i < project.formations.length - 1) nextPositions = project.formations[i + 1].positions;
    }
    // 使用当前视图（缩放/平移状态），不被 fitView 每帧重置
    this.view = drawScene(ctx, { x: 0, y: 0, w: W, h: H }, project, positions, {
      view: this.view,
      ghost, nextPositions,
      selection: scene.selection,
      showGrid: scene.showGrid,
      theme: scene.theme,
      pad: 16,
      onImageLoad: () => this.requestDraw(),
    });

    // 框选矩形（画布内像素坐标）
    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      ctx.save();
      ctx.fillStyle = 'rgba(56,189,248,.12)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      const x = Math.min(x0, x1), y = Math.min(y0, y1);
      ctx.fillRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(x, y, Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
    }

    // 朝向把手（恰好选中一名舞者且非播放）
    this.handlePx = null;
    if (scene.facingHandle && scene.singleSelected && scene.selection?.size >= 1 && !scene.playbackPos && !scene.readOnly) {
      const id = [...scene.selection][0];
      const p = positions[id];
      if (p) {
        const v = this.view;
        const rect = this.canvas.getBoundingClientRect();
        const fr = (p.facing || 0) * Math.PI / 180;
        const hx = v.ox + (p.x + Math.sin(fr) * 0.9) * v.scale;
        const hy = v.oy + (p.y - Math.cos(fr) * 0.9) * v.scale;
        this.handlePx = { x: hx + rect.left, y: hy + rect.top, px: hx, py: hy };
        ctx.save();
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(v.ox + p.x * v.scale, v.oy + p.y * v.scale);
        ctx.lineTo(hx, hy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8'; ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---- 手势：长按合并单元弹浮窗；拖拽重叠 2s 弹合并确认 ----
  _armLongPress(id) {
    const scene = this.getScene();
    const f = scene.formation;
    if (!f) return;
    const partner = (f.merges || []).find(m => m.a === id || m.b === id);
    if (!partner) return; // 未合并的舞者不弹
    const otherId = partner.a === id ? partner.b : partner.a;
    const a = f.positions[id], b = f.positions[otherId];
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > MERGE_DIST) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = rect.left + this.view.ox + ((a.x + b.x) / 2) * this.view.scale;
    const py = rect.top + this.view.oy + ((a.y + b.y) / 2) * this.view.scale;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.drag = null; // 取消拖拽，锁定等待浮窗操作
      this.lockedByLongPress = true;
      this.hooks.showUnitMenu({ mode: 'unit', ids: [id, otherId], screen: { x: px, y: py } });
    }, 500);
  }
  _checkMergeHold(draggedId) {
    if (this.mergeHold && this.mergeHold.fired) return;
    const scene = this.getScene();
    const f = scene.formation;
    if (!f) return;
    const pos = f.positions;
    const dragged = pos[draggedId];
    if (!dragged) { this._clearMergeHold(); return; }
    let other = null;
    for (const [id, q] of Object.entries(pos)) {
      if (id === draggedId) continue;
      if (Math.hypot(q.x - dragged.x, q.y - dragged.y) < 0.6) { other = id; break; }
    }
    if (!other) { this._clearMergeHold(); return; }
    if (!this.mergeHold || this.mergeHold.other !== other) {
      this._clearMergeHold();
      this.mergeHold = { other, start: performance.now() };
    }
    if (performance.now() - this.mergeHold.start >= 1200) {
      this.mergeHold.fired = true; // 一次性触发，避免 move 反复重建浮窗
      const rect = this.canvas.getBoundingClientRect();
      const mx = rect.left + this.view.ox + dragged.x * this.view.scale;
      const my = rect.top + this.view.oy + dragged.y * this.view.scale;
      this.hooks.showUnitMenu({ mode: 'merge', ids: [draggedId, other], formationIndex: scene.formationIndex, screen: { x: mx, y: my } });
    }
  }
  _clearMergeHold() {
    this.mergeHold = null;
    this.mergePromptShown = false;
  }

  // ---- 命中 ----
  // 始终按单个舞者命中（选择不含舞伴联动；共同移动仅来自框选/多选）
  // 重合时优先命中后绘制的（视觉上层）
  hitDancer(sx, sy) {
    const scene = this.getScene();
    const positions = scene.playbackPos || scene.formation?.positions || {};
    const entries = Object.entries(positions);
    let best = null, bd = Infinity;
    for (let i = entries.length - 1; i >= 0; i--) {
      const [id, p] = entries[i];
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < DANCER_R * 1.35 && d < bd) { bd = d; best = id; }
    }
    return best;
  }
  hitHandle(px, py) {
    if (!this.handlePx) return false;
    return Math.hypot(px - this.handlePx.x, py - this.handlePx.y) < 16;
  }

  _bind() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', e => this._down(e));
    cv.addEventListener('pointermove', e => this._move(e));
    cv.addEventListener('pointerup', e => this._up(e));
    cv.addEventListener('pointercancel', e => this._up(e));
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });
  }
  _down(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch {} // 合成事件/已释放指针时可能抛错
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { // 进入双指手势
      this.drag = null; this.box = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.requestDraw();
      return;
    }
    const scene = this.getScene();
    if (scene.readOnly) return;
    if (this.anim) { this.anim = null; this.draw(); } // 动效中操作：立即跳到终态，不吞输入
    if (this.hitHandle(e.clientX, e.clientY)) {
      this.drag = { kind: 'face', id: [...scene.selection][0] };
      return;
    }
    const s = this.toStage(e.clientX, e.clientY);
    this.hooks.hideUnitMenu?.();
    const hit = this.hitDancer(s.x, s.y);
    if (hit) {
      if (!scene.selection.has(hit)) this.hooks.select([hit], { add: e.shiftKey });
      else if (e.shiftKey) { this.hooks.select([hit], { add: true, toggleOff: true }); return; }
      // 记录拖拽起始快照（避免引用累加）
      const snap = {};
      for (const id of this.getScene().selection) {
        const p = this.getScene().formation?.positions[id];
        if (p) snap[id] = { x: p.x, y: p.y };
      }
      this.pendingDrag = { kind: 'dancer', id: hit, startS: s, start: snap, moved: false, downTime: performance.now() };
    } else if (e.pointerType === 'mouse') {
      const r = this.canvas.getBoundingClientRect();
      this.box = { x0: e.clientX - r.left, y0: e.clientY - r.top, x1: e.clientX - r.left, y1: e.clientY - r.top, startClientX: e.clientX, startClientY: e.clientY };
    } else {
      this.drag = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
    }
  }
  _move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (this.pinch.dist > 8 && d > 0) this.zoomAt(cx, cy, d / this.pinch.dist); // 防零距离产生 Infinity
      this.view.ox += cx - this.pinch.cx; this.view.oy += cy - this.pinch.cy;
      this.pinch = { dist: d, cx, cy };
      this.clampPan();
      this.requestDraw();
      return;
    }
    const scene = this.getScene();
    if (this.longPressTimer && Math.hypot(e.clientX - (this._lpStart?.x ?? e.clientX), e.clientY - (this._lpStart?.y ?? e.clientY)) > 6) {
      clearTimeout(this.longPressTimer); this.longPressTimer = null;
    }
    if (this.lockedByLongPress) return;
    // 待定拖拽转正：位移超阈值才真正开始拖动（避免微动误触）；长按合并单元未动 600ms 弹浮窗
    if (this.pendingDrag && !this.drag) {
      const sNow = this.toStage(e.clientX, e.clientY);
      const movedDist = Math.hypot(sNow.x - this.pendingDrag.startS.x, sNow.y - this.pendingDrag.startS.y);
      if (movedDist > 0.06) {
        this.drag = this.pendingDrag;
        this.pendingDrag = null;
      } else if (performance.now() - this.pendingDrag.downTime >= 600 && !this._longPressFired) {
        this._longPressFired = true;
        const f = scene.formation;
        const partner = (f.merges || []).find(m => m.a === this.pendingDrag.id || m.b === this.pendingDrag.id);
        if (partner) {
          const otherId = partner.a === this.pendingDrag.id ? partner.b : partner.a;
          const a = f.positions[partner.a], b2 = f.positions[partner.b];
          const cvRect = this.canvas.getBoundingClientRect();
          const px2 = cvRect.left + this.view.ox + ((a.x + b2.x) / 2) * this.view.scale;
          const py2 = cvRect.top + this.view.oy + ((a.y + b2.y) / 2) * this.view.scale;
          this.hooks.showUnitMenu({ mode: 'unit', ids: [partner.a, partner.b], style: partner.style, formationIndex: scene.formationIndex, screen: { x: px2, y: py2 } });
          this.pendingDrag = null;
          this.lockedByLongPress = true;
          return;
        }
      }
    }
    const drag = this.drag;
    if (drag?.kind === 'dancer') {
      this._checkMergeHold(drag.id);
      const s = this.toStage(e.clientX, e.clientY);
      let dx = s.x - drag.startS.x, dy = s.y - drag.startS.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 0.02) drag.moved = true;
      const stage = scene.project.stage;
      if (stage.snap) {
        const g = stage.gridM;
        const baseId = Object.keys(drag.start)[0];
        const base = drag.start[baseId];
        if (base) {
          dx = Math.round((base.x + dx) / g) * g - base.x;
          dy = Math.round((base.y + dy) / g) * g - base.y;
        }
      }
      const start = drag.start;
      const bs = stage.backstageM ?? 0;
      this.hooks.mutateLive(p => {
        const f = p.formations[this._formationIndex()];
        for (const [id, s0] of Object.entries(start)) {
          const q = f.positions[id];
          if (q) {
            // 钳制在舞台+后台区范围内，防止拖丢
            q.x = Math.min(stage.widthM + bs, Math.max(-bs, s0.x + dx));
            q.y = Math.min(stage.depthM + bs, Math.max(-bs, s0.y + dy));
          }
        }
      });
      this.requestDraw();
    } else if (drag?.kind === 'face') {
      const s = this.toStage(e.clientX, e.clientY);
      const f = scene.project.formations[this._formationIndex()];
      const p = f.positions[drag.id];
      if (p) {
        const ang = Math.round(((Math.atan2(s.x - p.x, -(s.y - p.y)) * 180 / Math.PI) % 360 + 360) % 360);
        this.hooks.mutateLive(proj => {
          const ff = proj.formations[this._formationIndex()];
          if (ff.positions[drag.id]) ff.positions[drag.id].facing = ang;
        });
        this.requestDraw();
      }
    } else if (drag?.kind === 'pan') {
      this.ensureView();
      this.view.ox += e.clientX - drag.lastX;
      this.view.oy += e.clientY - drag.lastY;
      drag.lastX = e.clientX; drag.lastY = e.clientY;
      this.clampPan();
      this.requestDraw();
    } else if (this.box) {
      const r = this.canvas.getBoundingClientRect();
      this.box.x1 = e.clientX - r.left; this.box.y1 = e.clientY - r.top;
      this.requestDraw();
    }
  }
  _formationIndex() { return this.getScene().formationIndex; }
  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    this._clearMergeHold();
    this.lockedByLongPress = false;
    // 未转正的 pendingDrag：up 时目标与其他舞者重叠 → 弹合并确认（快速拖到重叠松手也触发）
    if (this.pendingDrag && !this.drag) {
      const fmt0 = this.getScene().formation;
      const f = fmt0;
      const draggedId = this.pendingDrag.id;
      const draggedPos = f.positions[draggedId];
      if (draggedPos) {
        let mergeOther = null;
        for (const [id, q] of Object.entries(f.positions)) {
          if (id === draggedId) continue;
          if (Math.hypot(q.x - draggedPos.x, q.y - draggedPos.y) < 0.55) {
            const already = (f.merges || []).some(m => (m.a === draggedId && m.b === id) || (m.a === id && m.b === draggedId));
            if (!already) { mergeOther = id; break; }
          }
        }
        if (mergeOther) {
          this.pendingDrag = null;
          this.lockedByLongPress = true;
          this.hooks.showUnitMenu({ mode: 'merge', ids: [draggedId, mergeOther], formationIndex: this.getScene().formationIndex, screen: { x: e.clientX, y: e.clientY } });
          this.requestDraw();
          return;
        }
      }
    }
    this.pendingDrag = null; // 清残留待定拖拽，防止后续移动鼠标时粘黏光标
    const drag = this.drag;
    const scn = this.getScene();
    if (drag?.kind === 'dancer') {
      const fmt = scn.formation;
      const pos = fmt.positions;
      const draggedId = drag.id;
      const draggedPos = pos[draggedId];
      if (drag.moved) this.hooks.commit('移动舞者');
      // up 时与其他舞者重叠（<0.55m）且尚未合并 → 弹合并确认浮窗
      let mergeOther = null;
      for (const [id, q] of Object.entries(pos)) {
        if (id === draggedId) continue;
        if (Math.hypot(q.x - draggedPos.x, q.y - draggedPos.y) < 0.55) {
          const already = (fmt.merges || []).some(m => (m.a === draggedId && m.b === id) || (m.a === id && m.b === draggedId));
          if (!already) { mergeOther = id; break; }
        }
      }
      if (mergeOther) {
        this.drag = null;
        this.lockedByLongPress = true;
        this.hooks.showUnitMenu({ mode: 'merge', ids: [draggedId, mergeOther], formationIndex: scene.formationIndex, screen: { x: e.clientX, y: e.clientY } });
        this.requestDraw();
        return;
      }
      // 长按（按住 ≥500ms 未移动）且已合并 → 弹单元操作浮窗（拆开/切样式）
      if (!drag.moved && drag.downTime && performance.now() - drag.downTime >= 500) {
        const partner = (fmt.merges || []).find(m => m.a === draggedId || m.b === draggedId);
        if (partner) {
          const otherId = partner.a === draggedId ? partner.b : partner.a;
          const pa = pos[partner.a], pb = pos[partner.b];
          if (pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) <= MERGE_DIST) {
            this.drag = null;
            this.lockedByLongPress = true;
            this.hooks.showUnitMenu({ mode: 'unit', ids: [draggedId, otherId], style: partner.style, formationIndex: scene.formationIndex, screen: { x: e.clientX, y: e.clientY } });
            this.requestDraw();
            return;
          }
        }
      }
    } else if (this.box) {
      const p1 = this.toStage(this.box.startClientX, this.box.startClientY);
      const r = this.canvas.getBoundingClientRect();
      const p2 = this.toStage(this.box.x1 + r.left, this.box.y1 + r.top);
      const x0 = Math.min(p1.x, p2.x), x1 = Math.max(p1.x, p2.x);
      const y0 = Math.min(p1.y, p2.y), y1 = Math.max(p1.y, p2.y);
      const positions = scene.formation?.positions || {};
      const ids = Object.entries(positions)
        .filter(([, p]) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
        .map(([id]) => id);
      const tiny = Math.abs(this.box.x1 - this.box.x0) < 6 && Math.abs(this.box.y1 - this.box.y0) < 6;
      this.hooks.select(tiny ? [] : ids, { add: e.shiftKey });
      this.box = null;
      this.requestDraw();
    }
    this.drag = null;
  }
}
