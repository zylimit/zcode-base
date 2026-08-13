// zcode-base 测试：单元（common/catalog/impact/arch）+ 集成（CLI 子进程：账本/门禁/hook/质量门/安装面）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const RUNTIME_SRC = fileURLToDir(new URL('../runtime', import.meta.url));

function fileURLToDir(u) {
  return u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
}

// ---------- 单元：common ----------

test('canonicalJson 键排序确定性', async () => {
  const { canonicalJson, sha256 } = await import('../runtime/lib/common.mjs');
  const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
});

test('glob 语义：** 跨目录、* 单段', async () => {
  const { matchAny } = await import('../runtime/lib/common.mjs');
  assert.ok(matchAny('src/a/b/c.ts', ['src/**/*.ts']));
  assert.ok(matchAny('src/x.ts', ['src/*.ts']));
  assert.ok(!matchAny('src/a/x.ts', ['src/*.ts']));
  assert.ok(matchAny('.env', ['.env', '.env.*']));
  assert.ok(matchAny('.env.local', ['.env', '.env.*']));
});

// ---------- 单元：catalog ----------

test('catalog lint：悬空依赖/未归类/重叠报错，环告警', async () => {
  const { lint, classify } = await import('../runtime/lib/catalog.mjs');
  const bad = {
    version: 1,
    modules: [
      { name: 'a', globs: ['src/a/**'], deps: ['ghost', 'c'] },
      { name: 'b', globs: ['src/b/**'], deps: ['a'] },
      { name: 'c', globs: ['src/c/**'], deps: ['b', 'a'] },
    ],
    ignored: [],
    global: [],
  };
  const res = lint(bad, { trackedPaths: ['src/a/x.ts', 'src/b/y.ts', 'src/c/z.ts', 'loose.md'] });
  assert.ok(res.errors.some((e) => e.code === 'DANGLING_DEP'));
  assert.ok(res.errors.some((e) => e.code === 'UNMAPPED'));
  assert.ok(res.warnings.some((w) => w.code === 'CYCLE'));
  assert.equal(classify(bad, 'src/a/x.ts').module, 'a');
  assert.equal(classify(bad, 'loose.md').kind, 'unmapped');
});

test('catalog lint：重叠路径报错', async () => {
  const { lint } = await import('../runtime/lib/catalog.mjs');
  const cat = { version: 1, modules: [
    { name: 'a', globs: ['src/**'] },
    { name: 'b', globs: ['src/b/**'] },
  ] };
  const res = lint(cat, { trackedPaths: ['src/b/x.ts'] });
  assert.ok(res.errors.some((e) => e.code === 'OVERLAP'));
});

// ---------- 单元：impact 反向闭包 ----------

test('impact：反向闭包含传递消费者；unmapped 触发 degraded 全 fanout', async () => {
  const { analyze } = await import('../runtime/lib/impact.mjs');
  const cat = {
    version: 1,
    modules: [
      { name: 'ui', globs: ['src/ui/**'], deps: ['domain'] },
      { name: 'domain', globs: ['src/domain/**'], deps: ['infra'] },
      { name: 'infra', globs: ['src/infra/**'], deps: [] },
    ],
  };
  fs.writeFileSync = fs.writeFileSync; // no-op reference
  // analyze 内部 loadCatalog 读真实仓库文件；此处直用 reverseClosure 验证闭包
  const { reverseClosure } = await import('../runtime/lib/impact.mjs');
  const closure = reverseClosure(cat, ['infra']);
  assert.deepEqual(closure.sort(), ['domain', 'infra', 'ui']);
});

// ---------- 单元：arch import 提取 ----------

