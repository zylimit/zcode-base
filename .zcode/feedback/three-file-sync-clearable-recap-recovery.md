# three-file-sync-clearable-recap-recovery

- 日期: 2026-08-13
- 来源: 家族脚手架跨仓实践
- 信号: 新会话不知道上次做到哪；决策查无出处；需求改了只更 Spec 不更 CHANGELOG
- occurrence: 3（毕业：已进宪法「项目事实与恢复」）

## 现象

上下文压缩/新会话后丢失关键决策；需求变更只改一处文件导致 Spec 与 CHANGELOG 矛盾；恢复时凭记忆重做已完成工作。

## 根因

决策/完成/变更没有即时落盘，靠「回头补」；恢复没有权威事实源。

## 规则

决策/约束/完成即时写 progress.md（不攒批）；需求变更成对更新 Product-Spec.md + Product-Spec-CHANGELOG.md（只改一个不算完成）；新会话恢复读 progress.md 尾部 + task status。收尾自检：三文件都同步了吗？

## 执法建议

已进宪法 + SessionStart hook 注入恢复上下文（progress 尾部 + 活跃任务 + fast 状态）。
