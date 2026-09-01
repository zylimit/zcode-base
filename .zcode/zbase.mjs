#!/usr/bin/env node
// zbase 治理 CLI 统一入口。
// 用法：node .zcode/zbase.mjs <verb> [args]
// 退出码：0 通过 / 1 用法错误 / 2 hook 阻断（保留）/ 3 检查发现 / 4 账本校验失败。
import fs from 'node:fs';
import { EXIT } from './lib/common.mjs';

const [verb, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

// CLI 模型可见输出预算：超限响亮失败而非静默截断（截断的 JSON 是坏的 JSON）。
const MODEL_OUTPUT_LIMIT = 12_000;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function print(obj, { json = args.json } = {}) {
  const rendered = json ? `${JSON.stringify(obj, null, 2)}\n` : renderHuman(obj);
  if (rendered.length > MODEL_OUTPUT_LIMIT) {
    console.error(`[zbase] MODEL_OUTPUT_LIMIT：CLI 输出 ${rendered.length} 字符超上限 ${MODEL_OUTPUT_LIMIT}——拒绝静默截断。收窄查询范围或用 --json/预算参数（如 context pack --budget）。`);
    process.exit(EXIT.ERROR);
  }
  process.stdout.write(rendered);
}

function renderHuman(obj) {
  const lines = [];
  const walk = (o) => {
    if (o === null || o === undefined) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x)); return; }
    if (typeof o !== 'object') { lines.push(String(o)); return; }
    for (const [k, v] of Object.entries(o)) {
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
      if (typeof v === 'object') lines.push(`${k}:`);
      else lines.push(`${k}: ${v}`);
      if (typeof v === 'object') {
        if (Array.isArray(v)) v.slice(0, 20).forEach((x) => lines.push(`  - ${typeof x === 'object' ? JSON.stringify(x) : x}`));
        else lines.push(JSON.stringify(v, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
      }
    }
  };
  walk(obj);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

async function main() {
  if (!verb) return usage();
  switch (verb) {
    case 'hook': {
      const { handle } = await import('./lib/hooks.mjs');
      const event = args._[0];
      if (!event) return usage('hook <event>');
      return handle(event);
    }
    case 'doctor': {
      const { doctor } = await import('./lib/doctor.mjs');
      const res = doctor();
      print(res);
      if (!res.ok) process.exit(EXIT.FINDINGS);
      return;
    }
    case 'selftest': {
      const { selftest } = await import('./lib/doctor.mjs');
      const res = selftest();
      print(res);
      const slow = res.results.some((r) => r.slow);
      if (!res.ok) process.exit(EXIT.FINDINGS);
      if (slow) console.error('[zbase] 规模冒烟超时（警告，不失败）：环境性能不足');
      return;
    }
    case 'task': {
      const tasks = await import('./lib/tasks.mjs');
      const sub = args._[0];
      if (sub === 'start') {
        let input = args.input;
        if (input === true || input === '-') input = fs.readFileSync(0, 'utf8');
        else if (input) input = fs.readFileSync(input, 'utf8');
        else return usage('task start --input <file|-> [--risk low|medium|high] [--owned p1,p2] [--json]');
        const envelope = JSON.parse(input);
        const res = tasks.start({ envelope, risk: args.risk || 'medium', ownedPaths: args.owned ? String(args.owned).split(',') : [], refs: envelope.refs || {} });
        print(res);
        if (!res.ok) process.exit(EXIT.ERROR);
        return;
      }
      if (sub === 'status') return print(tasks.status());
      if (sub === 'finish') {
        const res = tasks.finish({ force: args.force === true });
        print(res);
        if (!res.ok) process.exit(EXIT.FINDINGS);
        return;
      }
      return usage('task start|status|finish');
    }
    case 'gate': {
      const { runGate } = await import('./lib/quality.mjs');
      const name = args._[0];
      if (!name) return usage('gate <check-name>');
      const res = runGate(name, { note: args.note ? String(args.note) : undefined });
      print(res);
      if (!res.ok) process.exit(res.reason ? EXIT.ERROR : EXIT.FINDINGS);
      return;
    }
    case 'quality': {
      const q = await import('./lib/quality.mjs');
      const sub = args._[0] || 'status';
      if (sub === 'status') return print(q.coverageStatus());
      if (sub === 'verify') {
        const res = q.verify();
        print(res);
        if (res.code === 'LEDGER_BROKEN') process.exit(EXIT.TAMPERED);
        if (!res.ok) process.exit(EXIT.FINDINGS);
        return;
      }
      return usage('quality status|verify');
    }
    case 'receipt': {
      const r = await import('./lib/receipts.mjs');
      const sub = args._[0];
      if (sub === 'write') {
        if (!args.check || !args.status) return usage('receipt write --check <name> --status PASS|FAIL|BLOCKED|SKIPPED [--note s] [--evidence f...]');
        const evidence = args.evidence ? String(args.evidence).split(',') : [];
        const res = r.writeReceipt({ check: String(args.check), status: String(args.status), note: args.note ? String(args.note) : undefined, evidence });
        print(res);
        return;
      }
      if (sub === 'verify') {
        const res = r.verifyLedger({});
        print(res);
        if (!res.ok) process.exit(EXIT.TAMPERED);
        return;
      }
      if (sub === 'stats') return print(r.ledgerStats());
      return usage('receipt write|verify|stats');
    }
    case 'waiver': {
      const w = await import('./lib/waivers.mjs');
      const sub = args._[0];
      if (sub === 'add') {
        try {
          const res = w.addWaiver({ check: String(args.check), attribute: args.attribute, reason: String(args.reason || ''), approver: String(args.approver || ''), expiry: String(args.expiry || ''), compensation: String(args.compensation || ''), followUp: String(args['follow-up'] || '') });
          print(res);
        } catch (e) {
          console.error(`[zbase] ${e.message}`);
          process.exit(EXIT.ERROR);
        }
        return;
      }
      if (sub === 'list') return print(w.listWaivers({ all: args.all === true }));
      return usage('waiver add|list');
    }
    case 'catalog': {
      const c = await import('./lib/catalog.mjs');
      const sub = args._[0];
      if (sub === 'lint') {
        const catalog = c.loadCatalog();
        if (!catalog) { console.log('module-catalog 不存在（小仓模式）'); return; }
        const { listPaths } = await import('./lib/git.mjs');
        const res = c.lint(catalog, { trackedPaths: listPaths() });
        print(res);
        if (res.errors.length) process.exit(EXIT.FINDINGS);
        return;
      }
      if (sub === 'init') {
        const { listPaths } = await import('./lib/git.mjs');
        const skeleton = c.initSkeleton({ trackedPaths: listPaths() });
        fs.writeFileSync((await import('./lib/config.mjs')).FILES.catalog, JSON.stringify(skeleton, null, 2) + '\n');
        print({ written: true, modules: skeleton.modules.length, file: 'harness/module-catalog.json', note: '骨架已生成：逐模块补 description/attributes/deps 后跑 catalog lint' });
        return;
      }
      return usage('catalog lint|init');
    }
    case 'impact': {
      const { analyze } = await import('./lib/impact.mjs');
      const { changedPaths } = await import('./lib/git.mjs');
      const changed = args.paths ? String(args.paths).split(',') : changedPaths();
      const res = analyze({ changed });
      print(res);
      if (!res.ok) process.exit(EXIT.ERROR);
      return;
    }
    case 'context': {
      const { pack } = await import('./lib/context.mjs');
      const { changedPaths } = await import('./lib/git.mjs');
      const changed = args.paths ? String(args.paths).split(',') : changedPaths();
      const res = pack({ changed, budget: args.budget ? { totalChars: Number(args.budget) } : undefined });
      print(res);
      return;
    }
    case 'arch': {
      const a = await import('./lib/arch.mjs');
      const sub = args._[0] || 'check';
      if (sub === 'check') {
        const res = a.check();
        print(res);
        if (!res.ok && res.reason) process.exit(EXIT.ERROR);
        else if (!res.ok) process.exit(EXIT.FINDINGS);
        return;
      }
      if (sub === 'baseline') return print(a.baselineWrite());
      if (sub === 'trend') {
        const res = a.trend();
        print(res);
        if (!res.ok) process.exit(EXIT.FINDINGS);
        return;
      }
      return usage('arch check|baseline|trend');
    }
    case 'adr': {
      const a = await import('./lib/arch.mjs');
      const res = a.adrCheck();
      print(res);
      if (!res.ok) process.exit(EXIT.FINDINGS);
      return;
    }
    case 'fitness': {
      const { audit } = await import('./lib/fitness.mjs');
      const res = audit();
      print(res);
      if (!res.ok) process.exit(EXIT.FINDINGS);
      return;
    }
    case 'risk': {
      const { scan } = await import('./lib/risk.mjs');
      const res = scan();
      print(res);
      if (!res.ok) process.exit(EXIT.FINDINGS);
      return;
    }
    case 'gate-audit': {
      const { audit } = await import('./lib/audit.mjs');
      print(audit());
      return;
    }
    case 'retention': {
      const { prune } = await import('./lib/retention.mjs');
      print(prune({ days: args.days ? Number(args.days) : undefined }));
      return;
    }
    case 'fast': {
      const s = await import('./lib/state.mjs');
      const sub = args._[0] || 'status';
      if (sub === 'on') {
        if (args.hours !== undefined) {
          console.error('[zbase] fast on --hours 已废除：改用 --minutes（必填，clamp 1..480），无默认值——贷款必须有期限');
          process.exit(EXIT.ERROR);
        }
        try {
          return print(s.fastSet(true, { minutes: args.minutes, reason: args.reason ? String(args.reason) : undefined }));
        } catch (e) {
          console.error(`[zbase] ${e.message}`);
          process.exit(EXIT.ERROR);
        }
      }
      if (sub === 'off') return print(s.fastSet(false));
      return print(s.fastStatus());
    }
    case 'install': {
      const { install } = await import('./lib/doctor.mjs');
      const dir = args._[0];
      if (!dir) return usage('install <target-dir>');
      print(install(dir));
      return;
    }
    case 'manifest': {
      const gen = await import('./lib/manifest.mjs');
      const sub = args._[0] || 'generate';
      if (sub === 'generate') return print(gen.generate());
      if (sub === 'check') {
        const res = gen.check();
        print(res);
        if (!res.ok) process.exit(EXIT.FINDINGS);
        return;
      }
      return usage('manifest generate|check');
    }
    default:
      usage();
  }
}

function usage(hint) {
  if (hint) console.error(`[zbase] 用法：node .zcode/zbase.mjs ${hint}`);
  else {
    console.log(`zbase 治理 CLI

用法：node .zcode/zbase.mjs <verb> [args] [--json]

  hook <event>              统一 hook 入口（SessionStart/UserPromptSubmit/PreToolUse/...）
  doctor                    环境自检（目录/hooks/账本/契约一致性）
  selftest                  120 模块 × 3 万路径规模冒烟
  task start --input <f|->  建任务（envelope 六字段 + risk + ownedPaths）
  task status | finish [--force]
  gate <check> [--note s]   跑 verification-matrix 声明的检查，四态落账
  quality status | verify   五性覆盖（反证优先；uncovered 阻断）
  receipt write --check <n> --status PASS|FAIL|BLOCKED|SKIPPED [--note s] [--evidence f1,f2]
  receipt verify | stats    哈希链校验 / 账本统计
  waiver add|list           豁免（五要素；security/safety/privacy 三性拒绝）
  catalog lint | init       模块账本校验 / 骨架生成
  impact [--paths a,b]      反向依赖闭包（默认取 git 变更）
  context pack [--budget N] 预算化上下文打包
  arch check|baseline|trend 架构执法 / 债务棘轮 / 趋势
  adr check                 ADR 幽灵引用检测
  fitness                   五性接线审计
  risk scan                 失败连击与危险状态
  gate-audit                死闸审计（从未拦过的门）
  retention prune           留痕滚动清理
  fast on|off|status      Fast Mode 贷款（on 必带 --minutes 1..480 与 --reason；安全护栏不受影响）
  install <dir>             安装/升级脚手架到目标项目
  manifest generate|check   FRAMEWORK-MANIFEST 维护`);
  }
  process.exit(EXIT.ERROR);
}

main().catch((e) => {
  console.error(`[zbase] ${e.stack || e.message}`);
  process.exit(EXIT.ERROR);
});
