---
name: progress-recorder
description: 工作单元收尾（派单收尾/发版/做出取舍/需求变更）时使用：即时同步 progress.md 项目记忆。
---

# progress-recorder：项目记忆

## 三文件同步铁律

- 决策/约束/完成**即时**写 `progress.md`；不许攒批、不许事后补。
- 需求变更**成对**更新 `Product-Spec.md` + `Product-Spec-CHANGELOG.md`（只改一个不算完成）。
- 文件存在即维护、始终一致；不存在的不强造。

## progress.md 结构

```markdown
# progress

## Pinned（长期约束）
- <不可违反的边界/环境事实>

## Decisions（决策流水：选型/取舍/否决/撤回）
- YYYY-MM-DD <决策> —— <理由>（不许埋进 Done 叙述充数）

## Done（完成流水）
- YYYY-MM-DD <事项> —— <证据句柄（receipt seq/文件）>

## Next（下一步）
- <待办 + 前置条件>

## Open Issues（未决）
- <问题 + 责任人/等待条件>
```

## 写入规范

- 条目风格贴合现有内容（无缝，禁元叙事）。
- 每个工作单元当下即写：派单收尾 / 发版 / 做出取舍 / 需求变更。
- 收尾自检：三文件都同步了吗？决策有没有混进 Done？——答不齐不算完成。

## 与恢复的关系

SessionStart hook 注入的恢复上下文来自本文件尾部——写得越即时，恢复越准。
