import Link from "next/link";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const data = await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    const counts = await tx<{ outcome: string; total: number }[]>`
      select outcome, count(*)::int as total from actions
      where created_at > now() - interval '14 days'
      group by outcome
    `;
    const pending = await tx<{ total: number }[]>`select count(*)::int as total from approvals where status = 'pending'`;
    const failures = await tx<{ tool: string; error_code: string | null; created_at: Date }[]>`
      select tool, error_code, created_at from actions
      where outcome in ('failed', 'denied')
      order by created_at desc limit 5
    `;
    const usage = await tx<{ action_count: number; actions_per_day: number }[]>`
      select coalesce(u.action_count, 0)::int as action_count, l.actions_per_day
      from org_limits l
      left join org_usage u on u.organization_id = l.organization_id and u.day = current_date
      where l.organization_id = ${ctx.orgId}
    `;
    return { counts, pending: pending[0]?.total ?? 0, failures, usage: usage[0] };
  });
  const total = data.counts.reduce((sum, row) => sum + row.total, 0);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Overview</h1>
      <section className="grid gap-3 sm:grid-cols-3">
        <article className="card"><p className="text-sm">Actions in 14 days</p><p className="font-serif text-3xl">{total}</p></article>
        <article className="card"><p className="text-sm">Pending approvals</p><p className="font-serif text-3xl">{data.pending}</p></article>
        <article className="card">
          <p className="text-sm">Today’s quota</p>
          <p className="font-serif text-3xl">{data.usage ? `${data.usage.action_count} / ${data.usage.actions_per_day}` : "0"}</p>
        </article>
      </section>
      {total === 0 ? <p>No actions yet.</p> : (
        <ul className="flex flex-wrap gap-2 text-sm">
          {data.counts.map((row) => <li key={row.outcome} className="badge">{row.outcome}: {row.total}</li>)}
        </ul>
      )}
      <section className="card">
        <h2 className="font-serif text-2xl">Recent failures</h2>
        {data.failures.length === 0 ? <p className="mt-2 text-sm">No failed actions yet.</p> : (
          <ul className="mt-3 grid gap-2 text-sm">
            {data.failures.map((row, index) => (
              <li key={index}>{row.tool} · {row.error_code ?? "failed"} · {new Date(row.created_at).toLocaleString()}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm"><Link className="font-bold underline" href={`/o/${slug}/failures`}>Open the failure log</Link></p>
      </section>
    </main>
  );
}
