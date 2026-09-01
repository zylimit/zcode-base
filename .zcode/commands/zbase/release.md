---
description: 发布流程：前置闸→发布三验→用户批准→溯源收口。
argument-hint: "[版本/目标环境]"
---

# /zbase:release

1. 调用 release-builder skill，目标：$ARGUMENTS
2. 前置闸：`node .zcode/zbase.mjs quality verify` 无 blocking + `receipt verify` 链完整。
3. 发布三验（产物/健康/冒烟）证据呈用户，**HIGH 审批停等**。
4. 批准后执行，收口：receipt + progress.md（Decisions/Done）+ 溯源链。
