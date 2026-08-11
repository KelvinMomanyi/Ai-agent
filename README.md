# AOVBoost

AOVBoost is an embedded Shopify app built with React Router, Prisma, Polaris,
an app-proxy storefront SDK, a theme app extension, and a post-purchase UI
extension.

## Requirements

- Node.js `>=20.19 <22` or `>=22.12`
- PostgreSQL
- Shopify CLI and a Shopify development store
- Upstash Redis for shared production cache and rate limiting (local
  development has an in-memory fallback)

## Local setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Configure the required environment variables:

   ```text
   SHOPIFY_API_KEY
   SHOPIFY_API_SECRET
   SHOPIFY_APP_URL
   DATABASE_URL
   DATABASE_DIRECT_URL
   ```

   Optional integrations:

   ```text
   UPSTASH_REDIS_REST_URL
   UPSTASH_REDIS_REST_TOKEN
   AOVBOOST_STOREFRONT_SESSION_SECRET
   AOVBOOST_ENABLE_LIVE_EVENTS
   GOOGLE_API_KEY
   GROQ_API_KEY
   ```

   `AOVBOOST_ENABLE_LIVE_EVENTS` is fail-closed and defaults to `false`; set it
   to the exact value `true` to enable authenticated storefront live-event
   polling. Production live-event deduplication also requires the Upstash Redis
   variables above so the ten-minute delivery cap is shared across Vercel
   function instances.

3. Generate Prisma Client and apply migrations:

   ```sh
   npm run setup
   ```

4. Start Shopify development:

   ```sh
   npm run dev
   ```

Shopify CLI reads `shopify.web.toml` and starts `react-router dev`. This project
does not use Remix or `@remix-run/dev`.

## Verification

Run the complete local quality gate:

```sh
npm run verify
```

This runs React Router type generation, TypeScript, ESLint, Vitest, the
storefront SDK build, Prisma Client generation, and the production app build.

Validate both Shopify extensions and application configuration with:

```sh
npx shopify app build
```

## Deployment

The application process should run these commands in order:

```sh
npm install
npm run setup
npm run build
npm run start
```

Deploy Shopify-managed configuration and extensions separately:

```sh
npm run deploy
```

For Vercel, keep the Framework Preset set to **React Router**. The committed
`vercel.json` runs `prisma migrate deploy` before the application build, then
`react-router.config.ts` generates the Vercel Function output. Both
`DATABASE_URL` and `DATABASE_DIRECT_URL` must be available to the build so a
deployment cannot publish a Prisma Client ahead of its database schema.

After deployment, update the app installation so the configured scopes and
webhooks are active. The merchant must also select AOVBoost as the post-purchase
app in Shopify Checkout settings and the app must have post-purchase access.

### Expiring offline access token rollout

This app requests expiring Shopify offline access tokens and automatically
rotates them through the official Shopify library. Deploy the Prisma migrations
before deploying the application so the refresh token fields exist.

Existing non-expiring tokens are migrated when a merchant next opens the app.
To migrate dormant installations in a controlled batch, set a strong
`OFFLINE_TOKEN_MIGRATION_SECRET` production environment variable and call the
protected endpoint:

```sh
curl -X POST "https://ai-agent-plum-eight.vercel.app/internal/token-migration?limit=20" \
  -H "Authorization: Bearer $OFFLINE_TOKEN_MIGRATION_SECRET"
```

Repeat the request until `remaining` is zero, then confirm the app's API health
in the Shopify Dev Dashboard. The exchange revokes each original token and is
irreversible, so verify database backups first.

## Architecture notes

- Storefront API requests are authenticated through Shopify app-proxy
  signatures plus a short-lived signed storefront session.
- Order webhooks are the source of truth for normal conversion attribution.
- Catalog synchronization is resumable and stored in PostgreSQL.
- Product relationships use `(shop, productId)` keys to preserve tenant
  isolation.
- Bundle widgets display Shopify's actual product prices. Only the signed
  post-purchase changeset flow currently applies an app-controlled discount.
