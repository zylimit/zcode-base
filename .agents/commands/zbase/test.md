---
description: 为指定模块/功能写测试或补覆盖（写测者独立于被测作者）。
argument-hint: "[模块/功能/缺陷描述]"
---

# /zbase:test

1. 调用 test-builder skill，目标：$ARGUMENTS
2. 描述的是缺陷 → 先 red-locks：锁定失败测试并验红，再交修复。
3. 跑真实测试运行器，回传输出摘要 + exit code + `receipt write` 落账。
