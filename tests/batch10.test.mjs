// 批次 10（R8a，三仓精读裁决 A1）：tier 档位盘行为级测试。
// - 唯一解析器 lib/tier.mjs：三档×block/advise/off、未列出默认 block（standard=全 block=现状零回归）、
//   结构性地板（任何档恒 block，含注入表直测）、治理面脏树 raise 现算（干净树 standard / 脏 .zcode/lib → strict 点名 / 脏 README 不升）。
// - tier validate 三违规各拒：三档不单调 / 地板入表 / 幽灵规则 id。
// - fast 档接现有贷款状态机：reason 必填、hours clamp 1..8、窗口开 → effective fast、窗口开+脏治理面 → strict（raise 优先）、
//   tier set standard 不清窗口（档位与贷款正交）。
// - hook 三出口（真实通道 subprocess）：Stop 门 advise（放行+gate-log advise+提醒输出不计三振）/ off（skip-tier 留痕）/ block（现状 exit 2）；
//   ask 档提醒 off → skip-tier 留痕不再注入；地板 deny 规则 fast 窗口内照旧 exit 2。
// - tier.json 损坏 → standard + 出声（quarantine 留痕）不砖会话；tier set standard/strict 带 --reason/--hours → 冲突 flag 拒。
// - classifier deny 档规则全量必须是地板（防新增 deny 规则漏划地板——地板清单与分类器契约互锁）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkHarnessProj, rmDir, zbase, REPO } from './helpers.mjs';
import { FLOOR_RULES, registeredRuleIds, ruleMode } from '../.zcode/lib/tier.mjs';

const profilePath = (dir) => path.join(dir, '.zcode', 'harness', 'profile.json');
const statePath = (dir) => path.join(dir, '.zcode', 'state', 'state.json');
const gateLogPath = (dir) => path.join(dir, '.zcode', 'state', 'gate-log.jsonl');

// 覆写 fast 档表（standard/strict 保持空=全 block）
function writeProfile(dir, fastRules) {
  fs.writeFileSync(profilePath(dir), JSON.stringify({
    version: 1,
    tiers: { fast: { rules: fastRules }, standard: { rules: {} }, strict: { rules: {} } },
  }, null, 2));
}

// 干净树项目：全量提交（mkHarnessProj 仅 git init 无提交——不提交则 .zcode/** 全 untracked 恒 raise，测不了 fast/standard 档）。
// 换最小 catalog（src/** 归类）：让 src-*.txt 成为 governed 代码——三文件同步门才有判定对象（仓内 catalog 不含 src/**，
// unmapped 不算 governed 代码，同步门不触发）。
function committedProj(fastRules) {
  const dir = mkHarnessProj();
  fs.writeFileSync(path.join(dir, '.zcode', 'harness', 'module-catalog.json'), JSON.stringify({
    version: 1,
    modules: [{ name: 'src', globs: ['src/**'], deps: [] }],
  }));
  // progress.md 在盘才执法 MEMORY_BEHIND_CODE（「文件存在即维护，不存在的不强造」——
  // 无 progress.md 时同步门降级为 warning 不拦，三文件同步门无从触发）。
  // mtime 回拨 1h：recorder 豁免窗=progress.md 最近 2 秒被改——刚创建的 progress 会让同步门误判「记录中」而豁免。
  fs.writeFileSync(path.join(dir, 'progress.md'), '# progress\n\n## Done（完成流水）\n\n- 初始化\n');
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(dir, 'progress.md'), old, old);
  if (fastRules) writeProfile(dir, fastRules);
  try {
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  } catch { /* 非 git 环境：raise 相关断言跳过风险由 CI 兜底（仓库测试面要求 git） */ }
  return dir;
}

