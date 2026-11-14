import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { inspectAgentRelease } from "../../../scripts/check-agent-release.mjs";

function fixture() {
  const core = "aovboost-agent-core-current.js";
  const shared = "aovboost-agent-AgentCore-current.js";
  const chat = "aovboost-agent-ChatConversation-current.js";
  const theme = "aovboost-theme-engine-current.js";
  return {
    agent: { file: core, files: [core, shared, chat] },
    theme: { file: theme },
    files: [
      {
        name: "aovboost-sdk.js",
        bytes: Buffer.from(`new URL("${core}");new URL("${theme}")`),
      },
      { name: core, bytes: Buffer.from(`export * from "./${shared}"`) },
      { name: shared, bytes: Buffer.from(`() => import("./${chat}")`) },
      { name: chat, bytes: Buffer.from("export const chat = true") },
      { name: theme, bytes: Buffer.from("export const theme = true") },
    ],
    blocks: [
      { name: "aovboost.liquid", bytes: Buffer.from("synthetic app block") },
    ],
  };
}

describe("offline agent release evidence", () => {
  it("inspects the lazy graph and produces reproducible, bounded evidence", () => {
    const input = fixture();
    const report = inspectAgentRelease(input);
    expect(report.liveVerified).toBe(false);
    expect(report.productionReady).toBe(false);
    expect(report.artifacts).toHaveLength(6);
    expect(report.references[input.agent.files[1]]).toEqual([
      input.agent.files[2],
    ]);
    expect(
      inspectAgentRelease({ ...input, files: [...input.files].reverse() })
        .fingerprint,
    ).toBe(report.fingerprint);
    input.blocks[0].bytes = Buffer.from("changed synthetic block");
    expect(inspectAgentRelease(input).fingerprint).not.toBe(report.fingerprint);
  });

  it("rejects a main bundle left over from a different build", () => {
    const input = fixture();
    input.files[0].bytes = Buffer.from(
      'new URL("aovboost-agent-core-previous.js")',
    );
    expect(() => inspectAgentRelease(input)).toThrow(/Missing SDK reference/);
  });

  it("rejects an absent lazy conversation even when the manifest omits it", () => {
    const input = fixture();
    input.files = input.files.filter(
      (file) => file.name !== input.agent.files[2],
    );
    input.agent.files.pop();
    expect(() => inspectAgentRelease(input)).toThrow(/Missing SDK reference/);
  });

  it("rejects an orphaned manifest chunk", () => {
    const input = fixture();
    input.files[2].bytes = Buffer.from("export const noChat = true");
    expect(() => inspectAgentRelease(input)).toThrow(/Unreachable SDK chunk/);
  });

  it("rejects stale generated assets that a partial build left behind", () => {
    const input = fixture();
    input.files.push({
      name: "aovboost-agent-core-previous.js",
      bytes: Buffer.from("old code"),
    });
    expect(() => inspectAgentRelease(input)).toThrow(/Missing or stale/);
  });

  it("rejects duplicate entries and paths outside the asset directory", () => {
    const input = fixture();
    input.agent.files.push(input.agent.file);
    expect(() => inspectAgentRelease(input)).toThrow(/Duplicate SDK manifest/);
    input.agent.files.pop();
    input.agent.files.push("../aovboost-agent-secret.js");
    expect(() => inspectAgentRelease(input)).toThrow(/Invalid SDK manifests/);
  });

  it("requires the IIFE to reference both current loader entries", () => {
    const input = fixture();
    input.files[0].bytes = Buffer.from(`new URL("${input.agent.file}")`);
    expect(() => inspectAgentRelease(input)).toThrow(/SDK entry mismatch/);
  });

  it("enforces the existing performance ceilings", () => {
    const input = fixture();
    input.files[3].bytes = Buffer.alloc(9001);
    expect(() => inspectAgentRelease(input)).toThrow(/lazyChat size budget/);
  });

  it("replaces previous success evidence when a subsequent CLI check fails", () => {
    const root = mkdtempSync(join(tmpdir(), "aovboost-release-"));
    const put = (name: string, bytes: string | Buffer) => {
      const target = join(root, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    };
    try {
      const input = fixture();
      for (const name of ["check-agent-release.mjs", "check-sdk-size.mjs"])
        put(
          `scripts/${name}`,
          readFileSync(new URL(`../../../scripts/${name}`, import.meta.url)),
        );
      put("storefront-sdk/.agent-core.json", JSON.stringify(input.agent));
      put("storefront-sdk/.theme-engine.json", JSON.stringify(input.theme));
      for (const file of input.files)
        put(`extensions/aovboost-storefront/assets/${file.name}`, file.bytes);
      for (const file of input.blocks)
        put(`extensions/aovboost-storefront/blocks/${file.name}`, file.bytes);
      const run = () =>
        spawnSync(
          process.execPath,
          [join(root, "scripts/check-agent-release.mjs")],
          { encoding: "utf8" },
        );
      const evidence = () =>
        JSON.parse(
          readFileSync(join(root, "test-results/agent-release.json"), "utf8"),
        );
      expect(run().status).toBe(0);
      expect(evidence().status).toBe("passed");
      put(
        "extensions/aovboost-storefront/assets/aovboost-sdk.js",
        'new URL("aovboost-agent-core-previous.js")',
      );
      expect(run().status).toBe(1);
      expect(evidence()).toMatchObject({
        status: "failed",
        liveVerified: false,
      });
      expect(evidence().fingerprint).toBeUndefined();
    } finally {
      // Verify the absolute target before recursive cleanup on Windows.
      if (
        dirname(resolve(root)) === resolve(tmpdir()) &&
        basename(root).startsWith("aovboost-release-")
      )
        rmSync(root, { recursive: true, force: true });
    }
  });
});
