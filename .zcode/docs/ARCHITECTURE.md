# ARCHITECTURE — zcode-base

> 综合七个家族脚手架经验构建的 harness 开发脚手架。本文描述分层、数据流与关键设计取舍（ADR 索引见文末）。

## 1. 分层架构

```
┌────────────────────────────────────────────────────────┐
│ 宪法层  AGENTS.md（自动注入）+ .zcode/rules/ 下沉细则    │  人读的纪律
├────────────────────────────────────────────────────────┤
│ 流程层  .zcode/skills/ ×17 + .zcode/commands/zbase ×16│  生命周期工作流
├────────────────────────────────────────────────────────┤
│ 执法层  用户级 hooks（~/.zcode/cli/config.json，7 事件，│  机器护栏
│         硬门禁+留痕，install 写入，ADR-0006）             │
│         → node .zcode/zbase.mjs hook <event>           │
├────────────────────────────────────────────────────────┤
│ 治理层  .zcode/lib/ 治理 CLI（task/gate/quality/receipt/│  证据与看护
│         catalog/impact/context/arch/fitness/audit/risk）│
├────────────────────────────────────────────────────────┤
│ 契约层  .zcode/harness/（module-catalog /               │  机器可读事实
│         verification-matrix / schemas / templates）      │
├────────────────────────────────────────────────────────┤
│ 运行态  .zcode/state/（gitignored：账本/门禁日志/任务/   │  会话间状态
│         证据/研究产物）                                    │
└────────────────────────────────────────────────────────┘
```

依赖只许向下：流程层调治理层命令；治理层读契约层；契约层不依赖任何上层。

## 2. 关键数据流

### 2.1 per-Task 闭环（防开发失控的主回路）

```
恢复(task status/fingerprint) → task start(六字段信封+fingerprint 绑定)
  → context pack(预算化,DENY 永不入包) → scoped 实现(派 implementer)
  → 受影响验证(impact fanout 范围) → receipt write(四态+chainHash)
  → code-review 三 Stage → task finish(quality verify 反证门)
  → Stop hook(无新鲜回执→请求继续,封顶 2 次)
```

### 2.2 证据链（防表演式完成）

```
命令执行 → 回执{check,status,fingerprint,evidence[]} 
  → 账本行{seq,chainHash=sha256(prev+canonical(content)),content}
  → quality verify 反证优先（同属性 PASS+FAIL=uncovered）
  → task finish 拦截 blocking
```

fingerprint = sha256(HEAD + staged diff + unstaged diff + 变更路径清单)。diff 任何字节变化 → 旧回执 stale。

### 2.3 架构看护（防防腐失效）

```
代码 import 边(regex 提取) vs module-catalog 声明
  → arch check（新违例=fail，基线内=已知债务）
  → arch baseline（存量固化，棘轮）→ arch trend（只紧不松）
  → adr check（Enforced-by 幽灵引用拦截）
```

### 2.4 hook 门禁（留痕可审计）

```
工具调用 → PreToolUse(Bash|Edit|Write) → 危险模式/保护路径匹配
  → 命中: exit 2 deny + gate-log
  → 放行: observe 留痕
  → gate-audit（死闸审计：从未拦过的门要么给证据要么撤）
```

## 3. 设计原则

1. **运行时强制 > 提示词自觉**：能进 hook/治理引擎的规则不留在提示词（如危险命令、账本防篡改）。
2. **fail-visible**：断链/超时/degraded 一律显式报告，不静默降级；BLOCKED 绝不假绿。
3. **零依赖 Node**：.zcode/lib 仅用 node:* 内置模块（ADR-0003），目标项目零污染。
4. **唯一开关**：大仓治理启用 = module-catalog 存在；不存在不强造，小仓零负担。
5. **保守扩张**：影响面不收敛（unmapped/truncated）→ 宁全量验证不漏测。
6. **诚实边界**：声明 hooks 不是沙箱、Stop 续命有上限、单模型审查有同源盲区（见 README）。

## 4. 模块视图

模块账本见 `.zcode/harness/module-catalog.json`（7 模块：governance/skills/commands/feedback/runtime-harness/contracts/installer）。核心模块胶囊：`.zcode/harness/modules/`（按需补充）。

## 5. ADR 索引

| ADR | 决策 |
|---|---|
| [0001](adr/0001-unified-node-dispatcher.md) | 每事件单 hook → 统一 Node dispatcher |
| [0002](adr/0002-hash-chain-ledger.md) | 哈希链账本 fail-closed |
| [0003](adr/0003-zero-dependency-node-runtime.md) | 零依赖 Node ≥18 runtime |
| [0004](adr/0004-zcode-native-extension-points.md) | 只用 zcode 原生扩展点 |
| [0005](adr/0005-arch-ratchet-baseline.md) | 架构债务棘轮 |
| [0006](adr/0006-user-scope-hooks-registration.md) | hooks 注册迁移用户级（免会话审核） |
