// core：词汇表与地基——common（工具/退出码/脱敏）+ config（路径/配置）+ state（跨进程锁/quarantine/stop-strikes/fast）+ git（访问层）。
// Task 8.10 模块界重组（dsh 界）：common/config/state/git/git.mjs 旧文件现为 re-export shim，旧 import 路径继续工作。
// 依赖方向：core 不依赖任何其他 lib 模块（依赖链底座：core ← graph/writes ← quality ← scan ← context ← hooks/doctor）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ══════════════════ 原 common.mjs ═══════════════════

// 基础工具：路径/JSON/哈希/原子写/退出码。零依赖，Node >= 18。

export const EXIT = {
  OK: 0,
  ERROR: 1,
  DENY: 2, // hook 阻断保留码
  FINDINGS: 3, // 检查发现（lint/arch/quality 失败）
  TAMPERED: 4, // 账本断链/证据腐化
};

// 红线三性：security/safety/privacy 永不可豁免、永不可 Fast 跳过（宪法八属性红线）。
// 唯一事实源——quality/waivers/fitness 共用，禁止各处复制（防三副本漂移）。
export const PROTECTED_ATTRS = ['security', 'safety', 'privacy'];

// ── 八属性六档词汇表（Task 9.1，源 dsh core.mjs §18，ISO/IEC 25010 对齐）─────────
// 唯一事实源：quality（覆盖门）/ scan（接线审计）/ graph（catalog lint）三处消费，
// 禁止各处本地复制（合并前 quality/scan 各有一份五属性副本——已统一到本点）。
export const ATTRIBUTES = Object.freeze([
  'resilience',      // 韧性：攻击/故障/灾难下存活并快速恢复
  'security',        // 安全 Security：机密性/完整性/授权/防篡改
  'safety',          // 安全 Safety：不伤人/环境/设备
  'privacy',         // 隐私：个人数据处理合法/最小/可撤销
  'reliability',     // 可靠：长期正确连续运行
  'availability',    // 可用：按承诺在线（v2.2 新增）
  'performance',     // 性能：时间/资源预算（v2.2 新增）
  'maintainability', // 可维护：变更成本可控（v2.2 新增）
]);

// 六档执法强度，最强在前。v2.2 新增 minimal（介于 low 与 none：受治理但降档执行）。
export const TIERS = Object.freeze(['critical', 'high', 'medium', 'low', 'minimal', 'none']);

// 无新鲜 PASS 认领时阻断门的档位（quality verify / task finish 消费）。
export const BLOCKING_TIERS = Object.freeze(new Set(['critical', 'high']));

// 必须带书面理由的档位：退出治理是记录的决策不是免费默认（attributeReasons 执法）。
export const REASON_REQUIRED_TIERS = Object.freeze(new Set(['minimal', 'none']));

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


// ══════════════════ 原 config.mjs ═══════════════════

// harness 配置装载：.zcode/harness/harness.json + 目录定位。
// v2.0 单目录封装：脚手架本体全部收进 .zcode/，运行态在 .zcode/state/（gitignored）。

export const ROOT = projectRoot();

export const DIRS = {
  zcode: path.join(ROOT, '.zcode'),
  harness: path.join(ROOT, '.zcode', 'harness'),
  runtime: path.join(ROOT, '.zcode', 'lib'),
  scripts: path.join(ROOT, '.zcode', 'scripts'),
  state: path.join(ROOT, '.zcode', 'state'),
  feedback: path.join(ROOT, '.zcode', 'feedback'),
  skills: path.join(ROOT, '.zcode', 'skills'),
  commands: path.join(ROOT, '.zcode', 'commands', 'zbase'),
  docs: path.join(ROOT, '.zcode', 'docs'),
  adr: path.join(ROOT, '.zcode', 'docs', 'adr'),
  rules: path.join(ROOT, '.zcode', 'rules'),
};

