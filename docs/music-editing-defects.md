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
