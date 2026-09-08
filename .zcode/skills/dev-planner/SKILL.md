---
name: dev-planner
description: Spec 与架构/DFX 已签字，需要生成或修订 DEV-PLAN.md（阶段/Task 拆分/验证定义/里程碑）时使用。
---

# dev-planner：开发计划

## 目标

产出可执行的 DEV-PLAN.md：Phase → Task，每个 Task 一个可独立验收的切片。

## 流程

1. 前置检查：Product-Spec 已签字；M/L 档有 Architecture-Design + DFX-Spec。
2. 拆分：按模块边界与依赖顺序拆 Phase；Phase 内拆 Task。**单 Task 预期 >60 分钟 = 分解不合理，回拆。**
3. **排序 = 价值交付与关键未知优先，不只依赖正序**：最先做能验证关键未知（OQ/技术风险）或最早交付可感业务价值的最小切片；依赖正序只在同价值档内作 tie-break——纯依赖正序会把「理解错误最后才暴露」埋进时间表。反例：先排依赖正序会把「验证不了价值」的 Task 排最前——三个 Phase 后才发现方向错，返工成本最大。
4. 每个 Task 写：内容/受影响模块/风险档/Verification（证明命令 + 期望输出）/**价值/未知锚点**（交付什么业务价值、依赖哪个未决项——从 Spec 业务上下文与 DEV-PLAN「价值/未知」列来，它是派单信封 `Business:` 字段的直接来源，没锚点的 Task 不进计划）。
5. 大仓项目：Task 标注受影响模块（`node .zcode/zbase.mjs impact` 的反向闭包结果）；单 writer 资产（共享契约/schema/迁移/lockfile）不并行。
6. 计划自检（出口闸）：
   - [ ] 每 Task 有 Verification
   - [ ] 每 Task 有「价值/未知」锚点
   - [ ] Phase 排序按价值/关键未知优先（不只依赖正序）
   - [ ] 依赖顺序正确（被依赖方先做）
   - [ ] 里程碑有判据与回滚点
   - [ ] 五性 critical/high 相关 Task 有对应验证安排
7. 更新 progress.md（计划决策进 Decisions）。

## 纪律

- Task 粒度以「能独立验收」为准，不按代码行数/文件数机械切。
- 计划赶不上变化是常态：变更时成对更新 DEV-PLAN + progress，并评估是否影响 Spec。

## 回执

DEV-PLAN.md + Phase/Task 统计 + 单 writer 资产清单 + 计划自检结果。
