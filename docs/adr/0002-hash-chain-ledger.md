# ADR-0002: 哈希链账本，断链 fail-closed

- 状态: Accepted
- 日期: 2026-08-13
- 决策人: zcode-base
- Enforced-by: receipt verify, fitness

## 背景

「验收以客观证据为准」依赖回执可信。平文件（JSONL）可被静默编辑/删除中段——证据体系一旦可被无痕篡改，质量门全是装饰。

## 决策

账本每行携带 `chainHash = sha256(prevChainHash + '\n' + canonicalJson(content))`，形成链。`receipt verify` 重算全链：

- 任意行被编辑 → 该行哈希不匹配 → CHAIN_BROKEN
- 中段删除 → 后续 seq 断号/链接断 → SEQ_GAP/CHAIN_BROKEN
- 尾部截断 → 可检测（与 task finish 时的期望对照）
- 证据文件在盘时重哈希 → EVIDENCE_TAMPERED/MISSING

任何 issue → exit 4（TAMPERED），全部回执视为未验证。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 平 JSONL 无链 | 可无痕篡改 |
| git commit 当账本 | 证据粒度太粗；hook/自动流程高频写入会污染历史 |

## 后果

- 正面：证据完整性可机器判定；篡改成本从「改个文件」升到「重算全链」。
- 负面：写入必须严格追加（appendLine 原子性）；rotation 需保留锚点。

## 执法方式

`receipt verify`（verify verb）+ `fitness` F4 规则 + `quality verify` 前置检查。
