import { canApprove, dlpConflict, environmentsMatch, evaluate, payloadViolates, type AgentStatus } from "@/lib/policy";
import { parseTool, type ToolName } from "@/lib/tools";
import { hashSecret, pepper } from "@/lib/tokens";
import { sql, withOrg, type Tx } from "@/server/db";

type TokenRow = {
  token_id: string;
  org_id: string;
  agent_id: string;
  agent_status: AgentStatus;
  agent_environment: string;
  agent_owner: string;
  token_environment: "test" | "live";
  token_scopes: string[];
  daily_limit: number | null;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
  org_daily: number;
  agent_scopes: string[];
  dlp_exception: boolean;
};

export type ActionResult = {
  status: number;
  body: Record<string, unknown>;
};

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

async function executeTool(
  tx: Tx,
  input: {
    orgId: string;
    agentId: string;
    actionId: string;
    tool: ToolName;
    args: Record<string, unknown>;
    notifyUser: string;
  },
): Promise<{ ok: true; resourceId: string | null } | { ok: false; code: string }> {
  if (input.tool === "ticket.create") {
    const rows = await tx<{ id: string }[]>`
      insert into tickets (organization_id, agent_id, action_id, title, body)
      values (
        ${input.orgId}, ${input.agentId}, ${input.actionId},
        ${String(input.args.title)}, ${String(input.args.body ?? "")}
      )
      returning id
    `;
    return { ok: true, resourceId: rows[0].id };
  }
  if (input.tool === "customer.create") {
    const rows = await tx<{ id: string }[]>`
      insert into customers (organization_id, name, email)
      values (${input.orgId}, ${String(input.args.name)}, ${input.args.email ? String(input.args.email) : null})
      returning id
    `;
    return { ok: true, resourceId: rows[0].id };
  }
  if (input.tool === "customer.delete") {
    const rows = await tx<{ id: string }[]>`
      update customers
      set deleted_at = now()
      where id = ${String(input.args.customer_id)}
        and organization_id = ${input.orgId}
        and deleted_at is null
      returning id
    `;
    if (!rows[0]) return { ok: false, code: "not_found" };
    return { ok: true, resourceId: rows[0].id };
  }
  if (input.tool === "customer.export") {
    const counts = await tx<{ total: number }[]>`
      select count(*)::int as total from customers
      where organization_id = ${input.orgId} and deleted_at is null
    `;
    const rows = await tx<{ id: string }[]>`
      insert into export_jobs (organization_id, action_id, row_count)
      values (${input.orgId}, ${input.actionId}, ${counts[0]?.total ?? 0})
      returning id
    `;
    return { ok: true, resourceId: rows[0].id };
  }
  if (input.tool === "notification.send") {
    const requested = input.args.user_id ? String(input.args.user_id) : input.notifyUser;
    const members = await tx<{ user_id: string }[]>`
      select user_id from memberships
      where organization_id = ${input.orgId} and user_id = ${requested} and status = 'active'
    `;
    const userId = members[0]?.user_id ?? input.notifyUser;
    const rows = await tx<{ id: string }[]>`
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        ${input.orgId}, ${userId}, 'agent.notification',
        ${String(input.args.title)}, ${String(input.args.body)}, null
      )
      returning id
    `;
    return { ok: true, resourceId: rows[0].id };
  }
  if (!process.env.OPENAI_API_KEY) return { ok: false, code: "provider_not_configured" };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: String(input.args.prompt) }],
      max_tokens: 300,
    }),
  });
  if (!response.ok) return { ok: false, code: "provider_error" };
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = payload.choices?.[0]?.message?.content ?? "";
  const rows = await tx<{ id: string }[]>`
    insert into tickets (organization_id, agent_id, action_id, title, body)
    values (${input.orgId}, ${input.agentId}, ${input.actionId}, 'Model completion', ${text.slice(0, 4000)})
    returning id
  `;
  return { ok: true, resourceId: rows[0].id };
}

async function behalfAllowed(tx: Tx, orgId: string, userId: string, tool: string) {
  const permission = tool.startsWith("customer.") ? "customer.write" : "agent.write";
  const rows = await tx<{ ok: boolean }[]>`
    select exists (
      select 1
      from memberships m
      join role_permissions rp on rp.role = m.role and rp.permission = ${permission}
      where m.organization_id = ${orgId} and m.user_id = ${userId} and m.status = 'active'
    ) as ok
  `;
  return Boolean(rows[0]?.ok);
}

