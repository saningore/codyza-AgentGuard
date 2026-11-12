"use server";

import { redirect } from "next/navigation";
import { slugify, dbMessage } from "@/lib/format";
import { mailConfigured, sendMail } from "@/lib/mail";
import { hashPassword, passwordAccepted, verifyPassword } from "@/lib/password";
import { newMfaSecret, verifyTotp } from "@/lib/totp";
import { hashSecret, newSecretToken, pepper } from "@/lib/tokens";
import { sql, withOrg } from "@/server/db";
import {
  clearChallengeCookie,
  clearSessionCookie,
  currentSessionToken,
  getSession,
  listMyOrgs,
  readChallengeCookie,
  requireUser,
  setChallengeCookie,
  setSessionCookie,
} from "@/server/context";
import type { FormState } from "@/server/forms";

function sessionHash(raw: string) {
  return hashSecret(raw, pepper("SESSION_PEPPER"));
}

async function clientKey() {
  const { headers } = await import("next/headers");
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

async function destination(userId: string) {
  const orgs = await listMyOrgs(userId);
  if (orgs.length === 1) return `/o/${orgs[0].slug}`;
  if (orgs.length === 0) return "/signup";
  return "/orgs";
}

async function openSession(userId: string, scope: "full" | "enroll") {
  const token = newSecretToken();
  await sql`select app.open_session(${userId}::uuid, ${token.hash}, ${scope}, now() + interval '14 days')`;
  await setSessionCookie(token.raw);
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const hits = await sql<{ bump_rate: number }[]>`select app.bump_rate(${`login:${email}`}, 900) as bump_rate`;
  if (Number(hits[0]?.bump_rate) > 10) return { error: "Too many attempts. Wait a few minutes and try again." };
  const rows = await sql<{ id: string; password_hash: string; mfa_enabled: boolean }[]>`
    select * from app.lookup_login(${email})
  `;
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: "Email or password is incorrect." };
  }
  if (user.mfa_enabled) {
    const token = newSecretToken();
    await sql`select app.open_challenge(${user.id}::uuid, ${token.hash})`;
    await setChallengeCookie(token.raw);
    return { error: "", step: "totp" };
  }
  const roles = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${user.id}, true)`;
    return tx<{ role: string }[]>`
      select role from memberships where user_id = ${user.id} and status = 'active'
    `;
  });
  const needsEnroll = roles.some((row) => row.role === "owner" || row.role === "admin");
  await openSession(user.id, needsEnroll ? "enroll" : "full");
  redirect(needsEnroll ? "/mfa" : await destination(user.id));
}

export async function confirmLogin(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get("code") ?? "").trim();
  const raw = await readChallengeCookie();
  if (!raw) return { error: "That sign-in expired. Start again.", step: "password" };
  const rows = await sql<{ user_id: string; mfa_secret: string | null }[]>`
    select * from app.take_challenge(${sessionHash(raw)})
  `;
  await clearChallengeCookie();
  const challenge = rows[0];
  if (!challenge?.mfa_secret || !verifyTotp(challenge.mfa_secret, code)) {
    return { error: "That code is not valid. Sign in again.", step: "password" };
  }
  await openSession(challenge.user_id, "full");
  redirect(await destination(challenge.user_id));
}

export async function logout() {
  const raw = await currentSessionToken();
  if (raw) await sql`select app.revoke_session(${sessionHash(raw)})`;
  await clearSessionCookie();
  redirect("/login");
}

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const organization = String(formData.get("organization") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  const hits = await sql<{ bump_rate: number }[]>`select app.bump_rate(${`signup:${await clientKey()}`}, 3600) as bump_rate`;
  if (Number(hits[0]?.bump_rate) > 5) return { error: "Too many new organizations from this network. Try again later." };
  if (name.length < 2 || organization.length < 2) return { error: "Enter your name and the organization name." };
  if (!email.includes("@") || email.length > 200) return { error: "Enter a valid email address." };
  if (!passwordAccepted(password)) return { error: "Use a password of at least 12 characters." };
  const passwordHash = await hashPassword(password);
  let slug = slugify(organization);
  try {
    const created = await sql<{ user_id: string }[]>`
      select * from app.register_owner(${email}, ${name}, ${passwordHash}, ${organization}, ${slug}, ${timezone})
    `;
    await openSession(created[0].user_id, "enroll");
  } catch (error) {
    if (error instanceof Error && /organizations_slug_key|duplicate key/i.test(error.message)) {
      slug = `${slugify(organization)}-${Math.floor(Math.random() * 900 + 100)}`;
      try {
        const created = await sql<{ user_id: string }[]>`
          select * from app.register_owner(${email}, ${name}, ${passwordHash}, ${organization}, ${slug}, ${timezone})
        `;
        await openSession(created[0].user_id, "enroll");
      } catch (retry) {
        return { error: dbMessage(retry) };
      }
    } else {
      return { error: dbMessage(error) };
    }
  }
  redirect("/mfa");
}

export async function beginMfa(): Promise<FormState> {
  const session = await requireUser();
  const secret = newMfaSecret();
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${session.userId}, true)`;
      await tx`select app.begin_mfa(${secret})`;
    });
  } catch (error) {
    return { error: dbMessage(error) };
  }
  return { error: "", notice: secret };
}

