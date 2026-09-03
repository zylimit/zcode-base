// 批次 1 回归锁（red-locks-the-bug）：三项已亲验红的缺陷，修复前必须先看到本文件红。
//   ① parseArgs 未知 flag 假绿（源 cc-base 64d9b8f 模式）：修前 `task status --nonsense-flag` exit 0。
//   ② 禁边/LAYER_VIOLATION 进棘轮基线豁免（源 cc-base 4b14be8 论点）：修前 FORBIDDEN_EDGE 经 arch baseline 后 check exit 0。
//   ③ readLines 窄形态 fail-open（源 cc-base 44b3739 同型窄面）：修前父目录 chmod 000 时 readLines 返回 []（0-entries 假绿）。
// 另含白名单正调用抽样：每个白名单 flag 至少一条实跑——防「漏列真 flag 把正常调用变 usage 错」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, zbase, tempDir, rmDir, mkHarnessProj } from './helpers.mjs';

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };
const CATALOG = { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'medium' } }] };
const MATRIX = { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: ['m'], command: 'true', allowFastSkip: true }] };

/** 断言：命令未被 flag 白名单拦截（其余失败形态不在此断言范围——各命令自身语义另测）。 */
function noFlagErr(r, label) {
  assert.ok(!r.stderr.includes('未知 flag'), `${label}：flag 被白名单误拦（漏列真 flag？）\nstderr: ${r.stderr.slice(0, 300)}`);
}

// ---------- ① parseArgs 未知 flag 假绿 ----------

test('B1-1 未知 flag 必须 usage 错误：task status --nonsense-flag → exit 1 且 stderr 点名（修前 exit 0 假绿）', () => {
  const r = zbase(['task', 'status', '--nonsense-flag']);
  assert.equal(r.code, 1, `应 exit 1（修前假绿 exit 0）\nstdout: ${r.stdout.slice(0, 200)}\nstderr: ${r.stderr}`);
  assert.match(r.stderr, /未知 flag：--nonsense-flag/);
  assert.match(r.stderr, /认识的 flag/);
});

test('B1-2 doctor --verbose-typo → exit 1 且 stderr 点名（修前 exit 0）', () => {
  const r = zbase(['doctor', '--verbose-typo']);
  assert.equal(r.code, 1, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /未知 flag：--verbose-typo/);
  assert.match(r.stderr, /doctor 认识的 flag/);
});

test('B1-3 治理参数拼错必须拦：gate --exector tester → exit 1 点名（修前静默丢 executor = 假绿）', () => {
  const r = zbase(['gate', 'definitely-not-a-check', '--exector', 'tester']);
  assert.equal(r.code, 1, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /未知 flag：--exector/);
});

