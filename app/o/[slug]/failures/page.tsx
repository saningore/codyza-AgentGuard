import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function FailuresPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; tool: string; outcome: string; error_code: string | null; created_at: Date; agent_name: string }[]>`
    select ac.id, ac.tool, ac.outcome, ac.error_code, ac.created_at, a.name as agent_name
    from actions ac join agents a on a.id = ac.agent_id
    where ac.outcome in ('failed', 'denied') or ac.error_code in ('quota_exceeded', 'approval_expired')
    order by ac.created_at desc limit 100
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Failed actions</h1>
      {rows.length === 0 ? <p>No failed actions yet.</p> : (
        <div className="table-wrap card">
          <table className="data">
            <thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Code</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.agent_name}</td>
                  <td>{row.tool}</td>
                  <td>{row.error_code ?? row.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
