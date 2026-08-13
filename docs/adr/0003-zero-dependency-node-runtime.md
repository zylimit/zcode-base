# ADR-0003: 零依赖 Node ≥18 运行时

- 状态: Accepted
- 日期: 2026-08-13
- 决策人: zcode-base
- Enforced-by: doctor

## 背景

脚手架会被安装进任意目标项目（可能没有任何 package.json，或有严格依赖锁定）。运行时若引入 npm 依赖，会造成：安装污染、版本冲突、供应链攻击面、离线不可用。

## 决策

runtime/ 仅使用 `node:*` 内置模块（fs/path/crypto/child_process/module）。入口 `node runtime/zbase.mjs`，要求 Node ≥18（structuredClone、crypto、for-await stdin）。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| TypeScript 编译产物 | 需构建链；checked-in 产物与源漂移风险 |
| shell 脚本族 | 跨平台差异；无法承载账本/闭包等复杂逻辑 |
| 带 npm 依赖 | 污染目标项目；供应链风险 |

## 后果

- 正面：拷贝即用；零冲突；审计面小。
- 负面：放弃现成 glob/命令行解析库——自实现（globToRegExp/parseArgs），功能收敛在够用范围。

## 执法方式

`doctor` 校验 Node 版本 ≥18；secret-scan/fitness 校验无依赖引入。
