# What does this PR do?

<!-- One or two sentences. For new blogs, tell us why this blog is worth following. -->

## Adding or changing a blog in sites.yml?

Checklist for each entry:

- [ ] All five fields present: `id`, `name`, `title`, `feed`, `url`
- [ ] `id` is kebab-case and unique (it becomes the source page URL)
- [ ] `title` is the short label readers see as a pill next to each article
- [ ] `feed` and `url` both use `https://`
- [ ] The feed is the blog's **engineering** feed, not a company-wide news or marketing firehose (if the blog has an engineering category feed, use that one)
- [ ] The feed loads in a feed reader and returns at least one item

Notes:

- CI fetches every new or changed feed and fails the build if it does not return items, so a red check usually means the feed URL is wrong or dead.
- One blog per PR is easiest to review, but small batches are fine.
- Removing a blog? Delete its entry, then run `node scripts/prune-sites.mjs` and commit the removed data files too, otherwise its old posts stay on the site.

## Code changes?

- [ ] `npm run build` passes locally
- [ ] For UI changes: checked both light and dark themes
- [ ] No em dashes in copy or docs
