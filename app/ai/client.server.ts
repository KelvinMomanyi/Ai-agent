export type AiProvider = "gemini" | "groq" | "none";

type AiService = {
  name: Exclude<AiProvider, "none">;
  url: string;
  headers: Record<string, string>;
  buildBody: (systemPrompt: string, userPrompt: string) => unknown;
  extractContent: (data: any) => string | null;
};

let lastAiProvider: AiProvider = "none";

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
    process.env.GROQ_API_KEY
      ? {
          name: "groq" as const,
          url: "https://api.groq.com/openai/v1/chat/completions",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          buildBody: (systemPrompt: string, userPrompt: string) => ({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 1000,
            temperature: 0,
          }),
          extractContent: (data: any) =>
            data.choices?.[0]?.message?.content ?? null,
        }
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

export async function* streamGroqChat(
  messages: { role: string; content: string }[],
): AsyncGenerator<string> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key is not configured");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 1000,
      temperature: 0.35,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Groq stream failed: ${response.status}`);
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
  if (process.env.GROQ_API_KEY) return "groq";
  return "none";
}

export function getLastAiProvider(): AiProvider {
  return lastAiProvider;
}
