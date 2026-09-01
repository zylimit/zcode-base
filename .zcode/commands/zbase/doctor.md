---
description: 环境自检 + 规模冒烟（目录/hooks 注册/契约/账本/接线一致性）。
argument-hint: ""
---

# /zbase:doctor

执行并汇报：

```bash
node .zcode/zbase.mjs doctor      # 全量自检（失败项逐条说明）
node .zcode/zbase.mjs selftest    # 120 模块 × 3 万路径规模冒烟
```

doctor 失败项按提示修复（如 hooks 未启用 → 跑 `node .zcode/zbase.mjs install <dir>` 注册用户级 hooks，或手工确认 `~/.zcode/cli/config.json` 的 hooks.enabled）；修复后重跑至全绿。
$ARGUMENTS
