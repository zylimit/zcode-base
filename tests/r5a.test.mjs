// Phase 9 R5a 机制测试（Task 9.1/9.2/9.3）：
// 八属性六档（UNJUSTIFIED_TIER 拒未理由降档/存量迁移 lint 绿/F1 严格化）
// + adapters（list PATH 探测+wired / add 接线+dry-run / 可执行缺失 BLOCKED 永不 PASS）
// + runtimeValidityHours 时间窗绑定（覆盖→过期回落 uncovered）
// + spec-lint（EARS 坏样例各码/degraded/本仓实扫绿）+ trace（悬空引用 fail/coverage 计算/孤儿/minCoverage）
// + context pack（DENY 命中变更集→diff 整体占位/无 DENY→diff 进包/摘要证据分离预算）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { zbase, mkHarnessProj, rmDir, REPO } from './helpers.mjs';
import { lint } from '../.zcode/lib/graph.mjs';

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function run(cwd, args) {
  return spawnSync(process.execPath, [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 60000 });
}

const jsonOf = (r) => {
  if (r.json !== undefined && r.json !== null) return r.json;
  const text = (r.stdout || '').trim();
  return JSON.parse(text); // helpers.zbase 未解析时兜底整体解析（pretty JSON 多行）
};

// ---------- Task 9.1：八属性六档 ----------

test('9.1 catalog lint：minimal/none 无 attributeReasons → UNJUSTIFIED_TIER error（退出治理是记录的决策）', () => {
  const base = (attributes, attributeReasons) => ({
    version: 1,
    modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes, ...(attributeReasons ? { attributeReasons } : {}) }],
  });
  // none 无理由 → error
  let res = lint(base({ reliability: 'none' }));
  assert.ok(res.errors.some((e) => e.code === 'UNJUSTIFIED_TIER' && e.module === 'app'), JSON.stringify(res.errors));
  // minimal 无理由 → error（新档位）
  res = lint(base({ reliability: 'minimal' }));
  assert.ok(res.errors.some((e) => e.code === 'UNJUSTIFIED_TIER'));
  // 补理由 → 绿
  res = lint(base({ reliability: 'none' }, { reliability: '脚手架示例：无可执法面' }));
  assert.equal(res.errors.filter((e) => e.code === 'UNJUSTIFIED_TIER').length, 0);
  // 未知属性名 / 未知档位
  res = lint(base({ turbo: 'high' }));
  assert.ok(res.errors.some((e) => e.code === 'UNKNOWN_ATTRIBUTE' && e.attr === 'turbo'));
  res = lint(base({ reliability: 'extreme' }));
  assert.ok(res.errors.some((e) => e.code === 'UNKNOWN_TIER'));
  // 八属性全名合法 + minimal 合法
  res = lint(base({
    resilience: 'low', security: 'none', safety: 'none', privacy: 'none', reliability: 'minimal',
    availability: 'none', performance: 'medium', maintainability: 'low',
  }, { security: '无信任边界', safety: '纯工具', privacy: '无个人数据', reliability: '降档执行', availability: '非服务' }));
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
});

test('9.1 本仓存量迁移：八属性六档后 catalog lint 全绿（exit 0）', () => {
  const r = zbase(['catalog', 'lint', '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const res = jsonOf(r);
  assert.equal(res.errors.length, 0);
});

test('9.1 fitness F1 严格化：minimal/none 缺 attributeReasons → 审计失败（模块级 reason 不再豁免）', () => {
  const dir = mkHarnessProj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { safety: 'none' }, reason: '模块级总体说明' }] },
    matrix: { version: 1, checks: [] },
  });
  const r = zbase(['fitness', '--json'], { cwd: dir });
  assert.equal(r.code, 3, 'F1 应 FAIL（exit 3）');
  const f1 = jsonOf(r).results.find((x) => x.id === 'F1');
  assert.equal(f1.ok, false);
  assert.ok(JSON.stringify(f1.detail).includes('attributeReasons'));
  rmDir(dir);
});

