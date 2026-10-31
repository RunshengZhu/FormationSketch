// 舞台画布：渲染 + 命中测试；手势全部委托 gesture.js 纯状态机（本类是其薄客户端）
import { faceAudience, posAt, easeInOut, lerpAngle, labelTableOf, truncateLabel } from './model.js';
import { createGestureMachine } from './gesture.js';

export const DANCER_R = 0.38; // 舞者圆点半径（米）

// ---------- 显示层垂直镜像（build-62-formations2 F3：观众在上/在下两种显示方式） ----------
// 数据坐标恒按「观众在数据 +y 侧」的底侧约定（genSlots 几何/区域布局同此约定）；
// audience==='top' 时画布渲染整体垂直镜像（y'=depthM−y）——区域标注、后台区、网格、舞者、
// 幽灵/路径全部随镜像；朝向角经 mirrorFacing 随之镜像；指针换算经 canvasYToStage 反向镜像。
// 纯函数（node 可测）：stageYToCanvas/canvasYToStage 为同一对合变换（自逆，往返恒等），
// 播放/插值/导出数据层零变化（只动显示层；drawScene 是视频导出逐帧合成器同一条渲染链）。
export function isViewMirrored(stage) { return stage?.audience === 'top'; }
export function stageYToCanvas(y, stage) { return isViewMirrored(stage) ? stage.depthM - y : y; }
export function canvasYToStage(y, stage) { return isViewMirrored(stage) ? stage.depthM - y : y; }
// 朝向角镜像：镜像 y 轴后方向向量 (sin f, −cos f) → (sin f, +cos f)，即 f' = 180−f
// （0↔180 对翻、90/270 左右向不变；与 shapes.mirrorV 的朝向换算同式）
export function mirrorFacing(f) { return (((180 - (Number(f) || 0)) % 360) + 360) % 360; }

// ---------- grid-granularity：主/次两级网格线 + 细粒度吸附（纯函数，node 可直测） ----------
// 次级线分档取舍（任务书允许 /2 或 /5 自适应，此处固定 /5，理由如下）：
//   1) /5 与 snapToGrid 的 fine 档完全同频——次级线是细吸附点阵的忠实可视化（线画在哪，
//      fine 吸附就落在哪，零认知映射成本）；/2 档与任何吸附档位不对应，画出来是「视觉谎言」。
//   2) 可读性/密度已由双重护栏承担：GRID_MINOR_MIN_PX 阈值（/5 间距不足 12px 宁可不画，
//      而非退而求其次画 /2 造成同一画面两档细分并存的心理模型）+ 次级条数上限（超限整体
//      退化只画主线，纯视觉降级无报错）。
//   3) 若实测反馈「要放大太多倍才出细线」，把 GRID_MINOR_DIV 改 2 即可（一行常量；届时
//      fine 吸附档是否同步改档由产品定——当前 fine=gridM/5 与细线同频是刻意选择）。
export const GRID_MINOR_DIV = 5;         // 次级细分档：gridM/5（与 snapToGrid fine 同档）
export const GRID_MINOR_MIN_PX = 12;     // 次级线最小像素间距——低于此不画（清晰度阈值）
export const GRID_MINOR_MAX_LINES = 400; // 次级线总条数上限（横+竖合计）——超限整体退化
// 粒度快捷档（wave2 接 props 快捷粒度钮用）。build-77-expux：model.js validateProject 与
// main.js STAGE_RANGE 已随本轮放宽到 [0.05,2]——0.05m 档合法入库，不再被校验钳回 0.1。
export const GRID_PRESETS = [
  { label: '0.5m', v: 0.5 },
  { label: '0.25m', v: 0.25 },
  { label: '0.1m', v: 0.1 },
  { label: '0.05m', v: 0.05 },
];
// 两级网格线生成。返回 { major:{x[],y[]}, minor:{x[],y[]} }——米制坐标（绘制层经 X()/Y() 消费，
// 仅消费 view.scale：线距像素 = 步长 × scale，ox/oy 不影响米制坐标）。
// 形态取舍说明：任务书字面 { major:number[], minor:number[] } 的扁平数组无法无损区分横/竖两组
// 线（W=16/H=12/g=0.5 时坐标 10 既是竖线也是横线，同值碰撞），故按轴分子对象；顶层
// major/minor 键与「米制坐标数组」语义保留。主线与 drawScene 既有累加循环同式（同序同 FP
// 序列），次级线按索引生成并按索引跳过 5 倍档位（免疫浮点尘埃）。
export function gridLines(stage, view) {
  const W = Number(stage?.widthM) || 0, H = Number(stage?.depthM) || 0;
  // gridM 缺失/非法回退 0.5（与 drawScene 既有 `|| 0.5` 口径一致）；≤0 防御性回退
  // （model.js clamp 域 [0.1,2] 下不可达，纯函数直测容错）
  const gm = Number(stage?.gridM);
  const g = Number.isFinite(gm) && gm > 0 ? gm : 0.5;
  const scale = Number(view?.scale) || 0;
  const EPS = 1e-9; // 次级线台缘容差（米）：末线与台缘重合时排除（台缘由 2px accent 边框承担）
  const major = { x: [], y: [] }, minor = { x: [], y: [] };
  for (let x = g; x < W; x += g) major.x.push(x);
  for (let y = g; y < H; y += g) major.y.push(y);
  const m = g / GRID_MINOR_DIV;
  if (m > 0 && m * scale >= GRID_MINOR_MIN_PX) {
    for (let i = 1; i * m < W - EPS; i++) if (i % GRID_MINOR_DIV) minor.x.push(i * m);
    for (let i = 1; i * m < H - EPS; i++) if (i % GRID_MINOR_DIV) minor.y.push(i * m);
    // 性能护栏：总条数（横+竖）超限整体退化只画主线（纯视觉降级，无报错）
    if (minor.x.length + minor.y.length > GRID_MINOR_MAX_LINES) {
      minor.x.length = 0; minor.y.length = 0;
    }
  }
  return { major, minor };
}
// 细粒度吸附（gesture.js 属他人文件域不可改——wave2 接线点见任务 notes）。
// fine=false：与 gesture.js computeTargets 现行吸附完全同式（Math.round(v/gs)*gs，行为零变化）；
// fine=true：按 gridM/GRID_MINOR_DIV 取整（与次级细线同频——细线即细吸附点阵）。
// 吸附开关（stage.snap）不在本函数判定：门闩仍由 gesture.js computeTargets 的 `if (stg.snap)`
// 持守——开关关闭时本函数根本不会被调用，行为与现状完全一致。
export function snapToGrid(x, y, stage, { fine = false } = {}) {
  const gm = Number(stage?.gridM);
  const gs = Number.isFinite(gm) && gm > 0 ? gm : 0.5;
  const step = fine ? gs / GRID_MINOR_DIV : gs;
  return { x: Math.round(x / step) * step, y: Math.round(y / step) * step };
}

