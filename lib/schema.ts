import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  jsonb
} from "drizzle-orm/pg-core";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const tableName = (name: string) => `${normalizedPrefix}${name}`;

export const users = pgTable(tableName("users"), {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  username: text("username"),
  gh_username: text("gh_username"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  authProvider: text("authProvider").notNull().default("native"),
  passwordHash: text("passwordHash"),
  role: text("role").notNull().default("author"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" })
    .notNull()
    .$onUpdate(() => new Date()),
});

export const userMeta = pgTable(
  tableName("user_meta"),
  {
    id: serial("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => {
    return {
      userKeyUnique: uniqueIndex().on(table.userId, table.key),
      userIdx: index().on(table.userId),
      keyIdx: index().on(table.key),
    };
  },
);

export const sessions = pgTable(
  tableName("sessions"),
  {
    sessionToken: text("sessionToken").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index().on(table.userId),
    };
  },
);

export const verificationTokens = pgTable(
  tableName("verificationTokens"),
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => {
    return {
      compositePk: primaryKey({ columns: [table.identifier, table.token] }),
    };
  },
);

export const examples = pgTable(tableName("examples"), {
  id: serial("id").primaryKey(),
  name: text("name"),
  description: text("description"),
  domainCount: integer("domainCount"),
  url: text("url"),
  image: text("image"),
  imageBlurhash: text("imageBlurhash"),
});

export const categories = pgTable(tableName("categories"), {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const tags = pgTable(tableName("tags"), {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const terms = pgTable(
  tableName("terms"),
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex().on(table.slug),
  }),
);

export const termTaxonomies = pgTable(
  tableName("term_taxonomies"),
  {
    id: serial("id").primaryKey(),
    termId: integer("termId")
      .references(() => terms.id)
      .notNull(),
    taxonomy: text("taxonomy").notNull(), // category | tag | custom
    description: text("description"),
    parentId: integer("parentId"),
    count: integer("count").default(0).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    termTaxonomyUnique: uniqueIndex().on(table.termId, table.taxonomy),
    taxonomyIdx: index().on(table.taxonomy),
  }),
);

export const termRelationships = pgTable(
  tableName("term_relationships"),
  {
    objectId: text("objectId").notNull(), // post id / domain-post id
    termTaxonomyId: integer("termTaxonomyId")
      .references(() => termTaxonomies.id)
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.objectId, table.termTaxonomyId] }),
    termTaxonomyIdx: index().on(table.termTaxonomyId),
  }),
);

export const cmsSettings = pgTable(
  tableName("cms_settings"),
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => {
    return {
      keyIdx: index().on(table.key),
    };
  },
);

export const rbacRoles = pgTable(
  tableName("rbac_roles"),
  {
    role: text("role").primaryKey(),
    capabilities: jsonb("capabilities").notNull().default({}),
    isSystem: boolean("isSystem").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    roleIdx: index().on(table.role),
  }),
);

export const dataDomains = pgTable(
  tableName("data_domains"),
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    contentTable: text("contentTable").notNull().unique(),
    metaTable: text("metaTable").notNull().unique(),
    description: text("description"),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    keyIdx: uniqueIndex().on(table.key),
  }),
);

export const termTaxonomyDomains = pgTable(
  tableName("term_taxonomy_domains"),
  {
    dataDomainId: integer("dataDomainId")
      .references(() => dataDomains.id)
      .notNull(),
    termTaxonomyId: integer("termTaxonomyId")
      .references(() => termTaxonomies.id)
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.dataDomainId, table.termTaxonomyId] }),
    termTaxonomyIdx: index().on(table.termTaxonomyId),
  }),
);

export const siteDataDomains = pgTable(
  tableName("site_data_domains"),
  {
    siteId: text("siteId")
      .references(() => sites.id)
      .notNull(),
    dataDomainId: integer("dataDomainId")
      .references(() => dataDomains.id)
      .notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.siteId, table.dataDomainId] }),
    siteIdIdx: index().on(table.siteId),
    dataDomainIdIdx: index().on(table.dataDomainId),
  }),
);

