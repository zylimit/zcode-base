// Phase 8 R4b 机制测试（Task 8.3/8.4）：
// verification plan（组队推导/保守扩散/依赖闭包/环检测/空计划阻断/CHECK_NOT_PLANNED/依赖与平台 BLOCKED/资源锁/planHash）
// + evidence 三重完整性（写入/篡改/缺失/路径逃逸/脱敏）+ retention 引用保护 + 账本轮转 anchor + gate-log 尺寸轮转。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const ZCODE_SRC = path.resolve(new URL('.', import.meta.url).pathname, '..', '.zcode');
const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');

function mkproj({ catalog, matrix, harness } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r4b-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true }); // 运行态不随测试项目拷贝
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  if (harness) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify(harness));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch {}
  return dir;
}

function run(cwd, args, stdin = '', env = {}) {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function ledgerLines(dir) {
  return fs.readFileSync(path.join(dir, '.zcode', 'state', 'ledger.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function startTask(dir, { risk = 'medium', owned = 'src/**' } = {}) {
  const t = run(dir, ['task', 'start', '--input', '-', '--risk', risk, '--owned', owned, '--json'], JSON.stringify(ENVELOPE));
  assert.equal(t.status, 0, t.stdout + t.stderr);
  return JSON.parse(t.stdout).task;
}

const CATALOG = {
  version: 1,
  modules: [
    { name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' }, verification: ['app-unit'] },
    { name: 'docs-mod', globs: ['docs/**'], deps: ['app'], attributes: { reliability: 'low' }, verification: ['doc-lint'] },
  ],
};

// ---------- Task 8.3：verification plan ----------

test('8.3 plan 组队推导：risk 起始 + module 并集 + dependency-of 闭包 + 拓扑序 + planHash 稳定', () => {
  const dir = mkproj({
    catalog: CATALOG,
    matrix: {
      version: 1,
      riskChecks: { medium: ['base-check'], high: ['base-check', 'app-unit', 'app-e2e'] },
      checks: [
        { name: 'app-e2e', command: 'true', proves: ['reliability'], scope: [], dependencies: ['prep', 'app-unit'] },
        { name: 'prep', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'base-check', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'app-unit', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'doc-lint', command: 'true', proves: ['reliability'], scope: [] },
      ],
    },
  });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x');
  startTask(dir, { risk: 'medium' });
  const p1 = JSON.parse(run(dir, ['plan', '--json']).stdout);
  assert.equal(p1.ok, true, JSON.stringify(p1));
  assert.equal(p1.empty, false);
  const names = p1.checks.map((c) => c.name);
  // risk 起始组 + 受影响模块并集 + 反向闭包保守扩散：src/** → app；docs-mod 依赖 app（消费者）→ 其 verification 一并入组
  assert.deepEqual([...names].sort(), ['app-unit', 'base-check', 'doc-lint']);
  const baseCheck = p1.checks.find((c) => c.name === 'base-check');
  assert.deepEqual(baseCheck.reasons, ['risk:medium']);
  const appUnit = p1.checks.find((c) => c.name === 'app-unit');
  assert.deepEqual(appUnit.reasons, ['module:app']);
  const docLint = p1.checks.find((c) => c.name === 'doc-lint');
  assert.deepEqual(docLint.reasons, ['module:docs-mod'], '反向闭包消费者的 verification 也入组（保守）');
  assert.ok(p1.planHash, 'planHash 必须存在');
  // planHash 稳定（同输入重复推导一致）
  const p2 = JSON.parse(run(dir, ['plan', '--json']).stdout);
  assert.equal(p2.planHash, p1.planHash);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 plan 依赖闭包 + 拓扑序：high 组队拉入 dependency-of 且依赖在前', () => {
  const dir = mkproj({
    catalog: CATALOG,
    matrix: {
      version: 1,
      riskChecks: { high: ['app-e2e'] },
      checks: [
        { name: 'app-e2e', command: 'true', proves: ['reliability'], scope: [], dependencies: ['prep'] },
        { name: 'prep', command: 'true', proves: ['reliability'], scope: [] },
      ],
    },
  });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x');
  startTask(dir, { risk: 'high' });
  const p = JSON.parse(run(dir, ['plan', '--json']).stdout);
  const names = p.checks.map((c) => c.name);
  assert.deepEqual(names, ['prep', 'app-e2e'], '拓扑序：依赖在前');
  const prep = p.checks.find((c) => c.name === 'prep');
  assert.deepEqual(prep.reasons, ['dependency-of:app-e2e']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 plan 保守扩散：unmapped 路径 → expandedToAll + conservativeChecks + reasons', () => {
  const dir = mkproj({
    catalog: CATALOG,
    matrix: {
      version: 1,
      riskChecks: { medium: ['base-check'] },
      conservativeChecks: ['secret-scan'],
      checks: [
        { name: 'base-check', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'secret-scan', command: 'true', proves: ['security'], scope: [] },
      ],
    },
  });
  startTask(dir);
  // unmapped 路径（根下散落文件，无模块认领、无 catchAll）→ impact 保守扩大到全模块
  fs.writeFileSync(path.join(dir, 'stray.ts'), 'x');
  const p = JSON.parse(run(dir, ['plan', '--json']).stdout);
  assert.equal(p.expandedToAll, true, JSON.stringify(p.degraded));
  const sec = p.checks.find((c) => c.name === 'secret-scan');
  assert.ok(sec, 'conservativeChecks 必须并入');
  assert.ok(sec.reasons.includes('conservative-impact'));
  // 全模块扩散：docs-mod（unmapped 保守扩大）的 verification 也进组队
  const doc = p.checks.find((c) => c.name === undefined ? null : c.name === 'doc-lint');
  if (doc) assert.ok(doc.reasons.includes('module:docs-mod'));
  assert.ok(p.degraded && p.degraded.length > 0, 'degraded 理由必须留痕');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 环检测：MATRIX_CYCLE → plan exit 1 / gate exit 1 / quality verify PLAN_INVALID', () => {
  const dir = mkproj({
    catalog: CATALOG,
    matrix: {
      version: 1,
      riskChecks: { medium: ['a'] },
      checks: [
        { name: 'a', command: 'true', proves: ['reliability'], scope: [], dependencies: ['b'] },
        { name: 'b', command: 'true', proves: ['reliability'], scope: [], dependencies: ['a'] },
      ],
    },
  });
  startTask(dir);
  const p = run(dir, ['plan', '--json']);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /MATRIX_CYCLE/);
  const g = run(dir, ['gate', 'a', '--json']);
  assert.equal(g.status, 1);
  assert.match(g.stdout, /MATRIX_CYCLE/);
  const v = run(dir, ['quality', 'verify', '--json']);
  assert.equal(v.status, 3);
  assert.match(v.stdout, /PLAN_INVALID/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 空计划阻断：plan empty exit 1 + gate EMPTY_PLAN + quality verify blocking + task finish 拦', () => {
  const dir = mkproj({
    catalog: CATALOG, // 模块无本风险档组队来源
    matrix: {
      version: 1,
      riskChecks: { low: ['base-check'] }, // 任务 medium → 起始组为空
      checks: [{ name: 'base-check', command: 'true', proves: ['reliability'], scope: [] }],
    },
  });
  startTask(dir, { risk: 'medium' });
  const p = run(dir, ['plan', '--json']);
  assert.equal(p.status, 1, '空计划是配置失败不是绿灯');
  const po = JSON.parse(p.stdout);
  assert.equal(po.empty, true);
  assert.match(po.note, /EMPTY_PLAN/);
  const g = run(dir, ['gate', 'base-check', '--json']);
  assert.equal(g.status, 1);
  assert.match(g.stdout, /EMPTY_PLAN/);
  const v = run(dir, ['quality', 'verify', '--json']);
  assert.equal(v.status, 3);
  assert.ok(JSON.parse(v.stdout).blocking.some((b) => /EMPTY_PLAN/.test(b.reason)), v.stdout);
  const f = run(dir, ['task', 'finish', '--json']);
  assert.equal(f.status, 3);
  assert.match(f.stdout, /EMPTY_PLAN/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 CHECK_NOT_PLANNED：采纳 matrix 后未组队检查拒绝；未采纳 matrix 保持传统模式（回归面）', () => {
  // 采纳 + 未组队 → 拒绝
  const dir = mkproj({
    catalog: CATALOG,
    matrix: {
      version: 1,
      riskChecks: { medium: ['in-plan'] },
      checks: [
        { name: 'in-plan', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'off-plan', command: 'true', proves: ['reliability'], scope: [] },
      ],
    },
  });
  startTask(dir);
  const denied = run(dir, ['gate', 'off-plan', '--json']);
  assert.equal(denied.status, 1);
  assert.match(denied.stdout, /CHECK_NOT_PLANNED/);
  const allowed = run(dir, ['gate', 'in-plan', '--json']);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).status, 'PASS');
  fs.rmSync(dir, { recursive: true, force: true });

  // 未采纳（无 riskChecks/conservativeChecks/module.verification）→ 传统模式：任务内 gate 照跑
  const dir2 = mkproj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] },
    matrix: { version: 1, checks: [{ name: 'off-plan', command: 'true', proves: ['reliability'], scope: [] }] },
  });
  startTask(dir2);
  const legacy = run(dir2, ['gate', 'off-plan', '--json']);
  assert.equal(legacy.status, 0, legacy.stdout + legacy.stderr);
  assert.equal(JSON.parse(legacy.stdout).status, 'PASS');
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('8.3 依赖未过 BLOCKED → 依赖 PASS 后可跑；回执/证据落账', () => {
  const dir = mkproj({
    matrix: {
      version: 1,
      riskChecks: { medium: ['app-test'] },
      checks: [
        { name: 'app-build', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'app-test', command: 'true', proves: ['reliability'], scope: [], dependencies: ['app-build'] },
      ],
    },
  });
  startTask(dir);
  const blocked = run(dir, ['gate', 'app-test', '--json']);
  assert.equal(blocked.status, 1);
  const bo = JSON.parse(blocked.stdout);
  assert.equal(bo.status, 'BLOCKED');
  assert.match(bo.reason, /dependency did not pass: app-build/);
  // BLOCKED 也落回执 + evidence
  const entries = ledgerLines(dir);
  const last = entries[entries.length - 1];
  assert.equal(last.content.status, 'BLOCKED');
  assert.match(last.content.note, /dependency did not pass/);
  assert.ok(last.content.evidencePath, 'BLOCKED 回执也带 evidence 句柄');
  // 依赖 PASS 后放行
  const build = run(dir, ['gate', 'app-build', '--json']);
  assert.equal(build.status, 0, build.stdout);
  const pass = run(dir, ['gate', 'app-test', '--json']);
  assert.equal(pass.status, 0, pass.stdout);
  assert.equal(JSON.parse(pass.stdout).status, 'PASS');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 平台不符 BLOCKED（声明 win32 在 linux 上拒）+ 资源锁执行期在场', () => {
  const dir = mkproj({
    matrix: {
      version: 1,
      riskChecks: { medium: ['win-only', 'lock-probe'] },
      checks: [
        { name: 'win-only', command: 'true', proves: ['reliability'], scope: [], platform: 'win32' },
        { name: 'lock-probe', command: 'test -f .zcode/state/resource-locks/rl-demo.lock', proves: ['reliability'], scope: [], resourceLocks: ['rl-demo'] },
      ],
    },
  });
  startTask(dir);
  const win = run(dir, ['gate', 'win-only', '--json']);
  assert.equal(win.status, 1);
  const wo = JSON.parse(win.stdout);
  assert.equal(wo.status, 'BLOCKED');
  if (process.platform !== 'win32') assert.match(wo.reason, /platform/);
  // 资源锁：命令在执行期内探测锁文件存在（锁由 withStateLock 持有）→ PASS
  const probe = run(dir, ['gate', 'lock-probe', '--json']);
  assert.equal(probe.status, 0, probe.stdout + probe.stderr);
  assert.equal(JSON.parse(probe.stdout).status, 'PASS');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.3 planHash 随计划选择变化；plan 命令无任务时输出引导（exit 0）', () => {
  const dir = mkproj({
    matrix: {
      version: 1,
      riskChecks: { medium: ['base-check'] },
      checks: [
        { name: 'base-check', command: 'true', proves: ['reliability'], scope: [] },
        { name: 'extra', command: 'true', proves: ['reliability'], scope: [] },
      ],
    },
  });
  // 无任务：说明性引导，非失败
  const noTask = run(dir, ['plan', '--json']);
  assert.equal(noTask.status, 0);
  assert.equal(JSON.parse(noTask.stdout).code, 'TASK_NOT_FOUND');
  assert.match(JSON.parse(noTask.stdout).note, /task start/);
  startTask(dir);
  const h1 = JSON.parse(run(dir, ['plan', '--json']).stdout).planHash;
  // 变更计划选择（riskChecks 扩组）→ planHash 变化（旧回执不匹配新计划 = stale 语义）
  const matrix = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), 'utf8'));
  matrix.riskChecks.medium.push('extra');
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  const h2 = JSON.parse(run(dir, ['plan', '--json']).stdout).planHash;
  assert.notEqual(h1, h2, '计划选择变化必须改变 planHash');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.4：evidence 三重完整性 ----------

test('8.4 evidence 三重句柄：gate 落 evidence 文件 + 回执三字段 + verify 过；篡改/删除 → exit 4', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', command: 'echo hello-out', proves: ['reliability'], scope: [] }] },
  });
  const task = startTask(dir);
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const go = JSON.parse(g.stdout);
  assert.ok(go.evidencePath.startsWith(`.zcode/state/evidence/${task.id}/`), go.evidencePath);
  const abs = path.join(dir, go.evidencePath);
  assert.ok(fs.existsSync(abs), 'evidence 文件必须存在');
  const entries = ledgerLines(dir);
  const c = entries[entries.length - 1].content;
  assert.equal(c.evidencePath, go.evidencePath);
  assert.equal(c.evidenceBytes, fs.statSync(abs).size);
  assert.equal(c.evidenceHash, sha256(fs.readFileSync(abs)));
  assert.match(fs.readFileSync(abs, 'utf8'), /hello-out/);
  // 完整 → verify exit 0；旧格式回执（receipt write 无句柄）兼容放行并标注 legacy
  run(dir, ['receipt', 'write', '--check', 'manual', '--status', 'PASS', '--note', '人工']);
  assert.equal(run(dir, ['receipt', 'verify']).status, 0);
  const vo = JSON.parse(run(dir, ['receipt', 'verify', '--json']).stdout);
  assert.equal(vo.legacyEvidenceReceipts, 1);
  assert.match(vo.legacy, /兼容放行/);
  // 篡改字节 → EVIDENCE_TAMPERED exit 4
  fs.appendFileSync(abs, 'TAMPERED');
  const t = run(dir, ['receipt', 'verify', '--json']);
  assert.equal(t.status, 4);
  assert.ok(JSON.parse(t.stdout).issues.some((i) => i.code === 'EVIDENCE_TAMPERED'), t.stdout);
  // 删除 → EVIDENCE_MISSING exit 4
  fs.rmSync(abs);
  const m = run(dir, ['receipt', 'verify', '--json']);
  assert.equal(m.status, 4);
  assert.ok(JSON.parse(m.stdout).issues.some((i) => i.code === 'EVIDENCE_MISSING'), m.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.4 evidence 脱敏：命令输出中的 token 不落 evidence 文件', () => {
  // 运行期拼装 token 字面量，防被自家 fitness scan 的 no-secret-literal 命中
  const tok = ['sk-abcde', 'fgh12345678'].join('');
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', command: `echo "token=${tok}"`, proves: ['reliability'], scope: [] }] },
  });
  startTask(dir);
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(g.status, 0, g.stdout);
  const text = fs.readFileSync(path.join(dir, JSON.parse(g.stdout).evidencePath), 'utf8');
  assert.doesNotMatch(text, new RegExp(tok));
  assert.match(text, /REDACTED/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.4 evidence 路径安全：伪造相对穿越/绝对路径（重算链）→ EVIDENCE_PATH_UNSAFE/ESCAPE exit 4', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', command: 'echo x', proves: ['reliability'], scope: [] }] },
  });
  startTask(dir);
  run(dir, ['gate', 'unit', '--json']);
  const forge = (evil) => {
    const file = path.join(dir, '.zcode', 'state', 'ledger.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    const prev = lines.length > 1 ? JSON.parse(lines[lines.length - 2]).chainHash : '';
    const entry = JSON.parse(lines[lines.length - 1]);
    entry.content.evidencePath = evil;
    const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
    entry.chainHash = sha256(`${prev}\n${JSON.stringify(sorted(entry.content))}`);
    fs.writeFileSync(file, `${[...lines.slice(0, -1), JSON.stringify(entry)].join('\n')}\n`);
  };
  forge('../escape.log');
  let v = run(dir, ['receipt', 'verify', '--json']);
  assert.equal(v.status, 4);
  assert.ok(JSON.parse(v.stdout).issues.some((i) => i.code === 'EVIDENCE_PATH_UNSAFE'), v.stdout);
  forge('/etc/passwd');
  v = run(dir, ['receipt', 'verify', '--json']);
  assert.equal(v.status, 4);
  assert.ok(JSON.parse(v.stdout).issues.some((i) => i.code === 'EVIDENCE_PATH_UNSAFE'), v.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.4：retention 引用保护 ----------

test('8.4 retention 引用保护：引用 evidence 不在删除清单；孤儿/过期可清；.corrupt-* 永不删；prune 后链仍可验证', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', command: 'echo out', proves: ['reliability'], scope: [] }] },
  });
  const task = startTask(dir);
  const g1 = JSON.parse(run(dir, ['gate', 'unit', '--json']).stdout);
  // 代码变更 → 指纹变 → 再跑一次（两条回执各自引用一份 evidence；旧回执 stale 但仍被保留账本引用）
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x');
  const g2 = JSON.parse(run(dir, ['gate', 'unit', '--json']).stdout);
  // 孤儿 evidence（无回执引用）+ 取证文件，mtime 老化
  const evRoot = path.join(dir, '.zcode', 'state', 'evidence');
  const old = new Date(Date.now() - 40 * 86400_000);
  const orphan = path.join(evRoot, 'orphan.log');
  fs.writeFileSync(orphan, 'no receipt references me');
  fs.utimesSync(orphan, old, old);
  const corrupt = path.join(evRoot, `${task.id}`, 'unit-x.corrupt-123.log');
  fs.writeFileSync(corrupt, 'quarantine original');
  fs.utimesSync(corrupt, old, old);
  // dry-run：清单正确，不动盘
  const dry = JSON.parse(run(dir, ['retention', 'prune', '--dry-run', '--days', '999', '--json']).stdout);
  assert.equal(dry.dryRun, true);
  assert.ok(dry.evidence.deleted.includes('.zcode/state/evidence/orphan.log'), JSON.stringify(dry.evidence));
  assert.ok(!dry.evidence.deleted.includes(g1.evidencePath), '当前 diff 回执引用的 evidence 不得入删除清单');
  assert.ok(!dry.evidence.deleted.includes(g2.evidencePath), '每 (task,check) 最新回执引用的 evidence 不得入删除清单');
  assert.ok(!dry.evidence.deleted.some((p) => p.includes('.corrupt-')), 'quarantine 取证文件永不删');
  assert.ok(fs.existsSync(orphan), 'dry-run 不动盘');
  assert.ok(dry.evidence.protected >= 2, JSON.stringify(dry.evidence));
  // apply：孤儿被清、引用保留、链仍可验证
  const applied = JSON.parse(run(dir, ['retention', 'prune', '--days', '999', '--json']).stdout);
  assert.ok(!fs.existsSync(orphan));
  assert.ok(fs.existsSync(path.join(dir, g1.evidencePath)));
  assert.ok(fs.existsSync(path.join(dir, g2.evidencePath)));
  assert.ok(fs.existsSync(corrupt));
  assert.equal(run(dir, ['receipt', 'verify']).status, 0, '清理不得制造 EVIDENCE_MISSING');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.4：账本轮转 + anchor ----------

test('8.4 账本轮转：rotateKeep=5 参数化 → 8 写后保 5 条 + anchor，链从 anchor 端到端可验证；anchor 是承重件', () => {
  const dir = mkproj({ harness: { ledger: { rotateKeep: 5 } } });
  let rotatedAt = null;
  for (let i = 1; i <= 8; i++) {
    const w = run(dir, ['receipt', 'write', '--check', `c${i}`, '--status', 'PASS', '--note', `n${i}`, '--json']);
    assert.equal(w.status, 0, w.stderr);
    const wo = JSON.parse(w.stdout);
    if (wo.rotation) rotatedAt = wo.rotation;
  }
  assert.ok(rotatedAt, '第 6 次写入起必须发生轮转');
  const lines = ledgerLines(dir);
  assert.equal(lines.length, 5, '保留最新 5 条');
  assert.deepEqual(lines.map((l) => l.seq), [4, 5, 6, 7, 8], '保留尾部沿用原 seq');
  const anchor = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'ledger.anchor.json'), 'utf8'));
  assert.equal(anchor.throughSeq, 3, 'anchor=最后被丢弃条目（seq 3）的链值');
  assert.equal(anchor.chainHash, rotatedAt.anchorChainHash);
  // 保留尾部从 anchor 端到端可验证
  assert.equal(run(dir, ['receipt', 'verify']).status, 0);
  const vo = JSON.parse(run(dir, ['receipt', 'verify', '--json']).stdout);
  assert.equal(vo.rotated, true);
  assert.equal(vo.anchor.throughSeq, 3);
  // anchor 是承重件：删除后无法从空 prev 验证（SEQ_GAP/CHAIN_BROKEN fail-closed）
  fs.rmSync(path.join(dir, '.zcode', 'state', 'ledger.anchor.json'));
  const broken = run(dir, ['receipt', 'verify', '--json']);
  assert.equal(broken.status, 4);
  assert.ok(JSON.parse(broken.stdout).issues.some((i) => i.code === 'SEQ_GAP' || i.code === 'CHAIN_BROKEN'), broken.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.4 gate-log 尺寸轮转：超限 → .1 保一代，当前文件重开', () => {
  const dir = mkproj({ harness: { retention: { gateLogMaxBytes: 512 } } });
  const gl = path.join(dir, '.zcode', 'state', 'gate-log.jsonl');
  fs.mkdirSync(path.dirname(gl), { recursive: true });
  fs.writeFileSync(gl, `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', event: 'seed', rule: 'seed', action: 'deny', preview: 'x'.repeat(600) })}\n`);
  // 一次 hook deny 写入 → 超过 512B → 先滚再写
  const res = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sudo rm -rf /tmp/x' } }));
  assert.equal(res.status, 2);
  assert.ok(fs.existsSync(`${gl}.1`), '必须保留一代归档 .1');
  assert.match(fs.readFileSync(`${gl}.1`, 'utf8'), /seed/);
  const cur = fs.readFileSync(gl, 'utf8').trim().split('\n');
  assert.equal(cur.length, 1, '当前文件从新条目重开');
  assert.match(cur[0], /sudo|deny/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 本仓自举兼容（关键回归证据） ----------

test('8.4 本仓旧账本（无 evidence 句柄的存量回执）verify 兼容放行', { skip: fs.existsSync(path.join(REPO_ROOT, '.zcode', 'state', 'ledger.jsonl')) ? false : '干净检出无账本（.zcode/state 为机器本地态，不随分支旅行）——本例只对有存量回执的开发机有意义' }, () => {
  const res = run(REPO_ROOT, ['receipt', 'verify', '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const vo = JSON.parse(res.stdout);
  assert.ok(vo.total > 0);
  assert.ok(vo.legacyEvidenceReceipts >= 30, '存量旧格式回执全部兼容放行并标注 legacy');
});
