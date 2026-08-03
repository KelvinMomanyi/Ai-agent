import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  // Vercel needs its deployment preset, while the standard React Router
  // output is retained for Docker and `npm start`.
  presets: process.env.VERCEL === "1" ? [vercelPreset()] : [],
} satisfies Config;
