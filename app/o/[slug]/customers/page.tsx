import { createCustomer } from "@/server/org-actions";
import { StateForm } from "@/components/state-form";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function CustomersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; name: string; email: string | null; deleted_at: Date | null }[]>`
    select id, name, email, deleted_at from customers order by created_at desc
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Customers</h1>
      {rows.length === 0 ? <p>No customers yet.</p> : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="card text-sm">
              <span className="font-bold">{row.name}</span>
              {row.email ? ` · ${row.email}` : ""}
              {row.deleted_at ? " · deleted" : ""}
            </li>
          ))}
        </ul>
      )}
      {ctx.can("customer.write") ? (
        <div className="card max-w-xl">
          <StateForm action={createCustomer} submit="Add customer">
            <input type="hidden" name="org" value={slug} />
            <label className="field">Name<input name="name" required /></label>
            <label className="field">Email<input name="email" type="email" /></label>
          </StateForm>
        </div>
      ) : null}
    </main>
  );
}
