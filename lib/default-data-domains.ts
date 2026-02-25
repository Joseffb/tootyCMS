import db from "@/lib/db";
import { dataDomains } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const DEFAULT_CORE_DOMAIN_KEYS = ["post", "page"] as const;
export type DefaultCoreDomainKey = (typeof DEFAULT_CORE_DOMAIN_KEYS)[number];

function normalizedPrefix() {
  const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
  return rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
}

type DomainRow = { id: number; key: string };

async function ensureOneCoreDomain(key: DefaultCoreDomainKey): Promise<DomainRow | null> {
  const existing = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, key),
    columns: { id: true, key: true },
  });
  if (existing) return existing;

  const prefix = normalizedPrefix();
  const label = key === "post" ? "Post" : "Page";
  const description = key === "post" ? "Default core post type" : "Default core page type";
  const contentTable = `${prefix}domain_${key}`;
  const metaTable = `${contentTable}_meta`;
  const created = await db
    .insert(dataDomains)
    .values({
      key,
      label,
      contentTable,
      metaTable,
      description,
      settings: { builtin: true },
    })
    .onConflictDoNothing()
    .returning({ id: dataDomains.id, key: dataDomains.key });

  if (created[0]) return created[0];
  const after = await db.query.dataDomains.findFirst({
    where: eq(dataDomains.key, key),
    columns: { id: true, key: true },
  });
  return after ?? null;
}

export async function ensureDefaultCoreDataDomains() {
  const out = new Map<DefaultCoreDomainKey, number>();
  for (const key of DEFAULT_CORE_DOMAIN_KEYS) {
    const row = await ensureOneCoreDomain(key);
    if (row?.id) out.set(key, row.id);
  }
  return out;
}
