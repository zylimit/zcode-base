---
name: code-review
description: 代码/diff/PR 需要审查，或 per-Task 闭环进入审查环节时使用。三阶段审查：静态闸→Spec 合规→代码质量。
---

# code-review：三阶段审查

## 流程

派 code-reviewer（fresh 实例，异于实现者）按序执行；**任一 Stage 失败 → 修复后从 Stage 0 重审**。

### Stage 0 — 静态闸

- lint/format 零新增告警；无调试残留；无密钥/PII 硬编码。
- 快速廉价：先过这关再谈别的。

### Stage 1 — Spec 合规

- 实现与 Spec/Task 条目逐条对照（列对照表）。
- Out of Scope 未越界；错误/边界/空状态路径已处理。

### Stage 2 — 代码质量

- 遵循 Existing Pattern；无空 catch/静默吞错/无调用方兼容层。
- 公共接口稳定性：消费者已核对。
- 文件拆分由职责/耦合/可测试性决定，不按机械行数。

## Findings 分级与处置

| 级别 | 处置 |
|---|---|
| P1（阻断） | 必修；缺陷走 red-locks（先锁定失败测试再修） |
| P2（应修） | 本轮修；走 review→fix 闭环 |
| P3（可选） | 顺手修或记录；不预先征询 |

## 有界对抗

- review→fix 封顶 **2 轮**；到顶转 deferred（结构化记录：问题/严重度/为何不修/负责人），不阻其它线。
- 高价值变更升级 red-blue-review（对抗审查）。

## 回执

Review-Receipt（`harness/templates/Review-Receipt-Template.md`）：三 Stage 结论 + Findings 表 + 轮次 + 裁定（ACCEPT / FIX_REQUIRED / NEEDS_MORE_EVIDENCE）。
