import { unstable_cache } from "next/cache";
import db from "./db";
import { isMissingRelationError } from "./db-errors";
import { and, desc, eq, inArray, not } from "drizzle-orm";
import { dataDomains, domainPostMeta, domainPosts, posts, sites, termRelationships, termTaxonomies, termTaxonomyDomains, terms, users } from "./schema";
import { convertTiptapJSONToMarkdown } from "@/lib/convertTiptapJSON";
import { serialize } from "next-mdx-remote/serialize";

function normalizeDomainForLookup(domain: string) {
  return domain.trim().toLowerCase().replace(/:\d+$/, "");
}

function parseSubdomainFromDomain(domain: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const rootDomainRaw = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost";
  const normalizedRootDomain = rootDomainRaw
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
  if (normalizedDomain === normalizedRootDomain) {
    return "main";
  }
  return normalizedDomain.endsWith(`.${normalizedRootDomain}`)
    ? normalizedDomain.replace(`.${normalizedRootDomain}`, "")
    : null;
}

export async function getSiteData(domain: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);

  return unstable_cache(
    async () => {
      return db.query.sites.findFirst({
        where: subdomain
          ? eq(sites.subdomain, subdomain)
          : eq(sites.customDomain, normalizedDomain),
        with: {
          user: true,
        },
      });
    },
    [`${domain}-metadata-v2`],
    {
      revalidate: 900,
      tags: [`${domain}-metadata`],
    },
  )();
}

export async function getPostsForSite(domain: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);

  return await unstable_cache(
    async () => {
      const rows = await db
        .select({
          title: domainPosts.title,
          description: domainPosts.description,
          slug: domainPosts.slug,
          image: domainPosts.image,
          imageBlurhash: domainPosts.imageBlurhash,
          createdAt: domainPosts.createdAt,
        })
        .from(domainPosts)
        .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
        .innerJoin(sites, eq(domainPosts.siteId, sites.id))
        .where(
          and(
            eq(dataDomains.key, "post"),
            subdomain
              ? eq(sites.subdomain, subdomain)
              : eq(sites.customDomain, normalizedDomain),
          )
        )
        .orderBy(desc(domainPosts.createdAt));
      if (rows.length > 0) return rows;
      return db
        .select({
          title: posts.title,
          description: posts.description,
          slug: posts.slug,
          image: posts.image,
          imageBlurhash: posts.imageBlurhash,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .innerJoin(sites, eq(posts.siteId, sites.id))
        .where(
          subdomain
            ? eq(sites.subdomain, subdomain)
            : eq(sites.customDomain, normalizedDomain),
        )
        .orderBy(desc(posts.createdAt));
    },
    [`${domain}-posts-v3`], // cache key
    {
      revalidate: 900, // 15 min fallback revalidation
      tags: [`${domain}-posts`], // 💡 allows manual busting
    }
  )();
}
export async function getPostData(domain: string, slug: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);

  return await unstable_cache(
    async () => {
      const data = await db
        .select({
          post: domainPosts,
          site: sites,
          user: users,
        })
        .from(domainPosts)
        .leftJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
        .leftJoin(sites, eq(sites.id, domainPosts.siteId))
        .leftJoin(users, eq(users.id, sites.userId))
        .where(
          and(
            eq(domainPosts.slug, slug),
            eq(domainPosts.published, true),
            eq(dataDomains.key, "post"),
            subdomain
              ? eq(sites.subdomain, subdomain)
              : eq(sites.customDomain, normalizedDomain),
          ),
        )
        .then((res) => {
          const row = res[0];
          if (!row || !row.post) return null;
          const postData = row.post as Record<string, unknown>;
          const siteData = row.site as Record<string, unknown> | null;
          return {
            ...postData,
            site: siteData
              ? {
                  ...siteData,
                  user: row.user,
                }
              : null,
          };
        });

      if (!data) {
        const legacy = await db
          .select({
            post: posts,
            site: sites,
            user: users,
          })
          .from(posts)
          .leftJoin(sites, eq(sites.id, posts.siteId))
          .leftJoin(users, eq(users.id, sites.userId))
          .where(
            and(
              eq(posts.slug, slug),
              eq(posts.published, true),
              subdomain
                ? eq(sites.subdomain, subdomain)
                : eq(sites.customDomain, normalizedDomain),
            ),
          )
          .then((res) => {
            const row = res[0];
            if (!row || !row.post) return null;
            const postData = row.post as Record<string, unknown>;
            const siteData = row.site as Record<string, unknown> | null;
            return {
              ...postData,
              site: siteData
                ? {
                    ...siteData,
                    user: row.user,
                  }
                : null,
            };
          });
        if (!legacy) return null;
        const typedLegacy = legacy as any;
        const [mdxSource, adjacentPosts] = await Promise.all([
          getMdxSource(typedLegacy.content!),
          db
            .select({
              slug: posts.slug,
              title: posts.title,
              createdAt: posts.createdAt,
              description: posts.description,
              image: posts.image,
              imageBlurhash: posts.imageBlurhash,
            })
            .from(posts)
            .leftJoin(sites, eq(sites.id, posts.siteId))
            .where(
              and(
                eq(posts.published, true),
                not(eq(posts.id, typedLegacy.id)),
                subdomain
                  ? eq(sites.subdomain, subdomain)
                  : eq(sites.customDomain, normalizedDomain),
              ),
            ),
        ]);
        return {
          ...typedLegacy,
          mdxSource,
          adjacentPosts,
        };
      }
      const typedData = data as any;

      const [mdxSource, adjacentPosts, metaRows] = await Promise.all([
        getMdxSource(typedData.content!),
        db
          .select({
            slug: domainPosts.slug,
            title: domainPosts.title,
            createdAt: domainPosts.createdAt,
            description: domainPosts.description,
            image: domainPosts.image,
            imageBlurhash: domainPosts.imageBlurhash,
          })
          .from(domainPosts)
          .leftJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
          .leftJoin(sites, eq(sites.id, domainPosts.siteId))
          .where(
            and(
              eq(domainPosts.published, true),
              eq(dataDomains.key, "post"),
              not(eq(domainPosts.id, typedData.id)),
              subdomain
                ? eq(sites.subdomain, subdomain)
                : eq(sites.customDomain, normalizedDomain),
            ),
          ),
        db
          .select({
            key: domainPostMeta.key,
            value: domainPostMeta.value,
          })
          .from(domainPostMeta)
          .where(eq(domainPostMeta.domainPostId, typedData.id)),
      ]);
      console.log("mdxSource");
      return {
        ...typedData,
        mdxSource,
        adjacentPosts,
        meta: metaRows,
      };
    },
    [`${domain}-${slug}-v3`],
    {
      revalidate: 900, // 15 minutes
      tags: [`${domain}-${slug}`],
    },
  )();
}

