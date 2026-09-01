---
id: multi-repo-commit-isolation
occurrences: 1
graduated: false
---

# multi-repo-commit-isolation

- 日期: 2026-09-01
- 来源: codex-base（feedback: multi-repo-commit-isolation）
- 信号: 多个仓库要 add/commit/push 时写耦合脚本一次搞定
- occurrence: 1

## 现象（事故语境）

多仓变更用耦合脚本批量 add/commit/push：一个仓成功、另一个失败——留下「半成功」烂局，回滚与补做都要人工拆尸检。

## 根因

把「多个独立验收单元」当成一个事务；仓库之间没有原子性可言。

## 规则（可执行表述）

多仓提交必须逐仓独立执行、各自验收：每仓独立 add→commit→push→核验（exit code + 远端状态），任何一仓失败不自动带崩其他仓的补做节奏。

## 执法建议

流程纪律（branch-finisher/release-builder 收尾清单项）；耦合式批量提交脚本本身就该被 review 拦下。
