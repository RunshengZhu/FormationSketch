// dancesport-choreo skill 测试（Phase 2 六能力实装 + Phase 3 音乐匹配 验收）
// 覆盖（与 skill 脚本头注契约逐条对应）：
//   0) 加固① vendor 防陈旧：`build-core --out <tmp>` 重建 core 与 skill vendor/wuzhen-core.mjs 逐字节比对，陈旧即 fail；
//   1) analyze-music：样例结构报告（拍/秒/8拍/密度建议）、规则表覆盖、一致性告警、负路径；
//   2) propose-formations：候选 2~4（铁律② count≤4）、props 由 core 重算、SVG 预览、排序稳定可复现、负路径；
//   3) propose-transition（§13 契约）：count≤4、排序稳定可复现、intermediate 两段 feasibility、
//      只产出 roster 内真实 id（加固②：roster 外 id 拒绝生成）；
//   4) check/apply 加固：roster 外 id → warning 决策点；自报 props 与 core 重算偏差 >5% → warning（加固③）；
//   5) propose-timeline：样例歌（BPM 120，前奏8/主歌32/副歌32/间奏8/副歌32/尾声8）→
//      总拍数对齐（=Σ段落拍数）、块数与密度规则一致（reset 整段/small 16拍/big 8拍一变）、
//      全部变换 feasibility ok、逐段 apply --all 后 computeSegments 总拍数一致、export 往返逐字节无损。
// 零外部依赖：node --test tests/skill-choreo.test.js 可跑。
// skill 位置：~/.agents/skills/dancesport-choreo（脚本一律以子进程调用，测的是 CLI 契约）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(homedir(), '.agents', 'skills', 'dancesport-choreo');
const SCRIPTS = join(SKILL, 'scripts');
const VENDOR = join(SKILL, 'vendor', 'wuzhen-core.mjs');
const node = process.execPath;

