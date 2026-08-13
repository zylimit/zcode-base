// git 集成：状态/路径枚举/task+git fingerprint（防证据腐化）。
import { execFileSync } from 'node:child_process';
import { sha256, matchAny } from './common.mjs';
import { loadHarnessConfig } from './config.mjs';

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  } catch (e) {
    if (opts.allowFail) return null;
    throw new Error(`git ${args.join(' ')} 失败：${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }
}

export function isGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) !== null;
}

export function headCommit() {
  return (git(['rev-parse', 'HEAD'], { allowFail: true }) || 'no-commits').trim();
}

export function diffHash(args) {
  const out = git([...args], { allowFail: true });
  return sha256(out || '');
}

// 路径枚举用 -z（NUL 分隔原始路径，无 C 转义；中文/空格文件名不破坏）。
export function listPaths(args = []) {
  const out = git(['ls-files', '-z', ...args], { allowFail: true });
  if (!out) return [];
  return out.split('\0').filter((p) => p !== '');
}

export function statusPaths() {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { allowFail: true });
  if (!out) return { staged: [], unstaged: [], untracked: [] };
  const staged = [], unstaged = [], untracked = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry === '') continue;
    const code = entry.slice(0, 2);
    const p = entry.slice(3);
    if (code === '??') untracked.push(p);
    else if (code[0] !== ' ') staged.push(p);
    else unstaged.push(p);
  }
  return { staged, unstaged, untracked };
}

// 运行态路径不算「项目变更」：账本/日志自身的写入不得使证据指纹腐化。
const STATE_PREFIX = '.zbase/';

function stripState(paths) {
  return paths.filter((p) => !p.startsWith(STATE_PREFIX));
}

// fingerprint：base commit + staged/unstaged diff 内容 + 变更路径清单。
// 任一项目文件字节变化 → fingerprint 变化 → 旧回执证据 stale（quality verify 按未验证处理）。
export function fingerprint() {
  const cfg = loadHarnessConfig();
  const max = cfg.context.maxTrackedPaths;
  const s = statusPaths();
  const all = stripState([...s.staged, ...s.unstaged, ...s.untracked]);
  let truncated = false;
  let list = all;
  if (all.length > max) { truncated = true; list = all.slice(0, max); }
  const fp = sha256([
    headCommit(),
    diffHash(['diff', '--cached']),
    diffHash(['diff']),
    sha256(list.sort().join('\n')),
  ].join(':'));
  return { fingerprint: fp, truncated, counts: { staged: s.staged.length, unstaged: s.unstaged.length, untracked: s.untracked.length } };
}

export function changedPaths() {
  const s = statusPaths();
  return stripState([...s.staged, ...s.unstaged, ...s.untracked]);
}

export function isDenyPath(p, patterns) {
  return matchAny(p, patterns);
}
