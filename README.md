# Engineering reads

An aggregator for engineering blogs: scheduled RSS/Atom ingestion with one-time backfill per site, and a static webapp with instant client-side search.

Seeded from [kilimchoi/engineering-blogs](https://github.com/kilimchoi/engineering-blogs) (420 feeds via its OPML).

## How it works

```
sites.yml ──> ingest worker (cron) ──> data/posts/*.ndjson + data/state.json
                                            │
                                            v
                              astro build + pagefind index ──> dist/ (static site)
```

- **`sites.yml`** is the single source of truth. Adding a site is one entry (`id`, `name`, `feed`, `url`). A site with no entry in `data/state.json` is treated as new and gets a **backfill**: the feed itself, then RFC 5005 archive pagination, then the WordPress `?paged=N` trick (capped at 500 posts/site). Every later run is a cheap **delta** using conditional GET (ETag/Last-Modified), so unchanged feeds cost a 304.
- Per-site state machine: `new → backfilling → active`, with `failing → quarantined` after 8 consecutive errors (quarantined sites are retried daily). Health is visible on the **Sources** page.
- Posts are deduped by feed GUID → canonical URL (tracking params stripped) → title+date hash, and stored as append-only NDJSON (git-friendly diffs for the scheduled commits).
- The webapp is fully static: paginated latest feed with day grouping, tag and source pages, saved posts and unread tracking in localStorage, and a [Pagefind](https://pagefind.app) search overlay (title/summary/tags, filterable by source and tag) that runs entirely in the browser.

## Commands

```sh
npm install
node ingest/run.mjs                 # pull all sites (backfills new ones)
node ingest/run.mjs --limit 20      # only first 20 sites
node ingest/run.mjs --site netflix  # one site by id
npm run build                       # astro build + search index -> dist/
npm run preview                     # serve dist/ locally
npm run dev                         # astro dev (search overlay needs a real build)
npm run import:opml                 # re-import data/seed.opml into sites.yml (manual edits win)
```

## Keyboard shortcuts

`/` search · `j`/`k` navigate · `o`/`Enter` open post · `s` save for later · `Esc` close

## Deploying (GitHub Pages)

1. Create a GitHub repo and push this project (branch `main`).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Run the **Pull feeds and deploy** workflow once manually (Actions tab) — the first run backfills everything and may take a while.
4. After that it runs every 30 minutes: ingest → commit `data/` → rebuild → deploy.

## Adding a site

Append to `sites.yml`:

```yaml
  - id: my-blog
    name: My Blog
    feed: https://example.com/feed.xml
    url: https://example.com
```

The next scheduled run backfills it and folds it into the regular pull. The aggregator also republishes everything at `/feed.xml` (RSS) and `/opml.xml`.
