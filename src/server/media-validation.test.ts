import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkPdf, MediaError, processImage, rejectedFormat, sanitizeFilename, sniffType, typeForFilename, validateAndProcess, IMAGE_MAX_BYTES, DOCUMENT_MAX_BYTES } = await import("./media-validation");

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";

async function jpeg(w = 1200, h = 800, opts: { exif?: boolean } = {}) {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg();
  if (opts.exif) img = img.withMetadata({ exif: { IFD0: { Copyright: "x" } } });
  return new Uint8Array(await img.toBuffer());
}
async function png(w = 10, h = 10) {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
}

describe("sniffType", () => {
  it("recognises JPEG, PNG, WebP and PDF by magic bytes", async () => {
    expect(sniffType(await jpeg(10, 10))).toBe("image/jpeg");
    expect(sniffType(await png())).toBe("image/png");
    expect(sniffType(new Uint8Array(await sharp(await png()).webp().toBuffer()))).toBe("image/webp");
    expect(sniffType(enc(PDF))).toBe("application/pdf");
    expect(sniffType(enc("hello"))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
  });
});

describe("validateAndProcess", () => {
  const expectReject = async (p: Promise<unknown>, msg: RegExp) => {
    await expect(p).rejects.toBeInstanceOf(MediaError);
    await expect(p).rejects.toThrow(msg);
  };
  it("rejects SVG and XML", async () => {
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/png", bytes: enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }), /SVG files aren't accepted/);
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/png", bytes: enc('\uFEFF  <?xml version="1.0"?><svg/>') }), /SVG files aren't accepted/);
  });
  it("rejects HTML renamed to .png", async () => {
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/png", bytes: enc("<!DOCTYPE html><html><script>alert(1)</script>") }), /web page/);
  });
  it("rejects GIF, zip and empty files", async () => {
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/png", bytes: enc("GIF89a....") }), /export it as JPG or PNG/);
    await expectReject(validateAndProcess({ kind: "document", declaredType: "application/pdf", bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) }), /Zip/);
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/png", bytes: new Uint8Array() }), /empty/);
  });
  it("rejects a declared/sniffed type mismatch", async () => {
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/png", bytes: await jpeg(10, 10) }), /named \.png but isn't a PNG image/);
  });
  it("rejects PDFs as images and WebP as documents", async () => {
    await expectReject(validateAndProcess({ kind: "image", declaredType: "application/pdf", bytes: enc(PDF) }), /JPG, PNG or WebP/);
    const webp = new Uint8Array(await sharp(await png()).webp().toBuffer());
    await expectReject(validateAndProcess({ kind: "document", declaredType: "image/webp", bytes: webp }), /PDF, JPG or PNG/);
  });
  it("enforces 3 MiB for images and 10 MiB for documents", async () => {
    const big = new Uint8Array(IMAGE_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expectReject(validateAndProcess({ kind: "image", declaredType: "image/jpeg", bytes: big }), /too large/);
    const bigPdf = new Uint8Array(DOCUMENT_MAX_BYTES + 1);
    bigPdf.set(enc("%PDF-1.4"));
    await expectReject(validateAndProcess({ kind: "document", declaredType: "application/pdf", bytes: bigPdf }), /too large/);
  });
  it("accepts a clean PDF unchanged", async () => {
    const out = await validateAndProcess({ kind: "document", declaredType: "application/pdf", bytes: enc(PDF) });
    expect(out.contentType).toBe("application/pdf");
    expect(Buffer.from(out.bytes).toString("latin1")).toBe(PDF);
  });
  it("accepts a JPEG document scan and re-encodes it", async () => {
    const out = await validateAndProcess({ kind: "document", declaredType: "image/jpeg", bytes: await jpeg(300, 400) });
    expect(out.contentType).toBe("image/jpeg");
    expect(out.width).toBe(300);
  });
});

describe("checkPdf", () => {
  it("rejects scripts, launch actions and a missing %%EOF", () => {
    expect(() => checkPdf(enc(PDF.replace("/Catalog", "/Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>")))).toThrow(/scripts or attachments/);
    expect(() => checkPdf(enc(PDF.replace("/Catalog", "/Catalog /AA << /O << /S /Launch >> >>")))).toThrow(/scripts or attachments/);
    expect(() => checkPdf(enc(PDF.replace("/Catalog", "/Catalog /J#61vaScript")))).toThrow(/scripts or attachments/);
    expect(() => checkPdf(enc("%PDF-1.4\n1 0 obj << >> endobj\n"))).toThrow(/incomplete/);
    expect(() => checkPdf(enc("%PDF-9.9\n%%EOF"))).toThrow(/valid PDF/);
  });
  it("a PDF header that does not start at byte 0 is refused", () => {
    expect(rejectedFormat(enc(`junk${PDF}`))).toMatch(/damaged/);
    expect(sniffType(enc(`junk${PDF}`))).toBeNull();
  });
});

describe("processImage", () => {
  it("removes EXIF metadata", async () => {
    const input = await jpeg(400, 300, { exif: true });
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processImage(input, "image/jpeg");
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
  });
  it("auto-rotates using the EXIF orientation", async () => {
    const rotated = new Uint8Array(await sharp({ create: { width: 400, height: 200, channels: 3, background: "#888" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    const out = await processImage(rotated, "image/jpeg");
    expect([out.width, out.height]).toEqual([200, 400]);
  });
  it("caps the long edge at 2400 px", async () => {
    const out = await processImage(await jpeg(3600, 1800), "image/jpeg");
    expect(out.width).toBe(2400);
    expect(out.height).toBe(1200);
  });
  it("strips bytes appended after the image", async () => {
    const input = Buffer.concat([Buffer.from(await png(20, 20)), Buffer.from("<script>alert(1)</script>")]);
    const out = await processImage(new Uint8Array(input), "image/png");
    expect(out.bytes.toString("latin1")).not.toContain("<script");
  });
});

describe("file names", () => {
  it("sanitizes path traversal, unicode, quotes, CRLF and long names", () => {
    expect(sanitizeFilename("../../x.pdf")).toBe("x.pdf");
    expect(sanitizeFilename("C:\\evil\\cert.PDF")).toBe("cert.pdf");
    expect(sanitizeFilename("Assurance café.pdf")).toBe("Assurance-cafe.pdf");
    expect(sanitizeFilename('a"b\r\nc.png')).toBe("a-b-c.png");
    const long = sanitizeFilename(`${"x".repeat(200)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename("....pdf")).toBe("document.pdf");
  });
  it("maps extensions to declared types per kind", () => {
    expect(typeForFilename("a.JPEG", "image")).toBe("image/jpeg");
    expect(typeForFilename("a.webp", "image")).toBe("image/webp");
    expect(typeForFilename("a.webp", "document")).toBeNull();
    expect(typeForFilename("a.pdf", "image")).toBeNull();
    expect(typeForFilename("a.pdf", "document")).toBe("application/pdf");
    expect(typeForFilename("a.svg", "image")).toBeNull();
  });
});
