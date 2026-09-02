// R4 code-review FIX_REQUIRED 修复的 red-locks 测试（4×P2 + 1×P3 + 1 记录项）：
// F1 lens 报告可无痕撤销 + verdict 落定后会话不封（quality.mjs review 区）
// F2 backlog 三性禁令只扫 summary——结构化字段（lens 认领红线属性）绕过
// F3 install --verify 的 git add -A stage 用户 untracked 文件（破坏目标仓 index）
// F4 make-release SECRET_RE 与 scan.mjs SECRET_LITERAL_PATTERNS 十族漂移
// F5 doctor.mjs:1 字面量 undefined 残留 + invariants 法则 2 文案与 gate BLOCKED 实际 exit 1 漂移（P3）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ZCODE_SRC = path.join(REPO, '.zcode');
const SCRIPTS = path.join(REPO, '.zcode', 'scripts');

function mkproj({ catalog, matrix } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r4fix-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* 已初始化则复用 */ } // zbase-fitness:ignore empty-catch
  return dir;
}

function run(cwd, args, stdin = '', env = {}) {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function mkhome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-home-'));
}

const CATALOG_FULL = { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'high', resilience: 'high', security: 'high', privacy: 'high' } }] };

function dirtySrc(dir, content = 'x') {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), content);
}

const BLUE_OK = JSON.stringify({ claims: [{ claim: '边界路径已验证', evidence: 'node .zcode/zbase.mjs gate unit → exit 0（receipt seq 在账）' }] });
const ERROR_LENS = JSON.stringify({ findings: [{ severity: 'error', location: 'src/a.ts:3', summary: '空输入未处理' }] });

// ---------- F1：lens 不可无痕撤销 + verdict 后会话封 ----------

