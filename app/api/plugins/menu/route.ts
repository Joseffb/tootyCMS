import { NextRequest, NextResponse } from "next/server";
import { getDashboardPluginMenuItems } from "@/lib/plugin-runtime";

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("siteId")?.trim() || undefined;
  const items = await getDashboardPluginMenuItems(siteId);
  return NextResponse.json({ items });
}
