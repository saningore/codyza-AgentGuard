"use server";

import { redirect } from "next/navigation";
import { dlpConflict, canSetStatus, type AgentStatus } from "@/lib/policy";
import { evaluate } from "@/lib/policy";
import { toolCatalog } from "@/lib/tools";
import { newApiToken, newSecretToken } from "@/lib/tokens";
import { dbMessage, slugify } from "@/lib/format";
import { withOrg } from "@/server/db";
import { requireOrg } from "@/server/context";
import type { FormState } from "@/server/forms";
import { decideApproval } from "@/server/decision";

function deny(): FormState {
  return { error: "You do not have permission to do that." };
}

export async function createAgent(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("agent.write")) return deny();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const environment = String(formData.get("environment") ?? "development");
  if (name.length < 2 || name.length > 120) return { error: "Enter an agent name." };
  if (!["development", "staging", "production"].includes(environment)) return { error: "Choose an environment." };
  const agentSlug = slugify(name);
  let created = "";
  try {
    created = await withOrg(ctx.userId, ctx.orgId, async (tx) => {
      const limits = await tx<{ agents_max: number; total: number }[]>`
        select l.agents_max, (select count(*)::int from agents a where a.organization_id = ${ctx.orgId} and a.status <> 'revoked') as total
        from org_limits l where l.organization_id = ${ctx.orgId}
      `;
      if (Number(limits[0]?.total) >= Number(limits[0]?.agents_max)) throw new Error("agent limit");
      const rows = await tx<{ id: string }[]>`
        insert into agents (organization_id, name, slug, description, environment, status, owner_user_id)
        values (${ctx.orgId}, ${name}, ${agentSlug}, ${description.slice(0, 500)}, ${environment}, 'draft', ${ctx.userId})
        returning id
      `;
      await tx`
        insert into audit_events (organization_id, actor_id, action, target, detail)
        values (${ctx.orgId}, ${ctx.userId}, 'agent.create', ${rows[0].id}, ${tx.json({ name, environment })})
      `;
      return rows[0].id;
    });
  } catch (error) {
    return { error: error instanceof Error && /agent limit/.test(error.message) ? "This organization has reached its agent limit." : dbMessage(error) };
  }
  redirect(`/o/${slug}/agents/${created}`);
}

