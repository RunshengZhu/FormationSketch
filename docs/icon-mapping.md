# 图标映射表（UI emoji → 内联 SVG 图标 · 决策⑤）

> Lane C（图标系统线）· 2026-09-24 · 基线 a43dd1b（并行期快照：Lane A 同期在改 index.html/main.js/timeline.js，行号会漂移，故下表用「锚点」而非行号定位）。
> 方案：**线性单色内联 SVG**（24×24 viewBox、`stroke="currentColor"` 与主题色联动、圆角线帽），尺寸 **16/20 两档**，零依赖（无 symbol/defs 注入、无外部资源）。实现：`js/icons.js`（单一事实源）+ `js/ui.js` 内嵌零漂移拷贝（原因见下「打包接线」）。

## 一、全仓 UI emoji 清单统计

扫描范围 `index.html + js/*.js + css/*.css`（符号区 U+2190–2BFF、U+FE0F、U+1F000–1FAFF）：

| 组 | 定义 | 种类 | 出现次数 | 说明 |
|---|---|---|---|---|
| **A 组** | 语义 UI 图标字符（按钮/控件/呈示位，彩色 emoji 呈现会破坏界面） | 30 | 100 | 本表第二节，逐个给 SVG 替换 |
| **B 组** | 文本/装饰符号（→ ≥ ≤ − ▾ ▸ ↔ ≠ ①…⑥ ∩ ∞ ⋯ ＋ 等），text 呈现单色无违和 | ~20 | 241 | **保留**，不替换（绝大头是 `→` 出现在注释/日志/文案里） |
| 保留 | 💃 空态插画（index.html `#library-empty .lib-empty-icon`） | 1 | 1 | 决策⑤明示保留 |

归属文件分布（A+B 合计，并行期快照）：main.js 88 · manual.js 50 · timeline.js 38 · index.html 35 · audio-clips.js 24 · model.js 23 · player.js 14 · gesture.js 13 · ui.js 10 · manual-assets.js 9 · css 9 · stage.js 8 · audio.js 7 · store.js 6 · choreo-extra.js 6 · shapes.js 1。
（model.js/audio-clips.js 的命中全部是 → 等文本箭头=纯 B 组；css 命中全部在注释；tests/scripts 里的 ~540 处 → 是断言/日志文案，非 UI，不在本表。）

## 二、A 组映射表（emoji → SVG 图标名）

「处理方」：**C=本轮已替换**（js/ui.js、js/manual.js）；**A=Lane A 汇合处理**（index.html/main.js/timeline.js，图标已备好、替换即可）；§=canvas `fillText` 呈示（SVG 不适用，建议 Lane A 改 canvas 路径绘制或纯文字，见遗留）。

