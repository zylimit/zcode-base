// 批次 14（E1 五件，2026-09-08，七仓快扫五候选落地）：
// ① E1-2 evidence-mode：committed 未跟踪 FAIL / 提交后 PASS / local 不查 / 非法档位 FAIL（doctor 检查项）；
// ② E1-3 planned 生命周期：planned 缺规范词仍 error（不豁免 lint）/ 覆盖分母排除（2 REQ 1 implemented
//    1 planned → 按 1 算）/ code·tests 引用 planned → warning 不 fail / 窗口不吞邻条（14 行窗口交互）；
// ③ E1-4 release-provenance：真包 entryCount=包条目数-1 / 逐文件哈希复算 / packageSha256 内容指纹可复算 /
//    gitCommit=HEAD；--dry-run 零写且预告附档；
// ④ E1-5/E1-1 锚点：skill-builder 改版验收对 + evolution-engine ④ 层验收对句 + release-builder 部署面核对 +
//    catalog installer→lib-* 禁边声明（E1-1 静态测试在 tests/independence.test.mjs 独立承担）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkHarnessProj, rmDir, zbase, REPO } from './helpers.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'ignore' });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ══════════════════ ① E1-2 evidence-mode（doctor 检查项） ══════════════════

const doctorCheck = (dir, id) => {
  const r = zbase(['doctor', '--json'], { cwd: dir });
  const parsed = r.json ?? JSON.parse(r.stdout);
  const hit = (parsed.checks || []).find((c) => c.id === id);
  assert.ok(hit, `doctor 须含 ${id} 检查项（实际：${(parsed.checks || []).map((c) => c.id).join(',')}）`);
  return hit;
};

const setEvidence = (dir, mode) => {
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify({ evidence: { mode } }));
};

test('B14-E1 evidence local（默认）：不查 git 跟踪，PASS 说明现状', () => {
  const dir = mkHarnessProj();
  try {
    setEvidence(dir, 'local');
    const c = doctorCheck(dir, 'evidence-mode');
    assert.equal(c.ok, true);
    assert.match(c.detail, /local（默认）/);
    // 不写 evidence 键 = 默认 local（DEFAULTS 缺席时 doctor 兜底 'local'，不虚声明 committed）
    fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'harness.json'), JSON.stringify({}));
    const c2 = doctorCheck(dir, 'evidence-mode');
    assert.equal(c2.ok, true, `缺省键须按 local 处理：${c2.detail}`);
  } finally { rmDir(dir); }
});

test('B14-E2 evidence committed：账本未入 git → FAIL 点名指引；git add -f 后 PASS', () => {
  const dir = mkHarnessProj();
  try {
    setEvidence(dir, 'committed');
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    // 空账本即可（本用例只验 evidence-mode 检查项的跟踪判定，不验链）；
    // 刻意不写裸 '{"seq":1}'——无 content 的行会触发既有 verifyLedger 崩溃（quality.mjs 面，不在本批修）
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'ledger.jsonl'), '');
    const c = doctorCheck(dir, 'evidence-mode');
    assert.equal(c.ok, false, '声明 committed 但账本未入 git 必须可见');
    assert.match(c.detail, /committed 模式声明了但账本未入 git/);
    assert.match(c.detail, /OPERATIONS/);
    // 提交账本（-f：.zcode/.gitignore 的 state/ 规则在场——正是 OPERATIONS 指引要放行的面）
    git(dir, 'add', '-f', '.zcode/state/ledger.jsonl');
    git(dir, 'commit', '-q', '-m', 'evidence: committed');
    const c2 = doctorCheck(dir, 'evidence-mode');
    assert.equal(c2.ok, true, `跟踪后须 PASS：${c2.detail}`);
    assert.match(c2.detail, /committed：账本已被 git 跟踪/);
  } finally { rmDir(dir); }
});

test('B14-E3 evidence 非法档位值 → FAIL（fail-visible 不默认放过）', () => {
  const dir = mkHarnessProj();
  try {
    setEvidence(dir, 'banana');
    const c = doctorCheck(dir, 'evidence-mode');
    assert.equal(c.ok, false);
    assert.match(c.detail, /非法（local\|committed）/);
  } finally { rmDir(dir); }
});

