// doctor：环境自检。selftest：规模冒烟。install：安全安装/升级到目标项目。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DIRS, FILES, catalogExists, loadHarnessConfig, userConfigPath } from './config.mjs';
import { readJson, writeJsonAtomic, rel, sha256, nowIso, matchAny } from './common.mjs';
import { loadCatalog, lint } from './catalog.mjs';
import { listPaths } from './git.mjs';
import { verifyLedger } from './receipts.mjs';
import { audit as fitnessAudit } from './fitness.mjs';
import { reverseClosure } from './impact.mjs';

export function doctor() {
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, ok, detail });

  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  check('node-version', nodeMajor >= 18, `Node ${process.versions.node}（需要 >=18）`);

  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); check('git', true, 'git 可用'); }
  catch { check('git', false, 'git 不可用：账本 fingerprint 依赖 git'); }

  for (const [id, dir] of [['harness', DIRS.harness], ['runtime', DIRS.runtime], ['skills', DIRS.skills], ['commands', DIRS.commands], ['rules', path.join(ROOT, 'rules')], ['docs', DIRS.docs]]) {
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
    check('hooks-events', false, '修复：node runtime/zbase.mjs install <dir>（注册用户级 hooks 到 ~/.zcode/cli/config.json）');
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

  const ok = checks.every((c) => c.ok);
  return { ok, checks, at: nowIso() };
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

// install：把脚手架核心面安装到目标项目（manifest 哈希安全升级 + 定制旁路）。
export function install(targetDir) {
  const target = path.resolve(targetDir);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  // 用户级 hooks 注册先行：用户配置损坏时尽早失败（目标树此时仅有空目录，零文件写入）
  const hooksRegistered = registerUserHooks();
  const surface = ['AGENTS.md', '.zcode/config.json', '.agents/skills', '.agents/commands', '.agents/feedback', 'rules', 'docs', 'runtime', 'harness/schemas', 'harness/templates', 'harness/harness.json', 'scripts/gen-manifest.mjs'];
  const report = { copied: [], bypassed: [], skipped: [], target };
  report.hooksRegistered = hooksRegistered;
  const oldManifestPath = path.join(target, 'FRAMEWORK-MANIFEST.json');
  const oldManifest = fs.existsSync(oldManifestPath) ? readJson(oldManifestPath) : null;
  const newManifest = fs.existsSync(FILES.manifest) ? readJson(FILES.manifest) : null;

  for (const item of surface) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) { report.skipped.push(`${item}（源缺失）`); continue; }
    // 逐文件处理（目录递归）
    const files = fs.statSync(src).isDirectory() ? walk(src) : [src];
    for (const file of files) {
      const relPath = rel(ROOT, file);
      const dest = path.join(target, relPath);
      const destExists = fs.existsSync(dest);
      if (destExists) {
        const destHash = sha256(fs.readFileSync(dest));
        const oldHash = oldManifest?.files?.[relPath];
        if (oldHash && destHash !== oldHash) {
          // 目标文件已被项目定制：旁路，不改写
          fs.mkdirSync(path.dirname(`${dest}.zbase-new`), { recursive: true });
          fs.copyFileSync(file, `${dest}.zbase-new`);
          report.bypassed.push(`${relPath} → ${relPath}.zbase-new`);
          continue;
        }
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, dest);
      report.copied.push(relPath);
    }
  }
  // 目标项目没有 catalog 时提供空骨架说明（不强造）
  const targetCatalog = path.join(target, 'harness', 'module-catalog.json');
  if (!fs.existsSync(targetCatalog)) {
    fs.mkdirSync(path.join(target, 'harness'), { recursive: true });
    fs.writeFileSync(targetCatalog, JSON.stringify({
      version: 1, layers: [], modules: [], global: ['docs/**', '*.md'],
      ignored: ['.git/**', '.zbase/**', 'node_modules/**', '*.zbase-new'], catchAll: null,
    }, null, 2) + '\n');
    report.copied.push('harness/module-catalog.json（空骨架，运行 catalog init 生成）');
  }
  // starter verification-matrix：起步即可用的治理自检（项目检查随后按 DFX 定档补充）
  const targetMatrix = path.join(target, 'harness', 'verification-matrix.json');
  if (!fs.existsSync(targetMatrix)) {
    fs.mkdirSync(path.join(target, 'harness'), { recursive: true });
    fs.writeFileSync(targetMatrix, JSON.stringify({
      version: 1,
      checks: [
        { name: 'zbase-doctor', command: 'node runtime/zbase.mjs doctor', proves: ['reliability'], scope: [], tier: 'medium', description: '治理面环境自检' },
        { name: 'zbase-secret-scan', command: "! grep -rInE 'AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY' . --include='*.ts' --include='*.js' --include='*.py' --include='*.go' --include='*.java' 2>/dev/null", proves: ['security', 'privacy'], scope: [], tier: 'high', description: '秘密不入库扫描（按项目语言调整 include）' },
      ],
    }, null, 2) + '\n');
    report.copied.push('harness/verification-matrix.json（starter，按 DFX 定档扩充）');
  }
  // 复制 manifest 供下次升级判基线
  if (newManifest) {
    fs.copyFileSync(FILES.manifest, oldManifestPath);
  }
  report.next = [
    '重启 ZCode 会话使用户级 hooks 生效（~/.zcode/cli/config.json）',
    'node runtime/zbase.mjs catalog init（从仓库扫描生成模块骨架）',
    'node runtime/zbase.mjs doctor',
    'bash setup.sh 或 git add . && commit（把脚手架纳入版本控制）',
  ];
  if (hooksRegistered.backup) report.next.push(`已备份用户级 hooks 至 ${hooksRegistered.backup}（覆写前自动整文件备份）`);
  return report;
}

// 用户级 hooks 注册面：7 事件 8 条（PreToolUse 占 2 条 matcher 组）。
// command 用自检 wrapper：当前项目无 runtime/zbase.mjs 则 exit 0 静默放行（用户级全局生效，非 zcode-base 项目不扰），有则透传 node 退出码。
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
const wrapHook = (event) => `if [ -f "${ZPD}/runtime/zbase.mjs" ]; then node "${ZPD}/runtime/zbase.mjs" hook ${event}; else exit 0; fi`;

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
