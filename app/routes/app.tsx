import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import prisma, { withRetry } from "../db.server";
import { authenticate } from "../shopify.server";
import { getJsonCache, setJsonCache } from "../redis.server";


export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const graphqlQuery = `
  query {
    products(first: 50) {
      edges {
        node {
          id
          title
          handle
          featuredMedia {
            preview {
              image {
                url
                altText
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
      }
    }
  }
  `;

  const response = await admin.graphql(`#graphql\n${graphqlQuery}`);
  const result: any = await response.json();

  if (Array.isArray(result.errors) && result.errors.length > 0) {
    throw new Response("Shopify product catalog is unavailable", { status: 502 });
  }

  const productCatalog = (result.data?.products?.edges || []).map(({ node }: any) => ({
    id: node.id,
    title: node.title,
    image: {
      src: node.featuredMedia?.preview?.image?.url || 'https://via.placeholder.com/40',
      alt: node.featuredMedia?.preview?.image?.altText || node.title,
    },
  }));


  // await prisma.shop.upsert({
  //   where: { shopDomain: session.shop },
  //   update: {
  //     accessToken: session.accessToken || "",
  //     productCatalog,
  //   },
  //   create: {
  //     shopDomain: session.shop,
  //     accessToken: session.accessToken || "",
  //     scope: session.scope,
  //     productCatalog,
  //   }
  // });
  // Only upsert on first auth, not every page load
  const key = `shop:init:${session.shop}`;
  const alreadyInit = await getJsonCache(key);
  if (!alreadyInit) {
    await withRetry(() =>
      prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: session.accessToken || "",
          productCatalog,
        },
        create: {
          shopDomain: session.shop,
          accessToken: session.accessToken || "",
          scope: session.scope,
          productCatalog,
        }
      })
    );
    await setJsonCache(key, true, 86400); // Cache 24 hours
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
        <Link to="/app/settings">Revenue Engine</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch thrown responses so auth headers are preserved.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
