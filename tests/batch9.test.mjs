// B2+B3 批测试（源 bridge-positioning-diagnosis-20260908.md 四节重设计）：
// B2 全链贯通：业务上下文从 Spec 贯通到架构/计划/审查/测试/实现——三模板新栏/新列锚点 +
//    五 skill 增补锚点（arch-designer 业务推导/dev-planner 价值排序/code-review 业务意图对照/
//    test-builder 验收双轨/dev-builder Business 摘取纪律）。
// B3 纠正闭环：feedbacklint 四新字段执法（新条目缺 = error；存量旧日期缺 = 兼容）+
//    feedback-writer 五分类与回显闭环协议 + evolution 毕业判据同族聚类化 + progress 修正关系标注。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { zbase, mkHarnessProj, rmDir, REPO } from './helpers.mjs';
import { parseFrontmatter, hasTrigger, FEEDBACK_NEW_SCHEMA_CUTOFF } from '../.zcode/lib/scan.mjs';

// ══════════════════ ① feedbacklint 四新字段执法（B3-11）══════════════════

// 新条目（date ≥ 生效日）缺四字段：沙箱实跑 feedback lint 必须 exit 1 且逐字段点名。
test('B9-F1 新条目（新日期）缺四新字段：feedback lint exit 1 + NEW_SCHEMA_MISSING 逐字段点名', () => {
  const dir = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'new-entry-missing-fields.md'), [
      '---',
      'id: new-entry-missing-fields',
      'occurrences: 1',
      'graduated: false',
      `date: ${FEEDBACK_NEW_SCHEMA_CUTOFF}`, // 生效日当日创建（含当日）
      '---',
      '',
      '# new-entry-missing-fields',
      '',
      '## 现象', '', 'x', '', '## 根因', '', 'y', '', '## 规则（可执行表述）', '', 'z', '',
    ].join('\n'));
    const r = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(r.code, 1, `契约破坏必须 exit 1：${r.stdout}${r.stderr}`);
    assert.equal(r.json.ok, false);
    const misses = r.json.errors.filter((e) => e.code === 'NEW_SCHEMA_MISSING');
    // basis/scope/trace 三字段值缺失 + supersedes 键缺席 = 4 条点名（supersedes 是「键必须在场」独立语义）
    assert.equal(misses.length, 4, `四字段逐一点名，实得 ${misses.length}：${JSON.stringify(misses)}`);
    for (const field of ['basis', 'scope', 'supersedes', 'trace']) {
      assert.ok(misses.some((e) => e.message.includes(field)), `错误信息须点名 ${field}`);
    }
  } finally { rmDir(dir); }
});

// 存量兼容双面：旧日期条目缺四字段不报错（不追溯填充）+ 本仓 23 条真实存量全过。
test('B9-F2 存量条目缺四字段不报错：沙箱旧日期条目过 + 本仓 feedback lint 实跑 exit 0', () => {
  const dir = mkHarnessProj();
  try {
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'legacy-entry-old-date.md'), [
      '---',
      'id: legacy-entry-old-date',
      'occurrences: 1',
      'graduated: false',
      'date: 2026-09-01', // 生效日前存量：四字段缺席照旧合法
      '---',
      '',
      '# legacy-entry-old-date', '', '正文', '',
    ].join('\n'));
    const r = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(r.code, 0, `旧日期条目不得追溯执法：${r.stdout}${r.stderr}`);
    assert.ok(!JSON.stringify(r.json.errors).includes('NEW_SCHEMA_MISSING'));
    // 无 date 键的 B3 前形态（本仓 23 条存量即此形态）同样不报——date 缺席 = 存量
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'legacy-entry-old-date.md'));
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'legacy-no-date.md'), [
      '---', 'id: legacy-no-date', 'occurrences: 2', 'graduated: false', '---', '', '# legacy-no-date', '',
    ].join('\n'));
    const r2 = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(r2.code, 0, '无 date 键的存量形态不报错');
  } finally { rmDir(dir); }
  // 本仓自举：真实存量 23 条（全部无 date 键）+ INDEX 头部措辞更新不破坏一致性
  const r = zbase(['feedback', 'lint', '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.ok, true);
  assert.ok(r.json.entries >= 23, `本仓存量条目一条不丢，实得 ${r.json.entries}`);
});

