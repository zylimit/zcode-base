// 重构批次 4 测试（源 cc 1fd76a5/cbfa004/0912ac8/9291705 模式）：
// rules-audit phantom 类（幽灵 verb/幽灵路径，唯一 error exit 1）+ 粗体 M 判据 + [P] 标记；
// dod rules-audit 接线（phantom 阻断）；agents-lint 判定升级（空节 error/中英标题同认/
// fence 内标题不计/一 heading 一 credit/高档缺段 error 低档宽松）；initSkeleton 死代码删除锁。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import url from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ZCODE_SRC = path.join(REPO_ROOT, '.zcode');

function mkproj({ catalog, matrix } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-b4-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true }); // 运行态不随测试项目拷贝
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* git 可能缺失 */ }
  return dir;
}

function run(cwd, args) {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 120000 });
}

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

function rmProj(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* 尽力清理；OS 终会回收 */ }
}

const jsonOf = (r) => JSON.parse(r.stdout);

// ---------- B4-1：rules-audit phantom（幽灵 verb）唯一 error exit 1 ----------

test('B4-1 phantom 幽灵 verb：`zbase <word>` / `node .zcode/zbase.mjs <word>` 不在派生面 → exit 1（非 3）', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# t',
    '',
    '日常跑 `zbase frobnicate` 与 `node .zcode/zbase.mjs not-a-verb` 即可。',
  ].join('\n'));
  const r = run(dir, ['rules-audit', '--json']);
  assert.equal(r.status, 1, r.stdout + r.stderr); // phantom 是唯一 error 级（区别于 unenforced 的 exit 3）
  const j = jsonOf(r);
  assert.equal(j.counts.phantom, 2);
  assert.deepEqual(j.phantoms.map((p) => p.kind), ['ghost-verb', 'ghost-verb']);
  assert.deepEqual(j.phantoms.map((p) => p.ref).sort(), ['frobnicate', 'not-a-verb']);
  assert.equal(j.findings[0].code, 'PHANTOM_ENFORCEMENT');
  assert.equal(j.ok, false);
  rmProj(dir);
});

test('B4-1 phantom 防误报：裸词/实存 verb/围栏内引用/运行态路径不触发', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# t',
    '',
    '裸词 `frobnicate` 不主张自己是 CLI verb；`zbase selftest` 实存；`zbase-core` 是 skill 名非调用形。',
    '证据落 `.zcode/state/evidence/`（运行态：mkproj 已删 state 目录，CI 干净检出同态——存在性非声明真实性）。',
    '',
    '```',
    '围栏内 `zbase fenced-ghost` 不算（代码示例不是执法声明）。',
    '```',
  ].join('\n'));
  const r = run(dir, ['rules-audit', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(jsonOf(r).counts.phantom, 0);
  rmProj(dir);
});

// ---------- B4-2：rules-audit phantom（幽灵路径）+ 用户级路径豁免 ----------

test('B4-2 phantom 幽灵路径：`.zcode/` 可执行形引用不存在 → exit 1；~/ 用户级路径与实存路径豁免', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# t',
    '',
    '引擎在 `node .zcode/no-such.mjs`，脚本 `sh .zcode/scripts/ghost.sh --x`；用户级 `~/.zcode/cli/config.json` 不检；实存 `.zcode/zbase.mjs` 不报。',
  ].join('\n'));
  const r = run(dir, ['rules-audit', '--json']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const j = jsonOf(r);
  assert.equal(j.counts.phantom, 2);
  assert.deepEqual(j.phantoms.map((p) => p.ref).sort(), ['.zcode/no-such.mjs', '.zcode/scripts/ghost.sh']);
  assert.ok(j.phantoms.every((p) => p.kind === 'ghost-path'));
  rmProj(dir);
});

// ---------- B4-3：粗体 M 判据 + [P] 标记 ----------

test('B4-3 粗体 M 判据：行首 `- **<token>**:` 命中执法面（verb/实存路径）计 enforced；[P] 计 declared', () => {
  const dir = mkproj();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
    '# t',
    '',
    '- **selftest**：每次会话自检，不靠自觉而是靠命令本身说话，无反引号引用。',
    '- **.zcode/rules/workflow.md**：全流程细则文件，按触加载优于常驻全文记忆。',
    '- **态度直接**：与用户沟通保持直接坦率不迎合。[P]',
  ].join('\n'));
  const r = run(dir, ['rules-audit', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = jsonOf(r);
  assert.equal(j.counts.total, 3);
  assert.equal(j.counts.enforced, 2, `粗体 M 应 credit 两行：${JSON.stringify(j.rows)}`);
  assert.equal(j.counts.declaredUnenforced, 1);
  assert.equal(j.counts.unenforced, 0);
  rmProj(dir);
});

