// 重构批次 5 测试（源 dsh 54ca45b specView / cc 07ed8ff State 块 + boundToCurrentDiff 模式）：
// spec view（按 impact 渲染需求切片：命中渲染/noLink 诚实信号/预算截断/--all/degraded 拒全量/
// 未知 flag 拒收/trace 默认输出形状零漂移）+ invariants State 块（任务六字段/fast 剩余小时数
// 无时钟值/账本 intact/待审数/gate.boundToCurrentDiff 两态/Pinned 块与预算序 State→铁律→Pinned）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { zbase, mkHarnessProj, rmDir } from './helpers.mjs';

// 需求 id 占位拼装（r5a 先例）：本仓实扫 trace 会把测试源文本里的连续「REQ-数字」完整形态
// 当悬空引用——源码内一律写 'REQ@N'，落盘/断言前 unmask 还原。
const unmask = (s) => s.replace(/(REQ|NFR)@/g, '$1-');
const unmaskRe = (re) => new RegExp(unmask(re.source), re.flags);

const CATALOG = {
  version: 1,
  modules: [
    { name: 'mod-a', globs: ['src/a/**'], deps: [], attributes: { reliability: 'low' } },
    { name: 'mod-b', globs: ['src/b/**'], deps: [], attributes: { reliability: 'low' } },
  ],
};

// 沙箱：Spec（3 需求）+ catalog（mod-a/mod-b）+ 引用文件（mod-a 侧 impl+test 引 REQ@101）。
function mkSpecProj() {
  const dir = mkHarnessProj({ catalog: CATALOG });
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), unmask([
    '# S', '',
    '- REQ@101：当提交时必须记录审计日志；验收：审计表有对应行。',
    '- REQ@102：当导出时必须写出全部字段；验收：CSV 行数匹配。',
    '- REQ@103：当归档时必须保留指针；验收：指针可解析。',
    '',
  ].join('\n')));
  fs.mkdirSync(path.join(dir, 'src', 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'b'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a', 'impl.js'), unmask('// 实现 REQ@101\n'));
  fs.writeFileSync(path.join(dir, 'src', 'a', 'other.js'), '// 无需求引用\n');
  fs.writeFileSync(path.join(dir, 'src', 'b', 'impl.js'), '// mod-b 侧无引用\n');
  fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), unmask('// 覆盖 REQ@101\n'));
  try { execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, stdio: 'ignore' }); } catch { /* git 缺失时 trace 按 untracked 兜底 */ }
  return dir;
}

// ---------- B5-1：spec view 命中渲染（变更路径 → 受影响模块 × 需求引用交集） ----------

