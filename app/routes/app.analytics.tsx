import { json, LoaderFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, DataTable } from "@shopify/polaris";
import { getAllEvents } from "../routes/api.upsell.track"; // Import from API or db
import UpsellChart from "./components/UpsellChart";

type EventData = {
  event: string;
  timestamp: string;
  data: Record<string, any>;
};

export const loader: LoaderFunction = async () => {
  const events = getAllEvents(); // Or call DB
  return json(events);
};

export default function UpsellDashboard() {
  const events = useLoaderData<EventData[]>();


  const counts = {
    impression: 0,
    click: 0,
    conversion: 0,
  };

  events.forEach(e => {
    if (counts[e.event] !== undefined) {
      counts[e.event]++;
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
    JSON.stringify(data),
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
