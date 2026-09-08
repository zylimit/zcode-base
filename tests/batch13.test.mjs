// 批次 13（evolution P1-P11 落地批，2026-09-08）：
// ① P5 ADR 真相源棘轮三态：沙箱新 ADR 缺栏 error / 本仓存量 8 ADR 豁免实跑 0 error /
//    悬空真相源路径 error + 路径/命令/URL 三形态对照；
// ② P1-P7 毕业标记：七条 frontmatter graduated+graduatedAt+graduatedTo 三键 + feedback lint 全过 +
//    FEEDBACK-INDEX 对应行同步一致；
// ③ P11 shim 删除锁：七文件不存在 + arch.mjs（非名单）保留 + catalog globs 无残留
//    （import 零断链不设专项用例——由 npm test 全量 + selftest 承担，dispatch 约定）；
// ④ P9 宪法棘轮锚：rules-audit ratio ≥ 0.395 且 phantom 0（毕业句并入既有行不新增行）；
// ⑤ P8/P10 落点锚：code-review/bug-fixer 同族检查项 + release-builder ls-remote 步在场。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkHarnessProj, rmDir, zbase, REPO } from './helpers.mjs';

const ADR_DIR = (dir) => path.join(dir, '.zcode', 'docs', 'adr');
const writeAdr = (dir, name, body) => {
  fs.mkdirSync(ADR_DIR(dir), { recursive: true });
  fs.writeFileSync(path.join(ADR_DIR(dir), name), `# ADR-XXXX: t\n\n${body}\n`);
};

// ══════════════════ ① P5 ADR 真相源棘轮 ══════════════════

test('B13-T1 新 ADR（date ≥ 2026-09-08）缺「真相源」行 → error exit 3；日期坏格式按新档处理', () => {
  const dir = mkHarnessProj();
  try {
    writeAdr(dir, '0009-missing.md', '- 状态: Proposed\n- 日期: 2026-09-08\n- Enforced-by: doctor\n');
    const r = zbase(['adr', 'check', '--json'], { cwd: dir });
    assert.equal(r.code, 3, `缺栏必须 findings exit 3：${r.stdout}${r.stderr}`);
    assert.equal(r.json.ok, false);
    assert.ok(r.json.errors.some((e) => e.kind === 'no-truth-source' && e.file === '0009-missing.md'),
      `须点名 no-truth-source：${JSON.stringify(r.json.errors)}`);
    // 日期格式坏 = 独立 BAD_DATE error（对齐 feedbacklint），且按新档口径继续跑真相源检查
    writeAdr(dir, '0010-baddate.md', '- 状态: Proposed\n- 日期: YYYY-MM-DD\n- Enforced-by: doctor\n');
    const r2 = zbase(['adr', 'check', '--json'], { cwd: dir });
    assert.equal(r2.code, 3);
    assert.ok(r2.json.errors.some((e) => e.kind === 'BAD_DATE' && e.file === '0010-baddate.md'),
      `坏日期须独立 BAD_DATE error：${JSON.stringify(r2.json.errors)}`);
    assert.ok(r2.json.errors.some((e) => e.kind === 'no-truth-source' && e.file === '0010-baddate.md'),
      'BAD_DATE 按新档处理后真相源检查照跑不受影响');
  } finally { rmDir(dir); }
});

test('B13-T2 存量豁免实跑：本仓 docs/adr 8 个存量 ADR（date < 2026-09-08）0 error', () => {
  const r = zbase(['adr', 'check', '--json']);
  assert.equal(r.code, 0, `本仓实跑必须 0 error：${r.stdout}${r.stderr}`);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.files, 8, '存量 8 ADR 全量在场');
  assert.deepEqual(r.json.errors, []);
  // 模板带真相源栏 + adr check 执法说明（HTML 注释作者规则）
  const tpl = fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'templates', 'ADR-Template.md'), 'utf8');
  assert.ok(/^- 真相源: /m.test(tpl), 'ADR 模板须带「真相源」栏');
  assert.ok(/adr check/.test(tpl) && /真相源/.test(tpl), '模板须写明 adr check 执法此栏');
  // P2-1 同族契约锚：ADR-CONTRACT 与模板同步（头部五行+真相源行节——sibling-config 族，改一处须同改）
  const contract = fs.readFileSync(path.join(REPO, '.zcode', 'docs', 'ADR-CONTRACT.md'), 'utf8');
  assert.match(contract, /头部五行元数据（标题\/状态\/日期\/决策人\/真相源）/, '契约头部计数须含真相源（防回退到四行）');
  assert.match(contract, /## 真相源行/, '契约须有「真相源行」执法节');
});

