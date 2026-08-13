---
description: 环境自检 + 规模冒烟（目录/hooks 注册/契约/账本/接线一致性）。
argument-hint: ""
---

# /zbase:doctor

执行并汇报：

```bash
node runtime/zbase.mjs doctor      # 全量自检（失败项逐条说明）
node runtime/zbase.mjs selftest    # 120 模块 × 3 万路径规模冒烟
```

doctor 失败项按提示修复（如 hooks 未启用 → 检查 .zcode/config.json 的 hooks.enabled）；修复后重跑至全绿。
$ARGUMENTS
