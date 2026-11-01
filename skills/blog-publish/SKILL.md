---
name: tech-blog-publisher
description: 把 Markdown 文章自动发布到掘金和知乎，含平台格式适配、登录态隔离、发布前自检与发布后回读校验。Use when the user asks to publish/sync an article to Juejin (掘金) or Zhihu (知乎), to fix a failed auto-publish, or to set up automated cross-posting for a blog.
whenToUse: 用户说"把这篇发到掘金/知乎""同步到知乎专栏""掘金点发布没反应""帮我搭一个自动发文章的流程"时
---

# 把文章发到掘金和知乎

**目标状态**：一条命令把一篇 Markdown 发到掘金或知乎，发完能回读到文章页确认标题、小节、正文都在；发错了能一条命令删掉。

**为什么不用官方接口**：两个平台都只有网页端校验在拦人——掘金摘要不足 50 字时点「发布」毫无反应，知乎编辑器只认 HTML 粘贴。所以方案是 Playwright 驱动本机 Chrome，走真人路径。

**成品形态**：一个 npm CLI（`blog-publish`）+ 一个独立 Chrome profile（登录态）。没有常驻进程。

---

## 0. 30 秒准入判定（先做，别跳）

60% 的失败不是脚本问题，是环境问题。**先跑体检，不要凭感觉判断环境。**

```bash
blog-publish doctor --file <要发的稿子.md>
```

输出分三组，逐项给 ✔ / ⚠ / ✖ 和修复建议：

| 组 | 检查什么 | ✖ 时怎么办 |
| --- | --- | --- |
| 环境 | Node ≥18、Chrome 路径、playwright-core、数据目录可写 | 按提示装/改；Chrome 找不到就设 `CHROME_PATH` |
| 会话 | profile 是否隔离、端口 9222、掘金/知乎登录态 | profile 指向日常 Chrome 目录时必须停手；未登录就 `login` |
| 稿件 | 平台识别、标题长度、正文长度、摘要字数、分类/标签 | 摘要 <50 会被自动补齐，但最好自己写够；缺分类/标签直接补文件头 |

退出码 `0` = 可以发布，`1` = 有 ✖。**看到 ✖ 不要继续往下跑**，先让它变绿。

其中 **profile 隔离**这条最不能妥协：工具必须用自己的 `~/.blog-publisher/profiles/chrome`，绝不能指向日常 Chrome 配置目录。Chrome 127+ 的 App-Bound Cookie 加密在非默认 profile 下会失配，Chrome 判定"解密失败"后会**删除**那些 Cookie——等于把你的全站登录态清空。这是真实发生过的事故，复盘见 `references/login-isolation.md`。

---

## 1. 安装与登录

```bash
npm i -g tech-blog-publisher      # 或 npx tech-blog-publisher@latest
blog-publish doctor               # 看环境与登录态
blog-publish login                # 没登录时：弹出独立 Chrome，扫码
```

`login` 会等到两个站点的登录态都出现才退出，打印：

```
掘金=已登录  知乎=已登录
```

**成功标志**：再跑一次 `doctor` 全部 ✔。失败就重跑 `login`。

---

## 2. 准备稿子

三种输入，任选：

| 输入 | 用法 |
| --- | --- |
| 博客源文（YAML frontmatter + `[toc]` + 站内链接） | `blog-publish adapt --file 48.md` 生成两份平台稿 |
| 平台稿（文件头 `<!-- ... -->`） | 直接 `publish --file 48_juejin.md` |
| 临时测试 | 复制 `examples/48_juejin.md` 改标题和正文 |

平台稿的元信息：

```markdown
<!--
platform: juejin          # juejin | zhihu
title: 标题
category: 人工智能         # 仅掘金
tags: 人工智能, LLM        # 仅掘金
summary: 大于 50 字        # 仅掘金，不足会被自动补齐
topics: 人工智能, 大语言模型  # 仅知乎
-->
```

