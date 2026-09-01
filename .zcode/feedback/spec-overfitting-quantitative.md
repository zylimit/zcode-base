---
id: spec-overfitting-quantitative
occurrences: 1
graduated: false
---

# spec-overfitting-quantitative

- 日期: 2026-09-01
- 来源: cc-base（progress Decisions 2026-06-15 的回执/验收面应用）
- 信号: 回执/验收标准钉死数字指标（必须 N 条/至少 X 行/恰好 Y 项）
- occurrence: 1

## 现象（事故语境）

cc 量化指标撤回决策的应用面：把回执/验收指标钉死为数字（specification overfitting）——执行方凑够数字即算完成，真实质量被牺牲；数字达标与任务做好之间没有必然通路。

## 根因

数字可审计≠数字承载价值；钉死数字会把优化目标从「任务质量」偷换成「指标读数」。

## 规则（可执行表述）

回执/验收标准用定性 DoD（可验收的行为描述+客观证据句柄：命令/输出/文件）；数字只用于真有物理意义的 NFR（性能预算/超时阈值），且须写明测法。

## 执法建议

与 `mem:metric-gaming-warning` 同源（cc 同一决策的两面：那条管 agent 定义撤回，本条管回执/验收口径）；DEV-PLAN 的 Verification 字段审查时对「凑数型指标」打回。
