// 场地 4:3 缺省 + 场地预设 —— build-61-stageaspect 单测。
// F1：新建项目缺省 16×12（4:3 横向，面积 192m² 与旧缺省 12×16 相同；观众方向/后台/网格不动；
//     既有项目零迁移——只有 createProject 落新缺省）；初始队形（genDefaultRows 派生）随新场地
//     居中/重排且全部落在场内。
// F2：场地预设五档数学（宽深与比例精确成档）+ stagePresetHit 高亮匹配纯函数
//     （精确宽深优先——区分同比档 8×6/16×12；宽深比兜底；非法/不命中 → null）。
//     接线静态断言：props-stage 顶部预设行、applyStagePreset 单条「调整场地」历史、
//     视口复位自动 fitView（stageView.view=null 与 stageChange 同链）。
// F3（video-export 联动）：静态断言合成器逐帧 fitView(project.stage) —— 4:3 场地自动放大舞者，
//     三轨条布局独立，无需改导出代码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, STAGE_PRESETS, stagePresetHit } from '../js/model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainSrc = readFileSync(join(root, 'js', 'main.js'), 'utf8');
const modelSrc = readFileSync(join(root, 'js', 'model.js'), 'utf8');
const cssSrc = readFileSync(join(root, 'css', 'style.css'), 'utf8');
const vxSrc = readFileSync(join(root, 'js', 'video-export.js'), 'utf8');

// ---------- F1：新项目缺省 4:3（16×12） ----------
test('F1: createProject 缺省场地 16×12（4:3 横向），观众方向/网格沿用旧缺省（后台缺省见 build-63-stageview2 F1）', () => {
  const p = createProject();
  assert.equal(p.stage.widthM, 16, '宽 16 米');
  assert.equal(p.stage.depthM, 12, '深 12 米');
  assert.equal(p.stage.audience, 'bottom', '观众方向不变');
  assert.equal(p.stage.backstageM, 1, '后台区缺省 1（build-63-stageview2 F1 瘦身，原 2）');
  assert.equal(p.stage.gridM, 0.5, '网格间距不变');
  assert.equal(p.stage.snap, true, '吸附开关不变');
  assert.equal(p.stage.bgImage, null, '背景图不变');
  assert.equal(p.stage.widthM / p.stage.depthM, 4 / 3, '宽深比 4:3');
  assert.equal(p.stage.widthM * p.stage.depthM, 192, '面积 192m² 与旧缺省 12×16 相同');
});

test('F1: 初始开场队形按新场地派生——双人横排落在场内且横向铺开（genDefaultRows 随 stage 派生）', () => {
  const p = createProject({ pairs: 6 });
  const pos = Object.values(p.formations[0].positions);
  assert.equal(pos.length, 12, '6 对=12 人全部有初始点位');
  const xs = pos.map(q => q.x), ys = pos.map(q => q.y);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= p.stage.widthM, 'x 全落在 0..widthM');
  assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= p.stage.depthM, 'y 全落在 0..depthM');
  // 双横排沿宽向铺开：16m 宽下 6 人/排的横向跨度应明显大于旧 12m 缺省（空间利用率提升的可观测面）
  const span = Math.max(...xs) - Math.min(...xs);
  assert.ok(span > 10, `横向跨度 ${span}m 应大于 10m（16m 宽场地铺开）`);
  assert.ok(pos.every(q => q.facing === 180), '朝向观众（bottom=180）不变');
});

