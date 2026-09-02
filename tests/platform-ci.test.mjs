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

// ---------- 用例 4 取证辅助：gate 失败名单从 evidence 全量解析（纯函数，独立自测） ----------

// node --test TAP 失败解析：每条 not ok 提取 { name, duration, error }。
//   - 允许嵌套子测试缩进（^\s*）；「# Subtest」前缀注释行天然不匹配；
//   - duration = 诊断块内首个 duration_ms 值；error = 首个 error 体首行——
//     「error: |-」多行形态取其后第一条非空行，「error: '单行'」形态去引号；
//   - error 首行截断到 160 字符；无 duration / 无 error 容错为 null（不猜）。
function parseTapFailures(text) {
  const lines = String(text || '').split('\n');
  const fails = [];
  const SCAN_MAX = 120; // 诊断块扫描上限（带栈的块数十行；防畸形输入整文件扫）
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*not ok \d+ - (.+)$/);
    if (!m) continue;
    let duration = null;
    let error = null;
    for (let j = i + 1; j < Math.min(lines.length, i + SCAN_MAX); j++) {
      const l = lines[j];
      if (/^\s*(not )?ok \d+ - /.test(l) || /^\s*1\.\.\d+/.test(l) || /^TAP version /.test(l) || /^\s*\.\.\.\s*$/.test(l)) break;
      if (duration === null) {
        const dm = l.match(/^\s*duration_ms:\s*([0-9.]+)\s*$/);
        if (dm) { duration = dm[1]; continue; }
      }
      if (error === null) {
        const em = l.match(/^\s*error:\s?(.*)$/);
        if (em) {
          const rest = em[1];
          if (rest === '|-') {
            for (let k = j + 1; k < Math.min(lines.length, j + SCAN_MAX); k++) {
              const t = lines[k].trim();
              if (t) { error = t; break; }
            }
          } else {
            error = rest.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
          }
        }
      }
      if (duration !== null && error !== null) break;
    }
    if (error !== null && error.length > 160) error = `${error.slice(0, 159)}…`;
    fails.push({ name: m[1].trim(), duration, error });
  }
  return fails;
}

// zbase() 解析惯例（tests/helpers.mjs:22）：先试最后一条非空行（单行机器通道），
// 失败再试整个 stdout（gate --json 是 pretty 多行 JSON，最后一行是「}」必然失败）。
function parseGateJson(s) {
  const line = (s || '').trim().split('\n').filter(Boolean).pop();
  if (line) { try { return JSON.parse(line); } catch { /* 落到整体解析 */ } }
  try { return JSON.parse((s || '').trim()); } catch { return null; }
}