test('B1-4 未知子命令仍由 usage 报错（子命令错误优先于 flag 细查，不误报）', () => {
  const r = zbase(['task', 'bogus', '--json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /task start\|status\|finish/);
});

test('B1-5 白名单正调用：本仓只读面全部 flag 被认识（防漏列真 flag）', () => {
  const runs = [
    ['doctor', '--json'], ['selftest', '--json'], ['plan', '--json'], ['quality', 'status', '--json'],
    ['review', 'status', '--json'], ['review', 'backlog', 'list', '--json'], ['review-pack', '--base', 'HEAD', '--json'],
    ['gate-audit', '--json'], ['effectiveness', '--json'], ['risk', 'scan', '--json'], ['invariants', '--json'],
    ['skills-lint', '--json'], ['scan-instructions', '--json'], ['agents-lint', '--json'],
    ['rules-audit', '--files', 'AGENTS.md', '--max', '5', '--json'], ['test-routing', '--json'], ['plan-lint', '--json'],
    ['spec-lint', '--json'], ['trace', '--json'], ['feedback', 'lint', '--json'], ['feedback', 'list', '--json'],
    ['receipt', 'stats', '--json'], ['receipt', 'verify', '--json'], ['budget', '--staged', '--json'],
    ['sync-check', '--staged', '--json'], ['adr', 'check', '--json'], ['fitness', '--json'], ['fitness', 'scan', '--json'],
    ['classifier', 'lint', '--json'], ['manifest', 'check', '--json'], ['impact', '--paths', 'README.md', '--json'],
    ['catalog', 'lint', '--json'], ['task', 'status', '--json'], ['fast', 'status', '--json'],
    ['recap', '--budget', '2000', '--json'], ['archive', '--json'],
    ['context', 'pack', '--budget', '5000', '--paths', 'README.md', '--json'],
    ['retention', 'prune', '--days', '1', '--dry-run', '--json'],
  ];
  for (const args of runs) {
    const r = zbase(args);
    noFlagErr(r, `zbase ${args.join(' ')}`);
  }
});

test('B1-6 白名单正调用：状态面（task/gate/receipt/waiver/review/quality/fast/dod/release/manifest/catalog/arch/adapters）', () => {
  const dir = mkHarnessProj({ catalog: CATALOG, matrix: MATRIX });
  try {
    noFlagErr(zbase(['task', 'start', '--input', '-', '--risk', 'low', '--owned', 'src/a.ts', '--json'], { cwd: dir, input: JSON.stringify(ENVELOPE) }), 'task start --input/--risk/--owned');
    noFlagErr(zbase(['plan', '--json'], { cwd: dir }), 'plan');
    noFlagErr(zbase(['gate', 'unit', '--note', '白名单抽样', '--executor', 'tester', '--json'], { cwd: dir }), 'gate --note/--executor');
    noFlagErr(zbase(['review', 'start', '--paths', 'src/a.ts', '--json'], { cwd: dir }), 'review start --paths');
    noFlagErr(zbase(['review', 'verdict', '--reviewer', 'r1', '--notes', 'ok', '--json'], { cwd: dir }), 'review verdict --reviewer/--notes');
    noFlagErr(zbase(['receipt', 'write', '--check', 'unit', '--status', 'PASS', '--note', 'n', '--executor', 'tester', '--evidence', 'a,b', '--json'], { cwd: dir }), 'receipt write 五 flag');
    noFlagErr(zbase(['quality', 'verify', '--json'], { cwd: dir }), 'quality verify');
    noFlagErr(zbase(['waiver', 'add', '--check', 'x', '--attribute', 'reliability', '--reason', 'r', '--approver', 'a', '--expiry', '2027-01-01', '--compensation', 'c', '--follow-up', 'f', '--approval', 'p', '--json'], { cwd: dir }), 'waiver add 八 flag');
    noFlagErr(zbase(['waiver', 'list', '--all', '--json'], { cwd: dir }), 'waiver list --all');
    noFlagErr(zbase(['task', 'finish', '--force', '--json'], { cwd: dir }), 'task finish --force');
    noFlagErr(zbase(['fast', 'on', '--minutes', '5', '--reason', '白名单抽样', '--json'], { cwd: dir }), 'fast on --minutes/--reason');
    noFlagErr(zbase(['fast', 'off', '--json'], { cwd: dir }), 'fast off');
    const hours = zbase(['fast', 'on', '--hours', '5'], { cwd: dir });
    assert.ok(!hours.stderr.includes('未知 flag'), '--hours 是「认识但已废除」，不得报未知 flag');
    assert.match(hours.stderr, /已废除/, '--hours 走专用废除报错');
    noFlagErr(zbase(['dod', '--budget', '3000', '--json'], { cwd: dir }), 'dod --budget');
    noFlagErr(zbase(['release', '--budget', '3000', '--json'], { cwd: dir }), 'release --budget');
    noFlagErr(zbase(['manifest', 'generate', '--json'], { cwd: dir }), 'manifest generate');
    noFlagErr(zbase(['catalog', 'init', '--json'], { cwd: dir }), 'catalog init');
    noFlagErr(zbase(['arch', 'baseline', '--json'], { cwd: dir }), 'arch baseline');
    noFlagErr(zbase(['arch', 'trend', '--json'], { cwd: dir }), 'arch trend');
    noFlagErr(zbase(['archive', '--apply', '--json'], { cwd: dir }), 'archive --apply');
    noFlagErr(zbase(['adapters', 'list', '--attribute', 'security', '--json'], { cwd: dir }), 'adapters list --attribute');
    noFlagErr(zbase(['adapters', 'add', 'gh-cli', '--dry-run', '--json'], { cwd: dir }), 'adapters add --dry-run');
  } finally {
    rmDir(dir);
  }
});

test('B1-7 install 全 flags 被认识（--hooks/--dry-run/--dryrun/--verify/--uninstall/--targets-from）', () => {
  const target = tempDir('b1-inst');
  const tf = path.join(path.dirname(target), `b1-tf-${path.basename(target)}.txt`);
  fs.writeFileSync(tf, `${target}\n`);
  try {
    noFlagErr(zbase(['install', target, '--dry-run', '--hooks', '--json']), 'install --dry-run --hooks');
    noFlagErr(zbase(['install', target, '--dryrun', '--json']), 'install --dryrun');
    noFlagErr(zbase(['install', target, '--verify', '--json']), 'install --verify');
    noFlagErr(zbase(['install', target, '--uninstall', '--json']), 'install --uninstall');
    noFlagErr(zbase(['install', '--targets-from', tf, '--dry-run', '--json']), 'install --targets-from');
  } finally {
    rmDir(target);
    fs.rmSync(tf, { force: true });
  }
});

// ---------- ② 禁边/LAYER_VIOLATION 不进棘轮基线豁免 ----------

/** 造一个 arch 执法项目：catalog + 违例源文件 + git add（arch check 走 ls-files 只看 tracked）。 */
function mkGraphProj(catalog, files) {
  const dir = mkHarnessProj({ catalog });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('B2-1 FORBIDDEN_EDGE 永不豁免：check fail → baseline 拒收 → 依然 fail（修前：baseline 后 exit 0）', () => {
  const catalog = { version: 1, layers: [], forbidden: [{ from: 'core', to: 'ext' }], modules: [
    { name: 'ui', globs: ['src/ui/**'], deps: [], attributes: {} },
    { name: 'core', globs: ['src/core/**'], deps: ['ui'], attributes: {} },
    { name: 'ext', globs: ['src/ext/**'], deps: [], attributes: {} },
  ] };
  const dir = mkGraphProj(catalog, {
    'src/ui/a.mjs': 'export const a = 1;\n',
    'src/ext/c.mjs': 'export const c = 1;\n',
    'src/core/b.mjs': "import '../ui/a.mjs';\nimport '../ext/c.mjs';\nexport const b = 2;\n",
  });
  try {
    const c1 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c1.code, 3, `禁边在场 check 必须 fail（修前语义同）\n${c1.stdout}${c1.stderr}`);
    assert.ok(c1.json.fresh.some((v) => v.code === 'FORBIDDEN_EDGE' && v.from === 'core' && v.to === 'ext'), JSON.stringify(c1.json.fresh));

    const bl = zbase(['arch', 'baseline', '--json'], { cwd: dir });
    assert.equal(bl.code, 0, `baseline 写入本身应成功\n${bl.stdout}${bl.stderr}`);
    assert.equal(bl.json.written, 0, '无 undeclared 债可入基线');
    assert.ok(bl.json.rejected >= 1, '禁边必须被拒收并计数');
    assert.match(JSON.stringify(bl.json), /禁边不是债/, '拒收必须响亮说明');
    const baseline = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'arch-baseline.json'), 'utf8'));
    assert.ok(!baseline.debts.some((d) => d.code === 'FORBIDDEN_EDGE'), '基线文件不得含 FORBIDDEN_EDGE');

    const c2 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c2.code, 3, `禁边经 baseline 后依然必须 fail——禁令不是可慢慢还的债（修前 exit 0 即本缺陷）\n${c2.stdout}${c2.stderr}`);
  } finally {
    rmDir(dir);
  }
});

