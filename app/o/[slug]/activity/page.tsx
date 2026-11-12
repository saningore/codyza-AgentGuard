import { scoreAction } from "@/server/org-actions";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ outcome?: string; agent?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; tool: string; outcome: string; error_code: string | null; agent_name: string; session_id: string | null; created_at: Date }[]>`
    select ac.id, ac.tool, ac.outcome, ac.error_code, a.name as agent_name, ac.session_id, ac.created_at
    from actions ac
    join agents a on a.id = ac.agent_id
    where (${query.outcome ?? ""} = '' or ac.outcome = ${query.outcome ?? ""})
      and (${query.agent ?? ""} = '' or a.slug = ${query.agent ?? ""})
    order by ac.created_at desc
    limit 100
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Activity</h1>
      <form className="flex flex-wrap gap-2" method="get">
        <label className="field">Outcome
          <select name="outcome" defaultValue={query.outcome ?? ""}>
            <option value="">Any</option>
            <option value="allowed">allowed</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="denied">denied</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label className="field">Agent slug<input name="agent" defaultValue={query.agent ?? ""} /></label>
        <button className="btn self-end" type="submit">Filter</button>
      </form>
      <div className="table-wrap card">
        <table className="data">
          <thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Outcome</th><th>Session</th><th>Score</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6}>No actions yet.</td></tr> : rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.agent_name}</td>
                <td>{row.tool}</td>
                <td>{row.outcome}{row.error_code ? ` (${row.error_code})` : ""}</td>
                <td>{row.session_id ?? ""}</td>
                <td>
                  <form action={scoreAction} className="flex gap-1">
                    <input type="hidden" name="org" value={slug} />
                    <input type="hidden" name="action_id" value={row.id} />
                    <button className="btn-secondary" name="score" value="1" type="submit">1</button>
                    <button className="btn-secondary" name="score" value="0" type="submit">0</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
