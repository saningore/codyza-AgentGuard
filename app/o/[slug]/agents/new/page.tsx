import { createAgent } from "@/server/org-actions";
import { StateForm } from "@/components/state-form";
import { requireOrg } from "@/server/context";

export default async function NewAgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireOrg(slug);
  return (
    <main id="main" className="grid max-w-xl gap-4">
      <h1 className="font-serif text-4xl">New agent</h1>
      <div className="card">
        <StateForm action={createAgent} submit="Create draft">
          <input type="hidden" name="org" value={slug} />
          <label className="field">Name<input name="name" required /></label>
          <label className="field">Description<textarea name="description" /></label>
          <label className="field">Environment
            <select name="environment" defaultValue="development">
              <option value="development">development</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
          </label>
        </StateForm>
      </div>
    </main>
  );
}
