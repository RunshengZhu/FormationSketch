// wuzhen-core 打包：js/model.js + js/shapes.js + js/choreo-extra.js → dist/core/wuzhen-core.mjs
// 单文件 ESM，Node 可直接 import；与 app 同一源码文件，零漂移。
// 做法（参照 build-single.mjs 的正则法，core 无外部依赖、更简单）：
//   1) 去掉模块间相对 import（core 内三文件只互相依赖，拼接后即局部名）；
//   2) 去掉 export 前缀并收集导出名；
//   3) 按依赖序拼接 + 末尾统一 export 块；
//   4) 顶层名冲突检查 + 动态 import 产物自检（导出齐全、可执行）。
// 用法：node scripts/build-core.mjs [--out <path>]
//   --out 缺省 dist/core/wuzhen-core.mjs；自定义路径用于防陈旧校验
//   （dancesport-choreo skill 测试：重建到临时文件与 vendor/ 逐字节比对）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 && process.argv[outIdx + 1] ? resolve(process.argv[outIdx + 1]) : join(root, 'dist', 'core', 'wuzhen-core.mjs');
// 依赖拓扑序（被依赖者在前）
const ORDER = ['model', 'shapes', 'choreo-extra'];

const transformModule = (mod) => {
  const file = join(root, 'js', `${mod}.js`);
  let code = readFileSync(file, 'utf8');
  const exportNames = [];

  // 1) 聚合并移除相对 import：import { A, B as C } from './x.js' / import * as X from './x.js'
  const nsAliases = new Map();          // alias -> source module
  const namedBySource = new Map();      // source -> Map(local -> imported)
  code = code.replace(/^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'\.\/([\w]+)\.js';?\s*$/gm,
    (m, starName, named, src) => {
      if (starName) nsAliases.set(starName, src);
      else {
        if (!namedBySource.has(src)) namedBySource.set(src, new Map());
        for (const spec of named.split(',')) {
          const t = spec.trim();
          if (!t) continue;
          const [imp, local = imp] = t.split(/\s+as\s+/);
          namedBySource.get(src).set(local.trim(), imp.trim());
        }
      }
      return `/* import from ${src}（拼接后为局部名） */`;
    });

  // 拼接后所有名字本就在同一作用域，import 无需生成绑定，只留注释说明来源：
  const preludeText = [
    ...[...nsAliases.keys()].map(a => `/* namespace alias ${a} → 同作用域（拼接） */`),
    ...[...namedBySource.entries()].map(([src, map]) =>
      `/* from ${src}: ${[...map.keys()].join(', ')} → 同作用域（拼接） */`),
  ].join('\n');

  // 2) 去 export 前缀，收集导出名（含 async function / function*）
  code = code.replace(/^export\s+(async\s+function|function\*?|const|class|let)\s+(\w+)/gm, (m, kind, name) => {
    exportNames.push(name);
    return `${kind} ${name}`;
  });
  code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, ''); // 具名导出列表（如有）

  // 3) 顶层声明名收集（含私有），供跨文件冲突检查
  const declared = new Set();
  for (const m of code.matchAll(/^(?:async\s+)?function\*?\s+(\w+)|^(?:const|let|class)\s+(\w+)/gm)) {
    declared.add(m[1] || m[2]);
  }
  return { mod, code, exportNames, declared, preludeText };
};

const modules = ORDER.map(transformModule);

// 冲突检查：三文件拼接进同一作用域，任何顶层重名都是语法错误，构建即失败
const seen = new Map();
for (const { mod, declared } of modules) {
  for (const name of declared) {
    if (seen.has(name)) throw new Error(`顶层名冲突：${name} 同时声明于 ${seen.get(name)} 与 ${mod}.js（拼接打包要求全局唯一）`);
    seen.set(name, mod);
  }
}

// 组装单文件 ESM
let out = `/* wuzhen-core —— 由 scripts/build-core.mjs 生成，勿手改。
 * 源文件：${ORDER.map(m => `js/${m}.js`).join(' + ')}（与 app 同源，零漂移）
 * 重建：node scripts/build-core.mjs
 */
`;
for (const { mod, code, preludeText } of modules) {
  out += `\n/* ===== module: ${mod}.js ===== */\n${preludeText ? preludeText + '\n' : ''}${code.trim()}\n`;
}
out += `\nexport {\n`;
for (const { mod, exportNames } of modules) {
  if (!exportNames.length) continue;
  out += `  /* ${mod}.js */\n  ${exportNames.join(',\n  ')},\n`;
}
out += `};\n`;

// 静态自检：拼接结果不得残留模块级 import/export（末尾统一导出块除外）
const body = out.slice(0, out.lastIndexOf('\nexport {'));
if (/^import\s/m.test(body) || /^export\s+(?!function|const|let|class)/m.test(body.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  throw new Error('产物中残留 import/export 语句，转换不完整');
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

// 运行时自检：产物可 import、导出齐全、核心函数可调用
const core = await import(pathToFileURL(OUT));
const missing = [];
for (const { mod, exportNames } of modules) {
  for (const name of exportNames) if (typeof core[name] === 'undefined') missing.push(`${mod}.${name}`);
}
if (missing.length) throw new Error(`产物导出缺失：${missing.join(', ')}`);
const smoke = core.createProject({ pairs: 2 });
if (smoke.dancers.length !== 4 || typeof core.toSVG(smoke.formations[0], { stage: smoke.stage, dancers: smoke.dancers }) !== 'string') {
  throw new Error('产物冒烟自检失败（createProject/toSVG）');
}
console.log(`已生成 ${OUT}（${(out.length / 1024).toFixed(1)} KB，${modules.map(m => `${m.mod}:${m.exportNames.length}`).join(' + ')}，共 ${Object.keys(core).length} 个导出，自检通过）`);
