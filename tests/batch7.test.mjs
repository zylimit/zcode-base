// 重构批次 7 测试（源 dsh 300d995 range receipt / 23ac8a4 runbook 模式）：
// ① range receipt——回执绑定发布 commit 范围（receipt write --base <ref>）：
//    tag→commit→落账带 range 三元组（base/head/diffHash）→ 验证绿；HEAD 一动即失效
//    （dsh 语义：valid exactly while HEAD still points at the reviewed commit）；
//    空 range（base==head）拒收（vacuous）；坏 ref 拒收；非 git 仓拒收——拒收一律不落账；
//    旧形态回执（无 range 键）与 range 回执同链共存（canonicalJson 按各自 content 重算，链格式零改动）。
// ② release receipt-fresh 双形态：指纹形态（fingerprint 匹配当前 diff）与 range 形态
//    （HEAD 未动 + diffHash 复算一致）任一新鲜即过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zbase, mkHarnessProj, rmDir } from './helpers.mjs';
import { rangeBinding, receiptBinding } from '../.zcode/lib/quality.mjs';

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
}

// 对齐 batch2 GREEN_CATALOG：release 十二条件可装配（ci-status 无 remote UNKNOWN 与本批次无关）
const GREEN_CATALOG = {
  version: 1, modules: [{ name: 'm', globs: ['src/**'], deps: [], attributes: { reliability: 'low', security: 'none', safety: 'none', privacy: 'none', resilience: 'none' }, attributeReasons: { security: '测试仓无可执行面', safety: '纯软件工具不伤人', privacy: '不含个人数据', resilience: '测试夹具' }, reason: '测试仓' }],
  global: ['.zcode/**', '*.md', '*.json'],
  ignored: ['.git/**'],
};

/** base commit + tag v0 + 第二个 commit（tag..HEAD 即待发布范围）。 */
function mkRangeProj() {
  const dir = mkHarnessProj({ catalog: GREEN_CATALOG, matrix: { version: 1, checks: [] } });
  for (const d of [['.zcode', 'rules'], ['.zcode', 'docs', 'adr'], ['.zcode', 'skills'], ['.zcode', 'commands', 'zbase']]) {
    fs.mkdirSync(path.join(dir, ...d), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'tag', 'v0');
  fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'y\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c1');
  return dir;
}

function ledgerLines(dir) {
  const p = path.join(dir, '.zcode', 'state', 'ledger.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
}

const ledgerLast = (dir) => JSON.parse(ledgerLines(dir).at(-1));
const item = (json, id) => json.items.find((i) => i.id === id);

// ══════════════════ ① range receipt 四场景 + 链兼容 ══════════════════

test('B7-T1 tag→commit→receipt write --base v0：range 三元组落账 + receipt verify 绿 + 旧形态回执同链共存', () => {
  const dir = mkRangeProj();
  try {
    // 先落一条旧形态回执（无 range 键）——新旧同链共存，链校验按各自 content 重算
    assert.equal(zbase(['receipt', 'write', '--check', 'legacy-form', '--status', 'PASS'], { cwd: dir }).code, 0);
    const r = zbase(['receipt', 'write', '--check', 'rel-range', '--status', 'PASS', '--base', 'v0', '--json'], { cwd: dir });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const base = git(dir, 'rev-parse', 'v0^{commit}').trim();
    const entry = ledgerLast(dir);
    assert.equal(entry.content.check, 'rel-range');
    assert.deepEqual(Object.keys(entry.content.range).sort(), ['base', 'diffHash', 'head'], 'range 三元组恰好三键');
    assert.equal(entry.content.range.base, base, 'base=ref 解析出的 commit sha');
    assert.equal(entry.content.range.head, head, 'head=落账时 HEAD');
    assert.match(entry.content.range.diffHash, /^[a-f0-9]{64}$/);
    // diffHash 可独立复算：sha256(git diff base..HEAD)
    const v = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v.code, 0, v.stdout + v.stderr);
    assert.equal(v.json.ok, true, '混合形态链必须完好');
    assert.equal(v.json.total, 2);
    assert.equal(v.json.rangeReceipts, 1);
    assert.equal(v.json.rangeFresh, 1);
  } finally { rmDir(dir); }
});

test('B7-T2 HEAD 再 commit → range 失效（HEAD 一动即失效）；release receipt-fresh 同步 stale；rebind 复绿', () => {
  const dir = mkRangeProj();
  try {
    assert.equal(zbase(['receipt', 'write', '--check', 'rel-range', '--status', 'PASS', '--base', 'v0'], { cwd: dir }).code, 0);
    fs.writeFileSync(path.join(dir, 'src', 'c.ts'), 'z\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'c2');
    const v = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v.code, 0, '链完好——失效是新鲜性问题不是断链');
    assert.equal(v.json.rangeReceipts, 1);
    assert.equal(v.json.rangeFresh, 0, 'HEAD 一动即失效（dsh：valid exactly while HEAD still points at the reviewed commit）');
    // release 的 receipt-fresh 必须看到 stale：树 clean 但指纹随 HEAD 移动而变，range head 已过期
    const rel = zbase(['release', '--json'], { cwd: dir });
    const rf = item(rel.json, 'receipt-fresh');
    assert.equal(rf.ok, false);
    assert.match(rf.detail, /stale/);
    // rebind 到新 HEAD → 复绿
    assert.equal(zbase(['receipt', 'write', '--check', 'rel-range', '--status', 'PASS', '--base', 'v0'], { cwd: dir }).code, 0);
    const v2 = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v2.json.rangeReceipts, 2);
    assert.equal(v2.json.rangeFresh, 1, '后到覆盖先到：新绑定有效');
  } finally { rmDir(dir); }
});

