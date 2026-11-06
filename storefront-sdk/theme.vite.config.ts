import { defineConfig } from "vite";
import { resolve, join, dirname } from "node:path";
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
const assets = resolve(__dirname, "../extensions/aovboost-storefront/assets");
export default defineConfig({
  publicDir: false,
  build: {
    target: "es2020",
    minify: true,
    emptyOutDir: false,
    outDir: assets,
    lib: { entry: resolve(__dirname, "src/theme/engine.ts"), formats: ["es"] },
    rollupOptions: {
      output: { entryFileNames: "aovboost-theme-engine-[hash].js" },
    },
  },
  plugins: [
    {
      name: "theme-engine-asset",
      writeBundle(_options, bundle) {
        const entry = Object.values(bundle).find(
          (row) => row.type === "chunk" && row.isEntry,
        );
        if (!entry) throw new Error("Missing theme engine entry");
        writeFileSync(
          resolve(__dirname, ".theme-engine.json"),
          JSON.stringify({ file: entry.fileName }),
        );
        for (const file of readdirSync(assets))
          if (
            /^aovboost-theme-engine-[\w-]+\.js$/.test(file) &&
            file !== entry.fileName
          ) {
            const target = join(assets, file);
            if (dirname(target) !== assets)
              throw new Error("Unsafe generated asset path");
            unlinkSync(target);
          }
      },
    },
  ],
});
