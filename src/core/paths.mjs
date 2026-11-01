import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 运行数据目录：登录态、发布记录。默认 ~/.blog-publisher，可用 BLOG_PUBLISH_HOME 覆盖 */
export const DATA_DIR = process.env.BLOG_PUBLISH_HOME || path.join(os.homedir(), '.blog-publisher');

/** 独立的 Chrome profile。绝不要指向用户日常使用的 Chrome 配置目录。 */
export const PROFILE_DIR = path.join(DATA_DIR, 'profiles', 'chrome');

export const LEDGER_FILE = path.join(DATA_DIR, 'publish-log.json');

/** 运行产物（截图、result.json）默认写到当前目录的 runs/ */
export const RUNS_DIR = process.env.BLOG_PUBLISH_RUNS || path.join(process.cwd(), 'runs');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function runDir(label) {
  return ensureDir(path.join(RUNS_DIR, `${stamp()}-${label}`));
}
