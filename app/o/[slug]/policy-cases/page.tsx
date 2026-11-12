import { runPolicyCase, savePolicyCase } from "@/server/org-actions";
import { StateForm } from "@/components/state-form";
import { requireOrg } from "@/server/context";
import { withOrg } from "@/server/db";

export default async function PolicyCasesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const rows = await withOrg(ctx.userId, ctx.orgId, (tx) => tx<{ id: string; name: string; expected_code: string; actual: string | null; passed: boolean | null }[]>`
    select c.id, c.name, c.expected_code,
      (select r.actual_code from policy_case_runs r where r.case_id = c.id order by r.created_at desc limit 1) as actual,
      (select r.passed from policy_case_runs r where r.case_id = c.id order by r.created_at desc limit 1) as passed
    from policy_cases c order by c.created_at desc
  `);
  return (
    <main id="main" className="grid gap-4">
      <h1 className="font-serif text-4xl">Policy cases</h1>
      <p className="text-sm">Saved cases re-run against the current decision rules and store pass or fail. They do not perform the tool.</p>
      {rows.length === 0 ? <p>No cases yet.</p> : rows.map((row) => (
        <article key={row.id} className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">{row.name}</h2>
            <p className="text-sm">Expected {row.expected_code}{row.actual ? ` · last ${row.actual} · ${row.passed ? "pass" : "fail"}` : ""}</p>
          </div>
          <form action={runPolicyCase}>
            <input type="hidden" name="org" value={slug} />
            <input type="hidden" name="case_id" value={row.id} />
            <button className="btn-secondary" type="submit">Run</button>
          </form>
        </article>
      ))}
      {ctx.can("policy.manage") ? (
        <div className="card max-w-xl">
          <StateForm action={savePolicyCase} submit="Save case">
            <input type="hidden" name="org" value={slug} />
            <label className="field">Name<input name="name" required /></label>
            <label className="field">Tool<input name="tool" defaultValue="customer.delete" /></label>
            <label className="field">Environment
              <select name="environment" defaultValue="development"><option>development</option><option>staging</option><option>production</option></select>
            </label>
            <label className="field">Expected code<input name="expected_code" defaultValue="approval_required" /></label>
            <label className="field">Arguments JSON<textarea name="arguments" defaultValue="{}" /></label>
          </StateForm>
        </div>
      ) : null}
    </main>
  );
}