export const communicationMessages = pgTable(
  tableName("communication_messages"),
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    channel: text("channel").notNull(), // email | sms | mms | com-x
    to: text("to").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    category: text("category").notNull().default("transactional"), // transactional | marketing
    status: text("status").notNull().default("queued"), // queued | retrying | sent | failed | dead | logged
    providerId: text("providerId"),
    externalId: text("externalId"),
    attemptCount: integer("attemptCount").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    nextAttemptAt: timestamp("nextAttemptAt", { mode: "date" }),
    lastError: text("lastError"),
    metadata: jsonb("metadata").notNull().default({}),
    createdByUserId: text("createdByUserId").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    siteIdx: index().on(table.siteId),
    statusIdx: index().on(table.status),
    nextAttemptIdx: index().on(table.nextAttemptAt),
    createdAtIdx: index().on(table.createdAt),
  }),
);

export const communicationAttempts = pgTable(
  tableName("communication_attempts"),
  {
    id: serial("id").primaryKey(),
    messageId: text("messageId")
      .references(() => communicationMessages.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    providerId: text("providerId").notNull(),
    eventId: text("eventId"),
    status: text("status").notNull(), // sent | failed | logged
    error: text("error"),
    response: jsonb("response").notNull().default({}),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    messageIdx: index().on(table.messageId),
    providerIdx: index().on(table.providerId),
    providerEventIdx: uniqueIndex().on(table.providerId, table.eventId),
    statusIdx: index().on(table.status),
    createdAtIdx: index().on(table.createdAt),
  }),
);

