import { expect, test } from "@playwright/test";
import { expectNoAccess, statePath } from "./helpers";
import { kpiValue, sellThreeThousandDollarJob } from "./sales";

test.describe("performance (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("a signed job raises Sales and Backlog; completing it moves it into Produced", async ({ page, browser }) => {
    await page.goto("/performance");
    const sales = await kpiValue(page, "kpi-sales");
    const produced = await kpiValue(page, "kpi-produced");
    const backlog = await kpiValue(page, "kpi-backlog");
    const jobs = await kpiValue(page, "kpi-jobs-sold");

    const name = await sellThreeThousandDollarJob(page, browser);
    await page.goto("/performance");
    expect(await kpiValue(page, "kpi-sales")).toBeCloseTo(sales + 3000, 2);
    expect(await kpiValue(page, "kpi-backlog")).toBeCloseTo(backlog + 3000, 2);
    expect(await kpiValue(page, "kpi-jobs-sold")).toBe(jobs + 1);

    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(name.replace(/[[\]]/g, "\\$&")) }).first().click();
    await page.getByLabel("Project status").selectOption({ label: "Complete" });
    await page.getByRole("button", { name: "Save status" }).click();
    await expect(page.getByText("Status saved")).toBeVisible();
    await expect(page.getByRole("list", { name: "Status history" }).getByText("→ Complete")).toBeVisible();

    await page.goto("/performance");
    expect(await kpiValue(page, "kpi-produced")).toBeCloseTo(produced + 3000, 2);
    expect(await kpiValue(page, "kpi-backlog")).toBeCloseTo(backlog, 2);
  });

  test("goals save and show against the year", async ({ page }) => {
    await page.goto("/settings?tab=goals");
    const year = new Date().getFullYear();
    await page.getByLabel(`Sales goal for ${year} ($)`).fill("1,200,000");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.goto("/performance?period=ytd");
    await expect(page.getByText(/of \$1,200,000 goal for/).first()).toBeVisible();
  });

  test("no sideways scrolling on a phone @mobile", async ({ page }) => {
    await page.goto("/performance");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("period-select")).toBeVisible();
  });
});

test.describe("performance (estimator)", () => {
  test.use({ storageState: statePath("estimator") });

  test("sees counts but no company money", async ({ page }) => {
    const res = await page.goto("/performance");
    const html = (await res?.text()) ?? "";
    for (const key of ["kpi-sales", "kpi-produced", "kpi-backlog\"", "goal-meter", "soldValue"]) expect(html, key).not.toContain(key);
    await expect(page.getByTestId("kpi-jobs-sold")).toBeVisible();
    await expect(page.getByTestId("kpi-leads")).toBeVisible();
    await expectNoAccess(page, "/settings?tab=goals");
  });
});

test.describe("performance (field roles)", () => {
  test.use({ storageState: statePath("painter") });
  test("painters can't open it", async ({ page }) => {
    await expectNoAccess(page, "/performance");
    await expect(page.getByRole("link", { name: "Performance" })).toHaveCount(0);
  });
});
