/** 删除自己发的知乎文章（测试清理 / 误发回滚） */
export async function deleteZhihuArticle(page, id) {
  await page.goto('https://www.zhihu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  return await page.evaluate(async (articleId) => {
    const res = await fetch(`/api/v4/articles/${articleId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  }, id);
}
