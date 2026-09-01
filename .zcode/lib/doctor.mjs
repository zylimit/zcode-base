undefined

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { catalogExists, DIRS, FILES, listPaths, loadHarnessConfig, matchAny, nowIso, readJson, rel, ROOT, sha256, userConfigPath, writeJsonAtomic } from './core.mjs';
import { lint, loadCatalog, reverseClosure } from './graph.mjs';
import { verifyLedger } from './quality.mjs';
import { audit as fitnessAudit } from './scan.mjs';

// ══════════════════ 原 doctor.mjs ═══════════════════

// doctor：环境自检。selftest：规模冒烟。install：安全安装/升级到目标项目。

export function doctor() {
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, ok, detail });

  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  check('node-version', nodeMajor >= 18, `Node ${process.versions.node}（需要 >=18）`);

  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); check('git', true, 'git 可用'); }
  catch { check('git', false, 'git 不可用：账本 fingerprint 依赖 git'); }

  for (const [id, dir] of [['harness', DIRS.harness], ['runtime', DIRS.runtime], ['skills', DIRS.skills], ['commands', DIRS.commands], ['rules', DIRS.rules], ['docs', DIRS.docs]]) {
    check(`dir-${id}`, fs.existsSync(dir), rel(ROOT, dir));
  }

  // hooks 注册面（双通道：工作区 .zcode/config.json 或用户级 ~/.zcode/cli/config.json 任一注册 7 事件即 PASS）
  const hooksNeed = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop'];
  const hookChannels = [
    { label: '工作区注册', file: path.join(ROOT, '.zcode', 'config.json') },
    { label: '用户级注册', file: userConfigPath(), display: '~/.zcode/cli/config.json' },
  ];
  const hookIssues = [];
  let hooksPass = null;
  for (const ch of hookChannels) {
    if (!fs.existsSync(ch.file)) { hookIssues.push(`${ch.label}：${ch.display || '.zcode/config.json'} 不存在`); continue; }
    try {
      const cfg = readJson(ch.file);
      if (cfg.hooks?.enabled !== true) { hookIssues.push(`${ch.label}：hooks.enabled≠true`); continue; }
      const events = Object.keys(cfg.hooks?.events || {});
      const missing = hooksNeed.filter((e) => !events.includes(e));
      if (missing.length) { hookIssues.push(`${ch.label}：缺事件 ${missing.join(',')}`); continue; }
      hooksPass = { label: ch.label, display: ch.display || '.zcode/config.json', count: events.length };
      break;
    } catch (e) { hookIssues.push(`${ch.label}：${ch.display || '.zcode/config.json'} 解析失败：${e.message}`); }
  }
  if (hooksPass) {
    check('hooks-enabled', true, `${hooksPass.label}：hooks.enabled=true`);
    check('hooks-events', true, `${hooksPass.label}（${hooksPass.display}）：7 事件全注册（${hooksPass.count}）`);
  } else {
    check('hooks-enabled', false, hookIssues.join('；'));
    check('hooks-events', false, '修复：node .zcode/zbase.mjs install <dir>（注册用户级 hooks 到 ~/.zcode/cli/config.json）');
  }

  // 契约面
  if (catalogExists()) {
    const catalog = loadCatalog();
    const res = lint(catalog, { trackedPaths: listPaths() });
    check('catalog-lint', res.errors.length === 0, res.errors.length ? res.errors.slice(0, 5) : `lint 通过，归类 ${res.totalPaths} 路径`);
    check('catalog-attrs', (catalog.modules || []).every((m) => m.attributes), '模块五性档位声明');
  } else check('catalog-lint', true, 'module-catalog 不存在（小仓模式）');

  check('matrix', fs.existsSync(FILES.matrix), fs.existsSync(FILES.matrix) ? 'verification-matrix 存在' : 'verification-matrix 缺失');

  const ver = verifyLedger();
  check('ledger', ver.ok, ver.ok ? `账本 ${ver.total} 条链完整` : `断链：${JSON.stringify(ver.issues.slice(0, 3))}`);

  const fit = fitnessAudit();
  check('fitness', fit.ok, fit.results.map((r) => `${r.id}:${r.ok ? 'PASS' : 'FAIL'}`).join(' '));

  const cfg = loadHarnessConfig();
  check('harness-config', true, `配置装载 OK（context ${cfg.context.totalChars} chars / maxFiles ${cfg.context.maxFiles}）`);

  // managedDrift（codex 移植）：FRAMEWORK-MANIFEST digest 比对——装出去的框架被谁改过。
  // critical 档（config/harness.json/lib/githooks）漂移 = error；customized 档 = warning。
  // 本仓（源仓）manifest 按源树生成，零漂移为常态；安装目标仓的漂移 = 项目定制，两档分级播报。
  const drift = managedDrift();
  if (drift.checked) {
    check('managed-drift', drift.critical.length === 0, drift.critical.length
      ? `critical 档框架文件被改：${drift.critical.slice(0, 5).join(', ')}${drift.critical.length > 5 ? ` 等 ${drift.critical.length} 个` : ''}——定制需记 ADR 并重生成 manifest`
      : `零漂移（${drift.files} 文件比对）${drift.customized.length ? `；customized 档 ${drift.customized.length} 个：${drift.customized.slice(0, 5).join(', ')}` : ''}`);
  } else check('managed-drift', true, '无 FRAMEWORK-MANIFEST（未安装态），跳过漂移比对');

  // bootstrap 出厂态警告：catalog/matrix 仍是安装器种入的出厂骨架——此时 impact/verify
  // 的全绿只是脚手架默认值在跑，不是项目事实。定制前不得依赖（warning 不阻断新装项目）。
  const bootstrap = bootstrapState();
  check('bootstrap-state', true, bootstrap.length
    ? `warning：${bootstrap.join('；')}——仍是出厂态，定制后再依赖 impact/verify`
    : 'catalog/matrix 均非出厂骨架（已定制）');

  // git hooks 接线（可选缝）：已接 = PASS；未接 = PASS 注明可选（不堵 doctor）
  const OUR_HOOKS = '.zcode/githooks';
  try {
    const hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    check('git-hooks', true, hooksPath === OUR_HOOKS
      ? `已接线 core.hooksPath=${OUR_HOOKS}（pre-commit/commit-msg/pre-push）`
      : `core.hooksPath=${hooksPath}（非本框架，git hooks 缝未启用；可选：node .zcode/zbase.mjs install <dir> --hooks）`);
  } catch {
    check('git-hooks', true, `未接线（可选缝）：node .zcode/zbase.mjs install <dir> --hooks 启用 pre-commit/commit-msg/pre-push`);
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, at: nowIso() };
}

