// build-91-varispeed：舞者简称显示体系——舞者级显示覆盖（dancer.labelMode）、重合角标去重
//（labelTableOf）、一键生成简称（autoShorts）、validateProject 覆盖清洗、舞台角标绘制观测。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, validateProject, dancerLabel, effectiveLabelMode, labelTableOf, autoShorts, LABEL_MODES,
} from '../js/model.js';
import { drawScene } from '../js/stage.js';

// ---------- A1 舞者级显示覆盖：覆盖优先，缺省/空/非法回退项目级 ----------
test('A1 effectiveLabelMode：舞者级覆盖优先；"" / 非法 / 缺省回退项目级', () => {
  const p = createProject({ pairs: 1 }); // M1(1) F1(1)
  p.settings.labelMode = 'name';
  assert.equal(effectiveLabelMode(p, p.dancers[0]), 'name');
  p.dancers[0].labelMode = 'short';
  assert.equal(effectiveLabelMode(p, p.dancers[0]), 'short');
  p.dancers[0].labelMode = '';
  assert.equal(effectiveLabelMode(p, p.dancers[0]), 'name', '空串=跟随项目');
  p.dancers[0].labelMode = 'bogus';
  assert.equal(effectiveLabelMode(p, p.dancers[0]), 'name', '非法=跟随项目');
  delete p.dancers[0].labelMode;
  assert.equal(effectiveLabelMode(p, p.dancers[0]), 'name');
  assert.equal(effectiveLabelMode(p, null), 'name', '无舞者对象=项目级');
  assert.equal(effectiveLabelMode(p, p.dancers[0]) && LABEL_MODES.includes('short'), true);
});

// ---------- A2 dancerLabel 显式模式参数（缺省仍为项目级，既有调用零改写） ----------
test('A2 dancerLabel 第 4 参显式模式；缺省仍随项目设置', () => {
  const p = createProject({ pairs: 1 });
  p.settings.labelMode = 'no';
  const d = p.dancers[0]; // name=M1 short=1
  assert.equal(dancerLabel(p, d, 7), '7', '缺省=项目级 no');
  assert.equal(dancerLabel(p, d, 7, 'no'), '7');
  assert.equal(dancerLabel(p, d, 7, 'short'), '1');
  assert.equal(dancerLabel(p, d, 7, 'name'), 'M1');
});

// ---------- B1 labelTableOf：重合角标去重（重合组按名册顺序 1..n；唯一组 idx=0） ----------
test('B1 labelTableOf：short 重合加角标；no 模式序号唯一无角标；name 重合同理', () => {
  const p = createProject({ pairs: 1 });
  p.settings.labelMode = 'short';
  let t = labelTableOf(p); // shorts '1','1' 重合
  assert.deepEqual([t.get(p.dancers[0].id), t.get(p.dancers[1].id)],
    [{ text: '1', idx: 1 }, { text: '1', idx: 2 }]);
  p.settings.labelMode = 'no';
  t = labelTableOf(p); // 序号 '1','2' 唯一
  assert.deepEqual([t.get(p.dancers[0].id).idx, t.get(p.dancers[1].id).idx], [0, 0]);
  assert.deepEqual([t.get(p.dancers[0].id).text, t.get(p.dancers[1].id).text], ['1', '2']);
  p.settings.labelMode = 'name';
  p.dancers[0].name = '王';
  p.dancers[1].name = '王';
  t = labelTableOf(p);
  assert.deepEqual([t.get(p.dancers[0].id).idx, t.get(p.dancers[1].id).idx], [1, 2], '姓名重合同样角标');
  p.dancers[1].name = '李';
  t = labelTableOf(p);
  assert.deepEqual([t.get(p.dancers[0].id).idx, t.get(p.dancers[1].id).idx], [0, 0], '消解后角标撤除');
});

// ---------- B2 labelTableOf：舞者级覆盖参与判重（跨模式混合按文本兜底） ----------
test('B2 labelTableOf：覆盖舞者与跟随舞者文本重合时同样角标', () => {
  const p = createProject({ pairs: 1 });
  p.settings.labelMode = 'no';
  p.dancers[0].labelMode = 'short'; // '1'
  let t = labelTableOf(p); // d0='1'(覆盖) d1='2'(序号) 唯一
  assert.deepEqual([t.get(p.dancers[0].id).idx, t.get(p.dancers[1].id).idx], [0, 0]);
  p.dancers[1].labelMode = 'short'; // 两人文本都 '1'
  t = labelTableOf(p);
  assert.deepEqual([t.get(p.dancers[0].id).idx, t.get(p.dancers[1].id).idx], [1, 2]);
});

