# ADR-0001: 每事件单 hook 注册 + 统一 Node dispatcher

- 状态: Accepted
- 日期: 2026-08-13
- 决策人: zcode-base
- Enforced-by: doctor

## 背景

ZCode 支持 7 个 hook 事件。若每个事件注册多个脚本、或每个规则一个脚本，会产生：并发竞态（多脚本同时写 gate-log）、跨平台维护税（.sh/.ps1 双写）、注册面爆炸难审计。

## 决策

每个事件只注册**一个** hook，全部路由到统一入口 `node runtime/zbase.mjs hook <event>`，由 runtime 内部按事件分发到具体处理逻辑（hooks.mjs）。规则数据（危险命令模式/保护路径）外置到 harness/harness.json 配置，改规则不改注册。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 每规则一个 hook 脚本 | 注册面爆炸；gate-log 并发写竞态；Windows 双写税 |
| shell 脚本直连 | 跨平台差异；逻辑无法与 runtime 库复用 |

## 后果

- 正面：单一注册面（doctor 可审计）；规则热改（配置）；Node 跨平台一致。
- 负面：hook 失败影响面集中（单点）——以 fail-visible + 留痕缓解。

## 执法方式

`doctor` 校验 .zcode/config.json 的 hooks.enabled 与 7 事件注册完整性。
