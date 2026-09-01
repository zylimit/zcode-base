// Phase 10 R6b 机制测试（Task 10.2 自我插桩 effectiveness）：
// - 每规则 {deny, observe, allow} 计数 + other（非三态动作计数不丢弃）+ lastTriggered（append-only 后到即最新）
// - unexercised 判定：阻断类事件（PreToolUse/PermissionRequest/Stop）上 deny===0 且非 pass-through
//   （'ok' 放行留痕 deny===0 是设计不是死闸；清单可经 harness.json effectiveness.passThroughRules 扩展）
// - 脱敏留痕卫生：报告输出的规则名过 redactSecrets（与 logGate 入口对称）
// - blindSpot 显式标注：从未触发的规则零留痕零计数，不在账上（不假装全知）
// 隔离构造：mkHarnessProj 临时项目内写 gate-log，不碰本仓真实留痕。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zbase, mkHarnessProj, rmDir } from './helpers.mjs';
import { effectiveness } from '../.zcode/lib/quality.mjs';

// 真实 gate-log 行形态（与 hooks.mjs logGate 落账一致）
const gate = (ts, event, rule, action, extra = {}) => ({ ts, event, rule, action, ...extra });

// ---------- 纯派生：计数 / lastTriggered / other ----------

test('10.2 effectiveness：每规则 {deny,observe,allow} 计数正确 + other 计非三态动作 + lastTriggered 取最新', () => {
  const res = effectiveness({ entries: [
    gate('2026-09-01T10:00:00Z', 'PreToolUse', 'rm-rf-root', 'deny'),
    gate('2026-09-01T10:05:00Z', 'PreToolUse', 'rm-rf-root', 'deny'),
    gate('2026-09-01T10:10:00Z', 'PreToolUse', 'rm-rf-root', 'observe'),
    gate('2026-09-01T10:15:00Z', 'PreToolUse', 'rm-rf-root', 'allow'),
    gate('2026-09-01T10:20:00Z', 'Stop', 'stop-gate', 'deny'),
    gate('2026-09-01T10:25:00Z', 'Stop', 'stop-gate', 'exhausted'), // 三振放行：非三态动作
    gate('2026-09-01T10:30:00Z', 'UserPromptSubmit', 'feedback-signal', 'observe'),
  ] });
  const byKey = new Map(res.rules.map((r) => [r.key, r]));
  const rm = byKey.get('PreToolUse:rm-rf-root');
  assert.equal(rm.deny, 2, 'deny 计数');
  assert.equal(rm.observe, 1, 'observe 计数');
  assert.equal(rm.allow, 1, 'allow 计数');
  assert.equal(rm.other, 0);
  assert.equal(rm.total, 4);
  assert.equal(rm.lastTriggered, '2026-09-01T10:15:00Z', 'lastTriggered=最后一条该规则留痕的 ts');
  const sg = byKey.get('Stop:stop-gate');
  assert.equal(sg.other, 1, 'exhausted 等非三态动作计入 other（计数不丢弃）');
  assert.equal(sg.lastTriggered, '2026-09-01T10:25:00Z');
  assert.ok(res.actionsSeen.includes('exhausted'), 'actionsSeen 收录全部出现过的动作词');
  assert.equal(res.totalEvents, 7);
});

// ---------- unexercised 判定 ----------

test('10.2 effectiveness：unexercised=阻断类事件上从未 deny 的规则；pass-through 与非阻断事件不计入', () => {
  const res = effectiveness({ entries: [
    gate('2026-09-01T10:00:00Z', 'PreToolUse', 'never-denied-rule', 'observe'), // 阻断事件+从未 deny → unexercised
    gate('2026-09-01T10:01:00Z', 'PreToolUse', 'ok', 'observe'),                 // pass-through（放行留痕）→ 不计
    gate('2026-09-01T10:02:00Z', 'PermissionRequest', 'ok', 'observe'),          // pass-through → 不计
    gate('2026-09-01T10:03:00Z', 'PostToolUse', 'executed', 'observe'),          // 非阻断事件 → 不计
    gate('2026-09-01T10:04:00Z', 'Stop', 'stop-gate', 'deny'),                   // 拦过 → 不计
    gate('2026-09-01T10:05:00Z', 'PermissionRequest', 'sudo', 'deny'),
  ] });
  assert.deepEqual(res.unexercised.map((r) => r.key), ['PreToolUse:never-denied-rule']);
  assert.ok(res.summary.includes('闸要能说出它挡住过什么'), '摘要带判据文案');
  assert.ok(res.blindSpot.includes('从未触发'), '盲区显式标注：零留痕规则不在账上');
});

