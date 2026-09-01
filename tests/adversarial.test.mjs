// Task 8.10 三类新测试之三：对抗性（源 codex tests/harness.test.mjs:711 账本篡改三态模式）。
// 账本（.zcode/state/ledger.jsonl 哈希链）篡改三态全部必须 exit 4（TAMPERED，fail-closed）：
//   ① 编辑中段行（改 content 不重算 chainHash）→ CHAIN_BROKEN
//   ② 删中段行（seq 断档 + 后续链失锚）→ SEQ_GAP + CHAIN_BROKEN
//   ③ 尾截（字节级截断，模拟半写）→ MALFORMED_LINE
// evidence 篡改 / 路径逃逸 / 删除已有用例不重复（见 tests/r4b.test.mjs 8.4 组）。
// hook 保护路径写入 deny（账本防篡改的第一道缝）已有用例（tests/harness.test.mjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zbase, mkHarnessProj, rmDir } from './helpers.mjs';

function seedLedger(dir, n = 4) {
  for (let i = 0; i < n; i++) {
    const r = zbase(['receipt', 'write', '--check', `adv-${i}`, '--status', 'PASS', '--note', `entry ${i}`], { cwd: dir });
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
  const v = zbase(['receipt', 'verify'], { cwd: dir });
  assert.equal(v.code, 0, '种子账本必须先验证通过');
}

function ledgerPath(dir) { return path.join(dir, '.zcode', 'state', 'ledger.jsonl'); }

test('8.10 对抗性：编辑中段行（不重算 chainHash）→ receipt verify exit 4', () => {
  const dir = mkHarnessProj();
  try {
    seedLedger(dir);
    const file = ledgerPath(dir);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 3);
    const mid = JSON.parse(lines[1]); // 中段（非首非尾）
    mid.content.note = 'tampered-without-rehash';
    lines[1] = JSON.stringify(mid);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const v = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v.code, 4, `篡改中段必须 exit 4，实际 ${v.code}：${v.stdout}`);
    assert.ok(v.json.issues.some((i) => i.code === 'CHAIN_BROKEN'), JSON.stringify(v.json.issues));
  } finally { rmDir(dir); }
});

test('8.10 对抗性：删中段行 → seq 断档 + 链失锚 → receipt verify exit 4', () => {
  const dir = mkHarnessProj();
  try {
    seedLedger(dir);
    const file = ledgerPath(dir);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.ok(lines.length >= 3);
    lines.splice(1, 1); // 删中段整行
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const v = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v.code, 4, `删中段行必须 exit 4，实际 ${v.code}：${v.stdout}`);
    assert.ok(v.json.issues.some((i) => i.code === 'SEQ_GAP' || i.code === 'CHAIN_BROKEN'), JSON.stringify(v.json.issues));
  } finally { rmDir(dir); }
});

test('8.10 对抗性：尾截（字节级截断模拟半写）→ MALFORMED_LINE → receipt verify exit 4', () => {
  const dir = mkHarnessProj();
  try {
    seedLedger(dir);
    const file = ledgerPath(dir);
    const content = fs.readFileSync(file, 'utf8');
    // 截去末 30 字节：最后一条 JSONL 必然残缺（每条回执远长于 30 字节）
    const cut = content.slice(0, content.length - 30);
    assert.ok(!cut.endsWith('\n'), '截断点应落在行内（字节级半写形态）');
    fs.writeFileSync(file, cut);
    const v = zbase(['receipt', 'verify', '--json'], { cwd: dir });
    assert.equal(v.code, 4, `尾截必须 exit 4，实际 ${v.code}：${v.stdout}`);
    assert.ok(v.json.issues.some((i) => i.code === 'MALFORMED_LINE' || i.code === 'CHAIN_BROKEN'), JSON.stringify(v.json.issues));
  } finally { rmDir(dir); }
});