// ══════════════════ ② E1-3 planned 生命周期（spec-lint/trace） ══════════════════
// fixture 需求 id 占位拼装（r5a 先例）：本仓实扫 trace 会扫 tests 源文本，连续完整形态会成悬空引用。
const unmask = (s) => s.replace(/(REQ|NFR)@/g, '$1-');
const writeSpec = (dir, text) => {
  const BIZ = '\n## 业务上下文\n\nfixture：B1 起根级 Spec 须含本章节。\n';
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), unmask(text) + BIZ);
};
const jsonOf = (r) => r.json ?? JSON.parse(r.stdout);

test('B14-P1 planned 缺规范词仍 NOT_NORMATIVE error（planned 不是质量折扣）+ counts.planned 对账', () => {
  const dir = mkHarnessProj();
  try {
    writeSpec(dir, [
      '# S', '',
      '- REQ@201（状态: planned）：支持导出，导出为 CSV；验收：CSV 行数匹配。', '',
    ].join('\n'));
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, 3, 'planned 需求缺规范词必须仍 error：');
    const res = jsonOf(r);
    assert.ok(res.findings.some((f) => f.code === 'NOT_NORMATIVE' && f.severity === 'error'), '可判定性检查不豁免');
    assert.equal(res.counts.planned, 1, 'counts.planned 单列计数');
    assert.equal(res.counts.requirements, 1, 'planned 计入全量 requirements');
    assert.equal(res.ids[0].planned, true, 'ids 条目带 planned 标记');
  } finally { rmDir(dir); }
});

test('B14-P2 覆盖分母排除：2 REQ（1 implemented+tested / 1 planned 未测）→ coverage 按 1 算 = 1.0', () => {
  const dir = mkHarnessProj();
  try {
    writeSpec(dir, [
      '# S', '',
      '- REQ@202：当提交时必须记录审计日志；验收：审计表有行。', '',
      '- REQ@203（状态：planned (P2)）：当归档时必须保留指针；验收：指针可解析。', '',
    ].join('\n'));
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), unmask('// 覆盖 REQ@202\n'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'impl.js'), unmask('// 实现 REQ@202\n'));
    git(dir, 'add', '.'); // listPaths 只见已跟踪路径（r5a trace 用例同款前置）
    const r = zbase(['trace', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `planned 未验证不得压覆盖率：${r.stdout}${r.stderr}`);
    const res = jsonOf(r);
    assert.equal(res.coverage, 1, `分母排除 planned 后 coverage=1（实际 ${res.coverage}）`);
    assert.equal(res.total, 2, 'total 仍计全量');
    assert.equal(res.plannedExcluded, 1, '排除计数可见（不是消失）');
    assert.deepEqual(res.planned, [unmask('REQ@203')]);
    assert.ok(!res.unverified.includes(unmask('REQ@203')), 'planned 不进 unverified 清单');
    assert.match(res.advice, /planned 1 条已排除覆盖分母/);
  } finally { rmDir(dir); }
});

test('B14-P3 tests/code 引用 planned → warning 不 fail（测试先行合法，转 done 前摘标记）', () => {
  const dir = mkHarnessProj();
  try {
    writeSpec(dir, [
      '# S', '',
      '- REQ@204（状态: planned）：当导出时必须写出全部字段；验收：CSV 行数匹配。', '',
    ].join('\n'));
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests', 'red.test.mjs'), unmask('// red-locks REQ@204\n'));
    git(dir, 'add', '.');
    const r = zbase(['trace', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `planned 引用是 warning 不是 error：${r.stdout}${r.stderr}`);
    const res = jsonOf(r);
    assert.ok(res.plannedRefs.some((p) => p.id === unmask('REQ@204') && p.file === 'tests/red.test.mjs'), '引用须点名 id+file');
    assert.match(res.advice, /引用了未实现需求（planned）/);
    assert.match(res.advice, /不得转 done/);
    assert.equal(res.ok, true);
  } finally { rmDir(dir); }
});

test('B14-P4 planned 窗口不吞邻条：邻条的「状态: planned」不污染前一条判定（14 行窗口交互）', () => {
  const dir = mkHarnessProj();
  try {
    writeSpec(dir, [
      '# S', '',
      '- REQ@205：当提交时必须记录审计日志；验收：审计表有行。', '',
      '- REQ@206（状态: planned）：当归档时必须保留指针；验收：指针可解析。', '',
    ].join('\n'));
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `对照组合须绿：${r.stdout}${r.stderr}`);
    const res = jsonOf(r);
    const a = res.ids.find((x) => x.id === unmask('REQ@205'));
    const b = res.ids.find((x) => x.id === unmask('REQ@206'));
    assert.equal(a.planned, undefined, '前一条（14 行窗口内含邻条 planned 行）不得被误判 planned');
    assert.equal(b.planned, true, '标记在自己判定块内才算自己的');
  } finally { rmDir(dir); }
});