test('B7-T3 空 range（base==head，两种形态）/ 坏 ref / 非 git 仓：一律拒收 exit 1 且不落账', () => {
  const dir = mkRangeProj();
  try {
    const before = ledgerLines(dir).length;
    const h = zbase(['receipt', 'write', '--check', 'x', '--status', 'PASS', '--base', 'HEAD'], { cwd: dir });
    assert.equal(h.code, 1);
    assert.match(h.stderr, /vacuous|空 range/);
    git(dir, 'tag', 'head-tag'); // 指向 HEAD 的 tag：解析成功但 base==head，同样 vacuous
    const t = zbase(['receipt', 'write', '--check', 'x', '--status', 'PASS', '--base', 'head-tag'], { cwd: dir });
    assert.equal(t.code, 1);
    assert.match(t.stderr, /vacuous|空 range/);
    const b = zbase(['receipt', 'write', '--check', 'x', '--status', 'PASS', '--base', 'no-such-ref'], { cwd: dir });
    assert.equal(b.code, 1);
    assert.match(b.stderr, /不可解析/);
    assert.equal(ledgerLines(dir).length, before, '拒收不得落账本');
  } finally { rmDir(dir); }
  const dir2 = mkHarnessProj({ catalog: GREEN_CATALOG, matrix: { version: 1, checks: [] } });
  try {
    fs.rmSync(path.join(dir2, '.git'), { recursive: true, force: true });
    const g = zbase(['receipt', 'write', '--check', 'x', '--status', 'PASS', '--base', 'v0'], { cwd: dir2 });
    assert.equal(g.code, 1);
    assert.match(g.stderr, /git 仓/);
  } finally { rmDir(dir2); }
});

test('B7-T4 rangeBinding/receiptBinding 纯判定：畸形 range 形状 fail-closed 不匹配（不触发 git）', () => {
  assert.equal(rangeBinding(null).matched, false);
  assert.equal(rangeBinding({}).matched, false);
  assert.equal(rangeBinding({ range: { base: 'a', head: 'b' } }).matched, false, '缺 diffHash');
  assert.equal(rangeBinding({ range: { base: 'a', head: 'b', diffHash: 'zz' } }).matched, false, '非 sha256 hex');
  assert.equal(rangeBinding({ range: { base: 1, head: 'b', diffHash: 'a'.repeat(64) } }).matched, false, '非字符串 base');
  // receiptBinding 路由：带 range 键的回执走 range 判定（畸形形状 → 不匹配；不依赖指纹参数）
  assert.deepEqual(receiptBinding('check-x', { range: { base: 'a', head: 'b', diffHash: 'zz' }, fingerprint: 'fp' }, 'fp'),
    { matched: false, binding: null }, 'range 回执不走指纹形态（dsh：HEAD 是唯一时钟）');
});

test('B7-T5 --base 进 SUBCOMMAND_FLAGS 与 usage（白名单假绿防护）', () => {
  const dir = mkRangeProj();
  try {
    const r = zbase(['receipt', 'write', '--check', 'flag-probe', '--status', 'PASS', '--base', 'v0', '--json'], { cwd: dir });
    assert.ok(!r.stderr.includes('未知 flag'), '--base 必须被认识');
    assert.equal(r.code, 0);
  } finally { rmDir(dir); }
  const u = zbase(['bogus-verb']); // 全量 usage 只读面
  assert.equal(u.code, 1);
  assert.match(u.stdout, /receipt write .*--base ref/);
});

// ══════════════════ ② release receipt-fresh 双形态 ══════════════════

test('B7-R1 形态一（指纹）：普通回执 fingerprint 匹配当前 diff → ok（既有行为回归锚）', () => {
  const dir = mkRangeProj();
  try {
    assert.equal(zbase(['receipt', 'write', '--check', 'b7-smoke', '--status', 'PASS'], { cwd: dir }).code, 0);
    const rel = zbase(['release', '--json'], { cwd: dir });
    const rf = item(rel.json, 'receipt-fresh');
    assert.equal(rf.ok, true, rf.detail);
    assert.match(rf.detail, /fingerprint 匹配当前 diff/);
  } finally { rmDir(dir); }
});

test('B7-R2 形态二（range）：指纹过期（工作树脏）但 HEAD 未动 → range 形态独撑 ok，worktree-clean 照旧阻断（语义正交）', () => {
  const dir = mkRangeProj();
  try {
    assert.equal(zbase(['receipt', 'write', '--check', 'rel-range', '--status', 'PASS', '--base', 'v0'], { cwd: dir }).code, 0);
    fs.writeFileSync(path.join(dir, 'src', 'dirty.ts'), 'uncommitted\n'); // 工作树脏 → 指纹形态失效
    const rel = zbase(['release', '--json'], { cwd: dir });
    const rf = item(rel.json, 'receipt-fresh');
    assert.equal(rf.ok, true, `range 形态须独撑 receipt-fresh：${rf.detail}`);
    assert.match(rf.detail, /range 新鲜/);
    assert.equal(item(rel.json, 'worktree-clean').ok, false, '脏树照旧阻断 worktree-clean——两条件语义正交');
  } finally { rmDir(dir); }
});
