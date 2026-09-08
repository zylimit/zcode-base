// E1-1 审计独立性禁边（kimi ADR-0002 轻量版，2026-09-08）：
// 分发面验证器不得 import .zcode/lib/*（引擎实现）——引擎缺陷无法让审计沉默。
// 双执法面：本测试（静态 import 检查）+ module-catalog forbidden 边（installer→lib-*，
// arch check 对真实 import 出 FORBIDDEN_EDGE）。
//
// 现状盘点（本批落地时点，与 docs/OPERATIONS.md「审计独立性边界」一致）：
//   独立验证器（本测试钉死）：run-tests.mjs / run-all.mjs（node 内建 only）、
//     make-release.sh（sh，无 import 面，泄漏自验内建）、gen-manifest.mjs（刻意双实现：
//     原为薄壳 import lib/doctor.mjs——引擎耦合，本批重写为 node 内建独立实现，
//     输出与引擎 manifest generate/check 字节兼容，见下方双实现互证用例）。
//   引擎自审（诚实边界）：selftest / doctor / `zbase manifest check` 仍是引擎的一部分——
//     反共谋的完整解（独立审计 CLI 全面双实现）明确记为远期，不做虚声明。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(REPO, '.zcode', 'scripts');

// 检测逻辑纯化（沙箱负例用内存字符串测，不落真违规文件）：
// 提取 ESM/CJS 全部静态与动态 import 说明符；相对路径解析到仓根后落在 .zcode/lib/ 内 = 命中。
// 刻意不 import 引擎的 graph.extractImports——独立性测试自己不得依赖被审对象（自举无效，kimi 语义）。
const IMPORT_SPEC_RE = /(?:import\s+(?:[\s\S]*?)\s+from\s*|import\s*|export\s+(?:[\s\S]*?)\s+from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

export function engineImportsOf(source, relFile) {
  const dir = path.posix.dirname(String(relFile));
  const hits = [];
  for (const m of String(source).matchAll(IMPORT_SPEC_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // 包名导入 / node: 内建不管
    const resolved = path.posix.normalize(path.posix.join(dir, spec));
    if (resolved === relFile) continue; // 自引用不算
    if (resolved.startsWith('.zcode/lib/')) hits.push({ spec, resolved });
  }
  return hits;
}

// 派单点名目标集（删除其中任一件 = 独立性回退，同样红）；目录内其余 .mjs 一并纳管（新验证器生来受钉）
const PINNED = ['gen-manifest.mjs', 'run-tests.mjs', 'run-all.mjs'];

test('E1-1a 目标集验证器零引擎 import——独立性钉死，未来加引擎 import 当场红', () => {
  const onDisk = new Set(fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')));
  for (const name of PINNED) {
    assert.ok(onDisk.has(name), `验证器 ${name} 缺失——目标集被删也是独立性回退`);
    const hits = engineImportsOf(fs.readFileSync(path.join(SCRIPTS, name), 'utf8'), `.zcode/scripts/${name}`);
    assert.deepEqual(hits, [], `${name} 不得 import .zcode/lib/*（引擎实现）：${JSON.stringify(hits)}`);
  }
  for (const name of onDisk) {
    const hits = engineImportsOf(fs.readFileSync(path.join(SCRIPTS, name), 'utf8'), `.zcode/scripts/${name}`);
    assert.deepEqual(hits, [], `.zcode/scripts/ 全目录纳管：${name} 不得 import .zcode/lib/*`);
  }
});

test('E1-1b 检测逻辑沙箱负例（内存字符串，不落违规文件）：三类 import 形态全拦、良性导入放行', () => {
  const rel = '.zcode/scripts/probe.mjs';
  // 命中面：静态 import / 动态 import() / export-from / lib 旧路径 shim
  assert.equal(engineImportsOf("import { generate } from '../lib/doctor.mjs';\n", rel).length, 1, '静态 import 命中');
  assert.equal(engineImportsOf("const m = await import('../lib/core.mjs');\n", rel).length, 1, '动态 import() 命中');
  assert.equal(engineImportsOf("export * from '../lib/quality.mjs';\n", rel).length, 1, 'export-from 命中');
  assert.equal(engineImportsOf("export { x } from '../lib/common.mjs';\n", rel).length, 1, 'lib/ 旧路径 shim 同样算引擎');
  // 良性面：node 内建 / 兄弟文件 / 仓根非 lib / 纯注释提及
  assert.deepEqual(engineImportsOf("import fs from 'node:fs';\nimport path from 'node:path';\n", rel), [], 'node 内建放行');
  assert.deepEqual(engineImportsOf("import { x } from './sibling.mjs';\n", rel), [], '同目录兄弟文件放行');
  // 拼装纪律（同 batch12 令牌字面量先例）：合成字面量不落连续 `from '<路径>'` 形态——
  // arch 边扫描静态读源码，完整形态会被当真边计 UNDECLARED_DEP（E2 重落 gate 实证）。
  assert.deepEqual(engineImportsOf("import pkg from '../package" + ".json';\n", rel), [], '仓根非 lib 放行');
  assert.deepEqual(engineImportsOf("// 提及 ../lib/doctor.mjs 于注释，无 import 语句\n", rel), [], '注释文本不算 import');
});

test('E1-1c 双实现互证：gen-manifest（独立实现）与引擎 manifest 在沙箱同判同哈希口径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zbase-indep-'));
  const genManifest = (args) => spawnSync(process.execPath, [path.join(dir, '.zcode', 'scripts', 'gen-manifest.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  try {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# t\n');
    fs.cpSync(path.join(REPO, '.zcode'), path.join(dir, '.zcode'), { recursive: true });
    fs.rmSync(path.join(dir, '.zcode', 'state'), { recursive: true, force: true });
    // 独立实现 generate：真产出清单
    const g1 = genManifest([]);
    assert.equal(g1.status, 0, `gen-manifest generate：${g1.stdout}${g1.stderr}`);
    const g1json = JSON.parse(g1.stdout);
    assert.ok(g1json.ok && g1json.files > 0, '独立实现须真产出清单（files > 0）');
    assert.ok(fs.existsSync(path.join(dir, 'FRAMEWORK-MANIFEST.json')));
    // 引擎实现对独立实现产物 check 通过（两实现哈希口径一致 = LF 归一 sha256——双实现漂移的互证锚）
    const e1 = spawnSync(process.execPath, [path.join(dir, '.zcode', 'zbase.mjs'), 'manifest', 'check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(e1.status, 0, `引擎对独立实现产物的 check 须过（口径漂移即红）：${e1.stdout}${e1.stderr}`);
    // 独立实现自 check 通过；篡改后 exit 3 点名 MODIFIED（审计真在审，不是摆设）
    const c1 = genManifest(['check']);
    assert.equal(c1.status, 0, `gen-manifest check：${c1.stdout}${c1.stderr}`);
    fs.appendFileSync(path.join(dir, '.zcode', 'scripts', 'run-tests.mjs'), '\n// drift\n');
    const c2 = genManifest(['check']);
    assert.equal(c2.status, 3, '篡改后独立实现须 exit 3');
    assert.ok(JSON.parse(c2.stdout).drift.some((d) => d.code === 'MODIFIED'), '须点名 MODIFIED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