export async function executeAction(input: {
  authorization: string | null;
  body: unknown;
  clientKey: string;
  idempotencyKey?: string | null;
}): Promise<ActionResult> {
  const record = input.body;
  if (!record || typeof record !== "object") {
    return { status: 422, body: { error: "invalid_arguments" } };
  }
  const toolName = "tool" in record ? String(record.tool ?? "") : "";
  const args = "arguments" in record ? record.arguments : {};
  const sessionId = "session_id" in record && record.session_id != null ? String(record.session_id).slice(0, 80) : null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const runId = "run_id" in record && typeof record.run_id === "string" && uuidPattern.test(record.run_id) ? record.run_id : null;
  const behalf = "on_behalf_of" in record && typeof record.on_behalf_of === "string" ? record.on_behalf_of : null;
  if (behalf && !uuidPattern.test(behalf)) return { status: 422, body: { error: "invalid_arguments" } };
  const rawToken = input.authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const clientKey = input.clientKey.slice(0, 80) || "local";
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey && !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
    return { status: 422, body: { error: "invalid_arguments" } };
  }

  const ipHits = await sql<{ bump_rate: number }[]>`select app.bump_rate(${`ip:${clientKey}`}, 60) as bump_rate`;
  if (Number(ipHits[0]?.bump_rate) > 120) {
    return { status: 429, body: { error: "rate_limited" } };
  }
  if (!rawToken) return { status: 401, body: { error: "invalid_token" } };

  let tokenHash = "";
  try {
    tokenHash = hashSecret(rawToken, pepper("TOKEN_PEPPER"));
  } catch {
    return { status: 401, body: { error: "invalid_token" } };
  }

  const resolved = await sql<{ resolve_token: TokenRow | null }[]>`select app.resolve_token(${tokenHash}) as resolve_token`;
  const token = resolved[0]?.resolve_token;
  if (!token || token.revoked_at || (token.expires_at && new Date(token.expires_at).getTime() < Date.now())) {
    return { status: 401, body: { error: "invalid_token" } };
  }
  token.token_scopes = asStringArray(token.token_scopes);
  token.agent_scopes = asStringArray(token.agent_scopes);

  const tokenHits = await sql<{ bump_rate: number }[]>`select app.bump_rate(${`token:${token.token_id}`}, 60) as bump_rate`;
  if (Number(tokenHits[0]?.bump_rate) > 60) {
    return { status: 429, body: { error: "rate_limited" } };
  }

  const parsed = parseTool(toolName, args);
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${token.created_by}, true)`;
    await tx`select set_config('app.org_id', ${token.org_id}, true)`;
    await tx`select set_config('app.token_id', ${token.token_id}, true)`;
    await tx`select app.touch_token(${token.token_id}::uuid)`;

    if (idempotencyKey) {
      const prior = await tx<{ http_status: number; body: Record<string, unknown> }[]>`
        select http_status, body from idempotency_keys
        where token_id = ${token.token_id} and idempotency_key = ${idempotencyKey}
      `;
      if (prior[0]) {
        return { status: prior[0].http_status, body: { ...prior[0].body, code: "idempotent_replay" } };
      }
    }

    if (runId) {
      await tx`
        insert into runs (id, organization_id, agent_id, session_id)
        values (${runId}::uuid, ${token.org_id}, ${token.agent_id}, ${sessionId})
        on conflict (id) do nothing
      `;
    }

    const toolKnown = parsed.ok ? true : parsed.code !== "unknown_tool";
    const argumentsOk = parsed.ok ? true : parsed.code !== "invalid_arguments";
    const scopeGranted = parsed.ok && token.token_scopes.includes(parsed.name) && token.agent_scopes.includes(parsed.name);
    const behalfOk = behalf ? await behalfAllowed(tx, token.org_id, behalf, toolName) : false;
    const deniedByPolicy =
      payloadViolates(token.agent_environment, args) ||
      dlpConflict({
        environment: token.agent_environment,
        scopes: token.agent_scopes,
        exception: token.dlp_exception,
      });

    const baseFacts = {
      rateLimited: false,
      tokenFound: true,
      environmentOk: environmentsMatch(token.token_environment, token.agent_environment),
      agentStatus: token.agent_status,
      toolKnown,
      argumentsOk,
      scopeGranted,
      behalfRequired: Boolean(behalf),
      behalfAllowed: behalfOk,
      policyDenied: deniedByPolicy,
      sensitive: parsed.ok && parsed.sensitivity === "sensitive",
      replay: false,
    };

    let verdict = evaluate({ ...baseFacts, quotaOk: true });
    if (verdict.consumeQuota) {
      const quota = await tx<{ consume_quota: boolean }[]>`
        select app.consume_quota(
          ${token.org_id}::uuid,
          ${token.token_id}::uuid,
          ${token.org_daily},
          ${token.daily_limit}
        ) as consume_quota
      `;
      if (!quota[0]?.consume_quota) verdict = evaluate({ ...baseFacts, quotaOk: false });
    }

    if (!verdict.record) {
      return { status: verdict.http, body: { error: verdict.code } };
    }

    const inserted = await tx<{ id: string }[]>`
      insert into actions (
        organization_id, agent_id, token_id, tool, arguments, outcome, http_status, error_code, session_id, run_id, idempotency_key
      ) values (
        ${token.org_id}, ${token.agent_id}, ${token.token_id}, ${toolName}, ${tx.json(JSON.parse(JSON.stringify(args ?? {})))},
        ${verdict.outcome === "allowed" ? "allowed" : verdict.outcome === "pending" ? "pending" : verdict.outcome === "denied" ? "denied" : "failed"},
        ${verdict.http},
        ${verdict.code === "allowed" || verdict.code === "approval_required" ? null : verdict.code},
        ${sessionId},
        ${runId},
        ${idempotencyKey}
      )
      returning id
    `;
    const actionId = inserted[0].id;
    if (runId) {
      await tx`
        insert into spans (organization_id, run_id, action_id, name)
        select ${token.org_id}, r.id, ${actionId}, ${toolName}
        from runs r
        where r.id = ${runId}::uuid and r.organization_id = ${token.org_id}
      `;
    }

    let resourceId: string | null = null;
    let approvalId: string | null = null;
    let status = verdict.http;
    let code = verdict.code;
    let decision = verdict.outcome;

    if (verdict.execute && parsed.ok) {
      const effect = await executeTool(tx, {
        orgId: token.org_id,
        agentId: token.agent_id,
        actionId,
        tool: parsed.name,
        args: parsed.args,
        notifyUser: behalf ?? token.created_by,
      });
      if (!effect.ok) {
        status = 422;
        code = "invalid_arguments";
        decision = "failed";
        await tx`
          update actions set outcome = 'failed', http_status = 422, error_code = ${effect.code}
          where id = ${actionId}
        `;
      } else {
        resourceId = effect.resourceId;
        await tx`update actions set resource_id = ${resourceId} where id = ${actionId}`;
      }
    }

    if (verdict.outcome === "pending" && parsed.ok) {
      const approvals = await tx<{ id: string }[]>`
        insert into approvals (
          organization_id, action_id, agent_id, requester_user_id, status, expires_at, payload
        ) values (
          ${token.org_id}, ${actionId}, ${token.agent_id}, ${token.created_by}, 'pending',
          now() + interval '24 hours', ${tx.json(JSON.parse(JSON.stringify({ tool: parsed.name, arguments: parsed.args })))}
        )
        returning id
      `;
      approvalId = approvals[0].id;
      const approvers = await tx<{ user_id: string; slug: string }[]>`
        select m.user_id, o.slug
        from memberships m
        join organizations o on o.id = m.organization_id
        join role_permissions rp on rp.role = m.role and rp.permission = 'approval.decide'
        where m.organization_id = ${token.org_id} and m.status = 'active'
      `;
      for (const approver of approvers) {
        if (approver.user_id === token.created_by || approver.user_id === token.agent_owner) continue;
        await tx`
          insert into notifications (organization_id, user_id, kind, title, body, href)
          values (
            ${token.org_id}, ${approver.user_id}, 'approval.requested',
            'Approval needed', ${`${parsed.name} is waiting for a decision.`},
            ${`/o/${approver.slug}/approvals`}
          )
        `;
      }
    }

    const body: Record<string, unknown> = {
      decision,
      code,
      action_id: actionId,
    };
    if (resourceId) body.resource_id = resourceId;
    if (approvalId) body.approval_id = approvalId;
    if (status >= 400) body.error = code;

    if (idempotencyKey) {
      await tx`
        insert into idempotency_keys (token_id, idempotency_key, action_id, http_status, error_code, body)
        values (${token.token_id}, ${idempotencyKey}, ${actionId}, ${status}, ${status >= 400 ? code : null}, ${tx.json(JSON.parse(JSON.stringify(body)))})
      `;
    }
    return { status, body };
  });
}

export async function decideApproval(input: {
  userId: string;
  orgId: string;
  role: string;
  approvalId: string;
  decision: "approved" | "denied";
  comment: string;
}) {
  return withOrg(input.userId, input.orgId, async (tx) => {
    const rows = await tx<
      {
        id: string;
        action_id: string;
        agent_id: string;
        requester_user_id: string;
        owner_user_id: string;
        payload: { tool: string; arguments: Record<string, unknown> };
        status: string;
      }[]
    >`
      select ap.id, ap.action_id, ap.agent_id, ap.requester_user_id, a.owner_user_id, ap.payload, ap.status
      from approvals ap
      join agents a on a.id = ap.agent_id
      where ap.id = ${input.approvalId} and ap.organization_id = ${input.orgId}
    `;
    const approval = rows[0];
    if (!approval || approval.status !== "pending") throw new Error("cannot approve");
    if (!canApprove({
      role: input.role,
      decidedBy: input.userId,
      requesterId: approval.requester_user_id,
      agentOwnerId: approval.owner_user_id,
    })) {
      throw new Error("cannot approve");
    }
    if (input.decision === "denied" && input.comment.trim().length < 3) throw new Error("comment required");
    const comment = input.comment.trim();
    if (input.decision === "denied") {
      await tx`
        update approvals
        set status = 'denied', comment = ${comment}, decided_by = ${input.userId}, decided_at = now()
        where id = ${approval.id} and status = 'pending'
      `;
      await tx`
        update actions set outcome = 'denied', error_code = 'approval_denied', http_status = 403
        where id = ${approval.action_id}
      `;
      await tx`
        insert into audit_events (organization_id, actor_id, action, target, detail)
        values (${input.orgId}, ${input.userId}, 'approval.deny', ${approval.id}, ${tx.json({ comment })})
      `;
      return { ok: true as const };
    }
    const parsed = parseTool(approval.payload.tool, approval.payload.arguments);
    if (!parsed.ok) throw new Error("invalid approval payload");
    const effect = await executeTool(tx, {
      orgId: input.orgId,
      agentId: approval.agent_id,
      actionId: approval.action_id,
      tool: parsed.name,
      args: parsed.args,
      notifyUser: approval.requester_user_id,
    });
    if (!effect.ok) {
      await tx`
        update approvals
        set status = 'denied', comment = ${effect.code}, decided_by = ${input.userId}, decided_at = now()
        where id = ${approval.id} and status = 'pending'
      `;
      await tx`
        update actions set outcome = 'failed', error_code = ${effect.code}, http_status = 422
        where id = ${approval.action_id}
      `;
      return { ok: false as const, code: effect.code };
    }
    await tx`
      update approvals
      set status = 'approved', comment = ${comment}, decided_by = ${input.userId}, decided_at = now()
      where id = ${approval.id} and status = 'pending'
    `;
    await tx`
      update actions set outcome = 'approved', error_code = null, http_status = 200, resource_id = ${effect.resourceId}
      where id = ${approval.action_id}
    `;
    await tx`
      insert into notifications (organization_id, user_id, kind, title, body, href)
      values (
        ${input.orgId}, ${approval.requester_user_id}, 'approval.decided',
        'Action approved', ${`${parsed.name} was approved.`}, null
      )
    `;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target, detail)
      values (${input.orgId}, ${input.userId}, 'approval.approve', ${approval.id}, ${tx.json({ tool: parsed.name })})
    `;
    return { ok: true as const, resourceId: effect.resourceId };
  });
}
