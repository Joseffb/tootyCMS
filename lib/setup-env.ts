import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { trace } from "@/lib/debug";

export type SetupEnvField = {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "password" | "url";
  helpText?: string;
};

export type SetupWizardSeed = {
  initialValues: Record<string, string>;
  configuredPasswordKeys: string[];
};

export const SETUP_ENV_FIELDS: SetupEnvField[] = [
  {
    key: "NEXTAUTH_URL",
    label: "NextAuth URL",
    required: true,
    placeholder: "https://app.example.com",
    type: "url",
    helpText: "Canonical auth callback URL. Needed so login redirects and provider callbacks resolve correctly.",
  },
  {
    key: "NEXT_PUBLIC_ROOT_DOMAIN",
    label: "Root Domain",
    required: true,
    placeholder: "fernain.com",
    helpText: "Base domain used for tenant routing and canonical links across the CMS.",
  },
  {
    key: "CMS_DB_PREFIX",
    label: "Database Table Prefix",
    required: true,
    placeholder: "fernain_",
    helpText: "Namespace prefix for all CMS tables. Prevents collisions when sharing a database.",
  },
  {
    key: "THEMES_PATH",
    label: "Themes Path(s)",
    placeholder: "themes,/abs/path/tootyCMS-themes",
    helpText: "Comma-separated theme discovery paths. Lets you load local and external theme repos.",
  },
  {
    key: "PLUGINS_PATH",
    label: "Plugins Path(s)",
    placeholder: "plugins,/abs/path/tootyCMS-plugins",
    helpText: "Comma-separated plugin discovery paths. Lets you load local and external plugin repos.",
  },
  {
    key: "POSTGRES_URL",
    label: "Postgres URL",
    required: true,
    type: "password",
    helpText: "Primary database connection string used by Drizzle and runtime queries.",
  },
  {
    key: "POSTGRES_TEST_URL",
    label: "Postgres Test URL",
    type: "password",
    helpText:
      "Optional dedicated test database URL for integration/e2e. If empty, tests use POSTGRES_URL.",
  },
  {
    key: "NEXTAUTH_SECRET",
    label: "NextAuth Secret",
    required: true,
    type: "password",
    helpText: "Session/signing secret for auth tokens and cookie integrity.",
  },
  {
    key: "AUTH_GITHUB_ID",
    label: "GitHub OAuth Client ID",
    helpText: "GitHub OAuth app client ID. Required only if GitHub auth plugin is enabled.",
  },
  {
    key: "AUTH_GITHUB_SECRET",
    label: "GitHub OAuth Client Secret",
    type: "password",
    helpText: "GitHub OAuth app secret paired with the client ID.",
  },
  {
    key: "AUTH_GOOGLE_ID",
    label: "Google OAuth Client ID",
    helpText: "Google OAuth client ID. Required only when Google auth plugin is enabled.",
  },
  {
    key: "AUTH_GOOGLE_SECRET",
    label: "Google OAuth Client Secret",
    type: "password",
    helpText: "Google OAuth client secret paired with the client ID.",
  },
  {
    key: "AUTH_FACEBOOK_ID",
    label: "Facebook OAuth Client ID",
    helpText: "Facebook app client ID. Required only when Facebook auth plugin is enabled.",
  },
  {
    key: "AUTH_FACEBOOK_SECRET",
    label: "Facebook OAuth Client Secret",
    type: "password",
    helpText: "Facebook app secret paired with the client ID.",
  },
  {
    key: "AUTH_APPLE_ID",
    label: "Apple OAuth Client ID",
    helpText: "Apple service/client identifier. Required only when Apple auth plugin is enabled.",
  },
  {
    key: "AUTH_APPLE_SECRET",
    label: "Apple OAuth Client Secret",
    type: "password",
    helpText: "Apple private key/token secret used for OAuth exchange.",
  },
  {
    key: "AUTH_BEARER_TOKEN",
    label: "Vercel Auth Bearer Token",
    type: "password",
    helpText: "Token used to write environment values through Vercel API during setup.",
  },
  {
    key: "PROJECT_ID_VERCEL",
    label: "Vercel Project ID",
    helpText: "Target Vercel project for env synchronization and setup automation.",
  },
  {
    key: "TEAM_ID_VERCEL",
    label: "Vercel Team ID",
    helpText: "Optional team scope for Vercel API calls when project is owned by a team.",
  },
  {
    key: "BLOB_READ_WRITE_TOKEN",
    label: "Vercel Blob Read/Write Token",
    type: "password",
    helpText: "Credential for media/file storage using Vercel Blob provider.",
  },
  {
    key: "AWS_REGION",
    label: "AWS Region",
    helpText: "AWS region for S3-backed media storage.",
  },
  {
    key: "AWS_ACCESS_KEY_ID",
    label: "AWS Access Key ID",
    helpText: "AWS credential ID used by S3 media provider.",
  },
  {
    key: "AWS_SECRET_ACCESS_KEY",
    label: "AWS Secret Access Key",
    type: "password",
    helpText: "AWS secret key paired with access key ID.",
  },
  {
    key: "AWS_S3_BUCKET",
    label: "AWS S3 Bucket",
    helpText: "S3 bucket name used by the media pipeline.",
  },
  {
    key: "MEDIA_UPLOAD_PROVIDER",
    label: "Media Upload Provider",
    placeholder: "auto",
    helpText: "Upload provider mode: auto | blob | s3 | dbblob.",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI API Key",
    type: "password",
    helpText: "Key for AI-powered features that call OpenAI APIs.",
  },
  {
    key: "OPENAI_MODEL",
    label: "OpenAI Model",
    placeholder: "gpt-4o-mini",
    helpText: "Default OpenAI model for the governed AI spine.",
  },
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    type: "password",
    helpText: "Key for AI-powered features that call Anthropic APIs.",
  },
  {
    key: "ANTHROPIC_MODEL",
    label: "Anthropic Model",
    placeholder: "claude-sonnet-4-20250514",
    helpText: "Default Anthropic model for the governed AI spine.",
  },
  {
    key: "AI_DEFAULT_PROVIDER",
    label: "AI Default Provider",
    placeholder: "openai",
    helpText: "Default AI provider id used when a request does not specify one.",
  },
  {
    key: "AI_QUOTA_MODE",
    label: "AI Quota Mode",
    placeholder: "none",
    helpText: "Quota mode for the AI spine: none or kv_daily.",
  },
  {
    key: "AI_INPUT_MAX_CHARS",
    label: "AI Input Max Characters",
    placeholder: "20000",
    helpText: "Maximum normalized input size allowed before the provider call.",
  },
  {
    key: "AI_OUTPUT_MAX_CHARS",
    label: "AI Output Max Characters",
    placeholder: "5000",
    helpText: "Maximum output size returned from the AI spine.",
  },
  {
    key: "AI_KV_DAILY_LIMIT_SITE",
    label: "AI Daily Site Limit",
    placeholder: "200",
    helpText: "Per-user daily site-scoped AI run limit when kv_daily quotas are enabled.",
  },
  {
    key: "AI_KV_DAILY_LIMIT_NETWORK",
    label: "AI Daily Network Limit",
    placeholder: "50",
    helpText: "Per-user daily network-scoped AI run limit when kv_daily quotas are enabled.",
  },
  {
    key: "DEBUG_MODE",
    label: "Debug Mode (true/false)",
    placeholder: "false",
    helpText: "Enables verbose diagnostics and trace output in runtime.",
  },
  {
    key: "TRACE_PROFILE",
    label: "Trace Profile (Test/Dev/Prod)",
    placeholder: "Dev",
    helpText: "Controls trace verbosity/profile formatting for observability output.",
  },
  {
    key: "TRACE_LOG_DIR",
    label: "Trace Log Directory",
    placeholder: "logs/traces",
    helpText: "Filesystem path where JSONL trace logs are written.",
  },
  {
    key: "TRACE_RETENTION_DAYS",
    label: "Trace Retention Days",
    placeholder: "14",
    helpText: "How many days of JSONL trace files to keep before pruning.",
  },
  {
    key: "TRACE_MAX_FILES",
    label: "Trace Max Files",
    placeholder: "60",
    helpText: "Max number of trace files retained in trace log directory.",
  },
  {
    key: "NO_IMAGE_MODE",
    label: "No Image Mode (true/false)",
    placeholder: "false",
    helpText: "Disables image workflows when media pipeline/providers are unavailable.",
  },
  {
    key: "NEXT_PUBLIC_VERCEL_DEPLOYMENT_SUFFIX",
    label: "Vercel Deployment Suffix",
    placeholder: "vercel.app",
    helpText: "Hostname suffix used to normalize and route Vercel preview domains.",
  },
];

