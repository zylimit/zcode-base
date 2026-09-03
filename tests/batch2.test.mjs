// 批次 2 回归锁（发版门 + CI 卫生五件，源 dsh/cc 复查裁决）：
//   ① release 新增 worktree-clean（要发的=被测的；.zcode/state 运行态不计脏）；
//   ② release 新增 ci-status（unknown is not a pass：无 remote/无 run/running → UNKNOWN 阻断；
//      gh 缺失/查询失败 → DEGRADED 非阻断）；
//   ③ release 新增 review-profile（降档还款可见化：非默认组队 → 非阻断 warning；default → 显式行）；
//   ④ install --hooks：exec bit 写进 git index（git add --chmod=+x）——Windows 文件系统无 POSIX 位，
//      index mode 是跨平台唯一可信载体（源 dsh 0c32f81 同坑）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, zbase, tempDir, rmDir, mkHarnessProj } from './helpers.mjs';

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

// doctor/dod/release 可全绿的项目（对齐 r4d GREEN_CATALOG 形态；catalog 须归类全部 tracked 路径）。
const GREEN_CATALOG = {
  version: 1,
  modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low', security: 'none', safety: 'none', privacy: 'none', resilience: 'none' }, attributeReasons: { security: '测试仓无可执行面', safety: '纯软件工具不伤人', privacy: '不含个人数据', resilience: '测试夹具' }, reason: '测试仓' }],
  global: ['.zcode/**', '*.md', '*.json'],
  ignored: ['.git/**'],
};

