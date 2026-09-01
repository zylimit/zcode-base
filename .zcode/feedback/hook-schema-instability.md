---
id: hook-schema-instability
occurrences: 1
graduated: false
---

# hook-schema-instability

- 日期: 2026-09-01
- 来源: cc-base（auto-push.sh 旧实现读了不存在的 .tool_exit_code 导致永不 push）
- 信号: hook 逻辑依赖宿主输入 schema 里拿不准的字段（版本间会变）
- occurrence: 1

## 现象（事故语境）

cc 的 auto-push hook 旧实现读取 hook 输入里的 `.tool_exit_code` 字段——宿主版本升级后该字段不存在，hook 判定永假、永不触发 push，且无报错。改用 git 状态判断后修复。

## 根因

hook 输入 schema 跨宿主版本不稳；依赖拿不准的字段=把正确性押在别人随时会改的内部接口上。

## 规则（可执行表述）

hook 逻辑宁可读外部可验证状态（git status/磁盘文件/进程表），不读 schema 里拿不准的字段；必须读 schema 字段时，缺字段按 fail-visible 报错而非默认值放行。

## 执法建议

zcode OQ-2（hook schema 字段实测）的先例结论——R6a 分类器接线与后续 hook 开发统一遵守；hooks 层缺字段时显式报错，不静默取 undefined。
