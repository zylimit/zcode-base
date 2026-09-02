// R4-FIX2 red-locks 测试：verifyLedger evidence 钉缺 supersede 语义（后写覆盖先写）。
//
// 缺陷（本仓实况）：.zcode/lib/quality.mjs verifyLedger() 对**每条**历史回执的
// content.evidence[].sha256 钉都按当前盘面复哈希——文件缺失报 EVIDENCE_MISSING、
// 当前 sha ≠ 钉 sha 报 EVIDENCE_TAMPERED。可变源文件一旦被钉即时间炸弹：
// receipt seq 72 钉了 tests/r3b.test.mjs 当时 sha，测试文件随后合法追加 →
// `receipt verify` 报 EVIDENCE_TAMPERED(seq 72) → 全量测试 8.4 红。
//
// 对照设计：同文件 latestReceipts() 已是「后到覆盖先到」（byCheck Map 后写覆盖）；
// supersede 是把同一哲学补到 evidence 钉复验。
//
// 修复契约（本组测试锁它）：同一路径只按最新（最高 seq）钉它的回执复验：
//   T6a 路径 P 在 seq A 钉 sha X，文件合法演进后 seq B(A<B) 再钉 sha Y=当前盘面
//       → verify ok:true，seq A 旧钉不再报 TAMPERED。
//   T6b 演进后无新钉 → 恰一个 EVIDENCE_TAMPERED，seq=最新钉它的那条（非旧钉）。
//   T6c 缺失同理 → 恰一个 EVIDENCE_MISSING，seq=最新钉它的那条；旧回执不重复报。
//   T6d 钉不同路径的回执互不影响；无钉回执不产生 issue。
//
// 全部用临时仓自建账本（mkproj 清 .zcode/state），不触碰本仓真实账本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ZCODE_SRC = path.join(REPO, '.zcode');

function mkproj() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-r4fix2-'));
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(ZCODE_SRC, path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true });
  try { execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* 非 git 也能跑 */ } // zbase-fitness:ignore empty-catch
  return dir;
}

