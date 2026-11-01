#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { PROFILE_DIR, runDir } from './core/paths.mjs';
import { launch, checkLogin, cookiesOf, loginState } from './core/chrome.mjs';
import { adaptBlogSource } from './core/adapt.mjs';
import { loadArticle, inferPlatform } from './core/article.mjs';
import { runDoctor, printDoctor } from './core/doctor.mjs';
import { mdToHtml, countHeadings } from './core/markdown.mjs';
import { hashContent, findPublished, record, forget } from './core/ledger.mjs';
import { deleteZhihuArticle } from './core/rollback.mjs';
import * as juejin from './platforms/juejin.mjs';
import * as zhihu from './platforms/zhihu.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';

const flag = (name) => argv.includes(`--${name}`);
function opt(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const asJson = flag('json');
const log = (...a) => {
  if (!asJson) console.log(...a);
};
const emit = (obj) => {
  if (asJson) console.log(JSON.stringify(obj));
};

async function commandLogin() {
  const browser = await launch({ port: 9222 });
  const ctx = browser.contexts()[0];
  const p1 = await ctx.newPage();
  await p1.goto('https://juejin.cn/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
  const p2 = await ctx.newPage();
  await p2.goto('https://www.zhihu.com/signin', { waitUntil: 'domcontentloaded' }).catch(() => {});
  log('已打开掘金 / 知乎登录页，请扫码或短信登录。等待登录状态（最多 10 分钟）…');

  const deadline = Date.now() + 10 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    const state = loginState(await cookiesOf(ctx));
    const line = `掘金=${state.juejin ? '已登录' : '未登录'}  知乎=${state.zhihu ? '已登录' : '未登录'}`;
    if (line !== last) {
      log(line);
      last = line;
    }
    if (state.juejin && state.zhihu) {
      log('两个站点都已登录，登录态已保存在 ' + PROFILE_DIR);
      emit({ status: 'ok', juejin: true, zhihu: true });
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  log('等待超时。可以重新运行 login。');
  emit({ status: 'timeout' });
  process.exitCode = 1;
}

async function commandPreflight() {
  const browser = await launch({ port: 9222 });
  const { state, missing } = await checkLogin(browser);
  log(`Chrome 调试端口：http://127.0.0.1:9222`);
  log(`登录态：掘金=${state.juejin ? 'OK' : '缺失'}  知乎=${state.zhihu ? 'OK' : '缺失'}`);
  log(`profile：${PROFILE_DIR}`);
  emit({ status: missing.length ? 'missing' : 'ok', ...state });
  if (missing.length) {
    log(`缺少登录：${missing.join('、')}。运行 login 完成一次扫码登录。`);
    process.exitCode = 1;
  }
}

async function commandDoctor() {
  const file = opt('file');
  const result = await runDoctor({ file, port: Number(opt('port', '9222')) });
  printDoctor(result, console.log);
  emit({ status: result.ok ? 'ok' : 'fail', ...result });
  if (!result.ok) process.exitCode = 1;
}

async function commandAdapt() {
  const file = opt('file');
  if (!file) throw new Error('用法：blog-publish adapt --file ../my-blog/src/articles/48.md');
  const { article, changes } = adaptBlogSource(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(path.resolve(file));
  const base = path.basename(file, '.md');
  const header = (platform, extra) => `<!--\nplatform: ${platform}\ntitle: ${article.title}\n${extra}-->\n\n`;
  const juejinFile = path.join(dir, `${base}_juejin.md`);
  const zhihuFile = path.join(dir, `${base}_zhihu.md`);
  fs.writeFileSync(
    juejinFile,
    header('juejin', `category: ${article.category || '人工智能'}\ntags: ${article.tags.join(', ') || '人工智能'}\nsummary: ${article.summary}\n`) + article.markdown + '\n',
  );
  fs.writeFileSync(zhihuFile, header('zhihu', `topics: ${article.topics.join(', ') || '人工智能, 大语言模型'}\n`) + article.markdown + '\n');
  log(`已生成：\n  ${juejinFile}\n  ${zhihuFile}`);
  if (changes.length) log(`适配改动：\n  - ${changes.join('\n  - ')}`);
  emit({ status: 'ok', juejinFile, zhihuFile, changes });
}

async function commandPublish() {
  const file = opt('file');
  if (!file) throw new Error('用法：blog-publish publish --file 48_juejin.md [--dry-run]');
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${abs}`);

  const { article: base, meta } = loadArticle(abs);
  const platform = inferPlatform(abs, meta, opt('platform'));
  if (!platform) throw new Error('无法判断平台：文件头写 platform，或用文件名 _juejin.md / _zhihu.md');

  const article = { ...base };
  if (platform === 'zhihu') article.html = mdToHtml(article.markdown);

  const dryRun = flag('dry-run');
  const force = flag('force');
  const hash = hashContent(article.markdown);

  if (!dryRun && !force) {
    const seen = findPublished(platform, hash);
    if (seen) {
      log(`跳过：同样的内容已在 ${seen.at} 发布过 → ${seen.url}`);
      log('（确认要再发一次可加 --force）');
      emit({ status: 'skipped', url: seen.url });
      return;
    }
  }

  const dir = runDir(`${platform}-${path.basename(abs, '.md')}`);
  log(`平台：${platform}${dryRun ? '（dry-run，不点最终发布）' : ''}`);
  log(`标题：${article.title}`);
  log(`正文：${article.markdown.length} 字符`);
  log(`产物目录：${dir}`);

  const browser = await launch({ port: 9222 });
  const ctx = browser.contexts()[0];
  const { missing } = await checkLogin(browser, { need: platform });
  if (missing.length) throw new Error(`${missing.join('、')} 未登录，先运行 login`);

  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const shot = async (name) => {
    await page.screenshot({ path: path.join(dir, `${name}.png`), timeout: 15000 }).catch(() => {});
  };

  const t0 = Date.now();
  const result =
    platform === 'juejin'
      ? await juejin.publish(page, article, { dryRun, log, shot })
      : await zhihu.publish(page, ctx, article, { dryRun, log, shot, dumpDir: dir });
  log(`流程耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let verification = null;
  if (result.status === 'published') {
    const verifier = platform === 'juejin' ? juejin.verify : zhihu.verify;
    verification = await verifier(page, result.url, {
      ...article,
      markdownLength: article.markdown.length,
      expectSections: result.expectSections || countHeadings(article.markdown, 2),
    });
    log(`发布成功：${result.url}`);
    log(verification.ok ? '回读校验：通过' : `回读校验：有问题 → ${verification.problems.join('；')}`);
    record({ platform, hash, title: article.title, url: result.url, file: abs });
  } else {
    await shot('dry-run-final');
    log('dry-run 完成，未发布。检查 runs 下的截图。');
  }

  const payload = { platform, file: abs, dryRun, result, verification, at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(payload, null, 2));
  emit(payload);

  await page.close();
  if (!dryRun && verification && !verification.ok) process.exitCode = 2;
}

async function commandRollback() {
  const platform = opt('platform') || 'zhihu';
  const url = opt('url') || '';
  const id = opt('id') || (url.match(/\/(?:p|post|spost)\/(\d+)/) || [])[1];
  if (!id) throw new Error('用法：blog-publish rollback --url https://zhuanlan.zhihu.com/p/123');

  const browser = await launch({ port: 9222 });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const res = platform === 'juejin' ? await juejin.deleteArticle(page, id) : await deleteZhihuArticle(page, id);
  log(`删除 ${platform}/${id}：HTTP ${res.status} ${res.body}`);
  if (/success|true/.test(res.body)) {
    if (url) forget(platform, url);
    log('已从发布记录中移除');
    emit({ status: 'deleted', platform, id });
  } else {
    emit({ status: 'failed', platform, id, res });
    process.exitCode = 1;
  }
}

async function commandMark() {
  const file = opt('file');
  const url = opt('url');
  const platform = opt('platform');
  if (!file || !url || !platform) throw new Error('用法：blog-publish mark --platform juejin --file 48_juejin.md --url https://...');
  const { article } = loadArticle(path.resolve(file));
  record({ platform, hash: hashContent(article.markdown), title: article.title, url, file: path.resolve(file), manual: true });
  log(`已登记：${platform} / ${article.title} → ${url}`);
  emit({ status: 'ok', platform, url });
}

function help() {
  console.log(`blog-publish —— 把文章发到掘金 / 知乎

  blog-publish login                          打开掘金/知乎登录页，保存登录态
  blog-publish doctor [--file <稿子.md>]       一次性体检：环境、登录态、稿件规则
  blog-publish preflight                      只检查 Chrome 与登录态
  blog-publish adapt --file <博客源文.md>      由博客源文生成 _juejin.md / _zhihu.md
  blog-publish publish --file <稿子.md>        发布（按文件名/文件头识别平台）
  blog-publish publish --file <稿子.md> --dry-run
  blog-publish rollback --url <文章链接>       删除刚发的文章（测试清理/误发回滚）
  blog-publish mark --platform juejin --file <稿子> --url <链接>

选项：
  --platform juejin|zhihu   强制指定平台
  --dry-run                 只填内容，不点最终发布
  --force                   忽略"已发布过"记录，强制再发
  --json                    输出机器可读结果
  --port 9222               调试端口
`);
}

try {
  if (cmd === 'login') await commandLogin();
  else if (cmd === 'preflight') await commandPreflight();
  else if (cmd === 'doctor') await commandDoctor();
  else if (cmd === 'adapt') await commandAdapt();
  else if (cmd === 'publish') await commandPublish();
  else if (cmd === 'rollback') await commandRollback();
  else if (cmd === 'mark') await commandMark();
  else help();
} catch (e) {
  console.error(`\n失败：${e.message}`);
  emit({ status: 'error', message: e.message });
  process.exitCode = 1;
}

process.exit(process.exitCode || 0);