// 新条目合规面：四字段齐过；supersedes 值可空过（键在场语义）；date 格式坏 fail-visible。
test('B9-F3 新条目四字段齐 + supersedes 留空值：过；date 格式坏：BAD_DATE 不默认放过', () => {
  const dir = mkHarnessProj();
  const write = (name, fmDate, extra = '') => fs.writeFileSync(
    path.join(dir, '.zcode', 'feedback', `${name}.md`),
    ['---', `id: ${name}`, 'occurrences: 1', 'graduated: false', `date: ${fmDate}`,
      'basis: 用户说「这不是我要的」', 'scope: 适用于导出口径类需求；不适用于权限类', `supersedes: ${extra || ''}`,
      'trace: 2026-09-08 会话中用户纠正受益人', '---', '', `# ${name}`, '', '正文', ''].join('\n'));
  try {
    write('new-entry-complete', '2026-09-08'); // supersedes 空值（键在场）= 「没有取代关系」也是回答
    const ok = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(ok.code, 0, `四字段齐+supersedes 留空必须过：${ok.stdout}${ok.stderr}`);
    write('new-entry-supersedes-set', '2026-09-08', 'red-locks-the-bug'); // supersedes 有值且指向在档条目（悬空校验见 F4）
    const ok2 = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(ok2.code, 0);
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'new-entry-complete.md'));
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'new-entry-supersedes-set.md'));
    write('new-entry-bad-date', '2026/09/08'); // 非 YYYY-MM-DD：无法判定新旧 → fail-visible
    const bad = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(bad.code, 1, 'date 格式坏不得默认按存量放过');
    assert.ok(bad.json.errors.some((e) => e.code === 'BAD_DATE'), '须点名 BAD_DATE');
  } finally { rmDir(dir); }
});

// supersedes 悬空引用（P2-1 red-locks）：修正链断链必须机器发现（仓库先例：trace 悬空引用 fail）。
// 三态：悬空 → exit 1 点名；指向真实存量条目 → 过；自指 → 拒（取代自己无意义）。
test('B9-F4 supersedes 三态：悬空 exit 1 + DANGLING_SUPERSEDES；指向存量条目过；自指拒', () => {
  const dir = mkHarnessProj();
  const writeNew = (name, supersedes) => fs.writeFileSync(
    path.join(dir, '.zcode', 'feedback', `${name}.md`),
    ['---', `id: ${name}`, 'occurrences: 1', 'graduated: false', 'date: 2026-09-08',
      'basis: 用户纠正受益人', 'scope: 导出口径类需求适用；权限类不适用', `supersedes: ${supersedes}`,
      'trace: 2026-09-08 会话纠正', '---', '', `# ${name}`, '', '正文', ''].join('\n'));
  try {
    // 态 a：悬空——指向不在档 id（增量 seenIds 会误判后遍历条目，全量 id 集二遍必须放行「指向后遍历存量」的形态，
    // 此处同时用一条无 date 存量目标验证后遍历不误判：见态 b
    writeNew('new-dangling', 'no-such-entry');
    const bad = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(bad.code, 1, '悬空 supersedes 必须契约破坏 exit 1');
    assert.ok(bad.json.errors.some((e) => e.code === 'DANGLING_SUPERSEDES' && e.message.includes('no-such-entry')),
      `须点名 DANGLING_SUPERSEDES 且含悬空 id，实得 ${JSON.stringify(bad.json.errors)}`);
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'new-dangling.md'));
    // 态 b：指向真实存量条目（本仓拷贝进沙箱的 23 条之一，后于新条目遍历也不得误判——二轮全量 id 集）
    writeNew('new-valid-ref', 'red-locks-the-bug');
    const ok = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(ok.code, 0, `指向真实存量条目必须过：${ok.stdout}${ok.stderr}`);
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'new-valid-ref.md'));
    // 态 c：自指——supersedes 指向自己（id 在全量集内，悬空检查抓不住，须独立拒）
    writeNew('new-self-ref', 'new-self-ref');
    const self = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(self.code, 1, '自指必须拒——取代自己无意义');
    assert.ok(self.json.errors.some((e) => e.message.includes('new-self-ref')), '自指错误须点名条目');
  } finally { rmDir(dir); }
});

