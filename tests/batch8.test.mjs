// B1 脊柱批测试（源 bridge-positioning-diagnosis-20260908.md 四节重设计）：
// ① 信封第 7 字段 Business（task start 机器执法）——缺失/空白拒绝且错误信息点名「信封第 7 字段」；
//    在场过；历史状态文件（无 business 的 activeTask）读侧不迁移不报错（只拦新 start）。
// ② spec-lint 业务章节存在性（SPEC_NO_BUSINESS_CONTEXT）——缺「## 业务上下文」error（exit 3）；
//    有章节不报；无 Spec 文件维持现状 rc 语义（degraded exit 3）；只查存在性不查内容质量。
// ③ 模板与 skill 契约——Product-Spec 模板锚点章节+FISU 标记+作者规则注释在场；
//    product-spec-builder 重写后 frontmatter/触发式描述过判定函数；本仓 spec-lint 实跑 exit 0（自举）。
// ④ rules-audit 棘轮锚——宪法信封段改动不引入 phantom/unenforced 倒退（ratio ≥ 0.361 基线）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zbase, mkHarnessProj, rmDir, REPO } from './helpers.mjs';
import { parseFrontmatter, hasTrigger, rulesAudit } from '../.zcode/lib/scan.mjs';

// 六字段旧信封（缺 business）——B1 前的合法形态，B1 起必须被拒。
const SIX_FIELD = {
  goal: 'g', scope: ['src/**'], outOfScope: [], existingPattern: 'n/a',
  verification: [{ command: 'node -e 0', expect: 'exit 0' }], escalation: '卡住交回',
};
const withBusiness = (extra = {}) => ({ ...SIX_FIELD, business: '给运营做日报导出，财务对账场景不动', ...extra });

// ══════════════════ ① 信封 Business 机器执法 ══════════════════

test('B8-E1 信封缺 business：task start 拒绝 exit 1 且错误信息点名「缺 Business 字段（信封第 7 字段）」', () => {
  const dir = mkHarnessProj();
  try {
    const r = zbase(['task', 'start', '--input', '-'], { cwd: dir, input: JSON.stringify(SIX_FIELD) });
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /缺 Business 字段（信封第 7 字段）/, '错误信息必须点名第 7 字段——含糊的「缺字段」逼不出补写');
    assert.match(r.stdout, /业务诉求/, '错误信息须指路：从 Spec 业务上下文摘什么');
    assert.ok(!fs.existsSync(path.join(dir, '.zcode', 'state', 'state.json')), '拒绝不得落状态');
  } finally { rmDir(dir); }
});

test('B8-E2 business 空白字符串与非字符串类型：同拒绝（严格 string 非空校验，不是键存在校验）', () => {
  const dir = mkHarnessProj();
  try {
    for (const blank of ['   ', '\t\n']) {
      const r = zbase(['task', 'start', '--input', '-'], { cwd: dir, input: JSON.stringify({ ...SIX_FIELD, business: blank }) });
      assert.equal(r.code, 1, `business=${JSON.stringify(blank)} 必须按缺失拒绝`);
      assert.match(r.stdout, /缺 Business 字段（信封第 7 字段）/);
    }
    // 非字符串类型（123/true/{}）：String() 强转后会伪装成非空文本——必须按类型拒绝
    for (const nonString of [123, true, {}]) {
      const r = zbase(['task', 'start', '--input', '-'], { cwd: dir, input: JSON.stringify({ ...SIX_FIELD, business: nonString }) });
      assert.equal(r.code, 1, `business=${typeof nonString} 必须按缺失拒绝——非字符串不是业务诉求`);
      assert.match(r.stdout, /缺 Business 字段（信封第 7 字段）/);
    }
  } finally { rmDir(dir); }
});

test('B8-E3 business 在场：任务建成 exit 0 + envelope 含 business 落 state + invariants 恢复面带业务锚点（截断 ≤60）', () => {
  const dir = mkHarnessProj();
  try {
    const longBusiness = '运营月末对账时手工核对三张表太慢，本切片把导出对齐财务口径，对账从两小时缩到十分钟；不碰财务已有报表权限。'.repeat(2);
    const r = zbase(['task', 'start', '--input', '-', '--json'], { cwd: dir, input: JSON.stringify(withBusiness({ business: longBusiness })) });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.zcode', 'state', 'state.json'), 'utf8'));
    const task = state.tasks.find((t) => t.id === state.activeTask.id);
    assert.equal(task.envelope.business, longBusiness, 'business 原样入信封存档（state 不截断，截断只发生在恢复摘要面）');
    // 恢复面（invariants State 块）：任务摘要行带 business 且截断 ≤60——新会话第一眼就有业务锚点
    const inv = zbase(['invariants', '--json'], { cwd: dir });
    assert.equal(inv.code, 0, inv.stdout + inv.stderr);
    const line = inv.json.text.split('\n').find((l) => l.startsWith('- 任务:'));
    assert.ok(line, 'State 块须含任务行');
    const m = /business: ([^|]*?)(?=( \||$))/.exec(line);
    assert.ok(m, `任务摘要行须含 business 字段（恢复面业务锚点），实得：${line}`);
    assert.ok(m[1].trim().length > 0 && m[1].trim().length <= 60, `business 截断 ≤60，实得 ${m[1].trim().length}`);
  } finally { rmDir(dir); }
});

