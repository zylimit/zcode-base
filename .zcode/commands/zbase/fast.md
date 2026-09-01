---
description: Fast Mode 贷款开关（on/off/status）：临时放水质量流程，三性红线永不豁免，证据贷款必须偿还。
argument-hint: "on --minutes N --reason \"...\" | off | status"
---

# /zbase:fast

执行 `node .zcode/zbase.mjs fast $ARGUMENTS`。

## on（贷款）

```
node .zcode/zbase.mjs fast on --minutes 30 --reason "演示前 30 分钟放水"
```

- `--minutes` 必填（clamp 1..480，超 8h 封顶），`--reason` 必填非空——无期限无债务人的贷款永远无法偿还；两者缺一 exit 1。
- 每次开启生成新 `windowId`：verification-matrix 中声明 `allowFastSkip:true` 且不证明 security/safety/privacy 的检查在 `gate` 时跳过执行、落 SKIPPED 回执（`fastModeWindow` 留痕）。
- **只有同一 windowId 窗口内的 SKIPPED 有效**：窗口关闭或重开后旧 SKIPPED 一律失效（quality verify 按未覆盖处理）。
- **已执行出的 FAIL 永不可被 fast 豁免**——fast 只允许跳过「未运行」的检查（反证优先）。

## 债务收口（不能忘）

- `task finish`：任务名下存在新鲜 fast-SKIPPED 回执 → 阻断「证据贷款不能关闭任务」，补跑偿贷或 `--force` 强收（留痕）。
- `risk scan`：`FAST_MODE_DEBT`（error 级）点名窗口内跳过的检查清单。
- 到期自动失效；`fast status` 显示 until/windowId；`fast off` 主动关闭。

## 永不豁免

生效期间硬拦不变：危险命令/秘密读写/保护路径/发布三验；security/safety/privacy 三性检查无论是否声明 allowFastSkip 都不可跳。
