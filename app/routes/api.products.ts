import { authenticate } from "app/shopify.server";
import { ActionFunctionArgs } from "node_modules/@remix-run/node/dist/index";
import { json } from '@remix-run/node';

export const action = async ({ request }: ActionFunctionArgs) => {
    const { cartItems } = await request.json();
    const { admin} = await authenticate.admin(request);
    // const products = await fetchProducts(request);
    // console.log(products,'fetchedProducts')
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
    
    const products = result.data.products.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    image: {
      src: node.featuredImage?.originalSrc || 'https://via.placeholder.com/40',
      alt: node.featuredImage?.altText || node.title,
    },
    }));
  
    return json({ products }, {
        headers: {
          'Access-Control-Allow-Origin': '*', // or limit to your store domain
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
  };