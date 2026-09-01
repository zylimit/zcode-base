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

// 红线三性：security/safety/privacy 永不可豁免、永不可 Fast 跳过（宪法五性红线）。
// 唯一事实源——quality/waivers/fitness 共用，禁止各处复制（防三副本漂移）。
export const PROTECTED_ATTRS = ['security', 'safety', 'privacy'];

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

// ---------- 输出脱敏与预算化截断 ----------
// 红线「隐私数据不入日志」的机器执法：所有模型可见/落盘通道（回执 note/gate-log/hook 输出）
// 统一在输出边界脱敏，不靠调用点自觉。脱敏可过度匹配（无害），漏匹配才是缺陷。

const REDACT_PATTERNS = [
  // PEM 私钥块（整块替换）
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // 平台 token 前缀族：sk-/pk-/rk-/sess-、ghp_ 系、github_pat_、glpat-、xox 系
  /\b(sk|pk|rk|sess)-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // AWS 访问键 / Google API 键
  /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // JWT 三段（eyJ 头.载荷.签名）
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
  // URL userinfo：scheme://user:pass@host（任意 scheme；DB 连接串是其子集，双写保底）
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"']+:[^\s@/"']+@[^\s"']*/gi,
  /\b((?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?|mssql):\/\/)[^@\s"']+@/gi,
  // 环境变量赋值形：命名键（AWS/OPENAI/ANTHROPIC）与后缀通配（*_SECRET|_TOKEN|_KEY|_PASSWORD）
  /\b(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*[=:]\s*[^\s"']+/gi,
  /\b([A-Z][A-Z0-9_]*(?:_SECRET|_TOKEN|_KEY|_PASSWORD))\s*[=:]\s*[^\s"']+/g,
  // Authorization 头
  /(authorization\s*:\s*(?:bearer|basic)\s+)[^\s"']+/gi,
  // 通用赋值形 password/token/secret/api-key [=:] 值
  /(password|passwd|token|secret|api[_-]?key)\s*[=:]\s*[^\s,"']+/gi,
  // URL query 参数中的凭据 ?token=...&api_key=...
  /([?&](?:token|api_key|apikey|access_token|refresh_token|signature|secret|password|client_secret)=)[^&\s"']+/gi,
];

export function redactSecrets(value) {
  let text = String(value ?? '');
  for (const re of REDACT_PATTERNS) {
    text = text.replace(re, (m, p1) => (p1 ? `${p1}[REDACTED]` : '[REDACTED]'));
  }
  return text;
}

// 先脱敏再截断（顺序不可反：已截断的 token 无法再被模式识别）。
// boundedHead 保头（命令的程序名是审计要的）；boundedTail 保尾（错误信息在输出尾部）。
export function boundedHead(text, limit, marker = '\n...[truncated]') {
  const clean = redactSecrets(text);
  if (clean.length <= limit) return clean;
  return clean.slice(0, Math.max(0, limit - marker.length)) + marker;
}

export function boundedTail(text, limit, marker = '...[truncated]\n') {
  const clean = redactSecrets(text);
  if (clean.length <= limit) return clean;
  return marker + clean.slice(Math.max(0, clean.length - limit + marker.length));
}

// boundedText：脱敏 + 截尾 marker 的通用单入口（hook 输出预算用）。
export function boundedText(text, limit) {
  return boundedHead(text, limit);
}
