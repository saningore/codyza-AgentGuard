import { sql } from "@/server/db";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const rows = await sql<{ expire_approvals: number }[]>`select app.expire_approvals() as expire_approvals`;
  return Response.json({ expired: rows[0]?.expire_approvals ?? 0 });
}
