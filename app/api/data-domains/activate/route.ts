import { setDataDomainActivation } from "@/lib/actions";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const siteId = typeof body?.siteId === "string" ? body.siteId : "";
  const dataDomainId = Number(body?.dataDomainId);
  const isActive = Boolean(body?.isActive);

  if (!siteId || !Number.isFinite(dataDomainId)) {
    return NextResponse.json({ error: "siteId and dataDomainId are required" }, { status: 400 });
  }

  const response = await setDataDomainActivation({ siteId, dataDomainId, isActive });
  if ((response as any)?.error) {
    const status = (response as any).error === "Admin role required" ? 403 : 400;
    return NextResponse.json(response, { status });
  }

  return NextResponse.json(response);
}

