// Phase 8 R4d 机制测试（Task 8.7/8.8）：
// release 九条件（阻断/READY/never-tag 文案）+ dod 12 步聚合 exit 码 + make-release（剥离/泄漏自验/秘密运行期拼装注入）
// + install 大合流（dry-run 零写/--json 恰一行/幂等/LF 归一/三方合并 obsolete 两态/旁路永不覆盖/
//   故障注入回滚 rolled-back 与 rollback-incomplete/--verify 先 stage/--targets-from 批量/uninstall/safeManagedPath 反穿越）。
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

function mkproj({ catalog, matrix, harness } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r4d-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  if (harness) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify(harness));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* zbase-fitness:ignore empty-catch 已初始化则复用 */ }
  return dir;
}

// doctor/dod/release 可全绿的项目（catalog 须归类全部 tracked 路径：提交后 .zcode/** + AGENTS.md 都在测量面内）
const GREEN_CATALOG = {
  version: 1,
  modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low', security: 'none', safety: 'none', privacy: 'none', resilience: 'none' }, attributeReasons: { security: '测试仓无可执行面', safety: '纯软件工具不伤人', privacy: '不含个人数据', resilience: '测试夹具' }, reason: '测试仓' }],
  global: ['.zcode/**', '*.md', '*.json'],
  ignored: ['.git/**'],
};
function mkdoctorproj() {
  const dir = mkproj({ catalog: GREEN_CATALOG, matrix: { version: 1, checks: [] } });
  for (const d of [path.join('.zcode', 'rules'), path.join('.zcode', 'docs', 'adr'), path.join('.zcode', 'skills'), path.join('.zcode', 'commands', 'zbase')]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  return dir;
}

function run(cwd, args, stdin = '', env = {}) {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...env } });
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function mkhome({ userConfig } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-home-'));
  if (userConfig !== undefined) {
    fs.mkdirSync(path.join(home, '.zcode', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(home, '.zcode', 'cli', 'config.json'), userConfig);
  }
  return home;
}

// ---------- Task 8.7：dod ----------

test('8.7 dod：全绿项目 12 步聚齐 exit 0；budget 超限（非阻断）不失败', () => {
  const dir = mkdoctorproj();
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  const res = run(dir, ['dod', '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.steps.length, 12);
  assert.deepEqual(out.blockingFailed, []);
  assert.ok(out.degraded.includes('trace'), 'trace 须带 DEGRADED legacy 标注');
  assert.match(out.text, /dod 只做静态治理/);
  // budget 非阻断：41 个变更文件超 maxChangedFiles=40 → dod 仍 exit 0
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (let i = 0; i < 41; i++) fs.writeFileSync(path.join(dir, 'src', `f${i}.ts`), 'x\n');
  const res2 = run(dir, ['dod', '--json']);
  assert.equal(res2.status, 0, res2.stdout + res2.stderr);
  assert.deepEqual(JSON.parse(res2.stdout).nonBlockingFailed, ['budget']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 dod：阻断步失败（catalog 损坏 → DEGRADED 标注）exit 2', () => {
  const dir = mkdoctorproj();
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), '{ broken json');
  const res = run(dir, ['dod', '--json']);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.blockingFailed.includes('catalog-lint'));
  assert.ok(out.degraded.includes('catalog-lint'), '引擎错误必须 DEGRADED 标注（degraded 绝不假装绿）');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.7：release 九条件 ----------

test('8.7 release：READY（exit 0）+ never-tag 文案 + 十二条件齐', () => {
  const dir = mkdoctorproj();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  // 批次 2：加假 remote 使 ci-status 有查询目标——gh 对不存在仓 exit≠0 → DEGRADED 非阻断（READY 不受影响；
  // 本地无 gh → ENOENT 同样 DEGRADED）。无 remote 会以 UNKNOWN（阻断）拦截——该形态由 batch2 显式覆盖。
  git(dir, 'remote', 'add', 'origin', 'https://github.com/zbase-r4d/nonexistent.git');
  // 新鲜回执：committed 树上写 PASS（receipt 不改 tracked 文件，fingerprint 不漂移）
  assert.equal(run(dir, ['receipt', 'write', '--check', 'release-smoke', '--status', 'PASS', '--note', 'n']).status, 0);
  const res = run(dir, ['release']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /tagging\/pushing\/deploying 是 HIGH 档人类行为，本命令永不执行/);
  assert.match(res.stdout, /## READY/);
  const json = JSON.parse(run(dir, ['release', '--json']).stdout);
  assert.equal(json.ready, true);
  assert.deepEqual(json.blockers, []);
  assert.equal(json.items.length, 12, '九条件 + 批次 2 三条件（worktree-clean/ci-status/review-profile）');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 release：stale 回执 + fast 窗口 + sync 脏 → NOT READY exit 2 逐项点名', () => {
  const dir = mkdoctorproj();
  fs.writeFileSync(path.join(dir, 'progress.md'), '# p\n');
  git(dir, 'add', 'progress.md');
  git(dir, 'commit', '-q', '-m', 'memory'); // progress.md 不在变更窗内，代码脏即失步
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\n'); // governed 代码脏而 progress.md 未同步
  const on = run(dir, ['fast', 'on', '--minutes', '5', '--reason', 'r4d 测试', '--json']);
  assert.equal(on.status, 0, on.stderr);
  const res = run(dir, ['release', '--json']);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ready, false);
  assert.ok(out.blockers.includes('receipt-fresh'), '无新鲜回执必须阻断');
  assert.ok(out.blockers.includes('fast-mode-closed'), 'fast 窗口开启必须阻断');
  assert.ok(out.blockers.includes('sync-clean'), '三文件失步必须阻断');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 release：fast 债务（SKIPPED 未偿）阻断 fast-debt-repaid', () => {
  const dir = mkproj({
    catalog: { version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low' } }] },
    matrix: { version: 1, checks: [{ name: 'unit', command: 'true', proves: ['reliability'], allowFastSkip: true }] },
  });
  assert.equal(run(dir, ['fast', 'on', '--minutes', '5', '--reason', 'r4d 债务', '--json']).status, 0);
  const g = run(dir, ['gate', 'unit', '--json']);
  assert.equal(g.status, 0, g.stdout + g.stderr);
  assert.equal(JSON.parse(g.stdout).status, 'SKIPPED');
  assert.equal(run(dir, ['fast', 'off']).status, 0);
  const res = run(dir, ['release', '--json']);
  assert.equal(res.status, 2);
  assert.ok(JSON.parse(res.stdout).blockers.includes('fast-debt-repaid'), '证据贷款未清偿必须阻断发版');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 release：review-backlog 过期为非阻断（READY 不受影响，warnings 点名）', () => {
  const dir = mkdoctorproj();
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  // 批次 2：假 remote 使 ci-status DEGRADED 非阻断（见上同型注释），保住本测试的 READY 断言语义。
  git(dir, 'remote', 'add', 'origin', 'https://github.com/zbase-r4d/nonexistent.git');
  assert.equal(run(dir, ['receipt', 'write', '--check', 'release-smoke', '--status', 'PASS']).status, 0);
  // 直接种入已过期积压条目（backlogAdd 校验未来时间，过期态只能落盘构造）
  const reviewDir = path.join(dir, '.zcode', 'state', 'review');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, 'session.json'), JSON.stringify({
    version: 1, backlog: [{ at: '2020-01-01T00:00:00Z', owner: 't', expiry: '2020-01-02T00:00:00Z', lens: 'correctness', summary: '过期债' }],
  }));
  const res = run(dir, ['release', '--json']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ready, true, '过期积压是非阻断条件');
  assert.ok(out.warnings.includes('review-backlog'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.7：make-release ----------

function mkrelrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-mkrel-'));
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

function mkrelease(cwd, args, extraEnv = {}) {
  return spawnSync('sh', [path.join(SCRIPTS, 'make-release.sh'), ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...extraEnv } });
}

// 平台分支（CI windows #141 等）：MINGW 分支产 .zip 且无原生 tar.gz 工具链——
// 列名/读取改走 python3 zipfile（与 make-release.sh MINGW 分支同依赖）。
// 脚本 stdout 在 Git Bash 下回显 MSYS 形态路径（/tmp/…），原生 Node/python3 不识——
// 按 basename 在 os.tmpdir()（= Git Bash /tmp 的 Windows 映射）重建原生路径。
const WIN = process.platform === 'win32';
const ARTIFACT_EXT = WIN ? '.zip' : '.tar.gz';
function artifactPath(reported) {
  return WIN ? path.join(os.tmpdir(), path.basename(reported)) : reported;
}
function listArtifact(pkg) {
  // split(/\r?\n/) 行尾归一：Windows 原生 python text-mode stdout 把 \n 译成 CRLF（CI #143 根因：
  // 名单每行尾残留 \r 击穿 endsWith）；posix 分支 tar -tzf 恒 LF，行为零漂移。
  if (!WIN) return execFileSync('tar', ['-tzf', pkg], { encoding: 'utf8' }).split(/\r?\n/);
  return execFileSync('python3', ['-c', "import zipfile,sys; print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", pkg], { encoding: 'utf8' }).split(/\r?\n/);
}
function readArtifactEntry(pkg, entry) {
  if (!WIN) return execFileSync('tar', ['-xzOf', pkg, entry], { encoding: 'utf8' });
  // 直写字节到 sys.stdout.buffer（CI #143 根因：Windows 原生 python stdout 默认编码
  // cp1252，zip 内 UTF-8 中文经 decode('utf-8') 后再往 cp1252 stdout 编码必炸
  // UnicodeEncodeError）；buffer.write 绕过 stdout 编码层，Node 端 execFileSync
  // encoding:'utf8' 负责最终解码，与原行为等价。
  // listArtifact 无同型风险不随修：print 的是 namelist() 文件名，打包名单全 ASCII
  // （git archive 跟随仓内路径，本仓无非 ASCII 文件名），cp1252 下编码无损。
  return execFileSync('python3', ['-c', "import zipfile,sys; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", pkg, entry], { encoding: 'utf8' });
}

const REL_BASE = {
  'AGENTS.md': '# demo\n',
  '.zcode/feedback/FEEDBACK-INDEX.md': '# FEEDBACK-INDEX\n| 私人条目 |\n|---|\n| lesson-1 |\n',
  '.zcode/feedback/lesson-1.md': '# 私人教训：不应随包分发\n',
  '.zcode/feedback/templates/entry.md': '# 条目模板（机制面，保留）\n',
  '.zcode/lib/a.mjs': 'export const x = 1;\n',
};

test('8.7 make-release：隔离仓冒烟——私人条目剥离、索引重置、templates 保留', () => {
  const dir = mkrelrepo(REL_BASE);
  const out = mkrelease(dir, ['v1.0.0']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const reported = out.stdout.trim().split('\n').pop();
  assert.ok(reported.endsWith(ARTIFACT_EXT), reported);
  const pkg = artifactPath(reported);
  try {
    const names = listArtifact(pkg);
    const base = path.basename(dir);
    assert.ok(!names.some((n) => n.endsWith('.zcode/feedback/lesson-1.md')), '私人经验条目不得入包');
    assert.ok(
      names.some((n) => n.endsWith('.zcode/feedback/templates/entry.md')),
      'templates（机制面）保留——取证样本：feedback 相关条目（前 10）' +
        `[${names.filter((n) => n.includes('feedback')).slice(0, 10).join(' | ')}]` +
        `；含反斜杠条目数 ${names.filter((n) => n.includes('\\')).length}/${names.length}` +
        '（反斜杠计数 >0 = 条目名分隔符形态问题；样本里无 templates = 文件根本不在 zip——win32/Linux 行为一致，仅失败消息更 rich）',
    );
    assert.ok(names.some((n) => n.endsWith('.zcode/feedback/FEEDBACK-INDEX.md')), '干净索引在包内');
    const index = readArtifactEntry(pkg, `${base}/.zcode/feedback/FEEDBACK-INDEX.md`);
    assert.match(index, /干净发布模板/);
    assert.ok(!index.includes('lesson-1'), '索引不得残留私人条目行');
  } finally {
    fs.rmSync(pkg, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('8.7 make-release：--dry-run 输出清单零写', () => {
  const dir = mkrelrepo(REL_BASE);
  const out = mkrelease(dir, ['v2.0.0-dry', '--dry-run']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /--dry-run：零写/);
  assert.match(out.stdout, /lesson-1\.md/, '剥离清单须点名私人条目');
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `${path.basename(dir)}-v2.0.0-dry${ARTIFACT_EXT}`)), false, 'dry-run 不得写包');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 make-release：泄漏注入（嵌套 feedback *.md 逃过 maxdepth 剥离）→ exit 1 不发坏包', () => {
  const dir = mkrelrepo({ ...REL_BASE, '.zcode/feedback/nested/leak.md': '# 嵌套私人条目\n' });
  const out = mkrelease(dir, ['v3.0.0']);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /私人 feedback 泄漏/);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `${path.basename(dir)}-v3.0.0${ARTIFACT_EXT}`)), false, '坏包必须删除');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 make-release：秘密注入（token 运行期拼装）→ exit 1 不发坏包', () => {
  // 运行期拼装：本测试源码与被扫仓都不落连续字面量（模式源码文本天然不命中完整形态）
  const AKIA = ['AKIA', 'IOSFODNN7EXAMPLEX1'].join('');
  const dir = mkrelrepo({ ...REL_BASE, 'config.js': `module.exports = { key: "${AKIA}" };\n` });
  const out = mkrelease(dir, ['v4.0.0']);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /秘密形态命中/);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `${path.basename(dir)}-v4.0.0${ARTIFACT_EXT}`)), false, '坏包必须删除');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('8.7 make-release：运行态入包（.zcode/state 被 track）→ exit 1', () => {
  const dir = mkrelrepo({ ...REL_BASE, '.zcode/state/ledger.jsonl': '{"seq":1}\n' });
  const out = mkrelease(dir, ['v5.0.0']);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /运行态泄漏/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Task 8.8：install 大合流 ----------

test('8.8 install --dry-run：全程零写（目标树/用户级配置/不存在的目标目录）', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const ghost = path.join(os.tmpdir(), 'zbase-ghost-' + Date.now());
  try {
    const res = run(src, ['install', target, '--dry-run', '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.ok(rep.counts.created > 90, `would create 应覆盖全安装面（实际 ${rep.counts.created}）`);
    assert.equal(rep.hooksRegistered.would, true);
    assert.deepEqual(fs.readdirSync(target), [], 'dry-run 目标树必须零写');
    assert.equal(fs.existsSync(path.join(home, '.zcode', 'cli', 'config.json')), false, 'dry-run 不得写用户级配置');
    const res2 = run(src, ['install', ghost, '--dry-run', '--json'], '', { HOME: home });
    assert.equal(res2.status, 0, res2.stdout + res2.stderr);
    assert.equal(fs.existsSync(ghost), false, 'dry-run 不得创建目标目录');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install --json：stdout 恰一行 + 事务 committed 回执 + 幂等重装 unchanged', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  try {
    const res = run(src, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(res.stdout.split('\n').filter((l) => l.trim()).length, 1, '--json 必须恰一行');
    const rep = JSON.parse(res.stdout);
    assert.equal(rep.ok, true);
    assert.equal(rep.receipt.status, 'committed');
    assert.ok(fs.existsSync(rep.receipt.path), '回执临时文件必须落盘（目标仓外）');
    assert.ok(fs.existsSync(path.join(target, '.zcode', 'zbase.mjs')));
    assert.ok(fs.existsSync(path.join(target, 'FRAMEWORK-MANIFEST.json')));
    // 幂等重装：全部 unchanged，无旁路
    const res2 = run(src, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res2.status, 0, res2.stdout + res2.stderr);
    const rep2 = JSON.parse(res2.stdout);
    assert.equal(rep2.counts.created, 0);
    assert.equal(rep2.counts.conflicts, 0);
    assert.ok(rep2.counts.unchanged > 90);
    assert.deepEqual(rep2.bypassed, []);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install LF 归一化：CRLF 目标副本不误报 customized（内容一致即 unchanged）', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const relFile = '.zcode/feedback/FEEDBACK-INDEX.md';
  try {
    assert.equal(run(src, ['install', target, '--json'], '', { HOME: home }).status, 0);
    const p = path.join(target, relFile);
    const crlf = fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n');
    fs.writeFileSync(p, crlf);
    const res = run(src, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.equal(rep.counts.conflicts, 0, 'CRLF 副本不得误报为定制（LF 归一比较）');
    assert.ok(!rep.bypassed.some((b) => b.includes(relFile)));
    assert.ok(fs.readFileSync(p, 'utf8').includes('\r\n'), 'unchanged 文件不得被重写（保留目标行尾风格）');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install 三方合并 upgrade：obsolete 未改删除 / 改过留置', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const gone = '.zcode/docs/ARCHITECTURE.md';     // 源删除 + 目标未改 → remove-obsolete
  const kept = '.zcode/docs/ROLE-CONTRACTS.md';   // 源删除 + 目标已改 → preserve-obsolete
  try {
    assert.equal(run(src, ['install', target, '--json'], '', { HOME: home }).status, 0);
    fs.rmSync(path.join(src, gone));
    fs.rmSync(path.join(src, kept));
    fs.writeFileSync(path.join(target, kept), '# 项目自己改过的契约\n');
    const res = run(src, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.ok(rep.removedObsolete.includes(gone), '未改的 obsolete 必须删除');
    assert.ok(rep.preservedObsolete.includes(kept), '改过的 obsolete 必须留置并列出');
    assert.equal(fs.existsSync(path.join(target, gone)), false);
    assert.equal(fs.existsSync(path.join(target, kept)), true);
    // 新基线不再含 obsolete 项（第三次安装零 obsolete）
    const res3 = run(src, ['install', target, '--json'], '', { HOME: home });
    const rep3 = JSON.parse(res3.stdout);
    assert.equal(rep3.counts.removedObsolete + rep3.counts.preservedObsolete, 0);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install 旁路：目标定制文件写 .zbase-new，原文件永不覆盖', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const relFile = '.zcode/rules/workflow.md';
  try {
    assert.equal(run(src, ['install', target, '--json'], '', { HOME: home }).status, 0);
    fs.writeFileSync(path.join(target, relFile), '# 项目定制规则（不得被覆盖）\n');
    const res = run(src, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.ok(rep.bypassed.some((b) => b.startsWith(relFile)));
    assert.equal(fs.readFileSync(path.join(target, relFile), 'utf8'), '# 项目定制规则（不得被覆盖）\n');
    assert.ok(fs.existsSync(path.join(target, `${relFile}.zbase-new`)), '旁路文件必须存在');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install 故障注入：zbase-install-fail-after=2 → 逆序回滚完整（rolled-back 留痕）', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  try {
    const res = run(src, ['install', target, '--json'], '', { HOME: home, 'zbase-install-fail-after': '2' });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.equal(rep.ok, false);
    assert.equal(rep.rollback.status, 'rolled-back');
    assert.equal(rep.receipt.status, 'rolled-back');
    const receipt = JSON.parse(fs.readFileSync(rep.receipt.path, 'utf8'));
    assert.equal(receipt.status, 'rolled-back');
    assert.equal(fs.existsSync(path.join(target, '.zcode', 'zbase.mjs')), false, '回滚后不得残留已装文件');
    assert.equal(fs.existsSync(path.join(target, 'FRAMEWORK-MANIFEST.json')), false, '回滚必须连基线 manifest 一起撤销');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install 故障注入：恢复失败 → rollback-incomplete（staging 备份保留）', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const archFile = path.join(target, '.zcode', 'docs', 'ARCHITECTURE.md');
  try {
    assert.equal(run(src, ['install', target, '--json'], '', { HOME: home }).status, 0);
    fs.appendFileSync(path.join(src, '.zcode', 'docs', 'ARCHITECTURE.md'), '\n<!-- 源侧变更，触发 update -->\n');
    // 目标文件 0444：update 覆写需文件写权 → 写入失败；回滚恢复（备份→原位覆写）同样失败 → incomplete
    fs.chmodSync(archFile, 0o444);
    const res = run(src, ['install', target, '--json'], '', { HOME: home });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.equal(rep.rollback.status, 'rollback-incomplete', res.stdout);
    assert.equal(rep.receipt.status, 'rollback-incomplete');
    assert.ok(rep.receipt.stagingPreserved, '不完整回滚必须保留 staging 备份目录');
    assert.ok(fs.existsSync(rep.receipt.path));
  } finally {
    try { fs.chmodSync(archFile, 0o644); } catch { /* zbase-fitness:ignore empty-catch 目标可能未创建 */ }
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install --verify：先 git add -A stage，再子进程 doctor/selftest/skills-lint', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
    const res = run(src, ['install', target, '--verify', '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.equal(rep.verify.staged, true, 'verify 前 stage 是证明力的前提');
    assert.equal(rep.verify.selftest, 0);
    assert.equal(rep.verify.skillsLint, 0);
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: target, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assert.ok(staged.length > 90, `安装产物应已 stage（实际 ${staged.length}）`);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 install --targets-from：批量两目标，单目标失败不中断批次', () => {
  const src = mkproj();
  const home = mkhome();
  const badTarget = path.join(os.tmpdir(), `zbase-file-${Date.now()}`);
  fs.writeFileSync(badTarget, 'not a directory');
  const goodTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const listFile = path.join(os.tmpdir(), `zbase-targets-${Date.now()}.txt`);
  fs.writeFileSync(listFile, `${badTarget}\n\n# comment\n${goodTarget}\n`);
  try {
    const res = run(src, ['install', '--targets-from', listFile, '--json'], '', { HOME: home });
    assert.equal(res.status, 1, '批次中存在失败目标 → exit 1');
    const rep = JSON.parse(res.stdout);
    assert.equal(rep.targets, 2);
    assert.equal(rep.results.length, 2);
    assert.equal(rep.results[0].ok, false, '坏目标（文件非目录）必须失败');
    assert.equal(rep.results[1].ok, true, '单目标失败不得中断批次');
    assert.ok(fs.existsSync(path.join(goodTarget, '.zcode', 'zbase.mjs')), '好目标必须装完');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(goodTarget, { recursive: true, force: true });
    fs.rmSync(badTarget, { force: true });
    fs.rmSync(listFile, { force: true });
  }
});

test('8.8 uninstall：dry-run 零删报清单；正式删基线文件、留定制文件、清基线 manifest', () => {
  const src = mkproj();
  const home = mkhome();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-tgt-'));
  const customized = '.zcode/rules/workflow.md';
  try {
    assert.equal(run(src, ['install', target, '--json'], '', { HOME: home }).status, 0);
    fs.writeFileSync(path.join(target, customized), '# 项目定制规则\n');
    const dry = run(src, ['install', target, '--uninstall', '--dry-run', '--json'], '', { HOME: home });
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    const dryRep = JSON.parse(dry.stdout);
    assert.ok(dryRep.wouldRemove.length > 90, 'dry-run 报将删清单');
    assert.ok(dryRep.preserved.includes(customized), '改过的受管文件必须留置');
    assert.ok(fs.existsSync(path.join(target, '.zcode', 'zbase.mjs')), 'dry-run 零删');
    const res = run(src, ['install', target, '--uninstall', '--json'], '', { HOME: home });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const rep = JSON.parse(res.stdout);
    assert.ok(rep.removed.length > 90);
    assert.equal(fs.existsSync(path.join(target, '.zcode', 'zbase.mjs')), false);
    assert.equal(fs.existsSync(path.join(target, 'FRAMEWORK-MANIFEST.json')), false, '基线 manifest 随卸载移除');
    assert.equal(fs.readFileSync(path.join(target, customized), 'utf8'), '# 项目定制规则\n', '定制文件不得被卸载删除');
    // 无 manifest 再卸载 → fail-visible
    const again = run(src, ['install', target, '--uninstall', '--json'], '', { HOME: home });
    assert.equal(again.status, 1);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('8.8 safeManagedPath：拒绝对路径/../空段/反斜杠；逐段 realpath 拒逃逸与悬空 symlink', async () => {
  const { safeManagedPath } = await import('../.zcode/lib/doctor.mjs');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-smp-'));
  try {
    const ok = safeManagedPath(target, '.zcode/lib/a.mjs');
    assert.equal(ok, path.resolve(target, '.zcode/lib/a.mjs'));
    for (const bad of ['/etc/passwd', '.zcode/../escape.mjs', '.zcode//a.mjs', '.zcode/./a.mjs', '.zcode\\a.mjs', '']) {
      assert.throws(() => safeManagedPath(target, bad), /不安全/, `须拒绝：${bad || '<空>'}`);
    }
    // symlink 逃逸：目标内目录链解析到目标外
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-out-'));
    fs.symlinkSync(outside, path.join(target, 'out-link'));
    assert.throws(() => safeManagedPath(target, 'out-link/x.mjs'), /目标外/);
    // 悬空 symlink：报错而非当作 ENOENT 普通缺段
    fs.symlinkSync(path.join(target, 'nowhere'), path.join(target, 'dangling'));
    assert.throws(() => safeManagedPath(target, 'dangling/x.mjs'), /悬空/);
    fs.rmSync(outside, { recursive: true, force: true });
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
