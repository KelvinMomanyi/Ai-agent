import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Legend, Line } from "recharts";

// export default function UpsellChart({ data }: { data: { name: string; count: number }[] }) {
//   console.log(data, 'chartData')
//   return (
//     <ResponsiveContainer width="100%" height={300}>
//       <BarChart data={data}>
//         <CartesianGrid strokeDasharray="3 3" />
//         <XAxis dataKey="name" />
//         <YAxis allowDecimals={false} />
//         <Tooltip />
//         <Bar dataKey="count" fill="#5c6ac4" />
//       </BarChart>
//     </ResponsiveContainer>
//   );
// }
// Enhanced Chart Component
export default function UpsellChart({ data }: { data: Array<{ name: string; count: number; color: string }> }) {
  return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" fill={(entry) => entry.color} />
        </BarChart>
      </ResponsiveContainer>
  );
}