const ALLOWED_KEYS = new Set(SETUP_ENV_FIELDS.map((field) => field.key));
const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_URL);
const isManagedRuntime = Boolean(
  isVercelRuntime ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.AWS_EXECUTION_ENV ||
  process.env.NETLIFY ||
  process.env.CF_PAGES ||
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RENDER ||
  process.env.FLY_APP_NAME,
);
type EnvBackend = "local" | "vercel" | "lambda" | "runtime";

export type SetupEnvPersistenceResult = {
  backend: EnvBackend;
  persisted: boolean;
};

export class SetupEnvPersistenceError extends Error {
  status = 409;
  code = "SETUP_ENV_PERSISTENCE_FAILED";
}

function parseEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    values[key] = value;
  }
  return values;
}

function formatEnvValue(value: string): string {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:@?&=+,-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function normalizeRuntimeEnvValue(key: string) {
  return String(process.env[key] || "").trim();
}

function isSensitiveSetupField(field: SetupEnvField) {
  return field.type === "password";
}

function getRequiredSetupKeys() {
  return SETUP_ENV_FIELDS.filter((field) => field.required).map((field) => field.key);
}

function getManagedRuntimeEnvDiff(payload: Record<string, string>) {
  const missingRequired: string[] = [];
  const missingSubmitted: string[] = [];
  const mismatchedSubmitted: string[] = [];

  for (const key of getRequiredSetupKeys()) {
    if (!normalizeRuntimeEnvValue(key)) missingRequired.push(key);
  }

  for (const field of SETUP_ENV_FIELDS) {
    if (!ALLOWED_KEYS.has(field.key)) continue;
    const requestedValue = String(payload[field.key] ?? "").trim();
    if (!requestedValue) continue;
    const runtimeValue = normalizeRuntimeEnvValue(field.key);
    if (!runtimeValue) {
      if (!missingSubmitted.includes(field.key)) missingSubmitted.push(field.key);
      continue;
    }
    if (runtimeValue !== requestedValue) mismatchedSubmitted.push(field.key);
  }

  return { missingRequired, missingSubmitted, mismatchedSubmitted };
}

export async function loadSetupEnvValues(): Promise<Record<string, string>> {
  const envPath = join(process.cwd(), ".env");
  let fileValues: Record<string, string> = {};
  try {
    const raw = await readFile(envPath, "utf8");
    fileValues = parseEnv(raw);
  } catch {
    try {
      const exampleRaw = await readFile(join(process.cwd(), ".env.example"), "utf8");
      fileValues = parseEnv(exampleRaw);
    } catch {
      fileValues = {};
    }
  }

  const values: Record<string, string> = {};
  for (const field of SETUP_ENV_FIELDS) {
    const fileValue = String(fileValues[field.key] || "").trim();
    if (fileValue) values[field.key] = fileValue;

    // Runtime env vars (e.g. Vercel-managed) should be visible to server-side setup flows.
    const runtimeValue = process.env[field.key];
    if (runtimeValue && runtimeValue.trim()) {
      values[field.key] = runtimeValue.trim();
    }
  }

  trace("setup-env", "loaded setup env values", {
    source: isManagedRuntime ? "runtime+file" : "file",
    keyCount: Object.keys(values).length,
  });
  return values;
}

export function buildSetupWizardSeed(values: Record<string, string>): SetupWizardSeed {
  const initialValues: Record<string, string> = {};
  const configuredPasswordKeys: string[] = [];

  for (const field of SETUP_ENV_FIELDS) {
    const normalizedValue = String(values[field.key] || "").trim();
    initialValues[field.key] = isSensitiveSetupField(field) ? "" : normalizedValue;
    if (normalizedValue && isSensitiveSetupField(field)) configuredPasswordKeys.push(field.key);
  }

  return {
    initialValues,
    configuredPasswordKeys,
  };
}

async function saveLocalEnvValues(payload: Record<string, string>) {
  const envPath = join(process.cwd(), ".env");
  let existing: Record<string, string> = {};
  try {
    existing = parseEnv(await readFile(envPath, "utf8"));
  } catch {
    existing = {};
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (isVercelRuntime && (process.env[key] || "").trim()) continue;
    existing[key] = String(value ?? "").trim();
  }

  const lines = SETUP_ENV_FIELDS.flatMap((field) => {
    if (isVercelRuntime && (process.env[field.key] || "").trim()) return [];
    const value = existing[field.key] ?? "";
    return `${field.key}=${formatEnvValue(value)}`;
  });

  lines.push("");
  await writeFile(envPath, `${lines.join("\n")}`, "utf8");
  trace("setup-env", "saved local .env values", { keyCount: lines.length - 1 });
}

async function saveRuntimeEnvValues(payload: Record<string, string>) {
  const diff = getManagedRuntimeEnvDiff(payload);
  const unresolved = Array.from(
    new Set([...diff.missingRequired, ...diff.missingSubmitted, ...diff.mismatchedSubmitted]),
  );

  if (unresolved.length > 0) {
    const details: string[] = [];
    if (diff.missingRequired.length > 0) {
      details.push(`missing required runtime env vars: ${diff.missingRequired.join(", ")}`);
    }
    if (diff.missingSubmitted.length > 0) {
      details.push(`submitted values are not present in runtime env: ${diff.missingSubmitted.join(", ")}`);
    }
    if (diff.mismatchedSubmitted.length > 0) {
      details.push(`runtime env values differ from submitted setup values: ${diff.mismatchedSubmitted.join(", ")}`);
    }
    throw new SetupEnvPersistenceError(
      `Managed runtime detected. Configure environment values outside the app before continuing (${details.join("; ")}).`,
    );
  }

  trace("setup-env", "runtime env values already satisfied; persistence skipped", {
    keyCount: Object.keys(payload).filter((key) => ALLOWED_KEYS.has(key)).length,
  });
  return {
    backend: "runtime",
    persisted: false,
  } satisfies SetupEnvPersistenceResult;
}

async function upsertVercelEnvVar(
  key: string,
  value: string,
  projectId: string,
  authToken: string,
  existingEnvIds: string[],
  teamId?: string,
) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const base = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`;

  for (const envId of existingEnvIds) {
    await fetch(`${base}/env/${encodeURIComponent(envId)}${qs}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    });
  }

  const createRes = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      value,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
    cache: "no-store",
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Failed setting Vercel env var ${key}. ${text}`.trim());
  }
}

async function listVercelEnvVarIdsByKey(
  projectId: string,
  authToken: string,
  teamId?: string,
) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const base = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`;
  const listRes = await fetch(`${base}/env${qs}`, {
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });
  if (!listRes.ok) {
    throw new Error("Failed listing Vercel env vars.");
  }
  const listJson = (await listRes.json()) as {
    envs?: Array<{ id: string; key: string; target?: string[] }>;
  };
  const byKey = new Map<string, string[]>();
  for (const entry of listJson.envs ?? []) {
    const key = String(entry.key || "").trim();
    const id = String(entry.id || "").trim();
    if (!key || !id) continue;
    const existing = byKey.get(key) ?? [];
    existing.push(id);
    byKey.set(key, existing);
  }
  return byKey;
}

