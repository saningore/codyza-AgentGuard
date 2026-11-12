begin;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create schema if not exists app;

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.current_org_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  password_hash text not null,
  mfa_secret text,
  mfa_enabled boolean not null default false,
  timezone text not null default 'America/Chicago',
  email_alerts boolean not null default false,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  scope text not null check (scope in ('full', 'enroll')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table rate_limit_buckets (
  bucket_key text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (bucket_key, window_start)
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 140),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'America/Chicago',
  demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'approver', 'developer', 'auditor', 'viewer')),
  status text not null default 'active' check (status in ('active', 'removed')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create unique index memberships_one_owner
  on memberships (organization_id)
  where role = 'owner' and status = 'active';

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin', 'operator', 'approver', 'developer', 'auditor', 'viewer')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  invited_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create table role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);

create table org_limits (
  organization_id uuid primary key references organizations (id) on delete cascade,
  actions_per_day integer not null default 50 check (actions_per_day > 0),
  agents_max integer not null default 5 check (agents_max > 0),
  tokens_max integer not null default 10 check (tokens_max > 0),
  approvals_per_day integer not null default 20 check (approvals_per_day > 0)
);

create table org_usage (
  organization_id uuid not null references organizations (id) on delete cascade,
  day date not null,
  action_count integer not null,
  primary key (organization_id, day)
);

create table token_usage (
  token_id uuid not null,
  day date not null,
  action_count integer not null,
  primary key (token_id, day)
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '',
  environment text not null check (environment in ('development', 'staging', 'production')),
  status text not null check (status in ('draft', 'active', 'paused', 'revoked')),
  owner_user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table agent_status_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into agent_status_transitions (from_status, to_status) values
  ('draft', 'active'), ('draft', 'revoked'),
  ('active', 'paused'), ('active', 'revoked'),
  ('paused', 'active'), ('paused', 'revoked');

create table tools (
  name text primary key,
  group_name text not null,
  sensitivity text not null check (sensitivity in ('standard', 'sensitive')),
  description text not null
);

insert into tools (name, group_name, sensitivity, description) values
  ('ticket.create', 'workspace', 'standard', 'Create a ticket in this organization.'),
  ('notification.send', 'workspace', 'standard', 'Send an in-app notification to a member.'),
  ('customer.create', 'customers', 'standard', 'Add a customer record.'),
  ('customer.export', 'customers', 'sensitive', 'Export this organization''s customers.'),
  ('customer.delete', 'customers', 'sensitive', 'Soft-delete one customer.'),
  ('model.complete', 'models', 'sensitive', 'Call a model when a provider key is configured.'),
  ('data.payment.read', 'policy', 'sensitive', 'Read payment data. Used by the production combination rule.'),
  ('tool.http.write', 'policy', 'sensitive', 'Call an external HTTP write. Used by the production combination rule.');

create table agent_scopes (
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  scope text not null,
  granted_by uuid not null references users (id),
  granted_at timestamptz not null default now(),
  primary key (agent_id, scope)
);

create table policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  unique (agent_id)
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  prefix text not null,
  token_hash text not null unique,
  environment text not null check (environment in ('test', 'live')),
  scopes text[] not null,
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create table actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  token_id uuid references api_tokens (id) on delete set null,
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('allowed', 'denied', 'failed', 'pending', 'approved')),
  http_status integer not null,
  error_code text,
  session_id text,
  run_id uuid,
  idempotency_key text,
  resource_id uuid,
  created_at timestamptz not null default now()
);

create table idempotency_keys (
  token_id uuid not null references api_tokens (id) on delete cascade,
  idempotency_key text not null,
  action_id uuid not null references actions (id) on delete cascade,
  http_status integer not null,
  error_code text,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (token_id, idempotency_key)
);

create table runs (
  id uuid primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  session_id text,
  created_at timestamptz not null default now()
);

