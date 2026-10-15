# Google sign-in with Appwrite

Appwrite handles **Google-only authentication**. Astro remains static on the existing Cloudflare Worker; Favorites remain in D1. The Worker uses Appwrite REST APIs and encrypted HttpOnly cookies. There is no browser authentication SDK, Firebase dependency, Firestore or Appwrite database requirement. This is a fresh auth setup: there are no users to migrate. Guest Favorites remain in browser storage and merge automatically after sign-in.

## Appwrite and Google setup

1. Create separate Appwrite Cloud projects for production and staging/development. Copy each project's **API endpoint** (including `/v1`, no trailing slash) and **project ID**. Choose an appropriate region. Free resources are shared across the organization's free projects.
2. Add a **Web platform** with hostname `devreads.fyi` to production. Add `www.devreads.fyi` if using the www site. Add the staging hostname to staging; add `localhost` to the development project. This allowlist permits OAuth success/failure URLs.
3. In **Auth > Settings > OAuth2 providers**, enable **Google**. Configure a Google Cloud **Web application OAuth client**, public app name `devreads.fyi`, support email, and homepage/privacy links. Register the **exact Google redirect URI displayed by Appwrite** in that Google OAuth client. It points to Appwrite's Google callback, not the Worker callback below and not Firebase's `/__/auth/handler`. Paste the Google client ID and secret into Appwrite only. Publish the Google OAuth app for general users after testing; a testing app is restricted to its test-user list.
4. Disable other login providers/methods (email/password, anonymous, phone, magic links, etc.). The application also checks that the actual Appwrite session provider is `google` and the account has a verified email. Use the current Appwrite Cloud API supporting the OAuth `state` parameter and Google provider attribution on token-exchanged sessions.
5. Create a **server API key** restricted to **`sessions.write` and `users.write`**, with a suitable expiry. The Worker uses it to exchange OAuth tokens and delete the authenticated user's Appwrite account. Do not give it database/storage scopes. Put it in Cloudflare as `APPWRITE_API_KEY`, never in Git, public assets or chat. Monitor its expiry and rotate it before expiration.
6. Configure the public values in the appropriate `wrangler.jsonc` environment:

```json
"APPWRITE_ENDPOINT": "https://YOUR-REGION.cloud.appwrite.io/v1",
"APPWRITE_PROJECT_ID": "YOUR_PROJECT_ID",
"AUTH_ENABLED": "false"
```

The code supports an HTTPS self-hosted Appwrite `/v1` endpoint too. Endpoint and project changes invalidate old application cookies. No Appwrite custom domain is required for this flow: the browser visits Appwrite as a top-level page and returns to devreads.fyi; subsequent authenticated calls go through the Worker.

Set separate secrets for each environment, using Wrangler's interactive secret input:

```powershell
npx wrangler secret put APPWRITE_API_KEY
npx wrangler secret put AUTH_SESSION_SECRET
npx wrangler secret put APPWRITE_API_KEY --env staging
npx wrangler secret put AUTH_SESSION_SECRET --env staging
```

