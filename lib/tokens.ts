import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function pepper(name: "SESSION_PEPPER" | "TOKEN_PEPPER") {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function hashSecret(value: string, spice: string) {
  return createHash("sha256").update(`${spice}:${value}`).digest("hex");
}

export function hashesEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function newSecretToken() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashSecret(raw, pepper("SESSION_PEPPER")) };
}

export function newApiToken(environment: "test" | "live") {
  const raw = `ag_${environment}_${randomBytes(24).toString("base64url")}`;
  return {
    raw,
    hash: hashSecret(raw, pepper("TOKEN_PEPPER")),
    prefix: raw.slice(0, 16),
    environment,
  };
}

export function tokenEnvironment(raw: string): "test" | "live" | null {
  if (raw.startsWith("ag_test_")) return "test";
  if (raw.startsWith("ag_live_")) return "live";
  return null;
}