| emoji | 图标名 | 语义 | 出现位置（锚点） | 处理方 |
|---|---|---|---|---|
| ✂ | `razor` | 拆开/自动切 | index.html `#btn-auto-split`；main.js 单元浮窗 `untie`「拆开」/「取消合并」（page-r/page-matrix 仪器断言文本 `✂ 拆开`，改动须同步驱动）；manual-assets 截图标注 | A |
| ⚑ | `flag` | 打点（音乐标记） | index.html `#btn-tag-drop` | A |
| 📚 | `library` | 媒体库 | index.html `#btn-media-library`、`#tl-empty-library`；timeline.js canvas 空态文案 §；ui.js 弹窗标题 | C(ui.js)+A |
| 📖 | `book` | 说明书 | index.html `#btn-manual-open`、`.mtab[data-tab=manual]`（**tests/manual.test.js 钉死 `>📖 说明书</button>`，替换须同步改该断言**）、overlay 标题；main.js 右面板页签注释 | A |
| 🎵 | `music` | 音乐与节拍 | index.html `#audio-disc summary`；ui.js 资产行/卡片音乐名 | C(ui.js)+A |
| 🗑 | `trash` | 删除 | ui.js 库卡片 `#library-grid .lc-del` | C |
| ✏ | `pencil` | 编辑锁 | index.html `#btn-edit-mode`；manual.js 正文 | C(manual.js)+A |
| ☰ | `menu` | 多选 | index.html `#btn-multi`；manual.js 手势表 | C(manual.js)+A |
| ⇋ | `flip-h` | 水平镜像 | index.html `#btn-mirror-h`；manual.js 正文 | C(manual.js)+A |
| ⇅ | `flip-v` | 垂直镜像 | index.html `#btn-mirror-v`；manual.js 正文 | C(manual.js)+A |
| ⇤ | `align-left` | 对齐到播放头 | index.html `#btn-align-playhead`；manual.js 正文 | C(manual.js)+A |
| ⏮ / ⏭ | `skip-back` / `skip-fwd` | 上/下一队形 | index.html `#pb-prev/#pb-next`；manual.js 正文 | C(manual.js)+A |
| ⏸ / ▶ | `pause` / `play` | 播放/暂停态 | index.html `#pb-play`；main.js 播放态 `textContent` 切换（播放/数拍/结束多分支） | A |
| ⏹ | `stop` | 停止 | index.html `#pb-stop` | A |
| ✕ | `close` | 关闭 | ui.js 库卡片菜单 `.um-cancel`（已加 aria-label=关闭）；main.js 单元浮窗取消钮（page-r/page-matrix 断言 `['删除','✕']` 构成，须同步）；index.html `#btn-manual-close`「完成 ✕」 | C(ui.js)+A |
| ↺ / ↻ | `undo` / `redo` | 撤销/重做 | index.html `#btn-undo/#btn-redo`；manual.js 正文 | C(manual.js)+A |
| ⟳ | `rotate` | 整体旋转 | index.html `.rot-ctl` 前缀；manual.js 正文 | C(manual.js)+A |
| ⌃ / ⌄ | `chevron-up` / `chevron-down` | 收起/展开音频轨 | timeline.js `#tl-audio-toggle` 文本切换；main.js「⌃ 收起」 | A |
| ↑ / ↓ | `arrow-up` / `arrow-down` | 队形上/下移 | main.js 队形列表「↑ 上移 / ↓ 下移」按钮 | A |
| ☀ / 🌙（含 ️VS16） | `sun` / `moon` | 主题切换 | index.html `#btn-theme`；main.js `btn-theme` 文本切换（☀️ 带 VS16，替换后应弃用 VS16） | A |
| 🔊 / 🔇 | `volume` / `mute` | 音轨音量/静音 | main.js 音轨 `muteBtn` 文本切换 | A |
| ⇄ | `swap` | 尺规刻度 拍⇄秒 等互换语义 | index.html `#tl-scale-toggle` title；manual.js | C(manual.js 引用)+A |
| ↷ | （canvas 呈示） | 时间轴「过渡 N 拍」标记 | timeline.js canvas `fillText('↷'+…)` § | A（canvas 画线或保留文本箭头） |
| 💃 | （保留） | 空态插画 | index.html `.lib-empty-icon` | 保留 |

## 三、本轮已落地的替换（Lane C 职权内）

| 文件 | 位置（锚点） | 替换前 | 替换后 |
|---|---|---|---|
| js/ui.js | `showLibCardMenu` 取消钮 | 文本 `✕` | `iconEl('close')` + `aria-label/title=关闭`（DOM 断言：svg 在位、无 ✕ 残留） |
| js/ui.js | `showMediaLibraryModal` 标题/活动资产行 | `📚 媒体库…` / `🎵 name` | `iconEl('library',20)` / `iconEl('music')`（DOM 断言通过） |
| js/ui.js | `renderLibrary` 卡片音乐名/删除钮 | `🎵 name` / `🗑` | `iconEl('music')` / `iconEl('trash')` + aria-label（DOM 断言通过） |
| js/manual.js | 正文 12 处入口引用（✂✏☰⇋⇅⇤⏮⏭▶↺↻⟳🎵） | emoji 字符 | 「`ic('razor')`+文字」内联 SVG；渲染输出含 17 个 `svg.ic`、A 组字符零残留（DOM 断言通过） |
| js/manual.js | `LEGACY-CITE` 引用区（注释） | — | ~~保留五条测试钉死的原文~~ 已退役（2026-09-24 清理轮）：互锁的 manual.test.js 原文断言与 icons.test.js 互锁测试同轮移除、引用区删除（历史原文查 git 历史）；同轮 tests/page-matrix.js 已 git rm（v1 仪器，round14-v3 起废弃，历史在 git） |

**验证**：`node --test tests/icons.test.js`（结构/齐全性/无回流/零漂移/接线约束 6 测）+ tests/manual.test.js 10/10 + tests/lib-menu-esc.test.js、tests/ux-conflict-fixes.test.js 16/16 + `node scripts/build-single.mjs` 冒烟 + 上述 DOM 输出断言。说明书可视提示已加一行「截图摄于图标化改造前，以新截图为准」（汇合重拍后移除）。

