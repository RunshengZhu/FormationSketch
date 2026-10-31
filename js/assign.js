// 槽位智能分配（build-62-formations2 F2）—— 最小化总移动距离的舞者↔槽位指派。
// 算法：匈牙利算法（Kuhn–Munkres，最短增广路 + 势函数实现，O(n³)）；本应用 n ≤ 50，毫秒级。
// cost = 欧氏距离。纯函数、零依赖，node 可直接测（与暴力全排列对拍 / 1D 非交叉 / 恒等映射）。
//
// 为什么能减少交叉与过远移动：以「总移动距离」为度量成本时，1D（共线站位）的最优指派可证
// 不产生交叉（顺序保持）；2D 场景无此定理，但最小化总欧氏距离在经验上大幅减少交叉与绕远
// （个别反例存在，不承诺零交叉）。生成器仍负责每个槽位的朝向（facing），本模块只决定
// 「哪位舞者去哪个槽位」。
//
// 接口约定：fromPts / toSlots 为等长或 fromPts ≤ toSlots 的 {x,y} 数组；返回 assignment
// （长度 = fromPts.length），assignment[i] = toSlots 中分派给第 i 个起点的下标（互不相同）。
// 缺位/兜底坐标由调用方（main.js 生成流）解析，本模块只做纯指派。

// 最小代价指派（矩形支持：行数 ≤ 列数；行多则自动转置）
export function assignMinCost(fromPts, toSlots) {
  const n0 = fromPts?.length || 0, m0 = toSlots?.length || 0;
  if (!n0 || !m0) return [];
  const P = fromPts.map(pt => (Number.isFinite(pt?.x) && Number.isFinite(pt?.y)) ? pt : { x: 0, y: 0 });
  const Q = toSlots.map(pt => (Number.isFinite(pt?.x) && Number.isFinite(pt?.y)) ? pt : { x: 0, y: 0 });
  const cost = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // 行 > 列：转置成「行 ≤ 列」解之，再翻回
  const transposed = n0 > m0;
  const rows = transposed ? Q : P, cols = transposed ? P : Q;
  const n = rows.length, m = cols.length;
  // 1 基势函数法（e-maxx 标准实现；a[i][j] = cost(rows[i], cols[j])）
  const a = rows.map(r => cols.map(c => cost(r, c)));
  const INF = Number.MAX_VALUE;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);      // p[j] = 分派到列 j 的行（0 = 空）
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  // p[j] = 行 → 反转成 assignment[行] = 列
  const rowToCol = new Array(n + 1).fill(0);
  for (let j = 1; j <= m; j++) if (p[j]) rowToCol[p[j]] = j;
  const out = [];
  for (let i = 1; i <= n; i++) out.push(rowToCol[i] - 1);
  // 转置情形：out[i] = 「转置后第 i 行」的列 = 原列 i 的原行号
  return transposed ? invert(out, n0) : out;
}
// 由「每列分到的行」还原「每行的列」：perm[c] = 原行（长度 = min(n,m)…此处 n≤m 分支不触达，
// 转置分支里 out[i] = 原列 i 分到的原行 → invert 得 assignment[原行] = 原列）
function invert(colToRow, totalCols) {
  const rowToCol = new Array(totalCols).fill(-1);
  colToRow.forEach((r, c) => { if (r >= 0 && r < totalCols) rowToCol[r] = c; });
  return rowToCol;
}

// 指派总代价（调试/测试便利；与 assignMinCost 同口径）
export function assignTotalCost(fromPts, toSlots, assignment) {
  let s = 0;
  for (let i = 0; i < assignment.length; i++) {
    const a = fromPts[i], b = toSlots[assignment[i]];
    if (a && b) s += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return s;
}