// managedDrift：FRAMEWORK-MANIFEST 逐文件 LF 归一化 digest 比对，分 critical 与 customized 两档。
// critical = 接线面（config/harness 契约/引擎 lib/git hooks）——动它们而不记 ADR/重生成 manifest
// 即治理面漂移；customized = 其余管理面文件（skills/docs 等项目定制常态）。
const DRIFT_CRITICAL = (relPath) => relPath === '.zcode/config.json'
  || relPath === '.zcode/harness/harness.json'
  || relPath === '.zcode/harness/verification-matrix.json'
  || relPath === '.zcode/harness/module-catalog.json'
  || relPath.startsWith('.zcode/lib/')
  || relPath.startsWith('.zcode/githooks/');

export function managedDrift() {
  if (!fs.existsSync(FILES.manifest)) return { checked: false, critical: [], customized: [], files: 0 };
  let manifest;
  try { manifest = readJson(FILES.manifest); } catch { return { checked: false, critical: [], customized: [], files: 0, reason: 'manifest 解析失败' }; }
  if (!manifest || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || Object.keys(manifest.files).length === 0) {
    return { checked: false, critical: [], customized: [], files: 0, reason: 'manifest 结构非法' };
  }
  const critical = [];
  const customized = [];
  for (const [relPath, expectHash] of Object.entries(manifest.files)) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) { critical.push(`${relPath}（缺失）`); continue; }
    const actual = sha256(fs.readFileSync(abs).toString('utf8').replace(/\r\n/g, '\n'));
    if (actual === expectHash) continue;
    (DRIFT_CRITICAL(relPath) ? critical : customized).push(relPath);
  }
  return { checked: true, critical, customized, files: Object.keys(manifest.files).length };
}

// bootstrap 出厂态检测：catalog 仍是安装器种入的空骨架（modules 空）/matrix 仍是 starter 两检查
// → 全绿只是脚手架默认值，不是项目事实。
export function bootstrapState() {
  const out = [];
  try {
    if (fs.existsSync(FILES.catalog)) {
      const catalog = readJson(FILES.catalog);
      if (Array.isArray(catalog.modules) && catalog.modules.length === 0) out.push('module-catalog 仍是空骨架（catalog init 后逐模块补齐）');
    }
    if (fs.existsSync(FILES.matrix)) {
      const matrix = readJson(FILES.matrix);
      const names = (matrix.checks || []).map((c) => c.name);
      if (names.length === 2 && names.includes('zbase-doctor') && names.includes('zbase-secret-scan')) {
        out.push('verification-matrix 仍是 starter（按 DFX 定档扩充检查）');
      }
    }
  } catch { /* 读取失败由 catalog-lint/matrix 检查项报告 */ }
  return out;
}

// selftest：120 模块 × 30k 路径合成规模冒烟（lint + impact 计时）。
export function selftest() {
  const results = [];
  // 1) glob 编译缓存正确性
  results.push({ id: 'glob', ok: matchAny('a/b/c.ts', ['a/**/*.ts']) && !matchAny('a/b/c.ts', ['a/*.ts']), detail: '** 语义' });

  // 2) 合成 catalog lint
  const modules = Array.from({ length: 120 }, (_, i) => ({
    name: `mod-${i}`, globs: [`src/mod-${i}/**`], classification: 'product',
    deps: i > 0 ? [`mod-${i - 1}`] : [], attributes: { reliability: 'low' },
  }));
  const paths = [];
  for (let m = 0; m < 120; m++) for (let f = 0; f < 250; f++) paths.push(`src/mod-${m}/file-${f}.ts`);
  const t0 = Date.now();
  const res = lint({ version: 1, modules, global: ['docs/**'], ignored: ['.git/**'] }, { trackedPaths: paths });
  const lintMs = Date.now() - t0;
  results.push({ id: 'catalog-lint-scale', ok: res.errors.length === 0, detail: `${modules.length} 模块 / ${paths.length} 路径 / ${lintMs}ms（预算 2500ms）`, slow: lintMs > 2500 });

  // 3) impact 闭包正确性：mod-0 是所有人的传递依赖
  const t1 = Date.now();
  const closure = reverseClosure({ modules }, ['mod-0']);
  const impactMs = Date.now() - t1;
  results.push({ id: 'impact-closure', ok: closure.length === 120, detail: `闭包 ${closure.length}/120 / ${impactMs}ms`, slow: impactMs > 2500 });

  return { ok: results.every((r) => r.ok), results, lintMs, impactMs, paths: paths.length };
}