test('B2-2 旧基线已存在的禁边 key：豁免效力作废，check 仍 fail（修前：被豁免 exit 0）', () => {
  const catalog = { version: 1, layers: [], forbidden: [{ from: 'core', to: 'ext' }], modules: [
    { name: 'ui', globs: ['src/ui/**'], deps: [], attributes: {} },
    { name: 'core', globs: ['src/core/**'], deps: ['ui'], attributes: {} },
    { name: 'ext', globs: ['src/ext/**'], deps: [], attributes: {} },
  ] };
  const dir = mkGraphProj(catalog, {
    'src/ui/a.mjs': 'export const a = 1;\n',
    'src/ext/c.mjs': 'export const c = 1;\n',
    'src/core/b.mjs': "import '../ui/a.mjs';\nimport '../ext/c.mjs';\nexport const b = 2;\n",
  });
  try {
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'arch-baseline.json'), JSON.stringify({
      version: 1, generatedAt: '2020-01-01T00:00:00.000Z',
      debts: [{ key: 'FORBIDDEN_EDGE|core|ext', code: 'FORBIDDEN_EDGE', from: 'core', to: 'ext', reason: 'legacy', since: '2020-01-01T00:00:00.000Z' }],
    }));
    const r = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(r.code, 3, `旧基线里的禁边 key 不得豁免（修前 exit 0）\n${r.stdout}${r.stderr}`);
    assert.ok(r.json.ignoredBaselineEntries >= 1, '被忽略的基线条目必须计数可见');
  } finally {
    rmDir(dir);
  }
});

