import { countHeadings } from '../core/markdown.mjs';

const EDITOR = 'https://juejin.cn/editor/drafts/new?v=2';

async function modalOpen(page) {
  return await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 500;
    return Array.from(document.querySelectorAll('div, section, aside')).some(
      (e) => vis(e) && e.innerText.includes('发布文章') && e.innerText.includes('添加标签'),
    );
  });
}

async function waitModal(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await modalOpen(page)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function clickInModal(page, text) {
  return await page.evaluate((t) => {
    const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
    const roots = Array.from(document.querySelectorAll('div, section, aside')).filter(
      (e) => vis(e) && e.innerText.includes('发布文章') && e.innerText.includes('添加标签'),
    );
    roots.sort((a, b) => a.innerText.length - b.innerText.length);
    const root = roots[0];
    if (!root) return false;
    const els = Array.from(root.querySelectorAll('button, div, span')).filter(
      (e) => vis(e) && e.textContent.trim() === t,
    );
    if (!els.length) return false;
    els.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    els[0].click();
    return true;
  }, text);
}

async function blurDropdown(page) {
  await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const h = Array.from(document.querySelectorAll('div,span')).find((e) => vis(e) && e.textContent.trim() === '发布文章');
    if (h) h.click();
  });
  await page.waitForTimeout(300);
}

async function addTag(page, tag) {
  const box = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const roots = Array.from(document.querySelectorAll('div')).filter(
      (e) => vis(e) && e.innerText.includes('发布文章') && e.innerText.includes('添加标签'),
    );
    roots.sort((a, b) => a.innerText.length - b.innerText.length);
    const root = roots[0];
    if (!root) return null;
    const el = Array.from(root.querySelectorAll('div,span')).find(
      (e) => vis(e) && /请搜索添加标签|你还能添加/.test(e.textContent.trim()) && e.children.length <= 2,
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!box) return { ok: false, reason: 'tag-input-not-found' };

  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(500);

  const focused = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const roots = Array.from(document.querySelectorAll('div')).filter(
      (e) => vis(e) && e.innerText.includes('发布文章') && e.innerText.includes('添加标签'),
    );
    roots.sort((a, b) => a.innerText.length - b.innerText.length);
    const input = roots[0]?.querySelector('.byte-select__input');
    if (!input) return false;
    input.focus();
    return document.activeElement === input;
  });
  if (!focused) return { ok: false, reason: 'tag-input-not-focused' };

  await page.keyboard.type(tag, { delay: 30 });
  await page.waitForTimeout(1600);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await blurDropdown(page);

  const applied = await page.evaluate(() => !document.body.innerText.includes('请搜索添加标签'));
  if (!applied) return { ok: false, reason: 'tag-keyboard-no-effect' };
  return { ok: true };
}

/** 掘金要求摘要 > 50 字（上限 100），不足时用正文首段兜底 */
function normalizeSummary(article, log = console.log) {
  const plain = article.markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let s = (article.summary || '').trim();
  if (s.length < 51) {
    s = (s + plain.slice(0, 100 - s.length)).slice(0, 100).trim();
    log(`摘要不足 50 字，已用正文补足到 ${s.length} 字`);
  }
  if (s.length < 51) throw new Error(`摘要只有 ${s.length} 字，掘金要求大于 50 字，且正文不足以补齐`);
  return s.slice(0, 100);
}

async function fillSummary(page, summary) {
  try {
    const ta = page.locator('textarea[maxlength="100"]:visible').first();
    if (await ta.count()) {
      await ta.click();
      await ta.fill(summary);
      return true;
    }
  } catch {}
  return await page.evaluate((text) => {
    const vis = (e) => e.offsetParent !== null;
    const ta = Array.from(document.querySelectorAll('textarea')).find(
      (t) => vis(t) && (t.getAttribute('maxlength') === '100' || t.closest('.summary')),
    );
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, summary);
}

export async function fill(page, article, { allowTitleTruncate = false } = {}) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input.title-input', { timeout: 30000 });
  await page.waitForTimeout(2500);

  await page.click('input.title-input');
  await page.locator('input.title-input').fill(article.title);
  await page.waitForTimeout(300);
  const actual = await page.inputValue('input.title-input');
  if (actual !== article.title && !allowTitleTruncate) {
    throw new Error(`掘金标题被改写：期望「${article.title}」，实际「${actual}」`);
  }
  const len = await page.evaluate((md) => {
    const el = document.querySelector('.CodeMirror');
    if (!el || !el.CodeMirror) return -1;
    el.CodeMirror.setValue(md);
    el.CodeMirror.refresh();
    return el.CodeMirror.getValue().length;
  }, article.markdown);
  if (len < 0) throw new Error('找不到掘金 Markdown 编辑器');
  await page.waitForTimeout(1500);
  return { actualTitle: actual, bodyLength: len };
}

