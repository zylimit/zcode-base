---
description: 进入架构阶段：模块划分/catalog/ADR/禁边声明，并跑架构看护检查。
argument-hint: "[架构关注点]"
---

# /zbase:arch

1. 调用 arch-designer skill。
2. 关注点：$ARGUMENTS
3. 完成后执行架构看护链并汇报结果：
   - `node runtime/zbase.mjs catalog lint`
   - `node runtime/zbase.mjs arch check`（存量违例评估后 `arch baseline` 固化）
   - `node runtime/zbase.mjs adr check`（幽灵引用零容忍）
   - `node runtime/zbase.mjs arch trend`（债务只许减）
