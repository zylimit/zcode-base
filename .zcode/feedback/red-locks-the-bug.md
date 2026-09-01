---
id: red-locks-the-bug
occurrences: 3
graduated: false
---

# red-locks-the-bug

- 日期: 2026-08-13
- 来源: 家族脚手架跨仓实践
- 信号: review/测试发现缺陷，直接动手改实现
- occurrence: 3（毕业：已进 rules/workflow.md）

## 现象

审查发现缺陷 → 直接修 → 自称修好 → 无测试锁定 → 同类缺陷回归时无法发现（或测试根本没写）。

## 根因

修复没有失败测试锚点，「修好」不可证；回归防护缺失。

## 规则

review/测试发现缺陷：修复前先派 tester 补**锁定该缺陷的失败测试** → 主 Agent 亲验测试为红 → implementer 修绿 → code-reviewer 复审。没红过的测试不算锁定。

## 执法建议

已进规则（rules/workflow.md per-Task 闭环 + bug-fixer skill）；高发团队可加 hook 检查（缺陷修复 commit 前存在新增/修改的测试文件）。
