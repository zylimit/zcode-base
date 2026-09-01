// 豁免管理：五要素强制 + security/safety/FAIL 永不可豁免 + 到期自动失效。
import fs from 'node:fs';
import { FILES, DIRS } from './config.mjs';
import { readJson, writeJsonAtomic, nowIso } from './common.mjs';

const REQUIRED = ['approver', 'expiry', 'compensation', 'followUp', 'binding'];
const PROTECTED_ATTRS = ['security', 'safety'];

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
