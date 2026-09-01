// live 路由行为测试断言库（Task 10.3，源 cc-base §H tests/test-helpers.sh 方法论移植，零 LLM 依赖）。
//
// 验证面：宪法「1% 即调」与「逃逸借口拦截」目前只有 prompt 约束、零行为验证——本库消费
// headless 会话事件流（JSONL，每行一个事件），断言「该调的 skill 真被调了吗？调 skill 前有没有偷跑？」。
//
// OQ-5（未决）：ZCode 是否有 headless CLI + 事件流日志（stream-json 等价）。本库与 fixtures
// 按当前 ZCode 工具调用 JSON 形态构造——{"type":"tool_use","name":"Skill","input":{"skill":"x"}} 式；
// 真实 headless 事件流的字段名/信封结构待实测校准后再对齐（见 cases/README.md）。
// 断言只依赖三个字段：type==='tool_use'、name（工具名）、input.skill（Skill 调用的目标 skill）——
// 校准面被刻意压到最小。
//
// 设计纪律（cc cross-line-decoupled 教训）：
//   - assertSkillInvoked 锁同一 tool_use 事件：skill 名必须出现在该事件的 input.skill 上，
//     在别的事件文本里被提到不算（裸 grep 两次独立匹配会假绿）。
//   - 断言失败=throw（带定位信息）；静默返回 false 是假绿的温床。
//   - loadEvents 对坏行 throw（fail-visible）：解析失败不是「没有事件」。
import fs from 'node:fs';

/** 解析事件流 JSONL。坏行 throw（带行号）——fail-visible，不静默跳过。 */
export function loadEvents(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const events = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch (e) {
      throw new Error(`事件流坏行（${file}:${i + 1}）：${e.message}——解析失败不是「没有事件」`);
    }
    events.push(ev);
  }
  return events;
}

/** 全部 tool_use 事件（顺序即调用顺序）。 */
export function toolUseEvents(events) {
  return events.filter((e) => e && e.type === 'tool_use' && typeof e.name === 'string');
}

/** 全部 Skill 调用（tool_use 且 name==='Skill'）。 */
export function skillInvocations(events) {
  return toolUseEvents(events).filter((e) => e.name === 'Skill');
}

function firstIndexOfToolUse(events, toolName) {
  return events.findIndex((e) => e && e.type === 'tool_use' && e.name === toolName);
}

/**
 * 断言目标 skill 真的被 Skill 工具调用了——锁同一 tool_use 事件：
 * skill 名必须出现在该事件的 input.skill 上。skill 名只在别的事件文本里被提及
 * （cross-line-decoupled 对抗形态）必须 FAIL，并显式给出该诊断。
 */
export function assertSkillInvoked(events, skillName) {
  const hits = skillInvocations(events).filter((e) => e.input && e.input.skill === skillName);
  if (hits.length > 0) return true;
  // 区分两种失败形态，给可行动的诊断
  const invoked = skillInvocations(events).map((e) => e.input?.skill).filter(Boolean);
  const mentionedElsewhere = events.some((e) => !(e.type === 'tool_use' && e.name === 'Skill') && JSON.stringify(e).includes(skillName));
  if (mentionedElsewhere) {
    throw new Error(`assertSkillInvoked FAIL（cross-line-decoupled）：skill "${skillName}" 只在别的事件文本中被提及，没有任何 Skill tool_use 的 input.skill 等于它——裸 grep 两次独立匹配会在这里假绿；实际调用的 skill：${invoked.length ? invoked.join(', ') : '（无）'}`);
  }
  throw new Error(`assertSkillInvoked FAIL：全程没有调用 skill "${skillName}"${invoked.length ? `（实际调用了：${invoked.join(', ')}）` : '（没有任何 Skill 调用）'}`);
}

/**
 * 断言首个 Skill 调用前没有偷跑：第一个 Skill tool_use 之前的 tool_use 必须全部在
 * allowedBefore 白名单内（默认 Skill/TodoWrite/Read——计划与阅读不算行动）；
 * 白名单外的 tool_use 残留 = 偷跑 FAIL；全程无 Skill 调用也 FAIL（该调不调本身就是失败）。
 */
export function assertNoPrematureAction(events, allowedBefore = ['Skill', 'TodoWrite', 'Read']) {
  const toolUses = toolUseEvents(events);
  const firstSkill = firstIndexOfToolUse(events, 'Skill');
  if (firstSkill === -1) {
    throw new Error(`assertNoPrematureAction FAIL：全程没有任何 Skill 调用——「1% 即调」被整个跳过（白名单 ${allowedBefore.join('/')} 之前之后都无所谓，skill 根本没上场）`);
  }
  const before = events.slice(0, firstSkill).filter((e) => e && e.type === 'tool_use');
  const premature = before.filter((e) => !allowedBefore.includes(e.name));
  if (premature.length > 0) {
    throw new Error(`assertNoPrematureAction FAIL：首个 Skill 调用前存在白名单外 tool_use（偷跑）：${premature.map((e) => `${e.name}#${events.indexOf(e) + 1}`).join(', ')}——允许的先行动作仅 ${allowedBefore.join('/')}`);
  }
  return true;
}

/** 断言 firstName 的首次 tool_use 严格早于 secondName 的首次（两者都必须存在）。 */
export function assertOrder(events, firstName, secondName) {
  const a = firstIndexOfToolUse(events, firstName);
  const b = firstIndexOfToolUse(events, secondName);
  if (a === -1) throw new Error(`assertOrder FAIL：没有任何 ${firstName} tool_use`);
  if (b === -1) throw new Error(`assertOrder FAIL：没有任何 ${secondName} tool_use`);
  if (a >= b) throw new Error(`assertOrder FAIL：${firstName}（事件 #${a + 1}）未早于 ${secondName}（事件 #${b + 1}）`);
  return true;
}

/** 简单包含断言（文本/输出面）。 */
export function assertContains(text, needle) {
  const hay = String(text ?? '');
  if (!hay.includes(needle)) throw new Error(`assertContains FAIL：找不到 "${needle}"（前 200 字符：${hay.slice(0, 200)}）`);
  return true;
}
