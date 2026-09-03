// 重构批次 6 测试（源 cc 8bb579b authorship / 248219a run-all / 8af3e2c golden 模式）：
// ① review verdict authorship 判定（同 executor 拒绝 ACCEPT 点名职责隔离红线 / 不同 executor 放行 /
//    无标识 enforced:false 写明缺哪半——两半各自可缺 / 非法标识拒 / status 透出 / ACCEPT 回执带判定）；
// ② run-all 本地 CI 复刻（--list 序列：固定首尾 + gate 步从 verification-matrix 动态同源 / npm script 接线）；
// ③ golden 行为尺子（遮罩有效性：diffHash/fingerprint 刻意不遮、chainHash 遮 / 场景表契约 /
//    record→check→篡改→红→删条目→strict 报 missing 的隔离闭环 / 无基线 degraded / 未知 flag 拒）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zbase, mkHarnessProj, rmDir, tempDir, REPO } from './helpers.mjs';
import { maskOutput, SCENARIOS, goldenRecord, goldenCheck } from '../.zcode/lib/golden.mjs';

// ══════════════════ ① authorship 三态 ══════════════════

const CATALOG = { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low', resilience: 'low' }, riskTier: 'low' }] };
const BLUE = JSON.stringify({ claims: [{ claim: '边界路径已验证', evidence: 'node -e 0 → exit 0' }] });

function mkReviewProj() {
  const dir = mkHarnessProj({ catalog: CATALOG });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  return dir;
}

// 全链 review：blue + 三个 lens（payload 可选携带 executor）
function fullChain(dir, executor) {
  assert.equal(zbase(['review', 'start'], { cwd: dir }).code, 0);
  assert.equal(zbase(['review', 'blue'], { cwd: dir, input: BLUE }).code, 0);
  for (const name of ['correctness', 'reliability', 'resilience']) {
    const r = zbase(['review', 'lens', name], { cwd: dir, input: JSON.stringify({ ...(executor ? { executor } : {}), findings: [] }) });
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
}

function implReceipt(dir, executor) {
  const r = zbase(['receipt', 'write', '--check', 'impl', '--status', 'PASS', ...(executor ? ['--executor', executor] : [])], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
}

function ledgerLast(dir) {
  const lines = fs.readFileSync(path.join(dir, '.zcode', 'state', 'ledger.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  return JSON.parse(lines[lines.length - 1]);
}

test('B6-A1 同 executor：lens 报告者=实现回执执行者 → 拒绝 ACCEPT，点名职责隔离红线（exit 1）', () => {
  const dir = mkReviewProj();
  implReceipt(dir, 'implementer');
  fullChain(dir, 'implementer'); // 评审者用了与实现回执相同的标识
  const r = zbase(['review', 'verdict', '--json'], { cwd: dir });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const j = r.json;
  assert.equal(j.ok, false);
  assert.ok(j.blockers.some((b) => /评审者=实现者（职责隔离红线）/.test(b) && /implementer/.test(b)), JSON.stringify(j.blockers));
  assert.equal(j.authorship.enforced, true);
  assert.equal(j.authorship.conflict.executor, 'implementer');
  // 拒绝时不得落 ACCEPT 回执：账本最后一条不是 review PASS
  assert.notEqual(ledgerLast(dir).content.check, 'review');
  rmDir(dir);
});

test('B6-A2 不同 executor：评审者≠实现者 → ACCEPT 放行 + authorshipEnforced:true + 回执带判定', () => {
  const dir = mkReviewProj();
  implReceipt(dir, 'implementer');
  fullChain(dir, 'code-reviewer');
  const r = zbase(['review', 'verdict', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const j = r.json;
  assert.equal(j.verdict, 'ACCEPT');
  assert.equal(j.isFinal, true);
  assert.equal(j.authorship.enforced, true);
  assert.equal(j.authorship.conflict, null);
  assert.deepEqual(j.authorship.implExecutors, ['implementer']);
  // session 留痕 + ACCEPT 回执 extra 带判定（透明：completion 门消费方可见）
  const receipt = ledgerLast(dir);
  assert.equal(receipt.content.check, 'review');
  assert.equal(receipt.content.authorshipEnforced, true);
  const session = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'review', 'session.json'), 'utf8'));
  assert.equal(session.verdict.authorshipEnforced, true);
  rmDir(dir);
});

test('B6-A3 数据缺（lens 半）：lens 无 executor 标识 → verdict 照常 ACCEPT + enforced:false 写明缺哪半', () => {
  const dir = mkReviewProj();
  implReceipt(dir, 'implementer'); // 实现回执半在
  fullChain(dir, null); // lens 半缺
  const r = zbase(['review', 'verdict', '--json'], { cwd: dir });
  assert.equal(r.code, 0, '诚实缺失不阻断');
  const j = r.json;
  assert.equal(j.verdict, 'ACCEPT');
  assert.equal(j.authorship.enforced, false);
  assert.equal(j.authorship.missing.length, 1);
  assert.match(j.authorship.missing[0], /lens-executor/);
  const session = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'review', 'session.json'), 'utf8'));
  assert.equal(session.verdict.authorshipEnforced, false);
  assert.ok((session.verdict.authorshipMissing || []).some((m) => /lens-executor/.test(m)));
  rmDir(dir);
});

test('B6-A4 数据缺（实现回执半）：lens 带标识但账本无同 diff 的 executorRole 回执 → enforced:false 写明', () => {
  const dir = mkReviewProj();
  // 不落任何带 executor 的实现回执
  fullChain(dir, 'code-reviewer');
  const r = zbase(['review', 'verdict', '--json'], { cwd: dir });
  assert.equal(r.code, 0, '诚实缺失不阻断');
  const j = r.json;
  assert.equal(j.verdict, 'ACCEPT');
  assert.equal(j.authorship.enforced, false);
  assert.ok(j.authorship.missing.some((m) => /impl-receipt-executor/.test(m)), JSON.stringify(j.authorship.missing));
  rmDir(dir);
});

test('B6-A5 非法 executor 标识：词表校验拒（exit 1，与 gate --executor 同词表报错）', () => {
  const dir = mkReviewProj();
  zbase(['review', 'start'], { cwd: dir });
  zbase(['review', 'blue'], { cwd: dir, input: BLUE });
  const r = zbase(['review', 'lens', 'correctness'], { cwd: dir, input: JSON.stringify({ executor: 'Bad Role', findings: [] }) });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /非法 lens executor 标识/);
  rmDir(dir);
});

