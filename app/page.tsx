import Link from "next/link";
import { Logo } from "@/components/logo";
import { getSession, listMyOrgs } from "@/server/context";

export default async function HomePage() {
  const session = await getSession();
  const orgs = session ? await listMyOrgs(session.userId) : [];
  return (
    <main id="main" className="mx-auto grid max-w-5xl gap-10 px-4 py-12">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-serif text-3xl text-copper">
          <Logo className="h-11 w-11" />
          AgentGuard
        </Link>
        <nav className="flex gap-3 text-sm font-bold">
          {session ? <Link className="btn" href={orgs[0] ? `/o/${orgs[0].slug}` : "/orgs"}>Open workspace</Link> : (
            <>
              <Link className="btn-secondary" href="/login">Sign in</Link>
              <Link className="btn" href="/signup">Create organization</Link>
            </>
          )}
        </nav>
      </header>
      <section className="grid gap-4">
        <p className="text-sm font-bold uppercase tracking-wide text-copper">AI agent control plane</p>
        <h1 className="max-w-3xl font-serif text-5xl leading-tight">Decide every agent action before it changes a record.</h1>
        <p className="max-w-2xl text-lg text-ink/80">
          Organizations register agents, grant scopes, and issue tokens. A sensitive tool waits for a different person to approve it. Paused agents, missing scopes, and daily limits are stored as failed actions, not hidden in the browser.
        </p>
      </section>
      <section className="grid gap-4 md:grid-cols-3">
        <article className="card">
          <h2 className="font-serif text-2xl">Scopes</h2>
          <p className="mt-2 text-sm">A token can only carry scopes the agent already has. Test tokens cannot act for a production agent.</p>
        </article>
        <article className="card">
          <h2 className="font-serif text-2xl">Approval</h2>
          <p className="mt-2 text-sm">Customer deletion and export return 202. The row changes only after another member approves.</p>
        </article>
        <article className="card">
          <h2 className="font-serif text-2xl">Evidence</h2>
          <p className="mt-2 text-sm">Activity, failures, and the append-only audit are separate. Analytics count the rows that exist.</p>
        </article>
      </section>
      <section className="card">
        <h2 className="font-serif text-2xl">Decision API</h2>
        <p className="mt-2 text-sm">POST /api/v1/actions with a bearer token and a JSON body of tool, arguments, and an optional Idempotency-Key. The README lists the demo token and the two sample organizations.</p>
      </section>
    </main>
  );
}
