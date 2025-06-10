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

// // export const loader: LoaderFunction = async () => {
// //   const events = await prisma.event.findMany({
// //     where: {
// //       timestamp: {
// //         gte: new Date(new Date().setDate(new Date().getDate() - 30)), // past 30 days
// //       },
// //     },
// //     orderBy: { timestamp: "desc" },
// //   });


// //   return json(events);
// // };
// export const loader: LoaderFunction = async ({ request }) => {
//   const { admin, session } = await authenticate.admin(request);
//   const storeId = `https://${session.shop}`
//   console.log(storeId, 'thisStoreId')
//   if (!storeId) {
//     throw new Response("Missing shop identifier", { status: 400 });
//   }
 
//   const events = await prisma.event.findMany({
//     where: {
//       storeId,
//       timestamp: {
//         gte: new Date(new Date().setDate(new Date().getDate() - 30)),
//       },
//     },
//     orderBy: { timestamp: "desc" },
//   });

//   return json(events);
// };


// export default function UpsellDashboard() {
//   const events = useLoaderData<EventData[]>();
//   console.log(events, 'events')

//   const counts = {
//   impression: 0,
//   click: 0,
//   conversion: 0,
// };

// // Map custom event names to standard categories
// const eventTypeMap: Record<string, keyof typeof counts> = {
//   upsell_impression: "impression",
//   upsell_add_to_cart: "click",
//   upsell_conversion: "conversion", // optional if you add this later
// };
// const uniqueSet = new Set<string>();

// events.forEach((e) => {
//   const normalized = eventTypeMap[e.event];
//   if (normalized) {
//     // Use a composite key: visitor + event type + product
//     const key = `${e.visitorId}-${normalized}-${e.data?.id}`;
//     if (!uniqueSet.has(key)) {
//       counts[normalized]++;
//       uniqueSet.add(key);
//     }
//   }
// });
// // events.forEach((e) => {
// //   const normalized = eventTypeMap[e.event];
// //   if (normalized) {
// //     counts[normalized]++;
// //   }
// // });

// const chartData = [
//   { name: "Impressions", count: counts.impression },
//   { name: "Clicks", count: counts.click },
//   { name: "Conversions", count: counts.conversion },
// ];

  

//   const rows = events.map(({ event, timestamp, data }) => [
//     event,
//     new Date(timestamp).toLocaleString(),
//     JSON.stringify(data, null, 2),
//   ]);

//   return (
//     <Page title="Analytics">
//       <Layout>
//         <Layout.Section>
//           <Card title="Event Analytics" sectioned>
//             <UpsellChart data={chartData} />
//           </Card>
//         </Layout.Section>
//         <Layout.Section>
//           <Card title="Event Tracking Log" sectioned>
//             <DataTable
//               columnContentTypes={["text", "text", "text"]}
//               headings={["Event", "Timestamp", "Data"]}
//               rows={rows}
//             />
//           </Card>
//         </Layout.Section>
//       </Layout>
//     </Page>
//   );
// }

// export const loader: LoaderFunction = async ({ request }) => {
//   const { admin, session } = await authenticate.admin(request);
//   const storeId = session.shop

//   if (!storeId) {
//     throw new Response("Missing shop identifier", { status: 400 });
//   }

//   const events = await prisma.event.findMany({
//     where: {
//       storeId,
//       timestamp: {
//         gte: new Date(new Date().setDate(new Date().getDate() - 30)),
//       },
//     },
//     orderBy: { timestamp: "desc" },
//   });

//   return json(events);
// };

// export default function UpsellDashboard() {
//   const events = useLoaderData<EventData[]>();

//   const counts = {
//     impression: 0,
//     click: 0,
//     conversion: 0,
//   };

//   const eventTypeMap: Record<string, keyof typeof counts> = {
//     upsell_impression: "impression",
//     upsell_add_to_cart: "click",
//     upsell_conversion: "conversion",
//   };

//   const uniqueSet = new Set<string>();

//   events.forEach((e) => {
//     const normalized = eventTypeMap[e.event];
//     const productId = e.data?.id || "unknown";

//     if (normalized) {
//       const key = `${normalized}-${productId}`;
//       if (!uniqueSet.has(key)) {
//         counts[normalized]++;
//         uniqueSet.add(key);
//       }
//     }
//   });