test('B8-E4 历史状态文件无 business：task status 读侧不迁移不报错（只拦新 task start）', () => {
  const dir = mkHarnessProj();
  try {
    // 手工构造 B1 前形态的历史状态：activeTask 的 envelope 无 business 键
    fs.mkdirSync(path.join(dir, '.zcode', 'state'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.zcode', 'state', 'state.json'), JSON.stringify({
      version: 1,
      activeTask: { id: 't-legacy', startedAt: '2026-09-01T00:00:00.000Z' },
      tasks: [{ id: 't-legacy', startedAt: '2026-09-01T00:00:00.000Z', envelope: SIX_FIELD, risk: 'medium', ownedPaths: [], refs: {}, reviewExclusions: [], baseline: { fingerprint: 'x' }, touchedPaths: [] }],
      fast: null, stopStrikes: null, degraded: [],
    }));
    const s = zbase(['task', 'status'], { cwd: dir });
    assert.equal(s.code, 0, s.stdout + s.stderr);
    assert.match(s.stdout, /t-legacy/);
    // 新 start 仍拦（活跃任务优先拦，先 finish 再验 business 拦截——直接换新沙箱验）
  } finally { rmDir(dir); }
  const dir2 = mkHarnessProj();
  try {
    // 老信封在其他六字段也缺时：通用缺字段信息优先于 business 专项（语义不互相吞）
    const r = zbase(['task', 'start', '--input', '-'], { cwd: dir2, input: JSON.stringify({ goal: 'g', business: 'b' }) });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /派单信封缺字段：/);
  } finally { rmDir(dir2); }
});

// ══════════════════ ② specLint 业务章节存在性 ══════════════════

// 最小可过 Spec：一条 REQ 带 EARS+规范性词+验收锚。businessCtx 控制是否含「## 业务上下文」章节。
function sandboxSpec(businessCtx) {
  const ctx = businessCtx ? '## 业务上下文\n\n为什么做：测试。\n\n' : '';
  return `# Spec\n\n${ctx}| 编号 | 需求 | 验收 |\n|---|---|---|\n| REQ-1 | 当 X 发生时必须做 Y | 验收：node -e 0 → exit 0 |\n`;
}

test('B8-S1 沙箱 Spec 缺业务上下文章节：spec-lint exit 3 + SPEC_NO_BUSINESS_CONTEXT', () => {
  const dir = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir, 'Product-Spec.md'), sandboxSpec(false));
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, 3, r.stdout + r.stderr);
    assert.ok(r.json.findings.some((f) => f.code === 'SPEC_NO_BUSINESS_CONTEXT'), '缺章节必须点名 SPEC_NO_BUSINESS_CONTEXT');
    assert.equal(r.json.ok, false);
  } finally { rmDir(dir); }
});

test('B8-S2 有「## 业务上下文」不报；### 子节与 HTML 注释包裹的假标题都不算章节锚', () => {
  const dir = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir, 'Product-Spec.md'), sandboxSpec(true));
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(!r.json.findings.some((f) => f.code === 'SPEC_NO_BUSINESS_CONTEXT'));
  } finally { rmDir(dir); }
  // ### 级子节标题（「### 业务上下文」）不满足 ## 级章节锚——子节顶替不了章节存在性
  const dir2 = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir2, 'Product-Spec.md'), `# Spec\n\n### 业务上下文\n子节形态\n\n| 编号 | 需求 | 验收 |\n|---|---|---|\n| REQ-1 | 当 X 发生时必须做 Y | 验收：node -e 0 → exit 0 |\n`);
    const r2 = zbase(['spec-lint', '--json'], { cwd: dir2 });
    assert.equal(r2.code, 3);
    assert.ok(r2.json.findings.some((f) => f.code === 'SPEC_NO_BUSINESS_CONTEXT'), '### 级不认——模板锚点是 ## 级章节');
  } finally { rmDir(dir2); }
  // HTML 注释区段里包裹的假标题（<!-- ## 业务上下文 -->）不算章节存在——剥注释后才算数，
  // 注释是写给维护者的不是写给 lint 的
  const dir3 = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir3, 'Product-Spec.md'), `# Spec\n\n<!--\n## 业务上下文\n注释里的假标题\n-->\n\n| 编号 | 需求 | 验收 |\n|---|---|---|\n| REQ-1 | 当 X 发生时必须做 Y | 验收：node -e 0 → exit 0 |\n`);
    const r3 = zbase(['spec-lint', '--json'], { cwd: dir3 });
    assert.equal(r3.code, 3);
    assert.ok(r3.json.findings.some((f) => f.code === 'SPEC_NO_BUSINESS_CONTEXT'), '注释里的假标题不得满足存在性检查');
  } finally { rmDir(dir3); }
});

