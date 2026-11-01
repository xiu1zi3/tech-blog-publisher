const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  let t = esc(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

/** 面向知乎编辑器的 Markdown -> HTML（只覆盖文章里用到的语法） */
export function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let list = null;
  let inCode = false;
  let quote = [];

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
      quote = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (/^```/.test(line)) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        closeList();
        out.push('<pre><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
      continue;
    }
    if (!line) {
      closeList();
      flushQuote();
      continue;
    }

    let m;
    if ((m = line.match(/^###\s+(.*)$/))) {
      closeList(); flushQuote(); out.push(`<h3>${inline(m[1])}</h3>`); continue;
    }
    if ((m = line.match(/^##\s+(.*)$/))) {
      closeList(); flushQuote(); out.push(`<h2>${inline(m[1])}</h2>`); continue;
    }
    if ((m = line.match(/^#\s+(.*)$/))) {
      closeList(); flushQuote(); out.push(`<h2>${inline(m[1])}</h2>`); continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList(); flushQuote(); out.push('<hr>'); continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); quote.push(m[1]); continue;
    }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      flushQuote();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flushQuote();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    closeList(); flushQuote();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  flushQuote();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

export function countHeadings(md, level = 2) {
  const re = level === 2 ? /^#{1,2}\s+/gm : /^#{3}\s+/gm;
  return (md.match(re) || []).length;
}
