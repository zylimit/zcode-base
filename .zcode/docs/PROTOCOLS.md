# PROTOCOLS — 协议集

> 来源：cursor-base PROTOCOLS + codex-base 派发契约精炼。所有协议字段机器可校验（schema 见 harness/schemas/）。

## 1. 任务信封（派单六字段）

```json
{
  "goal": "一个可独立验收的行为切片",
  "scope": ["允许触碰的文件/模块"],
  "outOfScope": ["明确禁止"],
  "existingPattern": "遵循的现有模式/契约文件路径",
  "verification": [{ "command": "证明命令", "expect": "期望输出/退出码" }],
  "escalation": "何时必须交回主 Agent"
}
```

缺字段不建任务（`task start` 校验）。>60min 预估 = 分解不合理。

## 2. 完成回执（回执信封六字段）

```
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Changed:
Verified:
Not verified:
Needs review by:
Evidence:
```

自报 DONE 只是「跑完了」；验收只认客观证据（宪法纪律 5）。

## 3. 验证回执（账本行）

```json
{ "seq": 7, "chainHash": "sha256(prevChainHash + '\\n' + canonicalJson(content))",
  "content": { "ts": "...", "task": "t-xxx", "check": "harness-unit-tests",
               "status": "PASS|FAIL|BLOCKED|SKIPPED", "fingerprint": "sha256(...)",
               "evidence": [{ "path": "...", "sha256": "..." }], "note": "输出尾部/exit code" } }
```

- `chainHash` 哈希链：编辑/删除/截断任意行 → 断链 → 全部回执视为未验证（fail-closed，exit 4）。
- `fingerprint`：HEAD + staged + unstaged + 路径清单的哈希；diff 变化 → 旧回执 stale。
- 四态语义：PASS 通过 / FAIL 反证存在 / BLOCKED 阻断待解（不算覆盖）/ SKIPPED 需豁免记录。

## 4. 反证优先覆盖判定

同（模块,属性）取**当前 fingerprint** 下的全部回执：

| 情形 | 判定 |
|---|---|
| 存在新鲜 FAIL | uncovered（FAIL 覆盖早先 PASS 的证明力） |
| 有 PASS 且无 FAIL | covered |
| 全 BLOCKED | uncovered（BLOCKED 不算覆盖） |
| SKIPPED + 有效豁免（非 security/safety） | covered（via waiver） |
| critical/high 无新鲜回执 | **blocking**（task finish 拦截，exit 3） |

## 5. 豁免协议（waiver 五要素）

```
approver（人）/ expiry（到期自动失效）/ compensation（补偿措施）
followUp（跟进事项）/ binding（绑定的 check+diff）
```

红线：security/safety 属性永不可豁免；FAIL 状态永不可豁免（豁免「暂时不做」，不豁免「做错了」）。

## 6. Stop 门协议

```
Stop 事件 → git 变更路径数 >0 且账本无当前 fingerprint 的新鲜回执
  → exit 2 请求继续（附修复指引）
  → 自计数封顶 2（ZCode 原生上限 3，留 1 次余量防死循环）
  → 耗尽放行 + gate-log 留痕（exhausted）
```

## 7. 有界对抗协议

review→fix 封顶 2 轮 → 转 deferred：`{problem, severity, why_not_fixed, owner, round_capped}`。Red finding 必须附 file:line 或复现路径，否则不立案。

## 8. 门禁留痕协议

所有 hook 拦截（deny）与放行观察（observe）写 `.zcode/state/gate-log.jsonl`；`gate-audit` 统计每规则拦截数——**denied=0 且 observed=0 的规则是死闸：要么给出有效性证据要么移除**（从未干预的控制 = 成本 + 虚假信心）。