export async function setAgentStatus(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  const agentId = String(formData.get("agent_id") ?? "");
  const to = String(formData.get("status") ?? "") as AgentStatus;
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    const rows = await tx<{ status: AgentStatus; owner_user_id: string }[]>`
      select status, owner_user_id from agents where id = ${agentId} and organization_id = ${ctx.orgId}
    `;
    const agent = rows[0];
    if (!agent) throw new Error("missing agent");
    if (!canSetStatus({ role: ctx.role, from: agent.status, to, ownsAgent: agent.owner_user_id === ctx.userId })) {
      throw new Error("permission denied");
    }
    await tx`update agents set status = ${to} where id = ${agentId}`;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target, detail)
      values (${ctx.orgId}, ${ctx.userId}, 'agent.status', ${agentId}, ${tx.json({ from: agent.status, to })})
    `;
  });
  redirect(`/o/${slug}/agents/${agentId}`);
}

export async function grantScope(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("scope.grant")) redirect(`/o/${slug}/agents?error=permission`);
  const agentId = String(formData.get("agent_id") ?? "");
  const scope = String(formData.get("scope") ?? "");
  const known = toolCatalog.some((tool) => tool.name === scope) || scope === "data.payment.read" || scope === "tool.http.write";
  if (!known) redirect(`/o/${slug}/agents/${agentId}?error=scope`);
  const sensitive = toolCatalog.find((tool) => tool.name === scope)?.sensitivity === "sensitive" || scope === "data.payment.read" || scope === "tool.http.write";
  if (sensitive && !ctx.can("scope.grant_sensitive")) redirect(`/o/${slug}/agents/${agentId}?error=permission`);
  try {
    await withOrg(ctx.userId, ctx.orgId, async (tx) => {
      const agents = await tx<{ environment: string }[]>`
        select environment from agents where id = ${agentId} and organization_id = ${ctx.orgId}
      `;
      if (!agents[0]) throw new Error("missing agent");
      const scopes = await tx<{ scope: string }[]>`select scope from agent_scopes where agent_id = ${agentId}`;
      const next = [...scopes.map((row) => row.scope), scope];
      const exceptions = await tx<{ id: string }[]>`select id from policy_exceptions where agent_id = ${agentId}`;
      if (dlpConflict({ environment: agents[0].environment, scopes: next, exception: exceptions.length > 0 })) {
        throw new Error("dlp");
      }
      await tx`
        insert into agent_scopes (organization_id, agent_id, scope, granted_by)
        values (${ctx.orgId}, ${agentId}, ${scope}, ${ctx.userId})
      `;
      await tx`
        insert into audit_events (organization_id, actor_id, action, target, detail)
        values (${ctx.orgId}, ${ctx.userId}, 'scope.grant', ${agentId}, ${tx.json({ scope })})
      `;
    });
  } catch (error) {
    redirect(`/o/${slug}/agents/${agentId}?error=${encodeURIComponent(dbMessage(error))}`);
  }
  redirect(`/o/${slug}/agents/${agentId}`);
}

export async function createToken(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("token.create")) return deny();
  const agentId = String(formData.get("agent_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const environment = String(formData.get("environment") ?? "test");
  const daily = String(formData.get("daily_limit") ?? "").trim();
  const scopes = formData.getAll("scopes").map(String);
  if (name.length < 2) return { error: "Name the token." };
  if (environment !== "test" && environment !== "live") return { error: "Choose test or live." };
  if (environment === "live" && !ctx.can("token.create_live")) return { error: "Only an owner or admin can mint a production token." };
  if (scopes.length === 0) return { error: "Choose at least one scope." };
  try {
    const secret = await withOrg(ctx.userId, ctx.orgId, async (tx) => {
      const agents = await tx<{ owner_user_id: string; environment: string }[]>`
        select owner_user_id, environment from agents where id = ${agentId} and organization_id = ${ctx.orgId}
      `;
      const agent = agents[0];
      if (!agent) throw new Error("missing agent");
      if (ctx.role === "developer" && agent.owner_user_id !== ctx.userId) throw new Error("permission denied");
      if (environment === "test" && agent.environment === "production") throw new Error("environment mismatch");
      if (environment === "live" && agent.environment !== "production") throw new Error("environment mismatch");
      const granted = await tx<{ scope: string }[]>`select scope from agent_scopes where agent_id = ${agentId}`;
      const allowed = new Set(granted.map((row) => row.scope));
      if (scopes.some((scope) => !allowed.has(scope))) throw new Error("scope missing");
      const limits = await tx<{ tokens_max: number; total: number }[]>`
        select l.tokens_max, (select count(*)::int from api_tokens t where t.organization_id = ${ctx.orgId} and t.revoked_at is null) as total
        from org_limits l where l.organization_id = ${ctx.orgId}
      `;
      if (Number(limits[0]?.total) >= Number(limits[0]?.tokens_max)) throw new Error("token limit");
      const minted = newApiToken(environment);
      const dailyLimit = daily ? Number(daily) : null;
      if (daily && (!Number.isInteger(dailyLimit) || dailyLimit! < 1)) throw new Error("bad limit");
      await tx`
        insert into api_tokens (
          organization_id, agent_id, name, prefix, token_hash, environment, scopes, daily_limit, created_by
        ) values (
          ${ctx.orgId}, ${agentId}, ${name}, ${minted.prefix}, ${minted.hash}, ${environment},
          ${scopes}, ${dailyLimit}, ${ctx.userId}
        )
      `;
      await tx`
        insert into audit_events (organization_id, actor_id, action, target, detail)
        values (${ctx.orgId}, ${ctx.userId}, 'token.create', ${agentId}, ${tx.json({ prefix: minted.prefix, environment })})
      `;
      return minted.raw;
    });
    return { error: "", notice: secret };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/token limit/.test(message)) return { error: "This organization has reached its token limit." };
    if (/environment mismatch/.test(message)) return { error: "That token type does not match the agent environment." };
    if (/scope missing/.test(message)) return { error: "A token scope must already be granted to the agent." };
    return { error: dbMessage(error) };
  }
}

export async function revokeToken(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("token.revoke")) redirect(`/o/${slug}?error=permission`);
  const tokenId = String(formData.get("token_id") ?? "");
  const agentId = String(formData.get("agent_id") ?? "");
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`update api_tokens set revoked_at = now() where id = ${tokenId} and organization_id = ${ctx.orgId} and revoked_at is null`;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target)
      values (${ctx.orgId}, ${ctx.userId}, 'token.revoke', ${tokenId})
    `;
    await tx`
      insert into notifications (organization_id, user_id, kind, title, body, href)
      select ${ctx.orgId}, a.owner_user_id, 'token.revoked', 'Token revoked', 'An API token was revoked.', ${`/o/${slug}/agents/${agentId}`}
      from agents a where a.id = ${agentId}
    `;
  });
  redirect(`/o/${slug}/agents/${agentId}`);
}

