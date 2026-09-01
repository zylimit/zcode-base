// Phase 7 机制测试：PROTECTED 三性 / fast 贷款 / 跨进程锁+quarantine / untracked 指纹 / 输出脱敏 / 软执法+预算 / Stop 分键。
// 复用 harness.test.mjs 的隔离项目模式（mkproj：拷贝 .zcode 到临时目录 + git init，运行态不随拷贝）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ZCODE_SRC = path.resolve(new URL('.', import.meta.url).pathname, '..', '.zcode');
const execFileP = promisify(execFile);

function mkproj({ catalog, matrix, harness } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-mech-'));
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

function readLedger(dir) {
  return fs.readFileSync(path.join(dir, '.zcode', 'state', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

function readGateLog(dir) {
  const f = path.join(dir, '.zcode', 'state', 'gate-log.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };

// 合成 token 运行期拼装：源码不落「前缀+16 字符」连续字面量——pre-commit 的 staged 秘密扫描对测试文件零误击，
// 真秘密若混进测试仍会被扫出（动态拼装只用于已知合成 fixture）。
const SK = `sk-${'abcdefghijklmnop1234'}`;
const GHP = `ghp_${'abcdefghijklmnopqrstuvwx'}`;
const AKIA = `AKIA${'IOSFODNN7EXAMPLE'}`;
const PEM = ['-----BEGIN RSA PRIVATE', ' KEY-----\nMIIE...\n-----END RSA PRIVATE', ' KEY-----'].join('');

// ---------- Task 7.1：PROTECTED 扩三性 ----------

test('7.1 privacy 豁免被拒（attribute 三性红线）', () => {
  const dir = mkproj();
  const res = run(dir, ['waiver', 'add', '--check', 'priv', '--attribute', 'privacy', '--reason', 'r', '--approver', 'user', '--expiry', '2027-01-01T00:00:00Z', '--compensation', 'c', '--follow-up', 'f']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /privacy 永不可豁免/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.1 waiver reason 命中 privacy 词汇拒绝（无 attribute 声明也拦）', () => {
  const dir = mkproj();
  const res = run(dir, ['waiver', 'add', '--check', 'x', '--reason', '暂时跳过隐私检查', '--approver', 'user', '--expiry', '2027-01-01T00:00:00Z', '--compensation', 'c', '--follow-up', 'f']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /不可豁免词汇/);
  // 英文词同样拦
  const res2 = run(dir, ['waiver', 'add', '--check', 'x', '--reason', 'skip privacy scan', '--approver', 'user', '--expiry', '2027-01-01T00:00:00Z', '--compensation', 'c', '--follow-up', 'f']);
  assert.equal(res2.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 7.2：fast 贷款语义 ----------

test('7.2 fast minutes clamp 1..480', () => {
  const dir = mkproj();
  const hi = run(dir, ['fast', 'on', '--minutes', '9999', '--reason', 't', '--json']);
  assert.equal(JSON.parse(hi.stdout).minutes, 480);
  const lo = run(dir, ['fast', 'on', '--minutes', '0', '--reason', 't', '--json']);
  assert.equal(JSON.parse(lo.stdout).minutes, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.2 gate fast 分支：allowFastSkip 跳过留痕 + protected 检查拒绝声明 allowFastSkip', () => {
  const dir = mkproj({
    matrix: { version: 1, checks: [
      { name: 'unit', proves: ['reliability'], scope: [], command: 'true', allowFastSkip: true },
      { name: 'sec', proves: ['security'], scope: [], command: 'true', allowFastSkip: true },
    ] },
  });
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', '测试窗口']);
  // unit：allowFastSkip + 非三性 → SKIPPED，回执带 fastModeWindow
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const out = JSON.parse(g.stdout);
  assert.equal(out.status, 'SKIPPED');
  assert.equal(out.skippedByFast, true);
  assert.ok(out.fastModeWindow);
  const [entry] = readLedger(dir);
  assert.equal(entry.content.status, 'SKIPPED');
  assert.equal(entry.content.fastModeWindow, out.fastModeWindow);
  assert.equal(entry.content.note, 'fast-mode');
  // sec：protected 检查声明 allowFastSkip → 直接拒绝（PROTECTED_FAST_SKIP）
  const bad = run(dir, ['gate', 'sec', '--json']);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /PROTECTED_FAST_SKIP/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.2 已执行 FAIL 永不可 fast 豁免（反证优先于 SKIPPED）+ task finish 债务阻断', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'critical' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: ['m'], command: 'true', allowFastSkip: true }] },
  });
  run(dir, ['task', 'start', '--input', '-'], JSON.stringify(ENVELOPE));
  run(dir, ['receipt', 'write', '--check', 'unit', '--status', 'FAIL', '--note', 'boom']);
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', '想盖掉 FAIL']);
  // 窗口内再跑 gate → SKIPPED 落账（后到），但 verify 的反证优先：新鲜 FAIL 仍在 → uncovered
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(JSON.parse(g.stdout).status, 'SKIPPED');
  const v = run(dir, ['quality', 'verify', '--json']);
  assert.equal(v.status, 3);
  const vo = JSON.parse(v.stdout);
  assert.ok(vo.blocking.some((b) => /反证.*FAIL/.test(b.reason)), JSON.stringify(vo.blocking));
  // task finish：存在新鲜 fast-SKIPPED → 证据贷款不能关闭任务
  const f = run(dir, ['task', 'finish', '--json']);
  assert.equal(f.status, 3);
  assert.match(f.stdout, /证据贷款不能关闭任务/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.2 windowId 绑定：窗口关闭/新窗口下旧 SKIPPED 一律失效', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'critical' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: ['m'], command: 'true', allowFastSkip: true }] },
  });
  // 窗口 1：跳过 → SKIPPED(wid1)
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', 'w1']);
  const g1 = run(dir, ['gate', 'unit', '--json']);
  const wid1 = JSON.parse(g1.stdout).fastModeWindow;
  // 窗口关闭：SKIPPED 无效 → critical 未覆盖阻断
  run(dir, ['fast', 'off']);
  const v1 = run(dir, ['quality', 'verify', '--json']);
  assert.equal(v1.status, 3, v1.stdout);
  assert.ok(JSON.parse(v1.stdout).blocking.length > 0);
  // 新窗口 wid2：wid1 的 SKIPPED 不被认 → 仍阻断
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', 'w2']);
  const st = JSON.parse(run(dir, ['fast', 'status', '--json']).stdout);
  assert.notEqual(st.windowId, wid1);
  const v2 = run(dir, ['quality', 'verify', '--json']);
  assert.equal(v2.status, 3);
  const vo2 = JSON.parse(v2.stdout);
  assert.ok(!vo2.skippedByFast.some((s) => s.windowId === wid1), '旧窗口 SKIPPED 不得计为有效 skip');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.2 risk scan：FAST_MODE_DEBT error 级点名 skipped 清单', () => {
  const dir = mkproj({
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: [], command: 'true', allowFastSkip: true }] },
  });
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', '债务测试']);
  run(dir, ['gate', 'unit', '--json']);
  const r = run(dir, ['risk', '--json']);
  assert.equal(r.status, 3); // high 信号阻断
  const ro = JSON.parse(r.stdout);
  const debt = ro.findings.find((f) => f.code === 'FAST_MODE_DEBT');
  assert.ok(debt, JSON.stringify(ro.findings));
  assert.deepEqual(debt.skipped, ['unit']);
  assert.equal(debt.severity, 'high');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 7.3：跨进程锁 + quarantine ----------

test('7.3 双进程并发 updateState 不丢增量（锁生效）', async () => {
  const dir = mkproj();
  fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.zcode', 'state', 'state.json'), JSON.stringify({ version: 1, counter: 0 }));
  const stateUrl = pathToFileURL(path.join(dir, '.zcode', 'lib', 'state.mjs'));
  const script = `import { updateState } from ${JSON.stringify(stateUrl)};\nfor (let i = 0; i < 10; i++) updateState((s) => ({ ...s, counter: (s.counter || 0) + 1 }));`;
  // 两子进程并发各做 10 次增量：无锁会互相覆盖丢更新，终值必须 = 20
  await Promise.all([0, 1].map(() => execFileP(process.execPath, ['--input-type=module', '-e', script], { cwd: dir })));
  const finalState = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'state.json'), 'utf8'));
  assert.equal(finalState.counter, 20, `并发增量丢失：期望 20，实际 ${finalState.counter}`);
  // 锁用完即删（不留残留锁文件）
  assert.equal(fs.readdirSync(path.join(dir, '.zcode', 'state')).filter((f) => f.endsWith('.lock')).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.3 损坏 state.json 隔离后引擎继续可用 + risk scan 单列信号', () => {
  const dir = mkproj();
  fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.zcode', 'state', 'state.json'), '{broken json');
  // 引擎不 brick：fast status 正常返回默认（exit 0）
  const st = run(dir, ['fast', 'status', '--json']);
  assert.equal(st.status, 0, st.stdout + st.stderr);
  assert.equal(JSON.parse(st.stdout).enabled, false);
  // 原件被改名隔离（取证保留），quarantine.jsonl 留事件
  const stateFiles = fs.readdirSync(path.join(dir, '.zcode', 'state'));
  assert.ok(stateFiles.some((f) => f.startsWith('state.json.corrupt-')), '损坏原件必须移开保全');
  assert.ok(!stateFiles.includes('state.json'), '损坏原件不得留在原位');
  const qevents = fs.readFileSync(path.join(dir, '.zcode', 'state', 'quarantine.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(qevents.length, 1);
  assert.equal(qevents[0].file, 'state.json');
  assert.ok(qevents[0].error.length > 0);
  // 引擎继续可用：正常写任务
  const t = run(dir, ['task', 'start', '--input', '-'], JSON.stringify(ENVELOPE));
  assert.equal(t.status, 0, t.stdout + t.stderr);
  // risk scan 单列 state-quarantined 信号（high → exit 3）
  const r = run(dir, ['risk', '--json']);
  assert.equal(r.status, 3);
  assert.ok(JSON.parse(r.stdout).findings.some((f) => f.code === 'STATE_QUARANTINED'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 7.4：untracked 内容入指纹 ----------

test('7.4 untracked 文件改内容 → fingerprint 变化，旧回执 stale', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'wip.txt'), 'v1');
  const w1 = run(dir, ['receipt', 'write', '--check', 'fp', '--status', 'PASS', '--note', 'bind v1']);
  assert.equal(w1.status, 0);
  const v1 = JSON.parse(run(dir, ['receipt', 'verify', '--json']).stdout);
  assert.equal(v1.staleCount, 0, '当前 fingerprint 下回执应 fresh');
  // 只改 untracked 文件内容（不改路径清单）→ fingerprint 必须变化
  fs.writeFileSync(path.join(dir, 'wip.txt'), 'v2-content-changed');
  const v2 = JSON.parse(run(dir, ['receipt', 'verify', '--json']).stdout);
  assert.notEqual(v2.currentFingerprint, v1.currentFingerprint, 'untracked 内容变化必须改变 fingerprint');
  assert.equal(v2.staleCount, 1, '旧回执必须 stale');
  // 重新落回执后恢复 fresh（staleCount 含历史旧回执属正常；fresh 语义用 Stop 门验证：有新鲜回执即放行）
  run(dir, ['receipt', 'write', '--check', 'fp', '--status', 'PASS', '--note', 'bind v2']);
  const s = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s.status, 0, s.stdout + s.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 7.5：三出口脱敏 ----------

test('7.5 token 形态样例在 receipt note / gate-log / hook 输出中全脱敏', () => {
  const dir = mkproj();
  const secrets = `${SK} ${GHP} ${AKIA}`;
  // 出口 1：receipt note → 账本行
  const w = run(dir, ['receipt', 'write', '--check', 'unit', '--status', 'PASS', '--note', `输出含 ${secrets} 以及 password=hunter2`]);
  assert.equal(w.status, 0);
  const ledgerRaw = fs.readFileSync(path.join(dir, '.zcode', 'state', 'ledger.jsonl'), 'utf8');
  assert.ok(!ledgerRaw.includes(SK), 'sk- token 不得入账本');
  assert.ok(!ledgerRaw.includes(GHP), 'ghp_ token 不得入账本');
  assert.ok(!ledgerRaw.includes(AKIA), 'AKIA 键不得入账本');
  assert.ok(!ledgerRaw.includes('password=hunter2'), 'password 赋值不得入账本');
  assert.ok(ledgerRaw.includes('[REDACTED]'));
  // 出口 2：gate-log（deny preview 含 token）
  run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: `export API_KEY=${SK} && rm -rf /` } }));
  const gateRaw = fs.readFileSync(path.join(dir, '.zcode', 'state', 'gate-log.jsonl'), 'utf8');
  assert.ok(!gateRaw.includes(SK), 'gate-log preview 不得含 token');
  assert.ok(gateRaw.includes('[REDACTED]'));
  // 出口 3：hook emit（session-start 播报任务 goal 含 token → additionalContext 脱敏）
  const env = { ...ENVELOPE, goal: `修复 key ${SK} 泄漏` };
  run(dir, ['task', 'start', '--input', '-'], JSON.stringify(env));
  const s = run(dir, ['hook', 'session-start'], '{}');
  assert.equal(s.status, 0);
  assert.ok(!s.stdout.includes(SK), 'hook 注入上下文不得含 token');
  assert.ok(s.stdout.includes('[REDACTED]'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.5 redactSecrets 模式集单元（PEM/JWT/URL userinfo/query 参数/环境变量）', async () => {
  const { redactSecrets, boundedHead, boundedTail } = await import('../.zcode/lib/common.mjs');
  const cases = [
    [PEM, new RegExp(['BEGIN RSA', 'PRIVATE KEY'].join(' '))],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N65I', /eyJhbGciOiJIUzI1NiJ9\.eyJzdWI/],
    ['postgres://admin:secret@db.example.com/prod', /admin:secret@/],
    ['https://user:pass@example.com/x', /user:pass@/],
    ['curl "https://api.example.com/v1?token=abc123&x=1"', /token=abc123/],
    ['AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiC', /wJalrXUtnFEMI/],
    ['xoxb-123456789-abcdefghijklmnop', /xoxb-123456789/],
    ['Authorization: Bearer abc.def.ghi12345', /abc\.def\.ghi12345/],
  ];
  for (const [input, mustNotMatch] of cases) {
    const out = redactSecrets(input);
    assert.ok(!mustNotMatch.test(out), `脱敏失败：${input.slice(0, 40)}… → ${out.slice(0, 60)}`);
    assert.ok(out.includes('[REDACTED]'), `必须留 [REDACTED] 标记：${input.slice(0, 40)}`);
  }
  // 先脱敏再截断：截断后 token 也不得残留
  const long = `log ${'x'.repeat(2000)} token ${SK} tail`;
  const head = boundedHead(long, 100);
  const tail = boundedTail(long, 100);
  assert.ok(!head.includes(SK) || head.length < 100);
  assert.ok(!tail.includes(SK));
  assert.ok(tail.endsWith('tail') || tail.includes('truncated'));
});

// ---------- Task 7.7：护栏资产软执法 + 输出预算 ----------

test('7.7 PostToolUse 引擎文件写入软执法：放行+留痕+播报；state 路径仍硬拦', () => {
  const dir = mkproj();
  // 引擎文件：PostToolUse 放行但 gate-log 记 guardrail-write + 播报
  const soft = run(dir, ['hook', 'post-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.zcode', 'lib', 'common.mjs') } }));
  assert.equal(soft.status, 0, soft.stdout + soft.stderr);
  assert.match(soft.stdout, /护栏资产已被修改/);
  assert.match(soft.stdout, /确认此改动有意为之/);
  const entries = readGateLog(dir);
  assert.ok(entries.some((e) => e.kind === 'guardrail-write' && e.action === 'guardrail-write' && /\.zcode\/lib\/common\.mjs$/.test(e.preview)));
  // 账本/门禁注册路径：PreToolUse 保持硬拦（protectedWritePaths 不动）
  const hard = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.zcode', 'state', 'ledger.jsonl') } }));
  assert.equal(hard.status, 2);
  assert.match(hard.stderr, /protected-write/);
  // 非护栏路径：无 guardrail 记录
  const plain = run(dir, ['hook', 'post-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'a.ts') } }));
  assert.equal(plain.status, 0);
  assert.equal(readGateLog(dir).filter((e) => e.kind === 'guardrail-write').length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.7 CLI 输出超 12000 字符 → MODEL_OUTPUT_LIMIT 拒绝（不静默截断）', () => {
  const dir = mkproj();
  // 构造大 gate-log（100 条规则行 → gate-audit JSON 输出远超 12000）
  const lines = [];
  for (let i = 0; i < 100; i++) lines.push(JSON.stringify({ ts: '2026-09-01T00:00:00Z', event: `Ev${i}`, rule: `rule-${i}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, action: 'observe' }));
  fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.zcode', 'state', 'gate-log.jsonl'), `${lines.join('\n')}\n`);
  const res = run(dir, ['gate-audit', '--json']);
  assert.equal(res.status, 1, res.stdout.slice(0, 200));
  assert.match(res.stderr, /MODEL_OUTPUT_LIMIT/);
  // 小输出不受影响
  const small = run(dir, ['fast', 'status', '--json']);
  assert.equal(small.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.7 hook emit 预算：超长 additionalContext 被裁（递归限长）', async () => {
  const { boundedHookOutput } = await import('../.zcode/lib/hooks.mjs');
  const huge = { additionalContext: 'x'.repeat(10_000) };
  const out = boundedHookOutput(huge);
  assert.ok(JSON.stringify(out).length <= 4000, `裁后仍超限：${JSON.stringify(out).length}`);
  assert.ok(typeof out.additionalContext === 'string' && out.additionalContext.length > 0);
  // 嵌套对象/数组也受限长
  const nested = { additionalContext: 'y'.repeat(3_000), list: Array.from({ length: 100 }, (_, i) => `item-${i}`) };
  const out2 = boundedHookOutput(nested);
  assert.ok(JSON.stringify(out2).length <= 4000, `嵌套裁剪失效：${JSON.stringify(out2).length}`);
  assert.ok(out2.list.length <= 20);
});

// ---------- Task 7.8：Stop 三振按状态分键 ----------

test('7.8 Stop 分键：不同缺失清单各自计数，清单回退恢复旧键计数', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const s1 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s1.status, 2);
  assert.match(s1.stderr, /三振 1\/3/);
  // 清单变化（新增 b.txt）→ 新键从零计：仍 1/3（不是 2/3）
  fs.writeFileSync(path.join(dir, 'b.txt'), 'y');
  const s2 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s2.status, 2);
  assert.match(s2.stderr, /三振 1\/3/);
  const s3 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s3.status, 2);
  assert.match(s3.stderr, /三振 2\/3/);
  // 删除 b.txt → 清单回退到 [a.txt] → 恢复键 A：计数从 1 续到 2
  fs.rmSync(path.join(dir, 'b.txt'));
  const s4 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s4.status, 2);
  assert.match(s4.stderr, /三振 2\/3/);
  // 旧键打满 3 次 → 第 4 次放行
  const s5 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s5.status, 2);
  const s6 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s6.status, 0, s6.stdout + s6.stderr);
  assert.match(s6.stdout, /人工审查/);
  fs.rmSync(dir, { recursive: true, force: true });
});

function pathToFileURL(p) {
  return `file://${p.split(path.sep).join('/')}`;
}

// ---------- Review R1 修复：F1 fast 债务收口（red-locks 先行） ----------

test('F1 债务跨指纹存续：fast SKIPPED 落账→改代码→task finish 必须阻断（证据贷款提示）', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'medium' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: ['m'], command: 'true', allowFastSkip: true }] },
  });
  run(dir, ['task', 'start', '--input', '-'], JSON.stringify(ENVELOPE));
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', 'red-lock 债务逃逸链']);
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(JSON.parse(g.stdout).status, 'SKIPPED'); // fast 窗口内合法跳过（medium 档）
  // 改一行代码：指纹变化，SKIPPED 回执变 stale——债务不得随指纹漂移逃逸
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'x.ts'), 'export const x = 1;\n');
  const f = run(dir, ['task', 'finish', '--json']);
  assert.equal(f.status, 3, `finish 应被债务阻断：${f.stdout}${f.stderr}`);
  assert.match(f.stdout, /证据贷款不能关闭任务/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F1 critical/high 档 check 在 fast 窗口不可被 skip：未跑=BLOCKED 语义', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'critical' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: ['m'], command: 'true', allowFastSkip: true }] },
  });
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', 'red-lock 高档不可跳']);
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(JSON.parse(g.stdout).status, 'SKIPPED'); // gate 层留痕（回执记录跳过事实）
  // verify 聚合：critical 档的 SKIPPED 不算覆盖——未跑=BLOCKED，仅 medium/low 档可 SKIPPED
  const v = run(dir, ['quality', 'verify', '--json']);
  assert.equal(v.status, 3, `critical 档 fast SKIPPED 不得放行：${v.stdout}`);
  const vo = JSON.parse(v.stdout);
  assert.ok(vo.blocking.some((b) => b.module === 'm' && b.attribute === 'reliability'), JSON.stringify(vo.blocking));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Review R1 修复：F2 quarantine 收窄 / F3 E2BIG / F4 预算+memoize / F5 tests/ 软执法 ----------

test('F2 quarantine 只对 JSON 语法损坏隔离：chmod 000（完好但不可读）必须报错而非静默隔离', () => {
  const dir = mkproj();
  fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.zcode', 'state', 'state.json'), '{"version":1}'); // 完好 JSON
  fs.chmodSync(path.join(dir, '.zcode', 'state', 'state.json'), 0o000);
  const st = run(dir, ['fast', 'status', '--json']);
  assert.equal(st.status, 1, `不可读状态必须响亮报错：${st.stdout}${st.stderr}`);
  assert.match(st.stderr, /EACCES|权限|denied/i);
  // 未被隔离：无 .corrupt-* 文件、无 quarantine.jsonl（好数据不得被当坏数据移开）
  const files = fs.readdirSync(path.join(dir, '.zcode', 'state'));
  assert.ok(!files.some((f) => f.includes('corrupt')), `完好状态被误隔离：${files.join(',')}`);
  assert.ok(!files.includes('quarantine.jsonl'));
  fs.chmodSync(path.join(dir, '.zcode', 'state', 'state.json'), 0o644); // 恢复后清理可删
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F3 git E2BIG 响亮抛错（不被 allowFail 吞成恒定指纹）', async () => {
  const { gitRaw } = await import('../.zcode/lib/git.mjs');
  // 单参数超内核 MAX_ARG_STRLEN（128KB）→ spawn E2BIG → 必须抛 GIT_OUTPUT_TRUNCATED 而非返回 null
  assert.throws(
    () => gitRaw(['status', 'x'.repeat(200_000)], { allowFail: true }),
    (e) => /GIT_OUTPUT_TRUNCATED|E2BIG/.test(e.message),
  );
});

test('F4 fingerprint 进程内 memoize：同值复用、clear 后参数变则失效', async () => {
  const g = await import('../.zcode/lib/git.mjs');
  const dir = mkproj();
  const prevCwd = process.cwd();
  try {
    process.chdir(dir);
    fs.writeFileSync('memo.txt', 'v1');
    const a1 = g.fingerprint();
    const a2 = g.fingerprint();
    assert.equal(a1.fingerprint, a2.fingerprint, '同参数必须命中缓存');
    assert.equal(a1, a2, '应返回同一缓存对象（去重 task finish 4 次/hook stop 2 次调用链）');
    // 文件内容变化 + clear 缓存 → 新值（参数变则失效）
    fs.writeFileSync('memo.txt', 'v2-changed');
    g.clearFingerprintCache();
    const b1 = g.fingerprint();
    assert.notEqual(b1.fingerprint, a1.fingerprint);
  } finally {
    process.chdir(prevCwd);
    g.clearFingerprintCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F4 untracked 预算：超 maxTrackedPaths → truncated=true 且内容段降级（路径清单哈希）', () => {
  // 子进程模式（config.ROOT 按子进程 cwd 解析，harness.json 覆盖生效）：
  // 两个内容相同的项目，唯一差异是 u3.txt 的**内容**——超预算降级段只哈希路径清单 → 指纹必须相同
  const mk = (u3Content) => {
    const dir = mkproj({ harness: { context: { maxTrackedPaths: 2 } } });
    fs.writeFileSync(path.join(dir, 'u1.txt'), 'content-1');
    fs.writeFileSync(path.join(dir, 'u2.txt'), 'content-2');
    fs.writeFileSync(path.join(dir, 'u3.txt'), u3Content);
    return dir;
  };
  const dirA = mk('content-3');
  const dirB = mk('content-3-CHANGED'); // 唯一差异：内容
  try {
    const t = run(dirA, ['task', 'start', '--input', '-', '--json'], JSON.stringify(ENVELOPE));
    assert.equal(t.status, 0, t.stdout + t.stderr);
    const taskA = JSON.parse(t.stdout).task;
    assert.equal(taskA.baseline.truncated, true, '超预算必须 truncated=true（Stop 门不放行）');
    assert.ok(taskA.baseline.counts.untracked >= 3);
    const t2 = run(dirB, ['task', 'start', '--input', '-', '--json'], JSON.stringify(ENVELOPE));
    assert.equal(t2.status, 0, t2.stdout + t2.stderr);
    const taskB = JSON.parse(t2.stdout).task;
    assert.equal(taskB.baseline.truncated, true);
    assert.equal(taskB.baseline.fingerprint, taskA.baseline.fingerprint, '降级段不得含内容字节（truncated=true 已响亮标注测量不完整）');
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('F4 超 16MiB 单文件不读内容（special:not-read），fingerprint 仍可用', async () => {
  const g = await import('../.zcode/lib/git.mjs');
  const dir = mkproj();
  const prevCwd = process.cwd();
  try {
    process.chdir(dir);
    // sparse file：lstat size > 16MiB 但不占实际磁盘
    const fd = fs.openSync('huge.bin', 'w');
    fs.ftruncateSync(fd, 17 * 1024 * 1024);
    fs.closeSync(fd);
    const fp = g.fingerprint(); // 不得抛错、不得真读 17MiB
    assert.equal(fp.truncated, false);
    assert.equal(typeof fp.fingerprint, 'string');
  } finally {
    process.chdir(prevCwd);
    g.clearFingerprintCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F5 tests/ 目录写入软执法：放行+留痕+播报（证据链本体同级保护）', () => {
  const dir = mkproj();
  const res = run(dir, ['hook', 'post-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'tests', 'x.test.mjs') } }));
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /护栏资产已被修改/);
  assert.match(res.stdout, /tests\/x\.test\.mjs/);
  const entries = readGateLog(dir);
  assert.ok(entries.some((e) => e.kind === 'guardrail-write' && /tests\/x\.test\.mjs$/.test(e.preview)));
  fs.rmSync(dir, { recursive: true, force: true });
});
