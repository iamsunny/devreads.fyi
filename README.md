# devreads.fyi

`$ tail -f engineering`: hundreds of engineering blogs, one fast reading list.

Live at [devreads.fyi](https://devreads.fyi).

## Features

- Latest posts from 200+ engineering blogs, grouped by day, with summaries, tags, reading time and thumbnails when feeds provide them
- Instant search across every post (title, summary, tags) with source and tag filters, fully client-side
- Keyboard-first: `/` search, `j`/`k` navigate, `o` open, `s` favorite, `Esc` close
- Heart/Favorites collection: browser storage for guests, optional Google/GitHub/LinkedIn sign-in and account sync, automatic legacy bookmark migration and guest import
- "New since last visit" tracking, stored in your browser
- Article sharing beside each heart: Copy link, LinkedIn, X, and Bluesky; native sharing on supported touch devices, with a selectable URL if clipboard access fails. Every shared publisher URL carries `utm_source=devreads.fyi`, retaining existing query parameters and fragments
- Searchable topic directory at `/tags`, with article counts and existing topic feeds
- Rolling weekly digest at `/digest`
- RSS re-export at `/feed.xml` and OPML at `/opml.xml`
- Light and dark (terminal) themes
- Wide desktop layout with a single-column reading feed and a three-column Tags directory, adapting to smaller screens
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

`npm run dev` and `npm run preview` serve Astro without Cloudflare bindings; use the counter kit's local integration/runtime tests for counter development. To update shared counter code, sync `pages/lib/counter.ts` to `worker/lib/counter.ts` and the widget to `public/visit-counter.js`. Merge counter-handler changes into `worker/index.ts` while preserving its account routes and scheduled cleanup. Re-run the kit's tests and this site's build before deployment.

To roll back the counter integration, remove only its binding, routes and footer widget, then rebuild and redeploy this site. Preserve account routes and D1 storage. Retain the separate counter Worker and namespace to preserve its stored total. Account rollback is documented separately below.

## Cookie consent and analytics

The shared layout loads CookieHub domain code `fa59a1b5` before Google Analytics 4 tag `G-VR4M09Z7LQ`. Consent defaults are queued before measurement commands. The published CookieHub configuration enables Google Consent Mode v2 in advanced mode, so Google can send cookieless measurements before analytics storage is granted; CookieHub manages consent updates and regional behavior. The footer's **cookie settings** link reopens the consent dialog. The privacy page describes consent storage and analytics behavior.

The previous analytics loader, project key, and outbound-event tracking hook were removed. The independent Cloudflare page-view counter and outbound UTM attribution continue to work. CookieHub appearance, regional rules, and future consent settings are managed in its dashboard; no Google Tag Manager container is installed because the provided `G-` ID is a GA4 measurement tag.

## Accounts and Favorites

Better Auth and Drizzle run in the existing Worker with a separate D1 application database. Google, GitHub and LinkedIn providers are gated by credentials and `AUTH_ENABLED`/`AUTH_PROVIDERS`; until configured, guest Favorites work and unfinished provider buttons stay hidden. See [authentication deployment and local development](docs/authentication.md) for provider callbacks, migrations, secret prompts, session behavior, rollback and capacity targets. `/favorites/` replaces `/saved/`, which redirects in the Worker. Account API responses are uncached and enforce session ownership.

The site remains static Astro. Authentication is supplied by Worker routes; Astro dev/preview supports local guest Favorites, while `npm run dev:accounts` supplies the actual local account backend after a build and local migrations. Production/staging storage is separate from local/test data and from the historical visit counter.

## Search structure

Public pages emit build-time Schema.org JSON-LD. The homepage identifies the WebSite; feeds and directories are CollectionPages whose ItemLists describe only their rendered entries. External article destinations stay attributed through original publisher URLs; no article authorship or publisher ownership is invented. Tag/source pages include visible breadcrumb navigation and matching BreadcrumbList data. Account, sign-in, Favorites, legacy Saved and error pages are noindex and excluded from the sitemap. Run `npm run check:seo` after building to verify graphs against rendered links, breadcrumbs, headings and sitemap contents.

## Commands

```sh
npm install
node ingest/run.mjs                 # pull all sites (backfills new ones)
node ingest/run.mjs --limit 20      # only first 20 sites
node ingest/run.mjs --site netflix  # one site by id
npm run build                       # astro build + search index -> dist/
npm run check:analytics             # verify built consent/tag markup and initialization
npm run check:sharing               # verify article controls and every tag destination/count
npm run check:seo                   # verify structured data, rendered lists, headings and indexing
npm run test:seo:browser            # Chrome checks after build; set CHROME_PATH when needed
npm run typecheck:worker             # strict account/counter Worker type checks
npm run test:accounts                # guest-store tests and actual workerd/D1 API tests
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
