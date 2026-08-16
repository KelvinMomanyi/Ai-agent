import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAI } from "./client.server";

const originalEnvironment = {
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GOOGLE_AI_MODEL: process.env.GOOGLE_AI_MODEL,
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
};

describe("AI gateway grounding contract", () => {
  beforeEach(() => {
    process.env.GOOGLE_API_KEY = "test-key";
    process.env.GOOGLE_AI_MODEL = "gemini-test-model";
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
