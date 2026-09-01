# ADR-0004: 只用 ZCode 原生扩展点

- 状态: Accepted
- 日期: 2026-08-13
- 决策人: zcode-base
- Enforced-by: doctor

## 背景

家族脚手架在七个宿主上各有适配层（.claude/.codex/.cursor/.opencode/...）。zcode-base 的宿主是 ZCode；同时 zcode 兼容多种路径（.zcode/.agents）。选错放置位置会导致 skill 不被发现、hook 不触发或被遮蔽。

## 决策

严格按 zcode-guide 官方规范落位：

| 资源 | 位置 | 依据 |
|---|---|---|
| 宪法 | `<repo>/AGENTS.md` | workspace 指令文件，自动注入 |
| Skills | `.zcode/skills/<name>/SKILL.md` | 跨工具通用路径；frontmatter 仅 name+description |
| Commands | `.zcode/commands/zbase/<verb>.md` | 嵌套目录→`/zbase:verb`（Windows 兼容冒号） |
| Hooks | `~/.zcode/cli/config.json`（用户级）→ hooks.enabled:true + 7 事件；工作区 `.zcode/config.json` 不再注册 | 用户级无会话审核摩擦；注册由 install 写入（含项目自检 wrapper）；详见 ADR-0006 |
| 运行态 | `.zcode/state/`（gitignored） | 非宿主路径，避免污染发现面 |

关键规范遵守：command frontmatter 用连字符键；`$ARGUMENTS` 替换；hook 输出用退出码（0 过/2 阻断）+ `additionalContext` JSON 注入；SKILL.md 正文 <500 行。

## 备选方案与拒绝理由

| 方案 | 拒绝理由 |
|---|---|
| 插件包形态 | hook 自动启用但 skill 优先级最低；marketplace 安装摩擦大 |
| `.zcode/skills/` 放置 | 会遮蔽用户级同名 skill，跨工具不通用 |

## 后果

- 正面：原生发现/触发/权限全兼容；doctor 可静态校验注册面。
- 负面：依赖 zcode 当前规范（7 事件上限、Stop 续命 ≤3）——以诚实边界声明兜底。

## 执法方式

`doctor` 双通道校验 hooks 注册（工作区或用户级任一满足 enabled+7 事件）与目录结构。