// ══════════════════ ③ E1-4 release-provenance ══════════════════

function mkrelrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-b14rel-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const mkrelease = (cwd, args) =>
  spawnSync('sh', [path.join(REPO, '.zcode', 'scripts', 'make-release.sh'), ...args], { cwd, encoding: 'utf8', timeout: 60000 });

const WIN = process.platform === 'win32';
// lesson-1.md 是**真文件**（最小合法条目形态：frontmatter 三键 + 正文）——review P3-3：
// 原断言「包内无 lesson-1」对只被 INDEX 引用而磁盘不存在的文件恒真（防不了剥离回退），
// 真文件在场才能构成剥离面的真回归锁。
const REL_FILES = {
  'AGENTS.md': '# demo\n',
  '.zcode/feedback/FEEDBACK-INDEX.md': '# FEEDBACK-INDEX\n| 私人条目 |\n|---|\n| lesson-1 |\n',
  '.zcode/feedback/lesson-1.md': '---\nid: lesson-1\noccurrences: 1\ngraduated: false\n---\n\n# 私人教训（不应随包分发）\n',
  '.zcode/lib/a.mjs': 'export const x = 1;\n',
};

test('B14-R1 provenance 附入包内：entryCount=包条目数-1、逐文件哈希与内容指纹可复算、gitCommit=HEAD', () => {
  const dir = mkrelrepo(REL_FILES);
  const out = mkrelease(dir, ['v1.0.0']);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const reported = out.stdout.trim().split('\n').pop();
  // 取证增强（CI macos 34212732976）：stdout 末行须为产物路径——前置守卫把隐含前提显式化。
  // macOS bsdtar 对空文件名 -tzf '' 静默 exit 0（GNU tar 报错 exit 2）：pkg='' 时下方 tar -tzf
  // 会「成功」返回空而非报错，红在 entryCount 断言且取证为空——先在此拦住，失败消息才可读。
  assert.ok(
    /\.(tar\.gz|zip)$/.test(reported),
    `make-release stdout 末行须为产物路径（取证：status=${out.status} stdout=${JSON.stringify(out.stdout)} stderr=${JSON.stringify(out.stderr)}）`,
  );
  const pkg = WIN ? path.join(os.tmpdir(), path.basename(reported)) : reported;
  const base = path.basename(dir);
  try {
    // 列名（平台分支同 r4d 先例：posix tar / win python3 zipfile）
    const names = WIN
      ? execFileSync('python3', ['-c', "import zipfile,sys; print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", pkg], { encoding: 'utf8' }).split(/\r?\n/)
      : execFileSync('tar', ['-tzf', pkg], { encoding: 'utf8' }).split(/\r?\n/);
    const files = names.filter((n) => n && !n.endsWith('/'));
    const provName = `${base}/release-provenance.json`;
    assert.ok(files.includes(provName), `包内须附 release-provenance.json（实际前 5：${files.slice(0, 5).join(' | ')}）`);
    const readEntry = (entry) => (WIN
      ? execFileSync('python3', ['-c', "import zipfile,sys; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", pkg, entry])
      : execFileSync('tar', ['-xzOf', pkg, entry]));
    const prov = JSON.parse(readEntry(provName).toString('utf8'));
    // gitCommit = 打包时 HEAD
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(prov.gitCommit, head, 'gitCommit 须为当前 HEAD（部署面比对的出生地锚）');
    assert.equal(prov.generator, 'make-release.sh');
    assert.equal(prov.gitTag, null, '无 tag 时为 null');
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(prov.generatedAt), 'generatedAt ISO-Z 形态');
    assert.match(prov.packageFile, /v1\.0\.0\.(tar\.gz|zip)$/, 'packageFile 指名产物');
    // entryCount = 包条目数 - 1（provenance 自身自指不入清单）
    assert.equal(prov.entryCount, files.length - 1, `entryCount ${prov.entryCount} ≠ 包文件数-1 ${files.length - 1}`);
    // 逐文件哈希复算：全量条目与解包内容一致
    for (const e of prov.entries) {
      assert.ok(files.includes(e.path), `条目 ${e.path} 须在包内`);
      const content = readEntry(e.path);
      assert.equal(sha256(content), e.sha256, `条目 ${e.path} 哈希不匹配`);
    }
    // packageSha256 = entries 规范串接（path:sha256 LF 连接）的内容指纹——解包可复算
    const canon = prov.entries.map((e) => `${e.path}:${e.sha256}`).join('\n');
    assert.equal(sha256(canon), prov.packageSha256, 'packageSha256 须可从解包树复算');
    // 剥离面不回退：真文件在场（REL_FILES 建了 lesson-1.md），断言它被剥离出包=真回归锁
    // （同时核 entries：provenance 清单只含包内文件——被剥离者同样不得混入 entries）
    assert.ok(!files.some((n) => n.endsWith('.zcode/feedback/lesson-1.md')), '私人经验条目必须被剥离（真文件在场）');
    assert.ok(!prov.entries.some((e) => e.path.endsWith('.zcode/feedback/lesson-1.md')), 'provenance entries 不得含被剥离文件');
  } finally {
    fs.rmSync(pkg, { force: true });
    rmDir(dir);
  }
});

