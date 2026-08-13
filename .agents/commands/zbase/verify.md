---
description: 跑全量验证门（Phase 完成闸）：matrix 检查 + 五性覆盖 + 账本完整性 + 架构看护。
argument-hint: ""
---

# /zbase:verify

依次执行并汇总（任一失败即汇报失败项与证据，不粉饰）：

```bash
node runtime/zbase.mjs receipt verify      # 账本链完整（断链 exit 4）
node runtime/zbase.mjs quality verify      # 五性覆盖（反证优先；blocking = exit 3）
node runtime/zbase.mjs catalog lint        # 模块账本
node runtime/zbase.mjs arch check          # 无新债
node runtime/zbase.mjs adr check           # 无幽灵引用
node runtime/zbase.mjs fitness             # 五性接线
node runtime/zbase.mjs risk scan           # 连击/危险状态
node --test tests/                         # 单元与集成测试（存在时）
```

汇报格式：每项 PASS/FAIL/BLOCKED + 关键证据。全绿才进 Phase 完成闸（用户确认）。
$ARGUMENTS
