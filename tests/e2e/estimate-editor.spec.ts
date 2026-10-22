import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { addRoom, startBlankEstimate } from "./sales";

/*
 * The estimate editor, PaintScout-style: rooms come with their usual surfaces, the size
 * fills them in, colours are picked once for all walls, the paint list groups by colour,
 * and the total is always on screen (side panel on desktop, bar along the bottom on phones).
 */
test.use({ storageState: statePath("owner") });

async function newCustomerEstimate(page: Page, label: string) {
  const stamp = Date.now();
  await page.goto("/customers/new");
  await page.getByLabel("Customer name").fill(`${label} ${stamp} [TEST DATA]`);
  await page.getByLabel("Street address").fill("1 Example St");
  await page.getByRole("button", { name: "Create customer" }).click();
  await page.getByRole("link", { name: "New estimate" }).click();
}

test("add rooms with their usual surfaces, one colour for all walls, options and the paint list", async ({ page }) => {
  await newCustomerEstimate(page, "Editor");
  // No title typed: it's named from the job type and the address.
  await startBlankEstimate(page);
  await expect(page.getByLabel("Estimate title")).toHaveValue("Interior repaint – 1 Example St");

  // The "New room" form is open on an empty estimate; a bedroom comes with its doors and trim.
  const form = page.getByRole("region", { name: "New room" });
  await expect(form).toBeVisible();
  await form.getByRole("group", { name: "Room name" }).getByRole("button", { name: "Bedroom", exact: true }).click();
  await form.getByLabel("Length in feet").fill("12x10x8");
  await expect(form.getByLabel("Width in feet")).toHaveValue("10");
  await expect(form.getByText("= walls 352 · ceiling 120 sq ft · baseboard 44 lin ft")).toBeVisible();
  const ticked = form.getByRole("group", { name: /Paint in this room/ }).locator('button[aria-pressed="true"]');
  await expect(ticked.filter({ hasText: "Walls – roll & cut" })).toHaveCount(1);
  await expect(ticked.filter({ hasText: "Door slab (per side)" })).toHaveCount(1);
  // Add & next keeps the form open for the next room.
  await form.getByRole("button", { name: "Add & next" }).click();
  await expect(page.getByRole("region", { name: "Bedroom" })).toBeVisible();
  await form.getByRole("group", { name: "Room name" }).getByRole("button", { name: "Hallway", exact: true }).click();
  await expect(form.getByLabel("Height in feet")).toHaveValue("8");
  await form.getByLabel("Length in feet").fill("15 4");
  await form.getByRole("button", { name: "Add room", exact: true }).click();

  const bedroom = page.getByRole("region", { name: "Bedroom" });
  const hall = page.getByRole("region", { name: "Hallway" });
  await expect(hall.getByLabel("Quantity").first()).toHaveValue("304"); // 2 × (15 + 4) × 8
  await bedroom.getByRole("button", { name: "Open Bedroom" }).click();
  await expect(bedroom.getByLabel("Quantity").first()).toHaveValue("352");

  // Pick a colour once, use it on every wall on the estimate.
  await bedroom.getByRole("button", { name: /Walls – roll & cut/ }).click();
  await bedroom.getByLabel("Colour", { exact: true }).fill("SW 7008 Alabaster");
  await bedroom.getByRole("radiogroup", { name: "Sheen" }).getByRole("radio", { name: "Eggshell" }).click();
  await bedroom.getByRole("button", { name: "all walls on this estimate" }).click();
  await expect(hall.getByRole("button", { name: /SW 7008 Alabaster · Eggshell/ })).toBeVisible();

  // Room conditions set every surface in the room at once.
  await bedroom.getByRole("button", { name: /Conditions: normal/ }).click();
  const prep = bedroom.getByRole("radiogroup", { name: "Prep" }).first();
  await prep.getByRole("radio").last().click();
  await expect(bedroom.getByRole("button", { name: /Conditions: (?!normal)/ })).toBeVisible();

  // Make the hallway ceiling an option: listed with its price, not in the total.
  const total = page.getByTestId("editor-total");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  const before = await total.innerText();
  await hall.getByRole("button", { name: /Ceilings – roll & cut/ }).click();
  await hall.getByText("Optional upgrade", { exact: true }).click();
  await expect(total).not.toHaveText(before);
  await expect(page.getByRole("button", { name: /Options the customer can add/ })).toContainText("1 ·");

  // Paint list: walls of both rooms in one colour row, by product.
  const details = page.getByRole("tabpanel");
  await page.getByRole("tab", { name: "Paint list" }).click();
  const walls = details.getByRole("listitem").filter({ hasText: "SW 7008 Alabaster · Eggshell" });
  await expect(walls).toHaveCount(1);
  await expect(walls).toContainText("Bedroom, Hallway");
  await expect(walls).toContainText(/gal → buy \d+ gal/);
  await page.getByRole("tab", { name: "Labour" }).click();
  await expect(details.locator("p", { hasText: "By room:" })).toContainText(/Bedroom [\d.]+ · Hallway [\d.]+/);

  // Hide costs for when the customer is watching.
  await expect(page.getByText("Gross margin")).toBeVisible();
  await page.getByRole("button", { name: "Hide costs" }).click();
  await expect(page.getByText("Gross margin")).toHaveCount(0);
  await page.getByRole("button", { name: "Show costs" }).click();

  // Survives a reload.
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("region", { name: "Hallway" })).toBeVisible();
});

