import db from "@/lib/db";
import { cmsSettings } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

const OAUTH_PROVIDER_IDS = ["github", "google", "facebook", "apple"] as const;

export async function GET() {
  const rows = await db
    .select({ key: cmsSettings.key, value: cmsSettings.value })
    .from(cmsSettings)
    .where(
      inArray(
        cmsSettings.key,
        OAUTH_PROVIDER_IDS.map((id) => `oauth_provider_${id}_enabled`),
      ),
    );

  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const enabled = Object.fromEntries(
    OAUTH_PROVIDER_IDS.map((id) => {
      const key = `oauth_provider_${id}_enabled`;
      return [id, values[key] ? values[key] === "true" : true];
    }),
  );

  return NextResponse.json({ enabled });
}