export const FILES = {
  catalog: path.join(DIRS.harness, 'module-catalog.json'),
  matrix: path.join(DIRS.harness, 'verification-matrix.json'),
  harnessConfig: path.join(DIRS.harness, 'harness.json'),
  manifest: path.join(ROOT, 'FRAMEWORK-MANIFEST.json'),
  progress: path.join(ROOT, 'progress.md'),
  ledger: path.join(DIRS.state, 'ledger.jsonl'),
  gateLog: path.join(DIRS.state, 'gate-log.jsonl'),
  state: path.join(DIRS.state, 'state.json'),
  waivers: path.join(DIRS.state, 'waivers.json'),
  archBaseline: path.join(DIRS.state, 'arch-baseline.json'),
};

const DEFAULTS = {
  version: 1,
  risk: {
    confirm: {
      // v2.3（R6a，Task 10.1）：危险命令/秘密读取的内置判定迁入 shell 语义分类器（lib/classifier.mjs，
      // 规则 id 保持 rm-rf-root/git-reset-hard/... 旧值；向量契约 .zcode/harness/classifier-rules.json，
      // `zbase classifier lint` 自测）。本配置面降为**项目附加正则**（opt-in，raw 命令串直测）：
      //   dangerousCommands: [{ rule, pattern }] → deny（规则 id 原样落 gate-log）
      //   secretReadPatterns: [pattern] → deny('secret-read')
      dangerousCommands: [],
      secretReadPatterns: [],
      protectedWritePaths: ['.zcode/state/**', '.zcode/config.json', 'FRAMEWORK-MANIFEST.json'],
      secretWritePatterns: ['^\\.env', '\\.key$', '\\.pem$', '^\\.ssh/'],
    },
  },
  context: { totalChars: 120000, fileChars: 20000, diffChars: 40000, modelChars: 8000, maxFiles: 40, maxTrackedPaths: 100000 },
  // spec 段（Task 9.2）：trace minCoverage 默认 0——脚手架自举 Spec 的验收靠 dod 链非单测引用，
  // 强制 1 会让自举项目永远红；目标项目按实情上调。
  spec: { minCoverage: 0 },
  ledger: { maxLines: 50000 },
  retention: { evidenceDays: 30, gateLogDays: 14 },
  fast: { defaultHours: 24 },
  // 变更爆炸半径预算（budget 命令；超限不禁止但必须拆分或记 ADR 显式升级）
  budget: { maxChangedFiles: 40, maxChangedLines: 1500, maxModulesTouched: 3, maxNewFiles: 25 },
  // 项目记忆：recap 预算 / 归档保留条数 / M3 阈值（Done>m3Threshold 提示自动归档）
  memory: {
    ledger: 'progress.md', archive: 'progress.archive.md',
    keepDone: 40, keepNotes: 30, recapBudget: 6000, invariantsBudget: 1200,
    maxLedgerBytes: 24000, m3Threshold: 100,
  },
};

export function loadHarnessConfig() {
  let user = {};
  if (fs.existsSync(FILES.harnessConfig)) user = readJson(FILES.harnessConfig) || {};
  const merged = structuredClone(DEFAULTS);
  for (const k of Object.keys(user)) {
    if (user[k] && typeof user[k] === 'object' && !Array.isArray(user[k]) && typeof merged[k] === 'object' && !Array.isArray(merged[k])) {
      Object.assign(merged[k], user[k]);
    } else merged[k] = user[k];
  }
  return merged;
}

export function catalogExists() {
  return fs.existsSync(FILES.catalog);
}

// 用户级 ZCode 配置（hooks 注册面：~/.zcode/cli/config.json，无工作区 hooks 的会话级审核）。
// HOME 环境变量跨平台优先——兑现测试隔离承诺（Windows 的 os.homedir() 读 USERPROFILE 不读 HOME）；
// 未设 HOME 时回落 os.homedir()（Windows 即 USERPROFILE）。
export function userConfigPath() {
  return path.join(process.env.HOME || os.homedir(), '.zcode', 'cli', 'config.json');
}


// ══════════════════ 原 state.mjs ═══════════════════

