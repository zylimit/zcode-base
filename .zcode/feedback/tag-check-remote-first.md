---
id: tag-check-remote-first
occurrences: 1
graduated: false
---

# tag-check-remote-first

- 日期: 2026-09-01
- 来源: cc-base（progress Pinned：曾因只看本地打出冲突 tag）
- 信号: 准备打 git tag，只查了本地 tag 列表
- occurrence: 1

## 现象（事故语境）

cc 打 tag 前只确认本地无同名 tag——远程早有人推过，tag 一推即冲突。本地无 tag ≠ 远程无 tag。

## 根因

把本地仓库状态当成全库状态；tag 命名空间的事实源在远端。

## 规则（可执行表述）

打 tag 前先 `git ls-remote --tags origin` 查远端现状，再定 tag 名；release-builder 的发布流程把这一步固化在打 tag 之前。

## 执法建议

release-builder 收尾清单项；与宪法纪律 8「远端写操作前当场实查当前实况」同向，本条是其 tag 场景的具体化。