// 四字段值占位形态（P3-3 red-locks）：尖括号包裹 <...> 或 SPEC_PLACEHOLDERS 命中 = 没填（对齐 spec-lint PLACEHOLDER 先例）；
// supersedes 空值仍合法过（「没有取代关系」语义）。
test('B9-F5 新条目四字段占位形态：尖括号包裹/SPEC_PLACEHOLDERS 命中 → error；正常值+空 supersedes 过', () => {
  const dir = mkHarnessProj();
  const fmLines = (name, fields) => ['---', `id: ${name}`, 'occurrences: 1', 'graduated: false', 'date: 2026-09-08', ...fields, '---', '', `# ${name}`, '', '正文', ''].join('\n');
  try {
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'new-angle-placeholder.md'), fmLines('new-angle-placeholder', [
      'basis: <用户原话/触发事件>', 'scope: 何时适用', 'supersedes: ', 'trace: 2026-09-08 会话',
    ]));
    const a = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(a.code, 1, '尖括号包裹整值=模板占位未填，必须 error');
    assert.ok(a.json.errors.some((e) => e.message.includes('basis') && /占位/.test(e.message)), '须点名 basis 占位形态');
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'new-angle-placeholder.md'));
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'new-tbd-placeholder.md'), fmLines('new-tbd-placeholder', [
      'basis: 用户纠正', 'scope: 待定', 'supersedes: ', 'trace: 2026-09-08 会话',
    ]));
    const b = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(b.code, 1, 'SPEC_PLACEHOLDERS 命中（待定）必须 error');
    assert.ok(b.json.errors.some((e) => e.message.includes('scope')), '须点名 scope');
    fs.rmSync(path.join(dir, '.zcode', 'feedback', 'new-tbd-placeholder.md'));
    // 正常值 + supersedes 空串：不误伤
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'new-normal.md'), fmLines('new-normal', [
      'basis: 用户说「给运营不是财务」', 'scope: 导出口径适用；权限类不适用', 'supersedes: ', 'trace: 2026-09-08 会话纠正',
    ]));
    const ok = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(ok.code, 0, `正常值+空 supersedes 必须过：${ok.stdout}${ok.stderr}`);
    // 存量条目（无 date）带占位形态 → 不报：占位执法只对带 date 的新条目，存量不追溯填充
    fs.writeFileSync(path.join(dir, '.zcode', 'feedback', 'legacy-placeholder.md'), ['---', 'id: legacy-placeholder', 'occurrences: 1', 'graduated: false',
      'basis: <用户原话/触发事件>', 'scope: 待定', '---', '', '# legacy-placeholder', '', '正文', ''].join('\n'));
    const legacy = zbase(['feedback', 'lint', '--json'], { cwd: dir });
    assert.equal(legacy.code, 0, `存量条目（无 date）占位形态不追溯不报：${legacy.stdout}${legacy.stderr}`);
  } finally { rmDir(dir); }
});



// ══════════════════ ② feedback-writer 协议锚点（B3-10）══════════════════

test('B9-K1 feedback-writer：五分类「业务理解偏差」+ 回显闭环协议键 + 四新字段 + 不重问', () => {
  const text = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'feedback-writer', 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(text);
  assert.equal(fm.ok, true, fm.reason);
  assert.equal(fm.data.name, 'feedback-writer');
  assert.ok(hasTrigger(fm.data.description), '描述保持触发式');
  // 五分类：四旧类仍在 + 第五类「业务理解偏差」与信号词在场
  for (const key of ['流程问题', '技术判断错误', '机制缺口', '偏好', '业务理解偏差', '这不是我要的', '你理解错了我的场景']) {
    assert.ok(text.includes(key), `feedback-writer 须含 ${key}`);
  }
  // 回显闭环协议：同一回复 + 改变了什么 + 不再重问（不止于道歉的机器化落点）
  for (const key of ['回显闭环', '同一回复', '不再重问', '止于道歉']) {
    assert.ok(text.includes(key), `回显闭环协议须含 ${key}`);
  }
  // 四新字段必填 + 存量兼容条款
  for (const key of ['basis', 'scope', 'supersedes', 'trace', '不追溯填充']) {
    assert.ok(text.includes(key), `四新字段契约须含 ${key}`);
  }
  // 写前核对在档 scope（已答/已授权不重问的支撑动作）
  assert.ok(text.includes('核对在档条目'), '落条目前须核对在档 scope——有则更新 occurrence 不新开');
});

// ══════════════════ ③ 三模板新栏/新列锚点（B2-1/2/3）══════════════════

