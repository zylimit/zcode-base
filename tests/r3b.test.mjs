// Phase 7 R3b 机制测试（Task 7.6/7.9/7.10/7.11/7.12）：
// 写路径预检（scope/并发冲突/symlink 逃逸/基线刷新）、budget 四指标、archive append-only 幂等 + M3、
// sync-check 双 error + Stop 挂 sync + recorder 豁免、3 git hooks、agents-lint、recap/invariants 预算化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import url from 'node:url';

const ZCODE_SRC = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '.zcode');
const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

function mkproj({ catalog, matrix, harness } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r3b-'));
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

function sh(cwd, script, args = []) {
  return spawnSync('sh', [script, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function commitAll(dir, msg = 'init scaffold') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回' };

// ---------- Task 7.6：写路径预检 ----------

test('7.6 单元：patchPaths / candidateWritePaths / shellWritePaths 提取', async () => {
  const w = await import('../.zcode/lib/writes.mjs');
  assert.deepEqual(w.patchPaths('*** Add File: a.txt\n+x\n*** Update File: b/c.md'), ['a.txt', 'b/c.md']);
  // apply_patch 工具名 → 补丁文本解析
  assert.deepEqual(w.candidateWritePaths('apply_patch', { patch: '*** Delete File: old.txt' }), ['old.txt']);
  // 路径键递归提取（嵌套对象）
  assert.deepEqual(w.candidateWritePaths('Edit', { file_path: 'x.ts', edits: [{ path: 'y.ts' }] }).sort(), ['x.ts', 'y.ts']);
  // shell：重定向 / tee / cp 末操作数 / PowerShell Set-Content -Path
  assert.deepEqual(w.shellWritePaths('echo hi > out.txt'), ['out.txt']);
  assert.deepEqual(w.shellWritePaths('echo hi >> logs/app.log | tee full.log'), ['logs/app.log', 'full.log']);
  assert.deepEqual(w.shellWritePaths('cp src/a.ts dist/a.ts'), ['dist/a.ts']);
  assert.deepEqual(w.shellWritePaths('mv a b && rm -rf -- target'), ['b', 'target']);
  assert.deepEqual(w.shellWritePaths('Set-Content -Path cfg.json -Value x'), ['cfg.json']);
  assert.deepEqual(w.shellWritePaths('Copy-Item -Destination bin/out.js'), ['bin/out.js']);
  // 动态路径（$VAR/*）不提取——展开结果不可知，不误判
  assert.deepEqual(w.shellWritePaths('echo hi > $TMP/x.log'), []);
  // /dev/null 等设备汇不是文件写目标（`cmd > /dev/null 2>&1` 不得被误拦为仓外写）
  assert.deepEqual(w.shellWritePaths('node build.js > /dev/null 2>&1'), []);
  assert.deepEqual(w.shellWritePaths('cat a.txt 2>/dev/null | tee out.log'), ['out.log']);
});

test('7.6 ownedPaths 闸：任务内路径放行，任务外路径 deny（工具与 shell 两路）', () => {
  const dir = mkproj({ catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] } });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const t = run(dir, ['task', 'start', '--input', '-', '--owned', 'src/**'], JSON.stringify(ENVELOPE));
  assert.equal(t.status, 0, t.stdout + t.stderr);
  // 任务内：允许
  const inScope = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'app.ts') } }));
  assert.equal(inScope.status, 0, inScope.stderr);
  // 任务外（工具）：deny TASK_SCOPE
  const outScope = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'docs', 'x.md') } }));
  assert.equal(outScope.status, 2);
  assert.match(outScope.stderr, /TASK_SCOPE/);
  // 任务外（shell 重定向）：同一闸
  const shellOut = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi > docs/x.md' } }));
  assert.equal(shellOut.status, 2);
  assert.match(shellOut.stderr, /TASK_SCOPE/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.6 knownHashes 并发冲突：外部改动后写 deny（冲突/新文件两态），基线刷新后可写', () => {
  const dir = mkproj();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'shared.ts'), 'v0');
  commitAll(dir, 'seed');
  const t = run(dir, ['task', 'start', '--input', '-', '--owned', 'src'], JSON.stringify(ENVELOPE));
  assert.equal(t.status, 0, t.stdout + t.stderr);
  // 任务外进程改了 owned 内的 tracked 文件 → deny TASK_CONCURRENT_CHANGE
  fs.writeFileSync(path.join(dir, 'src', 'shared.ts'), 'v1-by-someone-else');
  const conflict = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src', 'shared.ts') } }));
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /TASK_CONCURRENT_CHANGE/);
  // 任务外进程在 owned 内新建文件 → deny TASK_NEW_FILE_CONFLICT（存在但不在基线）
  fs.writeFileSync(path.join(dir, 'src', 'brand-new.ts'), 'externally created');
  const newFile = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'brand-new.ts') } }));
  assert.equal(newFile.status, 2);
  assert.match(newFile.stderr, /TASK_NEW_FILE_CONFLICT/);
  // 任务内正常流：新路径首写允许（尚不存在）→ PostToolUse 刷新基线 → 再次写仍允许（自己写的样子=新基线）
  const appTs = path.join(dir, 'src', 'app.ts');
  const first = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: appTs } }));
  assert.equal(first.status, 0, first.stderr);
  fs.writeFileSync(appTs, 'written by this task');
  const post = run(dir, ['hook', 'post-tool-use'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: appTs } }));
  assert.equal(post.status, 0, post.stderr);
  const second = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: appTs } }));
  assert.equal(second.status, 0, second.stderr);
  // touchedPaths 留痕
  const st = JSON.parse(run(dir, ['task', 'status', '--json']).stdout);
  assert.ok(st.active.touchedPaths.includes('src/app.ts'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.6 symlink 逃逸：目录链指向仓外 → deny（无任务也拦）', () => {
  const dir = mkproj();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-out-'));
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'outside');
  fs.symlinkSync(outside, path.join(dir, 'linkdir'), 'dir');
  const res = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'linkdir', 'victim.txt') } }));
  assert.equal(res.status, 2);
  assert.match(res.stderr, /write-preflight/);
  assert.match(res.stderr, /symlink 逃逸/);
  // 仓内正常路径不受影响
  const ok = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'normal.txt') } }));
  assert.equal(ok.status, 0, ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

// ---------- Task 7.9：budget + archive ----------

test('7.9 budget 四指标：超限 exit 1 + advice；预算内 exit 0', () => {
  const dir = mkproj({ harness: { budget: { maxChangedFiles: 2, maxNewFiles: 2, maxChangedLines: 10 } } });
  commitAll(dir);
  const clean = run(dir, ['budget', '--json']);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.equal(JSON.parse(clean.stdout).ok, true);
  // 3 个新文件（untracked）超 maxNewFiles/maxChangedFiles
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, `new-${i}.txt`), 'x');
  const over = run(dir, ['budget', '--json']);
  assert.equal(over.status, 1);
  const oo = JSON.parse(over.stdout);
  assert.equal(oo.ok, false);
  assert.ok(oo.findings.some((f) => f.metric === 'newFiles'));
  assert.match(oo.advice, /拆分变更|ADR/);
  // changedLines：numstat 累加（对已提交文件加大段变更）
  commitAll(dir, 'add new files');
  fs.writeFileSync(path.join(dir, 'new-0.txt'), `${Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')}\n`);
  const lines = run(dir, ['budget', '--json']);
  assert.equal(lines.status, 1);
  const lo = JSON.parse(lines.stdout);
  assert.ok(lo.metrics.changedLines >= 19, `changedLines=${lo.metrics.changedLines}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.9 archive：dry-run 计划 → --apply append-only 搬迁 + 指针 → 二次 --apply 幂等', () => {
  const dir = mkproj();
  const done = Array.from({ length: 45 }, (_, i) => `- 2026-09-01 完成条目 ${i + 1}（测试填充）`);
  fs.writeFileSync(path.join(dir, 'progress.md'), `# progress\n\n## Pinned\n\n- 固定约束\n\n## Done（完成流水）\n\n${done.join('\n')}\n`);
  // dry-run：plan 报告移动 5 条，不动文件
  const plan = run(dir, ['archive', '--json']);
  assert.equal(plan.status, 0);
  const po = JSON.parse(plan.stdout);
  assert.equal(po.applied, false);
  assert.equal(po.moved, 5);
  assert.equal(po.plan[0].section, 'Done');
  assert.equal(fs.existsSync(path.join(dir, 'progress.archive.md')), false);
  // --apply：归档 append-only + 活账本留最新 40 条（append 契约=最新在尾 → 头部最旧的条目 1-5 被搬走）
  const apply = run(dir, ['archive', '--apply', '--json']);
  assert.equal(apply.status, 0);
  const ao = JSON.parse(apply.stdout);
  assert.equal(ao.applied, true);
  assert.equal(ao.moved, 5);
  const archiveText = fs.readFileSync(path.join(dir, 'progress.archive.md'), 'utf8');
  assert.match(archiveText, /# Archived project memory/);
  assert.match(archiveText, /## Archived \d{4}-\d{2}-\d{2}/);
  assert.ok(archiveText.includes('完成条目 1（测试填充）'), '最旧条目（头部）必须进归档');
  const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
  assert.match(live, /Older entries are in \[progress\.archive\.md\]/);
  assert.ok(live.includes('完成条目 45（测试填充）'), '最新条目必须留在活账本');
  assert.ok(!live.includes('完成条目 5（'), '最旧条目不得留在活账本');
  assert.equal((live.match(/- 2026-09-01 完成条目/g) || []).length, 40);
  // 幂等：再跑一次无账可归
  const again = run(dir, ['archive', '--apply', '--json']);
  assert.equal(again.status, 0);
  assert.equal(JSON.parse(again.stdout).moved, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.9 M3 阈值：Done>100 → ledgerHealth.autoArchiveSuggested', () => {
  const dir = mkproj();
  const done = Array.from({ length: 105 }, (_, i) => `- 条目 ${i + 1}`);
  fs.writeFileSync(path.join(dir, 'progress.md'), `# progress\n\n## Done\n\n${done.join('\n')}\n`);
  const res = run(dir, ['archive', '--json']);
  const ro = JSON.parse(res.stdout);
  assert.equal(ro.health.autoArchiveSuggested, true);
  assert.match(ro.health.advice, /M3/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 7.10：sync-check + Stop 挂 sync + git hooks ----------

function mksyncrepo() {
  const dir = mkproj({ catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] } });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;');
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress\n\n## Pinned\n\n- 种子\n');
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), '# spec v1\n');
  fs.writeFileSync(path.join(dir, 'Product-Spec-CHANGELOG.md'), '# changelog\n\n## v1\n\n- 初始\n');
  commitAll(dir, 'seed');
  return dir;
}

test('7.10 sync-check：MEMORY_BEHIND_CODE / SPEC_WITHOUT_CHANGELOG 双 error；成对更新后通过', () => {
  const dir = mksyncrepo();
  // 双 error：代码变更 + Spec 单边变更，progress 与 CHANGELOG 都没动
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 2;');
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), '# spec v2\n');
  const bad = run(dir, ['sync-check', '--json']);
  assert.equal(bad.status, 1);
  const bo = JSON.parse(bad.stdout);
  assert.ok(bo.errors.some((e) => e.code === 'MEMORY_BEHIND_CODE'));
  assert.ok(bo.errors.some((e) => e.code === 'SPEC_WITHOUT_CHANGELOG'));
  // 反向：CHANGELOG 单独变更 → warning 不阻断
  git(dir, 'checkout', '--', '.');
  fs.writeFileSync(path.join(dir, 'Product-Spec-CHANGELOG.md'), '# changelog\n\n## v1\n\n- 初始（记录性补充）\n');
  const warn = run(dir, ['sync-check', '--json']);
  assert.equal(warn.status, 0);
  assert.ok(JSON.parse(warn.stdout).warnings.some((w) => w.code === 'CHANGELOG_WITHOUT_SPEC'));
  // 成对同步：代码+progress+Spec+CHANGELOG 同窗 → 通过
  git(dir, 'checkout', '--', '.');
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 3;');
  fs.appendFileSync(path.join(dir, 'progress.md'), '- 同步记录\n');
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), '# spec v3\n');
  fs.writeFileSync(path.join(dir, 'Product-Spec-CHANGELOG.md'), '# changelog\n\n## v1\n\n- 初始\n- v3 变更\n');
  const good = run(dir, ['sync-check', '--json']);
  assert.equal(good.status, 0, good.stdout);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.10 Stop 挂 three-file-sync：代码脏而 progress 未同步 → 拦停；recorder 豁免标志放行', () => {
  const dir = mksyncrepo();
  // progress.md mtime 老化到 2 秒窗口之外（recorder 豁免的 mtime 通道不触发，验证同步门本体）
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'progress.md'), old, old);
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 9;');
  const blocked = run(dir, ['hook', 'stop'], '{}');
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /MEMORY_BEHIND_CODE/);
  assert.match(blocked.stderr, /先同步 progress\.md/);
  // recorder 豁免：写入窗口标志存在 → 同步门放行（此处无回执，随后被回执门接管——语义上不再拦同步）
  fs.writeFileSync(path.join(dir, '.zcode', 'state', '.progress-recording'), '');
  const exempt = run(dir, ['hook', 'stop'], '{}');
  assert.equal(exempt.status, 2);
  assert.doesNotMatch(exempt.stderr, /MEMORY_BEHIND_CODE/);
  assert.match(exempt.stderr, /回执|receipt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.10 commit-msg：短主题/空词拒，正常主题过，超长只警不阻断', () => {
  const dir = mkproj();
  const hook = path.join(dir, '.zcode', 'githooks', 'commit-msg');
  const mkmsg = (s) => {
    const f = path.join(dir, 'msg.txt');
    fs.writeFileSync(f, `${s}\n\nbody\n`);
    return f;
  };
  assert.equal(sh(dir, hook, [mkmsg('fix')]).status, 1); // 空词 + 短
  assert.equal(sh(dir, hook, [mkmsg('wip')]).status, 1);
  assert.match(sh(dir, hook, [mkmsg('short')]).stderr, /12/); // <12 字符拒
  const good = sh(dir, hook, [mkmsg('feat: 写路径预检挡住任务外并发写')]);
  assert.equal(good.status, 0, good.stderr);
  const merge = sh(dir, hook, [mkmsg('Merge branch x')]);
  assert.equal(merge.status, 0); // Merge 前缀放行
  const long = sh(dir, hook, [mkmsg('feat: 这是一个明显超过七十二字符上限的超长提交主题用于验证只警告不阻断的行为')]);
  assert.equal(long.status, 0); // >72 警告不阻断
  assert.match(long.stderr, /72/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.10 pre-commit 真跑：缺 progress 同步 staged → 阻断；成对 staged → 通过', () => {
  const dir = mksyncrepo();
  const hook = path.join(dir, '.zcode', 'githooks', 'pre-commit');
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 7;');
  git(dir, 'add', 'src/a.ts');
  const bad = sh(dir, hook);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /sync-check/);
  // 成对 staged：progress.md 也改并 stage → sync 过；无秘密；无 tsconfig → 编译门跳过 → exit 0
  fs.appendFileSync(path.join(dir, 'progress.md'), '- pre-commit 验证记录\n');
  git(dir, 'add', 'progress.md');
  const good = sh(dir, hook);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.10 pre-commit 秘密扫描：staged 内容含 AKIA key → 阻断', () => {
  const dir = mksyncrepo();
  const hook = path.join(dir, '.zcode', 'githooks', 'pre-commit');
  const AKIA = `AKIA${'IOSFODNN7EXAMPLE'}`; // 运行期拼装：本测试文件源码不落连续字面量
  fs.writeFileSync(path.join(dir, 'config.js'), `module.exports = { key: "${AKIA}" };\n`);
  fs.appendFileSync(path.join(dir, 'progress.md'), '- 秘密扫描验证\n');
  git(dir, 'add', 'config.js', 'progress.md');
  const res = sh(dir, hook);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /秘密/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.10 install --hooks：接线 core.hooksPath + chmod；已有他方 hooksPath 不覆盖', () => {
  const src = mkproj();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-home-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
    const ins = run(src, ['install', target, '--hooks', '--json'], '', { HOME: home });
    assert.equal(ins.status, 0, ins.stdout + ins.stderr);
    const rep = JSON.parse(ins.stdout);
    assert.equal(rep.gitHooks.wired, true);
    assert.equal(execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: target, encoding: 'utf8' }).trim(), '.zcode/githooks');
    // 执行性断言分平台（CI #73）：posix 验权限位；win32 的 NTFS statSync().mode 不含执行位
    //（执行性由 Git Bash 调用语义承担，engine 侧 chmodSync 在 win32 无效果但不报错）——
    // 改验真实行为面：三钩子文件存在 + core.hooksPath 已接线（上方已断言）。
    if (process.platform === 'win32') {
      for (const hookFile of ['pre-commit', 'commit-msg', 'pre-push']) {
        assert.ok(fs.existsSync(path.join(target, '.zcode', 'githooks', hookFile)), `钩子文件 ${hookFile} 必须存在`);
      }
    } else {
      const st = fs.statSync(path.join(target, '.zcode', 'githooks', 'pre-commit'));
      assert.ok(st.mode & 0o111, '钩子必须可执行');
    }
    // 他方 hooksPath：不覆盖只告警
    execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: target, stdio: 'ignore' });
    const ins2 = run(src, ['install', target, '--hooks', '--json'], '', { HOME: home });
    const rep2 = JSON.parse(ins2.stdout);
    assert.equal(rep2.gitHooks.wired, false);
    assert.match(rep2.gitHooks.warning, /husky|不覆盖/);
    assert.equal(execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: target, encoding: 'utf8' }).trim(), '.husky');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------- Task 7.11：agents-lint ----------

