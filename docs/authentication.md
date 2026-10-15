# Google sign-in with Firebase Authentication

The site uses standard Firebase Authentication for **Google only**. Astro remains static on Cloudflare Workers Static Assets; Favorites stay in D1. Better Auth and Drizzle have been removed. Firebase/Google handle OAuth and SDK-managed persistence, and the Worker verifies ID tokens before accessing any user's Favorites. No Identity Platform, Firestore, Firebase Analytics, service-account key or Google OAuth client secret is needed in the Worker.

## Firebase setup

1. Create separate production and staging Firebase projects. Select the standard Spark/no-cost Authentication product; do not upgrade to Identity Platform for this Google-only integration. Other Firebase/Google Cloud products and existing Cloudflare usage have separate prices.
2. Register a **Web app** in each project. Copy its public `apiKey`, `authDomain`, `projectId` and `appId` from Project settings. The API key identifies the project; it is not an admin secret. Follow Firebase's API restrictions guidance and retain the Authentication API access required by both the browser SDK and Worker REST calls.
3. In Authentication > Sign-in method, enable **Google** and choose a support email. Disable other providers, including anonymous and email/password sign-in. Configure the app name/support/consent branding as needed in Google Cloud.
4. In Authentication > Settings > Authorized domains, add `devreads.fyi` and `www.devreads.fyi`. In the staging project, add the staging Worker hostname. Add `localhost` explicitly in a development project when testing locally. Keep the default project Firebase auth domain authorized.
5. Retain `authDomain` from Firebase, normally `<project-id>.firebaseapp.com`. The Google popup is managed by Firebase, with the helper callback `https://<authDomain>/__/auth/handler`. If supplying a separate Google OAuth client, register that exact callback in Google's client settings. It replaces the old `/api/auth/callback/google` callback. No GitHub/LinkedIn applications are used.

Map the public Web app configuration into Wrangler's production `vars`, and use the staging project's values under `env.staging.vars`:

```json
{
  "FIREBASE_PROJECT_ID": "your-project-id",
  "FIREBASE_API_KEY": "your-public-web-api-key",
  "FIREBASE_AUTH_DOMAIN": "your-project-id.firebaseapp.com",
  "FIREBASE_APP_ID": "1:123456789:web:your-app-id",
  "AUTH_ENABLED": "false"
}
```

First deploy and enable staging, test real Google popup login, cancellation, reload persistence, sign-out, reauthentication and deletion. Then enable production and verify the same flows. Provider buttons are shown only when `AUTH_ENABLED=true`, all four settings and D1 are present. Public config is returned by `/api/auth/config` only when enabled; no token, OAuth secret or admin credential is exposed. The SDK client bundle is loaded only when auth is configured.

## Databases and migrations

Production binding `AUTH_DB` uses `devreads-auth-production`; staging uses `devreads-auth-staging`. Both are independent of the visit counter. Apply migrations before deploying the new Worker:

```powershell
npx wrangler d1 migrations apply AUTH_DB --remote
npx wrangler d1 migrations apply AUTH_DB --remote --env staging
npm run build
npx wrangler deploy --env staging
# A push to main builds/deploys production through Cloudflare's Git integration.
```

Migration 0001 is retained unchanged. Migration 0002 adds Firebase project/UID mappings and temporary deletion markers. Historical Better Auth tables remain for rollback and are not read for authentication. Existing Favorites are retained. No user is linked merely because their email matches: a collision with an unmigrated legacy account returns `ACCOUNT_MIGRATION_REQUIRED` for explicit owner-assisted migration. The previous deployment was disabled and both remote databases were empty at its last verification; recheck before any future identity migration.

## Local development and verification

Use Node 22.12 or newer and Chrome/Chromium for browser tests.

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
# Fill the four public settings using a development Firebase project.
npx wrangler d1 migrations apply AUTH_DB --local --persist-to .wrangler/dev-local
npm run build
npm run dev:accounts
```

Open `http://localhost:8787`; authorize `localhost` in that Firebase project. Astro dev/preview alone has no account backend. Production/staging storage is never used by local runtime tests.

