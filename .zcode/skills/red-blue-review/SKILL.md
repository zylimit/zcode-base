---
name: red-blue-review
description: 高价值/高风险变更需要对抗式审查（安全相关改动、核心链路重构、发布前复核）时使用。Blue 自证→Red 攻击→Judge 裁定。
---

# red-blue-review：红蓝对抗审查

## 适用判据

满足任一：安全相关（auth/密钥/输入解析）、核心链路重构、发版前最后闸、用户点名。普通变更走 code-review 即可，不必升级对抗（成本约 3 倍）。

## 流程（封顶 2 轮）

### 1. Blue 自证（实现方）

陈述：改动意图 + 自认的风险面 + 已有防护 + 验证证据（receipt seq）。

### 2. Red 攻击（fresh 实例，心态=找出会出事的路径）

四个 lens 逐一过：

| Lens | 攻击问题示例 |
|---|---|
| correctness | 边界输入/并发/时序/部分失败时会怎样？ |
| security | 注入/越权/密钥泄漏/依赖链投毒面？ |
| release | 回滚路径真的可用吗？迁移失败一半呢？ |
| environment | 目标环境（OS/资源限制/网络策略）与开发机差异会踩什么坑？ |

**立案标准：Red finding 必须附 file:line 或可复现路径，否则不立案**（防凭感觉攻击）。

### 3. Judge 裁定（主 Agent，凭证据）

- ACCEPT：finding 全部有防护或被驳倒。
- FIX_REQUIRED：列必修项 → 走 red-locks 修复 → 复审。
- NEEDS_MORE_EVIDENCE：列补证命令，不猜。

### 4. 轮次控制

- 轮次 <2：按裁定继续。
- 轮次 =2 仍有分歧：转 deferred（问题/严重度/为何不修/负责人），不无限对抗。

## 纪律

- Red 与 Blue 不得同一实例（同源盲区）；Judge 不下场写码。
- 攻击结论落 `receipt write`（note 带轮次与裁定）。
- Fast Mode 不豁免本 skill 的用户显式要求。

## 回执

对抗报告（findings 表 + 裁定 + 轮次）+ receipt seq。
