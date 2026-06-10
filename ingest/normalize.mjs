import { createHash } from 'node:crypto';

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$|source$)/;

export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

export function stripHtml(html) {
  return (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

export function postKey(item) {
  const link = item.link ? canonicalUrl(item.link) : '';
  if (item.guid && !/^\s*$/.test(item.guid)) return hash(item.guid.trim());
  if (link) return hash(link);
  return hash(`${item.title ?? ''}|${item.isoDate ?? item.pubDate ?? ''}`);
}

function normalizeTags(categories) {
  const tags = new Set();
  for (let c of categories ?? []) {
    if (typeof c === 'object') c = c._ ?? c.$?.term ?? '';
    c = stripHtml(String(c))
      .toLowerCase()
      .replace(/[_/]+/g, ' ')
      .replace(/[^a-z0-9+#. -]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (c.length < 2 || c.length > 32 || /^\d+$/.test(c)) continue;
    tags.add(c);
    if (tags.size >= 5) break;
  }
  return [...tags];
}

function summarize(item) {
  const candidates = [
    item.contentSnippet,
    stripHtml(item.summary),
    stripHtml(item.content),
    stripHtml(item.contentEncoded),
  ];
  let text = candidates.find((t) => t && t.length > 0) ?? '';
  text = text.replace(/\s+/g, ' ').trim();
  const words = text.split(' ');
  if (words.length > 60) text = words.slice(0, 60).join(' ') + '…';
  return text.slice(0, 500);
}

export function normalizeItem(item) {
  const fullText = stripHtml(item.contentEncoded ?? item.content ?? '');
  const wordCount = fullText ? fullText.split(/\s+/).length : 0;
  const published = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null);
  return {
    id: postKey(item),
    url: item.link ? canonicalUrl(item.link) : null,
    title: stripHtml(item.title) || '(untitled)',
    author: stripHtml(item.creator ?? item.author ?? '') || null,
    published: published && !Number.isNaN(Date.parse(published)) ? published : null,
    summary: summarize(item),
    tags: normalizeTags(item.categories),
    wordCount,
    readingMin: wordCount ? Math.max(1, Math.round(wordCount / 230)) : null,
  };
}
