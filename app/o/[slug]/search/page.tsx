import Link from "next/link";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const ctx = await requireOrg(slug);
  const term = q.trim().slice(0, 80);
  const data = term
    ? await withOrg(ctx.userId, ctx.orgId, async (tx) => {
        const like = `%${term}%`;
        const agents = await tx<{ id: string; name: string }[]>`
          select id, name from agents where name ilike ${like} or slug ilike ${like} order by name limit 20
        `;
        const actions = await tx<{ id: string; tool: string; outcome: string }[]>`
          select id, tool, outcome from actions
          where tool ilike ${like} or coalesce(error_code, '') ilike ${like} or coalesce(session_id, '') ilike ${like}
          order by created_at desc limit 20
        `;
        const approvals = ctx.can("approval.decide")
          ? await tx<{ id: string; status: string }[]>`
              select id, status from approvals where status ilike ${like} or payload::text ilike ${like} order by created_at desc limit 20
            `
          : [];
        return { agents, actions, approvals };
      })
    : { agents: [], actions: [], approvals: [] };
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Search</h1>
      <form className="flex gap-2" method="get">
        <label className="field flex-1">Query<input name="q" defaultValue={term} /></label>
        <button className="btn self-end" type="submit">Search</button>
      </form>
      {!term ? <p>Enter a name, tool, or session.</p> : (
        <>
          <section>
            <h2 className="font-serif text-2xl">Agents</h2>
            {data.agents.length === 0 ? <p className="text-sm">No matching agents.</p> : data.agents.map((agent) => (
              <p key={agent.id}><Link className="underline" href={`/o/${slug}/agents/${agent.id}`}>{agent.name}</Link></p>
            ))}
          </section>
          <section>
            <h2 className="font-serif text-2xl">Actions</h2>
            {data.actions.length === 0 ? <p className="text-sm">No matching actions.</p> : (
              <ul className="text-sm">{data.actions.map((action) => <li key={action.id}>{action.tool} · {action.outcome}</li>)}</ul>
            )}
          </section>
          {ctx.can("approval.decide") ? (
            <section>
              <h2 className="font-serif text-2xl">Approvals</h2>
              {data.approvals.length === 0 ? <p className="text-sm">No matching approvals.</p> : (
                <ul className="text-sm">{data.approvals.map((row) => <li key={row.id}>{row.status}</li>)}</ul>
              )}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
