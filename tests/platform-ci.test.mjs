// platform-ci red-locks（CI 三缺陷修复先行）：
//   缺陷1（引擎）  core.mjs userConfigPath 用 os.homedir()——Windows 上不读 HOME，
//                  其「测试可用 HOME=<临时目录> 隔离」的注释承诺是假的（CI windows 作业污染真实用户目录）。
//   缺陷2（测试代码）8 个测试文件以 URL 对象的 pathname 属性拼仓库路径——Windows 上
//                  URL.pathname 前导斜杠（/D:/...），win32 path.resolve 串成 D:\D:\... 全 ENOENT。
//   缺陷3（CI 工作流）gate.yml 的 dod 步在 CI 必红（exit 2）——attributes 步读 .zcode/state
//                  本机回执，该目录不随 git 旅行，CI 无回执；修法是 dod 前跑 gate <check> 自落回执。
// 用例 1/2/3 修复前必须红；用例 4 是机制回归锁（gate→回执→dod 端到端），预期绿。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { REPO, tempDir, rmDir, mkHarnessProj } from './helpers.mjs';
import { userConfigPath } from '../.zcode/lib/core.mjs';

// ---------- 用例 1：userConfigPath 的 HOME 跨平台优先 ----------

test('PF1-1 userConfigPath HOME 跨平台优先（模拟 Windows homedir 不读 HOME）', () => {
  const homeTmp = tempDir('pf1-home');
  const realHomedir = os.homedir;
  const savedHome = process.env.HOME;
  try {
    // 模拟 Windows：os.homedir() 读 USERPROFILE 不读 HOME——补丁后无论 HOME 设什么都返回真实家目录。
    // core.mjs 与本文件 import 同一 node:os 模块实例，default export 对象属性补丁对被测函数可见。
    os.homedir = () => 'C:\\Users\\realhome';
    process.env.HOME = homeTmp;
    const got = userConfigPath();
    assert.equal(
      got,
      path.join(homeTmp, '.zcode', 'cli', 'config.json'),
      `userConfigPath 必须优先读 process.env.HOME（core.mjs:296 注释承诺「测试可用 HOME=<临时目录> 隔离」，但 Windows 上 os.homedir 不读 HOME，承诺失效）——期望 ${path.join(homeTmp, '.zcode', 'cli', 'config.json')}，实际 ${got}`,
    );
  } finally {
    os.homedir = realHomedir;
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    rmDir(homeTmp);
  }
});

// ---------- 用例 2：tests/ 禁用 URL 对象的 pathname 属性拼路径 ----------

// 检测目标：同一行里「import.meta.url 的 URL 构造」后紧跟取 pathname（Windows 串盘符元凶）。
// 两根指针运行期拼装（先例 r4fix 秘密注入同款手法）：本文件源码任何单行都不含完整字面量，扫描不自命中。
const NEEDLE_URL_PARTS = ['import', 'meta', 'url'];
const NEEDLE_PATHNAME_PARTS = ['', 'pathname'];

function scanPathnameViolations() {
  const urlNeedle = NEEDLE_URL_PARTS.join('.');
  const pathnameNeedle = NEEDLE_PATHNAME_PARTS.join('.');
  const violations = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) {
        const hits = fs.readFileSync(p, 'utf8')
          .split('\n')
          .map((line, i) => (line.includes(urlNeedle) && line.includes(pathnameNeedle) ? String(i + 1) : null))
          .filter(Boolean);
        if (hits.length > 0) violations.push(`${path.relative(REPO, p)}（行 ${hits.join(',')}）`);
      }
    }
  };
  walk(path.join(REPO, 'tests'));
  return violations;
}

test('PF1-2 tests/ 禁用 URL 构造接 pathname 取路径（Windows 串盘符，应走 fileURLToPath）', () => {
  const violations = scanPathnameViolations();
  assert.deepEqual(
    [...violations].sort(),
    [],
    `以下测试文件从 URL 构造直接取 pathname 属性拼仓库路径——Windows 上 URL.pathname 带前导斜杠（/D:/...），` +
      `win32 path.resolve 串成 D:\\D:\\... 导致 cpSync 全 ENOENT；正确写法是 url.fileURLToPath（先例 tests/helpers.mjs:9）：\n${violations.join('\n')}`,
  );
});

// ---------- 用例 3：gate.yml 契约——dod 前必须有 gate 自落回执步 ----------

