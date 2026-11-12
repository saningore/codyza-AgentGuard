import { describe, expect, it } from "vitest";
import { hashPassword, passwordAccepted, verifyPassword } from "../../lib/password";
import { hashSecret, hashesEqual } from "../../lib/tokens";

describe("passwords", () => {
  it("rejects a short password and verifies a stored hash", async () => {
    expect(passwordAccepted("short")).toBe(false);
    expect(passwordAccepted("Gate-lamp-42")).toBe(true);
    const stored = await hashPassword("Gate-lamp-42");
    expect(await verifyPassword("Gate-lamp-42", stored)).toBe(true);
    expect(await verifyPassword("Gate-lamp-43", stored)).toBe(false);
    expect(await verifyPassword("Gate-lamp-42", "plain")).toBe(false);
  });
});

describe("token hashes", () => {
  it("changes when the pepper changes and compares in constant time", () => {
    const left = hashSecret("ag_test_example", "pepper-a");
    const right = hashSecret("ag_test_example", "pepper-b");
    expect(left).not.toBe(right);
    expect(hashesEqual(left, hashSecret("ag_test_example", "pepper-a"))).toBe(true);
    expect(hashesEqual(left, right)).toBe(false);
  });
});