// ---------- C1 autoShorts：默认档案名原名即简称 / 中文取首字 / 空名保留 / 返回改动数 ----------
test('C1 autoShorts 规则：M1/F1 原名即简称；中文取首字素；空名保留；返回改动数', () => {
  const p = createProject({ pairs: 1 }); // names M1/F1, shorts '1','1'
  assert.equal(autoShorts(p), 2);
  assert.deepEqual(p.dancers.map(d => d.short), ['M1', 'F1']);
  p.dancers[0].name = '王小明';
  p.dancers[0].short = '9';
  p.dancers[1].name = '   '; // 仅空白=空名，保留
  assert.equal(autoShorts(p), 1, '只改 1 人');
  assert.equal(p.dancers[0].short, '王');
  assert.equal(p.dancers[1].short, 'F1', '空名保留原值');
});

// ---------- C2 autoShorts：数据层不去重（重合由呈示层角标兜底） ----------
test('C2 autoShorts：同姓生成同名简称不去重，labelTableOf 角标兜底', () => {
  const p = createProject({ pairs: 1 });
  p.dancers[0].name = '王大力';
  p.dancers[1].name = '王小红';
  assert.equal(autoShorts(p), 2);
  assert.deepEqual(p.dancers.map(d => d.short), ['王', '王'], '数据层不去重');
  p.settings.labelMode = 'short';
  const t = labelTableOf(p);
  assert.deepEqual([t.get(p.dancers[0].id).idx, t.get(p.dancers[1].id).idx], [1, 2], '呈示层角标去重');
});

// ---------- D1 validateProject：非法覆盖清洗（键不落盘）；合法保留；缺省不新增键 ----------
test('D1 validateProject：dancer.labelMode 非法 delete / 合法保留 / 缺省不落键', () => {
  const { ok, project: v } = validateProject({
    version: 1,
    settings: { labelMode: 'no' },
    dancers: [
      { id: 'a', name: 'A', short: 'A', labelMode: 'bogus' },
      { id: 'b', name: 'B', short: 'B', labelMode: 'short' },
      { id: 'c', name: 'C', short: 'C' },
    ],
    formations: [{ id: 'f', positions: {} }],
  });
  assert.equal(ok, true);
  assert.equal('labelMode' in v.dancers[0], false, '非法值键不落盘');
  assert.equal(v.dancers[1].labelMode, 'short', '合法值保留');
  assert.equal('labelMode' in v.dancers[2], false, '缺省不新增键（JSON 往返零漂移）');
});

// ---------- E1 drawScene 角标绘制观测：重合简称画小号上标 idx（node 桩 ctx） ----------
function stubCtx() {
  const texts = [];
  const noop = () => {};
  return new Proxy({}, {
    get(target, prop) {
      if (prop === '__texts') return texts;
      if (!target[prop]) {
        target[prop] = prop === 'fillText'
          ? (...a) => texts.push(String(a[0]))
          : prop === 'measureText'
            ? (s => ({ width: String(s).length * 10 }))
            : noop;
      }
      return target[prop];
    },
    set(target, prop, v) { target[prop] = v; return true; },
  });
}
test('E1 drawScene 角标绘制：重合简称画上标 1/2；无重合不画', () => {
  const p = createProject({ pairs: 1 });
  const f = p.formations[0];
  const draw = () => {
    const ctx = stubCtx();
    drawScene(ctx, { x: 0, y: 0, w: 300, h: 400 }, p, f.positions, { minimal: true, pad: 4, merges: [] });
    return ctx.__texts;
  };
  p.settings.labelMode = 'no';
  assert.deepEqual(draw().slice().sort(), ['1', '2'], '序号唯一：恰两张标签');
  p.settings.labelMode = 'short';
  const texts = draw(); // '1','1' 重合 → 主文本×2 + 角标 '1','2'
  assert.equal(texts.filter(t => t === '1').length, 3, '两张主文本 + 第一人角标');
  assert.ok(texts.includes('2'), '第二人角标上标');
});
