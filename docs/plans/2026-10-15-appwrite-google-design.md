# Appwrite Google-only authentication

The owner approved replacing the inactive Firebase integration with Appwrite Cloud. Keep Astro static on the existing Cloudflare Worker, keep Favorites in D1, and preserve Google-only sign-in, guest imports, account isolation, sign-out and deletion.

## Approach

Use Appwrite's OAuth2 token / server-side session flow over REST. A browser SDK would require Appwrite cookie persistence or a custom endpoint domain; self-hosting would add operational work. The selected Worker approach stores the Appwrite session inside an authenticated encrypted HttpOnly, Secure, SameSite=Lax cookie. No browser SDK or client token storage is required. Production uses host-only __Host- cookies; local HTTP uses distinct development names. The www frontend uses credentialed requests to the canonical apex with an exact origin allowlist.

Start OAuth with a same-origin POST. Store a ten-minute, one-use transaction in D1, bound to a random HttpOnly browser cookie. The callback validates state, consumes the transaction atomically, exchanges the Appwrite token and validates the account/session Google provider and verified email. Immediately redirect to a safe canonical URL without token query parameters. Redact query strings in Cloudflare logs; return no-store and no-referrer callback responses. Never send the API key to Google/the browser or follow upstream redirects server-side.

Map (Appwrite endpoint, project, UID) to the existing D1 user table. The owner confirmed there are no users anywhere; this is a fresh auth setup, with no user migration. Retain deployed schema migration files unchanged. Each authenticated request checks the live Appwrite account and session, including disabled/revoked/expired state. Encrypted cookies are bound to the configured project and origin. Use existing rate limiters and expected-owner guards.

Google confirmation repeats the OAuth flow and must return the same UID. Require confirmation within five minutes before account deletion. Persist a deletion job before deleting the remote account, then cascade-delete the D1 user and mark the job complete. Keep completed identity markers for 31 days plus the daily cleanup interval to block stale in-flight requests. Requests cannot use an account with a pending/completed job. Retry remote deletion safely (404 is idempotent), including through scheduled cleanup; explain cross-service deletion and backup retention in docs.

## Progress and verification

- [x] Inspect existing implementation and official Appwrite API/source documentation; record design before implementation.
- [x] Implement backend, additive migration and frontend redirect behavior.
- [x] Remove Firebase dependencies/config and update privacy, setup and local commands.
- [x] Run real workerd/D1 tests with controlled Appwrite HTTP responses, Chrome flow tests and static regression checks. Seven unit tests, ten runtime groups and twelve Chrome groups passed. Type checks, Worker bundle, 1,712-page build, SEO/analytics/sharing and zero-vulnerability audit passed. Runtime coverage includes scheduled deletion recovery; browser coverage includes the actual Worker redirect/cookie flow with a controlled Appwrite provider response. Actual Google OAuth remains untested pending owner configuration.
- [ ] Push, migrate and verify the inactive production deployment.
- [ ] Configure owner Appwrite/Google credentials and verify real OAuth before activation.

No Appwrite project credentials are available at implementation start. Local mocks establish application behavior, not a real Google callback. Keep production sign-in disabled until staging and production are configured and tested. Other application behavior and the visit counter remain unchanged.

Production D1 was read before schema changes: zero users and Favorites. Migration 0003 applied successfully to the isolated production and staging databases; no fixture data was inserted remotely. The application uses manual upstream fetch redirects because the actual workerd runtime does not support the standard fetch redirect='error' mode; non-2xx responses fail closed and never forward the server key to a redirect target.

Sources: https://appwrite.io/docs/products/auth/server-side-rendering and https://appwrite.io/docs/products/auth/oauth2. REST routes/headers and Google-provider session semantics were also checked against Appwrite's official server SDK and account controller source.
