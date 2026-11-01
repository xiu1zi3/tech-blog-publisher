import { parseFrontmatter, parseMetaBlock, parseList, buildArticle } from './meta.mjs';

/**
 * 把博客源文（带 YAML frontmatter、[toc]、站内链接）改写成平台可发的正文。
 * 返回正文与一份「改了什么」的清单，方便发布前人工确认。
 */
export function adaptBlogSource(source) {
  const { meta, body } = parseMetaBlock(source);
  const { data, body: md } = parseFrontmatter(body);
  const changes = [];

  let text = md;

  if (/^\[toc\]\s*$/im.test(text)) {
    text = text.replace(/^\[toc\]\s*$/gim, '');
    changes.push('移除 [toc]（平台自带目录/大纲）');
  }

  text = text.replace(/\[([^\]]+)\]\(\/article\/[^)]*\)/g, (_, label) => {
    changes.push(`站内链接改为纯文本：${label}`);
    return label;
  });

  text = text.replace(/!\[[^\]]*\]\((\/assets|\/images|\.\.?\/)[^)]*\)\s*/g, () => {
    changes.push('移除了指向本地资源的图片');
    return '';
  });

  const h1 = text.match(/^#\s+/gm);
  if (h1) {
    text = text.replace(/^#\s+/gm, '## ');
    changes.push(`标题层级：H1→H2（${h1.length} 处）`);
  }

  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    article: buildArticle({
      title: meta.title || data.title || '',
      summary: meta.summary || data.summary || '',
      category: meta.category || '',
      tags: parseList(meta.tags || (Array.isArray(data.tags) ? data.tags.join(',') : data.tags) || ''),
      topics: parseList(meta.topics || ''),
      markdown: text,
    }),
    changes,
    frontmatter: data,
  };
}

/** 读取平台稿（文件头 <!-- ... --> 元信息） */
export function readPlatformFile(source, fallbackTitle = '') {
  const { meta, body } = parseMetaBlock(source);
  return {
    article: buildArticle({
      title: meta.title || fallbackTitle,
      summary: meta.summary || '',
      category: meta.category || '',
      tags: parseList(meta.tags || ''),
      topics: parseList(meta.topics || ''),
      markdown: body.trim(),
    }),
    meta,
  };
}
