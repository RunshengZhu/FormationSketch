# 浏览器手势/快捷键冲突调研报告（round19 · UX）

- 项目：舞阵 WuZhen（formation-studio）@ `793c5d5`，实测目标 `http://localhost:8137/`（dev 源码树）
- 产出性质：调研报告 + 可复跑实证探针。**本轮未修改任何应用代码**（js/*、index.html、css/*、scripts/* 均未动）。
- 探针：`wuzhen-e2e-lab/conflict-*.mjs`（9 个，可复跑）；证据：`wuzhen-e2e-lab/out/round19-ux/`（12 份 JSON + 7 张截图）。
- 探针复跑方式：`cd wuzhen-e2e-lab && node conflict-0X-*.mjs`（需 dev server 在 8137）。

---

## 0. 平台诚实声明（必读）

| 环境 | 状态 | 说明 |
|---|---|---|
| Chromium 桌面（headless，真实 CDP 输入管线） | ✅ 已实证 | 键盘/鼠标/滚轮/右键均经 `Input.dispatch*` 产生 `isTrusted=true` 事件，通过浏览器默认行为处理（滚动接管、compat 鼠标事件、touch-action 判定） |
| Chromium 触摸模拟（`hasTouch` + `dispatchTouchEvent`） | ✅ 已实证 | 触摸事件进入真实手势管线；但**无真实屏幕**，双击缩放/长按呼出的"视觉后果"（页面缩放动画、放大镜）不可见，仅能验证事件层后果（pointercancel、visualViewport.scale、innerWidth） |
| WebKit（Playwright WebKit 26.6，Safari 内核代理） | ✅ 已实证（子集） | 键盘/右键/滚轮/合成指针事件可测；**触摸无拖拽原语**（仅 tap），触摸拖拽类以合成 PointerEvent 为代理证据 |
| iOS 真机（Safari / 边缘返回 / magnifier / rubber-band） | ❌ 不可实证 | 汇总为「真机人工确认清单」（§14），共 7 项 |
| Android 真机（Chrome / PTR / 长按呼出） | ❌ 不可实证 | 同上 |
| 浏览器 chrome 层快捷键（标签页切换、保留键） | ❌ CDP 不可达 | `Input.dispatchKeyEvent` 直接注入渲染进程，**绕过浏览器 chrome 层拦截逻辑**，因此"页面能否拦住 Ctrl+1..9"只能：① 页面侧 handler 生效性=已实证；② 浏览器是否放行=引用公开资料（[SO: capture browser shortcuts](https://stackoverflow.com/questions/7295508/javascript-capture-browser-shortcuts-ctrlt-n-w)、[Chromium Issue 41081444](https://issues.chromium.org/41081444)、[Chrome 官方快捷键表](https://support.google.com/chrome/answer/157179)）+ 真机确认 M-1 |

**等级定义**：P0=数据损坏或主流程阻断；P1=真实场景下功能明显受损/高危误触；P2=体验毛刺/一致性问题。已防御项标注「✅已防御」并保留验证证据（防回归口径）。

---

## 1. 执行摘要

对 11 项调研范围逐项完成了「代码现状判定 → 探针实证 → 定级 → 方案」。共登记 **17 项**发现：**已防御（验证通过）6 项、P1 冲突 5 项、P2 冲突 6 项**；无 P0（最严重的一条存在"数据损坏链"但需要触摸取消+鼠标 hover 的组合条件，且有撤销兜底，判 P1）。

**核心结论**：
1. **舞台 canvas 的防御面基本健康**：`touch-action:none` + wheel `passive:false` + contextmenu 拦截 + 中键防自动滚动 + pointercancel 接手势机，把画布上的浏览器默认行为防住了（多项实证通过）。
2. **两个状态机级缺陷在"浏览器中途接管"（pointercancel）路径上**：舞台手势机的 pointers 表不清理（→ 二次触摸误判 PINCH）；时间轴根本没有 pointercancel 监听（→ drag 卡死 + 鼠标 hover 误改块时长的数据损坏链）。这是本轮最有价值的发现，修复成本都很小。
3. **防御布局不均衡**：防御集中在画布，周边 UI（时间轴、播放条、面板、按钮）全部 `touch-action/overscroll/user-select = auto`，构成 P2 冲突面。
4. **键盘层防御基本到位**（Space/方向键/输入框守卫/Ctrl+数字页面侧 handler 全部实证通过），剩余风险集中在浏览器 chrome 层保留键（Safari Cmd+1..9），属方案级重设计议题。

### Top 冲突清单（每条：冲突 + 方案）

| # | 冲突（一句话） | 方案（一句话） |
|---|---|---|
| UX-01 | pointercancel 后手势机 pointers 表残留脏指针，下一次单指触摸被误判为双指 PINCH 并跳变缩放 | `gesture.js cancel()` 中按 pointerId 清理 pointers 表（或 cancel 携带 pointerId 全量清空） |
| UX-02 | 时间轴触摸拖拽被滚动容器接管（pointercancel 实证），且 MusicTimeline 无 cancel 监听 → drag 卡死、之后**鼠标无按键路过即持续改写块时长**（数据损坏链） | `#tl-canvas` 设 `touch-action:none`（滚动交由按钮/双指滚轮）并补 `pointercancel → this.drag=null` |
| UX-03 | overscroll-behavior 全局 auto + 根滚动器恒在顶部 → Chrome Android 顶部下拉刷新可达（刷新=整页重载） | `html{overscroll-behavior-y:none}`（库视图内滚容器不受影响） |
| UX-04 | SPA 无 history 哨兵：浏览器后退/iOS 左缘返回=直接离开编辑器（画布已拦横滑，时间轴/面板面拦不住） | 进编辑器 `history.pushState` 哨兵 + `popstate` 拦截（交互语义需产品拍板） |
| UX-05 | Safari 将 Cmd+1..9 保留给切标签页，事件不到页面 → 编组快捷键在 Safari 失效且用户被切走 | 快捷键重设计（§13，需产品拍板） |
| UX-06 | 除画布外全部交互面 `touch-action:auto` → 快速连点 ＋/−、移动 Tab 等按钮可触发浏览器双击缩放 | 按钮级 `touch-action:manipulation` |
| UX-07 | Shift+滚轮在 Chrome 换轴为 deltaX，画布缩放 handler 只读 deltaY → Shift+滚轮=舞台上的死键 | 明确语义：deltaX 驱动横向平移或显式忽略（产品拍板可选项） |
| UX-08 | 时间轴/播放条/面板右键漏出浏览器原生菜单（与画布自定义菜单不一致） | 制定右键策略：编辑面拦截或显式放行，输入框必须保留 |
| UX-09 | 项目库卡片右键=复制项目（隐藏手势），用户想调浏览器菜单时误复制 | 改显式「⋯」菜单或至少 toast 提示（产品拍板） |
| UX-10 | EditStrip 芯片用 HTML5 draggable，触屏不产生 dragstart → 移动端无法拖拽排序队形 | 提供触摸等价路径（长按拖动或上移/下移入口） |
| UX-11 | iOS 长按的 loupe/文本放大镜、Android 长按呼出未显式抑制（webkitTouchCallout=auto） | 画布/编辑面 `-webkit-touch-callout:none`（真机确认 M-8 后决定范围） |

---

## 2. 方案总表（按优先级；工作量 S≤0.5d / M≤2d / L>2d）

| 优先 | ID | 方案（代码级落点） | 修复对象 | 工作量 | 需拍板 |
|---|---|---|---|---|---|
| P1 | F-01 | `js/gesture.js` `cancel()`（L379-386）：清空 `pointers` 表与 `pinch`；或 cancel 接收 pointerId 精确删除。同步审计 `up()` 对 `lpBox` 的早退路径 | UX-01 | **S** | 否 |
| P1 | F-02 | `css/style.css` `#tl-canvas{touch-action:none}`（或 `pan-x` 保留容器双指滚动，二选一见 §4）；`js/timeline.js _bind()`（L296-307）补 `cv.addEventListener('pointercancel', () => { this.drag = null; })` | UX-02 | **S** | touch-action 取值需小决策 |
| P1 | F-03 | `css/style.css` 根部：`html{overscroll-behavior-y:none}`（可选连带 `overscroll-behavior-x:none` 防横滑历史导航） | UX-03/UX-04(部分) | **S** | 否 |
| P1 | F-04 | `js/main.js` 进/出编辑器时 `history.pushState`/`popstate` 哨兵 | UX-04 | S（代码）/M（交互语义） | **是**（返回键语义） |
| P1 | F-05 | 快捷键重设计（§13） | UX-05 | M | **是** |
| P2 | F-06 | `css/style.css`：`button,.btn,.ptab,#mobile-tabs button,.fi-chip,.es-chip,.um-btn{touch-action:manipulation}` | UX-06 | **S** | 否 |
| P2 | F-07 | `js/stage.js _bind()` wheel handler（L560-563）：读 `e.deltaX` 时按 Shift/横滑语义处理（横向平移或忽略但保持 preventDefault） | UX-07 | **S** | 语义可选拍板 |
| P2 | F-08 | 右键策略：`#tl-canvas`/播放条/面板统一 `contextmenu` preventDefault（输入框、名册表格除外） | UX-08 | **S** | 策略方向 |
| P2 | F-09 | `js/ui.js` L67 隐藏手势去留 | UX-09 | **S** | **是** |
| P2 | F-10 | EditStrip 触摸排序路径 | UX-10 | **M** | 形态 |
| P2 | F-11 | `#stage-canvas,#stage-wrap{ -webkit-touch-callout:none }` + 编辑面 `user-select:none`（输入框除外） | UX-11/UX-16 | **S** | 范围 |

---

## 3. 项 1：canvas touch-action 现值与浏览器接管行为

**场景**：触摸拖画布=平移/框选；双击=单元浮窗；双指=捏合缩放；长按=菜单/框选。浏览器侧对应：双击缩放、双指页面缩放、长按呼出、拖动滚动/回弹。
**浏览器/输入**：Chromium 触摸模拟（`dispatchTouchEvent`，375×667 移动视口）；WebKit 交叉验证。

**现状实测**（探针 `conflict-02-touch-stage.mjs` → `out/round19-ux/c02-touch-stage.json`；样式基线 `c01-style-audit.json`）：
- 现值：`#stage-canvas` 是**全应用唯一** `touch-action:none` 的元素（css/style.css L87）。其余一切=auto（含时间轴画布）。
- T1 空白拖动=平移：✅ 视图位移 (-80,-40)px，无 pointercancel、页面不滚、手势结束回 IDLE、pointers 清空。
- T2 长按空白=框选：✅ 700ms 静止后进入 BOX，拖动结算选中 3 人，无 touchcancel 干扰。
- T3 双击合并单元=浮窗：✅（`c02b-doubletap.json`）双 tap 后 `.unit-menu` 出现（拆开/胶囊/单编号/删除/✕），非合并舞者双击不弹浮窗（符合设计）。
- T4 双指捏合=舞台缩放：✅ 舞台 scale 10.28→22.27，`visualViewport.scale` 恒 1、`innerWidth` 不变 → **页面缩放未被触发**（touch-action:none 在事件层生效）。
- headless 局限：双击缩放/页面缩放的视觉动画不可见，以上以 `visualViewport.scale`/`innerWidth` 为代理指标。

**冲突等级**：✅已防御（画布本体）。残留见 §9 UX-06（周边 UI）。
**方案**：维持现状；将本节 IR 化为回归门禁（见验证标准）。
**验证标准（IR 口径）**：`dispatchTouchEvent` 拖拽 → `Δview.ox/oy`≈位移且 `visualViewport.scale==1`；双 tap 合并单元 → `.unit-menu` 存在；双指开合 → `view.scale` 变化率=指距变化率且 `innerWidth` 不变。

---

## 4. 项 2+7：overscroll / 下拉刷新 / 移动端边缘手势

**场景**：编辑器顶部下拉；面板滚动到底继续拖；iOS 左缘右滑返回；触控板双指横滑。
**浏览器/输入**：样式判定 + 合成/真实 wheel（Chromium）；真机行为不可实证。

**现状实测**（`conflict-08-overscroll-edge.mjs` → `c08-overscroll-edge.json`；`conflict-05` W6）：
- `html/body` `overscroll-behavior=auto`，根滚动器不可滚动但恒在 `scrollTop=0`，viewport 为 `width=device-width, initial-scale=1.0, viewport-fit=cover`（无 `user-scalable=no`）→ **Chrome Android 顶部下拉 PTR 的静态条件全部满足**（真机确认 M-5；主流 Web App 的同类事故先例充分）。
- 队形列表滚动到底后继续滚动：无窗口级 scroll 事件（body 不可滚，链条终止于"无效"），但 `overscroll=auto` 意味着可滚容器（`#formation-list`/`.props-page`/`#tl-scroll`/弹窗）在 iOS 的 rubber-band 行为未约束（M-6）。
- **历史栈**：全代码库 grep 无 `pushState/replaceState`；`history.length` 基线 2（about:blank+站点）且全程稳定 → 后退/边缘返回=离开应用（本地持久化兜底，但编辑现场重载）。
- 触控板双指横滑：画布上 wheel(deltaX) 被 preventDefault（终值实测 `c05` W3a/W6）→ 画布内历史导航被抑制；**时间轴 `#tl-scroll` 的 deltaX wheel 不拦**（W6 `tlDxWheelDp=false`，原生横向滚动是设计需求）→ 滚到尽头继续横滑可触发 Chrome 历史后退（真机确认 M-4）。

**冲突等级**：
- UX-03 PTR 可达：**P1**（真机确认后可升级/降级）
- UX-04 无历史哨兵：**P1**（iOS）/P2（桌面横滑路径）
**方案**：
- F-03：`html{overscroll-behavior-y:none}`（一行，零副作用——应用本身没有页面级滚动需求；库视图内部滚动不受影响）。
- F-04：编辑器路由哨兵（`pushState` + `popstate` → toast「再次返回离开」或直接回项目库），**返回键语义需产品拍板**。
**验证标准**：`getComputedStyle(html).overscrollBehaviorY === 'none'`；编辑器中 `history.back()` 不离开站点（哨兵生效）；时间轴横向 wheel 到尽头后 `history.length` 不变（哨兵场景）。

---

## 5. 项 3：拖拽时的文本选择 / 图像拖影（user-select 现状）

**场景**：画布框选/时间轴拖块时鼠标滑出画布进入文字区；双击面板文字；触屏长按。
**现状实测**（`conflict-07-selection.mjs` → `c07-selection.json`；样式 `c01`）：
- 全局 `user-select=auto`；仅 `.build-tag`、`#audio-disc summary` 为 none（css L120/229）。
- 画布框选拖入右面板：**无选择泄露**（选中文字=""，rangeCount=0；canvas 为替换元素无文字锚点）——实测优于预期。
- 时间轴拖块滑出到 block-ctl 文案：无泄露（同理）。
- 双击面板提示文字 → 选中「调节」二字（浏览器默认，无害但可优化）。
- 双击画布空白 → 无选择。
- `#proj-title` 输入框内拖选正常（应保留的能力，勿全局禁）。
- canvas 元素本身非 `draggable`，无图像拖影问题；但 **EditStrip 芯片 `chip.draggable=true`**（js/timeline.js L23）→ 触屏不产生 dragstart → UX-10。

**冲突等级**：✅已防御（画布拖拽路径）；UX-10 触屏排序缺失 **P2**。
**方案**：F-11（可选：编辑面 `user-select:none` 但显式豁免 input/textarea）；F-10（EditStrip 触摸排序，形态需产品拍板）。
**验证标准**：画布拖拽跨越面板后 `getSelection().isCollapsed===true`；输入框文字仍可拖选；（若做 F-10）触摸长按芯片 500ms 后可拖动排序。

---

## 6. 项 4：键盘冲突矩阵

**现状实测**（`conflict-04-keyboard.mjs` → `c04-keyboard.json`；焦点守卫代码 js/main.js L940-941）：

| 探针 | 结果 | 判定 |
|---|---|---|
| Space（编辑器） | `preventDefault` 生效：页面 `scrollY` 恒 0；keyup 未参与手势 → 播放切换恰好一次 | ✅已防御 |
| Space（焦点在播放按钮） | 按钮激活被抑制、无双触发（`doubleToggleRisk=false`） | ✅ |
| Space（库视图） | 无动作（守卫：非 editor 视图直接 return） | ✅ |
| 方向键（无选择） | 不 preventDefault；body 不可滚 → 页面不动；焦点在列表时滚列表（原生语义，预期行为） | ✅ |
| 方向键（有选择，Shift+↓） | 舞者 y +1.0（Shift 步进），无页面滚动 | ✅ |
| 数字 1..9（无编组） | 无效果 | ✅ |
| **Ctrl+1** | 存编组成功（groups 0→1，成员=当前选择），页面侧 `preventDefault` 生效 | ✅（页面侧） |
| 数字/Shift+数字 选编组 | 选择生效 | ✅ |
| Meta+2（Cmd 路径） | 存编组成功（隔离复证） | ✅（页面侧） |
| **输入框焦点守卫** | 焦点在 `#bpm-input` 时：数字/单键 e/Space/方向键均不触发应用快捷键，按键进入输入框 | ✅（守卫只认 INPUT/TEXTAREA/SELECT；应用无 contentEditable，够用） |
| Ctrl+Z / Ctrl+Y | 撤销/重做正常，redo 栈验证 | ✅ |
| Ctrl+W/T/N 误触面 | 应用对"其余一切 ctrl/meta/alt 组合"直接放行（main.js L966）→ **无争夺面**；浏览器保留键不可拦也无需拦 | ✅（UX-14，记录性） |
| **Ctrl/Cmd+1..9 vs 浏览器切标签** | Chrome 桌面按公开资料属**可拦截**项（页面 preventDefault 即可独占）；**Safari Cmd+1..9 为保留键，事件不到页面** → 编组失效且用户被切走。CDP 无法实证 chrome 层 → **真机确认 M-1** | UX-05：**P1（Safari）/P2（Chrome）** |
| Shift+F10 / ContextMenu 键 | CDP 键盘注入不产生 contextmenu 事件（chrome 层合成）→ 无法实证；**人工确认 M-3**。右键路径见 §8 | 待确认 |

**冲突等级**：UX-05 **P1(Safari)**；其余 ✅已防御。
**方案**：F-05 快捷键重设计（§13，需产品拍板）。代码级备选：在 `keydown` 捕获阶段对 `metaKey+Digit1..9` 显示 toast「Safari 请使用 Shift+数字或面板按钮」（低成本缓解）。
**验证标准**：焦点守卫 IR：`activeElement=INPUT` 时按下 `Digit1/Space/e/ArrowDown` → `snapshot()` 五项状态零变化且输入值含所按字符；编组 IR：`Ctrl+1` → `groups[0].memberIds == 保存时选择`。

---

## 7. 项 5：滚轮与触控板

**现状实测**（`conflict-05-wheel.mjs` → `c05-wheel.json`；js/stage.js L560-563 显式 `{passive:false}`）：

| 探针 | 结果 | 判定 |
|---|---|---|
| 画布普通滚轮 | 舞台缩放；`innerWidth`/`visualViewport.scale` 不变（页面缩放代理指标不动） | ✅ |
| **触控板捏合（ctrl+wheel）** | 舞台缩放；**Chrome 页面缩放未触发**（renderer 级默认动作被 preventDefault，`innerWidth` 不变为证） | ✅ UX-15 |
| passive 标记 | 画布 wheel 合成事件终值 `defaultPrevented=true`（非 passive 可取消）；`#tl-scroll` 普通滚轮不拦（原生滚动，设计使然） | ✅ |
| **Shift+滚轮（换轴形态 deltaX）** | 画布不缩放（handler 只读 `e.deltaY`）→ 死键；但 preventDefault 仍执行 → 双指横滑历史导航被抑制。语义丢失但无害 | UX-07 **P2** |
| 时间轴 ctrl+wheel | 时间线缩放（secPerPx 0→0.0058） | ✅ |
| 时间轴 Shift/横向滚轮 | deltaX 形态正常横向滚动 `#tl-scroll`（scrollLeft 0→160）；Playwright deltaY 形态不滚（无修饰传递，工具链限制，真机为换轴形态） | ✅ |
| WebKit 交叉 | `canvasPlain/canvasCtrl/tlCtrl` 终值 prevented=true，`tlPlain=false`（`c09-webkit.json`）——跨引擎一致 | ✅ |

**冲突等级**：UX-07 **P2**。
**方案**：F-07——`stage.js` wheel handler 增加横滑语义：`if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { panBy(-e.deltaX, 0); }`（或维持忽略，产品拍板可选项）；Shift+滚轮若要给缩放，Chrome 无法区分（已换轴），不建议。
**验证标准**：`dispatchMouseEvent(mouseWheel, deltaX=±240)` 于画布 → `view.ox` 变化（若采纳横滑语义）或 `view.scale` 不变且 `defaultPrevented=true`（维持现状口径）。

---

## 8. 项 6+9：pointercancel 路径 + 右键菜单

### 8a. pointercancel（本轮最重要发现）

**场景**：浏览器中途接管（来电/通知横幅/系统手势/滚动接管）→ `pointercancel`。两处状态机行为实证：

**UX-01 舞台手势机脏指针 — P1**
- 实测（`c02` T5，真实触摸管线）：touchStart→touchMove（平移中）→ `touchCancel` → 状态机回 IDLE ✅ 但 `debugPointers()` 残留 `[8]`（gesture.js `cancel()` L379-386 **不清 `pointers` 表**；`up()` 才删，而 cancel 后 `up` 不会再来）。随后**下一次单指按下 → `pointers.size===2` → `abortToPinch()` → 状态=PINCH**（`c02` T5 `secondDownState:"PINCH"`），伴随以脏坐标计算的捏合跳变。且该残留**不会自愈**：每次后续单指触摸都复现，直到切帧动画（`startPositionsPreview`→`reset()`）或浮窗关闭才复位。合成事件隔离复证：PINCH 中第二指 cancel、长按等待中 cancel 的结束状态均正确（IDLE、长按定时器已解除），但 pointers 残留在**所有** cancel 路径存在（T6）。
- WebKit 同路径复现（`c09` S5 `after cancel + new touch → PINCH`）。
- **方案（F-01，S）**：`cancel()` 开头 `pointers.clear(); pinch = null;`（stage 层 cancel 不带 pointerId，全清是安全保守解：cancel 后续不会有该批指针的任何事件）。同步在 `down()` 入口加防御：`if (pointers.size === 1 && state === 'IDLE') pointers.clear()`（时间窗口兜底）。
- **验证标准（IR）**：`touchStart→move→touchCancel→touchStart(新)` → `gesture.state()==='PAN'`（或 IDLE+pointers 空）、`debugPointers().length===1`；单指拖动全程无 zoom 跳变（`view.scale` 恒定）。

**UX-02 时间轴拖拽被接管 + drag 卡死 — P1（含数据损坏链）**
- 实测（`conflict-03-timeline.mjs` → `c03-timeline.json`，真实触摸管线）：
  - T1 尺规拖动（scrub）：`pointercancel=true`（滚动容器接管，即使 scrollLeft 未变——纵向主导轴判定即接管），接管后 `touchEnd` 失效 → `MusicTimeline.drag` 卡死为 `{kind:'scrub'}`，播放头停在半途 4.03 拍。**触摸端 scrub/拖块在现实现下基本不可用**（tap 定位仍可用）。
  - T2 块边缘拖动（hold 把手）：同样被 cancel；拖动中途已误写 `holdBeats 16→20`，drag 卡死 `{kind:'hold'}`。
  - **T3 卡死后果（数据损坏链）**：卡死的 hold-drag 存续时，**无按键的鼠标 hover 扫过时间线 → `holdBeats` 被连续改写（实测 2→25）**（timeline.js `_bind` 无 `pointercancel` 监听，`_move` 只查 `this.drag`）。截图 `c03-t3-hover.png`。
  - T4 鼠标基线（干净页面）：拖块正常（16→31 拍）→ 桌面行为不受影响（`c03-t4-mouse-baseline.json`）。
- **方案（F-02，S）**：两层——① `css`：`#tl-canvas{touch-action:none}`（块拖/scrub 从根上不被接管；`#tl-scroll` 的横向滚动改由滚轮/边缘/双指滚轮承担。若要保留触摸横滚，可改 `touch-action:pan-x` 并接受"把手拖拽仅在起手命中把手的 10px 容差内"的折衷，需小决策）；② `timeline.js _bind()` 补 `cv.addEventListener('pointercancel', () => { this.drag = null; })`（即使 touch-action 修复，也必须兜底，否则其他接管源同样卡死）。
- **验证标准（IR）**：触摸拖尺规 → `pointercancel` 后 `musicTl().drag===null`；拖块把手中途 cancel → `holdBeats` 回到拖前值或保持一次提交、随后鼠标 hover 扫过 `holdBeats` 零变化。

### 8b. 右键菜单（UX-08/09）

**实测**（`conflict-06-contextmenu.mjs` → `c06-contextmenu.json`，真实右键）：

| 目标 | contextmenu | 阻断 | 应用菜单 | 判定 |
|---|---|---|---|---|
| 画布空白 | 有 | ✅ 终值 prevented | 无（空白右键无菜单=设计） | ✅ |
| 画布舞者 | 有 | ✅ | ✅ 弹出（拆开/样式/删除） | ✅ |
| 时间轴画布 | 有 | ❌ | — | UX-08 P2：原生菜单漏出 |
| 队形芯片/播放条 | 有 | ❌ | — | UX-08 P2 |
| 项目名输入框 | 有 | ❌ | — | ✅ 粘贴入口应保留 |
| **项目库卡片** | 有 | ✅ | — | UX-09 P2：右键=**复制项目**（实测 library 1→2），隐藏手势误触面 |

**方案**：F-08（编辑面统一拦截，输入框豁免）；F-09（库卡片隐藏手势去留，**产品拍板**）。
**验证标准**：右键 `#tl-canvas` → `defaultPrevented===true` 且无浏览器菜单（截图对比）；右键 `#proj-title` → 浏览器菜单保留。

---

## 9. 项 8+10：双击语义 / 时间轴触摸与播放头

**双击（UX-06/UX-12）**：
- 画布：`touch-action:none` 根治双击缩放——双击浮窗实证可用（`c02b`）；tap→click 延迟实测 **0ms**（无 300ms 等待，`width=device-width` 视口下 Chrome 快击路径）。
- 周边按钮：`touch-action=auto`（c01 全量审计）→ 快速连点 ＋/− 拍、移动 Tab、fi-chip 等存在双击缩放可能（真机视觉后果不可模拟，事件层条件成立）→ UX-06 **P2**。方案 F-06（按钮级 `touch-action:manipulation`，保留双指缩放 a11y）。
**验证标准**：`getComputedStyle` 抽查 ≥8 个高频按钮 `touchAction==='manipulation'`；画布双 tap 浮窗 IR 持续通过。

**时间轴触摸（UX-02 的用户视角）**：块边缘拖动/播放头 scrub 是时间轴核心操作，当前在触摸端被滚动接管（§8a 实证）——**移动端时间轴"只读可看、拖拽基本不可用"**（tap 选中/定位可用）。修复优先级随移动端使用占比上升。

---

## 10. 项 11：自由发挥（其他发现）

| 发现 | 证据 | 等级/归属 |
|---|---|---|
| 项目库卡片右键=复制项目（隐藏手势） | `c06` libraryCardRightClick（1→2 个项目） | UX-09 P2（拍板） |
| EditStrip `draggable=true` 触屏无 dragstart → 移动端无法拖拽排序 | `c07` editStripDraggable | UX-10 P2 |
| iOS 长按 loupe/callout 未显式抑制（`webkitTouchCallout=auto`） | `c01` 样式审计 | UX-11 P2（真机 M-8） |
| Shift+滚轮死键（Chrome 换轴） | `c05` W3a | UX-07 P2 |
| 时间轴尽头横滑可触发历史后退（无哨兵） | `c05` W6 + `c08` | 并入 UX-04 |
| Alt+点击：mac/Chromium 无冲突（选中正常）；Linux Alt+拖动=移窗 | `c04` K8 | 真机项 M-2 |
| 中键自动滚动：已防（pointerdown+mousedown 双拦 button=1） | js/stage.js L544/559 + 历史 round 探针 | ✅ |
| 窗口 blur 修饰键卡住：已有 `setSpaceHeld(false)` 防护 | js/main.js L1024 | ✅ |
| 浏览器翻译气泡对 canvas：canvas 像素内容不可译、无 DOM 文本，无冲突证据 | 代码审阅 | 无影响（记录） |
| Escape 与浏览器全屏退出：应用不使用 fullscreen API，无争夺 | 代码审阅 | 无影响（记录） |

---

## 11. 已防御项汇总（回归门禁口径）

| ID | 项 | 实证要点 | 证据 |
|---|---|---|---|
| ✅D-1 | 画布 touch-action:none 防滚动/双击缩放/双指页面缩放 | T1/T3/T4 | c02/c02b |
| ✅D-2 | 画布 wheel passive:false + 页面缩放拦截（ctrl+wheel=舞台缩放） | W1/W2/W4 | c05 |
| ✅D-3 | 画布右键拦截+自定义菜单 | c06 | c06 |
| ✅D-4 | Space/方向键 preventDefault、输入框焦点守卫、Ctrl+数字页面侧 handler | K1-K5 | c04 |
| ✅D-5 | 中键防自动滚动；blur 防修饰键卡住 | 代码+复跑 | c04 |
| ✅D-6 | 拖拽无文本选择泄露（canvas 锚定）；双击画布无选择 | c07 | c07 |

---

## 12. 真机人工确认清单（本轮不可实证项）

| ID | 场景 | 预期/风险 |
|---|---|---|
| M-1 | Chrome/Safari 真机 Ctrl/Cmd+1..9 | Chrome 桌面预期可拦（资料）；**Safari 必切标签页**（保留键）→ 编组快捷键在 Safari 失效 |
| M-2 | Linux Chrome Alt+拖动画布 | 系统窗口拖动优先，舞台拖拽被吞 |
| M-3 | Shift+F10 / ContextMenu 键（焦点在 body/画布） | body 焦点时原生菜单弹出位置不可控 |
| M-4 | macOS Chrome 触控板双指横滑（时间轴区域滚到尽头） | 触发历史后退=离开编辑器 |
| M-5 | Chrome Android 编辑器顶部下拉 | PTR 弹出 → 整页重载（静态条件已满足） |
| M-6 | iOS Safari 面板滚动到边的 rubber-band | 是否牵动整页（body overflow:hidden 在 iOS 不可靠） |
| M-7 | iOS 左缘右滑返回 vs 舞台边缘起手的平移/框选 | 系统手势优先；画布 touch-action:none 不约束系统边缘手势 |
| M-8 | iOS 长按画布（舞者长按菜单/长按框选） | loupe/触摸高亮是否出现 |

---

## 13. 快捷键重设计方案（~~需产品拍板~~ → **round20 已裁定，见下**）

背景：RTS 式 Ctrl/Cmd+数字在 Chrome 可用，但在 Safari（Cmd+1..9 保留）、以及与浏览器标签页心智冲突的广义面上是脆弱的。候选方向（互不排斥）：

1. **平台感知降级**：检测 Safari → 编组快捷键改 `Alt/Cmd+Shift+数字`（不与保留键冲突）或仅保留面板按钮路径；Chrome 维持现状。改动小，但跨浏览器快捷键不一致。
2. **统一改为无浏览器语义的组合**：`Shift+数字=选`（现状）+ `Ctrl/Cmd+Shift+数字=存`（双修饰，无浏览器争夺面；Ctrl+Shift+数字未被 Chrome 保留——需真机复核 M-9）。缺点：与 RTS 习惯（Ctrl+数字）偏离。
3. **引线模式（leader key）**：`G` 引线 + 数字（如 `G 3` = 选组 3、`G Shift 3` = 存组 3）。无任何浏览器冲突、可扩展（G 后接 U=取消合并等），但学习成本与现有用户习惯迁移成本最高。
4. **触屏端本就不依赖这些快捷键**（编组面板按钮存在）→ 桌面浏览器差异可接受时，维持现状 + Safari 文案提示（最小改动）。

**拍板所需输入**：目标用户浏览器分布、RTS 习惯迁移成本、与 `e/d/g/f` 单键空间的兼容性（g 已被吸附切换占用，引线模式需换键）。

**round20 裁定（已落实）**：采用方向 4 的最小改动档——**不改键位**（Chrome/Edge 维持 Ctrl+1..9、macOS 维持 Cmd+1..9，页面侧 handler 现状有效）；Safari 侧不做平台感知改键，改为**文案提示显性化**：① 编组选项卡（props-groups）常驻说明注明「Safari 请用编组选项卡：Cmd+1..9 被浏览器保留，请改用本面板『选择』按钮」；② `#stage-canvas` title 追加同义提示。方向 1/2/3（平台感知降级 / 双修饰 / 引线模式）顺延，待 Safari 用户占比数据支持后再议。真机确认项 M-1 维持开放（Safari 真机复证）。

---

## 15. round20 落实记录（修复范围裁定 · 本节为唯一修订，其余章节保留 round19 原貌作为修复前基线）

用户拍板的修复范围与落点结果（探针复跑证据：`wuzhen-e2e-lab/out/round20-ux/`，探针副本 `lab/r20-*.mjs`，round19 原证据未覆盖）：

| ID | 结果 | 落点摘要 |
|---|---|---|
| F-01 | ✅已落实 | `gesture.js cancel()` 开头 `pointers.clear(); pinch=null`（全清保守解）；`up()` 对 lpBox 早退路径审计结论：非发起指在 lpBox 期间本就不入 pointers 表（down 早退在 set 之前），早退路径无残留面，不加代码 |
| F-02 | ✅已落实 | **`#tl-canvas{touch-action:none}` 胜出**（见下方决策注）；`timeline.js _bind()` 补 `pointercancel → this.drag=null` 兜底 |
| F-03 | ✅已落实 | `html{overscroll-behavior:none}`——**y/x 双向 none**：根滚动器无任何页面级滚动需求，x 向 none 连带抑制触控板横滑到底的历史导航（M-4 的 CSS 侧缓解，与 F-07 的 JS 侧 preventDefault 互为冗余防线）；库内滚容器不受影响 |
| F-04 | ✅已落实 | 哨兵决策机 `createHistorySentinel`（ui.js，node 可测）+ main.js 接线：进编辑器 pushState 恰一条；popstate 在编辑器=应用内回库（与「‹ 项目库」按钮严格同语义：stop+closeProject）；应用内回库主动弹哨兵并吞自驱 popstate；前进到哨兵=重开该项目；库⇄编辑器往返 pushState 覆盖 forward 条目，**零堆积** |
| F-05 | ✅已裁定落实 | 不改键位，方向 4 最小档：编组选项卡 + canvas title 文案提示（详 §13 裁定注） |
| F-06 | ✅已落实 | `button,.btn,.ptab,#mobile-tabs button,.fi-chip,.es-chip,.um-btn{touch-action:manipulation}`（按报告选择器原文） |
| F-07 | ✅已落实 | stage wheel：一律 preventDefault；`|deltaX|>|deltaY|` 且无 ctrl/meta → 舞台水平平移（`panView(-deltaX,0)`，含 Shift 换轴形态）；纵向/捏合缩放语义不变 |
| F-08 | ✅已落实 | document 级策略：编辑器视图内 contextmenu 一律 preventDefault（含时间轴/播放条/面板/chip，与画布自定义菜单同一防御面）；`input/textarea/select/.roster-table` 豁免保留系统菜单；库视图不拦（归 F-09） |
| F-09 | ✅已落实 | 库卡片右键=自定义菜单 `[打开/复制/删除/✕]`（复用 `.unit-menu/.um-btn` 风格，fixed 定位钳制视口，点外部/Esc 关闭）；**左键打开不变**；静默复制手势移除 |
| F-10 | ✅已实装（轮14b 更新） | EditStrip 触摸长按拖拽排序已于轮 14b 落地（长按 chip 0.3s 拿起→拖动实时预览→落位重排；blocks 按 formationId 跟随、容器边缘自动滚动、pointercancel 安全回滚。证据：`wuzhen-e2e-lab/out/round14-v3`、探针 `lab/probe-f10-touch-reorder.mjs`、单测 `tests/f10.test.js`）。本行 round20 时点为「⏸顺延（形态需另行拍板）」，实况以本行为准 |
| F-11 | ✅已落实 | `#stage-canvas,#stage-wrap{-webkit-touch-callout:none}` + `#editor-view{user-select:none}`（`input/textarea/select` 显式豁免；名册弹窗在 #modal-root，不受影响） |

**F-02 touch-action 取值决策（round20 备注 §4/§9）**：在 `none` 与 `pan-x` 之间取 **`none`**。理由：`pan-x` 让横向主导轴的触摸手势继续归浏览器滚动接管——块边缘把手拖拽恰是横拖，起手即便命中 10px 容差也会在滚动接管判定下被 pointercancel，等于触摸拖块依旧不可用；`none` 让 scrub/块拖/选择在触摸端从根上可用。代价：`#tl-scroll` 的触摸横滚让位（滚轮、ctrl+滚轮缩放、＋/−/⤢ 按钮、tap 选块定位全部保留；自适应宽度下溢出本就少见，缩放后可用按钮/滚轮回览）。「编辑操作可用性 > 触摸横滚便利」为裁定依据。

*round20 生成：2026-09-10；HEAD 793c5d5 + 本轮修复（未 commit）；修复前基线=本文件 §1–§14 与 out/round19-ux/。*

---

## 14. 附：探针清单与证据索引

| 探针（wuzhen-e2e-lab/） | 覆盖 | 证据（out/round19-ux/） |
|---|---|---|
| `conflict-lib.mjs` | 共享库：环境/仪器/CDP 触摸与滚轮原语 | — |
| `conflict-01-style-audit.mjs` | touch-action/user-select/overscroll/viewport/滚动容器（桌面+375 移动双视口） | c01-style-audit.json |
| `conflict-02-touch-stage.mjs` | 舞台触摸：平移/长按框选/捏合/**pointercancel 脏指针** | c02-touch-stage.json + c02-t*.png |
| `conflict-02b-doubletap.mjs` | 双击浮窗坐标修正复跑 + tap→click 延迟 | c02b-doubletap.json |
| `conflict-03-timeline.mjs` | 时间轴触摸接管/**drag 卡死/hover 误改**/鼠标基线 | c03-timeline.json、c03-t4-mouse-baseline.json + c03-*.png |
| `conflict-04-keyboard.mjs` | 键盘矩阵（Space/方向键/数字/守卫/撤销/Alt） | c04-keyboard.json |
| `conflict-05-wheel.mjs` | 滚轮/触控板（ctrl+wheel/Shift 换轴/passive/历史导航） | c05-wheel.json |
| `conflict-06-contextmenu.mjs` | 右键防御面盘点（6 目标 + 库卡片复制） | c06-contextmenu.json |
| `conflict-07-selection.mjs` | 拖拽选择泄露/双击选择/draggable 触屏 | c07-selection.json |
| `conflict-08-overscroll-edge.mjs` | overscroll/PTR 静态条件/历史栈/弹窗滚动/真机清单 | c08-overscroll-edge.json |
| `conflict-09-webkit.mjs` | WebKit 交叉验证（样式/键盘/右键/滚轮/脏指针/时间轴卡死/双击） | c09-webkit.json |

*报告生成：round19（2026-09-10）；HEAD 793c5d5；本轮零应用代码改动。*
