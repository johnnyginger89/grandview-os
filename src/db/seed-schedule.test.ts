import { describe, expect, it } from "vitest";
import { MESSAGE_TEMPLATES } from "./seed-data";
import { SCHEDULE_MESSAGE_TEMPLATES } from "./seed-schedule";

const VARIABLES = new Set(["first_name", "project_name", "start_week", "start_date", "end_date", "duration", "previous_start_date", "company_phone", "sender_name"]);
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);

describe("start notice templates", () => {
  it("adds four new email templates with unique keys", () => {
    const keys = [...MESSAGE_TEMPLATES, ...SCHEDULE_MESSAGE_TEMPLATES].map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SCHEDULE_MESSAGE_TEMPLATES.every((t) => t.channel === "email" && t.subject && t.body && t.name)).toBe(true);
  });

  it("only uses variables the notice composer fills", () => {
    for (const t of SCHEDULE_MESSAGE_TEMPLATES) for (const v of vars(`${t.subject} ${t.body}`)) expect(VARIABLES.has(v), `${t.key}: ${v}`).toBe(true);
  });

  it("keeps subjects on one line and money out of customer text", () => {
    for (const t of SCHEDULE_MESSAGE_TEMPLATES) {
      expect(t.subject).not.toMatch(/[\r\n]/);
      expect(`${t.subject}${t.body}`).not.toContain("$");
    }
  });

  it("adds the weather paragraph to the exterior start-week email only", () => {
    const [interior, exterior] = SCHEDULE_MESSAGE_TEMPLATES;
    expect(exterior.body).toContain("depends on the weather");
    expect(interior.body).not.toContain("weather");
    expect(exterior.body.replace(/\nExterior painting[^\n]*\n/, "")).toBe(interior.body);
  });
});