test('9.1 adapters list：available 按 PATH 真实探测，wired 按 matrix 同名检查', () => {
  const dir = mkHarnessProj({
    matrix: { version: 1, checks: [{ name: 'probe-node', command: 'node -e 0', proves: ['reliability'] }] },
  });
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'adapters.json'), JSON.stringify({
    version: 1,
    adapters: [
      { id: 'probe-node', attributes: ['reliability'], class: 'test', executable: 'node', command: 'node -e 0', install: 'x', rationale: '必有可执行' },
      { id: 'probe-missing', attributes: ['security'], class: 'security', executable: 'zz-not-a-tool-9x', command: 'zz-not-a-tool-9x --x', install: 'x', rationale: '必缺失' },
    ],
  }));
  const r = zbase(['adapters', 'list', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const res = jsonOf(r);
  const byId = Object.fromEntries(res.adapters.map((a) => [a.id, a]));
  assert.equal(byId['probe-node'].available, true, 'node 在 PATH 必探测得到');
  assert.equal(byId['probe-node'].wired, true, 'matrix 有同名检查 = wired');
  assert.equal(byId['probe-missing'].available, false, '不存在的可执行探测不出');
  assert.equal(byId['probe-missing'].wired, false);
  // --attribute 过滤
  const r2 = zbase(['adapters', 'list', '--attribute', 'security', '--json'], { cwd: dir });
  const res2 = jsonOf(r2);
  assert.deepEqual(res2.adapters.map((a) => a.id), ['probe-missing']);
  rmDir(dir);
});

test('9.1 adapters add：写入 matrix（proves/class/runtimeValidityHours），dry-run 不落盘，未知 id exit 1', () => {
  const dir = mkHarnessProj();
  const unknown = zbase(['adapters', 'add', 'no-such-adapter', '--json'], { cwd: dir });
  assert.equal(unknown.code, 1);
  // 真目录里的 runtime 类：load-k6 应带 runtimeValidityHours
  const dry = zbase(['adapters', 'add', 'load-k6', '--dry-run', '--json'], { cwd: dir });
  assert.equal(dry.code, 0, dry.stdout + dry.stderr);
  const before = fs.readFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), 'utf8');
  assert.ok(!before.includes('load-k6'), 'dry-run 不得写盘');
  const add = zbase(['adapters', 'add', 'load-k6', '--json'], { cwd: dir });
  assert.equal(add.code, 0, add.stdout + r0(add));
  const added = jsonOf(add);
  assert.equal(added.changed, true);
  assert.match(added.nextStep, /接线只是一半/);
  const matrix = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), 'utf8'));
  const chk = matrix.checks.find((c) => c.name === 'load-k6');
  assert.ok(chk, '检查已写入 matrix');
  assert.deepEqual(chk.proves, ['availability', 'performance']);
  assert.equal(chk.class, 'runtime');
  assert.equal(chk.runtimeValidityHours, 24, 'class:runtime 默认 24h 时间窗');
  // 幂等重跑：changed=false
  const again = jsonOf(zbase(['adapters', 'add', 'load-k6', '--json'], { cwd: dir }));
  assert.equal(again.changed, false);
  rmDir(dir);
});
function r0(r) { return (r && r.stderr) || ''; }

test('9.1 runGate：可执行缺失 → BLOCKED 永不 PASS（缺工具是 BLOCKED 不是 FAIL）', () => {
  const dir = mkHarnessProj({
    matrix: { version: 1, checks: [{ name: 'ghost-tool', command: 'zz-missing-tool-77 scan .', proves: ['security'] }] },
  });
  const r = zbase(['gate', 'ghost-tool', '--json'], { cwd: dir });
  const res = jsonOf(r);
  assert.equal(res.status, 'BLOCKED', JSON.stringify(res));
  assert.match(res.outputTail ?? '', /可执行缺失/);
  rmDir(dir);
});

test('9.1 runtimeValidityHours 时间窗：指纹过期仍按窗口覆盖（time-window 绑定），窗口过后回落 uncovered', () => {
  const dir = mkHarnessProj({
    catalog: { version: 1, modules: [{ name: 'app', globs: ['src/**'], deps: [], attributes: { availability: 'high' } }] },
    matrix: { version: 1, checks: [{ name: 'rt', command: 'node -e 0', proves: ['availability'], class: 'runtime', runtimeValidityHours: 0.0008 }] }, // ≈2.88s
  });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'v1');
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  // ① 跑出 PASS 回执（diff 绑定）
  const g = zbase(['gate', 'rt', '--json'], { cwd: dir });
  assert.equal(jsonOf(g).status, 'PASS', g.stdout + g.stderr);
  // ② 改工作树 → 指纹过期；ts 仍在时间窗内 → 时间窗覆盖（never 工作树证据标注）
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'v2');
  const v1 = jsonOf(zbase(['quality', 'verify', '--json'], { cwd: dir }));
  assert.equal(v1.ok, true, JSON.stringify(v1.blocking));
  assert.equal(v1.timeWindowCovered.length, 1);
  assert.match(v1.timeWindowCovered[0].binding, /^time-window-/);
  // ③ 窗口过后 → 回落 uncovered 且 availability(high) 阻断
  sleep(3200);
  const v2 = zbase(['quality', 'verify', '--json'], { cwd: dir });
  assert.equal(v2.code, 3, '窗口过期后 verify 应 exit 3');
  assert.ok(jsonOf(v2).blocking.some((b) => b.attribute === 'availability'));
  rmDir(dir);
});

