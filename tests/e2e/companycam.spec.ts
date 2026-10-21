import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { statePath } from "./helpers";
import { draftThreeThousandDollarEstimate } from "./sales";

/*
 * CompanyCam, against a stand-in CompanyCam API on this machine. Runs only when the app
 * server was started with COMPANYCAM_API_URL=http://127.0.0.1:<port> and this run has
 * COMPANYCAM_MOCK_PORT=<port>; otherwise it's skipped (nothing here may call the real
 * CompanyCam). Connect in Settings, link an estimate by address, see its photos, disconnect.
 */
const PORT = Number(process.env.COMPANYCAM_MOCK_PORT ?? 0);
const GOOD = "cc_test_token_[TEST DATA]_0123456789";
test.describe.configure({ mode: "serial" });
test.skip(!PORT, "Set COMPANYCAM_MOCK_PORT (and COMPANYCAM_API_URL on the server) to run");

let server: Server;
const created: unknown[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${GOOD}`) return send(401, { data: {}, errors: [{ code: "invalid_token", message: "Invalid token" }], meta: {} });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const p = url.pathname.replace(/^\/public_api\/v1/, "");
      if (p === "/access_tokens/verify") return send(200, { data: { message: "ok" }, errors: [], meta: {} });
      if (p === "/companies/current") return send(200, { data: { name: "Grandview Painting [TEST DATA]" } });
      if (p === "/projects/search" || p === "/projects")
        if (req.method === "POST") {
          created.push(JSON.parse(raw));
          return send(201, { data: { id: "777", name: "Created project", project_url: "https://app.companycam.example/projects/777" } });
        } else
          return send(200, {
            data: [{ id: "501", name: "1 Example St [TEST DATA]", address: { street_address_1: "1 Example St", city: "Surrey" }, project_url: "https://app.companycam.example/projects/501", status: "active" }],
            meta: { has_next: false },
          });
      if (p === "/projects/501") return send(200, { data: { id: "501", name: "1 Example St [TEST DATA]", project_url: "https://app.companycam.example/projects/501" } });
      if (p === "/photos")
        return send(200, {
          data: [1, 2, 3].map((i) => ({ id: String(i), status: "active", creator_name: "Niko", captured_at: "2026-10-20T18:00:00Z", uris: [{ type: "thumbnail", uri: `https://img.companycam.example/${i}.jpg`, url: `https://img.companycam.example/${i}.jpg` }] })),
        });
      send(404, { data: {}, errors: [{ code: "not_found", message: "Not found" }], meta: {} });
    });
  });
  await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
});

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

test.use({ storageState: statePath("owner") });

test("connect, link an estimate by address, see its photos, disconnect", async ({ page }) => {
  await page.goto("/settings?tab=integrations");
  const card = page.getByRole("region", { name: "CompanyCam" });
  if (await card.getByRole("button", { name: "Disconnect" }).isVisible()) {
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Disconnect" }).click();
  }
  await card.getByLabel("CompanyCam access token").fill("wrong-token-0123456789");
  await card.getByRole("button", { name: "Connect" }).click();
  await expect(card.getByRole("alert")).toContainText("didn't accept the access token");
  await card.getByLabel("CompanyCam access token").fill(GOOD);
  await card.getByRole("button", { name: "Connect" }).click();
  await expect(card.getByText(/Connected to Grandview Painting \[TEST DATA\]/)).toBeVisible();

  await draftThreeThousandDollarEstimate(page);
  const photos = page.getByRole("region", { name: "CompanyCam photos" });
  await expect(photos.getByLabel("Search CompanyCam")).toHaveValue("1 Example St");
  await photos.getByRole("button", { name: "Search" }).click();
  await photos.getByRole("list", { name: "CompanyCam projects" }).getByRole("button", { name: "Link" }).click();
  await expect(photos.getByRole("link", { name: /Open in CompanyCam/ })).toHaveAttribute("href", "https://app.companycam.example/projects/501");
  const imgs = photos.getByRole("list", { name: "CompanyCam photos" }).getByRole("img");
  await expect(imgs).toHaveCount(3);
  expect(await imgs.first().getAttribute("src")).toMatch(/^\/api\/integrations\/companycam\/image\?u=/);

  // A tampered image link is refused.
  const src = (await imgs.first().getAttribute("src"))!;
  expect((await page.request.get(src.replace(/s=[^&]+/, "s=forged"))).status()).toBe(404);

  await page.goto("/settings?tab=integrations");
  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByText("Not connected")).toBeVisible();
});
