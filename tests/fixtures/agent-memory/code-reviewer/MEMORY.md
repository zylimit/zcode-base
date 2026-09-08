# code-reviewer MEMORY（结构契约 fixture）

> committed 样本（3 条规范形态条目），锁定 MEMORY 文件结构契约：索引区单行一条 + 正文三段
>（现象 → Why → How to apply，heading 形态见正文）。真实记忆是本机私产，见 `../README.md`。

## 索引

- [fixture 样条一]：结构契约锚——索引行单行、正文三段齐
- [fixture 样条二]：现象段须带日期与 file:line
- [fixture 样条三]：How to apply 段须给可执行动作

---

## fixture 样条一

### 现象

2026-01-01，fixture 样例：审查中发现某判定只有行为级断言、无文本级锚（示例形态，无真实缺陷）。

### Why

结构契约样本：Why 段一句话讲机制，不展开叙事。

### How to apply

结构契约样本：给固定动作——先跑对应 lint，再读夹具是否做了预处理。

## fixture 样条二

### 现象

2026-01-02，fixture 样例：某条目现象段缺日期与定位，无法复核（示例形态）。

### Why

无日期无定位的「实测」不可复核，等于没测。

### How to apply

写条目时先填日期与 file:line（或批次号），再写失败形态。

## fixture 样条三

### 现象

2026-01-03，fixture 样例：某条目 How to apply 只写「注意」，无可执行动作（示例形态）。

### Why

「注意」不可执行——下次遇到同样形态时无法直接照做。

### How to apply

给固定命令或固定检查顺序（先跑什么、再看什么字段），让动作可照抄。