export async function confirmMfa(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireUser();
  const code = String(formData.get("code") ?? "");
  const secret = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${session.userId}, true)`;
    const rows = await tx<{ my_mfa_secret: string | null }[]>`select app.my_mfa_secret() as my_mfa_secret`;
    return rows[0]?.my_mfa_secret ?? null;
  });
  if (!secret || !verifyTotp(secret, code)) return { error: "That code does not match the authenticator secret." };
  const raw = await currentSessionToken();
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${session.userId}, true)`;
    await tx`select app.confirm_mfa()`;
    if (raw) await tx`select app.promote_session(${sessionHash(raw)})`;
  });
  redirect(await destination(session.userId));
}

export async function forgotPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { error: "Enter the email on the account." };
  const hits = await sql<{ bump_rate: number }[]>`select app.bump_rate(${`forgot:${email}`}, 3600) as bump_rate`;
  if (Number(hits[0]?.bump_rate) > 5) return { error: "Too many reset requests. Wait and try again." };
  const token = newSecretToken();
  const created = await sql<{ create_password_reset: boolean }[]>`
    select app.create_password_reset(${email}, ${token.hash}) as create_password_reset
  `;
  if (created[0]?.create_password_reset && mailConfigured()) {
    const link = `${process.env.APP_URL || "http://localhost:3000"}/reset/${token.raw}`;
    await sendMail(email, "Reset your AgentGuard password", `Open this link within 30 minutes: ${link}`);
  }
  return { error: "", notice: "If an account exists for that email, a reset link is ready." };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!passwordAccepted(password)) return { error: "Use a password of at least 12 characters." };
  const ok = await sql<{ consume_password_reset: boolean }[]>`
    select app.consume_password_reset(${sessionHash(token)}, ${await hashPassword(password)}) as consume_password_reset
  `;
  if (!ok[0]?.consume_password_reset) return { error: "This reset link is invalid or already used." };
  redirect("/login");
}

