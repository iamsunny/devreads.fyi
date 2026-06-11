# devreads.fyi

`$ tail -f engineering`: hundreds of engineering blogs, one fast reading list.

Live at [devreads.fyi](https://devreads.fyi).

## Features

- Latest posts from 300+ engineering blogs, grouped by day, with summaries, tags and reading time
- Instant search across every post (title, summary, tags) with source and tag filters, fully client-side
- Keyboard-first: `/` search, `j`/`k` navigate, `o` open, `s` save, `Esc` close
- Saved posts and "new since last visit" tracking, stored in your browser
- Rolling weekly digest at `/digest`
- RSS re-export at `/feed.xml` and OPML at `/opml.xml`
- Light and dark (terminal) themes

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

## Commands

```sh
npm install
node ingest/run.mjs                 # pull all sites (backfills new ones)
node ingest/run.mjs --limit 20      # only first 20 sites
node ingest/run.mjs --site netflix  # one site by id
npm run build                       # astro build + search index -> dist/
npm run preview                     # serve dist/ locally
npm run dev                         # astro dev (search needs a real build)
```

## Adding a site

Append an entry to `sites.yml` and open a PR (`title` is the pill shown next to each article):

```yaml
  - id: my-blog
    name: My Blog
    title: My Blog
    feed: https://example.com/feed.xml
    url: https://example.com
```

CI validates new entries automatically. Once merged, the next scheduled run backfills the site and folds it into the regular pull.

## License

[MIT](LICENSE)
