// git 集成：状态/路径枚举/task+git fingerprint（防证据腐化）。
// v2.1：untracked 逐文件内容字节编入指纹（WIP 阶段文件全是 untracked，恰是最需证据绑定的时刻）；
//      pathspec 一律 :(literal) 前缀防注入（路径来自仓库元数据也强制字面量）；
//      git 输出超 256MiB 截断 → GIT_OUTPUT_TRUNCATED 响亮抛错（绝不静默绑定截断的测量）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, matchAny } from './common.mjs';
import { loadHarnessConfig } from './config.mjs';

const GIT_MAX_OUTPUT = 256 * 1024 * 1024; // 256MiB

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_OUTPUT, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  } catch (e) {
    // 截断的测量按原样哈希 = 把证据静默绑到错误字节上——溢出必须响亮失败
    if (/maxBuffer/i.test(String(e.message))) {
      throw new Error(`git 输出超 ${GIT_MAX_OUTPUT} 字节上限（${args[0]} …）：拒绝绑定截断的测量（GIT_OUTPUT_TRUNCATED）`);
    }
    if (opts.allowFail) return null;
    throw new Error(`git ${args.join(' ')} 失败：${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }
}

// pathspec 防注入：路径即使来自仓库元数据，也强制字面量解释（:(glob) 等 magic 永不生效）
const literal = (p) => `:(literal)${p}`;

export function isGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree'], { allowFail: true }) !== null;
}

export function headCommit() {
  return (git(['rev-parse', 'HEAD'], { allowFail: true }) || 'no-commits').trim();
}

// 仓库工作树根（untracked 文件读内容的基准；git 子目录运行时 status 路径仍相对 toplevel）
function repoRoot() {
  const root = git(['rev-parse', '--show-toplevel'], { allowFail: true });
  return root ? root.trim() : process.cwd();
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

// 运行态路径不算「项目变更」：账本/日志/锁自身的写入不得使证据指纹腐化。
// v2.0 运行态在 .zcode/state/；.zbase/ 前缀保留兼容旧装项目。
const STATE_PREFIXES = ['.zcode/state/', '.zbase/'];

function stripState(paths) {
  return paths.filter((p) => !STATE_PREFIXES.some((s) => p.startsWith(s)));
}

// untracked 内容字节块：`长度:路径:类型:内容长度:` 前缀 + 原始内容 + NUL。
// 类型标记：symlink:not-followed（只记链接本身，绝不读目标）/ special:not-read（目录/设备等）/ missing（枚举后消失）。
function untrackedChunk(root, relPath) {
  let type = 'regular';
  let content = Buffer.alloc(0);
  try {
    const st = fs.lstatSync(path.join(root, relPath));
    if (st.isSymbolicLink()) type = 'symlink:not-followed';
    else if (st.isFile()) content = fs.readFileSync(path.join(root, relPath));
    else type = 'special:not-read';
  } catch (e) {
    if (e.code === 'ENOENT') type = 'missing';
    else throw e;
  }
  const head = Buffer.from(`${Buffer.byteLength(relPath)}:${relPath}:${type}:${content.length}:`, 'utf8');
  return Buffer.concat([head, content, Buffer.from('\0', 'utf8')]);
}

// fingerprint：base commit + staged/unstaged diff 内容（literal pathspec）+ untracked 内容字节 + 变更路径清单。
// 任一项目文件字节变化（含 untracked 文件内容变化）→ fingerprint 变化 → 旧回执证据 stale。
export function fingerprint() {
  const cfg = loadHarnessConfig();
  const max = cfg.context.maxTrackedPaths;
  const s = statusPaths();
  const root = repoRoot();
  const staged = stripState(s.staged);
  const unstaged = stripState(s.unstaged);
  const untracked = stripState(s.untracked);
  const all = [...staged, ...unstaged, ...untracked];
  let truncated = false;
  let list = all;
  if (all.length > max) { truncated = true; list = all.slice(0, max); }
  const untrackedHash = sha256(Buffer.concat(untracked.map((p) => untrackedChunk(root, p))));
  const fp = sha256([
    headCommit(),
    diffHash(['diff', '--cached', '--binary', '--no-ext-diff', ...(staged.length ? ['--', ...staged.map(literal)] : [])]),
    diffHash(['diff', '--binary', '--no-ext-diff', ...(unstaged.length ? ['--', ...unstaged.map(literal)] : [])]),
    untrackedHash,
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
