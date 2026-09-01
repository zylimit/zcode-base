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
3. 每个 Task 写：内容/受影响模块/风险档/Verification（证明命令 + 期望输出）。
4. 大仓项目：Task 标注受影响模块（`node .zcode/zbase.mjs impact` 的反向闭包结果）；单 writer 资产（共享契约/schema/迁移/lockfile）不并行。
5. 计划自检（出口闸）：
   - [ ] 每 Task 有 Verification
   - [ ] 依赖顺序正确（被依赖方先做）
   - [ ] 里程碑有判据与回滚点
   - [ ] 五性 critical/high 相关 Task 有对应验证安排
6. 更新 progress.md（计划决策进 Decisions）。

## 纪律

- Task 粒度以「能独立验收」为准，不按代码行数/文件数机械切。
- 计划赶不上变化是常态：变更时成对更新 DEV-PLAN + progress，并评估是否影响 Spec。

## 回执

DEV-PLAN.md + Phase/Task 统计 + 单 writer 资产清单 + 计划自检结果。