function getVercelEnvPayloadEntries(payload: Record<string, string>) {
  const entries: Array<[string, string]> = [];
  for (const field of SETUP_ENV_FIELDS) {
    if (!ALLOWED_KEYS.has(field.key)) continue;
    const value = String(payload[field.key] ?? "").trim();
    if (!value) continue;
    entries.push([field.key, value]);
  }
  return entries;
}

async function saveVercelEnvValues(payload: Record<string, string>) {
  const projectId = String(payload.PROJECT_ID_VERCEL ?? process.env.PROJECT_ID_VERCEL ?? "").trim();
  const authToken = String(payload.AUTH_BEARER_TOKEN ?? process.env.AUTH_BEARER_TOKEN ?? "").trim();
  const teamId = String(payload.TEAM_ID_VERCEL ?? process.env.TEAM_ID_VERCEL ?? "").trim();

  if (!projectId || !authToken) {
    throw new SetupEnvPersistenceError(
      "Vercel runtime detected, but PROJECT_ID_VERCEL or AUTH_BEARER_TOKEN is missing. Provide them in setup or preconfigure them in the runtime.",
    );
  }

  trace("setup-env", "saving vercel env values", { projectId, hasTeamId: Boolean(teamId) });
  const entries = getVercelEnvPayloadEntries(payload);
  const existingEnvIdsByKey = await listVercelEnvVarIdsByKey(projectId, authToken, teamId || undefined);
  for (const [key, value] of entries) {
    await upsertVercelEnvVar(
      key,
      value,
      projectId,
      authToken,
      existingEnvIdsByKey.get(key) ?? [],
      teamId || undefined,
    );
  }
  trace("setup-env", "saved vercel env values", { keyCount: entries.length });
  return {
    backend: "vercel",
    persisted: true,
  } satisfies SetupEnvPersistenceResult;
}

