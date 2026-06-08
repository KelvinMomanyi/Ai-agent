export type AiProvider = "gemini" | "groq" | "mistral" | "deepseek" | "none";

type AiService = {
  name: Exclude<AiProvider, "none">;
  url: string;
  headers: Record<string, string>;
  buildBody: (systemPrompt: string, userPrompt: string) => unknown;
  extractContent: (data: any) => string | null;
};

let lastAiProvider: AiProvider = "none";

function makeOpenAiService(
  name: "groq" | "mistral" | "deepseek",
  apiKey: string,
  url: string,
  model: string,
): AiService {
  return {
    name,
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    buildBody: (systemPrompt: string, userPrompt: string) => ({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0,
    }),
    extractContent: (data: any) =>
      data.choices?.[0]?.message?.content ?? null,
  };
}

function getAiServices(): AiService[] {
  return [
    process.env.GOOGLE_API_KEY
      ? {
          name: "gemini" as const,
          url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
          headers: { "Content-Type": "application/json" },
          buildBody: (systemPrompt: string, userPrompt: string) => ({
            contents: [
              {
                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
              },
            ],
            generationConfig: { maxOutputTokens: 1000, temperature: 0 },
          }),
          extractContent: (data: any) =>
            data.candidates?.[0]?.content?.parts?.[0]?.text ?? null,
        }
      : null,
    process.env.MISTRAL_API_KEY
      ? makeOpenAiService(
          "mistral",
          process.env.MISTRAL_API_KEY,
          "https://api.mistral.ai/v1/chat/completions",
          "mistral-small-latest",
        )
      : null,
    process.env.DEEPSEEK_API_KEY
      ? makeOpenAiService(
          "deepseek",
          process.env.DEEPSEEK_API_KEY,
          "https://api.deepseek.com/chat/completions",
          "deepseek-chat",
        )
      : null,
    process.env.GROQ_API_KEY
      ? makeOpenAiService(
          "groq",
          process.env.GROQ_API_KEY,
          "https://api.groq.com/openai/v1/chat/completions",
          "llama-3.3-70b-versatile",
        )
      : null,
  ].filter(Boolean) as AiService[];
}

export async function callAi(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  lastAiProvider = "none";

  for (const service of getAiServices()) {
    try {
      const response = await fetch(service.url, {
        method: "POST",
        headers: service.headers,
        body: JSON.stringify(service.buildBody(systemPrompt, userPrompt)),
        signal: AbortSignal.timeout(4500),
      });

      if (!response.ok) {
        console.log(`${service.name} returned ${response.status}, trying next`);
        continue;
      }

      const data = await response.json();
      const content = service.extractContent(data);
      if (content) {
        lastAiProvider = service.name;
        console.log(`AOVBoost AI provider used: ${service.name}`);
        return content;
      }
    } catch (error) {
      console.log(
        `${service.name} skipped:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return null;
}

export async function* streamOpenAIChat(
  messages: { role: string; content: string }[],
  config: { apiKey: string; url: string; model: string },
): AsyncGenerator<string> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: 1000,
      temperature: 0.35,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Chat stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const parsed = JSON.parse(line.slice(6));
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Malformed chunks are ignored so shoppers never see stream errors.
      }
    }
  }
}

export const STREAM_PROVIDERS = [
  {
    envKey: "MISTRAL_API_KEY",
    url: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-small-latest",
    name: "mistral" as const,
  },
  {
    envKey: "DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    name: "deepseek" as const,
  },
  {
    envKey: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    name: "groq" as const,
  },
];

export function parseAiJson<T>(raw: string | null): T | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export function getActiveProvider(): AiProvider {
  if (process.env.GOOGLE_API_KEY) return "gemini";
  if (process.env.MISTRAL_API_KEY) return "mistral";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GROQ_API_KEY) return "groq";
  return "none";
}

export function getLastAiProvider(): AiProvider {
  return lastAiProvider;
}