test('B2-3 LAYER_VIOLATION 同禁边处理：baseline 后依然 fail（修前：入基线被豁免）', () => {
  const catalog = { version: 1, layers: ['app', 'lib'], modules: [
    { name: 'app', globs: ['src/app/**'], deps: [], attributes: {}, layer: 'app' },
    { name: 'lib', globs: ['src/lib/**'], deps: ['app'], attributes: {}, layer: 'lib' },
  ] };
  const dir = mkGraphProj(catalog, {
    'src/app/a.mjs': 'export const a = 1;\n',
    'src/lib/l.mjs': "import '../app/a.mjs';\nexport const l = 2;\n", // 声明了依赖但违反分层（lib 索引 > app）
  });
  try {
    const c1 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c1.code, 3);
    assert.ok(c1.json.fresh.some((v) => v.code === 'LAYER_VIOLATION'), JSON.stringify(c1.json.fresh));
    const bl = zbase(['arch', 'baseline', '--json'], { cwd: dir });
    assert.equal(bl.json.written, 0, 'LAYER_VIOLATION 不入基线');
    assert.ok(bl.json.rejected >= 1);
    const c2 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c2.code, 3, `分层违例永不豁免（修前 baseline 后 exit 0）\n${c2.stdout}${c2.stderr}`);
  } finally {
    rmDir(dir);
  }
});

