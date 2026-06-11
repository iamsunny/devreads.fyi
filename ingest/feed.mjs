import Parser from 'rss-parser';

const UA = 'engineering-blogs-aggregator/0.1 (personal RSS aggregator; conditional GET; contact via repo)';

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
    ],
  },
});

// Conditional GET: returns {status:304} untouched, {status:200, text, etag, lastModified} on success.
export async function fetchUrl(url, { etag, lastModified, timeoutMs = 20000 } = {}) {
  const headers = { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304) return { status: 304 };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    status: 200,
    text: await res.text(),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

export async function parseFeed(xml) {
  return parser.parseString(xml);
}

// Atom archived-feed pagination (RFC 5005): <link rel="prev-archive" href="..."/>
export function prevArchiveLink(xml) {
  const m = xml.match(/<link\b[^>]*rel="prev-archive"[^>]*>/i);
  if (!m) return null;
  const href = m[0].match(/href="([^"]+)"/i);
  return href ? href[1] : null;
}
