import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, contacts, customers, estimates, integrationLinks, projects, properties, user, type LinkedEntityType } from "@/db/schema";
import { seal, unseal, sealedSchema } from "@/lib/crypto/secret-box";
import { audit } from "../audit";

/*
 * CompanyCam (photos the crew takes on site). The owner pastes an access token from
 * CompanyCam (Settings → API there) into Settings → Integrations here; it's stored
 * encrypted. A job or estimate is linked to a CompanyCam project (found by address, or
 * created from the job), and its latest photos show on the estimate, the job and the
 * work order. Photo files are fetched through our own server with short-lived signed
 * links, so the browser never needs CompanyCam's addresses and our security policy stays
 * strict. API: CompanyCam's public API v1 (https://developers.companycam.com; the older
 * /v2 API is retired in September 2027). Answers come as { data, errors, meta }.
 */

export class CompanyCamError extends Error {
  readonly expose = true;
}

const SETTING = "integration_companycam";
const API = () => (process.env.COMPANYCAM_API_URL || "https://api.companycam.com/public_api/v1").replace(/\/$/, "");
const TIMEOUT_MS = 8000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storedSchema = z.object({
  token: sealedSchema,
  connectedBy: z.string().nullable(),
  connectedAt: z.string(),
  companyName: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

async function stored() {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING)).limit(1);
  const parsed = storedSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

async function currentToken(): Promise<string | null> {
  const s = await stored();
  return s ? unseal(s.token) : null;
}

export interface CompanyCamStatus {
  connected: boolean;
  /** Saved, but can't be read any more (the server's secret changed): connect again. */
  unreadable: boolean;
  companyName: string | null;
  connectedAt: string | null;
  connectedByName: string | null;
}

export async function companyCamStatus(): Promise<CompanyCamStatus> {
  const s = await stored();
  if (!s) return { connected: false, unreadable: false, companyName: null, connectedAt: null, connectedByName: null };
  const readable = unseal(s.token) !== null;
  const [by] = s.connectedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, s.connectedBy)).limit(1) : [];
  return { connected: readable, unreadable: !readable, companyName: s.companyName, connectedAt: s.connectedAt, connectedByName: by?.name ?? null };
}

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

async function api(path: string, init: RequestInit = {}, token?: string | null): Promise<unknown> {
  const t = token ?? (await currentToken());
  if (!t) throw new CompanyCamError("CompanyCam isn't connected. Add the access token in Settings → Integrations.");
  let res: Response;
  try {
    res = await fetch(`${API()}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CompanyCamError("CompanyCam isn't answering right now. Try again in a minute.");
  }
  if (res.status === 401 || res.status === 403) throw new CompanyCamError("CompanyCam didn't accept the access token. Check it in Settings → Integrations.");
  if (res.status === 404) throw new CompanyCamError("That CompanyCam project no longer exists.");
  if (res.status === 429) throw new CompanyCamError("CompanyCam is busy. Try again in a minute.");
  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as { errors?: { message?: string }[] } | null;
    throw new CompanyCamError(`CompanyCam didn't accept that: ${body?.errors?.[0]?.message ?? "check the details"}.`);
  }
  if (!res.ok) throw new CompanyCamError("CompanyCam had a problem. Try again in a minute.");
  if (res.status === 204) return null;
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

const addressSchema = z
  .object({
    street_address_1: z.string().nullish(),
    street_address_2: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    postal_code: z.string().nullish(),
  })
  .nullish();
const imageUriSchema = z.object({ type: z.string(), uri: z.string().nullish(), url: z.string().nullish() });
const projectSchema = z.object({
  id: z.coerce.string(),
  name: z.string().nullish(),
  address: addressSchema,
  project_url: z.string().nullish(),
  status: z.string().nullish(),
});
const photoSchema = z.object({
  id: z.coerce.string(),
  uris: z.array(imageUriSchema).default([]),
  photo_url: z.string().nullish(),
  /** An ISO date-time (unix seconds in older answers). */
  captured_at: z.union([z.string(), z.number()]).nullish(),
  creator_name: z.string().nullish(),
  description: z.union([z.object({ plain_text_content: z.string().nullish() }), z.string()]).nullish(),
  status: z.string().nullish(),
});

const when = (v: string | number | null | undefined): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : /^\d+$/.test(v) ? new Date(Number(v) * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export interface CompanyCamProject {
  id: string;
  name: string;
  address: string;
  url: string | null;
}

const projectOut = (p: z.infer<typeof projectSchema>): CompanyCamProject => ({
  id: p.id,
  name: p.name?.trim() || "Untitled project",
  address: [p.address?.street_address_1, p.address?.city].filter(Boolean).join(", "),
  url: p.project_url ?? null,
});

/** Callers check settings.manage. Checks the token with CompanyCam before saving it. */
export async function connectCompanyCam(rawToken: unknown, actor: { id: string }): Promise<CompanyCamStatus> {
  const token = z.string().trim().min(10, "Paste the access token from CompanyCam.").max(2000).parse(rawToken);
  await api("/access_tokens/verify", { method: "POST", body: "{}" }, token);
  let companyName: string | null = null;
  try {
    const company = z.object({ name: z.string().nullish() }).safeParse(await api("/companies/current", {}, token));
    companyName = company.success ? (company.data.name ?? null) : null;
  } catch {
    // The name is only for display.
  }
  const value = { token: seal(token), connectedBy: actor.id, connectedAt: new Date().toISOString(), companyName };
  await db.insert(appSettings).values({ key: SETTING, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorId: actor.id, action: "integration.companycam.connect", entityType: "settings", entityId: SETTING, after: { companyName } });
  return companyCamStatus();
}

export async function disconnectCompanyCam(actor: { id: string }): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, SETTING));
  await audit({ actorId: actor.id, action: "integration.companycam.disconnect", entityType: "settings", entityId: SETTING });
}

