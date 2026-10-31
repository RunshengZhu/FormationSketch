# 舞阵 WuZhen · 项目状态（PROJECT_STATE）

> 维护约定：每次里程碑收口或会话轮转时更新本文件（机械蒸馏 + 人工校订，流程见 [docs/ROTATION.md](ROTATION.md)）。
> 本版：2026-10-04 · 由旧主会话 sess_030986dd（09-08→10-04）轮转时校订产出。

## 当前状态（一句话）

线上生产 build-90-gapfix（build-88-waveui 四项 + 有限同步修复 + 轨头空列修复，750/750）；
**build-91-varispeed（clip 滑动变速/变调 DSP 管线，783/783）已部署测试端点待真机验收**，
验收后晋升 release。旧主会话已归档，后续迭代在新会话按本文件 + CLAUDE.md 冷启动。

## 部署通道（build-88 起新流程：开发 → 测试端点 → 验收 → 晋升）

- **测试端点**：`wuzhen-test` 层 → http://59.110.90.21:8321/files/wuzhen-test/index.html
  ——常规开发构建先落此处（sw.js 同步），不影响生产用户；当前 build-90-gapfix；
- **生产端点**：`wuzhen-release` 层 → http://59.110.90.21:8321/files/wuzhen-release/index.html
  （/apps/wuzhen inline 入口同源）——仅验收通过后晋升（同 admin PUT 覆盖）；
- 上传/验证/凭证同「已知坑」节。两 tier 均已在 8321 服务建层（2026-10-07）。

## 最近交付（build-90-gapfix，10-07，轨头双偏移空列修复）

| build | 内容 | 状态 |
|-------|------|------|
| build-91-varispeed | **clip 滑动变速（varispeed，磁带式）**：clip.rate 字段（0.25–4.00，1% 粒度，缺省删键）；调度 playbackRate 组合乘（clip×传输，源消耗=slot×rate）；波形按 rate 映射（缓存键含 rate）+ ×徽标；clip 菜单「变速」滑杆（免历史实时预览 + 松手恰一条历史）+ 变速重置；mixClipInto 源读取 ×rate（视频/音频导出共用）。slot 长度不变（对齐不被扰动）；rate>1 源提前耗尽=槽尾静音（磁带自然行为）。subagent L(引擎/数据)+N(波形/UI) 并行 | 测试端点待真机验收（IAB 三次环境楔死：AudioWorklet 离线渲染/模块加载不完成——真机浏览器无此限；波形压缩与徽标截图验证过；单测覆盖混音/调度/清洗数学） |
| build-90-gapfix | **轨头双偏移空列修复**（用户实测：音轨卡片打开时轨头右侧恒定一条 96/148px 纵向空列占据轨道区）。根因：`_syncCanvasOffset` 的 `+ headWidth()` 为 build-46 前「轨头浮层时代」遗留——build-46 轨头改 flow 列后 #tl-inner 已从轨头右缘起排，该偏移成双重叠加。修复：canvas left 只随 scrollLeft | 已晋升生产 |

### 此前批次（build-89-syncn = build-88-waveui 四项 + 收口修复，10-07，生产=修复前版本）

| build | 内容 | 状态 |
|-------|------|------|
| build-89-syncn（收口修复） | ①**有限同步 N 失效修复**：调用点 `count: countNow` 漏 `()` 传函数 → Number.isFinite 恒 false → n 恒 Infinity 同步全部（用户实测）——补 `()` + 回归钉防回潮；②轨头建卡去 hidden 早退门（切模式首帧 hidden 未翻转时卡片缺失到下次渲染——窄屏实测缝隙）；窄屏轨头卡片几何仍需真机目检（IAB 375 模拟不可靠） | 已晋升生产 |
| build-88-waveui（J·timeline.js） | ①波形高精度：视口像素列直采解码 AudioBuffer 真 min/max（columnMinMax 纯函数，stride≤64），gain×fade 三路径同源，列极值 LRU（键=assetId\|srcStart\|列数，上限 8）；resolveBuffer 构造钩子（缺省回退 peaks 链）；②视口窗口渲染：画布=视口 lane 宽、#tl-inner 撑世界宽、ctx.translate(−scrollLeft)，全部绘制函数世界坐标零改写+出窗 early-skip——pps 量程 PPS_MIN=4/PPS_MAX=2400（采样级），8192 物理钳制转护栏；③尺规带（y≤22）滚轮缩放（zoomAt 锚点，双模式，wheelZoomStep 纯函数 ×1.15^±3）；④剃刀单发 API cutSelectedClipAtPlayhead()（复用 splitAtSec 一条历史；reason 三态）。性能实测：采样级逐列 0.71ms/帧、缓存命中 0.26ms/帧 | 已晋升生产 |
| build-88-waveui（K·main/index） | ①⌘K/Ctrl+K 快捷键（音乐模式限定，preventDefault，toast 反馈；编舞侧旧 ⌘K 分队形按需求移除留墓碑）；②剃刀钮改单发执行（toggle 态全量退役，三入口钮/⌘K/R 同一执行面 cutSelectedClipAtPlayheadUI）；③resolveBuffer 构造接线（ensureAssetBuffer——覆盖缺失重解码）；④说明书/工具条文案单发口径 | 已晋升生产 |
| build-86-mp3out（修复版） | 白屏二次根因（ORDER 漏 mp3-encoder→解构 undefined）修复 + E3 命名空间覆盖防线；MP3 导出功能（LAME 软编 + Mp3OutputFormat + 格式选择弹窗） | 验收通过已上线 |
| build-85-audioonly | 仅导出音频（M4A）：exportAudio 离线混音+Mediabunny 音频轨+三态选路 | 验收通过已上线 |
| build-84-bcrow | 块时长行单行钉死；底区操作栈钉底；横滚条加高抬离 | 验收通过已上线 |

