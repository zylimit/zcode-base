# 工作流细则

宪法指针文件：进入任一阶段前必读本文件。来源：cc-base `dev-workflow-details` + kimi-base `workflow.md` 精炼。

## 全流程总览

```
需求收集 → 【Spec 签字闸】→ 架构设计（可选，M/L 档必做）→ DFX 五性定档 →
【架构/DFX 签字闸】→ 开发计划（plan 自检）→ 项目开发（per-Task 闭环）→
【Phase 完成闸】→ 发布（发布三验）→ 本地运行验证 → 内容修订（按需）
```

每个阶段：触发条件 → 执行（调对应 Skill）→ 完成话术 → 签字闸（如有）。

## 签字闸（批的是「当前这版内容」）

- **Spec 签字闸**：Product-Spec.md 完成后必须用户点头才进架构/计划；内容有任何变更须重新请批。
- **架构/DFX 签字闸**：Architecture-Design.md + DFX-Spec.md 定稿后用户确认（M/L 档强制，S 档可合并到 Spec 闸）。
- **Phase 完成闸**：每 Phase 收尾跑 `/zbase:verify` + `quality verify` 全绿 + 用户确认后进下一 Phase。
- **发布闸**：发布前发布三验（见 release-builder）+ 用户明确批准。

## 审批三档

| 档 | 行为 | 范围 |
|---|---|---|
| **LOW** 不问直接跑 | 写文档/progress/feedback、加测试、P2/P3 顺手修复、只读探索、本地构建与测试 | — |
| **MEDIUM** 一句话预告后继续 | 新增/修改框架非家底文件、派长耗时子代理（预告静默+预计时长）、超 5 文件的批量重构、依赖安装 | 不停等 |
| **HIGH** 必停等明确批准 | 删除/停用/重写任何现有 hook/skill/宪法规则（存量资产铁律）、git push/发版/部署、不可逆或远端写操作、密钥/隐私相关、Spec 签字门 | — |

模糊落档按高一档处理；用户当前指令可显式豁免单次（安全护栏除外）。

## per-Task 闭环（开发默认循环）

1. **恢复与圈定**：查 Git 状态/diff/active task；大仓先 `catalog lint` + `impact`。
2. **建立任务**：复杂/跨模块/中高风险先 `task start`（envelope+risk+ownedPaths）；`context pack` 取预算化上下文。
3. **实现**：派 implementer（fresh），只改 Scope，遵循 Existing Pattern。
4. **受影响验证**：按 Task 的 Verification 跑检查 → `receipt write` 落账本（四态）。
5. **审查**：派 code-reviewer（Stage 0 静态 → Stage 1 Spec 合规 → Stage 2 代码质量）；任一失败 → bug-fixer 修 → 从 Stage 0 重审。
6. **收口**：三 Stage 全过 + `receipt verify` 通过 + `task finish`（quality verify 反证门拦截未覆盖属性）→ commit + 三文件同步。

单 Task 预期 >60 分钟 = 分解不合理，回拆。

## red-locks-the-bug（铁律）

review/测试发现缺陷：修复前先派 tester 补**锁定该缺陷的失败测试**→ 主 Agent 亲验测试为红 → implementer 修绿 → code-reviewer 复审。没红过的测试不算锁定。

## 需求变更纪律

- 成对更新 `Product-Spec.md` + `Product-Spec-CHANGELOG.md`（只改一个不算完成）。
- 变更影响架构 → 同步评估 ADR 是否需要新增/修订；影响五性档位 → 同步更新 module-catalog attributes + DFX-Spec。
- 交回当前 Task 记录变更来源，避免静默范围漂移。

## 完成话术规范

- 报告只陈述可验证事实：做了什么、跑了什么命令、exit code、还差什么。
- 禁用词：「应该没问题」「大概好了」「看起来通过了」「基本完成」。
- 未验证就说未验证，附原因与下一步。

## 三文件同步

见宪法「项目事实与恢复」。Enforced-by: sync-check（pre-commit+Stop 双缝——`node .zcode/zbase.mjs sync-check`，代码变更而 progress.md 未同步 / Spec 与 CHANGELOG 未成对 → error exit 1，Stop 事件在 recorder 写入窗口外同样拦停）。收尾自检：三文件都同步了吗？决策有没有混进 Done 叙述？——答不齐不算完成。
