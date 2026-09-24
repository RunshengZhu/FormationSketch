# 舞阵 WuZhen · 全生命周期测试用例文档（test-cases-full）

**版本基准：v0.9.18 / build-29-tags · HEAD `e38663c`（2026-09-24 核对）**
实测基准：dev 源码树 `http://localhost:8137/`（Playwright 实况，桌面 1280×800 + 移动 375×667 hasTouch 双视口抽核，**50/50 PASS**）。
上游输入：`docs/user-guide-flows.md`（52 功能 / 8 域 / 97 条 E2E 建议，v0.9.13 时点撰写——本文全部收录并映射）；
lab 既有仪器：`run-userflows.mjs`(38) + `run-userflows2.mjs`(49) + `run-l0/l1/l2/r/gr/realinput` + `r23-music` + `probe-tags`(T1..T11) + `probe-deeplink-import` + `review31-manual`；本轮实况探针 `lab/round31-cases-probe.mjs`（证据 `lab/out/round31-cases/`）。
**本文只产出文档与实况证据，未改任何应用代码。**

## 阅读说明

- 按**编舞全生命周期**组织为 8 个 Phase（P1 建档 → P8 skill 辅助创作）。每 Phase 三层：**原子操作清单**（从代码逐个枚举，含入口实况文案，不允许「等/之类」）→ **组合动线** → **测试用例目录**。
- 原子操作编号 `A<phase>-<n>`；测试用例编号 `TC-<phase>-<序号>`。
- 检查点标注沿用 lab 规范（`tests/e2e-matrix.md`）：**[STATE]**（`window.__fs.snapshot()` / store 状态）/**[DOM]**（选择器/文案/几何）/**[PIXEL]**（canvas 位图采样）/**[SCREEN]**（合成器截图对比）。
- 自动化状态三种：**✅已有**（驱动文件+用例号）／**✅等价**（语义等价的既有用例）／**🔵建议新增**／**⛔不可自动化**（附原因）。
- 驱动缩写：**UF1**=`lab/run-userflows.mjs`、**UF2**=`lab/run-userflows2.mjs`、**L1**=`lab/run-l1.mjs`(tests/page-l1.js D 组原语手势)、**L2**=`lab/run-l2.mjs`(C-01..C-10 组合)、**GR**=`lab/run-gr.mjs`(GR-01..07 编组)、**R**=`lab/run-r.mjs`(单元语义)、**RI**=`lab/run-realinput.mjs`(真实输入通道)、**M23**=`lab/r23-music.mjs`、**TAG**=`lab/probe-tags.mjs`(T1..T11)、**DL**=`lab/probe-deeplink-import.mjs`、**MAN**=`lab/review31-manual.mjs`(R31-A..H)、**R31**=`lab/round31-cases-probe.mjs`(本轮 50 检查)。
- 总量：**原子操作 152 个**；**测试用例 202 条**（97 条既有建议全部收录映射，新增 105 条）；每 Phase 边界/异常/中断类用例 ≥3 条。

---

## Phase 总览

| Phase | 主题 | 原子操作 | 用例数 | 收录 97 条 | 新增 |
|---|---|---|---|---|---|
| P1 | 建档（新建/导入/复制/恢复） | 19 | 22 | 7 | 15 |
| P2 | 名册与对象（舞者/编组/单元/选择） | 32 | 28 | 8 | 20 |
| P3 | 队形编排（生成/整形/帧管理/舞台设置） | 24 | 26 | 9 | 17 |
| P4 | 音乐与时间轴（BPM/块时长/tag 全套） | 25 | 36 | 16 | 20 |
| P5 | 播放与演示（播放族/编辑锁/撤销/Esc 族） | 13 | 26 | 17 | 9 |
| P6 | 视图与视图变换（缩放平移/主题/移动端/说明书） | 15 | 18 | 5 | 13 |
| P7 | 数据与迁移（导出导入/深链/持久化/离线） | 16 | 34 | 27 | 7 |
| P8 | skill 辅助创作（dancesport-choreo 往返） | 8 | 12 | 8 | 4 |
| **合计** | | **152** | **202** | **97** | **105** |

---

# P1 建档：从空白到第一份项目

## P1 · 原子操作清单（代码出处：`js/ui.js` showNewProjectModal/renderLibrary、`js/store.js` createNewProject/openProject/duplicateProject/deleteProjectById、`js/main.js` wireLibrary/wireTopbar/boot、`js/model.js` createProject）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A1-01 | 打开新建向导 | 库页「**＋ 新建项目**」 | `#btn-new-project` |
| A1-02 | 填项目名称 | 向导「**项目名称**」输入框（默认「未命名队列舞」，trim，空回退默认） | `title.value.trim() \|\| '未命名队列舞'` |
| A1-03 | 选初始方案 | 「**初始方案**」下拉 4 项：「标准 · 6 对（独立）/ 6 对 · 已组合 / 8 对 · 已组合 / 自定义」 | `preset` select |
| A1-04 | 设对数 | 「**对数（男女各半）**」0..30；**仅自定义可编辑**，其余预设 disabled 且回填 6/6/8 | `pairs` input |
| A1-05 | 设额外男舞者 | 「**额外男舞者**」0..30 | `extraM` |
| A1-06 | 设额外女舞者 | 「**额外女舞者**」0..30 | `extraF` |
| A1-07 | 设初始编组 | 「**初始编组**」：「**男士 / 女士**」\|「**不分组**」 | `grouping` select(gender/none) |
| A1-08 | 创建 | 「**创建**」→ 进编辑器 + 自动生成「开场队形」（双横排面向观众） | `store.createNewProject` |
| A1-09 | 取消向导 | 弹窗「**关闭**」/点遮罩 → 放弃建档 | `modal close` |
| A1-10 | 打开项目 | 库卡片左键；或卡片右键菜单「**打开**」 | `renderLibrary onOpen` |
| A1-11 | 复制项目 | 卡片右键「**复制**」→ 标题+「（副本）」、新 id、**音频一并继承** | `duplicateProject` |
| A1-12 | 删除项目 | 卡片「**🗑**」/右键「**删除**」→ confirm「删除项目「X」？不可恢复」 | `deleteProjectById` |
| A1-13 | 项目重命名 | 编辑器顶栏项目名输入框（change 提交，空回退「未命名」） | `#proj-title` |
| A1-14 | 导入项目文件 | 「**导出 ▾**」→「**导入项目文件…**」（总是新建副本，不覆盖） | `#imp-json` |
| A1-15 | 深链导入 | URL `?import=<项目JSON的URL>`（boot 后执行，**优先于 lastProject 恢复**） | `runDeeplinkImport` |
| A1-16 | 返回项目库 | 「**‹ 项目库**」；编辑器内浏览器后退（history 哨兵）同语义 | `closeProject` |
| A1-17 | 前进重开项目 | 回库后浏览器前进 → 哨兵 reopen；项目已被删则摘标记 | `sentinel.onPop` |
| A1-18 | 库卡片右键菜单 | 「打开 / 复制 / 删除 / ✕」；Esc、点外部、重渲染均可关 | `showLibCardMenu` |
| A1-19 | 自动保存与恢复 | 改动 400ms 落盘；`visibilitychange`/`pagehide` 强制落盘；`fs.lastProject` 恢复 | `scheduleSave/flush/init` |

## P1 · 组合动线

1. **空白→首项目**：空库 → 向导 → 预设 → 创建 → 编辑器导览（左栏/舞台/右面板/播放条/时间轴）。
2. **模板建档**：选「已组合」预设 → 建档即 `pairs` 个 capsule 合并单元（数据形态与手动 merge 完全一致）。
3. **接手建档**：文件导入（P7）或深链（P7）→ 进入「原名（副本）」→ 继续编辑。
4. **项目位管理**：库页复制/删除/重命名 + 浏览器后退前进往返（history 哨兵）。

## P1 · 测试用例目录

- TC-P1-01｜空库 →「＋ 新建项目」→「创建」进编辑器｜编舞老师｜空库（首次）｜点「＋ 新建项目」→ 直接点「创建」→ 断言 view=editor｜[STATE] `snapshot().dancers=12`、formations=1「开场队形」；[DOM] `#build-tag`=build-29-tags｜空库新建是历史 P0 回归位｜✅已有：UF1#E2E-S1-01
- TC-P1-02｜「6 对 · 已组合」建档即合并｜编舞老师｜空库｜向导选「6 对 · 已组合」→ 创建｜[STATE] `formations[0].merges` 长度=6 且 style=capsule、成对两人坐标重合；[PIXEL] 舞台 6 个胶囊徽标｜「8 对 · 已组合」同理 ×8｜✅已有：UF1#E2E-S1-02；R31#E-05（12 人 6 capsule 实况 PASS）
- TC-P1-03｜自定义对数=0 + 初始编组「不分组」｜编舞老师｜空库｜选「自定义」→ 对数 0 → 初始编组「不分组」→ 创建｜[STATE] dancers=0、groups=0；[DOM] 名册空态「名单为空：点「＋ 单人」添加舞者。」｜0 人项目不崩、生成器粒度全为空集｜✅已有：UF2#E2E-S1-03
- TC-P1-04｜预设非自定义时对数 disabled｜编舞老师｜向导开｜切预设 std6/merged6/merged8 → 对数 disabled 且值回填 6/6/8；切「自定义」恢复可编辑｜[DOM] `input:disabled` 切换、value 同步｜来回切换无残留｜✅已有：UF2#E2E-S1-04；R31#E-03/E-04（实况 PASS）
- TC-P1-05｜建档后刷新自动恢复｜编舞老师｜项目已建｜F5 刷新｜[STATE] 自动恢复上次项目（`fs.lastProject`）、view=editor｜无项目时恢复进库｜✅已有：UF2#E2E-S1-05
- TC-P1-06｜向导「关闭」取消｜编舞老师｜空库｜填一半 → 点「关闭」｜[STATE] 库列表不变、无新项目｜点遮罩同语义｜✅已有：UF2#E2E-S1-06
- TC-P1-07｜向导 4 预设枚举与默认值｜编舞老师｜空库｜打开向导逐项核对｜[DOM] 4 选项文案=「标准 · 6 对（独立）/6 对 · 已组合/8 对 · 已组合/自定义」，默认 std6、对数=6 disabled｜预设文案是入口实况锚点｜🔵建议新增（R31#E-02 已实况核对 PASS，待落 E2E 断言）
- TC-P1-08｜对数/额外舞者钳制 0..30｜编舞老师｜向导（自定义）｜对数输 -5/31/非数字 → 创建｜[STATE] `createProject` 内 `Math.max(0,+pairs.value||0)` 生效（负/非法→0；30 上限由 input max 提示）｜0 人不崩（联动 TC-P1-03）｜🔵建议新增
- TC-P1-09｜打开项目双入口（卡片左键 / 右键「打开」）｜接手老师｜库≥1 项目｜两入口各开一次｜[STATE] view=editor、projectId 正确；[DOM] 右键菜单项「打开」｜右键菜单 Esc 关闭不误开｜🔵建议新增
- TC-P1-10｜复制项目（库右键「复制」）｜编舞老师｜库≥1 项目｜右键「复制」→ 新卡片「（副本）」｜[STATE] 新 id、原项目不动、`getAudio(副本id)` 非空（音频继承）｜副本再复制命名叠加「（副本）」｜✅已有：UF2#E2E-S5-13（映射自 97 条）
- TC-P1-11｜删除项目 confirm 与不可恢复｜编舞老师｜库≥1 项目｜点「🗑」→ confirm 出现「删除项目「X」？不可恢复」→ 取消 → 再点确认｜[STATE] 取消=列表不变；确认=项目与音频记录删除、若删的是当前项目则回库｜confirm 原生对话框 ⛔在 headless 需 `page.on('dialog')` 处理（可自动化，按此接线）｜🔵建议新增
- TC-P1-12｜项目重命名（顶栏）→ 库卡片同步｜编舞老师｜编辑器内｜改 `#proj-title` → 失焦 → 返回库｜[STATE] `meta.title` 变更+落盘；[DOM] 库卡片标题同步｜空值回退「未命名」｜✅等价：undo 侧由 L1#D-15 覆盖；正向改名 🔵建议新增（与 TC-P5-22 配对）
- TC-P1-13｜「‹ 项目库」返回与 history 哨兵往返｜编舞老师｜编辑器内｜点「‹ 项目库」→ 浏览器后退 → 前进｜[STATE] 库⇄编辑器往返不丢现场、history 条目不堆积（哨兵弹压）｜后退离开前编辑已落盘｜✅等价：UF1 哨兵相关断言 + UF2#E2E-S1-05；专项往返 🔵建议补强
- TC-P1-14｜前进重开已被删的项目（哨兵容错）｜编舞老师｜曾后退到库｜前进 → 项目在删除后 reopen｜[STATE] 打不开时 `replaceState` 摘标记、不卡死｜需要操纵 history 的专用驱动｜🔵建议新增
- TC-P1-15｜库卡片右键菜单四项与关闭路径｜编舞老师｜库≥1｜右键卡片 → 菜单「打开/复制/删除/✕」→ Esc / 点外部 / ✕ 分别关｜[DOM] `#lib-card-menu` 存在/移除；监听数不增长（无泄漏）｜重渲染自动收走残留菜单｜✅等价：lab lib-menu-esc 专项（`ug-debug-unit.cjs`/单测 tests/lib-menu-esc.test.js）；E2E 化 🔵建议补强
- TC-P1-16｜自动保存 400ms debounce 与隐藏强制落盘｜编舞老师｜编辑器内｜改一处 → 立即读 IndexedDB（未落盘）→ 等 500ms（已落盘）→ `visibilitychange` 触发即时落盘｜[STATE] 存储记录 updatedAt/内容一致｜写失败（配额）静默不 crash｜✅已有：UF2#E2E-S1-05（刷新口径）+ UF1#E2E-S2-12（undo 落盘口径）；visibilitychange 口径 🔵建议补强
- TC-P1-17｜标准 6 对默认建档的初始队形几何｜编舞老师｜空库｜std6 创建｜[STATE] 开场队形双横排（rows 语义）、全部 facing=180（观众在下）｜对数变化 1..4 人单排｜🔵建议新增（L0#G2/G3 已有画布预置门禁可复用）
- TC-P1-18｜「8 对 · 已组合」建档（16 人 8 单元）｜编舞老师｜空库｜选 merged8 → 创建｜[STATE] dancers=16、merges=8 capsule｜—｜🔵建议新增
- TC-P1-19｜额外男/女舞者建档叠加｜编舞老师｜向导｜std6 + 额外男 2 + 女 1 → 创建｜[STATE] dancers=15、名册序 M7/M8 无简称自动编号｜额外舞者不进编组（仅按 grouping）｜🔵建议新增
- TC-P1-20｜空库文案与空态图标｜编舞老师｜清空存储｜进库页｜[DOM] `#library-empty` 可见，文案「还没有项目，点击右上角「新建项目」开始编排队形」｜—｜🔵建议新增（R31#E-01 实况 PASS）
- TC-P1-21｜连续快速创建多个项目不串档｜编舞老师｜空库｜连续建 3 个不同预设项目 → 库页核对｜[STATE] 3 条独立记录、id 互异、卡片元信息（人数/队形/时间）各自正确｜存储 listProjects 排序按 updatedAt｜🔵建议新增
- TC-P1-22｜本地存储不可用降级｜编舞老师｜模拟 localStorage/indexedDB 抛错｜boot → toast「本地存储不可用，已进入空项目库」｜[STATE] view=library、不 crash｜⛔半自动：需启动前注入存储桩（Playwright addInitScript 可行，标🔵）｜🔵建议新增

边界小结（P1）：空库新建（01）、0/30 极值（03/08）、向导中断（06）、存储不可用（22）、删除不可恢复（11）——满足 ≥3 条边界要求。

---

# P2 名册与对象：舞者 / 编组 / 合并单元 / 选择

## P2 · 原子操作清单（代码出处：`js/ui.js` showRosterModal、`js/main.js` showUnitMenu/wireStageTools/wireKeyboard、`js/model.js` addDancer/removeDancer/createGroup/removeGroup/renameGroup/expandUnits/addMerge/removeMerge/setMergeStyle/collapseUnit/renumberShorts、`js/gesture.js`）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A2-01 | ＋ 单人 | 名册弹窗「**＋ 单人**」（自动命名「舞者N」、role=X、自动进所有队形） | `M.addDancer` |
| A2-02 | 改姓名 | 名册行「姓名」输入框（change 提交） | `nameInp onchange` |
| A2-03 | 改简称 | 名册行「简称」（maxlength=3） | `shortInp` |
| A2-04 | 改角色 | 名册行「角色」下拉 男/女/其他；**改角色重置角色默认色** | `roleSel onchange` |
| A2-05 | 改颜色 | 名册行取色器（即改即存，**不**重置） | `colorInp onchange` |
| A2-06 | 删除舞者 | 名册行「**删除**」→ confirm「删除舞者「X」？（将从所有队形移除）」；联动清编组/merges/positions | `M.removeDancer` |
| A2-07 | 重编号码 | 名册「**重编号码**」（第 n 人 short=n） | `M.renumberShorts` |
| A2-08 | 名册芯片加/移出组 | 名册「编组」列芯片（chip-on 切换，一人可多组） | `chip onclick` |
| A2-09 | ＋ 存为编组 | 编组页「**＋ 存为编组**」（空选 toast「请先选中要存为编组的舞者」） | `saveSelectionAsGroupN()` |
| A2-10 | Ctrl/Cmd+1..9 覆盖存组 | 键盘（Safari 保留例外，文案引导用面板按钮） | `saveSelectionAsGroupN(n)` |
| A2-11 | 1..9 选组 | 键盘 | `selectGroupN(n)` |
| A2-12 | Shift+1..9 追加选组 | 键盘 | `selectGroupN(n,{add})` |
| A2-13 | 编组行「选择」 | 编组页行「**选择**」（行点击同效；成员在合并单元中→整单元展开） | `selectGroupN` |
| A2-14 | 编组「重命名」 | 编组页「**重命名**」（prompt；≤40 字截断；空名拒） | `M.renameGroup` |
| A2-15 | 编组「删除」 | 编组页「**删除**」（**删组不删人**） | `M.removeGroup` |
| A2-16 | 单击选择 | 舞台左键单击（合并单元任一成员=整单元入选） | gesture TAP |
| A2-17 | Shift+单击追加/移出 | 键盘修饰（已选单元→原子移出） | gesture PENDING |
| A2-18 | 多选模式点按追加 | 「**☰ 多选**」开关后点按=追加 | `btn-multi` |
| A2-19 | 框选（桌面） | 空白左键拖动（<6px 视为点击=清空选择；命中单元成员=整单元） | gesture BOX |
| A2-20 | 框选（触摸长按空白 0.5s） | 长按空白出起点圆点后拖动；期间忽略第二指 | gesture PAN→BOX(lpBox) |
| A2-21 | 合并为单元（工具栏） | 选恰 2 人 →「**合并为单元**」（capsule+collapseUnit；非 2 人/已是单元各有 toast） | `btn-merge-create` |
| A2-22 | 拖拽重叠合并确认 | 拖 A 到 B 上松手或驻留 1.5s → 浮窗「合并为单元」 | gesture DRAG→MENU(merge) |
| A2-23 | 浮窗样式创建 | 浮窗「**胶囊** / **单编号**」（merge 模式点击即创建） | `mkStyleBtn` |
| A2-24 | 单元浮窗「✂ 拆开」 | 双击/长按/右键单元 →「**✂ 拆开**」（removeMerge，两人原地保留，清选择） | `mkUntieBtn` |
| A2-25 | 单元浮窗样式切换 | 单元浮窗「胶囊/单编号」（setMergeStyle；当前样式高亮 um-cur） | `mkStyleBtn`（unit 模式） |
| A2-26 | 单元浮窗「删除」 | 单元浮窗「**删除**」（红字；两名舞者一并从名册/队形移除） | `mkDeleteBtn` |
| A2-27 | 单元浮窗「✕」 | 取消浮窗（外部按下同取消并吞掉该次按下） | `um-cancel` |
| A2-28 | 取消合并（工具栏） | 「**取消合并**」（所选涉及的所有单元；无涉及 toast；成员原地保留） | `btn-merge-cancel` |
| A2-29 | 多选浮窗三按钮 | 「**合并为单元**」（恰 2 人未合并）/「**✂ 取消合并**」（涉及单元全拆）/「**删除所选（N 人）**」 | mode='multi' 分支 |
| A2-30 | 上下文菜单 | 右键/长按舞者：未合并=「舞者 · X｜删除」；多选中命中=整选择菜单（恰一单元=单元浮窗）；命中者不在选择=先选中再弹 | gesture contextMenu |
| A2-31 | 换位 | 选恰 2 个单元（合并单元或单人）→「**换位**」（对调位置；非 2 单元 toast） | `btn-swap` |
| A2-32 | 显示字段三态 | 舞台页「**显示字段**」：编号序号/简称/姓名（存 `settings.labelMode`，画布/单元编号/缩略图全生效） | labelMode select |

## P2 · 组合动线

1. **建名单**：向导建档 → 名册逐行改资料 → 重编号码 → chips 编组。
2. **编组工作流**：舞台框选 → 存为编组 → 数字键调组 → 整组移动/统一朝向/删除（GR-01..07 全链）。
3. **单元工作流**：选 2 人合并 → 换样式 → 双击浮窗拆开/删除 → 拖拽驻留合并 → 替换语义（L2#C-01/02/03 全链）。
4. **多选工作流**：☰ 多选 → 点按追加 → 多选浮窗合并/取消合并/删除所选 N 人。

## P2 · 测试用例目录

- TC-P2-01｜改名 + 显示字段=姓名（长名截断）｜编舞老师｜编辑器 12 人｜名册改某人为 5 字名 → 舞台页显示字段切「姓名」｜[STATE] `settings.labelMode='name'`；[PIXEL] 画布圆内显示新名且 >4 字截为「3字+…」｜缺失姓名回退简称→序号｜✅已有：UF2#E2E-S1-15
- TC-P2-02｜重编号码｜编舞老师｜名册顺序乱｜点「重编号码」｜[STATE] short=1..N 按名册序；[PIXEL] 标签变数字｜增删人后再点仍连续｜✅已有：UF2#E2E-S1-16
- TC-P2-03｜删除舞者联动清理｜编舞老师｜多帧+合并+编组项目｜名册行「删除」→ confirm｜[STATE] dancers-1；所有帧 positions/merges 无悬挂、groups memberIds 清引用｜confirm 原生框按 TC-P1-11 接线｜✅已有：UF2#E2E-S1-17；L2#C-08（组引用联动）
- TC-P2-04｜「＋ 单人」自动进所有队形｜编舞老师｜≥2 帧｜名册「＋ 单人」｜[STATE] 每帧 positions 均含新 id（ensureDancerInFormation）｜0 人项目首加亦然｜✅已有：UF2#E2E-S1-18
- TC-P2-05｜改角色重置默认色 / 改颜色不重置｜编舞老师｜名册开｜角色 M→F → 颜色变粉；再改颜色为绿 → 切角色 X→F｜[STATE] color 字段两段语义正确｜颜色持久随项目｜🔵建议新增
- TC-P2-06｜简称 ≤3 字截断｜编舞老师｜名册开｜简称输 4 字｜[DOM] input maxlength=3；[STATE] 存 3 字｜labelMode=short 时画布跟随｜🔵建议新增
- TC-P2-07｜名册芯片加入/移出｜编舞老师｜已有组｜点行芯片 on→off→on｜[STATE] memberIds 增减；[DOM] `chip-on` class 切换；undo 各回一步｜一人可属多组｜✅已有：UF2#E2E-S1-20；GR#GR-06
- TC-P2-08｜舞台选 3 人「＋ 存为编组」｜编舞老师｜舞台多选｜编组页「＋ 存为编组」｜[STATE] groups+1（自动命名「组N」）；[DOM] 编组页新行「选择/重命名/删除」｜空选 toast「请先选中要存为编组的舞者」｜✅已有：UF2#E2E-S1-19
- TC-P2-09｜Ctrl+1..9 存组 / 1 选组 / Shift+1 追加 / 覆盖｜编舞老师｜舞台选择就绪｜GR-01 四步键盘序列｜[STATE] 每步 groups/selection 正确；覆盖语义=替换 memberIds｜Safari Cmd+1..9 不到页面（top10⑨ 已验证文案在位）｜✅已有：GR#GR-01；UF1#Top10-⑨
- TC-P2-10｜编组行选择 / 重命名 / 删除组（不删人）｜编舞老师｜groups≥1｜GR-02 序列｜[STATE] 重命名截断 40 字、删组后 dancers 不变、undo/redo 往返｜prompt 为原生框（驱动注入）｜✅已有：GR#GR-02
- TC-P2-11｜一人多组与组间互不污染｜编舞老师｜两组交叉｜GR-03 序列｜[STATE] 选择集合互斥正确｜—｜✅已有：GR#GR-03
- TC-P2-12｜组选择×单元原子（合并成员展开整单元）｜编舞老师｜成员含单元｜GR-07 序列（数字键/Shift 追加均展开）｜[STATE] 选择=两人｜—｜✅已有：GR#GR-07
- TC-P2-13｜预定义初始编组（gender/none）｜编舞老师｜向导两档建档｜[STATE] gender→「男士/女士」两组按角色划分；none→无组｜—｜✅已有：GR#GR-05
- TC-P2-14｜单击选择单元原子｜排练助手外全员｜单元在场｜点成员 A｜[STATE] selection=[A,B]；[PIXEL] 双高亮｜—｜✅已有：L1#D-01；L2#C-05(P1)
- TC-P2-15｜Shift 单击追加与原子移出｜编舞老师｜—｜L1#D-03 序列｜[STATE] 追加/移出整单元｜—｜✅已有：L1#D-03
- TC-P2-16｜☰ 多选模式点按追加｜触屏用户｜移动视口｜开「☰ 多选」→ 点按多人｜[STATE] selection 累积｜关闭后点按=替换选择｜✅已有：L1 T 组（触屏口径）+ RI
- TC-P2-17｜桌面空白拖动框选｜编舞老师｜—｜L1#D-08 序列（含 <6px 视为点击清空）｜[STATE] 矩形内舞者（单元原子）入选｜Shift+框选=追加｜✅已有：L1#D-08
- TC-P2-18｜触摸长按空白 0.5s 框选｜触屏用户｜移动+hasTouch｜长按空白出圆点标记后拖动松手｜[STATE] 结算同桌面框选；期间第二指不转 PINCH｜系统接管 pointercancel=零写入｜✅已有：RI（长按框选+中断）
- TC-P2-19｜工具栏「合并为单元」（恰 2 人）｜编舞老师｜选 2 人｜点「合并为单元」→ toast「已合并为单元：A + B」｜[STATE] merges+1 capsule、两点重合｜非 2 人 toast「请先选中恰好 2 名舞者」；已是单元 toast「所选两人已是一个单元」；按钮 disabled 态随选择｜✅已有：L2#C-01（浮窗路径）+ 🔵补按钮路径断言
- TC-P2-20｜拖 A 到 B 驻留 1.5s → 合并确认浮窗｜编舞老师｜—｜拖拽驻留触发（无需松手）｜[STATE] 提交「移动舞者」一条+浮窗「胶囊/单编号」；点「胶囊」merges+1 两点重合｜取消确认保留移动｜✅已有：UF2#E2E-S1-10；L1#D-07
- TC-P2-21｜单元浮窗「✂ 拆开」（帧级，不删人）｜编舞老师｜单元在场｜双击/长按/右键单元 →「✂ 拆开」｜[STATE] merge 消失、两人原地保留、选择清空；[PIXEL] 徽标消失双圆回归｜merges 是帧级数据不跨帧｜✅已有：L2#C-02；R 组
- TC-P2-22｜单元样式切换（胶囊↔单编号）｜编舞老师｜单元在场｜浮窗点另一样式｜[STATE] style 变更+历史「切换单元样式」；[PIXEL] single=单圆+虚线外环｜样式仅两枚（diamond/twin 已退役，载入自动迁移 capsule）｜✅已有：L2#C-01/03；L0#P3（两样式像素基线）
- TC-P2-23｜单元浮窗「删除」（删两名舞者）｜编舞老师｜单元在场｜浮窗红字「删除」｜[STATE] 两名舞者从名册/所有帧/编组移除、历史「删除单元（两名舞者）」一条｜undo 一步全回｜✅已有：R 组（删除路径）+ L2#C-08 联动口径；🔵补浮窗直删断言
- TC-P2-24｜替换合并语义（一人已属单元再合并=旧绑定静默解除）｜编舞老师｜A-B 单元在场｜把 A 拖向 C 合并｜[STATE] 旧 merge 消失、新 merge 存在；merges 不跨帧｜艺术意图 vs 数据实况差（文档 §4-7）｜✅已有：UF1#E2E-S1-11
- TC-P2-25｜多选浮窗「删除所选（N 人）」整组删除｜编舞老师｜多选 4 人（含单元）｜右键/长按命中者 → multi 菜单「删除所选（4 人）」｜[STATE] 4 人全删、组引用联动、历史一条｜—｜✅已有：GR#GR-04（multi 菜单删整组）
- TC-P2-26｜多选浮窗「合并为单元 / ✂ 取消合并」｜编舞老师｜多选恰 2 未合并人 → 菜单合并；多选含 2 单元 → 菜单取消合并｜[STATE] 两按钮按态出现；取消合并后成员移出选择｜恰选一个完整单元时状态机分流到单元浮窗（样式按钮唯一出现处）｜✅已有：L2#C-03（组内合并/替换）；🔵补 multi 取消合并直断言
- TC-P2-27｜上下文菜单分流（未合并=删除 / 多选=整选择 / 命中不在选择=先选中）｜编舞老师｜三种选择态｜右键三种命中｜[DOM] 菜单标题「舞者 · X」/「所选 N 人」/「合并单元」｜右键统一拦截（输入框/表格豁免）｜✅已有：L1#D-04/05 + UF1（DEFECT-R-1 回归）+ GR#GR-04
- TC-P2-28｜换位（恰 2 单元）｜编舞老师|选 2 单元｜点「换位」｜[STATE] 两单元位置对调（按单元内序配对）、历史「单元换位」｜1/3 单元 toast「请选中两个单元（合并单元或单人）」｜🔵建议新增（**当前无 E2E**，仅 R31 入口文案核对）

边界小结（P2）：删人 confirm 中断（03）、合并替换静默语义（24）、空选/非 2 人/非 2 单元 toast 族（08/19/28）、浮窗 Esc/外点取消（27）、长按被系统接管回滚（18）——满足 ≥3 条。

---

# P3 队形编排：生成 / 整形 / 帧管理 / 舞台设置

## P3 · 原子操作清单（代码出处：`js/main.js` wireStageTools/applyGenerator/buildProps/moveFormationRel、`js/shapes.js` genSlots/mirrorH/mirrorV/rotateSelected/distributeAxis/faceAll、`js/model.js` createFormationFrom/deleteFormation/moveFormation、`js/timeline.js` EditStrip、`js/gesture.js` DRAG/FACE/cancel）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A3-01 | 生成器 8 形 | 「**生成队形…**」下拉：多横排/一字横排/纵列/圆形/弧形/V 形/斜线/菱形（整体替换当前队形，缺席者顺延） | `#gen-kind` change |
| A3-02 | 编队粒度 | 「**单人 / 仅男士 / 仅女士**」（`#gen-unit`） | `gen-unit` |
| A3-03 | 拖动移动 | 按住拖动（网格吸附+舞台/后台钳制；单元原子同步位移） | gesture DRAG |
| A3-04 | 方向键微调 | 方向键 0.1m（吸附时=网格距）；Shift=1m；边界钳制 | keydown Arrow |
| A3-05 | 水平镜像 | 「**⇋**」（title 水平镜像） | `btn-mirror-h` |
| A3-06 | 垂直镜像 | 「**⇅**」 | `btn-mirror-v` |
| A3-07 | 整体旋转 | 「**⟳**」滑杆 -180..180（input 实时预览不进历史，change 松手提交「整体旋转」并复位 0°） | `rot-slider` |
| A3-08 | 均布 | 「**均布**」（所选 ≥3 人；右键切横向/纵向 + toast「均布方向：…」；<3 人 toast） | `btn-distribute` |
| A3-09 | 统一朝向 | 「**朝向…**」→「面向观众 / 面向圆心」（有选择=所选，无选择=全体） | `face-target` |
| A3-10 | F 键面向观众 | 键盘 F | keydown f |
| A3-11 | 朝向把手 | 样式页「**朝向把手**」开关 → 选中单人拖把手（FACE 手势，松手提交「调整朝向」） | `sty-facing`+FACE |
| A3-12 | 逐人朝向角度 | 属性面板选中区（前 8 人）每行「朝向」数字输入 0..359 | `selectionProps` |
| A3-13 | ＋ 新队形 | 「**＋ 新队形**」/键盘 D/索引条「**＋**」/左栏列表「＋」——复制当前帧插到其后 + 0.7s 切帧动画 | `addFormation` |
| A3-14 | 删除队形 | 左栏「**删除**」/索引条「**－**」（≥1 守卫 toast「至少保留一个队形」） | `deleteFormation` |
| A3-15 | 队形重排 | 桌面拖拽 chip（HTML5 DnD）/触摸长按 0.3s 拿起（边缘自动滚动+触觉）/右面板「**↑ 上移 / ↓ 下移**」；时长按 formationId 跟随 | EditStrip/moveFormationRel |
| A3-16 | 队形重命名 | 右面板「队形」页「名称」输入框 | `props-formation` |
| A3-17 | 队形颜色 | 「颜色」取色器 | color input |
| A3-18 | 队形备注 | 「备注」textarea（占位「这一段的动作要点…」） | note textarea |
| A3-19 | 切帧选择 | 左栏 chip / 索引条 chip / 时间轴块点击（清空选择；查看模式播放头跟随 seekFormation） | `switchFormation` |
| A3-20 | 舞台尺寸 | 舞台页「舞台尺寸（米）」宽/深（4..50）与「后台区」（0..10） | `stageChange` |
| A3-21 | 观众方向 | 舞台页「观众方向」下拉：下方/上方/左侧/右侧 | audience select |
| A3-22 | 网格与吸附 | 「网格间距」0.1..2、「**拖动吸附**」开关；G 键同效 | snap/gridM |
| A3-23 | 背景图 | 舞台页「上传背景…」/「清除」（dataURL 存项目） | bgImage |
| A3-24 | Escape 回滚进行中手势 | Esc（DRAG=回滚按下前快照零历史；BOX=收框） | gesture.cancel |

## P3 · 组合动线

1. **生成→微调→整形**：生成器落位 → 框选 → 均布/镜像/旋转/朝向 → 拖动细修（L1→L2 已链）。
2. **插帧表达动线**：＋ 新队形（复制）→ 新帧上改形 → 中间帧表达过渡。
3. **重排工作流**：拖 chip / 长按拿起 / ↑↓，各帧时长随队形走（不串位）。
4. **舞台适配**：改尺寸/观众方向/网格/背景图 → 全队形重绘。

## P3 · 测试用例目录

- TC-P3-01｜生成器「圆形」落位｜编舞老师｜12 人单帧｜生成队形…→圆形｜[STATE] positions 全部到圆轨道（半径/圆心容差）；[PIXEL] 缩略图更新；历史「生成队形(circle)」一条｜生成不感知当前选择｜🔵建议新增（97 条中唯一未落 E2E 的主干之一）
- TC-P3-02｜粒度「仅男士」生成｜编舞老师｜12 人｜粒度切「仅男士」→ 生成｜[STATE] 仅 role=M 位置改变，F 不动；「仅女士」对称｜粒度=空集（如 0 男）不崩｜🔵建议新增
- TC-P3-03｜8 形矩阵抽核（rows/line/columns/arc/v/diagonal/diamond）｜编舞老师｜12 人｜7 形逐一生成｜[STATE] 每形几何断言（列距/张角/斜率/菱形对称）＋零 pageerror｜单行/极多人数的自适应（rows 1..4 档）｜🔵建议新增（与 TC-P3-01/02 同驱动参数化）
- TC-P3-04｜框选 3 人 →「均布」+ 右键切方向｜编舞老师｜—｜S1-09 序列｜[STATE] 3 人等距；toast「均布方向：横向/纵向（右键切换）」｜<3 人 toast「请先框选至少 3 名舞者」｜✅已有：UF2#E2E-S1-09
- TC-P3-05｜水平/垂直镜像 ⇋/⇅｜编舞老师|不对称队形｜点 ⇋ → 点 ⇅｜[STATE] x 镜像=2cx−x、y 镜像=2cy−y（舞台中心对称）、历史各一条；[PIXEL] 位图镜像｜连点两次=复原｜🔵建议新增（**当前无 E2E**）
- TC-P3-06｜整体旋转 ⟳ 滑杆｜编舞老师｜—｜拖滑杆到 90°松手｜[STATE] 绕所选质心旋转 90°（无选择=全体）、历史恰 1 条「整体旋转」、滑杆复位 0°｜拖动中不进历史（input 预览）、±180 极值｜🔵建议新增（**当前无 E2E**）
- TC-P3-07｜拖动移动+网格吸附+后台钳制｜编舞老师｜—｜L1#D-06 序列｜[STATE] 吸附整格；拖出边界钳在 [-bs, W+bs]｜吸附关（G）后自由落点｜✅已有：L1#D-06；L2#C-04（视图变换后重放）
- TC-P3-08｜方向键微调（含 Shift 与边界）｜编舞老师｜选中 1 人｜方向键 ×n；Shift+方向键；推到舞台角｜[STATE] 步长 0.1m/网格距/1m 三档；钳制不越界｜无选择时按键无操作｜✅已有：L1#D-13
- TC-P3-09｜拖动中 Escape 回滚零历史｜编舞老师｜—｜L1#D-12 序列｜[STATE] 位置精确还原、undo 栈零增长；[PIXEL] 位图还原｜双指中断同回滚（RI 覆盖）｜✅已有：L1#D-12（映射 E2E-S1-12）；RI#IR-04
- TC-P3-10｜统一朝向「面向观众/面向圆心」+ F 键｜编舞老师｜—｜face-target 两档 + F 键｜[STATE] facing 全员/所选一致（圆心=径向）；GR-04 已覆盖圆心｜朝向把手拖动改单人（L1#D-14）｜✅已有：GR#GR-04；L1#D-14；🔵补「面向观众」全队直断言
- TC-P3-11｜逐人朝向角度输入｜编舞老师｜选中 1 人｜属性面板朝向输 270｜[STATE] facing=270、历史「调整朝向」｜>8 人折叠「…等 N 人」｜🔵建议新增
- TC-P3-12｜「＋ 新队形」克隆插入｜编舞老师｜3 帧｜「＋ 新队形」（按钮/D 键/索引条＋三入口）｜[STATE] formations+1、新帧=上一帧克隆、插入位=index+1、选中清空；[PIXEL] 切帧动画终态=新帧｜切帧预览关（工具栏）时无动画但数据同｜✅已有：UF2#E2E-S1-13、UF1#E2E-S2-02（blocks 按 formationId 保留）
- TC-P3-13｜删除队形与「至少保留一个队形」守卫｜编舞老师｜1 帧/多帧两种｜「删除」/索引条「－」｜[STATE] 多帧=块数-1 且索引钳制；唯一帧=toast「至少保留一个队形」不变｜播放中删除先暂停（→TC-P5-09）｜✅已有：UF2#E2E-S1-14、UF2#E2E-S3-15
- TC-P3-14｜帧隔离：改第 3 帧其余帧逐字节不变｜编舞老师|≥3 帧｜改第 3 帧两处｜[STATE] JSON 对比仅第 3 帧 diff｜—｜✅已有：UF1#E2E-S2-01
- TC-P3-15｜切帧清空选择（含编组选择）｜编舞老师｜选中态切帧｜点另一 chip｜[STATE] selection=[]｜查看模式切帧播放头跟随（seekFormation）｜✅已有：UF1#E2E-S2-05
- TC-P3-16｜队形重排三通道（DnD/触摸长按/↑↓）｜编舞老师｜≥3 帧｜桌面拖 chip；触摸长按 0.3s 拿起拖；右面板 ↑/↓｜[STATE] 顺序更新、时长随 formationId 走、历史「调整队形顺序」各一条；触摸落位抑制误点 400ms｜pointercancel 零写入零历史；↑↓ 首末行 disabled｜✅已有：UF1#E2E-S2-07；L2#C-07；🔵补 ↑↓ 通道直断言
- TC-P3-17｜队形重命名/颜色/备注｜编舞老师｜—｜右面板改名称/颜色/备注｜[STATE] 三字段持久；时间轴块名与颜色像素跟随｜重命名 undo 恢复（联动 TC-P5-18）｜🔵建议新增（**当前无 E2E**）
- TC-P3-18｜舞台尺寸/后台区修改与全帧重绘｜编舞老师｜—｜舞台页改宽 12→16、深 16→10、后台 2→3｜[STATE] stage 三字段；[PIXEL] 网格线密度/舞台框变化；缩略图/索引条重算纵横比｜非法值（0/负/超 50）回退原值｜🔵建议新增（**当前无 E2E**）
- TC-P3-19｜观众方向四档｜编舞老师｜—｜切 上方/左侧/右侧｜[STATE] faceAudience 映射 0/270/90；新建舞者/开场队形朝向随 audience｜—｜🔵建议新增
- TC-P3-20｜网格间距与吸附开关（G 键）｜编舞老师｜—｜改 gridM 0.5→1.0；G 键切吸附｜[STATE] stage.gridM/snap 变更；拖动落点步长跟随｜吸附状态随项目保存｜✅等价：L1#D-06（吸附口径）；G 键直断言 🔵补
- TC-P3-21｜背景图上传/清除｜编舞老师|—|上传本地图 → 画布衬底 → 清除｜[STATE] stage.bgImage src 存 dataURL/清除为 null；[PIXEL] 衬底可见｜大图性能（异步 onload 重绘一次）｜🔵建议新增
- TC-P3-22｜切帧预览 0.7s 动画与打断｜编舞老师|预览开|切帧 → 动画中点击｜[STATE] 纯 UI 效果不动播放头/时长；点击打断立即落终态｜预览关=瞬切；D 键新建同动画｜✅已有：L2#C-06
- TC-P3-23｜极多队形的时间轴/索引条自适应｜编舞老师|50 帧|批量建 50 帧｜[STATE] 时间轴自适应缩小、索引条横向滚动、零 pageerror｜渲染性能探针（analysis-06-perf 口径）｜🔵建议新增
- TC-P3-24｜生成器整体替换语义（旧位不保留）｜编舞老师|任意队形|同一帧两次生成不同形｜[STATE] 第二次生成完全覆盖第一次槽位（缺席者顺延自上一帧）｜—｜🔵建议新增
- TC-P3-25｜单元拖动整体位移（拆分呈示拖回合拢）｜编舞老师|分离呈示单元|拖单元成员 >0.8m 分离呈示 → 拖回 ≤0.8m｜[PIXEL] 分离=两圆+虚线、合拢=胶囊徽标；[STATE] merge 记录全程不变（呈示距离非数据）｜不存在单人拉伸路径｜✅已有：L2#C-02；R 组
- TC-P3-26｜组拖（多选整体移动）｜编舞老师|框选 4 人|拖任一成员｜[STATE] 整选择集同步位移一条历史｜仅当整单元已在多选中才随组拖｜✅已有：L2#C-03

边界小结（P3）：唯一队形删除守卫（13）、生成器空集粒度（02）、旋转 ±180 极值（06）、50 帧极值（23）、Esc/接管回滚（09）——满足 ≥3 条。

---

# P4 音乐与时间轴：载入 / 标定 / 块时长 / tag 全套

## P4 · 原子操作清单（代码出处：`js/main.js` wireAudioPanel/loadAudioFile、`js/audio.js` loadBlob/play/click、`js/timeline.js` MusicTimeline（tag 道全套）、`js/model.js` audio 字段/alignBlockStart/addTag/removeTag/renameTag/moveTag/sanitizeTags、`js/player.js` play/seek）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A4-01 | 载入音乐 | 「**🎵 音乐与节拍**」→「**载入音乐…**」（波形入时间轴；失败非破坏保留旧会话） | `btn-load-audio`/`audio-file` |
| A4-02 | BPM 输入 | 主行「**BPM**」数字框（钳 30..300，非法回退 120；**播放/数拍中 disabled**） | `bpm-input` |
| A4-03 | 点拍 | 校准子行「**点拍**」（连点 3 次起算、最近 8 次均值、停 2.5s 重置；播放中锁） | `btn-tap` |
| A4-04 | 首拍输入 | 主行「**首拍**」s（≥0；≥音频时长 toast 告警；播放中锁） | `offset-input` |
| A4-05 | 试听 | 校准「**试听**」（首拍前 2s 起 4.5s 自动停；无音乐 toast「请先载入音乐」） | `btn-offset-test` |
| A4-06 | 小节 | 校准「**小节**」4/3/2/6 拍下拉 | `bpb-select` |
| A4-07 | 数拍入场 | 校准「**数拍入场**」0..32 拍 | `countin-input` |
| A4-08 | 节拍器 | 主行「**节拍器**」勾选（随项目保存；播放每拍一声、小节首拍高音） | `pb-metro` |
| A4-09 | 连续时长 | 校准「**连续时长**」勾选（开=后续块顺延；关=压缩自身过渡） | `ripple-check` |
| A4-10 | 保持 ±1 拍 | 块时长栏「保持 −/＋」（钳 0.5..999；≤0.5 时 − disabled） | `bc-hold-minus/plus` |
| A4-11 | 过渡 ±1 拍 | 「过渡 −/＋」（末块整组隐藏 `#bc-travel-wrap`） | `bc-travel-minus/plus` |
| A4-12 | 面板时长数字 | 右面板「时间轴时长（拍）」保持/过渡输入（0.5..999；末块显示「最后一个队形，无过渡」） | props-formation |
| A4-13 | 拖块边缘改时长 | 时间轴拖 hold/travel 把手（吸附整拍；播放中可改；循环区间跟随） | MusicTimeline drag |
| A4-14 | 对齐到播放头 | 「**⇤ 对齐到播放头**」（0 号队形拒绝 toast；可达/不可达 toast 两态） | `btn-align-playhead` |
| A4-15 | ⚑ 打点 | 块时长栏「**⚑ 打点**」（播放头拍位开内联命名输入；默认名「标记 N」；自动滚动可视区） | `btn-tag-drop`→`stampTag` |
| A4-16 | tag 道双击空白打点 | tag 道双击空白（该拍位打点；删除后 400ms 内双击忽略） | `_dblclick` |
| A4-17 | tag 改名 | 双击旗点 → 内联输入回显原名（Enter/失焦提交；Esc 取消；≤20 字截断） | `_openTagInput({id})` |
| A4-18 | tag 拖移 | 拖旗（实时预览不进历史；松手恰一条「移动标记」；钳 ≥0 拍、两位小数） | drag kind='tag' |
| A4-19 | tag × 删除 | 悬停/点选显 ×（title「删除标记「X」」；命中 delX 删除一条「删标记」历史） | `_tagGeomHit` |
| A4-20 | tag 单击跳转 | 单击旗点（播放头跳该拍；activeTag 保持 × 可见=触屏删除路径） | `_up` 未 moved 分支 |
| A4-21 | tag 清洗 | 导入/载入时 `sanitizeTags`（非法 beat/空名/重复 id 丢弃；缺 id 补 uid） | `sanitizeTags` |
| A4-22 | 时间轴缩放 | 「**－ / ＋ / ⤢**」与 Ctrl+滚轮（pps 钳 0.5..4096/totalSec） | `tl-zoom-*`/wheel |
| A4-23 | 尺规 scrub | 尺规点击/拖动定位（钳 0..totalBeats；数拍中摸时间线=取消倒计） | drag kind='scrub' |
| A4-24 | 块点击选帧 | 时间轴块区点击 → `onSelectFormation` | `_down` 块区 |
| A4-25 | tag 悬停反馈 | 悬停旗点/× 显 title 与光标 pointer（「名称 · 小节 · 单击跳转 / 双击改名 / 拖动移位」） | `_tagTitle` |

## P4 · 组合动线

1. **标定流**：载入 → BPM/点拍 → 首拍+试听循环微调 → 小节/数拍设置（M23 全链）。
2. **对齐流**：scrub 到段落点 → 选目标队形 → 对齐到播放头 → 块时长栏核对总时长。
3. **tag 工作流**：试听/播放中 ⚑ 打点 → 双击改名（主歌/副歌/间奏）→ 拖旗对齐 → 单击跳转复核 → × 删除（TAG T1..T11 + R31 B 组全链）。
4. **时长工作流**：± 步进 / 面板输数 / 拖块边缘三通道 × 连续时长两态。

## P4 · 测试用例目录

- TC-P4-01｜载入 click120.wav｜编舞老师｜项目开｜载入 fixtures/click120.wav｜[STATE] audio.ready=true、duration>0；[DOM] `#audio-name` 文件名；[PIXEL] 波形出现｜损坏音频→toast「音频无法播放，已忽略」且旧音乐保留（非破坏载入）｜✅已有：UF1#E2E-S4-01；破坏分支 R31 无、M23 口径 🔵补
- TC-P4-02｜BPM 输 999 钳 300 / 输 0 回退 120｜编舞老师|已载音乐|输非法值｜[STATE] bpm=300/120｜播放中 disabled+title「暂停后可修改」｜✅已有：UF1#E2E-S4-02
- TC-P4-03｜点拍 4 次（500ms 间隔）→ BPM≈120｜编舞老师|暂停|连点｜[STATE] bpm≈120（3 次起算）｜✅已有：UF1#E2E-S4-03
- TC-P4-04｜点拍 >2.5s 超时重置｜编舞老师|暂停|2 点→等 2.6s→再点｜[STATE] 旧样本不掺入｜✅已有：UF1#E2E-S4-04
- TC-P4-05｜「试听」未载音乐 toast｜编舞老师|无音乐|点「试听」｜[DOM] toast「请先载入音乐」｜✅已有：UF2#E2E-S4-05
- TC-P4-06｜首拍=2.5 试听（前 2s 起 4.5s 停）｜编舞老师|已载音乐|点「试听」｜[STATE] 从 0.5s 起播约 4.5s 自动暂停｜✅已有：UF2#E2E-S4-06；M23#m8 像素证据
- TC-P4-07｜BPM 120→240 总时长减半｜编舞老师|—|改 BPM｜[STATE] totalDurationSec 减半、beatLabel 换算正确｜tag/块秒位随动（联动 TC-P4-24）｜✅已有：UF1#E2E-S4-07
- TC-P4-08｜「保持 ＋」连点与钳制｜编舞老师|—|连点＋；面板输 1000｜[STATE] +1/次、钳 0.5..999；显示「17拍·8.5s」式同步｜− 到 0.5 下限 disabled｜✅已有：UF2#E2E-S4-08
- TC-P4-09｜唯一队形时过渡控件隐藏｜编舞老师|1 帧|看块时长栏｜[DOM] `#bc-travel-wrap` display:none；面板显示「最后一个队形，无过渡」｜✅已有：UF2#E2E-S4-09
- TC-P4-10｜拖块边缘非整拍吸附｜编舞老师|≥2 帧|拖 hold 边到 X.4 拍｜[STATE] Math.round 吸附整拍｜✅已有：UF2#E2E-S4-10
- TC-P4-11｜ripple 开/关拖 hold 两语义｜编舞老师|≥3 帧|两种勾选下拖 hold｜[STATE] 开=后续块整体右移；关=自身过渡压缩后续不动｜✅已有：UF2#E2E-S2-04
- TC-P4-12｜拖块边缘恰 1 条「调整时长」历史｜编舞老师|—|拖 hold 16→20｜[STATE] holdBeats=20、历史恰 1 条｜播放中改+循环跟随（联动 TC-P5-08/UF1#Top10-①c）｜✅已有：UF2#E2E-S2-03
- TC-P4-13｜对齐到播放头（可达）｜编舞老师|≥2 帧|scrub→选中→对齐｜[STATE] holdStart≈播放头（±0.5）、历史 1 条｜✅已有：UF2#E2E-S4-11
- TC-P4-14｜对齐不可达 toast｜编舞老师|前块压扁|对齐到更早位置｜[DOM] toast「目标不可达：起点已尽量前移到…」｜✅已有：UF2#E2E-S4-12
- TC-P4-15｜第 1 队形对齐拒绝｜编舞老师|选第 1 帧|点「⇤ 对齐到播放头」｜[DOM] toast「第一个队形从 0 拍开始，无需对齐」｜✅已有：UF2#E2E-S4-13
- TC-P4-16｜⚑ 打点：播放头拍位 + 内联命名 + 默认名「标记 N」｜编舞老师|任意|点「⚑ 打点」→ Enter｜[STATE] tags+1、beat=播放头拍、name=「标记 1」；[DOM] `.tl-tag-input` 出现；历史「打标记」一条｜播放中打点不打断播放｜✅已有：TAG#T1、TAG#T10；R31#B-01（实况 PASS）
- TC-P4-17｜tag 道双击空白打点（该拍位）｜编舞老师|—|双击 tag 道空白 → Enter｜[STATE] 新 tag beat=双击位置拍｜删除后 400ms 内双击忽略（× 双击只删一次）｜✅已有：TAG#T2、TAG#T6；R31#B-03
- TC-P4-18｜tag 改名（回显/Enter/Esc/失焦/20 字截断）｜编舞老师|tag 在|双击旗点→改→Enter；再开→Esc；超长输入｜[STATE] Enter 提交历史「改标记」、Esc 不改、name≤20 字｜空提交=不改（保留原名）｜✅已有：TAG#T4；R31#B-05/B-06
- TC-P4-19｜tag 拖移（预览/提交一条/undo/redo）｜编舞老师|tag 在|拖旗 −2 拍松手｜[STATE] beat=目标拍、undo 回拖前、redo 复现；拖动中不进历史｜拖出左界钳 0；BPM 改变后拖动基准随秒位｜✅已有：TAG#T5；R31#B-07（实况 PASS）
- TC-P4-20｜tag × 删除（悬停 title/双击×守卫/undo）｜编舞老师|tag≥1|悬停→×→点击｜[STATE] tags-1、历史「删标记」一条；双击×只删一次（400ms 守卫）；undo 恢复｜触屏无 hover：单击旗点（activeTag）保持 × 可见再点删｜✅已有：TAG#T6；R31#B-08
- TC-P4-21｜tag 单击跳转（播放头对齐用途）｜编舞老师|tag 在|单击旗点｜[STATE] player.beat≈tag.beat（±0.05）｜道内单击不 scrub 不选块（分区独立）｜✅已有：TAG#T3；R31#B-04
- TC-P4-22｜tag 持久化与导出导入往返｜编舞老师|tag≥2|reload；导出→导入｜[STATE] tags 原样（拍位/名称）；`.formation.json` 含 tags、导入（副本）逐字段一致｜导出 v1（不含乐）同样携带 tags｜✅已有：TAG#T8、TAG#T9；R31#B-09
- TC-P4-23｜BPM/首拍改变 tag 秒位随动（拍位不变）｜编舞老师|tag 在 16 拍|BPM 120→60；firstBeatSec 0→2｜[STATE] tag.beat=16 不变、屏幕秒位 8s→16s→18s｜—｜✅已有：TAG#T7
- TC-P4-24｜tag 导入清洗 sanitizeTags｜接手老师|伪造 JSON|导入含 [beat=-1, beat=NaN, name='', 重复 id, 无 id] 的 tags｜[STATE] 非法项丢弃、缺 id 补 uid、重复保首个｜⛔纯函数已由 tests/tags.test.js 单测覆盖；E2E 伪造文件路径 🔵建议补
- TC-P4-25｜tag 移动端 375 可用性｜触屏用户|移动视口|⚑打点/双击空白/密集标记渲染｜[STATE] 两路打点可用；[PIXEL] 密集时只画旗点不溢出｜✅已有：TAG#T11；R31#G-03/G-07
- TC-P4-26｜小节 4/3/2/6 切换｜编舞老师|—|bpb-select 各档｜[STATE] beatsPerBar 持久；尺规小节线/节拍器重音/数拍节奏随档｜—｜🔵建议新增（M23#m3 有 BPM 60 口径可并参）
- TC-P4-27｜数拍入场 0..32 设置与钳制｜编舞老师|—|countin-input 输 40/负值｜[STATE] 钳 0..32 持久｜0=不倒计｜✅等价：UF2#E2E-S3-06（4 拍倒计）+ 🔵补钳制断言
- TC-P4-28｜节拍器开关随项目保存｜编舞老师|—|勾「节拍器」→reload｜[STATE] timeline.metronome=true 恢复｜音频断言豁免（状态位口径）｜✅已有：UF2#E2E-S3-09
- TC-P4-29｜播放/数拍中 BPM/首拍/点拍三锁｜编舞老师|播放中|程序化改 bpm/change 输入/点拍｜[STATE] 三者全被拦、输入框显示值还原、toast「播放中不可修改，暂停后可修改」｜暂停后立即解锁｜✅已有：M23（锁定口径）+ 🔵补程序化路径直断言（UF 套件已含 disabled DOM 断言）
- TC-P4-30｜首拍 ≥ 音频时长告警｜编舞老师|已载音乐|首拍填超时长值｜[DOM] toast「首拍（Xs）已超出音频时长（Ys），请确认单位为秒」（不阻断）｜—｜🔵建议新增
- TC-P4-31｜时间轴缩放三按钮 + Ctrl+滚轮｜编舞老师|—|－/＋/⤢/Ctrl+滚轮｜[STATE] pps 变化、块/tag 几何同步、⤢ 复位自适应｜缩放上限防 canvas 超限（4096px）｜🔵建议新增
- TC-P4-32｜尺规 scrub 定位与钳制｜编舞老师|—|点击/拖尺规；拖到负区/超出 totalBeats｜[STATE] beat 钳 0..totalBeats；播放头红线像素≈x｜音频结束态拖回音频范围恢复音频时钟（player 语义）｜✅已有：UF2#E2E-S3-10；🔵补钳制断言
- TC-P4-33｜块时长栏信息行（块名/起拍/总时长）｜编舞老师|—|看 `#bc-name/#bc-sec`｜[DOM] 「1. 开场队形」「（1.1 起 · 共 X.Xs）」随编辑实时刷新｜—｜🔵建议新增（渲染断言轻量）
- TC-P4-34｜数拍中摸时间线=取消倒计｜编舞老师|数拍进行中|scrub/拖块/切块任一｜[STATE] 倒计取消、播放头不弹回负拍｜✅已有：UF1（任务#14 回归口径）；R23#m4 关联
- TC-P4-35｜tag 悬停 title 与 × 几何（鼠标通道）｜编舞老师|tag 在|hover 旗点/×｜[DOM] canvas title 文案切换「删除标记「X」」；光标 pointer｜拖拽中不显 ×（防误删）｜✅已有：TAG#T6（部分）；R31 代码级 `_tagGeom` 断言
- TC-P4-36｜换曲先停（播放中载入新曲）｜编舞老师|播放中|载入第二首｜[STATE] 播放停止、toast「音乐已载入：X（播放已停止）」、旧会话被替换｜损坏文件失败非破坏（TC-P4-01 边界）｜🔵建议新增

边界小结（P4）：损坏音频（01）、BPM 钳制（02）、首拍越界（30）、点拍超时（04）、对齐不可达/0 号拒绝（14/15）、tag 清洗（24）、删除后双击守卫（17）——满足 ≥3 条。

---

# P5 播放与演示：播放族 / 编辑锁 / 撤销安全网 / Esc 取消族

## P5 · 原子操作清单（代码出处：`js/main.js` togglePlay/stepFormation/updateLoop/wireKeyboard、`js/player.js` play/pause/stop/seekBeat/setSpeed/setLoop/cancelCountin、`js/store.js` undo/redo/commit）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A5-01 | ▶ 播放/暂停 | 播放条「**▶**」/空格（五分支：倒计取消/暂停/结束重播/续播/按时钟起播） | `togglePlay` |
| A5-02 | ⏹ 停止 | 「**⏹**」（回 0；audioEnded 复位；循环恢复） | `player.stop` |
| A5-03 | ⏮/⏭ 步进 | 「**⏮ 上一队形 / ⏭ 下一队形**」（钳制；非播放态 seekFormation） | `stepFormation` |
| A5-04 | 速度 | 「**速度**」0.5/0.75/1/1.5/2×（音频变速/虚拟时钟同效） | `pb-speed` |
| A5-05 | 循环 | 「**循环**」勾选（当前队形段 [holdStart, travelEnd] 回绕；越段 seek 回） | `pb-loop` |
| A5-06 | 数拍入场倒计 | 设 >0 拍后 ▶ → 全屏倒计数（`#countin-overlay`） | `play(countIn)` |
| A5-07 | 取消倒计 | 倒计中 ▶/空格/Esc/摸时间线（回停止态基准拍） | `cancelCountin` |
| A5-08 | 编辑锁 | 「**✏ 编辑**」/E 键（关=查看模式：只读+随播放头联动） | `btn-edit-mode` |
| A5-09 | 撤销 | 「**↺**」/Ctrl/Cmd+Z（项目级快照，最多 60 步） | `store.undo` |
| A5-10 | 重做 | 「**↻**」/Ctrl+Shift+Z 或 Ctrl+Y | `store.redo` |
| A5-11 | Esc 取消族 | Esc 优先级：关说明书全屏层 → 取消倒计 → 取消手势 → 清空选择 | keydown Escape |
| A5-12 | 空格双语义 | 按住参与平移手势则 keyup 不触发播放 | space keyup |
| A5-13 | 播放中自动只读 | playing 期间舞台 readOnly（拖拽/框选全部拒绝） | stageScene readOnly |

## P5 · 组合动线

1. **演示准备**：上编辑锁 → 关幽灵/路径 → ⤢ 复位（动线 3.1）。
2. **现场播放**：▶/空格、⏮⏭ 切帧、循环某段、节拍器、scrub、变速（动线 3.2）。
3. **误操作兜底**：↺/↻ 全类型操作往返；撤销到底变灰；跨项目不串栈。
4. **中断恢复**：数拍取消四通道、Esc 手势回滚、播放中结构性操作先暂停。

## P5 · 测试用例目录

- TC-P5-01｜▶ 起播（无音乐虚拟时钟）｜排练助手|无音乐|点「▶」｜[STATE] playing=true、beat 前进；[DOM] ▶ 变 ⏸｜无音乐也播完整条时间轴（终态统一）｜✅已有：UF1#E2E-S3-05
- TC-P5-02｜数拍入场=4 全屏倒计起播｜排练助手|countin=4|▶｜[DOM] `#countin-overlay` 依次 4→1→隐藏；[STATE] beat 从 0 起播；数拍期播放键呈 ⏸、`#pb-pos`=「入场」｜倒计序列完整不跳数（DEFECT-R28-1 回归）｜✅已有：UF2#E2E-S3-06；R23#m4
- TC-P5-03｜播放中点 ⏭ 先暂停跳帧｜排练助手|播放中|点「⏭」｜[STATE] playing=false、formationIndex+1、播放头=该帧 holdStart｜⏮ 对称；首末帧钳制｜✅已有：UF2#E2E-S3-07
- TC-P5-04｜循环当前段回绕｜排练助手|选帧+勾循环|播放｜[STATE] beat 在 [holdStart,travelEnd] 回绕 ≥2 次｜切帧预览期间循环挂起、结束恢复｜✅已有：UF2#E2E-S3-08；R23#m6-loop
- TC-P5-05｜尺规 scrub 到 8.2 拍｜排练助手|暂停|尺规点击/拖动｜[STATE] beat≈8.2；[PIXEL] 播放头红线≈x｜✅已有：UF2#E2E-S3-10（钳制补强见 TC-P4-32）
- TC-P5-06｜速度 0.5× 减速｜排练助手|播放中|速度切 0.5×｜[STATE] 虚拟时钟 beat 增速减半；音频 setRate 同步｜—｜✅已有：UF2#E2E-S3-11
- TC-P5-07｜播到末尾自动停（终态统一）｜排练助手|—|播完整条｜[STATE] playing=false、beat=totalBeats（两套时钟一致）；「音乐已结束」toast=音频先完时一次｜再按 ▶ 从头播（TC-P5-15）｜✅已有：UF2#E2E-S3-12；R23#m6
- TC-P5-08｜播放中拖块改时长+循环区间跟随｜编舞老师|播放+循环|拖 hold 边｜[STATE] 不暂停、块时长生效、loopEnd 跟随新段长（DEFECT-R26-4 回归）｜✅已有：UF1#Top10-①c
- TC-P5-09｜播放中删队形先暂停｜编舞老师|播放中|删当前帧｜[STATE] player.playing=false、无报错、块数-1｜结构性操作（删/重排）统一先停｜✅已有：UF1#E2E-S2-06
- TC-P5-10｜播放中触摸长按重排队形｜触屏用户|播放中|长按 chip 拖拽｜[STATE] 先暂停、顺序更新时长随队形走｜✅已有：UF1#E2E-S2-07
- TC-P5-11｜编辑锁关闭后拖舞者零变化｜排练助手|查看模式|拖舞者｜[STATE] positions 零变化、无历史；[DOM] 按钮无 `toggled-on`｜—｜✅已有：UF1#E2E-S3-01；L2#C-05
- TC-P5-12｜查看模式触摸平移/捏合被拒｜排练助手|查看模式+触屏|平移/双指捏合｜[STATE] view.ox/oy/scale 不变（手势全禁）｜—｜✅已有：UF1#E2E-S3-02
- TC-P5-13｜查看模式 E 键恢复编辑｜排练助手|查看模式|按 E｜[STATE] editMode=true、舞台恢复可拖｜✅已有：UF1#E2E-S3-03
- TC-P5-14｜编辑模式播放中舞台只读｜编舞老师|播放中（锁开）|拖舞者｜[STATE] positions 零变化｜—｜✅已有：UF1#E2E-S3-04
- TC-P5-15｜全曲播完再按 ▶ 从头播｜排练助手|ended 态|再按 ▶｜[STATE] 有音乐 play(0)；无音乐 forceVirtual play(0)；不再静默归 0/只播末段｜—｜🔵建议新增（任务#6/#7 回归口径，M23 部分覆盖）
- TC-P5-16｜暂停后续播（不重开倒计）｜排练助手|播放中|⏸ → ▶｜[STATE] 从当前拍续播；音频结束态续播由虚拟时钟接管至 totalBeats｜—｜🔵建议新增
- TC-P5-17｜⏹ 停止复位｜排练助手|任意播放态|点「⏹」｜[STATE] beat=0、audioEnded 复位、循环恢复、▶ 复位｜—｜🔵建议新增
- TC-P5-18｜⏮ 上一队形与首帧钳制｜排练助手|第 1 帧|点「⏮」｜[STATE] formationIndex 钳 0、无报错；非播放态播放头跟随 seekFormation｜—｜🔵建议新增
- TC-P5-19｜循环勾选时切帧区间跟随｜排练助手|循环开|⏭ 切下一帧｜[STATE] loopStart/loopEnd 跟随新帧段｜—｜🔵建议新增
- TC-P5-20｜数拍取消四通道（▶/空格/Esc/摸时间线）｜排练助手|倒计中|四通道各试一次｜[STATE] 全部回到停止态基准拍（`_ciBase`）、不直接起播｜取消后播放头不残留负拍｜✅已有：UF1（任务#5/#14 回归）+ UF2#E2E-S3-06 关联；🔵补空格通道直断言
- TC-P5-21｜连续 5 类操作逐级 undo｜编舞老师|—|移动/合并/生成/重命名/时长各一条→逐级 ↺｜[STATE] 每级回到前一快照、canUndo/canRedo 正确｜✅等价：L1#D-15（移动+合并逐帧还原/重放）；全类型序列 🔵补
- TC-P5-22｜重命名项目→undo 恢复旧名｜编舞老师|—|改 `#proj-title`→Ctrl+Z｜[STATE] `meta.title` 恢复；输入框回显同步｜—｜🔵建议新增
- TC-P5-23｜撤销到栈底 ↺ disabled｜编舞老师|—|连续 ↺ 到底｜[DOM] `#btn-undo` disabled + opacity 0.4；↻ 对称｜✅已有：UF1#E2E-S2-12（65 次口径内含）+ 🔵独立断言
- TC-P5-24｜65 次提交后 undo 到底（栈深 60）｜编舞老师|—|脚本化 65 次 commit→undo 到底｜[STATE] 栈深 60、最早操作不可撤销；打开/导入清栈（不跨项目撤销）｜✅已有：UF1#E2E-S2-12
- TC-P5-25｜Esc 取消族优先级｜全员|各态|说明书层开→Esc；倒计中→Esc；拖动中→Esc；空闲→Esc｜[STATE] 逐级消费：关层→取消倒计→手势回滚→清选择；每级只消费一次｜—｜✅等价：MAN#R31-G（关层）+ L1#D-12（手势）+ UF（倒计）；四级串联 🔵补
- TC-P5-26｜空格播放双语义（参与平移不触发）｜编舞老师|—|空格 keyup 直按；空格按住+左键拖动后 keyup｜[STATE] 直按=播放切换；参与平移=不触发、不卡修饰键｜焦点在输入框时空格不触发；blur 清 spaceHeld｜✅已有：L1（空格口径）+ conflict-04-keyboard；🔵补「参与平移」直断言

边界小结（P5）：ended 重播（15）、倒计四通道取消（20）、栈底/60 上限（23/24）、Esc 逐级消费（25）、空格双语义（26）——满足 ≥3 条。

---

# P6 视图与视图变换：缩放平移 / 主题 / 移动端 / 说明书

## P6 · 原子操作清单（代码出处：`js/stage.js` wheel/panView/zoomAt/resetView、`js/gesture.js` PAN/PINCH、`js/main.js` wireMobileTabs/wireManual/renderFormationIndex、`js/manual.js` renderManual、`js/store.js` theme）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A6-01 | 滚轮缩放 | 画布滚轮/触控板捏合（以指针为中心） | stage wheel |
| A6-02 | 双指捏合缩放 | 触摸双指（进行中的拖动立即回滚，不产生历史） | gesture PINCH |
| A6-03 | 双指平移 | 双指同向移动 | PINCH pan |
| A6-04 | 中键拖动平移 | 鼠标中键拖（拦截自动滚动默认行为） | gesture PAN(button=1) |
| A6-05 | 空格+左键平移 | 空格按住+左键空白拖动 | spaceHeld 修饰 |
| A6-06 | 横向滚轮/横滑平移 | 横向主导 wheel（Shift+滚轮换轴同效） | panView |
| A6-07 | 触摸空白拖动平移 | 触摸空白位移>晋升阈值（未晋升抬起=点按清空选择） | gesture PAN(touch) |
| A6-08 | 视图复位 | 「**⤢**」（title 视图复位） | `btn-fit` |
| A6-09 | 主题切换 | 顶栏「**🌙 / ☀️**」（记忆 localStorage fs.theme） | `btn-theme` |
| A6-10 | 移动端三 Tab | 底部「**队形 / 舞台 / 更多**」（默认舞台；`body[data-mtab]`） | `#mobile-tabs` |
| A6-11 | 索引条直达 | 索引条尾「**＋ / －**」（免切 Tab 加/删队形） | fi-btn |
| A6-12 | 说明书页签（桌面） | 右面板「**📖 说明书**」（.mtab，第五页签） | props-manual |
| A6-13 | 说明书全屏层（移动端） | 「更多」→「**📖 使用说明书**」→ 全屏层；「**完成 ✕**」/Esc 关 | `btn-manual-open` |
| A6-14 | 显示开关族 | 工具栏「**幽灵 / 路径 / 切帧预览**」↔ 样式页同名复选（Ghost 虚影/移动路径/网格） | 双向同步 |
| A6-15 | 朝向把手开关 | 样式页「朝向把手（选中单人时显示，拖动调整朝向）」 | `sty-facing` |

## P6 · 组合动线

1. **现场缩放平移**：滚轮/捏合/中键/空格多通道随意切换后 ⤢ 复位（L2#C-04 回归链）。
2. **手机演示**：三 Tab 切换 → 索引条切帧/＋－ → 更多里名册/编组/说明书。
3. **说明书阅读**：桌面页签 / 移动端全屏层，同一 renderManual 内容（含截图与速查表）。

## P6 · 测试用例目录

- TC-P6-01｜375×667 开项目三 Tab｜排练助手|移动视口|开项目｜[DOM] 三键「队形/舞台/更多」默认「舞台」active；`body[data-mtab=stage]`｜✅已有：UF1#E2E-S3-13；R31#G-01
- TC-P6-02｜索引条「＋」｜排练助手|移动|点＋｜[STATE] formations+1（复制当前）、索引条滚到新 chip｜✅已有：UF2#E2E-S3-14
- TC-P6-03｜索引条「－」｜排练助手|移动|点－｜[STATE] 当前队形删除、索引钳制｜唯一帧守卫同 TC-P3-13｜✅已有：UF2#E2E-S3-15
- TC-P6-04｜切「更多」Tab 面板展开与重绘｜排练助手|移动|切更多｜[DOM] 右面板可见且页签在；零 pageerror（无 0 尺寸重绘）｜✅已有：UF2#E2E-S3-16
- TC-P6-05｜移动端「🎵 音乐与节拍」默认收起｜排练助手|≤1023.5px|看面板｜[DOM] `#audio-disc[open]`=false｜展开后记忆至刷新｜✅已有：UF2#E2E-S3-17；R31#G-02
- TC-P6-06｜滚轮缩放（指针中心）｜编舞老师|桌面|wheel±｜[STATE] scale 变化、缩放中心锚定指针；Ctrl+滚轮在时间轴=时间轴缩放（分区）｜✅已有：L1#D-10
- TC-P6-07｜双指捏合+双指平移（中断回滚）｜触屏用户|触屏|捏合；拖拽中第二指按下｜[STATE] 缩放/平移生效；DRAG 立即回滚零历史；零距离不产生 Infinity｜查看模式双指同样被拒（TC-P5-12）｜✅已有：L1#D-09；RI（中断）
- TC-P6-08｜中键拖动/空格+左键平移｜编舞老师|桌面|两通道各平移一次｜[STATE] view.ox/oy 变化、选择/数据/历史零变化；中键中途 Esc 干净中止｜✅已有：L1#D-11；RI#IR-04
- TC-P6-09｜横向滚轮/触控板横滑水平平移｜编舞老师|桌面|deltaX 主导 wheel｜[STATE] 仅 ox 变化（横向优先判定）；触控板双指横滑不触发历史导航（F-07）｜✅已有：conflict-05-wheel；r20 同源
- TC-P6-10｜触摸空白拖动平移/未晋升点按清空｜触屏用户|触屏|小幅抬起 vs 拖动抬起｜[STATE] 未晋升=点按清空选择；晋升=平移且不改选择｜✅已有：L1 T 组；RI
- TC-P6-11｜⤢ 视图复位｜编舞老师|缩放平移后|点「⤢」｜[STATE] view 复位 fitView（全部舞者可视）｜舞台尺寸修改后自动复位（stageChange view=null）｜✅等价：L2#C-04（变换回归）；直断言 🔵补
- TC-P6-12｜主题切换 🌙/☀️ 与记忆｜编舞老师|—|点主题钮→刷新｜[DOM] `data-theme` 切换、按钮文案互换、meta theme-color 跟随；[STATE] localStorage fs.theme 恢复｜主题是界面态不进项目文件｜🔵建议新增（R31 入口快照在案）
- TC-P6-13｜说明书页签（桌面五页签互斥）｜编舞老师|桌面|五页签往返×2｜[DOM] .ptab×4+.mtab×1 active 互斥、props-page 可见性互斥；时长改动回显不被说明书页干扰（propsKey 回归）｜✅已有：MAN#R31-A/B/C；R31#C-01
- TC-P6-14｜说明书全屏层（移动端入口/关闭）｜排练助手|移动|更多→📖 使用说明书→完成✕/Esc｜[DOM] `#manual-overlay` 开/关；桌面入口 CSS 隐藏（display:none，仅移动端「更多」显示）｜Esc 先关层不穿透舞台（TC-P5-25 第一级）｜✅已有：MAN#R31-G；R31#G-06、C-04
- TC-P6-15｜说明书内容完整性｜编舞老师|—|核对页内容｜[DOM] 9 节（7 场景+速查+限制）、速查两表 11+11 行、限制 7 条、截图全解码（naturalWidth>0，scrollIntoView 口径）、版本徽标「适用版本 build-29-tags」｜资产缺失静默跳过不裂图｜✅已有：MAN#R31-D；R31#C-02/C-03
- TC-P6-16｜显示开关族双向同步（幽灵/路径/切帧预览/网格）｜编舞老师|—|工具栏与样式页交替切｜[STATE] showGhost/showPaths/previewOnSwitch/showGrid 一致；[PIXEL] 虚影/路径线随开关出现消失｜均为界面态不进项目文件｜🔵建议新增（开关 DOM 在 R31 entries 快照）
- TC-P6-17｜朝向把手开关与拖动｜编舞老师|—|样式页开把手→拖单人把手｜[STATE] showFacingHandle=true；facing=拖动角度、松手历史「调整朝向」｜✅已有：L1#D-14
- TC-P6-18｜查看模式桌面滚轮缩放仍可用｜排练助手|查看模式|滚轮缩放｜[STATE] 缩放生效（wheel 无 readOnly 拦截——代码实况核实）；舞台仍随播放头｜触摸端全禁（TC-P5-12）对照｜🔵建议新增（诚实边界显式用例）

边界小结（P6）：双指中断回滚（07）、 Esc 层优先（14）、移动端 0 尺寸重绘（04）、查看模式触摸全禁 vs 滚轮可用（18 对照）——满足 ≥3 条。

---

# P7 数据与迁移：导出导入 / 深链 / 持久化 / 离线

## P7 · 原子操作清单（代码出处：`js/export.js`、`js/main.js` 导出菜单/doExportJSON/imp-json/wireDeeplinkImport、`js/store.js` storage 双后端/importProject/duplicateProject、`js/model.js` validateProject、`js/ui.js` renderLibrary）

| # | 原子操作 | 入口实况文案 / 手势 | 代码入口 |
|---|---|---|---|
| A7-01 | 导出 PNG | 「导出 ▾」→「**当前队形 PNG**」 | `exp.exportPNG` |
| A7-02 | 打印/PDF | 「**打印 / PDF（全部队形）**」（每队形一页，含备注与 8 拍标注） | `exp.printFormations` |
| A7-03 | 导出含乐 JSON | 「**导出项目文件（含音乐）**」（v2 dataBase64 内嵌；移动端优先系统分享） | `exp-json-audio` |
| A7-04 | 导出不含乐 JSON | 「**导出项目文件（不含音乐）**」（严格 v1，无 dataBase64） | `exp-json` |
| A7-05 | 导入项目文件 | 「**导入项目文件…**」（v1/v2 均可；音频回填+会话直灌） | `#imp-json` |
| A7-06 | 深链导入 | `?import=<URL>`（成功/失败都剥参；不覆盖既有项目） | `runDeeplinkImport` |
| A7-07 | 深链 URL 解析 | parseImportParam/stripImportParam/resolveImportUrl（hash 剥离、绝对→相对、仅 https/同源 http） | 纯函数三件套 |
| A7-08 | 项目校验迁移 | `validateProject`（版本/钳制/清洗：positions 键、merges 迁移、groups 悬挂、tags 清洗、pairs 退役） | 同名 |
| A7-09 | 复制项目 | 库右键「**复制**」（新 id+音频继承） | `duplicateProject` |
| A7-10 | 删除项目 | 「**🗑**」/右键「**删除**」+confirm | `deleteProjectById` |
| A7-11 | 存储双后端 | 在线 http(s)=IndexedDB（`formation-studio` 库 projects/audio 表）；file://=localStorage（键 `wuzhen:proj:*`） | `STORAGE_MODE` |
| A7-12 | 离线提示条 | file:// 库页「**离线版：项目数据保存在本浏览器（配乐不保留）**」+「**×**」（记忆 dismissed） | `wireOfflineNote` |
| A7-13 | 音频持久化 | 在线 putAudio/getAudio（Blob）；下载版 putAudio no-op（配乐不持久→「（重新选择文件）」） | storage |
| A7-14 | 自动落盘 | mutate→400ms scheduleSave；visibilitychange/pagehide 强制；undo/redo 也落盘 | store |
| A7-15 | 打开恢复音频 | openProject 后 `restoreAudio`（在线从 IDB 回填会话） | `restoreAudio` |
| A7-16 | history 哨兵 | 编辑器 pushState 一条；后退回库/前进重开；应用内回库弹哨兵 | `createHistorySentinel` |

## P7 · 组合动线

1. **文件交付**：导出（含乐/不含乐）→ 传输 → 对端导入（动线 5.1/5.3）。
2. **深链分享**：JSON 上 https → `?import=` 链接 → 自动导入 → 刷新不重导（动线 5.2）。
3. **跨设备迁移**：A 导出含乐 → 全新 context 导入 → 数据一致无残留。
4. **离线赛场**：下载版建档 → 配乐不持久例外 → 含乐导出兜底（动线 6.1/6.2）。

## P7 · 测试用例目录

- TC-P7-01｜导出当前队形 PNG｜编舞老师|编辑器|导出▾→当前队形 PNG｜[STATE] 下载事件触发、PNG 尺寸=画布、含主题底色｜⛔视觉内容人工抽检（自动断言文件头/尺寸可 🔵）｜🔵建议新增
- TC-P7-02｜打印/PDF（全部队形）｜编舞老师|多帧|导出▾→打印 / PDF｜[STATE] 每队形一页、含备注与 8 拍标注（打印窗口内容断言）｜⛔真实打印对话框不可自动（`window.print` 拦截后断言内容 🔵）｜🔵建议新增
- TC-P7-03｜导出含乐 JSON（v2）｜编舞老师|已载音乐|导出▾→含音乐｜[STATE] version=2、`audio.dataBase64` 非空；下载文件名 `<项目名>.formation.json`｜✅已有：UF1#E2E-S5-01
- TC-P7-04｜导入 v2 文件（音乐回填）｜接手老师|—|导入含乐文件｜[STATE] 新项目+1、标题=原名（副本）、audio.name 恢复、audio.ready=true｜✅已有：UF2#E2E-S5-02
- TC-P7-05｜导入 v1（无音乐）toast｜接手老师|—|导入 v1｜[DOM] toast「导入成功（该项目文件不含音乐，请重新载入音乐）」｜✅已有：UF2#E2E-S5-03
- TC-P7-06｜导入损坏文件不崩溃｜接手老师|—|随机字节改后缀导入｜[DOM] toast「导入失败：…」；[STATE] 库不变、无 pageerror｜✅已有：UF1#E2E-S5-04
- TC-P7-07｜不含乐导出严格 v1｜编舞老师|已载音乐|点「不含音乐」｜[STATE] 导出文件无 dataBase64、toast「已导出项目文件（不含音乐，可稍后重新载入）」——按钮语义与文案严格对齐（任务#1 回归）｜✅已有（部分）：UF1#E2E-S5-01 对照路径；直断言 🔵建议补
- TC-P7-08｜含乐导出双守卫 toast｜编舞老师|未载音乐/仅会话音乐|点「含音乐」｜[DOM] 未载=「当前项目未载入音乐，将导出不含音乐的项目文件」；找不到 blob=「本地未找到音乐文件，请重新载入后再导出含音乐版本」｜✅已有（下载版兜底）：UF1#E2E-S6-05；两 toast 直断言 🔵补
- TC-P7-09｜复制项目继承音频｜编舞老师|已载音乐|库右键「复制」｜[STATE] `getAudio(副本id)` 非空｜✅已有：UF2#E2E-S5-05
- TC-P7-10｜深链成功（剥参/不覆盖/toast）｜接手老师|—|带合法 `?import=<同源 JSON>` 打开｜[STATE] 进编辑器、标题（副本）、URL 参数剥离、库+1；toast「已导入项目：X」｜深链优先于 lastProject 自动恢复｜✅已有：UF1#E2E-S5-06；R31#D-01（实况 PASS）
- TC-P7-11｜深链后刷新不重导入｜接手老师|导入后|F5｜[STATE] 无「已导入」toast、库仍 1、参数空｜✅已有：UF1#E2E-S5-07；R31#D-02
- TC-P7-12｜深链 HTTP 404｜接手老师|—|`?import=<404 URL>`｜[DOM] toast「深链导入失败：项目文件无法获取（HTTP 404）」；正常进原视图｜✅已有：UF1#E2E-S5-08；R31#D-04
- TC-P7-13｜深链非法 JSON｜接手老师|—|`?import=<非 JSON>`｜[DOM] toast「深链导入失败：文件不是合法 JSON」｜✅已有：UF1#E2E-S5-09；R31#D-06
- TC-P7-14｜深链 ftp scheme 拒绝｜接手老师|—|`?import=ftp://…`｜[DOM] toast「深链导入失败：项目文件地址仅支持同源或 https」｜✅已有：UF1#E2E-S5-10；R31#D-05
- TC-P7-15｜深链含内嵌音乐回填｜接手老师|—|导入 v2 深链｜[STATE] 音乐 Blob 回填新项目并可播放｜✅已有：UF2#E2E-S5-11
- TC-P7-16｜深链优先于 lastProject 恢复｜接手老师|本地已有项目|带 import 打开｜[STATE] 进入的是导入副本而非 lastProject（init 后执行整体覆盖）｜✅已有：DL#P1
- TC-P7-17｜深链失败族补全（network/validate）｜接手老师|—|连接拒绝 / 校验不过（未知版本）｜[DOM] toast「…无法获取（网络异常）」/「…校验未通过」；不 crash｜✅等价：DL#P2/P3b（404/非 JSON 已单列）；network/validate 🔵补
- TC-P7-18｜SW 断网深链（ignoreSearch 供页）｜排练助手|HTTPS 渠道|断网带 ?import 打开｜[STATE] 应用本体可开（SW 导航缓存）；import 失败有 toast｜✅已有：UF2#E2E-S6-10；DL#P4
- TC-P7-19｜设备 A 导出→设备 B 导入｜编舞老师↔接手老师|全新 context|A 导出含乐 → B 导入｜[STATE] B 快照与导出文件一致、audio.ready=true｜✅已有：UF2#E2E-S5-12
- TC-P7-20｜新设备无旧设备残留｜编舞老师|全新 context|导入前后核对｜[STATE] 项目列表仅含导入项（无同步无残留）｜✅已有：UF2#E2E-S5-14
- TC-P7-21｜导入多帧多合并往返无损｜接手老师|复杂项目|导出→导入→逐帧对比｜[STATE] positions/merges 与源 JSON 一致（往返无损）｜🔵建议新增（TAG#T9 已覆盖 tags 字段口径）
- TC-P7-22｜导入副本上改一帧其余帧不变｜接手老师|导入副本|改一帧｜[STATE] 仅该帧 diff｜🔵建议新增
- TC-P7-23｜同一文件导入两次→两个独立副本｜接手老师|—|导入×2｜[STATE] 两个「（副本）」项目 id 互异互不覆盖｜🔵建议新增
- TC-P7-24｜旧版数据迁移清洗｜接手老师|伪造旧版 JSON|导入 v1 含 diamond/twin merges、悬挂 groups、pairs 字段、字符串数值｜[STATE] 旧样式→capsule、悬挂成员清理、pairs 删除、数值钳制（validateProject 全链）｜🔵建议新增（纯函数已由 tests/model.test.js 单测；E2E 文件路径 🔵）
- TC-P7-25｜undo 后刷新落盘为撤销后状态｜编舞老师|—|改→undo→刷新｜[STATE] 载入的是撤销后状态（scheduleSave 同样入栈）｜🔵建议新增
- TC-P7-26｜file:// 打开离线提示+ls 后端｜任何人|下载单文件|双击打开｜[DOM] `#offline-note` 文案正确；[STATE] STORAGE_MODE='ls'｜✅已有：UF1#E2E-S6-01
- TC-P7-27｜file:// 编辑刷新保留｜任何人|下载版|改一处→刷新｜[STATE] 改动保留（localStorage）｜✅已有：UF1#E2E-S6-02
- TC-P7-28｜下载版配乐不持久（重新选择文件）｜任何人|下载版|载入音乐→重开｜[STATE] 项目在、audio.ready=false、`#audio-name`「X（重新选择文件）」｜✅已有：UF1#E2E-S6-03
- TC-P7-29｜离线提示条关闭记忆｜任何人|下载版|点×→刷新｜[DOM] 不再出现（`wuzhen:offlineNoteDismissed=1`）｜✅已有：UF1#E2E-S6-04
- TC-P7-30｜下载版含乐导出兜底迁移｜任何人|下载版|导出含乐→删→导｜[STATE] 完整恢复（会话 Blob 兜底 DEFECT-R26-2）｜✅已有：UF1#E2E-S6-05
- TC-P7-31｜HTTP 渠道无 SW（断网不可用实证）｜任何人|在线 HTTP|读 `navigator.serviceWorker`｜[STATE] undefined——渠道诚实限制记录｜✅已有：UF1#E2E-S6-07
- TC-P7-32｜HTTPS 渠道 SW 注册断网可开｜任何人|localhost 安全上下文|二次访问断网｜[STATE] SW 控制下页面可开、应用进库｜✅已有：UF1#E2E-S6-08
- TC-P7-33｜断网中编辑恢复无丢失｜任何人|已打开页面|断网编辑→恢复→刷新｜[STATE] 全程自动落盘本地，无丢失｜✅已有：UF1#E2E-S6-09
- TC-P7-34｜file:// 无 SW 注册（渠道能力边界）｜任何人|下载版|读 serviceWorker 与导航拦截｜[STATE] 无 SW 注册、无导航拦截（深链/PWA 属在线渠道）｜🔵建议新增

边界小结（P7）：损坏文件（06）、深链五失败态（12/13/14/17/18）、配乐不持久（28）、存储配额写失败静默（A7-14 备注）、HTTP 断网渠道（31）——满足 ≥3 条。

---

# P8 skill 辅助创作：dancesport-choreo 与 app 往返

## P8 · 原子操作清单（skill 侧七能力 + app 侧配合；契约=project JSON 逐字节无损往返）

| # | 原子操作 | 入口 / 文案 | 侧 |
|---|---|---|---|
| A8-01 | 导出交接 | app「导出 ▾」→「导出项目文件（不含音乐）」交 agent | app |
| A8-02 | analyze-music | 老师先报 BPM/段落表并确认，agent 分析 | skill |
| A8-03 | propose-formations | 出队形候选 2–4 个+SVG+分散度/对称度/移动量 | skill |
| A8-04 | propose-transition | A→B 变体+速度可行性分（移动距离÷可用拍×BPM≤上限） | skill |
| A8-05 | propose-timeline | 段落表→blocks 提案（密度规则；travel ≤ span−1） | skill |
| A8-06 | apply | 写回前自动存版本快照（`.snapshots/v*.json`） | skill |
| A8-07 | check | 体检：硬校验+越界/最小间距/速度上限/拍数对齐→决策点清单 | skill |
| A8-08 | publish/回填 | 深链 `?import=` 或「导入项目文件…」载回 app | skill+app |

## P8 · 组合动线

候选→预览→体检→回填循环（动线 7.1）；段落表→时间轴匹配（动线 7.2）。**人在回路**：app 是唯一事实源，agent 只出候选，每次 apply 有快照可回退。

## P8 · 测试用例目录

- TC-P8-01｜app 导出→skill import/export→app 导入逐字节一致｜编舞老师×agent|—|三段往返｜[STATE] positions/merges/blocks 逐字节一致｜✅已有：UF1#E2E-S7-01
- TC-P8-02｜propose-formations 候选质量｜agent|—|出候选｜[STATE] 候选 ≤4、排序稳定可复现、每候选带 SVG｜✅已有：UF2#E2E-S7-02
- TC-P8-03｜check 违规 100% 拦截｜agent|越界项目|check｜[STATE] errors 含越界违规｜✅已有：UF1#E2E-S7-03
- TC-P8-04｜transition 引用名册外 id｜agent|—|构造未知 id｜[STATE] 拒绝生成/check 出 unknown-dancer warning｜✅已有：UF2#E2E-S7-04
- TC-P8-05｜apply 后快照生成｜agent|—|apply｜[STATE] `.snapshots/v*.json` +1 且内容=apply 后状态｜✅已有：UF2#E2E-S7-05
- TC-P8-06｜段落表提案 blocks｜agent|段落表|propose-timeline｜[STATE] 总拍数=歌曲节拍、块数与密度规则一致｜✅已有：UF2#E2E-S7-06
- TC-P8-07｜逐段 travel 可行性｜agent|—|校验｜[STATE] 每段 travel ≤ span−1、feasibility 全 ok｜✅已有：UF2#E2E-S7-07
- TC-P8-08｜apply 采纳后 export→app 导入无损｜编舞老师×agent|—|往返｜[STATE] 逐字节无损（契约回归）｜✅已有：UF2#E2E-S7-08
- TC-P8-09｜skill publish→深链回填全链｜编舞老师×agent|HTTPS 托管|publish 出链接→点开｜[STATE] 自动导入副本+音乐恢复（组合 TC-P7-10/15）｜🔵建议新增（DL 已分段覆盖，串链 🔵）
- TC-P8-10｜快照回退（人在回路）｜编舞老师|apply 后不满意|回退到 v(n-1) 快照重改｜[STATE] 快照链完整、回退后 check 通过｜🔵建议新增
- TC-P8-11｜自报属性偏差告警｜agent|—|自报分散度 vs core 重算偏差 >5%｜[STATE] check 输出 warning 决策点｜🔵建议新增
- TC-P8-12｜回填后 app 内复核｜编舞老师|导入副本|播放核对+体检问题处置｜[STATE] 播放全程无跳变（组合 TC-P5 系）｜⛔艺术效果判定人工；技术断言 🔵

---

# 覆盖对照表：97 条既有建议 → 本目录

> 状态：✅=已有驱动与用例（附驱动）/🔵=建议新增/等价=语义等价既有用例。驱动缩写见「阅读说明」。

| 原编号 | 主题摘要 | 新目录 | 状态 |
|---|---|---|---|
| E2E-S1-01 | 空库新建 | TC-P1-01 | ✅ UF1 |
| E2E-S1-02 | 已组合建档 | TC-P1-02 | ✅ UF1 |
| E2E-S1-03 | 自定义 0 人 | TC-P1-03 | ✅ UF2 |
| E2E-S1-04 | 预设对数 disabled | TC-P1-04 | ✅ UF2 |
| E2E-S1-05 | 刷新自动恢复 | TC-P1-05 | ✅ UF2 |
| E2E-S1-06 | 向导关闭取消 | TC-P1-06 | ✅ UF2 |
| E2E-S1-07 | 生成器圆形 | TC-P3-01 | 🔵（97 中未落 E2E） |
| E2E-S1-08 | 粒度仅男士 | TC-P3-02 | 🔵（97 中未落 E2E） |
| E2E-S1-09 | 均布+右键切向 | TC-P3-04 | ✅ UF2 |
| E2E-S1-10 | 拖拽驻留合并 | TC-P2-20 | ✅ UF2 |
| E2E-S1-11 | 合并替换语义 | TC-P2-24 | ✅ UF1 |
| E2E-S1-12 | 拖动中 Escape | TC-P3-09 | ✅等价 L1#D-12 + RI#IR-04 |
| E2E-S1-13 | ＋ 新队形 | TC-P3-12 | ✅ UF2 |
| E2E-S1-14 | 删除唯一队形守卫 | TC-P3-13 | ✅ UF2 |
| E2E-S1-15 | 改名+显示字段 | TC-P2-01 | ✅ UF2 |
| E2E-S1-16 | 重编号码 | TC-P2-02 | ✅ UF2 |
| E2E-S1-17 | 删除舞者联动 | TC-P2-03 | ✅ UF2 |
| E2E-S1-18 | ＋ 单人进所有帧 | TC-P2-04 | ✅ UF2 |
| E2E-S1-19 | 存为编组 | TC-P2-08 | ✅ UF2 |
| E2E-S1-20 | 名册芯片 | TC-P2-07 | ✅ UF2 |
| E2E-S2-01 | 帧隔离 | TC-P3-14 | ✅ UF1 |
| E2E-S2-02 | 插帧保留时长 | TC-P3-12 | ✅ UF1 |
| E2E-S2-03 | 拖块恰 1 历史 | TC-P4-12 | ✅ UF2 |
| E2E-S2-04 | ripple 两语义 | TC-P4-11 | ✅ UF2 |
| E2E-S2-05 | 切帧清选择 | TC-P3-15 | ✅ UF1 |
| E2E-S2-06 | 播放中删队形 | TC-P5-09 | ✅ UF1 |
| E2E-S2-07 | 播放中触摸重排 | TC-P5-10 | ✅ UF1 |
| E2E-S2-08 | 逐级 undo | TC-P5-21 | ✅等价 L1#D-15（全类型序列 🔵补） |
| E2E-S2-09 | 重命名项目 undo | TC-P5-22 | 🔵 |
| E2E-S2-10 | 栈底 ↺ disabled | TC-P5-23 | 🔵（UF1#S2-12 内含部分断言） |
| E2E-S2-11 | undo 落盘 | TC-P7-25 | 🔵 |
| E2E-S2-12 | 60 步上限 | TC-P5-24 | ✅ UF1 |
| E2E-S2-13 | 导入往返无损 | TC-P7-21 | 🔵 |
| E2E-S2-14 | 副本隔离编辑 | TC-P7-22 | 🔵 |
| E2E-S2-15 | 同文件双导 | TC-P7-23 | 🔵 |
| E2E-S3-01 | 查看模式拖拽拒绝 | TC-P5-11 | ✅ UF1 |
| E2E-S3-02 | 查看模式触摸拒绝 | TC-P5-12 | ✅ UF1 |
| E2E-S3-03 | E 键恢复 | TC-P5-13 | ✅ UF1 |
| E2E-S3-04 | 播放中只读 | TC-P5-14 | ✅ UF1 |
| E2E-S3-05 | ▶ 无音乐起播 | TC-P5-01 | ✅ UF1 |
| E2E-S3-06 | 数拍 4→1→隐藏 | TC-P5-02 | ✅ UF2 |
| E2E-S3-07 | 播放中 ⏭ | TC-P5-03 | ✅ UF2 |
| E2E-S3-08 | 循环回绕 | TC-P5-04 | ✅ UF2 |
| E2E-S3-09 | 节拍器状态位 | TC-P4-28 | ✅ UF2 |
| E2E-S3-10 | scrub 定位 | TC-P5-05 | ✅ UF2 |
| E2E-S3-11 | 速度 0.5× | TC-P5-06 | ✅ UF2 |
| E2E-S3-12 | 末尾自动停 | TC-P5-07 | ✅ UF2 |
| E2E-S3-13 | 移动端三 Tab | TC-P6-01 | ✅ UF1 |
| E2E-S3-14 | 索引条 ＋ | TC-P6-02 | ✅ UF2 |
| E2E-S3-15 | 索引条 － | TC-P6-03 | ✅ UF2 |
| E2E-S3-16 | 更多 Tab 重绘 | TC-P6-04 | ✅ UF2 |
| E2E-S3-17 | 音乐面板默认收起 | TC-P6-05 | ✅ UF2 |
| E2E-S4-01 | 载入 wav | TC-P4-01 | ✅ UF1 |
| E2E-S4-02 | BPM 钳制 | TC-P4-02 | ✅ UF1 |
| E2E-S4-03 | 点拍 4 次 | TC-P4-03 | ✅ UF1 |
| E2E-S4-04 | 点拍超时重置 | TC-P4-04 | ✅ UF1 |
| E2E-S4-05 | 试听无音乐 | TC-P4-05 | ✅ UF2 |
| E2E-S4-06 | 首拍试听 | TC-P4-06 | ✅ UF2 |
| E2E-S4-07 | BPM 减半 | TC-P4-07 | ✅ UF1 |
| E2E-S4-08 | 保持＋钳制 | TC-P4-08 | ✅ UF2 |
| E2E-S4-09 | 唯一队形无过渡 | TC-P4-09 | ✅ UF2 |
| E2E-S4-10 | 拖边吸附 | TC-P4-10 | ✅ UF2 |
| E2E-S4-11 | 对齐可达 | TC-P4-13 | ✅ UF2 |
| E2E-S4-12 | 对齐不可达 | TC-P4-14 | ✅ UF2 |
| E2E-S4-13 | 第 1 队形对齐拒绝 | TC-P4-15 | ✅ UF2 |
| E2E-S5-01 | 导出含乐 v2 | TC-P7-03 | ✅ UF1 |
| E2E-S5-02 | 导入 v2 回填 | TC-P7-04 | ✅ UF2 |
| E2E-S5-03 | 导入 v1 toast | TC-P7-05 | ✅ UF2 |
| E2E-S5-04 | 损坏文件 | TC-P7-06 | ✅ UF1 |
| E2E-S5-05 | 复制继承音频 | TC-P7-09 | ✅ UF2 |
| E2E-S5-06 | 深链成功 | TC-P7-10 | ✅ UF1 |
| E2E-S5-07 | 深链刷新不重导 | TC-P7-11 | ✅ UF1 |
| E2E-S5-08 | 深链 404 | TC-P7-12 | ✅ UF1 |
| E2E-S5-09 | 深链非法 JSON | TC-P7-13 | ✅ UF1 |
| E2E-S5-10 | 深链 ftp | TC-P7-14 | ✅ UF1 |
| E2E-S5-11 | 深链含乐 | TC-P7-15 | ✅ UF2 |
| E2E-S5-12 | A→B 迁移 | TC-P7-19 | ✅ UF2 |
| E2E-S5-13 | 库右键复制 | TC-P1-10 | ✅ UF2 |
| E2E-S5-14 | 新设备无残留 | TC-P7-20 | ✅ UF2 |
| E2E-S6-01 | file:// 提示+ls | TC-P7-26 | ✅ UF1 |
| E2E-S6-02 | file:// 刷新保留 | TC-P7-27 | ✅ UF1 |
| E2E-S6-03 | 配乐不持久 | TC-P7-28 | ✅ UF1 |
| E2E-S6-04 | 提示条记忆 | TC-P7-29 | ✅ UF1 |
| E2E-S6-05 | 含乐导出兜底 | TC-P7-30 | ✅ UF1 |
| E2E-S6-06 | file:// 无 SW | TC-P7-34 | 🔵 |
| E2E-S6-07 | HTTP 无 SW 实证 | TC-P7-31 | ✅ UF1 |
| E2E-S6-08 | HTTPS SW 断网 | TC-P7-32 | ✅ UF1 |
| E2E-S6-09 | 断网编辑无丢失 | TC-P7-33 | ✅ UF1 |
| E2E-S6-10 | SW 断网深链 | TC-P7-18 | ✅ UF2 |
| E2E-S7-01 | skill 往返无损 | TC-P8-01 | ✅ UF1 |
| E2E-S7-02 | 候选质量 | TC-P8-02 | ✅ UF2 |
| E2E-S7-03 | check 拦截 | TC-P8-03 | ✅ UF1 |
| E2E-S7-04 | 名册外 id | TC-P8-04 | ✅ UF2 |
| E2E-S7-05 | apply 快照 | TC-P8-05 | ✅ UF2 |
| E2E-S7-06 | 段落表 blocks | TC-P8-06 | ✅ UF2 |
| E2E-S7-07 | travel 校验 | TC-P8-07 | ✅ UF2 |
| E2E-S7-08 | apply 导入无损 | TC-P8-08 | ✅ UF2 |

**统计**：97 条 = ✅已有 86 + ✅等价 2（S1-12、S2-08）+ 🔵建议新增 9（S1-07、S1-08、S2-09、S2-10、S2-11、S2-13、S2-14、S2-15、S6-06）。

> 注：TC-P1-10 承接 S5-13（复制项目归入 P1 项目管理域）；S3-09（节拍器）归入 P4 音乐域——均为域归属调整，非遗漏。

---

# 总账与缺口

## 用例总账

| Phase | 用例数 | 收录自 97 | 新增（97 之外） |
|---|---|---|---|
| P1 | 22 | 7 | 15 |
| P2 | 28 | 8 | 20 |
| P3 | 26 | 9 | 17 |
| P4 | 36 | 16 | 20 |
| P5 | 26 | 17 | 9 |
| P6 | 18 | 5 | 13 |
| P7 | 34 | 27 | 7 |
| P8 | 12 | 8 | 4 |
| **合计** | **202** | **97** | **105** |

- 97 条全部收录：**✅已有 86**（UF1/UF2 直测）、**✅等价 2**（S1-12→L1#D-12+RI#IR-04；S2-08→L1#D-15，全类型序列另列补强）、**🔵建议新增 9**（S1-07、S1-08、S2-09、S2-10、S2-11、S2-13、S2-14、S2-15、S6-06）。
- 域归属调整 2 条（状态不变仍 ✅）：S5-13 复制项目 → TC-P1-10（归 P1 项目管理域）；S3-09 节拍器 → TC-P4-28（归 P4 音乐域）。
- **新增建议用例 105 条**（v0.9.14+ 新功能 tags/说明书/预设细节/多选浮窗/labelMode/舞台设置 + 边界与异常显式用例；其中 12 项已由 R31 探针实况核对通过，可直接转正式断言）。
- ⛔不可自动化 0 条：原生 confirm/prompt/print 均可经 Playwright dialog/print 拦截接线（已在对应用例标注接线方式）；仅 PNG/PDF 的**视觉内容**保留人工抽检。

## 「无 E2E 覆盖且可自动化」缺口 Top10（建议按序补测）

1. **舞台整形三件套零 E2E**：镜像 ⇋/⇅（TC-P3-05）、整体旋转 ⟳（TC-P3-06）、换位（TC-P2-28）——纯 mutate 提交，[STATE]+[PIXEL] 断言成本低、回归价值高。
2. **生成器矩阵**：97 条仅点名圆形与仅男士；8 形×3 粒度应参数化补齐（TC-P3-01/02/03）。
3. **撤销细节族**：重命名项目 undo（TC-P5-22）、全类型逐级 undo（TC-P5-21 补强）、undo 落盘（TC-P7-25）。
4. **导入往返细节族**：多帧多合并逐字节一致（TC-P7-21）、副本隔离编辑（TC-P7-22）、同文件双导（TC-P7-23）。
5. **队形元数据面板**：名称/颜色/备注三字段与时间轴块渲染联动（TC-P3-17）。
6. **舞台设置域**：尺寸/后台区/观众方向/背景图（TC-P3-18/19/21）——影响坐标系与朝向基准，回归风险实际不低。
7. **播放终态族**：ended 再按 ▶ 从头播（TC-P5-15）、⏹ 复位（TC-P5-17）、⏮ 钳制（TC-P5-18）、循环切帧跟随（TC-P5-19）。
8. **tag 边界**：sanitizeTags 伪造导入清洗（TC-P4-24）、首拍越界告警（TC-P4-30）、缩放与块时长栏信息行（TC-P4-31/33）。
9. **深链失败族收尾**：network/validate 两 reason（TC-P7-17）与「深链优先于 lastProject」的 dev 树直测（TC-P7-16 已由 DL 覆盖 dist）。
10. **界面态持久化**：主题记忆（TC-P6-12）、显示开关族双向同步（TC-P6-16）、⤢ 复位直断言（TC-P6-11）。

## 实况核对发现的文档/UI 不一致点（不改码，仅记录）

1. **说明书全屏入口实为移动端专属**：`#btn-manual-open`（title「打开使用说明书（全屏阅读）」）桌面 CSS `display:none`（`css/style.css:256`），仅移动端 `body[data-mtab=more]` 显示——桌面 DOM 里有按钮但永不可见；桌面说明书唯一入口是右面板「📖 说明书」页签。R31#C-04 实证（证据 `out/round31-cases/`）。index.html 注释已自述，测试断言须按「桌面=页签、移动=全屏层」分流。
2. **说明书节数口径**：DOM 实为 **9 个 `.man-scene`**（7 场景＋手势/快捷键速查＋数据与限制）；探针注释「7 场景」易让断言写错节数。R31#C-02 按 9 节核对 PASS。
3. **「均布」title 滞后**：按钮 title 仅写「所选舞者等间距(竖排间距)」，实际右键可切横向/纵向（右键能力靠 toast 提示，title 未覆盖）。
4. **时间轴缩放按钮位置描述**：user-guide-flows §1.6-45 写「时间轴右下」，实况「－ ＋ ⤢」位于「🎵 音乐与节拍」主行右端（音乐面板内），建议文档措辞对齐。
5. **README 四项历史差异仍存**（user-guide-flows §4-9 已记录）：移动端三 Tab（非四）、按钮文案「合并为单元/取消合并」（非组对拆对）、file:// 存 localStorage（非 IndexedDB）、触摸长按排序已落地（F-10 已做）——本轮复核无变化。
6. **97 条建议的部署路径假设**：深链示例 URL `/apps/wuzhen/index.html?import=` 为在线托管形态；dev 树为 `/index.html`、dist 单文件为根路径——属部署形态差异而非缺陷，E2E 已按「同源任意路径」口径通过（R31#D 组）。

## 本轮实况证据（`lab/out/round31-cases/`）

- `results.json`：50/50 PASS（A 桌面入口 9 / B tag 全套 10 / C 说明书 6 / D 深链 6 组 / E 向导 6 / F labelMode 3 / G 移动端 8，全部零 pageerror）。
- `entries-desktop.json`：桌面全量入口文案快照（顶栏/舞台工具/面板页签/播放条/块时长/音乐面板/校准子行/移动 Tab）。
- `shots/*.png`：tag 打点、拖移后、说明书页签、深链成功/失败、向导、移动端说明书与移动端打点共 9 张。
- 复用的既有证据：`out/probe-tags/`（T1..T11）、`out/f10/`（深链 dist+SW）、`out/round31-manual/`（说明书 R31-A..H）。
- 探针脚本：`lab/round31-cases-probe.mjs`（只读核对，未改应用代码；dev server 8137 由本轮按项目标准 `scripts/dev-server.py 8137 .` 拉起）。