function gateLog(dir) {
  return fs.readFileSync(gateLogPath(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

// ---------- 单元：ruleMode / 地板 / 默认 block ----------

test('R8a 地板规则任何档恒 block（含表内显式降级也无效——结构性地板不可表达为可调静音）', () => {
  for (const tier of ['fast', 'standard', 'strict']) {
    assert.equal(ruleMode('secret-read', tier), 'block');
    assert.equal(ruleMode('rm-rf-root', tier), 'block');
    assert.equal(ruleMode('write-preflight', tier), 'block');
    assert.equal(ruleMode('TASK_SCOPE', tier), 'block');
    assert.equal(ruleMode('protected-write', tier), 'block');
  }
  // 注入表直测：表里写 off/advise 也压不过地板
  assert.equal(ruleMode('secret-egress', 'fast', { 'secret-egress': 'off' }), 'block');
  assert.equal(ruleMode('git-reset-hard', 'fast', { 'git-reset-hard': 'advise' }), 'block');
});

test('R8a classifier deny 档规则全量是地板（deny 档危险类新增规则漏划地板 = 契约破坏，此测试即失败）', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'classifier-rules.json'), 'utf8'));
  const denyIds = doc.rules.filter((r) => r.decision === 'deny').map((r) => r.id);
  assert.ok(denyIds.length >= 15, `deny 档规则数异常（${denyIds.length}）——规则表被改坏？`);
  for (const id of denyIds) assert.ok(FLOOR_RULES.has(id), `classifier deny 规则 ${id} 必须是地板`);
});

test('R8a 未列出规则默认 block；standard 档全注册规则 block（=现状零回归硬保证）', () => {
  const registered = registeredRuleIds();
  assert.ok(registered.size >= 30, `注册面现算异常（${registered.size}）——hooks.mjs/classifier-rules 提取器坏了？`);
  for (const id of registered) {
    assert.equal(ruleMode(id, 'standard'), 'block', `${id} standard 必须默认 block`);
  }
  // 未注册/未列出 id 任何档都 block（宁严勿漏）
  for (const tier of ['fast', 'standard', 'strict']) {
    assert.equal(ruleMode('never-registered-rule', tier), 'block');
  }
});

// ---------- tier validate 三违规 ----------

test('R8a validate 拒三档不单调（fast advise 而 standard off——高档不得比低档松）', () => {
  const dir = mkHarnessProj();
  try {
    writeProfile(dir, { 'three-file-sync': 'advise' });
    fs.writeFileSync(profilePath(dir), JSON.stringify({
      version: 1,
      tiers: {
        fast: { rules: { 'three-file-sync': 'advise' } },
        standard: { rules: { 'three-file-sync': 'off' } },
        strict: { rules: {} },
      },
    }));
    const res = zbase(['tier', 'validate'], { cwd: dir });
    assert.equal(res.code, 3, `不单调必须 exit 3，实际 ${res.code}（${res.stdout}${res.stderr}）`);
    assert.match(res.stdout, /NOT_MONOTONIC/);
    assert.match(res.stdout, /three-file-sync/);
  } finally { rmDir(dir); }
});

test('R8a validate 拒地板入表（secret-read 是地板，任何档不得入表降级）', () => {
  const dir = mkHarnessProj();
  try {
    writeProfile(dir, { 'secret-read': 'advise' });
    const res = zbase(['tier', 'validate'], { cwd: dir });
    assert.equal(res.code, 3);
    assert.match(res.stdout, /FLOOR_IN_TABLE/);
  } finally { rmDir(dir); }
});

test('R8a validate 拒幽灵规则（表中 id 不在 hooks.mjs/classifier-rules 现算注册面）', () => {
  const dir = mkHarnessProj();
  try {
    writeProfile(dir, { 'ghost-rule-no-such': 'advise' });
    const res = zbase(['tier', 'validate'], { cwd: dir });
    assert.equal(res.code, 3);
    assert.match(res.stdout, /GHOST_RULE/);
    assert.match(res.stdout, /ghost-rule-no-such/);
  } finally { rmDir(dir); }
});

test('R8a validate 合法表过（仓内默认 profile：fast 只放 stop-gate:advise，单调+无地板+无幽灵）', () => {
  const res = zbase(['tier', 'validate']);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /ok: true/);
});

