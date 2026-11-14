import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
// The core is a flagged, separately loaded asset; the initial SDK budget stays
// unchanged. Count it in the combined budget so it cannot grow unnoticed.
// Phase 4 adds a separately requested conversation UI. All lazy/shared chunks
// count here; the initial SDK ceiling is unchanged.
// Phase 5 adds explicit fact validation and bounded inline renderers. Every
// emitted asset still counts; the initial SDK ceiling remains unchanged.
export const SDK_SIZE_BUDGET = { main: 170000, total: 285000, gzip: 87000 };
export const SDK_STAGE_BUDGET = {
  initial: { raw: 170000, gzip: 48000 },
  boot: { raw: 240000, gzip: 72000 },
  conversation: { raw: 250000, gzip: 76000 },
  lazyChat: { raw: 9000, gzip: 3600 },
};
export function measureSdk(files) {
  const sum = (rows) => ({
    raw: rows.reduce((n, file) => n + file.bytes.length, 0),
    gzip: rows.reduce((n, file) => n + gzipSync(file.bytes).length, 0),
  });
  const main = files.filter((file) => file.name === "aovboost-sdk.js");
  const agent = files.filter((file) => /^aovboost-agent-/.test(file.name));
  const chat = agent.filter((file) => file.name.includes("ChatConversation"));
  return {
    initial: sum(main),
    boot: sum([...main, ...agent.filter((file) => !chat.includes(file))]),
    conversation: sum([...main, ...agent]),
    lazyChat: sum(chat),
    all: sum(files),
  };
}
export function checkSdkSize(files) {
  const stages = measureSdk(files);
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
  for (const [name, budget] of Object.entries(SDK_STAGE_BUDGET))
    if (stages[name].raw > budget.raw || stages[name].gzip > budget.gzip)
      throw new Error(
        `SDK ${name} size budget exceeded: raw=${stages[name].raw}, gzip=${stages[name].gzip}`,
      );
  return { main: main.bytes.length, total, gzip, stages };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folder = fileURLToPath(
    new URL("../extensions/aovboost-storefront/assets/", import.meta.url),
  );
  const names = readdirSync(folder).filter(
    (name) =>
      name === "aovboost-sdk.js" ||
      /^aovboost-agent-[\w-]+\.js$/.test(name) ||
      /^aovboost-theme-engine-[\w-]+\.js$/.test(name),
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL("../storefront-sdk/.agent-core.json", import.meta.url),
      "utf8",
    ),
  );
  if (
    names.length !== manifest.files.length + 2 ||
    manifest.files.some((name) => !names.includes(name))
  )
    throw new Error(
      "Missing or stale SDK, theme engine or agent runtime chunks",
    );
  console.log(
    "AOVBoost SDK size:",
    checkSdkSize(
      names.map((name) => ({ name, bytes: readFileSync(join(folder, name)) })),
    ),
  );
}
