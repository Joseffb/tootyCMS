import { unstable_cache } from "next/cache";
import db from "./db";
import { isMissingRelationError } from "./db-errors";
import { and, desc, eq, inArray, not } from "drizzle-orm";
import { sites, users } from "./schema";
import { getSiteTaxonomyTables, withSiteTaxonomyTableRecovery } from "@/lib/site-taxonomy-tables";
import { convertTiptapJSONToMarkdown } from "@/lib/convertTiptapJSON";
import { serialize } from "next-mdx-remote/serialize";
import {
  getSiteDomainPostBySlug,
  listNetworkDomainPosts,
  listSiteDomainPostMeta,
  listSiteDomainPostMetaMany,
  listSiteDomainPosts,
} from "@/lib/site-domain-post-store";

function normalizeDomainForLookup(domain: string) {
  return domain.trim().toLowerCase().replace(/:\d+$/, "");
}

function normalizeConfiguredHost(value: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase();
}

function parseSubdomainFromDomain(domain: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const normalizedRootDomain =
    normalizeConfiguredHost(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "") || "localhost";
  if (normalizedDomain === normalizedRootDomain) {
    return "main";
  }
  return normalizedDomain.endsWith(`.${normalizedRootDomain}`)
    ? normalizedDomain.replace(`.${normalizedRootDomain}`, "")
    : null;
}

function shouldBypassDataCache() {
  return process.env.NODE_ENV === "test" || process.env.TRACE_PROFILE === "Test";
}

export async function getSiteData(domain: string) {
  const normalizedDomain = normalizeDomainForLookup(domain);
  const subdomain = parseSubdomainFromDomain(normalizedDomain);
  const query = async () =>
    db.query.sites.findFirst({
      where: subdomain
        ? eq(sites.subdomain, subdomain)
        : eq(sites.customDomain, normalizedDomain),
      with: {
        user: true,
      },
    });

  if (shouldBypassDataCache()) {
    return query();
  }

  return unstable_cache(
    query,
    [`${domain}-metadata-v2`],
    {
      revalidate: 900,
      tags: [`${domain}-metadata`],
    },
  )();
}

export async function getPostsForSite(domain: string) {
  return await unstable_cache(
    async () => {
      const site = await getSiteData(domain);
      if (!site?.id) return [];
      const rows = await listSiteDomainPosts({
        siteId: site.id,
        dataDomainKey: "post",
        published: true,
      });
      return rows
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((row) => ({
          title: row.title,
          description: row.description,
          slug: row.slug,
          image: row.image,
          imageBlurhash: row.imageBlurhash,
          createdAt: row.createdAt,
        }));
    },
    [`${domain}-posts-v3`], // cache key
    {
      revalidate: 900,
      tags: [`${domain}-posts`], // 💡 allows manual busting
    }
  )();
}
export async function getPostData(
  domain: string,
  slug: string,
  options?: {
    includeMdxSource?: boolean;
    includeAdjacentPosts?: boolean;
  },
) {
  return await unstable_cache(
    async () => {
      const site = await getSiteData(domain);
      if (!site?.id) return null;
      const post = await getSiteDomainPostBySlug({
        siteId: site.id,
        slug,
        dataDomainKey: "post",
        published: true,
      });
      if (!post) return null;

      const includeMdxSource = options?.includeMdxSource !== false;
      const includeAdjacentPosts = options?.includeAdjacentPosts !== false;

      const [mdxSource, adjacentPosts, metaRows] = await Promise.all([
        includeMdxSource ? getMdxSource(post.content || "") : Promise.resolve(null),
        includeAdjacentPosts
          ? listSiteDomainPosts({
              siteId: site.id,
              dataDomainKey: "post",
              published: true,
            }).then((rows) =>
              rows
                .filter((row) => row.id !== post.id)
                .map((row) => ({
                  slug: row.slug,
                  title: row.title,
                  createdAt: row.createdAt,
                  description: row.description,
                  image: row.image,
                  imageBlurhash: row.imageBlurhash,
                })),
            )
          : Promise.resolve([]),
        listSiteDomainPostMeta({
          siteId: site.id,
          dataDomainKey: "post",
          postId: post.id,
        }),
      ]);

      return {
        ...post,
        site,
        mdxSource,
        adjacentPosts,
        meta: metaRows,
      };
    },
    [`${domain}-${slug}-v4`, options?.includeMdxSource === false ? "no-mdx" : "with-mdx", options?.includeAdjacentPosts === false ? "no-adjacent" : "with-adjacent"],
    {
      revalidate: 900, // 15 minutes
      tags: [`${domain}-${slug}`],
    },
  )();
}

