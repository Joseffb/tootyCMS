import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { trace } from "@/lib/debug";

export type SetupEnvField = {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "password" | "url";
};

export const SETUP_ENV_FIELDS: SetupEnvField[] = [
  { key: "NEXTAUTH_URL", label: "NextAuth URL", required: true, placeholder: "https://app.example.com", type: "url" },
  { key: "NEXT_PUBLIC_ROOT_DOMAIN", label: "Root Domain", required: true, placeholder: "fernain.com" },
  { key: "CMS_DB_PREFIX", label: "Database Table Prefix", required: true, placeholder: "fernain_" },
  { key: "THEMES_PATH", label: "Themes Path", placeholder: "themes" },
  { key: "PLUGINS_PATH", label: "Plugins Path", placeholder: "plugins" },
  { key: "POSTGRES_URL", label: "Postgres URL", required: true, type: "password" },
  { key: "NEXTAUTH_SECRET", label: "NextAuth Secret", required: true, type: "password" },
  { key: "AUTH_GITHUB_ID", label: "GitHub OAuth Client ID" },
  { key: "AUTH_GITHUB_SECRET", label: "GitHub OAuth Client Secret", type: "password" },
  { key: "AUTH_GOOGLE_ID", label: "Google OAuth Client ID" },
  { key: "AUTH_GOOGLE_SECRET", label: "Google OAuth Client Secret", type: "password" },
  { key: "AUTH_FACEBOOK_ID", label: "Facebook OAuth Client ID" },
  { key: "AUTH_FACEBOOK_SECRET", label: "Facebook OAuth Client Secret", type: "password" },
  { key: "AUTH_APPLE_ID", label: "Apple OAuth Client ID" },
  { key: "AUTH_APPLE_SECRET", label: "Apple OAuth Client Secret", type: "password" },
  { key: "AUTH_BEARER_TOKEN", label: "Vercel Auth Bearer Token", type: "password" },
  { key: "PROJECT_ID_VERCEL", label: "Vercel Project ID" },
  { key: "TEAM_ID_VERCEL", label: "Vercel Team ID" },
  { key: "BLOB_READ_WRITE_TOKEN", label: "Vercel Blob Read/Write Token", type: "password" },
  { key: "AWS_REGION", label: "AWS Region" },
  { key: "AWS_ACCESS_KEY_ID", label: "AWS Access Key ID" },
  { key: "AWS_SECRET_ACCESS_KEY", label: "AWS Secret Access Key", type: "password" },
  { key: "AWS_S3_BUCKET", label: "AWS S3 Bucket" },
  { key: "OPENAI_API_KEY", label: "OpenAI API Key", type: "password" },
  { key: "DEBUG_MODE", label: "Debug Mode (true/false)", placeholder: "false" },
  { key: "TRACE_PROFILE", label: "Trace Profile (Test/Dev/Prod)", placeholder: "Dev" },
  { key: "TRACE_LOG_DIR", label: "Trace Log Directory", placeholder: "logs/traces" },
  { key: "NO_IMAGE_MODE", label: "No Image Mode (true/false)", placeholder: "false" },
  { key: "NEXT_PUBLIC_VERCEL_DEPLOYMENT_SUFFIX", label: "Vercel Deployment Suffix", placeholder: "vercel.app" },
];

const ALLOWED_KEYS = new Set(SETUP_ENV_FIELDS.map((field) => field.key));
const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_URL);
type EnvBackend = "local" | "vercel" | "lambda";

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

export async function loadSetupEnvValues(): Promise<Record<string, string>> {
  const envPath = join(process.cwd(), ".env");
  let values: Record<string, string> = {};
  try {
    const raw = await readFile(envPath, "utf8");
    values = parseEnv(raw);
  } catch {
    try {
      const exampleRaw = await readFile(join(process.cwd(), ".env.example"), "utf8");
      values = parseEnv(exampleRaw);
    } catch {
      values = {};
    }
  }

  // Runtime env vars (e.g. Vercel-managed) should be visible in the wizard.
  for (const field of SETUP_ENV_FIELDS) {
    const runtimeValue = process.env[field.key];
    if (runtimeValue && runtimeValue.trim()) {
      values[field.key] = runtimeValue.trim();
    }
  }

  trace("setup-env", "loaded setup env values", {
    source: isVercelRuntime ? "runtime+file" : "file",
    keyCount: Object.keys(values).length,
  });
  return values;
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

async function upsertVercelEnvVar(
  key: string,
  value: string,
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
    throw new Error(`Failed listing Vercel env vars for ${key}.`);
  }
  const listJson = (await listRes.json()) as {
    envs?: Array<{ id: string; key: string; target?: string[] }>;
  };
  const existing = (listJson.envs ?? []).filter((entry) => entry.key === key);

  for (const envVar of existing) {
    await fetch(`${base}/env/${encodeURIComponent(envVar.id)}${qs}`, {
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

async function saveVercelEnvValues(payload: Record<string, string>) {
  const projectId = process.env.PROJECT_ID_VERCEL?.trim();
  const authToken = process.env.AUTH_BEARER_TOKEN?.trim();
  const teamId = process.env.TEAM_ID_VERCEL?.trim();

  if (!projectId || !authToken) {
    throw new Error(
      "Vercel runtime detected, but PROJECT_ID_VERCEL or AUTH_BEARER_TOKEN is missing.",
    );
  }

  trace("setup-env", "saving vercel env values", { projectId, hasTeamId: Boolean(teamId) });
  for (const field of SETUP_ENV_FIELDS) {
    const key = field.key;
    if (!ALLOWED_KEYS.has(key)) continue;
    const value = String(payload[key] ?? "").trim();
    await upsertVercelEnvVar(key, value, projectId, authToken, teamId || undefined);
  }
  trace("setup-env", "saved vercel env values", { keyCount: SETUP_ENV_FIELDS.length });
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
}

function detectEnvBackend(): EnvBackend {
  const configured = (process.env.SETUP_ENV_BACKEND || "").trim().toLowerCase();
  if (configured === "local" || configured === "vercel" || configured === "lambda") {
    return configured;
  }
  if (isVercelRuntime) return "vercel";
  return "local";
}

export async function saveSetupEnvValues(payload: Record<string, string>): Promise<void> {
  const backend = detectEnvBackend();
  trace("setup-env", "selected env backend", { backend });
  if (backend === "vercel") {
    return saveVercelEnvValues(payload);
  }
  if (backend === "lambda") {
    return saveLambdaEnvValues(payload);
  }
  return saveLocalEnvValues(payload);
}
