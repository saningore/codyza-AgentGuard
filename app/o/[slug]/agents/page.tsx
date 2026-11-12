import Link from "next/link";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function AgentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const agents = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; name: string; status: string; environment: string; owner_name: string }[]>`
    select a.id, a.name, a.status, a.environment, u.name as owner_name
    from agents a join users u on u.id = a.owner_user_id
    order by a.name
  `);
  return (
    <main id="main" className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-4xl">Agents</h1>
        {ctx.can("agent.write") ? <Link className="btn" href={`/o/${slug}/agents/new`}>New agent</Link> : null}
      </div>
      <div className="grid gap-3">
        {agents.length === 0 ? <p>No agents yet.</p> : agents.map((agent) => (
          <Link key={agent.id} className="card grid gap-1" href={`/o/${slug}/agents/${agent.id}`}>
            <span className="font-bold">{agent.name}</span>
            <span className="text-sm">{agent.status} · {agent.environment} · {agent.owner_name}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
