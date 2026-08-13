---
description: 治理状态看板：活跃任务/fast/账本/门禁审计/风险一屏览。
argument-hint: ""
---

# /zbase:status

执行并汇总成一屏看板：

```bash
node runtime/zbase.mjs task status       # 活跃任务 + baselineDrift
node runtime/zbase.mjs fast status       # Fast Mode
node runtime/zbase.mjs receipt stats     # 账本四态统计
node runtime/zbase.mjs quality status    # 五性覆盖行
node runtime/zbase.mjs gate-audit        # 死闸审计（从未拦过的门）
node runtime/zbase.mjs risk scan         # 连击与危险状态
```

关注：baselineDrift=true（旧证据腐化，需重验）；gate-audit 中 denied=0 的规则（要么给证据要么撤）；risk 的 critical/high 发现。
$ARGUMENTS