export async function acceptInvite(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const hash = sessionHash(token);
  const peek = await sql<{ email: string; expired: boolean }[]>`select email, expired from app.peek_invite(${hash})`;
  const invite = peek[0];
  if (!invite || invite.expired) return { error: "This invite is invalid or expired." };
  const existing = await sql<{ id: string; password_hash: string }[]>`select * from app.lookup_login(${invite.email})`;
  try {
    let userId = "";
    if (existing[0]) {
      if (!(await verifyPassword(password, existing[0].password_hash))) {
        return { error: "That email already has an account. Enter its current password to join." };
      }
      const rows = await sql<{ accept_invite_existing: string }[]>`
        select app.accept_invite_existing(${hash}, ${existing[0].id}::uuid) as accept_invite_existing
      `;
      userId = rows[0].accept_invite_existing;
    } else {
      if (name.length < 2) return { error: "Enter your name." };
      if (!passwordAccepted(password)) return { error: "Use a password of at least 12 characters." };
      const rows = await sql<{ accept_invite_new: string }[]>`
        select app.accept_invite_new(${hash}, ${name}, ${await hashPassword(password)}) as accept_invite_new
      `;
      userId = rows[0].accept_invite_new;
    }
    const roles = await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${userId}, true)`;
      return tx<{ role: string; mfa_enabled: boolean }[]>`
        select m.role, u.mfa_enabled
        from memberships m join users u on u.id = m.user_id
        where m.user_id = ${userId} and m.status = 'active'
      `;
    });
    const enroll = roles.some((row) => (row.role === "owner" || row.role === "admin") && !row.mfa_enabled);
    await openSession(userId, enroll ? "enroll" : "full");
    redirect(enroll ? "/mfa" : await destination(userId));
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error && String((error as { digest?: string }).digest).includes("NEXT_REDIRECT")) {
      throw error;
    }
    return { error: dbMessage(error) };
  }
}

export async function updateAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  const emailAlerts = formData.get("email_alerts") === "on";
  if (name.length < 2 || name.length > 120) return { error: "Enter your name." };
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${session.userId}, true)`;
    await tx`
      update users set name = ${name}, timezone = ${timezone}, email_alerts = ${emailAlerts}
      where id = ${session.userId}
    `;
    await tx`
      insert into audit_events (actor_id, action, target) values (${session.userId}, 'account.update', ${session.userId})
    `;
  });
  return { error: "", notice: "Account saved." };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!passwordAccepted(next)) return { error: "Use a password of at least 12 characters." };
  const rows = await sql<{ password_hash: string }[]>`select password_hash from app.lookup_login(${session.email})`;
  if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) return { error: "The current password is incorrect." };
  const nextHash = await hashPassword(next);
  const raw = await currentSessionToken();
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${session.userId}, true)`;
    await tx`update users set password_hash = ${nextHash} where id = ${session.userId}`;
    await tx`select app.revoke_session(${raw ? sessionHash(raw) : ""})`;
    await tx`insert into audit_events (actor_id, action, target) values (${session.userId}, 'password.change', ${session.userId})`;
  });
  const token = newSecretToken();
  await sql`select app.open_session(${session.userId}::uuid, ${token.hash}, 'full', now() + interval '14 days')`;
  await setSessionCookie(token.raw);
  return { error: "", notice: "Password updated. Other sessions were signed out." };
}

export async function revokeSession(formData: FormData) {
  const session = await requireUser();
  const id = String(formData.get("session_id") ?? "");
  await sql`select app.revoke_session_id(${session.userId}::uuid, ${id}::uuid)`;
}

export async function leaveOrg(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const slug = String(formData.get("slug") ?? "");
  const orgs = await listMyOrgs(session.userId);
  const org = orgs.find((item) => item.slug === slug);
  if (!org) redirect("/orgs");
  try {
    await withOrg(session.userId, org.id, async (tx) => {
      const owners = await tx<{ total: number }[]>`
        select count(*)::int as total from memberships
        where organization_id = ${org.id} and role = 'owner' and status = 'active'
      `;
      if (org.role === "owner" && Number(owners[0]?.total) < 2) throw new Error("last owner");
      await tx`
        update memberships set status = 'removed'
        where organization_id = ${org.id} and user_id = ${session.userId}
      `;
      await tx`
        insert into audit_events (organization_id, actor_id, action, target)
        values (${org.id}, ${session.userId}, 'member.leave', ${session.userId})
      `;
    });
  } catch (error) {
    redirect(`/o/${slug}/settings?error=${encodeURIComponent(dbMessage(error))}`);
  }
  redirect("/orgs");
}
