import postgres from "postgres";

if (process.env.AGENTGUARD_USE_FIXTURES === "1") {
  throw new Error("AGENTGUARD_USE_FIXTURES=1 is refused. AgentGuard does not serve fixture data.");
}

const globalForSql = globalThis as typeof globalThis & { agentguard?: postgres.Sql };

export const sql =
  globalForSql.agentguard ??
  postgres(process.env.DATABASE_URL!, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { search_path: "public, app" },
  });

if (process.env.NODE_ENV !== "production") globalForSql.agentguard = sql;

export type Tx = postgres.TransactionSql<Record<string, never>>;

export async function withOrg<T>(userId: string, orgId: string, fn: (tx: Tx) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    await tx`select set_config('app.token_id', '', true)`;
    return fn(tx);
  });
}

export async function withToken<T>(userId: string, orgId: string, tokenId: string, fn: (tx: Tx) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    await tx`select set_config('app.token_id', ${tokenId}, true)`;
    return fn(tx);
  });
}