test('F1 lens 重报拒绝：error 已落会话后同 lens 重报空 findings → exit 1，历史 error 不得无痕消失', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  try {
    assert.equal(run(dir, ['review', 'start']).status, 0);
    run(dir, ['review', 'blue'], BLUE_OK);
    assert.equal(run(dir, ['review', 'lens', 'correctness'], ERROR_LENS).status, 0);
    assert.equal(run(dir, ['review', 'verdict', '--json']).status, 2, 'error 在账 → FIX_REQUIRED exit 2');

    // 同 lens 重报空 findings：当前实现直接覆写 s.lenses[name]——历史 error 无痕消失，必须拒绝
    const again = run(dir, ['review', 'lens', 'correctness', '--json'], JSON.stringify({ findings: [] }));
    assert.equal(again.status, 1, `重报必须 exit 1（实际 ${again.status}）：${again.stdout}${again.stderr}`);
    assert.match(JSON.parse(again.stdout).reason, /已报|重开/, '拒绝理由须指明出路（重开 review start）');

    // 历史事实仍在：再次 verdict 必须 FIX_REQUIRED（exit 2），不得因重报翻转为 ACCEPT
    const v2 = run(dir, ['review', 'verdict', '--json']);
    assert.equal(v2.status, 2, `历史 error 不得无痕消失（实际 verdict exit ${v2.status}）`);
    assert.equal(JSON.parse(v2.stdout).verdict, 'FIX_REQUIRED');
    const session = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'review', 'session.json'), 'utf8'));
    assert.equal(session.lenses.correctness.findings.length, 1, '会话内该 lens 的 findings 不得被重报清空');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F1 会话封死：ACCEPT+isFinal 落定后 blue/lens/verdict 写操作一律 exit 1；status 只读不受影响', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  try {
    assert.equal(run(dir, ['review', 'start']).status, 0);
    run(dir, ['review', 'blue'], BLUE_OK);
    for (const l of ['correctness', 'reliability', 'resilience', 'security', 'privacy']) {
      assert.equal(run(dir, ['review', 'lens', l], JSON.stringify({ findings: [] })).status, 0, l);
    }
    assert.equal(run(dir, ['review', 'verdict', '--json']).status, 0, '全 stage 通过 → ACCEPT+isFinal');

    // verdict 落定后会话已封：一切写操作拒绝（当前实现不封——重报/续写可改写已裁定的事实）
    const lens = run(dir, ['review', 'lens', 'correctness', '--json'], JSON.stringify({ findings: [] }));
    assert.equal(lens.status, 1, `封会话后 lens 必须 exit 1（实际 ${lens.status}）`);
    assert.match(JSON.parse(lens.stdout).reason, /已封|重开/, '拒绝理由须指明出路（重开 review start）');

    const blue = run(dir, ['review', 'blue', '--json'], BLUE_OK);
    assert.equal(blue.status, 1, `封会话后 blue 必须 exit 1（实际 ${blue.status}）`);

    const v2 = run(dir, ['review', 'verdict', '--json']);
    assert.equal(v2.status, 1, `封会话后 verdict 必须 exit 1（实际 ${v2.status}）`);

    // 只读面不受封禁影响
    const st = run(dir, ['review', 'status', '--json']);
    assert.equal(st.status, 0, st.stdout + st.stderr);
    assert.equal(JSON.parse(st.stdout).verdict.verdict, 'ACCEPT');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('F1 escalate 封会话后 backlog add 仍可用（人工升级的出路是把 finding 记成有书面理由的债）', () => {
  const dir = mkproj({ catalog: { ...CATALOG_FULL, review: { maxRounds: 1 } } });
  dirtySrc(dir);
  try {
    assert.equal(run(dir, ['review', 'start']).status, 0);
    run(dir, ['review', 'blue'], BLUE_OK);
    assert.equal(run(dir, ['review', 'lens', 'correctness'], ERROR_LENS).status, 0);
    const v = run(dir, ['review', 'verdict', '--json']);
    assert.equal(v.status, 2);
    assert.equal(JSON.parse(v.stdout).escalate, true, 'round 1 >= maxRounds 1 → escalate');

    // escalate 封会话：再 verdict 拒
    assert.equal(run(dir, ['review', 'verdict', '--json']).status, 1, 'escalate 后会话已封');
    // backlog 不封：非三性 finding 记债是 escalate advice 的出路
    const debt = run(dir, ['review', 'backlog', 'add', '--json'], JSON.stringify({ owner: 'human-lead', expiry: '2099-01-01T00:00:00Z', summary: '命名统一重构延后', lens: 'correctness' }));
    assert.equal(debt.status, 0, debt.stdout + debt.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- F2：backlog 三性禁令扩结构化字段 ----------

test('F2 backlog 三性禁令：lens 认领红线属性（security/privacy）即使 summary 干净也拒；location 文本命中禁令词同拒', () => {
  const dir = mkproj({ catalog: CATALOG_FULL });
  dirtySrc(dir);
  try {
    assert.equal(run(dir, ['review', 'start']).status, 0);
    const add = (payload) => run(dir, ['review', 'backlog', 'add'], JSON.stringify(payload));
    const FUT = '2099-01-01T00:00:00Z';

    // 结构化绕过：summary 完全干净，lens 名本身认领了红线属性——当前只扫 summary 放行
    const s1 = add({ owner: 'a', expiry: FUT, summary: 'x', lens: 'security' });
    assert.equal(s1.status, 1, `lens=security 必须 exit 1（实际 ${s1.status}）：${s1.stdout}`);
    assert.match(s1.stdout, /不可入积压/);

    const s2 = add({ owner: 'a', expiry: FUT, summary: 'x', lens: 'privacy' });
    assert.equal(s2.status, 1, `lens=privacy 必须 exit 1（实际 ${s2.status}）`);

    // location 是结构化文本字段：命中禁令词同样拒
    const s3 = add({ owner: 'a', expiry: FUT, summary: 'x', lens: 'correctness', location: 'src/a.ts:1（security 边界）' });
    assert.equal(s3.status, 1, `location 命中禁令词必须 exit 1（实际 ${s3.status}）`);

    // 非三性 lens + 干净文本：合法记债不受影响
    const ok = add({ owner: 'a', expiry: FUT, summary: '命名统一重构延后', lens: 'correctness', location: 'src/a.ts:1' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- F3：install --verify 不得 stage 用户 untracked 文件 ----------

test('F3 install --verify：用户 untracked 文件必须仍 untracked——stage 限定安装面 pathspec，不用 git add -A', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
    fs.writeFileSync(path.join(target, 'user-draft.txt'), '用户的未提交草稿\n');
    fs.mkdirSync(path.join(target, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(target, 'notes', 'wip.md'), '# 嵌套目录草稿\n');

    const res = run(src, ['install', target, '--verify', '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(JSON.parse(res.stdout).verify.staged, true, '安装面 stage 是 verify 证明力的前提');

    const status = execFileSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8' });
    assert.match(status, /\?\? user-draft\.txt/, `用户 untracked 必须仍 untracked（实际 status：\n${status}）`);
    assert.match(status, /\?\? notes\//, '嵌套 untracked 同样保住');

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: target, encoding: 'utf8' });
    assert.ok(!staged.split('\n').includes('user-draft.txt'), '用户文件不得入 index');
    assert.ok(!staged.includes('notes/wip.md'), '用户嵌套文件不得入 index');
    assert.ok(staged.split('\n').filter(Boolean).length > 90, `安装面仍须被 stage（实际 ${staged.split('\n').filter(Boolean).length}）`);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// ---------- F4：make-release SECRET_RE 对齐 scan.mjs 十族 ----------

const REL_BASE = {
  'AGENTS.md': '# demo\n',
  '.zcode/feedback/FEEDBACK-INDEX.md': '# FEEDBACK-INDEX\n',
  '.zcode/lib/a.mjs': 'export const x = 1;\n',
};

function mkrelrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-mkrelfix-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* zbase-fitness:ignore empty-catch */ }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function mkrelease(cwd, args) {
  return spawnSync('sh', [path.join(SCRIPTS, 'make-release.sh'), ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env } });
}

// 平台分支（CI windows）：make-release.sh MINGW 分支产 .zip 而非 .tar.gz——产物路径的扩展名按平台取。
const ARTIFACT_EXT = process.platform === 'win32' ? '.zip' : '.tar.gz';

// 运行期拼装：测试源码与被扫仓都不落连续完整形态（模式源码文本天然不命中——同 r4d 秘密注入先例）
const TOKENS = [
  ['sk-前缀', 'const t = "' + ['sk-', 'proj12345678'].join('') + '"'],
  ['pk-前缀', 'const t = "' + ['pk-', 'proj12345678'].join('') + '"'],
  ['rk-前缀', 'const t = "' + ['rk-', 'proj12345678'].join('') + '"'],
  ['sess-前缀', 'const t = "' + ['sess-', 'proj12345678'].join('') + '"'],
  ['ghp-token', 'const t = "' + ['ghp_', 'Ab01'.repeat(5)].join('') + '"'],
  ['github-pat', 'const t = "' + ['github_pat_', 'Ab01'.repeat(5)].join('') + '"'],
  ['glpat', 'const t = "' + ['glpat-', 'ab01'.repeat(4)].join('') + '"'],
  ['xox-slack', 'const t = "' + ['xoxb-', 'ab01cd23ef'].join('') + '"'],
  ['AKIA', 'const t = "' + ['AKIA', 'IOSFODNN7EXAMPLE'].join('') + '"'],
  ['ASIA', 'const t = "' + ['ASIA', 'IOSFODNN7EXAMPLE'].join('') + '"'],
  ['AIza', 'const t = "' + ['AIza', 'aB0'.repeat(11), 'xy'].join('') + '"'],
  ['JWT-三段', 'const t = "' + ['eyJ', 'abcdefghij', '.', 'klmnopqrst', '.', 'uvwxy'].join('') + '"'],
  ['PEM-私钥块', 'const k = "' + ['-----BEGIN ', 'RSA PRIVATE KEY', '-----'].join('') + '"'],
  ['DB-URI', 'const u = "' + ['postgres', '://user:secretpw@db.internal:5432/app'].join('') + '"'],
  ['password-赋值', 'const c = { ' + ['password', ': "hunter2secret"'].join('') + ' }'],
];

test('F4 make-release：各形态 token（运行期拼装）注入隔离仓 → exit 1 不发坏包（与 scan 十族对齐）', () => {
  // shell 语法检查先行（POSIX sh -n）
  const syn = spawnSync('sh', ['-n', path.join(SCRIPTS, 'make-release.sh')]);
  assert.equal(syn.status, 0, 'sh -n 必须通过：\n' + syn.stderr);
  const dash = spawnSync('dash', ['-n', path.join(SCRIPTS, 'make-release.sh')]);
  if (dash.error === undefined) assert.equal(dash.status, 0, 'dash -n（POSIX）必须通过：\n' + dash.stderr);

  for (const [label, line] of TOKENS) {
    const dir = mkrelrepo({ ...REL_BASE, 'config.js': `${line}\n` });
    try {
      const out = mkrelease(dir, ['v9.9.9']);
      assert.equal(out.status, 1, `${label} 必须被拦（exit 1）——SECRET_RE 与 scan 引擎漂移：\n${out.stdout}${out.stderr}`);
      assert.match(out.stderr, /秘密形态命中/);
      assert.equal(fs.existsSync(path.join(os.tmpdir(), `${path.basename(dir)}-v9.9.9${ARTIFACT_EXT}`)), false, '坏包必须删除');
    } finally {
      fs.rmSync(path.join(os.tmpdir(), `${path.basename(dir)}-v9.9.9${ARTIFACT_EXT}`), { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('F4 make-release：干净仓 + 敏感词非 token 形态 → 不误伤（exit 0 正常发包）', () => {
  const dir = mkrelrepo({ ...REL_BASE, 'doc.md': '# 安全说明\n本节讨论 security 边界与 privacy 政策（非凭据形态文本）。\n' });
  try {
    const out = mkrelease(dir, ['v8.8.8']);
    assert.equal(out.status, 0, `非 token 形态的敏感词文本不得误拦：\n${out.stdout}${out.stderr}`);
  } finally {
    fs.rmSync(path.join(os.tmpdir(), `${path.basename(dir)}-v8.8.8${ARTIFACT_EXT}`), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- F5 + 记录项：doctor.mjs 首行卫生 + invariants 法则 2 文案 ----------

test('F5 doctor.mjs 首行无字面量 undefined 残留；invariants 法则 2 与 gate BLOCKED 实际行为（exit 1）一致', async () => {
  const first = fs.readFileSync(path.join(REPO, '.zcode', 'lib', 'doctor.mjs'), 'utf8').split('\n')[0];
  assert.doesNotMatch(first, /^\s*undefined\s*$/, '首行不得是字面量 undefined 残留');
  await import('../.zcode/lib/doctor.mjs'); // 语法健康：可导入不抛错

  // P3 记录项：法则 2 文本「2 阻断」暗示 BLOCKED=exit 2，与 gate BLOCKED 实际 exit 1 拒绝漂移
  const dir = mkproj();
  try {
    const inv = run(dir, ['invariants', '--json']);
    assert.equal(inv.status, 0, inv.stdout + inv.stderr);
    const text = JSON.parse(inv.stdout).text;
    assert.match(text, /BLOCKED 非 PASS/, '法则 2 须声明 BLOCKED 非 PASS');
    assert.match(text, /exit 1 拒绝/, '法则 2 须声明 BLOCKED 按错误码拒绝（exit 1）');
    assert.doesNotMatch(text, /2 阻断/, '不得再以「2 阻断」表述四态（2 是 hook 阻断保留码，非 gate BLOCKED）');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
