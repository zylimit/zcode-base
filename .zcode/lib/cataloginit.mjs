// cataloginit：存量仓 catalog 草案生成器（批次 3，源 dsh 55f8dd7 discover × cc 9395d5c init 双源同证）。
// 「事实机器产、后果人决策」：机器只产可从代码读出的事实（目录聚类 / 真实 import 边 / 拓扑分层），
// 后果性字段（riskTier / attributes / forbiddenDeps / dependsOn）一律不猜——逐项列 needsDecision
// 说明为什么读不出。硬保证：草案自跑 catalog-lint 必须 0 error 才许写盘（开箱即用）；
// 已有 catalog 拒绝覆盖（--force 才行——已有声明是人的决策，草案会清掉它们）。
// 依赖方向：只依赖 core/graph（graph 提供 classify/extractImports/resolveToModule/lint）。
import path from 'node:path';
import { FILES, catalogExists, listPaths, rel, ROOT, writeJsonAtomic } from './core.mjs';
import { classify, extractImports, lint, resolveToModule } from './graph.mjs';

const slug = (s) => s.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.py', '.go', '.java', '.kt', '.cs', '.scala', '.swift', '.rb', '.php', '.rs']);

// 依赖图分层（sink 剥离法）：tier-0 = 不依赖任何模块的底层；tier-N = 依赖链最深可达 N。
// 只命名拓扑位置，不发明语义名（「contracts」「runtime」是人的决策）。
// 环残留（某轮无 sink 可剥）：剩余模块全体同层占位 + hasCycle 如实标注——不假装环有拓扑。
function tierAssign(moduleNames, edges) {
  const deps = new Map(moduleNames.map((n) => [n, new Set()]));
  for (const [f, t] of edges) {
    if (f !== t && deps.has(f) && deps.has(t)) deps.get(f).add(t);
  }
  const remaining = new Set(moduleNames);
  const tier = new Map();
  let level = 0;
  let hasCycle = false;
  while (remaining.size) {
    const sinks = [...remaining].filter((n) => [...deps.get(n)].every((d) => !remaining.has(d)));
    if (sinks.length === 0) {
      for (const n of remaining) tier.set(n, level);
      hasCycle = true;
      break;
    }
    for (const n of sinks) { tier.set(n, level); remaining.delete(n); }
    level++;
  }
  const max = Math.max(0, ...tier.values());
  // 数组顺序对齐 arch-check 语义（layers.indexOf(from) > indexOf(to) = 违规）：
  // 高层在前、底层在后——前面的可以依赖后面的，反向即违规。
  const layers = [];
  for (let i = max; i >= 0; i--) layers.push(`tier-${i}`);
  return { tier, layers, hasCycle };
}