create table spans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  run_id uuid not null references runs (id) on delete cascade,
  action_id uuid references actions (id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  action_id uuid not null unique references actions (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  requester_user_id uuid not null references users (id),
  status text not null check (status in ('pending', 'approved', 'denied', 'expired')),
  comment text,
  decided_by uuid references users (id),
  decided_at timestamptz,
  expires_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table action_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  action_id uuid not null references actions (id) on delete cascade,
  user_id uuid not null references users (id),
  score integer not null check (score in (0, 1)),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (action_id, user_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 140),
  email text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  agent_id uuid references agents (id) on delete set null,
  action_id uuid references actions (id) on delete set null,
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create table export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  action_id uuid references actions (id) on delete set null,
  row_count integer not null,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations (id) on delete cascade,
  actor_id uuid references users (id),
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table policy_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  environment text not null check (environment in ('development', 'staging', 'production')),
  expected_code text not null,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

create table policy_case_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  case_id uuid not null references policy_cases (id) on delete cascade,
  passed boolean not null,
  actual_code text not null,
  created_at timestamptz not null default now()
);

create index actions_org_created on actions (organization_id, created_at desc);
create index actions_outcome on actions (organization_id, outcome);
create index notifications_user on notifications (user_id, read_at, created_at desc);
create index customers_org on customers (organization_id);
create index audit_org on audit_events (organization_id, created_at desc);

insert into role_permissions (role, permission) values
  ('owner', 'org.manage'), ('owner', 'member.manage'), ('owner', 'agent.read'), ('owner', 'agent.write'),
  ('owner', 'agent.pause'), ('owner', 'scope.grant'), ('owner', 'scope.grant_sensitive'),
  ('owner', 'token.create'), ('owner', 'token.create_live'), ('owner', 'token.revoke'),
  ('owner', 'approval.decide'), ('owner', 'activity.read'), ('owner', 'audit.read'),
  ('owner', 'analytics.read'), ('owner', 'customer.read'), ('owner', 'customer.write'), ('owner', 'policy.manage'),
  ('admin', 'org.manage'), ('admin', 'member.manage'), ('admin', 'agent.read'), ('admin', 'agent.write'),
  ('admin', 'agent.pause'), ('admin', 'scope.grant'), ('admin', 'scope.grant_sensitive'),
  ('admin', 'token.create'), ('admin', 'token.create_live'), ('admin', 'token.revoke'),
  ('admin', 'approval.decide'), ('admin', 'activity.read'), ('admin', 'audit.read'),
  ('admin', 'analytics.read'), ('admin', 'customer.read'), ('admin', 'customer.write'), ('admin', 'policy.manage'),
  ('operator', 'agent.read'), ('operator', 'agent.write'), ('operator', 'agent.pause'),
  ('operator', 'scope.grant'), ('operator', 'activity.read'), ('operator', 'analytics.read'), ('operator', 'customer.read'),
  ('approver', 'agent.read'), ('approver', 'activity.read'), ('approver', 'approval.decide'), ('approver', 'customer.read'),
  ('developer', 'agent.read'), ('developer', 'agent.write'), ('developer', 'token.create'),
  ('developer', 'activity.read'), ('developer', 'customer.read'), ('developer', 'customer.write'), ('developer', 'policy.manage'),
  ('auditor', 'agent.read'), ('auditor', 'activity.read'), ('auditor', 'audit.read'), ('auditor', 'analytics.read'),
  ('viewer', 'agent.read'), ('viewer', 'activity.read');

create or replace function app.allowed(p_permission text) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1
    from memberships m
    join role_permissions rp on rp.role = m.role
    where m.user_id = app.current_user_id()
      and m.organization_id = app.current_org_id()
      and m.status = 'active'
      and rp.permission = p_permission
  )
$$;

create or replace function app.member_role() returns text
language sql stable security definer set search_path = public, app as $$
  select m.role
  from memberships m
  where m.user_id = app.current_user_id()
    and m.organization_id = app.current_org_id()
    and m.status = 'active'
$$;

