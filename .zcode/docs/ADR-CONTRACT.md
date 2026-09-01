# ADR 文件契约

一个决策一个文件：`.zcode/docs/adr/ADR-<NNNN>-<slug>.md`（号码 append-only 永不复用；被取代的标 `Superseded by ADR-NNNN` 并保留）。格式对照 `0006-user-scope-hooks-registration.md`：背景 → 决策 → 备选方案与拒绝理由 → 后果 → 执法方式，头部四行元数据（标题/状态/日期/决策人）。

## Enforced-by 行

Status 非 retired 的 ADR 必须带 `Enforced-by:` 行，值从**已知执法点清单**取，多个用半角逗号分隔：

| 类 | 可用值（`node .zcode/zbase.mjs adr check` 实际解析集） |
|---|---|
| 架构执法 | `catalog lint` / `arch check` / `arch baseline` / `arch trend` |
| 质量与接线执法 | `fitness` / `quality verify` |
| 账本与证据执法 | `receipt verify` / `risk scan` / `gate-audit` |
| 环境与自证 | `selftest` / `doctor` / `impact`（`adr check` 自身也合法） |

`node .zcode/zbase.mjs adr check` 对清单外的引用报错（exit 非 0）。**幽灵引用比没有更糟**：它读起来像被执法，实际什么都没执。

诚实边界（与 dsh 形态的差异）：

- 本仓 adr check 校验**已写下的** Enforced-by 引用是否真实，不强制行存在——缺行由 ADR 模板与 review 把关；决策确无机器执法点时，不造幽灵行，把人工审批写进正文「执法方式」段并在 progress.md Decisions 留痕（`manual:<谁>` 形态本仓引擎不解析，勿写）。
- 清单是显式枚举（lib/graph.mjs `adrCheck`），新增执法点需同步扩清单——这与 rules-audit 的动态推导集（从 zbase case/matrix/fitness 自动收集）是两种设计，各有边界。

## Retired 状态

被取代/废弃/拒绝/撤回的 ADR 在头部标注（Superseded / Deprecated / Rejected / Withdrawn / Retired）并保留原文——决策史只增不改。
