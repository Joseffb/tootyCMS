import { NextRequest, NextResponse } from "next/server";
import { trace } from "@/lib/debug";
import {
  getSiteDomainPostById,
  listSiteDomainPostMeta,
  upsertSiteDomainPostMeta,
} from "@/lib/site-domain-post-store";
import {
  getViewCountSkipReason,
  getViewCountThrottleState,
  parseViewCount,
  VIEW_COUNT_COOKIE,
  VIEW_COUNT_META_KEY,
  VIEW_COUNT_WINDOW_MS,
} from "@/lib/view-count";

type RouteContext = {
  params: Promise<{ postId: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  const { postId: rawPostId } = await context.params;
  const postId = String(rawPostId || "").trim();
  if (!postId) {
    return NextResponse.json({ ok: false, error: "postId is required" }, { status: 400 });
  }

  const skipReason = getViewCountSkipReason(req.headers);
  if (skipReason) {
    trace("view-count", "skip increment", { postId, reason: skipReason });
    return NextResponse.json({ ok: true, counted: false, reason: skipReason });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const siteId = String(body.siteId || "").trim();
  const dataDomainKey = String(body.dataDomainKey || "").trim();
  if (!siteId || !dataDomainKey) {
    return NextResponse.json({ ok: false, error: "siteId and dataDomainKey are required" }, { status: 400 });
  }

  const throttle = getViewCountThrottleState({
    rawCookie: req.cookies.get(VIEW_COUNT_COOKIE)?.value || "",
    postId,
  });
  if (throttle.throttled) {
    trace("view-count", "throttle increment", { postId, siteId, dataDomainKey });
    return NextResponse.json({ ok: true, counted: false, reason: "throttled" });
  }

  const post = await getSiteDomainPostById({ siteId, postId, dataDomainKey });
  if (!post || !post.published || post.dataDomainKey !== dataDomainKey) {
    return NextResponse.json({ ok: false, error: "Published post not found" }, { status: 404 });
  }

  const metaRows = await listSiteDomainPostMeta({
    siteId,
    dataDomainKey,
    postId,
  });
  const current = parseViewCount(metaRows.find((row) => row.key === VIEW_COUNT_META_KEY)?.value);
  const nextValue = current + 1;

  await upsertSiteDomainPostMeta({
    siteId,
    dataDomainKey,
    postId,
    key: VIEW_COUNT_META_KEY,
    value: String(nextValue),
  });

  trace("view-count", "increment success", {
    postId,
    siteId,
    dataDomainKey,
    viewCount: nextValue,
  });

  const response = NextResponse.json({ ok: true, counted: true, viewCount: nextValue });
  response.cookies.set(VIEW_COUNT_COOKIE, throttle.serialized, {
    path: "/",
    maxAge: Math.floor(VIEW_COUNT_WINDOW_MS / 1000),
    sameSite: "lax",
    httpOnly: false,
    secure: false,
  });
  return response;
}
