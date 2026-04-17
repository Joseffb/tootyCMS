import { kv } from "@vercel/kv";
import {
  normalizeAiAction,
  normalizeAiContextSurface,
  type AiDecision,
  type AiProviderDescriptor,
  type AiRunRequest,
  type AiRunResult,
  type AiScope,
} from "@/lib/ai-contracts";
import { trace } from "@/lib/debug";
import { userCan } from "@/lib/authorization";
import { resolveDefaultModel } from "@/lib/ai-providers";

const DEFAULT_AI_INPUT_MAX_CHARS = 20_000;
const DEFAULT_AI_OUTPUT_MAX_CHARS = 5_000;
const DEFAULT_AI_SITE_DAILY_LIMIT = 200;
const DEFAULT_AI_NETWORK_DAILY_LIMIT = 50;

type NormalizedAiRunRequest = AiRunRequest & {
  providerId?: string;
  input: {
    sourceText: string;
    instructionText?: string;
    contextText?: string;
  };
  context: {
    surface: "editor_assist" | "plugin_workspace" | "api";
    pluginId?: string;
    postId?: string;
    dataDomainKey?: string;
  };
};

type RunAiRequestOptions = {
  request: unknown;
  actorUserId: string;
  providers: AiProviderDescriptor[];
  traceId?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function createTraceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readIntegerEnv(key: string, fallback: number) {
  const value = Number.parseInt(String(process.env[key] || "").trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getQuotaMode() {
  const mode = cleanString(process.env.AI_QUOTA_MODE).toLowerCase();
  return mode === "kv_daily" ? "kv_daily" : "none";
}

function getAiInputMaxChars() {
  return readIntegerEnv("AI_INPUT_MAX_CHARS", DEFAULT_AI_INPUT_MAX_CHARS);
}

function getAiOutputMaxChars() {
  return readIntegerEnv("AI_OUTPUT_MAX_CHARS", DEFAULT_AI_OUTPUT_MAX_CHARS);
}

function getDailyLimit(scope: AiScope) {
  return scope.kind === "network"
    ? readIntegerEnv("AI_KV_DAILY_LIMIT_NETWORK", DEFAULT_AI_NETWORK_DAILY_LIMIT)
    : readIntegerEnv("AI_KV_DAILY_LIMIT_SITE", DEFAULT_AI_SITE_DAILY_LIMIT);
}

function normalizeScope(raw: unknown): AiScope | null {
  const candidate = asRecord(raw);
  const kind = cleanString(candidate.kind).toLowerCase();
  if (kind === "site") {
    const siteId = cleanString(candidate.siteId);
    if (!siteId) return null;
    return { kind: "site", siteId };
  }
  if (kind === "network") {
    if (cleanString(candidate.siteId)) return null;
    return { kind: "network" };
  }
  return null;
}

function normalizeAiRunRequest(raw: unknown): { ok: true; request: NormalizedAiRunRequest } | { ok: false; error: string } {
  const candidate = asRecord(raw);
  if (!candidate || Object.keys(candidate).length === 0) {
    return { ok: false, error: "AI request body is required." };
  }
  for (const forbiddenKey of ["messages", "model", "stream", "max_tokens", "max_completion_tokens", "temperature"]) {
    if (forbiddenKey in candidate) {
      return { ok: false, error: `Provider-shaped field "${forbiddenKey}" is not allowed in ai.run().` };
    }
  }

  const scope = normalizeScope(candidate.scope);
  if (!scope) {
    return { ok: false, error: "AI requests require an explicit scope." };
  }

  const action = normalizeAiAction(candidate.action);
  if (!action) {
    return { ok: false, error: "AI action must be one of generate, rewrite, summarize, or classify." };
  }

  const input = asRecord(candidate.input);
  const context = asRecord(candidate.context);
  const sourceText = cleanString(input.sourceText);
  if (!sourceText) {
    return { ok: false, error: "input.sourceText is required." };
  }

  const surface = normalizeAiContextSurface(context.surface);
  if (!surface) {
    return { ok: false, error: "context.surface must be editor_assist, plugin_workspace, or api." };
  }

  return {
    ok: true,
    request: {
      scope,
      action,
      input: {
        sourceText,
        instructionText: cleanString(input.instructionText) || undefined,
        contextText: cleanString(input.contextText) || undefined,
      },
      context: {
        surface,
        pluginId: cleanString(context.pluginId) || undefined,
        postId: cleanString(context.postId) || undefined,
        dataDomainKey: cleanString(context.dataDomainKey).toLowerCase() || undefined,
      },
      providerId: cleanString(candidate.providerId).toLowerCase() || undefined,
    },
  };
}

function totalInputChars(request: NormalizedAiRunRequest) {
  return (
    request.input.sourceText.length +
    (request.input.instructionText?.length || 0) +
    (request.input.contextText?.length || 0)
  );
}

async function authorizeRequest(userId: string, request: NormalizedAiRunRequest) {
  if (request.scope.kind === "network") {
    return userCan("network.ai.use", userId);
  }
  return userCan("site.ai.use", userId, { siteId: request.scope.siteId });
}

async function enforceQuota(userId: string, scope: AiScope, traceId: string) {
  const mode = getQuotaMode();
  if (mode === "none") {
    trace("ai", "quota decision", {
      traceId,
      scopeKind: scope.kind,
      scopeId: scope.kind === "site" ? scope.siteId : "network",
      mode,
      allowed: true,
    });
    return { ok: true as const };
  }

  if (!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)) {
    trace("ai", "quota decision", {
      traceId,
      scopeKind: scope.kind,
      scopeId: scope.kind === "site" ? scope.siteId : "network",
      mode,
      allowed: false,
      reason: "kv-unavailable",
    });
    return { ok: false as const, error: "AI kv_daily quota mode requires KV_REST_API_URL and KV_REST_API_TOKEN." };
  }

  const dateKey = new Date().toISOString().slice(0, 10);
  const scopeId = scope.kind === "site" ? scope.siteId : "network";
  const limit = getDailyLimit(scope);
  const key = `ai:quota:${scope.kind}:${scopeId}:${userId}:${dateKey}`;
  const count = await kv.incr(key);
  if (count === 1) {
    await kv.expire(key, 60 * 60 * 48);
  }
  const allowed = count <= limit;
  trace("ai", "quota decision", {
    traceId,
    scopeKind: scope.kind,
    scopeId,
    mode,
    allowed,
    count,
    limit,
  });

  if (!allowed) {
    return { ok: false as const, error: "Daily AI quota exceeded for the current scope." };
  }

  return { ok: true as const };
}

function selectProvider(request: NormalizedAiRunRequest, providers: AiProviderDescriptor[]) {
  const explicitProviderId = cleanString(request.providerId).toLowerCase();
  const configuredDefault = cleanString(process.env.AI_DEFAULT_PROVIDER).toLowerCase();
  const providerId = explicitProviderId || configuredDefault;
  if (!providerId) {
    return { ok: false as const, error: "No AI provider is configured.", provider: null };
  }
  const provider = providers.find((entry) => entry.id === providerId) || null;
  if (!provider) {
    return { ok: false as const, error: `Unknown AI provider "${providerId}".`, provider: null };
  }
  if (!provider.actions.includes(request.action)) {
    return { ok: false as const, error: `Provider "${providerId}" does not support action "${request.action}".`, provider: null };
  }
  return { ok: true as const, providerId, provider };
}

function summarizeRequestForTrace(request: NormalizedAiRunRequest) {
  return {
    action: request.action,
    scopeKind: request.scope.kind,
    scopeId: request.scope.kind === "site" ? request.scope.siteId : "network",
    surface: request.context.surface,
    pluginId: request.context.pluginId,
    postId: request.context.postId,
    dataDomainKey: request.context.dataDomainKey,
    inputChars: totalInputChars(request),
    sourceChars: request.input.sourceText.length,
    instructionChars: request.input.instructionText?.length || 0,
    contextChars: request.input.contextText?.length || 0,
    providerId: request.providerId || cleanString(process.env.AI_DEFAULT_PROVIDER).toLowerCase() || null,
  };
}

function sanitizeOutput(text: string, maxOutputChars: number) {
  const policyFlags: string[] = [];
  const cleaned = String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  let nextText = cleaned;
  let decision: AiDecision = "allow";
  if (nextText !== text.trim()) {
    decision = "modify";
    policyFlags.push("output_sanitized");
  }
  if (nextText.length > maxOutputChars) {
    nextText = nextText.slice(0, maxOutputChars).trim();
    decision = "modify";
    policyFlags.push("output_truncated");
  }
  if (!nextText) {
    return { decision: "reject" as const, text: "", policyFlags: [...policyFlags, "empty_output"] };
  }
  return { decision, text: nextText, policyFlags };
}

export async function runAiRequest(options: RunAiRequestOptions): Promise<AiRunResult> {
  const traceId = cleanString(options.traceId) || createTraceId();
  trace("ai", "run begin", { traceId });

  const normalized = normalizeAiRunRequest(options.request);
  if (!normalized.ok) {
    trace("ai", "run failure", { traceId, stage: "normalize", error: normalized.error });
    return { ok: false, error: normalized.error, traceId };
  }

  const request = normalized.request;
  trace("ai", "normalized request", { traceId, ...summarizeRequestForTrace(request) });

  const inputChars = totalInputChars(request);
  const maxInputChars = getAiInputMaxChars();
  if (inputChars > maxInputChars) {
    trace("ai", "run failure", {
      traceId,
      stage: "input_limit",
      inputChars,
      maxInputChars,
    });
    return { ok: false, error: `AI input exceeds the ${maxInputChars} character limit.`, traceId };
  }

  const allowed = await authorizeRequest(options.actorUserId, request);
  if (!allowed) {
    trace("ai", "run failure", {
      traceId,
      stage: "authorization",
      scopeKind: request.scope.kind,
      scopeId: request.scope.kind === "site" ? request.scope.siteId : "network",
      userId: options.actorUserId,
    });
    return { ok: false, error: "You do not have permission to use AI for this scope.", traceId };
  }

  const quota = await enforceQuota(options.actorUserId, request.scope, traceId);
  if (!quota.ok) {
    trace("ai", "run failure", { traceId, stage: "quota", error: quota.error });
    return { ok: false, error: quota.error, traceId };
  }

  const selection = selectProvider(request, options.providers);
  if (!selection.ok || !selection.provider) {
    trace("ai", "run failure", {
      traceId,
      stage: "provider_resolve",
      error: selection.error,
    });
    return { ok: false, error: selection.error, traceId };
  }

  const provider = selection.provider;
  const model = resolveDefaultModel(provider.id);
  trace("ai", "provider begin", {
    traceId,
    providerId: provider.id,
    ownerType: provider.ownerType,
    ownerId: provider.ownerId,
    model,
    action: request.action,
  });

  let providerResult;
  try {
    providerResult = await provider.run({
      action: request.action,
      sourceText: request.input.sourceText,
      instructionText: request.input.instructionText,
      contextText: request.input.contextText,
      maxOutputChars: getAiOutputMaxChars(),
      model,
      traceId,
    });
  } catch (error) {
    const providerError = error instanceof Error ? error.message : String(error);
    trace("ai", "provider end", {
      traceId,
      providerId: provider.id,
      ok: false,
      threw: true,
      error: providerError,
    });
    trace("ai", "run failure", {
      traceId,
      stage: "provider",
      providerId: provider.id,
      error: providerError,
    });
    return { ok: false, error: `AI provider request failed: ${providerError}`, traceId };
  }

  trace("ai", "provider end", {
    traceId,
    providerId: provider.id,
    ok: providerResult.ok,
    outputChars: providerResult.ok ? providerResult.outputText.length : 0,
    usage: providerResult.ok ? providerResult.usage : undefined,
  });

  if (!providerResult.ok) {
    trace("ai", "run failure", {
      traceId,
      stage: "provider",
      providerId: provider.id,
      error: providerResult.error,
    });
    return { ok: false, error: providerResult.error, traceId };
  }

  const guarded = sanitizeOutput(providerResult.outputText, getAiOutputMaxChars());
  trace("ai", "guard decision", {
    traceId,
    providerId: provider.id,
    decision: guarded.decision,
    policyFlags: guarded.policyFlags,
    outputChars: guarded.text.length,
  });

  const result: AiRunResult =
    guarded.decision === "reject"
      ? {
          ok: true,
          decision: "reject",
          providerId: provider.id,
          model: providerResult.model || model,
          traceId,
          usage: providerResult.usage,
          policyFlags: guarded.policyFlags,
        }
      : {
          ok: true,
          decision: guarded.decision,
          output: {
            kind: "text",
            text: guarded.text,
          },
          providerId: provider.id,
          model: providerResult.model || model,
          traceId,
          usage: providerResult.usage,
          policyFlags: guarded.policyFlags.length > 0 ? guarded.policyFlags : undefined,
        };

  trace("ai", "run end", {
    traceId,
    ok: result.ok,
    decision: result.ok ? result.decision : undefined,
    providerId: result.ok ? result.providerId : undefined,
  });
  return result;
}
