export const agentStatuses = ["draft", "active", "paused", "revoked"] as const;
export type AgentStatus = (typeof agentStatuses)[number];

const transitions: Record<AgentStatus, AgentStatus[]> = {
  draft: ["active", "revoked"],
  active: ["paused", "revoked"],
  paused: ["active", "revoked"],
  revoked: [],
};

export function legalTransition(from: AgentStatus, to: AgentStatus) {
  return transitions[from].includes(to);
}

export function environmentsMatch(tokenEnvironment: "test" | "live", agentEnvironment: string) {
  if (tokenEnvironment === "test") return agentEnvironment === "development" || agentEnvironment === "staging";
  return agentEnvironment === "production";
}

export function payloadViolates(environment: string, args: unknown) {
  if (environment !== "production") return false;
  const text = JSON.stringify(args ?? {}).toLowerCase();
  return /ignore\s+(all|any|previous)\s+(policy|instructions)/.test(text);
}

export function dlpConflict(input: {
  environment: string;
  scopes: string[];
  exception: boolean;
}) {
  if (input.environment !== "production" || input.exception) return false;
  const scopes = new Set(input.scopes);
  return scopes.has("data.payment.read") && scopes.has("tool.http.write");
}

export function canSetStatus(input: {
  role: string;
  from: AgentStatus;
  to: AgentStatus;
  ownsAgent: boolean;
}) {
  if (!legalTransition(input.from, input.to)) return false;
  if (input.to === "revoked") return input.role === "owner" || input.role === "admin";
  if (input.role === "owner" || input.role === "admin" || input.role === "operator") return true;
  return input.role === "developer" && input.ownsAgent;
}

export function canApprove(input: {
  role: string;
  decidedBy: string;
  requesterId: string;
  agentOwnerId: string;
}) {
  if (!["owner", "admin", "approver"].includes(input.role)) return false;
  if (input.decidedBy === input.requesterId) return false;
  if (input.decidedBy === input.agentOwnerId) return false;
  return true;
}

export type DecisionCode =
  | "rate_limited"
  | "invalid_token"
  | "environment_mismatch"
  | "agent_not_active"
  | "unknown_tool"
  | "invalid_arguments"
  | "scope_missing"
  | "user_scope_missing"
  | "policy_denied"
  | "quota_exceeded"
  | "approval_required"
  | "allowed"
  | "idempotent_replay";

export type Facts = {
  rateLimited: boolean;
  tokenFound: boolean;
  environmentOk: boolean;
  agentStatus: AgentStatus | "missing";
  toolKnown: boolean;
  argumentsOk: boolean;
  scopeGranted: boolean;
  behalfRequired: boolean;
  behalfAllowed: boolean;
  policyDenied: boolean;
  quotaOk: boolean;
  sensitive: boolean;
  replay: boolean;
};

export type Verdict = {
  http: number;
  code: DecisionCode;
  outcome: "allowed" | "denied" | "failed" | "pending" | "replay";
  record: boolean;
  execute: boolean;
  consumeQuota: boolean;
};

export function evaluate(facts: Facts): Verdict {
  if (facts.rateLimited) {
    return { http: 429, code: "rate_limited", outcome: "failed", record: facts.tokenFound, execute: false, consumeQuota: false };
  }
  if (!facts.tokenFound) {
    return { http: 401, code: "invalid_token", outcome: "failed", record: false, execute: false, consumeQuota: false };
  }
  if (facts.replay) {
    return { http: 200, code: "idempotent_replay", outcome: "replay", record: false, execute: false, consumeQuota: false };
  }
  if (!facts.environmentOk) {
    return { http: 403, code: "environment_mismatch", outcome: "denied", record: true, execute: false, consumeQuota: false };
  }
  if (facts.agentStatus !== "active") {
    return { http: 403, code: "agent_not_active", outcome: "failed", record: true, execute: false, consumeQuota: false };
  }
  if (!facts.toolKnown) {
    return { http: 422, code: "unknown_tool", outcome: "failed", record: true, execute: false, consumeQuota: false };
  }
  if (!facts.argumentsOk) {
    return { http: 422, code: "invalid_arguments", outcome: "failed", record: true, execute: false, consumeQuota: false };
  }
  if (!facts.scopeGranted) {
    return { http: 403, code: "scope_missing", outcome: "denied", record: true, execute: false, consumeQuota: false };
  }
  if (facts.behalfRequired && !facts.behalfAllowed) {
    return { http: 403, code: "user_scope_missing", outcome: "denied", record: true, execute: false, consumeQuota: false };
  }
  if (facts.policyDenied) {
    return { http: 403, code: "policy_denied", outcome: "denied", record: true, execute: false, consumeQuota: false };
  }
  if (!facts.quotaOk) {
    return { http: 429, code: "quota_exceeded", outcome: "failed", record: true, execute: false, consumeQuota: false };
  }
  if (facts.sensitive) {
    return { http: 202, code: "approval_required", outcome: "pending", record: true, execute: false, consumeQuota: true };
  }
  return { http: 200, code: "allowed", outcome: "allowed", record: true, execute: true, consumeQuota: true };
}
