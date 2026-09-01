---
name: red-blue-review
description: 高价值/高风险变更需要对抗式审查（安全相关改动、核心链路重构、发布前复核）时使用。Blue 自证→Red 攻击→Judge 裁定全程走 review 引擎协议（start/blue/lens/verdict），结论由已记录事实计算。
---

# red-blue-review：红蓝对抗审查（引擎协议版）

## 适用判据

满足任一：安全相关（auth/密钥/输入解析）、核心链路重构、发版前最后闸、用户点名、`catalog.review.requireForFinish=true` 项目的 medium/high 风险任务收尾。普通变更走 code-review 即可，不必升级对抗（成本约 3 倍）。

## 引擎协议（裁定由引擎计算，不是 Judge 口头宣布）

全程用 `node .zcode/zbase.mjs review ...`；退出码：协议违规 1 / FIX_REQUIRED 2 / degraded 3 / stale 4。每个 lens 必须是**不同的 fresh 子代理**（同源盲区；派单带派单六字段，回执用回执信封六字段）。

### 0. 开审（主 Agent）

```
node .zcode/zbase.mjs review-pack        # 证据包：Commits/Diffstat/删除审计/Untracked/Diff
node .zcode/zbase.mjs review start       # impact→lens 组队（profile×属性裁剪，输出 excludedLenses 理由）
```

- 空工作树拒绝开审（没有可审查的对象）。
- 组队结果里的 `requiredLenses` 决定派哪些 lens；`excludedLenses` 的理由原样进派单上下文。
- 审查期间工作树变化 → 所有写操作 stale（exit 4）→ 重新 start。

### 1. Blue 自证（实现方子代理）

```
echo '{"claims":[{"claim":"...","evidence":"命令/路径/退出码"}]}' | node .zcode/zbase.mjs review blue
```

- 空 claims 拒；**claim 缺 evidence 拒——没有命令/路径/退出码的主张只是观点**（exit 1）。

### 2. Red 攻击（每个 lens 一个 fresh 子代理，按 stage 顺序）

```
echo '{"findings":[{"severity":"error|warning|info","location":"file:line","summary":"...","verificationQuestion":"..."}]}' | node .zcode/zbase.mjs review lens <name>
```

| Stage | Lens | 攻击问题 |
|---|---|---|
| 1 code | correctness | 边界输入/并发/时序/部分失败时会怎样？ |
| 2 functional | reliability | 没有修复时测试会红吗？失败被分类而非重试吗？ |
| 3 trust | resilience | 出站调用有超时？重试有预算与退避？降级模式声明了吗？ |
| 3 trust | security | 注入/越权/密钥泄漏/依赖链投毒面？ |
| 3 trust | privacy | 触碰/记录/导出/留存了哪些个人数据？删除可证明吗？ |

- **立案标准（引擎强制）**：每条 finding 必须 `file:line` 或可跑的 reproduction，否则整批拒（exit 1）。
- **stage 门（引擎强制）**：当前 stage 的 required lens 未报完，下一 stage 提交被拒（stageGated exit 1）——`review status` 看待报清单。
- `verificationQuestion`（CoVe，可选）：为 finding 附一条可独立判定的核验问题——Judge 前由**不同的验证者**亲自重跑证据句柄核验，证据不足即判不真（默认怀疑立场）。
- lens 无法得出结论：`{"unable":true,"unableReason":"缺什么证据"}` + 空 findings。

### 3. Judge 裁定（主 Agent，凭引擎计算）

```
node .zcode/zbase.mjs review verdict [--reviewer <who>] [--notes s]
```

- 引擎聚合全部 lens 的 error 出裁定：**ACCEPT**（exit 0）/ **FIX_REQUIRED**（exit 2）/ **NEEDS_MORE_EVIDENCE**（exit 3）。
- 带 `verificationQuestion` 的 finding 在 verdict 输出标「待独立核验」（pendingVerification）——Judge 必须逐条独立核验完才可采信该 finding；证据锚定是承重墙，对抗形式只是补充。
- 仅 **ACCEPT+isFinal** 自动落 `check=review` 回执（带 lens 覆盖与 scope，进哈希链）——这是 completion 门的审查证据。
- advice 里「共识比三个分歧的 lens 更差」不是修辞：lens 间零分歧时抽查 findings 是否真的核过证据。

### 4. 轮次控制（skill 封顶 2 轮——宪法；引擎 maxRounds 默认 3）

- 轮次 <2：FIX_REQUIRED → 走 red-locks 修复 → `review start` 重开（上一轮进 lineage）。
- 轮次 =2 仍有分歧：转 deferred——`review backlog add`（stdin JSON：owner/expiry 未来 ISO/summary/lens 必填）。
- **三性 finding（security/safety/privacy/pii/secret/credential）永不可入积压**（exit 1）——积压会变成设计拒绝给它的豁免。
- 引擎 escalate（round≥maxRounds）输出 STOP 建议：缩小范围/降 profile/记债——到此交人工，不再开轮。

## 纪律

- Red 与 Blue 不得同一实例；Judge 不下场写码；各 lens 相互独立派单。
- 审查期间禁止改代码（改了就 stale，全部重来——引擎执法）。
- 回执映射：子代理回执信封的 Verified/Evidence 字段即 blue 的 claims.evidence 与 lens 的 findings.location/reproduction 来源；引擎回执（receipt seq）是最终审查证据。
- Fast Mode 不豁免本 skill 的用户显式要求；fast 窗口内 completion 门的 review 要求同样失效（窗口语义），但三性红线不变。