// install：把脚手架安装/升级到目标项目（Task 8.8 三仓大合流：dsh#14 + codex1.23 + cursor#14）。
// 模型 plan/apply 分离——
//   plan   逐文件 LF 归一化哈希判定（unchanged / create / update / conflict-旁路 .zbase-new）
//          + obsolete 三方合并（旧 manifest 有而新安装面无：未改→remove-obsolete 删除；改过→preserve-obsolete 留置）
//          + 种子 create-only（progress 模板/catalog 骨架/matrix starter）；
//   apply  每个 mutation 前备份进**目标仓外**临时 staging（os.tmpdir），逐项执行后整体 post-verify
//          （逐文件 LF digest 复核），任一失败 → 逆序回滚 → install-receipt 三态留痕
//          （committed / rolled-back / rollback-incomplete；回执落目标仓外临时文件 + stdout 报告，不污染目标仓）。
// 既有语义保留：manifest 哈希旁路 .zbase-new 永不覆盖他方定制；registerUserHooks（含备份）先行且不参与回滚
// （用户级配置独立于任何目标项目，幂等、覆写前自动备份；dry-run 一并跳写）。
// safeManagedPath 反穿越（cursor#14）：拒绝对路径/../空段；逐段 lstat+realpath 校验仍在目标内，悬空 symlink 报错。
// 故障注入：环境变量 zbase-install-fail-after=N（第 N 个 mutation 后抛错，供测试断言回滚）。
const MANAGED_ROOTS = ['.zcode'];
const EXCLUDE_PREFIX = ['.zcode/state/']; // 运行态永不安装
const SEEDS = ['AGENTS.md']; // 根对根种子
const BYPASS_SUFFIX = '.zbase-new';
const TARGET_MANIFEST = 'FRAMEWORK-MANIFEST.json';
const INSTALL_SURFACE = (rel) => rel === 'AGENTS.md'
  || (rel.startsWith('.zcode/') && !EXCLUDE_PREFIX.some((p) => rel.startsWith(p)));