export async function getDomainPostData(domain: string, dataDomainKey: string, slug: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);

  return await unstable_cache(
    async () => {
      const data = await db
        .select({
          post: domainPosts,
          site: sites,
          user: users,
          dataDomain: dataDomains,
        })
        .from(domainPosts)
        .leftJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
        .leftJoin(sites, eq(sites.id, domainPosts.siteId))
        .leftJoin(users, eq(users.id, sites.userId))
        .where(
          and(
            eq(domainPosts.slug, slug),
            eq(domainPosts.published, true),
            eq(dataDomains.key, dataDomainKey),
            subdomain
              ? eq(sites.subdomain, subdomain)
              : eq(sites.customDomain, normalizedDomain),
          ),
        )
        .then((res) => {
          const row = res[0];
          if (!row?.post) return null;
          const postRecord = row.post as Record<string, unknown>;
          const siteRecord = row.site as Record<string, unknown> | null;
          return {
            ...postRecord,
            site: siteRecord
              ? {
                  ...siteRecord,
                  user: row.user,
                }
              : null,
            dataDomain: row.dataDomain ?? null,
          };
        });

      if (!data) return null;

      const mdxSource = await getMdxSource((data as any).content ?? "");
      return {
        ...(data as any),
        mdxSource,
        adjacentPosts: [],
      };
    },
    [`${domain}-${dataDomainKey}-${slug}-v1`],
    {
      revalidate: 900,
      tags: [`${domain}-${slug}`],
    },
  )();
}

