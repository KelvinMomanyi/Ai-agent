import { authenticate } from "app/shopify.server";
import { ActionFunctionArgs } from "node_modules/@remix-run/node/dist/index";
import { json } from '@remix-run/node';


const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://teretret.myshopify.com', // or restrict to specific Shopify shop domain
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  export const loader = async ({request}) => {
    const { cors} = await authenticate.admin(request)
  
    return cors(json({ message: "Use POST method to get upsell suggestion." },{ headers: corsHeaders }));
  };

export const action = async ({ request }: ActionFunctionArgs) => {
    const { cartItems } = await request.json();
    const { admin, cors} = await authenticate.admin(request);
    // const products = await fetchProducts(request);
    // console.log(products,'fetchedProducts')
  
  };