/** Active CompanyCam projects whose name or street address matches. */
export async function searchCompanyCamProjects(query: string): Promise<CompanyCamProject[]> {
  const q = query.trim().slice(0, 100);
  const rows = z
    .array(projectSchema)
    .catch([])
    .parse(await api(q ? `/projects/search?${new URLSearchParams({ query: q, limit: "10" })}` : "/projects?limit=10"));
  return rows.filter((p) => p.status !== "deleted").map(projectOut);
}

// ---------------------------------------------------------------------------
// Links between our jobs/estimates and CompanyCam projects
// ---------------------------------------------------------------------------

export interface CompanyCamLink {
  entityType: LinkedEntityType;
  entityId: string;
  projectId: string;
  name: string | null;
  url: string | null;
}

async function ownLink(entityType: LinkedEntityType, entityId: string): Promise<CompanyCamLink | null> {
  if (!UUID_RE.test(entityId)) return null;
  const [l] = await db
    .select({ externalId: integrationLinks.externalId, externalName: integrationLinks.externalName, externalUrl: integrationLinks.externalUrl })
    .from(integrationLinks)
    .where(and(eq(integrationLinks.provider, "companycam"), eq(integrationLinks.entityType, entityType), eq(integrationLinks.entityId, entityId)))
    .limit(1);
  return l ? { entityType, entityId, projectId: l.externalId, name: l.externalName, url: l.externalUrl } : null;
}

/** The CompanyCam project for a job (its own link, else its estimate's) or an estimate. */
export async function companyCamLinkFor(entityType: LinkedEntityType, entityId: string): Promise<CompanyCamLink | null> {
  const own = await ownLink(entityType, entityId);
  if (own || entityType !== "project") return own;
  const [p] = await db.select({ estimateId: projects.estimateId }).from(projects).where(eq(projects.id, entityId)).limit(1);
  return p?.estimateId ? ownLink("estimate", p.estimateId) : null;
}

const linkInputSchema = z.object({
  entityType: z.enum(["project", "estimate"]),
  entityId: z.string().uuid(),
  companyCamProjectId: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "That isn't a CompanyCam project."),
});

/** Callers check write permission on the job or estimate. */
export async function linkCompanyCamProject(raw: unknown, actor: { id: string }): Promise<CompanyCamLink> {
  const input = linkInputSchema.parse(raw);
  const p = projectOut(projectSchema.parse(await api(`/projects/${encodeURIComponent(input.companyCamProjectId)}`)));
  await saveLink(input.entityType, input.entityId, p, actor);
  return { entityType: input.entityType, entityId: input.entityId, projectId: p.id, name: p.name, url: p.url };
}

