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

function providerKey() {
  return String(process.env.ANALYTICS_TINYBIRD_KEY || "tinybird").trim().toLowerCase();
}

function runtimeStage() {
  const explicit = String(process.env.ANALYTICS_RUNTIME_ENV || "").trim().toLowerCase();
  if (["local", "development", "preview", "production"].includes(explicit)) return explicit;
  const vercelEnv = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  if (["development", "preview", "production"].includes(vercelEnv)) return vercelEnv;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function envByStage(base) {
  const stage = runtimeStage();
  const map = {
    local: [`${base}_LOCAL`, `${base}_DEVELOPMENT`, base],
    development: [`${base}_DEVELOPMENT`, `${base}_LOCAL`, base],
    preview: [`${base}_PREVIEW`, `${base}_DEVELOPMENT`, base],
    production: [`${base}_PRODUCTION`, base],
  };
  for (const key of map[stage] || [base]) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function host() {
  return envByStage("ANALYTICS_TINYBIRD_HOST") || String(process.env.NEXT_PUBLIC_TB_HOST || DEFAULT_HOST).trim();
}

function dashboardToken() {
  return envByStage("ANALYTICS_TINYBIRD_DASH_TOKEN") || String(process.env.TB_DASH_TOKEN || "").trim();
}

function ingestToken() {
  return envByStage("ANALYTICS_TINYBIRD_INGEST_TOKEN") || String(process.env.TB_INGEST_TOKEN || "").trim();
}

function shouldHandleProvider(context = {}, key = "tinybird") {
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
  return new Response(res.body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function register(kernel, api) {
  kernel.addFilter("analytics:query", async (current, context = {}) => {
    if (current) return current;
    if (!shouldHandleProvider(context, providerKey())) return current;

    const name = String(context?.name || "").trim();
    if (!name) return new Response("Missing query name", { status: 400 });
    if (!ALLOWED_PIPES.has(name)) return new Response("Pipe not allowed", { status: 403 });

    const token = String((await api?.getPluginSetting?.("dashboardToken", dashboardToken())) || "").trim();
    if (!token) return new Response("Tinybird dashboard token missing", { status: 202 });

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
    const url = `${host()}/v0/pipes/${name}.json?token=${token}${qs ? `&${qs}` : ""}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      return withJsonContentType(res);
    } catch {
      return new Response("Tinybird query error", { status: 202 });
    }
  });

  kernel.addAction("analytics:event", async (event = {}) => {
    if (!shouldForwardEvent(event)) return;

    const token = String((await api?.getPluginSetting?.("ingestToken", ingestToken())) || "").trim();
    if (!token) return;

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
      await fetch(`${host()}/v0/events?name=${DATASOURCE}`, {
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