// LF 归一化哈希：内容一致性忽略行尾风格（CRLF checkout 不误报 customized）。缺失文件返回 null。
const hashLf = (buf) => sha256(buf.toString('utf8').replace(/\r\n/g, '\n'));
function fileLfHash(p) {
  try { return hashLf(fs.readFileSync(p)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

const isWithin = (root, cand) => {
  const r = path.relative(path.resolve(root), path.resolve(cand));
  return r === '' || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r));
};

// 反穿越：manifest 是不可信输入（可能是旧版本/被篡改的清单），路径必须词法+物理双重校验。
export function safeManagedPath(target, relPath) {
  if (typeof relPath !== 'string' || !relPath || path.isAbsolute(relPath)
    || /^[A-Za-z]:[\\/]/.test(relPath) || /^[/\\]{2}/.test(relPath) || relPath.includes('\\')) {
    throw new Error(`不安全的受管路径：${String(relPath)}`);
  }
  const segments = relPath.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) throw new Error(`不安全的受管路径（空段/../.）：${relPath}`);
  const root = path.resolve(target);
  const dest = path.resolve(root, ...segments);
  if (dest === root || !isWithin(root, dest)) throw new Error(`受管路径逃出目标：${relPath}`);
  // 逐段物理校验：symlink 逐段解析后必须仍在目标内；悬空 symlink 直接报错（不是 ENOENT 的普通缺段）
  let physicalRoot = root;
  try { physicalRoot = fs.realpathSync(root); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let cur = root;
  for (const seg of segments) {
    cur = path.resolve(cur, seg);
    let info;
    try { info = fs.lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') break; throw e; }
    let physical;
    try { physical = fs.realpathSync(cur); }
    catch (e) {
      if (info.isSymbolicLink()) throw new Error(`受管路径含悬空 symlink：${relPath}（${cur}）`);
      throw e;
    }
    if (!isWithin(physicalRoot, physical)) throw new Error(`受管路径解析出目标外：${relPath}（${cur} → ${physical}）`);
  }
  return dest;
}

function sourceVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'; }
  catch { return '0.0.0'; }
}

function managedSourceFiles() {
  const out = [];
  for (const root of MANAGED_ROOTS) {
    const src = path.join(ROOT, root);
    if (!fs.existsSync(src)) continue;
    for (const f of walk(src)) {
      const relPath = rel(ROOT, f);
      if (EXCLUDE_PREFIX.some((p) => relPath.startsWith(p))) continue;
      out.push({ rel: relPath, abs: f });
    }
  }
  for (const seed of SEEDS) {
    const abs = path.join(ROOT, seed);
    if (fs.existsSync(abs)) out.push({ rel: seed, abs });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const CATALOG_SKELETON = JSON.stringify({
  version: 1, layers: [], modules: [], global: ['.zcode/docs/**', '*.md'],
  ignored: ['.git/**', '.zcode/state/**', '.zbase/**', 'node_modules/**', '*.zbase-new'], catchAll: null,
}, null, 2) + '\n';
const MATRIX_STARTER = JSON.stringify({
  version: 1,
  checks: [
    { name: 'zbase-doctor', command: 'node .zcode/zbase.mjs doctor', proves: ['reliability'], scope: [], tier: 'medium', description: '治理面环境自检' },
    { name: 'zbase-secret-scan', command: "! grep -rInE 'AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY' . --include='*.ts' --include='*.js' --include='*.py' --include='*.go' --include='*.java' 2>/dev/null", proves: ['security', 'privacy'], scope: [], tier: 'high', description: '秘密不入库扫描（按项目语言调整 include）' },
  ],
}, null, 2) + '\n';

// plan：纯读，零写。返回 ops（mutation 顺序即回滚逆序基准）+ counts + 新基线 files。
export function planInstall(target) {
  const warnings = [];
  const skipped = [];
  const ops = [];
  const counts = { created: 0, updated: 0, unchanged: 0, conflicts: 0, removedObsolete: 0, preservedObsolete: 0, seeded: 0 };
  let oldManifest = null;
  try {
    if (fs.existsSync(path.join(target, TARGET_MANIFEST))) oldManifest = readJson(path.join(target, TARGET_MANIFEST));
  } catch (e) {
    warnings.push(`旧 manifest 不可读（${String(e.message).slice(0, 80)}）——按无基线处理：目标已有差异一律旁路不覆盖`);
    oldManifest = null;
  }
  if (oldManifest && (!oldManifest.files || typeof oldManifest.files !== 'object' || Array.isArray(oldManifest.files))) oldManifest = null;

  const walked = managedSourceFiles();
  if (!walked.some((w) => w.rel.startsWith('.zcode/'))) skipped.push('.zcode（源缺失）');
  const walkedSet = new Set(walked.map((w) => w.rel));
  const baseline = {};
  for (const { rel: r, abs } of walked) {
    const srcHash = fileLfHash(abs);
    baseline[r] = srcHash;
    const cur = fileLfHash(safeManagedPath(target, r));
    if (cur === srcHash) { counts.unchanged++; continue; }
    if (cur === null) { ops.push({ kind: 'create', rel: r, srcAbs: abs, hash: srcHash }); counts.created++; }
    else if (oldManifest?.files?.[r] && cur === oldManifest.files[r]) {
      // 目标仍是基线安装（项目没改过）→ 安全覆盖
      ops.push({ kind: 'update', rel: r, srcAbs: abs, hash: srcHash }); counts.updated++;
    } else {
      // 项目定制或无基线差异 → 旁路永不覆盖
      ops.push({ kind: 'conflict', rel: r, srcAbs: abs, hash: srcHash, sidecar: `${r}${BYPASS_SUFFIX}` }); counts.conflicts++;
    }
  }
  // obsolete 三方合并：旧 manifest 有而新安装面无的文件
  for (const [r, baseHash] of Object.entries(oldManifest?.files || {})) {
    if (!INSTALL_SURFACE(r) || walkedSet.has(r)) continue;
    let cur;
    try { cur = fileLfHash(safeManagedPath(target, r)); }
    catch (e) { warnings.push(`obsolete 路径不安全，跳过：${e.message}`); continue; }
    if (cur === null) continue;
    if (cur === baseHash) { ops.push({ kind: 'remove-obsolete', rel: r }); counts.removedObsolete++; }
    else { ops.push({ kind: 'preserve-obsolete', rel: r }); counts.preservedObsolete++; }
  }
  // 种子（create-only，不覆盖既有项目文件）
  const progressTemplate = path.join(DIRS.harness, 'templates', 'PROGRESS.md');
  if (fileLfHash(path.join(target, 'progress.md')) === null) {
    if (fs.existsSync(progressTemplate)) {
      ops.push({ kind: 'seed', rel: 'progress.md', srcAbs: progressTemplate, hash: fileLfHash(progressTemplate) });
      counts.seeded++;
    } else skipped.push('progress.md（模板 .zcode/harness/templates/PROGRESS.md 不存在，未种入）');
  }
  for (const [r, content] of [['.zcode/harness/module-catalog.json', CATALOG_SKELETON], ['.zcode/harness/verification-matrix.json', MATRIX_STARTER]]) {
    if (walkedSet.has(r)) continue; // 源有实体（走 managed 复制面）
    if (fileLfHash(path.join(target, r)) !== null) continue; // 目标已有，不强造
    const hash = hashLf(Buffer.from(content));
    ops.push({ kind: 'seed', rel: r, content, hash });
    baseline[r] = hash;
    counts.seeded++;
  }
  const manifestContent = JSON.stringify({ name: 'zcode-base', version: sourceVersion(), algorithm: 'sha256-lf-v1', generatedAt: nowIso(), files: baseline }, null, 2) + '\n';
  ops.push({ kind: 'install-manifest', rel: TARGET_MANIFEST, content: manifestContent, hash: hashLf(Buffer.from(manifestContent)) });
  return { target, ops, counts, warnings, skipped };
}

const MUTATION_KINDS = new Set(['create', 'update', 'conflict', 'remove-obsolete', 'seed', 'install-manifest']);

// 事务性 apply：备份（目标仓外 staging）→ 执行 → 整体 post-verify → 失败逆序回滚 → 三态回执。
function applyTransaction(target, plan, { dryRun = false } = {}) {
  const mutations = plan.ops.filter((o) => MUTATION_KINDS.has(o.kind));
  if (dryRun) return { ok: true, dryRun: true, wouldMutate: mutations.length };
  const installId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-install-')); // 目标仓外：回滚前不受目标仓状态影响
  const receiptPath = path.join(os.tmpdir(), `zbase-install-receipt-${installId}.json`);
  const applied = [];
  const rollbackErrors = [];
  const postVerify = [];
  const failAfter = Number.parseInt(process.env['zbase-install-fail-after'] ?? '0', 10);
  const startedAt = nowIso();
  const destOf = (op) => safeManagedPath(target, op.kind === 'conflict' ? op.sidecar : op.rel);
  let n = 0;
  try {
    for (const op of mutations) {
      const dest = destOf(op);
      let backup = null;
      if (fs.existsSync(dest)) {
        backup = path.join(staging, 'backup', String(applied.length));
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(dest, backup);
      }
      applied.push({ dest, backup });
      if (op.kind === 'remove-obsolete') fs.rmSync(dest, { force: true });
      else if (op.kind === 'install-manifest' || op.content !== undefined) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, op.content);
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(op.srcAbs, dest);
      }
      n++;
      if (Number.isFinite(failAfter) && failAfter > 0 && n >= failAfter) throw new Error(`注入的安装失败：第 ${n} 个 mutation 后（zbase-install-fail-after=${failAfter}）`);
    }
    // 整体 post-verify：逐文件 LF digest 复核（verify-not-assume——写完不查等于没写）
    for (const op of mutations) {
      const actual = fileLfHash(destOf(op));
      const ok = op.kind === 'remove-obsolete' ? actual === null : actual === op.hash;
      postVerify.push({ kind: op.kind, rel: op.kind === 'conflict' ? op.sidecar : op.rel, ok });
      if (!ok) throw new Error(`post-verify 失败：${op.rel}（digest 不符）`);
    }
    const receipt = { version: 1, installId, action: 'install', status: 'committed', target, startedAt, completedAt: nowIso(), counts: plan.counts, mutations: n };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    fs.rmSync(staging, { recursive: true, force: true });
    return { ok: true, receipt: { ...receipt, path: receiptPath } };
  } catch (error) {
    // 逆序回滚：有备份还原，无备份（新建文件）删除
    for (const item of [...applied].reverse()) {
      try {
        if (item.backup) fs.copyFileSync(item.backup, item.dest);
        else fs.rmSync(item.dest, { force: true });
      } catch (re) { rollbackErrors.push(`${rel(target, item.dest)}: ${re.message}`); }
    }
    const status = rollbackErrors.length ? 'rollback-incomplete' : 'rolled-back';
    const receipt = { version: 1, installId, action: 'install', status, target, startedAt, completedAt: nowIso(), error: String(error.message).slice(0, 300), rollbackErrors, counts: plan.counts, mutations: n };
    try { fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n'); } catch { /* 回执落盘失败不得吞掉原始错误 */ }
    // 回滚完整才清 staging；rollback-incomplete 保留备份目录供人工恢复（路径在回执可发现）
    if (!rollbackErrors.length) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* 保留 */ } }
    else receipt.stagingPreserved = staging;
    return { ok: false, error: error.message, rollback: { status, errors: rollbackErrors }, receipt: { ...receipt, path: receiptPath } };
  }
}

