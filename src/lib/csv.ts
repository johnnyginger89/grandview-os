/**
 * Small RFC 4180 CSV reader for spreadsheet exports (Markate, monday, PaintScout…).
 * Handles quoted fields with commas, quotes and line breaks, CRLF, a UTF-8 BOM,
 * and comma / semicolon / tab delimiters.
 */
export interface CsvTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

/** Bytes → text. Excel on Windows often saves Windows-1252 rather than UTF-8. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

export function parseCsv(input: string, opts: { maxRows?: number } = {}): CsvTable {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const max = opts.maxRows ?? Infinity;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length && rows.length <= max) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] !== "\n") endRow();
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length) endRow();

  const [head = [], ...body] = rows;
  const headers = head.map((h, k) => h.trim() || `Column ${k + 1}`);
  // Pad or trim every row to the header width so columns line up.
  return { headers, rows: body.map((r) => headers.map((_, k) => (r[k] ?? "").trim())), delimiter };
}
