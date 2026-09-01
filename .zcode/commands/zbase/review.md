---
description: 审查当前 diff 或指定范围（三阶段：静态闸→Spec 合规→代码质量）。
argument-hint: "[文件/commit 范围，默认当前 diff]"
---

# /zbase:review

1. 调用 code-review skill。
2. 审查范围：$ARGUMENTS（为空则取 `git status` + 当前 diff）。
3. 高价值变更（安全相关/核心链路/发版前）升级 red-blue-review。
4. 回传 Review-Receipt：三 Stage 结论 + Findings 表 + 裁定。