test('B9-T1 B2 三模板锚点：架构三列映射+业务推导节；DEV-PLAN 价值/未知列+排序规则；Review 业务意图核对栏', () => {
  const arch = fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'templates', 'Architecture-Design-Template.md'), 'utf8');
  // 需求映射三列表头（中间列=业务诉求，从业务上下文摘一句）
  assert.match(arch, /\|\s*Spec 条目\s*\|\s*业务诉求（从业务上下文摘一句）\s*\|\s*架构承接\s*\|/, '映射表必须三列且中间列点名业务诉求来源');
  // 业务推导节：五问 + 三段式取舍 + DFX 顺序倒置修正
  assert.match(arch, /^##\s*2\.\s*业务推导\s*$/m, '业务推导必须是编号独立节');
  for (const key of ['业务职责', '数据归属', '一致性要求', '故障后果', '团队能力', '业务理由→技术选择→被牺牲方', '顺序倒置']) {
    assert.ok(arch.includes(key), `架构模板业务推导须含 ${key}`);
  }
  // 后续节编号顺延：提取全部 `^## N.` 序列，严格 1..N 递增唯一（P3-2 升级——
  // 旧 includes 形态两个 ## 4. 骗得过：每个编号都在场，重复检测不到）
  const seq = [...arch.matchAll(/^##\s+(\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepEqual(seq, seq.map((_, i) => i + 1), `编号节必须严格 1..${seq.length} 递增唯一，实得 ${seq.join(',')}`);
  // 对照实证：畸形文本（追加一个重复的 ## 4.）旧 includes 断言骗得过、新序列断言必拒——本断言即 red-locks 锚
  const malformed = `${arch}\n## 4. 重复节\n`;
  const badSeq = [...malformed.matchAll(/^##\s+(\d+)\./gm)].map((m) => Number(m[1]));
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    assert.ok(malformed.includes(`## ${n}.`), '前置：旧 includes 断言对畸形文本确实绿（骗得过实证）');
  }
  assert.notDeepEqual(badSeq, badSeq.map((_, i) => i + 1), '新序列断言必须抓住重复编号（两个 ## 4.）');

  const plan = fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'templates', 'DEV-PLAN-Template.md'), 'utf8');
  assert.ok(plan.includes('| 价值/未知 |'), 'Task 表须含「价值/未知」列');
  assert.match(plan, /\|\s*Task\s*\|.*\|\s*价值\/未知\s*\|/, '「价值/未知」必须是 Task 表尾列');
  assert.ok(plan.includes('价值交付与关键未知优先'), '头部作者规则须写明排序=价值与关键未知优先');
  assert.ok(plan.includes('不只依赖正序'), '须点名不只依赖正序');
  assert.ok(plan.includes('Business'), '头部规则须注明价值/未知列是信封 Business 的来源');

  const rev = fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'templates', 'Review-Receipt-Template.md'), 'utf8');
  assert.ok(rev.includes('### 业务意图核对'), 'Stage 1 下须有「业务意图核对」子栏');
  for (const key of ['对应业务诉求', '意图仍成立', '升级回 Spec']) {
    assert.ok(rev.includes(key), `Review-Receipt 业务意图核对须含 ${key}`);
  }
  assert.ok(rev.includes('业务锚点'), '审查范围须有业务锚点行（reviewer 先读信封 Business）');
});

// ══════════════════ ④ Feedback 模板四新字段（B3-9）══════════════════

test('B9-T2 Feedback 模板：frontmatter 五新键 + 生效日兼容条款注释 + 被取代不删约定', () => {
  const text = fs.readFileSync(path.join(REPO, '.zcode', 'harness', 'templates', 'Feedback-Template.md'), 'utf8');
  const fm = parseFrontmatter(text);
  assert.equal(fm.ok, true, fm.reason);
  for (const key of ['date', 'basis', 'scope', 'supersedes', 'trace']) {
    assert.ok(fm.data[key] !== undefined, `模板 frontmatter 须含 ${key} 键（带释义占位）`);
  }
  assert.ok(text.includes('不追溯填充'), '须写明存量条目不追溯填充（兼容条款）');
  assert.ok(text.includes('2026-09-07'), '须写明四新字段生效日');
  assert.ok(text.includes('append-only'), 'supersedes 语义须注明被取代条目不删（append-only）');
  assert.ok(text.includes('同族失败模式聚类'), 'occurrence 行须与 evolution 新判据一致（不残留 occurrence ≥3 毕业旧表述）');
  assert.ok(!text.includes('≥3 毕业为规则'), '旧判据表述必须清除');
});

