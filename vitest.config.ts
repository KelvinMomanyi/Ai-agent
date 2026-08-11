import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "app/**/*.test.ts",
      "storefront-sdk/**/*.test.ts",
      "extensions/**/*.test.js",
    ],
    clearMocks: true,
  },
});
