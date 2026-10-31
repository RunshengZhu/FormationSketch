# 会话轮转 Runbook（formation-studio / wuzhen）

> 目标：经验放文件里，上下文保持轻，会话随时可换。
> 背景：wuzhen 主会话曾因体量失控（上下文 96 万 token）触发收尾失败循环
> （129 次 schema 校验失败，详见 CLAUDE.md「回合结束纪律」）。

## 什么时候轮转

满足任一条即启动（巡检任务每 30 分钟检查一次并会报告）：

| 信号 | 阈值 | 来源 |
|------|------|------|
| 上下文膨胀 NOTE | 最近一步 tokens.total > 70 万 | loop-watch 巡检输出 |
| 一个里程碑收口 | 一批 build 交付验收完成 | 自查 |
| 会话响应明显变钝 | 单步耗时/重试显著上升 | 体感 |
| 强制压缩发生 | 会话出现过 compaction | 说明已撞线，尽快收口 |

## 轮转四步（约 10 分钟）

**① 蒸馏**——把旧会话历史压成交接草稿（任意会话/新会话里执行均可）：

```bash
python3 ~/.zcode/scripts/session-kit/session_distill.py \
  --session sess_030986dd \
  --out docs/PROJECT_STATE.draft.md
```

**② 校订**——让旧会话（或任一新会话）把 `docs/PROJECT_STATE.draft.md` 校订成正式
`docs/PROJECT_STATE.md`：删掉自动生成声明行，核对里程碑时间线，把「下一步」写成
可执行的 1~3 条，补上机械提炼看不出来的决策根因。校订后旧会话即可弃。

**③ 归档**——在 ZCode 界面归档旧会话（数据保留在磁盘，仅从侧边栏隐藏）。

**④ 新会话冷启动**——⚠️ **必须在 ZCode 界面里新建会话**：无头 CLI（`zcode -p`）创建的会话
即使加 `--surface desktop` 也不会进入桌面侧边栏，数据库里的归档标记侧边栏同样不读——
新建、归档这两步只能在界面完成（2026-10-04 实测）。界面建好空会话后，粘入开场白模板：

```
继续 formation-studio（wuzhen）开发。
先读：仓库 CLAUDE.md（硬规矩）、README.md（架构）、docs/PROJECT_STATE.md（当前状态与下一步）。
读完后给出你对"下一步"的执行方案，确认后再动手。
遵守 CLAUDE.md「回合结束纪律」：收尾一律纯文字，禁止工具标记。
```

## 为什么这样设计

- **静态知识**（架构/功能/运行方式）→ README.md，长期稳定，不用反复进上下文。
- **硬规矩**（收尾纪律/验收流程）→ CLAUDE.md，每个新会话自动加载。
- **动态状态**（最近交付/下一步/已知坑）→ docs/PROJECT_STATE.md，每次轮转更新。
  可随时用 session_distill.py 从会话库重新蒸馏，不怕丢。
- 上下文维持在低位的收益：每步输入成本降 1~2 个数量级；模型对参数细节更敏锐，
  收尾循环这类病态不再被诱发。

## 相关工具

- 蒸馏器：`~/.zcode/scripts/session-kit/session_distill.py`（--list 可选会话）
- 巡检器：`~/.zcode/scripts/loop-watch/loop_watch.py`（每 30 分钟自动跑，
  >70 万 token 会以 NOTE 提示轮转）
