---
id: ci-is-investment
occurrences: 1
graduated: false
---

# ci-is-investment

- 日期: 2026-09-02
- 来源: 会话（CI 修复第 2 轮派单被用户中断后直接下指令）
- 信号: 用户原话「git ci 不是负担，不但要做好，还要持续，强化」
- occurrence: 1（≥3 毕业为规则，进宪法或 rules/）

## 现象

CI gate 4 矩阵全红（130 windows 红 + ubuntu dod 红），第 1 轮修复后剩 15 windows 红（存量测试从未在 Windows 上跑过的技术债）。用户在第 2 轮修复派单时中断并给出方向指令：CI 不是负担，要做好、持续、强化。

## 根因

机制问题：跨平台兼容从未被当作一等验收面——测试/引擎长期只在 Linux（WSL）验证，POSIX 语义假设（pathname/冒号文件名/chmod 位/E2BIG/路径分隔符）散布无静态执法，CI 矩阵虽在但 windows 节点红着不影响本地开发节奏，红债自然累积。

## 规则（可执行表述）

1. CI 矩阵任一节点（OS×Node）红 = 当轮必修，不跨轮挂账；修复与回归锁同一轮落地。
2. 新暴露的平台不兼容修复时，必须同轮加 Linux 可跑的回归锁（字符串合法性/静态扫描/平台守卫三选一），CI 矩阵本身 + platform-ci.test.mjs 是持续执法面。
3. 写测试/引擎代码遇到 POSIX 特有语义（权限位/errno 形态/路径分隔符/文件名字符集）时必须显式平台分支或带理由 skip，禁止默认全平台成立。

## 执法建议

platform-ci.test.mjs 已承担静态锁执法（每轮 CI 全矩阵跑）；若同类平台缺陷再发（occurrence ≥3），考虑把「跨平台静态规则」（pathname 反模式/文件名非法字符/路径直出）升格为 lint 级检查。
