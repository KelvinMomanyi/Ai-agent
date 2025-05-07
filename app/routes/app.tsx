import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import prisma from "app/db.server";
import { authenticate } from "../shopify.server";



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
          featuredImage {
            originalSrc
            altText
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
  const result = await response.json();
  
  const productCatalog = result.data.products.edges.map(({ node }) => ({
  id: node.id,
  title: node.title,
  image: {
    src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
    alt: node.featuredImage?.altText || node.title,
  },
  }));

  
  await prisma.shop.upsert({
    where: { shopDomain: session.shop },
    update: {
      accessToken: session.accessToken,
      productCatalog: session.productCatalog,
    },
    create: {
      shopDomain: session.shop,
      accessToken: session.accessToken,
      scope: session.scope,
      productCatalog:session.productCatalog,
    },
  });
  




return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};



export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
   
  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/additional">Additional page</Link>
        <Link to="/app/rest">Additional page</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
