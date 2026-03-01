import { NextRequest, NextResponse } from "next/server";
import { getDashboardPluginMenuItems } from "@/lib/plugin-runtime";

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("siteId")?.trim() || undefined;
  let items;
  try {
    items = await getDashboardPluginMenuItems(siteId);
  } catch (error) {
    if (!(siteId && error instanceof Error && error.message === "Invalid site.")) throw error;
    items = await getDashboardPluginMenuItems();
  }
  return NextResponse.json({ items });
}