// ---------- resolveTier：脏树 raise ----------

test('R8a resolveTier：干净树 standard；脏 .zcode/lib → strict 点名文件；脏 README.md 不升档', () => {
  const clean = committedProj();
  try {
    const base = zbase(['tier', 'status'], { cwd: clean });
    assert.equal(base.code, 0);
    assert.match(base.stdout, /effective: standard/);
    assert.match(base.stdout, /raiseCount: 0/);
    // 脏治理面：untracked .zcode/lib/x.mjs → raise strict + 点名
    fs.mkdirSync(path.join(clean, '.zcode', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(clean, '.zcode', 'lib', 'probe-raise.mjs'), 'export {};\n');
    const raised = zbase(['tier', 'status'], { cwd: clean });
    assert.match(raised.stdout, /effective: strict/);
    assert.match(raised.stdout, /\.zcode\/lib\/probe-raise\.mjs/);
  } finally { rmDir(clean); }
  const clean2 = committedProj();
  try {
    // 脏非治理面：README.md 修改 → 不升档
    fs.writeFileSync(path.join(clean2, 'README.md'), '# changed\n');
    const flat = zbase(['tier', 'status'], { cwd: clean2 });
    assert.match(flat.stdout, /effective: standard/);
    assert.match(flat.stdout, /raiseCount: 0/);
  } finally { rmDir(clean2); }
});

// ---------- fast 档接贷款状态机 ----------

test('R8a tier set fast 贷款契约：无 reason 拒；--hours 9 clamp 8（minutes=480）；窗口开 → effective fast', () => {
  const dir = committedProj();
  try {
    const noReason = zbase(['tier', 'set', 'fast', '--hours', '2'], { cwd: dir });
    assert.equal(noReason.code, 1);
    assert.match(noReason.stderr + noReason.stdout, /reason/i);
    const noHours = zbase(['tier', 'set', 'fast', '--reason', 'r'], { cwd: dir });
    assert.equal(noHours.code, 1);
    // hours 9 → clamp 8
    const on = zbase(['tier', 'set', 'fast', '--reason', '批次10测试', '--hours', '9'], { cwd: dir });
    assert.equal(on.code, 0, on.stdout + on.stderr);
    assert.match(on.stdout, /8/);
    const st = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
    assert.equal(st.fast.minutes, 480, 'clamp 8 折算 minutes=480（1..8h 双侧夹）');
    assert.ok(st.fast.windowId, '贷款 windowId 生成（现有 fast 状态机全套）');
    // 窗口开 → effective fast（干净树）
    const status = zbase(['tier', 'status'], { cwd: dir });
    assert.match(status.stdout, /effective: fast/);
    // 窗口开 + 脏治理面 → strict（raise 优先于 fast）
    fs.mkdirSync(path.join(dir, '.zcode', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'rules', 'probe.md'), 'x\n');
    const raised = zbase(['tier', 'status'], { cwd: dir });
    assert.match(raised.stdout, /effective: strict/);
    assert.match(raised.stdout, /\.zcode\/rules\/probe\.md/);
  } finally { rmDir(dir); }
});

test('R8a 档位与贷款正交：tier set standard 不清 fast 窗口（显式 fast off 或到期才清）', () => {
  const dir = committedProj();
  try {
    zbase(['tier', 'set', 'fast', '--reason', '正交性测试', '--hours', '1'], { cwd: dir });
    const setStd = zbase(['tier', 'set', 'standard'], { cwd: dir });
    assert.equal(setStd.code, 0);
    assert.match(setStd.stdout, /still-open/);
    const st = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
    assert.ok(st.fast?.enabled === true, 'tier set standard 后贷款窗口必须仍在');
    const tierJson = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'tier.json'), 'utf8'));
    assert.equal(tierJson.tier, 'standard');
    // standard 档 + 窗口开 → effective fast（窗口把出口强度提到 fast）
    const status = zbase(['tier', 'status'], { cwd: dir });
    assert.match(status.stdout, /effective: fast/);
  } finally { rmDir(dir); }
});