## 四、图标清单（js/icons.js，35 个）

播放条：`play` `pause` `stop` `skip-back` `skip-fwd`；编辑：`pencil` `razor` `trash` `close` `undo` `redo` `rotate` `menu` `plus` `minus`；箭头/撑条：`arrow-up` `arrow-down` `arrow-left` `arrow-right` `chevron-up` `chevron-down` `grip-h`；变换/对齐：`flip-h` `flip-v` `swap` `align-left` `magnet`；音乐/媒体/标记：`flag` `music` `library` `book` `volume` `mute`；主题：`sun` `moon`。

API：`iconHtml(name, size=16, label='')` → SVG 字符串（模板串/innerHTML 用）；`iconEl(name, size, label)` → SVG 元素（h() 子节点用；无 DOM 环境返回兜底 span 不抛错）。`label` 给出时 `role="img"+aria-label`，否则 `aria-hidden="true"`；未知名返回空串不裂图；样式全部内联（width/height/vertical-align −2px/−3px 基线对齐），**不改 css/style.css**。

## 五、打包接线约束与汇合点动作（重要）

`scripts/build-single.mjs` 的 `ORDER` 常量固定且**不含 `icons`**，而 app 模块静态 import 未打包模块会让单文件包运行时 `FS.icons` 未定义必炸。故本轮采用：**js/icons.js = 单一事实源；js/ui.js 内嵌 `ICONS-BEGIN/END` 哨兵块逐字拷贝**（tests/icons.test.js 强制零漂移 + 断言「无人静态 import icons.js」）。汇合点接入步骤：

1. `scripts/build-single.mjs` 的 `ORDER` 增补 `'icons'`（置于 `'ui'` 之前）；
2. js/ui.js 删除哨兵块，改回 `import { iconHtml, iconEl } from './icons.js'`；
3. Lane A 完成 index.html/main.js/timeline.js/gesture.js 的 A 组替换（本表「处理方=A」各条），同步受影响仪器（tests/page-r.js、tests/page-matrix.js 的 `✂ 拆开`/`✕` 文本断言）与 tests/manual.test.js 的 `📖 说明书`/原文断言（届时 manual.js 的 LEGACY-CITE 区与本文件第三节对应行一并退役）；〔收口注记 2026-09-24：page-matrix.js 已删除、LEGACY-CITE 区与原文/互锁断言已退役〕
4. 重拍说明书九图（round31 资产，**本轮不重拍**：截图与 js/manual-assets.js 字幕含历史 emoji，页面已挂「以新截图为准」提示）→ 更新 scripts/manual-assets.json → `node scripts/gen-manual-assets.mjs` 重新生成。