async function saveLink(entityType: LinkedEntityType, entityId: string, p: CompanyCamProject, actor: { id: string }) {
  const values = { externalId: p.id, externalName: p.name, externalUrl: p.url, linkedBy: actor.id, linkedAt: new Date() };
  await db
    .insert(integrationLinks)
    .values({ provider: "companycam", entityType, entityId, ...values })
    .onConflictDoUpdate({ target: [integrationLinks.provider, integrationLinks.entityType, integrationLinks.entityId], set: values });
  await audit({ actorId: actor.id, action: "integration.companycam.link", entityType, entityId, after: { companyCamProjectId: p.id, name: p.name } });
}

export async function unlinkCompanyCamProject(raw: unknown, actor: { id: string }): Promise<void> {
  const { entityType, entityId } = linkInputSchema.pick({ entityType: true, entityId: true }).parse(raw);
  await db
    .delete(integrationLinks)
    .where(and(eq(integrationLinks.provider, "companycam"), eq(integrationLinks.entityType, entityType), eq(integrationLinks.entityId, entityId)));
  await audit({ actorId: actor.id, action: "integration.companycam.unlink", entityType, entityId });
}

/** What a new CompanyCam project should say: the customer, the job and the address. */
async function newProjectDetails(entityType: LinkedEntityType, entityId: string) {
  const [e] =
    entityType === "estimate"
      ? await db.select({ customerId: estimates.customerId, propertyId: estimates.propertyId, title: estimates.title }).from(estimates).where(eq(estimates.id, entityId)).limit(1)
      : await db.select({ customerId: projects.customerId, propertyId: projects.propertyId, title: projects.name }).from(projects).where(eq(projects.id, entityId)).limit(1);
  if (!e) throw new CompanyCamError("This job no longer exists.");
  const [[c], [k], [pr]] = await Promise.all([
    db.select({ name: customers.displayName, email: customers.email, phone: customers.phone }).from(customers).where(eq(customers.id, e.customerId)).limit(1),
    db
      .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone })
      .from(contacts)
      .where(and(eq(contacts.customerId, e.customerId), eq(contacts.isPrimary, true)))
      .limit(1),
    e.propertyId
      ? db.select({ street: properties.street, unit: properties.unit, city: properties.city, province: properties.province, postalCode: properties.postalCode }).from(properties).where(eq(properties.id, e.propertyId)).limit(1)
      : Promise.resolve([] as { street: string; unit: string | null; city: string | null; province: string | null; postalCode: string | null }[]),
  ]);
  const customerName = c?.name ?? "Customer";
  const name = e.title.includes(customerName) ? e.title : `${customerName} – ${e.title}`;
  // CompanyCam needs the full address to make a project.
  if (!pr?.street || !pr.city) throw new CompanyCamError("This job needs a street address and city before it can have a CompanyCam project.");
  const contactName = [k?.firstName, k?.lastName].filter(Boolean).join(" ") || customerName;
  const email = k?.email || c?.email || "";
  const phone = k?.phone || c?.phone || "";
  return {
    project: {
      name: name.slice(0, 200),
      street_address_1: pr.unit ? `${pr.unit} – ${pr.street}` : pr.street,
      city: pr.city,
      state: pr.province || "BC",
      postal_code: pr.postalCode ?? "",
      country: "CA",
      // CompanyCam wants a contact's name, email and phone together.
      ...(email && phone ? { primary_contact: { name: contactName, email, phone_number: phone } } : {}),
    },
  };
}

/** Creates the CompanyCam project from the job or estimate and links it. */
export async function createCompanyCamProject(raw: unknown, actor: { id: string }): Promise<CompanyCamLink> {
  const { entityType, entityId } = linkInputSchema.pick({ entityType: true, entityId: true }).parse(raw);
  const body = await newProjectDetails(entityType, entityId);
  const p = projectOut(projectSchema.parse(await api("/projects", { method: "POST", body: JSON.stringify(body) })));
  await saveLink(entityType, entityId, p, actor);
  return { entityType, entityId, projectId: p.id, name: p.name, url: p.url };
}

// ---------------------------------------------------------------------------
// Photos, through signed links to our own image route
// ---------------------------------------------------------------------------

function signingKey(): Buffer {
  const base = process.env.INTEGRATIONS_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET || "";
  return Buffer.from(hkdfSync("sha256", base, "grandview-os", "companycam-image-links-v1", 32));
}

const sign = (u: string, exp: number) => createHmac("sha256", signingKey()).update(`${exp}.${u}`).digest("base64url");