create or replace function app.bump_rate(p_key text, p_window_seconds integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into rate_limit_buckets (bucket_key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set hits = rate_limit_buckets.hits + 1
  returning hits into v_hits;
  return v_hits;
end $$;

create or replace function app.consume_quota(p_org uuid, p_token uuid, p_org_limit integer, p_token_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org integer;
  v_token integer;
begin
  insert into org_usage (organization_id, day, action_count)
  values (p_org, current_date, 1)
  on conflict (organization_id, day)
  do update set action_count = org_usage.action_count + 1
  where org_usage.action_count < p_org_limit
  returning action_count into v_org;
  if v_org is null then
    return false;
  end if;
  if p_token_limit is null then
    return true;
  end if;
  insert into token_usage (token_id, day, action_count)
  values (p_token, current_date, 1)
  on conflict (token_id, day)
  do update set action_count = token_usage.action_count + 1
  where token_usage.action_count < p_token_limit
  returning action_count into v_token;
  if v_token is null then
    update org_usage set action_count = action_count - 1
    where organization_id = p_org and day = current_date;
    return false;
  end if;
  return true;
end $$;

create or replace function app.lookup_login(p_email text)
returns table (id uuid, password_hash text, mfa_enabled boolean, name text)
language sql security definer set search_path = public as $$
  select u.id, u.password_hash, u.mfa_enabled, u.name from users u where u.email = p_email
$$;

create or replace function app.open_session(p_user uuid, p_hash text, p_scope text, p_expires timestamptz) returns void
language sql security definer set search_path = public as $$
  insert into sessions (user_id, token_hash, scope, expires_at) values (p_user, p_hash, p_scope, p_expires);
$$;

create or replace function app.read_session(p_hash text)
returns table (user_id uuid, email text, name text, scope text, mfa_enabled boolean, timezone text)
language sql security definer set search_path = public as $$
  select u.id, u.email::text, u.name, s.scope, u.mfa_enabled, u.timezone
  from sessions s
  join users u on u.id = s.user_id
  where s.token_hash = p_hash and s.revoked_at is null and s.expires_at > now()
$$;

create or replace function app.revoke_session(p_hash text) returns void
language sql security definer set search_path = public as $$
  update sessions set revoked_at = now() where token_hash = p_hash and revoked_at is null;
$$;

create or replace function app.revoke_session_id(p_user uuid, p_id uuid) returns void
language sql security definer set search_path = public as $$
  update sessions set revoked_at = now() where id = p_id and user_id = p_user and revoked_at is null;
$$;

create or replace function app.my_sessions(p_user uuid)
returns table (id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
language sql security definer set search_path = public as $$
  select s.id, s.created_at, s.expires_at, s.revoked_at
  from sessions s
  where s.user_id = p_user
  order by s.created_at desc
  limit 20
$$;

create or replace function app.open_challenge(p_user uuid, p_hash text) returns void
language sql security definer set search_path = public as $$
  insert into login_challenges (user_id, token_hash, expires_at) values (p_user, p_hash, now() + interval '5 minutes');
$$;

create or replace function app.take_challenge(p_hash text)
returns table (user_id uuid, mfa_secret text, mfa_enabled boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  update login_challenges
  set used_at = now()
  where token_hash = p_hash and used_at is null and expires_at > now()
  returning login_challenges.user_id into v_user;
  if v_user is null then
    return;
  end if;
  return query select u.id, u.mfa_secret, u.mfa_enabled from users u where u.id = v_user;
end $$;

create or replace function app.begin_mfa(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update users set mfa_secret = p_secret where id = app.current_user_id() and mfa_enabled = false;
  if not found then
    raise exception 'mfa already enabled';
  end if;
end $$;

create or replace function app.my_mfa_secret() returns text
language sql security definer set search_path = public as $$
  select mfa_secret from users where id = app.current_user_id()
$$;

create or replace function app.confirm_mfa() returns void
language sql security definer set search_path = public as $$
  update users set mfa_enabled = true where id = app.current_user_id() and mfa_secret is not null;
$$;

create or replace function app.promote_session(p_hash text) returns void
language sql security definer set search_path = public as $$
  update sessions set scope = 'full' where token_hash = p_hash and revoked_at is null;
$$;

create or replace function app.register_owner(
  p_email text, p_name text, p_password_hash text, p_org text, p_slug text, p_timezone text
) returns table (user_id uuid, organization_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  oid uuid;
begin
  if char_length(btrim(p_name)) < 2 or char_length(btrim(p_org)) < 2 then
    raise exception 'name too short';
  end if;
  if p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid slug';
  end if;
  insert into users (email, name, password_hash, timezone)
  values (p_email, btrim(p_name), p_password_hash, coalesce(nullif(p_timezone, ''), 'America/Chicago'))
  returning id into uid;
  insert into organizations (name, slug, timezone)
  values (btrim(p_org), p_slug, coalesce(nullif(p_timezone, ''), 'America/Chicago'))
  returning id into oid;
  insert into memberships (organization_id, user_id, role) values (oid, uid, 'owner');
  insert into org_limits (organization_id) values (oid);
  insert into audit_events (organization_id, actor_id, action, target, detail)
  values (oid, uid, 'org.create', oid::text, jsonb_build_object('name', btrim(p_org)));
  return query select uid, oid;
end $$;

create or replace function app.create_password_reset(p_email text, p_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  select id into uid from users where email = p_email;
  if uid is null then
    return false;
  end if;
  insert into password_resets (user_id, token_hash, expires_at)
  values (uid, p_hash, now() + interval '30 minutes');
  return true;
end $$;

create or replace function app.consume_password_reset(p_hash text, p_password_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  update password_resets
  set used_at = now()
  where token_hash = p_hash and used_at is null and expires_at > now()
  returning user_id into uid;
  if uid is null then
    return false;
  end if;
  update users set password_hash = p_password_hash where id = uid;
  update sessions set revoked_at = now() where user_id = uid and revoked_at is null;
  insert into audit_events (actor_id, action, target) values (uid, 'password.reset', uid::text);
  return true;
end $$;

create or replace function app.peek_invite(p_hash text)
returns table (email text, expired boolean, role text, organization_name text)
language sql security definer set search_path = public as $$
  select i.email::text, (i.used_at is not null or i.expires_at <= now()), i.role, o.name
  from invitations i
  join organizations o on o.id = i.organization_id
  where i.token_hash = p_hash
$$;

create or replace function app.accept_invite_new(p_hash text, p_name text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv invitations%rowtype;
  uid uuid;
begin
  select * into inv from invitations where token_hash = p_hash and used_at is null and expires_at > now() for update;
  if inv.id is null then
    raise exception 'invite invalid';
  end if;
  insert into users (email, name, password_hash) values (inv.email, btrim(p_name), p_password_hash) returning id into uid;
  insert into memberships (organization_id, user_id, role) values (inv.organization_id, uid, inv.role);
  update invitations set used_at = now() where id = inv.id;
  insert into audit_events (organization_id, actor_id, action, target, detail)
  values (inv.organization_id, uid, 'member.join', uid::text, jsonb_build_object('role', inv.role));
  return uid;
end $$;

create or replace function app.accept_invite_existing(p_hash text, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv invitations%rowtype;
begin
  select * into inv from invitations where token_hash = p_hash and used_at is null and expires_at > now() for update;
  if inv.id is null then
    raise exception 'invite invalid';
  end if;
  insert into memberships (organization_id, user_id, role) values (inv.organization_id, p_user, inv.role)
  on conflict (organization_id, user_id) do update set role = excluded.role, status = 'active';
  update invitations set used_at = now() where id = inv.id;
  insert into audit_events (organization_id, actor_id, action, target, detail)
  values (inv.organization_id, p_user, 'member.join', p_user::text, jsonb_build_object('role', inv.role));
  return p_user;
end $$;

create or replace function app.resolve_token(p_hash text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'token_id', t.id,
    'org_id', t.organization_id,
    'agent_id', t.agent_id,
    'agent_status', a.status,
    'agent_environment', a.environment,
    'agent_owner', a.owner_user_id,
    'token_environment', t.environment,
    'token_scopes', to_jsonb(t.scopes),
    'daily_limit', t.daily_limit,
    'created_by', t.created_by,
    'expires_at', t.expires_at,
    'revoked_at', t.revoked_at,
    'org_daily', l.actions_per_day,
    'agent_scopes', coalesce((select jsonb_agg(s.scope) from agent_scopes s where s.agent_id = a.id), '[]'::jsonb),
    'dlp_exception', exists(select 1 from policy_exceptions e where e.agent_id = a.id)
  )
  from api_tokens t
  join agents a on a.id = t.agent_id
  join org_limits l on l.organization_id = t.organization_id
  where t.token_hash = p_hash
$$;

create or replace function app.touch_token(p_token uuid) returns void
language sql security definer set search_path = public as $$
  update api_tokens set last_used_at = now() where id = p_token;
$$;

create or replace function app.expire_approvals() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  rec record;
begin
  for rec in
    select ap.id, ap.organization_id, ap.action_id, ap.agent_id, a.owner_user_id
    from approvals ap
    join agents a on a.id = ap.agent_id
    where ap.status = 'pending' and ap.expires_at < now()
  loop
    update approvals set status = 'expired', decided_at = now() where id = rec.id;
    update actions set outcome = 'failed', error_code = 'approval_expired', http_status = 410 where id = rec.action_id;
    insert into notifications (organization_id, user_id, kind, title, body, href)
    values (rec.organization_id, rec.owner_user_id, 'approval.expired', 'Approval expired', 'A sensitive action expired before anyone approved it.', '/o/' || (select slug from organizations where id = rec.organization_id) || '/failures');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function app.enforce_agent_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status and not exists (
    select 1 from agent_status_transitions t where t.from_status = old.status and t.to_status = new.status
  ) then
    raise exception 'illegal status transition';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at = now();
  end if;
  return new;
end $$;

create trigger agents_status before update on agents
for each row execute function app.enforce_agent_status();

create or replace function app.prevent_audit_change() returns trigger
language plpgsql as $$
begin
  raise exception 'audit events are append-only';
end $$;

create trigger audit_no_update before update or delete on audit_events
for each row execute function app.prevent_audit_change();

alter table users enable row level security;
alter table users force row level security;
alter table organizations enable row level security;
alter table organizations force row level security;
alter table memberships enable row level security;
alter table memberships force row level security;
alter table invitations enable row level security;
alter table invitations force row level security;
alter table agents enable row level security;
alter table agents force row level security;
alter table agent_scopes enable row level security;
alter table agent_scopes force row level security;
alter table policy_exceptions enable row level security;
alter table policy_exceptions force row level security;
alter table api_tokens enable row level security;
alter table api_tokens force row level security;
alter table actions enable row level security;
alter table actions force row level security;
alter table runs enable row level security;
alter table runs force row level security;
alter table spans enable row level security;
alter table spans force row level security;
alter table approvals enable row level security;
alter table approvals force row level security;
alter table action_scores enable row level security;
alter table action_scores force row level security;
alter table customers enable row level security;
alter table customers force row level security;
alter table tickets enable row level security;
alter table tickets force row level security;
alter table export_jobs enable row level security;
alter table export_jobs force row level security;
alter table notifications enable row level security;
alter table notifications force row level security;
alter table audit_events enable row level security;
alter table audit_events force row level security;
alter table policy_cases enable row level security;
alter table policy_cases force row level security;
alter table policy_case_runs enable row level security;
alter table policy_case_runs force row level security;
alter table org_limits enable row level security;
alter table org_limits force row level security;
alter table idempotency_keys enable row level security;
alter table idempotency_keys force row level security;

create policy users_select on users for select using (
  id = app.current_user_id()
  or exists (
    select 1 from memberships mine
    join memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = app.current_user_id()
      and mine.status = 'active'
      and theirs.user_id = users.id
      and theirs.status = 'active'
      and (mine.organization_id = app.current_org_id() or app.current_org_id() is null)
  )
);
create policy users_update on users for update using (id = app.current_user_id()) with check (id = app.current_user_id());

create policy org_select on organizations for select using (
  exists (
    select 1 from memberships m
    where m.organization_id = organizations.id and m.user_id = app.current_user_id() and m.status = 'active'
  )
);
create policy org_update on organizations for update using (
  id = app.current_org_id() and app.allowed('org.manage')
) with check (
  id = app.current_org_id() and app.allowed('org.manage')
);

create policy memberships_select on memberships for select using (
  user_id = app.current_user_id() or organization_id = app.current_org_id()
);
create policy memberships_write on memberships for insert with check (
  organization_id = app.current_org_id() and app.allowed('member.manage')
);
create policy memberships_update on memberships for update using (
  organization_id = app.current_org_id() and app.allowed('member.manage')
) with check (
  organization_id = app.current_org_id() and app.allowed('member.manage')
);
create policy memberships_self on memberships for update using (
  user_id = app.current_user_id() and organization_id = app.current_org_id()
) with check (
  user_id = app.current_user_id() and organization_id = app.current_org_id() and status = 'removed'
);

create policy invites_select on invitations for select using (
  organization_id = app.current_org_id() and app.allowed('member.manage')
);
create policy invites_insert on invitations for insert with check (
  organization_id = app.current_org_id() and invited_by = app.current_user_id() and app.allowed('member.manage')
);

create policy agents_select on agents for select using (
  organization_id = app.current_org_id() and app.allowed('agent.read')
);
create policy agents_insert on agents for insert with check (
  organization_id = app.current_org_id() and app.allowed('agent.write') and owner_user_id = app.current_user_id()
);
create policy agents_update on agents for update using (
  organization_id = app.current_org_id() and (app.allowed('agent.write') or app.allowed('agent.pause'))
) with check (
  organization_id = app.current_org_id()
);

create policy scopes_select on agent_scopes for select using (
  organization_id = app.current_org_id() and app.allowed('agent.read')
);
create policy scopes_insert on agent_scopes for insert with check (
  organization_id = app.current_org_id() and granted_by = app.current_user_id() and app.allowed('scope.grant')
);
create policy scopes_delete on agent_scopes for delete using (
  organization_id = app.current_org_id() and app.allowed('scope.grant')
);

create policy exceptions_all on policy_exceptions for all using (
  organization_id = app.current_org_id() and app.allowed('scope.grant_sensitive')
) with check (
  organization_id = app.current_org_id() and created_by = app.current_user_id() and app.allowed('scope.grant_sensitive')
);

create policy tokens_select on api_tokens for select using (
  organization_id = app.current_org_id() and (app.allowed('token.create') or app.allowed('token.revoke') or app.allowed('agent.read'))
);
create policy tokens_insert on api_tokens for insert with check (
  organization_id = app.current_org_id() and created_by = app.current_user_id() and app.allowed('token.create')
);
create policy tokens_update on api_tokens for update using (
  organization_id = app.current_org_id() and (app.allowed('token.revoke') or id::text = current_setting('app.token_id', true))
) with check (organization_id = app.current_org_id());

create policy actions_select on actions for select using (
  organization_id = app.current_org_id() and app.allowed('activity.read')
);
create policy actions_insert on actions for insert with check (
  organization_id = app.current_org_id()
  and nullif(current_setting('app.token_id', true), '') is not null
);
create policy actions_update on actions for update using (
  organization_id = app.current_org_id()
  and (
    app.allowed('approval.decide')
    or token_id::text = nullif(current_setting('app.token_id', true), '')
  )
) with check (organization_id = app.current_org_id());

create policy idem_select on idempotency_keys for select using (
  exists (
    select 1 from api_tokens t
    where t.id = idempotency_keys.token_id
      and t.organization_id = app.current_org_id()
      and t.id::text = current_setting('app.token_id', true)
  )
);
create policy idem_insert on idempotency_keys for insert with check (
  exists (
    select 1 from api_tokens t
    where t.id = idempotency_keys.token_id
      and t.organization_id = app.current_org_id()
      and t.id::text = current_setting('app.token_id', true)
  )
);

create policy runs_select on runs for select using (organization_id = app.current_org_id() and app.allowed('activity.read'));
create policy runs_insert on runs for insert with check (
  organization_id = app.current_org_id() and nullif(current_setting('app.token_id', true), '') is not null
);
create policy spans_select on spans for select using (organization_id = app.current_org_id() and app.allowed('activity.read'));
create policy spans_insert on spans for insert with check (
  organization_id = app.current_org_id() and nullif(current_setting('app.token_id', true), '') is not null
);

create policy approvals_select on approvals for select using (
  organization_id = app.current_org_id() and (app.allowed('approval.decide') or app.allowed('activity.read'))
);
create policy approvals_insert on approvals for insert with check (
  organization_id = app.current_org_id() and nullif(current_setting('app.token_id', true), '') is not null
);
create policy approvals_update on approvals for update using (
  organization_id = app.current_org_id() and app.allowed('approval.decide')
) with check (organization_id = app.current_org_id());

create policy scores_select on action_scores for select using (
  organization_id = app.current_org_id() and app.allowed('activity.read')
);
create policy scores_insert on action_scores for insert with check (
  organization_id = app.current_org_id() and user_id = app.current_user_id() and app.allowed('activity.read')
);
create policy scores_update on action_scores for update using (
  organization_id = app.current_org_id() and user_id = app.current_user_id()
) with check (
  organization_id = app.current_org_id() and user_id = app.current_user_id()
);

create policy customers_select on customers for select using (
  organization_id = app.current_org_id() and app.allowed('customer.read')
);
create policy customers_insert on customers for insert with check (
  organization_id = app.current_org_id()
  and (app.allowed('customer.write') or nullif(current_setting('app.token_id', true), '') is not null)
);
create policy customers_update on customers for update using (
  organization_id = app.current_org_id()
  and (app.allowed('customer.write') or app.allowed('approval.decide') or nullif(current_setting('app.token_id', true), '') is not null)
) with check (organization_id = app.current_org_id());

create policy tickets_select on tickets for select using (
  organization_id = app.current_org_id() and app.allowed('activity.read')
);
create policy tickets_insert on tickets for insert with check (
  organization_id = app.current_org_id() and nullif(current_setting('app.token_id', true), '') is not null
);

create policy exports_select on export_jobs for select using (
  organization_id = app.current_org_id() and (app.allowed('customer.read') or app.allowed('audit.read'))
);
create policy exports_insert on export_jobs for insert with check (
  organization_id = app.current_org_id() and app.allowed('approval.decide')
);

create policy notes_select on notifications for select using (user_id = app.current_user_id());
create policy notes_insert on notifications for insert with check (
  organization_id = app.current_org_id()
  and (
    nullif(current_setting('app.token_id', true), '') is not null
    or app.allowed('approval.decide')
    or app.allowed('org.manage')
  )
);
create policy notes_update on notifications for update using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

create policy audit_select on audit_events for select using (
  actor_id = app.current_user_id()
  or (organization_id = app.current_org_id() and app.allowed('audit.read'))
);
create policy audit_insert on audit_events for insert with check (
  actor_id = app.current_user_id()
  and (organization_id is null or organization_id = app.current_org_id())
);

create policy cases_select on policy_cases for select using (
  organization_id = app.current_org_id() and (app.allowed('policy.manage') or app.allowed('agent.read'))
);
create policy cases_insert on policy_cases for insert with check (
  organization_id = app.current_org_id() and created_by = app.current_user_id() and app.allowed('policy.manage')
);
create policy case_runs_select on policy_case_runs for select using (
  organization_id = app.current_org_id() and app.allowed('agent.read')
);
create policy case_runs_insert on policy_case_runs for insert with check (
  organization_id = app.current_org_id() and app.allowed('policy.manage')
);

create policy limits_select on org_limits for select using (
  organization_id = app.current_org_id()
);
create policy limits_update on org_limits for update using (
  organization_id = app.current_org_id() and app.allowed('org.manage')
) with check (
  organization_id = app.current_org_id() and app.allowed('org.manage')
);

alter table org_usage enable row level security;
alter table org_usage force row level security;
alter table token_usage enable row level security;
alter table token_usage force row level security;
create policy org_usage_select on org_usage for select using (organization_id = app.current_org_id());
create policy token_usage_select on token_usage for select using (
  exists (
    select 1 from api_tokens t
    where t.id = token_usage.token_id
      and t.organization_id = app.current_org_id()
      and app.allowed('agent.read')
  )
);

grant usage on schema public, app to agentguard_app;
grant execute on all functions in schema app to agentguard_app;
grant select, insert, update, delete on
  users, organizations, memberships, invitations, agents, agent_scopes, policy_exceptions,
  api_tokens, actions, idempotency_keys, runs, spans, approvals, action_scores, customers,
  tickets, export_jobs, notifications, policy_cases, policy_case_runs, org_limits
to agentguard_app;
grant select, insert on audit_events to agentguard_app;
grant select on role_permissions, tools, agent_status_transitions, org_usage, token_usage to agentguard_app;

-- Supabase enables row security on every new public table. These catalogs have no tenant rows.
alter table role_permissions disable row level security;
alter table tools disable row level security;
alter table agent_status_transitions disable row level security;
revoke select (token_hash) on api_tokens from agentguard_app;

commit;
