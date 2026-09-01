---
name: skill-builder
description: 需要新建或修订 .zcode/skills/ 下的 Skill 时使用。遵循 zcode SKILL.md 原厂规范（frontmatter/触发描述/正文长度）。
---

# skill-builder：Skill 构建

## zcode 原厂规范（不可违背）

- 位置：`.zcode/skills/<name>/SKILL.md`（name 小写 kebab-case，与目录名一致）。
- frontmatter 必填 `name` + `description`；可选 `when_to_use`。
  - `description` 写清**何时用**（触发场景），是模型自动触发的唯一信号——模糊描述=永不触发。≤1024 字符（约 250 字符参与触发匹配）。
- 正文目标 **<500 行**（触发时全文加载）；细节下沉子文件按需读。
- 子目录：`references/`（扩展文档）、`templates/`（模板）、`scripts/`（脚本）。
- 触发无关键词匹配器：靠 description 的「何时用」表述。

## 流程

1. **捕获意图**：这个 Skill 解决什么重复工作？触发场景一句话说清。
2. **选目录**：`.zcode/skills/`（项目级）。
3. **写 SKILL.md**：
   - frontmatter description 用「…时使用」句式，列出具体触发词/场景。
   - 正文：目标 → 前置 → 流程（可执行步骤）→ 回执。引用 runtime verb 用真实命令（`node .zcode/zbase.mjs <verb>`）。
4. **2-3 个真实测试 prompt**：什么样的用户消息应该触发它？写下来自测。
5. **与用户复盘**：触发可靠吗？流程缺步吗？
6. **迭代**：概括化（别过拟合单场景）、保持精瘦（能删则删）、解释 why（关键步附一句为什么）。

## 纪律

- 修订现有 Skill 前先读原文，风格无缝贴合（存量资产铁律）。
- 新 Skill 建立后：`node .zcode/zbase.mjs manifest generate`（安装面变化）+ progress.md 记录。
- 命名冲突检查：`.zcode/skills/` 内避免同名 skill（同名按 zcode 发现顺序遮蔽）。

## 回执

Skill 路径 + frontmatter + 测试 prompt 清单 + manifest 更新证据。
