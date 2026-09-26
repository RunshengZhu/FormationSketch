# 队形结合音乐 · 编辑缺陷分析报告（round30）

- 项目：舞阵 WuZhen formation-studio
- 分析对象：dev 源码树 http://localhost:8137/（构建标记 `build-26-e2e2`；工作树 HEAD 实为 `4f6fed8`「轮17」，含轮16/17 修复，均在任务给定 `99861fa` 之后，本报告基于当前工作树实证）
- 方法：系统性代码审读（js/player.js、audio.js、model.js、main.js、timeline.js、stage.js、store.js、export.js）+ Playwright 探针实证（探针全部在 lab：`/Users/helius/.zcode/workspace/default/wuzhen-e2e-lab/analysis-*.mjs`，证据在 `/Users/helius/.zcode/workspace/default/wuzhen-e2e-lab/out/round30-analysis/`）
- 纪律：未修改任何应用代码（js/*、index.html、css/*、scripts/* 均未动，未 commit）；探针只经页面运行时包装与 `window.__fs` 测试钩子驱动

---

## 一、执行摘要

对「队形结合音乐的编辑」面做了双时钟（有音乐 / 无音乐）全维度对照与 8 族疑点实证：**确认缺陷与语义缺口 22 项（P1×3、P2×10、P3×9），无 P0**。三项在案观察 OBS-A/C/D 全部实锤，OBS-B 实锤，**OBS-E 证伪**（变速对音乐通道生效且拍点对齐，非缺陷）。另证伪一项代码审读假设（`_loopStash` 泄漏导致循环失效——实为死代码，行为无碍）。

核心结论：

1. **音乐时钟本身是稳的**：暂停续播零间隙、scrub 精确映射（beat 30.71 ↔ 15.36s）、变速经 `playbackRate` 同步且拍点对齐、长曲目性能全绿。问题集中在**「编辑动作打在播放中的时间轴上」没有统一的守卫/补偿语义**：改 BPM 播放头跳变、换音频静默停/失败僵死、scrub 越界停播、边界在播放头下移动。
2. **无音乐档是「二等公民」**：循环失效、无数拍入场、结束终态静默归零——同一枚 ▶ 按钮在两种时钟下是两套终端语义，无任何提示。
3. **呈示层插值缺口**：travel 过渡期合并单元符号（胶囊/绑定线/单编号）不插值，在 hold 边界突跳；「移出队形」造成的缺位舞者会在过渡期冻结原位、进下一帧瞬间消失。

### 分级统计

| 级别 | 数量 | 一句话口径 |
|---|---|---|
| P0 | 0 | 无数据损坏/崩溃/不可恢复 |
| P1 | 3 | 文案与行为相悖、播放核心参数（BPM） live 编辑破坏对齐、播放器僵死态 |
| P2 | 10 | 循环/终态/越界/缺位等语义缺口，功能可达但行为错误或无提示 |
| P3 | 9 | 一致性、cosmetic、latent 风险 |

### Top 缺陷（每条一句话）

1. **[P1] 「项目文件 · 不含音乐」按钮实际内嵌音乐**——与「含音乐」按钮导出字节完全相同（7,528,334 B，含 base64 音频），用户以为导出轻量文件实际带走整首曲（OBS-C 实锤，`analysis-05` m8）。
2. **[P1] 播放中改 BPM 播放头跳变**——120→240 时 beat 4.92→10.41（×2.12）瞬间跳变，双时钟皆跳；音乐通道不变速，所有队形切换点相对音乐立刻错位，无守卫无提示（`analysis-03` e4）。
3. **[P1] 播放中载入损坏音频 → 播放器僵死**——`playing=true`、播放头冻结、按钮显示 ⏸（看似在播），仅一条 toast，用户不点一下永远出不来（`analysis-05` m7）。
4. **[P2] 无音乐时「循环」完全失效**（OBS-A）——单段预览一次即停，复选框保持勾选但无效，无提示（`analysis-01` loopNomusic）。
5. **[P2] 数拍进行中按 ▶/空格 = 重开完整倒计**（OBS-B）——不是取消/暂停；Esc、切编辑锁也都不取消（`analysis-02` c3）。
6. **[P2] 播放结束终态双标**（OBS-D）——音乐档停在 `totalBeats`/末队形并发 ended；无音乐档静默归 0、无 ended 事件（`analysis-01` endMusic/endNomusic）。
7. **[P2] 音频比时间轴短时结束瞬间播放头跳变 +58 拍**，画出波形之外，pb-pos 从 2.2 跳 17.1（`analysis-05` m4）。
8. **[P2] travel 期合并单元呈示突跳**——绑定线/胶囊/单编号在 hold 边界瞬间切换，插值期两人重合时画成两个叠圆（`analysis-04` t1/t2）。
9. **[P2] 「移出队形」造成的缺位舞者**——过渡期冻结在原帧位置不走位，进下一帧瞬间消失（`analysis-04` t3）。
10. **[P2] 全曲播完后再按 ▶ 只重播最后一段**（音乐档，beat 从段起点 6 起而非 0，`analysis-01` replayMusic）。

---

## 二、双时钟对照表（逐格实证）

环境：120 BPM、3 队形（16+8 拍/块）、`click120.wav`（64s）vs 无音频；数据源 `analysis-01-dualclock.json`、`analysis-02-countin.json`。

| 维度 | 有音乐（audio.currentTime 驱动） | 无音乐（虚拟时钟） | 判定 |
|---|---|---|---|
| 起播拍速率 | 1.979 拍/s（名义 2.0） | 2.002 拍/s | 一致 ✅ |
| 暂停→续播位置 | 间隙 0 拍（audio.pause 保值） | 间隙 0 拍（beat 保值） | 一致 ✅ |
| 暂停期间时钟 | 冻结（drift 0） | 冻结（drift 0） | 一致 ✅ |
| 播放中 scrub | beat 30.71 / audioT 15.36s 精确映射，继续播放 | beat 30.79，继续播放 | 一致 ✅ |
| 速度 0.5× | `el.playbackRate=0.5`、拍速率 1.004（音乐同步变速，拍点对齐） | 拍速率 1.001 | 一致 ✅（**OBS-E 证伪**） |
| 循环回绕 | 段内回绕，8.5s 内 2 次 | **失效**：单段预览一次即停，复选框仍勾选，无提示 | ❌ 缺陷 #4 |
| 数拍入场 | 有（4→3→2→1，4 声，首声重音） | **永无**（`togglePlay` 无音乐分支写死 `countIn:false`） | ❌ 缺陷 #4 族/文档口径 |
| 结束终态 | beat=totalBeats、fi=末队形、`ended` 事件、音频停末尾 | beat=0、fi=0、**无 ended 事件**、静默归零 | ❌ 缺陷 #6 |
| 结束后再按 ▶ | 只重播最后一段（beat 从 6 起） | 重新单段预览第 1 段 | ❌ 缺陷 #7 |
| 播放中改 BPM | beat 4.92→10.41（×2.12）跳变，音乐不变速 | beat 4.97→10.49（×2.11）跳变 | ❌ 缺陷 #2 |
| 播放键语义 | 从当前队形段起播（fresh+数拍） | 单段预览（hold+travel 即停） | 语义分叉（设计选择，见 #4/#6） |

---

## 三、缺陷清单

> 每项：级别 / 复现动线（探针 + 手工步骤）/ 证据 / 影响 / 建议修复方向（不实现）。证据文件均在 `/Users/helius/.zcode/workspace/default/wuzhen-e2e-lab/out/round30-analysis/`。

### P1

#### 1. 「项目文件 · 不含音乐」按钮实际内嵌音乐（OBS-C）
- **复现**：载入音乐 → 导出 ▾ → 点「项目文件 · 不含音乐 (.formation.json)」→ 查看下载文件。探针 `analysis-05-mismatch.mjs`（M8）。
- **证据**：导出 7,528,334 字节，`audio.dataBase64` 存在（`dataFormat: audio/wav`，version 2）；与「含音乐」按钮导出**字节数完全相同**（`m8-export-noaudio-btn.json` / `m8-export-withaudio-btn.json`）。根因：`main.js` `exp-json` handler 调 `getExportAudioBlob()` 并按结果 `doExportJSON(!!blob, false)`——拿到 blob 就内嵌，菜单文案形同虚设。
- **影响**：用户以为导出轻量可分发文件，实际携带整曲 base64（体积 ×1000+）；「不含音乐」的交付意图（如发给无权使用音乐的人）被静默违背。
- **修复方向**：`exp-json` 明确传 `includeAudio=false`（不取 blob）；或文案动态化（「不含音乐」仅在无乐时可见）。

#### 2. 播放中改 BPM：播放头跳变、切分点与音乐脱钩（双时钟皆然）
- **复现**：播放中（beat≈5）把 BPM 输入框 120→240 回车。探针 `analysis-03-editplay.mjs`（E4）。
- **证据**：音乐档 beat 4.92→10.41（130ms 内，audioT 仅 +0.13s）；无音乐档 4.97→10.49；pb-pos 从 2.x 跳 4.2；播放继续、无任何守卫。根因：音乐时钟 `beat=secToBeat(audioT)` 与虚拟时钟 `beat=base+elapsed×bpm/60` 都直接读活值 `p.audio.bpm`，无重基（rebase）处理。
- **影响**：排练中误碰 BPM 输入框 → 队形切换拍点全部瞬间位移，音乐与走位对齐被破坏；用户看到播放头凭空跳跃。
- **修复方向**：播放中禁改/先暂停；或 live 改 BPM 时按 `sec` 重基虚拟时钟并对音乐通道做等效补偿提示（至少 toast「BPM 已改，播放头已按新拍重映射」）。

#### 3. 播放中载入损坏音频 → 播放器僵死态
- **复现**：播放中 `setInputFiles` 一个文本伪装的 `.wav`（或任何解码失败文件）。探针 `analysis-05-mismatch.mjs`（M7）。
- **证据**：1.2s 后 `playing=true`、`beat=1.92` 冻结、`audio.ready=false`、`useAudio=false`、`_virtual=null`、播放键显示 ⏸；800ms 后依旧；toast「音乐载入失败：音频无法解码」。根因：`loadBlob()` 先 `dispose()`（`ready=false`）再等 metadata，reject 后不回滚；`Player._tick` 在 `useAudio=false && !_virtual` 时走 `beat=this.beat` 空转，永不退出 playing 态。
- **影响**：UI 谎报播放中；计时空转；用户必须再点一次 ⏸ 才能恢复。另注：换**合法**新音频成功时播放也会静默停（见 #21）。
- **修复方向**：`loadAudioFile` 失败路径恢复旧音频会话（blob 还在 `audio.blob`）或强制 `player.pause()`；`_tick` 对 `useAudio=false && !_virtual` 的 playing 态加超时自愈。

### P2

#### 4. 无音乐时「循环」完全失效（OBS-A）
- **复现**：不载音乐 → 勾选「循环」→ ▶。探针 `analysis-01-dualclock.mjs`（loopNomusic、loopMusic）。
- **证据**：音乐档 8.5s 内回绕 2 次持续播放；无音乐档播放一次段预览（4+2 拍）即停，播放头归 0，此后 5s 无任何动作；`pb-loop` 仍勾选、`player.loopOn=true` 但 previewStop 优先。无扬声器排练（教师办公室/候场）是真实场景。
- **影响**：开关状态撒谎；无音乐排练无法循环磨同一段。
- **修复方向**：无音乐分支支持虚拟时钟循环回绕（去掉该路径的 previewStop 与循环互斥），或勾选循环且无音乐时 toast 说明。

#### 5. 数拍进行中按 ▶/空格 = 重开完整倒计，非取消/暂停（OBS-B）
- **复现**：countIn=4 → ▶ → 倒计中再按 ▶ 或空格。探针 `analysis-02-countin.mjs`（C3）。
- **证据**：重开后再现完整 4→3→2→1、再响 4 声、再等 4 拍才起播；Esc 不取消（overlay 持续）、切编辑锁不取消。根因：数拍期 `playing=false`，`togglePlay` 走 fresh 分支重新 `play()`（`play()` 内 `_cancelCountin` 后重数）。
- **影响**：手滑多按一次 = 全部重来；与「播放键=暂停」直觉相悖；Esc（全局「取消」键）无效。
- **修复方向**：数拍中 ▶/空格 = 取消数拍（回停止态）；再按才重新起数。Esc 直接取消数拍。

#### 6. 播放结束终态双标（OBS-D）
- **复现**：同一 8 拍小项目分别在有/无音乐下播完。探针 `analysis-01-dualclock.mjs`（endMusic/endNomusic）。
- **证据**：音乐档终态 beat=8（totalBeats）、fi=2、pb-pos「3.1」、`ended=true`；无音乐档终态 beat=0、fi=0、pb-pos「1.1」、无 `ended` 事件（`onPreviewEnd` 直接 `seekBeat(0)`）。
- **影响**：同一动作两种终端语义；脚本/自动化与用户心智都需要区分两套终态；无音乐档「结束」不可感知。
- **修复方向**：统一终态语义（都停在 totalBeats 或都归 0），无音乐预览结束也发 `ended`。

#### 7. 全曲播完后再按 ▶ 只重播最后一段（音乐档）
- **复现**：有音乐播到结束 → 再按 ▶。探针 `analysis-01-dualclock.mjs`（replayMusic）。
- **证据**：按下后 beat=6.94 且 fi=2——从最后一段 `holdStart=6` 起播，非从头、也非整曲。
- **影响**：排练者最常见动作「播完再来一遍」得到的是最后 4 秒；须手动 ⏹ 或点第一队形才能重来。
- **修复方向**：`playerAtEnd()` 时 fresh 起播回 `formationIndex=0`（或弹回 0 拍），与 ⏹ 后行为对齐。

#### 8. 音频比时间轴短：结束瞬间播放头跳到时间轴尽头
- **复现**：3s 音频 + 3 队形（64 拍=32s）→ ▶ 播完。探针 `analysis-05-mismatch.mjs`（M4）。
- **证据**：beat 5.88（播放中）→ 下一采样 beat=64、pb-pos「17.1」（原「2.2」）、audioT 停在 3s；播放头画出波形之外；`beat=totalBeats` 是 end 分支硬赋值。
- **影响**：播放头瞬移 58 拍，视觉上「跳到不存在的时间轴区域」；用户不知道是音乐放完还是出错。
- **修复方向**：音频先结束时停在 `secToBeat(audio.duration)` 并 toast「音乐已播完，时间轴剩余 X 拍未播放」；时间轴绘制音频终点后的「无音乐区」标记。

#### 9. 播放中 scrub 越过时间轴终点 → 播放停止、音频停在半路
- **复现**：播放中把播放头拖到 64 拍（totalBeats）之外。探针 `analysis-01-dualclock.mjs`（scrubBeyondBlocks）。
- **证据**：`seekBeat(70)` → beat=70 ≥ 64 → 下一 tick 暂停，beat 钳为 64，audioT=35（曲中）。两个通道终态不一致（播放头在 32s 处、音频在 35s 处）。
- **影响**：拖一下拖过头播放就死，需重新按 ▶；右缘没有「越界即停」的视觉预警。
- **修复方向**：scrub 目标钳制 `[0, totalBeats]`；或越界后停在终点但不暂停（循环回退到终点前）。

#### 10. 首拍偏移 ≥ 音频时长：起播即停，无任何解释
- **复现**：首拍输入 999 → ▶。探针 `analysis-05-mismatch.mjs`（M3）。
- **证据**：`everPlayed=false`；beat 停 16、audioT=64（钳到曲尾）、无 toast。
- **影响**：配置错误（首拍单位误填 ms 等）表现为「按播放没反应」，不可诊断。
- **修复方向**：`firstBeatSec ≥ duration` 时输入即警告并拒绝/钳制，toast 说明。

#### 11. 换新音频后旧块拍数不变，无错位提示
- **复现**：载入 64s 曲目编好 33s 时间轴 → 再载 3s 短音频。探针 `analysis-05-mismatch.mjs`（M6）。
- **证据**：toast 仅「音乐已载入：short3s.wav」；blocks 逐字节不变；无「时长/拍数不匹配」提示。
- **影响**：换曲后时间轴整体超出新音频（播放必然触发 #8 的跳变），用户得不到任何预警。
- **修复方向**：换音频时比较 `totalDurationSec` 与新 `duration`，超出差值超阈值时 toast + 时间轴上画出溢出段。

#### 12. travel 期合并单元呈示不插值，hold 边界突跳
- **复现**：F0 两人合并收拢于 A 点、F1 同两人不合并分居 B/C 点 → 播放过渡。探针 `analysis-04-travel.mjs`（T1/T2）。
- **证据**：数据级演算（阈值同 `drawScene` 0.8m）：过渡期呈示沿用 `formations[fi]`（段首帧）的 merges——A 合并 B 无时，两人分离到 >0.8m 呈「虚线绑定+双圆」，跨入 F1 hold 一帧内绑定线消失；B 合并（single 样式）A 无时，过渡末两人以**两个叠圆**呈现（dist 0.01），进 hold 瞬间突变为单编号圆。根因：`stageScene` 的 `merges` 取 `currentFormation()`（播放中=段首帧），插值位置与合并呈示不同源。
- **影响**：过渡动画最后一刻呈示突跳，演示/录屏时穿帮；合并-拆分编排的表达在过渡期失真。
- **修复方向**：呈示 merges 取「按过渡进度混合」：travel 中对两端 merges 求并/按距离渐变（接近 ≤0.8m 且任一端有合并即呈单元符号），或至少在 travel 后半程切换到目标帧 merges。

#### 13. 「移出队形」造成缺位：过渡期舞者冻结原位、进下一帧瞬间消失
- **复现**：F1 中选中舞者 3 按 Delete（移出队形）→ 播放 F0→F1 过渡。探针 `analysis-04-travel.mjs`（T3）。
- **证据**：beat 16/20/23.9 该舞者恒在 `x=7.5`（F0 位置，`lerpFormations` 的 `a=A||B, b=B||A` 兜底），beat 24 起从 `positions` 消失不被绘制；`validateProject` 也不回填缺位。
- **影响**：用户对「队形里删人」的心智是「他退出走位」，实际他先静止站在原地看完过渡再人间蒸发；反向上场时是瞬间突现。
- **修复方向**：`syncTimeline`/删除路径对缺位帧做 `carryPositionsForward` 回填（生成器路径已有此函数）；或过渡插值对缺位者显式淡入/淡出。

### P3

#### 14. 数拍中 scrub：播放头被负拍弹回
- **证据**：`analysis-02` C3：seekBeat(20) 后下一数拍 tick 把 beat 重写为 -6，播放头 20↔-6 打架（`c3_scrubDuringCountin.beats`）。
- **修复方向**：数拍期间禁用 scrub 或先取消数拍。

#### 15. 数拍中改 BPM/速度：点击间隔不跟随
- **证据**：`analysis-02` C3：120→240 中途，click 间隔恒 499/500ms（`intervalStale=true`）——`setInterval` 已排定。速度 0.5× 同理（`spb*1000/speed` 只在起数时算）。
- **修复方向**：改 BPM/速度时若数拍进行中，重排剩余计时。

#### 16. 播放中右面板「上移/下移」不暂停：内容在播放头下换位
- **证据**：`analysis-03` E2：beat 32 播放中上移后 `keptPlaying=true`，播放头所在段的内容从 F1 变 F0（`curName:'F0'`）。对照：左侧条拖拽排序 `hooks.move` 会先 `player.pause()`——同一动作两个入口守卫不一致。
- **修复方向**：`moveFormationRel` 补 `player.pause()`（与 hooks.move 对齐）。

#### 17. 播放中拖块边：拖动中循环区间失步
- **证据**：`analysis-03` E3：拖动中 `loopEnd=6` vs 实时 `travelEnd=7`（`staleWhileDragging=true`），松手后 `commitEdit→syncLoopAfterBlockEdit` 同步为 7。拖动期间播放头仍按旧边界回绕，可能提前回卷。
- **修复方向**：拖动 move 中也调用轻量 loop 刷新（或拖动中暂停回绕判定）。

#### 18. 播放中「对齐到播放头」不暂停；前一过渡可被无声拉长到数十拍
- **证据**：`analysis-03b` E8b：beat≈38.8 点击后 `seg1.holdStart` 24→38.79、前块 `travelBeats` 8→22.79（11.4s 过渡），toast 只报成功；边界在播放头下方移动，播放中舞台瞬间从 travel 插值切为 hold 帧。
- **修复方向**：点击时若在播放先暂停；`alignBlockStart` 对 `travelBeats` 增幅超过阈值（如 >16 拍）给确认提示。

#### 19. 编辑模式暂停在 travel：舞台回跳帧首，与播放瞬间画面不一致
- **证据**：`analysis-04` T4/T4b + 截图：同一暂停 beat=20（travel 中点），查看模式显示插值走位（t4b-viewmode-t50.png，两人在场中央），编辑模式显示帧首队形+Ghost（t4b-editmode-t50.png）。注：首测 t=0.07 时两截图肉眼无差（位移仅 0.57m），已用 t=0.5 重取证。
- **影响**：排练者在编辑模式暂停想看的就是当前走位，看到的是回跳帧（编辑语义合理但需自知）；两模式对照易被误报为 bug。
- **修复方向**：编辑模式暂停时叠加「半透明插值位置」图层（保留可编辑帧为主呈示），或在播放头处于 travel 时给出「走位中」角标。

#### 20. 数拍期间 pb-pos 显示 1.1、播放键仍为 ▶（cosmetic）
- **证据**：`analysis-02` C1：数拍期 `pbPos=['1.1']`（负拍被 `beatLabel` 钳 0）、`pbPlay=['▶']`（playing=false，onStateChange 未发）。
- **修复方向**：数拍期 pb-pos 显示「-n」或「入场」；播放键切为 ⏸/⏹ 态。

#### 21. 换合法新音频成功时播放静默停止
- **证据**：`analysis-03b` E7b 首测为探针伪影（同文件重选不触发 change，浏览器行为，非缺陷）；换**不同**文件细轨迹（`analysis-lib` 附加验证）：`ready=false`（dispose）→ 51ms 内 `playing=false`、beat 冻结在切换时刻、新音频 `dur=3` 就绪——播放无 toast 无理由地停了。
- **修复方向**：`loadAudioFile` 成功且正在播放时 toast「已停止播放并换曲」或直接按新音频续播当前 beat。

#### 22. `_loopStash`/`_restoreLoop` 为死代码（latent）
- **证据**：`analysis-01` loopStashLeak：预览暂停后 `loopOn=true`（`togglePlay` 在 `play()` 之后调 `updateLoop()` 立即覆写了挂起态），stash 残留但无害，续播后循环正常回绕。代码注释宣称的「预览期间挂起循环」实际靠 `_stopAt` 分支先于循环分支的顺序保证，stash 机制从未生效。
- **修复方向**：删除 stash 机制或在 `play()` 内改为「记序不覆写」，防未来改动顺序时引入真回归。

---

## 四、确认为设计合理 / 非缺陷（防重复报）

| 项 | 实证证据 | 结论 |
|---|---|---|
| 双时钟暂停/续播精度 | 两档续播间隙均 0 拍 | ✅ 无缺陷 |
| 播放中 scrub 双向定位 | 音乐档 beat↔sec 精确映射（30.71↔15.36s），播不停 | ✅ |
| **OBS-E 变速 × 音乐** | 0.5×：`playbackRate=0.5`、拍速率 1.004、拍点对齐 | ✅ **非缺陷**；音调随变速变化为 WebAudio 常态（听感项，见声明） |
| BPM 标错后修正保序 | 120→140：拍不变、段序保持、秒距等比 ×0.857（`analysis-05` M1） | ✅ |
| 负首拍偏移被钳制 | UI 与 `validateProject` 均钳 ≥0（M2） | ✅ 合理：音频开始前无采样，负偏移无意义 |
| countIn=1 / 0 边界 | 「1」显示 1 拍后起播；0 直接起播（`analysis-02` C2） | ✅ |
| 数拍+循环组合 | 起播数一次，回绕不再数拍、无 overlay 复现（C4） | ✅ |
| 播放中删除队形 | 先 `player.pause()` 再删，totalBeats 40（E1） | ✅ 安全 |
| 播放中点队形 chip | 无条件暂停 + 切帧动画，beat 冻结（E6） | ✅ 安全 |
| 播放中刷新页面 | 回 0 拍/未播放/队形 0，项目与音频经存储恢复，无报错（E9） | ✅（播放态不持久化属合理取舍） |
| 深链导入与播放 | 深链仅在 boot 执行，播放中无触发面；刷新即回干净态 | ✅（与 E9 同语义） |
| 导出→导入含乐往返**行为** | 导入后 `useAudio=true`，队形切换 beat 24.17 vs 期望 24（<0.2 拍），持续播放（M9 复跑） | ✅ 对齐 |
| 长曲目+多块性能 | 600s wav+32 块：播放头 p95 0.1ms、舞台绘制 p95 0.5ms、时间轴全量重绘 p95 1.4ms、0 longtask（`analysis-06`） | ✅ 无性能缺陷（桌面 headless 口径） |
| 同一文件重选不触发 change | 浏览器 file input 行为（`chg:0` 实证） | ✅ 非应用缺陷 |
| 拖边改时长后循环跟随 | 松手 `commitEdit→syncLoopAfterBlockEdit` 已修（DEFECT-R26-4 复验通过，E3） | ✅ 已修复项保持 |

---

## 五、平台诚实声明

1. **听感不可自动断言**：变速播放的音调变化（`playbackRate` 未设 `preservesPitch`）、节拍器/数拍 click 的音色音量、「音乐与队形切换听感是否踩拍」——本报告只以数值断言（拍速率、切换 beat 误差 <0.2 拍、click 频率序列），**未做人工听感验证**。headless 环境无真实扬声器，click 声以 `OscillatorNode.start` 拦截计数代替。
2. **性能口径**：桌面 headless Chromium（1360×860），单显示尺寸、默认缩放 + 8 档放大两窗口；移动端/低端设备/后台标签节流未测。
3. **探针驱动面**：scrub/对齐等经 `musicTl.hooks`（与尺规 pointer 事件同一处理函数），拖边用真实 `page.mouse` 指针轨迹；文件导入经 `filechooser` 事件（与用户选文件同一 input）。除个别标注（E7 首测为探针伪影并已重测）外均为真实 UI 路径。
4. **证据时效**：全部数据 2026-09-10～16 采集于 dev 工作树 `build-26-e2e2`；应用修复后需复跑（探针可一键重跑，见下）。

## 六、探针与证据索引

探针（可复跑，`node analysis-NN-*.mjs`）：

| 文件 | 覆盖 |
|---|---|
| `wuzhen-e2e-lab/analysis-lib.mjs` | 共享库（launch/setup/采样器/落盘） |
| `wuzhen-e2e-lab/analysis-01-dualclock.mjs` | 双时钟对照全格 + OBS-A/D/E + loopStash 证伪 |
| `wuzhen-e2e-lab/analysis-02-countin.mjs` | 数拍族 + OBS-B（C1–C5） |
| `wuzhen-e2e-lab/analysis-03-editplay.mjs` | 播放中编辑族 E1–E9 |
| `wuzhen-e2e-lab/analysis-03b-followup.mjs` | E7 细轨迹证伪 + E8b 播放中对齐 |
| `wuzhen-e2e-lab/analysis-04-travel.mjs` | travel/merges/缺位 + 暂停落点截图 |
| `wuzhen-e2e-lab/analysis-05-mismatch.mjs` | 错位族 M1–M9 + OBS-C + 僵死态 + 往返 |
| `wuzhen-e2e-lab/analysis-06-perf.mjs` | 600s wav + 32 块性能（自动生成长音频） |

证据：`wuzhen-e2e-lab/out/round30-analysis/`（7 个 JSON + 3 组截图 `t4b-*.png`/`t4-*.png` + 导出样本 `m8-*.json`/`m9-*.formation.json` + 测试音频 `short3s.wav`/`long10min.wav`）。

## 七、建议修复排期

**适合小轮快修（局部、低风险，每项 ≤半天）**：
- #1 不含音乐按钮（改一行语义 + 文案核对）
- #7 结束后再播回第 0 段 / #6 终态统一（`_tick` 与 `onPreviewEnd` 两处）
- #5 数拍中 ▶/Esc = 取消（`togglePlay`/`Escape` 两个入口）
- #14 数拍中禁 scrub、#16 右面板重排补 pause、#9 scrub 钳制、#10 首拍超长警告、#20 数拍期按钮态
- #21 换音频 toast、#3 僵死态自愈（loadAudioFile 失败路径 pause）

**需要设计拍板（语义取舍）**：
- #4 无音乐循环（虚拟时钟回绕 vs 明示「循环仅音乐模式」）
- #2 播放中改 BPM 的守卫策略（禁改 vs 重基映射）
- #8/#11 音频-时间轴失配的呈示（溢出区绘制 + 文案口径）
- #12/#13 过渡期呈示插值（merges 混合规则、缺位者淡入淡出）——涉及呈示规范，建议与编排用户对齐后再动
- #19 编辑模式暂停走位呈示（半透明图层与否）

---

## 八、round32 修复记录（2026-09-19，build-28-music，用户裁定「音乐部分尽量简洁，重点是对齐编辑体验」）

**本轮已修**：
- #1（P1）：「不含音乐」导出严格导出 v1（无 dataBase64），按钮改名「导出项目文件（含音乐）/（不含音乐）」，不含乐 toast 明示「不含音乐，可稍后重新载入」（main.js wireTopbar）。
- #2（P1）：播放/数拍中 BPM/首拍/点拍禁改——UI disabled（title「暂停后可修改」）+ 改变路径一律拦截（main.js updateMusicLock/rejectLockedMusicEdit）。取「禁改」方案（最简，无重基映射）。
- #3（P1）：损坏音频不僵死——audio.js loadBlob 改非破坏式（失败保留旧会话）、player._tick 对音频会话消失自愈暂停、loadAudioFile toast「音频无法播放，已忽略」。
- #5/#14（P2）：数拍中 ▶/空格/Esc/摸时间线 = 取消倒计回停止态（player.cancelCountin 基准拍还原；MusicTimeline._down 取消）。
- #6（P2）：终态统一——无音乐 ▶ 不再单段预览，同音乐档播到 totalBeats 停止并置 ended；全曲播完再按 ▶ 从头播（合并 #7 修复）。附带效应：无音乐 + 循环的段内回绕随之生效（#4 的循环失效部分顺带修复）。
- 报告#8（任务#7，P2）：音频先于时间轴自然结束——播放头钳在音频末拍（不再越界画出波形外）、toast 一次「音乐已结束」；再按 ▶ 虚拟时钟从当前拍接管至 totalBeats（取混合语义，实现代价小：useAudio 按 _audioEnded 关断）。
- #9（P2）：player.seekBeat 钳制 [0, totalBeats]。
- #10（P2）：首拍 ≥ 音频时长时一次性 toast 告警（不阻断）。
- #16（P2）：右面板「上移/下移」播放中先暂停（与左栏拖拽守卫对齐）。
- #21（P3）：播放中换曲先暂停，toast 明示「（播放已停止）」。
- #20（P3）：数拍期播放头呈「入场」、播放键呈 ⏸。

**backlog（本轮不做）**：#4 的「无音乐无数拍入场」、#8/#11 音频-时间轴失配呈示（溢出区绘制）、#12/#13 过渡期呈示插值、#15 数拍中改 BPM/速度不跟随、#17 拖边循环失步、#18 播放中对齐+过渡拉长、#19 编辑模式暂停呈示、#22 _loopStash 死代码清理。

---

## 九、round34 附表（2026-09-24，P4/P5 全用例 E2E 实测轮，build 工作树 5201046）

本轮以 `docs/test-cases-full.md` P4（36 条）/ P5（26 条）共 62 条用例全量实装驱动（lab/run-userflows-p4.mjs + run-userflows-p5.mjs，证据 `wuzhen-e2e-lab/out/round34-batchA/`），实测当场修复 2 项、「确认为设计合理」5 项。

### 9.1 当场修复（含前后证据）

| # | 级别 | 现象 | 根因 | 修复（diff） | 前后证据 |
|---|---|---|---|---|---|
| FIX-R34-1 | P3·竞态 | 载入音乐后**立即**按 ▶：播放刚起即停（playing 翻回 false、beat 冻结 ~0.07），▶ 复位，无提示 | `audio.loadBlob` 在 `decodeAudioData` **之前**置 `ready=true`，而 `loadAudioFile` 的项目字段提交（`p.audio.name`）要等 `loadBlob` 返回——中间隔整段解码（长曲数百 ms）。此窗口按 ▶：`useAudio=false` → 虚拟时钟起播；随后 name 提交使 `useAudio` 翻真 → `player._tick` 走「音频通道停了」自愈暂停 | `js/audio.js` loadBlob：`this.ready = true` 移到波形解码之后（窗口闭合） | 探针 `lab/probe-r34-audiorace.mjs`：修复前 **0/3**（playing=false、beat 0~0.04）；修复后 **3/3**（playing=true、beat≈1.7、零 pageerror）。证据 `out/round34-batchA/audiorace-results.json` |
| FIX-R34-2 | P3·健壮性 | 播放随即被打断（换曲先停/快速暂停）时 console 冒 `AbortError: The play() request was interrupted by a call to pause()` 的 **unhandled rejection**（E2E 记为 pageerror 噪声） | `audio.play()` 直接返回 `el.play()` promise，被 pause 抢先时 reject 无消费者 | `js/audio.js` play()：`return this.el.play().catch(() => {})`。真正的播放失败仍由 `player._tick` 的「音频通道停了」自愈兜底，行为不变 | 修复前 P4 首轮 36 条中 TC-P4-32/36 因该 pageerror 判 FAIL；修复后两用例「零 pageerror」严格断言通过（36/36 全绿） |

单测回归：`npm test` 232/232 PASS（该套件内 build 步骤已把 dist/formation-studio.html 同步重建，含上述修复）。

### 9.2 「确认为设计合理」附表（不改码，仅记录口径）

| # | 观察点 | 本轮实证口径 | 影响用例 |
|---|---|---|---|
| D-1 | 切帧预览不经播放引擎 | 预览=舞台 UI 动画（`startPositionsPreview`），switchFormation 先 `player.pause()`；「切帧预览期间循环挂起」实际语义=播放暂停、循环勾选与 loopOn 保持，▶ 后在新帧段回绕。player 内 `_stopAt/_loopStash` 预览引擎为死代码（round30 已记），行为无碍，清理维持 backlog | TC-P5-04 |
| D-2 | 停止态切帧不追播放头 | `stepFormation` 仅在 `beat>0.001 且非播放态` 时 `seekFormation`——beat≈0 的干净停止态切帧只改选中、播放头保持 0，防误清用户定位，合理 | TC-P5-18 |
| D-3 | 「校准」子行默认收起 | 点拍/试听/小节/数拍入场收进 `#calib-disc` 折叠（低频校准工具与主行对齐动线分离）；E2E 需先展开方可点击（仪器口径，与 UF2 一致） | TC-P4-03/04/05/06/26/27/29 |
| D-4 | 空格双语义延迟到 keyup | keydown 只置 spaceHeld；keyup 未参与指针手势才 togglePlay；window blur 清 spaceHeld 防卡键——设计确认 | TC-P5-26 |
| D-5 | 数拍取消回停止态基准拍 | ▶/空格/Esc/摸时间线四通道统一 `cancelCountin()`：回 `_ciBase`、不直接起播、不残留负拍（round30 #5/#14 修复语义的回归确认） | TC-P5-20、TC-P4-34 |


---

## 十、round37 附表（2026-09-25，P1/P2/P3 全用例 E2E 实测轮，build 工作树 5201046 + 本轮修复）

本轮以 `docs/test-cases-full.md` P1 建档（22 条）/ P2 名册与对象（28 条）/ P3 队形编排（26 条）共 76 条用例全量实装驱动（lab/run-userflows-p1/p2/p3.mjs，证据 `wuzhen-e2e-lab/out/round37-batchB/`），实测当场修复 4 项、「确认为设计合理」6 项。回归：既有全部套件复跑绿（l0/l1/r/gr/realinput/l2/uf1/uf2/p4/p5/音乐/node --test，见 `out/round37-batchB/regression/summary.txt`）。

### 10.1 当场修复（含前后证据）

| # | 级别 | 现象 | 根因 | 修复（diff） | 前后证据 |
|---|---|---|---|---|---|
| FIX-R37-1 | P3·交互失效 | 「统一朝向…」下拉无选择=全体时不生效且 console 报 TypeError；F 键无选择同炸（整体旋转滑杆 input 预览同源） | `js/main.js` 三处 `[...currentFormation().positions.keys()]`——positions 是普通对象，没有 `.keys()` 方法；有选择时走 `expandedSelection()` 分支掩盖了该路径 | 三处改 `Object.keys(currentFormation()?.positions \|\| {})`（含空帧守卫） | TC-P3-10 修复前 FAIL（pageerror×2、朝向不动 [0,60,…300]）；修复后面向观众全员 180、F 键多选仅所选生效，26/26 全绿 |
| FIX-R37-2 | P3·输入健壮性 | 舞台尺寸输 -2 → `stage.widthM=-2`、输 100 → 100 原样入库（几何损坏：负宽/超域）；仅 0/NaN 被挡 | `stageChange` 的 `Number(v) \|\| 原值` 只挡 falsy，min/max 属性对直接键入无约束 | `js/main.js` 新增 `STAGE_RANGE`（宽/深 4..50、后台 0..10、网格 0.1..2）——越界/非法一律回退原值；`propsKey=''` 强制重建舞台页使输入框回显实际生效值 | TC-P3-18 修复前 -2→-2、100→100；修复后均回退 16 且输入框同步（0 仍回退原值，合法值直通） |
| FIX-R37-3 | P3·数据丢失 | 粒度「仅男士/仅女士」生成后，粒度外舞者被瞬移到舞台中心（首帧场景）；文档预期「仅 role=M 位置改变，F 不动」 | `applyGenerator`→`applySlots` 整表替换 positions，子集外舞者清位后由 `carryPositionsForward` 兜底——首帧无上一帧可顺延，落到中心回退点 | `js/main.js` applyGenerator：子集生成前留存子集外舞者本帧现位，applySlots 后回填（全员生成整体替换语义不变） | TC-P3-02 修复前 F 三人全部落 (6,8)；修复后 F 逐人不位移、仅 M 到横排；TC-P3-24 全员替换语义回归 PASS |
| FIX-R37-4 | P3·呈示失效 | 「上传背景…」成功入库（dataURL 持久、清除可逆），但舞台画布**永远看不到衬底**——功能自上线起不可见 | `js/stage.js` drawScene 绘制顺序：bgImage 画在后台区/舞台白底**之前**，随即被 `#ffffff` 台面整幅覆盖；该功能此前无任何像素级验证 | bgImage 绘制块移到台面/后台底色之后、网格之前（50% alpha 衬底只在舞台区域可见，网格/舞者照常叠于其上；PNG 导出/打印同源受益） | TC-P3-21 修复前舞台中心 rgb=(218,224,231) 无红；修复后 (237,146,146) 红衬底可见，清除后恢复白底、刷新持久不变 |

单测回归：`npm test` 全绿（见 10.3）；既有 E2E 套件（含 L0/L1/L2/R/GR/RI/UF1/UF2）复跑绿，上述修复未改变任何既有断言口径。

### 10.2 「确认为设计合理」附表（不改码，仅记录口径）

| # | 观察点 | 本轮实证口径 | 影响用例 |
|---|---|---|---|
| D-6 | 对数上限 30 仅为提示 | spinner 在 max=30 封顶（ArrowUp 不越界）；直接键入 31 建档按 31 对（62 人）——`Math.max(0,·)` 只钳下界，文档既定口径「30 上限由 input max 提示」 | TC-P1-08 |
| D-7 | 拖合并成员=整单元位移 | gesture 快照恒为整单元（无单人拉伸路径）：拖 A 与 C 合并时旧单元另一成员 B 随行平移（间距保持、越界钳制），替换合并语义不受影响。文档 TC-P3-25 的「拖单元成员分离呈示」动线据此不可达，本轮以「生成器拆呈示+刚性平移+重新合并合拢」等价覆盖 | TC-P2-24、TC-P3-25 |
| D-8 | 均布方向切换初值 | `distributeAxis` 初始 undefined → 首次右键固定切到「纵向」（toast 明示），第二次才「横向」——方向状态机有明示文案，无歧义 | TC-P3-04 |
| D-9 | 切帧动画中点击不吞输入 | 动画=纯舞台 UI（`startPositionsPreview`），点击照常生效（选择/工具），动画自身 ≤0.7s 有限结束落目标帧；与 L2#C-06 已验口径一致，文档「点击打断立即落终态」按此校准 | TC-P3-22 |
| D-10 | history 哨兵计数与容错 | 哨兵条目恰一条、库⇄编辑器往返不堆积；前进重开已删项目时 `replaceState` 摘标记、留在库不卡死——F-04 决策机行为回归确认 | TC-P1-13、TC-P1-14 |
| D-11 | single 单编号呈示=单圆+虚线外环 | ×2 角标已移除（round23 决策）：外环 #38bdf8 虚线即单元区分符，像素实测命中 | TC-P2-22 |

### 10.3 回归数字

- 新驱动：P1 22/22、P2 28/28、P3 26/26（`out/round37-batchB/p{1,2,3}-report.md`）。
- 既有套件复跑：l0 / l1 / r / gr / realinput / l2 / userflows(uf1) / userflows2(uf2) / userflows-p4 / userflows-p5 / 音乐(r23-music) / node --test 全绿（`out/round37-batchB/regression/summary.txt`）。

## 十一、round39 附表（2026-09-24，P6/P7/P8 全用例 E2E 实测轮，build 工作树 5201046 + round37/39 修复，dist 已重建）

本轮以 `docs/test-cases-full.md` P6 视图/移动端/说明书（新增直断言 4 条）/ P7 数据与迁移（新增直断言 11 条）/ P8 skill 辅助（新增直断言 4 条）共 19 条🔵用例落地 + 7 条重点边界扩展（lab/run-userflows-p6/p7/p8.mjs，证据 `wuzhen-e2e-lab/out/round39-batchC/`），实测当场修复 2 项、「确认为设计合理/已知语义」4 项。✅已有 47 条逐条核对断言强度达标（详见 test-cases-full.md round39 证据节）。

### 11.1 当场修复（含前后证据）

| # | 级别 | 现象 | 根因 | 修复（diff） | 前后证据 |
|---|---|---|---|---|---|
| FIX-R39-1 | P2·持久化失效 | 主题切换后**刷新必回深色**：顶栏 🌙→☀️、data-theme、meta theme-color 当场全跟随且 localStorage `fs.theme=light` 写入成功，但 F5 后一律 dark——「记忆上次主题」语义形同虚设（TC-P6-12 检查点直接命中） | `js/store.js` state 对象字面量 **`theme` 键重复**：首行读 `localStorage.getItem('fs.theme')`，末尾又写 `theme: 'dark'`——后者覆盖前者，模块加载读值成为死代码 | 删去重复键，保留 localStorage 读值（附注释 FIX-R39-1） | 修复前探针 `probe-r39-p6.mjs`：after reload `{state:"dark", ls:"light"}`；修复后 39C#TC-P6-12 全绿（light 刷新保持 light、切回 dark 再刷新同样记忆，双向验证） |
| FIX-R39-2 | P2·呈示失效 | 工具栏「路径」按钮与样式页「移动路径（虚线）」复选切换时状态位/按钮样式正常联动，但**舞台画布零视觉变化**（39C#TC-P6-16 [PIXEL] diff=0px）——交互舞台的当前→下一队形移动路径虚线自功能上线起从未渲染过 | `js/stage.js` StageView.draw() 调 drawScene 时传了 `nextPositions` 但**漏传 `paths` 门闩**——drawScene 内 `if (opts.paths && opts.nextPositions)` 永假；「Ghost 虚影」同结构（`opts.ghost`）正常，掩盖了该路径 | drawScene opts 增加 `paths: !!nextPositions`（nextPositions 本就由 scene.showPaths 门控，如实回传） | 修复前 on→off/off→on 画布 diff 均 0px；修复后关路径 diff>50px、重开恢复（与初始帧 diff<50px），[PIXEL] 出现/消失双向断言过 |

单测与回归：`npm test` 全绿；既有全部套件（l0/l1/r/gr/realinput/l2/uf1/uf2/p1..p5/音乐）复跑绿，dist 单文件已重建（含 FIX-R39，file:// 渠道同步受益）。

### 11.2 「确认为设计合理 / 已知语义」附表（不改码，仅记录口径）

| # | 观察点 | 本轮实证口径 | 影响用例 |
|---|---|---|---|
| D-12 | 画布配色方案不随主题（舞台画布恒浅底 / 时间轴画布恒深底） | StageView.draw 先铺 `--stage-chrome` 色，随即被 drawScene 的固定浅底 `#f8fafc` 整幅覆盖（实测双主题 (3,3) 像素均 #f8fafc）；时间轴画布硬编码深色系（#0b1220/#131c31，timeline.js）。主题只作用于 DOM chrome（面板/按钮/CSS 变量，TC-P6-12 已断言跟随）。两画布「深浅双底」为既定视觉设计（部署版同口径），未按缺陷处理；如需「画布跟随主题」属新需求 | TC-P6-12 |
| D-13 | 说明书音乐/播放两图无 tag 道 | 两图摄于 build-28-music 干净快照基线（manual-shots-v2 纪律：不在有并行改动的工作树拍摄），早于 tag 特性并入；图像与 `scripts/manual-assets.json` 单一事实源逐字节同步、版本徽标运行时渲染=当前 build-29-tags。属「截图基线滞后于特性」的已知口径，建议下次干净快照重拍两图 | TC-P6-15、TC-P6-B3 |
| D-14 | 应用导出保留 `merges:[]` 空数组形态 | cloneBasic 原样导出内存态（createFormationFrom 给帧带 `merges:[]`），而 validateProject 导入时剥离空数组——往返**语义无损**（有无 merges 完全等价），仅字节形态差；skill 侧 roundtrip 两侧都过 validateProject 故逐字节一致。如需应用导出字节级幂等可在 cloneBasic 归一，本轮不改（避免扰动既有 UF1/UF2 文件比对口径） | TC-P7-21 |
| D-15 | 400ms 防抖窗口内刷新=尽力而为 | mutate 后 <400ms 触发 reload：pagehide flush 的 IDB 事务在页面卸载期不保证提交（实测落点=回退上一收敛态）；≥400ms 经 debounce 正常落盘，visibilitychange/pagehide 强制落盘在正常隐藏路径有效。产品口径「改动 400ms 内自动落盘」按「不 crash 且最终一致」验收，窗口内极速刷新的极端竞态不承诺保留最后一次击键 | TC-P7-B1、A7-14 |

### 11.3 回归数字

- 新驱动：P6 7/7、P7 14/14、P8 5/5（`out/round39-batchC/p{6,7,8}-report.md`；26/26 PASS）。
- 既有套件复跑：l0 / l1 / r / gr / realinput / l2 / uf1 / uf2 / p1 / p2 / p3 / p4 / p5 / 音乐(r23-music) / node --test（见 `out/round39-batchC/regression/summary.txt`）。

---

## 十二、多轨模型（R47 · 2026-09-24，真·多轨数据模型与引擎层落地，Lane B）

用户拍板：**真·多轨，两步走——本期 2 轨起步、上限 4 轨；solo 暂不做**。本节记录已落地的数据形态、迁移规则、引擎语义与拒绝策略（实现全部 additive：js/model.js + js/audio-clips.js，main.js/timeline.js/audio.js/index.html/css 零改动）。UI 渲染（时间轴多 lane）留给汇合轮（Lane A 音乐模式 UI + 本引擎对接）。

### 12.1 数据形态

```
project.timeline.tracks = [{ id, name, gain, muted }]
  id      轨标识（默认轨恒为 'trk1'；新增轨 uid('trk')）
  name    非空 ≤24 字（默认轨「配乐」；新增缺省「轨 N」避开占用名）
  gain    0..2 线性（与 ClipTransport 总控同域；UI 滑杆 0..1.5）
  muted   整轨静音布尔

project.timeline.audioClips[i].trackId   clip 归属轨；缺失/悬挂在清洗时回落 trk1
```

- 常量：`TRACK_MAX=4`（**上限由 UI 层把守，模型层不设限**）、`TRACK_NAME_MAX=24`、`DEFAULT_TRACK_ID='trk1'`。
- `createProject` 恒建 `tracks:[trk1「配乐」]`；`validateProject` 对空/缺失 tracks 缺省补建——**单轨旧项目零体验变化**。
- clip 增益数学不含轨增益：`clipGainAt`（淡化/clip gain/静音）与轨增益分属两级 Gain 节点，`trackOfClip` 提供悬挂回落（trk1 → 首轨）。

### 12.2 迁移与清洗（validateProject，导入/载入/保存收口）

| 输入形态 | 行为 |
|---|---|
| timeline 无 tracks / 空数组 | 补建 `[{id:'trk1', name:'配乐', gain:1, muted:false}]` |
| track 重复 id | 保首个、弃后续（同 tags/groups 口径） |
| track 非法项（非对象/无 id 补 uid 后照常入库；gain 越界钳 0..2） | 清洗 |
| clip.trackId 缺失 / 悬挂（指向不存在轨、轨上限外被删轨等） | 回落 `trk1`（无 trk1 时回落首轨） |
| 旧单字段 `autoPair` | 升级双缘：`autoPairOut`（淡出缘对端）/`autoPairIn`（淡入缘对端）；单侧 auto 缘按缘精确归属；双侧 auto 缘并存（链式中段被旧单字段覆写过）按「末次写入=淡出缘」启发式归 out，in 侧陈旧记录留待 prune 幽灵清理收口；旧字段保留为兼容镜像（旧版应用读新文件不丢信息） |

清洗幂等：二次 validate 逐字节一致（单测覆盖）。

### 12.3 引擎语义（ClipTransport，js/audio-clips.js）

- **Gain 链**：`src → clipGain（淡化/clip 增益自动化）→ trackGain(id)（轨 gain×muted，每轨一条持久子链）→ master → destination`。轨子链挂既有 master 入口，audio.js 不需要任何改动（`playClips` 照旧）。
- **激活开关**：`syncTracks(tracks)` 或 `play(clips, { tracks })` 激活多轨；`syncTracks(null)` 拆子链回 legacy 单链。**未激活时链路与旧版逐字节一致**（`clipGain` 直连 master）——既止单轨调用面与全部既有单测不受扰。
- **跨轨同时调度**：调度器按时间域工作，与轨无关；双轨各一 clip 落在同一前瞻窗即同 tick 全部起调（离线渲染实测双源）。
- **轨静音=该轨全部 clip 静音（实时生效）**：表达为子链增益 0——该轨 clip 照常调度（与 clip 级 muted 的「不调度」语义不同），取消静音立即出声，无需 reschedule；轨 gain 变更 `setTargetAtTime`（τ=10ms）平滑实时。
- **旧总控不动**：`setTrackGain/setTrackMuted`（C15 单轨总控）仍作用于 master，多轨下语义=全局微调；汇合轮 UI 应改用 `setTrackGainById/setTrackMutedById`。
- 段间静音判定（`effectiveRegions`）与 ended 判定暂按 clip 级 muted 口径，不感知轨静音（轨静音的「时间轴事件」语义留汇合轮裁定，见 12.6）。

### 12.4 操作 API（model.js 纯函数，node 可测，供汇合轮 UI 调用）

| API | 语义 | 拒绝条件 |
|---|---|---|
| `addTrack(project, {name})` | 新增轨（gain 1、不静音、名「轨 N」避让） | 无（TRACK_MAX 由 UI 把守） |
| `removeTrack(project, trackId)` | 删除空轨 | **非空拒绝**（轨上有 clip，含缺 trackId 视同归属 trk1）；轨不存在；删除 clip 策略=拒绝（简单安全） |
| `renameTrack(project, trackId, name)` | 重命名 ≤24 字 | 轨不存在/空名 → null |
| `setTrackGain(project, trackId, gain)` | 0..2 钳制写入 | 轨不存在 → null |
| `setTrackMuted(project, trackId, muted)` | 布尔写入 | 轨不存在 → null |
| `moveClipToTrack(project, clipId, trackId)` | clip 换轨 | clip/轨不存在 → `{ok:false,error}` |
| `stripTracksForV1(project)` | **v1 剥离助手**：深拷贝去掉 timeline.tracks 与 clip.trackId（原项目不动） | — |

引擎侧对应：`syncTracks(tracks)` / `setTrackGainById(trackId, g)` / `setTrackMutedById(trackId, m)`（轨不存在返回 false）。

### 12.5 导出 / 导入

- **v2（含乐）随行**：`exportProjectJSON` 走 `cloneBasic` 全量克隆，tracks/trackId 自动随行，无需改动。
- **v1（不含乐）剥离**：导出侧 `cloneBasic` 同样全量克隆，因此剥离需在导出入口接线——已提供纯函数 `stripTracksForV1(project)`，汇合轮在 `doExportJSON(false, …)` 路径（main.js）或 `exportProjectJSON`（export.js）内一行接入即可（两个文件本轮均属并行禁区，未动）。现状：v1 文件携带 tracks 数据，旧版应用导入时未知字段被 spread 保留但不参与任何逻辑，**行为无害**，仅不够整洁。
- 往返：导出→导入 validate 后轨态/clip 归属逐字段无损（单测覆盖）。

### 12.6 上限与边界策略备忘（汇合轮裁定项）

1. 4 轨上限在 UI 层把守（addTrack 按钮 disabled / toast）；模型层超 4 轨数据不清洗不拒载（防御性宽容）。
2. `removeTrack` 只允许空轨、删 clip 拒绝——UI 侧需先引导移动/删除 clip 再删轨。
3. 跨轨重叠是否套用自动交叉淡化（`applyAutoCrossfades` 现按时间域对全部 clip 生效，不分轨）：建议汇合轮裁定「跨轨不自动淡化」（混音语义应保留叠加），如裁定成立需给 computeOverlaps 加轨过滤（一处小改）。
4. 轨静音是否参与 `effectiveRegions`（段间静音判定/ended）与时间轴呈示：建议「不参与」（静音≠无事件，走带语义稳定），与 12.3 现状一致。
5. legacy 单轨总控（音轨表头音量/静音滑杆，localStorage `wuzhen:audioTrackMix`）与 per-track API 并存期语义：master 微调 vs trk1 轨控，汇合轮切 UI 时二选一收口。

### 12.7 验证记录

- 单测：`tests/audio-clips.test.js` 24→**33**（+9：迁移/轨清洗/操作 API/removeTrack 拒绝/链式 autoPair 双缘/autoPair 迁移/双轨调度与 Gain 链拓扑/悬挂回落与 legacy 回退/导出往返与 v1 剥离），33/33 绿。
- 全量：`node --test tests/*.test.js` 基线 HEAD 256/256 → 本轮 265 测试 264 绿 + 1 预期失败（skill-choreo「vendor 防陈旧」：model.js 变更后 vendor 待编排层同步，`node scripts/build-core.mjs && cp dist/core/wuzhen-core.mjs ~/.agents/skills/dancesport-choreo/vendor/`，skill 目录本轮禁区未动）。隔离对照（clean worktree @a43dd1b + 仅本轮三文件）同为 264+1，证明无其他扰动。
- `node scripts/build-core.mjs`：dist/core/wuzhen-core.mjs 已再生（48.6 KB，97 导出，自检通过）。
- 离线渲染对拍（`wuzhen-e2e-lab/probe-round47-multitrack.mjs`，真实 OfflineAudioContext，13/13 PASS）：双轨同时调度双源；trk2 gain 0.5 实链 -6.01dB（理论 -6.02）；重叠窗功率叠加 +0.96dB（理论 +0.97）；轨态静音重叠窗回落 -0.02dB≈0、S 窗 -Inf；实时静音打在 t=2.0 → 已调度 S 源尾段 -Inf 且重叠窗不受扰（未 reschedule）。证据 `out/round47-multitrack/multitrack-numerics.json`。

---

## 十二、round46 附表（2026-09-24，Lane A·双 UI 模式 + 多选弹框 + 恒定 BPM 显性化，build `build-32-dualmode`，基准 HEAD `a43dd1b`）

本节由 round46 Lane A（核心交互线）追加，覆盖三件事：①「恒定 BPM 假设」从隐性缺陷转为**显性契约 + 降级路径**（决策⑥）；②「编辑器双 UI 模式」（编舞⇄音乐，决策②/③）；③多选弹框与单人同构（决策④）。实证依据：`docs/optimization-plan-r2.md` §1.3/§2.1/§2.2（60s 双速曲 120→160BPM 单值 BPM 模型下拍线偏移线性累积至 9.875s/19.75 拍、后半段 80 乐拍仅 1 拍落在拍线、最佳拟合 BPM 仍残 4.378s；clip 引擎全秒制天然免疫）。

### 12.1 已知限制（建档为显性契约，不再按缺陷处理）

| # | 限制 | 口径 | 降级路径（round46 已落地） |
|---|---|---|---|
| L-BPM-1 | 拍↔秒换算仅在**全曲恒定 BPM** 时成立；变速曲（现场版/渐快渐慢/多段 BPM）下拍线、tag、块边界、节拍器、数拍全部随时间线性漂移，**无法靠调单值 BPM 救回**（两段各自仍偏） | 队形层保留拍制（八拍是编舞领域母语，方案 B 全面秒制已否决）；clip/剪辑层本就全秒制、无节拍绑定 | ① **载入体检**：载入音频后实际时长与拍模型（首拍+总拍数×拍长）偏差 >10% → 一次性 toast「音频节奏与拍线可能不一致（变速曲），可用秒刻度对齐」（已读记忆落 sessionStorage `wuzhen:varispeedHint`：同一标签页会话（含刷新）不重复提示，新会话最多再提示一次——**未用 localStorage**，因既有仪器 run-ir06.mjs A9/B9 与 userflows-p1 TC-P1-15 将 localStorage 键集合钉在白名单上（新键即红），硬回归门禁优先，属任务书「localStorage 记忆已读」的降一档执行，软提示不阻断，存在强节奏但 IOI 方差大曲风的误报可能——文案用「可能」）；② **尺规秒刻度**：「拍刻度/秒刻度」按钮切换（`wuzhen:rulerScale` 记忆，默认拍；秒刻度=NICE 秒族主刻度+1/5 细分）；③ **Alt+←/→ 播放头秒步进 ±0.5s**（不依赖拍线按秒对位）；④ 应用外先把变速曲恒速化再载入。节奏图（分段 BPM 表，方案 C）为 P1 可选演进，等需求拍板单独立项 |
| L-BPM-2 | 「按队形段自动切」的切点来自拍模型（beatToSec），非恒速曲上切点随拍线漂移 | 剪切引擎忠实于输入秒值（垃圾进垃圾出），引擎本身无缺陷 | 同 L-BPM-1（体检提示 + 秒刻度人工核位） |
| L-BPM-3 | 节拍器/数拍按单值 spb 定频，变速曲下与音乐脱拍且相位持续漂移 | 数拍保留（走表不依赖音乐内容，是「给演员听的入场」） | 体检判定非恒速时以 toast 提示后按秒刻度人工对位；节拍器仅供恒速曲 |

### 12.2 双 UI 模式（编舞⇄音乐）与多选弹框的回归口径

- **编舞模式（默认）= 既有行为零变化**（几何/交互/视觉）：`tlTotalHeight('stage',·)` 与旧公式逐值一致（桌面简单 150 / 移动 120 / 展开桌面 160）；既有全部 E2E 套件跑在该模式上保持绿。
- **音乐模式**：隐藏队形块区（canvas 不绘制、命中/拖边/磁吸候选关闭）与块时长栏（`#block-ctl[hidden]`）；保留尺规（拍/秒刻度）/tag 道/音频轨（简单态+可展开）/播放头/播放条；舞台画面保留但收窄（桌面 `#stage-col` 320px、移动 42%，余量给属性面板）。切换入口=顶栏「编舞 | 音乐」分段开关或快捷键 M；**播放/数拍中禁止切换**（toast「暂停后可切换」）。状态保持：选择/tag/播放位置/循环/时间轴缩放/clip 选择跨模式与跨往返零丢失（`localStorage 'wuzhen:uiMode'` 记忆；旧 `wuzhen:audioTrackExpanded=1` 迁移为音乐模式）。
- **多选弹框（SelectionMenu，N≥2）**：朝向▸（观众/圆心/互相对齐——互对仅恰 2 人）、存为编组、合并为单元（恰 2 人未合并）、取消合并（涉合并，既有语义）、均布 纵/横（N≥3，模型语义 <3 人无效果故不呈示）、移出队形（=Del 键语义：清位不删名册）、删除所选（N 人）。**单人上下文菜单保持既有构成 `['删除','✕']`**——page-r R-02/R-04 仪器精确断言（硬回归门禁优先于「恒有朝向」的理想构成；同构骨架与条件显隐机制已就位，后续如改仪器口径可一键放开）。

### 12.8 汇合轮（2026-09-26，Lane A/B/C 集成收尾，build build-32-dualmode 工作树）

多轨 UI 已接入音乐模式（对接 12.3-12.6 引擎/API），§12.6 五条裁定项全部落定：

1. **TRACK_MAX=4 UI 把守**：音乐模式轨头底部「＋加轨」条——到限呈禁用态（`aria-disabled`+置灰）仍可点，点击 toast「最多 4 条音轨」；模型层不设限（维持）。
2. **removeTrack 仅空轨**：非空轨删除钮 disabled（title 引导「先移动或删除音频块」），无删最后一轨入口（剩 1 轨时 disabled）；模型拒绝语义保持为最后防线。
3. **跨轨重叠维持自动交叉淡化**：`computeOverlaps` 不加轨过滤（实现最简、听感合理）；菱形手柄画在 ov.a 所在 lane。
4. **轨静音不参与 ended/effectiveRegions**：维持引擎现状（静音≠无事件）。
5. **legacy 单轨总控收口**：master 滑杆（`setTrackGain/setTrackMuted`）保留为编舞模式展开态表头「整体音量」；音乐模式每轨轨头走 `setTrackGainById/setTrackMutedById`——二者并存不冲突。

**实现要点**：
- 布局：音乐模式音频区=每轨一条 lane（简单 26px/展开 72px，随既有展开开关），轨分隔线+轨头 DOM（`#tl-tracks-head`，120px 列：轨名双击改名/音量滑杆 0–1.5/静音钮/删轨钮+底部加轨条 26px）；`tlTotalHeight('music',…)`=音频轨底+12+26（编舞 150/120/160 不动，lane-a G2 同步改值）。编舞模式恒单 lane 呈示（多轨数据不改舞台几何）。
- 引擎接线：`render()` 每帧比「tracks 数组引用+内容签名」调 `transport.syncTracks`（载入/undo/redo/结构变化兜底，幂等、setTargetAtTime 平滑）；滑杆/静音直走 `setTrackGainById/setTrackMutedById`（实时，不 reschedule）；加/删轨后结构 reschedule（播放中）；clip 跨轨拖拽=模型 `moveClipToTrack`+提交后 reschedule；拖入落点按 lane 归属轨（`createClipFromDrop(…, trackId)`）。
- 轨操作历史：加轨/删轨/改名/静音各成一条（「加音轨/删音轨/重命名音轨/静音音轨」）；轨音量滑杆不进历史（同 clip 增益把手口径）。
- v1 导出剥离：`doExportJSON(false,…)` 路径一行接 `stripTracksForV1`（12.5 预留接线点）；探针实测不含乐文件无 `timeline.tracks`/`clip.trackId`、含乐文件随行。
- 探针：`lab/probe-merge-multitrack.mjs` 27/27 PASS（图标化呈示断言 6 + 多轨动线 18 + v1 剥离 + 说明书 9 图解码 + 零 pageerror；证据 `out/merge-multitrack/`）。

## 十三、就绪信号轮附表（2026-09-24，E2E 确定性完成信号 + 盲等整改，build-35-w3 工作树）

**背景**：E2E subagent 普遍以长固定 sleep 盲等 canvas 渲染/存储落盘/boot，根因是应用未暴露确定性完成信号。本轮两层根治：应用暴露信号（纯加法）+ 测试纪律与助手。

**① 应用信号（`window.__fs` 增补，全部加法、既有字段零改动）**：

| 信号 | 定义/触发点 | 消费示例 |
| --- | --- | --- |
| `__fs.ready` | Promise；boot 全流程（store.init + lastProject 恢复 + 深链 + 首帧渲染 + 订阅挂载）完成后 resolve（js/main.js boot 尾）；重复读取同一 Promise，boot 已完成则 resolved | `await page.evaluate(() => window.__fs.ready)` 替代 goto 后盲等 |
| `__fs.renderSeq` | 数字（只读语义）；状态驱动重绘计数，计点两处：`MusicTimeline.render()` 出口（js/timeline.js）与 `StageView.requestDraw()` 出口（js/stage.js）各 +1（一次完整 render() 通常 +2）。口径：rAF/切帧动效逐帧直调 `draw()` 不计、`drawPlayhead` 局部重绘不计；播放 onTick 的舞台重绘经 requestDraw 出口会计（本质状态驱动） | `waitForRender(page,{fromSeq})` 轮询 `renderSeq > fromSeq` |
| `__fs.flushNow()` | async；清 400ms 防抖定时器并立即 `storage.putProject(state.project)`（js/store.js 导出 `flushNow`：无项目 no-op；无挂起写时只等在途写完成——幂等，updatedAt 不被无谓刷新） | `await page.evaluate(() => window.__fs.flushNow())` 替代「盲等 400/900ms 防抖」后再断言持久化 |

**② 测试纪律与助手**：E2E 纪律入 `docs/test-cases-full.md` 附录（禁 ≥1s 固定盲等；一律条件等待；时序采样类除外需注释「合法时序采样」）。共享助手 `lab/lib-wait.mjs`（`waitForBoot`/`waitForRender`+`renderSeqNow`/`waitForFlush`/`waitForExpr`，超时抛错附现场 dump）。

**③ 示范改造对照表（lab/w1-verify.mjs、lab/w3-verify.mjs 各自批次驱动，共 3 处）**：

| 位置 | 前（盲等） | 后（条件等待） | 实测省时 |
| --- | --- | --- | --- |
| w1-verify.mjs IR-W1-5b | `sleep(1400)` 播放跨段界 | `waitForExpr`：轮询 formationIndex 翻转 + preview 帧名同步（超时 5s） | ~1.0s/次 |
| w1-verify.mjs IR-W1-1h | `sleep(400)` 视口改矮后重绘 | `waitForRender`（setViewportSize 前取 `renderSeqNow` 基线） | ~0.35s/次 |
| w3-verify.mjs IR-W3-2g | `sleep(500)` 等变速体检 toast | `waitForExpr`：轮询 toast 文本含「变速曲」（超时 5s） | ~0.45s/次 |

保留并注释「合法时序采样」：w3-verify 数拍大字两处 `sleep(350)`（数拍=真实时间窗 2 拍@120BPM≈1s，须窗内取样）。w3-verify-r55.mjs 为 round55 存档快照，有意不改。

**④ 单测与回归**：`tests/ready-signals.test.js` +4（flushNow 幂等/无项目 no-op/在途写收口 + renderSeq 计数语义：requestDraw +1、动画帧直调 draw() 不计）；node --test 总数 308→312 全绿，run-l2 红线 pin 按回填链协议 308→312。复跑：node --test 312/312、run-l0 20/20、run-l1 29/29、run-l2 12/12、w1-verify 36/36、w2-verify 39/39、w3-verify 42/42、默认编舞模式冒烟（拖动/undo/renderSeq/flushNow 持久化）绿、零 pageerror。
