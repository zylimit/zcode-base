---
id: preserve-brand-assets
occurrences: 1
graduated: false
---

# preserve-brand-assets

- 日期: 2026-09-01
- 来源: codex-base（feedback: preserve-brand-assets；Logo 误删事故）
- 信号: 清理/精简仓库时删除了图标、Logo、商标等品牌资产
- occurrence: 1

## 现象（事故语境）

仓库清理精简时 Logo 被当冗余资产删除，只能从 git 历史恢复——品牌资产的价值判断与普通文件不同，误删的代价不对称。

## 根因

清理清单没有资产分类步骤；「看起来没人引用」不等于「可以删」。

## 规则（可执行表述）

清理精简前先盘点品牌资产（Logo/图标/商标/授权文本），默认保留；删除任何品牌资产需用户明确确认，不从「未被引用」推导出「可删」。

## 执法建议

branch-finisher / release-builder 收尾清单加盘点项；删除审计（review pack 的 deletions 段）复核时点名品牌资产类删除。
