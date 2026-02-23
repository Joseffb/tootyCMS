// app/api/tb-pipe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { trace } from '@/lib/debug';
import { isLocalHostLike } from "@/lib/site-url";

export const runtime = 'nodejs';

// Allow override to point at local Tinybird or cloud Tinybird
const TB_HOST  = process.env.NEXT_PUBLIC_TB_HOST ?? 'https://api.us-east.aws.tinybird.co';
const TB_TOKEN = process.env.TB_DASH_TOKEN!;   // server-only secret

// Whitelist of pipe names
const ALLOWED = new Set([
  'visitors_per_day',
  'top_pages',
  'top_sources',
  'top_locations',
  'top_devices',
  'domain_share',
]);

function isDebugFallbackMode(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const debug = process.env.DEBUG_MODE === "true" || process.env.NEXT_PUBLIC_DEBUG_MODE === "true";
  return debug && isLocalHostLike(host);
}

function emptyDataResponse(name: string, reason: string) {
  return NextResponse.json(
    {
      data: [],
      meta: { fallback: true, pipe: name, reason },
    },
    { status: 200 },
  );
}

export async function GET(req: NextRequest) {
  const incoming = new URL(req.url);
  const params   = incoming.searchParams;
  const name     = params.get('name');

  if (!name) {
    return new NextResponse('Missing ?name=', { status: 400 });
  }
  if (!ALLOWED.has(name)) {
    return new NextResponse('Pipe not allowed', { status: 403 });
  }

  // Handle domain parameter:
  // - If no 'domain' present, set to never-match to avoid accidental global data
  // - If domain === 'all', remove the param so pipe sees no domain filter
  // - Otherwise, leave as provided
  const rawDomain = params.get('domain');
  if (rawDomain === null) {
    params.set('domain', 'nevergonnahappen');
  } else if (rawDomain === 'all') {
    params.delete('domain');
  }

  // Remove 'name' from querystring, build QS from remaining params
  params.delete('name');
  const qs = params.toString();

  // Construct Tinybird URL
  const tbUrl = `${TB_HOST}/v0/pipes/${name}.json?token=${TB_TOKEN}` +
    (qs ? `&${qs}` : '');

  trace("tb-pipe", "proxy request", {
    incomingParams: incoming.searchParams.toString(),
    forwardUrl: tbUrl,
  });

  try {
    const tbRes = await fetch(tbUrl, { cache: 'no-store' });
    if (!tbRes.ok && isDebugFallbackMode(req)) {
      console.warn(`[tb-pipe] fallback for ${name}: upstream status ${tbRes.status}`);
      return emptyDataResponse(name, `upstream_status_${tbRes.status}`);
    }
    return new NextResponse(tbRes.body, {
      status:  tbRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[tb-pipe] fetch failed:', err);
    if (isDebugFallbackMode(req)) {
      return emptyDataResponse(name, "fetch_failed");
    }
    return new NextResponse('Tinybird proxy error', { status: 502 });
  }
}
