import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, PROFILE_DIR, ensureDir } from './paths.mjs';
import { findChrome, launch, checkLogin } from './chrome.mjs';
import { loadArticle, inferPlatform } from './article.mjs';

const CHROME_DEFAULT_DIRS = [
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome Beta/User Data'),
  path.join(process.env.LOCALAPPDATA || '', 'Chromium/User Data'),
  path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
  path.join(os.homedir(), '.config/google-chrome'),
];

function check(group, name, status, detail, hint) {
  return { group, name, status, detail: detail || '', hint: hint || '' };
}

function inDefaultChromeDir(dir) {
  const norm = (s) => s.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
  return CHROME_DEFAULT_DIRS.filter(Boolean).some((d) => norm(dir).startsWith(norm(d)));
}

export async function runDoctor({ file = null, port = 9222 } = {}) {
  const checks = [];

  // ---- 环境 ----
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(
    major >= 18
      ? check('环境', 'Node 版本', 'ok', `v${process.versions.node}`)
      : check('环境', 'Node 版本', 'fail', `v${process.versions.node}`, '需要 Node >= 18（用到全局 fetch）'),
  );

  let chrome = '';
  try {
    chrome = findChrome();
    const exists = fs.existsSync(chrome);
    checks.push(
      exists || !chrome.includes(path.sep)
        ? check('环境', 'Chrome 可执行文件', 'ok', chrome)
        : check('环境', 'Chrome 可执行文件', 'fail', chrome, '设置环境变量 CHROME_PATH 指向 chrome 可执行文件'),
    );
  } catch (e) {
    checks.push(check('环境', 'Chrome 可执行文件', 'fail', e.message, '安装 Chrome，或设置 CHROME_PATH'));
  }

  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pw = req('playwright-core/package.json');
    checks.push(check('环境', 'playwright-core', 'ok', `v${pw.version}`));
  } catch (e) {
    checks.push(check('环境', 'playwright-core', 'fail', e.message, '重新安装：npm i -g tech-blog-publisher'));
  }

  let writable = true;
  try {
    ensureDir(DATA_DIR);
    const probe = path.join(DATA_DIR, '.doctor-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch {
    writable = false;
  }
  checks.push(
    writable
      ? check('环境', '数据目录可写', 'ok', DATA_DIR)
      : check('环境', '数据目录可写', 'fail', DATA_DIR, '检查磁盘权限，或用 BLOG_PUBLISH_HOME 指定别的目录'),
  );

  // ---- 会话 ----
  if (inDefaultChromeDir(PROFILE_DIR)) {
    checks.push(
      check('会话', 'profile 隔离', 'fail', PROFILE_DIR, '绝不能指向日常 Chrome 目录，会清空你的 Cookie。见 references/login-isolation.md'),
    );
  } else {
    checks.push(check('会话', 'profile 隔离', 'ok', PROFILE_DIR));
  }

  let browser = null;
  try {
    browser = await launch({ port });
    checks.push(check('会话', `调试端口 ${port}`, 'ok', `CDP 已连通 http://127.0.0.1:${port}`));
  } catch (e) {
    checks.push(check('会话', `调试端口 ${port}`, 'fail', e.message, '关掉占用端口的旧 Chrome 窗口，或换 --port'));
  }

  if (browser) {
    try {
      const { state } = await checkLogin(browser);
      checks.push(
        state.juejin
          ? check('会话', '掘金登录态', 'ok', 'sessionid 存在')
          : check('会话', '掘金登录态', 'fail', '未登录', '运行 blog-publish login 扫码'),
      );
      checks.push(
        state.zhihu
          ? check('会话', '知乎登录态', 'ok', 'z_c0 存在')
          : check('会话', '知乎登录态', 'fail', '未登录', '运行 blog-publish login 扫码'),
      );
    } catch (e) {
      checks.push(check('会话', '登录态检查', 'fail', e.message));
    }
  }

  // ---- 稿件（可选）----
  if (file) {
    try {
      const { article, meta, mode } = loadArticle(file);
      const platform = inferPlatform(file, meta);

      checks.push(
        platform
          ? check('稿件', '平台识别', 'ok', `${platform}（${mode}）`)
          : check('稿件', '平台识别', 'fail', '无法判断', '文件头写 platform，或文件名用 _juejin.md / _zhihu.md'),
      );

      checks.push(
        article.title.length > 80
          ? check('稿件', '标题长度', 'warn', `${article.title.length} 字`, '掘金标题过长时可能被编辑器改写')
          : check('稿件', '标题长度', 'ok', `${article.title.length} 字`),
      );

      checks.push(
        article.markdown.length >= 200
          ? check('稿件', '正文长度', 'ok', `${article.markdown.length} 字符`)
          : check('稿件', '正文长度', 'warn', `${article.markdown.length} 字符`, '太短的文章可能触发平台校验'),
      );

      if (platform === 'juejin') {
        const sum = article.summary.length;
        checks.push(
          sum > 50
            ? check('稿件', '摘要', 'ok', `${sum} 字（要求 > 50）`)
            : check('稿件', '摘要', 'warn', `${sum} 字，不足 50`, '工具会用正文自动补到 100 字，建议自己在文件头写好'),
        );
        checks.push(
          article.category
            ? check('稿件', '分类', 'ok', article.category)
            : check('稿件', '分类', 'fail', '缺失', '掘金必填，文件头写 category'),
        );
        if (!article.tags.length) {
          checks.push(check('稿件', '标签', 'fail', '缺失', '掘金必填，文件头写 tags'));
        } else if (article.tags.length > 1) {
          checks.push(
            check('稿件', '标签', 'warn', `${article.tags.length} 个：${article.tags.join('、')}`, '账号等级可能只允许 1 个，多出的会被忽略'),
          );
        } else {
          checks.push(check('稿件', '标签', 'ok', article.tags[0]));
        }
      }

      if (platform === 'zhihu') {
        checks.push(
          article.topics.length
            ? check('稿件', '话题', 'ok', article.topics.join('、'))
            : check('稿件', '话题', 'warn', '未设置', '可选；设置后发布时会尝试添加'),
        );
      }
    } catch (e) {
      checks.push(check('稿件', '解析', 'fail', e.message, '检查文件头元信息格式'));
    }
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  return { ok: failed.length === 0, checks, failed: failed.length, warned: warned.length };
}

const ICON = { ok: '✔', warn: '⚠', fail: '✖' };

export function printDoctor(result, log = console.log) {
  let group = '';
  for (const c of result.checks) {
    if (c.group !== group) {
      group = c.group;
      log(`\n${group}`);
    }
    const line = `  ${ICON[c.status] || '·'} ${c.name}${c.detail ? '  ' + c.detail : ''}`;
    log(line);
    if (c.hint && c.status !== 'ok') log(`      → ${c.hint}`);
  }
  log('');
  log(result.ok ? `体检通过（${result.warned} 项提醒）` : `有 ${result.failed} 项不通过，先修掉再发布`);
}
