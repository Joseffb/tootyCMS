import { NextRequest, NextResponse } from "next/server";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { resolveAnalyticsSiteId } from "@/lib/analytics-site";
import { ensureDomainQueueTable } from "@/lib/domain-queue";
import db from "@/lib/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

function prefix() {
  const raw = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return raw.endsWith("_") ? raw : `${raw}_`;
}

function quotedQueueTable() {
  return `"${`${prefix()}domain_events_queue`.replace(/"/g, "\"\"")}"`;
}

function normalizeDomain(input: string) {
  return input.trim().toLowerCase().replace(/:\d+$/, "");
}

function escapeLike(input: string) {
  return input.replace(/[\\%_]/g, "\\$&");
}

async function queryRows(query: any) {
  const result = await db.execute(query);
  return ((result as any)?.rows || []) as Array<Record<string, unknown>>;
}

async function fallbackVisitorsPerDay(siteId?: string | null, domain?: string | null) {
  const table = quotedQueueTable();
  const normalizedDomain = normalizeDomain(String(domain || ""));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const bySite = siteId ? sql`AND coalesce(event->>'siteId', '') = ${siteId}` : sql``;
  const byDomain = normalizedDomain && normalizedDomain !== "all" && normalizedDomain !== "nevergonnahappen"
    ? sql`AND lower(coalesce(event->>'domain', '')) = ${normalizedDomain}`
    : sql``;
  const rows = await queryRows(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
           COUNT(*)::int AS total_pageviews
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${bySite}
      ${byDomain}
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return rows.map((row) => ({
    date: String(row.date || ""),
    total_pageviews: Number(row.total_pageviews || 0),
  }));
}

async function fallbackTopPages(siteId?: string | null, domain?: string | null) {
  const table = quotedQueueTable();
  const normalizedDomain = normalizeDomain(String(domain || ""));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const bySite = siteId ? sql`AND coalesce(event->>'siteId', '') = ${siteId}` : sql``;
  const byDomain = normalizedDomain && normalizedDomain !== "all" && normalizedDomain !== "nevergonnahappen"
    ? sql`AND lower(coalesce(event->>'domain', '')) = ${normalizedDomain}`
    : sql``;
  const rows = await queryRows(sql`
    SELECT coalesce(nullif(event->'payload'->>'page_url', ''), nullif(event->>'path', ''), '(unknown)') AS page,
           COUNT(*)::int AS visitors
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${bySite}
      ${byDomain}
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 10
  `);
  return rows.map((row) => ({
    page: String(row.page || "(unknown)"),
    visitors: Number(row.visitors || 0),
  }));
}

async function fallbackTopDevices(siteId?: string | null, domain?: string | null) {
  const table = quotedQueueTable();
  const normalizedDomain = normalizeDomain(String(domain || ""));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const bySite = siteId ? sql`AND coalesce(event->>'siteId', '') = ${siteId}` : sql``;
  const byDomain = normalizedDomain && normalizedDomain !== "all" && normalizedDomain !== "nevergonnahappen"
    ? sql`AND lower(coalesce(event->>'domain', '')) = ${normalizedDomain}`
    : sql``;
  const rows = await queryRows(sql`
    SELECT coalesce(nullif(event->'payload'->>'device_type', ''), '(unknown)') AS device,
           COUNT(*)::int AS visitors
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${bySite}
      ${byDomain}
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 10
  `);
  return rows.map((row) => ({
    device: String(row.device || "(unknown)"),
    visitors: Number(row.visitors || 0),
  }));
}

async function fallbackTopLocations(siteId?: string | null, domain?: string | null) {
  const table = quotedQueueTable();
  const normalizedDomain = normalizeDomain(String(domain || ""));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const bySite = siteId ? sql`AND coalesce(event->>'siteId', '') = ${siteId}` : sql``;
  const byDomain = normalizedDomain && normalizedDomain !== "all" && normalizedDomain !== "nevergonnahappen"
    ? sql`AND lower(coalesce(event->>'domain', '')) = ${normalizedDomain}`
    : sql``;
  const rows = await queryRows(sql`
    SELECT coalesce(nullif(event->'payload'->>'country', ''), '(unknown)') AS country,
           COUNT(*)::int AS visitors
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${bySite}
      ${byDomain}
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 10
  `);
  return rows.map((row) => ({
    country: String(row.country || "(unknown)"),
    visitors: Number(row.visitors || 0),
  }));
}

async function fallbackTopSources(siteId?: string | null, domain?: string | null) {
  const table = quotedQueueTable();
  const normalizedDomain = normalizeDomain(String(domain || ""));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const bySite = siteId ? sql`AND coalesce(event->>'siteId', '') = ${siteId}` : sql``;
  const byDomain = normalizedDomain && normalizedDomain !== "all" && normalizedDomain !== "nevergonnahappen"
    ? sql`AND lower(coalesce(event->>'domain', '')) = ${normalizedDomain}`
    : sql``;
  const rows = await queryRows(sql`
    SELECT coalesce(nullif(event->'payload'->>'referrer_url', ''), '(direct)') AS referrer,
           COUNT(*)::int AS visitors
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${bySite}
      ${byDomain}
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 40
  `);

  const grouped = new Map<string, number>();
  for (const row of rows) {
    const raw = String(row.referrer || "(direct)").trim();
    let source = "(direct)";
    if (raw && raw !== "(direct)") {
      try {
        source = new URL(raw).hostname.replace(/^www\./, "") || "(direct)";
      } catch {
        source = raw.replace(/^https?:\/\//, "").split("/")[0] || "(direct)";
      }
    }
    grouped.set(source, (grouped.get(source) || 0) + Number(row.visitors || 0));
  }
  return [...grouped.entries()]
    .map(([source, visitors]) => ({ source, visitors }))
    .sort((a, b) => b.visitors - a.visitors)
    .slice(0, 10);
}

async function fallbackDomainShare(domain: string, siteId?: string | null) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return {
      data: [{ domain: "(unknown)", pct_hits: 0, hits: 0, total_hits: 0 }],
      meta: { provider: "internal_queue", fallback: true, window_days: 30 },
    };
  }
  const table = quotedQueueTable();
  const siteFilter = siteId
    ? sql`AND coalesce(event->>'siteId', '') = ${siteId}`
    : sql``;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const totalResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${siteFilter}
  `);
  const total = Number((totalResult as any)?.rows?.[0]?.count || 0);
  if (!total) {
    return {
      data: [{ domain: normalizedDomain, pct_hits: 0, hits: 0, total_hits: 0 }],
      meta: { provider: "internal_queue", fallback: true, window_days: 30 },
    };
  }

  const domainResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM ${sql.raw(table)}
    WHERE status = 'processed'
      AND coalesce(event->>'name', '') = 'page_view'
      AND created_at >= ${thirtyDaysAgo}
      ${siteFilter}
      AND lower(coalesce(event->>'domain', '')) = ${normalizedDomain}
  `);
  const hits = Number((domainResult as any)?.rows?.[0]?.count || 0);
  const pct = Math.round((hits / total) * 1000) / 10;
  return {
    data: [{ domain: normalizedDomain, pct_hits: pct, hits, total_hits: total }],
    meta: { provider: "internal_queue", fallback: true, window_days: 30 },
  };
}