> **汇合轮（2026-09-26）执行完毕**，上述 1–4 全部落地，本节历史口径留档：
> - ①②：ORDER 已含 `'icons'`（置于全部取用方 'timeline'/'ui' 之前——timeline.js 的 tl-audio-toggle 图标也静态取用；另 bundler 修复：「export { … }」转发行由整行剥除改为原位 `Object.assign(NS,…)` 展开，顺带修复了 FS.audioClips.MIN_CLIP_DUR 在单文件包中长期缺名的潜在缺陷）；ui.js 哨兵块删除、改 `import + re-export`（manual.js 从 ui.js 取 iconHtml 的链保持，icons.test.js 第 3/4 测同步改写为「接线形态/接线约束（翻转）」）。
> - ⑥（几何补偿）：SVG 图标与原 emoji 字形的行内度量差会在窄视口放大成布局位移——实测两处并已补偿：`#audio-disc summary .ic{margin-bottom:-1px}`（桌面 audio-disc 行高 -1px，舞台视口 scale 回到图标化前逐值）；`@media ≤1023.5px #block-ctl .spacer{display:none}`（375px 下 ⚑→SVG 钮宽 +7.6px 把 flex spacer 挤到第二行、block-ctl +10px 高 → 移动端舞台变矮，L2 几何基线依赖旧值）。验证：桌面+375 视口下 #topbar/#stage-wrap/#tl-scroll/#playbar/audio-disc/scale 与 HEAD（a43dd1b）逐值一致。
> - ③：index.html/main.js/timeline.js 的 A 组呈示位全部图标化（canvas 呈示 `📚`/`↷` 改纯文字；`#tl-scale-toggle` title 的 `⇄` 改文字「与…切换」；B 组与注释保留）。iconHtml 新增 `data-icon` 机器标识（E2E 仪器按它断言呈示态）。
> - 仪器改写对照（逐条）：
>
> | 仪器 · 原断言 | 改写后 |
> |---|---|
> | tests/page-r.js `menu()` btns 收集 `textContent.trim()` | `textContent.trim() \|\| aria-label` 兜底；R-01 `['✂ 拆开',…]+✕` → `['拆开','胶囊','单编号','删除','关闭']`；R-02/R-04 `['删除','✕']` → `['删除','关闭']` |
> | tests/page-matrix.js `menuBtn(tx)` 仅文本匹配 | 加 aria-label 兜底；5 处 `menuBtn('✕')` → `menuBtn('关闭')` |
> | tests/page-l1.js `playBtn()` 读 pb-play 文本 | 按 `svg[data-icon=play\|pause]` 翻译回 ▶/⏸（断言字面不变） |
> | tests/manual.test.js:74 `>📖 说明书</button>` | mtab 含 `svg[data-icon="book"]`+「说明书」regex |
> | lab run-userflows.mjs S3-05、run-userflows-p4/p5（pb-play 文本） | 同 page-l1 的 data-icon 翻译 |
> | lab run-userflows-p1.mjs TC-P1-15 库菜单 `['打开','复制','删除','✕']` | aria 兜底 + `['打开','复制','删除','关闭']` |
> | lab run-userflows-p2.mjs TC-P2-21/26/27（`✂ 拆开`、`删除,✕`、btns 收集） | aria 兜底；`'拆开'`、`'删除,关闭'` |
> | lab run-userflows-p3.mjs TC-P3-16 ↑↓（`textContent==='↑ 上移'`、`:has-text`） | `svg[data-icon=arrow-up\|arrow-down]` + `:has(svg[data-icon=…])` |
> | lab run-userflows-p6.mjs TC-P6-12 主题按钮 `🌙/☀️` | `data-icon=moon\|sun` 翻译回原字 |
>
> - ④：说明书九图已按 build-32-dualmode 重拍（manual-shots-v2，SHOT_URL=8137 合并树）→ manual-assets.json/js 再生；合计 206.9KB ≤224KB 预算、单张 ≤48KB；manual.js「以新截图为准」提示与文件头滞后注记移除；字幕（✂ 拆开/▶⏸）同步改纯文字口径；LEGACY-CITE 引用区按约保留（manual.test.js:34 原文断言未退役，与 icons.test.js 互锁继续有效）。

## 六、遗留与说明

- **归 Lane A 的 index/main/timeline emoji**：✂(btn-auto-split、untie) ⚑(btn-tag-drop) 📖(说明书页签×2+入口+overlay+main.js:634) 🎵(audio summary) 📚(btn-media-library、tl-empty-library) ⏮⏹⏭(playbar) ▶/⏸(pb-play 全部播放态分支) ⌃/⌄(tl-audio-toggle、收起) ⇤(btn-align-playhead) ✕(btn-manual-close、单元浮窗取消) ↺↻(btn-undo/redo) ⟳(rot-ctl) ↑↓(队形列表) ☀🌙(btn-theme，注意 ☀️ 含 VS16) 🔊🔇(muteBtn) ⇄(tl-scale-toggle 文案)。图标名全部就绪（本表第二节），替换即用 `iconHtml/iconEl`。
- **canvas 呈示**（timeline.js `↷` 过渡标记、`📚` 空态文案）：SVG 不适用；建议改 canvas 路径绘制或改纯文字（「媒体库」/「过渡 N 拍」），Lane A 定夺。
- **耦合仪器**：main.js 单元浮窗的 `✂ 拆开`/`✕` 被 tests/page-r.js R-02/R-04、tests/page-matrix.js M06 等按文本精确断言（main.js:81-82 注释自述「硬回归门禁优先」）；index.html `📖 说明书` 被 tests/manual.test.js:74 钉死。Lane A 替换时必须同轮改写这两处驱动/断言。
- **B 组不替换**：`→`（注释/日志/文案约 230 处）、`−/＋`（块时长步进钮，文本呈示单色且语义即加减号）、`▾/▸`（「导出 ▾」菜单指示）、`↔`（「老师 ↔ 老师」）、`≥/≤/≠/①…⑥`（注释）、`×`（offline-note 关闭，U+00D7 文本乘号）。
- 页签语义说明：⏺ 本表行号类信息为并行期快照，以锚点（元素 id / 函数名 / 断言原文）为准。
