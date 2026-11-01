# 为什么必须用独立 Chrome profile（事故复盘）

## 一句话

自动化用的 Chrome 必须是**工具自己的 profile**（`~/.blog-publisher/profiles/chrome`）。
一旦指向你日常使用的 Chrome 配置目录，Chrome 会判定 App-Bound 加密的 Cookie「解密失败」并**直接删除**，导致全站登录态丢失。

## 事故经过（真实发生）

2026-11，第一次做这套自动化时的操作顺序：

1. 为了让脚本能接管浏览器，需要 `--remote-debugging-port`。
2. 日常 Chrome 已经开着，用同一个 profile 再起一个实例会被单例机制合并。
3. 于是把日常 profile 复制到别的目录，用副本启动带调试端口的 Chrome。
4. 结果：副本里绝大多数 Cookie 解不出来，页面全是未登录；更糟的是，用**软链接指向真实 profile** 启动的那次，Chrome 在加载时把无法解密的 Cookie 全部删除。Cookies 数据库只剩几十条新写入的记录，B 站、Google 等站点的登录态一起消失，磁盘上也没有可恢复的旧版本。

## 根因

Chrome 127+ 对 Cookie 使用 App-Bound Encryption（值前缀 `v20`）。这层加密和 profile 的"默认位置"绑定：

- 用**默认目录**启动 → 正常解密。
- 用**自定义目录**（复制、软链接、移动）启动 → 解密失败。

而 Chrome 的 Cookie 加载逻辑遇到解密失败的记录会**删除**它们（防止坏数据反复报错），于是不是"读不到"，而是"被清掉"。

## 正确做法

| 要做 | 不要做 |
| --- | --- |
| 用工具自己的 profile，第一次由 `login` 命令创建 | 复制/软链接日常 Chrome 的 `User Data` |
| 登录态由 `blog-publish login` 在那个 profile 里现场扫码建立 | 试图"借用"已登录的日常 Chrome |
| 需要查看登录态时跑 `blog-publish preflight` | 直接读 `Cookies` 数据库（文件被独占锁，且需要解密） |

## 自检

```bash
blog-publish preflight
```

输出里的 `profile：` 必须是 `~/.blog-publisher/profiles/chrome`（或你显式设置的 `BLOG_PUBLISH_HOME`）。
如果它指向了 `C:\Users\<你>\AppData\Local\Google\Chrome\User Data`，**立刻停止**，改回来再用。

## 如果已经踩了

1. 停止一切自动化。
2. 用日常 Chrome 重新登录受影响的站点（Cookie 无法从磁盘恢复，别浪费时间找备份）。
3. 检查当前 profile 路径，确认工具已指向 `~/.blog-publisher/profiles/chrome`。
4. 重新跑 `blog-publish login` 建立自动化专用登录态。

## 为什么这次能安全处理

本工具的 profile 从未指向默认目录，`profiles/chrome` 是 `login` 在独立路径下创建的，Chrome 对它的 Cookie 始终使用可解密方案（`v10`），所以移动目录后登录态仍然有效——这也是判断"profile 是否用对了"的旁证：如果移动 profile 后登录态还在，说明它是独立 profile。
