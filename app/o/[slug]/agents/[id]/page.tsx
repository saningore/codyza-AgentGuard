import Link from "next/link";
import { notFound } from "next/navigation";
import { canSetStatus, type AgentStatus } from "@/lib/policy";
import { toolCatalog } from "@/lib/tools";
import { createToken, grantScope, recordDlpException, revokeToken, setAgentStatus } from "@/server/org-actions";
import { StateForm } from "@/components/state-form";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

const statuses: AgentStatus[] = ["draft", "active", "paused", "revoked"];

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, id } = await params;
  const query = await searchParams;
  const ctx = await requireOrg(slug);
  const data = await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    const agents = await tx<{ id: string; name: string; description: string; status: AgentStatus; environment: string; owner_user_id: string; owner_name: string }[]>`
      select a.id, a.name, a.description, a.status, a.environment, a.owner_user_id, u.name as owner_name
      from agents a join users u on u.id = a.owner_user_id
      where a.id = ${id}
    `;
    if (!agents[0]) return null;
    const scopes = await tx<{ scope: string }[]>`select scope from agent_scopes where agent_id = ${id} order by scope`;
    const tokens = await tx<{ id: string; name: string; prefix: string; environment: string; revoked_at: Date | null; last_used_at: Date | null; daily_limit: number | null }[]>`
      select id, name, prefix, environment, revoked_at, last_used_at, daily_limit
      from api_tokens where agent_id = ${id} order by created_at desc
    `;
    const actions = await tx<{ id: string; tool: string; outcome: string; error_code: string | null; created_at: Date }[]>`
      select id, tool, outcome, error_code, created_at from actions where agent_id = ${id} order by created_at desc limit 12
    `;
    const runs = await tx<{ id: string; created_at: Date }[]>`
      select id, created_at from runs where agent_id = ${id} order by created_at desc limit 8
    `;
    return { agent: agents[0], scopes, tokens, actions, runs };
  });
  if (!data) notFound();
  const granted = new Set(data.scopes.map((scope) => scope.scope));
  const next = statuses.filter((status) => canSetStatus({
    role: ctx.role,
    from: data.agent.status,
    to: status,
    ownsAgent: data.agent.owner_user_id === ctx.userId,
  }));
  return (
    <main id="main" className="grid gap-4">
      <p className="text-sm"><Link className="underline" href={`/o/${slug}/agents`}>Agents</Link></p>
      <h1 className="font-serif text-4xl">{data.agent.name}</h1>
      <p className="text-sm">{data.agent.status} · {data.agent.environment} · owner {data.agent.owner_name}</p>
      {data.agent.description ? <p>{data.agent.description}</p> : null}
      {query.error ? <p role="alert" className="text-sm font-bold text-clay">{query.error}</p> : null}
      <section className="card">
        <h2 className="font-serif text-2xl">Status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {next.length === 0 ? <p className="text-sm">No status changes are available to you.</p> : next.map((status) => (
            <form key={status} action={setAgentStatus}>
              <input type="hidden" name="org" value={slug} />
              <input type="hidden" name="agent_id" value={id} />
              <input type="hidden" name="status" value={status} />
              <button className="btn-secondary" type="submit">Mark {status}</button>
            </form>
          ))}
        </div>
      </section>
      <section className="card">
        <h2 className="font-serif text-2xl">Scopes</h2>
        <ul className="mt-2 flex flex-wrap gap-2">{[...granted].map((scope) => <li key={scope} className="badge">{scope}</li>)}</ul>
        {ctx.can("scope.grant") ? (
          <form action={grantScope} className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="org" value={slug} />
            <input type="hidden" name="agent_id" value={id} />
            <label className="field">Grant scope
              <select name="scope">
                {toolCatalog.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                <option value="data.payment.read">data.payment.read</option>
                <option value="tool.http.write">tool.http.write</option>
              </select>
            </label>
            <button className="btn" type="submit">Grant</button>
          </form>
        ) : null}
        {ctx.can("scope.grant_sensitive") && data.agent.environment === "production" ? (
          <form action={recordDlpException} className="mt-4 grid gap-2">
            <input type="hidden" name="org" value={slug} />
            <input type="hidden" name="agent_id" value={id} />
            <label className="field">Owner exception for payment read plus HTTP write
              <input name="reason" placeholder="Why this production agent needs both" />
            </label>
            <button className="btn-secondary" type="submit">Record exception</button>
          </form>
        ) : null}
      </section>
      <section className="card">
        <h2 className="font-serif text-2xl">Tokens</h2>
        {data.tokens.length === 0 ? <p className="mt-2 text-sm">No tokens yet.</p> : (
          <ul className="mt-3 grid gap-2 text-sm">
            {data.tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{token.name} · {token.prefix}… · {token.environment}{token.revoked_at ? " · revoked" : ""}{token.daily_limit ? ` · ${token.daily_limit}/day` : ""}</span>
                {ctx.can("token.revoke") && !token.revoked_at ? (
                  <form action={revokeToken}>
                    <input type="hidden" name="org" value={slug} />
                    <input type="hidden" name="token_id" value={token.id} />
                    <input type="hidden" name="agent_id" value={id} />
                    <button className="btn-secondary" type="submit">Revoke</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {ctx.can("token.create") ? (
          <div className="mt-4">
            <StateForm action={createToken} submit="Create token">
              <input type="hidden" name="org" value={slug} />
              <input type="hidden" name="agent_id" value={id} />
              <label className="field">Name<input name="name" required /></label>
              <label className="field">Type
                <select name="environment" defaultValue="test">
                  <option value="test">test</option>
                  {ctx.can("token.create_live") ? <option value="live">live</option> : null}
                </select>
              </label>
              <label className="field">Daily limit<input name="daily_limit" inputMode="numeric" placeholder="blank for the org limit only" /></label>
              <fieldset className="grid gap-1 text-sm">
                <legend className="font-bold">Scopes on this token</legend>
                {[...granted].map((scope) => (
                  <label key={scope} className="flex items-center gap-2 font-normal">
                    <input type="checkbox" name="scopes" value={scope} /> {scope}
                  </label>
                ))}
              </fieldset>
            </StateForm>
          </div>
        ) : <p className="mt-3 text-sm">You cannot create a token.</p>}
      </section>
      <section className="card">
        <h2 className="font-serif text-2xl">Recent actions</h2>
        {data.actions.length === 0 ? <p className="mt-2 text-sm">No actions yet.</p> : (
          <ul className="mt-3 grid gap-1 text-sm">
            {data.actions.map((action) => <li key={action.id}>{action.tool} · {action.outcome}{action.error_code ? ` · ${action.error_code}` : ""}</li>)}
          </ul>
        )}
      </section>
      <section className="card">
        <h2 className="font-serif text-2xl">Runs</h2>
        {data.runs.length === 0 ? <p className="mt-2 text-sm">No runs yet. Pass run_id on the decision API to append spans.</p> : (
          <ul className="mt-3 grid gap-1 text-sm">{data.runs.map((run) => <li key={run.id}>{run.id}</li>)}</ul>
        )}
      </section>
    </main>
  );
}