/** 全绿沙箱：目录齐 + src 提交 + 可选假 remote（假 remote 使 ci-status 走 gh 查询失败 → DEGRADED 非阻断）。 */
function mkGreenProj({ catalog, remote } = {}) {
  const dir = mkHarnessProj({ catalog: catalog || GREEN_CATALOG, matrix: { version: 1, checks: [] } });
  for (const d of [['.zcode', 'rules'], ['.zcode', 'docs', 'adr'], ['.zcode', 'skills'], ['.zcode', 'commands', 'zbase']]) {
    fs.mkdirSync(path.join(dir, ...d), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}

const item = (json, id) => json.items.find((i) => i.id === id);

/** posix stub gh：忽略参数固定输出（win32 无法提供 gh.exe，见 B2-3 skip 理由）。 */
function stubGhEnv(stdout, exitCode = 0) {
  const bin = tempDir('ghbin');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ncat <<'STUB_EOF'\n${stdout}\nSTUB_EOF\nexit ${exitCode}\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

// ---------- ①+② ci-status / worktree-clean ----------

test('B2-1 无 remote 沙箱：ci-status UNKNOWN 阻断（unknown is not a pass），其余十一条件齐', () => {
  const dir = mkGreenProj(); // 无 remote：连 gh 都不必调用（沙箱稳定，不依赖宿主是否装 gh/联网）
  try {
    assert.equal(zbase(['receipt', 'write', '--check', 'b2-smoke', '--status', 'PASS'], { cwd: dir }).code, 0);
    const r = zbase(['release', '--json'], { cwd: dir });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    const json = r.json;
    assert.equal(json.ready, false);
    assert.deepEqual(json.blockers, ['ci-status'], '全绿仓唯一阻断应是 ci-status UNKNOWN');
    assert.equal(json.items.length, 12, '九条件 + 批次 2 三条件');
    const ci = item(json, 'ci-status');
    assert.equal(ci.ok, false);
    assert.match(ci.detail, /无判决/);
    assert.match(ci.detail, /无 git remote/);
    // worktree-clean：committed 树 + 只有 .zcode/state 运行态写入（receipt）→ 不算脏
    const wc = item(json, 'worktree-clean');
    assert.equal(wc.ok, true, `运行态不得误判为脏树：${wc.detail}`);
    assert.match(wc.detail, /运行态/);
    // review-profile：GREEN_CATALOG 无 review 覆盖 → default 显式行（占位可见化）
    assert.equal(item(json, 'review-profile').ok, true);
    assert.match(item(json, 'review-profile').detail, /default/);
  } finally { rmDir(dir); }
});

test('B2-2 worktree-clean：tracked 脏树阻断（要发的=被测的）', () => {
  const dir = mkGreenProj();
  try {
    assert.equal(zbase(['receipt', 'write', '--check', 'b2-smoke', '--status', 'PASS'], { cwd: dir }).code, 0);
    fs.writeFileSync(path.join(dir, 'src', 'dirty.ts'), 'uncommitted\n'); // 未提交变更
    const r = zbase(['release', '--json'], { cwd: dir });
    assert.equal(r.code, 2);
    const json = r.json;
    assert.ok(json.blockers.includes('worktree-clean'), '脏树必须阻断发版');
    const wc = item(json, 'worktree-clean');
    assert.equal(wc.ok, false);
    assert.match(wc.detail, /工作树脏/);
    assert.match(wc.detail, /src\/dirty\.ts/);
  } finally { rmDir(dir); }
});

test('B2-3 ci-status 四形态：success→PASS / failure→FAIL / 空或 running→UNKNOWN / gh 挂→DEGRADED 非阻断', { skip: process.platform === 'win32' ? 'stub 无法提供 gh.exe（win32 spawn 无 shell 不解析 .cmd；UNKNOWN 形态由 B2-1 全平台覆盖，DEGRADED 由 r4d 假 remote 路径覆盖）' : false }, () => {
  const REMOTE = 'https://github.com/zbase-b2/nonexistent.git';
  const cases = [
    { stdout: '[{"conclusion":"success"},{"conclusion":"success"}]', expect: { ok: true, degraded: false }, match: /CI success/ },
    { stdout: '[{"conclusion":"success"},{"conclusion":"failure"}]', expect: { ok: false, degraded: false }, match: /CI 判决 .*failure.*CI 红不发版/ },
    { stdout: '[]', expect: { ok: false, degraded: false }, match: /无判决/ },
    { stdout: '[{"conclusion":null}]', expect: { ok: false, degraded: false }, match: /running/ },
    { stdout: 'gh: Could not resolve', exitCode: 1, expect: { ok: true, degraded: true }, match: /gh 查询失败/ },
  ];
  for (const c of cases) {
    const dir = mkGreenProj({ remote: REMOTE });
    try {
      assert.equal(zbase(['receipt', 'write', '--check', 'b2-smoke', '--status', 'PASS'], { cwd: dir }).code, 0);
      const r = zbase(['release', '--json'], { cwd: dir, env: stubGhEnv(c.stdout, c.exitCode ?? 0) });
      const json = r.json;
      const ci = item(json, 'ci-status');
      assert.equal(ci.ok, c.expect.ok, `${c.stdout}@exit${c.exitCode ?? 0} → ok=${c.expect.ok}，实际 detail: ${ci.detail}`);
      assert.equal(ci.degraded, c.expect.degraded, `degraded=${c.expect.degraded}，实际 detail: ${ci.detail}`);
      assert.match(ci.detail, c.match);
      if (c.expect.ok) assert.equal(json.ready, true, 'PASS/DEGRADED 不得阻断 READY');
      else assert.ok(json.blockers.includes('ci-status'), 'FAIL/UNKNOWN 必须阻断');
    } finally { rmDir(dir); }
  }
});

// ---------- ③ review-profile 降档还款 ----------

test('B2-4 review-profile：team 降档 → 非阻断 warning 点名未召集 lens；lenses 全员 override → ok', () => {
  // 降档（team = correctness+reliability+resilience，缺 security/privacy）
  const down = mkGreenProj({ catalog: { ...GREEN_CATALOG, review: { profile: 'team' } } });
  try {
    const r = zbase(['release', '--json'], { cwd: down });
    assert.equal(r.code, 2); // 无 remote → ci-status UNKNOWN 阻断（与本测试无关）
    const json = r.json;
    assert.ok(json.warnings.includes('review-profile'), '降档必须进 warnings（非阻断）');
    const rp = item(json, 'review-profile');
    assert.equal(rp.ok, false);
    assert.match(rp.detail, /team/);
    assert.match(rp.detail, /security/);
    assert.match(rp.detail, /not a pass|waiver/);
  } finally { rmDir(down); }
  // 显式 lenses 全员 override：非默认但未低于全员 → ok（可见化，不警告）
  const full = mkGreenProj({ catalog: { ...GREEN_CATALOG, review: { lenses: ['correctness', 'reliability', 'resilience', 'security', 'privacy'] } } });
  try {
    const json = zbase(['release', '--json'], { cwd: full }).json;
    assert.equal(item(json, 'review-profile').ok, true);
    assert.match(item(json, 'review-profile').detail, /lenses override/);
    assert.ok(!json.warnings.includes('review-profile'));
  } finally { rmDir(full); }
  // lenses 降档 override（只 correctness）：同样 warning
  const lean = mkGreenProj({ catalog: { ...GREEN_CATALOG, review: { lenses: ['correctness'] } } });
  try {
    const json = zbase(['release', '--json'], { cwd: lean }).json;
    assert.ok(json.warnings.includes('review-profile'), 'lenses 降档 override 也必须警告');
    assert.match(item(json, 'review-profile').detail, /未召集/);
  } finally { rmDir(lean); }
});

// ---------- ④ install --hooks：exec bit 进 git index ----------

test('B2-5 install --hooks：三钩子 exec bit 写进 git index（100755）——Windows 克隆到 Linux 仍可执行', () => {
  const src = mkHarnessProj();
  const target = tempDir('tgt');
  const home = tempDir('home');
  try {
    execFileSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
    const ins = zbase(['install', target, '--hooks', '--json'], { env: { HOME: home } });
    assert.equal(ins.code, 0, ins.stdout + ins.stderr);
    assert.equal(ins.json.gitHooks.wired, true);
    assert.equal(ins.json.gitHooks.indexMode, 'staged-755', ins.stdout);
    // index mode 断言平台无关（git index 跨平台一致）：git add --chmod=+x 写入 100755，
    // 工作树 chmod 在 win32 无 POSIX 位——这正是要靠 index mode 承载的原因。
    for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
      const line = execFileSync('git', ['ls-files', '-s', `.zcode/githooks/${hook}`], { cwd: target, encoding: 'utf8' }).trim();
      assert.match(line, /^100755 /, `${hook} index mode 须 100755（实际 ${line || '未 stage'}）`);
    }
    // 非 git 仓目标：hooks 接线失败（wired=false）→ 不尝试 add，无 indexMode 字段
    const naked = tempDir('tgt');
    try {
      const ins2 = zbase(['install', naked, '--hooks', '--json'], { env: { HOME: home } });
      assert.equal(ins2.code, 0);
      assert.equal(ins2.json.gitHooks.wired, false);
      assert.equal(ins2.json.gitHooks.indexMode, undefined, '非 git 仓不得声称已写 index mode');
    } finally { rmDir(naked); }
  } finally {
    rmDir(src); rmDir(target); rmDir(home);
  }
});
