#!/usr/bin/env node
// 本地一键复刻 CI 全序列（批次 6，源 cc 248219a 论点：只放 CI 就重演「本地跑的和 CI 跑的不是
// 同一件事」——本地绿但 CI 红时，排障的第一嫌疑就是两处跑的序列根本不同）。
//
// 序列 = .github/workflows/gate.yml 的完整步骤序列（selftest → skills-lint → scan-instructions
// → catalog lint → npm test → manifest check → gate 连发 → dod）。gate 连发不硬编码检查名：
// 从 verification-matrix.json 读「带 command 的 checks」（与 gate.yml 的 Quality gates 步同源
// ——matrix 是唯一事实源，CI 手写清单漂移时这里自动跟随）。
//
// 刻意不跑的 CI 步骤（取舍写明，不是遗漏）：
//   - install 冒烟：CI 在 ephemeral HOME 里向临时目录注册 hooks（隔离验证），本地没有等价的
//     一次性 HOME——向真实 HOME 写入不属于「本地回归」的副作用面。
//   - release / ci-status 类：发版面证据装配，与日常回归混跑会把发版判定污染进日常账本。
//   - coverage 与 risk scan：CI 中标注 continue-on-error（advisory），不阻断也不在本序列；
//     需要时单独跑 npm run coverage / node .zcode/zbase.mjs risk scan。
//   - test log 上传：CI artifact 机制，本地无对应物（失败输出直接打印尾部）。
//
// 任一步失败立即停（fail-visible）+ 打印该步输出尾部 + 汇总；全绿 exit 0。
// 注意：gate 连发会自落回执（.zcode/state 不入 git），dod 在序列末尾正好消费这些新鲜回执。
// 存在活跃任务时 gate 走 verification plan 组队执法（CHECK_NOT_PLANNED 会拒未组队检查）——
// 那是特性不是缺陷；日常回归建议在无活跃任务的工作树上跑。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const zbaseArgs = (args) => [path.join('.zcode', 'zbase.mjs'), ...args];

// gate.yml Quality gates 步的数据源：matrix 中带 command 的检查（顺序 = matrix 声明序，不硬编码）。
function gatedChecks() {
  const matrix = JSON.parse(fs.readFileSync(path.join(root, '.zcode', 'harness', 'verification-matrix.json'), 'utf8'));
  return (matrix.checks || []).filter((c) => c.command);
}

// 固定序列（gate 连发之前/之后的步骤与 gate.yml 一一对应；ci = CI 里的步骤名）。
function steps() {
  const fixed = [
    { name: 'selftest', ci: 'Engine self-test', cmd: ['node', zbaseArgs(['selftest'])] },
    { name: 'skills-lint', ci: 'Skills lint', cmd: ['node', zbaseArgs(['skills-lint'])] },
    { name: 'scan-instructions', ci: 'Instruction files security scan', cmd: ['node', zbaseArgs(['scan-instructions'])] },
    { name: 'catalog lint', ci: 'Module catalog lint', cmd: ['node', zbaseArgs(['catalog', 'lint'])] },
    { name: 'npm test', ci: 'Unit tests', cmd: [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test']] },
    { name: 'manifest check', ci: 'Integrity manifest', cmd: ['node', zbaseArgs(['manifest', 'check'])] },
  ];
  const gates = gatedChecks().map((c) => ({
    name: `gate ${c.name}`, ci: `Quality gates (${c.name})`, cmd: ['node', zbaseArgs(['gate', c.name])],
  }));
  return [...fixed, ...gates, { name: 'dod', ci: 'Definition of Done (static aggregation)', cmd: ['node', zbaseArgs(['dod'])] }];
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const TAIL_LINES = 40;

function run() {
  // --list：只打印序列不执行（人类核对与 CI 步骤对账用；测试消费同一出口）
  if (process.argv.includes('--list')) {
    for (const s of steps()) process.stdout.write(`${s.name}\t# CI: ${s.ci}\n`);
    return;
  }
  const list = steps();
  const totalStart = Date.now();
  process.stdout.write(`[run-all] 本地复刻 CI 全序列（gate.yml 同源，${list.length} 步；gate 连发自 matrix 动态取）\n`);
  let failed = null;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const start = Date.now();
    const r = spawnSync(s.cmd[0], s.cmd[1], { cwd: root, encoding: 'utf8', timeout: 600_000, windowsHide: true });
    const ms = Date.now() - start;
    const ok = r.status === 0;
    process.stdout.write(`${ok ? '✅' : '❌'} ${s.name} (${secs(ms)})\n`);
    if (!ok) {
      failed = { ...s, index: i + 1, exit: r.status };
      const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');
      process.stdout.write(`\n--- ${s.name} 输出尾部（exit ${r.status}；CI 对应步骤「${s.ci}」）---\n${out || '(无输出)'}\n--- 结束 ---\n`);
      break; // fail-visible：任一步失败立即停
    }
  }
  const total = secs(Date.now() - totalStart);
  if (failed) {
    process.stderr.write(`\n[run-all] 失败于第 ${failed.index}/${list.length} 步：${failed.name}（exit ${failed.exit}；CI 对应步骤「${failed.ci}」）。总耗时 ${total}。\n`);
    process.exit(1);
  }
  process.stdout.write(`[run-all] 全序列绿：${list.length}/${list.length} 步，总耗时 ${total}（gate 回执已自落，dod 已聚合）。\n`);
}

run();
