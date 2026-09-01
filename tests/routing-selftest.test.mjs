// Task 10.3 断言库自验（selftest 层，源 cc §H：无需 LLM，fixture 驱动验证断言函数本身判得对）。
// 位置说明：launcher 只扫 tests/*.test.mjs 顶层（不递归），故本文件放顶层、命名 routing-selftest；
// 断言库与 fixtures 在 tests/routing/。
// 失败判据（cc 教训）：断言库把偷跑/跨行解耦误判 PASS 才算 selftest 失败——
// 下方所有 assert.throws 正是锁这个：断言库若退化为裸 grep 假绿，assert.throws 落空 → 本文件红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { loadEvents, assertSkillInvoked, assertNoPrematureAction, assertOrder, assertContains } from './routing/test-helpers.mjs';

const FIXTURES = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'routing', 'fixtures');
const fixture = (name) => loadEvents(path.join(FIXTURES, name));

// ---------- good-run：正确路由样本 → 全过 ----------

test('10.3 good-run：skill 真被调用（锁同一 tool_use）+ 无偷跑 + 顺序正确', () => {
  const events = fixture('good-run.jsonl');
  assert.equal(assertSkillInvoked(events, 'product-spec-builder'), true);
  assert.equal(assertNoPrematureAction(events), true, 'TodoWrite/Read 在白名单内，Write 在 Skill 之后');
  assert.equal(assertOrder(events, 'Skill', 'Write'), true, '先调 skill 再动手写');
});

// ---------- premature-run：偷跑样本 → assertNoPrematureAction 必须 FAIL ----------

test('10.3 premature-run：Skill 前的 Edit 业务码 = 偷跑，必须 FAIL 并点名残留工具', () => {
  const events = fixture('premature-run.jsonl');
  assert.equal(assertSkillInvoked(events, 'bug-fixer'), true, 'skill 本身调对了——失败仅在偷跑');
  assert.throws(() => assertNoPrematureAction(events), (e) => {
    assert.match(e.message, /偷跑/);
    assert.match(e.message, /Edit/, '点名偷跑的工具');
    return true;
  }, '断言库若把偷跑误判 PASS（静默放行），本 selftest 失败');
  // 收紧白名单后 Read 也成偷跑：白名单语义可调
  assert.throws(() => assertNoPrematureAction(events, ['Skill', 'TodoWrite']), /Read/);
});

// ---------- cross-line-decoupled：对抗样本 → assertSkillInvoked 必须 FAIL ----------

test('10.3 cross-line-decoupled：skill 名只在别的事件文本出现，必须 FAIL（裸 grep 假绿防线）', () => {
  const events = fixture('cross-line-decoupled.jsonl');
  // 对抗性质非空：流里确实有 '"name":"Skill"' 的行，也确实到处都是 'bug-fixer' 字样——
  // 裸 grep 两次独立匹配（有 Skill 调用 && 提到过 bug-fixer）会在这里假绿。
  const raw = fs.readFileSync(path.join(FIXTURES, 'cross-line-decoupled.jsonl'), 'utf8');
  assert.ok(raw.includes('"name":"Skill"'), 'fixture 前提：存在 Skill tool_use 行');
  assert.ok(raw.includes('bug-fixer'), 'fixture 前提：skill 名确实在流中出现过（只是不在 Skill 的 input.skill 上）');
  assert.throws(() => assertSkillInvoked(events, 'bug-fixer'), (e) => {
    assert.match(e.message, /cross-line-decoupled/, '给出跨行解耦诊断而非笼统未调用');
    return true;
  }, '断言库若退化为裸 grep，本 selftest 失败');
  // 实际调用的 skill 判得对：zbase-core 确实被调
  assert.equal(assertSkillInvoked(events, 'zbase-core'), true);
});

// ---------- 边界：全程无 Skill / 坏行 fail-visible / assertOrder / assertContains ----------

test('10.3 全程无 Skill 调用：assertNoPrematureAction 也 FAIL（该调不调本身就是失败）', () => {
  const events = fixture('good-run.jsonl').filter((e) => !(e.type === 'tool_use' && e.name === 'Skill'));
  assert.throws(() => assertNoPrematureAction(events), /没有任何 Skill 调用/);
  assert.throws(() => assertSkillInvoked(events, 'product-spec-builder'), /没有任何 Skill 调用|没有调用 skill|cross-line-decoupled/, 'skill 名残留在文本里 → 跨行解耦诊断也算 FAIL（同样不许假绿）');
});

test('10.3 loadEvents 坏行 throw（fail-visible：解析失败不是「没有事件」）', () => {
  const bad = path.join(FIXTURES, '..', '.tmp-bad-line.jsonl');
  fs.writeFileSync(bad, '{"type":"text","text":"ok"}\n{not json\n');
  try {
    assert.throws(() => loadEvents(bad), /坏行.*2/);
  } finally {
    fs.rmSync(bad, { force: true });
  }
});

test('10.3 assertOrder/assertContains 基本判定', () => {
  const events = fixture('good-run.jsonl');
  assert.equal(assertOrder(events, 'TodoWrite', 'Skill'), true);
  assert.throws(() => assertOrder(events, 'Write', 'Skill'), /未早于/);
  assert.throws(() => assertOrder(events, 'Bash', 'Skill'), /没有任何 Bash/);
  assert.equal(assertContains('闸要能说出它挡住过什么', '挡住过'), true);
  assert.throws(() => assertContains('abc', 'xyz'), /assertContains FAIL/);
});