// ---------- Task 9.2：spec-lint（EARS）+ trace ----------

function writeSpec(dir, text) {
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), text);
}

test('9.2 spec-lint：无需求文件 → degraded exit 3', () => {
  const dir = mkHarnessProj();
  const r = zbase(['spec-lint', '--json'], { cwd: dir });
  assert.equal(r.code, 3);
  assert.equal(jsonOf(r).degraded, true);
  rmDir(dir);
});

test('9.2 spec-lint：坏样例逐码命中（NOT_NORMATIVE/NO_METRIC/PLACEHOLDER/DUPLICATE_ID=error；NO_TRIGGER/AMBIGUOUS=warning）', () => {
  const dir = mkHarnessProj();
  const cases = [
    // [name, specText, expectCodes(as error), expectWarnings, exit]
    ['NOT_NORMATIVE', '# S\n\n- REQ-100：支持导出，导出为 CSV。\n', ['NOT_NORMATIVE'], [], 3],
    ['NO_METRIC', '# S\n\n- NFR-1：当高峰时系统必须保持快速；验收：压测报告。\n', ['NO_METRIC'], [], 3],
    ['PLACEHOLDER', '# S\n\nTBD\n\n- REQ-101：当提交时必须记录审计日志；验收：审计表有行。\n', ['PLACEHOLDER'], [], 3],
    ['DUPLICATE_ID', '# S\n\n- REQ-102：当登录失败达 3 次时必须锁定；验收：锁定标记。\n\n- REQ-102：重复声明。\n', ['DUPLICATE_ID'], [], 3],
    ['NO_TRIGGER_warning', '# S\n\n- REQ-103：系统必须校验签名；验收：坏签名被拒。\n', [], ['NO_TRIGGER'], 0],
    ['AMBIGUOUS_warning', '# S\n\n- REQ-104：当加载时必须初始化；验收：日志有序。（合理默认值）\n', [], ['AMBIGUOUS'], 0],
    ['NFR_metric_ok', '# S\n\n- NFR-2：当查询时 p95 必须 <250 ms；验收：基准输出。\n', [], [], 0],
    ['clean_REQ', '# S\n\n- REQ-105：当用户提交时系统必须记录审计日志；验收：审计表有对应行。\n', [], [], 0],
  ];
  for (const [name, text, errs, warns, exit] of cases) {
    writeSpec(dir, text);
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, exit, `${name}: exit ${r.code}≠${exit}\n${r.stdout}${r.stderr}`);
    const res = jsonOf(r);
    const codes = (sev) => res.findings.filter((f) => f.severity === sev).map((f) => f.code);
    for (const e of errs) assert.ok(codes('error').includes(e), `${name}: errors=${codes('error')}`);
    for (const w of warns) assert.ok(codes('warning').includes(w), `${name}: warnings=${codes('warning')}`);
    if (!errs.length) assert.equal(res.counts.error, 0, `${name}: 不应有 error`);
  }
  rmDir(dir);
});

test('9.2 trace：悬空引用 fail、coverage 计算、孤儿需求、minCoverage 配置', () => {
  const dir = mkHarnessProj();
  git(dir, 'init', '-q');
  writeSpec(dir, [
    '# S',
    '',
    '- REQ-101：当提交时必须记录审计日志；验收：审计表有行。',
    '- REQ-102：当导出时必须写出全部字段；验收：CSV 行数匹配。',
    '- REQ-103：当归档时必须保留指针；验收：指针可解析。',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), '// 覆盖 REQ-101\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'impl.js'), '// 实现 REQ-102\n');
  fs.writeFileSync(path.join(dir, 'tests', 'b.test.mjs'), '// 引用 REQ-999（悬空）\n');
  git(dir, 'add', '.');

  // 悬空 → fail（exit 3），coverage=1/3
  const r = zbase(['trace', '--json'], { cwd: dir });
  assert.equal(r.code, 3, r.stdout + r.stderr);
  const res = jsonOf(r);
  assert.equal(res.coverage, 0.3333, `coverage ${res.coverage}`);
  assert.deepEqual(res.danglingTests.map((d) => d.id), ['REQ-999']);
  assert.ok(res.orphaned.includes('REQ-103'), 'REQ-103 无实现无测试 = 孤儿');

  // 去掉悬空：minCoverage 默认 0 → 过；REQ-103 孤儿仅列出
  fs.writeFileSync(path.join(dir, 'tests', 'b.test.mjs'), '// 无引用\n');
  const ok0 = jsonOf(zbase(['trace', '--json'], { cwd: dir }));
  assert.equal(ok0.ok, true);
  assert.ok(ok0.orphaned.includes('REQ-103'));

  // harness.json spec.minCoverage=0.5 → coverage 0.3333 < 0.5 → fail
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify({ spec: { minCoverage: 0.5 } }));
  const r2 = zbase(['trace', '--json'], { cwd: dir });
  assert.equal(r2.code, 3);
  assert.equal(jsonOf(r2).minCoverage, 0.5);
  rmDir(dir);
});

