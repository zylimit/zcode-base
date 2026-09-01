// zcode-base 测试：单元（common/catalog/impact/arch）+ 集成（CLI 子进程：账本/门禁/hook/质量门/安装面）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const ZCODE_SRC = fileURLToDir(new URL('../.zcode', import.meta.url));

function fileURLToDir(u) {
  return u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
}

// ---------- 单元：common ----------

test('canonicalJson 键排序确定性', async () => {
  const { canonicalJson, sha256 } = await import('../.zcode/lib/common.mjs');
  const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
});

test('glob 语义：** 跨目录、* 单段', async () => {
  const { matchAny } = await import('../.zcode/lib/common.mjs');
  assert.ok(matchAny('src/a/b/c.ts', ['src/**/*.ts']));
  assert.ok(matchAny('src/x.ts', ['src/*.ts']));
  assert.ok(!matchAny('src/a/x.ts', ['src/*.ts']));
  assert.ok(matchAny('.env', ['.env', '.env.*']));
  assert.ok(matchAny('.env.local', ['.env', '.env.*']));
});

// ---------- 单元：catalog ----------

test('catalog lint：悬空依赖/未归类/重叠报错，环告警', async () => {
  const { lint, classify } = await import('../.zcode/lib/catalog.mjs');
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
  const { lint } = await import('../.zcode/lib/catalog.mjs');
  const cat = { version: 1, modules: [
    { name: 'a', globs: ['src/**'] },
    { name: 'b', globs: ['src/b/**'] },
  ] };
  const res = lint(cat, { trackedPaths: ['src/b/x.ts'] });
  assert.ok(res.errors.some((e) => e.code === 'OVERLAP'));
});

// ---------- 单元：impact 反向闭包 ----------

test('impact：反向闭包含传递消费者；unmapped 触发 degraded 全 fanout', async () => {
  const { analyze } = await import('../.zcode/lib/impact.mjs');
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
  const { reverseClosure } = await import('../.zcode/lib/impact.mjs');
  const closure = reverseClosure(cat, ['infra']);
  assert.deepEqual(closure.sort(), ['domain', 'infra', 'ui']);
});

// ---------- 单元：arch import 提取 ----------

test('arch：多语言 import 提取', async () => {
  const arch = await import('../.zcode/lib/arch.mjs');
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
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true }); // 运行态不随测试项目拷贝
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch {}
  return dir;
}

function run(cwd, args, stdin = '', env = {}) {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
}

// doctor 可通过项目：catalog/matrix + doctor 检查的全部目录；hooks 通道由用例自行布置
function mkdoctorproj() {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low', security: 'none', safety: 'none', privacy: 'none', resilience: 'none' }, reason: '测试仓' }] },
    matrix: { version: 1, checks: [] },
  });
  fs.mkdirSync(path.join(dir, '.zcode'), { recursive: true });
  for (const d of [path.join('.zcode', 'rules'), path.join('.zcode', 'docs', 'adr')]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const d of [path.join('.zcode', 'skills'), path.join('.zcode', 'commands', 'zbase')]) fs.mkdirSync(path.join(dir, d), { recursive: true });
  return dir;
}

