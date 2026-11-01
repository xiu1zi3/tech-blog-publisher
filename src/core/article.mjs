import fs from 'node:fs';
import path from 'node:path';
import { adaptBlogSource, readPlatformFile } from './adapt.mjs';

/** 从文件名 / 文件头 / 显式参数推断平台 */
export function inferPlatform(file, meta = {}, explicit = null) {
  if (explicit) return explicit;
  if (meta.platform) return meta.platform;
  if (/_juejin\.md$/i.test(file)) return 'juejin';
  if (/_zhihu\.md$/i.test(file)) return 'zhihu';
  return null;
}

/** 读取稿子：自动区分「平台稿（<!-- -->）」和「博客源文（YAML frontmatter）」 */
export function loadArticle(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${abs}`);
  const source = fs.readFileSync(abs, 'utf8');
  if (/^\s*<!--/.test(source)) {
    const { article, meta } = readPlatformFile(source);
    return { article, meta, mode: 'platform-file', file: abs };
  }
  const { article, changes } = adaptBlogSource(source);
  return { article, meta: { changes }, mode: 'blog-source', file: abs };
}
