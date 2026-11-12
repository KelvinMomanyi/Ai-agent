import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { RouterLink } from "./components/RouterLink";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <PolarisAppProvider
          i18n={polarisTranslations}
          linkComponent={RouterLink}
        >
          <Outlet />
        </PolarisAppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <PolarisAppProvider i18n={polarisTranslations}>
          <div style={{ padding: "24px", fontFamily: "sans-serif" }}>
            <h2>
              {status === 401 || status === 403
                ? "Please reopen AOVBoost"
                : "This page could not load"}
            </h2>
            <p>
              {status === 401 || status === 403
                ? "Open AOVBoost from Shopify Admin to restore your session."
                : "Try reloading the page. If the problem continues, reopen AOVBoost from Shopify Admin."}
            </p>
            {isRouteErrorResponse(error) ? (
              <p>Request status: {status}</p>
            ) : null}
          </div>
        </PolarisAppProvider>
        <Scripts />
      </body>
    </html>
  );
}
