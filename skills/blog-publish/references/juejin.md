# 掘金发布细节

## 入口

编辑器：`https://juejin.cn/editor/drafts/new?v=2`
页面里有：
- 标题：`input.title-input`
- 正文：CodeMirror 5 实例，`document.querySelector('.CodeMirror').CodeMirror.setValue(md)`
- 「发布」按钮：`button`，文案精确为 `发布`

正文用 `CodeMirror.setValue` 灌入后会触发 bytemd 的 change 事件，状态能同步；不要用 `insertText` 逐字输入（慢且容易丢字）。

## 发布面板（右侧抽屉）

点「发布」后出现抽屉，包含四块：

| 字段 | 是否必填 | 定位方式 |
| --- | --- | --- |
| 分类 | 必填 | 抽屉内精确文字（后端 / 前端 / Android / iOS / 人工智能 / 开发工具 / 代码人生 / 阅读） |
| 添加标签 | 必填 | `.byte-select`，第一个 `byte-select__input` |
| 文章封面 | 选填 | 上传，可跳过 |
| 编辑摘要 | 必填 | `textarea[maxlength="100"]` |

## 摘要：大于 50 字，否则静默失败

这是最容易踩的坑。摘要 ≤ 50 字时，点「确定并发布」**没有任何提示、页面不动、接口不发出**。
工具的处理：不足 50 字用正文首段补到 100 字，写完再读一次 textarea 的 `value.length`，仍 < 51 就中止。

## 标签：受账号配额限制

- 下拉是 Byte Design 的 `byte-select`，选项在 `.byte-select-dropdown .byte-select-option`。
- **用键盘选，不要用 JS `.click()`**：点击不会触发选中，稳妥路径是
  `input.focus()` → `type(tag)` → `ArrowDown` → `Enter`。
- 选中后占位符「请搜索添加标签」消失，可以用它判断是否真的选中。
- 账号等级决定能加几个标签（测试账号只有 1 个，下拉会显示「你还能添加 0 个标签」）。

## 标题会被异步覆盖

编辑器加载草稿后可能把标题写回旧值。工具在填完后读一次、发布前再读一次，不一致直接中止。

## 发布请求与结果

点「确定并发布」会发出 `POST https://api.juejin.cn/content_api/v1/article/publish`（或 `article_draft/publish`），返回：

```json
{ "err_no": 0, "err_msg": "", "data": { "article_id": "7702..." } }
```

- 成功判断：拿到 `data.article_id`，或页面跳到 `/published` / `/post/<id>`。
- 文章地址：`https://juejin.cn/post/<article_id>`。

## 删除（回滚）

在掘金页面上下文里发请求，带上登录 Cookie：

```js
await fetch('https://api.juejin.cn/content_api/v1/article/delete', {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ article_id: '7702...' }),
});
// => {"err_no":0,"err_msg":"success","data":null}
```

注意：相对路径 `/content_api/...` 打到的是 `juejin.cn`，会返回 `err_no:404 内容为空`；必须用 `api.juejin.cn` 这个绝对地址。

## 回读校验

刚发布后文章页可能短暂显示不全（还在处理），所以校验要**重试**：

- 轮询最多 60s，每轮重新 `goto` 一次，直到 `h2` 数量 > 0 且正文长度 > 200。
- 正文容器：`article` / `.article-content` / `.markdown-body` / `#article-root`。
- 标题正常时 `h1` 与稿子标题一致；被截断时以 `：` 前的主标题为准做前缀比较。
