# completion-claims-need-fresh-verification

- 日期: 2026-08-13
- 来源: 家族脚手架跨仓实践（cc/codex/ccb-base 事故汇总）
- 信号: 子代理自报「完成/通过/DONE」；主 Agent 未复核就说「修好了」
- occurrence: 3（毕业：已机制化 receipt fingerprint + Stop 门 + 五步闸）

## 现象

子代理回复「测试通过」「已完成」，实际：测试没跑/跑的是旧命令/exit code 非零但只读了尾部输出/文件根本没写盘。主 Agent 转述后用户发现未完成，信任链断裂。

## 根因

「DONE」只反映子代理跑完了流程，不反映结果正确；复用上一条消息的旧输出当新鲜证据；只看输出有无不看 exit code 与失败数。

## 规则

任何「完成/通过/修好」结论出口前走五步闸：① 想清哪条命令能证明 ② 跑全量全新的该命令 ③ 读完整输出、看 exit code、数失败数 ④ 确认输出确实支持结论 ⑤ 才下结论。禁用「应该/大概/看起来」。没有当场跑出的新鲜证据，不报完成。

## 执法建议

已机制化：`receipt write` 绑定 task+git fingerprint（diff 变化=证据腐化）；Stop 门拦截无新鲜回执的收尾；quality verify 反证优先。