export const webcallbackEvents = pgTable(
  tableName("webcallback_events"),
  {
    id: serial("id").primaryKey(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    handlerId: text("handlerId").notNull(),
    pluginId: text("pluginId"),
    status: text("status").notNull().default("received"), // received | processed | failed | ignored
    requestBody: text("requestBody").notNull().default(""),
    requestHeaders: jsonb("requestHeaders").notNull().default({}),
    requestQuery: jsonb("requestQuery").notNull().default({}),
    response: jsonb("response").notNull().default({}),
    error: text("error"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    siteIdx: index().on(table.siteId),
    handlerIdx: index().on(table.handlerId),
    statusIdx: index().on(table.status),
    createdAtIdx: index().on(table.createdAt),
  }),
);

export const webhookSubscriptions = pgTable(
  tableName("webhook_subscriptions"),
  {
    id: serial("id").primaryKey(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    eventName: text("eventName").notNull(),
    endpointUrl: text("endpointUrl").notNull(),
    secret: text("secret"),
    enabled: boolean("enabled").notNull().default(true),
    maxRetries: integer("maxRetries").notNull().default(4),
    backoffBaseSeconds: integer("backoffBaseSeconds").notNull().default(30),
    headers: jsonb("headers").notNull().default({}),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    siteIdx: index().on(table.siteId),
    eventIdx: index().on(table.eventName),
    enabledIdx: index().on(table.enabled),
    subscriptionUnique: uniqueIndex().on(table.siteId, table.eventName, table.endpointUrl),
  }),
);

export const webhookDeliveries = pgTable(
  tableName("webhook_deliveries"),
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    subscriptionId: integer("subscriptionId")
      .references(() => webhookSubscriptions.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    eventId: text("eventId").notNull(),
    eventName: text("eventName").notNull(),
    endpointUrl: text("endpointUrl").notNull(),
    status: text("status").notNull().default("queued"), // queued | retrying | sent | failed | dead
    attemptCount: integer("attemptCount").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(4),
    nextAttemptAt: timestamp("nextAttemptAt", { mode: "date" }),
    lastError: text("lastError"),
    requestBody: text("requestBody").notNull().default(""),
    requestHeaders: jsonb("requestHeaders").notNull().default({}),
    responseStatus: integer("responseStatus"),
    responseBody: text("responseBody"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    subscriptionIdx: index().on(table.subscriptionId),
    siteIdx: index().on(table.siteId),
    statusIdx: index().on(table.status),
    dueIdx: index().on(table.nextAttemptAt),
    eventIdx: index().on(table.eventId),
    deliveryUnique: uniqueIndex().on(table.subscriptionId, table.eventId),
  }),
);

export const posts = pgTable(
  tableName("posts"),
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    title: text("title"),
    description: text("description"),
    content: text("content"),
    layout: text("layout"),
    slug: text("slug")
      .notNull()
      .$defaultFn(() => createId()),
    image: text("image").default(
      "",
    ),
    imageBlurhash: text("imageBlurhash").default(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAhCAYAAACbffiEAAAACXBIWXMAABYlAAAWJQFJUiTwAAABfUlEQVR4nN3XyZLDIAwE0Pz/v3q3r55JDlSBplsIEI49h76k4opexCK/juP4eXjOT149f2Tf9ySPgcjCc7kdpBTgDPKByKK2bTPFEdMO0RDrusJ0wLRBGCIuelmWJAjkgPGDSIQEMBDCfA2CEPM80+Qwl0JkNxBimiaYGOTUlXYI60YoehzHJDEm7kxjV3whOQTD3AaCuhGKHoYhyb+CBMwjIAFz647kTqyapdV4enGINuDJMSScPmijSwjCaHeLcT77C7EC0C1ugaCTi2HYfAZANgj6Z9A8xY5eiYghDMNQBJNCWhASot0jGsSCUiHWZcSGQjaWWCDaGMOWnsCcn2QhVkRuxqqNxMSdUSElCDbp1hbNOsa6Ugxh7xXauF4DyM1m5BLtCylBXgaxvPXVwEoOBjeIFVODtW74oj1yBQah3E8tyz3SkpolKS9Geo9YMD1QJR1Go4oJkgO1pgbNZq0AOUPChyjvh7vlXaQa+X1UXwKxgHokB2XPxbX+AnijwIU4ahazAAAAAElFTkSuQmCC",
    ),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date()),
    published: boolean("published").default(false).notNull(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    userId: text("userId").references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => {
    return {
      siteIdIdx: index().on(table.siteId),
      userIdIdx: index().on(table.userId),
      slugSiteIdKey: uniqueIndex().on(table.slug, table.siteId),
    };
  },
);

export const domainPosts = pgTable(
  tableName("domain_posts"),
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    dataDomainId: integer("dataDomainId")
      .references(() => dataDomains.id)
      .notNull(),
    title: text("title"),
    description: text("description"),
    content: text("content"),
    layout: text("layout"),
    slug: text("slug")
      .notNull()
      .$defaultFn(() => createId()),
    image: text("image").default(
      "",
    ),
    imageBlurhash: text("imageBlurhash").default(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAhCAYAAACbffiEAAAACXBIWXMAABYlAAAWJQFJUiTwAAABfUlEQVR4nN3XyZLDIAwE0Pz/v3q3r55JDlSBplsIEI49h76k4opexCK/juP4eXjOT149f2Tf9ySPgcjCc7kdpBTgDPKByKK2bTPFEdMO0RDrusJ0wLRBGCIuelmWJAjkgPGDSIQEMBDCfA2CEPM80+Qwl0JkNxBimiaYGOTUlXYI60YoehzHJDEm7kxjV3whOQTD3AaCuhGKHoYhyb+CBMwjIAFz647kTqyapdV4enGINuDJMSScPmijSwjCaHeLcT77C7EC0C1ugaCTi2HYfAZANgj6Z9A8xY5eiYghDMNQBJNCWhASot0jGsSCUiHWZcSGQjaWWCDaGMOWnsCcn2QhVkRuxqqNxMSdUSElCDbp1hbNOsa6Ugxh7xXauF4DyM1m5BLtCylBXgaxvPXVwEoOBjeIFVODtW74oj1yBQah3E8tyz3SkpolKS9Geo9YMD1QJR1Go4oJkgO1pgbNZq0AOUPChyjvh7vlXaQa+X1UXwKxgHokB2XPxbX+AnijwIU4ahazAAAAAElFTkSuQmCC",
    ),
    published: boolean("published").default(false).notNull(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    userId: text("userId").references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    dataDomainIdIdx: index().on(table.dataDomainId),
    slugDomainIdKey: uniqueIndex().on(table.slug, table.dataDomainId),
    siteIdIdx: index().on(table.siteId),
    siteDomainPublishedIdx: index().on(table.siteId, table.dataDomainId, table.published, table.updatedAt),
    siteSlugIdx: index().on(table.siteId, table.slug),
  }),
);

export const domainPostMeta = pgTable(
  tableName("domain_post_meta"),
  {
    id: serial("id").primaryKey(),
    domainPostId: text("domainPostId")
      .references(() => domainPosts.id)
      .notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    domainPostIdx: index().on(table.domainPostId),
    domainPostKeyUnique: uniqueIndex().on(table.domainPostId, table.key),
  }),
);

export const media = pgTable(
  tableName("media"),
  {
    id: serial("id").primaryKey(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    userId: text("userId").references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    provider: text("provider").notNull().default("blob"), // blob | s3
    bucket: text("bucket"),
    objectKey: text("objectKey").notNull(),
    url: text("url").notNull(),
    label: text("label"),
    mimeType: text("mimeType"),
    size: integer("size"),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    siteIdx: index().on(table.siteId),
    userIdx: index().on(table.userId),
    objectKeyIdx: uniqueIndex().on(table.objectKey),
    createdAtIdx: index().on(table.createdAt),
  }),
);

