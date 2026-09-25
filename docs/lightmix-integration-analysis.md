# 音乐剪辑能力集成分析（lightmix → WuZhen）

> 问题：能否把 lightmix（sess_044daf25，Adobe Audition 风格网页多轨混音器）的**基础音乐剪辑能力**集成进 WuZhen，
> 作为剪辑专用功能，并与队形编排形成联动？
> 结论：**可行。推荐「引擎嵌入」模式，分三期**。基础剪辑（裁/切/移/淡化/导出）不引入任何 WASM 与构建链污染。

## 1. 两侧现状

### lightmix（能力供给方）
- 纯浏览器实现：Web Audio API 全链（decode→Gain 淡化→轨道→Master），float32；**运行时零依赖**（构建期 Vite/Vitest，46 测试）。
- 可复用的独立模块：`AssetStore`（导入解码/重采样 48k）、波形峰值金字塔（Worker，绘制代价与音长无关）、`wav.ts`（手写 16/24/32bit encoder）、`renderMixdown`（OfflineAudioContext 离线渲染，"听到即导出"）、`zerocross`（零交叉吸附消咔哒）、clip 模型（trim/split/move/ fades/交叉淡化/增益包络）。
- 变速/转调（signalsmith-stretch，WASM）与多轨混音台为可选能力——**基础剪辑不需要它们**。
- 工程文件 `.lmproj.json` 为引用式；无 REST API；集成=文件级。
- 已知缺口：OPFS 持久化未接、无 limiter、MP3 导出未做、导出下载缺无头 E2E。

### WuZhen（需求方）
- 已有：单音频载入（AudioController）、双时钟播放（音乐/虚拟）、时间轴 blocks（队形段，拍基）、**BPM/首拍/beatToSec 秒制换算已存在**、tag 道（音乐分段标记，v0.9.18）、scrub/循环/缩放、导出含乐 v2（dataBase64 内嵌）。
- 缺口：波形不可视、无法裁剪/切割音乐、无法按队形段对齐音乐、无淡化、无混音导出。
- 架构约束：零依赖、单文件 HTML（build-single 打包）、无构建链——**lightmix 是 TS/Vite 构建，但其产物是普通 JS；WuZhen 只 vendor 产物，不引入构建链**（与 wuzhen-core 反向 vendor 同理）。

## 2. 三种集成模式

| 模式 | 形态 | 成本 | 判定 |
|---|---|---|---|
| A · 文件往返 | WuZhen 导出「音乐+段落标记」→ lightmix 剪辑 → 导出 WAV 回载 | 最低（几乎零开发） | 兜底保留；两次手工、体验割裂，不作主方案 |
| **B · 引擎嵌入（推荐）** | lightmix 的**纯音频模块**构建为 `vendor/lightmix-audio.mjs` 产物（decode/金字塔/clip 调度/mixdown/wav/zerocross，**剔除**变速 WASM 与多轨 UI），WuZhen 时间轴新增「音乐剪辑道」 | 中（1~2 轮） | 单文件原则可保（产物内联）；能力即插即用 |
| C · 双应用互操作 | iframe/深链互导（.lmproj + 音频） | 中高 | 体验割裂、双事实源，不推荐 |

## 3. 模式 B 设计要点（剪辑专用 + 队形联动）

### 3.1 数据模型（并入 project，可序列化、随导出往返）
```
timeline.audioClips: [{
  id, srcStartSec, lengthSec,      // 引用同一音频资产（非破坏）
  timelineStartSec,                // 时间轴落点（秒制；拍位换算已由 beatToSec 覆盖）
  fadeInSec, fadeOutSec, gain
}]
```
- 非破坏引用（与 lightmix clip 同构），原音频 blob 不动；
- 导出 v2 dataBase64 语义不变，clips 随行；validateProject 清洗（越界钳制、重叠策略）。

### 3.2 UI（时间轴内新增「音乐剪辑道」，与 tag 道同级）
- 波形道：金字塔波形按 clips 渲染（缩放联动已有 pps 体系）；
- 手柄：左右缘 trim（受音频边界约束）、播放头分割（复用 Ctrl/Cmd+K 习惯）、拖移整段；
- 淡化：段缘 fade 手柄（横拖时长）；零交叉吸附（消切点咔哒）；
- **联动一「按队形段自动切」**：以 blocks 边界（beatToSec 已有）为分割点一键生成剪辑段，段间自动交叉淡化（过渡拍数=淡化时长上限）——队形换形即音乐换段；
- **联动二「吸附到块边界/tag」**：剪辑边缘吸附候选加入块边界与 tag 拍位（换算为秒）；
- **联动三「段长反推」**：选区长度 ↔ 拍数换算提示（该段 X 秒=Y 拍@BPM），辅助音乐-队形对齐校准。

### 3.3 播放/导出
- 播放：AudioController 接 clip 调度（Tale of Two Clocks 调度参数直接抄 lightmix）；双时钟语义不变——音频通道按剪辑后的有效区间驱动，虚拟时钟接管逻辑沿用轮20 守卫；
- 导出：`renderMixdown`（OfflineAudioContext）产出「表演用混音」→ 可一键替换项目配乐（非破坏，原 blob 保留）或另存下载。

### 3.4 风险与对策
| 风险 | 对策 |
|---|---|
| TS 构建产物进入零依赖仓 | 只 vendor 构建产物文件；lightmix 仓负责产出与测试，WuZhen 仓零构建链 |
| 体积 | 基础剪辑子集预估 gzip +40~70KB（远小于说明书 +308KB 先例）；不含 WASM |
| 双时钟边界（剪辑播放 vs 队形时钟） | 剪辑区间的播放头映射统一走 beatToSec 秒制；轮20 守卫（播放中禁改 BPM/首拍）天然消掉大半边界竞态 |
| 移动端性能 | 金字塔波形绘制代价与音长无关（Worker 预算），375 视口按既有缩放体系裁剪绘制窗口 |

## 4. 分期建议

| 期 | 范围 | 验收口径 |
|---|---|---|
| v1 基础剪辑 | 波形道 + trim/split/移除 + 零交叉吸附 + 段淡入淡出 + 导出 WAV 替换配乐 | 剪辑往返无损、播放对齐、IR/场景回归绿 |
| v2 队形联动 | 按队形段自动切、块边界/tag 吸附、段长↔拍数反推、mixdown 导出 | 一首歌×10 段队形的对齐在 3 分钟内完成（人工计时口径） |
| v3 进阶 | 变速（WASM）、多段重排 ripple、OPFS 工程持久 | 按需 |

## 5. 需要拍板
1. 集成模式确认（建议 B）；
2. v1 是否接受「vendor 构建产物」进入仓库（唯一架构让步，先例：wuzhen-core 反向 vendor）；
3. 变速/转调是否进范围（建议 v1 不进，避免 WASM）。
