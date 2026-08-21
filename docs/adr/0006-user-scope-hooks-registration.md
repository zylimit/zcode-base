# ADR-0006: hooks 注册迁移用户级

- 状态: Accepted
- 日期: 2026-08-21
- 决策人: zcode-base
- Enforced-by: doctor

## 背景

ZCode 客户端对**工作区 hooks**（`<repo>/.zcode/config.json` 的 `hooks` 键）执行会话级审核：每个新会话弹「N 个工作区 Hook 待审核，本会话暂未启用」，需逐条人工启用且无批量同意。实测后果：v1.0.0 交付后的会话中，8 条治理门禁（危险命令/保护路径/Stop 验证等）长期处于待审核离线状态——硬门禁名存实亡，这与「运行时强制 > 提示词自觉」的设计原则（ARCHITECTURE §3.1）直接冲突。

官方 zcode-configuration-guide 口径：用户级配置 hooks（`~/.zcode/cli/config.json` → `hooks`）无信任门禁，`enabled: true` 即生效；工作区与用户级 hooks 为叠加执行关系（非覆盖），二者并存会双重触发。

## 决策

1. hooks 注册面从工作区 `.zcode/config.json` 迁到**用户级** `~/.zcode/cli/config.json`；工作区配置清空为 `{}`（文件保留，避免 manifest 面变更）。
2. `install` 新增 `registerUserHooks()` 步骤：只覆写用户级配置的 `hooks` 键、保留其余键（mcp.servers 等）；幂等（等值覆写不堆叠）；覆写前检测到**异已 hooks**（存在且与 spec 不等）先整文件备份为 `config.json.bak-zbase-<ts>` 并在 report 中可见告警；用户配置损坏时 throw（fail-visible）且目标树零文件写入。
3. 每条 hook command 用**项目自检 wrapper**：
   `if [ -f "${ZCODE_PROJECT_DIR}/runtime/zbase.mjs" ]; then node "${ZCODE_PROJECT_DIR}/runtime/zbase.mjs" hook <event>; else exit 0; fi`
   ——用户级全局注册下，未安装 zcode-base 的项目静默放行（exit 0），装了的项目透传真实退出码（0 过/2 阻断/其他失败可见）。
4. `doctor` hooks 检查改**双通道**：工作区或用户级任一满足 `enabled=true` + 7 事件即 PASS（detail 注明通道）；双缺 FAIL 并给 install 修复指引——团队仍可选择工作区注册模式，不被堵死。
5. 事件/matcher/超时/statusMessage 与 v1.0.0 工作区注册面逐项一致（7 事件 8 条，PreToolUse 占 Bash / Edit|Write|ApplyPatch 2 组）。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 维持工作区注册 + 用户逐会话审核 | 审核无批量同意，门禁长期离线（实测已发生）；摩擦不可接受 |
| 挪回插件包形态借 hook 自动启用 | skill 优先级最低 + marketplace 摩擦（ADR-0004 已拒，理由不变） |
| 工作区+用户级双注册 | 叠加执行 = 每事件双跑，门禁双记、性能翻倍 |

## 后果

- 正面：门禁即时生效（免审核）；install 一次配置全项目复用；wrapper 保证非 zcode 项目零打扰；异已 hooks 先备份可回滚。
- 负面：hooks 不随仓库分发（新 clone 后需跑一次 install 或手工迁移）；写用户家目录属跨仓副作用——以「只覆写 hooks 键 + 备份 + report 可见」约束；wrapper 依赖 POSIX sh 与 PATH 中的 node（Windows 原生 cmd 不适用，诚实边界）。
- 溯源：本机迁移由主 Agent 于 2026-08-21 手工完成（8 条 wrapper 命令经双环境冒烟：zcode-base 项目透传、无 runtime 目录静默 exit 0），脚手架 install/doctor/测试由 implementer 子代理实现、code-reviewer 三阶段审查（F1 备份缺口已修复）。

## 执法方式

`doctor` 双通道校验 hooks 注册；`manifest check` 覆盖 `.zcode/config.json` 哈希（空对象基线）；`tests/harness.test.mjs` 含用户级注册/幂等/mcp 保留/双通道/损坏配置 fail-visible/异已 hooks 备份用例（HOME 隔离）。
