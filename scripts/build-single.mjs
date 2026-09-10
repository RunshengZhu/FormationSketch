// 极简单文件打包：把 index.html + css + 全部 JS 模块合并为一个可直接双击打开的 HTML
// 用法：node scripts/build-single.mjs  → 产物 dist/formation-studio.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'dist', 'formation-studio.html');

// 依赖拓扑序（被依赖者在前）
const ORDER = ['model', 'shapes', 'store', 'audio', 'player', 'stage', 'timeline', 'export', 'ui', 'main'];
// 'export' 是保留字，命名空间键用 exporter
const nsKey = mod => (mod === 'export' ? 'exporter' : mod);

function transformModule(mod) {
  const file = join(root, 'js', `${mod}.js`);
  let code = readFileSync(file, 'utf8');
  const NS = `FS.${nsKey(mod)}`;
  const prelude = [];
  const exportNames = [];

  // 1) 聚合 import：import * as X from './y.js' / import { A, B as C } from './y.js'
  const nsAliases = new Map(); // alias -> source
  const namedBySource = new Map(); // source -> Map(localName -> importedName)
  code = code.replace(/^import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'\.\/([\w]+)\.js';?\s*$/gm,
    (m, starName, named, src) => {
      const key = nsKey(src);
      if (starName) nsAliases.set(starName, key);
      else {
        if (!namedBySource.has(key)) namedBySource.set(key, new Map());
        for (const spec of named.split(',')) {
          const t = spec.trim();
          if (!t) continue;
          const [imp, local = imp] = t.split(/\s+as\s+/);
          namedBySource.get(key).set(local.trim(), imp.trim());
        }
      }
      return `/* import from ${src} */`;
    });

  for (const [alias, key] of nsAliases) prelude.push(`const ${alias} = FS.${key};`);
  for (const [key, map] of namedBySource) {
    const specs = [...map.entries()].map(([local, imp]) => (local === imp ? imp : `${imp}: ${local}`)).join(', ');
    prelude.push(`const { ${specs} } = FS.${key};`);
  }

  // 2) 去掉 export 前缀，收集导出名（含 async function）
  code = code.replace(/^export\s+(async\s+function|function\*?|const|class)\s+(\w+)/gm, (m, kind, name) => {
    exportNames.push(name);
    return `${kind} ${name}`;
  });
  code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

  // 3) 组装 IIFE
  const assigns = exportNames.length ? `Object.assign(${NS}, { ${exportNames.join(', ')} });` : '';
  return `${NS} = FS.${nsKey(mod)} || {};\n(function(){\n'use strict';\n${prelude.join('\n')}\n${code}\n${assigns}\n})();`;
}

// ---- 组装 ----
const css = readFileSync(join(root, 'css', 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');

let bundle = `/* Formation Studio 单文件版 —— 由 scripts/build-single.mjs 生成，勿手改 */
window.FS = window.FS || {};
`;
for (const mod of ORDER) {
  bundle += `\n/* ===== module: ${mod} ===== */\n`;
  bundle += `FS.${nsKey(mod)} = FS.${nsKey(mod)} || {};\n`;
  bundle += transformModule(mod);
  bundle += `\n`;
}
if (/<\/script>/i.test(bundle)) throw new Error('bundle 中含有 </script>，需转义');

html = html.replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>', `<script>\n${bundle}\n</script>`);
if (html.includes('css/style.css') || html.includes('js/main.js')) throw new Error('仍有外部资源引用未替换');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`已生成 ${OUT}（${(html.length / 1024).toFixed(1)} KB）`);
