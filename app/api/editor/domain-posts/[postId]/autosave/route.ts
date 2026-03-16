import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  persistDomainPostUpdateForUser,
  type DomainPostUpdateInput,
} from "@/lib/domain-post-persistence";

type RouteContext = {
  params: Promise<{
    postId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { postId } = await context.params;
  const resolvedPostId = decodeURIComponent(String(postId || "").trim());
  if (!resolvedPostId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const body = (await request.json()) as DomainPostUpdateInput;
  const payloadId = String(body?.id || "").trim();
  if (!payloadId || payloadId !== resolvedPostId) {
    return NextResponse.json({ error: "postId mismatch" }, { status: 400 });
  }

  const result = await persistDomainPostUpdateForUser({
    userId: session.user.id,
    data: body,
  });

  if ((result as { error?: string } | null)?.error) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
