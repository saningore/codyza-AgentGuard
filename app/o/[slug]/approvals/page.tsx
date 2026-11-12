import { resolveApproval } from "@/server/org-actions";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; status: string; payload: { tool?: string; arguments?: unknown }; requester: string; created_at: Date }[]>`
    select ap.id, ap.status, ap.payload, u.name as requester, ap.created_at
    from approvals ap
    join users u on u.id = ap.requester_user_id
    where ap.status = 'pending'
    order by ap.created_at
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Approvals</h1>
      {query.error ? <p role="alert" className="font-bold text-clay">{query.error}</p> : null}
      {rows.length === 0 ? <p>No approvals are waiting.</p> : rows.map((row) => (
        <article key={row.id} className="card grid gap-3">
          <h2 className="font-bold">{row.payload?.tool ?? "Action"}</h2>
          <p className="text-sm">Requested by {row.requester}</p>
          <pre className="overflow-auto rounded-xl bg-mist p-3 text-xs">{JSON.stringify(row.payload?.arguments ?? {}, null, 2)}</pre>
          {ctx.can("approval.decide") ? (
            <form action={resolveApproval} className="grid gap-2">
              <input type="hidden" name="org" value={slug} />
              <input type="hidden" name="approval_id" value={row.id} />
              <label className="field">Comment<input name="comment" placeholder="Required when denying" /></label>
              <div className="flex flex-wrap gap-2">
                <button className="btn" name="decision" value="approved" type="submit">Approve</button>
                <button className="btn-secondary" name="decision" value="denied" type="submit">Deny</button>
              </div>
            </form>
          ) : null}
        </article>
      ))}
    </main>
  );
}
