import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2020",
    minify: true,
    emptyOutDir: false,
    cssCodeSplit: false,
    outDir: resolve(__dirname, "../extensions/aovboost-storefront/assets"),
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "AOVBoostSDKBundle",
      formats: ["iife"],
      fileName: () => "aovboost-sdk.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
