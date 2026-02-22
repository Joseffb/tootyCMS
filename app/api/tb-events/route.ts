// app/api/tb-events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { isDebugMode, trace } from '@/lib/debug';

export const runtime = 'nodejs';

const DATASOURCE = 'website_visitors';
const HOST = process.env.NEXT_PUBLIC_TB_HOST ?? 'https://api.us-east.aws.tinybird.co';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Read and parse the incoming JSON
  const rawText: string = await req.text();
  const parsed: Record<string, unknown> = JSON.parse(rawText);

  // 2. Extract geo headers
  const country: string = req.headers.get('x-vercel-ip-country') ?? '';
  const city: string = req.headers.get('x-vercel-ip-city') ?? '';

  // 3. Extract client IP
  const ipAddress: string =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '';

  // 4. Build enriched payload
  const enrichedPayload = {
    ...parsed,
    country,
    city,
    ip_address: ipAddress,
  };
  const enrichedBody: string = JSON.stringify(enrichedPayload);

  // 5. Determine Tinybird host
  const hdrHost: string | null =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const tbHost: string = HOST;
  const token: string | undefined = process.env.TB_INGEST_TOKEN;

  trace("tb-events", "incoming event", {
    host: hdrHost,
    tinybirdHost: tbHost,
    payloadSize: enrichedBody.length,
    payload: enrichedPayload,
  });

  // 7. Validate token
  if (!token) {
    if (isDebugMode()) {
      console.warn('[tb-events] TB_INGEST_TOKEN missing; skipping event ingest');
    }
    return new NextResponse('Tinybird token missing; event skipped', { status: 202 });
  }

  try {
    // 8. Send to Tinybird
    const tbRes = await fetch(
      `${tbHost}/v0/events?name=${DATASOURCE}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: enrichedBody + '\n',
      }
    );

    const text = await tbRes.text();
    if (!tbRes.ok) {
      if (isDebugMode()) {
        console.warn('[tb-events] Tinybird error; skipping event →', text);
      }
      return new NextResponse(`Tinybird error; event skipped: ${text}`, { status: 202 });
    }

    trace("tb-events", "ingested event", { response: text });
    return new NextResponse('ok', {
      headers: {
        'Access-Control-Allow-Origin':
          process.env.CORS_ALLOW_ORIGIN ?? '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
      },
    });
  } catch (error) {
    if (isDebugMode()) {
      console.warn('[tb-events] fetch threw; skipping event:', error);
    }
    return new NextResponse('Tinybird fetch error; event skipped', { status: 202 });
  }
}