//   const chartData = [
//     { name: "Impressions", count: counts.impression },
//     { name: "Clicks", count: counts.click },
//     { name: "Conversions", count: counts.conversion },
//   ];

//   const rows = events.map(({ event, timestamp, data }) => [
//     event,
//     new Date(timestamp).toLocaleString(),
//     JSON.stringify(data, null, 2),
//   ]);

//   return (
//     <Page title="Analytics">
//       <Layout>
//         <Layout.Section>
//           <Card title="Event Analytics" sectioned>
//             <UpsellChart data={chartData} />
//           </Card>
//         </Layout.Section>
//         <Layout.Section>
//           <Card title="Event Tracking Log" sectioned>
//             <DataTable
//               columnContentTypes={["text", "text", "text"]}
//               headings={["Event", "Timestamp", "Data"]}
//               rows={rows}
//             />
//           </Card>
//         </Layout.Section>
//       </Layout>
//     </Page>
//   );
// }



// export const loader: LoaderFunction = async ({ request }) => {
//   const { admin, session } = await authenticate.admin(request);
//   const storeId = session.shop;

//   if (!storeId) {
//     throw new Response("Missing shop identifier", { status: 400 });
//   }

//   const events = await prisma.event.findMany({
//     where: {
//       storeId,
//       timestamp: {
//         gte: new Date(new Date().setDate(new Date().getDate() - 30)),
//       },
//     },
//     orderBy: { timestamp: "desc" },
//   });

//   return json(events);
// };

// export default function UpsellDashboard() {
//   const events = useLoaderData<EventData[]>();

//   // Process all events without deduplication
//   const processedData = useMemo(() => {
//     const eventCounts = {
//       impression: 0,
//       click: 0,
//       conversion: 0,
//     };

//     const eventTypeMap: Record<string, keyof typeof eventCounts> = {
//       upsell_impression: "impression",
//       upsell_add_to_cart: "click",
//       upsell_conversion: "conversion",
//     };

//     // Product-specific analytics
//     const productAnalytics: Record<string, {
//       impressions: number;
//       clicks: number;
//       conversions: number;
//       ctr: number;
//       conversionRate: number;
//       productName?: string;
//     }> = {};

//     // Time-based analytics (last 7 days)
//     const timeAnalytics: Record<string, {
//       impressions: number;
//       clicks: number;
//       conversions: number;
//     }> = {};

//     events.forEach((event) => {
//       const eventType = eventTypeMap[event.event];
//       const productId = event.data?.id || "unknown";
//       const productName = event.data?.title || event.data?.name || "Unknown Product";
//       const dateKey = new Date(event.timestamp).toISOString().split('T')[0];

//       if (eventType) {
//         // Overall counts
//         eventCounts[eventType]++;

//         // Product-specific analytics
//         if (!productAnalytics[productId]) {
//           productAnalytics[productId] = {
//             impressions: 0,
//             clicks: 0,
//             conversions: 0,
//             ctr: 0,
//             conversionRate: 0,
//             productName,
//           };
//         }
//         productAnalytics[productId][eventType === "click" ? "clicks" : eventType === "impression" ? "impressions" : "conversions"]++;

//         // Time-based analytics
//         if (!timeAnalytics[dateKey]) {
//           timeAnalytics[dateKey] = {
//             impressions: 0,
//             clicks: 0,
//             conversions: 0,
//           };
//         }
//         timeAnalytics[dateKey][eventType === "click" ? "clicks" : eventType === "impression" ? "impressions" : "conversions"]++;
//       }
//     });

//     // Calculate rates for products
//     Object.keys(productAnalytics).forEach(productId => {
//       const product = productAnalytics[productId];
//       product.ctr = product.impressions > 0 ? (product.clicks / product.impressions) * 100 : 0;
//       product.conversionRate = product.clicks > 0 ? (product.conversions / product.clicks) * 100 : 0;
//     });

//     // Prepare time series data
//     const timeSeriesData = Object.entries(timeAnalytics)
//       .map(([date, data]) => ({
//         date,
//         ...data,
//       }))
//       .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