export async function resolveApproval(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("approval.decide")) redirect(`/o/${slug}/approvals?error=permission`);
  const approvalId = String(formData.get("approval_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "");
  if (decision !== "approved" && decision !== "denied") redirect(`/o/${slug}/approvals`);
  try {
    await decideApproval({
      userId: ctx.userId,
      orgId: ctx.orgId,
      role: ctx.role,
      approvalId,
      decision,
      comment,
    });
  } catch (error) {
    redirect(`/o/${slug}/approvals?error=${encodeURIComponent(dbMessage(error))}`);
  }
  redirect(`/o/${slug}/approvals`);
}

export async function scoreAction(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("activity.read")) redirect(`/o/${slug}/activity`);
  const actionId = String(formData.get("action_id") ?? "");
  const score = Number(formData.get("score"));
  const note = String(formData.get("note") ?? "").slice(0, 500);
  if (score !== 0 && score !== 1) redirect(`/o/${slug}/activity`);
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`
      insert into action_scores (organization_id, action_id, user_id, score, note)
      values (${ctx.orgId}, ${actionId}, ${ctx.userId}, ${score}, ${note})
      on conflict (action_id, user_id) do update set score = excluded.score, note = excluded.note
    `;
  });
  redirect(`/o/${slug}/activity`);
}

export async function savePolicyCase(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("policy.manage")) return deny();
  const name = String(formData.get("name") ?? "").trim();
  const tool = String(formData.get("tool") ?? "");
  const environment = String(formData.get("environment") ?? "development");
  const expected = String(formData.get("expected_code") ?? "");
  let args: unknown = {};
  try {
    args = JSON.parse(String(formData.get("arguments") ?? "{}"));
  } catch {
    return { error: "Arguments must be JSON." };
  }
  if (name.length < 2) return { error: "Name the case." };
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`
      insert into policy_cases (organization_id, name, tool, arguments, environment, expected_code, created_by)
      values (${ctx.orgId}, ${name}, ${tool}, ${tx.json(JSON.parse(JSON.stringify(args)))}, ${environment}, ${expected}, ${ctx.userId})
    `;
  });
  redirect(`/o/${slug}/policy-cases`);
}

