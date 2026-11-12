import { readFileSync } from "node:fs";
import postgres from "postgres";
import { demoMfa, demoPassword, demoToken, ids } from "./ids";
import { hashPassword } from "../lib/password";
import { hashSecret } from "../lib/tokens";

function loadEnv() {
  const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
  }
}

loadEnv();

async function main() {
const sql = postgres(process.env.DATABASE_URL_ADMIN!, { max: 1, onnotice: () => {} });

const people = [
  [ids.june, "june.okoye@harbor.test", "June Okoye", demoMfa.june],
  [ids.andre, "andre.brooks@harbor.test", "Andre Brooks", demoMfa.andre],
  [ids.maria, "maria.santos@harbor.test", "Maria Santos", null],
  [ids.sam, "sam.okonkwo@harbor.test", "Sam Okonkwo", null],
  [ids.pat, "pat.nguyen@harbor.test", "Pat Nguyen", null],
  [ids.lee, "lee.ortiz@harbor.test", "Lee Ortiz", null],
  [ids.jordan, "jordan.hale@harbor.test", "Jordan Hale", null],
  [ids.riley, "riley.chen@northline.test", "Riley Chen", demoMfa.riley],
  [ids.alex, "alex.morgan@northline.test", "Alex Morgan", null],
] as const;

try {
  const passwordHash = await hashPassword(demoPassword);
  const tokenHash = hashSecret(demoToken, process.env.TOKEN_PEPPER!);

  await sql.begin(async (tx) => {
    await tx`
      insert into organizations (id, name, slug, timezone, demo) values
        (${ids.harborOrg}, 'Harbor Robotics', 'harbor-robotics', 'America/Chicago', true),
        (${ids.northlineOrg}, 'Northline Clinic', 'northline', 'America/New_York', true)
    `;
    for (const [id, email, name, secret] of people) {
      await tx`
        insert into users (id, email, name, password_hash, mfa_secret, mfa_enabled)
        values (${id}, ${email}, ${name}, ${passwordHash}, ${secret}, ${secret != null})
      `;
    }
    const memberships: [string, string, string][] = [
      [ids.harborOrg, ids.june, "owner"],
      [ids.harborOrg, ids.andre, "admin"],
      [ids.harborOrg, ids.maria, "operator"],
      [ids.harborOrg, ids.sam, "approver"],
      [ids.harborOrg, ids.pat, "developer"],
      [ids.harborOrg, ids.lee, "auditor"],
      [ids.harborOrg, ids.jordan, "viewer"],
      [ids.northlineOrg, ids.riley, "owner"],
      [ids.northlineOrg, ids.alex, "approver"],
    ];
    for (const [org, user, role] of memberships) {
      await tx`insert into memberships (organization_id, user_id, role) values (${org}, ${user}, ${role})`;
    }
    await tx`
      insert into org_limits (organization_id, actions_per_day, agents_max, tokens_max, approvals_per_day) values
        (${ids.harborOrg}, 500, 20, 30, 100),
        (${ids.northlineOrg}, 500, 20, 30, 100)
    `;
    await tx`
      insert into agents (id, organization_id, name, slug, description, environment, status, owner_user_id) values
        (${ids.dispatch}, ${ids.harborOrg}, 'Dispatch', 'dispatch', 'Creates tickets and requests customer deletion.', 'development', 'active', ${ids.june}),
        (${ids.billing}, ${ids.harborOrg}, 'Billing', 'billing', 'Production agent used for the payment and HTTP combination rule.', 'production', 'paused', ${ids.june}),
        (${ids.intake}, ${ids.northlineOrg}, 'Intake', 'intake', 'Northline intake agent.', 'development', 'active', ${ids.riley})
    `;
    for (const scope of ["ticket.create", "customer.create", "customer.delete", "notification.send"]) {
      await tx`
        insert into agent_scopes (organization_id, agent_id, scope, granted_by)
        values (${ids.harborOrg}, ${ids.dispatch}, ${scope}, ${ids.june})
      `;
    }
    await tx`
      insert into api_tokens (
        id, organization_id, agent_id, name, prefix, token_hash, environment, scopes, created_by
      ) values (
        ${ids.harborToken}, ${ids.harborOrg}, ${ids.dispatch}, 'Dispatch demo',
        ${demoToken.slice(0, 16)}, ${tokenHash}, 'test',
        ${["ticket.create", "customer.create", "customer.delete", "notification.send"]},
        ${ids.june}
      )
    `;
    await tx`
      insert into customers (id, organization_id, name, email) values
        (${ids.ada}, ${ids.harborOrg}, 'Ada Mensah', 'ada@harbor.test'),
        (${ids.nia}, ${ids.northlineOrg}, 'Nia Boateng', 'nia@northline.test')
    `;
    await tx`
      insert into audit_events (organization_id, actor_id, action, target, detail) values
        (${ids.harborOrg}, ${ids.june}, 'agent.create', ${ids.dispatch}, ${sql.json({ name: "Dispatch", sample: true })}),
        (${ids.northlineOrg}, ${ids.riley}, 'agent.create', ${ids.intake}, ${sql.json({ name: "Intake", sample: true })})
    `;
  });
  console.log("Seed applied.");
} finally {
  await sql.end();
}
}

main();