//     // Overall metrics
//     const totalImpressions = eventCounts.impression;
//     const totalClicks = eventCounts.click;
//     const totalConversions = eventCounts.conversion;
//     const overallCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
//     const overallConversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0;

//     return {
//       eventCounts,
//       productAnalytics,
//       timeSeriesData,
//       overallMetrics: {
//         totalImpressions,
//         totalClicks,
//         totalConversions,
//         overallCTR,
//         overallConversionRate,
//       },
//     };
//   }, [events]);

//   const chartData = [
//     { name: "Impressions", count: processedData.eventCounts.impression, color: "#3B82F6" },
//     { name: "Clicks", count: processedData.eventCounts.click, color: "#10B981" },
//     { name: "Conversions", count: processedData.eventCounts.conversion, color: "#F59E0B" },
//   ];

//   const productTableData = Object.entries(processedData.productAnalytics).map(([productId, data]) => [
//     data.productName || productId,
//     data.impressions.toString(),
//     data.clicks.toString(),
//     data.conversions.toString(),
//     `${data.ctr.toFixed(2)}%`,
//     `${data.conversionRate.toFixed(2)}%`,
//   ]);

//   const eventRows = events.map(({ event, timestamp, data }) => [
//     event,
//     new Date(timestamp).toLocaleString(),
//     JSON.stringify(data, null, 2),
//   ]);

//   return (
//     <Page title="Upsell Analytics Dashboard">
//       <Layout>
//         {/* Key Metrics Cards */}
//         <Layout.Section>
//           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
//             <Card sectioned>
//               <div style={{ textAlign: 'center' }}>
//                 <Text variant="headingLg" as="h3">
//                   {processedData.overallMetrics.totalImpressions}
//                 </Text>
//                 <Text variant="bodyMd" color="subdued">
//                   Total Impressions
//                 </Text>
//               </div>
//             </Card>
//             <Card sectioned>
//               <div style={{ textAlign: 'center' }}>
//                 <Text variant="headingLg" as="h3">
//                   {processedData.overallMetrics.totalClicks}
//                 </Text>
//                 <Text variant="bodyMd" color="subdued">
//                   Total Clicks
//                 </Text>
//               </div>
//             </Card>
//             <Card sectioned>
//               <div style={{ textAlign: 'center' }}>
//                 <Text variant="headingLg" as="h3">
//                   {processedData.overallMetrics.totalConversions}
//                 </Text>
//                 <Text variant="bodyMd" color="subdued">
//                   Total Conversions
//                 </Text>
//               </div>
//             </Card>
//             <Card sectioned>
//               <div style={{ textAlign: 'center' }}>
//                 <Text variant="headingLg" as="h3">
//                   {processedData.overallMetrics.overallCTR.toFixed(2)}%
//                 </Text>
//                 <Text variant="bodyMd" color="subdued">
//                   Overall CTR
//                 </Text>
//               </div>
//             </Card>
//             <Card sectioned>
//               <div style={{ textAlign: 'center' }}>
//                 <Text variant="headingLg" as="h3">
//                   {processedData.overallMetrics.overallConversionRate.toFixed(2)}%
//                 </Text>
//                 <Text variant="bodyMd" color="subdued">
//                   Conversion Rate
//                 </Text>
//               </div>
//             </Card>
//           </div>
//         </Layout.Section>

//         {/* Charts Section */}
//         <Layout.Section>
//           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
//             <Card title="Event Distribution" sectioned>
//               <UpsellChart data={chartData} />
//             </Card>
//             <Card title="Time Series Analysis" sectioned>
//               <UpsellTimeSeriesChart data={processedData.timeSeriesData} />
//             </Card>
//           </div>
//         </Layout.Section>

//         {/* Product Performance Table */}
//         <Layout.Section>
//           <Card title="Product Performance Analytics" sectioned>
//             <DataTable
//               columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
//               headings={["Product", "Impressions", "Clicks", "Conversions", "CTR", "Conv. Rate"]}
//               rows={productTableData}
//               sortable={[true, true, true, true, true, true]}
//             />
//           </Card>
//         </Layout.Section>