export async function runPolicyCase(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("policy.manage")) redirect(`/o/${slug}/policy-cases`);
  const caseId = String(formData.get("case_id") ?? "");
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    const rows = await tx<{ tool: string; arguments: unknown; environment: string; expected_code: string }[]>`
      select tool, arguments, environment, expected_code from policy_cases where id = ${caseId}
    `;
    const item = rows[0];
    if (!item) return;
    const catalog = toolCatalog.find((tool) => tool.name === item.tool);
    const verdict = evaluate({
      rateLimited: false,
      tokenFound: true,
      environmentOk: true,
      agentStatus: "active",
      toolKnown: Boolean(catalog),
      argumentsOk: true,
      scopeGranted: true,
      behalfRequired: false,
      behalfAllowed: false,
      policyDenied: item.environment === "production" && /ignore\s+(all|any|previous)\s+(policy|instructions)/i.test(JSON.stringify(item.arguments)),
      quotaOk: true,
      sensitive: catalog?.sensitivity === "sensitive",
      replay: false,
    });
    await tx`
      insert into policy_case_runs (organization_id, case_id, passed, actual_code)
      values (${ctx.orgId}, ${caseId}, ${verdict.code === item.expected_code}, ${verdict.code})
    `;
  });
  redirect(`/o/${slug}/policy-cases`);
}

export async function createCustomer(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("customer.write")) return deny();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (name.length < 2) return { error: "Enter the customer name." };
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`
      insert into customers (organization_id, name, email)
      values (${ctx.orgId}, ${name}, ${email || null})
    `;
  });
  redirect(`/o/${slug}/customers`);
}

export async function inviteMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("member.manage")) return deny();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer");
  if (!["admin", "operator", "approver", "developer", "auditor", "viewer"].includes(role)) return { error: "Choose a role." };
  if (!email.includes("@")) return { error: "Enter an email address." };
  const token = newSecretToken();
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`
      insert into invitations (organization_id, email, role, token_hash, expires_at, invited_by)
      values (${ctx.orgId}, ${email}, ${role}, ${token.hash}, now() + interval '7 days', ${ctx.userId})
    `;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target, detail)
      values (${ctx.orgId}, ${ctx.userId}, 'member.invite', ${email}, ${tx.json({ role })})
    `;
  });
  return { error: "", notice: `${process.env.APP_URL || "http://localhost:3000"}/invite/${token.raw}` };
}

export async function saveOrg(_prev: FormState, formData: FormData): Promise<FormState> {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("org.manage")) return deny();
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? ctx.timezone);
  const actions = Number(formData.get("actions_per_day"));
  if (name.length < 2) return { error: "Enter the organization name." };
  if (!Number.isInteger(actions) || actions < 1 || actions > 100000) return { error: "Enter a daily action limit." };
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`update organizations set name = ${name}, timezone = ${timezone} where id = ${ctx.orgId}`;
    await tx`update org_limits set actions_per_day = ${actions} where organization_id = ${ctx.orgId}`;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target, detail)
      values (${ctx.orgId}, ${ctx.userId}, 'org.update', ${ctx.orgId}, ${tx.json({ actions_per_day: actions })})
    `;
  });
  return { error: "", notice: "Organization saved." };
}

export async function markNotification(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  const id = String(formData.get("id") ?? "");
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`update notifications set read_at = now() where id = ${id} and user_id = ${ctx.userId}`;
  });
  redirect(`/o/${slug}/notifications`);
}

export async function recordDlpException(formData: FormData) {
  const slug = String(formData.get("org") ?? "");
  const ctx = await requireOrg(slug);
  if (!ctx.can("scope.grant_sensitive")) redirect(`/o/${slug}/agents`);
  const agentId = String(formData.get("agent_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) redirect(`/o/${slug}/agents/${agentId}?error=reason`);
  await withOrg(ctx.userId, ctx.orgId, async (tx) => {
    await tx`
      insert into policy_exceptions (organization_id, agent_id, reason, created_by)
      values (${ctx.orgId}, ${agentId}, ${reason}, ${ctx.userId})
      on conflict (agent_id) do update set reason = excluded.reason, created_by = excluded.created_by
    `;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target, detail)
      values (${ctx.orgId}, ${ctx.userId}, 'policy.exception', ${agentId}, ${tx.json({ reason })})
    `;
  });
  redirect(`/o/${slug}/agents/${agentId}`);
}