test('B14-R2 make-release --dry-run：零写不变 + 预告将附入 provenance', () => {
  const dir = mkrelrepo(REL_FILES);
  try {
    const out = mkrelease(dir, ['v1.0.0-dry', '--dry-run']);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /--dry-run：零写/);
    assert.match(out.stdout, /将附入: release-provenance\.json/, 'dry-run 须预告附档');
    assert.match(out.stdout, /lesson-1\.md/, '剥离清单须点名真在场的私人条目（P3-3 fixture 加固后可观察）');
    assert.equal(fs.existsSync(path.join(os.tmpdir(), `${path.basename(dir)}-v1.0.0-dry.tar.gz`)), false, 'dry-run 不得写包');
  } finally { rmDir(dir); }
});

// ══════════════════ ④ E1-5/E1-1 锚点（文本面 grep 级） ══════════════════

test('B14-K1 skill 锚点：skill-builder 改版验收对（TDD-for-Skills 红锁 + A/B 盲评）', () => {
  const sb = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'skill-builder', 'SKILL.md'), 'utf8');
  assert.match(sb, /## 改版验收/, 'skill-builder 须有「改版验收」段');
  assert.match(sb, /TDD-for-Skills（红锁，必做）/, 'TDD-for-Skills 红锁必做');
  assert.match(sb, /A\/B 盲评（重大改版用，可选）/, 'A/B 盲评可选档');
  assert.match(sb, /真实失败 prompt/, '红锁须锚定真实失败 prompt（red）');
});

test('B14-K2 evolution-engine ④ 层验收对句 + release-builder 部署面核对（provenance）', () => {
  const ee = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'evolution-engine', 'SKILL.md'), 'utf8');
  assert.match(ee, /验收对（TDD 红锁必做，A\/B 盲评可选/, '④ 层旁须有验收对指引');
  const rb = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'release-builder', 'SKILL.md'), 'utf8');
  assert.match(rb, /## 部署面核对/, 'release-builder 须有部署面核对段');
  assert.match(rb, /release-provenance\.json/, '须比对 provenance 清单');
  assert.match(rb, /gitCommit/, '须先查 git HEAD 与 provenance commit 字段（codewhale 事故形态）');
});

test('B14-K3 catalog 禁边锚：installer → lib 实现模块 forbidden 声明全量在场（与 independence.test 双执法）', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'module-catalog.json'), 'utf8'));
  const LIBS = ['lib-core', 'lib-graph', 'lib-writes', 'lib-quality', 'lib-scan', 'lib-context', 'lib-hooks', 'lib-doctor'];
  for (const to of LIBS) {
    assert.ok(catalog.forbidden.some((f) => f.from === 'installer' && f.to === to), `installer→${to} 禁边缺失`);
  }
  const reason = catalog.forbidden.find((f) => f.from === 'installer' && f.to === 'lib-core').reason;
  assert.match(reason, /kimi ADR-0002/, '禁边理由须锚定 ADR-0002（审计独立性）');
});
