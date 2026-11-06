# Expiring offline token migration audit

Audit completed November 5, 2026. No production tokens were exchanged or refreshed
as part of this audit.

## Result

The migration is implemented. All eight offline sessions returned by the
read-only audit of the database configured in the local `.env` have expiring
credentials. Two refresh-related reliability issues remain, so token lifecycle
handling should not yet be considered fully hardened.

The production alias `ai-agent-dusky-nine.vercel.app` resolves to a READY
production deployment of commit `ae177374bf517e2ea49cd86d0f494615c8c9eb51`, matching
the clean local checkout inspected before this report was added. The deployed
commit therefore includes the authentication and migration code reviewed here.
The local database connection was not independently compared with the production
connection, and Shopify's dashboard compliance status was not inspected.

## Database evidence

`npm.cmd run tokens:audit` completed successfully after generating the local
Prisma client. The audit only reads counts:

| Metric | Count |
| --- | ---: |
| Offline sessions with a nonempty access token | 8 |
| Expiring sessions with all expiry/refresh fields populated | 8 |
| Non-expiring sessions | 0 |
| Sessions with incomplete expiry metadata | 0 |
| Expired refresh tokens | 0 |

These counts describe stored metadata, not Shopify's acceptance of each token.
An expired access token is expected between requests when refresh is performed
on demand. A refresh token can also be revoked before its stored expiry.

## Implemented support

- `app/shopify.server.ts` sets `expiringOfflineAccessTokens: true` and public
  App Store distribution. The installed React Router library passes the flag
  into token acquisition and refreshes background offline credentials within
  five minutes of access-token expiry.
- `prisma/schema.prisma` and the token migrations provide `expires`,
  `refreshToken`, and `refreshTokenExpires` storage.
- `app/upstash-session-storage.server.ts` writes credentials to PostgreSQL
  before caching them and reads offline sessions from PostgreSQL.
- `app/services/offline-token-migration.server.ts` uses Shopify's direct legacy
  exchange, validates returned credentials, and retries persistence without
  repeating the exchange. Interactive/background wrappers and protected batch
  endpoints are present.
- No active application Admin API path was found using the duplicated
  `Shop.accessToken` field directly instead of the authentication clients.

## Reliability findings

### High: Invalid refresh credentials can block webhook handling

`app/routes/api.webhooks.tsx:21` calls `authenticate.webhook()` before its event
handling. In installed `@shopify/shopify-app-react-router` 1.2.1, webhook
authentication attempts to refresh an expired offline access token before
returning the verified webhook payload. The SDK converts a refresh response of
HTTP 401 with `invalid_request` into HTTP 500.

A local reproduction using the installed SDK and fake credentials confirmed
this HTTP 500. An invalid or revoked refresh token can therefore block data-only
webhooks, including uninstall and compliance handling, before those branches
execute. Token validity should not be a prerequisite for processing an otherwise
authentic webhook that does not need an Admin API call. Preserve Shopify's
signature validation when addressing this.

### Medium: Automatic refresh ignores failed durable persistence

`app/upstash-session-storage.server.ts:27` returns `false` when PostgreSQL cannot
save a session. The SDK's `ensure-offline-token-is-not-expired.mjs:13` awaits
`storeSession()` but ignores its boolean result and returns the rotated session.

A local reproduction confirmed that the SDK returns the new token even when
storage reports failure. The direct legacy migration has persistence retries,
but normal automatic refresh does not share them. A database outage can leave
the newest credential pair only in the request's memory. Handle failed writes
explicitly and retry saving the same returned pair before reporting success.

## Production configuration observations

Production environment variable names were inspected without decrypting values:

- `OFFLINE_TOKEN_MIGRATION_SECRET` exists for `/internal/token-migration`.
- `SHOPIFY_TOKEN_MIGRATION_SECRET` is absent, so the newer
  `/api/migrate-offline-tokens` endpoint rejects authenticated requests until
  configured. This does not imply any remaining legacy-token backlog.
- `SHOPIFY_KEY_ID` and `SHOPIFY_PRIVATE_KEY` are absent. Optional application-only
  background recovery is implemented but disabled. Normal stored-token refresh
  remains available; a missing or invalid refresh token requires the merchant
  to reopen the app. These signing credentials are not required for the offline
  token migration itself.

## Validation and limits

- Four existing targeted test files passed: 31 tests covering migration,
  session storage, background authentication, and application-only access.
- `npm.cmd run typecheck` passed.
- The two SDK failure scenarios above were reproduced locally with fake data.
- No deployment, production database mutation, migration execution, live token
  rotation, or Shopify dashboard action was performed.

Shopify's published requirements were checked against its current
[migration guide](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens)
and [access token reference](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens).
The guide specifies January 1, 2027 delisting/new-install enforcement,
January 15 merchant warnings, and April 1 GraphQL rejection of non-expiring
offline tokens. Confirm the dashboard status and audited database's production
identity before treating this report as final App Store compliance confirmation.
