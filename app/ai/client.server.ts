export type AiProvider = "gemini" | "groq" | "mistral" | "deepseek" | "none";

export type AiGatewayRequest = {
  triggerName: string;
  systemPrompt: string;
  userPrompt: string;
  schemaType?: "json" | "text";
  maxTokens?: number;
  timeoutProfile?: "urgent" | "normal" | "relaxed";
  fallback?: string;
};

export type AiGatewayResult = {
  content: string | null;
  provider: AiProvider;
  executionMs: number;
  fallbackUsed: boolean;
  errors: Array<{ provider: string; message: string }>;
};

type AiService = {
  name: Exclude<AiProvider, "none">;
  url: string;
  headers: Record<string, string>;
  buildBody: (request: AiGatewayRequest) => unknown;
  extractContent: (data: any) => string | null;
};

let lastAiProvider: AiProvider = "none";

const MODEL_COOLDOWN_MS = 30_000;
const modelHealth = new Map<Exclude<AiProvider, "none">, { downUntil: number }>();

const TIMEOUT_MS = {
  urgent: Number(process.env.AOVBOOST_AI_TIMEOUT_URGENT_MS || 2500),
  normal: Number(process.env.AOVBOOST_AI_TIMEOUT_NORMAL_MS || 3500),
  relaxed: Number(process.env.AOVBOOST_AI_TIMEOUT_RELAXED_MS || 5800),
};

