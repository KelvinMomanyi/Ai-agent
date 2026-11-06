import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAI } from "./client.server";
vi.mock("../models/usage.server", () => ({
  monthlyAiAvailable: async () => true,
  reserveMonthlyAiCall: async () => true,
}));

const originalEnvironment = {
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_AI_MODEL: process.env.GOOGLE_AI_MODEL,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};

describe("AI gateway grounding contract", () => {
  it("cancels a provider request without trying another model after disconnect", async () => {
    process.env.MISTRAL_API_KEY = "test-mistral";
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
          started();
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = callAI({
      triggerName: "chat:cancel",
      shop: "shop.test",
      systemPrompt: "rules",
      userPrompt: "hello",
      signal: controller.signal,
      fallback: "fallback",
    });
    await ready;
    controller.abort();
    expect((await result).fallbackUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = "test-key";
    process.env.GOOGLE_AI_MODEL = "gemini-test-model";
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    restoreEnvironment();
  });

  it("sends system instructions separately and accepts valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: "Grounded answer",
                      productIds: [],
                      followUpQuestion: null,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callAI({
      triggerName: "chat:test",
      systemPrompt: "Store-only system rules",
      userPrompt: '{"message":"hello"}',
      schemaType: "json",
      fallback: '{"reply":"fallback"}',
    });

    expect(result.fallbackUsed).toBe(false);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/models/gemini-test-model:generateContent",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.systemInstruction.parts[0].text).toBe(
      "Store-only system rules",
    );
    expect(body.contents[0].parts[0].text).toBe('{"message":"hello"}');
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("rejects malformed JSON before it reaches the chat route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "not json" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await callAI({
      triggerName: "chat:test",
      systemPrompt: "rules",
      userPrompt: "message",
      schemaType: "json",
      fallback: '{"reply":"fallback"}',
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.content).toBe('{"reply":"fallback"}');
    expect(result.errors).toContainEqual({
      provider: "gemini",
      message: "Model returned invalid JSON",
    });
  });
  it("uses the configured reasoning profile without changing the ordinary model", async () => {
    vi.stubEnv("GOOGLE_AI_REASONING_MODEL", "reasoning-test-model");
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [
                { content: { parts: [{ text: '{"pairings":[]}' }] } },
              ],
            }),
            { status: 200 },
          ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await callAI({
      triggerName: "pairing:test",
      jobClass: "pairing_reasoning",
      timeoutProfile: "reasoning",
      systemPrompt: "rules",
      userPrompt: "catalog",
      schemaType: "json",
      fallback: '{"pairings":[]}',
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "reasoning-test-model:generateContent",
    );
    expect(result.modelVersion).toBe("reasoning-test-model");
    await callAI({
      triggerName: "chat:test",
      systemPrompt: "rules",
      userPrompt: "message",
      fallback: "fallback",
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "gemini-test-model:generateContent",
    );
  });
  it("keeps Mistral thinking chunks out of parsed pairing JSON", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("MISTRAL_API_KEY", "synthetic");
    vi.stubEnv("MISTRAL_AI_REASONING_MODEL", "reasoning-mistral-test");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  {
                    type: "thinking",
                    thinking: [{ text: "private reasoning" }],
                  },
                  { type: "text", text: '{"pairings":[]}' },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await callAI({
      triggerName: "pairing:test",
      jobClass: "pairing_reasoning",
      timeoutProfile: "reasoning",
      systemPrompt: "rules",
      userPrompt: "catalog",
      schemaType: "json",
      fallback: "fallback",
    });
    expect(result.content).toBe('{"pairings":[]}');
    expect(result.fallbackUsed).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "reasoning-mistral-test",
      reasoning_effort: "high",
    });
  });
});

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
