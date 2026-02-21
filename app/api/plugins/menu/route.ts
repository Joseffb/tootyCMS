import { NextResponse } from "next/server";
import { getDashboardPluginMenuItems } from "@/lib/plugin-runtime";

export async function GET() {
  const items = await getDashboardPluginMenuItems();
  return NextResponse.json({ items });
}
