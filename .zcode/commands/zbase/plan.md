---
description: 进入计划阶段：生成/修订 DEV-PLAN.md（Phase/Task 拆分与验证定义）。
argument-hint: "[范围或约束]"
---

# /zbase:plan

1. 前置检查：Product-Spec 已签字；M/L 档有架构与 DFX。
2. 调用 dev-planner skill，范围：$ARGUMENTS
3. 产出 DEV-PLAN.md 后执行计划自检（每 Task 有 Verification / 依赖顺序 / 单 writer 资产不并行 / >60min 拆分）并汇报。