/** A link to our image route for one CompanyCam image URL, good for `ttlSeconds`. */
export function imageLink(url: string, now = Date.now(), ttlSeconds = 86_400): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const u = Buffer.from(url, "utf8").toString("base64url");
  return `/api/integrations/companycam/image?u=${u}&e=${exp}&s=${sign(url, exp)}`;
}

/** The CompanyCam URL behind a signed link, or null when it's forged, expired or not https. */
export function verifyImageLink(params: { u?: string | null; e?: string | null; s?: string | null }, now = Date.now()): string | null {
  if (!params.u || !params.e || !params.s || !/^\d{1,12}$/.test(params.e)) return null;
  const exp = Number(params.e);
  if (exp * 1000 < now) return null;
  let url: string;
  try {
    url = Buffer.from(params.u, "base64url").toString("utf8");
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  const want = Buffer.from(sign(url, exp));
  const got = Buffer.from(params.s);
  return want.length === got.length && timingSafeEqual(want, got) ? url : null;
}

export interface CompanyCamPhoto {
  id: string;
  thumb: string;
  full: string;
  /** Opens the photo in CompanyCam (needs a CompanyCam login). */
  url: string | null;
  capturedAt: string | null;
  by: string | null;
  description: string | null;
}

const pick = (uris: z.infer<typeof imageUriSchema>[], ...types: string[]) => {
  for (const t of types) {
    const hit = uris.find((x) => x.type === t);
    const u = hit?.uri || hit?.url;
    if (u) return u;
  }
  return uris[0]?.uri || uris[0]?.url || null;
};

/** The latest photos of a CompanyCam project, newest first. */
export async function companyCamPhotos(companyCamProjectId: string, limit = 24): Promise<CompanyCamPhoto[]> {
  const params = new URLSearchParams({ "project_ids[]": companyCamProjectId, limit: String(Math.min(Math.max(limit, 1), 100)) });
  const rows = z.array(photoSchema).catch([]).parse(await api(`/photos?${params}`));
  return rows
    .filter((p) => p.status !== "deleted")
    .map((p) => {
      const thumb = pick(p.uris, "thumbnail", "web", "original");
      const full = pick(p.uris, "web", "original", "thumbnail");
      return thumb && full
        ? {
            id: p.id,
            thumb: imageLink(thumb),
            full: imageLink(full),
            url: p.photo_url ?? null,
            capturedAt: when(p.captured_at),
            by: p.creator_name ?? null,
            description: (typeof p.description === "string" ? p.description : p.description?.plain_text_content)?.trim() || null,
          }
        : null;
    })
    .filter((p): p is CompanyCamPhoto => !!p)
    .slice(0, limit);
}

export interface CompanyCamPanel {
  status: CompanyCamStatus;
  link: CompanyCamLink | null;
  /** True when the link comes from the job's estimate rather than the job itself. */
  inherited: boolean;
  photos: CompanyCamPhoto[];
  /** What to search CompanyCam for, to link it: the street address. */
  suggestedQuery: string;
  error: string | null;
}

/** Everything the CompanyCam card needs, without ever throwing (CompanyCam being down mustn't break the page). */
export async function companyCamPanel(entityType: LinkedEntityType, entityId: string): Promise<CompanyCamPanel | null> {
  const status = await companyCamStatus();
  if (!status.connected) return { status, link: null, inherited: false, photos: [], suggestedQuery: "", error: null };
  const link = await companyCamLinkFor(entityType, entityId);
  let photos: CompanyCamPhoto[] = [];
  let error: string | null = null;
  if (link) {
    try {
      photos = await companyCamPhotos(link.projectId);
    } catch (e) {
      error = e instanceof CompanyCamError ? e.message : "CompanyCam photos couldn't be loaded.";
    }
  }
  let suggestedQuery = "";
  if (!link) {
    const [row] =
      entityType === "estimate"
        ? await db.select({ street: properties.street }).from(estimates).leftJoin(properties, eq(properties.id, estimates.propertyId)).where(eq(estimates.id, entityId)).limit(1)
        : await db.select({ street: properties.street }).from(projects).leftJoin(properties, eq(properties.id, projects.propertyId)).where(eq(projects.id, entityId)).limit(1);
    suggestedQuery = row?.street ?? "";
  }
  return { status, link, inherited: !!link && (link.entityType !== entityType || link.entityId !== entityId), photos, suggestedQuery, error };
}
