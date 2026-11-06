import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
export const SDK_SIZE_BUDGET = { main: 170000, total: 240000, gzip: 65000 };
export function checkSdkSize(files) {
  const main = files.find((file) => file.name === "aovboost-sdk.js");
  const total = files.reduce((sum, file) => sum + file.bytes.length, 0),
    gzip = files.reduce((sum, file) => sum + gzipSync(file.bytes).length, 0);
  if (
    !main ||
    main.bytes.length > SDK_SIZE_BUDGET.main ||
    total > SDK_SIZE_BUDGET.total ||
    gzip > SDK_SIZE_BUDGET.gzip
  )
    throw new Error(
      `SDK size budget exceeded: main=${main?.bytes.length || 0}, total=${total}, gzip=${gzip}`,
    );
  return { main: main.bytes.length, total, gzip };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = fileURLToPath(
    new URL("../extensions/aovboost-storefront/assets/", import.meta.url),
  );
  const names = readdirSync(folder).filter(
    (name) =>
      name === "aovboost-sdk.js" ||
      /^aovboost-theme-engine-[\w-]+\.js$/.test(name),
  );
  if (names.length !== 2)
    throw new Error("Expected one SDK and one hashed theme engine asset");
  console.log(
    "AOVBoost SDK size:",
    checkSdkSize(
      names.map((name) => ({ name, bytes: readFileSync(join(folder, name)) })),
    ),
  );
}
