import { sql, type QueryResult, type QueryResultRow } from "@vercel/postgres";

type Primitive = string | number | boolean | undefined | null;

type QueryCapableSqlClient = typeof sql & {
  query: <O extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: Primitive[],
  ) => Promise<QueryResult<O>>;
};

export { sql };
export const sqlClient = sql as unknown as QueryCapableSqlClient;