export const postCategories = pgTable(tableName("post_categories"), {
  postId: text("post_id").references(() => posts.id).notNull(),
  categoryId: integer("category_id").references(() => categories.id).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.postId, table.categoryId] }),
}));

export const postTags = pgTable(tableName("post_tags"), {
  postId: text("post_id").references(() => posts.id).notNull(),
  tagId: integer("tag_id").references(() => tags.id).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.postId, table.tagId] }),
}));

export const postMeta = pgTable(
  tableName("post_meta"),
  {
    id: serial("id").primaryKey(),
    postId: text("post_id").references(() => posts.id).notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    postKeyUnique: uniqueIndex().on(table.postId, table.key),
    postIdIdx: index().on(table.postId),
    keyIdx: index().on(table.key),
  }),
);

export const postsRelations = relations(posts, ({ one, many }) => ({
  site: one(sites, { references: [sites.id], fields: [posts.siteId] }),
  user: one(users, { references: [users.id], fields: [posts.userId] }),
  categories: many(postCategories),
  tags: many(postTags),
  meta: many(postMeta),
}));

export const postCategoriesRelations = relations(postCategories, ({ one }) => ({
  post: one(posts, { references: [posts.id], fields: [postCategories.postId] }),
  category: one(categories, { references: [categories.id], fields: [postCategories.categoryId] }),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { references: [posts.id], fields: [postTags.postId] }),
  tag: one(tags, { references: [tags.id], fields: [postTags.tagId] }),
}));

export const postMetaRelations = relations(postMeta, ({ one }) => ({
  post: one(posts, { references: [posts.id], fields: [postMeta.postId] }),
}));

export const termsRelations = relations(terms, ({ many }) => ({
  taxonomies: many(termTaxonomies),
}));

export const termTaxonomiesRelations = relations(termTaxonomies, ({ one, many }) => ({
  term: one(terms, { references: [terms.id], fields: [termTaxonomies.termId] }),
  relationships: many(termRelationships),
  domains: many(termTaxonomyDomains),
}));

export const termRelationshipsRelations = relations(termRelationships, ({ one }) => ({
  taxonomy: one(termTaxonomies, { references: [termTaxonomies.id], fields: [termRelationships.termTaxonomyId] }),
}));

export const dataDomainsRelations = relations(dataDomains, ({ many }) => ({
  posts: many(posts),
  domainPosts: many(domainPosts),
  taxonomies: many(termTaxonomyDomains),
  sites: many(siteDataDomains),
}));

export const termTaxonomyDomainsRelations = relations(termTaxonomyDomains, ({ one }) => ({
  dataDomain: one(dataDomains, { references: [dataDomains.id], fields: [termTaxonomyDomains.dataDomainId] }),
  taxonomy: one(termTaxonomies, { references: [termTaxonomies.id], fields: [termTaxonomyDomains.termTaxonomyId] }),
}));

export const siteDataDomainsRelations = relations(siteDataDomains, ({ one }) => ({
  site: one(sites, { references: [sites.id], fields: [siteDataDomains.siteId] }),
  dataDomain: one(dataDomains, { references: [dataDomains.id], fields: [siteDataDomains.dataDomainId] }),
}));

export const communicationMessagesRelations = relations(communicationMessages, ({ one, many }) => ({
  site: one(sites, { references: [sites.id], fields: [communicationMessages.siteId] }),
  createdByUser: one(users, { references: [users.id], fields: [communicationMessages.createdByUserId] }),
  attempts: many(communicationAttempts),
}));

export const communicationAttemptsRelations = relations(communicationAttempts, ({ one }) => ({
  message: one(communicationMessages, { references: [communicationMessages.id], fields: [communicationAttempts.messageId] }),
}));

export const domainPostsRelations = relations(domainPosts, ({ one, many }) => ({
  dataDomain: one(dataDomains, { references: [dataDomains.id], fields: [domainPosts.dataDomainId] }),
  site: one(sites, { references: [sites.id], fields: [domainPosts.siteId] }),
  user: one(users, { references: [users.id], fields: [domainPosts.userId] }),
  meta: many(domainPostMeta),
}));