// ---------- hook 三出口（真实通道） ----------

test('R8a Stop 门 advise 出口：软规则命中 → 放行（exit 0）+ tier-advise 提醒 + gate-log advise 行（不计三振）', () => {
  const dir = committedProj({ 'three-file-sync': 'advise', 'stop-gate': 'advise' });
  try {
    zbase(['tier', 'set', 'fast', '--reason', 'advise 出口测试', '--hours', '1'], { cwd: dir });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'x'); // 非治理面脏（governed 代码）：progress 未同步 + 无新鲜回执 → 两门都命中
    const s = zbase(['hook', 'stop'], { cwd: dir, input: '{}' });
    assert.equal(s.code, 0, `advise 语义=放行，实际 ${s.code}（${s.stdout}${s.stderr}）`);
    assert.match(s.stdout, /tier-advise/, 'advise 提醒必须可见（systemMessage+additionalContext）');
    assert.match(s.stdout, /stop-gate/);
    const rows = gateLog(dir);
    const advises = rows.filter((r) => r.action === 'advise');
    assert.ok(advises.length >= 2, '三文件同步门与回执门两条 advise 留痕');
    assert.ok(advises.every((r) => r.tier === 'fast'), 'advise 行携带 tier 字段（哪个档降的）');
    assert.ok(!rows.some((r) => r.action === 'stop-release'), 'advise 不走三振路径');
  } finally { rmDir(dir); }
});

test('R8a Stop 门 off 出口：跳过判定 → 放行 + gate-log skip-tier 留痕（跳过不是消失）', () => {
  const dir = committedProj({ 'three-file-sync': 'off', 'stop-gate': 'off' });
  try {
    zbase(['tier', 'set', 'fast', '--reason', 'off 出口测试', '--hours', '1'], { cwd: dir });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'b.txt'), 'x');
    const s = zbase(['hook', 'stop'], { cwd: dir, input: '{}' });
    assert.equal(s.code, 0, `off 语义=跳过放行，实际 ${s.code}（${s.stdout}${s.stderr}）`);
    assert.doesNotMatch(s.stdout, /tier-advise/, 'off 不产生提醒（与 advise 区分）');
    const rows = gateLog(dir);
    const skips = rows.filter((r) => r.action === 'skip-tier');
    assert.ok(skips.some((r) => r.rule === 'three-file-sync' && r.tier === 'fast'));
    assert.ok(skips.some((r) => r.rule === 'stop-gate' && r.tier === 'fast'));
  } finally { rmDir(dir); }
});

test('R8a Stop 门 block 对照：standard 档（默认、无窗口）软规则照旧硬拦 exit 2（现状零回归）', () => {
  const dir = committedProj(); // 仓内默认 profile：fast 档才降，standard 全 block
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'c.txt'), 'x');
    const s = zbase(['hook', 'stop'], { cwd: dir, input: '{}' });
    assert.equal(s.code, 2, `standard 档 stop-gate 必须照旧拦（现状），实际 ${s.code}`);
    assert.match(s.stderr, /未提交|三振/);
  } finally { rmDir(dir); }
});

test('R8a ask 档提醒 off：sudo 提权提醒被 skip-tier 跳过不再注入；standard 档照旧注入', () => {
  const dir = committedProj({ 'privilege-escalation': 'off' });
  try {
    zbase(['tier', 'set', 'fast', '--reason', 'ask off 测试', '--hours', '1'], { cwd: dir });
    const quiet = zbase(['hook', 'pre-tool-use'], {
      cwd: dir,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sudo apt-get install ripgrep' } }),
    });
    assert.equal(quiet.code, 0);
    assert.doesNotMatch(quiet.stdout, /privilege-escalation/, 'off 档提醒不得再注入');
    const rows = gateLog(dir);
    assert.ok(rows.some((r) => r.action === 'skip-tier' && r.rule === 'privilege-escalation'), '跳过要留痕不是消失');
  } finally { rmDir(dir); }
  const std = committedProj();
  try {
    const loud = zbase(['hook', 'pre-tool-use'], {
      cwd: std,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sudo apt-get install ripgrep' } }),
    });
    assert.equal(loud.code, 0);
    assert.match(loud.stdout, /privilege-escalation/, 'standard 档 ask 提醒照旧（现状零回归）');
  } finally { rmDir(std); }
});

