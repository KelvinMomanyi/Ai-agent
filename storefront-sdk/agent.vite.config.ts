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
    rollupOptions: {
      input: resolve(__dirname, "src/agent/AgentCore.ts"),
      // This is an application runtime, not a library awaiting tree shaking.
      // Keep its loader API while allowing Vite to minify whitespace too.
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "aovboost-agent-core-[hash].js",
        chunkFileNames: "aovboost-agent-[name]-[hash].js",
      },
    },
  },
  plugins: [
    {
      name: "agent-core-asset",
      writeBundle(_options, bundle) {
        const entry = Object.values(bundle).find(
          (row) => row.type === "chunk" && row.isEntry,
        );
        if (!entry) throw new Error("Missing agent core entry");
        writeFileSync(
          resolve(__dirname, ".agent-core.json"),
          JSON.stringify({ file: entry.fileName, files: Object.keys(bundle) }),
        );
        for (const file of readdirSync(assets))
          if (/^aovboost-agent-[\w-]+\.js$/.test(file) && !bundle[file]) {
            const target = join(assets, file);
            if (dirname(target) !== assets)
              throw new Error("Unsafe generated asset path");
            unlinkSync(target);
          }
      },
    },
  ],
});
