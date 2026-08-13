# Task Brief — <task-id>

> task start 的输入。六字段齐全才建任务（`node runtime/zbase.mjs task start --input <file>`）。

```json
{
  "goal": "<一个可独立验收的行为切片>",
  "scope": ["<允许触碰的文件/模块>"],
  "outOfScope": ["<明确禁止>"],
  "existingPattern": "<遵循的现有模式/契约文件路径>",
  "verification": [
    { "command": "<证明命令>", "expect": "<期望输出/退出码>" }
  ],
  "escalation": "<何时必须交回主 Agent>",
  "refs": { "spec": "<Product-Spec 条目>", "plan": "<DEV-PLAN Task>", "adr": [] },
  "risk": "low|medium|high",
  "ownedPaths": ["<并行写时的独占路径>"],
  "reviewExclusions": []
}
```

## 回执信封（子代理返回）

```
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Changed:
Verified:
Not verified:
Needs review by:
Evidence:
```

## 收口检查

- [ ] verification 全部跑过且 exit code 符合预期
- [ ] `receipt write` 落账（四态）
- [ ] code-review 三 Stage 全过
- [ ] `task finish`（quality verify 无 blocking）
