// 说明书截图标注自适应尺寸（build-73-syncui F3）——纯函数模块，node 可测，不入应用打包
//（build-single ORDER 不含本文件；唯一消费方是 lab/manual-shots-v5.mjs 拍摄脚本）。
//
// v4 缺陷根因：标注尺寸按 DPR 固定放大（fontSize×2、框宽/箭头 ×2）——2x 图按原显示宽度呈现
// 时标注与 UI 同大尚可，但「最终图上占比」随镜头采样率漂移：降采样全景镜头标注视觉占比翻倍、
// 遮挡有效说明区域；原生直拍小镜头箭头 18px 长于标签到框的距离，只见大箭头。
//
// v5 公式：一切尺寸以「最终图上像素」为基准，随镜头有效采样率 effScale（= DPR × 降采样系数，
// 1 CSS px 对应的最终图像素数）与目标宽 targetW（最终图宽）自适应：
//   fontImg = clamp(12, min(15×effScale, 0.05×targetW), 30)
//     · 15×effScale ≈ 1.25× UI 基准字（12px CSS）同刻度——标注永远只比被拍 UI 文字大一号，
//       不随 DPR 恒定放大（v4 根因修复）；
//     · 0.05×targetW 宽度兜底——极窄镜头（索引 pane ~279px 等）标注不挤满宽度；
//     · [12,30] 图上像素硬界——任何镜头字号都不至于不可读或成横幅。
//   css 值 = 图上值 ÷ effScale（注入页面绘制）。
// 箭头双模（v4「只见大箭头」修复）：标签缺省紧邻框（padNear，无箭头）；仅 arrow:true 的标注
// 以 padArrow 间距排布并画箭头，箭头长 = min(fontImg×0.6, 9css px)，间距不足 2×箭头长自动
// 退化为无箭头标签。
// 验收口径（F3）：标注框+标签总占图面积 ≤ 1/3（annotCoverageRatio）。

// 单镜头标注尺寸集：图上像素（*Img）+ 换算好的 CSS 像素（css*，注入页面直接用）。
// targetW：最终图宽 px；effScale：最终图上每 CSS px 的像素数。
export function annotSizing({ targetW, effScale = 1 } = {}) {
  const tw = Number(targetW), es = Number(effScale);
  const ok = Number.isFinite(tw) && tw > 0 && Number.isFinite(es) && es > 0;
  const fontImg = ok ? clampN(12, Math.min(15 * es, 0.05 * tw), 30) : 12;
  const e = ok ? es : 1;
  const s = {
    targetW: ok ? tw : 0, effScale: e,
    fontImg,
    borderImg: clampN(1.5, fontImg * 0.14, 4),  // 标注框描边宽
    radiusImg: fontImg * 0.5,                   // 框/标签圆角
    padNearImg: fontImg * 0.45,                 // 无箭头标签紧邻间距
    padArrowImg: fontImg * 1.8,                 // 箭头模式标签间距
    strokeImg: Math.max(1.2, fontImg * 0.1),    // 箭头线宽
    arrowImg: fontImg * 0.6,                    // 箭头三角长（css 侧再与 9px 硬帽取 min）
    arrowMinGapImg: fontImg * 0.6 * 2,          // 间距不足 2×箭头长 → 退化无箭头
  };
  return {
    ...s,
    css: {
      fontSize: r(s.fontImg / e),
      borderW: r(s.borderImg / e),
      radius: r(s.radiusImg / e),
      padNear: r(s.padNearImg / e),
      padArrow: r(s.padArrowImg / e),
      stroke: r(s.strokeImg / e),
      arrow: r(s.arrowImg / e),
      arrowMinGap: r(s.arrowMinGapImg / e),
    },
  };
}
// 标注占用率（遮挡验收口径，≤1/3）：标签按整块面积计；框只计描边带（周长×borderW）——
// 3px 描边不构成遮挡，整框面积会计入被圈选的 UI 本体（全景镜头会虚高到 90%+）。矩形带
// borderW 字段按描边带计（v5 拍摄侧 box 恒带 borderW），不带则按整框计（保守口径）。
export function annotCoverageRatio(annots, targetW, targetH) {
  const w = Number(targetW), h = Number(targetH);
  if (!(w > 0) || !(h > 0) || !Array.isArray(annots)) return 1;
  let sum = 0;
  for (const a of annots) {
    const l = a?.label;
    if (l && Number.isFinite(l.width) && Number.isFinite(l.height)) sum += Math.max(0, l.width) * Math.max(0, l.height);
    const b = a?.box;
    if (b && Number.isFinite(b.width) && Number.isFinite(b.height)) {
      sum += (Number(b?.borderW) > 0)
        ? 2 * (Math.max(0, b.width) + Math.max(0, b.height)) * b.borderW
        : Math.max(0, b.width) * Math.max(0, b.height);
    }
  }
  return sum / (w * h);
}
function clampN(lo, v, hi) { return Math.max(lo, Math.min(hi, v)); }
function r(n) { return Math.round(n * 100) / 100; }
