"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/server/auth-actions";
import { Logo } from "@/components/logo";

function isCurrent(pathname: string, href: string) {
  if (href === "/account") return pathname === "/account" || pathname.startsWith("/account/");
  if (href === "/orgs") return pathname === "/orgs" || pathname.startsWith("/orgs/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const home = `/o/${slug}`;
  const links = [
    ...items.map((item) => ({ href: `${home}${item.href}`, label: item.label, exact: item.href === "" })),
    { href: "/account", label: "Account", exact: false },
    { href: "/orgs", label: "Organizations", exact: false },
  ];
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-4 md:grid-cols-[220px_1fr] md:py-6">
      <aside className="sticky top-0 z-30 -mx-4 self-start border-b border-line bg-paper/95 px-4 py-3 backdrop-blur md:top-4 md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <Link href="/" className="flex items-center gap-2 font-serif text-2xl text-copper">
          <Logo />
          AgentGuard
        </Link>
        <p className="mt-3 text-sm font-bold">{orgName}</p>
        <p className="text-sm capitalize text-ink/70">{role}</p>
        <button className="btn-secondary mt-3 md:hidden" type="button" aria-expanded={open} aria-controls="org-nav" onClick={() => setOpen((value) => !value)}>
          {open ? "Close menu" : "Menu"}
        </button>
        <nav id="org-nav" className={`${open ? "grid" : "hidden"} mt-3 gap-1 text-sm font-semibold md:grid`}>
          {links.map((item) => {
            const current = item.exact ? pathname === item.href : isCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                className={`rounded-full px-3 py-2 hover:bg-mist ${current ? "bg-mist" : ""}`}
                href={item.href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
          <form action={logout}>
            <button className="rounded-full px-3 py-2 text-left font-semibold hover:bg-mist" type="submit">Log out</button>
          </form>
        </nav>
      </aside>
      <div className="grid min-w-0 gap-4">
        {demo ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm">This workspace is sample data. A new signup starts empty.</p> : null}
        {children}
      </div>
    </div>
  );
}
