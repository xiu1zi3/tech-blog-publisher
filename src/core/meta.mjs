const META_RE = /^\s*<!--([\s\S]*?)-->\s*/;

/** 解析文首 <!-- key: value --> 元信息块 */
export function parseMetaBlock(text) {
  const m = text.match(META_RE);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

/** "人工智能, LLM" | "[人工智能, LLM]" -> ['人工智能','LLM'] */
export function parseList(value) {
  if (!value) return [];
  return String(value)
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(/[,，、]/)
    .map((s) => s.trim().replace(/^["'「]|["'」]$/g, ''))
    .filter(Boolean);
}

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    data[key] = /^\[.*\]$/.test(value) ? parseList(value) : value.replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length) };
}

export function buildArticle({ title, summary = '', category = '', tags = [], topics = [], markdown }) {
  if (!title) throw new Error('缺少标题');
  if (!markdown || markdown.trim().length < 50) throw new Error('正文过短，疑似解析失败');
  return { title: title.trim(), summary: summary.trim(), category: category.trim(), tags, topics, markdown: markdown.trim() };
}