test('B5-1 spec view --paths：受影响模块命中需求渲染，未命中需求不出现', () => {
  const dir = mkSpecProj();
  const r = zbase(['spec', 'view', '--paths', 'src/a/impl.js', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const j = r.json;
  assert.equal(j.ok, true);
  assert.equal(j.mode, 'impact');
  assert.equal(j.noLink, false);
  assert.equal(j.totalRequirements, 3);
  assert.ok(j.rendered >= 1, `rendered=${j.rendered}`);
  assert.match(j.text, unmaskRe(/REQ@101/));
  assert.match(j.text, /code 1 \/ tests 1/);
  assert.ok(j.affectedModules.includes('mod-a'), `affected=${j.affectedModules}`);
  assert.doesNotMatch(j.text, unmaskRe(/REQ@102/), 'mod-b 的需求不该进 mod-a 的切片');
  assert.doesNotMatch(j.text, unmaskRe(/REQ@103/), '孤儿需求（无引用）不该进 impact 切片');
  rmDir(dir);
});

test('B5-1 spec view --paths 跨模块闭包：mod-b 依赖 mod-a 时变更 mod-a 也渲染 mod-b 引用的需求', () => {
  const dir = mkHarnessProj({
    catalog: {
      version: 1,
      modules: [
        { name: 'mod-a', globs: ['src/a/**'], deps: [], attributes: { reliability: 'low' } },
        { name: 'mod-b', globs: ['src/b/**'], deps: ['mod-a'], attributes: { reliability: 'low' } },
      ],
    },
  });
  fs.writeFileSync(path.join(dir, 'Product-Spec.md'), unmask([
    '# S', '',
    '- REQ@101：当提交时必须记录审计日志；验收：审计表有对应行。',
    '- REQ@102：当导出时必须写出全部字段；验收：CSV 行数匹配。',
    '',
  ].join('\n')));
  fs.mkdirSync(path.join(dir, 'src', 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a', 'impl.js'), '// 无引用\n');
  fs.writeFileSync(path.join(dir, 'src', 'b', 'impl.js'), unmask('// 实现 REQ@102\n'));
  try { execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, stdio: 'ignore' }); } catch { /* 同上 */ }
  // 变更 mod-a → fanout 含 mod-b（反向依赖闭包）→ mod-b 引用的 REQ@102 入切片
  const r = zbase(['spec', 'view', '--paths', 'src/a/impl.js', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(r.json.affectedModules.includes('mod-b'));
  assert.match(r.json.text, unmaskRe(/REQ@102/));
  rmDir(dir);
});

// ---------- B5-2：noLink 诚实信号（空交集 ≠ 无适用需求） ----------

test('B5-2 spec view noLink：受影响模块 cite 零需求 → 「此变更不可追溯」而非空列表', () => {
  const dir = mkSpecProj();
  const r = zbase(['spec', 'view', '--paths', 'src/b/impl.js', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr); // 诚实信号非错误
  const j = r.json;
  assert.equal(j.noLink, true);
  assert.equal(j.rendered, 0);
  assert.match(j.text, /此变更不可追溯（受影响模块无对应需求）/);
  assert.match(j.text, /不可追溯/);
  rmDir(dir);
});

// ---------- B5-3：预算化（header/每需求块/omitted 如实标注） ----------

test('B5-3 spec view 预算：--budget 耗尽 → omitted 如实标注；默认预算全渲染 omitted=0', () => {
  const dir = mkSpecProj();
  // --all 3 需求 + 小预算：装下头几个块、余下 omitted（并存才有断言力）
  const tight = zbase(['spec', 'view', '--all', '--budget', '150', '--json'], { cwd: dir });
  assert.equal(tight.code, 0, tight.stdout + tight.stderr);
  assert.ok(tight.json.omitted >= 1, `omitted=${tight.json.omitted}`);
  assert.ok(tight.json.rendered >= 1 && tight.json.rendered < 3, `rendered=${tight.json.rendered}`);
  assert.match(tight.json.text, /\[omitted \d+ 需求：预算 150 字符耗尽/);
  // 默认预算 4000：3 需求全渲染零 omitted
  const full = zbase(['spec', 'view', '--paths', 'src/a/impl.js', '--json'], { cwd: dir });
  assert.equal(full.json.omitted, 0);
  assert.equal(full.json.rendered, 1); // 交集只有 REQ@101
  rmDir(dir);
});

// ---------- B5-4：--all 全量（不过滤 impact） ----------

test('B5-4 spec view --all：全部需求渲染（含孤儿与未引用），不按 impact 过滤', () => {
  const dir = mkSpecProj();
  const r = zbase(['spec', 'view', '--all', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const j = r.json;
  assert.equal(j.mode, 'all');
  assert.equal(j.noLink, false);
  assert.equal(j.rendered, 3);
  assert.equal(j.omitted, 0);
  assert.match(j.text, unmaskRe(/REQ@101/));
  assert.match(j.text, unmaskRe(/REQ@102/));
  assert.match(j.text, unmaskRe(/REQ@103/));
  assert.equal(j.affectedModules, null, '--all 不携带受影响集');
  rmDir(dir);
});

// ---------- B5-5：degraded 三态（unmapped 拒全量 / 无 Spec / 缺 --paths） ----------

test('B5-5 spec view degraded：unmapped 路径拒绝渲染全量并如实报；无 Spec / 缺 --paths 同 degraded exit 3', () => {
  const dir = mkSpecProj();
  // unmapped：impact 保守扩大原则 → 拒绝渲染
  const unm = zbase(['spec', 'view', '--paths', 'unmapped/orphan.js', '--json'], { cwd: dir });
  assert.equal(unm.code, 3, unm.stdout + unm.stderr);
  assert.equal(unm.json.degraded, true);
  assert.match(unm.json.reason, /degraded impact/);
  assert.match(unm.json.reason, /unmapped/);
  assert.equal(unm.json.text, undefined, 'degraded 不渲染切片');
  // 缺 --paths 且无 --all
  const nop = zbase(['spec', 'view', '--json'], { cwd: dir });
  assert.equal(nop.code, 3);
  assert.equal(nop.json.degraded, true);
  // 无 Spec 文件
  const bare = mkHarnessProj();
  const nospec = zbase(['spec', 'view', '--all', '--json'], { cwd: bare });
  assert.equal(nospec.code, 3);
  assert.equal(nospec.json.degraded, true);
  rmDir(dir);
  rmDir(bare);
});

// ---------- B5-6：CLI 契约（未知 flag 拒收 / 无子命令 usage） ----------

test('B5-6 spec view 未知 flag 拒收 exit 1；spec 无子命令 → usage exit 1', () => {
  const dir = mkSpecProj();
  const bad = zbase(['spec', 'view', '--nonsense'], { cwd: dir });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /未知 flag：--nonsense/);
  assert.match(bad.stderr, /--paths --all --budget/);
  const nosub = zbase(['spec'], { cwd: dir });
  assert.equal(nosub.code, 1);
  assert.match(nosub.stderr, /spec view/);
  rmDir(dir);
});

// ---------- B5-7：trace 默认输出形状零漂移（full 只经 spec view 内部消费） ----------

test('B5-7 trace 默认 rows 无 code 字段（full 模式只在 spec view 内部消费）', () => {
  const dir = mkSpecProj();
  const t = zbase(['trace', '--json'], { cwd: dir });
  assert.equal(t.code, 0, t.stdout + t.stderr);
  const row = t.json.rows[0];
  assert.equal(row.code, undefined, '默认形态不新增字段（CLI 输出零漂移）');
  assert.ok('codeCount' in row && 'tests' in row);
  // full 数据的消费证明在 B5-1 闭包用例：REQ@102 仅 code 引用（无 tests）仍入切片——
  // 过滤用 r.code 数组（trace({full:true}) 独有），codeCount/默认 tests 都撑不起该命中。
  rmDir(dir);
});

// ---------- B5-8：invariants State 块基础（头声明/无任务/账本/待审/bound） ----------

test('B5-8 invariants State 块：头声明「刚从文件派生」；无任务如实报；账本 intact 与待审数在场', () => {
  const dir = mkHarnessProj();
  const r = zbase(['invariants', '--json'], { cwd: dir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const text = r.json.text;
  assert.match(text, /刚从文件派生/, '头声明：按它校准别按压缩后印象走');
  assert.match(text, /按它校准，别按压缩后印象走/);
  assert.match(text, /## State\n- 任务: 无活跃任务/);
  assert.match(text, /- 账本: intact（\d+ 条）|断链/);
  assert.match(text, /- 待审: backlog \d+ 条/);
  assert.match(text, /gate\.boundToCurrentDiff: false（账本无回执——从未落账）/, '空账本 bound=false（从未落账）');
  // 块序：State 在铁律之前（预算内序决定什么活下来）
  assert.ok(text.indexOf('## State') < text.indexOf('## 铁律'), 'State 块须在铁律前');
  rmDir(dir);
});

// ---------- B5-9：State 块带活跃任务（id + 六字段摘要） ----------

test('B5-9 invariants State 块：活跃任务 id 与六字段（goal/scope/outOfScope/pattern/verification/escalation）', () => {
  const dir = mkHarnessProj();
  const envelope = {
    goal: '实现切片渲染', scope: ['src/**'], outOfScope: ['docs/**'],
    existingPattern: '沿 scan.mjs spec 节', verification: [{ command: 'npm test', expect: 'exit 0' }],
    escalation: '数据结构不符交回主 Agent',
  };
  const t = zbase(['task', 'start', '--input', '-', '--owned', 'src/**'], { cwd: dir, input: JSON.stringify(envelope) });
  assert.equal(t.code, 0, t.stdout + t.stderr);
  const r = zbase(['invariants', '--json'], { cwd: dir });
  assert.equal(r.code, 0);
  const line = r.json.text.split('\n').find((l) => l.startsWith('- 任务:'));
  assert.ok(line, 'State 块须含任务行');
  assert.match(line, /t-[a-z0-9]+（medium）/, '任务 id（t- 前缀）+ risk');
  assert.match(line, /goal: 实现切片渲染/);
  assert.match(line, /scope: src\/\*\*/);
  assert.match(line, /outOfScope: docs\/\*\*/);
  assert.match(line, /existingPattern: 沿 scan\.mjs spec 节/);
  assert.match(line, /verification: \{"command":"npm test","expect":"exit 0"\}/, '对象数组元素 JSON 化非 [object Object]');
  assert.match(line, /escalation: 数据结构不符交回主 Agent/);
  rmDir(dir);
});

// ---------- B5-10：fast 窗口两态（剩余小时数、无时钟值） ----------

test('B5-10 invariants fast：on → 剩余小时数（无 ISO 时钟值）；off → 关闭', () => {
  const dir = mkHarnessProj();
  zbase(['fast', 'on', '--minutes', '60', '--reason', '批次5测试窗口'], { cwd: dir });
  const on = zbase(['invariants', '--json'], { cwd: dir });
  assert.equal(on.code, 0);
  assert.match(on.json.text, /FAST MODE 贷款剩余 [\d.]+h/);
  assert.match(on.json.text, /批次5测试窗口/);
  // 无时钟值（cc 教训）：State 行不得携带绝对时间戳（ISO 形态）——缓存比对按相对值走
  const stateBlock = on.json.text.split('## 铁律')[0];
  assert.doesNotMatch(stateBlock, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'State 块不得含 ISO 时钟值');
  zbase(['fast', 'off'], { cwd: dir });
  const off = zbase(['invariants', '--json'], { cwd: dir });
  assert.match(off.json.text, /FAST MODE: 关闭/);
  rmDir(dir);
});

// ---------- B5-11：gate.boundToCurrentDiff 两态 ----------

test('B5-11 invariants gate.boundToCurrentDiff：落账回执后 true；树变后 false（旧回执不算数）', () => {
  const dir = mkHarnessProj();
  try { execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, stdio: 'ignore' }); } catch { /* fingerprint 也覆盖 untracked */ }
  // 落账一条 PASS 回执（fingerprint 绑定当时树）
  const w = zbase(['receipt', 'write', '--check', 'unit', '--status', 'PASS'], { cwd: dir });
  assert.equal(w.code, 0, w.stdout + w.stderr);
  const bound = zbase(['invariants', '--json'], { cwd: dir });
  assert.match(bound.json.text, /gate\.boundToCurrentDiff: true（最后回执即当前 diff——上次绿灯就是这次的）/);
  // 树变（untracked 新文件）→ fingerprint 漂移 → false
  fs.writeFileSync(path.join(dir, 'drift.txt'), '树变了');
  const drifted = zbase(['invariants', '--json'], { cwd: dir });
  assert.match(drifted.json.text, /gate\.boundToCurrentDiff: false（最后回执 ≠ 当前 diff——旧回执不算数，先重跑 gate）/);
  rmDir(dir);
});

// ---------- B5-12：Pinned 块 + 预算序（小预算下 State 活、Pinned 让位） ----------

test('B5-12 invariants Pinned 块与预算序：progress.md Pinned 段入块；小预算 State 存活 Pinned 让位', () => {
  const dir = mkHarnessProj();
  const pinned = Array.from({ length: 6 }, (_, i) => `- 长期约束 ${i + 1}：${'x'.repeat(110)}`);
  fs.writeFileSync(path.join(dir, 'progress.md'), `# progress\n\n## Pinned（长期约束）\n\n${pinned.join('\n')}\n\n## Done（完成流水）\n\n- 完成甲\n`);
  const full = zbase(['invariants', '--json'], { cwd: dir });
  assert.equal(full.code, 0);
  assert.match(full.json.text, /## Pinned\n- 长期约束 1/);
  assert.ok(full.json.text.indexOf('## 铁律') < full.json.text.indexOf('## Pinned'), '块序 State→铁律→Pinned');
  // 小预算：截断从尾——Pinned/铁律先让位，State（活状态）保到最后
  const tight = zbase(['invariants', '--budget', '420', '--json'], { cwd: dir });
  assert.equal(tight.code, 0);
  assert.equal(tight.json.truncated, true);
  assert.match(tight.json.text, /## State/, 'State 块在小预算下存活');
  assert.doesNotMatch(tight.json.text, /## Pinned/, 'Pinned 在小预算下让位');
  assert.ok(tight.json.chars <= 420 + 40, `chars=${tight.json.chars}`);
  rmDir(dir);
});
