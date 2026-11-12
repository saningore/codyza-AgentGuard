import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function TicketsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; title: string; body: string; created_at: Date }[]>`
    select id, title, body, created_at from tickets order by created_at desc limit 50
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Tickets</h1>
      {rows.length === 0 ? <p>No tickets yet. An allowed ticket.create call writes one here.</p> : rows.map((row) => (
        <article key={row.id} className="card">
          <h2 className="font-bold">{row.title}</h2>
          {row.body ? <p className="mt-1 text-sm">{row.body}</p> : null}
        </article>
      ))}
    </main>
  );
}
