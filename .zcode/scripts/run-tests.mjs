#!/usr/bin/env node
// 测试 launcher（Task 8.10，源 dsh audit/run-tests.mjs 模式）。
//
// Node 20 的 test runner 不展开 glob：`node --test tests/*.test.mjs` 在 20 上按字面路径失败
// （22+ 才自行展开）。本 launcher 用 readdir 展开为显式文件列表再 spawn `node --test`，
// 同一条 npm test 命令在 18/20/22/24 行为一致（Node 18 无 --test，要求 >=20 跑测试；
// 引擎本体仍支持 >=18）。
//
// 无测试文件 → exit 3（nothing proved）：空跑不是通过，是「什么都没证明」。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, 'tests');
if (!fs.existsSync(dir)) {
  process.stderr.write(`run-tests: no tests directory at ${dir}\n`);
  process.exit(3);
}
const files = fs.readdirSync(dir)
  .filter((f) => /\.test\.mjs$/.test(f))
  .sort()
  .map((f) => path.join('tests', f));

if (files.length === 0) {
  process.stderr.write('run-tests: no *.test.mjs files under tests/; nothing ran, so nothing is proven\n');
  process.exit(3);
}

// execArgv 透传（批次 2）：`node --experimental-test-coverage .zcode/scripts/run-tests.mjs` 的 flag
// 只落在 launcher 进程，spawn 的 --test 子进程不继承 → 覆盖率恒空。透传后同一条命令两端行为一致
// （npm test 场景 execArgv 为空数组，行为零变化）。
const r = spawnSync(process.execPath, [...process.execArgv, '--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status === null ? 1 : r.status);
