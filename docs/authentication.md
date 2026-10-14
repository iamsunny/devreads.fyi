# Authentication and Favorites deployment

Better Auth 1.7.8 and Drizzle run in the existing static-assets Worker. The application D1 database is separate from the visit counter. Guest hearts and legacy bookmark migration work without OAuth configuration. Provider buttons appear only when the feature flag, auth secret, D1 binding and selected provider credentials are configured.

Use Node 22.12 or newer. Astro was upgraded to 7.3.8 alongside compatible build tools to resolve dependency advisories; the final dependency audit reports zero vulnerabilities.

## Databases and environments

Production: `devreads-auth-production`, binding `AUTH_DB`. Staging: `devreads-auth-staging`, configured under the staging Wrangler environment. Local development uses `.wrangler/dev-local`, not remote storage.

```powershell
npm install
npm run build
Copy-Item .dev.vars.example .dev.vars
# Fill .dev.vars with local OAuth app credentials and a random auth secret.
npx wrangler d1 migrations apply AUTH_DB --local --persist-to .wrangler/dev-local
npm run dev:accounts
```

Local callback root: `http://localhost:8787/api/auth/callback/`. Astro dev/preview alone has no account backend and supports guest favorites only. Tests use disposable Miniflare storage and test-only sessions; no public test-login endpoint exists.

Apply migrations before deploying code that uses them:

```powershell
npx wrangler d1 migrations apply AUTH_DB --remote
npx wrangler d1 migrations apply AUTH_DB --remote --env staging
# Deploy staging first when configuring real provider credentials:
npm run build
npx wrangler deploy --env staging
# Production is Git-connected: a push to main builds/deploys devreads-fyi.
```

## OAuth applications

Create one application for each provider/environment. Production callbacks must exactly match:

| Provider | Callback | Setup |
|---|---|---|
| Google | `https://devreads.fyi/api/auth/callback/google` | Google Cloud Console → APIs & Services → OAuth consent screen and Web application credentials. Publish for external users and complete branding/domain checks required by Google. Request `openid email profile`. |
| GitHub | `https://devreads.fyi/api/auth/callback/github` | GitHub Settings → Developer settings → OAuth Apps → New OAuth App. Homepage `https://devreads.fyi`; request `read:user user:email`. |
| LinkedIn | `https://devreads.fyi/api/auth/callback/linkedin` | LinkedIn Developer Portal → Create app → enable **Sign In with LinkedIn using OpenID Connect** → Auth redirect URLs. Complete LinkedIn's application/company verification requirements. Request `openid profile email`. |

For staging, set `AUTH_BASE_URL` to the deployed staging Worker URL and register matching staging callbacks. Do not reuse production applications/secrets for staging or local development. Staging has no counter binding.

