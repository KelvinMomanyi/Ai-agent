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
   GOOGLE_API_KEY
   GROQ_API_KEY
   ```

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
`vercel.json` overrides any older Remix selection, while
`react-router.config.ts` generates the Vercel Function output.

After deployment, update the app installation so the configured scopes and
webhooks are active. The merchant must also select AOVBoost as the post-purchase
app in Shopify Checkout settings and the app must have post-purchase access.

## Architecture notes

- Storefront API requests are authenticated through Shopify app-proxy
  signatures plus a short-lived signed storefront session.
- Order webhooks are the source of truth for normal conversion attribution.
- Catalog synchronization is resumable and stored in PostgreSQL.
- Product relationships use `(shop, productId)` keys to preserve tenant
  isolation.
- Bundle widgets display Shopify's actual product prices. Only the signed
  post-purchase changeset flow currently applies an app-controlled discount.
