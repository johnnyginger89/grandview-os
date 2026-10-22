import { expect, test, type Page } from "@playwright/test";
import { statePath } from "./helpers";
import { sellThreeThousandDollarJob } from "./sales";

/*
 * Job chat: the office and the crew booked on a job talk in the job's channel, the crew
 * posts an end-of-day update with a photo, everyone else in the chat is told, and people
 * outside it (or signed out) can't read it or see its photos.
 */
test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const CREW = `[TEST DATA] Chat crew ${stamp}`;
const HELLO = `Starting Monday, bring drop sheets ${stamp}`;
const UPDATE = `Kitchen walls done, ceilings tomorrow ${stamp}`;
// A 4×3 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4kWIERww4OQBHKhBpqqu7qgAAAABJRU5ErkJggg==", "base64");
let chatPath = "";
let photoUrl = "";

const log = (page: Page) => page.getByRole("log", { name: "Messages" });

test.describe("job chat (owner)", () => {
  test.use({ storageState: statePath("owner") });

  test("the office posts in a sold job's chat, and books a crew into it", async ({ page, browser }) => {
    const name = await sellThreeThousandDollarJob(page, browser);
    await page.goto("/schedule/setup");
    await page.getByRole("button", { name: "Add crew" }).click();
    const crew = page.getByRole("form", { name: "Add crew" });
    await crew.getByLabel("Name").fill(CREW);
    await crew.getByLabel("Crew size").fill("2");
    await crew.getByRole("checkbox", { name: "Painter (Dev)" }).check();
    await crew.getByRole("button", { name: "Crew lead: Painter (Dev)" }).click();
    await crew.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("table", { name: "Crews" }).getByText(CREW).first()).toBeVisible();

    await page.goto("/projects");
    await page.getByRole("link", { name: new RegExp(name.replace(/[[\]]/g, "\\$&")) }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Assign someone" }).click();
    const assign = page.getByRole("form", { name: "Assign someone" });
    await assign.getByLabel("Who").selectOption({ label: CREW });
    await assign.getByLabel("Working days").fill("3");
    await assign.getByRole("button", { name: "Add to schedule" }).click();
    await expect(page.getByTestId("work-order-assigned").first()).toContainText(CREW);

    await page.getByRole("region", { name: "Job chat" }).getByRole("link", { name: "Open chat" }).click();
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}/);
    chatPath = new URL(page.url()).pathname;
    await expect(log(page).getByText("No messages yet.")).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).fill(HELLO);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(log(page).getByText(HELLO)).toBeVisible();

    // The painter's crew is in the chat because it's booked; the owner is always in it.
    await page.getByRole("button", { name: /^People in this chat/ }).click();
    const people = page.getByRole("dialog", { name: "People in this chat" });
    await expect(people.getByRole("list", { name: "Members" })).toContainText("Painter (Dev)");
    await expect(people.getByRole("list", { name: "Members" })).toContainText("Booked on this job");
    await people.getByRole("button", { name: "Done" }).click();
  });
});

test.describe("job chat (booked painter)", () => {
  test.use({ storageState: statePath("painter") });

  test("the painter reads it from My Jobs and posts a daily update with a photo", async ({ page }) => {
    test.skip(!chatPath, "needs the owner steps above");
    await page.goto("/my-jobs");
    await page.getByRole("article").filter({ hasText: CREW }).getByRole("link", { name: "Job chat" }).click();
    await expect(page).toHaveURL(new RegExp(`${chatPath}$`));
    await expect(log(page).getByText(HELLO)).toBeVisible();
    // Crews see who is in the chat, never the list of every other staff member.
    expect(await page.content()).not.toContain("Estimator (Dev)");

    await page.getByRole("button", { name: "Post today's daily update" }).click();
    await page.getByLabel("How far along").selectOption("60");
    await page.getByRole("textbox", { name: "Message" }).fill(UPDATE);
    await page.locator('input[type="file"][multiple]').setInputFiles({ name: "kitchen.png", mimeType: "image/png", buffer: PNG });
    const photos = page.getByRole("list", { name: "Photos to send" });
    await expect(photos.getByRole("listitem")).toHaveCount(1);
    await expect(photos.getByLabel("Uploading")).toHaveCount(0);
    await page.getByRole("button", { name: "Send daily update" }).click();

    const update = log(page).getByRole("article").filter({ hasText: UPDATE });
    await expect(update.getByText("Daily update · 60% done")).toBeVisible();
    const img = update.getByRole("img", { name: "Job photo" });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    photoUrl = new URL((await update.getByRole("link").first().getAttribute("href"))!, page.url()).toString();
  });
});

test.describe("job chat (owner, after the update)", () => {
  test.use({ storageState: statePath("owner") });

  test("the owner is told, and sees it in the chat list", async ({ page }) => {
    test.skip(!photoUrl, "needs the painter's update");
    await expect(async () => {
      const res = await page.request.get("/api/notifications");
      const { items } = (await res.json()) as { items: { title: string; body: string | null }[] };
      expect(items.some((n) => n.title.startsWith("Daily update on #") && n.body?.includes(UPDATE.slice(0, 30)))).toBe(true);
    }).toPass({ timeout: 15_000 });
    await page.goto("/chat");
    await expect(page.getByRole("list", { name: "Job chats" }).getByRole("link").filter({ hasText: "Daily update:" }).first()).toBeVisible();
    await page.goto(chatPath);
    await expect(log(page).getByText(UPDATE)).toBeVisible();
    const res = await page.request.get(photoUrl);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    expect(res.headers()["cache-control"]).toContain("private");
  });
});

test.describe("job chat (outsiders)", () => {
  test.use({ storageState: statePath("subcontractor") });

  test("someone not on the job, or signed out, can't read it or its photos", async ({ page, browser }) => {
    test.skip(!photoUrl, "needs the steps above");
    await page.goto(chatPath);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText(HELLO)).toHaveCount(0);
    expect((await page.request.get(photoUrl)).status()).toBe(404);
    expect((await page.request.get(`/api${chatPath}/messages`)).status()).toBe(404);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    expect((await anon.request.get(photoUrl)).status()).toBe(404);
    expect((await anon.request.get(`/api${chatPath}/messages`)).status()).toBe(401);
    await anon.close();
  });
});
