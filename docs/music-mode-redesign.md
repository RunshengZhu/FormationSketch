# 音乐模式重定位设计：独立的以秒为基底的剪辑工作台（Music Mode Redesign）

**版本基准**：v0.9.23 / build-36-idx · main `eae2d4e`（审计执行于工作树 `fc68ad1` = `eae2d4e` + dist 部署提交，js/css/index 源码逐字节一致，行号通用）
**性质**：架构重定位设计文档 + 现状实证审计。本轮**未改动任何应用代码**（js/*、index.html、css/*、scripts/*、dist 零变更）。
**证据目录**：`~/.zcode/workspace/default/wuzhen-e2e-lab/out/round58-musicmode-audit/`（audit.json、audit-followup.json 全量量测 + 10 张截图）；探针脚本 `wuzhen-e2e-lab/round58-musicmode-audit.mjs`、`round58-followup.mjs`（playwright 只读驾驶 + 页面运行时包装）。
**场景口径**（除注明外）：3 队形 ×（16 保持+8 过渡）→ `totalBeats=64`（120BPM=32s）；载入 64s 音频 → **音频域 = 2 × 队形块域**。该倍差场景是全部量测的试金石。

---

## 0. 用户反馈（权威需求）与结论摘要

1. 音乐编辑页面**不应与队形关联，应该是队形来和音乐对齐，音乐始终为最底层的元素**；
2. 编辑音乐时需要能**方便地缩放时间轴**；
3. 播放**不应该被对应的队形限制**：始终可以**随意播放、拖动当前播放线到任意位置开始播放**；
4. **clip 两端要支持方便地拖动改变剪辑位置**（经典剪辑交互）；
5. 音轨音量/mute 等设置目前是**浮窗形态**，应作为**明确的 container**，时间轴在这个 container **后向右延伸**，不应该被遮挡。

**审计结论（一句话）**：音乐模式的**时间轴基座仍然锚在队形块域上**——画布宽度、pps、缩放上限、播放头钳制、ended 终态、End 键、自动划分域全部由 `computeSegments(p).totalBeats`（blocks 派生）决定，音频比队形长时**右半首波形在画布上不存在、播放头到不了、播不完、缩放进不去**（E58-01/03/05/13）；叠加轨头是 `position:absolute` 浮层（盖住画布前 140px，行高还被 flex 压缩 3.7~10px，resize 后漂移且永不重建，E58-08/10/14），以及 clip trim 手柄可见性差（3px 半透明线 + 6px 隐形热区，E58-09）。**语义层（trim 的内容锚定、分割、自动交叉淡化、多轨引擎）已经是对的**——本轮重定位的重心是**换基座（秒域）+ 换骨架（container 化）+ 补易用性**，而不是重写剪辑引擎。

---

## 1. 现状审计（G1–G6，逐条实证）

> 证据编号 E58-xx 均可在 `out/round58-musicmode-audit/audit.json` / `audit-followup.json` 与同名截图中复核。代码位置均为 `eae2d4e` 行号。

### G1 音乐模式与队形的耦合点清单（反馈 #1）

| # | 耦合点 | 现状 | 证据 |
|---|---|---|---|
| G1-a | **播放域钳制 = blocks 域** | `Player.seekBeat` 钳制 `[0, totalBeats]`（player.js L157-176）；`totalBeats` 由 `computeSegments` 从 blocks 累加（model.js L286-299） | E58-03：`seekBeat(1000)` → 钳在 64 拍=32s；音频还剩 32s |
| G1-b | **画布几何 = blocks 域** | `layoutWidth`/`ppsOf`/`drawRuler`/`zoom` 全用 `beatToSec(totalBeats)`（timeline.js L386-391、L719-720、L1079-1084、L1091-1099） | E58-01：auto pps=41.2 由 32s 域派生；canvas 1080px 只覆盖 64s clip 的 51.6% |
| G1-c | **音频轨渲染以块域为参照** | clip 盒按秒绘制但画布只有 32s 宽 → 32s 之外的波形**画出画布外被裁**，用户看到的波形「顶满全宽」，无任何「还有一半」的线索 | E58-03：`canvasCoversClipRatio=0.516`；截图 r58-01 |
| G1-d | **preview 栏的队形绑定** | `#music-preview` 280px 常驻音乐模式：队形画布 + 保持/过渡 ±1 拍步进 + 「对齐到播放头」（队形域操作） | E58-02：三项全 true；截图 r58-01 右栏 |
| G1-e | **音乐工具条的队形残留** | 「按队形段自动切」（块边界→分割点，队形驱动音频剪辑的反向路径）驻音乐工具条第 3 位 | E58-02：`mtb-auto-split` 可见，title「按队形段自动切：块边界→分割点…」 |
| G1-f | **播放条的队形耦合** | ⏮/⏭=上一/下一队形；「循环」勾选=循环当前队形段；播放头=0 时按 ▶ 从**当前队形段起点**起播（不是从 0） | E58-02（pbPrevNextTitle/pbLoopTitle）；E58-06（选队形 3 → 起播拍=48） |
| G1-g | **节奏划分域 = blocks 域** | 自动划分三来源（均分 N 段/小节规则/段落表）与段派生（`sectionSegmentsOf` 末段到 totalBeats）全部以 totalBeats 为界——**音频后半永远无法被划分** | E58-01：`sectionEndBeat=64`（=totalBeats）；model.js L373-383；main.js autoSegmentsEven/Bars/Table |
| G1-h | **ended 终态被 blocks 锁死** | `_tick`：`beat >= totalBeats` → pause+ended，音频是否放完不问（player.js L255-263） | E58-05：从 beat 55 起播，32s 处 ended，transport 才走到 31.8s / 音频 64s |

### G2 播放自由度（反馈 #3）

- **播放头拖不过 totalBeats**：尺规最右端点击 → beat 钳 64（E58-04）；`seekBeat(1000)` 同样钳 64（E58-03）。音频更长时，播放线**不可能**到达 32s 之后。
- **不能从任意位置起播**：① 播放头只能定位在 blocks 域内（前条）；② ▶ 的 fresh 起播点=当前队形段 `holdStart`（E58-06，main.js L1126-1131）——起播点由队形决定。
- **ended 被 blocks 边界锁死**：E58-05 全程采样显示 beat 55→64 后 `ended:true`，音频 64s 只放到 32s；「音乐已结束」toast 语义错误（音乐没结束，是队形走完了）。
- **End 键**：`min(beatToSec(totalBeats), lastClipEndSec)`——64s 音频只到 32s（E58-17/F4；main.js L2381-2384）。
- **scrub 面狭窄**：音乐模式 lane 内拖动=剪辑手势（clipMove/timeSel/trim），scrub 只有 22px 尺规一条（E58-07；timeline.js `_down` L1236-1262）。
- **播放中连模式都不能切**：`setUiMode` 播放/数拍中禁止（E58-15；main.js L809-813）。

### G3 clip 两端 trim 的现状交互（反馈 #4）

**语义已对齐经典剪辑，差距在可达性/可见性**：

- **语义（正确，保留）**：左缘拖=内容锚定（`trimClipLeftAnchored`：srcStart 与 timelineStart 同步前进，E58-09 实测 start 6.722→8.617、src 0→1.894、len 64→62.106）；右缘拖=length 变化（源锚定）；Shift+拖=只改边界（src 不动，E58-09 Shift 变体实测）；非破坏（srcStart/length 域，audio-clips.js L172-209）。
- **可见性（差）**：trim 缘的可见 affordance 只有 **3px 宽、alpha 0.5 的红色细线**（timeline.js L667-673），无把手 glyph、无常驻提示；
- **可达性（差）**：命中热区 `TRIM_TOL_PX=6`（L24、L1295-1296），实测缘外 1px=`ew-resize`、12px=`grab`（E58-09）——低缩放下难以命中；淡化把手在顶部 12px 条带内优先命中（L1293-1294），进一步挤压 trim 缘；
- **致命死角**：全长 clip（载入音乐的默认形态，start=0）的**左缘 trim 手柄恒在轨头浮层之下（x<140px），永远抓不到**，必须先拖离或缩放（E58-10）——新用户的第一动作「把曲子掐个头」直接不可达。

### G4 轨头形态：浮层遮挡而非 container（反馈 #5）

- **形态**：`#tl-tracks-head` = `position:absolute; left:0; z-index:7; width:140px`（css/style.css L280），浮在 `#tl-scroll` 画布**之上**，不是 flex 列。时间轴画布从 x=0 起绘，**前 140px 压在轨头下面**。
- **遮挡实测**：在轨头区内取 `elementFromPoint` → 顶层=`tlt-row`（轨头），隐藏轨头后同一点=`tl-canvas`（E58-08）——波形、clip、播放头在该区被遮挡，且指针事件被轨头拦截（clip 拖移/trim 无法在 x<140 起手）。
- **错位实测（静态就有）**：`syncAudioDom` 写入轨头总高=`laneH+26`（timeline.js L528），但子元素需要 `laneH+12(行距)+26` → **恒差 12px**，flex-shrink 静默挤压行高：1 轨 120px lane 对应行高 110.1px，3 轨 120px lane 对应行高 116.3px（E58-08/F1）。
- **错位实测（resize 后）**：窗口 860→500，canvas laneH 变 88.67px，轨头行只被 flex 收缩到 86.4px（并非按新 laneH 重建）；此后**数据变更也不重建**（`syncTracksHead` 签名只含轨数据不含几何，main.js L1597-1619，F2b `rebuiltOnDataChange=false`）→ 行与 lane 逐行漂移累积（第 3 行差 4.5px+）。
- **可达性**：改名=双击走 `prompt()` 弹窗（原生对话框，非内联），音量=46px 滑杆，静音=按钮（E58-08）——入口存在但形态简陋、且整体是浮窗心智。

### G5 时间轴缩放（反馈 #2）

- **上限**：`zoom()` 的 `maxPps = 4096/totalSec`，totalSec 仍是 **blocks 域 32s** → 上限 128pps、画布 4096px——即使放最大，视界也只有 32s（E58-11；timeline.js L1096）。
- **下限**：pps 下限 0.5，但 `layoutWidth = max(clientW, totalSec/secPerPx)`——画布宽恒 ≥ 容器宽，缩到底后内容压缩成**左侧一条细缝、右侧大片空底**（E58-12；截图 r58-06）。
- **⤢ 适配**：`zoomFit()` 回到 auto=blocks 域+1s——适配对象是队形长度而非音频时长；64s 音频的右半**永不入画**（E58-13）。
- **好的一面（保留）**：Alt+滚轮锚定缩放（`zoomAt`，C16）与 Shift+滚轮横移已存在；秒刻度（NICE 族）已存在。锚定缩放在低倍率（画布不超容器）下无可滚动余量、锚定自然失效（F3，属几何必然非缺陷）。
- **刻度缺省**：音乐模式缺省仍是「拍刻度」（`resolveRulerScaleFor` 缺省 beat）——BPM 未校准时拍网格无意义，与「音乐为底层」相悖。

### G6 其它发现（自由扩展）

| # | 发现 | 证据 |
|---|---|---|
| G6-a | **同一画布两套原点**：播放头 x=`beatToSec(beat)×pps`（含 firstBeatSec 偏置，model.js L283），clip/时间选区 x=纯秒×pps（无偏置）——首拍≠0 时播放头「曲首」与波形起点视觉错位 firstBeatSec×pps（实测首拍=5s 时偏 25px @4.9pps） | F5/E58-16 |
| G6-b | **播放中锁 BPM/首拍/点拍 + 禁切模式**：音频对齐参数在播放态被禁（防播放头跳变，任务#2 口径）——与「音乐为底层、播放自由」的预期相冲，重定位后需重审（见 §6 决策点 4） | E58-15 |
| G6-c | **循环域是队形段**：`updateLoop` 用当前队形 `[holdStart,travelEnd)`；时间选区临时循环换算回拍域且选区框不到 blocks 域之外 | E58-02/E58-20 |
| G6-d | **单轨大面积空底**：1 轨 lane 120px，其余 ~600px 容器高画深色空底（W1「内容不足拉满容器」设计）——竖向空间未给剪辑服务 | 截图 r58-01 |
| G6-e | **轨头改名走 prompt()**：原生弹窗打断心流，与时间轴内联命名输入（tag 道 `_openTagInput`）的标准不一致 | E58-08 |
| G6-f | **自动划分的拍域依赖校准**：BPM/首拍未校准（缺省 120/0）时「均分 N 段」落在无意义的拍位上——划分域应以秒为主、拍为换算 | E58-01/G1-g |

---

## 2. 目标架构：「音乐模式 = 独立的秒制剪辑工作台」

### 2.0 双模式关系图（重定位后）

```
                    project（单一数据源：tags / blocks / audio / media / tracks / clips）
                      │                                    │
        ┌─────────────┴─────────────┐        ┌─────────────┴──────────────┐
        │  编舞模式（现状零变化）        │        │  音乐模式（秒制剪辑工作台）      │
        │  主域 = 拍（blocks 派生）      │        │  主域 = 秒（音频时长派生）      │
        │  队形为主：舞台+块区+块时长栏   │        │  音乐为底层：多轨 lane+clip     │
        │  音频=26px 只读缩影（现状）     │        │  队形/tag = overlay 映射        │
        │  seek 钳 [0,totalBeats]（现状）│        │  播放头全域自由；ended=音频放完  │
        └─────────────────────────────┘        └────────────────────────────┘
                      │          切换零丢失（现状已保证，保持）      │
                      └──────────────── 桥梁 ────────────────────┘
        tags（拍位存储）= 节奏划分轨：音乐模式里是音频的结构标注（overlay），
        编舞模式里是队形对齐的参照——beatToSec 是唯一换算口，随 BPM/首拍动态重映射。
```

**公理（「音乐为底层」的一致贯彻）**：
- 音乐模式的时间轴是**秒轴**，域=`[0, 音乐域长]`；队形块/tag 是**映射上来的 overlay**（beat→sec 换算），不是坐标系的 owner；
- **BPM/首拍/拍号是音频的对齐参数**（校准工具），不是队形的派生物——改动它们平移的是「拍↔秒映射」，音频 clip 的秒位一个字节都不动（现状已如此，保持并显性化）；
- 编舞模式一切现状（几何、播放语义、钳制）逐值不动（红线 E-12 延续）。

### 2.1 时间轴基座重定位【含引擎语义改动，风险单独标注】

**D1 音乐域长（新纯函数，model.js）**
```js
// 音乐模式时间轴主域上界：最后 clip 终点与活动资产时长取大（下限 10s 托底）。
// blocks 完全不参与。波形全可见、播放头全可达的几何基础。
export function musicDomainSec(p) {
  const clipEnd = lastClipEndSec(clipsOf(p));                    // audio-clips.js 既有
  const assetDur = activeAssetOf(p)?.durationSec || 0;           // model.js 既有
  return Math.max(clipEnd, assetDur, 10);
}
```

**D2 几何换基座【纯 UI】**（timeline.js，落点：`layoutWidth` L386、`ppsOf` L1079、`drawRuler` L719、`zoom` L1091）
- `layoutWidth`/`ppsOf`：music 模式用 `musicDomainSec(p)` 替换 `beatToSec(totalBeats)`；auto pps = `W / (domainSec + 2)`（2s 尾部余量）。stage 模式分支逐值不动。
- `drawRuler`：music 模式缺省**秒刻度**（`resolveRulerScaleFor` 对 music 缺省改 'sec'，W3 分键机制沿用）；拍网格降级为**对齐 overlay**——按 `(bpm, firstBeatSec, beatsPerBar)` 在整个秒域上画小节线（不再止于 totalBeats），刻度按钮保留可切。
- `zoom`：`maxPps = 8192 / musicDomainSec(p)`（画布像素上限 4096→8192；64s 音频即 128pps 上限不变，180s 曲亦有 45pps）；下限改为**fit 即地板**（见 §2.4）。

**D3 播放头全域自由【引擎语义，风险 R1】**（player.js，落点：`seekBeat` L157、`_tick` L255-263、`_finish` L280-298、main.js `playerAtEnd` L1134、End 键 L2381）
- `seekBeat` 的钳制改**模式感知**：music 模式钳 `[0, secToBeat(p, musicDomainSec(p))]`（≈不设拍域上限，只挡负值与无穷）；stage 模式保持 `[0, totalBeats]`（编舞红线）。构造器注入 `getMode` 钩子（main.js 传入 `() => musicTl.mode`）。
- **ended 重定义（music）**：终点域 = `musicDomainSec`（音频放完=ended），不再取 totalBeats；`_audioEnded` 虚拟接管语义**仅 stage 模式保留**（编舞排练要跟着队形走完无乐尾段——round30 #7 语义），music 模式音频放完即干净停在 `lastClipEndSec`。
  - 反向场景（blocks 32s < 音频 64s）：music 模式播过 32s 后队形停在末帧（`currentFormationIndexAt` 已天然钳末段，model.js L516-520，安全），音乐继续到 64s——这正是「队形来对齐音乐」。
  - ⚠ 风险 R1：TC-P5-07/15（播到末尾终态）在**音乐模式分支**的口径变化；stage 分支逐值不动，用模式门控隔离，全部既有单测在 stage 语境下应原样绿。
- End 键：music 模式 → `musicDomainSec` 秒位；stage 模式保持 `min(totalBeats, lastClipEnd)`。
- ⏮/⏭/「循环当前队形段」/fresh ▶ 从段起点起播：**stage 语义原样保留**；music 模式下 ⏮/⏭ 改义为「跳上一个/下一个 clip 缘」（经典 DAW 语义），▶ 一律从当前播放头起播（fresh 与续播同义，数拍入场仍可配）。
- 循环：music 模式「循环」勾选=循环**时间选区**（`applyTimeSelLoop` 已存在，C11，提升为音乐模式主循环语义）；无选区时勾选=循环整个音乐域。

**D4 队形/tag = overlay 映射【纯 UI + 1 个函数签名】**
- blocks 区在 music 模式不绘制（现状已隐藏，保持）；**不新增队形 overlay 绘制**（反馈 #1：音乐页面不与队形关联；对齐参照走 preview 栏，见 D8）。
- 节奏划分轨保留（它是音频结构标注，属音乐侧）；`sectionSegmentsOf(p, endBeatOverride?)` 增加可选末段终点参数，music 调用方传 `secToBeat(p, musicDomainSec(p))`，**缺省=现状 totalBeats**（编舞调用方零变化）。自动划分三来源的曲长口径同步改传 override（main.js autoSegments*）。
- tags 仍以**拍位存储**（编舞桥梁语义不丢，r2 §3.3 裁定延续）；「音乐为底层」体现在**域与呈示**（秒轴 + 换算），不在存储单位——最小增量。

### 2.2 多轨 container 化【纯 UI 重排】

**D5 布局（index.html + css，落点：#tl-body 结构 L255-266、css L276-289；timeline.js `syncAudioDom` L520-536 整体退役）**

```
#tl-body（flex column）
└─ #tl-scroll（overflow:auto，唯一滚动容器；横向滚=内容宽，纵向滚=轨多时）
   └─ .tl-grid（display:flex; min-width:100%; width:max-content）
      ├─ #tl-head-col（position:sticky; left:0; z-index:5; width:148px; flex:none;
      │                background:var(--bg2); border-right:1px solid var(--line)）
      │   ├─ .tlh-corner  高 22px（与尺规同行；可放磁吸/剃刀小钮，P2 可空）
      │   ├─ .tlh-corner2 高 28px（与划分轨同行；空）
      │   ├─ .tlh-track ×N  高 = laneH（与 lane 逐行同高，flex:none 禁收缩）
      │   │    ├ 行1：轨名（内联编辑） · 静音 · 删轨（仅空轨）
      │   │    ├ 行2：音量滑杆（0–1.5）+ 数值
      │   │    └ 行3：N 个剪辑 / 空轨（dim 小字）
      │   └─ .tlh-ops     高 26px：[＋加轨]（≤4 满禁用）
      └─ #tl-inner（position:relative）
         ├─ #tl-canvas（尺规 22 + 划分轨 28 + N×lane + ops 空行 26；x=0 从 container 右缘起）
         └─ #tl-overlay（播放头，pointer-events:none）
```

- **遮挡按构造消失**：canvas 从轨头列右缘起绘，二者是同一 flex 行的兄弟，物理上无重叠；`elementFromPoint` 任意点回到画布。E58-10 的「clip 左缘不可抓」随之消亡。
- **对齐按构造成立**：行高同一变量 `laneH`（`musicLaneH(containerH, n)` 保留），行 `flex:none` 显式高 → E58-08/F1/F2 的 12px 挤压与漂移不复存在；`syncTracksHead` 的数据签名门控（E58-14 根因）整段删除，轨头重建改由 `laneH`/轨数据任一变化触发。
- **纵横滚动一处管**：sticky 双轴（left:0 管横滚、竖滚自然随容器）——零 scroll 同步 JS；纵向滚动条出现在 #tl-scroll 右缘，轨头与 lane 同滚（DAW 标准行为）。
- **改名内联化**：轨名双击 → 行内 input（复用 tag 道 `_openTagInput` 的交互范式），退役 `prompt()`（修 G6-e）。

### 2.3 clip 交互对齐经典剪辑【纯 UI + 命中面】

语义层全部保留（内容锚定 trim / Shift 变体 / 分割 / 拖移 / 跨轨 / 磁吸 / 自动交叉淡化——E58-09 实证已对），本轮只补「可见、好抓、可发现」：

| # | 项 | 设计 | 落点 |
|---|---|---|---|
| T1 | **两端 trim 手柄常驻可见** | music 模式 clip 两缘画把手 glyph（8×10 竖把 + 中缺刻，Audition 式），选中/hover 时增亮至实色 + 加粗描边；laneH<40 或 clip 宽<24px 时降级为现有 3px 线 | `drawClipBox` L667-673 |
| T2 | **命中热区 6→10px** | `TRIM_TOL_PX = 10`；trim 缘与淡化把手冲突维持「顶部 12px 归淡化」分区不变；hover 时 clip 名牌旁浮出 tooltip「拖动=修剪（内容跟手）· Shift=只移边界」 | `TRIM_TOL_PX` L24、`_audioHit` L1295 |
| T3 | trim=非破坏 | 现状保留：`srcStartSec/lengthSec` 域（源内容锚定），零破坏零迁移 | audio-clips.js L172-209 |
| T4 | 播放头分割 | Cmd/Ctrl+K + 剃刀（现状保留）；剃刀 hover 光标已达标 | `splitAtPlayhead` L1717 |
| T5 | 拖整段/跨轨/磁吸 | 现状保留（含 W3 跨轨 lane 高亮） | `_applyClipMove` L1416 |
| T6 | 双击 | 双击 clip=选中+循环预览；双击空白=清选（现状保留） | `_dblclick` L1898 |
| T7 | 触屏 | trim 缘命中半径触控指针放宽至 14px（`pointerType` 分支） | `_audioHit` |
| T8 | 键盘微调 | Alt+←/→ 选中 clip 微移 10ms（现状有 nudgeSelected 但无 Alt 捷径——补键位）；Shift+=按网格 | `nudgeSelected` L1798 |

### 2.4 缩放【纯 UI】

| 项 | 设计 |
|---|---|
| 域 | music 模式一切缩放以 `musicDomainSec` 为域（D1/D2） |
| 范围 | pps ∈ `[fitPps, 8192/domainSec]`——**下限=适配（fit 即地板）**：缩到底=整曲入画，**根除 E58-12 的「左侧细缝+大片空底」**（旧下限 0.5pps 与 `max(clientW,…)` 兜底的组合废弃） |
| ⤢ 适配 | `zoomFitMusic()`：适配音频时长（+2s 尾余量）；载入音乐/切换项目后自动 fit 一次 |
| 锚定 | Alt+滚轮锚定光标（既有 zoomAt 保留）；**－/＋ 按钮改锚视口中心**（`zoom(factor, centerClientX)`——现状按钮锚左缘，缩放时视野向右漂） |
| 横移 | Shift+滚轮（既有）保留；触屏双指横滚走容器原生滚动 |
| 记忆 | music/stage 分键延续（W3）；pps 会话态即可，不持久化（保持现状口径） |

### 2.5 与编舞模式的关系

- **编舞模式逐值不动**（红线）：舞台三栏、块区/块时长栏、150/120/160 几何、26px 只读音频道、seek 钳 `[0,totalBeats]`、ended 虚拟接管、⏮⏭/循环段语义——全部现状保留。
- **共享 project 数据、切换零丢失**（现状已保证：round46/IR-W1-6 口径，`setMode` 只动呈示面）——保持。
- **音乐模式内队形元素收敛为「对齐辅助」**（D4/D8）：不绘块 overlay；preview 栏改**可折叠**（默认展开、记忆开关），内聚「只读队形画布 + 对齐到播放头」；「按队形段自动切」从工具条第 3 位降级进「对齐队形 ▸」折叠组（功能保留——它是音乐↔队形的桥，但不再是音乐模式的一级动作）。
- **工具条重组**（§2.2 反馈 #1 落地面）：`[＋载入][媒体库] │ [⚑打点][自动划分▾][索引] │ [对齐组：BPM/首拍/点拍/小节/数拍/试听] │ [秒/拍][－][＋][⤢][磁吸][剃刀] ┄┄ [对齐队形▸][资产名]`——BPM/首拍组标注为「音频对齐」语义（title 文案），强调它们是校准参数不是队形派生。

### 2.6 数据模型增量（最小原则）

| 项 | 增量 | 说明 |
|---|---|---|
| 音乐域上界 | **0 个新字段** | `musicDomainSec(p)` 派生自 `lastClipEndSec` + `activeAsset.durationSec`（既有字段）——「project.audio.durationSec 为主域上界」无需落盘，派生即真相，且天然跟随多 clip 编辑（拖出更长 clip 域自动变长） |
| blocks / tags / clips / tracks | **不变** | 块仍拍位；tags 仍拍位（编舞桥梁）；clip 秒位引擎不动 |
| 播放位置 | 会话态 | 播放头可停在 blocks 域外（秒 >32s），不持久化（现状播放头本就不入库）——零 schema |
| 函数签名 | 2 处加参 | `sectionSegmentsOf(p, endBeatOverride?)`、`Player` 构造器 `getMode` 钩子——均带缺省=现状，编舞调用方零改动 |
| 遗留可选项 | 不并入本轮 | 轨 solo、masterGain 入项目（W3 裁剪项）维持待拍板，与本重定位正交 |

**唯一引擎语义改动清单（风险 R1/R2 全集）**：① music 模式 seek 钳制域；② music 模式 ended 终点域 + `_audioEnded` 接管旁路。其余全部为纯 UI/几何/命中面。

---

## 3. 实现批次与验收口径

> 红线（继承 round51 §6）：编舞模式像素级零变化（tl 高 150/120/160、L2 基线、`lane-a.test.js` G1 原样绿）；stage 模式播放语义逐值不动。

### 批次 M1：秒域基座 + 自由播放（核心，含引擎语义 R1）——M-L，3 人日 + 回归 1
`musicDomainSec`；`layoutWidth/ppsOf/drawRuler/zoom` 换域；music 缺省秒刻度 + 拍网格 overlay；`seekBeat`/`_tick`/`_finish`/End 键/⏮⏭/▶ 起播/循环的模式感知分支；划分域 override 三来源接线。
IR 验收草案：
- **IR-M1-1** 64s 音频 + 32s 块：music 模式 auto 画布域 = 64s+2s；clip 波形全宽可见（`canvasW ≥ clipEnd×pps`）；⤢ 后右端可见。
- **IR-M1-2** 播放头可 scrub/点击定位到 60s；从 55s 起播播到 64s 才 ended（音频真实放完）；「音乐已结束」toast 语义成立。
- **IR-M1-3** End=64s；⏮/⏭=clip 缘步进；循环选区生效。
- **IR-M1-4** stage 模式回归：`seekBeat(1000)` 仍钳 totalBeats；ended/虚拟接管/循环段与 eae2d4e 逐值一致（复跑 round34 P5 族 + r27/r29 探针全绿）。
- **IR-M1-5** 自动划分：无 tag 传入 override 时行为与现状逐值一致；music 模式划分域覆盖到音频末（末段终点=域尾）。

### 批次 M2：轨头 container 化（纯 UI）——M，2 人日
§2.2 布局全部；`syncAudioDom` 轨头定位退役；重建门控改「laneH 或轨数据变化」；内联改名。
IR 验收草案：
- **IR-M2-1** 轨头区内 `elementFromPoint` = 画布/lane（零遮挡）；clip 可从 x=0 起拖/trim。
- **IR-M2-2** 1/3/4 轨 × 860/500 两档窗口：轨头行高 == laneH ±1px（逐行），加轨条底对齐；resize 后无需数据变更即对齐。
- **IR-M2-3** 轨名内联改名（Enter/失焦提交、Esc 取消），prompt 不再出现；音量/静音/删轨/加轨功能与现状等价（复跑 round50 verify-2）。

### 批次 M3：clip 交互 affordance（纯 UI+命中）——S-M，1.5 人日
T1/T2/T7/T8（把手 glyph、命中 10px、触控 14px、tooltip、Alt 微移键位）。
IR 验收草案：
- **IR-M3-1** music 模式 clip 两缘把手常驻可见（截图像素断言），hover 增亮；Shift 拖=只移边界语义复测（E58-09 用例改写）。
- **IR-M3-2** 全长 clip（start=0）左缘可直接抓取 trim（M2 后几何 + M3 命中联动）；Trim 后 undo 恰一条历史。
- **IR-M3-3** 复跑 r41 trim 族 / IR-C4：内容锚定语义零变化。

### 批次 M4：缩放补全（纯 UI）——S，1 人日
fit 即地板、⤢ 适配音频、按钮中心锚定、载入后自动 fit、8192 上限。
IR 验收草案：
- **IR-M4-1** 缩到底=整曲入画、无空底细缝（r58-06 场景复拍）；放大到画布 8192px 封顶不崩。
- **IR-M4-2** ＋/－ 锚视口中心（中心秒偏移 <0.5s）；Alt+滚轮锚定复测（离 cap 后真锚定）。
- **IR-M4-3** 载入音乐自动 fit 一次；⤢ 域=音频时长+2s。

### 批次 M5：信息架构收尾（纯 UI）——M，1.5 人日 + 用例改写 1
工具条重组（对齐组标注/「对齐队形▸」折叠）、preview 栏可折叠记忆、music 循环=选区语义、seconds 缺省刻度、说明书/快捷键表更新。
IR 验收草案：
- **IR-M5-1** 折叠组/preview 折叠态跨会话记忆；stage 模式工具面零变化。
- **IR-M5-2** music 模式「循环」勾选行为=选区循环（无选区=整域）；stage 语义不动。
- **IR-M5-3** 往返一致性复跑（IR-W1-6 口径）：选择/播放头/循环/缩放/clipSel 跨切换零丢失。

**合计：~9 人日 + 回归 1 人日**。依赖序：M1 → M2 → M3（依赖 M2 的零遮挡）/M4 可并行 → M5 收尾。

---

## 4. 与 202 条用例目录 / 既有套件的关系

### 4.1 编舞模式红线保持清单（全部原样，禁止波及）
- `tests/lane-a.test.js` G1 三值与 tl 高公式（stage 分支）；
- TC-P4 族（载入/BPM/首拍/试听——控件与守卫不动，仅音乐工具条 title 文案微调属 IR-M5）；
- TC-P5 族 stage 语义（终态统一、循环段、数拍入场）——M1 的模式门控保证 stage 分支逐值一致（IR-M1-4 复跑背书）；
- TC-P6 移动端编舞；round34/37/39/40/42 回归 harness 的 stage 断言。

### 4.2 废弃/改写清单（音乐模式相关）

| 用例/断言 | 处置 | 依据 |
|---|---|---|
| End 键 = `min(totalBeats, lastClipEnd)`（main.js L2382 及其仪器） | **music 分支改写**为 `musicDomainSec`；stage 分支保留 | E58-17 |
| TC-P5-07「播到末尾自动停 beat=totalBeats」 | **拆两态**：stage 原样；music 新用例「播到音频末停」 | E58-05 |
| round51 P3/E-06 类「切模式后轨头 children」断言 | **改写**：轨头常驻子元素结构变化（.tlh-track） | §2.2 |
| round50 verify-2 轨头图标/结构快照 | **改写**：新 container 结构 + 内联改名 | §2.2 |
| W3 IR-W3-2「刻度分键缺省均=拍」 | **改写**：music 缺省=秒、stage 缺省=拍 | D2 |
| r23/r24/r55/r57 中「pps 自适应=blocks 域」的几何推算 | **改写**：域=音频时长 | E58-01/13 |
| music-clip-ui-spec §1 注记（End 取小者口径） | **修订**：music=音频域、stage=取小者 | §2.1 D3 |
| IR-W1-5 preview 栏 ±1 拍步进 | **保留**（对齐辅助定位不删，仅折叠化） | 决策点 2 |
| 展开/浮层类历史断言（#tl-tracks-head top/height 内联样式） | **废弃**（属性随 syncAudioDom 退役） | §2.2 |
| `resolveInitialUiMode`/uiMode 迁移类 | 保留不动 | 无涉 |

---

## 5. 需用户拍板的决策点

1. **⏮/⏭ 与 ▶ 起播的音乐模式语义**（D3）：建议 music=「上一/下一个 clip 缘」+「▶ 恒从播放头起播」；若希望音乐模式也保留队形步进（对齐工作流），可改为「⏮⏭ 双语义：短按 clip 缘、Alt+=队形段」。
2. **preview 栏去留形态**（D8）：建议「可折叠、默认展开」（对齐工作流需要参照）；若贯彻「音乐页面零队形元素」可默认折叠甚至移除（对齐动作仅在切换瞬间需要，M5 可减 0.5 人日）。
3. **「按队形段自动切」位置**：建议降级进「对齐队形▸」折叠组（功能保留）；若认为它违反「音乐为底层」应从音乐模式移除，则需在编舞摘要条补等价入口。
4. **播放中锁 BPM/首拍是否解除**（G6-b）：现状锁是为防播放头跳变（round30 P1#2）。重定位后音乐模式以秒走带、BPM 改动只动 overlay 映射，**技术上可解锁**（播放头秒位不跳、拍网格/划分轨实时重映射）；建议 music 模式解锁（实时校准体验质变），stage 模式维持锁定。涉及删除守卫，需单列小批次（0.5 人日）+ 回归。
5. **music 缺省刻度改秒**（D2）：影响 W3 IR-W3-2 与老用户习惯（有 localStorage 记忆兜底，老用户已选过则不受影响）。默认改。

---

## 附：证据文件索引
- `~/.zcode/workspace/default/wuzhen-e2e-lab/out/round58-musicmode-audit/audit.json` —— G1–G6 全量量测（领域基线/钳制/ended 采样/轨头几何/trim 实拖/缩放扫描）
- 同目录 `audit-followup.json` —— F1/F2（3 轨行高挤压与 resize 漂移）、F4（End 键）、F5（首拍偏移双原点）
- 同目录截图：`r58-01`（音乐模式全景：轨头浮层/空底/preview 栏）、`r58-02`（轨头遮挡区）、`r58-03/04`（clip 移动与 trim 前后）、`r58-05/06`（缩放上限/缩到底细缝）、`r58-07`（resize 后行高漂移）、`r58-09/10`（3 轨与 resize 对齐）、`r58-08`（编舞模式对照）
- 探针脚本：`~/.zcode/workspace/default/wuzhen-e2e-lab/round58-musicmode-audit.mjs`、`round58-followup.mjs`（只读驾驶 + 运行时包装，应用代码零变更）
- 参照实现：`~/.zcode/workspace/default/lightmix/src/render/canvasView.ts`（`scrollSec/pps/tail` 秒域视图模型：域=最后 clip 终点+余量，播放头秒制全域自由）、`src/core/model.ts`（clip trim 纯秒制模型）
- 代码引用（eae2d4e）：player.js L157-176（seek 钳）、L255-263（ended=totalBeats）、L280-298（_finish）；timeline.js L386-391/L1079-1084（几何域）、L1091-1099（zoom）、L24/L667-673/L1293-1297（trim 手柄/命中）、L520-536（syncAudioDom 浮层定位）；main.js L1099-1133（循环段/起播耦合）、L1595-1668（轨头构建与签名门控）、L2381-2384（End 键）；model.js L283-299（beatToSec/totalBeats）、L373-383（段域）；css/style.css L280-289（轨头浮层）

---

## 6. 交付记录（M3 + M4 + M5 收尾批 · build-38-m3m5）

**交付批**：round64 · 2026-09-24 · `build-38-m3m5`（M1/M2 已随 build-37-m1m2 交付，见 round62/round63 探针）。
**本批范围**：§2.3 T1/T2/T7/T8（clip affordance）+ D3 的 ⏮⏭ 正式实装 + §2.4 缩放收尾 + §2.5 工具条/preview 折叠收尾 + 说明书/快捷键表。
**探针**：`~/.zcode/workspace/default/wuzhen-e2e-lab/round64-m3m5.mjs` → `out/round64-m3m5/audit.json`（P1 ⏮⏭ / P2 把手 / P3 Alt 微移 / P4 缩放 / P5 工具条与折叠 / P6 R63-1，全绿）。

### 6.1 逐项交付

| 项 | 设计 | 落地 | 验收 |
|---|---|---|---|
| T1 把手常驻 | 两缘把手 glyph（竖把+中缺刻），hover/选中增亮；laneH<40 或 clip 宽<24px 降级 3px 线 | `drawClipBox`/`_drawTrimGrip`（timeline.js） | 探针 P2：常态像素 reddish（r-g>40）、hover 实色 [244,63,94] ✓ |
| T2 热区 10px | `TRIM_TOL_PX=10`，顶部 12px 归淡化分区不变 | `_audioHit`（timeline.js） | 探针 P2：mouse 9px=trimL / 11px=body ✓ |
| T7 触屏 14px | `pointerType` 分支放宽 | `_audioHit(x,y,clips,touch)` | 探针 P2：touch 13px=trimL / 15px=body ✓ |
| 把手 tooltip | hover 显「拖动=修剪（内容跟手）· Shift=只移边界」 | `_move` hover 分支写 `cv.title` | 探针 P2：显/隐（离缘清空）✓ |
| E58-10 根除复核 | M2 container 化后全长 clip 左缘可直接抓 | —（几何已由 M2 消亡） | 探针 P2：`_audioHit(2px)`=trimL + 真实指针拖 40px trim 成功、内容锚定（src==start）✓ |
| ⏮⏭ clip 缘步进 | D3：music=前/后 clip 缘（无缘=0/域尾）；stage=队形步进不动 | `clipEdgeStepSec`（audio-clips.js 纯函数+单测）+ `stepFormation`（main.js） | 探针 P1：单 clip ⏮@10s→0、⏭@10s→64s（域尾）；3 clip ⏮@10→8、⏭@10→20、⏭@25→32（缘）、⏮@5→0、@14→8（严格前缘）✓ |
| DEFECT-R63-1 | setUiMode 补 ⏮⏭ title 刷新 | `setUiMode` 同步写两 title（1 行×2）+ `render` 兜底 | 探针 P6：切模式后 100ms 内 title 已按模式切换 ✓ |
| T8 Alt 微移 | Alt+←/→ 选中 clip 微移 | `nudgeSelected` 增 `opts.step`；wireKeyboard music+有选中分支 | 探针 P3：±0.1s 精确；无选中回落播放头 ±0.5s ✓ |
| M4 中心锚定 | －/＋ 锚视口中心 | `zoomCenter`（复用 zoomAt 换算）接 `#tl-zoom-in/out-music` | 探针 P4：＋/－ 中心秒漂移 0.002/0.003s（<0.5s）✓ |
| M4 Shift 横移 | Shift+滚轮横移不缩放 | 既有（C16）核对标记 | 探针 P4：scrollLeft+240、pps 零变化 ✓ |
| M4 极限健全 | fit 地板再缩小=无操作；8192 上限封顶 | M1 已做，核对标记 | 探针 P4：fit 后再缩小 pps 不变；连放大 pps=8192/64、W=8192 ✓ |
| M5 工具条 | §2.5 分组：资产组│⚑打点·自动划分▾·索引│对齐组│尺规组（含磁吸/剃刀） | index.html 调序（自动划分▾ 移入打点/索引组）+ 新增磁吸/剃刀钮（S/R 键位保持） | 探针 P5：分组顺序断言 + 按钮与 `snapOn/razor` 同态（含 Esc 退剃刀同步）✓ |
| M5 preview 折叠 | 决策②：可折叠、默认展开、记忆 | `.mp-head`+`#mp-collapse`（index.html/css/main.js），`wuzhen:mpCollapsed` | 探针 P5：280→42 折叠、reload 后仍 42、展开 280、LS '1'/'0' ✓；移动 88px 横条不呈示折叠钮（W3 形态隔离） |
| M5 文档 | 说明书/快捷键表补新语义 | js/manual.js：音乐场景 7 步改写（秒刻度缺省/播放中可改 BPM/⏮⏭ 新语义/索引面板/自动划分/把手提示/preview 折叠）+ 手势表音频 clip 行 + 键表（Ctrl/Cmd+K、⌘⇧L、Alt 语义、Delete/方向键 clip 语义） | manual.test 325 全绿（LEGACY-CITE 原文断言不受影响） |

### 6.2 偏差记录（相对 §2.3/§2.4/§5 原案）

1. **T8 Alt 微移步长 10ms → 0.1s**：设计 T8 文案为「微移 10ms」；交付按任务口径取 ±0.1s（与播放头 Alt 秒步进 0.5s 同数量级，10ms 在键盘步进下不可感知）。`opts.step` 参数化，缺省 10ms 档保留（←/→ 无修饰键路径不变）。
2. **磁吸/剃刀工具条钮**：§2.5 工具条图含 [磁吸][剃刀]，本批补齐（原仅 S/R 键盘入口，可发现性缺口）；置于尺规组 ⤢ 之后，与设计图一致。
3. **「对齐队形▸」折叠组不设**：§2.5 草图尾部的 [对齐队形▸] 组唯一内容是「按队形段自动切」，决策③已将该功能整体移除（§2.2 反馈 #1 落地）——组随内容一并免设。preview 栏（决策②保留）承担队形对齐参照。
4. **缩放中心锚定仅接音乐工具条 －/＋**（`#tl-zoom-in/out-music`）：编舞摘要条同位按钮（`#tl-zoom-in/out`）保持既有 `zoom()` 锚左缘行为——stage 模式缩放行为属编舞红线保持面（§4.1），TC-P4-31 口径不变。
5. **折叠记忆键移动端不生效**：W3 §2.3 移动端 preview 为 88px 底部横条，无折叠余量——`.mp-head` 在 <1024px 不呈示、折叠样式桌面专属（CSS 隔离），记忆键跨端不串。
6. **p4 旧锁断言改写（决策④授权）**：TC-P4-02/29 的「播放中 BPM/首拍 disabled+拦截+还原+toast」断言随锁收缩退役，改写为「播放中 BPM/首拍程序化 change 直接生效（不锁、不还原）+ 点拍仍锁（disabled/click 无效/title）+ 数拍中点拍锁 + 暂停解锁」；改写对照见 round64 交付报告。

### 6.3 回归

- node --test 红线：324→**325**（+1：`clipEdgeStepSec` 纯函数单测，tests/audio-clips.test.js §14），run-l2.mjs 阈值已回填。
- 全量回归（l0/l1/r/gr/realinput/l2/r23-music/uf1/uf2/p1–p5/node×2）数字见 round64 交付报告（out/round64-m3m5/）。
