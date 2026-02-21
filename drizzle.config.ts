import { defineConfig } from "drizzle-kit";

const rawPrefix = process.env.CMS_DB_PREFIX?.trim() || "tooty_";
const normalizedPrefix = rawPrefix.endsWith("_") ? rawPrefix : `${rawPrefix}_`;

export default defineConfig({
  schema: "./lib/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  tablesFilter: [`${normalizedPrefix}*`],
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
});
