// round46 Lane A（双 UI 模式 / 多选弹框 / 恒定 BPM 显性化）node 单测：
// 全部走纯函数出口（main.js selectionMenuSpec/varispeedMismatch、timeline.js
// tlTotalHeight/niceSecStep/fmtSecLabel），不依赖 DOM/浏览器。
// 既有套件口径不变：本文件只新增，不改既有测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionMenuSpec, varispeedMismatch } from '../js/main.js';
import { tlTotalHeight, niceSecStep, fmtSecLabel, TRACKS_OPS_H } from '../js/timeline.js';

// ---------- 实现 2：SelectionMenu 条目矩阵（0/1/2/3+ 人 × 构成） ----------
test('S1 N=1：朝向（无互对）+ 删除（「删除」标签=单人既有文案，仪器口径）', () => {
  const items = selectionMenuSpec({ count: 1 });
  assert.deepEqual(items.map(i => i.kind), ['facing', 'delete']);
  assert.equal(items[0].eachOther, false);
  assert.equal(items[1].label, '删除'); // page-r R-02/R-04 精确断言 ['删除','✕']（呈示层收口见 main.js 注释）
});

test('S2 N=2 未合并：互相对齐出现、存为编组、合并为单元、移出队形；无均布（<3 人模型无效果）', () => {
  const items = selectionMenuSpec({ count: 2, pairEligible: true, mergedInvolved: false });
  assert.deepEqual(items.map(i => i.kind), ['facing', 'saveGroup', 'mergeUnit', 'removeFromFormation', 'delete']);
  assert.equal(items[0].eachOther, true, '恰 2 人 → 互相对齐');
  assert.equal(items.at(-1).label, '删除所选（2 人）');
});

test('S3 N=2 涉合并（或已是整单元）：无「合并为单元」；mergedInvolved → 取消合并', () => {
  // 整单元多选会被手势机分流到 unit 载荷（round23 M2），spec 层仍表达「不重复给合并入口」
  const items = selectionMenuSpec({ count: 2, pairEligible: false, mergedInvolved: true });
  assert.deepEqual(items.map(i => i.kind), ['facing', 'saveGroup', 'unmerge', 'removeFromFormation', 'delete']);
  assert.ok(!items.some(i => i.kind === 'mergeUnit'));
});

test('S4 N=3 群体：朝向无互对、存编组、取消合并（涉合并时）、均布、移出队形、删除所选（3 人）', () => {
  const plain = selectionMenuSpec({ count: 3, pairEligible: false, mergedInvolved: false });
  assert.deepEqual(plain.map(i => i.kind),
    ['facing', 'saveGroup', 'distribute', 'removeFromFormation', 'delete']);
  assert.equal(plain[0].eachOther, false, '互相对齐仅 N=2');
  assert.equal(plain.at(-1).label, '删除所选（3 人）');
  const mixed = selectionMenuSpec({ count: 3, pairEligible: false, mergedInvolved: true });
  assert.ok(mixed.some(i => i.kind === 'unmerge'), '涉合并单元 → 取消合并');
  assert.ok(!mixed.some(i => i.kind === 'mergeUnit'));
});

test('S5 N≥4：同 N=3 骨架（删除标签随 N），合并族按构成显隐', () => {
  const items = selectionMenuSpec({ count: 4 });
  assert.deepEqual(items.map(i => i.kind),
    ['facing', 'saveGroup', 'distribute', 'removeFromFormation', 'delete']);
  assert.equal(items.at(-1).label, '删除所选（4 人）');
});

test('S6 恰 2 人未合并但 selection 含第三方（N=3）：不给「合并为单元」（pairEligible 只看整 selection）', () => {
  const items = selectionMenuSpec({ count: 3, pairEligible: true });
  assert.ok(!items.some(i => i.kind === 'mergeUnit'));
});

// ---------- 实现 1：双 UI 模式几何（编舞=既有零变化；音乐=块区不占位） ----------
test('G1 编舞模式（stage）总高与既有版本逐值一致：桌面简单 150 / 移动 120 / 展开桌面 160', () => {
  // audioBottom：简单态=22(尺规)+18(tag)+26(音轨)=66；展开态=22+18+72=112
  assert.equal(tlTotalHeight('stage', 66, false), 150);
  assert.equal(tlTotalHeight('stage', 66, true), 120);
  assert.equal(tlTotalHeight('stage', 112, false), 160);
});

test('G2 音乐模式（music）块区不占位：总高=音频轨底+12+多轨加轨条 26（汇合轮改值，简单 104 / 展开 150，移动端同式；编舞 G1 三值不动）', () => {
  assert.equal(tlTotalHeight('music', 66, false), 66 + 12 + TRACKS_OPS_H);
  assert.equal(tlTotalHeight('music', 112, false), 112 + 12 + TRACKS_OPS_H);
  assert.equal(tlTotalHeight('music', 66, true), 66 + 12 + TRACKS_OPS_H);
  assert.equal(TRACKS_OPS_H, 26, '加轨条高=26（音乐模式底部 ＋加轨 DOM 条）');
});

// ---------- 实现 3：恒定 BPM 显性化 ----------
test('B1 varispeedMismatch 阈值：偏差 ≤10% 不报、>10% 报、非法输入安全为否', () => {
  assert.equal(varispeedMismatch(60, 120, 0.5, 0), false);      // 模型 60s = 实际 60s
  assert.equal(varispeedMismatch(60, 112, 0.5, 0), false);      // 模型 56s，偏差 6.7% < 10%
  assert.equal(varispeedMismatch(60, 108, 0.5, 0), false);      // 模型 54s，偏差恰 10%（不含）→ 不报
  assert.equal(varispeedMismatch(60, 106, 0.5, 0), true);       // 模型 53s，偏差 11.7% > 10%
  assert.equal(varispeedMismatch(60, 100, 0.5, 0), true);       // 模型 50s，偏差 16.7%
  assert.equal(varispeedMismatch(60, 30, 0.5, 2), true);        // 含首拍 2s：模型 17s → 71.7% > 10%
  assert.equal(varispeedMismatch(0, 120, 0.5), false);
  assert.equal(varispeedMismatch(60, 0, 0.5), false);
  assert.equal(varispeedMismatch(60, 120, 0), false);
});

test('B2 niceSecStep：NICE 秒族取「像素宽≥68」最小步长；pps 非正回退 3600', () => {
  assert.equal(niceSecStep(68), 1);        // 1s=68px
  assert.equal(niceSecStep(67.9), 2);      // 1s=67.9px → 升 2s
  assert.equal(niceSecStep(13.6), 5);      // 5s=68px
  assert.equal(niceSecStep(3), 30);        // 15s=45px<68 → 30s
  assert.equal(niceSecStep(0.5), 300);
  assert.equal(niceSecStep(0), 3600);
  assert.equal(niceSecStep(-1), 3600);
  assert.equal(niceSecStep(100000), 0.1);  // 高倍放大：0.1s=10000px ≥68 → 最小步长
});

test('B3 fmtSecLabel：<60s 呈「N.s」/「Ns」，≥60s 呈 m:ss', () => {
  assert.equal(fmtSecLabel(0), '0s');
  assert.equal(fmtSecLabel(12), '12s');
  assert.equal(fmtSecLabel(12.5), '12.5s');
  assert.equal(fmtSecLabel(59.96), '60s');  // 先四舍五入到 0.1s 再分支（60 恰好落秒制标签）
  assert.equal(fmtSecLabel(60), '1:00');
  assert.equal(fmtSecLabel(75), '1:15');
  assert.equal(fmtSecLabel(600), '10:00');
});