// 草案生成：目录聚类 → 模块提案 → 真实 import 边扫描（referenceEdges，不进 deps）→ 拓扑分层。
// 三条不猜硬约束：riskTier 一律 low 占位；attributes 刻意不生成（留空让人定档）；
// deps 恒空（referenceEdges 供人采纳——写进声明图会让 arch-check 对自己的倒影检查，cc 教训）。
export function draft({ trackedPaths } = {}) {
  const paths = trackedPaths ?? listPaths();
  const byTop = new Map();
  const rootFiles = [];
  for (const p of paths) {
    const seg = p.split('/');
    if (seg.length === 1) { rootFiles.push(p); continue; }
    const top = seg[0];
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top).push(p);
  }
  // 非隐藏目录 → 模块；隐藏目录（.github/.zcode 等）与 node_modules → ignored（工具/配置面不是产品模块）。
  const moduleDirs = [...byTop.keys()].filter((d) => !d.startsWith('.') && d !== 'node_modules');
  const ignored = [...byTop.keys()]
    .filter((d) => d.startsWith('.') || d === 'node_modules')
    .map((d) => `${d}/**`)
    .sort();
  const modules = moduleDirs
    .sort()
    .map((d) => ({ name: slug(d), globs: [`${d}/**`] }));
  if (rootFiles.length > 0) modules.push({ name: 'root-files', globs: ['*'] });
  // slug 撞名（'My Dir' 与 'my-dir'）：不猜合并对象，响亮报错让人改名。
  const seen = new Set();
  for (const m of modules) {
    if (seen.has(m.name)) throw new Error(`目录名 slug 后撞名：${m.name}——目录名只能保留 [a-z0-9-]，请先改名去歧义`);
    seen.add(m.name);
  }
  const skeleton = { version: 1, layers: [], modules, global: [], ignored, catchAll: null };
  // 真实 import 边：相对/别名 import 解析到草案模块归属（包名导入忽略——外部依赖不由 catalog 管）。
  // 支持形态与 arch check 同源（graph.mjs extractImports/resolveToModule）：含 './x.mjs' 裸扩展名、
  // './x' 省扩展、'@/' 别名。未能解析的 spec 静默忽略（宁缺勿错——草案不装作看得见所有语言形态）。
  const edgeSet = new Set();
  for (const p of paths) {
    if (p.includes('node_modules') || !CODE_EXTS.has(path.extname(p))) continue;
    const from = classify(skeleton, p);
    if (from.kind !== 'module') continue;
    const abs = path.join(ROOT, p);
    for (const spec of extractImports(abs)) {
      const to = resolveToModule(ROOT, abs, spec, skeleton);
      if (!to || to === from.module) continue;
      edgeSet.add(`${from.module}\u0000${to}`);
    }
  }
  const referenceEdges = [...edgeSet]
    .map((k) => { const [from, to] = k.split('\u0000'); return { from, to }; })
    .sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`));
  const { tier, layers, hasCycle } = tierAssign(
    modules.map((m) => m.name),
    referenceEdges.map((e) => [e.from, e.to]),
  );
  skeleton.layers = layers;
  for (const m of skeleton.modules) {
    m.layer = `tier-${tier.get(m.name)}`; // 字符串（与 layers 数组元素一致；lint BAD_LAYER 执法形状）
    m.classification = 'product';
    m.description = 'TODO: 草案占位——机器只知目录边界，模块职责一句话由人补';
    m.deps = []; // 恒空：referenceEdges 是事实观察，采纳多少进声明是人的决策
    m.riskTier = 'low'; // 占位：riskTier 是「这里失效要付多少代价」的陈述，代码读不出
    // attributes 刻意不生成：八属性档位是设计意图不是代码事实（needsDecision 逐项列出）
  }
  return { skeleton, referenceEdges, hasCycle, trackedFiles: paths.length };
}

// needsDecision：逐模块列出「读不出的决策」+ 每项为什么（文案只出现一次，模块清单逐个点名）。
function decisionList(skeleton, referenceEdges, hasCycle) {
  const outEdges = new Map(skeleton.modules.map((m) => [m.name, 0]));
  for (const e of referenceEdges) outEdges.set(e.from, (outEdges.get(e.from) || 0) + 1);
  return {
    why: {
      riskTier: '草案占位 low——riskTier 是「这里失效要付多少代价」的陈述，代码读不出',
      attributes: '刻意不生成——八属性档位（resilience/…/maintainability）是设计意图，不是代码事实',
      forbiddenDeps: '不生成——禁边是政策决定（什么永远不许依赖什么）；import 边只能证明现状，证明不了政策',
      deps: '恒空——referenceEdges 是事实观察，采纳多少进声明是你的决定（arch-check 只对声明执法，不检查自己的倒影）',
    },
    modules: skeleton.modules.map((m) => ({
      module: m.name,
      open: ['riskTier', 'attributes', 'forbiddenDeps', 'deps'],
      observedOutEdges: outEdges.get(m.name) || 0,
    })),
    global: [
      'layers 的 tier-N 是拓扑位置命名——若要语义命名（如 contracts/runtime）由人改写并保持数组顺序（前可依赖后）',
      'global/ignored 划分是草案默认（隐藏目录与 node_modules 全进 ignored）——按仓库实际调整',
      ...(hasCycle ? ['检测到 import 环：环内模块被压平同层占位（hasCycle: true）——破环或显式接受，草案不假装环有拓扑'] : []),
    ],
  };
}

// 主入口：dry-run（默认）打印草案+needsDecision；--apply 写盘（写前自跑 lint，0 error 才落盘）。
export function init({ apply = false, force = false } = {}) {
  if (catalogExists() && !force) {
    return {
      ok: false,
      reason: 'module-catalog 已存在：拒绝覆盖（--force 才可重新生成；已有 deps/attributes/accepted 声明会被草案清掉）',
    };
  }
  const paths = listPaths();
  if (paths.length === 0) {
    return { ok: false, reason: 'git ls-files 无 tracked 路径——catalog init 面向存量仓（先 git add + commit 再跑）' };
  }
  let built;
  try {
    built = draft({ trackedPaths: paths });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  // 硬保证：草案自跑 catalog-lint（含 trackedPaths 归类审计）必须 0 error——绝不写自不一致的账本。
  const check = lint(built.skeleton, { trackedPaths: paths });
  if (check.errors.length) {
    return { ok: false, reason: '草案未通过自跑 catalog-lint（生成器不变量破坏，拒绝写盘）', errors: check.errors };
  }
  const needsDecision = decisionList(built.skeleton, built.referenceEdges, built.hasCycle);
  const summary = {
    ok: true,
    dryRun: !apply,
    modules: built.skeleton.modules.length,
    referenceEdges: built.referenceEdges.length,
    layers: built.skeleton.layers,
    trackedFiles: built.trackedFiles,
    ...(built.hasCycle ? { hasCycle: true } : {}),
    ...(apply ? { written: true, file: rel(ROOT, FILES.catalog), next: 'catalog lint 确认 rc 0 → 逐项清 needsDecision（补 description → 采纳 referenceEdges 进 deps → 定档）' } : {}),
  };
  if (apply) writeJsonAtomic(FILES.catalog, built.skeleton);
  return apply ? { ...summary, referenceEdges: built.referenceEdges, needsDecision }
    : { ...summary, draft: built.skeleton, referenceEdges: built.referenceEdges, needsDecision };
}