test('B6-A6 review status 透出 lensExecutors 与 verdict 判定留痕', () => {
  const dir = mkReviewProj();
  fullChain(dir, 'auditor-a');
  const mid = zbase(['review', 'status', '--json'], { cwd: dir });
  assert.deepEqual(mid.json.lensExecutors, { correctness: 'auditor-a', reliability: 'auditor-a', resilience: 'auditor-a' });
  assert.equal(zbase(['review', 'verdict', '--json'], { cwd: dir }).code, 0);
  const after = zbase(['review', 'status', '--json'], { cwd: dir });
  assert.equal(after.json.verdict.authorshipEnforced, false); // 无实现回执半：判定留痕为 false 而非缺省
  rmDir(dir);
});

// ══════════════════ ② run-all 本地 CI 复刻 ══════════════════

test('B6-R1 run-all --list：固定首尾 + gate 步与 verification-matrix 带 command 的 checks 同源', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, '.zcode', 'scripts', 'run-all.mjs'), '--list'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const names = r.stdout.split('\n').filter((l) => l.trim()).map((l) => l.split('\t')[0]);
  // 首尾对齐 gate.yml 序列（selftest 先行、dod 收口）
  assert.equal(names[0], 'selftest');
  assert.equal(names[names.length - 1], 'dod');
  // gate 步动态取自 matrix（唯一事实源：不硬编码清单，与 CI 的 Quality gates 步同源）
  const matrix = JSON.parse(fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'verification-matrix.json'), 'utf8'));
  const expected = new Set(matrix.checks.filter((c) => c.command).map((c) => `gate ${c.name}`));
  const actual = new Set(names.filter((n) => n.startsWith('gate ')));
  assert.deepEqual(actual, expected, 'gate 步必须恰好覆盖 matrix 带 command 的 checks（无硬编码漂移）');
  // 发版面与 CI 特有步骤不进序列（取舍写明：release 不混入日常回归）
  assert.ok(!names.some((n) => /release|ci-status|install/.test(n)));
});

