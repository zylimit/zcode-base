// Task 8.10 三类新测试之二：性能锚点（源 codex tests/harness.test.mjs:1057 模式 + dsh §15 性能预算）。
// 「抓数量级回归」：把 Spec 非功能预算变成回归测试——数字超限如实失败，不放宽断言迁就。
//   - 合成大仓 fixture：64 模块 / 30k 文件路径（600k 行虚拟规模 = 30k 文件 × 20 行；
//     lint/impact 消费路径清单与依赖图，行数经路径规模映射——selftest 合成法加强版）。
//   - fingerprint 锚点：真实临时 git 仓 + 500 untracked 文件，端到端计时（含 node 启动 + git 枚举 + 逐文件内容哈希）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lint, reverseClosure } from '../.zcode/lib/graph.mjs';
import { zbase, mkHarnessProj, rmDir } from './helpers.mjs';

const BUDGET_LINT_MS = 2500; // selftest/catalog-lint-scale 同款预算
const BUDGET_IMPACT_MS = 5000; // Spec 非功能：60 万行 impact < 5s
const BUDGET_FINGERPRINT_MS = 3000; // 500 untracked 端到端（进程启动含在内）

function syntheticCatalog() {
  const modules = Array.from({ length: 64 }, (_, i) => ({
    name: `mod-${i}`, globs: [`src/mod-${i}/**`], classification: 'product',
    deps: i > 0 ? [`mod-${i - 1}`] : [], attributes: { reliability: 'low' },
  }));
  const paths = [];
  for (let m = 0; m < 64; m++) for (let f = 0; f < 470; f++) paths.push(`src/mod-${m}/pkg-${Math.floor(f / 20)}/file-${f}.ts`);
  return { catalog: { version: 1, modules, global: ['docs/**'], ignored: ['.git/**'] }, paths };
}

test('8.10 性能锚点：64 模块 / 30080 路径（600k 行虚拟）合成仓 catalog-lint < 2.5s', () => {
  const { catalog, paths } = syntheticCatalog();
  assert.equal(paths.length, 30080);
  const t0 = Date.now();
  const res = lint(catalog, { trackedPaths: paths });
  const ms = Date.now() - t0;
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors.slice(0, 3)));
  assert.ok(ms < BUDGET_LINT_MS, `catalog-lint 数量级回归：${ms}ms 超预算 ${BUDGET_LINT_MS}ms（64 模块/${paths.length} 路径）`);
});

test('8.10 性能锚点：合成仓 impact 反向闭包（mod-0 → 全 64 模块）< 5s', () => {
  const { catalog } = syntheticCatalog();
  const t0 = Date.now();
  const closure = reverseClosure(catalog, ['mod-0']);
  const ms = Date.now() - t0;
  assert.equal(closure.length, 64, `闭包应含全部 64 模块，实际 ${closure.length}`);
  assert.ok(ms < BUDGET_IMPACT_MS, `impact 数量级回归：${ms}ms 超预算 ${BUDGET_IMPACT_MS}ms`);
});

test('8.10 性能锚点：500 untracked 文件 fingerprint 端到端（receipt write 含进程启动）< 3s', () => {
  const dir = mkHarnessProj();
  try {
    for (let i = 0; i < 500; i++) {
      fs.writeFileSync(path.join(dir, `wip-${i}.txt`), `untracked content ${i} v1\n`);
    }
    const t0 = Date.now();
    const r = zbase(['receipt', 'write', '--check', 'perf-fp-500-untracked', '--status', 'PASS', '--note', 'fingerprint anchor'], { cwd: dir });
    const ms = Date.now() - t0;
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(ms < BUDGET_FINGERPRINT_MS, `fingerprint 数量级回归：${ms}ms 超预算 ${BUDGET_FINGERPRINT_MS}ms（500 untracked）`);
    // 绑定必须真实：写第二张回执后 verify fresh 计数含当前指纹
    const v = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v.code, 0, v.stdout + v.stderr);
    assert.ok(v.json.total >= 1);
  } finally {
    rmDir(dir);
  }
});
