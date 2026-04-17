import {
  AI_ACTIONS,
  type AiAction,
  type AiProviderExecutionInput,
  type AiProviderExecutionResult,
  type AiProviderRegistration,
} from "@/lib/ai-contracts";

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_API_VERSION = "2023-06-01";

function defaultModelForProvider(providerId: string) {
  if (providerId === "anthropic") {
    return (process.env.ANTHROPIC_MODEL || "").trim() || DEFAULT_ANTHROPIC_MODEL;
  }
  return (process.env.OPENAI_MODEL || "").trim() || DEFAULT_OPENAI_MODEL;
}

function approximateMaxTokens(maxOutputChars: number) {
  const normalized = Number.isFinite(maxOutputChars) ? Math.max(1, Math.trunc(maxOutputChars)) : 1_024;
  return Math.max(32, Math.min(4_096, Math.ceil(normalized / 4)));
}

function buildSystemPrompt(action: AiAction, maxOutputChars: number) {
  const actionLine =
    action === "rewrite"
      ? "Rewrite the provided text according to the instruction."
      : action === "summarize"
        ? "Summarize the provided text according to the instruction."
        : action === "classify"
          ? "Classify the provided text according to the instruction."
          : "Generate text according to the instruction.";
  return [
    "You are a provider adapter for a governed CMS AI spine.",
    actionLine,
    "Return plain text only.",
    "Do not include markdown fences, labels, or explanations.",
    `Keep the final output at or below ${maxOutputChars} characters when possible.`,
  ].join(" ");
}

function buildUserPrompt(input: AiProviderExecutionInput) {
  return [
    `Action: ${input.action}`,
    input.instructionText ? `Instruction:\n${input.instructionText}` : "",
    input.contextText ? `Context:\n${input.contextText}` : "",
    `Source:\n${input.sourceText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function readOpenAiOutputText(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry: any) => {
        if (!entry || typeof entry !== "object") return "";
        if (typeof entry.text === "string") return entry.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function readAnthropicOutputText(payload: any) {
  const content = Array.isArray(payload?.content) ? payload.content : [];
  return content
    .map((entry: any) => {
      if (!entry || typeof entry !== "object") return "";
      return typeof entry.text === "string" ? entry.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function runOpenAi(input: AiProviderExecutionInput): Promise<AiProviderExecutionResult> {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not configured." };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || defaultModelForProvider("openai"),
      temperature: 0.2,
      max_tokens: approximateMaxTokens(input.maxOutputChars),
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(input.action, input.maxOutputChars),
        },
        {
          role: "user",
          content: buildUserPrompt(input),
        },
      ],
    }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      error: String(payload?.error?.message || payload?.raw || `OpenAI request failed with status ${response.status}.`),
      metadata: payload,
    };
  }

  const outputText = readOpenAiOutputText(payload);
  return {
    ok: true,
    outputText,
    model: String(payload?.model || input.model || defaultModelForProvider("openai")),
    usage: {
      inputTokens: Number(payload?.usage?.prompt_tokens || 0) || undefined,
      outputTokens: Number(payload?.usage?.completion_tokens || 0) || undefined,
      totalTokens: Number(payload?.usage?.total_tokens || 0) || undefined,
    },
    metadata: payload,
  };
}

async function runAnthropic(input: AiProviderExecutionInput): Promise<AiProviderExecutionResult> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || defaultModelForProvider("anthropic"),
      max_tokens: approximateMaxTokens(input.maxOutputChars),
      system: buildSystemPrompt(input.action, input.maxOutputChars),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(input),
        },
      ],
    }),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return {
      ok: false,
      error: String(payload?.error?.message || payload?.raw || `Anthropic request failed with status ${response.status}.`),
      metadata: payload,
    };
  }

  const outputText = readAnthropicOutputText(payload);
  const inputTokens = Number(payload?.usage?.input_tokens || 0) || undefined;
  const outputTokens = Number(payload?.usage?.output_tokens || 0) || undefined;
  return {
    ok: true,
    outputText,
    model: String(payload?.model || input.model || defaultModelForProvider("anthropic")),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens === undefined && outputTokens === undefined
          ? undefined
          : (inputTokens || 0) + (outputTokens || 0),
    },
    metadata: payload,
  };
}

export function createOpenAiProvider(): AiProviderRegistration {
  return {
    id: "openai",
    actions: [...AI_ACTIONS],
    run: runOpenAi,
    async healthCheck() {
      const apiKey = (process.env.OPENAI_API_KEY || "").trim();
      if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured." };
      return { ok: true };
    },
  };
}

export function createAnthropicProvider(): AiProviderRegistration {
  return {
    id: "anthropic",
    actions: [...AI_ACTIONS],
    run: runAnthropic,
    async healthCheck() {
      const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
      if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not configured." };
      return { ok: true };
    },
  };
}

export function resolveDefaultModel(providerId: string) {
  return defaultModelForProvider(String(providerId || "").trim().toLowerCase());
}

export function registerBuiltInAiProviders(registry: {
  registerCoreAiProvider: (registration: AiProviderRegistration) => void;
}) {
  for (const provider of [createOpenAiProvider(), createAnthropicProvider()]) {
    registry.registerCoreAiProvider(provider);
  }
}
