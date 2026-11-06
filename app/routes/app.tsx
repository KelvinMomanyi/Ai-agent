import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { resumeCatalogSyncOnAdminEntry } from "../jobs/aovboost.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  try {
    await resumeCatalogSyncOnAdminEntry(session.shop, admin);
  } catch {
    // The durable job reports failure on Home; a sync failure must not lock
    // merchants out of settings or the rest of the embedded admin.
    console.error("AOVBoost admin-entry catalog sync failed", {
      shop: session.shop,
    });
  }
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/analytics">Revenue Dashboard</Link>
        <Link to="/app/pairings">Product pairings</Link>
        <Link to="/app/settings">Recommendations</Link>
        <Link to="/app/plan">Plan &amp; usage</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch thrown responses so auth headers are preserved.
export function ErrorBoundary() {
  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      {boundary.error(useRouteError())}
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