// gate 失败取证：优先按 runGate 回执句柄（receiptSeq + evidencePath——相对沙箱根的 posix
// 路径，quality.mjs writeEvidenceFile 落盘）读 evidence 全量（保尾 ≤200k，比 outputTail 的
// 2000 字符窗口大两个数量级——上轮 19 失败只捞到 1 条的直接根因）解析 TAP；句柄缺失或
// 文件不存在回落 outputTail/stdout 解析。返回 { detail, stdout }：detail = 附进断言消息的
// 名单段；stdout = 「stdout 尾部」段的首选来源（evidence 命中时用 raw outputTail 比 JSON 可读）。
function gateForensics(root, r) {
  const res = parseGateJson(r.stdout);
  const handle = res && typeof res.evidencePath === 'string' ? res : null;
  const render = (fails) => fails
    .slice(0, 25)
    .map((f) => `${f.name}（duration_ms ${f.duration ?? '？'}，error: ${f.error ?? '（无 error 行）'}）`)
    .join('\n');
  if (handle && fs.existsSync(path.join(root, handle.evidencePath))) {
    const fails = parseTapFailures(fs.readFileSync(path.join(root, handle.evidencePath), 'utf8'));
    const head = `（evidence 全量解析：receiptSeq ${handle.receiptSeq ?? '？'} → ${handle.evidencePath}）`;
    return {
      detail: fails.length
        ? `\n--- 失败用例名单（not ok ${fails.length} 条${fails.length > 25 ? '，仅列前 25 条' : ''}）${head} ---\n${render(fails)}`
        : `\n--- TAP 解析得 0 条 not ok ${head}——node ≥23 的 --test 默认 spec 报告器没有 not ok 行，属预期，定性看下方输出尾部 ---`,
      stdout: res.outputTail || r.stdout,
    };
  }
  const fb = parseTapFailures((res && res.outputTail) || r.stdout);
  return {
    detail: `\n--- 失败用例名单（回落 outputTail/stdout 解析：${handle ? `evidence 文件不存在（${handle.evidencePath}）` : 'stdout JSON 无 evidencePath 句柄'}，not ok ${fb.length} 条）---\n` +
      (fb.length ? render(fb) : '（0 条——可能为 spec 报告器输出或非 TAP 检查）'),
    stdout: r.stdout,
  };
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
      // --json 机器通道：stdout 变为 runGate 结果的 pretty JSON（含 receiptSeq/evidencePath
      // 句柄）供取证解析；exit 码与检查执行同人读通道完全一致（print 后按 res.ok 退出）。
      const r = runZbase(dir, ['gate', check, '--json'], 300_000, { HOME: homeTmp });
      const forensics = r.status === 0 ? null : gateForensics(dir, r); // posix 全绿零额外 IO
      assert.equal(
        r.status, 0,
        `gate ${check} 必须 exit 0（实际 ${r.status}${r.error ? `，spawn 异常 ${r.error.message}` : ''}）` +
          (forensics ? forensics.detail : '') +
          `\n--- stdout 尾部 ---\n${tail(forensics ? forensics.stdout : r.stdout)}\n--- stderr 尾部 ---\n${tail(r.stderr)}`,
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

// ---------- 用例 4b：取证解析器自测（合成 TAP + 合成 gate 回执句柄，不跑真 gate） ----------

test('PF1-4 取证解析器：parseTapFailures 合成 TAP（error 两形态/缩进与 # Subtest 忽略/无 duration 容错/160 截断）+ gateForensics 句柄命中与回落', () => {
  const LONG_ERR = 'Y'.repeat(200);
  const tap = [
    'TAP version 13',
    '# Subtest: ok 的用例',
    'ok 1 - ok 的用例',
    '  ---',
    '  duration_ms: 0.1',
    '  ...',
    '# Subtest: setup 秒崩用例',
    'not ok 2 - setup 秒崩用例',
    '  ---',
    '  duration_ms: 8.12',
    "  type: 'test'",
    '  error: |-',
    '    ReferenceError: hooks is not defined',
    '        at Test.run (node:internal/test_runner/test:1118:25)',
    "  code: 'ERR_TEST_FAILURE'",
    '  ...',
    '# Subtest: 单行 error 用例',
    'not ok 3 - 单行 error 用例',
    '  ---',
    '  duration_ms: 0.059',
    "  error: 'boom 单行形态'",
    '  ...',
    '# Subtest: 嵌套缩进且无 duration 的用例',
    '    not ok 4 - 嵌套缩进且无 duration 的用例',
    '      ---',
    '      error: |-',
    `        ${LONG_ERR} 尾部截断`,
    '      ...',
    '1..4',
  ].join('\n');
  const fails = parseTapFailures(tap);
  assert.equal(fails.length, 3, `ok 行与「# Subtest」前缀行不得计入名单（实际 ${JSON.stringify(fails)}）`);
  assert.deepEqual(fails[0], { name: 'setup 秒崩用例', duration: '8.12', error: 'ReferenceError: hooks is not defined' }, 'error: |- 多行形态取首条非空行');
  assert.deepEqual(fails[1], { name: '单行 error 用例', duration: '0.059', error: 'boom 单行形态' }, 'error: 单行形态去引号');
  assert.deepEqual(
    fails[2],
    { name: '嵌套缩进且无 duration 的用例', duration: null, error: `${'Y'.repeat(159)}…` },
    '嵌套缩进可匹配；无 duration 容错为 null；error 首行截断到 160 字符',
  );
  assert.equal(fails[2].error.length, 160, '截断后恰 160 字符（159 + 省略号）');
  assert.deepEqual(parseTapFailures(''), [], '空文本容错为空名单');
  assert.deepEqual(parseTapFailures(null), [], 'null 容错为空名单');

  // gateForensics 全链：合成沙箱里放假 evidence 文件，喂合成 gate --json stdout
  const sbx = tempDir('pf1-forensic');
  try {
    const evRel = '.zcode/state/evidence/no-task/harness-unit-tests-1-1.log';
    fs.mkdirSync(path.dirname(path.join(sbx, evRel)), { recursive: true });
    fs.writeFileSync(path.join(sbx, evRel), tap);
    // pretty 多行 JSON（gate --json 实际形态）→ parseGateJson 走「整体 stdout」分支
    const good = gateForensics(sbx, {
      status: 3,
      stdout: JSON.stringify({ ok: false, status: 'FAIL', exitCode: 1, outputTail: '（outputTail 窗口）', receiptSeq: 9, evidencePath: evRel }, null, 2),
    });
    assert.ok(good.detail.includes('receiptSeq 9'), '消息必须带回执句柄（receiptSeq + evidencePath）');
    assert.ok(
      good.detail.includes('setup 秒崩用例（duration_ms 8.12，error: ReferenceError: hooks is not defined）'),
      '消息必须带 名字 + duration + error 首行 三元组',
    );
    assert.equal(good.stdout, '（outputTail 窗口）', 'evidence 命中时 stdout 尾部首选 raw outputTail（比 JSON 转义形态可读）');
    // 单行 JSON → parseGateJson 走「最后一行」分支
    const single = gateForensics(sbx, { status: 3, stdout: JSON.stringify({ receiptSeq: 10, evidencePath: evRel, outputTail: 'x' }) });
    assert.ok(single.detail.includes('receiptSeq 10'));
    // 句柄在但文件不存在 → 回落 outputTail 解析
    const miss = gateForensics(sbx, {
      status: 3,
      stdout: JSON.stringify({ outputTail: 'not ok 7 - 只有尾巴窗口', evidencePath: '.zcode/state/evidence/no-task/absent.log' }, null, 2),
    });
    assert.ok(miss.detail.includes('回落'), 'evidence 文件不存在必须明示回落');
    assert.ok(miss.detail.includes('只有尾巴窗口'), '回落名单来自 outputTail 解析');
    // stdout 根本不是 JSON（人读通道形态）→ 无句柄回落且 0 条不炸
    const noJson = gateForensics(sbx, { status: 1, stdout: 'gate 人读格式输出' });
    assert.ok(noJson.detail.includes('0 条'), '无 JSON 句柄时如实报 0 条（fail-visible，不硬造名单）');
  } finally {
    rmDir(sbx);
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
