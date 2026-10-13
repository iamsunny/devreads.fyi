# devreads.fyi

`$ tail -f engineering`: hundreds of engineering blogs, one fast reading list.

Live at [devreads.fyi](https://devreads.fyi).

## Features

- Latest posts from 200+ engineering blogs, grouped by day, with summaries, tags, reading time and thumbnails when feeds provide them
- Instant search across every post (title, summary, tags) with source and tag filters, fully client-side
- Keyboard-first: `/` search, `j`/`k` navigate, `o` open, `s` save, `Esc` close
- Saved posts and "new since last visit" tracking, stored in your browser
- Article sharing beside each bookmark: Copy link, LinkedIn, X, and Bluesky; native sharing on supported touch devices, with a selectable URL if clipboard access fails
- Searchable topic directory at `/tags`, with article counts and existing topic feeds
- Rolling weekly digest at `/digest`
- RSS re-export at `/feed.xml` and OPML at `/opml.xml`
- Light and dark (terminal) themes
- Realtime cumulative page-view counter in the footer, with no visitor identifiers

## How it works

```
sites.yml -> ingest worker (scheduled) -> data/posts/*.ndjson + data/state.json
                                               |
                                               v
                            astro build + search index -> dist/ (static site)
```

- `sites.yml` is the source of truth. A site with no fetch state gets a one-time backfill: the feed itself, then RFC 5005 archive pagination, then the WordPress `?paged=N` trick, capped at 500 posts per site. Every later run is a conditional-GET delta, so unchanged feeds cost a 304.
- Each site runs a small state machine (`new -> backfilling -> active`, `failing -> quarantined` after repeated errors, retried daily). Health is visible on the Sources page.
- Posts dedupe by feed GUID, then canonical URL (tracking params stripped), then title+date hash.
- The webapp is fully static. Search runs in the browser against a sharded JSON index built straight from the post store, prefetched in the background.
- Cloudflare's static-assets Worker serves the Astro build and schedules eligible HTML page-view increments through a private binding to the separately deployed `devreads-visit-counter` Durable Object. The footer reads same-origin `/api/visits` snapshots and `/api/visits/ws` updates. Only `https://devreads.fyi` counts; assets, previews, obvious crawlers, prefetches, redirects and errors are excluded. Recording is best effort and never delays page delivery.

## Counter deployment

The implementation is copied from [iamsunny/visit-counter](https://github.com/iamsunny/visit-counter). Deploy that repository's Durable Object Worker first, then deploy this site's existing `devreads-fyi` Worker. `wrangler.jsonc` preserves both custom domains and enables Worker-first asset routing so page requests reach the counter handler. The Durable Object class and stable object name `devreads.fyi` must remain unchanged to retain totals. There is no public increment endpoint.

The total includes 144,948 historical Cloudflare zone page views imported once through private counter Worker configuration. Live views are added on top. The kit's `docs/historical-pageviews.json` records the historical period and metric differences; redeploying this site or the counter does not reapply the import.

`npm run dev` and `npm run preview` serve Astro without Cloudflare bindings; use the counter kit's local integration/runtime tests for counter development. To update shared code, sync `pages/lib/counter.ts` to `worker/lib/counter.ts`, `static-worker/index.ts` to `worker/index.ts` (adjust its import), and the widget to `public/visit-counter.js`. Re-run the kit's tests and this site's build before deployment.

To roll back, restore the previous static-only `wrangler.jsonc`, remove the footer widget/script and `worker/` integration, then rebuild and redeploy this site. Retain the separate counter Worker and namespace to preserve its stored total.

## Cookie consent and analytics

The shared layout loads CookieHub domain code `fa59a1b5` before Google Analytics 4 tag `G-VR4M09Z7LQ`. Consent defaults are queued before measurement commands. The published CookieHub configuration enables Google Consent Mode v2 in advanced mode, so Google can send cookieless measurements before analytics storage is granted; CookieHub manages consent updates and regional behavior. The footer's **cookie settings** link reopens the consent dialog. The privacy page describes consent storage and analytics behavior.

The previous analytics loader, project key, and outbound-event tracking hook were removed. The independent Cloudflare page-view counter and outbound UTM attribution continue to work. CookieHub appearance, regional rules, and future consent settings are managed in its dashboard; no Google Tag Manager container is installed because the provided `G-` ID is a GA4 measurement tag.

## Commands

```sh
npm install
node ingest/run.mjs                 # pull all sites (backfills new ones)
node ingest/run.mjs --limit 20      # only first 20 sites
node ingest/run.mjs --site netflix  # one site by id
npm run build                       # astro build + search index -> dist/
npm run check:analytics             # verify built consent/tag markup and initialization
npm run check:sharing               # verify article controls and every tag destination/count
npm run preview                     # serve dist/ locally
npm run dev                         # astro dev (search needs a real build)
```

## Adding a site

Append an entry to `sites.yml` and open a PR (`name` is shown as a pill next to each article):

```yaml
  - id: my-blog
    name: My Blog
    feed: https://example.com/feed.xml
    url: https://example.com
```

CI validates new entries automatically. Once merged, a fetch runs immediately: the new site backfills and appears within a few minutes, then joins the regular schedule. Removing an entry prunes its stored posts automatically on the same trigger.

## License

[MIT](LICENSE)