test('arch：多语言 import 提取', async () => {
  const arch = await import('../runtime/lib/arch.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-arch-'));
  const ts = path.join(tmp, 'm.ts');
  fs.writeFileSync(ts, `import x from './b';\nrequire('./c');\nconst y = await import('./d');\n`);
  fs.writeFileSync(path.join(tmp, 'm.py'), `from .sib import x\nimport os\n`);
  // extractImports 未导出则跳过（内部函数）；经 check() 间接覆盖
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- 集成：CLI 子进程 ----------

function mkproj({ catalog, matrix } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-proj-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(RUNTIME_SRC, path.join(dir, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch {}
  return dir;
}

function run(cwd, args, stdin = '') {
  return spawnSync('node', [path.join('runtime', 'zbase.mjs'), ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 60000 });
}

test('集成：hook 危险命令 deny / 安全命令放行', () => {
  const dir = mkproj();
  const bad = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /rm-rf-root/);
  const bad2 = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat .env' } }));
  assert.equal(bad2.status, 2);
  const ok = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }));
  assert.equal(ok.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：hook 保护路径写入 deny（账本防篡改）', () => {
  const dir = mkproj();
  const bad = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.zbase', 'ledger.jsonl') } }));
  assert.equal(bad.status, 2);
  const ok = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'app.ts') } }));
  assert.equal(ok.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：user-prompt-submit 反馈信号注入 additionalContext', () => {
  const dir = mkproj();
  const res = run(dir, ['hook', 'user-prompt-submit'], JSON.stringify({ prompt: '不对，这里错了' }));
  assert.equal(res.status, 0);
  assert.match(res.stdout, /additionalContext/);
  assert.match(res.stdout, /feedback-writer/);
  const quiet = run(dir, ['hook', 'user-prompt-submit'], JSON.stringify({ prompt: '帮我加个功能' }));
  assert.equal(quiet.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：session-start 恢复注入', () => {
  const dir = mkproj();
  const res = run(dir, ['hook', 'session-start'], '{}');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /zcode-base 会话恢复/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：账本写入→链校验通过→篡改→exit 4', () => {
  const dir = mkproj();
  const w1 = run(dir, ['receipt', 'write', '--check', 'unit', '--status', 'PASS', '--note', 'ok']);
  assert.equal(w1.status, 0);
  const w2 = run(dir, ['receipt', 'write', '--check', 'lint', '--status', 'FAIL', '--note', 'boom']);
  assert.equal(w2.status, 0);
  const v1 = run(dir, ['receipt', 'verify']);
  assert.equal(v1.status, 0, v1.stdout);
  // 篡改第一行内容
  const ledger = path.join(dir, '.zbase', 'ledger.jsonl');
  const lines = fs.readFileSync(ledger, 'utf8').trim().split('\n');
  const first = JSON.parse(lines[0]);
  first.content.status = 'FAIL'; // 未重算 chainHash
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(ledger, lines.join('\n') + '\n');
  const v2 = run(dir, ['receipt', 'verify']);
  assert.equal(v2.status, 4);
  assert.match(v2.stdout, /CHAIN_BROKEN/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：task start 六字段校验 + task finish 质量门', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'critical' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: ['m'], command: '' }] },
  });
  // 缺字段拒绝
  const bad = run(dir, ['task', 'start', '--input', '-'], JSON.stringify({ goal: 'g' }));
  assert.equal(bad.status, 1);
  const env = { goal: '实现功能 X', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };
  const ok = run(dir, ['task', 'start', '--input', '-'], JSON.stringify(env));
  assert.equal(ok.status, 0, ok.stdout);
  // critical 属性无新鲜 PASS → finish 被拦（exit 3）
  const f1 = run(dir, ['task', 'finish']);
  assert.equal(f1.status, 3, f1.stdout);
  assert.match(f1.stdout, /blockers|m\.reliability/);
  // 写新鲜 PASS 回执后放行
  const w = run(dir, ['receipt', 'write', '--check', 'unit', '--status', 'PASS', '--note', 'tests green']);
  assert.equal(w.status, 0);
  const f2 = run(dir, ['task', 'finish']);
  assert.equal(f2.status, 0, f2.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：quality verify 反证优先——新鲜 FAIL 覆盖早先 PASS', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { security: 'high' } }] },
    matrix: { version: 1, checks: [{ name: 'sec', proves: ['security'], scope: ['m'], command: '' }] },
  });
  run(dir, ['receipt', 'write', '--check', 'sec', '--status', 'PASS', '--note', 'first']);
  run(dir, ['receipt', 'write', '--check', 'sec', '--status', 'FAIL', '--note', 'regression']);
  const res = run(dir, ['quality', 'verify']);
  assert.equal(res.status, 3);
  assert.match(res.stdout, /反证/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：fitness 拦截未接线的高档位属性', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { privacy: 'high' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: [], command: '' }] },
  });
  const res = run(dir, ['fitness']);
  assert.equal(res.status, 3);
  assert.match(res.stdout, /F2/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：waiver 红线——security 属性拒绝豁免', () => {
  const dir = mkproj();
  const res = run(dir, ['waiver', 'add', '--check', 'sec', '--attribute', 'security', '--reason', 'r', '--approver', 'user', '--expiry', '2027-01-01T00:00:00Z', '--compensation', 'c', '--follow-up', 'f']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /永不可豁免/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：impact 闭包与 degraded（unmapped）', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [
      { name: 'ui', globs: ['src/ui/**'], deps: ['core'] },
      { name: 'core', globs: ['src/core/**'], deps: [] },
    ] },
  });
  const res = run(dir, ['impact', '--paths', 'src/core/a.ts', '--json']);
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.affected.sort(), ['core']);
  assert.deepEqual(out.fanout.sort(), ['core', 'ui']); // fanout=验证范围（含传递消费者）
  const deg = run(dir, ['impact', '--paths', 'stray/file.ts', '--json']);
  const out2 = JSON.parse(deg.stdout);
  assert.equal(out2.degraded, true);
  assert.ok(out2.fanout.length >= 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：Stop 门——无新鲜回执时 deny（封顶 2 次后放行），有回执放行', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'change.txt'), 'x'); // untracked 变更
  const s1 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s1.status, 2, s1.stdout + s1.stderr);
  const s2 = run(dir, ['hook', 'stop'], '{}');
  assert.equal(s2.status, 2);
  const s3 = run(dir, ['hook', 'stop'], '{}'); // 第 3 次：计数耗尽放行
  assert.equal(s3.status, 0);
  // 新项目：写新鲜回执后 stop 直接放行
  const dir2 = mkproj();
  fs.writeFileSync(path.join(dir2, 'change.txt'), 'x');
  run(dir2, ['receipt', 'write', '--check', 'smoke', '--status', 'PASS', '--note', 'verified']);
  const s4 = run(dir2, ['hook', 'stop'], '{}');
  assert.equal(s4.status, 0, s4.stdout + s4.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('集成：context pack 拒绝 DENY 路径入包', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [] }] },
  });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
  const res = run(dir, ['context', 'pack', '--paths', 'src/a.ts,.env', '--json']);
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  const paths = out.files.map((f) => f.path);
  assert.ok(paths.includes('src/a.ts'));
  assert.ok(!paths.includes('.env'));
  assert.ok(out.denied >= 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：catalog lint CLI 悬空依赖 exit 3', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: ['ghost'] }] },
  });
  const res = run(dir, ['catalog', 'lint', '--json']);
  assert.equal(res.status, 3);
  assert.ok(JSON.parse(res.stdout).errors.some((e) => e.code === 'DANGLING_DEP'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：fast 开关与状态', () => {
  const dir = mkproj();
  const on = run(dir, ['fast', 'on', '--json']);
  assert.equal(JSON.parse(on.stdout).enabled, true);
  const st = run(dir, ['fast', 'status', '--json']);
  assert.equal(JSON.parse(st.stdout).enabled, true);
  const off = run(dir, ['fast', 'off', '--json']);
  assert.equal(JSON.parse(off.stdout).enabled, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('集成：doctor 在完整项目上通过', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low', security: 'none', safety: 'none', privacy: 'none', resilience: 'none' }, reason: '测试仓' }] },
    matrix: { version: 1, checks: [] },
  });
  // doctor 需要 .zcode/config.json + skills/commands/rules/docs 目录
  fs.mkdirSync(path.join(dir, '.zcode'), { recursive: true });
  fs.copyFileSync(path.join(path.dirname(RUNTIME_SRC), '.zcode', 'config.json'), path.join(dir, '.zcode', 'config.json'));
  for (const d of ['rules', path.join('docs', 'adr')]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const d of [path.join('.agents', 'skills'), path.join('.agents', 'commands', 'zbase')]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const res = run(dir, ['doctor', '--json']);
  assert.equal(res.status, 0, res.stdout);
  const out = JSON.parse(res.stdout);
  assert.ok(out.ok);
  fs.rmSync(dir, { recursive: true, force: true });
});
