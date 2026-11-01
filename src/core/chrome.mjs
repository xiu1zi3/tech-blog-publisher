import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { PROFILE_DIR, ensureDir } from './paths.mjs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'google-chrome',
  'chromium',
];

export function findChrome() {
  for (const p of CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return process.env.CHROME_PATH || 'google-chrome';
}

async function cdpAlive(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  } catch {
    return false;
  }
}

export async function attach(port = 9222) {
  if (!(await cdpAlive(port))) return null;
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`);
}

export async function launch({ port = 9222, headless = false } = {}) {
  const existing = await attach(port);
  if (existing) {
    existing.__launchedByUs = false;
    return existing;
  }
  ensureDir(PROFILE_DIR);
  const chrome = findChrome();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
  ];
  if (headless) args.push('--headless=new');
  const child = spawn(chrome, [...args, 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await cdpAlive(port)) {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      browser.__launchedByUs = true;
      return browser;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Chrome 未能在 30s 内开放调试端口 ${port}`);
}

export async function cookiesOf(context) {
  const page = context.pages()[0] || (await context.newPage());
  const cdp = await context.newCDPSession(page);
  const { cookies } = await cdp.send('Network.getAllCookies');
  return cookies;
}

export function loginState(cookies) {
  const has = (domain, name) => cookies.some((c) => c.domain.includes(domain) && c.name === name);
  return {
    juejin: has('juejin.cn', 'sessionid'),
    zhihu: has('zhihu.com', 'z_c0'),
  };
}

export async function checkLogin(browser, { need } = {}) {
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const state = loginState(await cookiesOf(ctx));
  const missing = [];
  if ((!need || need === 'juejin') && !state.juejin) missing.push('掘金');
  if ((!need || need === 'zhihu') && !state.zhihu) missing.push('知乎');
  return { state, missing };
}
