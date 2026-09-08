# tester MEMORY（结构契约 fixture）

> committed 样本（3 条规范形态条目），锁定 MEMORY 文件结构契约：索引区单行一条 + 正文三段
>（现象 → Why → How to apply，heading 形态见正文）。真实记忆是本机私产，见 `../README.md`。

## 索引

- [fixture 样条一]：结构契约锚——索引行单行、正文三段齐
- [fixture 样条二]：现象段须带日期与 file:line
- [fixture 样条三]：How to apply 段须给可执行动作

---

## fixture 样条一

### 现象

2026-01-01，fixture 样例：测试夹具刚创建的文件触发被测系统的 mtime 新鲜度豁免（示例形态）。

### Why

结构契约样本：Why 段一句话讲机制，不展开叙事。

### How to apply

结构契约样本：给固定动作——夹具写完回拨 mtime 一小时。

## fixture 样条二

### 现象

2026-01-02，fixture 样例：断言依赖只在本机存在的 untracked 目录，CI 干净检出缺席即红（示例形态）。

### Why

本机文件让 CI 代码在本地假绿——local-green 不是 CI-green。

### How to apply

断言私产目录时改锚 committed fixture，或对真实目录做存在性守卫（在场断言/缺席 skip）。

## fixture 样条三

### 现象

2026-01-03，fixture 样例：某条目 How to apply 只写「小心」，无可执行动作（示例形态）。

### Why

「小心」不可执行——下次遇到同样形态时无法直接照做。

### How to apply

给固定命令或固定检查顺序（先跑什么、再看什么字段），让动作可照抄。
