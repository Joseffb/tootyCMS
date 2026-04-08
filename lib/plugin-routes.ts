import { NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { trace } from "@/lib/debug";
import type { PluginRouteSchemaField } from "@/lib/kernel";

type DispatchInput = {
  request: Request;
  pluginId: string;
  slug?: string[];
};

const BLOCKED_PLUGIN_ROUTE_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
  "x-real-ip",
]);

const BLOCKED_PLUGIN_ROUTE_HEADER_PREFIXES = [
  "cf-",
  "sec-",
  "x-forwarded-",
  "x-vercel-",
];

function normalizeHeaders(headers: Headers) {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalizedKey = String(key || "").toLowerCase();
    if (
      BLOCKED_PLUGIN_ROUTE_HEADERS.has(normalizedKey) ||
      BLOCKED_PLUGIN_ROUTE_HEADER_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      return;
    }
    out[normalizedKey] = String(value || "");
  });
  return out;
}

function normalizePath(slug?: string[]) {
  const parts = Array.isArray(slug)
    ? slug.map((part) => String(part || "").trim()).filter(Boolean)
    : [];
  return `/${parts.join("/")}`.replace(/\/+/g, "/");
}

async function parseBody(request: Request) {
  const method = String(request.method || "GET").toUpperCase();
  if (method === "GET" || method === "DELETE") return {};
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return {};
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function coercePrimitive(value: unknown, field: PluginRouteSchemaField) {
  switch (field.type) {
    case "string": {
      const normalized = String(value ?? "");
      if (field.enum && !field.enum.includes(normalized)) {
        throw new Error("must be one of the allowed values");
      }
      if (field.minLength !== undefined && normalized.length < field.minLength) {
        throw new Error(`must be at least ${field.minLength} characters`);
      }
      if (field.maxLength !== undefined && normalized.length > field.maxLength) {
        throw new Error(`must be at most ${field.maxLength} characters`);
      }
      return normalized;
    }
    case "number": {
      const normalized = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(normalized)) throw new Error("must be a valid number");
      if (field.minimum !== undefined && normalized < field.minimum) {
        throw new Error(`must be >= ${field.minimum}`);
      }
      if (field.maximum !== undefined && normalized > field.maximum) {
        throw new Error(`must be <= ${field.maximum}`);
      }
      return normalized;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      const normalized = String(value ?? "").trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
      throw new Error("must be a boolean");
    }
    case "array": {
      if (!Array.isArray(value)) throw new Error("must be an array");
      return value;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("must be an object");
      }
      return value as Record<string, unknown>;
    }
    default:
      return value;
  }
}

function validatePayload(
  source: Record<string, unknown>,
  schema: Record<string, PluginRouteSchemaField> | undefined,
  label: "query" | "body",
) {
  if (!schema) return { ok: true as const, value: source };
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const value = source[key];
    if (value === undefined || value === null || value === "") {
      if (field.required) {
        return { ok: false as const, error: `${label}.${key} is required` };
      }
      continue;
    }
    try {
      out[key] = coercePrimitive(value, field);
    } catch (error) {
      return {
        ok: false as const,
        error: `${label}.${key} ${error instanceof Error ? error.message : "is invalid"}`,
      };
    }
  }
  return { ok: true as const, value: { ...source, ...out } };
}

function resolveSiteId(query: Record<string, unknown>, body: Record<string, unknown>) {
  const raw = typeof body.siteId === "string" ? body.siteId : typeof query.siteId === "string" ? query.siteId : "";
  const siteId = String(raw || "").trim();
  return siteId || null;
}

export async function dispatchPluginRouteRequest(input: DispatchInput) {
  const pluginId = String(input.pluginId || "").trim();
  const method = String(input.request.method || "GET").trim().toUpperCase();
  const path = normalizePath(input.slug);
  const url = new URL(input.request.url);
  const rawQuery = Object.fromEntries(url.searchParams.entries());
  let rawBody: Record<string, unknown> = {};

  try {
    rawBody = await parseBody(input.request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 },
    );
  }

  const kernel = await createKernelForRequest();
  const route = kernel
    .getPluginRoutes(pluginId)
    .find((entry) => entry.method === method && entry.path === path);

  if (!route) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const traceMeta = { pluginId, method, path, auth: route.auth, capability: route.capability };
  trace("plugins", "plugin route begin", traceMeta);

  const validatedQuery = validatePayload(rawQuery, route.schema?.query, "query");
  if (!validatedQuery.ok) {
    return NextResponse.json({ ok: false, error: validatedQuery.error }, { status: 400 });
  }
  const validatedBody = validatePayload(rawBody, route.schema?.body, "body");
  if (!validatedBody.ok) {
    return NextResponse.json({ ok: false, error: validatedBody.error }, { status: 400 });
  }

  let session: any = null;
  if (route.auth !== "public") {
    session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const siteId = resolveSiteId(validatedQuery.value, validatedBody.value);
    const allowed = await userCan(route.capability, session.user.id, siteId ? { siteId } : undefined);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await route.handler({
      pluginId,
      namespace: route.namespace,
      method: route.method,
      path: route.path,
      auth: route.auth,
      capability: route.capability,
      siteId: resolveSiteId(validatedQuery.value, validatedBody.value),
      session,
      userId: session?.user?.id ? String(session.user.id) : null,
      query: validatedQuery.value,
      body: validatedBody.value,
      headers: normalizeHeaders(input.request.headers),
    });
    const payload =
      result && typeof result === "object" && !Array.isArray(result)
        ? result
        : { ok: true, data: result };
    trace("plugins", "plugin route end", { ...traceMeta, ok: true });
    return NextResponse.json(payload);
  } catch (error) {
    trace("plugins", "plugin route failed", {
      ...traceMeta,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Plugin route failed." },
      { status: 500 },
    );
  }
}
