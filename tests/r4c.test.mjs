// Phase 8 R4c 机制测试（Task 8.5/8.6/8.11）：
// review 全链（start 组队+属性裁剪/blue evidence 协议/lens stage 门与 finding 定位/stale exit 4/
// verdict ACCEPT+回执落账/FIX_REQUIRED exit 2+lineage/maxRounds escalate/backlog 三性拒绝/review-pack 溢写）
// + completion 门聚合（optional 已执行 FAIL 阻断/executor 非 tester 拒/planHash 消费/review scope 匹配）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import url from 'node:url';

const ZCODE_SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '.zcode');

function mkproj({ catalog, matrix, harness } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r4c-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  if (harness) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify(harness));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* 已初始化则复用 */ } // zbase-fitness:ignore empty-catch
  return dir;
}

function run(cwd, args, stdin = '') {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 60000 });
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };

function startTask(dir, { risk = 'medium', owned = 'src/**' } = {}) {
  const t = run(dir, ['task', 'start', '--input', '-', '--risk', risk, '--owned', owned, '--json'], JSON.stringify(ENVELOPE));
  assert.equal(t.status, 0, t.stdout + t.stderr);
  return JSON.parse(t.stdout).task;
}

function ledgerLines(dir) {
  return fs.readFileSync(path.join(dir, '.zcode', 'state', 'ledger.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// catalog：app 模块只声明 reliability/resilience（无 security/privacy）→ production 组队裁掉 security/privacy
const CATALOG_TRIM = { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low', resilience: 'low' } }] };
// catalog：全属性声明 → production 全组队
const CATALOG_FULL = { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'high', resilience: 'high', security: 'high', privacy: 'high' } }] };

function dirtySrc(dir, content = 'x') {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), content);
}

const BLUE_OK = JSON.stringify({ claims: [{ claim: '边界路径已验证', evidence: 'node .zcode/zbase.mjs gate unit → exit 0（receipt seq 在账）' }] });

// ---------- Task 8.5：review 全链 ----------

