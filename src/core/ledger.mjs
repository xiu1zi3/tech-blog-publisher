import fs from 'node:fs';
import crypto from 'node:crypto';
import { LEDGER_FILE, ensureDir } from './paths.mjs';
import path from 'node:path';

export function hashContent(text) {
  return crypto.createHash('sha1').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);
}

export function readLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return [];
  }
}

export function findPublished(platform, hash) {
  return readLedger().find((e) => e.platform === platform && e.hash === hash) || null;
}

export function record(entry) {
  ensureDir(path.dirname(LEDGER_FILE));
  const list = readLedger();
  list.push({ ...entry, at: new Date().toISOString() });
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(list, null, 2));
}

export function forget(platform, url) {
  const list = readLedger().filter((e) => !(e.platform === platform && e.url === url));
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(list, null, 2));
}