test('F1: 既有项目零迁移——旧 12×16 项目数据原样可用，缺省只由 createProject 决定', () => {
  // 载入路径不改 stage（store 清洗只补缺失键）：模拟旧项目对象直接可用
  const legacy = { stage: { widthM: 12, depthM: 16, audience: 'bottom', gridM: 0.5, snap: true, backstageM: 2, bgImage: null } };
  const p = createProject();
  p.stage = legacy.stage; // 模拟旧项目载入后的形态
  assert.equal(p.stage.widthM, 12);
  assert.equal(p.stage.depthM, 16);
  assert.equal(stagePresetHit(p.stage.widthM, p.stage.depthM), '34', '旧缺省 12×16 精确命中 3:4 档');
  // 缺省值只写死在 createProject 一处（STAGE_PRESETS 的 4:3 档是独立数据，不算缺省点）
  const occurrences = [...modelSrc.matchAll(/stage: \{ widthM: 16, depthM: 12/g)].length;
  assert.equal(occurrences, 1, '16×12 缺省只在 createProject 写一处');
});

// ---------- F2a：预设五档数学 ----------
test('F2: 场地预设五档——宽深值、比例、id 唯一', () => {
  assert.equal(STAGE_PRESETS.length, 5, '五档：4:3 / 3:4 / 1:1 / 16:9 / 小场地');
  const by = Object.fromEntries(STAGE_PRESETS.map(p => [p.id, p]));
  assert.equal(by['43'].widthM, 16); assert.equal(by['43'].depthM, 12);
  assert.equal(by['34'].widthM, 12); assert.equal(by['34'].depthM, 16);
  assert.equal(by['11'].widthM, 14); assert.equal(by['11'].depthM, 14);
  assert.equal(by['169'].widthM, 18); assert.equal(by['169'].depthM, 10);
  assert.equal(by['small'].widthM, 8); assert.equal(by['small'].depthM, 6);
  assert.equal(new Set(STAGE_PRESETS.map(p => p.id)).size, 5, 'id 唯一');
  // 比例数学：各档宽深比与标签一致（16:9 用交叉相乘核对，规避除法浮点）
  const ratio = (w, d, rw, rd) => Math.abs(w * rd - rw * d) < 1e-9;
  assert.ok(ratio(by['43'].widthM, by['43'].depthM, 4, 3), '4:3 档 = 4/3');
  assert.ok(ratio(by['34'].widthM, by['34'].depthM, 3, 4), '3:4 档 = 3/4');
  assert.ok(ratio(by['11'].widthM, by['11'].depthM, 1, 1), '1:1 档 = 1');
  assert.ok(ratio(by['169'].widthM, by['169'].depthM, 18, 10), '16:9 档 = 18×10（9:5，16:9 的整数米近似档）');
  assert.ok(ratio(by['small'].widthM, by['small'].depthM, 4, 3), '小场地 8×6 = 4/3 比例');
  // 全档落在 STAGE_RANGE 域内（舞台页签输入框可回显，不被钳制拒绝）
  for (const p of STAGE_PRESETS) {
    assert.ok(p.widthM >= 4 && p.widthM <= 50 && p.depthM >= 4 && p.depthM <= 50, `${p.id} 在 [4,50] 域内`);
  }
});

// ---------- F2b：stagePresetHit 高亮匹配纯函数 ----------
test('F2: stagePresetHit 精确宽深优先——五档精确命中；同比档 8×6 亮「小场地」不亮「4:3」', () => {
  assert.equal(stagePresetHit(16, 12), '43');
  assert.equal(stagePresetHit(12, 16), '34');
  assert.equal(stagePresetHit(14, 14), '11');
  assert.equal(stagePresetHit(18, 10), '169');
  assert.equal(stagePresetHit(8, 6), 'small', '同比档按精确宽深区分');
});

test('F2: stagePresetHit 宽深比兜底——自由输入同比例值亮对应档；不命中/非法 → null', () => {
  assert.equal(stagePresetHit(20, 15), '43', '20×15 是 4:3');
  assert.equal(stagePresetHit(9, 12), '34', '9×12 是 3:4');
  assert.equal(stagePresetHit(20, 20), '11', '20×20 是 1:1');
  assert.equal(stagePresetHit(36, 20), '169', '36×20 是 16:9');
  assert.equal(stagePresetHit(10, 7), null, '自由比例全不亮');
  assert.equal(stagePresetHit(13.5, 13.5), '11', '0.5 步进输入仍按比命中');
  assert.equal(stagePresetHit(0, 12), null, '宽 0 非法');
  assert.equal(stagePresetHit(NaN, 12), null, 'NaN 非法');
  assert.equal(stagePresetHit(-16, 12), null, '负宽非法');
  assert.equal(stagePresetHit('16', 12), '43', '字符串数值（input value 域）可命中');
});

// ---------- F2c：接线静态断言 ----------
test('F2: props-stage 预设行接线——顶部快捷组在尺寸组之前、渲染五档钮、命中高亮、title 提示场地类型', () => {
  const presetIdx = mainSrc.indexOf("h('div', { class: 'pg-title' }, '场地预设')");
  const sizeIdx = mainSrc.indexOf("h('div', { class: 'pg-title' }, '舞台尺寸（米）')");
  assert.ok(presetIdx > -1, 'buildProps 有「场地预设」组');
  assert.ok(sizeIdx > presetIdx, '预设组位于舞台尺寸组上方（props-stage 顶部）');
  assert.match(mainSrc, /\.\.\.M\.STAGE_PRESETS\.map/, '预设行渲染全部档位钮');
  assert.match(mainSrc, /M\.stagePresetHit\(st\.widthM, st\.depthM\) === p\.id \? ' active'/, '命中档加 active 高亮');
  assert.match(mainSrc, /title: `\$\{p\.label\}（\$\{p\.widthM\}×\$\{p\.depthM\} 米）· \$\{p\.kind\}`/, 'title 提示宽深+场地类型');
  assert.match(modelSrc, /kind: '标准舞池'/, '档位带场地类型参考注释（title 消费）');
});

test('F2: applyStagePreset 单条「调整场地」历史 + 视口复位自动 fitView（与 stageChange 同链）', () => {
  const fn = mainSrc.slice(mainSrc.indexOf('function applyStagePreset'), mainSrc.indexOf('function applyStagePreset') + 400);
  assert.match(fn, /stageView\.view = null/, '预设套用先复位视口 → 下次绘制 fitView 兜底');
  assert.match(fn, /propsKey = ''/, '强制重建舞台页签 → 高亮随新宽深刷新');
  assert.match(fn, /store\.mutate\(pr => \{[\s\S]*?pr\.stage\.widthM = p\.widthM;[\s\S]*?pr\.stage\.depthM = p\.depthM;[\s\S]*?\}, '调整场地'\)/, '宽深一次写入=单条「调整场地」历史');
  // 数值输入路径（自由改尺寸）同样保持自动 fitView：stageChange 既有接线不回退
  const change = mainSrc.slice(mainSrc.indexOf('function stageChange'), mainSrc.indexOf('function stageChange') + 800);
  assert.match(change, /stageView\.view = null/, 'stageChange 仍复位视口（改尺寸→自动适配视口）');
  assert.match(change, /propsKey = ''/, 'stageChange 强制重建页签（回显钳制值+高亮刷新）');
  // fitView 兜底语义在 stage.js：view 空则取 fitView 结果
  const stageSrc = readFileSync(join(root, 'js', 'stage.js'), 'utf8');
  assert.match(stageSrc, /if \(!this\.view\) this\.view = fit/, 'stage.js view 空 → fitView 兜底（自动适配视口的实现点）');
  // 预设钮高亮样式入包
  assert.match(cssSrc, /\.stage-preset\.active\{border-color:var\(--acc\)/, '命中档 accent 高亮样式');
});

// ---------- F3：视频导出联动（不改导出代码，静态钉住调用链） ----------
test('F3: 视频合成器逐帧按 project.stage fitView 等比 letterbox——4:3 场地自动放大舞者，三轨条不受影响', () => {
  assert.match(vxSrc, /import \{ drawScene, fitView \} from '\.\/stage\.js';/, '合成器用舞台域 fitView');
  assert.match(vxSrc, /view: fitView\(layout\.stageW, layout\.stageH, project\.stage/, '逐帧按当前场地等比适配（场地改 4:3 无需改导出）');
  assert.match(vxSrc, /stripY/, '三轨条布局独立于场地比例（上部舞台+下部轨条 letterbox 结构不变）');
});
