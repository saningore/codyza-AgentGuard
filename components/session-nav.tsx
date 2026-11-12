import Link from "next/link";
import { logout } from "@/server/auth-actions";

export function SessionNav({ orgs }: { orgs: { slug: string; name: string }[] }) {
  return (
    <nav aria-label="Account" className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-1 border-b border-line bg-paper/95 px-4 py-3 text-sm font-semibold backdrop-blur">
      {orgs.map((org) => (
        <Link key={org.slug} className="rounded-full px-3 py-2 hover:bg-mist" href={`/o/${org.slug}`}>
          {org.name}
        </Link>
      ))}
      <Link className="rounded-full px-3 py-2 hover:bg-mist" href="/orgs">Organizations</Link>
      <Link className="rounded-full px-3 py-2 hover:bg-mist" href="/account">Account</Link>
      <form action={logout}>
        <button className="rounded-full px-3 py-2 font-semibold hover:bg-mist" type="submit">Log out</button>
      </form>
    </nav>
  );
}