test('7.11 agents-lint：high 模块无契约 error；四段缺段 error（批次 4 升级：高档空壳契约拦截）；low 模块不要求', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [
      { name: 'hi', globs: ['src/hi/**'], riskTier: 'high', deps: [] },
      { name: 'lo', globs: ['src/lo/**'], riskTier: 'low', deps: [] },
    ] },
  });
  // 无契约 → error NO_MODULE_AGENTS（low 模块不要求）
  const bad = run(dir, ['agents-lint', '--json']);
  assert.equal(bad.status, 3);
  const bo = JSON.parse(bad.stdout);
  assert.ok(bo.errors.some((e) => e.code === 'NO_MODULE_AGENTS' && e.module === 'hi'));
  assert.ok(!bo.errors.some((e) => e.module === 'lo'));
  // 有契约但缺段 → error（批次 4：高档缺段从 warning 升 error——缺段的契约等于没写全边界）
  fs.mkdirSync(path.join(dir, 'src', 'hi'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), '# hi\n\n## Purpose 用途\n\n- 测试\n');
  const partial = run(dir, ['agents-lint', '--json']);
  assert.equal(partial.status, 3, partial.stdout);
  const po = JSON.parse(partial.stdout);
  assert.ok(po.errors.some((e) => e.code === 'MODULE_AGENTS_INCOMPLETE' && e.module === 'hi'));
  // 四段齐全 → 零告警
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), '# hi\n\n## Purpose 用途\n\n- x\n\n## Boundaries 边界\n\n- x\n\n## Invariants 不变量\n\n- x\n\n## Verification 验证\n\n- x\n');
  const full = run(dir, ['agents-lint', '--json']);
  assert.equal(full.status, 0);
  assert.equal(JSON.parse(full.stdout).warnings.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.11 本仓自举：runtime-harness(critical)/contracts(high) 嵌套契约在场 → agents-lint 通过', () => {
  const res = run(REPO_ROOT, ['agents-lint', '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const ro = JSON.parse(res.stdout);
  const names = ro.checked.map((c) => c.module);
  assert.ok(names.includes('runtime-harness'));
  assert.ok(names.includes('contracts'));
  assert.ok(ro.checked.every((c) => c.contract), 'high/critical 模块必须有契约文件');
});

test('7.11 catalog lint：非法 riskTier → BAD_RISK_TIER error', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], riskTier: 'extreme', deps: [] }] },
  });
  const res = run(dir, ['catalog', 'lint', '--json']);
  assert.equal(res.status, 3);
  assert.ok(JSON.parse(res.stdout).errors.some((e) => e.code === 'BAD_RISK_TIER'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 7.12：recap + invariants ----------

test('7.12 recap：预算硬截断有标注；无活跃任务输出 In progress=无', () => {
  const dir = mkproj();
  const pinned = Array.from({ length: 30 }, (_, i) => `- Pinned 条目 ${i + 1}：${'x'.repeat(120)}`);
  fs.writeFileSync(path.join(dir, 'progress.md'), `# progress\n\n## Pinned（长期约束）\n\n${pinned.join('\n')}\n\n## Done（完成流水）\n\n- 完成甲\n`);
  const res = run(dir, ['recap', '--budget', '800', '--json']);
  assert.equal(res.status, 0);
  const ro = JSON.parse(res.stdout);
  assert.equal(ro.truncated, true);
  assert.ok(ro.text.includes('recap 已在 800 字符处截断'), ro.text.slice(-120));
  assert.ok(ro.text.length < 1000);
  // 无预算参数 → 默认 6000 不截断
  const full = run(dir, ['recap', '--json']);
  const fo = JSON.parse(full.stdout);
  assert.equal(fo.truncated, false);
  assert.match(fo.text, /## In progress\n- 无活跃任务/);
  assert.match(fo.text, /完成甲/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.12 invariants：含五法则与活状态；fast DEBT 点名 skipped 清单；预算内', () => {
  const dir = mkproj({
    matrix: { version: 1, checks: [{ name: 'unit', proves: ['reliability'], scope: [], command: 'true', allowFastSkip: true }] },
  });
  let res = run(dir, ['invariants', '--json']);
  assert.equal(res.status, 0);
  let io = JSON.parse(res.stdout);
  for (const law of [/证据五步|五步/, /exit 3 不是通过|四态/, /security \/ safety \/ privacy|三性/, /ownedPaths|SCOPE/, /HIGH 档/]) {
    assert.match(io.text, law);
  }
  assert.match(io.text, /无活跃任务/);
  assert.ok(io.chars <= io.budget + 40);
  // fast 窗口 + SKIPPED 债务 → DEBT 点名
  run(dir, ['fast', 'on', '--minutes', '5', '--reason', '测试']);
  run(dir, ['gate', 'unit', '--json']);
  res = run(dir, ['invariants', '--json']);
  io = JSON.parse(res.stdout);
  assert.match(io.text, /FAST MODE 贷款/);
  assert.match(io.text, /DEBT/);
  assert.match(io.text, /unit/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('7.12 SessionStart 注入 recap：脏树校准提醒（A4）+ 待毕业 feedback 播报（A5）', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x'); // 脏树
  fs.mkdirSync(path.join(dir, '.zcode', 'feedback'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'FEEDBACK-INDEX.md'), [
    '# FEEDBACK-INDEX', '',
    '| 条目 | 主题 | occurrence | 毕业 |',
    '|---|---|---|---|',
    '| graduated-one | 已毕业条目 | 3 | 已机制化：x |',
    '| pending-one | 未毕业条目 | 1 |  |',
    '',
  ].join('\n'));
  const res = run(dir, ['hook', 'session-start'], '{}');
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /zcode-base 会话恢复/);
  assert.match(res.stdout, /Recap/); // recap 内容注入
  assert.match(res.stdout, /工作树非干净/); // A4
  assert.match(res.stdout, /待毕业 feedback 1 条/); // A5
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Review R1 修复：F13 OUTSIDE_REPO 限定活跃任务（任务边界执法） ----------

test('R1-F13 仓外写：无活跃任务放行，有活跃任务 deny（symlink 逃逸仍无条件拦）', () => {
  const dir = mkproj();
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi > /tmp/zbase-r1-probe.txt' } });
  // 无活跃任务：仓外写不属任务越权 → 放行（主 Agent 验收探针场景）
  const noTask = run(dir, ['hook', 'pre-tool-use'], payload);
  assert.equal(noTask.status, 0, `无任务时仓外写应放行：${noTask.stderr}`);
  // 有活跃任务：写目标在仓外 → 任务边界执法 deny
  const t = run(dir, ['task', 'start', '--input', '-', '--owned', 'src/**'], JSON.stringify(ENVELOPE));
  assert.equal(t.status, 0, t.stdout + t.stderr);
  const withTask = run(dir, ['hook', 'pre-tool-use'], payload);
  assert.equal(withTask.status, 2, `有任务时仓外写应拦：${withTask.stdout}`);
  assert.match(withTask.stderr, /OUTSIDE_REPO|写目标在仓外/);
  assert.match(withTask.stderr, /任务边界/);
  // symlink 逃逸保持无条件（无任务也拦）——安全面不放宽
  run(dir, ['task', 'finish', '--force', '--json']);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r1-out-'));
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'x');
  fs.symlinkSync(outside, path.join(dir, 'linkdir'), 'dir');
  const esc = run(dir, ['hook', 'pre-tool-use'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'linkdir', 'victim.txt') } }));
  assert.equal(esc.status, 2);
  assert.match(esc.stderr, /symlink 逃逸/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

// ---------- 字节预算归档：ledgerHealth 按字节判超 × archive 只按条目数搬 → advice 开出空药方的死锁 ----------
// 修复契约（本组测试锁定）：
//   1) memoryConfig 默认新增 keepMinDone:2 / keepMinNotes:1（字节模式保留下限，可被 harness.memory.* 覆盖）；
//   2) archiveLedger 按条目数规划后，若活账本 bytes > maxLedgerBytes → 额外搬最旧条目（先 Done 搬到位后仍 ≥ keepMinDone，
//      再 Notes 至 ≥ keepMinNotes），投影 = 当前 bytes − Σ(被搬行字节长+1)，搬到投影 ≤ maxLedgerBytes 或触底；
//      搬法遵循现有 append 契约（最新在尾 → 头部最旧，搬头留尾），指针行/append-only/幂等语义不变；
//   3) 触底仍超预算 → 结果对象 overBudget:true + reason（收紧条目长度或上调 memory.maxLedgerBytes），
//      CLI exit code 保持 0（机械搬迁成功），fail-visible 靠 flag + health.ok:false；
//   4) ledgerHealth：over 且 Done ≤ keepMinDone 且 Notes ≤ keepMinNotes（无可搬）时 advice 不得再说 archive --apply；
//   5) 纯条目数模式行为完全不变（T3 回归锚，现有 7.9 语义）。

// 字节模式 fixture：每条恰 100B 的 ASCII Done 条目（ASCII 下字节=字符数；Buffer.byteLength 实算自检防 fixture 漂移）
const byteDoneEntry = (i) => { const head = `- done-${String(i + 1).padStart(2, '0')} `; return head + 'x'.repeat(100 - Buffer.byteLength(head)); };
const byteLedgerText = (n) => `# progress\n\n## Done\n\n${Array.from({ length: n }, (_, i) => byteDoneEntry(i)).join('\n')}\n`;
const ARCHIVE_POINTER_LINE = '- Older entries are in [progress.archive.md](progress.archive.md).';

test('字节归档 T1：字节超预算而条数未超 → dry-run 有计划、--apply 搬最旧 3 条留最新 2 条、health 回绿、二次幂等', () => {
  const dir = mkproj({ harness: { memory: { maxLedgerBytes: 300 } } });
  // fixture 自检：5×100B 条目 + 21B 骨架 = 526B > 300（字节超限）；5 条 < keepDone=40（条数不超——正是缺陷场景）
  const text = byteLedgerText(5);
  assert.equal(Buffer.byteLength(text), 526, 'fixture：初始账本必须 526B');
  // 收敛自检（投影 = 526 − k×101；实际活账本 = 21B 骨架 + 66B 指针 + 留存条目）：
  // 搬 2 条投影 324>300 不得提前停；搬 3 条投影 223≤300、实际 290≤300 → 停点唯一（无论实现按投影还是按实际字节判定）
  assert.ok(526 - 2 * 101 > 300, 'fixture：搬 2 条后投影必须仍超预算（保证停点在 3 条）');
  assert.ok(526 - 3 * 101 <= 300, 'fixture：搬 3 条后投影必须入预算');
  const afterMove3 = `# progress\n\n## Done\n\n${ARCHIVE_POINTER_LINE}\n${byteDoneEntry(3)}\n${byteDoneEntry(4)}\n`;
  assert.ok(Buffer.byteLength(afterMove3) <= 300, 'fixture：搬 3 条后实际活账本必须 ≤ 预算（health 回绿的硬保证）');
  fs.writeFileSync(path.join(dir, 'progress.md'), text);
  // dry-run：字节超限必须有搬迁计划——现行实现 moved:0「无可归档条目」即本缺陷（advice 开空药方）
  const plan = run(dir, ['archive', '--json']);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const po = JSON.parse(plan.stdout);
  assert.equal(po.applied, false);
  assert.equal(po.moved, 3, `dry-run 必须如实预告字节模式将搬最旧 3 条（现行 moved:${po.moved} 即「字节超限却无可归档」死锁）`);
  assert.ok(po.plan.some((p) => p.section === 'Done'), 'plan 必须含 Done 段');
  assert.equal(fs.existsSync(path.join(dir, 'progress.archive.md')), false, 'dry-run 不得动盘');
  // --apply：最旧 3 条（done-01/02/03）进归档，最新 2 条（done-04/05）留活账本（keepMinDone=2），指针行在场
  const apply = run(dir, ['archive', '--apply', '--json']);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const ao = JSON.parse(apply.stdout);
  assert.equal(ao.applied, true);
  assert.equal(ao.moved, 3);
  const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
  assert.equal((live.match(/- done-\d\d /g) || []).length, 2, `活账本 Done 必须恰剩 keepMinDone=2 条，实际\n${live}`);
  assert.ok(live.includes('done-04') && live.includes('done-05'), '最新 2 条必须留在活账本');
  assert.ok(!live.includes('done-01') && !live.includes('done-02') && !live.includes('done-03'), '最旧 3 条不得留在活账本');
  assert.match(live, /Older entries are in \[progress\.archive\.md\]/, '归档指针行必须在场');
  const archiveText = fs.readFileSync(path.join(dir, 'progress.archive.md'), 'utf8');
  assert.match(archiveText, /# Archived project memory/);
  assert.ok(archiveText.includes('done-01') && archiveText.includes('done-02') && archiveText.includes('done-03'), '最旧 3 条必须进归档');
  assert.equal(ao.health.ok, true, `归档后活账本必须回预算内（290B ≤ 300B），health=${JSON.stringify(ao.health)}`);
  // 幂等：二次 --apply 无账可归（条数与字节都在预算内）
  const again = run(dir, ['archive', '--apply', '--json']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(JSON.parse(again.stdout).moved, 0, '二次 --apply 必须幂等（moved 0）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('字节归档 T2：搬到 keepMinDone 底线仍超预算 → 底线不破、overBudget 诚实上报（exit 0）、advice 不再开 archive 空药方', () => {
  // 150B 预算：保留最新 2 条（2×100B）后实际 290B 仍 > 150B → 触底仍超（自检防 fixture 漂移）
  const dir = mkproj({ harness: { memory: { maxLedgerBytes: 150 } } });
  const afterFloor = `# progress\n\n## Done\n\n${ARCHIVE_POINTER_LINE}\n${byteDoneEntry(3)}\n${byteDoneEntry(4)}\n`;
  assert.ok(Buffer.byteLength(afterFloor) > 150, 'fixture：保留底线后必须仍超预算');
  fs.writeFileSync(path.join(dir, 'progress.md'), byteLedgerText(5));
  const apply = run(dir, ['archive', '--apply', '--json']);
  assert.equal(apply.status, 0, '机械搬迁成功必须 exit 0（fail-visible 靠 overBudget flag，不靠 exit code）');
  const ao = JSON.parse(apply.stdout);
  // 底线不破 + 能搬的照搬（触底 ≠ 不搬）
  const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
  assert.equal((live.match(/- done-\d\d /g) || []).length, 2, `keepMinDone 底线：活账本 Done 不得低于 2 条，实际\n${live}`);
  assert.ok(live.includes('done-05'), '最新条目必须保留');
  const archiveText = fs.readFileSync(path.join(dir, 'progress.archive.md'), 'utf8');
  assert.ok(archiveText.includes('done-01') && archiveText.includes('done-03'), '触底前可搬的最旧 3 条必须已机械搬入归档');
  // 诚实上报：overBudget flag + 出路提示；health fail-visible；advice 不得再开空药方
  assert.equal(ao.overBudget, true, `触底仍超必须 overBudget:true，实际=${JSON.stringify(ao).slice(0, 400)}`);
  assert.match(`${ao.reason ?? ''} ${ao.health?.advice ?? ''}`, /收紧|上调/, 'reason/advice 必须提示收紧条目长度或上调 maxLedgerBytes');
  assert.equal(ao.health.ok, false, '触底仍超时 health 必须 ok:false');
  assert.doesNotMatch(ao.health.advice, /archive --apply/, '无可搬时 advice 不得再开 archive --apply（空药方死锁根因）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('字节归档 T3 回归锚：纯条目数模式行为不变——45 条薄条目、字节预算充足 → moved 恰为 5（keepDone=40）', () => {
  const dir = mkproj({ harness: { memory: { maxLedgerBytes: 10_000_000 } } });
  const done = Array.from({ length: 45 }, (_, i) => `- 2026-09-01 完成条目 ${i + 1}（测试填充）`);
  fs.writeFileSync(path.join(dir, 'progress.md'), `# progress\n\n## Pinned\n\n- 固定约束\n\n## Done（完成流水）\n\n${done.join('\n')}\n`);
  const plan = run(dir, ['archive', '--json']);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const po = JSON.parse(plan.stdout);
  assert.equal(po.moved, 5, `条目数模式 moved 必须恰为 5（45−40），实际 ${po.moved}`);
  assert.equal(po.plan[0].section, 'Done');
  assert.equal(po.plan[0].moving, 5);
  assert.equal(po.overBudget ?? false, false, '预算内不得误报 overBudget');
  const apply = run(dir, ['archive', '--apply', '--json']);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  assert.equal(JSON.parse(apply.stdout).moved, 5);
  const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
  assert.equal((live.match(/- 2026-09-01 完成条目/g) || []).length, 40);
  assert.ok(live.includes('完成条目 45（测试填充）'), '最新条目必须留在活账本');
  assert.ok(!live.includes('完成条目 5（'), '最旧条目不得留在活账本');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- 字节预算归档复审 P2 修复契约（T4/T5）----------
//   P2-F1 投影漏算指针行：首次归档 --apply 会在被搬块首插入指针行（66B+换行），停机与 overBudget 判定必须
//      计入该成本（已有指针行则删旧插新净零）——否则压线区间出现「顶层 overBudget:false、内嵌 health.ok:false」
//      的自相矛盾，只看 overBudget 的上层静默漏报；
//   P2-F2 movedSet 全行精确匹配：逐字节相同的重复条目被连带误删，可击穿 keepMin 底线并丢副本——改按出现
//      计数（multiset）删除，append 契约（最旧在头）下首个命中即最旧副本。

test('字节归档 T4：压线一致性——overBudget 与 health.ok 不得自相矛盾（投影计入指针行成本）', () => {
  // 224B 预算落在缺陷窗口：漏计指针的投影 526−3×101=223 ≤ 224 假达标停机；计入指针 526+67−303=290 > 224 触底仍超
  const dir = mkproj({ harness: { memory: { maxLedgerBytes: 224 } } });
  const text = byteLedgerText(5);
  assert.equal(Buffer.byteLength(text), 526, 'fixture：初始账本必须 526B');
  const pointerCost = Buffer.byteLength(ARCHIVE_POINTER_LINE) + 1; // 指针行本体 + 换行符
  assert.ok(526 - 3 * 101 <= 224, 'fixture：漏计指针的投影恰好「达标」——本缺陷窗口（预算 224 的意义所在）');
  assert.ok(526 + pointerCost - 3 * 101 > 224, 'fixture：计入指针后触底仍超预算（真实态必须超）');
  fs.writeFileSync(path.join(dir, 'progress.md'), text);
  const apply = run(dir, ['archive', '--apply', '--json']);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const ao = JSON.parse(apply.stdout);
  assert.equal(ao.applied, true);
  assert.equal(ao.moved, 3, `fixture 锁定：本预算下停点必须恰在 3 条（keepMinDone 触底），实际 ${ao.moved}`);
  // 一致性（不预设哪边）：overBudget ⟺ !health.ok——顶层与内嵌 health 对「是否在预算内」必须同一定调
  assert.equal(ao.overBudget, !ao.health.ok,
    `顶层 overBudget:${ao.overBudget} 与内嵌 health.ok:${ao.health.ok} 自相矛盾（投影漏算指针行成本的典型症状）`);
  // 活账本实际字节必须与 health.bytes 逐字一致（health 是落盘后实测，不得报旧值/预估值）
  const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
  assert.equal(ao.health.bytes, Buffer.byteLength(live, 'utf8'), 'health.bytes 必须等于活账本实际字节');
  // advice 与实态一致：超预算且已到保留下限（无可搬）时不得再开 archive --apply 空药方，必须给出收紧/上调出路
  const liveDone = (live.match(/- done-\d\d /g) || []).length;
  if (!ao.health.ok && liveDone <= 2) {
    assert.doesNotMatch(ao.health.advice, /archive --apply/, '无可搬时 advice 不得说 archive --apply');
    assert.match(ao.health.advice, /收紧|上调/, '无可搬时 advice 必须提示收紧条目长度或上调 maxLedgerBytes');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('字节归档 T5：重复文本条目按出现计数删除——keepMin 底线不破、保留区副本不丢', () => {
  // 位置 1 与位置 5 逐字节相同的 5 条 Done；预算 300 → 恰搬最旧 3 条（计入指针 290 ≤ 300 < 391，停点唯一）
  const dir = mkproj({ harness: { memory: { maxLedgerBytes: 300 } } });
  const dup = byteDoneEntry(0);
  const entries = [dup, byteDoneEntry(1), byteDoneEntry(2), byteDoneEntry(3), dup];
  const text = `# progress\n\n## Done\n\n${entries.join('\n')}\n`;
  assert.equal(Buffer.byteLength(text), 526, 'fixture：初始账本必须 526B');
  const pointerCost = Buffer.byteLength(ARCHIVE_POINTER_LINE) + 1;
  assert.ok(526 + pointerCost - 3 * 101 <= 300 && 526 + pointerCost - 2 * 101 > 300, 'fixture：字节模式停点必须恰在 3 条');
  fs.writeFileSync(path.join(dir, 'progress.md'), text);
  const apply = run(dir, ['archive', '--apply', '--json']);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const ao = JSON.parse(apply.stdout);
  assert.equal(ao.moved, 3, '必须恰搬最旧 3 条');
  // keepMinDone 底线：活账本 Done 恰剩 2 条——Set 全行匹配会把保留区的重复文本连带删掉只剩 1 条
  const live = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
  assert.equal((live.match(/- done-\d\d /g) || []).length, 2, `keepMinDone 底线：活账本 Done 必须恰剩 2 条，实际\n${live}`);
  // 无副本丢失：保留区的那份重复文本必须仍在场恰 1 份
  assert.equal(live.split('\n').filter((l) => l === dup).length, 1, `保留区的重复文本条目必须仍在场恰 1 份，实际\n${live}`);
  // 归档恰 3 条（被搬的 3 份原文，不多少）
  const archiveText = fs.readFileSync(path.join(dir, 'progress.archive.md'), 'utf8');
  assert.equal((archiveText.match(/^- /gm) || []).length, 3, `归档必须恰 3 条，实际\n${archiveText}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
