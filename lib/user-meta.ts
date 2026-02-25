import db from "@/lib/db";
import { userMeta } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

function isMissingUserMetaTableError(error: unknown) {
  const code = (error as any)?.code;
  const message = String((error as any)?.message || "");
  return code === "42P01" || message.includes("tooty_user_meta");
}

export async function getUserMetaValue(userId: string, key: string) {
  try {
    const row = await db.query.userMeta.findFirst({
      where: and(eq(userMeta.userId, userId), eq(userMeta.key, key)),
      columns: { value: true },
    });
    return row?.value ?? null;
  } catch (error) {
    if (isMissingUserMetaTableError(error)) return null;
    throw error;
  }
}

export async function setUserMetaValue(userId: string, key: string, value: string) {
  try {
    await db
      .insert(userMeta)
      .values({ userId, key, value })
      .onConflictDoUpdate({
        target: [userMeta.userId, userMeta.key],
        set: { value, updatedAt: new Date() },
      });
  } catch (error) {
    if (isMissingUserMetaTableError(error)) return;
    throw error;
  }
}
