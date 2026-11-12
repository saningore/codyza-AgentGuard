import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function LimitsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ actions_per_day: number; agents_max: number; tokens_max: number; approvals_per_day: number; used: number }[]>`
    select l.actions_per_day, l.agents_max, l.tokens_max, l.approvals_per_day, coalesce(u.action_count, 0)::int as used
    from org_limits l
    left join org_usage u on u.organization_id = l.organization_id and u.day = current_date
    where l.organization_id = ${ctx.orgId}
  `);
  const limit = rows[0];
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Usage limits</h1>
      {limit ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          <li className="card">Actions today: {limit.used} / {limit.actions_per_day}</li>
          <li className="card">Agents allowed: {limit.agents_max}</li>
          <li className="card">Active tokens allowed: {limit.tokens_max}</li>
          <li className="card">Approvals per day: {limit.approvals_per_day}</li>
        </ul>
      ) : <p>Limits are not configured.</p>}
    </main>
  );
}