// 运行态：.zcode/state/state.json（任务/fast/Stop 三振）。
// v2.1 机制层：
//   - 跨进程状态锁 withStateLock（hook 是宿主 spawn 的独立进程，无锁的读-改-写必然丢更新）
//   - 损坏隔离 quarantine（坏状态文件既不 brick 引擎也不静默重建：移开+留痕+按默认继续）
//   - fast 贷款语义（minutes/reason 必填 + windowId 窗口身份）
//   - Stop 三振按状态分键（sha256(task+fingerprint+缺失清单)，替换旧 stopCount 按天计数）

const EMPTY = { version: 1, activeTask: null, tasks: [], fast: null, stopStrikes: null, degraded: [] };

// ---------- 跨进程状态锁 ----------
// open(lockPath,'wx') 独占创建 → 写 {pid, ownerToken, createdAt}；
// EEXIST 且锁龄 >staleMs 且持锁进程已死（信号 0 探测，EPERM=存活）→ 删锁重试（stale 突破）；
// 等待 busy-wait pollMs，超 timeoutMs 抛 LOCK_TIMEOUT；释放读回 ownerToken 匹配才删（防误删他人的锁）。
const LOCK_WAIT_MS = 15_000;
const LOCK_STALE_MS = 120_000;
const LOCK_POLL_MS = 25;

// 同步自旋等待（引擎全同步；零依赖下唯一可靠的忙等原语）
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockOwnerAlive(lockPath) {
  try {
    const info = readJson(lockPath);
    if (!Number.isInteger(info.pid) || info.pid <= 0) return false;
    try { process.kill(info.pid, 0); return true; }
    catch (e) { return e.code === 'EPERM'; } // EPERM=目标进程存在但非本人所有 → 存活
  } catch { return false; }
}