Generate an independent 32-byte random session secret for each environment (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Store it securely; rotating it signs out application sessions. Never commit the generated value. Appwrite API keys are server credentials; unlike the old Firebase public API key they must remain secret.

Keep `AUTH_ENABLED=false` until the values and secrets are ready. Enable staging, deploy it, then exercise real Google login/cancellation/reload/sign-out/confirmation/deletion before enabling production. Provider buttons appear only when the full configuration, D1 and both secrets exist. `/api/auth/config` exposes enabled status, Google provider and canonical URL, never server credentials or session data.

The **Worker** receives the Appwrite success/failure redirect at `https://devreads.fyi/api/auth/callback/google` (or the configured staging/local base URL). Google itself returns to the Appwrite redirect URI shown in its Console. Do not interchange these callbacks.

## Database and development

Retain deployed migrations 0001 and 0002 unchanged. Additive migration 0003 creates the Appwrite identity map, ten-minute OAuth transaction records and durable deletion jobs. Previous inactive Firebase/Better Auth tables are not used for authentication. No existing users or Favorites need transferring.

```powershell
npx wrangler d1 migrations apply AUTH_DB --remote
npx wrangler d1 migrations apply AUTH_DB --remote --env staging
```

Use Node 24.12+ (`.node-version` pins 24.13.0) and Chrome/Chromium for browser checks:

```powershell
npm ci
npm run build
Copy-Item .dev.vars.example .dev.vars
# Fill .dev.vars with a separate development Appwrite project/key/session secret.
npx wrangler d1 migrations apply AUTH_DB --local --persist-to .wrangler/dev-local
npm run dev:accounts
```

Open `http://localhost:8787`. Astro dev/preview alone does not serve the account backend. Local tests always use disposable D1 and controlled Appwrite HTTP responses; no test users are inserted remotely. No test-login endpoint or unsigned-session mode exists in the deployed Worker.

```powershell
npm run typecheck:worker
npm run test:accounts
npm run build
npm run check:seo
npm run check:analytics
npm run check:sharing
npm run test:accounts:browser
npm audit
```

## Sessions and Favorites

Sign-in starts through an exact-origin JSON POST. A random state and browser cookie bind a one-use D1 transaction to the initiating browser for ten minutes. The browser visits Appwrite's OAuth2-token URL so Appwrite can also establish its own OAuth nonce cookie. The Worker exchanges the callback's one-time token, verifies the current account/session, and immediately returns a no-store, no-referrer redirect to an allowed site origin. A www sign-in returns to www so its own browser Favorites can be imported. Callback query strings contain a temporary credential; Cloudflare query redaction must stay enabled, and upstream log integrations must also avoid capturing it.

Session cookies contain an AES-GCM encrypted Appwrite session, bound to the project, endpoint and canonical origin. Production cookies are host-only `__Host-devreads.session` / `__Host-devreads.oauth`, with Secure, HttpOnly, SameSite=Lax and Path=/; local HTTP uses distinct unprefixed names. Session lifetime is the shorter of Appwrite expiry and 30 days. No session secret or Google access/refresh token is stored in D1 or localStorage. The Worker checks the live Appwrite account and current session on each authenticated request, without a stale account cache. Administrative revocation therefore takes effect on the next API request. Application records do not persist session IP addresses or user-agent strings; Appwrite itself processes technical session information.

Treat these authentication cookies as necessary in CookieHub; analytics consent must not block login. The www frontend sends credentialed requests to the canonical apex with an exact origin allowlist. Mutations require an allowed Origin. Cross-origin previews cannot use production account APIs. Guest storage remains separate on apex and www.

Favorites preserve per-user ownership, expected-user guards, import acknowledgements in batches of 50, 100-record cursor pages, and 50-ID membership queries. Failed imports retain unacknowledged browser Favorites. Sign-out revokes the current remote session, clears the cookie and updates other tabs; other devices remain signed in. A remotely invalid/expired session shows sign-in again, while a network outage preserves displayed account state. Account collections are never copied into guest storage.

## Deletion, logs and rollback

Confirm Google sign-in on Account when needed. Confirmation repeats OAuth and must return the same Appwrite UID. The resulting confirmation is valid for five minutes. The Worker writes a deletion job first, then deletes the remote Appwrite user and cascades the local user/identity/Favorites deletion. The job blocks account access immediately, survives cross-service failures and can be retried using the same Account page before reloading. A 404 from Appwrite during a recorded retry is safe. After reloading, a pending deletion may show the signed-out view; scheduled recovery continues without browser access. The daily scheduled handler retries up to 25 pending deletions; `appwrite_deletion_retry_failed` means a retry still needs attention. Completed identity markers last 31 days plus the daily cleanup interval, preventing old in-flight requests from recreating deleted users. D1 backups/Time Travel retain historical data according to the Cloudflare plan.

Errors log only fixed event names/API paths (`appwrite_oauth_failed`, `account_api_failed`); never log cookies, tokens, raw provider responses or query parameters. Invocation logs/traces are disabled and query redaction remains enabled. Appwrite's own retention and logging are controlled by its service/settings.

Set `AUTH_ENABLED=false` to hide sign-in while retaining guest Favorites and D1 data. Keep migration history and remote storage. Do not switch providers after public activation without planning identity continuity; no such migration is needed for this initial launch. Old unused Worker secrets can be removed after the rollback window; they are not read by Appwrite code.

Appwrite Cloud currently includes 75,000 MAU on Free; Pro starts at $25/month with 200,000 MAU. Other resource limits and Cloudflare usage still apply. Free Appwrite projects pause after a week of inactivity and projects paused for 90 days are deleted. Monitor project activity, resource quotas, API-key expiry, errors and D1/Workers usage. The earlier 100k-account growth benchmark has not been run; functional checks are not a capacity guarantee.

Sources: [OAuth login](https://appwrite.io/docs/products/auth/oauth2), [server-side authentication](https://appwrite.io/docs/products/auth/server-side-rendering), [account REST API](https://appwrite.io/docs/references/cloud/server-nodejs/account), [users API](https://appwrite.io/docs/references/cloud/server-nodejs/users), [pricing](https://appwrite.io/pricing), [inactivity deletion policy](https://appwrite.io/changelog/entry/2026-06-29), and [privacy](https://appwrite.io/privacy).
