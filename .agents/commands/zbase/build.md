---
description: 开始/继续实现某个 Phase 或 Task（per-Task 闭环：实现→受影响验证→审查→收口）。
argument-hint: "[Phase/Task 编号或目标]"
---

# /zbase:build

1. 调用 dev-builder skill，目标：$ARGUMENTS
2. 大仓项目先跑 `node runtime/zbase.mjs impact`（保守扩张铁律）。
3. 中高风险 Task 先 `task start --input`（六字段信封）+ `context pack`。
4. 收口必须：verification 全绿 → `receipt write` → code-review 三 Stage → `task finish`。
