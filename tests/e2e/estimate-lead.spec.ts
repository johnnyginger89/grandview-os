import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";

/*
 * Every estimate goes with the customer's open lead (audit A-SAL-3), starts on the job type
 * the customer asked for, and shows their request while estimating (A-SAL-14, A-EST-12).
 */
test.use({ storageState: statePath("owner") });

test("an estimate started from the customer page goes with their open lead, its job type and its request", async ({ page }) => {
  const stamp = Date.now();
  const request = `Repaint the siding and trim before spring [TEST DATA ${stamp}]`;
  await page.goto("/leads/new");
  await page.getByLabel("First name").fill("Lead");
  await page.getByLabel("Last name").fill(`Link ${stamp}`);
  await page.getByLabel("Email").fill(`lead-link-${stamp}@example.com`);
  await page.getByText("Exterior", { exact: true }).click();
  await page.getByRole("button", { name: "+ Add address and project details" }).click();
  await page.getByLabel("Project description").fill(request);
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  const number = (await page.getByText(/^Lead #\d+/).first().textContent())?.match(/#(\d+)/)?.[1];
  expect(number).toBeTruthy();

  // From the customer's page, not the lead's.
  await page.getByRole("link", { name: "Customer record" }).click();
  await page.getByRole("link", { name: "New estimate" }).click();
  const leadChoice = page.getByRole("radio", { name: new RegExp(`^#${number} · Exterior`) });
  await expect(leadChoice).toBeChecked();
  await expect(page.getByRole("radio", { name: "Exterior", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Start blank" }).click();
  await expect(page).toHaveURL(/\/estimates\/[0-9a-f-]{36}$/);

  const card = page.getByRole("region", { name: "Lead" });
  await expect(card.getByRole("link", { name: `Lead #${number}` })).toBeVisible();
  await expect(card).toContainText("Exterior");
  await expect(card).toContainText(request);

  // Unlinked by mistake: the estimate says so and links back in one click.
  await card.getByRole("button", { name: "Change lead" }).click();
  await card.getByLabel("Lead for this estimate").selectOption({ label: "No lead" });
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card).toContainText("Not linked to a lead");
  await card.getByRole("button", { name: "Link to lead" }).click();
  await expect(card.getByRole("link", { name: `Lead #${number}` })).toBeVisible();

  // And the lead lists the estimate.
  const estimateNumber = (await page.getByText(/^#\d+$/).first().textContent())?.slice(1);
  await card.getByRole("link", { name: `Lead #${number}` }).click();
  await expect(page.getByRole("link", { name: new RegExp(`^#${estimateNumber} `) })).toBeVisible();
});

test("with several open leads, New estimate asks which one before starting", async ({ page }) => {
  const stamp = Date.now();
  // Typed in by the office (not a website form), so the second enquiry is its own lead.
  for (const type of ["Interior", "Cabinets"]) {
    await page.goto("/leads/new");
    await page.getByLabel("First name").fill("Two");
    await page.getByLabel("Last name").fill(`Leads ${stamp}`);
    await page.getByLabel("Email").fill(`two-leads-${stamp}@example.com`);
    await page.getByText(type, { exact: true }).click();
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  }

  await page.getByRole("link", { name: "Customer record" }).click();
  await page.getByRole("link", { name: "New estimate" }).click();
  await expect(page.getByRole("group", { name: "Lead" }).getByRole("radio")).toHaveCount(3);
  await expect(page.getByText(/has 2 open leads\. Pick the one this estimate is for\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start blank" })).toBeDisabled();
  await page.getByRole("radio", { name: /· Cabinets ·/ }).check();
  await expect(page.getByRole("radio", { name: "Cabinets", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Start blank" })).toBeEnabled();
});