// ══════════════════ ⑤ 五 skill 增补锚点（B2-4..8）══════════════════

test('B9-K2 B2 五 skill 增补锚点：业务推导/价值排序/业务意图对照/验收双轨/Business 摘取', () => {
  const read = (name) => fs.readFileSync(path.join(REPO, '.zcode', 'skills', name, 'SKILL.md'), 'utf8');
  const arch = read('arch-designer');
  assert.ok(arch.includes('## 业务推导'), 'arch-designer 须有业务推导节');
  for (const key of ['让谁的业务更好', '升级回 Spec', '具体业务情境复述', '被牺牲方']) {
    assert.ok(arch.includes(key), `arch-designer 须含 ${key}`);
  }
  const planner = read('dev-planner');
  for (const key of ['价值交付与关键未知优先', '不只依赖正序', '价值/未知', 'Business']) {
    assert.ok(planner.includes(key), `dev-planner 须含 ${key}`);
  }
  const review = read('code-review');
  for (const key of ['业务意图对照', '代码合规但业务意图偏移', '按 FIX 处理并升级回 Spec']) {
    assert.ok(review.includes(key), `code-review 须含 ${key}`);
  }
  const tester = read('test-builder');
  for (const key of ['验收来源双轨', '工程面', '场景面', '对应哪条 example']) {
    assert.ok(tester.includes(key), `test-builder 须含 ${key}`);
  }
  const builder = read('dev-builder');
  for (const key of ['不自行编造', '七字段信封', 'Escalation 交回主 Agent', '理解快照']) {
    assert.ok(builder.includes(key), `dev-builder 须含 ${key}`);
  }
  // 五个 skill frontmatter 均完好（增补不破坏 skills-lint 契约面）
  const r = zbase(['skills-lint', '--json']);
  assert.equal(r.code, 0, `skills-lint 全绿：${r.stdout}${r.stderr}`);
  assert.equal(r.json.counts.error, 0);
});

// ══════════════════ ⑥ evolution 同族聚类判据 + progress 修正关系（B3-12/13）══════════════════

test('B9-K3 evolution 判据同族聚类化 + progress-recorder 修正关系标注 + INDEX 同步', () => {
  const evo = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'evolution-engine', 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(evo);
  assert.equal(fm.ok, true, fm.reason);
  assert.ok(fm.data.description.includes('同族失败模式聚类'), 'description 判据须更新为聚类（清掉 occurrence ≥3 主导表述）');
  assert.ok(evo.includes('主判据 = 同族失败模式聚类'), '须显式声明主判据');
  assert.ok(evo.includes('参考信号') && evo.includes('不单独触发'), '单条 occurrence 须降为参考信号不单独触发');
  assert.ok(evo.includes('spec-overfitting-quantitative'), '须注明与 spec-overfitting 教训对齐');
  assert.ok(evo.includes('数字可审计≠数字承载价值'), '对齐理由须在场');

  const prog = fs.readFileSync(path.join(REPO, '.zcode', 'skills', 'progress-recorder', 'SKILL.md'), 'utf8');
  assert.ok(prog.includes('修正为'), 'Decisions 须有修正关系标注形态');
  assert.ok(prog.includes('触发：<用户纠正/反例/新证据>'), '修正标注须带触发来源');
  assert.ok(prog.includes('修正链'), '须写明为何要修正标注（防弃子回捡）');

  // INDEX 头部与新判据同步（不残留「occurrence ≥3 = 毕业候选」旧主导表述）
  const idx = fs.readFileSync(path.join(REPO, '.zcode', 'feedback', 'FEEDBACK-INDEX.md'), 'utf8');
  assert.ok(idx.includes('同族失败模式聚类'), 'INDEX 头部判据须同步');
  assert.ok(!idx.includes('occurrence ≥3 = 毕业候选'), 'INDEX 不得残留旧判据主导表述');
});

// ══════════════════ ⑦ 本仓自举收口（全量回归面在 CI run-all）══════════════════

test('B9-K4 本仓自举：feedback lint + spec-lint 实跑 exit 0（B2/B3 改动不破坏既有面）', () => {
  const fb = zbase(['feedback', 'lint', '--json']);
  assert.equal(fb.code, 0, fb.stdout + fb.stderr);
  const spec = zbase(['spec-lint', '--json']);
  assert.equal(spec.code, 0, spec.stdout + spec.stderr);
  assert.equal(spec.json.ok, true);
});