export function withStateLock(file, fn) {
  const lockPath = `${file}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const ownerToken = crypto.randomUUID();
  const started = Date.now();
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ownerToken, createdAt: nowIso() }));
    } catch (e) {
      if (e.code !== 'EEXIST') throw new Error(`锁 ${lockPath} 获取失败：${e.message}（LOCK_FAILED）`);
      let age = -1;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { /* 锁刚被删，进下一轮竞争 */ }
      if (age > LOCK_STALE_MS && !lockOwnerAlive(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch { /* 已被他人突破，继续竞争 */ }
        continue;
      }
      if (Date.now() - started >= LOCK_WAIT_MS) {
        throw new Error(`锁 ${lockPath} 等待超时（${LOCK_WAIT_MS}ms）——另一进程持有中且未释放（LOCK_TIMEOUT）`);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* 已关闭 */ }
    try {
      const cur = readJson(lockPath);
      if (cur && cur.ownerToken === ownerToken) fs.unlinkSync(lockPath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // 非ENOENT的释放失败必须可见（锁残留可被 stale 突破，但不可静默）
    }
  }
}

// ---------- 损坏隔离 quarantine ----------
// JSON 损坏：改名 <file>.corrupt-<ts> 取证保留 + 追加 .zcode/state/quarantine.jsonl 事件 → 按默认值继续。
// 运营纪律：核对隔离原件确认无工作丢失，不要删除取证文件。
export function quarantineState(file, error) {
  const quarantined = `${file}.corrupt-${Date.now()}`;
  fs.renameSync(file, quarantined);
  try {
    appendLine(path.join(DIRS.state, 'quarantine.jsonl'), {
      ts: nowIso(),
      file: path.basename(file),
      quarantinedAs: path.basename(quarantined),
      error: String(error?.message ?? error).slice(0, 400),
    });
  } catch { /* 事件追加 best-effort：rename 已保全取证原件 */ }
  return quarantined;
}

export function quarantineEvents() {
  return readLines(path.join(DIRS.state, 'quarantine.jsonl')).map((l) => {
    try { return JSON.parse(l); } catch { return { ts: null, file: 'unknown', error: 'quarantine 记录自身不可解析' }; }
  });
}

// ---------- 读/写/更新 ----------
// 读不加锁（写全部走 tmp+rename 原子替换，读到的永远是完整 JSON）；写与读-改-写一律锁内。
// 重计算（git diff/fingerprint）必须在锁外完成后再进锁提交——持锁跑全仓 diff 会超出 stale 窗口导致双写。
function readStateFile(file, fallback) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  try {
    const s = readJson(file);
    return { ...structuredClone(fallback), ...s };
  } catch (e) {
    // 只对 JSON 语法损坏隔离（半写/篡改）；EACCES/EMFILE 等读写错误必须 rethrow——
    // 完好但暂不可读的状态若被静默隔离，等于把好数据当坏数据丢弃且引擎无感。
    if (e instanceof SyntaxError) {
      quarantineState(file, e);
      return structuredClone(fallback);
    }
    throw e;
  }
}

export function loadState() {
  return readStateFile(FILES.state, EMPTY);
}

export function saveState(state) {
  fs.mkdirSync(DIRS.state, { recursive: true });
  withStateLock(FILES.state, () => writeJsonAtomic(FILES.state, state));
}

// updateState：锁内读-改-写，并发安全的唯一入口（mutator 须为纯计算，不做 IO 重活）。
export function updateState(mutator) {
  fs.mkdirSync(DIRS.state, { recursive: true });
  return withStateLock(FILES.state, () => {
    const next = mutator(readStateFile(FILES.state, EMPTY));
    if (next === undefined) throw new Error('state 更新函数返回 undefined（STATE_UPDATE_FAILED）');
    writeJsonAtomic(FILES.state, next);
    return next;
  });
}

// ---------- Fast Mode 贷款语义 ----------
// fast on --minutes N --reason "..."：minutes 必填（clamp 1..480）、reason 必填非空——无期限无债务人的贷款永远无法偿还。
// 每次开启生成新 windowId：SKIPPED 回执绑定 fastModeWindow，只有同一窗口内的 SKIPPED 才有效；
// 旧窗口的 SKIPPED 在新窗口/无窗口时一律 invalid。已执行出 FAIL 的检查永不可被 fast 豁免（见 quality verify 反证优先）。
export function fastStatus(state = loadState()) {
  const f = state.fast;
  if (!f || !f.enabled) return { enabled: false };
  const untilRaw = f.until || f.expiresAt || null;
  const until = untilRaw ? new Date(untilRaw).getTime() : 0;
  if (!(until > Date.now())) return { enabled: false, expiredAt: untilRaw };
  return {
    enabled: true,
    reason: f.reason || null,
    minutes: f.minutes ?? null,
    windowId: f.windowId || null,
    createdAt: f.createdAt || null,
    until: untilRaw,
  };
}

export function fastSet(on, { minutes, reason } = {}) {
  if (!on) {
    updateState((s) => ({ ...s, fast: null }));
    return fastStatus();
  }
  const m = Number(minutes);
  if (minutes === undefined || minutes === null || minutes === '' || !Number.isFinite(m)) {
    throw new Error('fast on 缺 --minutes（必填，clamp 1..480）：贷款必须有期限');
  }
  if (!reason || !String(reason).trim()) {
    throw new Error('fast on 缺 --reason（必填非空）：贷款必须有债务人与事由，无期限的放水会活过它的借口');
  }
  const clamped = Math.min(480, Math.max(1, Math.round(m)));
  const createdAt = nowIso();
  const loan = {
    version: 1,
    enabled: true,
    reason: String(reason).trim(),
    minutes: clamped,
    windowId: crypto.randomUUID(),
    createdAt,
    until: new Date(Date.now() + clamped * 60_000).toISOString(),
  };
  const next = updateState((s) => ({ ...s, fast: loan }));
  return fastStatus(next);
}

// ---------- Stop 三振按状态分键 ----------
// strike key = sha256(taskId + fingerprint + 缺失清单 JSON)：不同缺失项各自计数（修好一项不误耗另一项额度，
// 两个缺失项交替出现也各自累计、互不消耗），清单/指纹/任务任一变化 → 新键从零计。
// 同键连拦 ≥limit 次 → 第 limit+1 次放行交人工审查。多槽 Map 存储（最近 MAX_KEYS 个键，访问序淘汰防无限增长）。
// 替换旧 stopCount（按天全局计数）：一个顽固缺失项耗尽全部额度、或两个缺失项交替各计一次永不触发，都是分键修正的缺陷。
const STOP_STRIKE_MAX_KEYS = 8;

export function bumpStopStrike(key, limit = 3) {
  const next = updateState((s) => {
    const prev = s.stopStrikes || {};
    const counts = { ...(prev.counts || {}) };
    const order = [...(prev.order || []).filter((k) => k in counts)];
    counts[key] = (counts[key] || 0) + 1;
    order.push(key);
    while (order.length > STOP_STRIKE_MAX_KEYS) {
      const evicted = order.shift();
      if (evicted !== key) delete counts[evicted];
    }
    return { ...s, stopStrikes: { version: 2, counts, order, updatedAt: nowIso() } };
  });
  const count = next.stopStrikes.counts[key] || 0;
  return { count, over: count > limit };
}


// ══════════════════ 原 git.mjs ═══════════════════

// git 集成：状态/路径枚举/task+git fingerprint（防证据腐化）。
// v2.1：untracked 逐文件内容字节编入指纹（WIP 阶段文件全是 untracked，恰是最需证据绑定的时刻）；
//      pathspec 一律 :(literal) 前缀防注入（路径来自仓库元数据也强制字面量）；
//      git 输出超 256MiB 截断 → GIT_OUTPUT_TRUNCATED 响亮抛错（绝不静默绑定截断的测量）。

const GIT_MAX_OUTPUT = 256 * 1024 * 1024; // 256MiB
const UNTRACKED_FILE_MAX_BYTES = 16 * 1024 * 1024; // 单个 untracked 文件内容读取上限 16MiB

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_OUTPUT, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  } catch (e) {
    const msg = String(e.message || '');
    // 截断的测量按原样哈希 = 把证据静默绑定到错误字节上——输出溢出（maxBuffer）与参数溢出（E2BIG）都必须响亮失败；
    // 二者若被 allowFail 吞成 null → sha256('') 恒定指纹，是比崩溃更坏的静默假绿。
    // EINVAL：Windows 上超长参数列表在 spawn 层报 EINVAL 而非 E2BIG（Linux 形态）；execFileSync 场景下
    // git 正常调用不会 EINVAL，命中即命令行/参数问题，与 E2BIG 同类，按参数溢出响亮抛（CI windows #49）。
    if (/maxBuffer/i.test(msg) || e.code === 'E2BIG' || /E2BIG/.test(msg) || e.code === 'EINVAL') {
      const cause = /maxBuffer/i.test(msg) ? `输出超 ${GIT_MAX_OUTPUT} 字节上限` : `参数列表超系统上限（${e.code === 'EINVAL' ? 'EINVAL，Windows 形态' : 'E2BIG'}）`;
      throw new Error(`git ${args[0]} … ${cause}：拒绝绑定截断/失败的测量（GIT_OUTPUT_TRUNCATED）`);
    }
    if (opts.allowFail) return null;
    throw new Error(`git ${args.join(' ')} 失败：${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }
}

