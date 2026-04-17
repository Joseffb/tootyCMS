export const AI_ACTIONS = ["generate", "rewrite", "summarize", "classify"] as const;
export const AI_CONTEXT_SURFACES = ["editor_assist", "plugin_workspace", "api"] as const;
export const AI_DECISIONS = ["allow", "modify", "reject"] as const;
export const AI_TEXT_TOOL_APPLY_ACTIONS = ["replace_selection", "insert_below"] as const;
export const AI_TEXT_TOOL_SOURCES = ["selection", "content"] as const;

export type AiAction = (typeof AI_ACTIONS)[number];
export type AiContextSurface = (typeof AI_CONTEXT_SURFACES)[number];
export type AiDecision = (typeof AI_DECISIONS)[number];
export type AiTextToolApplyAction = (typeof AI_TEXT_TOOL_APPLY_ACTIONS)[number];
export type AiTextToolSource = (typeof AI_TEXT_TOOL_SOURCES)[number];

export type AiScope =
  | { kind: "site"; siteId: string }
  | { kind: "network" };

export type AiRunRequest = {
  scope: AiScope;
  action: AiAction;
  input: {
    sourceText: string;
    instructionText?: string;
    contextText?: string;
  };
  context: {
    surface: AiContextSurface;
    pluginId?: string;
    postId?: string;
    dataDomainKey?: string;
  };
  providerId?: string;
};

export type AiRunSuccessResult = {
  ok: true;
  decision: AiDecision;
  output?: {
    kind: "text";
    text: string;
  };
  providerId: string;
  model: string;
  traceId: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  policyFlags?: string[];
};

export type AiRunFailureResult = {
  ok: false;
  error: string;
  traceId: string;
};

export type AiRunResult = AiRunSuccessResult | AiRunFailureResult;

export type AiProviderExecutionInput = {
  action: AiAction;
  sourceText: string;
  instructionText?: string;
  contextText?: string;
  maxOutputChars: number;
  model: string;
  traceId: string;
};

export type AiProviderExecutionResult =
  | {
      ok: true;
      outputText: string;
      model: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
      metadata?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      metadata?: Record<string, unknown>;
    };

export type AiProviderRegistration = {
  id: string;
  actions: AiAction[];
  run: (input: AiProviderExecutionInput) => Promise<AiProviderExecutionResult>;
  healthCheck?: () => Promise<{ ok: boolean; error?: string }>;
};

export type AiProviderDescriptor = AiProviderRegistration & {
  ownerType: "core" | "plugin";
  ownerId: string;
};

export function normalizeAiAction(value: unknown): AiAction | null {
  const normalized = String(value || "").trim().toLowerCase();
  return (AI_ACTIONS as readonly string[]).includes(normalized) ? (normalized as AiAction) : null;
}

export function normalizeAiContextSurface(value: unknown): AiContextSurface | null {
  const normalized = String(value || "").trim().toLowerCase();
  return (AI_CONTEXT_SURFACES as readonly string[]).includes(normalized)
    ? (normalized as AiContextSurface)
    : null;
}
