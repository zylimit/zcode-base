// Batch 16（CI run 34217996444 两根因回归锁）：
//   1) writes.mjs 输入侧路径归一——macOS 形态：hook 输入绝对路径来自 mkdtemp 的 TMPDIR 字面形
//      （/var/folders/…，/var → /private/var 符号链接），引擎 root 经 cwd/getcwd 是规范形
//      （/private/var/…）。path.resolve(root, 绝对输入) 忽略 root → 跨形态 path.relative 必得 ../..
//      → 旧代码误判 OUTSIDE_REPO（写预检簇 6 用例）。修法：字面越界输入先做最深祖先归一
//      （realpath(D) === realRoot 的最深存在祖先，用规范根重建尾段）。Linux 无符号链接零漂移。
//      本地等价模拟：物理根 realA + 符号链接 linkB → realA；引擎视角 root = realA（Linux getcwd
//      与 macOS 同返物理规范形），hook 输入走 linkB 前缀——逐字节复刻跨形态。
//   2) core.mjs withStateLock 竞争判定扩 EPERM/EBUSY——Windows 强制锁语义下第二进程 open('wx')
//      对持有中锁文件报 EPERM 而非 EEXIST，只认 EEXIST 会把正常竞争误判致命 LOCK_FAILED。
//      Windows 实机不可验（本地 Linux）：EEXIST 竞争路径跑并发冒烟锁定，EPERM/EBUSY 靠代码路径
//      review + 竞争集合常量固化，如实记档。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, mkHarnessProj, rmDir, tempDir, zbase } from './helpers.mjs';

const execFileP = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

const ENVELOPE = { goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a', verification: [{ command: 'node -e 0', expect: 'exit 0' }], business: 'b1', escalation: '交回主 Agent' };

/** macOS 形态沙箱：物理根 realA + 符号链接 linkB → realA。返回 { realA, linkB }（引擎用 realA，输入用 linkB）。 */
function mkCrossFormSandbox() {
  const realA = tempDir('b16real');
  fs.writeFileSync(path.join(realA, 'AGENTS.md'), '# test\n');
  fs.cpSync(path.join(REPO, '.zcode'), path.join(realA, '.zcode'), { recursive: true });
  fs.rmSync(path.join(realA, '.zcode', 'state'), { recursive: true, force: true });
  fs.mkdirSync(path.join(realA, '.zcode', 'harness'), { recursive: true });
  const linkB = path.join(path.dirname(realA), `b16link-${path.basename(realA)}`);
  fs.symlinkSync(realA, linkB, 'dir');
  return { realA, linkB };
}

// ---------- 16.1 输入侧归一：symlink 前缀绝对输入 = 仓内（放行，rel 与 root 基对账一致） ----------

test('16.1 resolveForWrite：symlink 前缀绝对输入（规范根视角）放行且 rel/abs 为规范形', async () => {
  const { resolveForWrite } = await import(pathToFileURL(path.join(REPO, '.zcode', 'lib', 'writes.mjs')).href);
  const { realA, linkB } = mkCrossFormSandbox();
  try {
    fs.mkdirSync(path.join(realA, 'src'), { recursive: true });
    fs.writeFileSync(path.join(realA, 'src', 'shared.ts'), 'v0');
    // 引擎 root = 物理规范形（Linux getcwd / macOS getcwd 同为此形态）
    const root = fs.realpathSync.native(realA);
    // 新文件（尾段不存在——mkdtemp 沙箱里 hook 首写 src/app.ts 的形态）：放行，rel 与 root 基对账一致
    const fresh = resolveForWrite(path.join(linkB, 'src', 'app.ts'), root);
    assert.deepEqual(fresh, { abs: path.join(root, 'src', 'app.ts'), rel: 'src/app.ts' });
    // 已存在文件（knownHashes 比对形态）：同样放行，abs 为规范形
    const existing = resolveForWrite(path.join(linkB, 'src', 'shared.ts'), root);
    assert.deepEqual(existing, { abs: path.join(root, 'src', 'shared.ts'), rel: 'src/shared.ts' });
    // 零漂移锚：规范前缀输入与 symlink 前缀输入返回完全一致（Linux 上无形态差异时逐字节等价）
    assert.deepEqual(resolveForWrite(path.join(root, 'src', 'app.ts'), root), fresh);
  } finally {
    rmDir(realA);
    rmDir(linkB);
  }
});

// ---------- 16.2 跨形态逃逸：symlink 前缀 + 仓内 symlink 指向仓外 → 仍是 SYMLINK_ESCAPE（安全面不降档） ----------

test('16.2 resolveForWrite：symlink 前缀输入的仓内逃逸链仍报 SYMLINK_ESCAPE（不得降为 OUTSIDE_REPO）', async () => {
  const { resolveForWrite } = await import(pathToFileURL(path.join(REPO, '.zcode', 'lib', 'writes.mjs')).href);
  const { realA, linkB } = mkCrossFormSandbox();
  const outside = tempDir('b16out');
  try {
    fs.writeFileSync(path.join(outside, 'victim.txt'), 'outside');
    fs.symlinkSync(outside, path.join(realA, 'linkdir'), 'dir');
    const root = fs.realpathSync.native(realA);
    // 输入前缀跨形态 + 尾段经仓内 symlink 指向仓外：归一只对前缀，逃逸检测仍由游标循环执行
    assert.throws(() => resolveForWrite(path.join(linkB, 'linkdir', 'victim.txt'), root), (e) => e.code === 'SYMLINK_ESCAPE');
    // 真仓外（symlink 前缀指向根外路径）：归一匹配不到仓根 → 保字面 → OUTSIDE_REPO 不误放
    const other = tempDir('b16other');
    try {
      assert.throws(() => resolveForWrite(path.join(other, 'x.txt'), root), (e) => e.code === 'OUTSIDE_REPO');
    } finally { rmDir(other); }
  } finally {
    rmDir(realA);
    rmDir(linkB);
    rmDir(outside);
  }
});

// ---------- 16.3 端到端 hook：cwd=规范形 + file_path=symlink 前缀（macOS CI 形态全链路） ----------

test('16.3 hook pre-tool-use：symlink 前缀 file_path 任务内放行、任务外 TASK_SCOPE（不再误判仓外）', () => {
  const { realA, linkB } = mkCrossFormSandbox();
  try {
    fs.mkdirSync(path.join(realA, 'src'), { recursive: true });
    // 引擎进程 cwd 在物理根 realA（Linux/macOS getcwd 均返回物理形——跨形态由此产生）
    const start = zbase(['task', 'start', '--input', '-', '--owned', 'src/**'], { cwd: realA, input: JSON.stringify(ENVELOPE) });
    assert.equal(start.code, 0, start.stdout + start.stderr);
    // 任务内 symlink 前缀输入：放行（CI #34217996444 原误判「写目标在仓外」）
    const inScope = zbase(['hook', 'pre-tool-use'], { cwd: realA, input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(linkB, 'src', 'app.ts') } }) });
    assert.equal(inScope.code, 0, inScope.stderr);
    // 任务外（symlink 前缀）：TASK_SCOPE——路径已正确归一进 ownedPaths 闸，而非 OUTSIDE_REPO 误拦
    const outScope = zbase(['hook', 'pre-tool-use'], { cwd: realA, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(linkB, 'docs', 'x.md') } }) });
    assert.equal(outScope.code, 2);
    assert.match(outScope.stderr, /TASK_SCOPE/);
    // 真仓外写仍按任务边界拦（OUTSIDE_REPO 语义保留）
    const outsideRepo = zbase(['hook', 'pre-tool-use'], { cwd: realA, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi > /tmp/zbase-b16-probe.txt' } }) });
    assert.equal(outsideRepo.code, 2);
    assert.match(outsideRepo.stderr, /OUTSIDE_REPO|写目标在仓外/);
  } finally {
    rmDir(realA);
    rmDir(linkB);
  }
});

