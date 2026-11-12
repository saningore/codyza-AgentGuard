# AgentGuard

AgentGuard is an organization control plane for AI agents. A person registers an agent, grants scopes, and issues an API token. The agent calls `POST /api/v1/actions`. The server checks the token, status, scope, policy, and daily limit, then either writes a real record, refuses the call, or waits for a different person to approve it. Every outcome is stored. Charts and search read those rows.

Sample organizations wear a banner. A new signup starts with no agents and analytics that say no actions yet. `model.complete` fails with `provider_not_configured` until `OPENAI_API_KEY` is set. `AGENTGUARD_USE_FIXTURES=1` prevents the server from booting.

## Live site

Deployment is Vercel for the app and Neon for Postgres. Put the public URL here after the first deploy.

## Demo accounts

Both organizations are sample data. Every account uses the password `Gate-lamp-42`. Owner and admin accounts also require the authenticator secret below.

| Organization | Person | Role | Email | Authenticator |
| --- | --- | --- | --- | --- |
| Harbor Robotics (`harbor-robotics`) | June Okoye | Owner | june.okoye@harbor.test | `JBSWY3DPEHPK3PXP` |
| Harbor Robotics | Andre Brooks | Admin | andre.brooks@harbor.test | `MFRGGZDFMZTWQ2LK` |
| Harbor Robotics | Maria Santos | Operator | maria.santos@harbor.test | none |
| Harbor Robotics | Sam Okonkwo | Approver | sam.okonkwo@harbor.test | none |
| Harbor Robotics | Pat Nguyen | Developer | pat.nguyen@harbor.test | none |
| Harbor Robotics | Lee Ortiz | Auditor | lee.ortiz@harbor.test | none |
| Harbor Robotics | Jordan Hale | Viewer | jordan.hale@harbor.test | none |
| Northline Clinic (`northline`) | Riley Chen | Owner | riley.chen@northline.test | `ORUGS4ZANFZSAYLO` |
| Northline Clinic | Alex Morgan | Approver | alex.morgan@northline.test | none |

Harbor's development agent `dispatch` accepts this test token:

```text
ag_test_harbor_dispatch_demo_token_0001
```

`ticket.create` and `customer.create` run immediately. `customer.delete` returns HTTP 202 until Sam, Andre, or another eligible approver who does not own the agent decides. June cannot approve it. Northline cannot see Harbor's queue.

## Run locally

Node.js 22 and Docker.

```bash
npm install
copy .env.example .env
npm run setup
npm run dev
```

Open http://localhost:3000. `npm run setup` starts Postgres on port 54331, applies `db/migrations/001_schema.sql`, and loads the sample organizations.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | App role. Row security applies. |
| `DATABASE_URL_ADMIN` | Yes | Migrations and seed only. |
| `SESSION_PEPPER` | Yes | Session and reset token hashes. |
| `TOKEN_PEPPER` | Yes | API token hashes. Only the hash is stored. |
| `CRON_SECRET` | Yes | `POST /api/cron` expires approvals. |
| `APP_URL` | Yes | Links in reset mail and invites. |
| `RESEND_API_KEY` | No | Sends password reset mail when set with `EMAIL_FROM`. |
| `EMAIL_FROM` | No | From address for Resend. |
| `OPENAI_API_KEY` | No | Used only after `model.complete` is approved. |

The checked-in example values are for the local Docker database. Do not reuse those peppers in production.

## Decision order

`POST /api/v1/actions` with `Authorization: Bearer` and optional `Idempotency-Key`.

1. Address rate limit, 120 requests per minute.
2. Token hash, expiry, and revocation. A bad secret is HTTP 401 with no organization data.
3. Token rate limit, 60 requests per minute.
4. A repeated idempotency key returns the original decision.
5. Test tokens only match development or staging. Live tokens only match production.
6. The agent must be active.
7. The tool name and arguments must match the catalog.
8. The scope must be on both the agent and the token.
9. `on_behalf_of` must also have the matching permission.
10. Production payload and the payment-read plus HTTP-write combination.
11. Organization and token daily counters.
12. Sensitive tools return HTTP 202 and do not write the side effect.
13. Standard tools commit the ticket, customer, or notification with the action row.

Reason codes include `invalid_token`, `environment_mismatch`, `agent_not_active`, `unknown_tool`, `invalid_arguments`, `scope_missing`, `user_scope_missing`, `policy_denied`, `quota_exceeded`, `approval_required`, `allowed`, and `idempotent_replay`.

Login allows 10 attempts per 15 minutes per email. Signup allows 5 per hour per address. Password reset allows 5 per hour per email. The counters live in Postgres so more than one server process shares them.

## Checks

```bash
npm test
npm run test:integration
npm run test:e2e
npm run check:ready
npm run build
```

## Deploy

1. Create a Neon Postgres database and a role without bypassrls for the app.
2. Set the environment variables in Vercel. Leave `AGENTGUARD_USE_FIXTURES` unset.
3. Run the migration and seed with `DATABASE_URL_ADMIN`.
4. Deploy the Next.js app on the Node runtime.
5. Add a 15-minute cron calling `POST /api/cron` with `Authorization: Bearer $CRON_SECRET`.

## Reviewer path

1. Open the site. The logo and the Codyza link are on the page.
2. Sign in as Jordan. Dispatch has no Create token button.
3. Call `ticket.create` with the demo token. A ticket appears.
4. Call `customer.delete`. The response is 202 and the customer remains.
5. Sign in as Alex at Northline. That approval is not listed.
6. Sign in as Sam at Harbor and approve it. The audit page, as Lee, shows Sam.
7. Sign out. The workspace redirects to sign in.
8. Forgot password shows the same notice for an unknown email.

Powered by [Codyza](https://codyza.com).
