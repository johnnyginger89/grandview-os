/** Owner-written plain text → paragraphs and bullet lists. Never HTML. */
export type Block = { type: "p"; text: string } | { type: "ul"; items: string[] };

const BULLET = /^\s*(?:-|•|\*)\s+/;

export function parseProse(text: string | null | undefined): Block[] {
  if (!text) return [];
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: "ul", items: list });
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (BULLET.test(line)) {
      flushPara();
      const item = line.replace(BULLET, "").trim();
      if (item) list.push(item);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** One entry per non-empty line, with any leading bullet marker removed. */
export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(BULLET, "").trim())
    .filter(Boolean);
}
