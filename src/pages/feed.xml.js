// The aggregator's own RSS feed: latest 50 posts across all sources.
import { posts, siteById } from '../lib/data.mjs';

const esc = (s) =>
  String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function GET(context) {
  const items = posts
    .slice(0, 50)
    .map(
      (p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(p.url)}</link>
      <guid isPermaLink="false">${esc(p.id)}</guid>
      ${p.published ? `<pubDate>${new Date(p.published).toUTCString()}</pubDate>` : ''}
      <description>${esc(`${siteById.get(p.siteId)?.name ?? p.siteId}: ${p.summary}`)}</description>
    </item>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>devreads.fyi</title>
    <link>${esc(context.site ?? 'http://localhost:4321')}</link>
    <description>$ tail -f engineering - every engineering blog, one feed</description>
${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