// 导出供测试直接验证溢出抛错路径（真实 E2BIG：单参数 > 内核 MAX_ARG_STRLEN 128KB）
export { git as gitRaw };

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
// 类型标记：symlink:not-followed（只记链接本身，绝不读目标）/ special:not-read（目录/设备/超 16MiB 大文件）/ missing（枚举后消失）。
// 单文件内容读取上限 UNTRACKED_FILE_MAX_BYTES：超限不读内容，类型降级 special:not-read（防一次性读入巨型文件拖垮 CLI）。
function untrackedChunk(root, relPath) {
  let type = 'regular';
  let content = Buffer.alloc(0);
  try {
    const st = fs.lstatSync(path.join(root, relPath));
    if (st.isSymbolicLink()) type = 'symlink:not-followed';
    else if (st.isFile()) {
      if (st.size > UNTRACKED_FILE_MAX_BYTES) type = 'special:not-read';
      else content = fs.readFileSync(path.join(root, relPath));
    } else type = 'special:not-read';
  } catch (e) {
    if (e.code === 'ENOENT') type = 'missing';
    else throw e;
  }
  const head = Buffer.from(`${Buffer.byteLength(relPath)}:${relPath}:${type}:${content.length}:`, 'utf8');
  return Buffer.concat([head, content, Buffer.from('\0', 'utf8')]);
}

