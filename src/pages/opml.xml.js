// OPML export of all configured sources.
import { sites } from '../lib/data.mjs';

const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export function GET() {
  const outlines = sites
    .map((s) => `      <outline type="rss" text="${esc(s.name)}" title="${esc(s.name)}" xmlUrl="${esc(s.feed)}" htmlUrl="${esc(s.url)}"/>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head><title>Engineering reads</title></head>
  <body>
    <outline text="Engineering reads" title="Engineering reads">
${outlines}
    </outline>
  </body>
</opml>`;
  return new Response(xml, { headers: { 'content-type': 'text/x-opml; charset=utf-8' } });
}