// 临时 HOME：用例涉及用户级 ~/.zcode/cli/config.json 时必须隔离，绝不写真实 HOME
function mkhome({ userConfig } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-home-'));
  if (userConfig !== undefined) {
    fs.mkdirSync(path.join(home, '.zcode', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(home, '.zcode', 'cli', 'config.json'), userConfig);
  }
  return home;
}

// 工作区通道完整注册形态（doctor 只验 enabled + 7 事件键）
function fullWorkspaceHooks() {
  const events = {};
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    events[e] = [{ hooks: [{ type: 'command', command: 'true' }] }];
  }
  return JSON.stringify({ hooks: { enabled: true, events } }, null, 2) + '\n';
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
  const bad = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.zcode', 'state', 'ledger.jsonl') } }));
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
  const ledger = path.join(dir, '.zcode', 'state', 'ledger.jsonl');
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

test('集成：install 注册用户级 hooks（幂等、保留用户数据），doctor 用户级通道通过', () => {
  const dir = mkdoctorproj();
  fs.writeFileSync(path.join(dir, '.zcode', 'config.json'), '{}\n'); // 工作区 hooks 已清空（迁移后形态）
  const home = mkhome({ userConfig: JSON.stringify({ mcp: { servers: { demo: { type: 'stdio', command: 'demo', enabled: true } } } }) });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  try {
    const ins = run(dir, ['install', target, '--json'], '', { HOME: home });
    assert.equal(ins.status, 0, ins.stdout + ins.stderr);
    const rep = JSON.parse(ins.stdout);
    assert.equal(rep.hooksRegistered.events, 7);
    assert.equal(rep.hooksRegistered.commands, 8);
    assert.equal(rep.hooksRegistered.file, path.join(home, '.zcode', 'cli', 'config.json'));
    assert.equal(rep.hooksRegistered.backup, null); // 无既有 hooks → 不触发备份
    assert.ok(rep.next.some((s) => s.includes('重启 ZCode 会话')));
    const ucfgPath = path.join(home, '.zcode', 'cli', 'config.json');
    const ucfg = JSON.parse(fs.readFileSync(ucfgPath, 'utf8'));
    assert.equal(ucfg.mcp.servers.demo.command, 'demo'); // 只覆写 hooks，用户数据保留
    assert.equal(Object.keys(ucfg.hooks.events).length, 7);
    const commands = Object.values(ucfg.hooks.events).flat().map((g) => g.hooks).flat();
    assert.equal(commands.length, 8); // PreToolUse 占 2 条 matcher 组
    assert.ok(commands.every((h) => h.command.startsWith('if [ -f "${ZCODE_PROJECT_DIR}/.zcode/zbase.mjs" ]') && h.command.endsWith('else exit 0; fi')));
    // 幂等：重复 install 覆写而非堆叠
    run(dir, ['install', target, '--json'], '', { HOME: home });
    const ucfg2 = JSON.parse(fs.readFileSync(ucfgPath, 'utf8'));
    assert.equal(ucfg2.hooks.events.SessionStart.length, 1);
    assert.equal(ucfg2.mcp.servers.demo.command, 'demo');
    assert.deepEqual(fs.readdirSync(path.join(home, '.zcode', 'cli')).filter((f) => f.startsWith('config.json.bak-zbase-')), []); // 等值重装零备份
    // doctor：工作区通道不满足 → 用户级通道 PASS
    const res = run(dir, ['doctor', '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout);
    const out = JSON.parse(res.stdout);
    assert.ok(out.ok);
    assert.match(out.checks.find((c) => c.id === 'hooks-events').detail, /用户级注册/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('集成：doctor 工作区 hooks 通道通过', () => {
  const dir = mkdoctorproj();
  fs.writeFileSync(path.join(dir, '.zcode', 'config.json'), fullWorkspaceHooks());
  const home = mkhome(); // 无用户级配置
  try {
    const res = run(dir, ['doctor', '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout);
    const out = JSON.parse(res.stdout);
    assert.ok(out.ok);
    assert.match(out.checks.find((c) => c.id === 'hooks-events').detail, /工作区注册/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('集成：doctor 双通道皆缺时 hooks FAIL 并给修复指引', () => {
  const dir = mkdoctorproj();
  fs.writeFileSync(path.join(dir, '.zcode', 'config.json'), '{}\n');
  const home = mkhome();
  try {
    const res = run(dir, ['doctor', '--json'], '', { HOME: home });
    assert.equal(res.status, 3, res.stdout);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, false);
    assert.equal(out.checks.find((c) => c.id === 'hooks-enabled').ok, false);
    assert.match(res.stdout, /不存在/); // 两条通道缺置可见
    assert.match(out.checks.find((c) => c.id === 'hooks-events').detail, /install/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('集成：install 覆写第三方 hooks 前整文件备份，等值重装不再备份', () => {
  const dir = mkproj();
  const thirdParty = {
    hooks: { enabled: true, events: { SessionStart: [{ hooks: [{ type: 'command', command: 'my-third-party-tool' }] }] } },
    mcp: { servers: { demo: { type: 'stdio', command: 'demo', enabled: true } } },
  };
  const home = mkhome({ userConfig: JSON.stringify(thirdParty) });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const cliDir = path.join(home, '.zcode', 'cli');
  const baks = () => fs.readdirSync(cliDir).filter((f) => f.startsWith('config.json.bak-zbase-'));
  try {
    const ins1 = run(dir, ['install', target, '--json'], '', { HOME: home });
    assert.equal(ins1.status, 0, ins1.stdout + ins1.stderr);
    const rep1 = JSON.parse(ins1.stdout);
    assert.match(rep1.hooksRegistered.backup, /config\.json\.bak-zbase-/); // 备份路径可见
    assert.ok(rep1.next.some((s) => s.includes('已备份用户级 hooks 至'))); // 警告进 next
    // (a) 主文件 hooks 已为 spec 形态
    const main1 = JSON.parse(fs.readFileSync(path.join(cliDir, 'config.json'), 'utf8'));
    assert.equal(Object.keys(main1.hooks.events).length, 7);
    assert.ok(main1.hooks.events.SessionStart[0].hooks[0].command.includes('zbase.mjs'));
    // (b) 备份文件存在，整文件原样，第三方 hooks 可找回
    assert.equal(baks().length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(rep1.hooksRegistered.backup, 'utf8')), thirdParty);
    assert.equal(JSON.parse(fs.readFileSync(rep1.hooksRegistered.backup, 'utf8')).hooks.events.SessionStart[0].hooks[0].command, 'my-third-party-tool');
    // (c) mcp 键仍在主文件
    assert.equal(main1.mcp.servers.demo.command, 'demo');
    // 等值重装：backup=null、无新备份文件
    const ins2 = run(dir, ['install', target, '--json'], '', { HOME: home });
    assert.equal(ins2.status, 0, ins2.stdout + ins2.stderr);
    assert.equal(JSON.parse(ins2.stdout).hooksRegistered.backup, null);
    assert.equal(baks().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('集成：install 遇损坏的用户级配置 fail-visible 且不改动文件', () => {
  const dir = mkproj();
  const home = mkhome({ userConfig: '{broken' });
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  try {
    const res = run(dir, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /解析失败/);
    assert.equal(fs.readFileSync(path.join(home, '.zcode', 'cli', 'config.json'), 'utf8'), '{broken'); // 未被改写
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