// ---------- B4-4：dod rules-audit 接线（phantom 阻断） ----------

// 全绿项目配方（对齐 r4d GREEN_CATALOG：catalog 归类全部 tracked 路径 + 空 matrix）
const GREEN_CATALOG = {
  version: 1,
  modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low', security: 'none', safety: 'none', privacy: 'none', resilience: 'none' }, attributeReasons: { security: '测试仓无可执行面', safety: '纯软件工具不伤人', privacy: '不含个人数据', resilience: '测试夹具' }, reason: '测试仓' }],
  global: ['.zcode/**', '*.md', '*.json'],
  ignored: ['.git/**'],
};
function mkgreenproj(agentsText) {
  const dir = mkproj({ catalog: GREEN_CATALOG, matrix: { version: 1, checks: [] } });
  for (const d of [path.join('.zcode', 'rules'), path.join('.zcode', 'docs', 'adr'), path.join('.zcode', 'skills'), path.join('.zcode', 'commands', 'zbase')]) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), agentsText);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('B4-4 dod 接线：rules-audit 步阻断化——phantom>0 → FAIL exit 2；phantom=0 → ok 且如实报 ratio', () => {
  const dirty = mkgreenproj('# t\n\n日常跑 `zbase frobnicate`。\n');
  const r = run(dirty, ['dod', '--json']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const j = jsonOf(r);
  assert.ok(j.blockingFailed.includes('rules-audit'), `rules-audit 须在阻断失败列：${JSON.stringify(j.blockingFailed)}`);
  const step = j.steps.find((s) => s.id === 'rules-audit');
  assert.equal(step.blocking, true, '批次 4 起 rules-audit 是阻断步');
  assert.equal(step.ok, false);
  assert.match(step.detail, /phantom 1/);
  assert.match(step.detail, /frobnicate/);
  rmProj(dirty);

  const clean = mkgreenproj('# t\n');
  const r2 = run(clean, ['dod', '--json']);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const j2 = jsonOf(r2);
  const step2 = j2.steps.find((s) => s.id === 'rules-audit');
  assert.equal(step2.ok, true);
  assert.match(step2.detail, /phantom 0/);
  assert.match(step2.detail, /不阻断/); // unenforced 不阻断语义保留（覆盖率可视化非闸）
  rmProj(clean);
});

// ---------- B4-5：agents-lint 判定升级 ----------

const HI_LO_CATALOG = {
  version: 1,
  modules: [
    { name: 'hi', globs: ['src/hi/**'], riskTier: 'high', deps: [] },
    { name: 'lo', globs: ['src/lo/**'], riskTier: 'low', deps: [] },
  ],
};

test('B4-5 空节判定：标题在场正文空 → EMPTY_SECTION error（空壳过等于没契约）', () => {
  const dir = mkproj({ catalog: HI_LO_CATALOG });
  fs.mkdirSync(path.join(dir, 'src', 'hi'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), [
    '# hi',
    '',
    '## Purpose 用途',
    '',
    '## Boundaries 边界',
    '',
    '- x',
    '',
    '## Invariants 不变量',
    '',
    '- x',
    '',
    '## Verification 验证',
    '',
    '- x',
  ].join('\n'));
  const r = run(dir, ['agents-lint', '--json']);
  assert.equal(r.status, 3, r.stdout);
  const e = jsonOf(r).errors.find((x) => x.code === 'MODULE_AGENTS_EMPTY_SECTION');
  assert.ok(e, `缺 EMPTY_SECTION：${r.stdout}`);
  assert.deepEqual(e.empty, ['Purpose']);
  rmProj(dir);
});

test('B4-5 中英标题同认：纯中文四段（用途/边界/不变量/验证）→ 无缺段', () => {
  const dir = mkproj({ catalog: HI_LO_CATALOG });
  fs.mkdirSync(path.join(dir, 'src', 'hi'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), [
    '# hi',
    '',
    '## 用途',
    '',
    '- 引擎本体',
    '',
    '## 边界',
    '',
    '- 只动本目录',
    '',
    '## 不变量',
    '',
    '- 零依赖',
    '',
    '## 验证',
    '',
    '- npm test',
  ].join('\n'));
  const r = run(dir, ['agents-lint', '--json']);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(jsonOf(r).errors.length, 0);
  rmProj(dir);
});

test('B4-5 fence 内标题不计：代码块里的 Verification 标题不 credit 段', () => {
  const dir = mkproj({ catalog: HI_LO_CATALOG });
  fs.mkdirSync(path.join(dir, 'src', 'hi'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), [
    '# hi',
    '',
    '## Purpose 用途',
    '',
    '- x',
    '',
    '## Boundaries 边界',
    '',
    '- x',
    '',
    '## Invariants 不变量',
    '',
    '- x',
    '',
    '```markdown',
    '## Verification 验证',
    '',
    '（这只是骨架示例，不是本契约的段）',
    '```',
  ].join('\n'));
  const r = run(dir, ['agents-lint', '--json']);
  assert.equal(r.status, 3, r.stdout);
  const e = jsonOf(r).errors.find((x) => x.code === 'MODULE_AGENTS_INCOMPLETE');
  assert.ok(e, `围栏内标题应不计段：${r.stdout}`);
  assert.deepEqual(e.missing, ['Verification']);
  rmProj(dir);
});

test('B4-5 一 heading 只 credit 一节：`Purpose 与 Boundaries` 双词标题不双计', () => {
  const dir = mkproj({ catalog: HI_LO_CATALOG });
  fs.mkdirSync(path.join(dir, 'src', 'hi'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), [
    '# hi',
    '',
    '## Purpose 与 Boundaries',
    '',
    '- x',
    '',
    '## Invariants 不变量',
    '',
    '- x',
    '',
    '## Verification 验证',
    '',
    '- x',
  ].join('\n'));
  const r = run(dir, ['agents-lint', '--json']);
  assert.equal(r.status, 3, r.stdout);
  const e = jsonOf(r).errors.find((x) => x.code === 'MODULE_AGENTS_INCOMPLETE');
  assert.ok(e, `同标题双计应被防：${r.stdout}`);
  assert.deepEqual(e.missing, ['Boundaries']); // 只 credit 了 Purpose
  rmProj(dir);
});

test('B4-5 低档宽松：low 模块自带残缺契约 → warning 不阻断；高档同契约 → error', () => {
  const dir = mkproj({ catalog: HI_LO_CATALOG });
  const shell = '# lo\n\n## Purpose 用途\n\n- x\n'; // 只有 Purpose 一段
  fs.mkdirSync(path.join(dir, 'src', 'lo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'lo', 'AGENTS.md'), shell);
  const r = run(dir, ['agents-lint', '--json']);
  assert.equal(r.status, 3, 'hi（high）无契约仍 error'); // hi 目录无 AGENTS.md
  const j = jsonOf(r);
  assert.ok(j.warnings.some((w) => w.code === 'MODULE_AGENTS_INCOMPLETE' && w.module === 'lo'), `低档宽松应 warning：${r.stdout}`);
  assert.ok(!j.errors.some((e) => e.module === 'lo'), '低档缺段不得 error');
  // hi 补同款残缺契约 → 高档缺段 error（对照：同契约两档不同判）
  fs.mkdirSync(path.join(dir, 'src', 'hi'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'hi', 'AGENTS.md'), shell);
  const r2 = run(dir, ['agents-lint', '--json']);
  assert.equal(r2.status, 3, r2.stdout);
  assert.ok(jsonOf(r2).errors.some((e) => e.code === 'MODULE_AGENTS_INCOMPLETE' && e.module === 'hi'), '高档同契约必须 error');
  rmProj(dir);
});

// ---------- B4-6：本仓锚点 + 死代码删除锁 ----------

test('B4-6 本仓 rules-audit 实跑锚：phantom=0 恒成立；索引化后 enforced ≥12（棘轮）', () => {
  const r = run(REPO_ROOT, ['rules-audit', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = jsonOf(r);
  assert.equal(j.counts.phantom, 0, `宪法不得引用幽灵执法点：${JSON.stringify(j.phantoms)}`);
  assert.ok(j.counts.total >= 36, `规则行 ≥36，实得 ${j.counts.total}`);
  assert.ok(j.counts.enforced >= 12, `批次 4 索引化后 enforced ≥12（基线 6→13），实得 ${j.counts.enforced}——回退须显式决策`);
  assert.ok(j.counts.declaredUnenforced >= 4, `[P] 自认标记应 ≥4，实得 ${j.counts.declaredUnenforced}`);
});

test('B4-6 initSkeleton 死代码删除锁：graph.mjs 不再导出（cataloginit 接管）', async () => {
  const graph = await import('../.zcode/lib/graph.mjs');
  assert.equal(typeof graph.initSkeleton, 'undefined', '批次 4 已删除零调用方死代码，不得回潮');
  assert.equal(typeof graph.agentsLint, 'function');
});