test('PF1-3 gate.yml 契约：dod 前必须有 gate 回执自落步', () => {
  const yml = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'gate.yml'), 'utf8');
  const lines = yml.split('\n');
  const dodLine = lines.findIndex((l) => l.includes('zbase.mjs dod'));
  assert.ok(dodLine >= 0, 'gate.yml 必须存在 dod 步（当前文件有，防误删锚）');
  const gateLine = lines.findIndex((l) => l.includes('zbase.mjs gate '));
  assert.ok(
    gateLine >= 0,
    'gate.yml 必须在 dod 之前按 verification-matrix 跑 `zbase.mjs gate <check>` 自落回执——' +
      'dod 的 attributes 步读 .zcode/state 本机回执，该目录不随 git 旅行，CI 无回执必红（exit 2，130 测试级联失败之外的第二处必红源）',
  );
  assert.ok(gateLine < dodLine, `gate 回执自落步（第 ${gateLine + 1} 行）必须在 dod 步（第 ${dodLine + 1} 行）之前——先落回执后聚合`);
});

// ---------- 用例 4：机制回归锁（gate→回执→dod 端到端，预期绿，非 red-lock） ----------

function runZbase(cwd, args, timeout, env = {}) {
  // 剥掉 node:test 运行器注入的 NODE_TEST_CONTEXT：带着它，沙箱内层 `node --test`
  // （harness-unit-tests 的命令）会 ~23ms 空转 exit 0——假绿；剥掉才真跑全套（~2s）。
  const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
  return spawnSync(process.execPath, [path.join('.zcode', 'zbase.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: { ...cleanEnv, ...env },
  });
}

test('PF1-4 机制回归锁：真 catalog 沙箱 → gate 序列自落回执 → dod exit 0（预期绿）', () => {
  const dir = mkHarnessProj(); // 复制真 .zcode、清 state——模拟 CI 全新 checkout 后自落回执
  const homeTmp = tempDir('pf1-home'); // 隔离 HOME：install 注册/doctor 读取都走 HOME 通道（对齐 gate.yml install 冒烟步）
  const regDir = tempDir('pf1-reg');
  const GIT = ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false'];
  const tail = (s, n = 15) => {
    const t = (s || '').trim();
    return t ? t.split('\n').slice(-n).join('\n') : '（无输出）';
  };
  // 取证增强（CI #60：沙箱 19 红两轮纹丝不动——停止盲修，先拿名单）：gate 失败时 stdout 的 TAP
  // 统计常被尾部截断，看不到 not ok 名单——从完整 stdout 解析全部失败用例名（前 20 条）附进断言
  // 消息，CI 日志直接给出定性所需的用例清单。只读不改输出，沙箱搭建逻辑零触碰。
  const notOkList = (s) => (s || '')
    .split('\n')
    .map((l) => { const m = l.match(/^not ok \d+ - (.+)$/); return m ? m[1] : null; })
    .filter(Boolean)
    .slice(0, 20);
  try {
    // harness-unit-tests 的命令是 node --test tests/harness.test.mjs——沙箱内必须有 tests/
    fs.cpSync(path.join(REPO, 'tests'), path.join(dir, 'tests'), { recursive: true });
    // CRLF 双保险（CI windows #60，沙箱 harness.test.mjs 19 红根因）：windows runner 全局 autocrlf=true
    // 会把入库/工作树污染成 CRLF——①复制仓根 .gitattributes（* text=auto eol=lf）进沙箱；②下方 git add/commit
    // 一律 -c core.autocrlf=false。沙箱内 zbase 子命令的内部 git 只读调用不受影响（有 .gitattributes 保护）。
    fs.copyFileSync(path.join(REPO, '.gitattributes'), path.join(dir, '.gitattributes'));
    const add = spawnSync('git', [...GIT, 'add', '-A'], { cwd: dir, encoding: 'utf8' });
    assert.equal(add.status, 0, `沙箱 git add 失败：${add.stderr || add.error}`);
    const commit = spawnSync('git', [...GIT, 'commit', '-q', '-m', 'init'], { cwd: dir, encoding: 'utf8' });
    assert.equal(commit.status, 0, `沙箱 git commit 失败：${commit.stderr || commit.error}`);

    // gate.yml 同款前置：install 冒烟把 7 事件 hooks 注册进隔离 HOME——doctor 的 hooks 双通道靠它 PASS
    // （无此步则 doctor 在任何沙箱必红：工作区 config 是 {}，用户级无注册。Linux 上 HOME 通道修复前后行为一致。）
    const install = runZbase(dir, ['install', regDir], 300_000, { HOME: homeTmp });
    assert.equal(
      install.status, 0,
      `install 冒烟必须 exit 0（实际 ${install.status}）` +
        `\n--- stdout 尾部 ---\n${tail(install.stdout)}\n--- stderr 尾部 ---\n${tail(install.stderr)}`,
    );

    // 按 verification-matrix 的 conservativeChecks 序列自落回执（每个必须 exit 0，fail-visible 打尾部）
    const CHECKS = [
      'harness-selftest', 'harness-doctor', 'ledger-integrity', 'fitness-audit',
      'secret-scan', 'catalog-lint', 'arch-ratchet', 'harness-unit-tests',
    ];
    for (const check of CHECKS) {
      const r = runZbase(dir, ['gate', check], 300_000, { HOME: homeTmp });
      const fails = notOkList(r.stdout);
      assert.equal(
        r.status, 0,
        `gate ${check} 必须 exit 0（实际 ${r.status}${r.error ? `，spawn 异常 ${r.error.message}` : ''}）` +
          (fails.length ? `\n--- 失败用例名单（not ok，前 ${fails.length} 条）---\n${fails.join('\n')}` : '') +
          `\n--- stdout 尾部 ---\n${tail(r.stdout)}\n--- stderr 尾部 ---\n${tail(r.stderr)}`,
      );
    }

    // 回执齐了再聚合：dod 的 attributes 步此刻有新鲜 PASS 回执可读 → exit 0
    const dod = runZbase(dir, ['dod'], 300_000, { HOME: homeTmp });
    assert.equal(
      dod.status, 0,
      `8 项 gate 自落回执后 dod 必须 exit 0（实际 ${dod.status}）——CI 回执链断裂：` +
        `\n--- stdout 尾部 ---\n${tail(dod.stdout, 40)}\n--- stderr 尾部 ---\n${tail(dod.stderr, 40)}`,
    );
  } finally {
    rmDir(dir);
    rmDir(homeTmp);
    rmDir(regDir);
  }
});

// ---------- 用例 5：win32 短名路径回归锁（install --verify 的 staged 行为锁） ----------

test('PF2-3 install --verify 对临时 git 仓必须完成安装面 stage（win32 短名路径回归锁）', () => {
  // CI windows #153/#161 根因：GitHub windows runner 的 os.tmpdir() 是 8.3 短名（C:\Users\RUNNER~1\…）
  // 而 git rev-parse --show-toplevel 返回长名——verifyInstalled 严格字符串比较必不等，误走「目标在别的
  // 仓库内部」分支，staged 永不设置。doctor.mjs 修复 = realpathSync.native 归一比较。Linux tmpdir 无短名
  // 形态差异可构造（resolve 层已归一），本用例退化为 staged 行为锁：win32 上比较未归一时必红，且失败
  // 消息直接指向短名根因（区别于 r4d 8.8 同形用例的红——消息不指向根因）。
  const src = mkHarnessProj();
  const home = tempDir('pf2-home');
  const target = tempDir('pf2-tgt');
  try {
    spawnSync('git', ['init', '-q'], { cwd: target, stdio: 'ignore' });
    const res = runZbase(src, ['install', target, '--verify', '--json'], 300_000, { HOME: home });
    assert.equal(
      res.status, 0,
      `install --verify 必须 exit 0（实际 ${res.status}）` +
        `\n--- stdout 尾部 ---\n${(res.stdout || '').trim().split('\n').slice(-15).join('\n')}` +
        `\n--- stderr 尾部 ---\n${(res.stderr || '').trim().split('\n').slice(-15).join('\n')}`,
    );
    const rep = JSON.parse(res.stdout.trim().split('\n').filter(Boolean).pop());
    assert.equal(
      rep.verify.staged, true,
      'verify.staged 必须为 true——若为 undefined 且 warnings 含「目标在 … 仓库内部」，即 toplevel 与 target 的' +
        '路径形态比较未归一（win32 8.3 短名 vs git 长名，doctor.mjs verifyInstalled 必须用 realpathSync.native 比较）',
    );
  } finally {
    rmDir(src);
    rmDir(home);
    rmDir(target);
  }
});
