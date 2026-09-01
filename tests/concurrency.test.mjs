// Task 8.10 三类新测试之一：并发正确性（锁回归守护，源 codex tests/harness.test.mjs:158 模式）。
// 与 mechanisms.test.mjs 的 7.3（N=10）互补：此处 N=25 拉长竞争窗口，且走新模块路径 core.mjs +
// tests/helpers.mjs——守护「七模块界重组不丢锁语义」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { mkHarnessProj, rmDir } from './helpers.mjs';

const execFileP = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
});

test('8.10 并发正确性：两子进程并发 updateState 各 25 次增量 → 终值 = 50（锁回归守护）', async () => {
  const dir = mkHarnessProj();
  try {
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'state.json'), JSON.stringify({ version: 1, counter: 0 }));
    // 新模块路径（core.mjs 吸收原 state.mjs；shim 仍可用但新测试写新路径）
    const coreUrl = pathToFileURL(path.join(dir, '.zcode', 'lib', 'core.mjs')).href;
    const N = 25;
    const script = `import { updateState } from ${JSON.stringify(coreUrl)};\nfor (let i = 0; i < ${N}; i++) updateState((s) => ({ ...s, counter: (s.counter || 0) + 1 }));`;
    await Promise.all([0, 1].map(() => execFileP(process.execPath, ['--input-type=module', '-e', script], { cwd: dir })));
    const finalState = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'state.json'), 'utf8'));
    assert.equal(finalState.counter, 2 * N, `并发增量丢失：期望 ${2 * N}，实际 ${finalState.counter}（withStateLock 回归）`);
    // 锁用完即删：不留残留锁文件（残留 = 下次假冲突/脏树）
    assert.equal(fs.readdirSync(path.join(dir, '.zcode', 'state')).filter((f) => f.endsWith('.lock')).length, 0);
  } finally {
    rmDir(dir);
  }
});
