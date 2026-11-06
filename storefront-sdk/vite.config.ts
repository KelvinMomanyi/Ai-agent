import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const engine = JSON.parse(
  readFileSync(resolve(__dirname, ".theme-engine.json"), "utf8"),
);

export default defineConfig({
  define: { __AOVBOOST_THEME_ENGINE_ASSET__: JSON.stringify(engine.file) },
  publicDir: false,
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
