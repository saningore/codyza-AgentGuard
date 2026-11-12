import { expect, test } from "@playwright/test";
import { demoMfa, demoPassword } from "../../db/ids";
import { currentTotp } from "../../lib/totp";

test("the marketing page shows the logo and the Codyza link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "AgentGuard" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Powered by Codyza" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Decide every agent action/ })).toBeVisible();
});

test("a wrong password stays on the sign-in page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("jordan.hale@harbor.test");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /incorrect/i })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a viewer can open the workspace and cannot create a token", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("jordan.hale@harbor.test");
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/o\/harbor-robotics/);
  await expect(page.getByRole("link", { name: "Powered by Codyza" })).toBeVisible();
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("link", { name: /Dispatch active/ }).click();
  await expect(page.getByRole("heading", { name: "Dispatch" })).toBeVisible();
  await expect(page.getByText("You cannot create a token.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create token" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("an owner completes the authenticator step", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("june.okoye@harbor.test");
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Authentication code")).toBeVisible();
  await page.getByLabel("Authentication code").fill(currentTotp(demoMfa.june));
  await page.getByRole("button", { name: "Confirm code" }).click();
  await expect(page).toHaveURL(/\/o\/harbor-robotics/);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("health checks answer and cron without a secret does not", async ({ request }) => {
  const live = await request.get("/api/health/live");
  const ready = await request.get("/api/health/ready");
  const cron = await request.post("/api/cron");
  expect(live.ok()).toBe(true);
  expect(ready.ok()).toBe(true);
  expect(cron.status()).toBe(401);
});

test("a sensitive deletion waits for a different person", async ({ page, request }) => {
  const name = `Playwright ${Date.now()}`;
  const created = await request.post("/api/v1/actions", {
    headers: { Authorization: "Bearer ag_test_harbor_dispatch_demo_token_0001" },
    data: { tool: "customer.create", arguments: { name } },
  });
  expect(created.ok()).toBe(true);
  const createdBody = await created.json();
  const removed = await request.post("/api/v1/actions", {
    headers: { Authorization: "Bearer ag_test_harbor_dispatch_demo_token_0001" },
    data: { tool: "customer.delete", arguments: { customer_id: createdBody.resource_id } },
  });
  expect(removed.status()).toBe(202);
  await page.goto("/login");
  await page.getByLabel("Email").fill("sam.okonkwo@harbor.test");
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Approvals" }).click();
  const card = page.locator("article", { hasText: createdBody.resource_id });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("No approvals are waiting.")).toBeVisible();
  await page.getByRole("link", { name: "Customers" }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.locator("li", { hasText: name })).toContainText("deleted");
});

test("phone width keeps sign-in and the workspace usable @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Powered by Codyza" })).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email").fill("jordan.hale@harbor.test");
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/o\/harbor-robotics/);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await page.getByRole("link", { name: "Agents" }).click();
  await page.getByRole("link", { name: /Dispatch active/ }).click();
  await expect(page.getByRole("heading", { name: "Dispatch" })).toBeVisible();
  await expect(page.getByText("You cannot create a token.")).toBeVisible();
});

test("forgot password does not reveal whether the email exists", async ({ page }) => {
  await page.goto("/forgot");
  await page.getByLabel("Email").fill("nobody@harbor.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(/If an account exists/i);
});
