// 批次 3 回归锁（双源同证机制落地，源 dsh 6af50bd/55f8dd7 × cc 62fe100/9395d5c 复查裁决）：
//   ① cochange：git 历史共变反查模块边界——达标对识别 / >minFiles 批量提交跳过计数可见 /
//      accepted 书面消音 / declared 信息行 / 默认 advisory rc 0 vs --gate rc 1 / 无 catalog rc 3；
//   ② catalog lint 对 cochange.accepted 的形状校验（reason 必填、with 不悬空）；
//   ③ catalog init：草案生成（referenceEdges 进参考边不进 deps、riskTier low 占位、attributes 不生成、
//      needsDecision 逐项）→ --apply 写盘后自跑 catalog lint rc 0（开箱即用硬保证）→ 已有 catalog 拒绝覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, zbase, tempDir, rmDir, mkHarnessProj } from './helpers.mjs';

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

/** 写文件（建父目录）→ git add 指定路径 → commit。沙箱提交序列精确控制共变历史。 */
function commit(dir, files, msg, content = 'x\n') {
  for (const f of files) {
    const abs = path.join(dir, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, 'add', ...files);
  git(dir, 'commit', '-q', '-m', msg);
}

// ---------- ① cochange ----------

const COCHANGE_CATALOG = {
  version: 1,
  modules: [
    { name: 'a', globs: ['src/a/**'], deps: [] },
    { name: 'b', globs: ['src/b/**'], deps: [] },
    { name: 'c', globs: ['src/c/**'], deps: [] },
  ],
  ignored: ['.zcode/**', '.git/**'],
};

/** 共变历史沙箱：初始(a) + 5 次 a+b 成对 + 1 次 c 独立 + 1 次 32 文件批量提交（跨 a/b，>30 须跳过）。 */
function mkCochangeProj({ catalog } = {}) {
  const dir = mkHarnessProj({ catalog: catalog || COCHANGE_CATALOG });
  commit(dir, ['src/a/seed.txt'], 'init a');
  for (let i = 0; i < 5; i++) commit(dir, [`src/a/f${i}.txt`, `src/b/f${i}.txt`], `pair ${i}`);
  commit(dir, ['src/c/solo.txt'], 'solo c');
  const bulk = [];
  for (let i = 0; i < 16; i++) bulk.push(`src/a/bulk/${i}.txt`);
  for (let i = 0; i < 16; i++) bulk.push(`src/b/bulk/${i}.txt`);
  commit(dir, bulk, 'bulk reformat'); // 32 文件 > minFiles=30：整 commit 跳过（若不跳过 (a,b) 会变成 6）
  return dir;
}

const pairOf = (json, mods) => (json.undeclaredCoupling || []).find((p) => p.modules.join('=') === mods.join('='));

test('B3-1 达标对识别 + 批量提交排除计数可见：5 次成对提交 → undeclared (a,b) cochangeCount=5；批量 commit 跳过且 skippedCommits=1', () => {
  const dir = mkCochangeProj();
  try {
    const r = zbase(['cochange', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `advisory 默认 rc 0\nstdout: ${r.stdout.slice(0, 400)}\nstderr: ${r.stderr}`);
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.commitsScanned, 7, 'init + 5 对 + solo = 7（批量提交不进 scanned）');
    assert.equal(j.skippedCommits, 1, '32 文件批量提交必须计入 skippedCommits（跳过不静默）');
    const ab = pairOf(j, ['a', 'b']);
    assert.ok(ab, 'undeclaredCoupling 必须含 (a,b)');
    assert.equal(ab.cochangeCount, 5, '批量提交被排除——若计入则 6（>30 文件整 commit 跳过）');
    // 每对自带分母（给分母不给合成分）：三数并列可复核
    assert.equal(ab.commitsScanned, 7);
    assert.equal(ab.skippedCommits, 1);
    assert.equal(j.knobs.pairThreshold, 5);
  } finally { rmDir(dir); }
});

test('B3-2 --gate opt-in：undeclared 非空 → rc 1；默认 advisory 同仓 rc 0', () => {
  const dir = mkCochangeProj();
  try {
    assert.equal(zbase(['cochange', '--gate', '--json'], { cwd: dir }).code, 1, 'opt-in 硬闸有 undeclared 对 → rc 1');
    assert.equal(zbase(['cochange', '--json'], { cwd: dir }).code, 0, '默认 advisory 永 rc 0');
  } finally { rmDir(dir); }
});

test('B3-3 accepted 书面消音：cochange.accepted 带理由的对 → acceptedCoupling，不再报 undeclared，--gate rc 0', () => {
  const catalog = structuredClone(COCHANGE_CATALOG);
  catalog.modules[0].cochange = { accepted: [{ with: 'b', reason: '同一工作流的两面，书面接受共变' }] };
  const dir = mkCochangeProj({ catalog });
  try {
    const r = zbase(['cochange', '--gate', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `accepted 对消音后 --gate 无 undeclared → rc 0\nstdout: ${r.stdout.slice(0, 400)}`);
    const j = r.json;
    assert.equal(j.undeclaredCoupling.length, 0, 'accepted 对不得再报 undeclared');
    const acc = (j.acceptedCoupling || []).find((p) => p.modules.join('=') === 'a=b');
    assert.ok(acc, 'acceptedCoupling 须列 (a,b)（含 cochangeCount，接受可见不等于删除事实）');
    assert.equal(acc.cochangeCount, 5);
  } finally { rmDir(dir); }
});

test('B3-4 declared 信息行：deps 双向任一声明 → declaredCoupling 非 undeclared（共变与声明一致 = 架构图认账）', () => {
  const catalog = structuredClone(COCHANGE_CATALOG);
  catalog.modules[1].deps = ['a']; // b 声明依赖 a：单向声明即构成双向判定
  const dir = mkCochangeProj({ catalog });
  try {
    const r = zbase(['cochange', '--gate', '--json'], { cwd: dir });
    assert.equal(r.code, 0, '声明过的共变不是 undeclared');
    const dec = (r.json.declaredCoupling || []).find((p) => p.modules.join('=') === 'a=b');
    assert.ok(dec, 'declaredCoupling 须列 (a,b) 信息行');
    assert.equal(dec.cochangeCount, 5);
  } finally { rmDir(dir); }
});

test('B3-5 无 catalog → rc 3 degraded（对齐仓内惯例）', () => {
  const dir = mkHarnessProj();
  try {
    fs.rmSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'));
    const r = zbase(['cochange', '--json'], { cwd: dir });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.equal(r.json.degraded, true);
  } finally { rmDir(dir); }
});

test('B3-6 三旋钮 CLI 可覆写 + 白名单正调用；--gate 拼错拒收', () => {
  const dir = mkCochangeProj();
  try {
    // --pair-threshold 6 > cochangeCount 5 → 无达标对（旋钮真实生效的证明）
    const r = zbase(['cochange', '--pair-threshold', '6', '--json'], { cwd: dir });
    assert.ok(!r.stderr.includes('未知 flag'), '--pair-threshold 必须被认识');
    assert.equal(r.json.undeclaredCoupling.length, 0, '阈值 6 时 count=5 不达标');
    assert.equal(r.json.knobs.pairThreshold, 6);
    // --min-files 100 > 32：批量提交不再跳过 → (a,b) 变 6（min-files 旋钮生效证明）
    const r2 = zbase(['cochange', '--min-files', '100', '--json'], { cwd: dir });
    assert.equal(pairOf(r2.json, ['a', 'b']).cochangeCount, 6, 'min-files 放宽后批量提交计入');
    assert.equal(r2.json.skippedCommits, 0);
    assert.equal(r2.json.knobs.minFiles, 100);
    // --max-commits 2：窗口收窄到最近 2 条 = bulk(跳过) + solo c → scanned=1/skipped=1（窗口×跳过叠加）
    const r3 = zbase(['cochange', '--max-commits', '2', '--json'], { cwd: dir });
    assert.equal(r3.json.commitsScanned, 1);
    assert.equal(r3.json.skippedCommits, 1);
    assert.equal(r3.json.truncated, true, '历史超窗口须 truncated 标注');
    // 数值校验：非正整数拒收
    assert.equal(zbase(['cochange', '--pair-threshold', 'abc'], { cwd: dir }).code, 1);
    // 未知 flag 拒收（SUBCOMMAND_FLAGS 表同步）
    const typo = zbase(['cochange', '--gatte'], { cwd: dir });
    assert.equal(typo.code, 1);
    assert.match(typo.stderr, /未知 flag：--gatte/);
  } finally { rmDir(dir); }
});

// ---------- ② catalog lint：cochange.accepted 形状校验 ----------

test('B3-7 accepted 形状执法：缺 reason → BAD_COCHANGE_ACCEPTED；with 悬空 → DANGLING_COCHANGE_REF；带全则 rc 0', () => {
  const mk = (acceptedA, acceptedB) => mkHarnessProj({
    catalog: {
      version: 1,
      modules: [
        { name: 'a', globs: ['src/a/**'], deps: [], ...(acceptedA ? { cochange: { accepted: acceptedA } } : {}) },
        { name: 'b', globs: ['src/b/**'], deps: [], ...(acceptedB ? { cochange: { accepted: acceptedB } } : {}) },
      ],
      ignored: ['.zcode/**', '.git/**'],
    },
  });
  const bad = mk([{ with: 'b' }]); // 缺 reason
  const ghost = mk([{ with: 'b', reason: 'r' }], [{ with: 'ghost-module', reason: 'r' }]); // with 悬空
  const good = mk([{ with: 'b', reason: '工作流两面，书面接受' }]);
  try {
    const r1 = zbase(['catalog', 'lint', '--json'], { cwd: bad });
    assert.equal(r1.code, 3, '缺 reason 必须 FINDINGS');
    assert.ok(JSON.stringify(r1.json.errors).includes('BAD_COCHANGE_ACCEPTED'));
    const r2 = zbase(['catalog', 'lint', '--json'], { cwd: ghost });
    assert.equal(r2.code, 3);
    assert.ok(JSON.stringify(r2.json.errors).includes('DANGLING_COCHANGE_REF'), '悬空接受（对不存在的模块消音）必须点名');
    assert.equal(zbase(['catalog', 'lint', '--json'], { cwd: good }).code, 0, '带 with+reason 的合法接受不拦');
  } finally { rmDir(bad); rmDir(ghost); rmDir(good); }
});

// ---------- ③ catalog init 草案生成器 ----------

/** 无 .zcode 的干净沙箱仓：顶级 alpha→beta 相对 import（裸扩展名形态）+ beta 内部同模块 import + 根级散文件。 */
function mkInitProj() {
  const dir = tempDir('b3init');
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'beta'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'alpha', 'mod.mjs'), "import { x } from '../beta/lib.mjs';\nexport const y = x;\n");
  fs.writeFileSync(path.join(dir, 'beta', 'lib.mjs'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'beta', 'app.mjs'), "import { x } from './lib.mjs';\nexport const z = x;\n");
  fs.writeFileSync(path.join(dir, 'README.md'), '# sandbox\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const catalogFile = (dir) => path.join(dir, '.zcode', 'harness', 'module-catalog.json');

test('B3-8 catalog init dry-run：草案含 referenceEdges/needsDecision；三条不猜（deps 恒空、无 attributes、riskTier low 占位）', () => {
  const dir = mkInitProj();
  try {
    const r = zbase(['catalog', 'init', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `dry-run 只读不落盘，rc 0\nstdout: ${r.stdout.slice(0, 400)}\nstderr: ${r.stderr}`);
    const j = r.json;
    assert.equal(j.ok, true);
    assert.equal(j.dryRun, true);
    assert.equal(j.modules.length ?? j.modules, 3, 'alpha + beta + root-files');
    // referenceEdges：真实 import 边进参考边（alpha→beta）；beta 内部 import 同模块不构成边
    const edge = j.referenceEdges.find((e) => e.from === 'alpha' && e.to === 'beta');
    assert.ok(edge, "referenceEdges 必须含 alpha→beta（'../beta/lib.mjs' 裸扩展名解析）");
    assert.equal(j.referenceEdges.filter((e) => e.from === 'beta' && e.to === 'beta').length, 0);
    // 拓扑分层：beta 不依赖 → tier-0；alpha 依赖 beta → tier-1；数组高层在前（前可依赖后）
    assert.deepEqual(j.layers, ['tier-1', 'tier-0']);
    const alpha = j.draft.modules.find((m) => m.name === 'alpha');
    assert.equal(alpha.layer, 'tier-1');
    assert.deepEqual(alpha.deps, [], 'deps 恒空——referenceEdges 供人采纳，不写进声明图');
    assert.ok(!('attributes' in alpha), 'attributes 刻意不生成（留空让人定档）');
    assert.equal(alpha.riskTier, 'low', 'riskTier low 占位');
    // needsDecision：逐项 why（读不出的理由）+ 逐模块 open 清单
    for (const f of ['riskTier', 'attributes', 'forbiddenDeps', 'deps']) assert.ok(j.needsDecision.why[f], `needsDecision.why.${f} 必须在场`);
    assert.ok(j.needsDecision.modules.some((m) => m.module === 'alpha' && m.observedOutEdges === 1));
    assert.ok(!fs.existsSync(catalogFile(dir)), 'dry-run 不得写盘');
  } finally { rmDir(dir); }
});

test('B3-9 --apply 写盘后 catalog lint rc 0（开箱即用硬保证）；已有 catalog 拒绝覆盖，--force 才放行', () => {
  const dir = mkInitProj();
  try {
    const r = zbase(['catalog', 'init', '--apply', '--json'], { cwd: dir });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.json.written, true);
    assert.ok(fs.existsSync(catalogFile(dir)));
    assert.equal(zbase(['catalog', 'lint', '--json'], { cwd: dir }).code, 0, '草案自跑 lint 必须 rc 0');
    // 已有 catalog：拒绝覆盖（不含 --force）
    const again = zbase(['catalog', 'init', '--json'], { cwd: dir });
    assert.equal(again.code, 1);
    assert.match(again.json.reason, /已存在/);
    assert.ok(!again.json.draft, '拒绝时不产出草案');
    const forced = zbase(['catalog', 'init', '--force', '--apply', '--json'], { cwd: dir });
    assert.equal(forced.code, 0, '--force 放行重新生成');
    assert.equal(zbase(['catalog', 'lint', '--json'], { cwd: dir }).code, 0, 'force 重生成后仍须 lint-clean');
  } finally { rmDir(dir); }
});

test('B3-10 本仓（已有 catalog）：catalog init 必须拒绝', () => {
  const r = zbase(['catalog', 'init']); // cwd=REPO：真实仓只读
  assert.equal(r.code, 1);
  assert.match(r.stdout, /已存在/);
  assert.match(r.stdout, /--force/);
});
