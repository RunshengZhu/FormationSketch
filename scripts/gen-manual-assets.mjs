// 说明书图片资产生成器：把 scripts/manual-assets.json（单一事实源）转成 ES 模块
// js/manual-assets.js（export const），供 js/manual.js 静态 import 与 build-single 打包。
// 为什么不直接 import JSON：import attributes（with { type: 'json' }）要求较新浏览器，
// 与本项目「零依赖、老 Safari 可用」的兼容底线冲突；Node 单测也直接 import 本产物。
// 用法：node scripts/gen-manual-assets.mjs   （JSON 更新后重跑；产物勿手改）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'scripts', 'manual-assets.json');
const OUT = join(root, 'js', 'manual-assets.js');

const json = JSON.parse(readFileSync(SRC, 'utf8'));
const keys = Object.keys(json.images || {});
if (!keys.length) throw new Error('manual-assets.json 无 images');
for (const k of keys) {
  const v = json.images[k];
  if (typeof v !== 'string' || !v.startsWith('data:image/jpeg;base64,')) {
    throw new Error(`images.${k} 不是 image/jpeg base64 data URI`);
  }
}

const banner = `// 自动生成：由 scripts/gen-manual-assets.mjs 从 scripts/manual-assets.json 生成，勿手改。
// 说明书截图（真实拍摄 + JPEG 压缩；build-59-manual4 起 lab manual-shots-v4.mjs DPR2 高清重拍），
// js/manual.js 经 import 使用；node 单测直接 import 校验。
export const MANUAL_META = ${JSON.stringify(json.meta, null, 2)};
export const MANUAL_IMAGES = {
${keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(json.images[k])},`).join('\n')}
};
`;

writeFileSync(OUT, banner);
console.log(`已生成 ${OUT}（${keys.length} 张图，meta.generatedAt=${json.meta?.generatedAt || '-'}）`);