`adapt` 会做四件事并打印清单：去 frontmatter 与 `[toc]`、站内链接 `/article/N` 转纯文本、`#` 降为 `##`、移除本地资源图片。

---

## 3. 先演练，再发布（别省这一步）

```bash
blog-publish publish --file 48_juejin.md --dry-run
```

dry-run 只做"填内容 + 选分类/标签/摘要"，**不点最终发布**，然后把截图写到 `runs/<时间>-<平台>-<文件名>/`。打开截图确认：标题对、正文进来了、分类和标签已选中。

这是唯一能在不产生线上副作用的前提下验证排版的机会。

---

## 4. 发布

```bash
blog-publish publish --file 48_juejin.md
blog-publish publish --file 48_zhihu.md
```

工具会自动：填标题 → 灌正文 → 选分类/标签（掘金）或转 HTML 粘贴（知乎）→ 点发布 → 等待跳转 → 回读文章页校验。

成功输出：

```
发布成功：https://juejin.cn/post/7702638129132306466
回读校验：通过
```

---

## 5. 看懂结果

| 输出 | 含义 | 该做什么 |
| --- | --- | --- |
| `回读校验：通过` | 标题、小节数、正文长度都对 | 完成 |
| `回读校验：有问题 → …` | 文章已发出去但页面不符 | 打开链接人工看一眼，多半是标题被平台改写 |
| `失败：…` + 退出码 1 | 没发出去 | 看 `runs/` 里最后一张截图，对照 `references/troubleshooting.md` |
| `跳过：同样的内容已…发布过` | 幂等命中 | 要重发加 `--force` |

退出码：`0` 成功 / `1` 失败 / `2` 发布成功但校验不过。脚本和插件按这个判断，不要靠解析中文。

---

## 6. 高频坑（症状 → 原因 → 处理）

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 掘金点「确定并发布」没反应，页面不动 | 摘要 ≤ 50 字 | 工具已自动补齐；若仍失败，检查摘要框是否真的写进去了（截图里看字符数） |
| 掘金标签只有一个，第二个加不上 | 账号标签配额（等级）限制 | 正常现象，工具会停；想换标签先删掉第一个 |
| 掘金标题发布后少了副标题 | 编辑器异步覆盖了输入框 | 工具在发布前会再比对一次标题并中止；把标题改短重发 |
| 知乎正文变成一大段纯文本 | 用了 `Ctrl+V` 之外的注入方式，或剪贴板权限没给 | 工具走 `navigator.clipboard.write` + `Ctrl+V`；权限由 CDP 授予，别改成 `insertHTML` |
| 知乎点发布后停在 `/p/xxx/edit` | 先存草稿，需要再点一次发布 | 工具会自动重点一次；手工操作时也要点第二次 |
| 启动 Chrome 就报"登录态丢失" | profile 指向了日常 Chrome 目录 | 立刻停下，按 `references/login-isolation.md` 恢复，别继续发布 |

---

## 7. 回滚与幂等

```bash
blog-publish rollback --url https://juejin.cn/post/xxx
blog-publish rollback --url https://zhuanlan.zhihu.com/p/xxx
```

- 走平台自己的删除接口（掘金 `content_api/v1/article/delete`、知乎 `DELETE /api/v4/articles/<id>`），入参是文章 id。
- 只能删**自己**的文章；别拿它当通用删除工具。
- 发布记录在 `~/.blog-publisher/publish-log.json`，按正文 hash 去重。手工发过的文章用 `mark` 登记，避免以后重复发。

---

## 参考

- `references/juejin.md` —— 掘金编辑器的 DOM、摘要规则、标签配额、发布/删除接口
- `references/zhihu.md` —— 知乎写作页流程、HTML 粘贴、成功判定
- `references/login-isolation.md` —— 为什么必须独立 profile（含事故复盘）
- `references/troubleshooting.md` —— 失败对照表与取证方法