test('B13-T3 悬空真相源路径 error；实存路径/命令/URL 形态放行（非路径只查非空）', () => {
  const dir = mkHarnessProj();
  try {
    // 悬空路径：反引号内仓内路径不存在 → ghost-truth-source
    writeAdr(dir, '0009-dangling.md',
      '- 状态: Proposed\n- 日期: 2026-09-08\n- Enforced-by: doctor\n- 真相源: 见 `.zcode/lib/nonexistent.mjs` 现状\n');
    const r = zbase(['adr', 'check', '--json'], { cwd: dir });
    assert.equal(r.code, 3);
    assert.ok(r.json.errors.some((e) => e.kind === 'ghost-truth-source' && e.ref === '.zcode/lib/nonexistent.mjs'),
      `须点名悬空路径：${JSON.stringify(r.json.errors)}`);
    // 对照：实存路径（沙箱复制了完整 .zcode）+ 命令形 + URL 形 + 裸词形态全放行
    writeAdr(dir, '0009-dangling.md',
      '- 状态: Proposed\n- 日期: 2026-09-08\n- Enforced-by: doctor\n'
      + '- 真相源: `node .zcode/zbase.mjs receipt verify` 输出 + `.zcode/lib/quality.mjs` 现状；'
      + '上游见 https://example.com/adr 与 `git ls-remote --tags origin`\n');
    const r2 = zbase(['adr', 'check', '--json'], { cwd: dir });
    assert.equal(r2.code, 0, `实存/命令/URL 形态不得误拦：${r2.stdout}${r2.stderr}`);
    // 空值：栏在场但空 → error（非路径形态也必须写出具体指向）
    writeAdr(dir, '0009-dangling.md', '- 状态: Proposed\n- 日期: 2026-09-08\n- Enforced-by: doctor\n- 真相源:\n');
    const r3 = zbase(['adr', 'check', '--json'], { cwd: dir });
    assert.equal(r3.code, 3);
    assert.ok(r3.json.errors.some((e) => e.kind === 'empty-truth-source'), '空真相源必须拦');
    // 占位形态（review P3-2）：尖括号整值包裹=模板原文没改 → error——占位值内含实存路径
    // （`.zcode/lib/quality.mjs` 在沙箱存在）也不得借实存校验静默通过
    writeAdr(dir, '0009-dangling.md',
      '- 状态: Proposed\n- 日期: 2026-09-08\n- Enforced-by: doctor\n'
      + '- 真相源: <本决策所依赖事实的权威文件/命令——见 `.zcode/lib/quality.mjs` 现状>\n');
    const r4 = zbase(['adr', 'check', '--json'], { cwd: dir });
    assert.equal(r4.code, 3, '占位形态必须拦');
    assert.ok(r4.json.errors.some((e) => e.kind === 'PLACEHOLDER_TRUTH_SOURCE' && e.file === '0009-dangling.md'),
      `须点名占位形态：${JSON.stringify(r4.json.errors)}`);
  } finally { rmDir(dir); }
});

// ══════════════════ ② P1-P7 毕业标记 ══════════════════

const GRADUATED = [
  'completion-claims-need-fresh-verification', // P1
  'destructive-ops-recheck-live-state',        // P2
  'main-agent-no-direct-coding',               // P3
  'red-locks-the-bug',                         // P4
  'single-truth-source-rejection',             // P5
  'three-file-sync-clearable-recap-recovery',  // P6
  'waiver-lifecycle-explicit',                 // P7
];

test('B13-F1 七条毕业三键在场（graduated/graduatedAt/graduatedTo）+ feedback lint 全过 + 候选清零', () => {
  for (const id of GRADUATED) {
    const fm = fs.readFileSync(path.join(REPO, '.zcode', 'feedback', `${id}.md`), 'utf8').split('---')[1];
    assert.match(fm, /^graduated: true$/m, `${id} 须 graduated: true`);
    assert.match(fm, /^graduatedAt: 2026-09-08$/m, `${id} 须 graduatedAt: 2026-09-08`);
    assert.match(fm, /^graduatedTo: \S.+/m, `${id} 须 graduatedTo 机制落点一句话`);
  }
  const lint = zbase(['feedback', 'lint', '--json']);
  assert.equal(lint.code, 0, `毕业标记不得破坏契约：${lint.stdout}${lint.stderr}`);
  assert.equal(lint.json.ok, true);
  const list = zbase(['feedback', 'list', '--json']);
  assert.equal(list.code, 0);
  assert.equal(list.json.candidates.length, 0, '七条毕业后无 ≥3 未毕业候选残留');
});