export async function getDomainPostsForSite(domain: string, dataDomainKey: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);
  return unstable_cache(
    async () =>
      db
        .select({
          id: domainPosts.id,
          title: domainPosts.title,
          description: domainPosts.description,
          slug: domainPosts.slug,
          createdAt: domainPosts.createdAt,
        })
        .from(domainPosts)
        .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
        .innerJoin(sites, eq(sites.id, domainPosts.siteId))
        .where(
          and(
            eq(domainPosts.published, true),
            eq(dataDomains.key, dataDomainKey),
            subdomain
              ? eq(sites.subdomain, subdomain)
              : eq(sites.customDomain, normalizedDomain),
          ),
        )
        .orderBy(desc(domainPosts.createdAt)),
    [`${domain}-${dataDomainKey}-archive-v1`],
    {
      tags: [`${domain}-posts`],
      revalidate: 3600,
    },
  )();
}

function extractFirstImageFromContent(rawContent: unknown): string {
  if (typeof rawContent !== "string" || !rawContent.trim()) return "";
  try {
    const doc = JSON.parse(rawContent);
    const visit = (node: any): string => {
      if (!node || typeof node !== "object") return "";
      if (node.type === "image" && typeof node?.attrs?.src === "string") {
        return node.attrs.src;
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          const found = visit(child);
          if (found) return found;
        }
      }
      return "";
    };
    return visit(doc);
  } catch {
    return "";
  }
}

export async function getFeaturedProjectsForSite(domain: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);
  return await unstable_cache(
    async () => {
      const rows = await db
        .select({
          id: domainPosts.id,
          title: domainPosts.title,
          description: domainPosts.description,
          slug: domainPosts.slug,
          content: domainPosts.content,
          createdAt: domainPosts.createdAt,
          domainKey: dataDomains.key,
        })
        .from(domainPosts)
        .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
        .innerJoin(sites, eq(sites.id, domainPosts.siteId))
        .where(
          and(
            eq(domainPosts.published, true),
            eq(dataDomains.key, "showcase"),
            subdomain
              ? eq(sites.subdomain, subdomain)
              : eq(sites.customDomain, normalizedDomain),
          ),
        )
        .orderBy(desc(domainPosts.createdAt))
        .limit(20);

      if (!rows.length) return [];

      const ids = rows.map((row) => row.id);
      const relRows = await db
        .select({
          objectId: termRelationships.objectId,
          taxonomy: termTaxonomies.taxonomy,
          slug: terms.slug,
          name: terms.name,
        })
        .from(termRelationships)
        .innerJoin(termTaxonomies, eq(termTaxonomies.id, termRelationships.termTaxonomyId))
        .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
        .where(and(eq(termTaxonomies.taxonomy, "category"), inArray(termRelationships.objectId, ids as string[])));

      const metaRows = await db
        .select({
          domainPostId: domainPostMeta.domainPostId,
          key: domainPostMeta.key,
          value: domainPostMeta.value,
        })
        .from(domainPostMeta)
        .where(inArray(domainPostMeta.domainPostId, ids as string[]));

      const termsByObject = new Map<string, Array<{ slug: string | null; name: string | null }>>();
      for (const row of relRows) {
        const list = termsByObject.get(row.objectId) || [];
        list.push({ slug: row.slug, name: row.name });
        termsByObject.set(row.objectId, list);
      }

      const metaByObject = new Map<string, Record<string, string>>();
      for (const row of metaRows) {
        const bag = metaByObject.get(row.domainPostId) || {};
        bag[row.key.trim().toLowerCase()] = row.value;
        metaByObject.set(row.domainPostId, bag);
      }

      const featured = rows
        .filter((row) => {
          const terms = termsByObject.get(row.id) || [];
          return terms.some((term) => (term.slug || "").toLowerCase() === "featured");
        })
        .slice(0, 4)
        .map((row) => {
          const terms = termsByObject.get(row.id) || [];
          const meta = metaByObject.get(row.id) || {};
          const technologyTerms = terms
            .filter((term) => (term.slug || "").toLowerCase() !== "featured")
            .map((term) => term.name || term.slug || "")
            .filter(Boolean);
          const thumbnail =
            meta.thumbnail ||
            meta.thumbnail_image ||
            meta.image ||
            meta.cover ||
            extractFirstImageFromContent(row.content || "");
          const link = meta.link || meta.url || meta.external_url || "";

          return {
            title: row.title || "Untitled Showcase",
            description: row.description || "Showcase entry",
            href: link || `/${domain}/${row.domainKey}/${row.slug}`,
            thumbnail,
            technologies: technologyTerms,
            createdAt: row.createdAt,
          };
        });

      return featured;
    },
    [`${domain}-featured-showcases-v1`],
    {
      revalidate: 900,
      tags: [`${domain}-posts`],
    },
  )();
}

