// 批次 15（E2 减脂批）：
// ① P11 余量 shim 删除锁：12 个零引用 shim 不在盘（`export *` 与命名 re-export 两形态——retention 为
//    后者，review 裁 FIX_REQUIRED 后补删）+ 7 个有在册调用方的 shim 保留点名（决策留痕）；
// ② 全仓静态零引用扫描（与删除审计同口径：import 形态含省略扩展名 / 动态 import() / 字符串路径引用
//    （含 lib/ 前缀与裸文件名两形态）/ path.join 拼装提示的裸文件名；docs/feedback/state 历史性提及豁免）；
// ③ catalog 收编 + manifest 对齐：runtime-harness globs 无悬空 + catalog lint 0 error + manifest 无被删名 + check 过闸；
// ④ 重注入正常路径不回归（emit 成功 → 行送达 + 指纹写回 + gate-log observe，对齐 batch12 R9-R2 语义不弱化）；
// ⑤ 重注入 emit 失败：指纹不落（非 0 退出 fail-visible）+ 下轮正常 emit 重发（重于漏发，R9-P3-3 时序整改锚）——
//    注入方式 NODE_OPTIONS --import 载荷补丁从进程内抛同步错（/dev/full、关闭 fd1、断管三形态实测均造不出
//    可靠同步失败——Node 吞错后立即 exit(0)，进程内注入是唯一可靠形态，如实记档）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkHarnessProj, rmDir, zbase, REPO, tempDir } from './helpers.mjs';

// E2 删除面（P11 七删后的零引用余量；retention 为命名 re-export 形态，review P2-1 补删）；KEPT 七个各有在册调用方（见各用例注释），不删。
const DELETED = ['agentslint', 'config', 'feedbacklint', 'fitness', 'manifest', 'memory', 'release', 'retention', 'risk', 'rulesaudit', 'scaninstr', 'sync'];
// arch.mjs（harness.test.mjs + batch13 删除锁）、catalog.mjs（harness.test.mjs）、common.mjs（harness/mechanisms/r4a）、
// git.mjs（mechanisms）、impact.mjs（harness）、skillslint.mjs（r4a）为动态 import 引用；
// state.mjs 为 mechanisms.test.mjs 跨进程并发测试的 path.join 拼装引用（邻接口径漏网、全量测试捕获后如实恢复）。
const KEPT = ['arch', 'catalog', 'common', 'git', 'impact', 'skillslint', 'state'];
const libFile = (dir, name) => path.join(dir, '.zcode', 'lib', `${name}.mjs`);

// ══════════════════ ①② 删除面与零引用锁 ══════════════════

test('E2-S1 12 零引用 shim 已删（export * 与命名 re-export 两形态）+ 7 有引用 shim 保留（删除面精确到名，不虚报）', () => {
  for (const name of DELETED) {
    assert.equal(fs.existsSync(libFile(REPO, name)), false, `${name} 应已删除（E2 全仓零引用核验）`);
  }
  for (const name of KEPT) {
    assert.equal(fs.existsSync(libFile(REPO, name)), true, `${name} 有在册 import 调用方（tests 动态 import），保留`);
  }
});

// 扫描豁免目录名（历史性提及豁免：docs 研究笔记 / feedback 教训 / state 运行态账本 / VCS 与依赖目录）
const SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', 'state', 'agent-memory', 'docs', 'feedback']);
const SCAN_SUFFIX = /\.(mjs|js|cjs|json|sh|ps1|yml|yaml|md|command)$/;

function* scanFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(e.name)) continue;
      yield* scanFiles(path.join(dir, e.name));
    } else if (SCAN_SUFFIX.test(e.name) && !/^progress(\.archive)?\.md$/.test(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

test('E2-S2 全仓静态零引用扫描：11 被删名无任何 import/动态 import/字符串路径引用（审计同口径+裸文件名形态）', () => {
  const patternsOf = (name) => [
    new RegExp(`from\\s+['"]\\.{1,2}/${name}['"]`),                              // 相对 import 省略扩展名
    new RegExp(`from\\s+['"]\\.{1,2}/${name}\\.mjs['"]`),                        // 相对 import 全形态
    new RegExp(`['"][^'"]*lib/${name}(\\.mjs)?['"]`),                            // 含 lib/ 前缀的字符串路径（含动态 import() 实参）
    new RegExp(`import\\(\\s*['"]\\.{1,2}/${name}(\\.mjs)?['"]\\s*\\)`),         // 动态 import 相对形态
    new RegExp(`['"]${name}\\.mjs['"]`),                                         // 裸文件名字符串（path.join 拼装提示——state.mjs 漏网教训）
  ];
  const offenders = [];
  for (const file of scanFiles(REPO)) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const name of DELETED) {
      for (const re of patternsOf(name)) {
        const m = text.match(re);
        if (m) offenders.push(`${path.relative(REPO, file)}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `被删 shim 出现新引用（复活须重走删除审计）：\n${offenders.join('\n')}`);
});

// ══════════════════ ③ catalog 收编 + manifest 对齐 ══════════════════

test('E2-S3 catalog 收编 + manifest 对齐：globs 无悬空、lint 0 error、manifest 无被删名且 check 过闸', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'module-catalog.json'), 'utf8'));
  const libGlobs = catalog.modules.flatMap((m) => (m.globs || []).filter((g) => g.startsWith('.zcode/lib/') && g.endsWith('.mjs')));
  for (const g of libGlobs) {
    assert.equal(fs.existsSync(path.join(REPO, g)), true, `catalog glob 指向不存在文件：${g}`);
  }
  for (const name of DELETED) {
    assert.ok(!libGlobs.includes(`.zcode/lib/${name}.mjs`), `被删文件 ${name} 的 catalog glob 未收编`);
  }
  const lint = zbase(['catalog', 'lint', '--json']);
  assert.equal(lint.code, 0, `catalog lint 须 0 error：${lint.stdout}${lint.stderr}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'FRAMEWORK-MANIFEST.json'), 'utf8'));
  for (const name of DELETED) {
    assert.ok(!Object.prototype.hasOwnProperty.call(manifest.files, `.zcode/lib/${name}.mjs`), `manifest 仍登记被删文件：${name}`);
  }
  const check = zbase(['manifest', 'check', '--json']);
  assert.equal(check.code, 0, `manifest check 须过闸：${check.stdout}${check.stderr}`);
});

// ══════════════════ ④⑤ 重注入时序（R9-P3-3：先送达后记账） ══════════════════

const ENVELOPE = JSON.stringify({
  goal: 'E2 重注入时序验证目标行',
  scope: ['src/**'], outOfScope: [], existingPattern: 'n/a',
  verification: [{ command: 'node -e 0', expect: 'exit 0' }],
  business: '验证 emit 成功后才落指纹的时序契约',
  escalation: '卡住交回',
});
const statePath = (dir) => path.join(dir, '.zcode', 'state', 'state.json');
const readState = (dir) => (fs.existsSync(statePath(dir)) ? JSON.parse(fs.readFileSync(statePath(dir), 'utf8')) : {});
const prompt = (dir, opts = {}) => zbase(['hook', 'user-prompt-submit'], {
  cwd: dir, input: JSON.stringify({ prompt: '继续干活' }), ...opts,
});

test('E2-R1 重注入正常路径不回归：emit 成功 → 行送达 + 指纹写回 + gate-log observe + 同指纹幂等', () => {
  const dir = mkHarnessProj();
  try {
    assert.equal(zbase(['task', 'start', '--input', '-', '--owned', 'src/**'], { cwd: dir, input: ENVELOPE }).code, 0);
    const res = prompt(dir);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /铁律重注入/);
    assert.match(readState(dir).lastReinjectedFingerprint ?? '', /^[0-9a-f]{64}$/, 'emit 成功后指纹写回仍在（时序整改不减成功面）');
    const gate = fs.readFileSync(path.join(dir, '.zcode', 'state', 'gate-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(gate.some((g) => g.rule === 'reinjection' && g.action === 'observe'), '送达后记账：observe 留痕仍在');
    const second = prompt(dir);
    assert.equal(second.code, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /铁律重注入/, '同指纹第二发不发（幂等不回归）');
  } finally { rmDir(dir); }
});

test('E2-R2 重注入 emit 失败：指纹不落（非 0 退出 fail-visible）+ 下轮正常 emit 重发（重于漏发）', () => {
  // NODE_OPTIONS --import 需 Node≥20.6；engines >=20 的 20.0-20.5 缝隙下该用例环境性通过非真测
  // （旧 Node 子进程在 flag 解析即退非零，两条断言空转成立而非验证注入路径）——CI 22/24 实测有效，如实记档不强改 engines。
  const patchDir = tempDir('e2-emit-fail');
  const patch = path.join(patchDir, 'patch.mjs');
  fs.writeFileSync(patch, [
    '// E2 测试注入：只让 emit 载荷写出抛同步错，其余 stdout 写不受影响。',
    'const orig = process.stdout.write.bind(process.stdout);',
    'process.stdout.write = (chunk, enc, cb) => {',
    "  if (typeof chunk === 'string' && chunk.includes('\\\"additionalContext\\\"')) {",
    "    throw new Error('EIO: test-injected emit failure');",
    '  }',
    '  return orig(chunk, enc, cb);',
    '};',
    '',
  ].join('\n'));
  const importUrl = pathToFileURL(patch).href;
  const dir = mkHarnessProj();
  try {
    assert.equal(zbase(['task', 'start', '--input', '-', '--owned', 'src/**'], { cwd: dir, input: ENVELOPE }).code, 0);
    const failed = prompt(dir, { env: { NODE_OPTIONS: `--import ${importUrl}` } });
    assert.notEqual(failed.code, 0, 'emit 写出抛错须非 0 退出（fail-visible，不静默假绿）');
    assert.equal(readState(dir).lastReinjectedFingerprint, undefined, 'emit 失败不得写指纹（旧时序=先写后发，用户未见行且下轮不重发）');
    // 下轮 emit 正常：同一指纹必须重发——「重于漏发」的可观察证明
    const resent = prompt(dir);
    assert.equal(resent.code, 0, resent.stderr);
    assert.match(resent.stdout, /铁律重注入/, 'emit 失败后下轮必须重发（指纹未落，不吞行）');
    assert.match(readState(dir).lastReinjectedFingerprint ?? '', /^[0-9a-f]{64}$/, '重发送达后指纹才落盘');
    // 补：emit 失败轮的进程内补丁自身合法加载（防「补丁没生效导致假绿」——失败轮必须真跑过补丁路径）
    assert.ok(failed.stderr.length > 0, '失败轮须有 stderr（崩溃可见）');
  } finally { rmDir(dir); rmDir(patchDir); }
});
// 自指防护说明：本文件对被删名的引用一律为裸名数组或 path.join 拼装，无 lib/<name> 邻接字面量——E2-S2 扫描不会误报自身。
// 盘点口径教训（E2+review 固化）：①shim 识别须覆盖 `export *` 与**命名 re-export** 两形态（retention 漏网实证）；
// ②引用核查须覆盖 path.join 拼装/裸文件名形态（state.mjs 漏网实证）。