test('B6-R2 package.json scripts.run-all 接线', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['run-all'], 'node .zcode/scripts/run-all.mjs');
});

// ══════════════════ ③ golden 行为尺子 ══════════════════

const HEX64 = 'a'.repeat(64);
const HEX64B = 'b'.repeat(64);

test('B6-G1 遮罩有效性：TS/MS/ID/SEQ/TMP/UUID/HASH 遮，diffHash/fingerprint 刻意不遮', () => {
  const tmp = '/tmp/zbase-golden-Xx1';
  const raw = [
    `startedAt: 2026-09-02T10:11:12.345Z`,
    `elapsed: 1723ms wall / 45.5ms cpu`,
    `epoch: 1759380000000`,
    `task id: t-lx9abc123 w-ab12cd34`,
    `"seq": 412 receiptSeq: 7 throughSeq=399`,
    `diffHash: ${HEX64}`,
    `"fingerprint": "${HEX64}"`,
    `canonicalDiff ${HEX64}`,
    `chainHash: ${HEX64B}`,
    `evidenceHash ${HEX64B}`,
    `path: ${tmp}/.zcode/state/x.log`,
    `windowId: 3f2a1b9c-0d1e-4f2a-9b3c-7d8e9f0a1b2c`,
  ].join('\n');
  const m = maskOutput(raw, { tmp });
  assert.match(m, /startedAt: <TS>/);
  assert.match(m, /elapsed: <MS> wall \/ <MS> cpu/);
  assert.match(m, /epoch: <MS>/);
  assert.match(m, /task id: <ID> <ID>/);
  assert.match(m, /"seq": <SEQ> receiptSeq: <SEQ> throughSeq=<SEQ>/);
  assert.ok(m.includes(`diffHash: ${HEX64}`), 'diffHash 刻意不遮——遮了测不出 canonicalDiff 被改坏（cc 教训）');
  assert.ok(m.includes(`"fingerprint": "${HEX64}"`), 'fingerprint 刻意不遮');
  assert.ok(m.includes(`canonicalDiff ${HEX64}`), 'canonicalDiff 刻意不遮');
  assert.match(m, new RegExp(`chainHash: <HASH>`));
  assert.match(m, /evidenceHash <HASH>/, 'evidenceHash 遮（随运行内容变化，不属于 diffHash 类保留名单）');
  assert.match(m, /path: <TMP>\/\.zcode\/state\/x\.log/);
  assert.match(m, /windowId: <UUID>/);
  // 遮罩后不含裸时间戳/裸 64hex（保留名单之外）
  assert.doesNotMatch(m, /\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(m, new RegExp(`(?<!diffHash: |"fingerprint": "|canonicalDiff )${HEX64B}`));
});

test('B6-G2 场景表契约：id 唯一、两类形态、数量在尺子设计区间', () => {
  const ids = SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, '场景 id 必须唯一');
  assert.ok(SCENARIOS.length >= 15 && SCENARIOS.length <= 25, `场景数 ${SCENARIOS.length} 应在 15-25`);
  for (const s of SCENARIOS) {
    assert.ok(['repo', 'sandbox'].includes(s.kind), `${s.id} kind 非法`);
    assert.ok(Array.isArray(s.args) && s.args.length > 0, `${s.id} 必须带 args`);
  }
  assert.ok(SCENARIOS.some((s) => s.kind === 'repo'), '必须有本仓只读面场景');
  assert.ok(SCENARIOS.some((s) => s.kind === 'sandbox'), '必须有沙箱仓写面场景');
});

