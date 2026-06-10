import { fetchUrl, parseFeed, prevArchiveLink } from './feed.mjs';
import { postKey } from './normalize.mjs';

// Pulls history beyond the feed's first page. Strategies, in order:
// 1. RFC 5005 archived feeds (rel="prev-archive")
// 2. WordPress-style ?paged=N (a large share of company blogs)
// Stops as soon as a page yields nothing new, so servers that ignore
// the paged param (and echo page 1 forever) cost exactly one extra request.
export async function backfillExtraPages(feedUrl, firstXml, { maxPages = 10, existing = new Set() }) {
  const items = [];
  const seen = new Set(existing);
  const collect = (feedItems) => {
    let fresh = 0;
    for (const item of feedItems ?? []) {
      const key = postKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      fresh++;
    }
    return fresh;
  };

  let archiveUrl = prevArchiveLink(firstXml);
  let archivePages = 0;
  while (archiveUrl && archivePages < maxPages) {
    try {
      const res = await fetchUrl(archiveUrl);
      const fresh = collect((await parseFeed(res.text)).items);
      archivePages++;
      if (!fresh) break;
      archiveUrl = prevArchiveLink(res.text);
    } catch {
      break;
    }
  }
  if (archivePages > 0) return items;

  const sep = feedUrl.includes('?') ? '&' : '?';
  for (let page = 2; page <= maxPages + 1; page++) {
    try {
      const res = await fetchUrl(`${feedUrl}${sep}paged=${page}`);
      const fresh = collect((await parseFeed(res.text)).items);
      if (!fresh) break;
    } catch {
      break;
    }
  }
  return items;
}