function gitTop(dir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return path.resolve(out);
  } catch { return null; }
}

// --verify：先 git add -A（不 stage 什么都没证明）再子进程跑安装副本的 doctor/selftest/skills-lint/catalog-lint。
// selftest/skills-lint 失败 → errors；doctor failing 与 catalog-lint 退出码 → warnings（新装仓的骨架态是预期，不是事故）。
function verifyInstalled(target, report) {
  const out = {};
  const top = gitTop(target);
  if (top === path.resolve(target)) {
    try {
      execFileSync('git', ['add', '-A', '--', '.'], { cwd: target, stdio: 'ignore' });
      out.staged = true;
    } catch (e) { report.warnings.push(`无法 stage 安装产物（${String(e.message).slice(0, 80)}）：catalog-lint 将度量空 tracked 集`); }
  } else if (!top) {
    report.warnings.push('非 git 仓：verify 只跑引擎自检，catalog-lint 无 tracked 路径可测（Run: git init）');
  } else {
    report.warnings.push(`目标在 ${top} 仓库内部：引擎将治理该树而非本子目录`);
  }
  const zbase = path.join(target, '.zcode', 'zbase.mjs');
  const zb = (args) => spawnSync(process.execPath, [zbase, ...args], { cwd: target, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  const parseJson = (stdout) => { try { return JSON.parse(stdout); } catch { return null; } };
  const doctor = zb(['doctor', '--json']);
  const doctorJson = parseJson(doctor.stdout);
  out.doctorFailing = doctorJson ? doctorJson.checks.filter((c) => !c.ok).map((c) => c.id) : ['<no output>'];
  if (out.doctorFailing.length) report.warnings.push(`安装副本 doctor failing：${out.doctorFailing.join(', ')}`);
  const selftest = zb(['selftest', '--json']);
  out.selftest = selftest.status;
  if (selftest.status !== 0) report.errors.push(`安装副本 selftest 失败（exit ${selftest.status}）`);
  const skills = zb(['skills-lint', '--json']);
  out.skillsLint = skills.status;
  if (skills.status !== 0) report.errors.push(`安装副本 skills-lint 失败（exit ${skills.status}）`);
  const hasCatalog = fs.existsSync(path.join(target, '.zcode', 'harness', 'module-catalog.json'));
  if (hasCatalog) {
    const cl = zb(['catalog-lint', '--json']);
    out.catalogLint = cl.status;
    const clJson = parseJson(cl.stdout);
    out.trackedPaths = clJson ? (clJson.totalPaths ?? null) : null;
    if (cl.status !== 0) report.warnings.push(`catalog-lint exit ${cl.status}：种入的 catalog 未归类本项目源（按 DFX 定档后重跑）`);
    if (out.trackedPaths === 0) report.warnings.push('catalog-lint 度量 0 tracked 路径——什么都没证明；stage 后重跑');
  } else out.catalogLint = null;
  return out;
}

export function install(targetDir, { hooks = false, dryRun = false, verify = false } = {}) {
  const target = path.resolve(targetDir);
  const report = { target, dryRun, copied: [], bypassed: [], skipped: [], seeded: [], removedObsolete: [], preservedObsolete: [], warnings: [], errors: [], counts: null };
  const fail = (msg) => { report.errors.push(msg); report.ok = false; return report; };
  try {
    if (!fs.existsSync(target)) { if (!dryRun) fs.mkdirSync(target, { recursive: true }); }
    else if (!fs.statSync(target).isDirectory()) return fail(`目标存在但不是目录：${target}`);
  } catch (e) { return fail(`目标不可创建/解析：${e.message}`); }
  if (isWithin(target, ROOT) || isWithin(ROOT, target)) return fail(`拒绝安装到源树内/覆盖源树：${target}`);

  // 用户级 hooks 注册先行（既有原则）：损坏配置尽早失败，此时目标树零写入。
  // 注册不参与目标仓事务与回滚（用户级配置全局共享、幂等、自带备份）；dry-run 一并跳写。
  if (dryRun) report.hooksRegistered = { would: true, note: 'dry-run：用户级 hooks 未注册（正式安装时注册到 ~/.zcode/cli/config.json）' };
  else {
    try { report.hooksRegistered = registerUserHooks(); }
    catch (e) { return fail(`用户级 hooks 注册失败：${e.message}`); }
  }

  let plan;
  try { plan = planInstall(target); }
  catch (e) { return fail(`安装计划失败：${e.message}`); }
  report.warnings.push(...plan.warnings);
  report.skipped.push(...plan.skipped);
  report.counts = plan.counts;
  for (const op of plan.ops) {
    if (op.kind === 'create' || op.kind === 'update') report.copied.push(op.rel);
    else if (op.kind === 'conflict') report.bypassed.push(`${op.rel} → ${op.sidecar}`);
    else if (op.kind === 'seed') report.seeded.push(op.rel);
    else if (op.kind === 'remove-obsolete') report.removedObsolete.push(op.rel);
    else if (op.kind === 'preserve-obsolete') report.preservedObsolete.push(op.rel);
  }

  const applied = applyTransaction(target, plan, { dryRun });
  if (applied.receipt) report.receipt = applied.receipt;
  if (!applied.ok) {
    report.rollback = applied.rollback;
    report.errors.push(`安装事务失败已回滚（status=${applied.rollback.status}）：${applied.error}${applied.rollback.errors.length ? `；回滚不完整项：${applied.rollback.errors.join(' | ')}` : ''}`);
  }

  if (hooks) {
    if (dryRun) report.gitHooks = { would: true, note: `dry-run：未接线（正式安装时 git config core.hooksPath ${HOOKS_DIR_REL}）` };
    else report.gitHooks = wireGitHooks(target);
  }
  if (verify) {
    if (dryRun) report.verify = { would: true, note: 'dry-run：未跑安装副本验证（正式安装时 stage + doctor/selftest/skills-lint/catalog-lint）' };
    else if (applied.ok) report.verify = verifyInstalled(target, report);
  }

  report.next = [
    '重启 ZCode 会话使用户级 hooks 生效（~/.zcode/cli/config.json）',
    'node .zcode/zbase.mjs catalog init（从仓库扫描生成模块骨架）',
    'node .zcode/zbase.mjs doctor',
    'bash setup.sh 或 git add . && commit（把脚手架纳入版本控制）',
    // Task 9.2 复制面/维护面分离（codex §2）：维护面不随安装分发——脚手架的项目记忆不是用户的项目记忆
    '维护面（tests/、docs/ 深研报告、Product-Spec/DEV-PLAN/progress/FRAMEWORK-MANIFEST）不随安装分发：目标项目按自身需求自建 Spec 与计划，不继承本仓的自举文档',
  ];
  if (hooks && report.gitHooks?.wired) report.next.push(`git hooks 已接线（core.hooksPath=${report.gitHooks.hooksPath}）——提交前将跑 sync-check/秘密扫描/按栈编译门`);
  if (hooks && report.gitHooks?.warning) report.next.push(report.gitHooks.warning);
  if (!dryRun && report.hooksRegistered?.backup) report.next.push(`已备份用户级 hooks 至 ${report.hooksRegistered.backup}（覆写前自动整文件备份）`);
  if (report.bypassed.length) report.next.push(`${report.bypassed.length} 个文件与目标现存内容不同已旁路（.zbase-new）：人工比对后自选采纳`);
  if (report.preservedObsolete.length) report.next.push(`${report.preservedObsolete.length} 个已删除面文件目标侧被改过，留置待人工处置：${report.preservedObsolete.slice(0, 5).join(', ')}`);
  report.ok = report.errors.length === 0;
  return report;
}

// uninstall：只删仍等于基线的受管文件（LF 归一比对）+ 清空目录；被改过的留置并列出（他方定制优先）。
// 同为事务性：备份进目标仓外 staging → 删 → post-verify → 失败逆序回滚。
export function uninstall(targetDir, { dryRun = false } = {}) {
  const target = path.resolve(targetDir);
  const report = { target, dryRun, removed: [], preserved: [], skipped: [], removedDirs: [], warnings: [], errors: [] };
  const manifestPath = path.join(target, TARGET_MANIFEST);
  let manifest = null;
  try { manifest = readJson(manifestPath); }
  catch (e) { report.errors.push(`无可读安装清单：${e.message}——uninstall 只删有基线记录的受管文件，不盲扫`); report.ok = false; return report; }
  if (!manifest?.files || typeof manifest.files !== 'object') { report.errors.push('安装清单结构非法（无 files 表）'); report.ok = false; return report; }

  const ops = [];
  for (const [r, baseHash] of Object.entries(manifest.files)) {
    if (!INSTALL_SURFACE(r)) continue;
    let cur;
    try { cur = fileLfHash(safeManagedPath(target, r)); }
    catch (e) { report.errors.push(e.message); continue; }
    if (cur === null) { report.skipped.push(`${r}（已不存在）`); continue; }
    if (cur === baseHash) ops.push({ kind: 'remove', rel: r });
    else { ops.push({ kind: 'preserve', rel: r }); }
  }
  ops.push({ kind: 'remove-manifest', rel: TARGET_MANIFEST });
  report.preserved = ops.filter((o) => o.kind === 'preserve').map((o) => o.rel);
  if (dryRun) {
    report.wouldRemove = ops.filter((o) => o.kind === 'remove' || o.kind === 'remove-manifest').map((o) => o.rel);
    report.ok = true;
    report.note = 'dry-run：未删除任何文件';
    return report;
  }

  const installId = `${Date.now()}-${process.pid}-${crypto.randomUUID()}`;
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-uninstall-'));
  const receiptPath = path.join(os.tmpdir(), `zbase-install-receipt-${installId}.json`);
  const applied = [];
  const rollbackErrors = [];
  const startedAt = nowIso();
  try {
    for (const op of ops) {
      if (op.kind === 'preserve') continue;
      const dest = safeManagedPath(target, op.rel);
      if (!fs.existsSync(dest)) continue;
      const backup = path.join(staging, 'backup', String(applied.length));
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(dest, backup);
      applied.push({ dest, backup, rel: op.rel });
      fs.rmSync(dest, { force: true });
      report.removed.push(op.rel);
    }
    for (const item of applied) {
      if (fs.existsSync(item.dest)) throw new Error(`uninstall post-verify 失败：${item.rel} 仍存在`);
    }
    // 清空目录：被删文件的父目录链，深→浅，只删真空目录
    const dirs = new Set();
    for (const op of ops) {
      if (op.kind !== 'remove' && op.kind !== 'remove-manifest') continue;
      let d = path.posix.dirname(op.rel);
      while (d !== '.' && d !== '/') { dirs.add(d); d = path.posix.dirname(d); }
    }
    for (const d of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) {
      try { fs.rmdirSync(path.join(target, d)); report.removedDirs.push(d); }
    catch (e) { if (!['ENOTEMPTY', 'ENOENT', 'EEXIST'].includes(e.code)) throw e; }
    }
    const receipt = { version: 1, installId, action: 'uninstall', status: 'committed', target, startedAt, completedAt: nowIso(), removed: report.removed.length, preserved: report.preserved.length };
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    fs.rmSync(staging, { recursive: true, force: true });
    report.receipt = { ...receipt, path: receiptPath };
    report.ok = report.errors.length === 0;
    return report;
  } catch (error) {
    for (const item of [...applied].reverse()) {
      try { fs.copyFileSync(item.backup, item.dest); } catch (re) { rollbackErrors.push(`${item.rel}: ${re.message}`); }
    }
    const status = rollbackErrors.length ? 'rollback-incomplete' : 'rolled-back';
    const receipt = { version: 1, installId, action: 'uninstall', status, target, startedAt, completedAt: nowIso(), error: String(error.message).slice(0, 300), rollbackErrors };
    try { fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n'); } catch { /* 不吞原始错误 */ }
    if (!rollbackErrors.length) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* 保留 */ } }
    else receipt.stagingPreserved = staging;
    report.rollback = { status, errors: rollbackErrors };
    report.receipt = { ...receipt, path: receiptPath };
    report.removed = [];
    report.errors.push(`卸载事务失败已回滚（status=${status}）：${error.message}`);
    report.ok = false;
    return report;
  }
}

// git hooks 接线：目标目录内 git config core.hooksPath .zcode/githooks；chmod +x 三钩子；
// 既有 hooksPath ≠ 本框架 → 不覆盖只告警（他方定制优先）。目标非 git 仓 → 说明性结果。
const HOOKS_DIR_REL = '.zcode/githooks';
const HOOK_FILES = ['pre-commit', 'commit-msg', 'pre-push'];
export function wireGitHooks(target) {
  const hooksDir = path.join(target, HOOKS_DIR_REL);
  const result = { hooksPath: HOOKS_DIR_REL, wired: false };
  if (!fs.existsSync(hooksDir)) {
    result.warning = `git hooks 未接线：${HOOKS_DIR_REL} 不存在（脚手架未完整安装？）`;
    return result;
  }
  for (const f of HOOK_FILES) {
    const p = path.join(hooksDir, f);
    if (fs.existsSync(p)) fs.chmodSync(p, 0o755);
  }
  try {
    const existing = execFileSync('git', ['-C', target, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (existing && existing !== HOOKS_DIR_REL) {
      result.warning = `git hooks 未接线：core.hooksPath 已为 ${existing}（他方 hooks）——不覆盖；如需本框架接管请人工执行 git config core.hooksPath ${HOOKS_DIR_REL}`;
      return result;
    }
  } catch { /* 无既有值 → 直接设置 */ }
  try {
    execFileSync('git', ['-C', target, 'config', 'core.hooksPath', HOOKS_DIR_REL], { stdio: 'ignore' });
    result.wired = true;
  } catch (e) {
    result.warning = `git hooks 接线失败（目标可能不是 git 仓）：${e.message.slice(0, 120)}`;
  }
  return result;
}

// 用户级 hooks 注册面：7 事件 8 条（PreToolUse 占 2 条 matcher 组）。
// command 用自检 wrapper：当前项目无 .zcode/zbase.mjs 则 exit 0 静默放行（用户级全局生效，非 zcode-base 项目不扰），有则透传 node 退出码。
export function userHooksSpec() {
  const hook = (event, timeout, statusMessage) => ({
    hooks: [{ type: 'command', command: wrapHook(event), timeout, statusMessage }],
  });
  const hookWithMatcher = (matcher, event, timeout, statusMessage) => ({
    matcher, hooks: [{ type: 'command', command: wrapHook(event), timeout, statusMessage }],
  });
  return {
    enabled: true,
    timeoutMs: 30000,
    maxOutputBytes: 65536,
    events: {
      SessionStart: [hook('session-start', 15, 'zcode-base 会话恢复')],
      UserPromptSubmit: [hook('user-prompt-submit', 10, 'zcode-base 反馈信号检测')],
      PreToolUse: [
        hookWithMatcher('Bash', 'pre-tool-use', 15, 'zcode-base 危险命令门禁'),
        hookWithMatcher('Edit|Write|ApplyPatch', 'pre-tool-use', 15, 'zcode-base 保护路径门禁'),
      ],
      PermissionRequest: [hookWithMatcher('Bash', 'permission-request', 15, 'zcode-base 权限复核')],
      PostToolUse: [hookWithMatcher('Bash', 'post-tool-use', 10, 'zcode-base 执行留痕')],
      PostToolUseFailure: [hook('post-tool-use-failure', 10, 'zcode-base 失败留痕')],
      Stop: [hook('stop', 20, 'zcode-base Stop 验证门')],
    },
  };
}

// ZCODE_PROJECT_DIR 由 ZCode 客户端在 hook 运行时按项目展开——JSON 里必须是字面量，不能被 JS 模板插值吃掉
const ZPD = '${ZCODE_PROJECT_DIR}';
const wrapHook = (event) => `if [ -f "${ZPD}/.zcode/zbase.mjs" ]; then node "${ZPD}/.zcode/zbase.mjs" hook ${event}; else exit 0; fi`;

// 注册到用户级 ~/.zcode/cli/config.json：只覆写 hooks 键，保留其余键（mcp.servers 等用户数据）；幂等（覆写非 append）。
// 覆写前备份：已有 hooks 与 spec 不等（用户/第三方注册）→ 整个旧 config.json 原样备份为同目录 config.json.bak-zbase-<ISO时间戳>；
// 等值覆写（幂等重装）不产生备份。用户级配置不受版本控制，丢了不可恢复，故备份先于覆写。
export function registerUserHooks() {
  const file = userConfigPath();
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = readJson(file); } catch (e) { throw new Error(`用户级配置 ${file} 解析失败：${e.message}——人工修复后重跑 install`); }
  }
  const spec = userHooksSpec();
  let backup = null;
  if (cfg.hooks && JSON.stringify(cfg.hooks) !== JSON.stringify(spec)) {
    backup = `${file}.bak-zbase-${nowIso()}`;
    fs.copyFileSync(file, backup);
  }
  cfg.hooks = spec; // 覆写：重复 install 不堆叠
  writeJsonAtomic(file, cfg);
  const commands = Object.values(spec.events).flat().reduce((n, group) => n + group.hooks.length, 0);
  return { file, events: Object.keys(spec.events).length, commands, backup };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}


// ══════════════════ 原 manifest.mjs ═══════════════════

// FRAMEWORK-MANIFEST 维护：LF 规范化 SHA-256 清单，支撑安装器安全升级。

// 安装面（v2.0 单目录封装）：.zcode/ 整体 + 根级文件；运行态 .zcode/state/ 永不入清单。
export const SURFACE = [
  'AGENTS.md',
  '.zcode',
  'setup.sh',
  'package.json',
  'README.md',
];

const MANIFEST_EXCLUDE_PREFIX = ['.zcode/state/'];

function walkManifest(file, prefix = '') {
  const st = fs.statSync(file);
  if (st.isFile()) return [file];
  const out = [];
  for (const e of fs.readdirSync(file, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.tmp-')) continue;
    const childPrefix = prefix ? `${prefix}/${e.name}` : e.name;
    if (MANIFEST_EXCLUDE_PREFIX.some((p) => `${childPrefix}/`.startsWith(p))) continue;
    out.push(...walkManifest(path.join(file, e.name), childPrefix));
  }
  return out;
}

function fileHash(file) {
  const content = fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n');
  return sha256(content);
}

export function generate() {
  const files = {};
  for (const item of SURFACE) {
    const p = path.join(ROOT, item);
    if (!fs.existsSync(p)) continue;
    for (const f of walkManifest(p, item)) files[rel(ROOT, f)] = fileHash(f);
  }
  const manifest = { name: 'zcode-base', version: readVersion(), algorithm: 'sha256-lf-v1', generatedAt: nowIso(), files };
  fs.writeFileSync(FILES.manifest, JSON.stringify(manifest, null, 2) + '\n');
  return { ok: true, files: Object.keys(files).length, manifest: rel(ROOT, FILES.manifest) };
}

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
}

export function check() {
  if (!fs.existsSync(FILES.manifest)) return { ok: false, reason: 'FRAMEWORK-MANIFEST.json 不存在，先 manifest generate' };
  const m = JSON.parse(fs.readFileSync(FILES.manifest, 'utf8'));
  const drift = [];
  for (const [rp, hash] of Object.entries(m.files || {})) {
    const abs = path.join(ROOT, rp);
    if (!fs.existsSync(abs)) { drift.push({ file: rp, code: 'MISSING' }); continue; }
    if (fileHash(abs) !== hash) drift.push({ file: rp, code: 'MODIFIED' });
  }
  // 新增未登记文件（安装面内）
  const known = new Set(Object.keys(m.files || {}));
  for (const item of SURFACE) {
    const p = path.join(ROOT, item);
    if (!fs.existsSync(p)) continue;
    for (const f of walkManifest(p, item)) {
      const rp = rel(ROOT, f);
      if (!known.has(rp)) drift.push({ file: rp, code: 'UNTRACKED' });
    }
  }
  return { ok: drift.length === 0, drift, tracked: known.size };
}