export async function getTaxonomyArchiveData(
  domain: string,
  taxonomy: "category" | "tag",
  termSlug: string,
) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);
  const rows = await unstable_cache(
    async () =>
      db
        .select({
          termName: terms.name,
          termSlug: terms.slug,
          postTitle: domainPosts.title,
          postDescription: domainPosts.description,
          postSlug: domainPosts.slug,
          postCreatedAt: domainPosts.createdAt,
          postDataDomain: dataDomains.key,
        })
        .from(termRelationships)
        .innerJoin(termTaxonomies, eq(termTaxonomies.id, termRelationships.termTaxonomyId))
        .innerJoin(terms, eq(terms.id, termTaxonomies.termId))
        .innerJoin(domainPosts, eq(domainPosts.id, termRelationships.objectId))
        .innerJoin(
          termTaxonomyDomains,
          and(
            eq(termTaxonomyDomains.termTaxonomyId, termTaxonomies.id),
            eq(termTaxonomyDomains.dataDomainId, domainPosts.dataDomainId),
          ),
        )
        .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
        .innerJoin(sites, eq(sites.id, domainPosts.siteId))
        .where(
          and(
            eq(termTaxonomies.taxonomy, taxonomy),
            eq(terms.slug, termSlug),
            eq(domainPosts.published, true),
            subdomain
              ? eq(sites.subdomain, subdomain)
              : eq(sites.customDomain, normalizedDomain),
          ),
        ),
    [`${domain}-${taxonomy}-${termSlug}-v2`],
    {
      revalidate: 900,
      tags: [`${domain}-posts`],
    },
  )();

  if (!rows.length) return null;
  return {
    taxonomy,
    term: {
      name: rows[0].termName,
      slug: rows[0].termSlug,
    },
    posts: rows.map((row) => ({
      title: row.postTitle,
      description: row.postDescription,
      slug: row.postSlug,
      dataDomain: row.postDataDomain,
      createdAt: row.postCreatedAt,
    })),
  };
}
export async function getMdxSource(postContents: string) {
  console.log("🧾 getMdxSource Before Everything:", postContents);
  const json = (() => {
    try {
      return typeof postContents === "string"
        ? JSON.parse(postContents)
        : postContents;
    } catch (err) {
      console.error("❌ Invalid TipTap JSON:", postContents);
      return {};
    }
  })();

  if (!json || json.type !== "doc" || !Array.isArray(json.content)) {
    console.error("🚨 Invalid TipTap JSON structure", json);
    return null;
  }
  console.log("🧾 Before Tiptap:", json);

  const markdown = convertTiptapJSONToMarkdown(json);
  console.log("🧾 Tiptap JSON input:", JSON.stringify(json, null, 2));
  console.log("📝 Converted Markdown:\n", markdown);
  return await serialize(markdown, {
    mdxOptions: {
      remarkPlugins: [],
      format: "mdx",
    },
  });
}

export type SitemapPost = {
  slug: string;
  dataDomain: string;
  siteId: string;
  domain: string;
  updatedAt: Date | null;
};

export async function getAllPosts(): Promise<SitemapPost[]> {
  let results: Array<{
    slug: string;
    dataDomain: string;
    siteId: string | null;
    subdomain: string | null;
    customDomain: string | null;
    updatedAt: Date | null;
  }> = [];

  try {
    results = await db
      .select({
        slug: domainPosts.slug,
        dataDomain: dataDomains.key,
        siteId: domainPosts.siteId,
        subdomain: sites.subdomain,
        customDomain: sites.customDomain,
        updatedAt: domainPosts.updatedAt,
      })
      .from(domainPosts)
      .innerJoin(dataDomains, eq(dataDomains.id, domainPosts.dataDomainId))
      .innerJoin(sites, eq(domainPosts.siteId, sites.id))
      .where(eq(domainPosts.published, true));
  } catch (error) {
    // Fresh installs can build before migrations create CMS tables.
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return results
    .filter((row) => typeof row.siteId === "string" && row.siteId.length > 0)
    .map((row) => ({
    slug: row.slug,
    dataDomain: row.dataDomain || "post",
    siteId: row.siteId as string,
    domain:
      row.customDomain ||
      (row.subdomain === "main"
        ? String(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost")
        : `${row.subdomain || "main"}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost"}`),
    updatedAt: row.updatedAt,
    }));
}
