---
description: Fast Mode 开关（on/off/status）：临时放水质量流程，安全护栏永不豁免。
argument-hint: "on [hours] | off | status"
---

# /zbase:fast

执行 `node runtime/zbase.mjs fast $ARGUMENTS`（默认 status；on 可带小时数，默认 24h 自动过期）。

生效期间：跳过**自动派发**的 review/test/red-locks；不豁免危险命令拦截/隐私保护/发布三验；用户显式要求的检视照做。到期自动回严格模式，SessionStart 每次播报防忘关。
