import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { resolveAuthorizedSiteForAnyCapability } from "@/lib/admin-site-selection";
import { getAllMetaKeys, getTaxonomyOverview, getTaxonomyTerms, getTaxonomyTermsPreview } from "@/lib/actions";
import {
  isEagerEditorTaxonomy,
  normalizeEditorReferenceData,
} from "@/lib/editor-reference-data";

const EDITOR_REFERENCE_CAPABILITIES = [
  "site.content.read",
  "site.content.create",
  "site.content.edit.own",
  "site.content.edit.any",
  "site.content.publish",
] as const;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = String(searchParams.get("siteId") || "").trim();
  if (!requestedSiteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  const { site } = await resolveAuthorizedSiteForAnyCapability(
    session.user.id,
    requestedSiteId,
    [...EDITOR_REFERENCE_CAPABILITIES],
  );
  if (!site) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const requestedTaxonomy = String(searchParams.get("taxonomy") || "")
    .trim()
    .toLowerCase();
  if (requestedTaxonomy) {
    if (isEagerEditorTaxonomy(requestedTaxonomy)) {
      return NextResponse.json(
        {
          error:
            "Eager editor taxonomies are server-seeded on article/item pages and cannot be fetched individually.",
          taxonomy: requestedTaxonomy,
          source: "seeded-eager-taxonomy-disallowed",
        },
        {
          status: 409,
          headers: {
            "x-tooty-editor-reference-source": "seeded-eager-taxonomy-disallowed",
          },
        },
      );
    }
    const limitRaw = searchParams.get("limit");
    const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(200, Number(limitRaw))) : null;
    const rows = limit == null
      ? await getTaxonomyTerms(site.id, requestedTaxonomy)
      : await getTaxonomyTermsPreview(site.id, requestedTaxonomy, limit);
    return NextResponse.json({
      terms: rows.map((row) => ({
        id: row.id,
        name: row.name,
      })),
    });
  }

  const [taxonomyOverviewRows, metaKeySuggestions] = await Promise.all([
    getTaxonomyOverview(site.id),
    getAllMetaKeys(),
  ]);
  const eagerTaxonomies = taxonomyOverviewRows
    .map((row) => row.taxonomy)
    .filter((taxonomy) => isEagerEditorTaxonomy(taxonomy));
  const eagerTermPairs = await Promise.all(
    eagerTaxonomies.map(async (taxonomy) => [
      taxonomy,
      (await getTaxonomyTerms(site.id, taxonomy)).map((row) => ({
        id: row.id,
        name: row.name,
      })),
    ] as const),
  );

  return NextResponse.json(
    normalizeEditorReferenceData({
      taxonomyOverviewRows,
      taxonomyTermsByKey: Object.fromEntries(eagerTermPairs),
      metaKeySuggestions,
    }),
  );
}