Enter credentials using Wrangler's hidden input prompts:

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put LINKEDIN_CLIENT_ID
npx wrangler secret put LINKEDIN_CLIENT_SECRET
```

Use `--env staging` for staging secrets. Set a distinct random `BETTER_AUTH_SECRET` of at least 32 characters for each environment. Secrets belong in Wrangler or ignored `.dev.vars`, never tracked source files. Do not rotate this secret casually: it signs sessions and encrypts provider tokens.

Set `AUTH_ENABLED=true` and `AUTH_PROVIDERS=google,github,linkedin` in the relevant Wrangler environment only after credentials are in place. First enable and verify on staging; then test actual production sign-in/callbacks, cancellation, sign-out, and linked accounts. Real OAuth verification requires the owner's provider accounts. `AUTH_ENABLED=false` rolls back account features while retaining D1 data and guest favorites.

## Behavior and security

Guest favorites migrate from `er:saved` to `er:favorites:v1`. Successfully migrated legacy data is removed; malformed/unsafe data retains a backup and does not repeatedly resurrect removed entries. Browser storage never contains session/provider tokens. Automatic import clears only acknowledged records that have not changed during the request. Import errors retain the local copy and expose Retry sync.

Sessions use secure HttpOnly host-only `__Secure-devreads.session_token` cookies, rolling 30-day expiry and daily renewal. Additional short-lived `devreads` OAuth-state cookies are necessary for the flow. Classify this cookie family as **necessary** in CookieHub; analytics consent must not block sign-in or account sync. Provider tokens are encrypted by Better Auth. Identity claims and account linking are checked server-side; no blanket trusted-provider bypass is enabled. Explicit provider linking and deletion require a sign-in within five minutes. An account without a verified provider email can sign in using an internal `.invalid` placeholder; that placeholder is not a contact address, and such an identity cannot be implicitly linked to another account.

Favorites APIs require authenticated ownership and validate origins/JSON, record sizes and HTTP(S) URLs. Auth/Favorites responses are uncached; only exact apex/www origins receive credentialed CORS. All browser return paths are restricted to those origins. Production account APIs are unavailable on preview/worker URLs. Worker observability redacts URL query strings, including OAuth callback codes. Counter security rules remain separate.

The daily cron removes expired sessions and verification records. Account deletion cascades favorites and authentication records. Restore operations may restore deleted data from backups; D1 Time Travel retention follows the Cloudflare plan.

## Checks, costs and capacity

```powershell
npm run typecheck:worker
npm run test:accounts
npm run build
npm run check:analytics
npm run check:sharing
# After build and test:accounts; requires an installed Chrome/Chromium:
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:accounts:browser
```

Workers Paid has a $5 account minimum plus additional usage; it is not a guaranteed total bill. Monitor Workers CPU/requests/errors and D1 database size, rows read/written and query latency. D1 storage includes indexes. Begin PostgreSQL migration work at 7GB or when indexed queries cannot meet the measured peak workload; D1 has a hard 10GB per-database maximum.

Growth acceptance target: 100k accounts with 20 favorites each; 100 authenticated requests/second for ten minutes, 90% reads/10% writes, p95 under 500ms and unexpected errors under 1%, excluding OAuth-provider latency. Results must be recorded separately; passing functional tests does not establish this capacity. Initial usage assumption is 5k MAU. Alert/review operationally when latency/error rates or storage approach these thresholds.

Keep application and counter databases/namespaces when rolling back. Roll back through `AUTH_ENABLED=false` and the previous Worker version; never delete storage to roll back UI changes.

## Implementation verification (2026-10-15)

Strict Worker type checking, six unit tests and six actual workerd/D1 test groups passed. Runtime checks cover real signed sessions, forgery/expiry, owner isolation, idempotent writes, 50-record imports, 100-record pagination, origin and JSON validation, OAuth redirect initialization, recent-session checks and cascading account deletion. Ten headless Chrome test groups against the local Worker/D1 passed, including legacy migration, automatic import, a second device, account switching, failed-write rollback, partial-import retry, logout, deletion, both themes and widths from 320 to 1,440px. Provider redirect tests use dummy credentials and controlled sessions; they do not establish successful real OAuth callbacks.

After incorporating scheduled feed updates, the final static build produced 1,708 pages and indexed 26,168 posts. Existing analytics and sharing regression checks passed, including 64,927 article controls and 1,254 tag destinations. Linux GitHub CI passed clean npm installation, strict types, full build, account runtime tests, analytics/sharing checks and audit. The optional WASM lock entries missing from the initial Windows-generated lockfile were repaired.

Production and staging D1 databases have migration `0001` applied and distinct auth secrets stored in Cloudflare. Provider credentials remain outstanding, so `AUTH_ENABLED=false` is intentional. No test identities or fixture sessions were inserted in either remote database. Production was deployed through Cloudflare's Git build for commit `290087b` (build `bed47cd8-c8ba-4ad9-8559-af85baf7401f`, version `7778a048-37e7-4e94-8d47-82aa62d79b27`). Live Chrome checks passed for guest migration, hearts, persistence, attributed sharing, hidden unconfigured providers, API origin/preview isolation and responsive pages. The existing counter read 145,221 during verification; it continues advancing. Third-party scripts were blocked and verification used prefetch headers. Real provider callbacks remain unverified.

The 100k-account growth benchmark has **not** been run. Paid billing status could not be verified with the available OAuth permissions; the subscriptions read returned 403. Before the growth benchmark, confirm Workers Paid in the dashboard, enable a credentialed staging deployment, run the workload above against staging only, and record measured results. Functional tests establish application behavior, not a MAU capacity guarantee.

Reference: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), and [Better Auth account linking](https://better-auth.com/docs/concepts/users-accounts).
