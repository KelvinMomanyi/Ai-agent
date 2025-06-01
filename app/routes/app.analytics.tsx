import { json, LoaderFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, DataTable } from "@shopify/polaris";
import { json, LoaderFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server"; // ensure this exports `prisma`
import UpsellChart from "./components/UpsellChart";
import { Page, Layout, Card, DataTable } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

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

export const loader: LoaderFunction = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const storeId = `https://${session.shop}/`

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

  const counts = {
    impression: 0,
    click: 0,
    conversion: 0,
  };

  const eventTypeMap: Record<string, keyof typeof counts> = {
    upsell_impression: "impression",
    upsell_add_to_cart: "click",
    upsell_conversion: "conversion",
  };

  const uniqueSet = new Set<string>();

  events.forEach((e) => {
    const normalized = eventTypeMap[e.event];
    const productId = e.data?.id || "unknown";

    if (normalized) {
      const key = `${normalized}-${productId}`;
      if (!uniqueSet.has(key)) {
        counts[normalized]++;
        uniqueSet.add(key);
      }
    }
  });

  const chartData = [
    { name: "Impressions", count: counts.impression },
    { name: "Clicks", count: counts.click },
    { name: "Conversions", count: counts.conversion },
  ];

  const rows = events.map(({ event, timestamp, data }) => [
    event,
    new Date(timestamp).toLocaleString(),
    JSON.stringify(data, null, 2),
  ]);

  return (
    <Page title="Analytics">
      <Layout>
        <Layout.Section>
          <Card title="Event Analytics" sectioned>
            <UpsellChart data={chartData} />
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card title="Event Tracking Log" sectioned>
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["Event", "Timestamp", "Data"]}
              rows={rows}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