// ---------- 脱敏留痕卫生 ----------

test('10.2 effectiveness：报告输出的规则名过 redactSecrets（token 形规则名不得原样出口）', () => {
  // token 运行期拼装，防自家 pre-commit/发布扫描命中测试源码
  const tok = ['sk-abcde', 'fghijklmnopqr'].join('');
  const res = effectiveness({ entries: [
    gate('2026-09-01T10:00:00Z', 'PreToolUse', `leak-${tok}`, 'deny'),
  ] });
  const r = res.rules[0];
  assert.ok(!r.rule.includes(tok), '秘密模式不得原样出现在报告');
  assert.ok(r.key.includes('[REDACTED]'), '命中脱敏模式被替换');
});

// ---------- CLI + 隔离项目：构造 gate-log → 计数正确 → unexercised 判定 ----------

test('10.2 effectiveness 子命令：隔离目录构造 gate-log，--json 输出计数与 unexercised（exit 0）', () => {
  const dir = mkHarnessProj();
  try {
    const lines = [
      { ts: '2026-09-01T10:00:00Z', event: 'PreToolUse', tool: 'Bash', rule: 'rm-rf-root', action: 'deny', preview: 'rm -rf /', reason: '危险命令' },
      { ts: '2026-09-01T10:01:00Z', event: 'PreToolUse', tool: 'Bash', rule: 'rm-rf-root', action: 'deny', preview: 'rm -rf /tmp/x /' },
      { ts: '2026-09-01T10:02:00Z', event: 'PreToolUse', tool: 'Bash', rule: 'ok', action: 'observe', preview: 'ls -la' },
      { ts: '2026-09-01T10:03:00Z', event: 'PreToolUse', tool: 'Bash', rule: 'shell-semantic', action: 'observe', preview: 'sudo npm test' },
      { ts: '2026-09-01T10:04:00Z', event: 'PostToolUse', tool: 'Bash', rule: 'executed', action: 'observe', preview: 'ls -la' },
    ];
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'gate-log.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = zbase(['effectiveness', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `exit 0（说明性报告不阻断）；stderr=${r.stderr}`);
    const res = r.json;
    assert.equal(res.totalEvents, 5);
    const byKey = new Map(res.rules.map((x) => [x.key, x]));
    assert.equal(byKey.get('PreToolUse:rm-rf-root').deny, 2, '构造计数正确');
    assert.deepEqual(res.unexercised.map((x) => x.key), ['PreToolUse:shell-semantic'], '从未 deny 的阻断类规则入 unexercised；ok/executed 不入');
  } finally {
    rmDir(dir);
  }
});

test('10.2 effectiveness：harness.json effectiveness.passThroughRules 扩展 pass-through 清单', () => {
  const dir = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify({ effectiveness: { passThroughRules: ['advisory-note'] } }));
    const r = zbase(['effectiveness', '--json'], { cwd: dir });
    assert.equal(r.code, 0);
    // 无 gate-log → 空账不失败；写一条 advisory-note observe 后该规则不进 unexercised
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'gate-log.jsonl'),
      `${JSON.stringify(gate('2026-09-01T10:00:00Z', 'PreToolUse', 'advisory-note', 'observe'))}\n${JSON.stringify(gate('2026-09-01T10:01:00Z', 'PreToolUse', 'unknown-blocking', 'observe'))}\n`);
    const r2 = zbase(['effectiveness', '--json'], { cwd: dir });
    const res = r2.json;
    assert.deepEqual(res.unexercised.map((x) => x.key), ['PreToolUse:unknown-blocking'], '扩展清单内的规则不计 unexercised，清单外照常计');
  } finally {
    rmDir(dir);
  }
});
