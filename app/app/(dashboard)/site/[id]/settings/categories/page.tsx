import {
  createTaxonomy,
  createTaxonomyTerm,
  deleteTaxonomy,
  deleteTaxonomyTerm,
  getTaxonomyOverview,
  getTaxonomyTerms,
  renameTaxonomy,
  setTaxonomyLabel,
  updateTaxonomyTerm,
} from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Fragment } from "react";
import { getAuthorizedSiteForUser } from "@/lib/authorization";

type Props = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    taxonomy?: string;
  }>;
};

export default async function SiteSettingsCategories({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const id = (await params).id;
  const site = await getAuthorizedSiteForUser(session.user.id, decodeURIComponent(id), "site.settings.write");
  if (!site) {
    notFound();
  }

  const taxonomies = await getTaxonomyOverview();
  const query = (await searchParams) ?? {};
  const selectedTaxonomy =
    query.taxonomy && taxonomies.some((taxonomy) => taxonomy.taxonomy === query.taxonomy)
      ? query.taxonomy
      : null;
  const selectedTerms = selectedTaxonomy ? await getTaxonomyTerms(selectedTaxonomy) : [];
  const termNameById = new Map(selectedTerms.map((term) => [term.id, term.name]));

  return (
    <div className="flex flex-col space-y-6">
      <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-5">
        <h2 className="font-cal text-xl text-stone-900">Categories and Tags</h2>
        <p className="mt-1 text-sm text-stone-600">
          Category is the default system taxonomy; tags remain open vocabulary.
        </p>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-white p-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-stone-700">Create Taxonomy</h3>
        <form
          action={async (formData) => {
            "use server";
            const taxonomy = String(formData.get("taxonomy") ?? "");
            const label = String(formData.get("label") ?? "");
            if (!taxonomy.trim()) return;
            await createTaxonomy({ taxonomy, label });
          }}
          className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input
            name="taxonomy"
            type="text"
            placeholder="genre"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <input
            name="label"
            type="text"
            placeholder="Genre"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
            Create
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Slug</th>
              <th className="px-4 py-2 font-medium">Label</th>
              <th className="px-4 py-2 font-medium">Terms</th>
              <th className="px-4 py-2 font-medium">Usage</th>
              <th className="px-4 py-2 font-medium">Taxonomy Actions</th>
            </tr>
          </thead>
          <tbody>
            {taxonomies.map((taxonomy) => (
              <Fragment key={taxonomy.taxonomy || "taxonomy-row"}>
                <tr
                  className={`border-t border-stone-200 ${selectedTaxonomy === taxonomy.taxonomy ? "bg-amber-50/70" : ""}`}
                >
                  <td className="px-4 py-2">
                    <form
                      action={async (formData) => {
                        "use server";
                        const next = String(formData.get("next") ?? "").trim();
                        if (!next) return;
                        await renameTaxonomy({ current: taxonomy.taxonomy, next });
                      }}
                    >
                    <input
                      name="next"
                      type="text"
                      defaultValue={taxonomy.taxonomy || "category"}
                      aria-label={`Rename taxonomy ${taxonomy.taxonomy}`}
                      title="Click to edit, then press Enter to save"
                      className="w-full border-0 bg-transparent p-0 font-mono text-xs text-stone-700 outline-none ring-0 focus:outline-none focus:ring-0"
                    />
                    <button type="submit" className="sr-only">
                      Save Slug
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2">
                    <form
                      action={async (formData) => {
                        "use server";
                        const label = String(formData.get("label") ?? "").trim();
                        if (!label) return;
                        await setTaxonomyLabel({ taxonomy: taxonomy.taxonomy, label });
                      }}
                    >
                    <input
                      name="label"
                      type="text"
                      defaultValue={taxonomy.label || "Category"}
                      aria-label={`Edit label for ${taxonomy.taxonomy}`}
                      title="Click to edit, then press Enter to save"
                      className="w-full border-0 bg-transparent p-0 text-sm text-stone-800 outline-none ring-0 focus:outline-none focus:ring-0"
                    />
                    <button type="submit" className="sr-only">
                      Save Label
                    </button>
                  </form>
                </td>
                  <td className="px-4 py-2">{taxonomy.termCount}</td>
                  <td className="px-4 py-2">{taxonomy.usageCount}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={
                          selectedTaxonomy === taxonomy.taxonomy
                            ? `/site/${site.id}/settings/categories`
                            : `?taxonomy=${encodeURIComponent(taxonomy.taxonomy)}`
                        }
                        className="rounded border border-cyan-300 px-2 py-1 text-xs text-cyan-700 hover:bg-cyan-50"
                      >
                        {selectedTaxonomy === taxonomy.taxonomy ? "Hide terms" : "Click to show terms"}
                      </Link>
                      <form
                        action={async () => {
                          "use server";
                          await deleteTaxonomy(taxonomy.taxonomy);
                        }}
                      >
                        <button type="submit" className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
                {selectedTaxonomy === taxonomy.taxonomy && (
                  <tr className="border-t border-stone-200 bg-cyan-50/60">
                    <td colSpan={5} className="px-4 py-4">
                      <div className="rounded-lg border border-cyan-200 bg-white p-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold uppercase tracking-[0.08em] text-stone-700">
                            Terms for {taxonomy.taxonomy}
                          </h4>
                        </div>
                        <form
                          action={async (formData) => {
                            "use server";
                            const label = String(formData.get("label") ?? "");
                            const parentRaw = String(formData.get("parentId") ?? "");
                            const parentId = parentRaw ? Number(parentRaw) : null;
                            if (!label.trim()) return;
                            await createTaxonomyTerm({
                              taxonomy: taxonomy.taxonomy,
                              label,
                              parentId: Number.isFinite(parentId) ? parentId : null,
                            });
                          }}
                          className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                        >
                          <input name="label" type="text" placeholder="New term" className="rounded-md border border-stone-300 px-3 py-2 text-sm" />
                          <select name="parentId" className="rounded-md border border-stone-300 px-3 py-2 text-sm">
                            <option value="">No parent</option>
                            {selectedTerms.map((term) => (
                              <option key={`parent-${term.id}`} value={term.id}>
                                {term.name}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700">
                            Add Term
                          </button>
                        </form>

                        <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
                          <table className="w-full text-sm">
                            <thead className="bg-stone-50 text-left">
                              <tr>
                                <th className="px-4 py-2 font-medium">Term</th>
                                <th className="px-4 py-2 font-medium">Slug</th>
                                <th className="px-4 py-2 font-medium">Parent</th>
                                <th className="px-4 py-2 font-medium">Usage</th>
                                <th className="px-4 py-2 font-medium">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedTerms.map((term) => (
                                <tr key={term.id} className="border-t border-stone-200">
                                  <td className="px-4 py-2">
                                    <form
                                      action={async (formData) => {
                                        "use server";
                                        const label = String(formData.get("label") ?? "").trim();
                                        const slug = String(formData.get("slug") ?? "").trim();
                                        if (!label) return;
                                        await updateTaxonomyTerm({ termTaxonomyId: term.id, label, slug });
                                      }}
                                    >
                                      <input
                                        name="label"
                                        type="text"
                                        defaultValue={term.name}
                                        aria-label={`Edit term ${term.name}`}
                                        title="Click to edit, then press Enter to save"
                                        className="w-full border-0 bg-transparent p-0 text-sm text-stone-800 outline-none ring-0 focus:outline-none focus:ring-0"
                                      />
                                      <input type="hidden" name="slug" value={term.slug} />
                                    </form>
                                  </td>
                                  <td className="px-4 py-2">
                                    <form
                                      action={async (formData) => {
                                        "use server";
                                        const label = String(formData.get("label") ?? "").trim();
                                        const slug = String(formData.get("slug") ?? "").trim();
                                        if (!label) return;
                                        await updateTaxonomyTerm({ termTaxonomyId: term.id, label, slug });
                                      }}
                                    >
                                      <input
                                        name="slug"
                                        type="text"
                                        defaultValue={term.slug}
                                        aria-label={`Edit slug for ${term.name}`}
                                        title="Click to edit, then press Enter to save"
                                        className="w-full border-0 bg-transparent p-0 font-mono text-xs text-stone-500 outline-none ring-0 focus:outline-none focus:ring-0"
                                      />
                                      <input type="hidden" name="label" value={term.name} />
                                    </form>
                                  </td>
                                  <td className="px-4 py-2">
                                    <form
                                      action={async (formData) => {
                                        "use server";
                                        const parentRaw = String(formData.get("parentId") ?? "");
                                        const parentId = parentRaw ? Number(parentRaw) : null;
                                        await updateTaxonomyTerm({
                                          termTaxonomyId: term.id,
                                          parentId: Number.isFinite(parentId) ? parentId : null,
                                        });
                                      }}
                                      className="flex items-center gap-2"
                                    >
                                      <select
                                        name="parentId"
                                        defaultValue={term.parentId ? String(term.parentId) : ""}
                                        aria-label={`Edit parent for ${term.name}`}
                                        className="w-full rounded border border-stone-300 px-2 py-1 text-xs text-stone-700"
                                      >
                                        <option value="">No parent</option>
                                        {selectedTerms
                                          .filter((candidate) => candidate.id !== term.id)
                                          .map((candidate) => (
                                            <option key={`row-parent-${term.id}-${candidate.id}`} value={candidate.id}>
                                              {candidate.name}
                                            </option>
                                          ))}
                                      </select>
                                      <button type="submit" className="rounded border border-cyan-300 px-2 py-1 text-xs text-cyan-700 hover:bg-cyan-50">
                                        Save
                                      </button>
                                    </form>
                                    {term.parentId ? (
                                      <p className="mt-1 text-[11px] text-stone-500">
                                        Parent: {termNameById.get(term.parentId) ?? `#${term.parentId}`}
                                      </p>
                                    ) : null}
                                  </td>
                                  <td className="px-4 py-2">{term.usageCount}</td>
                                  <td className="px-4 py-2">
                                    <form
                                      action={async () => {
                                        "use server";
                                        await deleteTaxonomyTerm(term.id);
                                      }}
                                    >
                                      <button type="submit" className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">
                                        Delete
                                      </button>
                                    </form>
                                  </td>
                                </tr>
                              ))}
                              {selectedTerms.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="px-4 py-4 text-stone-500">
                                    No terms yet for this taxonomy.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