test('B8-S3 无 Spec 文件：维持现状 rc 语义（degraded exit 3，无 SPEC_NO_BUSINESS_CONTEXT 假报）', () => {
  const dir = mkHarnessProj();
  try {
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, 3, '无需求文件=degraded（既有语义不变）');
    assert.equal(r.json.degraded, true);
    assert.match(r.json.reason, /无需求文件/);
    assert.ok(!JSON.stringify(r.json).includes('SPEC_NO_BUSINESS_CONTEXT'), '无对象不执法——不能拿不存在的东西报存在性缺失');
  } finally { rmDir(dir); }
});

// ══════════════════ ③ 模板与 skill 契约 + 本仓自举 ══════════════════

test('B8-T1 模板存在且锚点齐全 + 行为级：模板全文进沙箱实跑 spec-lint 必须 exit 0（模板=用户 Spec 第一现场）', () => {
  const p = path.join(REPO, '.zcode', 'harness', 'templates', 'Product-Spec.md');
  assert.ok(fs.existsSync(p), '模板必须存在——skill 引用它，悬空引用是幽灵路径');
  const text = fs.readFileSync(p, 'utf8');
  for (const anchor of [
    /^##\s*业务上下文\s*$/m, /^##\s*用户故事与场景\s*$/m, /^##\s*功能需求\s*$/m,
    /^##\s*非功能需求\s*$/m, /^##\s*边界与依赖\s*$/m, /^##\s*开放问题清单/m, /^##\s*签字\s*$/m,
  ]) assert.match(text, anchor);
  // 业务上下文四要素子节（为什么做/谁真正受益/现实中怎么运转/例外与隐性规则）+ 术语表
  for (const sub of ['### 为什么做', '### 谁真正受益', '### 现实中怎么运转', '### 例外与隐性规则', '### 术语表']) {
    assert.ok(text.includes(sub), `模板须含子节 ${sub}`);
  }
  // FISU 四标记 + 红卡语义 + 签字覆盖复述
  for (const fisu of ['【事实】', '【推断】', '【建议】', '开放问题清单']) assert.ok(text.includes(fisu), `模板须含 FISU 标记 ${fisu}`);
  assert.ok(text.includes('情境复述'), '签字语义须注明覆盖 AI 的情境复述');
  assert.ok(text.includes('spec-lint'), '作者规则注释须写明 spec-lint 读什么（dsh 实践）');
  // 行为级（review 升级项）：模板全文作为真实 Spec 进沙箱跑 spec-lint，子进程实跑 exit 0。
  // 剥注释的静态检查比真实运行宽松——注释里的占位词字面量在真实扫描同样命中，以实跑为准。
  const dir = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir, 'Product-Spec.md'), text);
    const r = zbase(['spec-lint', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `模板必须过自己的 spec-lint：\n${(r.json ? JSON.stringify(r.json.findings, null, 1) : r.stdout)}`);
    assert.equal(r.json.counts.error, 0);
  } finally { rmDir(dir); }
});

test('B8-K1 本仓自举：spec-lint 实跑 exit 0（业务上下文章节在场且不破坏既有判定）', () => {
  const r = zbase(['spec-lint', '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.counts.error, 0);
  assert.ok(r.json.counts.requirements >= 34, `本仓 34 条需求一条不丢，实得 ${r.json.counts.requirements}`);
});

test('B8-K2 重写后 product-spec-builder：frontmatter 完整 + 触发式描述 + 协议要素在场 + 本仓 skills-lint exit 0', () => {
  const p = path.join(REPO, '.zcode', 'skills', 'product-spec-builder', 'SKILL.md');
  const text = fs.readFileSync(p, 'utf8');
  const fm = parseFrontmatter(text);
  assert.equal(fm.ok, true, fm.reason);
  assert.equal(fm.data.name, 'product-spec-builder');
  assert.ok(fm.data.description.length <= 220, `description ${fm.data.description.length} 字符超软阈值（每会话付费）`);
  assert.ok(hasTrigger(fm.data.description), '描述必须是触发式（当…时使用）——否则模型读摘要跳正文漏触发');
  // 采访协议七动作与关键机制在场（协议密度对齐 design-brief-builder 范本）
  for (const key of ['先观察后提问', '先查后问', '问题预算', '带假设直答', '五个必问主题', 'example mapping', '护栏', '【推断】', '请纠偏', '收敛条件', '红卡未清', '对话示例']) {
    assert.ok(text.includes(key), `重写后 skill 须含 ${key}`);
  }
  // 本仓 skills-lint 全绿
  const r = zbase(['skills-lint', '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.counts.error, 0);
});

// ══════════════════ ④ rules-audit 棘轮锚 ══════════════════

test('B8-R1 rules-audit 棘轮锚：宪法信封段改动无倒退——ratio ≥ 0.361 且 phantom=0', () => {
  const r = rulesAudit();
  assert.equal(r.counts.phantom, 0, `宪法不得引入幽灵执法点：${JSON.stringify(r.phantoms)}`);
  assert.ok(r.enforcementRatio >= 0.361, `enforcementRatio ${r.enforcementRatio} < 0.361 基线（B1 信封段改动不得拉低已执法规则占比）`);
  // 信封第 7 字段进了宪法围栏内（六字段→七字段），围栏行本身不参与规则行计数——只验不倒退不断言新增
});
