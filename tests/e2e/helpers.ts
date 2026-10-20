import { expect, type Page } from "@playwright/test";

export const DEV_PASSWORD = "grandview-dev-only-1";
export const ROLES_UNDER_TEST = ["owner", "estimator", "painter", "subcontractor"] as const;
export type TestRole = (typeof ROLES_UNDER_TEST)[number];

export const statePath = (role: TestRole) => `tests/e2e/.auth/${role}.json`;

export async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@dev.grandview.local`);
  await page.getByLabel("Password").fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function expectNoAccess(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/no-access|my-jobs/);
}