async function saveLambdaEnvValues(payload: Record<string, string>) {
  const endpoint = process.env.SETUP_ENV_LAMBDA_URL?.trim();
  if (!endpoint) {
    throw new Error("SETUP_ENV_LAMBDA_URL is required for lambda env backend.");
  }
  const auth = process.env.SETUP_ENV_LAMBDA_TOKEN?.trim();

  const body = Object.fromEntries(
    SETUP_ENV_FIELDS.map((field) => [field.key, String(payload[field.key] ?? "").trim()]),
  );

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify({ values: body }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lambda env sync failed. ${text}`.trim());
  }
  trace("setup-env", "saved lambda env values", { endpoint });
  return {
    backend: "lambda",
    persisted: true,
  } satisfies SetupEnvPersistenceResult;
}

function detectEnvBackend(): EnvBackend {
  const configured = (process.env.SETUP_ENV_BACKEND || "").trim().toLowerCase();
  if (configured === "local" || configured === "vercel" || configured === "lambda" || configured === "runtime") {
    return configured;
  }
  if (isVercelRuntime) return "vercel";
  if (isManagedRuntime) return "runtime";
  return "local";
}

export async function saveSetupEnvValues(payload: Record<string, string>): Promise<SetupEnvPersistenceResult> {
  const backend = detectEnvBackend();
  trace("setup-env", "selected env backend", { backend });

  // Managed runtimes must never write `.env` files. If the runtime config already
  // satisfies setup, treat it as authoritative and skip any persistence backend.
  if (isManagedRuntime && backend !== "vercel" && backend !== "lambda") {
    return saveRuntimeEnvValues(payload);
  }
  if (backend === "runtime") {
    return saveRuntimeEnvValues(payload);
  }
  if (backend === "vercel") {
    const diff = getManagedRuntimeEnvDiff(payload);
    if (
      isManagedRuntime &&
      diff.missingRequired.length === 0 &&
      diff.missingSubmitted.length === 0 &&
      diff.mismatchedSubmitted.length === 0
    ) {
      return saveRuntimeEnvValues(payload);
    }
    return saveVercelEnvValues(payload);
  }
  if (backend === "lambda") {
    const diff = getManagedRuntimeEnvDiff(payload);
    if (
      isManagedRuntime &&
      diff.missingRequired.length === 0 &&
      diff.missingSubmitted.length === 0 &&
      diff.mismatchedSubmitted.length === 0
    ) {
      return saveRuntimeEnvValues(payload);
    }
    return saveLambdaEnvValues(payload);
  }
  await saveLocalEnvValues(payload);
  return {
    backend: "local",
    persisted: true,
  };
}
