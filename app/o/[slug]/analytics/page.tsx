import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function AnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (!ctx.can("analytics.read")) return <main id="main"><h1 className="font-serif text-4xl">Analytics</h1><p>You cannot view analytics.</p></main>;
  const data = await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    const days = await tx<{ day: Date; total: number }[]>`
      select date_trunc('day', created_at) as day, count(*)::int as total
      from actions
      where created_at > now() - interval '14 days'
      group by 1 order by 1
    `;
    const outcomes = await tx<{ outcome: string; total: number }[]>`
      select outcome, count(*)::int as total from actions group by outcome order by outcome
    `;
    const agents = await tx<{ name: string; total: number }[]>`
      select a.name, count(*)::int as total
      from actions ac join agents a on a.id = ac.agent_id
      group by a.name order by total desc limit 5
    `;
    const wait = await tx<{ seconds: number | null }[]>`
      select extract(epoch from avg(decided_at - created_at))::int as seconds
      from approvals where decided_at is not null
    `;
    return { days, outcomes, agents, wait: wait[0]?.seconds };
  });
  const max = Math.max(1, ...data.days.map((day) => day.total));
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Analytics</h1>
      {data.days.length === 0 ? <p>No actions yet.</p> : (
        <section className="card">
          <h2 className="font-serif text-2xl">Actions by day</h2>
          <ul className="mt-3 grid gap-2">
            {data.days.map((day) => (
              <li key={day.day.toISOString()} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2 text-sm">
                <span>{new Date(day.day).toLocaleDateString()}</span>
                <span className="h-3 rounded-full bg-mist"><span className="block h-3 rounded-full bg-copper" style={{ width: `${(day.total / max) * 100}%` }} /></span>
                <span>{day.total}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <h2 className="font-serif text-2xl">Outcomes</h2>
        {data.outcomes.length === 0 ? <p className="mt-2">No actions yet.</p> : (
          <ul className="mt-2 flex flex-wrap gap-2">{data.outcomes.map((row) => <li key={row.outcome} className="badge">{row.outcome}: {row.total}</li>)}</ul>
        )}
      </section>
      <section className="card">
        <h2 className="font-serif text-2xl">Busiest agents</h2>
        {data.agents.length === 0 ? <p className="mt-2">No actions yet.</p> : (
          <ol className="mt-2 grid gap-1 text-sm">{data.agents.map((agent) => <li key={agent.name}>{agent.name}: {agent.total}</li>)}</ol>
        )}
        <p className="mt-3 text-sm">Mean approval wait: {data.wait == null ? "no decided approvals yet" : `${data.wait} seconds`}.</p>
      </section>
    </main>
  );
}