const run = (script, args, { expect = 0, dir = null } = {}) => {
  const r = spawnSync(node, [join(SCRIPTS, script), ...(dir ? [dir] : []), ...args], { encoding: 'utf8' });
  assert.equal(r.status, expect, `${script} ${args.join(' ')} 退出码 ${r.status}（期望 ${expect}）\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
};
const tmp = () => mkdtempSync(join('/tmp', 'skill-choreo-'));
const core = await import(pathToFileURL(VENDOR)); // 与 vendor 同源复算 props/可行性

// 样例歌（任务书样例）：BPM 120，前奏8/主歌32/副歌32/间奏8/副歌32/尾声8 = 120 拍
const SAMPLE_SECTIONS = {
  sections: [
    { name: '前奏', beats: 8 },
    { name: '主歌', beats: 32 },
    { name: '副歌', beats: 32 },
    { name: '间奏', beats: 8 },
    { name: '副歌', beats: 32 },
    { name: '尾声', beats: 8 },
  ],
};

// ---------- 0) 加固①：vendor 防陈旧 ----------
test('加固① vendor 防陈旧：重建 core 与 vendor/wuzhen-core.mjs 逐字节一致', () => {
  const out = join(tmp(), 'wuzhen-core-rebuild.mjs');
  const b = spawnSync(node, [join(ROOT, 'scripts', 'build-core.mjs'), '--out', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(b.status, 0, `build-core --out 失败：${b.stderr}`);
  const rebuilt = readFileSync(out);
  const vendored = readFileSync(VENDOR);
  assert.ok(rebuilt.equals(vendored),
    'vendor/wuzhen-core.mjs 与 app 源重建产物不一致（vendor 陈旧）——请重建同步：node scripts/build-core.mjs && cp dist/core/wuzhen-core.mjs ~/.agents/skills/dancesport-choreo/vendor/');
});

// ---------- 1) analyze-music ----------
test('analyze-music：样例结构报告（拍/秒/8拍/密度建议 + 总拍数）', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '6', '--preset-merged', '--bpm', '120'], { dir });
  const sectionsFile = join(dir, 'sections.json');
  writeFileSync(sectionsFile, JSON.stringify(SAMPLE_SECTIONS));
  run('analyze-music.mjs', ['--bpm', '120', '--sections', sectionsFile], { dir });
  const rep = JSON.parse(readFileSync(join(dir, 'music-report.json'), 'utf8'));
  assert.equal(rep.bpm, 120);
  assert.equal(rep.secPerBeat, 0.5);
  assert.equal(rep.totalBeats, 120);
  assert.equal(rep.sections.length, 6);
  const [intro, verse, chorus] = rep.sections;
  assert.deepEqual([intro.name, intro.density, intro.startBeat, intro.endBeat, intro.startSec], ['前奏', 'reset', 0, 8, 0]);
  assert.deepEqual([verse.name, verse.density, verse.changeEveryBeats, verse.eights], ['主歌', 'small', 16, 4]);
  assert.deepEqual([chorus.name, chorus.density, chorus.changeEveryBeats], ['副歌', 'big', 8]);
  assert.equal(chorus.startBeat, 40);
  assert.equal(chorus.startSec, 20); // 40 拍 × 0.5s
  assert.equal(rep.sections[3].density, 'reset'); // 间奏
  rmSync(dir, { recursive: true, force: true });
});

test('analyze-music：规则表可覆盖 + 一致性告警 + 首拍偏移', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '2', '--bpm', '120'], { dir });
  const sectionsFile = join(dir, 'sections.json');
  writeFileSync(sectionsFile, JSON.stringify({ sections: [{ name: '间奏', beats: 8 }, { name: '怪段落', beats: 6 }] }));
  const rulesFile = join(dir, 'rules.json');
  writeFileSync(rulesFile, JSON.stringify({ rules: [{ match: '间奏', density: 'big', changeEveryBeats: 8 }] }));
  const r = run('analyze-music.mjs', ['--bpm', '120', '--sections', sectionsFile, '--rules', rulesFile, '--duration-sec', '61', '--first-beat-sec', '0.5', '--out', join(dir, 'rep.json')], { dir });
  const rep = JSON.parse(readFileSync(join(dir, 'rep.json'), 'utf8'));
  assert.equal(rep.sections[0].density, 'big'); // 覆盖生效
  assert.equal(rep.sections[0].densitySource, 'override');
  assert.equal(rep.sections[1].density, 'small'); // 未识别段落 → 缺省 small（提示人确认）
  assert.equal(rep.sections[1].densitySource, 'default');
  assert.ok(rep.warnings.some(w => w.includes('不与 8 拍对齐') || w.includes('整小节')), '非 8 拍对齐告警');
  assert.ok(rep.warnings.some(w => w.includes('音频时长推算')), 'durationSec 推算告警');
  assert.equal(rep.sections[0].startSec, 0.5); // 首拍偏移参与换算
  assert.ok(r.stdout.includes('人'), '输出提示人确认（铁律⑥）');
  rmSync(dir, { recursive: true, force: true });
});

test('analyze-music：负路径（缺 sections / 非法 beats / 缺 bpm）', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '2'], { dir });
  run('analyze-music.mjs', ['--bpm', '120'], { dir, expect: 1 }); // 缺 --sections
  const sectionsFile = join(dir, 'sections.json');
  writeFileSync(sectionsFile, JSON.stringify({ sections: [{ name: '前奏', beats: 0 }] }));
  run('analyze-music.mjs', ['--bpm', '120', '--sections', sectionsFile], { dir, expect: 1 }); // beats 非法
  writeFileSync(sectionsFile, JSON.stringify({ sections: [{ name: '前奏', beats: 8, density: 'huge' }] }));
  run('analyze-music.mjs', ['--bpm', '120', '--sections', sectionsFile], { dir, expect: 1 }); // density 非法
  writeFileSync(sectionsFile, JSON.stringify({ sections: [{ name: '前奏', beats: 8 }] }));
  // 缺 --bpm 且项目 audio.bpm 为空 → 拒绝（裸项目文件，不经 validateProject 补默认）
  rmSync(join(dir, 'project.wuzhen.json'));
  writeFileSync(join(dir, 'project.wuzhen.json'), JSON.stringify({ version: 1, meta: { title: '裸' }, audio: { bpm: null } }));
  run('analyze-music.mjs', ['--sections', sectionsFile], { dir, expect: 1 });
  rmSync(dir, { recursive: true, force: true });
});

// ---------- 2) propose-formations ----------
test('propose-formations：2~4 候选、props 由 core 重算、SVG 预览、排序稳定可复现', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '6', '--preset-merged', '--bpm', '120'], { dir });
  run('propose-formations.mjs', ['--style', '大气', '--count', '3', '--beats', '8', '--out', join(dir, 'cf1.json')], { dir });
  const doc = JSON.parse(readFileSync(join(dir, 'cf1.json'), 'utf8'));
  assert.ok(doc.candidates.length >= 2 && doc.candidates.length <= 3, '候选 2~3 个');
  const project = JSON.parse(readFileSync(join(dir, 'project.wuzhen.json'), 'utf8'));
  const base = project.formations[project.formations.length - 1];
  for (const c of doc.candidates) {
    assert.ok(c.preview.startsWith('<svg xmlns='), `${c.id} 带 SVG 预览`);
    assert.ok(Object.keys(c.formation.positions).length === project.dancers.length, '覆盖全员');
    // props 必须与 core 重算一致（加固③的正向：propose 自身就重算）
    const diff = core.diffFormations(base, c.formation);
    const feas = core.feasibility(base, c.formation, 8, project.audio.bpm, 1.2);
    assert.equal(c.props.movedCount, diff.moved.length);
    assert.equal(c.props.maxDist, diff.maxDist);
    assert.equal(c.props.totalDist, diff.totalDist);
    assert.equal(c.props.score, Number.isFinite(feas.score) ? feas.score : 9999);
    assert.equal(typeof c.props.dispersion, 'number');
    assert.equal(typeof c.props.symmetry, 'number');
  }
  // 排序稳定可复现（同输入同序同值）
  run('propose-formations.mjs', ['--style', '大气', '--count', '3', '--beats', '8', '--out', join(dir, 'cf2.json')], { dir });
  const doc2 = JSON.parse(readFileSync(join(dir, 'cf2.json'), 'utf8'));
  const strip = d => JSON.stringify(d.candidates.map(({ createdAt, ...rest }) => rest));
  assert.equal(strip(doc), strip(doc2), '两次运行候选序与内容一致（createdAt 除外）');
  rmSync(dir, { recursive: true, force: true });
});

test('propose-formations：负路径（count 出界 / 未知种类 / 候选不足 2）', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '2'], { dir });
  run('propose-formations.mjs', ['--count', '5'], { dir, expect: 1 }); // 铁律② 上限
  run('propose-formations.mjs', ['--count', '1'], { dir, expect: 1 }); // 铁律② 下限
  run('propose-formations.mjs', ['--kinds', 'spiral'], { dir, expect: 1 }); // 未知种类
  run('propose-formations.mjs', ['--kinds', 'rows', '--count', '3'], { dir, expect: 1 }); // 池太小 → 不足 2 候选
  rmSync(dir, { recursive: true, force: true });
});

// ---------- 3) propose-transition（§13 契约） ----------
// 建一个含 2 队形的工作区（init + apply 一个 propose-formations 候选，全部脚本化）
function workspaceWith2Formations() {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '6', '--preset-merged', '--bpm', '120'], { dir });
  run('propose-formations.mjs', ['--kinds', 'circle,v', '--count', '2', '--beats', '8', '--out', join(dir, 'cf.json')], { dir });
  run('apply.mjs', [join(dir, 'cf.json'), '--pick', 'c1', '--yes'], { dir });
  return dir;
}

test('propose-transition §13：count≤4 / 排序稳定 / 两段 feasibility / 全 roster id', t => {
  const dir = workspaceWith2Formations();
  const project = JSON.parse(readFileSync(join(dir, 'project.wuzhen.json'), 'utf8'));
  const roster = new Set(project.dancers.map(d => d.id));
  run('propose-transition.mjs', ['--from', '0', '--to', '1', '--beats', '8', '--count', '4', '--out', join(dir, 'ct1.json')], { dir });
  const doc = JSON.parse(readFileSync(join(dir, 'ct1.json'), 'utf8'));
  assert.ok(doc.candidates.length >= 2 && doc.candidates.length <= 4, '候选 2~4 个（铁律②）');
  let sawIntermediate = false;
  for (const c of doc.candidates) {
    // 加固②：只产出 roster 内真实 id
    for (const id of Object.keys(c.formation.positions)) assert.ok(roster.has(id), `位置 id ${id} 在名册内`);
    for (const m of c.formation.merges || []) {
      assert.ok(roster.has(m.a) && roster.has(m.b), '单元 id 在名册内');
    }
    assert.ok(c.preview.startsWith('<svg'), 'SVG 预览');
    if (c.props.legs) {
      sawIntermediate = true;
      assert.equal(c.props.legs.length, 2, '插入过渡变体记录两段');
      assert.ok(c.props.legs.every(l => l.ok === true), `两段 feasibility 都过 cap（${JSON.stringify(c.props.legs)}）`);
      assert.equal(c.props.legs[0].beats + c.props.legs[1].beats, 8, '两段拍数合计=可用拍数');
    }
  }
  assert.ok(sawIntermediate, '默认变体族含插入过渡队形');
  // 排序稳定可复现
  run('propose-transition.mjs', ['--from', '0', '--to', '1', '--beats', '8', '--count', '4', '--out', join(dir, 'ct2.json')], { dir });
  const doc2 = JSON.parse(readFileSync(join(dir, 'ct2.json'), 'utf8'));
  const strip = d => JSON.stringify(d.candidates);
  assert.equal(strip(doc), strip(doc2), '两次运行候选序与内容一致');
  rmSync(dir, { recursive: true, force: true });
});

test('propose-transition 加固②：roster 外 id 拒绝生成（退出码 1）', t => {
  const dir = workspaceWith2Formations();
  const pfile = join(dir, 'project.wuzhen.json');
  const p = JSON.parse(readFileSync(pfile, 'utf8'));
  p.formations[1].positions.ghost_id = { x: 3, y: 3, facing: 180 };
  writeFileSync(pfile, JSON.stringify(p, null, 2) + '\n');
  const r = spawnSync(node, [join(SCRIPTS, 'propose-transition.mjs'), dir, '--from', '0', '--to', '1'], { encoding: 'utf8' });
  assert.equal(r.status, 1, `应拒绝生成（实际 ${r.status}）\n${r.stdout}`);
  assert.ok(r.stderr.includes('名册外'), '提示名册外 id');
  rmSync(dir, { recursive: true, force: true });
});

test('propose-transition：未知变体族 / count 出界 / from=to 拒绝', t => {
  const dir = workspaceWith2Formations();
  run('propose-transition.mjs', ['--from', '0', '--to', '1', '--variants', 'spiral'], { dir, expect: 1 });
  run('propose-transition.mjs', ['--from', '0', '--to', '1', '--count', '6'], { dir, expect: 1 });
  run('propose-transition.mjs', ['--from', '1', '--to', '1'], { dir, expect: 1 });
  rmSync(dir, { recursive: true, force: true });
});

// ---------- 4) check/apply 加固②③ ----------
test('check 加固：roster 外 id → warning 决策点（候选与项目两种模式）', t => {
  const dir = workspaceWith2Formations();
  const doc = JSON.parse(readFileSync(join(dir, 'cf.json'), 'utf8'));
  doc.candidates[0].formation.positions.ghost_c = { x: 1, y: 1, facing: 180 };
  writeFileSync(join(dir, 'c-ghost.json'), JSON.stringify(doc, null, 2));
  const r = run('check.mjs', ['--candidate', join(dir, 'c-ghost.json'), '--pick', 'c1', '--json'], { dir });
  const rep = JSON.parse(r.stdout);
  assert.ok(rep.decisionPoints.some(p => p.type === 'unknown-dancer' && p.severity === 'warning'), '候选模式 unknown-dancer warning');
  assert.equal(rep.ok, true, 'warning 不改判通过');
  // 项目模式
  const pfile = join(dir, 'project.wuzhen.json');
  const p = JSON.parse(readFileSync(pfile, 'utf8'));
  p.formations[1].positions.ghost_p = { x: 2, y: 2, facing: 180 };
  writeFileSync(pfile, JSON.stringify(p, null, 2) + '\n');
  const r2 = run('check.mjs', ['--json'], { dir });
  const rep2 = JSON.parse(r2.stdout);
  assert.ok(rep2.decisionPoints.some(p2 => p2.type === 'unknown-dancer' && p2.severity === 'warning'), '项目模式 unknown-dancer warning');
  rmSync(dir, { recursive: true, force: true });
});

test('check/apply 加固③：自报 props 偏差 >5% → warning；精确 props 无 warning', t => {
  const dir = workspaceWith2Formations();
  // 精确 props（propose 原产物）→ 无 drift
  const r0 = run('check.mjs', ['--candidate', join(dir, 'cf.json'), '--pick', 'c1', '--beats', '8', '--json'], { dir });
  assert.equal(JSON.parse(r0.stdout).decisionPoints.filter(p => p.type === 'props-drift').length, 0, '精确 props 不报 drift');
  // 篡改 props → warning
  const doc = JSON.parse(readFileSync(join(dir, 'cf.json'), 'utf8'));
  doc.candidates[0].props.maxDist = Number(doc.candidates[0].props.maxDist) + 5;
  doc.candidates[0].props.movedCount = 99;
  writeFileSync(join(dir, 'c-drift.json'), JSON.stringify(doc, null, 2));
  const r = run('check.mjs', ['--candidate', join(dir, 'c-drift.json'), '--pick', 'c1', '--beats', '8', '--json'], { dir });
  const rep = JSON.parse(r.stdout);
  const drifts = rep.decisionPoints.filter(p => p.type === 'props-drift');
  assert.ok(drifts.length >= 2, `maxDist/movedCount 都应报 drift（实际 ${drifts.length}）`);
  assert.ok(drifts.every(p => p.severity === 'warning'), 'drift 是 warning 级');
  // apply 侧同样告警（dry-run 即打印，退出码 3）
  const ra = spawnSync(node, [join(SCRIPTS, 'apply.mjs'), dir, join(dir, 'c-drift.json'), '--pick', 'c1'], { encoding: 'utf8' });
  assert.equal(ra.status, 3);
  assert.ok((ra.stdout + ra.stderr).includes('偏差'), 'apply 打印 props 偏差警告');
  rmSync(dir, { recursive: true, force: true });
});

// ---------- 5) propose-timeline（Phase 3 音乐匹配） ----------
test('propose-timeline 样例歌：总拍数对齐 / 密度块数一致 / 全变换 feasible / 逐段 apply 后往返无损', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '6', '--preset-merged', '--bpm', '120', '--title', '样例歌'], { dir });
  const sectionsFile = join(dir, 'sections.json');
  writeFileSync(sectionsFile, JSON.stringify(SAMPLE_SECTIONS));
  run('analyze-music.mjs', ['--bpm', '120', '--sections', sectionsFile], { dir });

  run('propose-timeline.mjs', ['--report', join(dir, 'music-report.json'), '--out', join(dir, 'proposal.json')], { dir });
  const prop = JSON.parse(readFileSync(join(dir, 'proposal.json'), 'utf8'));
  // 总拍数对齐：= Σ 段落拍数 = 120
  assert.equal(prop.totalBeats, 120);
  // 块数与密度规则一致：reset 整段 1 块 / small 16 拍一变 → 2 块 / big 8 拍一变 → 4 块
  assert.equal(prop.sections.map(s => s.blocks).join(','), '1,2,4,1,4,1');
  assert.equal(prop.sections.map(s => s.density).join(','), 'reset,small,big,reset,big,reset');
  assert.equal(prop.formations.length, 13);
  assert.equal(prop.blocks.length, 13);
  // 末块 travel=0；其余块 hold+travel=span（总拍数守恒）
  assert.equal(prop.blocks[12].travelBeats, 0);
  for (const b of prop.blocks) assert.equal(b.holdBeats + b.travelBeats, b.span, `块 ${b.index} hold+travel=span`);
  // 全部变换 feasibility ok
  assert.ok(prop.transitions.length === 12);
  assert.ok(prop.transitions.every(tr => tr.ok === true), `全部变换可行（${JSON.stringify(prop.transitions.filter(tr => !tr.ok))}）`);
  // 每段候选文件存在且带 block 提示
  for (const s of prop.sections) {
    assert.ok(existsSync(s.candidatesFile), s.candidatesFile);
    const sec = JSON.parse(readFileSync(s.candidatesFile, 'utf8'));
    assert.equal(sec.candidates.length, s.blocks);
    for (const c of sec.candidates) {
      assert.ok(c.block && Number.isFinite(c.block.holdBeats), '候选带 block 提示');
      assert.ok(c.preview.startsWith('<svg'), '候选带 SVG');
    }
  }
  // 提案可复现（createdAt 除外）
  run('propose-timeline.mjs', ['--report', join(dir, 'music-report.json'), '--out', join(dir, 'proposal2.json')], { dir });
  const prop2 = JSON.parse(readFileSync(join(dir, 'proposal2.json'), 'utf8'));
  assert.equal(JSON.stringify({ ...prop, createdAt: 0 }), JSON.stringify({ ...prop2, createdAt: 0 }), '提案稳定可复现');

  // 逐段 apply（人拍板一段 → apply 一段：一段一快照）
  prop.sections.forEach((s, i) => {
    run('check.mjs', ['--candidate', s.candidatesFile, '--beats', String(prop.blocks[s.formations[0]].travelBeats || 4)], { dir, expect: 0 });
    run('apply.mjs', [s.candidatesFile, '--all', '--yes'], { dir });
  });
  // 应用后：队形/块/总拍数与提案一致，全部变换 feasible
  const project = JSON.parse(readFileSync(join(dir, 'project.wuzhen.json'), 'utf8'));
  assert.equal(project.formations.length, 13);
  assert.equal(project.timeline.blocks.length, 13);
  const { totalBeats } = core.computeSegments(project);
  assert.equal(totalBeats, 120, 'computeSegments 总拍数=120');
  prop.blocks.forEach((b, i) => {
    assert.equal(project.timeline.blocks[i].holdBeats, b.holdBeats, `块 ${i} hold 一致`);
    assert.equal(project.timeline.blocks[i].travelBeats, b.travelBeats, `块 ${i} travel 一致`);
  });
  for (let i = 0; i < 12; i++) {
    const f = core.feasibility(project.formations[i], project.formations[i + 1], project.timeline.blocks[i].travelBeats, project.audio.bpm, 1.2);
    assert.ok(f.ok, `应用后变换 ${i}→${i+1} 可行（需 ${f.maxNeededDist}m / ${f.availableDist}m）`);
  }
  // 每段一快照（v1..v6）
  for (let v = 1; v <= 6; v++) assert.ok(existsSync(join(dir, '.snapshots', `v${v}.json`)), `快照 v${v} 存在`);
  // export 往返无损（逐字节）
  const rr = run('export-import.mjs', ['roundtrip'], { dir });
  assert.ok(rr.stdout.includes('逐字节一致，无损'));
  run('export-import.mjs', ['export', '--out', join(dir, 'exported.json')], { dir });
  const v = core.validateProject(JSON.parse(readFileSync(join(dir, 'exported.json'), 'utf8')));
  assert.equal(v.ok, true, '导出 JSON 硬校验通过');
  rmSync(dir, { recursive: true, force: true });
});

test('propose-timeline 负路径：缺 report / 报告缺 sections', t => {
  const dir = tmp();
  run('state.mjs', ['init', '--pairs', '2'], { dir });
  run('propose-timeline.mjs', [], { dir, expect: 1 });
  const bad = join(dir, 'bad-report.json');
  writeFileSync(bad, JSON.stringify({ bpm: 120, sections: [] }));
  run('propose-timeline.mjs', ['--report', bad], { dir, expect: 1 });
  rmSync(dir, { recursive: true, force: true });
});