test('B2-4 UNDECLARED_DEP 棘轮语义不回归：老债基线放行 → 新增 fail → trend 集合比较点名 fresh 边 → 还清 retired', () => {
  const catalog = { version: 1, layers: [], modules: [
    { name: 'ui', globs: ['src/ui/**'], deps: [], attributes: {} },
    { name: 'core', globs: ['src/core/**'], deps: [], attributes: {} },
    { name: 'ext', globs: ['src/ext/**'], deps: [], attributes: {} },
  ] };
  const dir = mkGraphProj(catalog, {
    'src/ui/a.mjs': 'export const a = 1;\n',
    'src/core/b.mjs': "import '../ui/a.mjs';\nexport const b = 2;\n", // UNDECLARED_DEP|core|ui
  });
  try {
    const c1 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c1.code, 3, '未声明依赖是 fresh 债');
    const bl = zbase(['arch', 'baseline', '--json'], { cwd: dir });
    assert.equal(bl.json.written, 1, 'undeclared 是可入基线的债');
    const c2 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c2.code, 0, `老债在基线必须放行（棘轮语义不回归）\n${c2.stdout}${c2.stderr}`);
    const t1 = zbase(['arch', 'trend', '--json'], { cwd: dir });
    assert.equal(t1.code, 0);
    assert.equal(t1.json.direction, 'flat');

    // 新债：ext 未声明 → ui
    fs.mkdirSync(path.join(dir, 'src', 'ext'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'ext', 'c.mjs'), "import '../ui/a.mjs';\nexport const c = 3;\n");
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    const c3 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c3.code, 3, '新增 undeclared 必须失败');
    const t2 = zbase(['arch', 'trend', '--json'], { cwd: dir });
    assert.equal(t2.code, 3);
    assert.ok(t2.json.fresh.some((v) => v.code === 'UNDECLARED_DEP' && v.from === 'ext' && v.to === 'ui'), `trend 必须点名 fresh 边：${JSON.stringify(t2.json)}`);
    assert.equal(t2.json.direction, 'worse');

    // 还清：删两处违例文件（ls-files 仍列出但内容不可读 → 边消失）
    fs.rmSync(path.join(dir, 'src', 'core', 'b.mjs'));
    fs.rmSync(path.join(dir, 'src', 'ext', 'c.mjs'));
    const c4 = zbase(['arch', 'check', '--json'], { cwd: dir });
    assert.equal(c4.code, 0, '违例清零后 check 过闸');
    const t3 = zbase(['arch', 'trend', '--json'], { cwd: dir });
    assert.equal(t3.code, 0);
    assert.ok((t3.json.retired || []).some((k) => k.includes('UNDECLARED_DEP|core|ui')), `还清的边必须进 retired：${JSON.stringify(t3.json)}`);
    assert.equal(t3.json.direction, 'improved');
  } finally {
    rmDir(dir);
  }
});

// ---------- ③ readLines 窄形态 fail-open ----------

test('B3-1 readLines：文件存在但不可读（父目录 chmod 000）必须上抛（修前返回 [] = verifyLedger 0-entries 假绿）', async (t) => {
  // win32 skip（对齐 mechanisms F2 理由）：NTFS 无 POSIX 权限位语义，chmod 000 对原生 Node 的
  // 读取不可见——「不可读必须报错」的前提在 win32 不成立，仅 POSIX 文件系统可验。
  if (process.platform === 'win32') {
    t.skip('NTFS 无 POSIX 权限位语义：chmod 000 对原生 Node 不可读性不生效，仅 POSIX 文件系统可验');
    return;
  }
  const { readLines } = await import('../.zcode/lib/core.mjs');
  const dir = tempDir('b3');
  const f = path.join(dir, 'ledger.jsonl');
  fs.writeFileSync(f, '{"a":1}\n\n{"a":2}\n');
  fs.chmodSync(dir, 0o000);
  try {
    assert.throws(() => readLines(f), (e) => e.code === 'EACCES' || /denied|权限/i.test(e.message), '存在但不可读必须 fail-visible 上抛');
  } finally {
    fs.chmodSync(dir, 0o755);
    rmDir(dir);
  }
});

test('B3-2 readLines：不存在 → []（仅 ENOENT 视为空）；正常文件 → 非空行数组', async () => {
  const { readLines } = await import('../.zcode/lib/core.mjs');
  const dir = tempDir('b3x');
  try {
    assert.deepEqual(readLines(path.join(dir, 'none.jsonl')), [], '不存在的文件仍是空账本（语义保持）');
    const f = path.join(dir, 'l.jsonl');
    fs.writeFileSync(f, '{"a":1}\n\n{"a":2}\n');
    assert.deepEqual(readLines(f), ['{"a":1}', '{"a":2}'], '空行过滤、非空行保序');
  } finally {
    rmDir(dir);
  }
});
