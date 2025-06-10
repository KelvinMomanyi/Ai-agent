import { ResponsiveContainer, BarChart, Box, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Legend, Line } from "recharts";

export default function UpsellTimeSeriesChart({ data }: { data: Array<{ date: string; impressions: number; clicks: number; conversions: number }> }) {
  return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="date" 
            tickFormatter={(value) => new Date(value).toLocaleDateString()}
          />
          <YAxis />
          <Tooltip 
            labelFormatter={(value) => new Date(value).toLocaleDateString()}
          />
          <Legend />
          <Line type="monotone" dataKey="impressions" stroke="#3B82F6" strokeWidth={2} name="Impressions" />
          <Line type="monotone" dataKey="clicks" stroke="#10B981" strokeWidth={2} name="Clicks" />
          <Line type="monotone" dataKey="conversions" stroke="#F59E0B" strokeWidth={2} name="Conversions" />
        </LineChart>
      </ResponsiveContainer>
  );
}