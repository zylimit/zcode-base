---
description: 预算化上下文打包（DENY 路径永不入包；只打印 manifest，全文落 .zbase/context/）。
argument-hint: "[总字符预算，默认 120000]"
---

# /zbase:context

执行 `node runtime/zbase.mjs context pack --budget $ARGUMENTS`（为空用默认 120K chars）。

使用纪律：
- manifest 中 `impact.degraded=true` → 保守理解：影响面未收敛。
- 打包文件读法：优先读 `reason: capsule:*` 的模块胶囊，再读 task-diff 文件；DENY 命中的秘密/构建产物永不入包。
- truncated=true → 上下文被预算裁剪，关键文件没进包时提高预算或缩小 Scope。