export async function publish(page, article, { dryRun = false, log = console.log, shot } = {}) {
  const filled = await fill(page, article);
  log(`标题/正文已填入（${filled.bodyLength} 字符）`);

  await page.getByRole('button', { name: '发布', exact: true }).click();
  if (!(await waitModal(page))) {
    if (shot) await shot('juejin-modal-missing');
    throw new Error('点击「发布」后没有出现发布设置面板');
  }
  await page.waitForTimeout(1200);
  log('发布面板已打开');

  if (article.category) {
    const ok = await clickInModal(page, article.category);
    log(ok ? `分类：${article.category}` : `分类未找到：${article.category}`);
    await page.waitForTimeout(600);
  }

  const added = [];
  for (const tag of article.tags.slice(0, 3)) {
    const res = await addTag(page, tag);
    if (res.ok) {
      added.push(tag);
      await page.waitForTimeout(700);
    } else {
      const why = added.length ? '账号只允许 1 个标签' : res.reason;
      log(`标签未添加：${tag} → ${why}`);
      break;
    }
  }
  log(`标签：${added.join('、') || '无'}`);

  const summary = normalizeSummary(article, log);
  const okSummary = await fillSummary(page, summary);
  log(okSummary ? `摘要已填写（${summary.length} 字）` : '未找到摘要输入框（跳过）');
  if (!okSummary) throw new Error('找不到摘要输入框，掘金要求摘要大于 50 字');

  const sumInPage = await page.evaluate(() => {
    const ta = Array.from(document.querySelectorAll('textarea')).find((t) => t.offsetParent && t.getAttribute('maxlength') === '100');
    return ta ? ta.value.trim().length : 0;
  });
  if (sumInPage < 51) throw new Error(`摘要实际只写入 ${sumInPage} 字，掘金要求大于 50 字`);

  if (shot) await shot('juejin-before-publish');

  const titleNow = await page.inputValue('input.title-input');
  if (titleNow !== filled.actualTitle) throw new Error(`发布前标题被改动：「${titleNow}」，已中止`);
  const tagReady = await page.evaluate(() => !document.body.innerText.includes('请搜索添加标签'));
  if (!tagReady) throw new Error('标签没有选中（掘金要求至少一个标签），已中止发布');

  if (dryRun) return { status: 'dry-run', title: filled.actualTitle, tags: added, summary };

  const expectSections = countHeadings(article.markdown, 2);
  await blurDropdown(page);
  await page.waitForTimeout(300);
  const [resp] = await Promise.all([
    page
      .waitForResponse((r) => /article\/publish|article_draft\/publish/.test(r.url()) && r.request().method() === 'POST', { timeout: 90000 })
      .catch(() => null),
    page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.innerText.replace(/[\s\u200b]/g, '') === '确定并发布',
      );
      if (!btn) return 'not-found';
      btn.scrollIntoView({ block: 'center' });
      btn.click();
      return 'clicked';
    }),
  ]);

  let articleId = null;
  let respText = '';
  if (resp) {
    try {
      respText = await resp.text();
      const json = JSON.parse(respText);
      articleId = json?.data?.article_id || json?.data?.id || null;
    } catch {}
  }
  log(`发布接口：${resp ? resp.status() : '未捕获'} ${respText.slice(0, 160).replace(/\s+/g, ' ')}`);

  await page.waitForURL((u) => /\/published|\/post\/|\/spost\//.test(u.toString()), { timeout: 60000 }).catch(() => {});
  if (shot) await shot('juejin-after-confirm');
  if (!articleId) {
    articleId = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => /\/(spost|post)\/\d+/.test(x.href));
      return a ? a.href.match(/\/(?:spost|post)\/(\d+)/)[1] : null;
    });
  }
  if (!articleId) throw new Error('发布后未取到文章 ID');
  return { status: 'published', url: `https://juejin.cn/post/${articleId}`, articleId, expectSections, tags: added };
}

export async function verify(page, url, expected) {
  let got = { h1: '', h2: [], bodyLen: 0 };
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    got = await page.evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      const h2 = Array.from(document.querySelectorAll('h2')).map((e) => e.innerText.trim());
      const body = document.querySelector('article, .article-content, .markdown-body, #article-root')?.innerText || '';
      return { h1, h2, bodyLen: body.length };
    });
    if (got.h2.length > 0 && got.bodyLen > 200) break;
    await page.waitForTimeout(3000);
  }

  const problems = [];
  if (got.h1 && !expected.title.startsWith(got.h1) && !got.h1.startsWith(expected.title.split('：')[0])) {
    problems.push(`标题不符：页面「${got.h1}」`);
  }
  const minBody = Math.max(80, Math.round((expected.markdownLength || 0) * 0.5));
  if (got.bodyLen < minBody) problems.push(`正文过短：${got.bodyLen} < ${minBody}`);
  if (got.h2.length < expected.expectSections - 1) {
    problems.push(`小节数不足：${got.h2.length}/${expected.expectSections}`);
  }
  return { ok: problems.length === 0, problems, got };
}

/** 删除自己刚发的掘金文章（测试清理 / 误发回滚） */
export async function deleteArticle(page, id) {
  await page.goto('https://juejin.cn/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  return await page.evaluate(async (articleId) => {
    const res = await fetch('https://api.juejin.cn/content_api/v1/article/delete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ article_id: articleId }),
    });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  }, id);
}
