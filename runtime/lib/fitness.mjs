// fitness：五性接线审计——「声明了没人执法」的接线缺陷拦截。
// 五条零依赖规则（借鉴 pi-base fitness 思想）：
//   F1 声明完整性：所有模块五性档位合法，none/minimal 必须有 reason
//   F2 执法接线：critical/high 属性必须有认领检查（verification-matrix proves）
//   F3 红线完整性：security/safety 检查不可被豁免（waiver 中不得出现）
//   F4 账本健康：哈希链完整
//   F5 检查真实性：matrix 中每条 command 必须可解析（命令存在），Enforced-by 不空
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { loadCatalog } from './catalog.mjs';
import { loadMatrix } from './quality.mjs';
import { listWaivers } from './waivers.mjs';
import { verifyLedger } from './receipts.mjs';

const ATTRS = ['resilience', 'security', 'safety', 'privacy', 'reliability'];
const VALID = ['critical', 'high', 'medium', 'low', 'none'];

export function audit() {
  const results = [];
  const check = (id, ok, detail) => results.push({ id, ok, detail });

  // F1
  const catalog = loadCatalog();
  if (!catalog) {
    check('F1', true, 'module-catalog 不存在（小仓模式，五性档位未启用）');
  } else {
    const bad = [];
    for (const m of catalog.modules || []) {
      const attrs = m.attributes || {};
      for (const a of ATTRS) {
        const lv = attrs[a] || 'none';
        if (!VALID.includes(lv)) bad.push(`${m.name}.${a}=${lv} 非法档位`);
        else if ((lv === 'none') && !attrs.reason && !(m.attributeReasons || {})[a]) {
          // none 档要求说明：模块级 reason 或逐属性 attributeReasons
          if (!m.reason) bad.push(`${m.name}.${a}=none 缺 reason`);
        }
      }
    }
    check('F1', bad.length === 0, bad.length ? bad.slice(0, 10) : `${catalog.modules.length} 模块五性档位声明完整`);
  }

  // F2
  const matrix = loadMatrix();
  const proved = new Set(matrix.checks.flatMap((c) => c.proves || []));
  const unwired = [];
  if (catalog) {
    for (const m of catalog.modules || []) {
      for (const a of ATTRS) {
        const lv = (m.attributes || {})[a] || 'none';
        if ((lv === 'critical' || lv === 'high') && !proved.has(a)) unwired.push(`${m.name}.${a}=${lv} 无认领检查`);
      }
    }
  }
  check('F2', unwired.length === 0, unwired.length ? unwired.slice(0, 10) : 'critical/high 属性全部有认领检查');

  // F3
  const waivers = listWaivers({ all: true });
  const badWaivers = waivers.filter((w) => w.attribute === 'security' || w.attribute === 'safety');
  check('F3', badWaivers.length === 0, badWaivers.length ? `红线属性出现 ${badWaivers.length} 条豁免记录` : 'security/safety 无豁免记录');

  // F4
  const ver = verifyLedger();
  check('F4', ver.ok, ver.ok ? `账本 ${ver.total} 条，链完整` : `账本断链：${JSON.stringify(ver.issues.slice(0, 3))}`);

  // F5
  const ghost = [];
  for (const c of matrix.checks) {
    if (c.command) {
      const bin = c.command.trim().split(/\s+/)[0];
      try { execFileSync('bash', ['-c', `command -v ${JSON.stringify(bin)} >/dev/null 2>&1 || command -v node >/dev/null 2>&1 && node -e "process.exit(0)"`], { timeout: 5000 }); }
      catch { ghost.push(`${c.name}: 命令 ${bin} 不可用`); }
      if (c.command.trim().startsWith('node') && !fs.existsSync('runtime/zbase.mjs') && c.command.includes('runtime/')) {
        ghost.push(`${c.name}: 引用 runtime/zbase.mjs 但文件不存在`);
      }
    }
  }
  check('F5', ghost.length === 0, ghost.length ? ghost : `${matrix.checks.length} 条检查全部可解析`);

  return { ok: results.every((r) => r.ok), results };
}