export async function getDomainPostData(domain: string, dataDomainKey: string, slug: string) {
  return await unstable_cache(
    async () => {
      const site = await getSiteData(domain);
      if (!site?.id) return null;
      const post = await getSiteDomainPostBySlug({
        siteId: site.id,
        slug,
        dataDomainKey,
        published: true,
      });
      if (!post) return null;
      const mdxSource = await getMdxSource(post.content ?? "");
      return {
        ...post,
        site,
        dataDomain: {
          id: post.dataDomainId,
          key: post.dataDomainKey,
          label: post.dataDomainLabel,
        },
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
  return unstable_cache(
    async () => {
      const site = await getSiteData(domain);
      if (!site?.id) return [];
      return listSiteDomainPosts({
        siteId: site.id,
        dataDomainKey,
        published: true,
      }).then((rows) =>
        rows
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            content: row.content,
            slug: row.slug,
            createdAt: row.createdAt,
          })),
      );
    },
    [`${domain}-${dataDomainKey}-archive-v2`],
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
  return await unstable_cache(
    async () => {
      const site = await getSiteData(domain);
      if (!site?.id) return [];
      const rows = await listSiteDomainPosts({
        siteId: site.id,
        dataDomainKey: "showcase",
        published: true,
      });
      if (!rows.length) return [];

      const metaRows = await listSiteDomainPostMetaMany({
        siteId: site.id,
        dataDomainKey: "showcase",
        postIds: rows.map((row) => row.id),
      });
      const metaByObject = new Map<string, Record<string, string>>();
      for (const row of metaRows) {
        const bag = metaByObject.get(row.domainPostId) || {};
        bag[row.key.trim().toLowerCase()] = row.value;
        metaByObject.set(row.domainPostId, bag);
      }

      return rows.slice(0, 4).map((row) => {
        const meta = metaByObject.get(row.id) || {};
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
          href: link || `/${domain}/${row.dataDomainKey}/${row.slug}`,
          thumbnail,
          technologies: [],
          createdAt: row.createdAt,
        };
      });
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
  const result = await unstable_cache(
    async () => {
      try {
        const site = await getSiteData(domain);
        if (!site?.id) return null;
        const relationRows = await withSiteTaxonomyTableRecovery(site.id, async () => {
          const { termsTable, termTaxonomiesTable, termRelationshipsTable } = getSiteTaxonomyTables(site.id);
          return db
            .select({
              termName: termsTable.name,
              termSlug: termsTable.slug,
              objectId: termRelationshipsTable.objectId,
            })
            .from(termRelationshipsTable)
            .innerJoin(termTaxonomiesTable, eq(termTaxonomiesTable.id, termRelationshipsTable.termTaxonomyId))
            .innerJoin(termsTable, eq(termsTable.id, termTaxonomiesTable.termId))
            .where(
              and(
                eq(termTaxonomiesTable.taxonomy, taxonomy),
                eq(termsTable.slug, termSlug),
              ),
            );
        });
        if (!relationRows.length) return null;
        const postIds = relationRows.map((row) => String(row.objectId || "")).filter(Boolean);
        if (!postIds.length) return null;
        const posts = await listSiteDomainPosts({
          siteId: site.id,
          ids: postIds,
          published: true,
        });
        if (!posts.length) return null;
        const postById = new Map(posts.map((post) => [post.id, post]));
        const rows = relationRows
          .map((row) => {
            const post = postById.get(String(row.objectId || ""));
            if (!post) return null;
            return {
              termName: row.termName,
              termSlug: row.termSlug,
              postTitle: post.title,
              postDescription: post.description,
              postSlug: post.slug,
              postCreatedAt: post.createdAt,
              postDataDomain: post.dataDomainKey,
            };
          })
          .filter(Boolean) as Array<{
          termName: string | null;
          termSlug: string | null;
          postTitle: string;
          postDescription: string;
          postSlug: string;
          postCreatedAt: Date;
          postDataDomain: string;
        }>;
        if (!rows.length) return null;
        return rows;
      } catch (error) {
        if (isMissingRelationError(error)) return [];
        throw error;
      }
    },
    [`${domain}-${taxonomy}-${termSlug}-v2`],
    {
      revalidate: 900,
      tags: [`${domain}-posts`],
    },
  )();

  if (!result || !result.length) return null;
  const rows = result as Array<{
    termName: string | null;
    termSlug: string | null;
    postTitle: string;
    postDescription: string;
    postSlug: string;
    postDataDomain: string;
    postCreatedAt: Date;
  }>;
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

  const markdown = convertTiptapJSONToMarkdown(json);
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
  const siteRows = await db.query.sites.findMany({
    columns: {
      id: true,
      subdomain: true,
      customDomain: true,
    },
  });
  if (!siteRows.length) return [];
  const posts = await listNetworkDomainPosts({
    siteIds: siteRows.map((site) => site.id),
    published: true,
  });
  const siteMap = new Map(
    siteRows.map((site) => [site.id, { subdomain: site.subdomain, customDomain: site.customDomain }]),
  );
  return posts.map((post) => {
    const site = siteMap.get(post.siteId);
    return {
      slug: post.slug,
      dataDomain: post.dataDomainKey || "post",
      siteId: post.siteId,
      domain:
        site?.customDomain ||
        (site?.subdomain === "main"
          ? String(process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost")
          : `${site?.subdomain || "main"}.${process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost"}`),
      updatedAt: post.updatedAt,
    };
  });
}