test('B6-G3 隔离闭环：record→check 双绿 → 篡改 exit code 红 → 还原', () => {
  const baselineFile = path.join(tempDir('golden'), 'baseline.json');
  const subset = SCENARIOS.filter((s) => ['sandbox-review-verdict-no-session', 'sandbox-budget-dirty'].includes(s.id));
  assert.equal(subset.length, 2);
  const rec = goldenRecord({ scenarios: subset, baselineFile });
  assert.equal(rec.ok, true, JSON.stringify(rec));
  assert.equal(rec.recorded, 2);
  assert.ok(rec.bytes > 0);
  const ok1 = goldenCheck({ strict: true, scenarios: subset, baselineFile });
  assert.equal(ok1.ok, true, JSON.stringify(ok1));
  assert.equal(ok1.compared, 2);
  // 篡改实验：改基线一个场景的 exit code → check 红（尺子测的是行为面，exit code 是行为）
  const raw = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  raw.scenarios['sandbox-budget-dirty'].exitCode = 0 === raw.scenarios['sandbox-budget-dirty'].exitCode ? 1 : 0;
  fs.writeFileSync(baselineFile, `${JSON.stringify(raw, null, 2)}\n`);
  const bad = goldenCheck({ strict: true, scenarios: subset, baselineFile });
  assert.equal(bad.ok, false);
  assert.equal(bad.diffCount, 1);
  assert.equal(bad.diffs[0].id, 'sandbox-budget-dirty');
  assert.notEqual(bad.diffs[0].exitCode.baseline, bad.diffs[0].exitCode.current);
  // 还原 → 复绿
  const rec2 = goldenRecord({ scenarios: subset, baselineFile });
  assert.equal(rec2.ok, true);
  assert.equal(goldenCheck({ strict: true, scenarios: subset, baselineFile }).ok, true);
  rmDir(path.dirname(baselineFile));
});

test('B6-G4 strict 双向校验：场景被删（基线有条目、场景表没有）→ missingInTable 照报不假绿', () => {
  const baselineFile = path.join(tempDir('golden2'), 'baseline.json');
  const two = SCENARIOS.filter((s) => ['sandbox-review-verdict-no-session', 'sandbox-budget-dirty'].includes(s.id));
  assert.equal(goldenRecord({ scenarios: two, baselineFile }).ok, true);
  // 场景表删掉一个：交集比对会静默漏掉单侧漂移——strict 必须报
  const one = two.slice(0, 1);
  const r = goldenCheck({ strict: true, scenarios: one, baselineFile });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingInTable, ['sandbox-budget-dirty']);
  assert.deepEqual(r.missingInBaseline, []);
  // 反向：场景表新增未 record → missingInBaseline
  const r2 = goldenCheck({ strict: true, scenarios: two.concat([{ id: 'brand-new', kind: 'sandbox', args: ['review', 'verdict'] }]), baselineFile });
  assert.equal(r2.ok, false);
  assert.deepEqual(r2.missingInBaseline, ['brand-new']);
  rmDir(path.dirname(baselineFile));
});

test('B6-G5 无基线 → degraded（rc 3 语义在 CLI 层）；未知 flag → usage 拒（golden 进 SUBCOMMAND_FLAGS 表）', () => {
  const dir = tempDir('golden3');
  const none = goldenCheck({ baselineFile: path.join(dir, 'nope.json') });
  assert.equal(none.degraded, true);
  assert.match(none.reason, /基线不存在/);
  rmDir(dir);
  const r = zbase(['golden', 'check', '--bogus']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /未知 flag/);
  const r2 = zbase(['golden', 'record', '--strict']);
  assert.equal(r2.code, 1, '--strict 只属于 check 子命令：record 面不认识即拒（白名单细分）');
});
