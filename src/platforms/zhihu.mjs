const WRITE = 'https://zhuanlan.zhihu.com/write';

async function editorState(page) {
  return await page.evaluate(() => {
    const ed = document.querySelector('[contenteditable="true"]');
    const ta = document.querySelector('textarea[placeholder*="请输入标题"]');
    return { title: ta?.value || '', len: ed?.innerText.length || 0 };
  });
}

async function clickPublishButton(page) {
  return await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const btn = Array.from(document.querySelectorAll('button'))
      .filter(vis)
      .find((b) => b.innerText.replace(/[\s\u200b]/g, '') === '发布');
    if (!btn) return { found: false, enabled: false };
    if (btn.disabled) return { found: true, enabled: false };
    btn.click();
    return { found: true, enabled: true };
  });
}

async function waitEditorReady(page) {
  await page.waitForSelector('textarea[placeholder*="请输入标题"]', { timeout: 40000 });
  await page.waitForTimeout(2000);
}

/** 发布设置弹窗（部分账号/场景会出现，要求选话题、原创声明） */
async function findDialog(page) {
  return await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 200;
    const boxes = Array.from(document.querySelectorAll('div[role=dialog], div'))
      .filter((e) => vis(e) && e.innerText.length < 1500 && /话题/.test(e.innerText) && /发布|原创/.test(e.innerText));
    boxes.sort((a, b) => a.innerText.length - b.innerText.length);
    return boxes[0] ? { text: boxes[0].innerText.slice(0, 500) } : null;
  });
}

async function addTopics(page, topics, log) {
  if (!topics.length) return [];
  const added = [];
  for (const topic of topics.slice(0, 3)) {
    const ok = await page.evaluate(() => {
      const vis = (e) => e.offsetParent !== null;
      const input = Array.from(document.querySelectorAll('input,textarea')).find((i) => vis(i) && /话题/.test(i.placeholder || ''));
      if (!input) return false;
      input.focus();
      input.click();
      return true;
    });
    if (!ok) {
      log('未找到话题输入框，跳过话题');
      break;
    }
    await page.waitForTimeout(400);
    await page.keyboard.type(topic, { delay: 40 });
    await page.waitForTimeout(1500);
    const picked = await page.evaluate((t) => {
      const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0;
      const items = Array.from(document.querySelectorAll('li, div[class*=item], div[class*=option]'))
        .filter((e) => vis(e) && e.children.length === 0 && e.textContent.trim().startsWith(t));
      if (!items.length) return false;
      items[items.length - 1].click();
      return true;
    }, topic);
    if (picked) added.push(topic);
    await page.waitForTimeout(600);
  }
  return added;
}

export async function publish(page, context, article, { dryRun = false, log = console.log, shot, dumpDir, confirmDialog = false } = {}) {
  await page.goto(WRITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitEditorReady(page);

  await page.fill('textarea[placeholder*="请输入标题"]', article.title);
  const state0 = await editorState(page);
  if (state0.title !== article.title) throw new Error(`知乎标题被改写：${state0.title}`);

  await page.locator('[contenteditable="true"]').first().click();
  await page.waitForTimeout(400);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://zhuanlan.zhihu.com' });
  await page.evaluate(
    async ({ h, t }) => {
      const item = new ClipboardItem({
        'text/html': new Blob([h], { type: 'text/html' }),
        'text/plain': new Blob([t], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    },
    { h: article.html, t: article.markdown },
  );
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(3000);

  const expect = article.markdown.length * 0.8;
  let state = await editorState(page);
  for (let i = 0; i < 10 && state.len < expect; i++) {
    await page.waitForTimeout(1000);
    state = await editorState(page);
  }
  if (state.len < expect) throw new Error(`知乎正文粘贴不完整：${state.len} < ${Math.round(expect)}`);
  log(`正文已粘贴：${state.len} 字`);

  if (shot) await shot('zhihu-filled');
  if (dryRun) {
    return { status: 'dry-run', title: state0.title, length: state.len };
  }

  let clicked = await clickPublishButton(page);
  for (let i = 0; i < 20 && !clicked.enabled; i++) {
    await page.waitForTimeout(1000);
    clicked = await clickPublishButton(page);
  }
  if (!clicked.found) throw new Error('知乎页面找不到「发布」按钮');
  if (!clicked.enabled) throw new Error('知乎「发布」按钮不可用（标题或正文为空？）');

  // 三种可能：①直接发布并弹「发布成功」②跳到 /p/<id>/edit 需要再点一次 ③弹发布设置
  let publishedUrl = null;
  for (let round = 0; round < 6 && !publishedUrl; round++) {
    await page.waitForTimeout(2500);
    const url = page.url();
    const success = await page.evaluate(() => document.body.innerText.includes('发布成功'));
    if (/\/p\/\d+$/.test(url) && !url.includes('/edit')) {
      publishedUrl = url;
      break;
    }
    if (success) {
      await page.waitForTimeout(1500);
      const u = page.url();
      if (/\/p\/\d+/.test(u)) {
        publishedUrl = u.replace(/\/edit.*$/, '');
        break;
      }
    }
    if (url.includes('/edit')) {
      await waitEditorReady(page);
      const st = await editorState(page);
      if (st.title !== article.title) throw new Error('跳转后标题丢失');
      const dlg = await findDialog(page);
      if (dlg) {
        const topics = await addTopics(page, article.topics || [], log);
        if (topics.length) log(`话题：${topics.join('、')}`);
        if (shot) await shot('zhihu-dialog');
        await page.evaluate(() => {
          const vis = (e) => e.offsetParent !== null;
          const btns = Array.from(document.querySelectorAll('button'))
            .filter((b) => vis(b) && !b.disabled && b.innerText.replace(/[\s\u200b]/g, '') === '发布');
          btns.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
          if (btns[0]) btns[0].click();
        });
        continue;
      }
      const again = await clickPublishButton(page);
      if (!again.enabled) throw new Error('编辑页「发布」按钮不可用');
    }
  }

  if (!publishedUrl) {
    if (shot) await shot('zhihu-publish-unknown');
    throw new Error(`发布后未能确认文章地址：${page.url()}`);
  }
  publishedUrl = publishedUrl.replace(/\/edit.*$/, '');
  return { status: 'published', url: publishedUrl };
}

export async function verify(page, url, expected = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const got = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.innerText?.trim() || '';
    const h2 = Array.from(document.querySelectorAll('h2')).map((e) => e.innerText.trim());
    const body = document.querySelector('.Post-RichText, article')?.innerText || '';
    return { h1, h2, bodyLen: body.length };
  });
  const problems = [];
  if (!got.h1) problems.push('页面没有标题');
  const minBody = Math.max(80, Math.round((expected.markdownLength || 0) * 0.5));
  if (got.bodyLen < minBody) problems.push(`正文过短：${got.bodyLen} < ${minBody}`);
  const wantH2 = expected.expectSections || 0;
  if (wantH2 && got.h2.length < wantH2 - 1) problems.push(`小节数不足：${got.h2.length}/${wantH2}`);
  return { ok: problems.length === 0, problems, got };
}
