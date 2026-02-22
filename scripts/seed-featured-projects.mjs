#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;

function qi(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function table(prefix, suffix) {
  const normalized = prefix.endsWith("_") ? prefix : `${prefix}_`;
  return `${normalized}${suffix}`;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required.");
  }

  const prefix = (process.env.CMS_DB_PREFIX || "tooty_").trim();
  const t = (suffix) => qi(table(prefix, suffix));
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const siteRow = await client.query(`select id, "userId" from ${t("sites")} where "isPrimary" = true order by "createdAt" asc limit 1`);
    if (!siteRow.rows.length) {
      throw new Error("No primary site found.");
    }
    const siteId = siteRow.rows[0].id;
    const userId = siteRow.rows[0].userId;

    const domainInsert = await client.query(
      `insert into ${t("data_domains")}(key, label, "contentTable", "metaTable", description)
       values ($1,$2,$3,$4,$5)
       on conflict (key) do update set label = excluded.label
       returning id`,
      ["project", "Project", `${prefix}domain_project`, `${prefix}domain_project_meta`, "Project CPT"],
    );
    const projectDomainId = domainInsert.rows[0].id;

    await client.query(
      `insert into ${t("site_data_domains")}("siteId", "dataDomainId", "isActive")
       values ($1,$2,true)
       on conflict ("siteId", "dataDomainId") do update set "isActive" = true`,
      [siteId, projectDomainId],
    );

    const ensureTaxonomy = async (slug, name) => {
      const termInsert = await client.query(
        `insert into ${t("terms")}(slug, name)
         values ($1,$2)
         on conflict (slug) do update set name = excluded.name
         returning id`,
        [slug, name],
      );
      const termId = termInsert.rows[0].id;

      const taxInsert = await client.query(
        `insert into ${t("term_taxonomies")}("termId", taxonomy)
         values ($1,'category')
         on conflict do nothing
         returning id`,
        [termId],
      );
      if (taxInsert.rows.length) return taxInsert.rows[0].id;
      const existing = await client.query(
        `select id from ${t("term_taxonomies")} where "termId" = $1 and taxonomy = 'category' limit 1`,
        [termId],
      );
      return existing.rows[0]?.id;
    };

    const featuredTaxonomyId = await ensureTaxonomy("featured", "Featured");
    const aiTaxonomyId = await ensureTaxonomy("ai-systems", "AI Systems");
    const platformTaxonomyId = await ensureTaxonomy("platform-engineering", "Platform Engineering");
    const cmsTaxonomyId = await ensureTaxonomy("cms-architecture", "CMS Architecture");
    const desktopTaxonomyId = await ensureTaxonomy("desktop-apps", "Desktop Apps");
    const governanceTaxonomyId = await ensureTaxonomy("governance-systems", "Governance Systems");

    const taxonomyIds = [
      featuredTaxonomyId,
      aiTaxonomyId,
      platformTaxonomyId,
      cmsTaxonomyId,
      desktopTaxonomyId,
      governanceTaxonomyId,
    ].filter(Boolean);
    for (const taxonomyId of taxonomyIds) {
      await client.query(
        `insert into ${t("term_taxonomy_domains")}("dataDomainId", "termTaxonomyId")
         values ($1,$2)
         on conflict do nothing`,
        [projectDomainId, taxonomyId],
      );
    }

    const seedProjects = [
      {
        slug: "leira-ai-kernel",
        title: "Leira AI Kernel",
        description: "Local AI assistant with governance layer.",
        technologyTaxonomyId: aiTaxonomyId,
        featured: true,
        link: "https://leira.fernain.com",
        thumbnail: "/tooty/sprites/tooty-ideas-cropped.png",
      },
      {
        slug: "tooty-cms",
        title: "Tooty CMS",
        description: "Multi-tenant content management system.",
        technologyTaxonomyId: cmsTaxonomyId,
        featured: true,
        link: "https://tooty.dev",
        thumbnail: "/tooty/sprites/tooty-laptop-cropped.png",
      },
      {
        slug: "fernain-jobs",
        title: "Fernain Jobs",
        description: "Tech hiring platform for distributed teams.",
        technologyTaxonomyId: platformTaxonomyId,
        featured: true,
        link: "https://jobs.fernain.com",
        thumbnail: "/tooty/sprites/tooty-megaphone-cropped.png",
      },
      {
        slug: "leira-ai-desktop",
        title: "Leira AI Desktop",
        description: "Desktop AI assistant for daily execution.",
        technologyTaxonomyId: desktopTaxonomyId,
        featured: true,
        link: "https://desktop.fernain.com",
        thumbnail: "/tooty/sprites/tooty-reading-cropped.png",
      },
      {
        slug: "atlas-policy-pulse",
        title: "Atlas Policy Pulse",
        description: "Internal policy intelligence dashboard for compliance and audit teams.",
        technologyTaxonomyId: governanceTaxonomyId,
        featured: false,
        link: "https://labs.fernain.com/atlas-policy-pulse",
        thumbnail: "/tooty/sprites/tooty-camera-cropped.png",
      },
    ];

    for (const item of seedProjects) {
      const content = JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `${item.title} overview` }] }],
      });

      const postInsert = await client.query(
        `insert into ${t("domain_posts")}("dataDomainId", "siteId", "userId", title, description, content, slug, image, layout, published)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'post',true)
         on conflict (slug, "dataDomainId") do update set title = excluded.title, description = excluded.description, image = excluded.image
         returning id`,
        [projectDomainId, siteId, userId, item.title, item.description, content, item.slug, item.thumbnail],
      );
      const postId = postInsert.rows[0].id;

      const assignTaxonomyIds = [
        item.featured ? featuredTaxonomyId : null,
        item.technologyTaxonomyId,
      ].filter(Boolean);
      for (const taxonomyId of assignTaxonomyIds) {
        if (!taxonomyId) continue;
        await client.query(
          `insert into ${t("term_relationships")}("objectId", "termTaxonomyId")
           values ($1,$2)
           on conflict do nothing`,
          [postId, taxonomyId],
        );
      }

      for (const [key, value] of Object.entries({ link: item.link, thumbnail: item.thumbnail })) {
        await client.query(
          `insert into ${t("domain_post_meta")}("domainPostId", key, value)
           values ($1,$2,$3)
           on conflict ("domainPostId", key) do update set value = excluded.value`,
          [postId, key, value],
        );
      }
    }

    console.log("Seeded project data-domain records successfully (4 featured + 1 non-featured).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
