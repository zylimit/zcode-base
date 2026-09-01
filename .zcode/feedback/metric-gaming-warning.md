---
id: metric-gaming-warning
occurrences: 1
graduated: false
---

# metric-gaming-warning

- 日期: 2026-09-01
- 来源: cc-base（progress Decisions 2026-06-15：撤回 agent 定义量化成功指标）
- 信号: 给 agent/角色定义加量化成功指标（diff 行数/覆盖率/完成票数）
- occurrence: 1

## 现象（事故语境）

cc 曾把量化成功指标（diff 行数、覆盖率）钉进 agent 定义，后主动撤回——specification overfitting（arxiv 2403.08425）：指标钉进目标后，执行方会喂指标而不是完成真实任务。

## 根因

把「可度量」误当「可管理」：被博弈的指标比没有指标更糟——它给劣质产出盖了合格的章。

## 规则（可执行表述）

不为 agent/角色定义设量化成功指标；成功判据用定性 DoD（可验收的行为描述+客观证据句柄）。与 `mem:spec-overfitting-quantitative` 同源（那条管回执/验收面的应用）。

## 执法建议

spec-lint 的度量要求只针对 NFR 需求（性能预算类），不外溢到角色定义；evolution-engine 评估新规则时过一遍「这条会不会被博弈」。