export const domainPostMetaRelations = relations(domainPostMeta, ({ one }) => ({
  domainPost: one(domainPosts, { references: [domainPosts.id], fields: [domainPostMeta.domainPostId] }),
}));

export const sites = pgTable(
  tableName("sites"),
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name"),
    description: text("description"),
    logo: text("logo").default(""),
    font: text("font").default("font-cal").notNull(),
    image: text("image").default("/tooty-soccer.svg"),
    imageBlurhash: text("imageBlurhash").default(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAhCAYAAACbffiEAAAACXBIWXMAABYlAAAWJQFJUiTwAAABfUlEQVR4nN3XyZLDIAwE0Pz/v3q3r55JDlSBplsIEI49h76k4opexCK/juP4eXjOT149f2Tf9ySPgcjCc7kdpBTgDPKByKK2bTPFEdMO0RDrusJ0wLRBGCIuelmWJAjkgPGDSIQEMBDCfA2CEPM80+Qwl0JkNxBimiaYGOTUlXYI60YoehzHJDEm7kxjV3whOQTD3AaCuhGKHoYhyb+CBMwjIAFz647kTqyapdV4enGINuDJMSScPmijSwjCaHeLcT77C7EC0C1ugaCTi2HYfAZANgj6Z9A8xY5eiYghDMNQBJNCWhASot0jGsSCUiHWZcSGQjaWWCDaGMOWnsCcn2QhVkRuxqqNxMSdUSElCDbp1hbNOsa6Ugxh7xXauF4DyM1m5BLtCylBXgaxvPXVwEoOBjeIFVODtW74oj1yBQah3E8tyz3SkpolKS9Geo9YMD1QJR1Go4oJkgO1pgbNZq0AOUPChyjvh7vlXaQa+X1UXwKxgHokB2XPxbX+AnijwIU4ahazAAAAAElFTkSuQmCC",
    ),
    subdomain: text("subdomain").unique(),
    customDomain: text("customDomain").unique(),
    message404: text("message404").default(
      "Blimey! You''ve found a page that doesn''t exist.",
    ),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date()),
    userId: text("userId").references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    seriesCards: jsonb("seriesCards").default([]),
    layout: text("layout").default(
      "default",
    ),
    heroImage: text("heroImage"),
    heroTitle: text("heroTitle"),
    heroSubtitle: text("heroSubtitle"),
    heroCtaText: text("heroCtaText"),
    heroCtaUrl: text("heroCtaUrl"),
    isPrimary: boolean("isPrimary").default(false).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index().on(table.userId),
    };
  },
);

export const siteUserTableRegistry = pgTable(
  tableName("site_user_table_registry"),
  {
    siteId: text("siteId")
      .primaryKey()
      .references(() => sites.id, { onDelete: "cascade", onUpdate: "cascade" }),
    tableIndex: integer("tableIndex").notNull().unique(),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    tableIndexIdx: index().on(table.tableIndex),
  }),
);

export const sitesRelations = relations(sites, ({ one, many }) => ({
  posts: many(posts),
  user: one(users, { references: [users.id], fields: [sites.userId] }),
  dataDomains: many(siteDataDomains),
  media: many(media),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { references: [users.id], fields: [sessions.userId] }),
}));

export const accounts = pgTable(
  tableName("accounts"),
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    refreshTokenExpiresIn: integer("refresh_token_expires_in"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    oauth_token_secret: text("oauth_token_secret"),
    oauth_token: text("oauth_token"),
  },
  (table) => {
    return {
      userIdIdx: index().on(table.userId),
      compositePk: primaryKey({
        columns: [table.provider, table.providerAccountId],
      }),
    };
  },
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { references: [users.id], fields: [accounts.userId] }),
}));

export const userRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  sites: many(sites),
  posts: many(posts),
  media: many(media),
  userMeta: many(userMeta),
}));

export const userMetaRelations = relations(userMeta, ({ one }) => ({
  user: one(users, { references: [users.id], fields: [userMeta.userId] }),
}));

export const siteUserTableRegistryRelations = relations(siteUserTableRegistry, ({ one }) => ({
  site: one(sites, { references: [sites.id], fields: [siteUserTableRegistry.siteId] }),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  site: one(sites, { references: [sites.id], fields: [media.siteId] }),
  user: one(users, { references: [users.id], fields: [media.userId] }),
}));

export type SelectSite = typeof sites.$inferSelect;
export type SelectPost = typeof posts.$inferSelect;
export type SelectExample = typeof examples.$inferSelect;
