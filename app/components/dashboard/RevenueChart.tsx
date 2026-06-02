import { Box, Text } from "@shopify/polaris";

type RevenuePoint = {
  date: string;
  revenue: number;
};

type RevenueChartProps = {
  data: RevenuePoint[];
};

export function RevenueChart({ data }: RevenueChartProps) {
  const points = normalizeSeries(data);
  const maxRevenue = Math.max(...points.map((point) => point.revenue), 1);
  const width = 720;
  const height = 220;
  const padding = 28;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const path = points
    .map((point, index) => {
      const x =
        padding +
        (points.length <= 1 ? 0 : (index / (points.length - 1)) * usableWidth);
      const y = padding + usableHeight - (point.revenue / maxRevenue) * usableHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  if (data.length === 0) {
    return (
      <Box paddingBlock="600">
        <Text as="p" tone="subdued" alignment="center">
          Revenue attribution appears after converted offers are tracked.
        </Text>
      </Box>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Revenue attributed to AOVBoost"
      style={{ display: "block", width: "100%", height: "240px" }}
    >
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="#d9d9d9"
      />
      <line
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
        stroke="#d9d9d9"
      />
      <path d={path} fill="none" stroke="#008060" strokeWidth="4" />
      {points.map((point, index) => {
        const x =
          padding +
          (points.length <= 1 ? 0 : (index / (points.length - 1)) * usableWidth);
        const y =
          padding + usableHeight - (point.revenue / maxRevenue) * usableHeight;
        return <circle key={point.date} cx={x} cy={y} r="4" fill="#008060" />;
      })}
      <text x={padding} y={20} fill="#6d7175" fontSize="12">
        {formatCurrency(maxRevenue)}
      </text>
      <text x={padding} y={height - 8} fill="#6d7175" fontSize="12">
        {points[0]?.date}
      </text>
      <text x={width - padding - 72} y={height - 8} fill="#6d7175" fontSize="12">
        {points.at(-1)?.date}
      </text>
    </svg>
  );
}

function normalizeSeries(data: RevenuePoint[]) {
  return data.length > 0 ? data : [{ date: "", revenue: 0 }];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
  }).format(value);
}
