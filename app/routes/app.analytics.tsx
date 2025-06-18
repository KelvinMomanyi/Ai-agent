import { json, LoaderFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, DataTable } from "@shopify/polaris";
import { json, LoaderFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server"; // ensure this exports `prisma`
import UpsellChart from "./components/UpsellChart";
import { Page, Layout, Card, DataTable, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {useMemo} from 'react'
import UpsellTimeSeriesChart from './components/UpsellTimeSeriesChart'


type EventData = {
  event: string;
  timestamp: string;
  data: Record<string, any>;
};
type ShopData = {
  currencyCode: string;
  currencyFormats: {
    moneyFormat: string;
    moneyWithCurrencyFormat: string;
  };
};

type LoaderData = {
  events: EventData[];
  shop: ShopData;
};


export const loader: LoaderFunction = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const storeId = session.shop;

  if (!storeId) {
    throw new Response("Missing shop identifier", { status: 400 });
  }

  const events = await prisma.event.findMany({
    where: {
      storeId,
      timestamp: {
        gte: new Date(new Date().setDate(new Date().getDate() - 30)),
      },
    },
    orderBy: { timestamp: "desc" },
  });

  // Fetch shop currency information
  const shopResponse = await admin.graphql(`
    query getShop {
      shop {
        currencyCode
        currencyFormats {
          moneyFormat
          moneyWithCurrencyFormat
        }
      }
    }
  `);

  const shopResponseJson = await shopResponse.json();

  return json({
    events,
    shop: shopResponseJson.data.shop
  });
};




export default function UpsellDashboard() {
  const { events, shop } = useLoaderData<LoaderData>();

  // Currency formatting function
// Updated formatCurrency function
const formatCurrency = (amount: number) => {
  if (shop?.currencyFormats?.moneyFormat) {
    const formattedAmount = amount.toFixed(2);
    
    // Handle different Shopify currency format placeholders
    return shop.currencyFormats.moneyFormat
      .replace('{{amount}}', formattedAmount)
      .replace('{{amount_with_comma_separator}}', formattedAmount.replace('.', ','))
      .replace('{{amount_no_decimals}}', Math.round(amount).toString())
      .replace('{{amount_with_comma_separator_no_decimals}}', Math.round(amount).toString().replace('.', ','));
  }
  
  // Fallback to browser formatting
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: shop?.currencyCode || 'USD',
  }).format(amount);
};

  // Helper function to extract product info from different event data structures
  const extractProductInfo = (event) => {
    const { event: eventType, data } = event;
    
    switch (eventType) {
      case 'upsell_impression':
        // Impression data: { id: "gid://shopify/ProductVariant/42100385316929", title: "Selling Plans Ski Wax" }
        if (data?.id && data?.title) {
          // Extract variant ID from GraphQL ID
          const variantId = data.id.includes('ProductVariant/') 
            ? data.id.split('ProductVariant/')[1] 
            : data.id;
          return {
            productId: variantId,
            productName: data.title,
            variantId: variantId
          };
        }
        break;
        
      case 'upsell_add_to_cart':
        // Add to cart data has variant_id and title directly
        if (data?.variant_id && data?.title) {
          return {
            productId: data.variant_id.toString(),
            productName: data.title,
            variantId: data.variant_id.toString()
          };
        }
        break;
        
      case 'conversion':
        // Conversion data is a complete Shopify order object
        if (data?.line_items && Array.isArray(data.line_items)) {
          // Extract line items from the order object
          return data.line_items.map(item => ({
            productId: item.variant_id?.toString() || item.id?.toString() || 'unknown',
            productName: item.title || item.name || 'Unknown Product',
            variantId: item.variant_id?.toString() || item.id?.toString() || 'unknown',
            quantity: item.quantity || 1,
            price: parseFloat(item.price || '0'),
            totalValue: (parseFloat(item.price || '0') * (item.quantity || 1))
          }));
        }
        break;
    }
    
    return null;
  };

  // Process all events without deduplication
  const processedData = useMemo(() => {
    const eventCounts = {
      impression: 0,
      click: 0,
      conversion: 0,
    };

    const eventTypeMap: Record<string, keyof typeof eventCounts> = {
      upsell_impression: "impression",
      upsell_add_to_cart: "click",
      conversion: "conversion",
    };

    // Product-specific analytics
    const productAnalytics: Record<string, {
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
      ctr: number;
      conversionRate: number;
      productName: string;
    }> = {};

    // Time-based analytics (last 7 days)
    const timeAnalytics: Record<string, {
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
    }> = {};

    let totalRevenue = 0;

    events.forEach((event) => {
      const eventType = eventTypeMap[event.event];
      const dateKey = new Date(event.timestamp).toISOString().split('T')[0];

      if (eventType) {
        const productInfo = extractProductInfo(event);
        
        if (productInfo) {
          // Handle conversion events (array of products from order line items)
          if (eventType === 'conversion' && Array.isArray(productInfo)) {
            productInfo.forEach(product => {
              // Overall counts (count each line item as a conversion)
              eventCounts.conversion += product.quantity || 1;
              totalRevenue += product.totalValue || 0;
              
              // Product-specific analytics
              if (!productAnalytics[product.productId]) {
                productAnalytics[product.productId] = {
                  impressions: 0,
                  clicks: 0,
                  conversions: 0,
                  revenue: 0,
                  ctr: 0,
                  conversionRate: 0,
                  productName: product.productName,
                };
              }
              productAnalytics[product.productId].conversions += product.quantity || 1;
              productAnalytics[product.productId].revenue += product.totalValue || 0;
              
              // Time-based analytics
              if (!timeAnalytics[dateKey]) {
                timeAnalytics[dateKey] = {
                  impressions: 0,
                  clicks: 0,
                  conversions: 0,
                  revenue: 0,
                };
              }
              timeAnalytics[dateKey].conversions += product.quantity || 1;
              timeAnalytics[dateKey].revenue += product.totalValue || 0;
            });
          } else if (!Array.isArray(productInfo)) {
            // Handle impression and click events (single product)
            const product = productInfo;
            
            // Overall counts
            eventCounts[eventType]++;

            // Product-specific analytics
            if (!productAnalytics[product.productId]) {
              productAnalytics[product.productId] = {
                impressions: 0,
                clicks: 0,
                conversions: 0,
                revenue: 0,
                ctr: 0,
                conversionRate: 0,
                productName: product.productName,
              };
            }
            
            if (eventType === 'impression') {
              productAnalytics[product.productId].impressions++;
            } else if (eventType === 'click') {
              productAnalytics[product.productId].clicks++;
            }

            // Time-based analytics
            if (!timeAnalytics[dateKey]) {
              timeAnalytics[dateKey] = {
                impressions: 0,
                clicks: 0,
                conversions: 0,
                revenue: 0,
              };
            }
            
            if (eventType === 'impression') {
              timeAnalytics[dateKey].impressions++;
            } else if (eventType === 'click') {
              timeAnalytics[dateKey].clicks++;
            }
          }
        }
      }
    });

    // Calculate rates for products
    Object.keys(productAnalytics).forEach(productId => {
      const product = productAnalytics[productId];
      product.ctr = product.impressions > 0 ? (product.clicks / product.impressions) * 100 : 0;
      product.conversionRate = product.clicks > 0 ? (product.conversions / product.clicks) * 100 : 0;
    });

    // Prepare time series data
    const timeSeriesData = Object.entries(timeAnalytics)
      .map(([date, data]) => ({
        date,
        ...data,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Overall metrics
    const totalImpressions = eventCounts.impression;
    const totalClicks = eventCounts.click;
    const totalConversions = eventCounts.conversion;
    const overallCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const overallConversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

    return {
      eventCounts,
      productAnalytics,
      timeSeriesData,
      overallMetrics: {
        totalImpressions,
        totalClicks,
        totalConversions,
        totalRevenue,
        overallCTR,
        overallConversionRate,
      },
    };
  }, [events]);

  const chartData = [
    { name: "Impressions", count: processedData.eventCounts.impression, color: "#3B82F6" },
    { name: "Clicks", count: processedData.eventCounts.click, color: "#10B981" },
    { name: "Conversions", count: processedData.eventCounts.conversion, color: "#F59E0B" },
  ];

  const productTableData = Object.entries(processedData.productAnalytics).map(([productId, data]) => [
    data.productName || productId,
    data.impressions.toString(),
    data.clicks.toString(),
    data.conversions.toString(),
    formatCurrency(data.revenue), // Using currency formatting here
    `${data.ctr.toFixed(2)}%`,
    `${data.conversionRate.toFixed(2)}%`,
  ]);

  const eventRows = events.map(({ event, timestamp, data }) => [
    event,
    new Date(timestamp).toLocaleString(),
    JSON.stringify(data, null, 2),
  ]);

  return (
    <Page title="Analytics Dashboard">
      <Layout>
        {/* Key Metrics Cards */}
        <Layout styles={{
            display: 'flex',
            flexDirection: 'row',
            gap: '16px',
            flexWrap: 'wrap',
            width: '100%',
          }}>
          <Layout.Section oneHalf >
            <Card >
                <Text variant="headingLg" as="h3" alignment="center">
                  {processedData.overallMetrics.totalImpressions}
                </Text>
                <Text variant="bodyMd" color="subdued" alignment="center">
                  Total Impressions
                </Text>
            </Card>
          </Layout.Section>
          
        </Layout >
        <Layout styles={{
            display: 'flex',
            flexDirection: 'row',
            gap: '16px',
            flexWrap: 'wrap',
            width: '100%',
          }}>
          <Layout.Section oneHalf>
            <Card >
          
                <Text variant="headingLg" as="h3" alignment="center">
                  {processedData.overallMetrics.totalClicks}
                </Text>
                <Text variant="bodyMd" color="subdued" alignment="center">
                  Total Clicks
                </Text>
              
            </Card>
          </Layout.Section>
        </Layout>
        <Layout>
          <Layout.Section oneHalf>
            <Card>
            
                <Text variant="headingLg" as="h3" alignment="center">
                  {processedData.overallMetrics.totalConversions}
                </Text>
                <Text variant="bodyMd" color="subdued" alignment="center">
                  Total Conversions
                </Text>
              
            </Card>
          </Layout.Section>
        </Layout>
        <Layout>
          <Layout.Section oneHalf>
            <Card>
            
                <Text variant="headingLg" as="h3" alignment="center">
                {formatCurrency(processedData.overallMetrics.totalRevenue)}
                </Text>
                <Text variant="bodyMd" color="subdued" alignment="center">
                  Total Revenue
                </Text>
              
            </Card>
          </Layout.Section>
        </Layout>
        <Layout >
        <Layout.Section oneHalf>
          <Card >
      
              <Text variant="headingLg" as="h3" alignment="center">
                {processedData.overallMetrics.overallCTR.toFixed(2)}%
              </Text>
              <Text variant="bodyMd" color="subdued" alignment="center">
                Overall CTR
              </Text>
              
          </Card>
        </Layout.Section>
        </Layout>  
        <Layout>
        <Layout.Section oneHalf>
          <Card >
          
              <Text variant="headingLg" as="h3" alignment="center">
                {processedData.overallMetrics.overallConversionRate.toFixed(2)}%
              </Text>
              <Text variant="bodyMd" color="subdued" alignment="center">
                Conversion Rate
              </Text>
              
          </Card>
        </Layout.Section>
        </Layout> 

        {/* Charts Section */}
        <Layout.Section oneHalf>
          <Card title="Event Distribution" sectioned>
            <UpsellChart data={chartData} />
          </Card>
        </Layout.Section>
        <Layout.Section oneHalf>
          <Card title="Time Series Analysis" sectioned>
            <UpsellTimeSeriesChart data={processedData.timeSeriesData} />
          </Card>
        </Layout.Section>

        {/* Product Performance Table */}
         <Layout.Section>
          <Card title="Product Performance Analytics" sectioned>
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric", "numeric"]}
              headings={["Product", "Impressions", "Clicks", "Conversions", "Revenue", "CTR", "Conv. Rate"]}
              rows={productTableData}
              sortable={[true, true, true, true, true, true, true]}
            />
          </Card>
        </Layout.Section> 

        {/* Detailed Event Log */}
         {/* <Layout.Section>
          <Card title="Event Tracking Log" sectioned>

              <Text variant="bodyMd" color="subdued">
                Showing {events.length} events from the last 30 days
              </Text>
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["Event Type", "Timestamp", "Event Data"]}
                rows={eventRows}
                pagination={{
                  hasNext: false,
                  hasPrevious: false,
                  onNext: () => {},
                  onPrevious: () => {},
                }}
              />

          </Card>
        </Layout.Section>  */}
      </Layout>
    </Page>
  );
}






