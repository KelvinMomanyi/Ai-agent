# Shopify offline token rollout

AOVBoost requests expiring offline tokens through the Shopify React Router
library. The library refreshes the access/refresh pair automatically. PostgreSQL
is the authoritative store for offline credentials; Redis is a secondary cache.
Existing non-expiring tokens can migrate when the app opens or when a background
job requests an Admin client. Dormant stores still need the batch migration.

Shopify's October 27, 2026 changelog sets January 1, 2027 as the deadline to stay
listed and accept new installations. Merchant warnings begin January 15, and
affected API requests return HTTP 403 starting April 1.

## 1. Verify storage and deploy

Run `npm run tokens:audit` with the intended database in `.env`. This command
prints counts only and does not exchange tokens or modify the database.
`nonExpiring` is the migration backlog. Investigate `incomplete` sessions
separately; they cannot safely use the legacy-token exchange.

Deploy the application using the normal backend deployment. The existing Prisma
migrations must have created `session.refreshToken` and
`session.refreshTokenExpires`. A Shopify extension deployment alone does not
deploy this server code.

## 2. Migrate dormant stores

Set a strong `SHOPIFY_TOKEN_MIGRATION_SECRET` in the backend's production
environment. The protected endpoint defaults to a read-only dry run:

```sh
curl -X POST "$SHOPIFY_APP_URL/api/migrate-offline-tokens" \
  -H "Authorization: Bearer $SHOPIFY_TOKEN_MIGRATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":1}'
```

Start with one store by adding `execute:true`:

```sh
curl -X POST "$SHOPIFY_APP_URL/api/migrate-offline-tokens" \
  -H "Authorization: Bearer $SHOPIFY_TOKEN_MIGRATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"execute":true,"limit":1}'
```

The exchange permanently invalidates the old token for affected Admin API
requests. The server must save the returned access token, refresh token and both
expiry values before reporting success. Check the canary's app pages and catalog
sync, then repeat with `limit:25` until `remaining` and `failed` are both zero.
An optional `shop` field restricts either request to a permanent
`*.myshopify.com` domain.

Run the database audit again. Investigate incomplete credentials and expired
refresh tokens, and check Shopify's dashboard after its reporting updates.
The dashboard count can differ from stored sessions and is the final source
for Shopify's compliance warning.

If an exchange response is lost, Shopify supports retrying the original legacy
token within seven days while the issued pair remains eligible. If persistence
fails after a response arrives, the server retries saving that same pair instead
of exchanging it again. Do not restore an old database snapshot as a way to
reverse the Shopify exchange.

The older `/internal/token-migration` endpoint remains available with its
separate `OFFLINE_TOKEN_MIGRATION_SECRET` for existing automation.

## 3. Enable private-key access for background jobs

Follow Shopify's application-only token guide to generate an RSA (2048–8192 bit)
or P-256 key pair, export the **public** JWK, and register it in AOVBoost's
Dev Dashboard under **Settings → Credentials → Public keys**.

Configure these server-side environment variables in production:

| Variable              | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| `SHOPIFY_API_KEY`     | AOVBoost's existing client ID                            |
| `SHOPIFY_KEY_ID`      | The `kid` of the registered public JWK                   |
| `SHOPIFY_PRIVATE_KEY` | Matching private PEM, with real newlines or escaped `\n` |

Keep the private key in the deployment's secret storage. Never commit it or send
it to the browser or Shopify; only the public JWK goes in Shopify's dashboard.

When both signing variables are set, `unauthenticated.admin(shop)` uses
application-only tokens for jobs such as catalog sync and store knowledge. It
works for installed stores without a merchant session or stored refresh token.
These tokens do not replace, renew or migrate the stored offline pair, so the
batch migration above is still necessary.

The backend signs a new 60-second assertion for each token request, including
retries; reads the token's `expires_in`; caches it per store and process; and
renews it before expiry. Transient token request failures get up to three
attempts. A GraphQL HTTP 401 invalidates the cached token and retries once with
a new token. Permission errors do not trigger credential recovery.

Without signing variables, background jobs use the normal stored offline pair
and the Shopify library's automatic refresh. A missing or invalid refresh token
then requires the merchant to reopen the app.

Sources:

- [Updated enforcement timeline](https://shopify.dev/changelog/posts/migrate-to-expiring-offline-access-tokens-before-january-2027)
- [Migration and response recovery](https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens)
- [Application-only access and public-key setup](https://shopify.dev/docs/apps/build/authentication-authorization/application-only-access-tokens)