build-80-mb（10-05）：视频导出迁移 Mediabunny（+WASM AAC 软编 T2；MediaRecorder 路废弃删除）。
build-79-tlui（10-05）：十项体验批次（tag 描述/去 ×/同步前后 N/名册上场 toggle/生成过滤/秒制等）。

## 已知怪癖（自动化/环境，非产品缺陷）

- **IAB 首载旧模块**：ZCode 内嵌浏览器新开标签首载偶尔命中上一会话的模块缓存（页面 reload 即愈），
  自动化测试时若 import 面与磁盘不符先 reload 再断言。
- **IAB 音频节流**：内嵌 webview 对 MediaRecorder 录制的音频渲染降频/冻结（keepWarm 支路 +
  2.5×+10s 死限护栏兜底）；真实浏览器前台用户手势场景正常，兜底路真机耗时≈视频时长。

更早：build-44~68 共 24 版（移动端三优化 build-66/67/68、说明书五幕 user story 重构 build-57/…），
功能明细以 [README.md](../README.md) 为准。

## 下一步（backlog，接手会话先与用户确认优先级再动工）

1. 分享重设计
2. HTTPS 托管（SW 断网缓存依赖安全上下文，见 README「运行」节）
3. 过渡插值
4. 节奏图立项
5. iPad AAC 真机确认

## 已知坑与对策

- **dist 单文件白屏（build-78/79 曾中招，已根治+双防线）**：build-single.mjs 的 nsKey 连字符
  映射表漏新模块（video-recorder）→ 产物 `FS.video-recorder` 非法标识符 → classic 整包语法
  错误 → 单文件版全平台白屏。**源码模式 e2e（localhost:8124）测不到此类缺陷**——防线：
  ① nsKey 构建期标识符校验（漏配映射构建当场失败）；② checkupdate E2 编译冒烟
  （new Function 编译整包 + FS.<key> 连字符零残留断言）。**新增带连字符 JS 模块后必须
  同步 nsKey 映射，且交付前开一次 dist 本体目检**。
- **「上线」= 推托管，不是只重建 dist**（build-74 轮教训）：本地 `npm run build:single` 后必须
  上传文件托管服务（dancesport-files skill）的 `wuzhen-release` 层，覆盖 `index.html`（入口，
  即 dist/formation-studio.html）与 `sw.js` 两个文件，用户端「检查更新」才拉得到新版；
  验证：`curl -s <BASE>/files/wuzhen-release/index.html | grep __MAIN_BUILD`。
  `/apps/wuzhen` inline 入口由托管服务直接吐同字节文件（content-disposition inline）。
- **托管上传凭证**：config.env 的层 Bearer 读可用、写 401（2026-10-04 实测）——上传走
  管理员口令换 session Cookie（`POST /api/login` → `Cookie: session=…` PUT）。

- **收尾循环**（已根治但需警惕复发）：旧会话曾因上下文 96 万 token 失稳，回合末反复调
  `mcp__node_repl__js` 漏 `code` 发"完成标记"，129 次 schema 校验失败。对策已固化为
  [CLAUDE.md](../CLAUDE.md)「回合结束纪律」——**新会话必须遵守，收尾一律纯文字**。
- **File has been modified since read**（历史 ×22）：多 agent 并行编辑同一文件所致；
  派发 coder 时注意工作树/文件隔离。
- **测试基线**：当前全量 679 用例（含 lab 探针），任何交付前必须全绿；
  回归电池优化线索见 tests/ 与 e2e-matrix.md。

## 热区文件（历史改动最集中，动前先读）

`js/stage.js` ×98 · `js/main.js` ×89 · `css/style.css` ×23 · `js/player.js` ×21 · `index.html` ×19

## 轮转与巡检设施（全局）

- 轮转流程：[docs/ROTATION.md](ROTATION.md) · 蒸馏器 `~/.zcode/scripts/session-kit/session_distill.py`
- 每 30 分钟死循环巡检 + >70 万 token 轮转提醒（登记在 `~/.zcode/MEMORY.md`）
