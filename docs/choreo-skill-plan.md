# dancesport-choreo · 辅助创作 skill 实施计划

> 定位：**人在回路的编排辅助**，不是全自动生成器。App 是唯一事实源（project JSON 双向往返），
> skill 提供「枚举候选、算账、画图、体检」四类原子能力，艺术决策始终由人做出。

## 已有功能盘点（skill 直接复用，不新造）

| 已有能力 | 位置 | skill 用途 |
|---|---|---|
| 8 种队形参数化生成 `genSlots(kind,count,stage,opts)` | js/shapes.js | propose-formations 的候选引擎 |
| 按序落位 `applySlots` + 单元感知 `expandUnits` | js/shapes.js / model.js | 合并单元整单元占位 |
| 变换原语 `mirrorH/mirrorV/rotateSelected/distributeAxis/swapTwo/faceAll` | js/shapes.js | propose-transition 的候选变体 |
| 合并 `addMerge/collapseUnit`、`UNIT_STYLES` | js/model.js | 组合单元编排 |
| 音乐换算 `spb/beatToSec/secToBeat`、blocks↔formations 同步 | js/model.js | 音乐匹配落时间轴 |
| 校验 `validateProject` | js/model.js | 硬校验闭环 |
| 导入 `store.importProject(json)`（app 内已有入口） | js/store.js | 交付通道 v1 |
| 公网托管层 + `/apps/wuzhen/` inline 入口 | 8321 服务 | 交付通道 v2（深链） |

## Phase 0 · wuzhen-core（Node 可用核心）——目标：单一事实源

- 新增纯函数：`toSVG(formation, {stage})`（零依赖 SVG 字符串，候选可视化）、`diffFormations(a,b)`（移动量/人员变化摘要）、`feasibility(from,to,beats,bpm)`（速度上限可行性分）。
- `scripts/build-single.mjs` 增产 `dist/core/wuzhen-core.mjs`：打包 model+shapes 纯函数与上述新增，Node ESM 可直接 import。
- **验收**：新增 tests/core.test.js 与 app 同源跑（建队形/变换/校验/SVG）；core 与 app 用同一源码文件，零漂移；npm test 全绿。

## Phase 1 · skill 骨架（dancesport-choreo 安装到 ~/.agents/skills/）——目标：交互协议立起来

- `SKILL.md`：能力目录 + **交互协议**（①一次只推进一个决策点；②候选 2~4 个、每候选带 SVG 图与量化属性；③apply 必须经人确认；④每 apply 存版本快照；⑤禁止一次生成整支舞）。
- 状态管理：工作目录内 `project.wuzhen.json`（事实源）+ `.snapshots/v*.json`（每次 apply 存档）。
- 脚本骨架（薄包装 core）：`analyze-music.mjs`、`propose-formations.mjs`、`propose-transition.mjs`、`apply.mjs`、`check.mjs`、`export.mjs/import.mjs`。
- **验收**：示例项目（12 人 6 单元）端到端演练：导入 → 提议 → 人选 → 应用 → 体检 → 导出 → 回 app 打开无损。

## Phase 2 · 能力实现与规则库——目标：候选有据、体检有牙

- `propose-formations`：8 种队形 × 参数（单元感知、行距、朝向 faceAll）→ 候选集 + SVG + 属性（分散度/对称度/与上段移动量）。
- `propose-transition`：A→B 变体（直接/mirrorH/rotateSelected/插过渡队形）+ `feasibility` 分（需移动距离 ÷ 可用拍数 × BPM ≤ 速度上限）。
- `check`：validateProject 硬校验 + 软规则（越界/最小间距/速度上限/拍数对齐），输出决策点清单；**能抓植入违规**（测试注入坏数据必须被拦）。
- `analyze-music`：BPM+首拍+段落表 → 拍数结构报告（人确认音乐理解）。
- **验收**：植入违规样例 100% 被抓；候选评分排序稳定可复现。

## Phase 3 · 音乐匹配落地——目标：段落表变时间轴

- 段落表（人工提供：前奏 8 拍/主歌 32/副歌 32…）→ 变换密度规则（8/16 拍一变、副歌大调度、主歌小调度、间奏重置）→ 生成 formations + blocks（复用 blocks↔formations 同步与 spb/beatToSec），总拍数=歌曲节拍。
- **验收**：样例歌曲（BPM 120、128 拍）生成的时间轴在 app 中播放对齐；C-07 回归不受影响。

## Phase 4 · 深链交付——目标：点开链接=编排好的项目

- app 小改：`/apps/wuzhen/?import=<URL>` boot 时 fetch URL → importProject（SW navigate 缓存需兼容带 query 的入口，实现轮细化）。
- skill：`publish.mjs` 上传 JSON 到 wuzhen-release 层 → 产出深链（可进微信）。
- **验收**：公网点深链载入项目；既有离线/持久化回归（IR-06/07）不回归。

## Phase 5 · 打磨（backlog）

规则文件每项目可配（.choreo-rules.json）、更多队形/风格模板、真机确认清单消化、音频自动节拍分析（v3 研究）。

## 里程碑与验收总表

| Phase | 交付物 | 验收硬指标 | 预估轮次 |
|---|---|---|---|
| 0 | wuzhen-core.mjs | node import + 同源单测绿 | 0.5 |
| 1 | skill 骨架 + 协议 | 端到端往返演练 | 1 |
| 2 | 6 能力 + 规则库 | 违规 100% 拦截、候选带 SVG | 1 |
| 3 | 音乐匹配 | 样例歌时间轴对齐 | 1 |
| 4 | 深链交付 | 公网点链接载入 | 0.5 |
| 5 | 打磨 | backlog | 按需 |

## 风险与边界（诚实声明）

- 音乐/艺术判断始终在人：skill 的评分只是几何/时间可行性，不代表好看好跳；
- iOS Safari 7 天存储清理策略（装到主屏可豁免）影响深链渠道的数据持久预期；
- WebKit 真机特性（长按放大镜等）维持真机人工确认清单。
