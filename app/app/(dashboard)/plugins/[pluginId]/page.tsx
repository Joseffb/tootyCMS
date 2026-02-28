import { getSession } from "@/lib/auth";
import { getPluginById, getPluginConfig, savePluginConfig } from "@/lib/plugin-runtime";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest } from "@/lib/plugin-runtime";
import { sendCommunication } from "@/lib/communications";
import MigrationKitConsole from "@/components/migration-kit-console";
import CarouselOrderManager from "@/components/plugins/carousel-order-manager";
import db from "@/lib/db";
import { dataDomains, domainPostMeta, domainPosts } from "@/lib/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { listSiteIdsForUser } from "@/lib/site-user-tables";

type Props = {
  params: Promise<{ pluginId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PluginSetupPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const resolvedSearchParams = (await searchParams) || {};
  const tab = String(resolvedSearchParams.tab || "settings").trim().toLowerCase();
  const selectedSiteId = String(resolvedSearchParams.siteId || "").trim();
  const pluginId = decodeURIComponent((await params).pluginId);
  const plugin = await getPluginById(pluginId);
  if (!plugin) notFound();
  const pluginData = plugin;
  const config = (await getPluginConfig(pluginData.id)) as Record<string, unknown>;
  const isCarousels = pluginData.id === "tooty-carousels";

  const accessibleSiteIds = await listSiteIdsForUser(session.user.id);
  const ownedSites = await db.query.sites.findMany({
    where: accessibleSiteIds.length
      ? (sites) => inArray(sites.id, accessibleSiteIds)
      : (sites) => inArray(sites.id, ["__none__"]),
    columns: { id: true, name: true, isPrimary: true, subdomain: true },
    orderBy: (sites, { asc }) => [asc(sites.name), asc(sites.subdomain), asc(sites.id)],
  });
  const mainOwnedSiteId =
    ownedSites.find((site) => site.isPrimary || site.subdomain === "main")?.id || ownedSites[0]?.id || "";
  const effectiveSiteId = selectedSiteId || (ownedSites.length === 1 ? mainOwnedSiteId : "");
  const migrationRedirectSuffix = selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : "";

  const isDevTools = pluginData.id === "dev-tools";
  const isMigrationKit = pluginData.id === "export-import";
  const canUseSendMessageTool = await userCan("network.plugins.manage", session.user.id);
  const kernel = await createKernelForRequest(effectiveSiteId || undefined);
  const providers = kernel.getAllPluginCommunicationProviders().map((provider) => ({
    id: `${provider.pluginId}:${provider.id}`,
    label: `${provider.pluginId}:${provider.id}`,
    channels: provider.channels,
  }));
  const migrationResponse = isMigrationKit
      ? await kernel.applyFilters<Response | null>("domain:query", null, {
        name: "export_import.providers",
        params: { siteId: effectiveSiteId || undefined },
      })
    : null;
  const migrationProviderPayload =
    migrationResponse && migrationResponse.ok
      ? ((await migrationResponse.json().catch(() => null)) as {
          providers?: Array<{
            id: string;
            label: string;
            version?: string;
            source?: string;
            enabled?: boolean;
            networkRequired?: boolean;
            capabilities?: { export?: boolean; import?: boolean; inspect?: boolean; apply?: boolean };
          }>;
        } | null)
      : null;
  const migrationProviders = Array.isArray(migrationProviderPayload?.providers)
    ? migrationProviderPayload.providers
    : [];

  if (isCarousels) {
    const canManageCarousels = effectiveSiteId
      ? await userCan("site.settings.write", session.user.id, { siteId: effectiveSiteId })
      : canUseSendMessageTool;
    if (effectiveSiteId && !canManageCarousels) {
      redirect("/app");
    }

    const carouselDomain = effectiveSiteId
      ? await db.query.dataDomains.findFirst({
          where: eq(dataDomains.key, "carousel"),
          columns: { id: true },
        })
      : null;

    const slides = effectiveSiteId && carouselDomain
      ? await (async () => {
          const rows = await db
            .select({
              id: domainPosts.id,
              title: domainPosts.title,
              description: domainPosts.description,
              image: domainPosts.image,
              published: domainPosts.published,
              createdAt: domainPosts.createdAt,
            })
            .from(domainPosts)
            .where(
              and(
                eq(domainPosts.siteId, effectiveSiteId),
                eq(domainPosts.dataDomainId, carouselDomain.id),
              ),
            )
            .orderBy(asc(domainPosts.createdAt));

          const ids = rows.map((row) => row.id);
          const metaRows = ids.length
            ? await db
                .select({
                  domainPostId: domainPostMeta.domainPostId,
                  key: domainPostMeta.key,
                  value: domainPostMeta.value,
                })
                .from(domainPostMeta)
                .where(
                  and(
                    inArray(domainPostMeta.domainPostId, ids),
                    inArray(domainPostMeta.key, ["cta_text", "cta_url", "panel_status", "sort_order"]),
                  ),
                )
            : [];

          const metaByPost = new Map<string, Record<string, string>>();
          for (const row of metaRows) {
            const bucket = metaByPost.get(row.domainPostId) || {};
            bucket[row.key] = row.value;
            metaByPost.set(row.domainPostId, bucket);
          }

          return rows
            .map((row) => {
              const meta = metaByPost.get(row.id) || {};
              const sortOrder = Number(meta.sort_order || "");
              return {
                ...row,
                meta,
                sortOrder: Number.isFinite(sortOrder) ? sortOrder : 999,
              };
            })
            .sort((a, b) => {
              if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
              return a.createdAt.getTime() - b.createdAt.getTime();
            });
        })()
      : [];

    async function saveCarouselSlide(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      if (!siteId) return;
      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await createKernelForRequest(siteId);
      const carousel = await db.query.dataDomains.findFirst({
        where: eq(dataDomains.key, "carousel"),
        columns: { id: true },
      });
      if (!carousel) return;

      const slideId = String(formData.get("slideId") || "").trim();
      const title = String(formData.get("title") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const image = String(formData.get("image") || "").trim();
      const ctaText = String(formData.get("cta_text") || "").trim();
      const ctaUrl = String(formData.get("cta_url") || "").trim();
      const panelStatus = String(formData.get("panel_status") || "").trim();
      const sortOrderRaw = Number(String(formData.get("sort_order") || "").trim() || "0");
      const sortOrder = Number.isFinite(sortOrderRaw) ? Math.max(0, Math.trunc(sortOrderRaw)) : 0;
      const published = formData.get("published") === "on";
      if (!title) return;
      const targetId = slideId || createId();

      if (slideId) {
        await db
          .update(domainPosts)
          .set({
            title,
            description,
            image,
            published,
            updatedAt: new Date(),
          })
          .where(and(eq(domainPosts.id, slideId), eq(domainPosts.siteId, siteId), eq(domainPosts.dataDomainId, carousel.id)));
      } else {
        await db.insert(domainPosts).values({
          id: targetId,
          dataDomainId: carousel.id,
          title,
          description,
          content: "",
          slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "carousel-slide"}-${Date.now()}`,
          image,
          published,
          siteId,
          userId: current.user.id,
        });
      }

      const metaEntries = [
        { key: "cta_text", value: ctaText },
        { key: "cta_url", value: ctaUrl },
        { key: "panel_status", value: panelStatus },
        { key: "sort_order", value: String(sortOrder) },
      ];
      for (const entry of metaEntries) {
        await db
          .insert(domainPostMeta)
          .values({
            domainPostId: targetId,
            key: entry.key,
            value: entry.value,
          })
          .onConflictDoUpdate({
            target: [domainPostMeta.domainPostId, domainPostMeta.key],
            set: {
              value: entry.value,
              updatedAt: new Date(),
            },
          });
      }

      revalidatePath(`/app/plugins/tooty-carousels?tab=slides&siteId=${encodeURIComponent(siteId)}`);
      revalidatePath(`/app/site/${siteId}/settings/plugins`);
      redirect(`/app/plugins/tooty-carousels?tab=slides&siteId=${encodeURIComponent(siteId)}&saved=1`);
    }

    async function deleteCarouselSlide(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const slideId = String(formData.get("slideId") || "").trim();
      const confirm = String(formData.get("confirm") || "").trim().toLowerCase();
      if (!siteId || !slideId || confirm !== "delete") return;

      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      await db.delete(domainPostMeta).where(eq(domainPostMeta.domainPostId, slideId));
      await db.delete(domainPosts).where(and(eq(domainPosts.id, slideId), eq(domainPosts.siteId, siteId)));

      revalidatePath(`/app/plugins/tooty-carousels?tab=slides&siteId=${encodeURIComponent(siteId)}`);
      revalidatePath(`/app/site/${siteId}/settings/plugins`);
      redirect(`/app/plugins/tooty-carousels?tab=slides&siteId=${encodeURIComponent(siteId)}&deleted=1`);
    }

    async function reorderCarouselSlides(formData: FormData) {
      "use server";
      const current = await getSession();
      if (!current?.user?.id) redirect("/login");

      const siteId = String(formData.get("siteId") || "").trim();
      const rawOrder = String(formData.get("order") || "").trim();
      if (!siteId || !rawOrder) return;

      const allowed = await userCan("site.settings.write", current.user.id, { siteId });
      if (!allowed) return;

      let parsed: Array<{ id: string; sortOrder: number }> = [];
      try {
        const candidate = JSON.parse(rawOrder);
        if (Array.isArray(candidate)) {
          parsed = candidate
            .map((entry) => ({
              id: String((entry as any)?.id || "").trim(),
              sortOrder: Number((entry as any)?.sortOrder),
            }))
            .filter((entry) => entry.id && Number.isFinite(entry.sortOrder));
        }
      } catch {
        parsed = [];
      }
      if (!parsed.length) return;

      for (const entry of parsed) {
        await db
          .insert(domainPostMeta)
          .values({
            domainPostId: entry.id,
            key: "sort_order",
            value: String(Math.max(0, Math.trunc(entry.sortOrder))),
          })
          .onConflictDoUpdate({
            target: [domainPostMeta.domainPostId, domainPostMeta.key],
            set: {
              value: String(Math.max(0, Math.trunc(entry.sortOrder))),
              updatedAt: new Date(),
            },
          });
      }

      revalidatePath(`/app/plugins/tooty-carousels?tab=slides&siteId=${encodeURIComponent(siteId)}`);
      revalidatePath(`/`);
    }

    return (
      <div className="flex max-w-5xl flex-col gap-6 p-8">
        <div>
          <h1 className="font-cal text-3xl font-bold">{pluginData.name}</h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
            Carousel entries are managed here. The underlying `carousel` data domain is intentionally hidden from the main content menu.
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="slides" />
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Site</span>
            <select
              name="siteId"
              defaultValue={effectiveSiteId}
              className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-black"
            >
              <option value="">Select a site</option>
              {ownedSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name || site.subdomain || site.id}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white">
            Open Site
          </button>
        </form>

        {effectiveSiteId ? (
          <>
            <CarouselOrderManager
              siteId={effectiveSiteId}
              slides={slides.map((slide) => ({
                id: slide.id,
                title: slide.title || "Untitled",
                sortOrder: slide.sortOrder,
                status: slide.meta.panel_status || (slide.published ? "Published" : "Draft"),
              }))}
              saveOrderAction={reorderCarouselSlides}
            />

            <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
              <h2 className="font-cal text-xl dark:text-white">Add Slide</h2>
              <form action={saveCarouselSlide} className="mt-4 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="siteId" value={effectiveSiteId} />
                <label className="grid gap-1 text-sm">
                  <span>Title</span>
                  <input name="title" required className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Image URL</span>
                  <input name="image" className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                </label>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span>Description</span>
                  <textarea name="description" rows={3} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>CTA Text</span>
                  <input name="cta_text" className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>CTA URL</span>
                  <input name="cta_url" className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Sort Order</span>
                  <input name="sort_order" type="number" defaultValue="0" className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>Status</span>
                  <select name="panel_status" className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black">
                    <option value="">Live</option>
                    <option value="coming-soon">Coming Soon</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input name="published" type="checkbox" defaultChecked className="h-4 w-4 rounded border-stone-300" />
                  Published
                </label>
                <div className="md:col-span-2">
                  <button className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white">
                    Save Slide
                  </button>
                </div>
              </form>
            </div>

            <div className="grid gap-4">
              {slides.map((slide) => (
                <div key={slide.id} className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold dark:text-white">{slide.title || "Untitled"}</h3>
                      <p className="text-xs text-stone-500">Sort order: {slide.sortOrder}</p>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs ${slide.published ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-700"}`}>
                      {slide.published ? "Published" : "Draft"}
                    </span>
                  </div>
                  <form action={saveCarouselSlide} className="grid gap-3 md:grid-cols-2">
                    <input type="hidden" name="siteId" value={effectiveSiteId} />
                    <input type="hidden" name="slideId" value={slide.id} />
                    <label className="grid gap-1 text-sm">
                      <span>Title</span>
                      <input name="title" defaultValue={slide.title || ""} required className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>Image URL</span>
                      <input name="image" defaultValue={slide.image || ""} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                    </label>
                    <label className="grid gap-1 text-sm md:col-span-2">
                      <span>Description</span>
                      <textarea name="description" rows={3} defaultValue={slide.description || ""} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>CTA Text</span>
                      <input name="cta_text" defaultValue={slide.meta.cta_text || ""} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>CTA URL</span>
                      <input name="cta_url" defaultValue={slide.meta.cta_url || ""} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>Sort Order</span>
                      <input name="sort_order" type="number" defaultValue={String(slide.meta.sort_order || slide.sortOrder || 0)} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black" />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span>Status</span>
                      <select name="panel_status" defaultValue={slide.meta.panel_status || ""} className="rounded-md border border-stone-300 px-3 py-2 dark:border-stone-700 dark:bg-black">
                        <option value="">Live</option>
                        <option value="coming-soon">Coming Soon</option>
                      </select>
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
                      <input name="published" type="checkbox" defaultChecked={slide.published} className="h-4 w-4 rounded border-stone-300" />
                      Published
                    </label>
                    <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                      <button className="rounded-md border border-black bg-black px-3 py-2 text-xs font-semibold text-white">
                        Save Slide
                      </button>
                    </div>
                  </form>
                  <form action={deleteCarouselSlide} className="mt-3 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="siteId" value={effectiveSiteId} />
                    <input type="hidden" name="slideId" value={slide.id} />
                    <label className="grid gap-1 text-xs">
                      <span>Type delete to remove</span>
                      <input name="confirm" className="rounded-md border border-rose-200 px-2 py-1 dark:border-rose-800 dark:bg-black" />
                    </label>
                    <button className="rounded-md border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:hover:bg-rose-950/30">
                      Delete Slide
                    </button>
                  </form>
                </div>
              ))}
              {slides.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                  No slides yet for this site.
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
            Select a site to manage carousel slides.
          </div>
        )}
      </div>
    );
  }

  async function sendMessage(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) throw new Error("Not authenticated.");
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) throw new Error("Network admin required.");

    const providerId = String(formData.get("providerId") || "").trim();
    const from = String(formData.get("from") || "").trim();
    const to = String(formData.get("to") || "").trim();
    const cc = String(formData.get("cc") || "").trim();
    const bcc = String(formData.get("bcc") || "").trim();
    const replyTo = String(formData.get("replyTo") || "").trim();
    const subject = String(formData.get("subject") || "").trim();
    const body = String(formData.get("body") || "").trim();
    if (!to) throw new Error("To is required.");
    if (!body) throw new Error("Body is required.");

    await sendCommunication(
      {
        channel: "email",
        to,
        subject,
        body,
        category: "transactional",
        metadata: {
          from,
          cc,
          bcc,
          replyTo,
          preferredProvider: providerId,
          sentFrom: "dev-tools:send-message",
        },
      },
      { createdByUserId: current.user.id },
    );
  }

  async function save(formData: FormData) {
    "use server";
    const nextConfig: Record<string, unknown> = {};
    for (const field of pluginData.settingsFields || []) {
      if (field.type === "checkbox") {
        nextConfig[field.key] = formData.get(field.key) === "on";
      } else {
        nextConfig[field.key] = String(formData.get(field.key) || "");
      }
    }
    await savePluginConfig(pluginData.id, nextConfig);
    revalidatePath(`/plugins/${pluginData.id}`);
    revalidatePath(`/app/plugins/${pluginData.id}`);
    redirect(`/app/plugins/${pluginData.id}?tab=settings&saved=1`);
  }

  async function toggleMigrationProvider(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;

    const providerId = String(formData.get("providerId") || "").trim().toLowerCase();
    const nextEnabled = String(formData.get("enabled") || "") === "on";
    if (!providerId) return;

    const currentConfig = (await getPluginConfig("export-import")) as Record<string, unknown>;
    const rawDisabled = currentConfig.disabledProviders;
    const rawRequired = currentConfig.networkRequiredProviders;
    const disabled = new Set(
      Array.isArray(rawDisabled)
        ? rawDisabled.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawDisabled || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawDisabled || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );
    const requiredSet = new Set(
      Array.isArray(rawRequired)
        ? rawRequired.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawRequired || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawRequired || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );

    if (nextEnabled) disabled.delete(providerId);
    else {
      disabled.add(providerId);
      // Mirror plugin network behavior: disabled providers cannot remain network-required.
      requiredSet.delete(providerId);
    }

    await savePluginConfig("export-import", {
      ...currentConfig,
      disabledProviders: Array.from(disabled.values()),
      networkRequiredProviders: Array.from(requiredSet.values()),
    });
    revalidatePath("/plugins/export-import");
    revalidatePath("/app/plugins/export-import");
    redirect(`/app/plugins/export-import?tab=providers&saved=1${migrationRedirectSuffix}`);
  }

  async function toggleMigrationProviderNetworkRequired(formData: FormData) {
    "use server";
    const current = await getSession();
    if (!current?.user?.id) return;
    const allowed = await userCan("network.plugins.manage", current.user.id);
    if (!allowed) return;

    const providerId = String(formData.get("providerId") || "").trim().toLowerCase();
    const nextRequired = String(formData.get("required") || "") === "on";
    if (!providerId) return;

    const currentConfig = (await getPluginConfig("export-import")) as Record<string, unknown>;
    const rawRequired = currentConfig.networkRequiredProviders;
    const rawDisabled = currentConfig.disabledProviders;
    const requiredSet = new Set(
      Array.isArray(rawRequired)
        ? rawRequired.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawRequired || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawRequired || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );
    const disabled = new Set(
      Array.isArray(rawDisabled)
        ? rawDisabled.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(String(rawDisabled || "[]"));
              if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
              }
            } catch {
              // noop
            }
            return String(rawDisabled || "")
              .split(",")
              .map((item) => item.trim().toLowerCase())
              .filter(Boolean);
          })(),
    );

    if (nextRequired) {
      requiredSet.add(providerId);
      // Mirror plugin network behavior: network-required implies enabled.
      disabled.delete(providerId);
    }
    else requiredSet.delete(providerId);

    await savePluginConfig("export-import", {
      ...currentConfig,
      networkRequiredProviders: Array.from(requiredSet.values()),
      disabledProviders: Array.from(disabled.values()),
    });
    revalidatePath("/plugins/export-import");
    revalidatePath("/app/plugins/export-import");
    redirect(`/app/plugins/export-import?tab=providers&saved=1${migrationRedirectSuffix}`);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="font-cal text-3xl font-bold">{pluginData.name}</h1>
      {pluginData.developer ? (
        <p className="text-xs text-stone-500 italic">
          by{" "}
          {pluginData.website ? (
            <a href={pluginData.website} target="_blank" rel="noreferrer">
              {pluginData.developer}
            </a>
          ) : (
            pluginData.developer
          )}
        </p>
      ) : null}
      <p className="text-sm text-stone-600">{pluginData.description}</p>

      {isMigrationKit ? (
        <>
          <div className="flex gap-2 border-b border-stone-200 pb-2">
            <Link
              href={`/plugins/${pluginData.id}?tab=settings${selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : ""}`}
              className={`rounded border px-3 py-1 text-sm ${tab === "settings" ? "border-stone-700 bg-stone-700 text-white" : "border-stone-300 bg-white text-black"}`}
            >
              Settings
            </Link>
            <Link
              href={`/plugins/${pluginData.id}?tab=providers${selectedSiteId ? `&siteId=${encodeURIComponent(selectedSiteId)}` : ""}`}
              className={`rounded border px-3 py-1 text-sm ${tab === "providers" ? "border-stone-700 bg-stone-700 text-white" : "border-stone-300 bg-white text-black"}`}
            >
              Providers
            </Link>
          </div>

          {tab === "providers" ? (
            <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-5 text-black">
              <div>
                <h2 className="font-cal text-xl text-black">Child Providers</h2>
                <p className="text-xs text-black">
                  Child plugins install normally, then appear here for enable/disable control.
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-white text-left text-black">
                    <tr>
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Capabilities</th>
                      <th className="px-3 py-2">Enabled</th>
                      <th className="px-3 py-2">Network</th>
                    </tr>
                  </thead>
                  <tbody>
                    {migrationProviders.map((provider) => (
                      <tr key={provider.id} className="border-t border-stone-200">
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-black">{provider.label || provider.id}</p>
                          <p className="text-xs text-black">{provider.id}</p>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-black">
                          {(provider.source || "plugin").toString()}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-black">
                          {[
                            provider.capabilities?.export ? "export" : null,
                            provider.capabilities?.import ? "import" : null,
                            provider.capabilities?.inspect ? "inspect" : null,
                            provider.capabilities?.apply ? "apply" : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "-"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <form action={toggleMigrationProvider}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input type="hidden" name="enabled" value={provider.enabled === false ? "on" : ""} />
                            <button
                              type="submit"
                              title={provider.enabled === false ? "Enable provider" : "Disable provider"}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                                provider.enabled === false
                                  ? "border-stone-500 bg-stone-600"
                                  : "border-emerald-700 bg-emerald-700"
                              }`}
                            >
                              {provider.enabled === false ? "Disabled" : "Enabled"}
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    provider.enabled === false
                                      ? "bg-stone-300/70"
                                      : "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <form action={toggleMigrationProviderNetworkRequired}>
                            <input type="hidden" name="providerId" value={provider.id} />
                            <input type="hidden" name="required" value={provider.networkRequired === true ? "" : "on"} />
                            <button
                              type="submit"
                              title={provider.networkRequired === true ? "Set provider as optional" : "Set provider as network required"}
                              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] ${
                                provider.networkRequired === true
                                  ? "border-emerald-700 bg-emerald-700"
                                  : "border-stone-500 bg-stone-600"
                              }`}
                            >
                              Network
                              <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full border border-black/30 bg-black/20">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${
                                    provider.networkRequired === true
                                      ? "bg-lime-300 shadow-[0_0_6px_rgba(163,230,53,0.95)]"
                                      : "bg-stone-300/70"
                                  }`}
                                />
                              </span>
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                    {migrationProviders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-sm text-black">
                          No providers registered yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <MigrationKitConsole siteId={selectedSiteId || null} providers={migrationProviders} />
          )}
        </>
      ) : isDevTools ? (
        <>
          <div className="flex gap-2 border-b border-stone-200 pb-2 dark:border-stone-700">
            <Link
              href={`/plugins/${pluginData.id}?tab=settings`}
              className={`rounded border px-3 py-1 text-sm ${tab === "settings" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black dark:border-stone-600 dark:bg-stone-900 dark:text-white"}`}
            >
              Settings
            </Link>
            <Link
              href={`/plugins/${pluginData.id}?tab=send-message`}
              className={`rounded border px-3 py-1 text-sm ${tab === "send-message" ? "border-black bg-black text-white" : "border-stone-300 bg-white text-black dark:border-stone-600 dark:bg-stone-900 dark:text-white"}`}
            >
              Send Message
            </Link>
          </div>

          {tab === "send-message" ? (
            canUseSendMessageTool ? (
              <form action={sendMessage} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
                <h2 className="font-cal text-xl dark:text-white">Send Message</h2>
                <p className="text-xs text-stone-500">Network-admin test compose tool for communication providers.</p>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Provider</span>
                  <select name="providerId" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white">
                    <option value="">Auto select (by channel)</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label} [{provider.channels.join(", ")}]
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">From</span>
                  <input name="from" placeholder="noreply@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">To</span>
                  <input name="to" required placeholder="recipient@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">CC</span>
                  <input name="cc" placeholder="cc@example.com, cc2@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">BCC</span>
                  <input name="bcc" placeholder="bcc@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Reply-To</span>
                  <input name="replyTo" placeholder="reply@example.com" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Subject</span>
                  <input name="subject" placeholder="Message subject" className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800 dark:text-stone-100">Body</span>
                  <textarea name="body" required rows={8} placeholder="Compose message..." className="rounded-md border border-stone-300 px-2 py-1 dark:border-stone-600 dark:bg-stone-900 dark:text-white" />
                </label>
                <button className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Send Message</button>
              </form>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Network admin permission is required to use Send Message.
              </div>
            )
          ) : (pluginData.settingsFields || []).length > 0 ? (
            <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
              {(pluginData.settingsFields || []).map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-stone-800">{field.label}</span>
                  {field.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      name={field.key}
                      defaultChecked={
                        config[field.key] === undefined || config[field.key] === null
                          ? ["true", "1", "yes", "on"].includes(String(field.defaultValue ?? "").trim().toLowerCase())
                          : Boolean(config[field.key])
                      }
                      className="h-4 w-4"
                    />
                  ) : field.type === "select" ? (
                    <select
                      name={field.key}
                      defaultValue={String(config[field.key] || field.defaultValue || "")}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    >
                      {(field.options || []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      name={field.key}
                      defaultValue={String(config[field.key] || "")}
                      placeholder={field.placeholder || ""}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    />
                  ) : (
                    <input
                      type={field.type || "text"}
                      name={field.key}
                      defaultValue={String(config[field.key] || "")}
                      placeholder={field.placeholder || ""}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    />
                  )}
                  {typeof field.helpText === "string" && field.helpText.trim().length > 0 ? (
                    <span className="text-xs text-stone-500">{field.helpText}</span>
                  ) : null}
                </label>
              ))}
              <button className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Save</button>
            </form>
          ) : (
            <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
          )}
        </>
      ) : (pluginData.settingsFields || []).length > 0 ? (
        <form action={save} className="grid gap-3 rounded-lg border border-stone-200 bg-white p-5">
          {(pluginData.settingsFields || []).map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-stone-800">{field.label}</span>
              {field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  name={field.key}
                  defaultChecked={
                    config[field.key] === undefined || config[field.key] === null
                      ? ["true", "1", "yes", "on"].includes(String(field.defaultValue ?? "").trim().toLowerCase())
                      : Boolean(config[field.key])
                  }
                  className="h-4 w-4"
                />
              ) : field.type === "select" ? (
                <select
                  name={field.key}
                  defaultValue={String(config[field.key] || field.defaultValue || "")}
                  className="rounded-md border border-stone-300 px-2 py-1"
                >
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  name={field.key}
                  defaultValue={String(config[field.key] || "")}
                  placeholder={field.placeholder || ""}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              ) : (
                <input
                  type={field.type || "text"}
                  name={field.key}
                  defaultValue={String(config[field.key] || "")}
                  placeholder={field.placeholder || ""}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              )}
              {typeof field.helpText === "string" && field.helpText.trim().length > 0 ? (
                <span className="text-xs text-stone-500">{field.helpText}</span>
              ) : null}
            </label>
          ))}
          <button className="w-fit rounded-md border border-stone-700 bg-stone-700 px-3 py-2 text-sm text-white">Save</button>
        </form>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">No plugin settings fields defined.</div>
      )}
    </div>
  );
}
