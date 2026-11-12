import { inviteMember } from "@/server/org-actions";
import { StateForm } from "@/components/state-form";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ name: string; email: string; role: string; status: string }[]>`
    select u.name, u.email::text, m.role, m.status
    from memberships m join users u on u.id = m.user_id
    order by u.name
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Members</h1>
      <ul className="grid gap-2">{rows.map((row) => <li key={row.email} className="card text-sm">{row.name} · {row.email} · {row.role} · {row.status}</li>)}</ul>
      {ctx.can("member.manage") ? (
        <div className="card max-w-xl">
          <h2 className="font-serif text-2xl">Invite</h2>
          <StateForm action={inviteMember} submit="Create invite">
            <input type="hidden" name="org" value={slug} />
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Role
              <select name="role" defaultValue="viewer">
                <option>admin</option><option>operator</option><option>approver</option>
                <option>developer</option><option>auditor</option><option>viewer</option>
              </select>
            </label>
          </StateForm>
        </div>
      ) : null}
    </main>
  );
}
