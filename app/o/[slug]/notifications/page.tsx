import { markNotification } from "@/server/org-actions";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; title: string; body: string; read_at: Date | null; href: string | null }[]>`
    select id, title, body, read_at, href from notifications where user_id = ${ctx.userId} order by created_at desc limit 50
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Alerts</h1>
      {rows.length === 0 ? <p>No alerts yet.</p> : rows.map((row) => (
        <article key={row.id} className="card">
          <h2 className="font-bold">{row.title}</h2>
          <p className="text-sm">{row.body}</p>
          {!row.read_at ? (
            <form action={markNotification} className="mt-2">
              <input type="hidden" name="org" value={slug} />
              <input type="hidden" name="id" value={row.id} />
              <button className="btn-secondary" type="submit">Mark read</button>
            </form>
          ) : <p className="mt-2 text-xs">Read</p>}
        </article>
      ))}
    </main>
  );
}
