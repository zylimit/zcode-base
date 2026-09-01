// 豁免管理：五要素强制 + security/safety/privacy 红线三性 + FAIL 永不可豁免 + 到期自动失效。
import fs from 'node:fs';
import { FILES, DIRS } from './config.mjs';
import { readJson, writeJsonAtomic, nowIso, PROTECTED_ATTRS } from './common.mjs';

const REQUIRED = ['approver', 'expiry', 'compensation', 'followUp', 'binding'];
// 红线词汇表：reason 命中即拒——豁免文本里出现这些词说明豁免的对象本身就是不可豁免的。
// （zcode waiver 无独立 scope 字段，check 名与 reason 一并校验。）
const WAIVER_FORBIDDEN_WORDS = /(safety|security|privacy|pii|secret|credential|destructive|deploy|production|push|隐私|安全|密钥|凭据|生产|部署)/i;

function load() {
  if (!fs.existsSync(FILES.waivers)) return [];
  return readJson(FILES.waivers);
}

export function addWaiver({ check, attribute, reason, approver, expiry, compensation, followUp }) {
  const waivers = load().filter(isActive);
  const missing = REQUIRED.filter((k) => !({ approver, expiry, compensation, followUp, binding: true }[k]));
  if (missing.length) throw new Error(`豁免缺五要素：${missing.join(', ')}`);
  if (attribute && PROTECTED_ATTRS.includes(attribute)) {
    throw new Error(`红线：${attribute} 永不可豁免`);
  }
  const text = `${reason || ''} ${check || ''}`;
  if (WAIVER_FORBIDDEN_WORDS.test(text)) {
    throw new Error(`红线：豁免理由/check 命中不可豁免词汇（privacy/security/safety/secret 等）——三性豁免在结构上无可表达之例外`);
  }
  const entry = {
    id: `w-${Date.now().toString(36)}`,
    check, attribute: attribute || null, reason,
    approver, expiry, compensation, followUp,
    binding: { check, createdAt: nowIso() },
    createdAt: nowIso(),
  };
  waivers.push(entry);
  fs.mkdirSync(DIRS.state, { recursive: true });
  writeJsonAtomic(FILES.waivers, waivers);
  return entry;
}

function isActive(w) {
  return !w.expiry || new Date(w.expiry).getTime() > Date.now();
}

export function listWaivers({ all = false } = {}) {
  const waivers = load();
  return all ? waivers : waivers.filter(isActive).map((w) => ({ ...w, expired: !isActive(w) }));
}

// 某检查是否被有效豁免覆盖（只豁免「暂时不做」，FAIL 状态由 quality verify 拦截，不在此处理）。
export function covers(check, attribute) {
  return load().some((w) => isActive(w) && w.check === check && (!attribute || w.attribute === attribute));
}

export function expiredCount() {
  return load().filter((w) => !isActive(w)).length;
}
