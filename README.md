# tech-blog-publisher

**给 agent 用的掘金 / 知乎发布技能。** 一份 `SKILL.md` + 一个 CLI，让 DSH、Claude Code、Cursor 等支持 SKILL.md 的 agent 自己把 Markdown 文章发出去，并回读确认。

> 你只需要说一句"把 48 号文章发到掘金和知乎"，剩下由 agent 按 `skills/blog-publish/SKILL.md` 执行。

---

## 一、给 agent 用（主路径）

### 1. 装两样东西

```bash
npm i -g tech-blog-publisher
```

然后把技能目录接进你的 agent：

| agent | 做法 |
| --- | --- |
| DSH | 把 `skills/blog-publish/` 复制/链接到 `~/.dsh/skills/` |
| Claude Code | 复制到项目 `.claude/skills/` 或用户级 skills 目录 |
| Cursor / 其它 | 把 `skills/blog-publish/SKILL.md` 挂进 rules / skills |

不想复制也可以直接指向包里：`node_modules/tech-blog-publisher/skills/blog-publish/SKILL.md`。

### 2. 对 agent 说人话

```
把 D:\blog\src\articles\49.md 发到掘金和知乎
```

agent 会按技能里的顺序做七件事：

1. `doctor` —— 一次性体检：Node/Chrome/playwright 是否可用、profile 是否隔离、端口通不通、两个站点登录态、稿件的摘要/分类/标签是否合规
2. 缺登录态就 `login`，让你扫一次码
3. `adapt` —— 把博客源文改成两个平台稿（去 frontmatter、`[toc]`、站内链接）
4. `publish --dry-run` —— 填好内容停在发布前，把截图给你看
5. `publish` —— 真发，拿回文章链接
6. 回读文章页校验标题 / 小节 / 正文长度
7. 报结果；有问题就按 `references/troubleshooting.md` 对症状

### 3. agent 依赖的接口（这就是全部契约）

| 命令 | 作用 |
| --- | --- |
| `blog-publish doctor [--file x.md]` | 一次性体检，分「环境 / 会话 / 稿件」三组给出 ✔ ⚠ ✖ 和修复建议 |
| `blog-publish preflight` | 只检查 Chrome 与登录态，轻量版 |
| `blog-publish login` | 打开独立 Chrome，等两个站点登录完成 |
| `blog-publish adapt --file x.md` | 生成 `x_juejin.md` / `x_zhihu.md` |
| `blog-publish publish --file x_juejin.md [--dry-run] [--json]` | 发布或演练 |
| `blog-publish rollback --url <链接>` | 删掉刚发的文章（测试清理 / 误发） |
| `blog-publish mark --platform … --url …` | 登记手工发过的文章，避免重复发 |

`doctor` 的退出码：全绿 `0`，有 ✖ `1`（⚠ 不阻断）。agent 只要看这一个返回就知道能不能继续。

机器可读输出：`--json` → `{"status":"published","url":"…"}`。
退出码：`0` 成功 ｜ `1` 失败 ｜ `2` 发布成功但回读校验不过。

### 4. 为什么 agent 能可靠地用它

| 设计 | 解决的问题 |
| --- | --- |
| SKILL.md 第一节是**准入判定** | agent 最贵的是瞎试；先查 profile 隔离、登录态、摘要字数，不满足就停 |
| 每个失败都有**截图 + 对照表** | agent 不需要猜，按 `references/troubleshooting.md` 对症状 |
| 发布前 `--dry-run` | 不用产生线上副作用就能验证排版 |
| 幂等 + `rollback` | agent 试错不会留下重复文章或垃圾内容 |

---

## 二、人也可以直接用

```bash
blog-publish doctor                                  # 先体检，全绿再动手
blog-publish login                                   # 一次性扫码
blog-publish publish --file 48_juejin.md --dry-run   # 先演练
blog-publish publish --file 48_juejin.md             # 再发
```

稿子格式（文件头元信息，正文就是普通 Markdown）：

```markdown
<!--
platform: juejin
title: 标题
category: 人工智能
tags: 人工智能, LLM
summary: 摘要，掘金要求大于 50 字，不足会自动用正文补足
-->

正文……
```

知乎稿把 `category/tags` 换成 `topics: 人工智能, 大语言模型`。

---

## 三、平台规则（工具已内置，agent 不必记）

| 平台 | 规则 | 工具的处理 |
| --- | --- | --- |
| 掘金 | 摘要必须**大于 50 字**，否则点发布毫无反应 | 不足时补到 100 字，发布前读回 textarea 二次确认 |
| 掘金 | 分类、标签必填；标签数量受账号配额限制 | 按文字点选分类；标签用键盘选中，配额用完即停 |
| 掘金 | 标题会被编辑器异步覆盖 | 填完读回比对，发布前再比对一次 |
| 知乎 | 直接粘贴 Markdown 会变成纯文本 | Markdown 转 HTML 后写剪贴板再粘贴 |
| 知乎 | 点「发布」不弹确认框，直接发布 | 以 URL 变成 `/p/<id>` 判定成功 |
| 知乎 | 有时先存草稿跳到 `/p/<id>/edit` | 检测到 `/edit` 就再点一次发布 |

细节在 `skills/blog-publish/references/`：掘金 DOM 与接口、知乎流程、登录态隔离（**必读**，关系到会不会清空你浏览器 Cookie）、故障排查。

---

## 四、为什么不是调接口

两个平台的阻拦都在网页端：掘金的摘要校验、分类标签配额，知乎的富文本粘贴。工具用 Playwright 驱动本机 Chrome 的**独立 profile**，走和真人一样的路径，不依赖私有接口，也不需要申请 AppID。

登录态存在 `~/.blog-publisher/profiles/chrome`，与日常 Chrome 完全隔离——**这不是洁癖，是必须**：Chrome 127+ 的 App-Bound 加密在非默认 profile 下会失配并删除 Cookie。事故复盘见 `references/login-isolation.md`。

---

## 五、已知限制

- 两个平台都是 UI 自动化，页面改版会失效；失败先看 `runs/` 里的截图。
- 掘金标签数量取决于账号等级（测试账号只有 1 个）。
- 调试端口 9222 只监听本机；不发布时可以把那个 Chrome 窗口关掉，下次自动拉起。

## License

MIT