// ---------- 场景绘制（舞台视图/缩略图/PNG/打印共用） ----------
export function stageBounds(stage) {
  const b = stage.backstageM ?? 0;
  // build-62 F3：左右候场区（wingM）超出后台条带时纳入包络（缺省 wing 1 ≤ 后台 1，包络不变）
  const wx = Math.max(b, stage.wingM ?? 0);
  return { x0: -wx, y0: -b, x1: stage.widthM + wx, y1: stage.depthM + b };
}
// ---------- build-63-stageview2 F3：全域舞者视野包络（纯函数，node 可测） ----------
// 舞者可自由驻留任意区域（舞台/后台/侧翼/观众区）——视野包络 = stageBounds ∪ 舞者位置外扩 pad 米。
// 无舞者/无有效坐标 → null（union 恒等回 stageBounds，行为与旧版完全一致）。
export function dancerEnvelope(positions, pad = 0.5) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
  for (const p of Object.values(positions || {})) {
    const x = Number(p?.x), y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    any = true;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!any) return null;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}
export function unionBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
export function fitView(canvasW, canvasH, stage, pad = 14, positions = null) {
  // build-63-stageview2 F3：包络 = stageBounds ∪ dancerEnvelope(positions, 0.5)——舞者在观众区/
  // 后台深处时视野自动包含不裁切；视频导出合成器同链传 positions（导出画面同口径）
  const b = unionBounds(stageBounds(stage), dancerEnvelope(positions));
  const raw = Math.min((canvasW - pad * 2) / (b.x1 - b.x0), (canvasH - pad * 2) / (b.y1 - b.y0));
  // DEFECT-M-1（round23 音乐 E2E 实测发现）：画布隐藏（rect 0×0，如 boot 竞态下编辑器尚未
  // 显示）时 raw≤0 → 负 scale 一路传进 ctx.arc 抛 IndexSizeError（pageerror 一票否决面）。
  // 非有限/非正的 scale 一律回退到保守正值（0 尺寸画布绘制本就是无害 no-op）。
  const scale = Number.isFinite(raw) && raw > 0 ? raw : 10;
  const ox = (canvasW - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale;
  const oy = (canvasH - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale;
  return { scale, ox, oy };
}
export function drawScene(ctx, rect, project, positions, opts = {}) {
  const { widthM: W, depthM: H } = project.stage;
  const MERGE_DIST = 0.8; // 配对舞者接近此间距内合为徽标
  const theme = opts.theme || (typeof document !== 'undefined' && document.documentElement.dataset.theme) || 'dark';
  const dark = theme !== 'light';
  const view = opts.view || fitView(rect.w, rect.h, project.stage, opts.pad ?? 14, positions);
  const s = view.scale, ox = view.ox + rect.x, oy = view.oy + rect.y;
  const r = DANCER_R * s;
  // build-62 F3：显示镜像——Y() 经 stageYToCanvas（audience='top' 时 y'=depthM−y），
  // 全部场景元素（网格/区域/舞者/幽灵/路径/区域标注）统一走 Y()；观众方位标注（罗盘性质，
  // 标示当前显示方向的观众侧）走 Yraw 直排画面，不随镜像二次翻转
  const mirrored = isViewMirrored(project.stage);
  const X = x => ox + x * s, Y = y => oy + stageYToCanvas(y, project.stage) * s, Yraw = y => oy + y * s;
  const bs = project.stage.backstageM ?? 0;
  const wing = project.stage.wingM ?? 0;
  const audience = project.stage.audience;

  // 背景
  ctx.fillStyle = opts.bg || '#f8fafc';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // ---------- build-63-stageview2 F1/F2：区域重设计 ----------
  //   瘦身统一：后台/侧翼/观众带只铺「暗一档」低对比底色（原 slate 大面积底+浓斜纹退役），
  //   不再呈大面积区域感；侧翼不标字，后台条带居中小字「后台」（「上/下场」门旧称退役）。
  //   界限强化：主舞台 2px accent 实线边框 + 四角 L 形角标——舞台亮、四周暗，一眼可辨。
  //   镜像修复：fillRect 不再以镜像 Y() 直接作矩形上缘（audience='top' 时 Y() 反向，
  //   底色整体错位一个舞台高度——build-62 遗留缺陷，本次以 min(Y(y0),Y(y0+h)) 归一修复）。
  const yTop = (y0, hM) => Math.min(Y(y0), Y(y0 + hM)); // 镜像稳健的矩形画布上缘
  // 周边带（后台+侧翼+观众环带）暗一档底色；舞台台面恒白（亮）
  if (bs > 0 && !opts.minimal) {
    ctx.fillStyle = '#eef2f7';
    ctx.fillRect(X(-bs), yTop(-bs, H + 2 * bs), (W + 2 * bs) * s, (H + 2 * bs) * s);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(X(0), yTop(0, H), W * s, H * s);

  if (!opts.minimal) {
    const zoneFont = Math.max(10, s * 0.45);
    const zoneColor = '#94a3b8';
    // 竖排标签（逐字堆叠）
    const vLabel = (text, px, py) => {
      ctx.save();
      ctx.fillStyle = zoneColor; ctx.font = `600 ${zoneFont}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lh = Math.max(12, s * 0.58);
      const chars = [...String(text)];
      const y0 = py - (chars.length - 1) * lh / 2;
      chars.forEach((ch, i) => ctx.fillText(ch, px, y0 + i * lh));
      ctx.restore();
    };
    const hLabel = (text, px, py) => {
      ctx.save();
      ctx.fillStyle = zoneColor; ctx.font = `600 ${zoneFont}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, px, py);
      ctx.restore();
    };
    // 斜纹填充（45° 细线，裁剪在条带内；build-63 F1 降弱——build-62 浓斜纹退役）
    const hatch = (x0, y0, w, h) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(100,116,139,.14)'; ctx.lineWidth = 1;
      ctx.beginPath();
      const step = Math.max(6, s * 0.55);
      for (let d = -h; d < w; d += step) {
        ctx.moveTo(x0 + d, y0 + h);
        ctx.lineTo(x0 + d + h, y0);
      }
      ctx.stroke();
      ctx.restore();
    };
    // 左右候场区（侧翼，build-64 F1/F2）：扩大留白 + 两侧各标「后台」竖排小字——
    // 侧翼=后台的延伸（舞者候场/上下场通道），与后台条带同一概念统一标记
    if (wing > 0) {
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? -wing : W;
        ctx.fillStyle = 'rgba(148,163,184,.10)';
        ctx.fillRect(X(x0), yTop(0, H), wing * s, H * s);
        hatch(X(x0), yTop(0, H), wing * s, H * s);
        vLabel('后台', X(x0 + wing / 2), Y(H / 2));
      }
    }
    // 后台条带：淡 tint + 居中小字「后台」（标签统一，build-63 F1）
    if (bs > 0) {
      const chRect = audience === 'left' ? { x: W, y: -bs, w: bs, h: H + 2 * bs }
        : audience === 'right' ? { x: -bs, y: -bs, w: bs, h: H + 2 * bs }
        : { x: -bs, y: -bs, w: W + 2 * bs, h: bs }; // bottom/top：数据 y<0 条带（top 经镜像呈示在画面下方）
      ctx.fillStyle = 'rgba(148,163,184,.10)';
      ctx.fillRect(X(chRect.x), yTop(chRect.y, chRect.h), chRect.w * s, chRect.h * s);
      // build-64 F3：后台条带=专属「后台通道」标记（横排场地横排字、竖排场地竖排字，字号加大一档）
      if (audience === 'left' || audience === 'right') {
        ctx.save();
        ctx.fillStyle = '#64748b'; ctx.font = `700 ${zoneFont}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('后台通道', X(chRect.x + chRect.w / 2), Y(H / 2));
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = '#64748b'; ctx.font = `700 ${zoneFont}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('后台通道', X(W / 2), Y(-bs / 2));
        ctx.restore();
      }
    }
    // 观众标记（build-64 F1 观点回归）：观众是核心方位标记——居中显著呈示在观众条带
    // （罗盘性质走 Yraw 直排画面，不随镜像二次翻转——沿用 build-62 语义）
    ctx.save();
    ctx.fillStyle = zoneColor;
    ctx.font = `700 ${Math.max(12, s * 0.5)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (audience === 'left') ctx.fillText('观 众', X(-bs * 0.5), Yraw(H / 2));
    else if (audience === 'right') ctx.fillText('观 众', X(W + bs * 0.5), Yraw(H / 2));
    else if (audience === 'top') ctx.fillText('观 众', X(W / 2), Yraw(-bs * 0.5));
    else ctx.fillText('观 众', X(W / 2), Yraw(H + bs * 0.5));
    ctx.restore();
  }

  // 背景图（DEFECT-R37-4：原绘制在后台区/舞台白底之前，整幅被白底覆盖——画布永远看不到衬底。
  // 移到台面/后台底色之后、网格之前：50% alpha 衬底只在舞台区域内可见，网格/舞者照常叠于其上。）
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

  // 网格（grid-granularity：主/次两级线。主线=既有 gridM 网格线，样式与台面内域口径不变
  // （stageview2 F2 静态断言钉住其原文）；视口足够大时叠加 gridM/5 次级细线——生成/阈值/
  // 条数护栏收口在纯函数 gridLines（node 可直测），此处消费其次级坐标。次级线透明度内联：
  // 现有主线色本就不分主题（台面恒白，slate 系两主题通用），次级取同族更淡一档，不改 css。
  // 次级先行铺底、主线后画覆盖其上。）
  const g = opts.showGrid === false ? 0 : (project.stage.gridM || 0.5);
  if (!opts.minimal && g > 0) {
    const gl = gridLines(project.stage, view);
    ctx.save();
    if (gl.minor.x.length || gl.minor.y.length) {
      ctx.strokeStyle = 'rgba(148,163,184,.12)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of gl.minor.x) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(H)); }
      for (const y of gl.minor.y) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(W), Y(y)); }
      ctx.stroke();
    }
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

  // ---------- build-63-stageview2 F2：舞台实线边框 + 四角角标（观众角部小字已前移至区域块） ----------
  {
    const acc = dark ? '#38bdf8' : '#0284c7';
    const bx = X(0), by = yTop(0, H), bw = W * s, bh = H * s;
    ctx.save();
    ctx.strokeStyle = acc; ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    // 四角 L 形短角标（外扩 3px，长度随缩放 clamp 6..14px）
    const ck = Math.max(6, Math.min(14, s * 0.5)), o = 3;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx - o, by - o + ck); ctx.lineTo(bx - o, by - o); ctx.lineTo(bx - o + ck, by - o); // 左上
    ctx.moveTo(bx + bw + o - ck, by - o); ctx.lineTo(bx + bw + o, by - o); ctx.lineTo(bx + bw + o, by - o + ck); // 右上
    ctx.moveTo(bx + bw + o, by + bh + o - ck); ctx.lineTo(bx + bw + o, by + bh + o); ctx.lineTo(bx + bw + o - ck, by + bh + o); // 右下
    ctx.moveTo(bx - o + ck, by + bh + o); ctx.lineTo(bx - o, by + bh + o); ctx.lineTo(bx - o, by + bh + o - ck); // 左下
    ctx.stroke();
    ctx.restore();
  }

  // Ghost（上一/下一队形）：合并单元接近=圆角矩形虚影，分离/独立舞者=圆虚影
  if (opts.ghost) {
    function ghostBadge(cx, cy, w, hh, bothPresent) {
      ctx.save(); ctx.globalAlpha = 0.32;
      ctx.setLineDash([4, 4]);
      rrPath(cx - w / 2, cy - hh / 2, w, hh, hh * 0.45);
      if (bothPresent) { ctx.fillStyle = 'rgba(71,85,105,.12)'; ctx.fill(); }
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    };
    function ghostCircle(px, py) {
      ctx.save(); ctx.globalAlpha = 0.32;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(px, py, DANCER_R * s, 0, Math.PI * 2);
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    };
    for (const gp of opts.ghost) {
      const gmerged = new Set((gp.merges || []).flatMap(m => [m.a, m.b]));
      for (const m of gp.merges || []) {
        const a = gp.positions[m.a], b = gp.positions[m.b];
        if (!a || !b) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) <= MERGE_DIST) {
          ghostBadge((X(a.x) + X(b.x)) / 2, (Y(a.y) + Y(b.y)) / 2, r * 3.4, r * 1.5, true);
        } else {
          ghostCircle(X(a.x), Y(a.y));
          ghostCircle(X(b.x), Y(b.y));
        }
      }
      for (const [id, p2] of Object.entries(gp.positions)) {
        if (gmerged.has(id)) continue;
        if (!positions[id]) continue;
        ghostCircle(X(p2.x), Y(p2.y));
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

  // 舞者与合并单元渲染：
  //   合并单元两人位置接近（≤0.8m）时合为单元符号（capsule 徽标 / single 单编号圆）；
  //   分开超过阈值时呈示为两个独立圆 + 虚线绑定（拖动编辑互不影响）。
  const dancerById = id => project.dancers.find(x => x.id === id);
  const inSel = id => opts.selection?.has(id);
  // 舞者标签（round23 需求 2 + build-74-labelname）：labelTableOf 按每舞者有效模式
  //（舞者级覆盖 > 项目级 settings.labelMode）解析文本，重合文本自带 1..n 角标去重。
  const ordinalOf = new Map(project.dancers.map((d, i) => [d.id, i + 1]));
  const labelTable = labelTableOf(project);
  const labelEntryOf = id => labelTable.get(id) || null;
  // 标签落笔（三处共用：单人圆/单编号圆/胶囊双标）：主文本居中；idx>0 时右上角小号上标
  // 画角标，主文本左移让位（角标只占右侧半字宽，不挤占主文本可读空间）。
  function drawLabelText(id, cx, cy, fontPx) {
    const e = labelEntryOf(id);
    const text = e ? truncateLabel(e.text) : '?';
    const base = `700 ${Math.max(8, fontPx)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (e?.idx > 0) {
      ctx.font = base;
      const tw = ctx.measureText(text).width;
      const idxFont = `700 ${Math.max(6, fontPx * 0.55)}px sans-serif`;
      ctx.font = idxFont;
      const istr = String(e.idx), iw = ctx.measureText(istr).width;
      ctx.fillText(istr, cx + tw * 0.5, cy - fontPx * 0.52);
      ctx.font = base;
      ctx.fillText(text, cx - iw * 0.45, cy + fontPx * 0.05);
    } else {
      ctx.font = base;
      ctx.fillText(text, cx, cy + fontPx * 0.05);
    }
  };
  function drawOne(id, p, px, py, rr, sel) {
    const d = dancerById(id); if (!d) return;
    // 朝向指示（圆内指针）：显示镜像时朝向角经 mirrorFacing 随之镜像（指针仍指向画面上
    // 与数据语义一致的方向——面向数据观众的舞者，镜像后仍面向画面上的观众侧）
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((mirrored ? mirrorFacing(p.facing || 0) : (p.facing || 0)) * Math.PI / 180);
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
    drawLabelText(id, px, py, rr * 0.95);
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
  // 合并单元符号：capsule=圆角矩形（左右各色+编号）/ single=单编号圆+虚线外环
  function drawUnitSymbol(style, idA, idB, a, b, sel, alpha) {
    const cx = (X(a.x) + X(b.x)) / 2, cy = (Y(a.y) + Y(b.y)) / 2;
    const dA = dancerById(idA), dB = dancerById(idB);
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (style === 'single') {
      // 单编号：只画一个与单舞者同尺寸的圆（编号取成员中序号较小者，随 labelMode 呈示）；
      // 叠加虚线外环（主题强调色）——虚线环已足够区分于单人，×2 角标已移除
      const acc = dark ? '#38bdf8' : '#0284c7';
      const ord = v => ordinalOf.get(v?.id) ?? Number.MAX_SAFE_INTEGER;
      const dd = [dA, dB].filter(Boolean).sort((x, y) => ord(x) - ord(y) || String(x.short).localeCompare(String(y.short)))[0] || dA;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = dd?.color || '#64748b'; ctx.fill();
      ctx.lineWidth = sel ? Math.max(2.5, s * 0.09) : Math.max(1, s * 0.04);
      ctx.strokeStyle = sel ? '#0ea5e9' : 'rgba(15,23,42,.55)'; ctx.stroke();
      ctx.fillStyle = '#fff';
      drawLabelText(dd ? dd.id : '', cx, cy, r * 0.95);
      // 虚线外环（与内圆留出间隙）
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = Math.max(1.2, s * 0.05);
      ctx.strokeStyle = acc; ctx.stroke();
      ctx.setLineDash([]);
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
      drawLabelText(idA, cx - w * 0.25, cy, hh * 0.62);
      drawLabelText(idB, cx + w * 0.25, cy, hh * 0.62);
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
    this.box = null;
    this.boxOrigin = null; // 长按框选起点标记（触摸/笔；桌面鼠标框选为 null）
    this._spaceHeld = false;   // 空格（平移修饰键）按住状态，由 main.js 键盘接线驱动
    this._spaceGesture = false; // 本次按住空格期间是否发生过指针手势
    this.gesture = createGestureMachine(this._makeGestureHost());
    this._bind();
    this._ro = new ResizeObserver(() => this.requestDraw());
    this._ro.observe(canvas.parentElement);
  }

  // ---- 坐标换算 ----
  toStage(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.view;
    // build-62 F3：y 经 canvasYToStage 反向镜像（与 drawScene 的 stageYToCanvas 同一纯函数，
    // 禁止两处手写）——观众在上时画布下方像素 = 数据 y 小侧，点谁是谁
    const stage = this.getScene?.()?.project?.stage;
    return { x: (px - rect.left - v.ox) / v.scale, y: canvasYToStage((py - rect.top - v.oy) / v.scale, stage) };
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
    // build-63-stageview2 F3：fit 包络含舞者位置（舞者在观众区/后台深处时初始视野自动包含，
    // 缩放下限同链放宽——无人越界时与 stageBounds 口径完全一致）
    const fit = fitView(W, H, scene.project.stage, 16, scene.playbackPos || scene.formation?.positions || null);
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
    // E2E 信号：状态驱动重绘公共出口 +1（切帧动效逐帧直调 draw() 不计；Node 导入无 window 跳过）
    if (typeof window !== 'undefined' && window.__fs) window.__fs.renderSeq++;
  }

  // ---- 切帧动效（纯舞台 UI 动画：不经过播放引擎、不动播放头/时间线） ----
  startPositionsPreview(fromFormation, toFormation, durationMs = 700) {
    if (!fromFormation || !toFormation) return;
    this.anim = {
      from: fromFormation.positions, to: toFormation.positions,
      t0: performance.now(), dur: Math.max(200, durationMs),
    };
    this.gesture?.reset(); // 动效打断进行中的手势
    this.box = null;
    this.boxOrigin = null;
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
    // build-63-stageview2 F3：平移软钳制同样走 ∪ 舞者包络——观众区舞者不会被钳出可视域
    const b = unionBounds(stageBounds(scene.project.stage), dancerEnvelope(scene.playbackPos || scene.formation?.positions || null));
    const s = this.view.scale, W = rect.width, H = rect.height, m = 80;
    this.view.ox = Math.min(W - m - b.x0 * s, Math.max(m - b.x1 * s, this.view.ox));
    this.view.oy = Math.min(H - m - b.y0 * s, Math.max(m - b.y1 * s, this.view.oy));
  }

  draw() {
    const scene = this.getScene();
    if (!scene?.project) return;
    // DEFECT-M-1 同源守卫：画布隐藏（rect 0×0，如 boot 中编辑器尚未显示）时不绘制，
    // 防止把 fitView 的兜底 scale 写进 this.view 污染首次可见绘制
    const probeRect = this.canvas.getBoundingClientRect();
    if (probeRect.width < 1 || probeRect.height < 1) return;
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
      // FIX-R39-2（round39 P6 开关族 E2E 实测发现）：drawScene 的路径绘制以 opts.paths 为门闩
      //（`if (opts.paths && opts.nextPositions)`），本处此前漏传 → 「路径」按钮/样式页复选在
      // 交互舞台上零视觉效果（虚线永不存在）。nextPositions 本就由 scene.showPaths 门控，
      // 这里如实回传 paths 开关即可。
      paths: !!nextPositions,
      merges: scene.merges || [],
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
      // 长按框选起点标记：小圆点+细虚线环（触摸/笔长按触发的轻量反馈；零尺寸矩形阶段的可见主体）
      if (this.boxOrigin) {
        ctx.save();
        ctx.fillStyle = 'rgba(56,189,248,.95)';
        ctx.strokeStyle = 'rgba(56,189,248,.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(this.boxOrigin.x, this.boxOrigin.y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(this.boxOrigin.x, this.boxOrigin.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    // 朝向把手（恰好选中一名舞者且非播放）
    this.handlePx = null;
    if (scene.facingHandle && scene.singleSelected && scene.selection?.size >= 1 && !scene.playbackPos && !scene.readOnly) {
      const id = [...scene.selection][0];
      const p = positions[id];
      if (p) {
        // 把手锚在「数据空间中舞者前方 0.9m」的点再经 Y() 映射——镜像显示时自动与
        // drawOne 的镜像朝向指针一致（同一方向量的两种算法，禁两处手写角度换算）
        const v = this.view;
        const rect = this.canvas.getBoundingClientRect();
        const fr = (p.facing || 0) * Math.PI / 180;
        const hx = v.ox + (p.x + Math.sin(fr) * 0.9) * v.scale;
        const hy = v.oy + stageYToCanvas(p.y - Math.cos(fr) * 0.9, project.stage) * v.scale;
        this.handlePx = { x: hx + rect.left, y: hy + rect.top, px: hx, py: hy };
        ctx.save();
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(v.ox + p.x * v.scale, v.oy + stageYToCanvas(p.y, project.stage) * v.scale);
        ctx.lineTo(hx, hy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8'; ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---- 命中 ----
  // 始终按单个舞者命中（返回被点中的那一个 id）；合并单元的原子展开（整单元选择/拖拽）
  // 由 gesture.js 状态机基于 merges 完成
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

  // ---- 手势：委托 gesture.js 纯状态机；本类只做坐标换算、命令执行与渲染 ----
  _makeGestureHost() {
    return {
      // 查询
      readOnly: () => !!this.getScene().readOnly,
      hitHandle: (px, py) => this.hitHandle(px, py),
      hitDancer: (x, y) => this.hitDancer(x, y),
      toStage: (px, py) => this.toStage(px, py),
      selection: () => [...(this.getScene().selection || [])],
      multiSelect: () => !!this.getScene().multiSelect,
      formation: () => this.getScene().formation,
      fmtIndex: () => this.getScene().formationIndex,
      now: () => performance.now(),
      stage: () => this.getScene().project.stage,
      // build-77-expux（W2 接线清单 #5）：吸附几何查询/细粒度偏好——gesture.js computeTargets
      // 经 host.snap 消费 snapToGrid（粗/细档），避免 stage.js↔gesture.js 循环 import；
      // fineSnap=UI 级偏好（main.js scene.fineSnap 透传，wuzhen:fineSnap，默认关）
      fineSnap: () => !!this.getScene().fineSnap,
      snap: (x, y, fine) => snapToGrid(x, y, this.getScene().project.stage, { fine }),
      // 命令
      select: (ids, opts) => this.hooks.select(ids, opts || {}),
      applyPositions: map => this.hooks.mutateLive(p => {
        const f = p.formations[this.getScene().formationIndex];
        for (const [id, v] of Object.entries(map)) {
          const q = f.positions[id];
          if (q) Object.assign(q, v);
        }
      }),
      rollback: map => this.hooks.mutateLive(p => {
        const f = p.formations[this.getScene().formationIndex];
        for (const [id, v] of Object.entries(map)) {
          const q = f.positions[id];
          if (q) { q.x = v.x; q.y = v.y; }
        }
      }),
      commit: label => this.hooks.commit(label),
      showMenu: payload => {
        // .unit-menu 是 #stage-wrap 内的 absolute 定位：必须给容器相对坐标（客户坐标会双重偏移）
        const rect = this.canvas.getBoundingClientRect();
        const wrap = this.canvas.parentElement?.getBoundingClientRect();
        const dx = wrap ? rect.left - wrap.left : 0, dy = wrap ? rect.top - wrap.top : 0;
        const v = this.view;
        const at = payload.at || { x: 0, y: 0 };
        // build-62 F3：屏幕 y 经 stageYToCanvas（at 为数据坐标，显示镜像时同步翻转）
        const st = this.getScene?.()?.project?.stage;
        this.hooks.showUnitMenu({ ...payload, screen: { x: dx + v.ox + at.x * v.scale, y: dy + v.oy + stageYToCanvas(at.y, st) * v.scale } });
      },
      hideMenu: () => this.hooks.hideUnitMenu?.(),
      box: (rect, opts = {}) => {
        if (!rect) { this.box = null; this.boxOrigin = null; this.requestDraw(); return; }
        const r = this.canvas.getBoundingClientRect(); // client px → 画布内像素（渲染用）
        this.box = { x0: rect.x0 - r.left, y0: rect.y0 - r.top, x1: rect.x1 - r.left, y1: rect.y1 - r.top };
        // 长按框选（触摸/笔）起点反馈：opts.origin=在锚点画低调标记（桌面鼠标框选不画，视觉不变）
        this.boxOrigin = opts.origin ? { x: rect.x0 - r.left, y: rect.y0 - r.top } : null;
        this.requestDraw();
      },
      panBy: (dx, dy) => {
        this.ensureView();
        this.view.ox += dx; this.view.oy += dy;
        this.clampPan();
        this.requestDraw();
      },
      zoomAt: (cx, cy, f) => this.zoomAt(cx, cy, f),
      requestDraw: () => this.requestDraw(),
    };
  }

  _bind() {
    const cv = this.canvas;
    // 事件翻译：button=按下键位（1=中键）、space=空格按住状态（main.js 键盘接线跟踪，
    // 经事件对象传给手势机——手势机保持纯函数、不读 DOM）；alt=Alt/Option 按住
    //（build-77-expux：拖动细粒度吸附临时取反，gesture.js computeTargets 消费）
    const ev = e => ({ pointerId: e.pointerId, px: e.clientX, py: e.clientY, shift: e.shiftKey, touch: e.pointerType !== 'mouse', button: e.button, space: this._spaceHeld, alt: e.altKey });
    cv.addEventListener('pointerdown', e => {
      if (e.button === 1) e.preventDefault(); // 中键按下：防浏览器自动滚动
      if (this._spaceHeld) this._spaceGesture = true; // 本次按住空格期间发生了指针手势
      try { cv.setPointerCapture(e.pointerId); } catch {} // 合成事件/已释放指针时可能抛错
      this.gesture.down(ev(e));
    });
    cv.addEventListener('pointermove', e => this.gesture.move(ev(e)));
    cv.addEventListener('pointerup', e => this.gesture.up(ev(e)));
    cv.addEventListener('pointercancel', () => this.gesture.cancel());
    // 右键上下文菜单：拦掉浏览器默认菜单；命中舞者且手势机 IDLE 时弹出
    // （合并=单元菜单/未合并=删除菜单，与触摸长按共用同一浮窗与关闭路径）
    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.gesture.contextMenu({ px: e.clientX, py: e.clientY });
    });
    // 中键的兼容鼠标事件默认行为（自动滚动）同样拦掉
    cv.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    cv.addEventListener('wheel', e => {
      // F-07（UX-07）：一律 preventDefault（阻断触控板双指横滑触发的历史导航）。
      // 横向主导（触控板双指横滑；Shift+滚轮在 Chrome 换轴后也以 deltaX 到达）=舞台水平平移；
      // 纵向/捏合（ctrl+wheel）维持缩放语义不变。
      e.preventDefault();
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.panView(-e.deltaX, 0);
        return;
      }
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });
  }
  // 平移（像素）：wheel 横滑等桌面输入通道用（触摸/指针手势经手势机 host.panBy 走同一钳制）
  panView(dx, dy) {
    this.ensureView();
    this.view.ox += dx; this.view.oy += dy;
    this.clampPan();
    this.requestDraw();
  }
  // ---- 空格平移修饰键（main.js 驱动）----
  get spaceHeld() { return this._spaceHeld; }
  setSpaceHeld(on) {
    const was = this._spaceHeld;
    this._spaceHeld = !!on;
    if (this._spaceHeld && !was) this._spaceGesture = false; // 新一次按住：重置"已参与手势"标记
    if (!this._spaceHeld && was) { const used = this._spaceGesture; this._spaceGesture = false; return used; }
    return false; // 松开时返回按住期间是否参与过指针手势（供上层决定是否触发原空格快捷键）
  }
  gestureCancel() { return this.gesture.cancel(); }
  gestureMenuClosed() { this.gesture.reset(); } // 浮窗经由自身按钮/上层关闭时同步解锁
}