// ---------- 16.4 锁竞争冒烟：EEXIST/EPERM/EBUSY 同走重试，正常竞争不出现 LOCK_FAILED ----------

test('16.4 withStateLock 并发冒烟：两子进程各 10 次 updateState 抢同一锁 → 终值 20、无 LOCK_FAILED、无锁残留', async () => {
  const dir = mkHarnessProj();
  try {
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'state.json'), JSON.stringify({ version: 1, counter: 0 }));
    const coreUrl = pathToFileURL(path.join(dir, '.zcode', 'lib', 'core.mjs')).href;
    const N = 10;
    const script = `import { updateState } from ${JSON.stringify(coreUrl)};\nfor (let i = 0; i < ${N}; i++) updateState((s) => ({ ...s, counter: (s.counter || 0) + 1 }));`;
    // 竞争错误码（EEXIST POSIX / EPERM·EBUSY Windows 持有中形态）一律进重试不致命：
    // 子进程任何 stderr 输出即失败（LOCK_FAILED 形态本地不可复现，Windows 靠竞争集合常量 + review，如实记档）
    const results = await Promise.all([0, 1].map(() => execFileP(process.execPath, ['--input-type=module', '-e', script], { cwd: dir })));
    assert.ok(results.every((r) => String(r).trim() === ''), '并发抢锁子进程不得有输出（LOCK_FAILED/未捕获异常即失败）');
    const finalState = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'state.json'), 'utf8'));
    assert.equal(finalState.counter, 2 * N, `并发增量丢失：期望 ${2 * N}，实际 ${finalState.counter}`);
    assert.equal(fs.readdirSync(path.join(dir, '.zcode', 'state')).filter((f) => f.endsWith('.lock')).length, 0, '锁用完即删，不留残留');
    // 竞争集合常量固化：EPERM/EBUSY 在集合内（防后人「清理」回 EEXIST-only）
    const src = fs.readFileSync(path.join(dir, '.zcode', 'lib', 'core.mjs'), 'utf8');
    assert.match(src, /LOCK_CONTENTION\s*=\s*new Set\(\['EEXIST',\s*'EPERM',\s*'EBUSY'\]\)/);
  } finally {
    rmDir(dir);
  }
});