test('R8a 地板 deny 规则 fast 窗口内照旧硬拦：rm -rf / → exit 2（安全护栏不在可调静音面内）', () => {
  const dir = committedProj({ 'rm-rf-root': 'off' }); // 恶意表也压不过地板
  try {
    zbase(['tier', 'set', 'fast', '--reason', '地板测试', '--hours', '1'], { cwd: dir });
    const s = zbase(['hook', 'pre-tool-use'], {
      cwd: dir,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sudo rm -rf /' } }),
    });
    assert.equal(s.code, 2, `地板规则任何档恒 block，实际 ${s.code}`);
    assert.match(s.stderr, /rm-rf-root/);
  } finally { rmDir(dir); }
});

// ---------- 损坏容错与冲突 flag ----------

test('R8a tier.json 损坏 → standard + 出声不炸（quarantine 留痕，exit 0）', () => {
  const dir = committedProj();
  try {
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'tier.json'), '{not-json');
    const res = zbase(['tier', 'status'], { cwd: dir });
    assert.equal(res.code, 0, `损坏不得砖会话，实际 ${res.code}（${res.stdout}${res.stderr}）`);
    assert.match(res.stdout, /standard/, '按默认 standard 继续');
    assert.match(res.stdout, /损坏/, 'fail-visible：损坏必须出声');
    const q = fs.readFileSync(path.join(dir, '.zcode', 'state', 'quarantine.jsonl'), 'utf8');
    assert.match(q, /tier\.json/, 'quarantine 留痕取证');
  } finally { rmDir(dir); }
});

test('R8a 冲突 flag：tier set standard|strict 带 --reason/--hours → 拒（贷款参数只属于 fast 档）', () => {
  const dir = committedProj();
  try {
    const r1 = zbase(['tier', 'set', 'standard', '--reason', 'x'], { cwd: dir });
    assert.equal(r1.code, 1);
    const r2 = zbase(['tier', 'set', 'strict', '--hours', '2'], { cwd: dir });
    assert.equal(r2.code, 1);
    const r3 = zbase(['tier', 'set', 'bogus'], { cwd: dir });
    assert.equal(r3.code, 1, '未知档位拒');
  } finally { rmDir(dir); }
});

// ---------- 播报与解释 ----------

test('R8a SessionStart 播报 tier 行（档位+effective+raise 数，单行）', () => {
  const dir = mkHarnessProj();
  try {
    const s = zbase(['hook', 'session-start'], { cwd: dir, input: '{}' });
    assert.equal(s.code, 0);
    assert.match(s.stdout, /TIER 档位/, 'SessionStart 必须播报档位');
    assert.match(s.stdout, /effective/);
  } finally { rmDir(dir); }
});

test('R8a explain：每规则三档模式+地板标记；stop-gate fast=advise（默认表）而 secret-read 地板全 block', () => {
  const dir = committedProj(); // 提交后再查：raise 不干扰，读的是表
  try {
    const res = zbase(['tier', 'explain', '--rule', 'stop-gate'], { cwd: dir });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /advise/);
    assert.match(res.stdout, /floor.:false/, '非地板标记');
    const floor = zbase(['tier', 'explain', '--rule', 'secret-read'], { cwd: dir });
    assert.equal(floor.code, 0);
    assert.match(floor.stdout, /floor.:true/, '地板标记');
    const ghost = zbase(['tier', 'explain', '--rule', 'no-such-rule'], { cwd: dir });
    assert.equal(ghost.code, 1, '未注册规则 explain 拒');
  } finally { rmDir(dir); }
});

