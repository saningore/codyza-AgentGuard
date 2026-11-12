import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function AuditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = ctx.can("audit.read")
    ? await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ action: string; target: string | null; actor: string | null; created_at: Date }[]>`
        select e.action, e.target, u.name as actor, e.created_at
        from audit_events e
        left join users u on u.id = e.actor_id
        where e.organization_id = ${ctx.orgId}
        order by e.created_at desc limit 100
      `)
    : [];
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Audit</h1>
      {!ctx.can("audit.read") ? <p>You cannot read the audit log.</p> : rows.length === 0 ? <p>No audit events yet.</p> : (
        <div className="table-wrap card">
          <table className="data">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.action}-${index}`}>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.actor ?? "System"}</td>
                  <td>{row.action}</td>
                  <td>{row.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
