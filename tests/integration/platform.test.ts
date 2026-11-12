import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { ids } from "../../db/ids";
import { hashPassword } from "../../lib/password";
import { hashSecret } from "../../lib/tokens";
import { executeAction, decideApproval } from "../../server/decision";
import { withOrg } from "../../server/db";

const admin = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1 });

afterAll(async () => {
  await admin.end();
});

describe("organization isolation", () => {
  it("hides the other organization's customers and every row when the tenant is unset", async () => {
    const foreign = await withOrg(ids.alex, ids.northlineOrg, (tx) => tx<{ total: string }[]>`
      select count(*)::text as total from customers where organization_id = ${ids.harborOrg}
    `);
    expect(foreign[0].total).toBe("0");

    const unset = await withOrg(ids.jordan, ids.harborOrg, async (tx) => {
      await tx`select set_config('app.org_id', '', true)`;
      return tx<{ total: string }[]>`select count(*)::text as total from customers`;
    });
    expect(unset[0].total).toBe("0");
  });

  it("refuses a viewer insert of an API token", async () => {
    await expect(withOrg(ids.jordan, ids.harborOrg, (tx) => tx`
      insert into api_tokens (
        organization_id, agent_id, name, prefix, token_hash, environment, scopes, created_by
      ) values (
        ${ids.harborOrg}, ${ids.dispatch}, 'nope', 'ag_test_nope', ${"hash"}, 'test', ${["ticket.create"]}, ${ids.jordan}
      )
    `)).rejects.toThrow();
  });
});

describe("decisions", () => {
  it("writes a failed action for a paused agent and then resumes it", async () => {
    await withOrg(ids.june, ids.harborOrg, (tx) => tx`update agents set status = 'paused' where id = ${ids.dispatch}`);
    try {
      const paused = await executeAction({
        authorization: `Bearer ${process.env.DEMO_TOKEN ?? "ag_test_harbor_dispatch_demo_token_0001"}`,
        body: { tool: "ticket.create", arguments: { title: "Should fail" } },
        clientKey: "integration-paused",
      });
      expect(paused.status).toBe(403);
      expect(paused.body.error).toBe("agent_not_active");
      const rows = await withOrg(ids.lee, ids.harborOrg, (tx) => tx<{ error_code: string }[]>`
        select error_code from actions where error_code = 'agent_not_active' order by created_at desc limit 1
      `);
      expect(rows[0].error_code).toBe("agent_not_active");
    } finally {
      await withOrg(ids.june, ids.harborOrg, (tx) => tx`update agents set status = 'active' where id = ${ids.dispatch}`);
    }
  });

  it("keeps the customer until a different person approves, and replays the same key once", async () => {
    const created = await executeAction({
      authorization: "Bearer ag_test_harbor_dispatch_demo_token_0001",
      body: { tool: "customer.create", arguments: { name: "Integration Subject" } },
      clientKey: "integration-create",
    });
    expect(created.status).toBe(200);
    const customerId = String(created.body.resource_id);
    const key = `idem-${randomUUID()}`;
    const pending = await executeAction({
      authorization: "Bearer ag_test_harbor_dispatch_demo_token_0001",
      body: { tool: "customer.delete", arguments: { customer_id: customerId } },
      clientKey: "integration-delete",
      idempotencyKey: key,
    });
    expect(pending.status).toBe(202);
    const still = await admin<{ deleted_at: Date | null }[]>`select deleted_at from customers where id = ${customerId}`;
    expect(still[0].deleted_at).toBeNull();
    await expect(decideApproval({
      userId: ids.june,
      orgId: ids.harborOrg,
      role: "owner",
      approvalId: String(pending.body.approval_id),
      decision: "approved",
      comment: "owner cannot",
    })).rejects.toThrow(/cannot approve/);
    const approved = await decideApproval({
      userId: ids.sam,
      orgId: ids.harborOrg,
      role: "approver",
      approvalId: String(pending.body.approval_id),
      decision: "approved",
      comment: "reviewed",
    });
    expect(approved.ok).toBe(true);
    const gone = await admin<{ deleted_at: Date | null }[]>`select deleted_at from customers where id = ${customerId}`;
    expect(gone[0].deleted_at).not.toBeNull();
    const replay = await executeAction({
      authorization: "Bearer ag_test_harbor_dispatch_demo_token_0001",
      body: { tool: "customer.delete", arguments: { customer_id: customerId } },
      clientKey: "integration-replay",
      idempotencyKey: key,
    });
    expect(replay.body.code).toBe("idempotent_replay");
    const deletes = await admin<{ total: number }[]>`
      select count(*)::int as total from actions where idempotency_key = ${key}
    `;
    expect(deletes[0].total).toBe(1);
  });

  it("stops the second call when the token daily limit is one", async () => {
    const raw = `ag_test_quota_${randomUUID().replaceAll("-", "")}`;
    const hash = hashSecret(raw, process.env.TOKEN_PEPPER!);
    await admin`
      insert into api_tokens (
        organization_id, agent_id, name, prefix, token_hash, environment, scopes, daily_limit, created_by
      ) values (
        ${ids.harborOrg}, ${ids.dispatch}, 'quota', ${raw.slice(0, 16)}, ${hash}, 'test',
        ${["ticket.create"]}, 1, ${ids.june}
      )
    `;
    const first = await executeAction({
      authorization: `Bearer ${raw}`,
      body: { tool: "ticket.create", arguments: { title: "One" } },
      clientKey: "integration-quota-a",
    });
    const second = await executeAction({
      authorization: `Bearer ${raw}`,
      body: { tool: "ticket.create", arguments: { title: "Two" } },
      clientKey: "integration-quota-b",
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.body.error).toBe("quota_exceeded");
  });
});

describe("password reset and audit", () => {
  it("accepts a reset token once", async () => {
    const raw = `reset-${randomUUID()}`;
    const hash = hashSecret(raw, process.env.SESSION_PEPPER!);
    const created = await admin<{ create_password_reset: boolean }[]>`
      select app.create_password_reset('jordan.hale@harbor.test', ${hash}) as create_password_reset
    `;
    expect(created[0].create_password_reset).toBe(true);
    const next = await hashPassword("Gate-lamp-99");
    const first = await admin<{ consume_password_reset: boolean }[]>`
      select app.consume_password_reset(${hash}, ${next}) as consume_password_reset
    `;
    const second = await admin<{ consume_password_reset: boolean }[]>`
      select app.consume_password_reset(${hash}, ${next}) as consume_password_reset
    `;
    expect(first[0].consume_password_reset).toBe(true);
    expect(second[0].consume_password_reset).toBe(false);
    const restored = await hashPassword("Gate-lamp-42");
    await admin`update users set password_hash = ${restored} where id = ${ids.jordan}`;
  });

  it("refuses an update to the audit log", async () => {
    await expect(admin`update audit_events set action = 'tamper'`).rejects.toThrow(/append-only/);
  });
});
