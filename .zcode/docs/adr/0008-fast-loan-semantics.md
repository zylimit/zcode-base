# ADR-0008: Fast Mode 贷款语义

- 状态: Accepted
- 日期: 2026-09-01
- 决策人: zcode-base（v2.0 R3a + F1 修复裁决；dsh 四条件 × cursor 反论点两案叠乘）
- Enforced-by: quality verify, risk scan, receipt verify

## 背景

v1.0 的 `fast on/off` 是无形状的开关：默认 24h、无上限、reason 可空、无留痕——放水会变成常态（"a mode flag is exactly the state that outlives its excuse"）。dsh-base 给出贷款四条件（8h 封顶/reason 必填/allowFastSkip 预标记/SKIPPED 留痕+DEBT 阻断）；cursor-base 反对全局窗口本身，主张按检查豁免，并提出独立铁律「已执行的 FAIL 永不可豁免」（跳过未运行 ≠ 豁免已证缺陷）。codex 补 windowId 窗口绑定（旧窗口的 SKIPPED 在新窗口被误认有效）。

## 决策（八条，缺一即回退到普通门禁语义）

1. `fast on` 必带 `--minutes 1..480`（8h 封顶）与 `--reason`——无日期的贷款永远还不上。
2. `allowFastSkip` 预标记：只有 verification-matrix 显式声明 `allowFastSkip: true` 的检查可跳；**security/safety/privacy 三性与 critical/high 档在配置期即拒绝**（PROTECTED_FAST_SKIP/BLOCKING_FAST_SKIP）。
3. 跳过留痕：被跳检查落 `SKIPPED` 回执进哈希链账本，不是消失。
4. `windowId` 窗口绑定：每次 `fast on` 生成新窗口 id，SKIPPED 回执记录所属窗口；窗口关闭或换窗后旧 SKIPPED 一律失效。
5. 已执行的 FAIL 永不可被 fast 豁免（反证优先于 SKIPPED）。
6. DEBT 阻断：窗口内产生的 SKIPPED 债务**按任务/窗口维度存续（不随指纹漂移蒸发——F1 修复），持续到还清**；`task finish` 与 `release`（fast-debt-repaid 条件）在债务未清时阻断。
7. fast 不豁免安全护栏（危险命令/秘密/保护路径 hook 永不受 fast 影响）。
8. 状态可见：SessionStart 播报 fast 开关与到期，防忘关。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 维持 v1.0 无形状开关 | 放水无时间形状、无偿还义务，必然常态 |
| cursor 按检查豁免制（per-check diff-bound expiring waivers）作为主机制 | 会话级截止压力是真实需求，豁免制逐条申请摩擦过大；但其「已执行 FAIL 不可豁免」铁律被叠乘吸收——两案不是互斥 |
| dsh 四条件原样 | 无 windowId：旧窗口 SKIPPED 在新窗口被误认有效；无「已执行 FAIL」铁律 |

## 后果

- 正面：放水有时间形状（8h 封顶）、有账本（SKIPPED 留痕）、有偿还义务（DEBT 阻断 finish/release）、有边界（三性与阻断档永不可跳）。
- 负面：需要放水的会话多两步（minutes+reason）；债务跨指纹存续意味着 fast 期间不能靠改代码逃债（F1 实证的原缺陷已封）。

## 执法方式

`quality verify`（SKIPPED 回执可接受性判定：窗口匹配+非保护档；critical/high 档 fast 窗口内未跑=BLOCKED；task finish 债务阻断）、`risk scan`（FAST_MODE_DEBT error 级点名 skipped 清单）、`receipt verify`（SKIPPED 回执随哈希链与窗口绑定字段校验）执行本决策。