//         {/* Detailed Event Log */}
//         <Layout.Section>
//           <Card title="Event Tracking Log" sectioned>
//             <div style={{ marginBottom: '1rem' }}>
//               <Text variant="bodyMd" color="subdued">
//                 Showing {events.length} events from the last 30 days
//               </Text>
//             </div>
//             <DataTable
//               columnContentTypes={["text", "text", "text"]}
//               headings={["Event Type", "Timestamp", "Event Data"]}
//               rows={eventRows}
//               pagination={{
//                 hasNext: false,
//                 hasPrevious: false,
//                 onNext: () => {},
//                 onPrevious: () => {},
//               }}
//             />
//           </Card>
//         </Layout.Section>
//       </Layout>
//     </Page>
//   );
// }

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

  return json(events);
};

export default function UpsellDashboard() {
  const events = useLoaderData<EventData[]>();

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
      upsell_conversion: "conversion",
    };

    // Product-specific analytics
    const productAnalytics: Record<string, {
      impressions: number;
      clicks: number;
      conversions: number;
      ctr: number;
      conversionRate: number;
      productName?: string;
    }> = {};

    // Time-based analytics (last 7 days)
    const timeAnalytics: Record<string, {
      impressions: number;
      clicks: number;
      conversions: number;
    }> = {};

    events.forEach((event) => {
      const eventType = eventTypeMap[event.event];
      const productId = event.data?.id || "unknown";
      const productName = event.data?.title || event.data?.name || "Unknown Product";
      const dateKey = new Date(event.timestamp).toISOString().split('T')[0];

      if (eventType) {
        // Overall counts
        eventCounts[eventType]++;

        // Product-specific analytics
        if (!productAnalytics[productId]) {
          productAnalytics[productId] = {
            impressions: 0,
            clicks: 0,
            conversions: 0,
            ctr: 0,
            conversionRate: 0,
            productName,
          };
        }
        productAnalytics[productId][eventType === "click" ? "clicks" : eventType === "impression" ? "impressions" : "conversions"]++;

        // Time-based analytics
        if (!timeAnalytics[dateKey]) {
          timeAnalytics[dateKey] = {
            impressions: 0,
            clicks: 0,
            conversions: 0,
          };
        }
        timeAnalytics[dateKey][eventType === "click" ? "clicks" : eventType === "impression" ? "impressions" : "conversions"]++;
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
              columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
              headings={["Product", "Impressions", "Clicks", "Conversions", "CTR", "Conv. Rate"]}
              rows={productTableData}
              sortable={[true, true, true, true, true, true]}
            />
          </Card>
        </Layout.Section>

        {/* Detailed Event Log */}
        <Layout.Section>
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
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// Enhanced Chart Component
// function UpsellChart({ data }: { data: Array<{ name: string; count: number; color: string }> }) {
//   return (
//     <Box height="300px">
//       <ResponsiveContainer width="100%" height="100%">
//         <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
//           <CartesianGrid strokeDasharray="3 3" />
//           <XAxis dataKey="name" />
//           <YAxis />
//           <Tooltip />
//           <Bar dataKey="count" fill={(entry) => entry.color} />
//         </BarChart>
//       </ResponsiveContainer>
//     </Box>
//   );
// }

// // New Time Series Chart Component
// function UpsellTimeSeriesChart({ data }: { data: Array<{ date: string; impressions: number; clicks: number; conversions: number }> }) {
//   return (
//     <Box height="300px">
//       <ResponsiveContainer width="100%" height="100%">
//         <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
//           <CartesianGrid strokeDasharray="3 3" />
//           <XAxis 
//             dataKey="date" 
//             tickFormatter={(value) => new Date(value).toLocaleDateString()}
//           />
//           <YAxis />
//           <Tooltip 
//             labelFormatter={(value) => new Date(value).toLocaleDateString()}
//           />
//           <Legend />
//           <Line type="monotone" dataKey="impressions" stroke="#3B82F6" strokeWidth={2} name="Impressions" />
//           <Line type="monotone" dataKey="clicks" stroke="#10B981" strokeWidth={2} name="Clicks" />
//           <Line type="monotone" dataKey="conversions" stroke="#F59E0B" strokeWidth={2} name="Conversions" />
//         </LineChart>
//       </ResponsiveContainer>
//     </Box>
//   );
// }