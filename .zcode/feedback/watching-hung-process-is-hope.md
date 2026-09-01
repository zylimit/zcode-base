---
id: watching-hung-process-is-hope
occurrences: 1
graduated: false
---

# watching-hung-process-is-hope

- 日期: 2026-09-01
- 来源: cursor-base（feedback: long-batch-needs-watchdog-and-stop-loss）
- 信号: 长批量任务/部署脚本挂起后盯着进程等它「自己好」
- occurrence: 1

## 现象（事故语境）

cursor 长批量任务教训：进程挂起后持续观望数小时——「Watching a hung process is the most expensive form of hope」；「进程还活着」不是进度，挂着不动恰恰是最贵的状态。

## 根因

无 per-item 超时、无止损信号：把「未失败」误读为「在进行」。

## 规则（可执行表述）

长批量任务必须 per-item 超时 + 隔离害群之马（而非杀整个 run）+ 止损信号（日志冻结超过最坏重试窗/输出计数不前进即停手转诊断）。挂起进程的处理是「判死+取证」，不是「再等等」。

## 执法建议

deployer/长任务的派单 Verification 字段写明超时与止损判据；cursor service 监督器的「重启风暴熔断」是同型立场的引擎化范本。