test('9.2 本仓实扫：spec-lint 与 trace 全绿（34 需求，无悬空引用）', () => {
  const sl = zbase(['spec-lint', '--json']);
  assert.equal(sl.code, 0, sl.stdout + sl.stderr);
  const slr = jsonOf(sl);
  assert.equal(slr.counts.error, 0);
  assert.ok(slr.counts.requirements >= 34);
  const tr = zbase(['trace', '--json']);
  assert.equal(tr.code, 0, tr.stdout + tr.stderr);
  const trr = jsonOf(tr);
  assert.equal((trr.dangling || []).length + (trr.danglingTests || []).length, 0);
});

// ---------- Task 9.3：context pack 升级 ----------

function commitBaseline(dir) {
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'plain v1\n');
  fs.writeFileSync(path.join(dir, '.env'), 'password=hunter2-secret\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
}

test('9.3 pack：变更集含 DENY 路径 → canonical diff 整体占位+hash，秘密不进包', () => {
  const dir = mkHarnessProj();
  commitBaseline(dir);
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'plain v2\n');
  fs.writeFileSync(path.join(dir, '.env'), 'password=hunter2-secret-rotated\n');
  const r = zbase(['context', 'pack', '--paths', 'src/a.txt,.env', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const m = jsonOf(r);
  assert.ok(m.diffOmitted && m.diffOmitted.includes('.env'), 'diffOmitted 应点名 .env');
  const packText = fs.readFileSync(path.join(dir, ...m.evidencePath.split('/')), 'utf8');
  assert.match(packText, /DENIED-IN-CHANGESET/);
  assert.match(packText, /sha256:[0-9a-f]{64}/);
  assert.ok(!packText.includes('hunter2'), '秘密内容不得经 diff 进包');
  rmDir(dir);
});

test('9.3 pack：无 DENY 命中 → canonical diff 内容进包（evidence 侧）；摘要面只带句柄', () => {
  const dir = mkHarnessProj();
  commitBaseline(dir);
  fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'plain v2 with visible change\n');
  const r = zbase(['context', 'pack', '--paths', 'src/a.txt', '--json'], { cwd: dir });
  const m = jsonOf(r);
  assert.equal(m.diffOmitted, undefined);
  assert.ok(m.evidencePath && m.packHash, '摘要面必须携带 evidencePath/packHash 句柄');
  const packText = fs.readFileSync(path.join(dir, ...m.evidencePath.split('/')), 'utf8');
  assert.match(packText, /## Canonical Diff/);
  assert.ok(packText.includes('plain v2 with visible change'), '非秘密 diff 应可见');
  // 摘要/证据分离：manifest（模型可见面）不含文件内容
  assert.ok(!JSON.stringify(m).includes('plain v2 with visible change'));
  assert.ok(m.files.every((f) => !('content' in f)));
  rmDir(dir);
});

test('9.3 pack：modelSummary 超预算 → 清单截尾（filesTruncated），句柄与统计保留', () => {
  const dir = mkHarnessProj();
  commitBaseline(dir);
  const changed = [];
  for (let i = 0; i < 30; i++) {
    const p = `src/f${i}.txt`;
    fs.writeFileSync(path.join(dir, p), `content ${i}\n`);
    changed.push(p);
  }
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify({ context: { modelChars: 2000 } }));
  const r = zbase(['context', 'pack', '--paths', changed.join(','), '--json'], { cwd: dir });
  const m = jsonOf(r);
  assert.equal(m.modelChars, 2000);
  assert.ok(m.summaryChars <= 2000, `summaryChars ${m.summaryChars} 超预算`);
  assert.equal(JSON.stringify(m).length, m.summaryChars, 'summaryChars 必须与实际序列化长度一致（防自指漂移）');
  assert.equal(m.filesTruncated, true, '清单应截尾');
  assert.ok(m.files.length >= 10, '截尾保底 10 条');
  assert.ok(m.packHash, '句柄保留');
  rmDir(dir);
});
