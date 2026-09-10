// 时间线：编辑模式队形条（缩略图+拖拽排序） / 音乐模式波形时间线（块拖拽、节拍吸附、播放头）
import { drawScene } from './stage.js';
import { computeSegments, spb, beatToSec, secToBeat, beatLabel } from './model.js';

// ---------- 编辑模式：队形条 ----------
export class EditStrip {
  constructor(container, hooks) {
    this.el = container;
    this.hooks = hooks; // {select(i), add(), duplicate(), delete(), move(from,to), getProject(), getIndex(), names()}
    this._key = '';
    this._thumbTimer = null;
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
      cv.width = 120; cv.height = 68;
      const nm = document.createElement('div');
      nm.className = 'es-name';
      nm.textContent = `${i + 1}. ${f.name}`;
      nm.title = f.name;
      chip.append(cv, nm);
      chip.addEventListener('click', () => this.hooks.select(i));
      chip.addEventListener('dragstart', e => { this._dragFrom = i; e.dataTransfer.effectAllowed = 'move'; });
      chip.addEventListener('dragover', e => { e.preventDefault(); });
      chip.addEventListener('drop', e => { e.preventDefault(); if (this._dragFrom != null && this._dragFrom !== i) this.hooks.move(this._dragFrom, i); this._dragFrom = null; });
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
    [...this.el.querySelectorAll('.es-chip')].forEach((chip, i) => {
      const f = p.formations[i];
      const cv = chip.querySelector('canvas');
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== 120 * dpr) { cv.width = 120 * dpr; cv.height = 68 * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (f) drawScene(ctx, { x: 0, y: 0, w: 120, h: 68 }, p, f.positions, { minimal: true, pad: 4, pairLines: false });
    });
  }
}

// ---------- 音乐模式：波形时间线 ----------
export class MusicTimeline {
  constructor({ canvas, overlay, scroll, hooks }) {
    this.cv = canvas; this.ov = overlay; this.scroll = scroll;
    this.hooks = hooks; // {getProject(), getPlayer(), onSelectFormation(i), mutate(fn,label), seekBeat(b), audio}
    this.secPerPx = 0;  // 0 = 自适应
    this.drag = null;
    this._bind();
  }
  pxPerSec() { return this.secPerPx ? 1 / this.secPerPx : 0; }
  layoutWidth(p) {
    const { totalBeats } = computeSegments(p);
    const totalSec = beatToSec(p, totalBeats) || 10;
    const w0 = this.scroll.clientWidth || 600;
    return Math.max(w0, this.secPerPx ? totalSec / this.secPerPx : totalSec * Math.max(8, w0 / Math.max(totalSec, 30)));
  }
  render() {
    const p = this.hooks.getProject();
    if (!p) return;
    const dpr = window.devicePixelRatio || 1;
    const h = this.scroll.clientHeight || 120;
    const W = this.layoutWidth(p);
    for (const c of [this.cv, this.ov]) {
      c.width = Math.round(W * dpr); c.height = Math.round(h * dpr);
      c.style.width = W + 'px'; c.style.height = h + 'px';
    }
    this.W = W; this.H = h;
    const ctx = this.cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, h);
    this.drawRuler(ctx, p, h);
    this.drawWave(ctx, p, h);
    this.drawBlocks(ctx, p, h);
    this.drawPlayhead();
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
  drawWave(ctx, p, h) {
    const audio = this.hooks.audio;
    const pps = this.ppsOf(p);
    if (!audio?.peaks) {
      if (audio?.ready) { // 无波形：画时长条
        ctx.save();
        ctx.fillStyle = 'rgba(56,189,248,.15)';
        ctx.fillRect(0, this.rulerH, (audio.duration || 0) * pps, h - this.rulerH);
        ctx.restore();
      }
      return;
    }
    const peaks = audio.peaks;
    const mid = this.rulerH + (h - this.rulerH) * 0.42;
    const amp = (h - this.rulerH) * 0.34;
    ctx.save();
    ctx.fillStyle = 'rgba(56,189,248,.5)';
    const step = Math.max(1, Math.floor(this.W / 2000)); // 大宽度下抽稀绘制
    for (let x = 0; x < this.W; x += step) {
      const sec = x / pps;
      const i = Math.floor(sec / (audio.duration || 1) * peaks.length);
      const v = peaks[Math.max(0, Math.min(peaks.length - 1, i))] || 0;
      ctx.fillRect(x, mid - v * amp, step, Math.max(1, v * amp * 2));
    }
    ctx.restore();
  }
  drawBlocks(ctx, p, h) {
    const { segments } = computeSegments(p);
    const pps = this.ppsOf(p);
    const spbV = spb(p);
    const top = h - 44, bh = 36;
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
    window.addEventListener('pointerup', e => this._up(e), { passive: true });
    this.scroll.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
      }
    }, { passive: false });
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
    const r = this.cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const edges = this.edgeHits(x);
    if (edges.length && y > this.rulerH) {
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      this.drag = { ...edges[0], startX: x };
      return;
    }
    if (y <= this.rulerH) {
      // 尺规：点击/拖动定位
      try { this.cv.setPointerCapture(e.pointerId); } catch {}
      this.drag = { kind: 'scrub' };
      this.hooks.seekBeat(this.xToBeat(x));
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
  _move(e) {
    const drag = this.drag;
    if (!drag) {
      // 悬停反馈：边缘光标 + 块高亮
      const r = this.cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const edges = this.edgeHits(x);
      this.cv.style.cursor = edges.length ? 'ew-resize' : 'default';
      let hoverSeg = null;
      for (const hit of edges) hoverSeg = hit.seg.i;
      if (hoverSeg === null && y >= (this.blocksTop ?? 0) && y <= (this.blocksTop ?? 0) + (this.blocksH ?? 0)) {
        const p = this.hooks.getProject();
        if (p) {
          const beat = this.xToBeat(x);
          for (const s of computeSegments(p).segments) {
            if (beat >= s.holdStart && beat < s.travelEnd) { hoverSeg = s.i; break; }
          }
        }
      }
      if (this.hoverSeg !== hoverSeg) { this.hoverSeg = hoverSeg; this.render(); }
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
    if (this.drag && (this.drag.kind === 'hold' || this.drag.kind === 'travel')) {
      this.hooks.commitEdit?.('调整时长');
    }
    this.drag = null;
  }
}
