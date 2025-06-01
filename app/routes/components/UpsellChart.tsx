import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function UpsellChart({ data }: { data: { name: string; count: number }[] }) {
  console.log(data, 'chartData')
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#5c6ac4" />
      </BarChart>
    </ResponsiveContainer>
  );
}
