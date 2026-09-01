# MODULE-CAPSULE: <module-name>

> 位置: `.zcode/harness/modules/<module-name>.md`。context pack 优先打包胶囊而非源码全文——60W 行仓的上下文纪律：读胶囊不读实现。

## 职责

<一段话：这个模块为什么存在，不做什么>

## 公共契约

<对外暴露的 API/事件/数据格式；签名 + 语义 + 破坏性变更流程>

## 依赖

- 依赖（deps）: <modules>
- 被依赖（消费者）: <modules>（impact 反向闭包结果）
- 禁边（forbidden）: <如「不得依赖 X」>

## 五性档位（module-catalog attributes 同步）

| 属性 | 档位 | 关键手段 |
|---|---|---|
| 韧性 | … | … |

## 测试入口

<跑这个模块测试的命令；verification-matrix 中 scope 含本模块的检查名>

## 已知债务

<baseline 中的存量违例；新债零容忍（arch check）>
