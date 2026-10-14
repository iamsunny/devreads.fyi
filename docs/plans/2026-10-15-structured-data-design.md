# Schema.org and search structure

Approved scope: add structured data to the existing static Astro site, without changing its feed architecture or claiming ownership of external articles.

- [x] Emit a homepage WebSite node and public WebPage/CollectionPage nodes with stable canonical IDs.
- [x] Describe only rendered feed and directory entries through ItemList/ListItem, preserving original external URLs and list order. Do not invent authors, publishers, dates or article bodies.
- [x] Add visible Home > Tags > topic and Home > Sources > source breadcrumbs and matching BreadcrumbList nodes.
- [x] Add visible H1 headings on Latest and pagination pages using the existing terminal typography.
- [x] Improve tag/source/directory descriptions; noindex account, sign-in, Favorites, legacy Saved and error pages. Exclude utility and redirect URLs from the sitemap.
- [x] Escape JSON-LD safely; verify all built pages against rendered list links and breadcrumbs, then verify existing analytics/sharing and browser layouts.
- [ ] Push and verify the Git-connected Cloudflare deployment and production markup.

Implementation uses a shared build-time helper and one JSON-LD graph per indexable page. Pagination describes the visible page slice, with positions local to that slice and numberOfItems equal to the rendered list length. Breadcrumbs use the current theme, compact mono text and wrapping on narrow screens. No SearchAction is added: search is a browser overlay and Google retired its sitelinks search box. Structured data clarifies content; it does not guarantee rich results.

Local verification: build passed for 1,708 pages / 26,168 indexed posts. `check:seo` verified 1,703 public graphs, 1,701 lists with 66,363 rendered entries, 1,436 breadcrumb trails, safe serialization, one H1 per page, and exact sitemap/noindex exclusions. Analytics and sharing checks passed unchanged. Headless Chrome verified ten routes, both themes, 320/390/768/1,440px widths, rendered list URLs, keyboard breadcrumb navigation and the Saved redirect. Screenshots were inspected. A pre-existing Sources table overflow was fixed with an accessible horizontal scroll region. Checks validate JSON syntax, the selected Schema.org types/properties and consistency with rendered content; they do not claim a Google rich-result appearance or a Search Console recrawl.
