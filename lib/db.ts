import { sql } from "@vercel/postgres";
import { drizzle } from "drizzle-orm/vercel-postgres";
import * as schema from "./schema";
import { isSqlDebugMode } from "./debug";

const db = drizzle(sql, { schema, logger: isSqlDebugMode() });

export default db;

export type DrizzleClient = typeof db;