async function fallbackForQuery(name: string, siteId?: string | null, domain?: string | null) {
  try {
    if (name === "domain_share") return await fallbackDomainShare(String(domain || ""), siteId);
    if (name === "visitors_per_day") {
      return {
        data: await fallbackVisitorsPerDay(siteId, domain),
        meta: { provider: "internal_queue", fallback: true, reason: "local_queue" },
      };
    }
    if (name === "top_pages") {
      return {
        data: await fallbackTopPages(siteId, domain),
        meta: { provider: "internal_queue", fallback: true, reason: "local_queue" },
      };
    }
    if (name === "top_sources") {
      return {
        data: await fallbackTopSources(siteId, domain),
        meta: { provider: "internal_queue", fallback: true, reason: "local_queue" },
      };
    }
    if (name === "top_locations") {
      return {
        data: await fallbackTopLocations(siteId, domain),
        meta: { provider: "internal_queue", fallback: true, reason: "local_queue" },
      };
    }
    if (name === "top_devices") {
      return {
        data: await fallbackTopDevices(siteId, domain),
        meta: { provider: "internal_queue", fallback: true, reason: "local_queue" },
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  await ensureDomainQueueTable();
  const incoming = new URL(req.url);
  const name = incoming.searchParams.get("name");
  if (!name) return new NextResponse("Missing ?name=", { status: 400 });
  const siteId = await resolveAnalyticsSiteId({
    headers: req.headers,
    domainHint: incoming.searchParams.get("domain"),
  });
  const kernel = await createKernelForRequest(siteId);

  const response = await kernel.applyFilters<Response | NextResponse | null>(
    "domain:query",
    null,
    {
      request: req,
      name,
      params: Object.fromEntries(incoming.searchParams.entries()),
    },
  );

  const requestedDomain = incoming.searchParams.get("domain")?.trim() || "";
  if (!response) {
    const fallback = await fallbackForQuery(name, siteId, requestedDomain);
    if (fallback) return NextResponse.json(fallback, { status: 200 });
    return NextResponse.json(
      {
        data: [],
        meta: { provider: null, fallback: true, reason: "no_analytics_provider" },
      },
      { status: 200 },
    );
  }

  const rawText = await response.text();
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const canParseJson = contentType.includes("application/json");

  if (response.status >= 200 && response.status < 300 && canParseJson) {
    try {
      const parsed = JSON.parse(rawText);
      const data = Array.isArray(parsed?.data) ? parsed.data : [];
      if (data.length > 0) {
        return NextResponse.json(parsed, { status: response.status });
      }
      const fallback = await fallbackForQuery(name, siteId, requestedDomain);
      if (fallback) return NextResponse.json(fallback, { status: 200 });
      return NextResponse.json(parsed, { status: response.status });
    } catch {
      // fall through to generic handling
    }
  }

  const fallback = await fallbackForQuery(name, siteId, requestedDomain);
  if (fallback) return NextResponse.json(fallback, { status: 200 });

  if (response instanceof NextResponse) return new NextResponse(rawText, { status: response.status, headers: response.headers });
  return new NextResponse(rawText, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
