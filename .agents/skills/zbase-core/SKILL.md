---
name: zbase-core
description: 会话开始、恢复中断工作、查看项目状态或不确定从哪一步继续时使用。装载治理状态（活跃任务/fast/degraded）并路由到正确的工作流入口。
---

# zbase-core：会话路由与恢复

## 目标

任何新会话的第一入口：恢复上下文 → 意图路由 → 进入对应 Skill。不直接做业务工作。

## 恢复步骤

1. 读 `progress.md` 尾部（决策/Done/Pinned/Next）。
2. 跑 `node runtime/zbase.mjs task status`：有活跃任务 → 检查 `baselineDrift`（true = 旧证据已腐化，受影响验证需重跑）。
3. 跑 `node runtime/zbase.mjs fast status`：Fast 生效中 → 提醒用户到期时间，安全护栏不受影响。
4. `node runtime/zbase.mjs risk scan`：有 critical/high 发现 → 先处理再开工。

## 意图路由

| 用户意图 | 路由 |
|---|---|
| 新产品/新需求/模糊想法 | product-spec-builder |
| 谈架构/分层/模块划分 | arch-designer |
| 五性/安全/隐私/可靠性指标 | dfx-designer |
| 排期/任务拆分 | dev-planner |
| 开始/继续实现 Phase/Task | dev-builder |
| 报障/修复 | bug-fixer |
| 审查代码/diff | code-review |
| 写测试/补测试 | test-builder |
| 发布/打包/部署 | release-builder |
| 合并/收尾分支 | branch-finisher |
| 高风险变更复核 | red-blue-review |
| 大仓导航/影响分析 | large-repo-harness |
| 给出修正/反馈 | feedback-writer |
| 复盘/沉淀规则 | evolution-engine |
| 1% 可能适用某 Skill | 先调那个 Skill（宪法：1% 即调） |

## 会话收尾

- 三文件同步（progress.md 必写；Spec 变更成对更新）。
- 活跃任务若有未验证改动 → 跑受影响验证 + `receipt write`，否则 Stop 门会拦截。

## 边界

- 不确定路由时问用户，不猜。
- 本 Skill 不代替任何业务 Skill；路由后立即交棒。
