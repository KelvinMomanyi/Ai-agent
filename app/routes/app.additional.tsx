import { useState, useEffect } from 'react';
// adjust path if needed
import {
  Card,
  Page,
  TextField,
  Button,
  Layout,
  Text,
  InlineError,
} from '@shopify/polaris';

import { request } from 'http';

// export async function fetchAndStoreShopifyData(
//   storeUrl: string,
//   accessToken: string,
//   request: Request
// ) {
//   const supabase = createClient(request);

//   async function fetchFromShopify(endpoint: string) {
//     const res = await fetch(`https://${storeUrl}/admin/api/2024-04/${endpoint}`, {
//       headers: {
//         'X-Shopify-Access-Token': accessToken,
//         'Content-Type': 'application/json',
//       },
//     });
//     if (!res.ok) throw new Error(`Failed to fetch ${endpoint}`);
//     return res.json();
//   }

//   try {
//     const { products } = await fetchFromShopify('products.json');
//     await supabase.from('products').insert(products.map((p: any) => ({
//       shopify_id: p.id,
//       title: p.title,
//       handle: p.handle,
//       vendor: p.vendor,
//       status: p.status,
//       created_at: p.created_at,
//     })));

//     const { custom_collections } = await fetchFromShopify('custom_collections.json');
//     await supabase.from('collections').insert(custom_collections.map((c: any) => ({
//       shopify_id: c.id,
//       title: c.title,
//       handle: c.handle,
//       published_at: c.published_at,
//     })));

//     const { smart_collections } = await fetchFromShopify('smart_collections.json');
//     await supabase.from('collections').insert(smart_collections.map((c: any) => ({
//       shopify_id: c.id,
//       title: c.title,
//       handle: c.handle,
//       published_at: c.published_at,
//     })));

//     const { customers } = await fetchFromShopify('customers.json');
//     await supabase.from('customers').insert(customers.map((c: any) => ({
//       shopify_id: c.id,
//       email: c.email,
//       first_name: c.first_name,
//       last_name: c.last_name,
//       created_at: c.created_at,
//     })));

//     const { orders } = await fetchFromShopify('orders.json');
//     await supabase.from('orders').insert(orders.map((o: any) => ({
//       shopify_id: o.id,
//       name: o.name,
//       email: o.email,
//       financial_status: o.financial_status,
//       total_price: o.total_price,
//       created_at: o.created_at,
//     })));

//     const { blogs } = await fetchFromShopify('blogs.json');
//     await supabase.from('blogs').insert(blogs.map((b: any) => ({
//       shopify_id: b.id,
//       title: b.title,
//       handle: b.handle,
//       created_at: b.created_at,
//     })));

//     const { pages } = await fetchFromShopify('pages.json');
//     await supabase.from('pages').insert(pages.map((p: any) => ({
//       shopify_id: p.id,
//       title: p.title,
//       handle: p.handle,
//       body_html: p.body_html,
//       created_at: p.created_at,
//     })));

//     return '✅ Shopify data fetched and stored successfully';
//   } catch (error: any) {
//     throw new Error(error.message || '❌ Unknown error occurred');
//   }
// }



export default function FetchShopifyPage() {
  const [status, setStatus] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(false);

  // Automatically retrieve storeUrl and accessToken
  useEffect(() => {
    async function fetchCredentials() {
      // const shop = new URLSearchParams(window.location.search).get('shop');
      // setStoreUrl(shop || '');
      const shop ='https://teretret.myshopify.com/'

      if (shop) {
        try {
          const res = await fetch(`/api/get-access-token?shop=${shop}`);
          const data = await res.json();
          setAccessToken(data.accessToken);
        } catch (err) {
          setStatus('❌ Failed to load credentials.');
        }
      } else {
        setStatus('❌ Shop not found in URL.');
      }
    }

    fetchCredentials();
  }, []);

  // const handleFetch = async () => {
  //   setLoading(true);
  //   setStatus('Fetching Shopify data...');
  //   try {
  //     const result = await fetchAndStoreShopifyData(storeUrl,accessToken, request );
  //     setStatus(result);
  //   } catch (err: any) {
  //     setStatus(`❌ Error: ${err.message}`);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const handleFetch = async () => {
    setLoading(true);
    setStatus('Fetching Shopify data...');
    try {
      const res = await fetch('app/api/fetchData', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeUrl, accessToken }),
      });
      const data = await res.json();
      setStatus(data.message || '✅ Success');
    } catch (err: any) {
      setStatus(`❌ Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  

  return (
    <Page title="Setup Shopify Integration">
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Text variant="bodyMd" as="p" tone="info" alignment="center">
              Click "Next" to fetch and store your Shopify store data.
            </Text>
            <Button
              primary
              loading={loading}
              onClick={handleFetch}
              fullWidth
              marginTop
              disabled={!accessToken || !storeUrl}
            >
              Next
            </Button>
            {status && (
              <Text
                variant="bodyMd"
                color="subdued"
                as="p"
                tone="info"
                alignment="center"
                marginTop
              >
                {status}
              </Text>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


