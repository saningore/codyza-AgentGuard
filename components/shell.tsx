"use client";

import Link from "next/link";
import { useState } from "react";
import { logout } from "@/server/auth-actions";
import { Logo } from "@/components/logo";

export function Shell({
  slug,
  orgName,
  role,
  demo,
  items,
  children,
}: {
  slug: string;
  orgName: string;
  role: string;
  demo: boolean;
  items: { href: string; label: string }[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const links = items.map((item) => (
    <Link key={item.href} className="rounded-full px-3 py-2 hover:bg-mist" href={`/o/${slug}${item.href}`} onClick={() => setOpen(false)}>
      {item.label}
    </Link>
  ));
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:grid-cols-[220px_1fr]">
      <aside className="md:sticky md:top-4 md:self-start">
        <Link href="/" className="flex items-center gap-2 font-serif text-2xl text-copper">
          <Logo />
          AgentGuard
        </Link>
        <p className="mt-3 text-sm font-bold">{orgName}</p>
        <p className="text-sm capitalize text-ink/70">{role}</p>
        <button className="btn-secondary mt-3 md:hidden" type="button" aria-expanded={open} aria-controls="org-nav" onClick={() => setOpen((value) => !value)}>
          Menu
        </button>
        <nav id="org-nav" className={`${open ? "grid" : "hidden"} mt-3 gap-1 text-sm font-semibold md:grid`}>
          {links}
          <Link className="rounded-full px-3 py-2 hover:bg-mist" href="/account">Account</Link>
          <Link className="rounded-full px-3 py-2 hover:bg-mist" href="/orgs">Organizations</Link>
          <form action={logout}>
            <button className="rounded-full px-3 py-2 text-left font-semibold hover:bg-mist" type="submit">Log out</button>
          </form>
        </nav>
      </aside>
      <div className="grid gap-4">
        {demo ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm">This workspace is sample data. A new signup starts empty.</p> : null}
        {children}
      </div>
    </div>
  );
}
