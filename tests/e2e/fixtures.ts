/** Upload fixtures built in memory, so no binary test files live in the repo. */
import sharp from "sharp";

export const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

export const photoJpeg = (colour = "#7a9cc6") => sharp({ create: { width: 1200, height: 800, channels: 3, background: colour } }).jpeg({ quality: 80 }).toBuffer();

export const pdf = (marker = "") => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n% ${marker}\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
export const PDF_WITH_JS = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const HTML_AS_PNG = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");

export function oversize(bytes: number, header: number[]) {
  const b = Buffer.alloc(bytes);
  Buffer.from(header).copy(b);
  return b;
}
export const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0];
