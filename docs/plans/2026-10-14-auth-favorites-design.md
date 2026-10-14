# Social sign-in and Favorites

Approved: Better Auth + Drizzle + Cloudflare D1 on Workers Paid; initially 5,000 monthly active users, with 100,000 MAU as the growth target. The $5 account minimum is not a total-cost guarantee.

## Implementation tracker

- [x] Pin dependencies; validate an actual workerd bundle with D1.
- [x] Add versioned Better Auth/Favorites migrations and separate development/staging/production storage.
- [x] Add Google/GitHub/LinkedIn OAuth, 30-day rolling sessions, five-minute freshness for linking/deletion, exact-origin checks, and rate limits.
- [x] Add authenticated paginated Favorites, membership batches, idempotent writes, and acknowledged batch import.
- [x] Replace bookmarks with green hearts and Saved with Favorites; keep the s shortcut and redirect /saved/.
- [x] Migrate browser bookmarks, automatically import guest favorites, handle failures without data loss, and isolate account/guest state.
- [x] Add themed Sign in and Account pages, a dismissible local-save nudge, and account linking/deletion.
- [x] Update privacy, deployment documentation, cleanup, and monitoring guidance.
- [x] Run backend/runtime/browser and existing build/analytics/sharing regression checks.
- [x] Deploy code and verify production. Cloudflare Git build and live guest Favorites checks passed; see authentication.md for deployment and test evidence. Public provider activation remains a separate outstanding task below.

## Architecture

Astro remains static. The existing devreads-fyi Worker serves /api/auth/* and /api/favorites* before static assets, preserving the counter routes. Better Auth uses a Drizzle D1 adapter. One application database stores auth and per-user favorite snapshots, independent of counter storage. Production authentication is disabled on workers.dev/preview hosts.

The canonical API is https://devreads.fyi. Only the apex and www origins may make credentialed auth/Favorites requests. OAuth callbacks are /api/auth/callback/google, /github, and /linkedin on the apex. Provider credentials and the auth secret are Worker secrets. Use minimal identity scopes, verified-email-only implicit linking, and unverified internal placeholder addresses for missing provider email. Cookie/session state must never be stored in localStorage.

## Favorites behavior

Guests save without login. A versioned local store migrates er:saved after a successful write. Hearts use aria-pressed and the existing green accent. /favorites/ replaces /saved/. Sign-in explains that browser favorites merge into the account automatically. Import acknowledges records in batches of 50; only acknowledged, unchanged guest entries are cleared. Repeated imports cannot duplicate records.

Signed-in writes are serialized per article, update optimistically, and roll back on failure. Favorite lists use cursor pagination (100/page); membership queries accept 50 IDs. Refresh on page load/tab focus and notify other tabs after mutations. Logout clears account caches and does not copy account data to the guest store. Deleting an account deletes its favorites. The guest nudge is dismissible for 24 hours.

## Verification and rollout

Test real SQLite/workerd storage, owner isolation, CSRF/origin and safe-return checks, imports/retries, session expiry, provider linking/deletion, and browser migration/account switching. Inspect both themes at 320â€“1,440px and keep existing sharing/analytics/counter checks passing. Provider cancellation/missing-email cases use controlled test providers; real production OAuth must be checked separately.

Monitor latency/errors, D1 storage/rows and import failures; clean expired auth records daily. Storage alert threshold: 7GB (D1 hard maximum 10GB). Capacity validation target: 100k accounts Ã— 20 favorites; 100 authenticated requests/second for ten minutes, 90% reads/10% writes, p95 below 500ms and unexpected errors below 1%. Do not claim this growth benchmark passed until actually measured on staging.

## Outstanding external activation

- [ ] Add provider credentials and verify real Google, GitHub and LinkedIn callbacks before enabling public sign-in.
- [ ] Confirm Workers Paid billing and run the documented 100k-account staging growth benchmark; no capacity result is claimed.

Implemented checks and provisioning results are recorded in [authentication.md](../authentication.md).