test('B13-F2 FEEDBACK-INDEX 行同步：七条对应行均为「已毕业 2026-09-08」状态', () => {
  const index = fs.readFileSync(path.join(REPO, '.zcode', 'feedback', 'FEEDBACK-INDEX.md'), 'utf8');
  for (const id of GRADUATED) {
    const row = index.split('\n').find((l) => l.includes(`| ${id} |`));
    assert.ok(row, `INDEX 缺 ${id} 行`);
    assert.match(row, /已毕业 2026-09-08/, `${id} 行状态须同步为已毕业`);
  }
});

// ══════════════════ ③ P11 shim 删除锁 ══════════════════

test('B13-S1 七 shim 已删零残留 + arch.mjs（非名单）保留 + catalog globs 无悬空指向', () => {
  // import 零断链不设专项断言：npm test 全量加载 + selftest 引擎自检即断链证明（派单约定）。
  for (const m of ['waivers', 'tasks', 'receipts', 'plan', 'budget', 'review', 'audit']) {
    assert.equal(fs.existsSync(path.join(REPO, '.zcode', 'lib', `${m}.mjs`)), false, `lib/${m}.mjs 应已删除`);
  }
  assert.equal(fs.existsSync(path.join(REPO, '.zcode', 'lib', 'arch.mjs')), true, 'arch.mjs 不在 P11 名单，保留');
  assert.equal(fs.existsSync(path.join(REPO, '.zcode', 'lib', 'quality.mjs')), true, '合并主体 quality.mjs 在场');
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'module-catalog.json'), 'utf8'));
  const globs = catalog.modules.flatMap((mod) => mod.globs || []);
  for (const g of globs.filter((g) => g.startsWith('.zcode/lib/') && g.endsWith('.mjs'))) {
    assert.equal(fs.existsSync(path.join(REPO, g)), true, `catalog glob 指向不存在文件：${g}`);
  }
});

// ══════════════════ ④ P9 宪法棘轮锚 ══════════════════

test('B13-A1 宪法改动后 rules-audit ratio ≥ 0.395 且 phantom 0（毕业句并入既有行不新增行）', () => {
  const r = zbase(['rules-audit', '--json']);
  assert.equal(r.code, 0, `rules-audit 须过闸：${r.stdout}${r.stderr}`);
  assert.ok(r.json.enforcementRatio >= 0.395, `ratio 倒退：${r.json.enforcementRatio} < 0.395`);
  assert.equal(r.json.counts.phantom, 0, 'phantom 幽灵执法点恒 0');
  const agents = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
  assert.match(agents, /关键证据主 Agent 亲验——子代理的自报不替代主 Agent 读输出/, 'P9 毕业句须在宪法纪律 5');
});

// ══════════════════ ⑤ P8/P10 落点锚 ══════════════════

test('B13-K1 族A/族B/tag 三落点行在场：code-review 同族配置面 / bug-fixer 同类实例扫描 / release-builder ls-remote', () => {
  const cr = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'code-review', 'SKILL.md'), 'utf8');
  assert.match(cr, /同族配置面/, 'code-review 须加 sibling-config 族类别覆盖检查项');
  const bf = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'bug-fixer', 'SKILL.md'), 'utf8');
  assert.match(bf, /同类配置实例是否同病/, 'bug-fixer 须加 config-defects 族检查项');
  const rb = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'release-builder', 'SKILL.md'), 'utf8');
  assert.match(rb, /git ls-remote --tags origin/, 'release-builder 打 tag 前须实查远端（P10 事实修正）');
  const orch = fs.readFileSync(path.join(REPO, '.zcode', 'rules', 'orchestration.md'), 'utf8');
  assert.match(orch, /子代理的自报不替代主 Agent 读输出/, 'orchestration 三铁律须展开族B同义句');
});
