import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkSdkSize } from "./check-sdk-size.mjs";

const mainName = "aovboost-sdk.js";
const agentName = /^aovboost-agent-[\w-]+\.js$/;
const themeName = /^aovboost-theme-engine-[\w-]+\.js$/;
const isRuntime = (name) =>
  name === mainName || agentName.test(name) || themeName.test(name);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Inspect the actual emitted graph, rather than trusting the build manifests
// alone: the IIFE may still refer to an older core or theme entry after a
// partial build. This is offline tooling, never loaded by the storefront.
/**
 * @param {{
 *   files: Array<{name: string, bytes: Buffer}>,
 *   agent: {file: string, files: string[]},
 *   theme: {file: string},
 *   blocks?: Array<{name: string, bytes: Buffer}>
 * }} input
 */
export function inspectAgentRelease({ files, agent, theme, blocks = [] }) {
  if (
    !agentName.test(agent?.file) ||
    !themeName.test(theme?.file) ||
    !Array.isArray(agent?.files) ||
    !agent.files.includes(agent.file) ||
    !agent.files.every(
      (name) => typeof name === "string" && agentName.test(name),
    )
  )
    throw new Error("Invalid SDK manifests; run npm run build:sdk first");
  const expected = [mainName, theme.file, ...agent.files];
  if (new Set(expected).size !== expected.length)
    throw new Error("Duplicate SDK manifest entry");
  const emitted = new Map();
  for (const file of files) {
    if (!isRuntime(file.name) || emitted.has(file.name) || !file.bytes.length)
      throw new Error("Invalid, duplicate or empty SDK asset");
    emitted.set(file.name, file.bytes);
  }
  if (
    expected.length !== emitted.size ||
    expected.some((name) => !emitted.has(name))
  )
    throw new Error("Missing or stale SDK assets; run npm run build:sdk first");

  const graph = new Map();
  for (const [name, bytes] of emitted) {
    const references = [
      ...new Set(bytes.toString("utf8").match(/aovboost-[\w.-]+\.js/g) || []),
    ];
    for (const reference of references)
      if (!emitted.has(reference))
        throw new Error(`Missing SDK reference: ${name} -> ${reference}`);
    graph.set(name, references);
  }
  for (const entry of [agent.file, theme.file])
    if (!graph.get(mainName).includes(entry))
      throw new Error(`SDK entry mismatch: ${entry}`);
  const reachable = new Set();
  const visit = (name) => {
    if (reachable.has(name)) return;
    reachable.add(name);
    for (const reference of graph.get(name)) visit(reference);
  };
  visit(mainName);
  if (reachable.size !== emitted.size)
    throw new Error("Unreachable SDK chunk in release");

  const sizes = checkSdkSize(files);
  const artifacts = [
    ...files.map((file) => ({ ...file, kind: "runtime" })),
    ...blocks.map((file) => ({ ...file, kind: "app_block" })),
  ]
    .map(({ name, bytes, kind }) => ({
      name,
      kind,
      raw: bytes.length,
      sha256: sha256(bytes),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return {
    version: 1,
    scope: "local-built-javascript-and-app-blocks",
    fingerprint: sha256(JSON.stringify(artifacts)),
    sizes,
    artifacts,
    references: Object.fromEntries(
      [...graph].sort(([left], [right]) => left.localeCompare(right, "en")),
    ),
    liveVerified: false,
    productionReady: false,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = join(root, "test-results/agent-release.json");
  const save = (report) => {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      JSON.stringify(
        { ...report, generatedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  };
  try {
    // Invalidate earlier evidence before inspection, including interrupted runs.
    save({ version: 1, status: "checking", liveVerified: false });
    const assets = join(root, "extensions/aovboost-storefront/assets");
    const blocks = join(root, "extensions/aovboost-storefront/blocks");
    const report = inspectAgentRelease({
      files: readdirSync(assets)
        .filter(isRuntime)
        .map((name) => ({ name, bytes: readFileSync(join(assets, name)) })),
      agent: JSON.parse(
        readFileSync(join(root, "storefront-sdk/.agent-core.json"), "utf8"),
      ),
      theme: JSON.parse(
        readFileSync(join(root, "storefront-sdk/.theme-engine.json"), "utf8"),
      ),
      blocks: readdirSync(blocks)
        .filter((name) => name.endsWith(".liquid"))
        .map((name) => ({ name, bytes: readFileSync(join(blocks, name)) })),
    });
    save({ ...report, status: "passed" });
    console.log("Local SDK graph and size checks passed.");
    console.log(`Fingerprint: ${report.fingerprint}`);
    console.log(
      "Evidence: test-results/agent-release.json (not live verification)",
    );
  } catch (error) {
    try {
      save({ version: 1, status: "failed", liveVerified: false });
    } catch {
      // A read-only filesystem may prevent evidence output. Still fail the CLI.
    }
    // The exit code is authoritative. No environment, source contents or
    // credential-bearing error stack is printed.
    console.error(
      error?.code === "ENOENT"
        ? "SDK build inputs missing; run npm run build:sdk first"
        : error instanceof Error
          ? error.message
          : "Local SDK release check failed",
    );
    process.exitCode = 1;
  }
}
