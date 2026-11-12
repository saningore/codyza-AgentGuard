import Link from "next/link";
import { SessionNav } from "@/components/session-nav";
import { requireUser, listMyOrgs } from "@/server/context";

export default async function OrgsPage() {
  const session = await requireUser();
  if (session.scope !== "full") {
    const { redirect } = await import("next/navigation");
    redirect("/mfa");
  }
  const orgs = await listMyOrgs(session.userId);
  return (
    <main id="main" className="mx-auto grid max-w-xl gap-4 px-4 py-6">
      <SessionNav orgs={orgs} />
      <h1 className="font-serif text-4xl">Organizations</h1>
      {orgs.length === 0 ? <p>You do not belong to an organization yet.</p> : orgs.map((org) => (
        <Link key={org.id} className="card" href={`/o/${org.slug}`}>
          <span className="font-bold">{org.name}</span>
          <span className="mt-1 block text-sm capitalize">{org.role}</span>
        </Link>
      ))}
    </main>
  );
}
