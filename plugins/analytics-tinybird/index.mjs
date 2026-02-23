import { NextResponse } from "next/server";

const DATASOURCE = "website_visitors";
const DEFAULT_HOST = "https://api.us-east.aws.tinybird.co";
const ALLOWED_PIPES = new Set([
  "visitors_per_day",
  "top_pages",
  "top_sources",
  "top_locations",
  "top_devices",
  "domain_share",
]);

function providerEnabled() {
  const flag = String(process.env.ANALYTICS_TINYBIRD_ENABLED || "true").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(flag);
}

function providerKey() {
  return String(process.env.ANALYTICS_TINYBIRD_KEY || "tinybird").trim().toLowerCase();
}

function host() {
  return String(process.env.ANALYTICS_TINYBIRD_HOST || process.env.NEXT_PUBLIC_TB_HOST || DEFAULT_HOST).trim();
}

function dashboardToken() {
  return String(process.env.ANALYTICS_TINYBIRD_DASH_TOKEN || process.env.TB_DASH_TOKEN || "").trim();
}

function ingestToken() {
  return String(process.env.ANALYTICS_TINYBIRD_INGEST_TOKEN || process.env.TB_INGEST_TOKEN || "").trim();
}

function isEnabledValue(raw, fallback) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "off", "no"].includes(value);
}

function shouldHandleProvider(context = {}, key = providerKey()) {
  const requested = String(context?.params?.provider || "").trim().toLowerCase();
  return !requested || requested === key;
}

function shouldForwardEvent(event = {}) {
  if (!event || typeof event !== "object") return false;
  const actorType = String(event.actorType || "").trim().toLowerCase();
  // Keep admin/operator activity out of analytics transport.
  if (actorType === "admin") return false;
  return true;
}

function withJsonContentType(res) {
  return new NextResponse(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function register(kernel, api) {
  kernel.addFilter("analytics:query", async (current, context = {}) => {
    if (current) return current;
    const enabledRaw = await api?.getPluginSetting?.("enabled", String(providerEnabled()));
    if (!isEnabledValue(enabledRaw, providerEnabled())) return current;
    const providerKeyValue = String((await api?.getPluginSetting?.("providerKey", providerKey())) || providerKey())
      .trim()
      .toLowerCase();
    if (!shouldHandleProvider(context, providerKeyValue)) return current;

    const name = String(context?.name || "").trim();
    if (!name) return new NextResponse("Missing query name", { status: 400 });
    if (!ALLOWED_PIPES.has(name)) return new NextResponse("Pipe not allowed", { status: 403 });

    const token = String((await api?.getPluginSetting?.("dashboardToken", dashboardToken())) || "").trim();
    if (!token) return new NextResponse("Tinybird dashboard token missing", { status: 202 });

    const params = new URLSearchParams(context?.params || {});
    const rawDomain = params.get("domain");
    if (rawDomain === null) {
      params.set("domain", "nevergonnahappen");
    } else if (rawDomain === "all") {
      params.delete("domain");
    }
    params.delete("name");
    params.delete("provider");

    const qs = params.toString();
    const apiHost = String((await api?.getPluginSetting?.("host", host())) || "").trim() || host();
    const url = `${apiHost}/v0/pipes/${name}.json?token=${token}${qs ? `&${qs}` : ""}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      return withJsonContentType(res);
    } catch {
      return new NextResponse("Tinybird query error", { status: 202 });
    }
  });

  kernel.addAction("analytics:event", async (event = {}) => {
    const enabledRaw = await api?.getPluginSetting?.("enabled", String(providerEnabled()));
    if (!isEnabledValue(enabledRaw, providerEnabled())) return;
    if (!shouldForwardEvent(event)) return;

    const token = String((await api?.getPluginSetting?.("ingestToken", ingestToken())) || "").trim();
    if (!token) return;

    const apiHost = String((await api?.getPluginSetting?.("host", host())) || "").trim() || host();

    const payload = {
      event_name: String(event.name || "custom_event"),
      timestamp: String(event.timestamp || new Date().toISOString()),
      site_id: String(event.siteId || ""),
      domain: String(event.domain || ""),
      path: String(event.path || ""),
      actor_type: String(event.actorType || "anonymous"),
      actor_id: String(event.actorId || ""),
      ...(event.payload && typeof event.payload === "object" ? event.payload : {}),
    };

    try {
      await fetch(`${apiHost}/v0/events?name=${DATASOURCE}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: `${JSON.stringify(payload)}\n`,
      });
    } catch {
      // Swallow provider transport failures in pre-alpha event pipeline.
    }
  });
}
