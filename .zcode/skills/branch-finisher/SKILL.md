---
name: branch-finisher
description: 功能分支开发完成，需要收尾（最终验证/清理/合并准备）时使用。
---

# branch-finisher：分支收尾

## 流程

1. **状态盘点**：`git status` 干净（无未提交/未跟踪遗留）；branch 与 base 的 diff 全在预期 Scope 内。
2. **最终验证**：`/zbase:verify` 全绿 + `quality verify` 无 blocking + `receipt verify` 链完整。
3. **契约一致性**：module-catalog/ADR/MODULE-CAPSULE 与实际改动一致（新模块入册了吗？禁边变了吗？）。
4. **清理**：临时文件/调试代码/`.zbase-new` 旁路产物处置；死代码不留。
5. **三文件同步终检**：progress.md 完整记录本分支的决策与完成项；Spec 变更已成对更新。
6. **合并准备**：commit message（做了什么/为什么/证据）；rebase/merge 策略；等待用户批准合并（HIGH）。

## 纪律

- 发现 Scope 外改动 → 停下向用户报告，不悄悄打包带走。
- 合并冲突预演：先看 base 是否前进，冲突大就早同步。

## 回执

分支状态摘要 + 验证证据 + 契约一致性结论 + 合并就绪判定。
