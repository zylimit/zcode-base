// 基础工具：路径/JSON/哈希/原子写/退出码。零依赖，Node >= 18。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const EXIT = {
  OK: 0,
  ERROR: 1,
  DENY: 2, // hook 阻断保留码
  FINDINGS: 3, // 检查发现（lint/arch/quality 失败）
  TAMPERED: 4, // 账本断链/证据腐化
};

export function projectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md')) || fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// 规范化 JSON：排序键、无多余空白——账本哈希的前置条件。
export function canonicalJson(value) {
  const sorted = (v) => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sorted(value));
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

export function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
}

export function rel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}

export function isBinaryFile(file, peek = 8000) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(peek);
    const n = fs.readSync(fd, buf, 0, peek, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

// glob → RegExp：支持 ** * ? 与普通字符。编译结果供缓存复用。
const globCache = new Map();
export function globToRegExp(glob) {
  let re = globCache.get(glob);
  if (re) return re;
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { src += '(?:.*/)?'; i++; }
        else src += '.*';
      } else src += '[^/]*';
    } else if (c === '?') src += '[^/]';
    else src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re = new RegExp(`^${src}$`);
  globCache.set(glob, re);
  return re;
}

export function matchAny(p, globs) {
  return globs.some((g) => globToRegExp(g).test(p));
}

export function human(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function fail(msg, code = EXIT.ERROR) {
  process.stderr.write(`[zbase] ${msg}\n`);
  process.exit(code);
}
