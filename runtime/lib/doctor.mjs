// doctor：环境自检。selftest：规模冒烟。install：安全安装/升级到目标项目。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DIRS, FILES, catalogExists, loadHarnessConfig } from './config.mjs';
import { readJson, rel, sha256, nowIso, matchAny } from './common.mjs';
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

  // hooks 注册面
  const zcodeConfig = path.join(ROOT, '.zcode', 'config.json');
  if (fs.existsSync(zcodeConfig)) {
    try {
      const cfg = readJson(zcodeConfig);
      const events = Object.keys(cfg.hooks?.events || {});
      const need = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop'];
      const missing = need.filter((e) => !events.includes(e));
      check('hooks-enabled', cfg.hooks?.enabled === true, cfg.hooks?.enabled === true ? 'hooks.enabled=true' : 'hooks 未启用（.zcode/config.json 需 hooks.enabled=true）');
      check('hooks-events', missing.length === 0, missing.length ? `缺事件：${missing.join(',')}` : `7 事件全注册（${events.length}）`);
    } catch (e) { check('hooks-config', false, `.zcode/config.json 解析失败：${e.message}`); }
  } else check('hooks-config', false, '.zcode/config.json 不存在');

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
  const surface = ['AGENTS.md', '.zcode/config.json', '.agents/skills', '.agents/commands', '.agents/feedback', 'rules', 'docs', 'runtime', 'harness/schemas', 'harness/templates', 'harness/harness.json', 'scripts/gen-manifest.mjs'];
  const report = { copied: [], bypassed: [], skipped: [], target };
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
    'node runtime/zbase.mjs catalog init（从仓库扫描生成模块骨架）',
    'node runtime/zbase.mjs doctor',
    'bash setup.sh 或 git add . && commit（把脚手架纳入版本控制）',
  ];
  return report;
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