// fingerprint：base commit + staged/unstaged diff 内容（literal pathspec）+ untracked 内容字节 + 变更路径清单。
// 任一项目文件字节变化（含 untracked 文件内容变化）→ fingerprint 变化 → 旧回执证据 stale。
// 预算（maxTrackedPaths）覆盖路径清单**与 untracked 内容段**：超限 truncated=true（Stop 门不放行），
// 且内容段降级为路径清单哈希 + 响亮标注（不读文件内容——不给人「预算内已测量」的错觉）。
// 进程内 memoize：同进程多次调用（task finish→verify/verifyLedger/fastDebt 链、hook stop 两跳）去重；
// 参数变（HEAD/diff/untracked 清单与内容）由 clearFingerprintCache() 显式失效或进程重启自然失效。
let fpCache = null;

export function clearFingerprintCache() {
  fpCache = null;
}

export function fingerprint() {
  if (fpCache) return fpCache;
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
  // untracked 内容段预算：变更路径总数超限时降级为「路径清单 + 响亮标注」，不读内容
  const untrackedHash = truncated
    ? sha256(`budget-exceeded:content-not-read:${untracked.length}:${untracked.slice(0, max).sort().join('\n')}`)
    : sha256(Buffer.concat(untracked.map((p) => untrackedChunk(root, p))));
  const fp = sha256([
    headCommit(),
    diffHash(['diff', '--cached', '--binary', '--no-ext-diff', ...(staged.length ? ['--', ...staged.map(literal)] : [])]),
    diffHash(['diff', '--binary', '--no-ext-diff', ...(unstaged.length ? ['--', ...unstaged.map(literal)] : [])]),
    untrackedHash,
    sha256(list.sort().join('\n')),
  ].join(':'));
  fpCache = { fingerprint: fp, truncated, counts: { staged: s.staged.length, unstaged: s.unstaged.length, untracked: s.untracked.length } };
  return fpCache;
}

export function changedPaths() {
  const s = statusPaths();
  return stripState([...s.staged, ...s.unstaged, ...s.untracked]);
}

// numstat：[{path, added, removed}]（binary 行为 '-' 按 0 计）。staged 用 --cached，否则对 HEAD（无 commit 时 allowFail → null）。
export function numstat({ staged = false } = {}) {
  const out = git(staged ? ['diff', '--cached', '--numstat'] : ['diff', 'HEAD', '--numstat'], { allowFail: true });
  if (!out) return [];
  return out.split('\n').filter((l) => l.trim() !== '').map((l) => {
    const [a, r, ...rest] = l.split('\t');
    return { path: rest.join('\t'), added: /^\d+$/.test(a) ? Number(a) : 0, removed: /^\d+$/.test(r) ? Number(r) : 0 };
  });
}

// 当前分支名（ detached HEAD → 'HEAD'；非 git → 'no-git'）。
export function branchName() {
  const out = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
  return out ? out.trim() : 'no-git';
}

export function isDenyPath(p, patterns) {
  return matchAny(p, patterns);
}

// PATH 探测可执行（Task 9.1，源 cursor whichCommand）：Windows 展开 PATHEXT（npx→npx.cmd）。
// 返回命中路径或 null。adapters list 据此报 available——探测不出 ≠ 未安装，但检查跑不了就是 BLOCKED。
export function whichCommand(bin) {
  const isWin = process.platform === 'win32';
  const exts = isWin ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, `${bin}${ext}`);
      try {
        if (isWin) fs.accessSync(cand, fs.constants.F_OK);
        else fs.accessSync(cand, fs.constants.X_OK);
        return cand;
      } catch { /* 下一个候选 */ }
    }
  }
  return null;
}

// canonical diff 文本（Task 9.3）：literal pathspec 防注入（路径来自仓库元数据也强制字面量），
// 截断/失败响亮抛错（同 git() 契约）——供 context pack 组装 diff 段（DENY 命中时只取 hash 不取内容）。
export function diffText(paths = []) {
  return git(['diff', '--binary', '--no-ext-diff', ...(paths.length ? ['--', ...paths.map(literal)] : [])]);
}
