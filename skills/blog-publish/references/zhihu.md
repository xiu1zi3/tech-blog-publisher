# 知乎发布细节

## 入口

写作页：`https://zhuanlan.zhihu.com/write`

- 标题：`textarea[placeholder*="请输入标题"]`
- 正文：`[contenteditable="true"]`（Draft.js）
- 「发布」按钮：`button`，文案精确为 `发布`

## 正文必须是 HTML 粘贴

知乎编辑器不认 Markdown。直接贴 Markdown 会变成一堆 `##` 和 `**`。
正确路径：

1. Markdown → HTML（`<h2>/<h3>/<p>/<ul>/<ol>/<li>/<strong>/<code>/<a>` 这些都支持）
2. 通过 CDP 授予剪贴板权限：`context.grantPermissions(['clipboard-read','clipboard-write'], { origin })`
3. 页面内写剪贴板：

```js
await navigator.clipboard.write([new ClipboardItem({
  'text/html': new Blob([html], { type: 'text/html' }),
  'text/plain': new Blob([md], { type: 'text/plain' }),
})]);
```

4. 聚焦正文后按 `Control+V`

粘贴后校验：`[contenteditable].innerText.length` 至少要达到 Markdown 长度的 0.8 倍，否则说明只贴进去一部分。

## 点「发布」是直接发布，没有确认框

和掘金不同，知乎点「发布」就出去了，成功时弹一个「发布成功」的分享框，页面 URL 变成 `https://zhuanlan.zhihu.com/p/<id>`。

判定成功的可靠信号：**URL 匹配 `/p/<数字>` 且不含 `/edit`**。

## 可能先跳到 `/p/<id>/edit`

有时点发布后先进草稿编辑页，需要在那里再点一次「发布」。工具的处理是轮询最多 6 轮：

- URL 变成 `/p/<id>` 且不含 `/edit` → 成功
- 页面出现「发布成功」且 URL 含 `/p/` → 成功
- URL 含 `/edit` → 等编辑器就绪，再点一次「发布」

## 话题（可选）

部分场景会出现带「话题」的设置弹层：找到 placeholder 含「话题」的输入框，输入后等建议列表出现并点选。没有弹层就跳过，不影响发布。

## 删除（回滚）

```js
await fetch('/api/v4/articles/<id>', {
  method: 'DELETE',
  credentials: 'include',
  headers: { 'content-type': 'application/json' },
});
// => {"success": true}
```

注意：这个 DELETE 要打在 **www.zhihu.com** 域下（在 `zhuanlan.zhihu.com` 页面里用相对路径会 404）。工具先 `goto('https://www.zhihu.com/')` 再发请求。

删除后在文章页确认：再取一次会返回「资源不存在」。

## 回读校验

- 标题：`h1`
- 正文：`.Post-RichText` 或 `article`
- 小节数：`h2`

作者本人的文章页会带一些 UI 文本，正文长度阈值取 Markdown 长度的 0.5 倍即可，不要用过大的绝对值（短测试稿会被误判）。
