---
id: local-green-is-not-ci-green
occurrences: 1
graduated: false
---

# local-green-is-not-ci-green

- 日期: 2026-09-02
- 来源: 本仓 manifest 漏检事故 + cc-base CI 红一个月事故（批次 1 研究增量报告）
- 信号: 本地终验全绿后收官/发版，CI 红
- occurrence: 1

## 现象

- 本仓 2026-09-02：manifest 漏检——本地终验漏跑 manifest check，而子代理已重生成 manifest，CI 4 个作业挂。
- cc-base：CI 红了一个月，本地逐批验证全部记「全绿」，无人发现判决源早已分叉。

## 根因

本地跑的检查集合与 CI 跑的检查集合不同（漏项/版本/环境差异），但「本地全绿」被当成「CI 会绿」的证据——这是拿错误全集的自证替代目标全集的判决。验证只对「实际执行的命令」负责，不对「以为等价的命令集」负责。

## 规则

1. 收官/发版/跨环境修复关闭前，必须独立核查 CI 判决：`gh run list --commit <HEAD>`（或等效远端状态查询）与本地测试结果并列呈现，两者都绿才算绿。
2. 跨环境修复（本地修、CI 验）只允许记「已修未验」，CI 判决出来后才可改口为「已修已验」。

## 执法建议

release 九条件加 ci-status 条件：装配时查询 HEAD 对应 CI 运行状态，非 success 阻断（批次 2 接线）。