test('8.5 start 组队：profile 默认 production × 属性裁剪 + excludedLenses 理由 + 空树拒绝', () => {
  const dir = mkproj({ catalog: CATALOG_TRIM });
  dirtySrc(dir);
  const s = run(dir, ['review', 'start', '--json']);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  const so = JSON.parse(s.stdout);
  assert.deepEqual([...so.session.requiredLenses].sort(), ['correctness', 'reliability', 'resilience'], 'security/privacy 应被属性裁剪裁出（无模块声明 low 以上）');
  assert.deepEqual(so.session.excludedLenses.map((e) => e.lens).sort(), ['privacy', 'security']);
  assert.ok(so.session.excludedLenses.every((e) => /属性裁剪/.test(e.reason)), '每个未召集 lens 必须带理由');
  assert.equal(so.round, 1);
  fs.rmSync(dir, { recursive: true, force: true });

  // 干净树（全部提交）→ no-change 拒绝（degraded exit 3）
  const dir2 = mkproj();
  git(dir2, 'add', '-A');
  git(dir2, 'commit', '-q', '-m', 'init');
  const s2 = run(dir2, ['review', 'start', '--json']);
  assert.equal(s2.status, 3, s2.stdout + s2.stderr);
  assert.match(JSON.parse(s2.stdout).reason, /no-change/);
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('8.5 blue 协议：空 claims 拒 / claim 缺 evidence 拒（观点不是主张）', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  assert.equal(run(dir, ['review', 'start']).status, 0);
  const empty = run(dir, ['review', 'blue'], JSON.stringify({ claims: [] }));
  assert.equal(empty.status, 1);
  const noEv = run(dir, ['review', 'blue'], JSON.stringify({ claims: [{ claim: '我觉得没问题' }] }));
  assert.equal(noEv.status, 1);
  assert.match(noEv.stdout, /没有命令\/路径\/退出码的主张只是观点/);
  assert.equal(run(dir, ['review', 'blue'], BLUE_OK).status, 0, '带 evidence 的 claim 必须被接受');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 lens 协议：未知 lens 拒 / 无定位 finding 整批拒 / severity 非法拒 / stage 门拒（exit 1）', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  run(dir, ['review', 'start']);
  run(dir, ['review', 'blue'], BLUE_OK);
  const unknown = run(dir, ['review', 'lens', 'performance'], JSON.stringify({ findings: [] }));
  assert.equal(unknown.status, 1);
  assert.match(unknown.stdout, /未知 lens/);
  const unlocated = run(dir, ['review', 'lens', 'correctness'], JSON.stringify({ findings: [{ severity: 'warning', summary: '感觉这里有问题' }] }));
  assert.equal(unlocated.status, 1);
  assert.match(unlocated.stdout, /既无 file:line location 也无 reproduction/);
  const badSev = run(dir, ['review', 'lens', 'correctness'], JSON.stringify({ findings: [{ severity: 'critical', location: 'src/a.ts:1', summary: 'x' }] }));
  assert.equal(badSev.status, 1);
  assert.match(badSev.stdout, /severity/);
  // stage 门：correctness（stage 1）未报，security（stage 3）提交被拒
  const gated = run(dir, ['review', 'lens', 'security', '--json'], JSON.stringify({ findings: [] }));
  assert.equal(gated.status, 1);
  const go = JSON.parse(gated.stdout);
  assert.equal(go.stageGated, true);
  assert.match(go.reason, /stage 3/);
  // verdict 前置阻断：stage 1 lens 未报完 → blocker exit 1
  const v = run(dir, ['review', 'verdict', '--json']);
  assert.equal(v.status, 1);
  assert.ok(JSON.parse(v.stdout).blockers.some((b) => /correctness/.test(b)), v.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 全链 ACCEPT：按序报齐 stage 1→2→3 → verdict exit 0 + isFinal + review 回执落账（链完整）', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  const task = startTask(dir, { owned: 'src/**' });
  assert.equal(run(dir, ['review', 'start']).status, 0);
  run(dir, ['review', 'blue'], BLUE_OK);
  // stage 1 → 2 → 3 按序；correctness 带 CoVe verificationQuestion 的 warning finding
  const lens = (name, findings) => run(dir, ['review', 'lens', name], JSON.stringify({ findings }));
  assert.equal(lens('correctness', [{ severity: 'warning', location: 'src/a.ts:1', summary: '命名可更明确', verificationQuestion: '读 src/a.ts:1 是否确为边界计算？' }]).status, 0);
  assert.equal(lens('reliability', []).status, 0);
  assert.equal(lens('resilience', []).status, 0);
  assert.equal(lens('security', []).status, 0);
  assert.equal(lens('privacy', []).status, 0);
  const v = run(dir, ['review', 'verdict', '--reviewer', 'judge-1', '--json']);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const vo = JSON.parse(v.stdout);
  assert.equal(vo.verdict, 'ACCEPT');
  assert.equal(vo.isFinal, true);
  assert.equal(vo.stage, 3);
  assert.ok(vo.receipt && vo.receipt.seq > 0, 'ACCEPT+isFinal 必须自动落回执');
  assert.ok(vo.pendingVerification.length === 1, '带 verificationQuestion 的 finding 必须标注待独立核验');
  assert.match(vo.advice, /共识比三个分歧的 lens 更差/);
  // 回执内容：check=review + lens 覆盖 + scope + verdict 字段，且绑任务
  const entries = ledgerLines(dir);
  const r = entries[entries.length - 1];
  assert.equal(r.content.check, 'review');
  assert.equal(r.content.status, 'PASS');
  assert.equal(r.content.task, task.id);
  assert.equal(r.content.reviewVerdict, 'ACCEPT');
  assert.deepEqual(r.content.reviewScope, ['src/**'], '默认 scope=活跃任务 ownedPaths（completion 门比对锚）');
  assert.deepEqual(r.content.lenses, ['correctness', 'reliability', 'resilience', 'security', 'privacy']);
  // 进哈希链：链完整
  assert.equal(run(dir, ['receipt', 'verify']).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 FIX_REQUIRED exit 2 + error finding 聚合 + 重开 lineage 追加', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  assert.equal(run(dir, ['review', 'start']).status, 0);
  run(dir, ['review', 'blue'], BLUE_OK);
  assert.equal(run(dir, ['review', 'lens', 'correctness'], JSON.stringify({ findings: [{ severity: 'error', location: 'src/a.ts:3', summary: '空输入未处理' }] })).status, 0);
  // error 在 stage 1，但 stage 3 lens 可继续报（error 跨 stage 聚合，序仍成立）；直接 verdict 也应 FIX_REQUIRED
  const v = run(dir, ['review', 'verdict', '--json']);
  assert.equal(v.status, 2, 'FIX_REQUIRED 必须 exit 2');
  const vo = JSON.parse(v.stdout);
  assert.equal(vo.verdict, 'FIX_REQUIRED');
  assert.equal(vo.errorCount, 1);
  assert.equal(vo.errors[0].lens, 'correctness');
  assert.equal(vo.escalate, false, 'round 1 未达 maxRounds');
  // 修复后重开：上一会话 FIX_REQUIRED → lineage 追加（diffHash/errorCount/round）
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'fixed');
  assert.equal(run(dir, ['review', 'start', '--json']).status, 0);
  const s2 = JSON.parse(run(dir, ['review', 'status', '--json']).stdout);
  assert.equal(s2.round, 2, 'lineage 计数 +1');
  const session = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'review', 'session.json'), 'utf8'));
  assert.equal(session.lineage.length, 1);
  assert.equal(session.lineage[0].errors, 1);
  assert.ok(session.lineage[0].diffHash);
  assert.ok(session.lineage[0].round);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 maxRounds escalate：maxRounds=2，第 2 轮 FIX_REQUIRED → escalate + STOP 建议', () => {
  const dir = mkproj({ catalog: { ...CATALOG_FULL, review: { maxRounds: 2 } } });
  dirtySrc(dir);
  const badLens = JSON.stringify({ findings: [{ severity: 'error', location: 'src/a.ts:3', summary: '空输入未处理' }] });
  for (let round = 1; round <= 2; round++) {
    assert.equal(run(dir, ['review', 'start']).status, 0, `round ${round} start`);
    run(dir, ['review', 'blue'], BLUE_OK);
    assert.equal(run(dir, ['review', 'lens', 'correctness'], badLens).status, 0);
    const v = run(dir, ['review', 'verdict', '--json']);
    assert.equal(v.status, 2);
    const vo = JSON.parse(v.stdout);
    if (round === 2) {
      assert.equal(vo.escalate, true, `round ${vo.round} >= maxRounds ${vo.maxRounds} 必须 escalate`);
      assert.match(vo.advice, /停/);
      assert.match(vo.advice, /profile|缩小范围/);
    } else {
      assert.equal(vo.escalate, false);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 stale：开审后改工作树 → blue/lens 写操作 exit 4', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  assert.equal(run(dir, ['review', 'start']).status, 0);
  fs.appendFileSync(path.join(dir, 'src', 'a.ts'), '\n// late change');
  const b = run(dir, ['review', 'blue', '--json'], BLUE_OK);
  assert.equal(b.status, 4, 'diffHash 变化后一切写操作 stale');
  assert.match(JSON.parse(b.stdout).reason, /stale|变化/);
  const l = run(dir, ['review', 'lens', 'correctness'], JSON.stringify({ findings: [] }));
  assert.equal(l.status, 4);
  const v = run(dir, ['review', 'verdict', '--json']);
  assert.equal(v.status, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 backlog：缺字段/过期 expiry/三性 finding 拒（exit 1）；合法条目录入 + EXPIRED 标注', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  run(dir, ['review', 'start']);
  const add = (payload) => run(dir, ['review', 'backlog', 'add'], JSON.stringify(payload));
  assert.equal(add({ owner: 'a', summary: 's', lens: 'correctness' }).status, 1, '缺 expiry 拒');
  assert.equal(add({ owner: 'a', expiry: '2000-01-01T00:00:00Z', summary: 's', lens: 'correctness' }).status, 1, '过期 expiry 拒');
  const sec = add({ owner: 'a', expiry: '2099-01-01T00:00:00Z', summary: 'security 边界检查后补', lens: 'security' });
  assert.equal(sec.status, 1, '三性相关 finding 不可入积压');
  assert.match(sec.stdout, /不可入积压/);
  const ok = add({ owner: 'dev-a', expiry: '2099-01-01T00:00:00Z', summary: '命名统一重构延后', lens: 'correctness', location: 'src/a.ts:1' });
  assert.equal(ok.status, 0, ok.stdout);
  // 伪造已过期条目（直接改会话状态）→ list 标 EXPIRED
  const sessionPath = path.join(dir, '.zcode', 'state', 'review', 'session.json');
  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  session.backlog.push({ at: '2020-01-01T00:00:00Z', owner: 'old', expiry: '2020-02-01T00:00:00Z', lens: 'correctness', summary: '历史债' });
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  const list = JSON.parse(run(dir, ['review', 'backlog', 'list', '--json']).stdout);
  assert.equal(list.count, 2);
  assert.equal(list.expired, 1);
  assert.ok(list.entries.some((e) => e.expired && e.owner === 'old'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.5 review-pack：base 解析（tag→origin/main→首 commit）+ 五段结构 + >800 行溢写 patch 留指针', () => {
  const dir = mkproj();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c1');
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'b\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c2');
  const res = run(dir, ['review-pack', '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const po = JSON.parse(res.stdout);
  assert.equal(po.baseVia, 'first-commit', '无 tag 无 origin/main → 首 commit');
  assert.equal(po.commits, 1);
  const pack = fs.readFileSync(path.join(dir, po.packPath), 'utf8');
  assert.match(pack, /## Commits/);
  assert.match(pack, /## Diffstat/);
  assert.match(pack, /## 删除审计/);
  assert.match(pack, /## Untracked/);
  assert.match(pack, /## Diff/);
  // 大 diff（>800 行）→ 溢写 patch 文件留指针
  fs.writeFileSync(path.join(dir, 'src', 'big.js'), Array.from({ length: 900 }, (_, i) => `line-${i}`).join('\n') + '\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c3-big');
  const big = JSON.parse(run(dir, ['review-pack', '--json']).stdout);
  assert.ok(big.diffLines > 800, `diff 行数 ${big.diffLines}`);
  const bigPack = fs.readFileSync(path.join(dir, big.packPath), 'utf8');
  assert.match(bigPack, /已溢写至/);
  const spillRef = bigPack.match(/已溢写至 (\S+)——/)[1];
  assert.ok(fs.existsSync(path.join(dir, spillRef)), '溢写 patch 文件必须真实存在');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.6：completion 门聚合 + executor 绑定 ----------

const PLAN_MATRIX = {
  version: 1,
  riskChecks: { medium: ['c1'], high: ['c1', 'c2'] },
  checks: [
    { name: 'c1', command: 'true', proves: [], scope: [] },
    { name: 'c2', command: 'true', proves: [], scope: [] },
  ],
};

test('8.6 optional FAIL 阻断：组队外检查已执行出新鲜 FAIL → finish 拒（已执行的失败永不可接受）', () => {
  const dir = mkproj({ catalog: CATALOG_TRIM, matrix: PLAN_MATRIX });
  dirtySrc(dir);
  startTask(dir);
  assert.equal(run(dir, ['gate', 'c1', '--json']).status, 0);
  // 组队外检查（不在 plan）：手动落 FAIL 回执（自动绑当前任务）
  assert.equal(run(dir, ['receipt', 'write', '--check', 'optional-scan', '--status', 'FAIL', '--note', '顺手跑的检查失败']).status, 0);
  const f = run(dir, ['task', 'finish', '--json']);
  assert.equal(f.status, 3, f.stdout + f.stderr);
  assert.match(f.stdout, /已执行的失败永不可接受/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.6 executor 绑定：risk=high 无 fast 时 required 回执非 tester 拒；gate --executor tester 后放行；非法角色格式拒', () => {
  const dir = mkproj({ catalog: CATALOG_TRIM, matrix: PLAN_MATRIX });
  dirtySrc(dir);
  startTask(dir, { risk: 'high' });
  // 非法 executor 格式（引擎入口校验）
  const bad = run(dir, ['receipt', 'write', '--check', 'c1', '--status', 'PASS', '--executor', 'Bad Role']);
  assert.equal(bad.status, 1);
  // implementer 自己跑的 gate（无 executor）→ 回执 executorRole 未声明
  assert.equal(run(dir, ['gate', 'c1', '--json']).status, 0);
  assert.equal(run(dir, ['gate', 'c2', '--json']).status, 0);
  const f1 = run(dir, ['task', 'finish', '--json']);
  assert.equal(f1.status, 3, '高风险检查需 tester 执行的新鲜回执');
  assert.match(f1.stdout, /高风险检查需 tester 执行/);
  // tester 重跑 → 放行
  assert.equal(run(dir, ['gate', 'c1', '--executor', 'tester', '--json']).status, 0);
  assert.equal(run(dir, ['gate', 'c2', '--executor', 'tester', '--json']).status, 0);
  const f2 = run(dir, ['task', 'finish', '--json']);
  assert.equal(f2.status, 0, f2.stdout + f2.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.6 planHash 消费：回执落账后计划身份变化（risk 档变）→ 旧回执 stale 需重验', () => {
  const dir = mkproj({ catalog: CATALOG_TRIM, matrix: PLAN_MATRIX });
  dirtySrc(dir);
  startTask(dir, { risk: 'medium' });
  assert.equal(run(dir, ['gate', 'c1', '--json']).status, 0);
  // finish 本应通过（medium 无 executor 要求）——先证绿
  assert.equal(run(dir, ['task', 'finish', '--json']).status, 0);
  // 重开任务、落回执，然后改任务风险档（state 不入指纹，回执仍新鲜，但 planHash 变）
  startTask(dir, { risk: 'medium' });
  assert.equal(run(dir, ['gate', 'c1', '--json']).status, 0);
  const statePath = path.join(dir, '.zcode', 'state', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const t = state.tasks.find((x) => x.id === state.activeTask.id);
  t.risk = 'high';
  fs.writeFileSync(statePath, JSON.stringify(state));
  const f = run(dir, ['task', 'finish', '--json']);
  assert.equal(f.status, 3);
  assert.match(f.stdout, /planHash mismatch：计划在回执之后变化/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.6 review 门：requireForFinish 采纳 + risk medium 无 fast → scope 不匹配拒 / scope 匹配 + ACCEPT 放行', () => {
  // requireForFinish 采纳；plan 未采纳（传统模式）→ completion 只剩 review 门；
  // 显式 lenses 全组队（模块无属性声明，避免属性裁剪把 stage 3 lens 裁掉）
  const catalog = {
    version: 1,
    review: { requireForFinish: true, lenses: ['correctness', 'reliability', 'resilience', 'security', 'privacy'] },
    modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: {} }],
  };
  const dir = mkproj({ catalog, matrix: { version: 1, checks: [] } });
  dirtySrc(dir);
  startTask(dir, { owned: 'src/**' });

  // 无任何审查 → 拒
  const f0 = run(dir, ['task', 'finish', '--json']);
  assert.equal(f0.status, 3);
  assert.match(f0.stdout, /review.*missing review receipt|missing review receipt/);

  // 范围过期：审查 scope ≠ 任务 ownedPaths（--paths 覆盖）→ ACCEPT 回执也不算
  assert.equal(run(dir, ['review', 'start', '--paths', 'docs/**']).status, 0);
  run(dir, ['review', 'blue'], BLUE_OK);
  for (const l of ['correctness', 'reliability', 'resilience', 'security', 'privacy']) {
    assert.equal(run(dir, ['review', 'lens', l], JSON.stringify({ findings: [] })).status, 0, l);
  }
  assert.equal(run(dir, ['review', 'verdict', '--json']).status, 0);
  const f1 = run(dir, ['task', 'finish', '--json']);
  assert.equal(f1.status, 3, '审查范围与任务 ownedPaths 不匹配不得关闭任务');
  assert.match(f1.stdout, /scope 与任务 ownedPaths 不匹配|审查范围过期/);

  // 重开审查（默认 scope=任务 ownedPaths）→ 通过
  assert.equal(run(dir, ['review', 'start']).status, 0);
  run(dir, ['review', 'blue'], BLUE_OK);
  for (const l of ['correctness', 'reliability', 'resilience', 'security', 'privacy']) {
    assert.equal(run(dir, ['review', 'lens', l], JSON.stringify({ findings: [] })).status, 0, l);
  }
  assert.equal(run(dir, ['review', 'verdict', '--json']).status, 0);
  const f2 = run(dir, ['task', 'finish', '--json']);
  assert.equal(f2.status, 0, f2.stdout + f2.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.6 回归面：未启用 requireForFinish 的项目 finish 不要求 review（宪法路由条件触发，采纳开关沿用 PLAN_NOT_ADOPTED 哲学）', () => {
  const dir = mkproj({ catalog: CATALOG_TRIM, matrix: PLAN_MATRIX });
  dirtySrc(dir);
  startTask(dir); // medium、无 review
  assert.equal(run(dir, ['gate', 'c1', '--json']).status, 0);
  const f = run(dir, ['task', 'finish', '--json']);
  assert.equal(f.status, 0, f.stdout + f.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});
