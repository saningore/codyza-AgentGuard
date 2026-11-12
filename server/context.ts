import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { hashSecret, pepper } from "@/lib/tokens";
import { sql, withOrg } from "@/server/db";

export type Session = {
  userId: string;
  email: string;
  name: string;
  scope: "full" | "enroll";
  mfaEnabled: boolean;
  timezone: string;
};

export type OrgContext = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  slug: string;
  role: string;
  timezone: string;
  demo: boolean;
  permissions: string[];
  can: (permission: string) => boolean;
};

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function sessionHash(raw: string) {
  return hashSecret(raw, pepper("SESSION_PEPPER"));
}

export async function setSessionCookie(raw: string) {
  const jar = await cookies();
  jar.set("ag_session", raw, { ...cookieBase, maxAge: 60 * 60 * 24 * 14 });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete("ag_session");
}

export async function setChallengeCookie(raw: string) {
  const jar = await cookies();
  jar.set("ag_challenge", raw, { ...cookieBase, maxAge: 60 * 5 });
}

export async function readChallengeCookie() {
  const jar = await cookies();
  return jar.get("ag_challenge")?.value ?? null;
}

export async function clearChallengeCookie() {
  const jar = await cookies();
  jar.delete("ag_challenge");
}

export async function currentSessionToken() {
  const jar = await cookies();
  return jar.get("ag_session")?.value ?? null;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const raw = await currentSessionToken();
  if (!raw) return null;
  const rows = await sql<
    { user_id: string; email: string; name: string; scope: "full" | "enroll"; mfa_enabled: boolean; timezone: string }[]
  >`select * from app.read_session(${sessionHash(raw)})`;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    scope: row.scope,
    mfaEnabled: row.mfa_enabled,
    timezone: row.timezone,
  };
});

export const requireUser = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
});

export async function listMyOrgs(userId: string) {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await tx`select set_config('app.org_id', '', true)`;
    return tx<{ id: string; name: string; slug: string; role: string }[]>`
      select o.id, o.name, o.slug, m.role
      from memberships m
      join organizations o on o.id = m.organization_id
      where m.user_id = ${userId} and m.status = 'active'
      order by o.name
    `;
  });
}

export async function loadOrg(slug: string): Promise<OrgContext | "login" | "mfa" | null> {
  const session = await getSession();
  if (!session) return "login";
  if (session.scope !== "full") return "mfa";
  const orgs = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${session.userId}, true)`;
    await tx`select set_config('app.org_id', '', true)`;
    return tx<{ id: string; name: string; slug: string; timezone: string; demo: boolean; role: string }[]>`
      select o.id, o.name, o.slug, o.timezone, o.demo, m.role
      from memberships m
      join organizations o on o.id = m.organization_id
      where m.user_id = ${session.userId} and m.status = 'active' and o.slug = ${slug}
    `;
  });
  const org = orgs[0];
  if (!org) return null;
  if ((org.role === "owner" || org.role === "admin") && !session.mfaEnabled) return "mfa";
  const permissions = await withOrg(session.userId, org.id, async (tx) => {
    const rows = await tx<{ permission: string }[]>`
      select permission from role_permissions where role = ${org.role} order by permission
    `;
    return rows.map((row) => row.permission);
  });
  return {
    userId: session.userId,
    email: session.email,
    name: session.name,
    orgId: org.id,
    orgName: org.name,
    slug: org.slug,
    role: org.role,
    timezone: org.timezone,
    demo: org.demo,
    permissions,
    can: (permission: string) => permissions.includes(permission),
  };
}

export const requireOrg = cache(async (slug: string): Promise<OrgContext> => {
  const loaded = await loadOrg(slug);
  if (loaded === "login") redirect("/login");
  if (loaded === "mfa") redirect("/mfa");
  if (!loaded) notFound();
  return loaded;
});