function run(cwd, args) {
  return spawnSync('node', [path.join('.zcode', 'zbase.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 120000 });
}

/** 在 dir/rel 写文件并 receipt write 钉它，返回该回执 seq。 */
function pin(dir, rel, check, content) {
  if (content !== undefined) fs.writeFileSync(path.join(dir, ...rel.split('/')), content);
  const w = run(dir, ['receipt', 'write', '--check', check, '--status', 'PASS', '--evidence', rel, '--json']);
  assert.equal(w.status, 0, `receipt write(${check}) 失败: ${w.stdout}${w.stderr}`);
  return JSON.parse(w.stdout).seq;
}

function verify(dir) {
  const v = run(dir, ['receipt', 'verify', '--json']);
  let vo = null;
  try { vo = JSON.parse(v.stdout); } catch { /* 输出非 JSON 本身就是失败，交给断言报 */ }
  return { code: v.status, vo, raw: v.stdout + v.stderr };
}

// ---------- T6a：supersede 生效（同路径最新钉覆盖旧钉） ----------

test('T6a evidence 钉 supersede：seq1 钉 F → F 合法演进 → seq2(不同 check) 再钉 F=当前盘面 → verify ok:true、issues 空', () => {
  const dir = mkproj();
  try {
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    const s1 = pin(dir, 'notes/a.txt', 'c-old', 'v1\n');
    assert.equal(s1, 1, `首钉应为 seq 1，实际 ${s1}`);
    const s2 = pin(dir, 'notes/a.txt', 'c-new', 'v2 合法演进\n'); // 文件演进后由更高 seq 再钉
    assert.equal(s2, 2, `再钉应为 seq 2，实际 ${s2}`);
    const { code, vo, raw } = verify(dir);
    assert.equal(code, 0, `演进后再钉同路径必须 verify exit 0（旧钉被 supersede），实际 exit ${code}：${raw}`);
    assert.equal(vo.ok, true, `ok 必须为 true，实际 issues=${JSON.stringify(vo.issues)}`);
    assert.deepEqual(vo.issues, [], `issues 必须为空，实际 ${JSON.stringify(vo.issues)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- T6b：演进后无新钉 → 最新钉担责（恰一条，seq=最新） ----------

test('T6b 演进后无再钉 → 恰一条 EVIDENCE_TAMPERED 且 seq=最新钉(2)，旧钉(1)不重复报', () => {
  const dir = mkproj();
  try {
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    pin(dir, 'notes/a.txt', 'c1', 'v1\n');
    pin(dir, 'notes/a.txt', 'c2', 'v2\n');
    fs.writeFileSync(path.join(dir, 'notes', 'a.txt'), 'v3 无新钉\n'); // 演进后再无 seq3 钉
    const { code, vo, raw } = verify(dir);
    assert.equal(code, 4, `未再钉的演进必须 exit 4，实际 ${code}：${raw}`);
    assert.equal(vo.ok, false);
    assert.equal(vo.issues.length, 1, `issues 必须恰一条（最新钉担责），实际 ${JSON.stringify(vo.issues)}`);
    assert.equal(vo.issues[0].code, 'EVIDENCE_TAMPERED', `code 必须 EVIDENCE_TAMPERED，实际 ${vo.issues[0].code}`);
    assert.equal(vo.issues[0].seq, 2, `seq 必须是最新钉它的回执(2)，实际 ${vo.issues[0].seq}`);
    assert.equal(vo.issues[0].path, 'notes/a.txt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- T6c：缺失 → 最新钉担责（恰一条 EVIDENCE_MISSING，seq=最新） ----------

test('T6c 删除文件 → 恰一条 EVIDENCE_MISSING 且 seq=最新钉(2)，旧回执不重复报', () => {
  const dir = mkproj();
  try {
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    pin(dir, 'notes/a.txt', 'c1', 'v1\n');
    pin(dir, 'notes/a.txt', 'c2', 'v2\n');
    fs.rmSync(path.join(dir, 'notes', 'a.txt')); // 最新钉的回执在场而文件被删
    const { code, vo, raw } = verify(dir);
    assert.equal(code, 4, `文件缺失必须 exit 4，实际 ${code}：${raw}`);
    assert.equal(vo.ok, false);
    assert.equal(vo.issues.length, 1, `issues 必须恰一条，实际 ${JSON.stringify(vo.issues)}`);
    assert.equal(vo.issues[0].code, 'EVIDENCE_MISSING', `code 必须 EVIDENCE_MISSING，实际 ${vo.issues[0].code}`);
    assert.equal(vo.issues[0].seq, 2, `seq 必须是最新钉它的回执(2)，实际 ${vo.issues[0].seq}`);
    assert.equal(vo.issues[0].path, 'notes/a.txt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- T6d：不同路径互不影响 + 无钉回执不产生 issue ----------

test('T6d 跨路径隔离：a 有新钉免责、b 无新钉担责（恰一条 TAMPERED@b,seq=2）；无钉回执(seq3)零 issue', () => {
  const dir = mkproj();
  try {
    fs.mkdirSync(path.join(dir, 'notes'), { recursive: true });
    const s1 = pin(dir, 'notes/a.txt', 'c-a1', 'a-v1\n');
    const s2 = pin(dir, 'notes/b.txt', 'c-b1', 'b-v1\n');
    // 无钉回执（不带 --evidence）：不应产生任何 evidence issue
    const w3 = run(dir, ['receipt', 'write', '--check', 'c-plain', '--status', 'PASS', '--json']);
    assert.equal(w3.status, 0, w3.stderr);
    const s3 = JSON.parse(w3.stdout).seq;
    assert.equal(s3, 3, `无钉回执应为 seq 3，实际 ${s3}`);
    pin(dir, 'notes/a.txt', 'c-a2', 'a-v2\n'); // seq4：a 演进后再钉 → a 免责
    fs.writeFileSync(path.join(dir, 'notes', 'b.txt'), 'b-v2 无新钉\n'); // b 演进后无再钉 → b 的最新钉(seq2)担责
    const { code, vo, raw } = verify(dir);
    assert.equal(code, 4, `b 未再钉必须 exit 4，实际 ${code}：${raw}`);
    assert.equal(vo.ok, false);
    assert.equal(vo.issues.length, 1, `只 b 担责：issues 必须恰一条，实际 ${JSON.stringify(vo.issues)}`);
    assert.equal(vo.issues[0].code, 'EVIDENCE_TAMPERED');
    assert.equal(vo.issues[0].path, 'notes/b.txt', `担责路径必须是 b，实际 ${vo.issues[0].path}`);
    assert.equal(vo.issues[0].seq, s2, `b 的担责 seq 必须是其最新钉(2)，实际 ${vo.issues[0].seq}`);
    assert.ok(!vo.issues.some((i) => i.seq === s1), `a 的旧钉(seq ${s1})已被 supersede，不得报 issue`);
    assert.ok(!vo.issues.some((i) => i.seq === s3), `无钉回执(seq ${s3})不得产生 issue`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
