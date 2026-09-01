// 共享测试辅助（Task 8.10，源 dsh tests/helpers.mjs 模式）。Node 标准库 only（tests/AGENTS 纪律）。
// 新用例一律用本文件；各旧 test 文件的本地 run/mkproj 辅助保留不强制迁移（避免零行为重组外的无谓 churn）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

export const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/** 跑 zbase 子命令，返回 {code, json, stdout, stderr}（json = stdout 最后一行 JSON，无则 null）。 */
export function zbase(args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO, '.zcode', 'zbase.mjs'), ...args], {
    cwd: opts.cwd || REPO,
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts.timeout || 60_000,
    input: opts.input,
    env: { ...process.env, ...(opts.env || {}) },
  });
  let json = null;
  // zbase --json 有两种形态：单行机器通道（install --json）与 pretty 多行（print 默认）。
  // 先试最后一行（dsh 惯例），失败再试整个 stdout。
  const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (line) { try { json = JSON.parse(line); } catch { json = null; } }
  if (json === null && (r.stdout || '').trim()) {
    try { json = JSON.parse(r.stdout); } catch { json = null; }
  }
  return { code: r.status, json, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** 仓库外一次性目录（os.tmpdir，绝不污染宿主树）。 */
export function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `zbase-${label}-`));
}

/** 尽力清理；OS 终会回收。 */
export function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the OS reclaims it */ }
}

/** 复制 .zcode 到临时目录建一个最小可跑项目（清运行态；可选覆写 catalog/matrix）。 */
export function mkHarnessProj({ catalog, matrix } = {}) {
  const dir = tempDir('proj');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# test\n');
  fs.cpSync(path.join(REPO, '.zcode'), path.join(dir, '.zcode'), { recursive: true });
  fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.zcode', 'harness'), { recursive: true });
  if (catalog) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify(catalog));
  if (matrix) fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'verification-matrix.json'), JSON.stringify(matrix));
  try { spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' }); } catch { /* 非 git 也能跑大部分面 */ }
  return dir;
}
