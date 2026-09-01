---
description: 影响分析：改动路径 → 受影响模块 → 反向依赖闭包（保守扩张）。
argument-hint: "[路径1,路径2 或留空取 git 变更]"
---

# /zbase:impact

执行 `node .zcode/zbase.mjs impact --paths $ARGUMENTS`（为空则取 git 变更路径）。

解读纪律：
- 输出 degraded=true（unmapped/shared/global/truncated）→ 验证范围扩大到全模块 fanout，宁全跑不漏测。
- fanout 列表 = 必须纳入定向验证的模块集（含传递消费者）。
- unmapped 路径 >0 → 先补 module-catalog 归类再继续。
