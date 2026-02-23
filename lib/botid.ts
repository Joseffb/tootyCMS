import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { checkBotId } from "botid/server";

const BOTID_PLUGIN_ID = "botid-shield";
const BOTID_ENABLED_KEY = `plugin_${BOTID_PLUGIN_ID}_enabled`;
const BOTID_CONFIG_KEY = `plugin_${BOTID_PLUGIN_ID}_config`;

export type BotIdRouteKey = "api_generate" | "api_upload_image";
type BotIdMode = "off" | "monitor" | "enforce";

type BotIdGuardConfig = {
  enabled: boolean;
  mode: BotIdMode;
  protectGenerate: boolean;
  protectUploadImage: boolean;
  allowVerifiedBots: Set<string>;
  developmentBypass: "HUMAN" | "BAD-BOT" | "GOOD-BOT" | "ALLOWED" | "";
};

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function toMode(value: unknown): BotIdMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "enforce") return "enforce";
  if (normalized === "off") return "off";
  return "monitor";
}

function parseCsvSet(input: unknown) {
  if (typeof input !== "string") return new Set<string>();
  return new Set(
    input
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseConfig(raw: string | undefined): BotIdGuardConfig {
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  return {
    enabled: false,
    mode: toMode(parsed.mode),
    protectGenerate: toBoolean(parsed.protect_generate, true),
    protectUploadImage: toBoolean(parsed.protect_upload_image, true),
    allowVerifiedBots: parseCsvSet(parsed.allow_verified_bots),
    developmentBypass: String(parsed.development_bypass ?? "")
      .trim()
      .toUpperCase()
      .replace(/_/g, "-") as BotIdGuardConfig["developmentBypass"],
  };
}

async function getBotIdConfig(): Promise<BotIdGuardConfig> {
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(inArray(cmsSettings.key, [BOTID_ENABLED_KEY, BOTID_CONFIG_KEY]));

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const config = parseConfig(byKey.get(BOTID_CONFIG_KEY));
  config.enabled = byKey.get(BOTID_ENABLED_KEY) === "true";
  if (!config.enabled) config.mode = "off";
  return config;
}

function routeEnabled(config: BotIdGuardConfig, route: BotIdRouteKey) {
  if (route === "api_generate") return config.protectGenerate;
  if (route === "api_upload_image") return config.protectUploadImage;
  return false;
}

function asBotName(input: unknown) {
  return String(input ?? "").trim().toLowerCase();
}

export async function evaluateBotIdRoute(route: BotIdRouteKey) {
  let config: BotIdGuardConfig;
  try {
    config = await getBotIdConfig();
  } catch {
    return { allowed: true as const, blocked: false as const, mode: "off" as const, reason: "config-unavailable" };
  }
  if (config.mode === "off" || !routeEnabled(config, route)) {
    return { allowed: true as const, blocked: false as const, mode: config.mode, reason: "disabled" };
  }

  try {
    const options =
      process.env.NODE_ENV === "development" && config.developmentBypass
        ? { developmentOptions: { bypass: config.developmentBypass } }
        : undefined;
    const verdict = (await checkBotId(options as any)) as any;

    const isBot = Boolean(verdict?.isBot);
    const verified = Boolean(verdict?.isVerifiedBot);
    const verifiedName = asBotName(verdict?.verifiedBotName ?? verdict?.botName);
    const allowedVerified = verified && verifiedName && config.allowVerifiedBots.has(verifiedName);

    if (isBot && !allowedVerified && config.mode === "enforce") {
      return {
        allowed: false as const,
        blocked: true as const,
        mode: config.mode,
        reason: "blocked-bot",
      };
    }

    return {
      allowed: true as const,
      blocked: false as const,
      mode: config.mode,
      reason: isBot ? "monitor-bot" : "human",
    };
  } catch (error) {
    console.warn("[botid] check failed; allowing request", {
      route,
      mode: config.mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: true as const, blocked: false as const, mode: config.mode, reason: "check-failed" };
  }
}