test("Hide costs hides every cost on the page, stays hidden on this device, and Show costs brings them back", async ({ page }) => {
  await newCustomerEstimate(page, "Customer view");
  await startBlankEstimate(page);
  await addRoom(page, "Living room", { size: "15 12 8", only: ["Walls – roll & cut"] });
  await page.getByRole("button", { name: /^Extras/ }).click();
  await page.getByRole("button", { name: "Subcontractor", exact: true }).click();
  await page.getByLabel("Cost", { exact: true }).fill("500");

  const room = page.getByRole("region", { name: "Living room" });
  const walls = room.getByRole("button", { name: /Walls – roll & cut/ });
  const note = room.getByText(/^Rate: /);
  const paint = room.getByLabel("Paint product").locator("option", { hasText: "Sherwin-Williams Duration Home Interior Matte" });
  const versions = page.getByRole("dialog", { name: "Versions" });
  const openVersions = async () => {
    await page.getByRole("button", { name: "Estimate menu" }).click();
    await page.getByRole("button", { name: "Versions" }).click();
  };
  // Labour cost and rate, paint $/gal, other costs, cost, margin, markup: none of it for the customer.
  const internal = /Labour \$|@ \$|\/gal|Other \$|Cost \$|Margin|markup/i;

  // Costs show to the owner until hidden.
  await walls.click();
  await expect(note).toContainText(/Labour \$[\d,.]+ @ \$[\d,.]+\/h · Paint [\d.]+ gal \$[\d,.]+ · Other \$[\d,.]+ · Cost \$[\d,.]+ · Margin [\d.]+%/);
  await expect(paint).toHaveText(/^Sherwin-Williams Duration Home Interior Matte · \$[\d,.]+\/gal$/);
  await expect(page.getByLabel("Markup %")).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  await openVersions();
  await versions.getByRole("button", { name: "Save a version" }).click();
  await expect(versions.getByRole("columnheader", { name: "Margin" })).toBeVisible();
  await versions.getByRole("button", { name: "Close" }).click();

  // One switch hides them in the room card, the surface details, the paint picker, Extras, Versions and Totals.
  await page.getByRole("button", { name: "Hide costs" }).click();
  await expect(note).toHaveText(/^Rate: [\d.]+ sq ft\/h \(v\d+\) · Paint [\d.]+ gal$/);
  await expect(paint).toHaveText("Sherwin-Williams Duration Home Interior Matte");
  await expect(room).not.toContainText(internal);
  await expect(page.getByLabel("Cost", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Markup %")).toHaveCount(0);
  await expect(page.getByText("Gross margin")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Price" })).toHaveCount(0);
  await openVersions();
  await expect(versions.getByRole("columnheader", { name: "Price" })).toBeVisible();
  await expect(versions.getByRole("columnheader", { name: "Margin" })).toHaveCount(0);
  await versions.getByRole("button", { name: "Close" }).click();
  // The prices the customer sees on the proposal stay.
  await expect(page.getByTestId("editor-total")).toHaveText(/\$[\d,]+\.\d\d/);
  await expect(room.getByText(/^\$[\d,]+\.\d\d$/).first()).toBeVisible();

  // Remembered on this device.
  await page.reload();
  // Retry until the page has loaded enough to open the surface.
  await expect(async () => {
    if ((await walls.getAttribute("aria-expanded")) !== "true") await walls.click();
    await expect(paint).toBeAttached({ timeout: 500 });
  }).toPass();
  await expect(paint).toHaveText("Sherwin-Williams Duration Home Interior Matte");
  await expect(room).not.toContainText(internal);
  await expect(page.getByLabel("Markup %")).toHaveCount(0);

  await page.getByRole("button", { name: "Show costs" }).click();
  await expect(note).toContainText(/Labour \$[\d,.]+ @ \$[\d,.]+\/h · .+ · Margin [\d.]+%/);
  await expect(paint).toHaveText(/\/gal$/);
  await expect(page.getByLabel("Markup %")).toBeVisible();
  await expect(page.getByText("Gross margin")).toBeVisible();
});

test("save as a template and start the next estimate from it", async ({ page }) => {
  await newCustomerEstimate(page, "Template source");
  await startBlankEstimate(page);
  await addRoom(page, "Kitchen", { size: "12 10" });
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 10_000 });
  const name = `Kitchen only ${Date.now()} [TEST DATA]`;
  await page.getByRole("button", { name: "Estimate menu" }).click();
  await page.getByRole("button", { name: "Save as template" }).click();
  await page.getByRole("dialog", { name: "Save as template" }).getByLabel("Template name").fill(name);
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Saved as a template")).toBeVisible();

  await newCustomerEstimate(page, "From template");
  await page.getByRole("button", { name }).click();
  await expect(page).toHaveURL(/\/estimates\/[0-9a-f-]{36}/);
  await expect(page.getByRole("region", { name: "Kitchen" })).toBeVisible();
});

test("new estimate finds the customer by search", async ({ page }) => {
  const stamp = Date.now();
  const customer = `Searchable ${stamp} [TEST DATA]`;
  await page.goto("/customers/new");
  await page.getByLabel("Customer name").fill(customer);
  await page.getByRole("button", { name: "Create customer" }).click();
  await page.goto("/estimates/new");
  await expect(page.getByRole("button", { name: "Start blank" })).toBeDisabled();
  await page.getByLabel("Find the customer").fill(`Searchable ${stamp}`);
  await page.getByRole("list", { name: "Matching customers" }).getByRole("button", { name: new RegExp(`Searchable ${stamp}`) }).click();
  await page.getByRole("radio", { name: "Exterior", exact: true }).click();
  await startBlankEstimate(page);
  await expect(page.getByLabel("Estimate title")).toHaveValue("Exterior repaint");
  // Outside areas on an exterior job.
  await expect(page.getByRole("region", { name: "New room" }).getByRole("button", { name: "Whole house", exact: true })).toBeVisible();
});

test("phone: the total and Send stay on screen @mobile", async ({ page }) => {
  await newCustomerEstimate(page, "Phone");
  await startBlankEstimate(page);
  await addRoom(page, "Living room", { size: "15 12 8" });
  const bar = page.getByRole("button", { name: "Show totals, paint list and labour" });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("incl. GST");
  // The app's own bottom menu makes way for the estimate bar.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await bar.click();
  await expect(page.getByRole("dialog", { name: "Totals" }).getByText("Total incl. GST")).toBeVisible();
  await page.getByRole("dialog", { name: "Totals" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("the owner changes the room presets in Settings", async ({ page }) => {
  const room = `Mudroom ${Date.now()}`;
  await page.goto("/rates?tab=rooms");
  const presets = page.getByRole("region", { name: "Room presets" });
  await presets.getByRole("button", { name: "Add a room name" }).click();
  await presets.getByLabel("Room name").fill(room);
  await presets.getByRole("checkbox", { name: /Walls – roll & cut/ }).check();
  await page.getByRole("button", { name: "Save room presets" }).click();
  await expect(page.getByText("Saved. New rooms on estimates use these now.")).toBeVisible();

  await newCustomerEstimate(page, "Presets");
  await startBlankEstimate(page);
  const form = page.getByRole("region", { name: "New room" });
  await form.getByRole("group", { name: "Room name" }).getByRole("button", { name: room }).click();
  await expect(form.getByRole("group", { name: /Paint in this room/ }).locator('button[aria-pressed="true"]')).toHaveText([/Walls – roll & cut/]);

  // Tidy up: take it out again.
  await page.goto("/rates?tab=rooms");
  await page.getByRole("button", { name: `Remove ${room}` }).click();
  await page.getByRole("button", { name: "Save room presets" }).click();
  await expect(page.getByText("Saved. New rooms on estimates use these now.")).toBeVisible();
});
