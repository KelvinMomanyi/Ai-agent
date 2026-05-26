import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Legend,
  Line,
} from "recharts";

export default function UpsellTimeSeriesChart({
  data,
}: {
  data: Array<{
    date: string;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue?: number;
  }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={(value) => new Date(value).toLocaleDateString()}
        />
        <YAxis allowDecimals={false} />
        <Tooltip labelFormatter={(value) => new Date(value).toLocaleDateString()} />
        <Legend />
        <Line
          type="monotone"
          dataKey="impressions"
          stroke="#2563EB"
          strokeWidth={2}
          name="Impressions"
        />
        <Line
          type="monotone"
          dataKey="clicks"
          stroke="#059669"
          strokeWidth={2}
          name="Adds"
        />
        <Line
          type="monotone"
          dataKey="conversions"
          stroke="#D97706"
          strokeWidth={2}
          name="Conversions"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