```powershell
npm run typecheck:worker
npm run test:accounts
npm run build
npm run check:analytics
npm run check:sharing
npm run check:seo
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:accounts:browser
npm run test:seo:browser
npm audit
```

Runtime tests use locally generated RSA signatures and mock Google's public-key/Firebase REST responses, while running the deployed Worker bundle in workerd against disposable D1. Browser tests use a test-only popup adapter and genuinely signed tokens. No unsigned-token mode, emulator verification bypass or public test-login endpoint is deployed. These tests do not establish a successful real Google callback; owner project configuration is still required.

## Session, ownership and privacy

Firebase's SDK persists auth state using its managed IndexedDB/localStorage mechanisms and refreshes short-lived ID tokens. This replaces the former 30-day HttpOnly Better Auth cookie. Application code does not manually persist tokens, place them in URLs or save Google access/refresh tokens in D1. Treat Firebase sign-in storage as **necessary** in CookieHub; analytics consent must not block login or Favorites sync. The Firebase SDK is not loaded while auth is disabled.

The browser sends ID tokens in the Authorization header. The Worker checks RS256 signatures against Google's rotating keys, exact project issuer/audience, expiry, issued/authentication times, Google provider and verified email. Account lookup also checks UID, current Google linkage, verified email, disabled state and `validSince` revocation. Account-status lookups are cached for at most 60 seconds in a bounded isolate cache; administrative revocation may therefore take up to that interval to be observed. Signature and expiry checks still run on every request. Application deletion markers reject replay immediately.

Only exact apex/www origins receive bearer CORS headers. Mutations require an allowed Origin; originless reads require same-origin Fetch Metadata. Production account endpoints are unavailable on preview/worker hosts. All responses are no-store, URL query strings are redacted from Worker logs, automatic invocation logs/traces are disabled, and explicit API error logs include only the path. Favorite writes/imports include an expected application user ID so a tab/account switch cannot write an old action into a different account. D1 owner checks remain authoritative.

Sign-out clears Firebase state on the current browser origin and notifies other tabs. It does not delete cloud Favorites or automatically log out every other device. Apex and www have separate browser storage; canonical navigation to the apex is recommended. Guest favorites migrate and import in acknowledged batches of 50; failed imports retain unacknowledged local data. Pagination is 100 records and membership queries accept 50 IDs.

Account deletion requires Google reauthentication within five minutes. The Worker deletes the authenticated Firebase user, then atomically removes its D1 user/Favorites/mapping and writes a two-hour replay marker. Cross-service deletion is not a distributed transaction: if Firebase succeeds while D1 fails, retry promptly while the current token and recent-auth window remain valid; `USER_NOT_FOUND` from Firebase is treated as an idempotent deletion retry. A sustained outage may require operator cleanup of orphaned D1 records. Daily cleanup removes expired markers and historical expired sessions/verification records. D1 backup retention/Time Travel may retain historical deleted data according to the Cloudflare plan.

## Rollback, costs and growth

`AUTH_ENABLED=false` hides Google sign-in while retaining local guest Favorites and all D1 data. Keep migration history, remote databases and the counter namespace. Old Worker secrets are unused by Firebase; retain them until the rollback window closes, then remove them separately. Do not revert to the old auth backend after creating Firebase users without an explicit identity/data migration.

Standard Firebase's non-phone Authentication is listed as no-cost subject to quotas. The separate Identity Platform upgrade has different MAU pricing and daily Spark limits; it is not required here. Existing Cloudflare Workers/D1 charges remain separate. Monitor Workers request/CPU/error rates and D1 rows/size/query latency. The earlier 100k-account staging capacity benchmark has not been measured; functional tests are not a capacity guarantee. Workers Paid billing status could not previously be read with available API permissions.

Sources: [Firebase pricing](https://firebase.google.com/pricing), [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence), [ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [account lookup/deletion REST APIs](https://firebase.google.com/docs/reference/rest/auth), [API-key guidance](https://firebase.google.com/docs/projects/api-keys), and [Firebase privacy](https://firebase.google.com/support/privacy).
