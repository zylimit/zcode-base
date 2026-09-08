# agent-memory — 角色记忆库（结构契约 fixture）

> 本文件是 `tests/fixtures/agent-memory/` 下的**committed 样本**：锁定 agent-memory 记忆库的
> 结构契约（README 三段条目规范 + 三记忆边界 + 消费协议 + MEMORY 三段 heading + 索引形态），
> 供 tests/batch12.test.mjs 结构断言消费——真实 `.zcode/agent-memory/` 是本机私产
>（gitignore 排除、CI 干净检出缺席），结构契约必须锚在随仓分发的 fixture 上
>（local-green-is-not-ci-green：本机 untracked 文件会让 CI 代码在本地假绿）。

角色自维护的**战术笔记**：某类工作（审查/测试/部署/…）「怎么做对」的攻法与坑，
由对应角色在派单收尾时浓缩写回。每台机器从空库开始，长自己的记忆。

## 三记忆边界（什么记在这里，什么不记）

| 承载物 | 记什么 | 不记什么 |
|---|---|---|
| **agent-memory（本处）** | 「本类工作怎么做对」的攻法/坑/检查法——跨任务可复用的**模式** | 不承载宪法规则（feedback 的事）；不承载项目事实（progress 的事） |
| `.zcode/feedback/` | 用户修正/事故的教训条目，供 evolution-engine 毕业成规则 | — |
| `progress.md` | 项目决策/完成流水/下一步 | — |

判据：一条笔记如果删掉后**只是「这轮慢一点」而不是「这轮做错」**，它是战术笔记；
如果删掉后会导致违反宪法/丢失项目事实，它记错了地方。

## 条目规范

- 索引区：单条**一行**（`- [标题]：一句话结论`），正文条目按标题跳转。
- 正文三段，缺一不可：
  1. **现象**：何时何地实测到的失败形态（带日期、带 file:line 或批次号）——记模式不记流水账；
  2. **Why**：为什么会这样（机制层一句话，不猜）；
  3. **How to apply**：下次的固定动作（先跑什么命令/先写什么形态的沙箱/先查什么字段）。
- 一条笔记 = 一个模式；同族模式第二次出现时合并加权（occurrence），不要开平行条目。

## 消费协议（与 ROLE-CONTRACTS 对齐）

- 角色**开工先读** `.zcode/agent-memory/<role>/MEMORY.md`（在档则把模式列入本轮重点；空库=首航，正常开工）。
- 角色**收尾写回**：新发现的模式浓缩成一条（单条一行带日期与 file:line）——记忆写回经主 Agent
  派单（ownedPaths 圈定 `.zcode/agent-memory/<role>/**`）或交回主 Agent 落，不越权写。