test('R8a invariants State 块带 tier 一行（无 ISO 时钟值）', () => {
  const dir = committedProj();
  try {
    const res = zbase(['invariants', '--json'], { cwd: dir });
    assert.equal(res.code, 0);
    assert.match(res.json.text, /TIER 档位/);
    const stateBlock = res.json.text.split('## 铁律')[0];
    assert.doesNotMatch(stateBlock, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'State 块不得含 ISO 时钟值');
  } finally { rmDir(dir); }
});

// ---------- review P3 补测（R8a review 轮：advise 不写三振续算 / fast 窗口到期回落） ----------

test('R8a advise→block 三振续算：advise 期间同缺失多次 stop 不写 strike；切回 block 后同清单继续累计不归零', () => {
  const dir = committedProj({ 'three-file-sync': 'advise', 'stop-gate': 'advise' });
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'strike.txt'), 'x'); // 同一缺失清单全程不动树（strike 键=task+fingerprint+缺失）
    const strikes = () => {
      const st = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
      const counts = st.stopStrikes?.counts || {};
      const entries = Object.entries(counts);
      assert.ok(entries.length <= 1, `本用例只应有一个 strike 键，实际 ${entries.length}`);
      return entries.length ? entries[0][1] : 0;
    };
    // ① block 基线：standard 档（默认表、无窗口）stop → exit 2，三振 1/3
    const b1 = zbase(['hook', 'stop'], { cwd: dir, input: '{}' });
    assert.equal(b1.code, 2);
    assert.match(b1.stderr, /三振 1\/3/);
    assert.equal(strikes(), 1);
    // ② 切 advise（fast 窗口开，表内两门降 advise）：两次 stop 均放行且不写 strike
    zbase(['tier', 'set', 'fast', '--reason', '三振续算测试', '--hours', '1'], { cwd: dir });
    for (let i = 0; i < 2; i++) {
      const a = zbase(['hook', 'stop'], { cwd: dir, input: '{}' });
      assert.equal(a.code, 0, `advise 期间 stop 必须放行（第 ${i + 1} 次），实际 ${a.code}`);
      assert.match(a.stdout, /tier-advise/);
    }
    assert.equal(strikes(), 1, 'advise 不计三振——strike 计数不得增长');
    // ③ 切回 block（显式 strict 压过窗口：档位优先级 raise>strict>window）：同缺失清单继续累计到 2，不归零
    zbase(['tier', 'set', 'strict'], { cwd: dir });
    const b2 = zbase(['hook', 'stop'], { cwd: dir, input: '{}' });
    assert.equal(b2.code, 2);
    assert.match(b2.stderr, /三振 2\/3/, '同键继续累计（advise 期间未清零也未隐匿计数）');
    assert.equal(strikes(), 2);
  } finally { rmDir(dir); }
});

test('R8a fast 档窗口到期 → tierStatus 报 warning + effective 回落 standard（贷款到期档位自然失效）', () => {
  const dir = committedProj();
  try {
    zbase(['tier', 'set', 'fast', '--reason', '到期回落测试', '--hours', '1'], { cwd: dir });
    // 窗口开：effective fast
    const on = zbase(['tier', 'status'], { cwd: dir });
    assert.match(on.stdout, /effective: fast/);
    // 模拟到期：state.json fast.until 回拨 1 分钟（fastStatus 按 until>Date.now 判失效）
    const st = JSON.parse(fs.readFileSync(statePath(dir), 'utf8'));
    st.fast.until = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(statePath(dir), JSON.stringify(st, null, 2));
    const off = zbase(['tier', 'status'], { cwd: dir });
    assert.equal(off.code, 0);
    assert.match(off.stdout, /effective: standard/, '无活跃窗口的 fast 档回落 standard');
    assert.match(off.stdout, /回落 standard/, 'fail-visible：回落必须出声（warning）');
  } finally { rmDir(dir); }
});
