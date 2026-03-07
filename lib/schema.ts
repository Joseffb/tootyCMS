import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;
const tableName = (name: string) => `${normalizedPrefix}${name}`;
const networkTableName = (name: string) => tableName(`network_${name}`);

export const users = pgTable(networkTableName("users"), {
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
  networkTableName("user_meta"),
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
  (table) => ({
    userKeyUnique: uniqueIndex().on(table.userId, table.key),
    userIdx: index().on(table.userId),
    keyIdx: index().on(table.key),
  }),
);

export const sessions = pgTable(
  networkTableName("sessions"),
  {
    sessionToken: text("sessionToken").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => ({
    userIdIdx: index().on(table.userId),
  }),
);

export const verificationTokens = pgTable(
  networkTableName("verification_tokens"),
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => ({
    compositePk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

export const systemSettings = pgTable(
  networkTableName("system_settings"),
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date())
      .defaultNow(),
  },
  (table) => ({
    keyIdx: index().on(table.key),
  }),
);

export const rbacRoles = pgTable(
  networkTableName("rbac_roles"),
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

export const sites = pgTable(
  networkTableName("sites"),
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
    message404: text("message404").default("Blimey! You''ve found a page that doesn''t exist."),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" })
      .notNull()
      .$onUpdate(() => new Date()),
    userId: text("userId").references(() => users.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    seriesCards: jsonb("seriesCards").default([]),
    layout: text("layout").default("default"),
    heroImage: text("heroImage"),
    heroTitle: text("heroTitle"),
    heroSubtitle: text("heroSubtitle"),
    heroCtaText: text("heroCtaText"),
    heroCtaUrl: text("heroCtaUrl"),
    isPrimary: boolean("isPrimary").default(false).notNull(),
  },
  (table) => ({
    userIdIdx: index().on(table.userId),
  }),
);

export const communicationMessages = pgTable(
  networkTableName("communication_messages"),
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    channel: text("channel").notNull(),
    to: text("to").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    category: text("category").notNull().default("transactional"),
    status: text("status").notNull().default("queued"),
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
  networkTableName("communication_attempts"),
  {
    id: serial("id").primaryKey(),
    messageId: text("messageId")
      .references(() => communicationMessages.id, { onDelete: "cascade", onUpdate: "cascade" })
      .notNull(),
    providerId: text("providerId").notNull(),
    eventId: text("eventId"),
    status: text("status").notNull(),
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
  networkTableName("webcallback_events"),
  {
    id: serial("id").primaryKey(),
    siteId: text("siteId").references(() => sites.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    handlerId: text("handlerId").notNull(),
    pluginId: text("pluginId"),
    status: text("status").notNull().default("received"),
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
  networkTableName("webhook_subscriptions"),
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
  networkTableName("webhook_deliveries"),
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
    status: text("status").notNull().default("queued"),
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

export const accounts = pgTable(
  networkTableName("accounts"),
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
  (table) => ({
    userIdIdx: index().on(table.userId),
    compositePk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  }),
);

export const sitesRelations = relations(sites, ({ one, many }) => ({
  user: one(users, { references: [users.id], fields: [sites.userId] }),
  communicationMessages: many(communicationMessages),
  webcallbackEvents: many(webcallbackEvents),
  webhookSubscriptions: many(webhookSubscriptions),
  webhookDeliveries: many(webhookDeliveries),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { references: [users.id], fields: [sessions.userId] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { references: [users.id], fields: [accounts.userId] }),
}));

export const userRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  sites: many(sites),
  userMeta: many(userMeta),
  communicationMessages: many(communicationMessages),
}));

export const userMetaRelations = relations(userMeta, ({ one }) => ({
  user: one(users, { references: [users.id], fields: [userMeta.userId] }),
}));

export const communicationMessagesRelations = relations(communicationMessages, ({ one, many }) => ({
  site: one(sites, { references: [sites.id], fields: [communicationMessages.siteId] }),
  createdByUser: one(users, { references: [users.id], fields: [communicationMessages.createdByUserId] }),
  attempts: many(communicationAttempts),
}));

export const communicationAttemptsRelations = relations(communicationAttempts, ({ one }) => ({
  message: one(communicationMessages, { references: [communicationMessages.id], fields: [communicationAttempts.messageId] }),
}));

export const webcallbackEventsRelations = relations(webcallbackEvents, ({ one }) => ({
  site: one(sites, { references: [sites.id], fields: [webcallbackEvents.siteId] }),
}));

export const webhookSubscriptionsRelations = relations(webhookSubscriptions, ({ one, many }) => ({
  site: one(sites, { references: [sites.id], fields: [webhookSubscriptions.siteId] }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  site: one(sites, { references: [sites.id], fields: [webhookDeliveries.siteId] }),
  subscription: one(webhookSubscriptions, {
    references: [webhookSubscriptions.id],
    fields: [webhookDeliveries.subscriptionId],
  }),
}));

export type SelectSite = typeof sites.$inferSelect;
export type SelectPost = {
  slug: string;
  image: string | null;
  imageBlurhash: string | null;
  title: string | null;
  description: string | null;
  createdAt: Date;
};