const TOTAL_TIMEOUT_MS = {
  urgent: Number(process.env.AOVBOOST_AI_TOTAL_TIMEOUT_URGENT_MS || 4800),
  normal: Number(process.env.AOVBOOST_AI_TOTAL_TIMEOUT_NORMAL_MS || 5000),
  relaxed: Number(process.env.AOVBOOST_AI_TOTAL_TIMEOUT_RELAXED_MS || 8000),
};

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
    buildBody: (request) => ({
      model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_tokens: request.maxTokens || 400,
      temperature: 0,
      response_format:
        request.schemaType === "json" ? { type: "json_object" } : undefined,
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
          buildBody: (request: AiGatewayRequest) => ({
            contents: [
              {
                parts: [{ text: `${request.systemPrompt}\n\n${request.userPrompt}` }],
              },
            ],
            generationConfig: {
              maxOutputTokens: request.maxTokens || 400,
              temperature: 0,
              responseMimeType:
                request.schemaType === "json" ? "application/json" : undefined,
            },
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
    process.env.GROQ_API_KEY
      ? makeOpenAiService(
          "groq",
          process.env.GROQ_API_KEY,
          "https://api.groq.com/openai/v1/chat/completions",
          "llama-3.3-70b-versatile",
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
  ].filter(Boolean) as AiService[];
}

export async function callAi(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const result = await callAI({
    triggerName: "legacy",
    systemPrompt,
    userPrompt,
    schemaType: "text",
    maxTokens: 400,
    timeoutProfile: "normal",
  });
  return result.content;
}

export async function callAI(request: AiGatewayRequest): Promise<AiGatewayResult> {
  const startedAt = Date.now();
  const errors: AiGatewayResult["errors"] = [];
  const timeoutProfile = request.timeoutProfile || "normal";
  const timeoutMs = getTimeoutMs(timeoutProfile);
  const deadlineAt = startedAt + getTotalTimeoutMs(timeoutProfile);
  lastAiProvider = "none";

  for (const service of getAvailableServices()) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 200) {
      errors.push({ provider: service.name, message: "Gateway deadline reached" });
      break;
    }

    try {
      const response = await fetch(service.url, {
        method: "POST",
        headers: service.headers,
        body: JSON.stringify(service.buildBody(request)),
        signal: AbortSignal.timeout(Math.min(timeoutMs, remainingMs)),
      });

      if (!response.ok) {
        const message = `HTTP ${response.status}`;
        errors.push({ provider: service.name, message });
        markModelDown(service.name);
        logGatewayAttempt(request, service.name, startedAt, false, message);
        continue;
      }

      const data = await response.json();
      const content = service.extractContent(data);
      if (content) {
        lastAiProvider = service.name;
        markModelUp(service.name);
        logGatewayAttempt(request, service.name, startedAt, true);
        return {
          content,
          provider: service.name,
          executionMs: Date.now() - startedAt,
          fallbackUsed: false,
          errors,
        };
      }

      const message = "Empty model response";
      errors.push({ provider: service.name, message });
      markModelDown(service.name);
      logGatewayAttempt(request, service.name, startedAt, false, message);
    } catch (error) {
      const message = getErrorMessage(error);
      errors.push({ provider: service.name, message });
      markModelDown(service.name);
      logGatewayAttempt(request, service.name, startedAt, false, message);
    }
  }

  const fallback = request.fallback ?? getGatewayFallback(
    request.triggerName,
    request.schemaType,
  );
  console.warn("AOVBoost AI gateway fallback used:", {
    triggerName: request.triggerName,
    executionMs: Date.now() - startedAt,
    errors,
  });

  return {
    content: fallback,
    provider: "none",
    executionMs: Date.now() - startedAt,
    fallbackUsed: true,
    errors,
  };
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
  if (process.env.MISTRAL_API_KEY) return "mistral";
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  return "none";
}

export function getLastAiProvider(): AiProvider {
  return lastAiProvider;
}

function getAvailableServices() {
  const now = Date.now();
  return getAiServices().filter((service) => {
    const health = modelHealth.get(service.name);
    return !health || health.downUntil <= now;
  });
}

function markModelDown(provider: Exclude<AiProvider, "none">) {
  modelHealth.set(provider, { downUntil: Date.now() + MODEL_COOLDOWN_MS });
}

function markModelUp(provider: Exclude<AiProvider, "none">) {
  modelHealth.delete(provider);
}

function getTimeoutMs(profile: NonNullable<AiGatewayRequest["timeoutProfile"]>) {
  const timeout = TIMEOUT_MS[profile];
  return Number.isFinite(timeout) && timeout > 0 ? timeout : TIMEOUT_MS.normal;
}

function getTotalTimeoutMs(profile: NonNullable<AiGatewayRequest["timeoutProfile"]>) {
  const timeout = TOTAL_TIMEOUT_MS[profile];
  return Number.isFinite(timeout) && timeout > 0 ? timeout : TOTAL_TIMEOUT_MS.normal;
}

function getGatewayFallback(triggerName: string, schemaType?: "json" | "text") {
  if (schemaType !== "json") {
    return "I can help compare products and find the right add-ons.";
  }

  if (triggerName === "exit_intent") {
    return JSON.stringify({
      headline: "Wait before you go",
      subtext: "Your cart may qualify for a limited offer.",
      promoCode: null,
      ctaLabel: "Review cart",
      expiryMinutes: 10,
    });
  }
  if (triggerName === "cart_item_added" || triggerName === "add_to_cart") {
    return JSON.stringify({
      headline: "Complete the set",
      products: [],
      bundleLabel: "Recommended add-ons",
    });
  }
  if (triggerName === "price_sensitive_chat" || triggerName === "price_hesitation") {
    return JSON.stringify({
      hesitationDetected: true,
      discountCode: null,
      message: "I can help find a lower-priced alternative from this store.",
    });
  }

  return JSON.stringify({
    widgetType: null,
    payload: {},
    reasoning: "AI unavailable; no intervention shown.",
    confidence: 0,
  });
}

function logGatewayAttempt(
  request: AiGatewayRequest,
  provider: AiProvider,
  startedAt: number,
  ok: boolean,
  error?: string,
) {
  const payload = {
    triggerName: request.triggerName,
    provider,
    ok,
    executionMs: Date.now() - startedAt,
    schemaType: request.schemaType || "text",
    error,
  };
  if (ok) {
    console.log("AOVBoost AI gateway success:", payload);
  } else {
    console.warn("AOVBoost AI gateway attempt failed:", payload);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
