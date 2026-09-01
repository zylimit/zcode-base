# live 路由行为测试——case 目录（骨架，Task 10.3）

live 层验证宪法最大未验证面：**「该调的 skill 真会被调吗？调 skill 前有没有偷跑？」**。
静态一致性检查（`zbase test-routing`：宪法声明 ↔ 磁盘双向）只证明规则写对了，不证明模型真的照做；
本目录放真跑宿主 CLI 拿事件日志断言的 case（源 cc-base §H 三层金字塔的第三层）。

## 前置：OQ-5（未决，阻塞真 case）

**ZCode 是否有 headless CLI（claude -p 等价）+ 事件流日志（stream-json 等价）？**

- 有 → 按 cc 形态落 case：headless 跑一条用户消息 → 事件流 JSONL → 喂给
  `tests/routing/test-helpers.mjs` 断言（assertSkillInvoked / assertNoPrematureAction）。
  **字段名需实测校准**：断言库只依赖 `type==='tool_use'` / `name` / `input.skill` 三个字段，
  校准面已刻意压到最小；若真实事件流的工具调用是嵌在 assistant 消息里的
  （`message.content[].type==='tool_use'` 式信封），在校准层拍平后再入断言库，不改断言语义。
- 没有 → 本目录保持骨架，selftest 层（`tests/routing-selftest.test.mjs`）持续守护断言库本身。

## 运行开关：RUN_LIVE_ROUTING=1

live case **默认 opt-out**（防烧 token）：只有环境变量 `RUN_LIVE_ROUTING=1` 时才执行；
未设置时 case 整体 SKIP。SKIP ≠ PASS——runner 汇总里必须显式可见，不许混进通过数。

## 环境探针设计（第一个 case 兼任探针，cc 亲测过的坑）

cc-base 在 OAuth/LiteLLM 代理环境下 headless CLI **不产生任何 Skill 事件**——live case 全 FAIL
但并非路由回归（cc progress Decisions：判影响面的准绳是「改动是否触碰路由规则文件」）。
因此第一个 case 必须兼任环境探针：

1. 认证失败 / CLI 不存在 → **SKIP 全部 live case**，诊断写明失败原因（带原始 stderr 摘要）；
2. 跑通但事件流中零 Skill 事件 → **SKIP 全部**，诊断标注「宿主环境不产 Skill 事件（代理已知坑）」；
3. 探针通过 → 其余 case 正常断言，FAIL 即真 FAIL。

判影响面纪律：只有改动触碰**路由规则文件**（AGENTS.md 工作流路由表 / skills/*/SKILL.md 的
触发描述 / commands）时才需要跑 live 层。

## case 命名与结构（OQ-5 落地后照此添加）

- `todo-app-triggers-product-spec.sh|mjs`：模糊产品想法 → 断言 product-spec-builder 被调、
  Skill 前无偷跑（白名单 Skill/TodoWrite/Read）。
- `bug-report-triggers-bug-fixer.sh|mjs`：报障 → 断言 bug-fixer 被调。
- 每个 case：headless 跑 → 事件流落临时文件 → 复用 `../test-helpers.mjs` 断言（零重复实现）。
