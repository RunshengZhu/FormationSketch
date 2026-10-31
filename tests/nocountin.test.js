// build-68-nocountin 退役静态断言：播放键倒计时（数拍入场）整体退役后的防回归门禁。
// 覆盖：① 应用源码（js/ + index.html + css/）零 countin/数拍/倒计 残留（退役注记行豁免）；
//       ② index.html 无 #countin-overlay/#mp-countin/两处「数拍」输入，摘要条与校准子行结构保留；
//       ③ player.play 签名无 countIn、引擎无 cancelCountin/onCountin/_ciBase 残件；
//       ④ 模型层：createProject 不再生成 countInBeats；旧 JSON 残留字段载入零报错并被剥离（零迁移）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject, validateProject } from '../js/model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- ① 应用源码零残留 ----------
test('N1 应用源码零 countin 残留：js/*、index.html、css/* 无 countin/countIn/数拍/倒计（退役注记行豁免）', () => {
  const files = [];
  for (const f of readdirSync(join(ROOT, 'js'))) if (f.endsWith('.js')) files.push(join(ROOT, 'js', f));
  files.push(join(ROOT, 'index.html'), join(ROOT, 'css', 'style.css'));
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      // 豁免：退役注记行（说明本功能已退役的注释/标记），如 build-68-nocountin 标记
      if (lines[i].includes('退役') || lines[i].includes('nocountin')) continue;
      if (/[cC]ount[Ii]n|数拍|倒计/.test(lines[i])) hits.push(`${file}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  assert.deepEqual(hits, [], `发现 countin 残留：\n${hits.join('\n')}`);
});

// ---------- ② index.html 结构 ----------
test('N2 index.html：overlay/大字/两处数拍输入退役；播放条与摘要条/校准子行布局结构保留', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const gone of ['id="countin-overlay"', 'id="mp-countin"', 'id="countin-input"', 'id="countin-input-music"']) {
    assert.ok(!html.includes(gone), `${gone} 已退役`);
  }
  // 退役不破布局：两行播放条与摘要条锚点 id 原样（mobilestage 行高预算回归由 mobilestage.test 锁）
  for (const kept of ['id="stage-wrap"', 'id="music-preview"', 'id="music-summary"', 'id="calib-disc"', 'id="mp-canvas"', 'id="pb-play"']) {
    assert.ok(html.includes(kept), `布局锚点 ${kept} 保留`);
  }
  // 校准子行保留其余（BPM/首拍只读 + 小节）
  assert.ok(html.includes('id="bpm-input"') && html.includes('id="offset-input"') && html.includes('id="bpb-select"'), '校准子行 BPM/首拍/小节保留');
});

// ---------- ③ 引擎签名 ----------
test('N3 player.play 签名无 countIn 选项；引擎无 cancelCountin/onCountin/_ciBase 残件', () => {
  const src = readFileSync(join(ROOT, 'js', 'player.js'), 'utf8');
  assert.ok(!/play\s*\([^)]*countIn/.test(src), 'play() 签名无 countIn');
  for (const gone of ['cancelCountin', 'onCountin', '_ciBase', '_ciTimer', 'this.countin']) {
    assert.ok(!src.includes(gone), `player.js 无 ${gone} 残件`);
  }
  // main.js 调用方同步：无 countIn 传参 / countin 守卫残留
  const main = readFileSync(join(ROOT, 'js', 'main.js'), 'utf8');
  assert.ok(!/countIn\s*:/.test(main), 'main.js 无 countIn: 传参');
  assert.ok(!/player\??\.countin/.test(main), 'main.js 无 player.countin 守卫残留');
});

// ---------- ④ 模型层：字段退役 + 旧 JSON 容忍剥离 ----------
test('N4 createProject 不再生成 countInBeats；旧 JSON 残留字段载入零报错并剥离（零迁移）', () => {
  const fresh = createProject({ pairs: 1 });
  assert.equal(fresh.timeline.countInBeats, undefined, '新项目无 countInBeats 字段');
  // 旧项目 JSON 带 countInBeats：validateProject 零报错，字段被 sanitize 剥离不保留
  const oldJson = {
    version: 1, dancers: [], formations: [{ id: 'f', positions: {} }],
    timeline: { countInBeats: 4, blocks: [] },
  };
  const { project } = validateProject(oldJson);
  assert.equal(project.timeline.countInBeats, undefined, '旧 JSON 的 countInBeats 载入即剥离');
});
