import { leaveOrg } from "@/server/auth-actions";
import { saveOrg } from "@/server/org-actions";
import { StateForm } from "@/components/state-form";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await requireOrg(slug);
  const limits = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ actions_per_day: number }[]>`
    select actions_per_day from org_limits where organization_id = ${ctx.orgId}
  `);
  return (
    <main id="main" className="grid max-w-xl gap-4">
      <h1 className="font-serif text-4xl">Settings</h1>
      {query.error ? <p role="alert" className="font-bold text-clay">{query.error}</p> : null}
      {ctx.can("org.manage") ? (
        <div className="card">
          <StateForm action={saveOrg} submit="Save settings">
            <input type="hidden" name="org" value={slug} />
            <label className="field">Name<input name="name" defaultValue={ctx.orgName} required /></label>
            <label className="field">Timezone<input name="timezone" defaultValue={ctx.timezone} /></label>
            <label className="field">Actions per day<input name="actions_per_day" defaultValue={limits[0]?.actions_per_day ?? 50} /></label>
          </StateForm>
        </div>
      ) : <p>You can review this workspace. Organization settings are limited to owners and admins.</p>}
      <form action={leaveOrg}>
        <input type="hidden" name="slug" value={slug} />
        <button className="btn-secondary" type="submit">Leave organization</button>
      </form>
    </main>
  );
}
