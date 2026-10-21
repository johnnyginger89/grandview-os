"use client";
import { ExternalLink, Plus, X } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { Button, Card, CardHeader, Field, FormError, Input, Select } from "@/components/ui";
import { diffDays, formatIsoDate, isIsoDate, type IsoDate } from "@/lib/calendar-date";
import { eachDay } from "@/lib/schedule/dates";
import { BC_STAT_HOLIDAYS_URL } from "@/lib/schedule/holidays";
import type { ScheduleSettings } from "@/lib/schedule/settings-schema";
import { saveScheduleSettingsAction, type SetupResult } from "./actions";

const WEEK = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
] as const;

const MAX_CLOSED_DAYS = 100;
const MAX_ADD_AT_ONCE = 31;

const dayText = (d: IsoDate) => formatIsoDate(d, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

type ClosedDay = ScheduleSettings["extraClosedDays"][number];

/** Work days, week start, holidays and the owner's extra closed days. */
export function CalendarPanel({
  settings,
  holidays,
}: {
  settings: ScheduleSettings;
  holidays: { year: number; days: { date: IsoDate; label: string }[] }[];
}) {
  const [workDays, setWorkDays] = useState<number[]>(settings.workDays);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(settings.weekStartsOn);
  const [holidayRegion, setHolidayRegion] = useState(settings.holidayRegion);
  const [span, setSpan] = useState(settings.defaultSpanDays);
  const [crewSize, setCrewSize] = useState(String(settings.defaultCrewSize));
  const [closed, setClosed] = useState<ClosedDay[]>(settings.extraClosedDays);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [pending, start] = useTransition();

  const edited = () => setResult(null);
  const toggleDay = (day: number, on: boolean) => {
    setWorkDays((cur) => (on ? [...new Set([...cur, day])] : cur.filter((d) => d !== day)));
    edited();
  };

  const addClosed = () => {
    const last = to || from;
    const label = reason.trim();
    if (!isIsoDate(from)) return setAddError("Pick the first closed day.");
    if (!isIsoDate(last)) return setAddError("Pick a valid last day, or leave it empty for one day.");
    if (last < from) return setAddError("The last day is before the first day.");
    if (diffDays(from, last) >= MAX_ADD_AT_ONCE) return setAddError(`Add at most ${MAX_ADD_AT_ONCE} days at a time.`);
    if (!label) return setAddError("Say why you're closed, e.g. Christmas shutdown.");
    const have = new Set(closed.map((c) => c.date));
    const added = eachDay(from, last).filter((d) => !have.has(d)).map((date) => ({ date, label: label.slice(0, 60) }));
    if (closed.length + added.length > MAX_CLOSED_DAYS) return setAddError(`You can list up to ${MAX_CLOSED_DAYS} closed days. Remove some old ones first.`);
    setClosed([...closed, ...added].sort((a, b) => (a.date < b.date ? -1 : 1)));
    setFrom("");
    setTo("");
    setReason("");
    setAddError(null);
    edited();
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const size = Number(crewSize);
    if (!workDays.length) return setResult({ ok: false, error: "Tick at least one work day." });
    if (!/^\d+$/.test(crewSize.trim()) || size < 1 || size > 20) return setResult({ ok: false, error: "Default crew size must be 1 to 20 people." });
    start(async () => {
      setResult(
        await saveScheduleSettingsAction({
          ...settings,
          workDays,
          weekStartsOn,
          holidayRegion,
          defaultSpanDays: span,
          defaultCrewSize: size,
          extraClosedDays: closed,
        }),
      );
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Calendar settings">
      <Card>
        <CardHeader title="Work week" description="Days that aren't work days are shaded on the calendar and skipped when working out how long a job takes." />
        <div className="space-y-4 p-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Work days</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {WEEK.map((w) => (
                <label key={w.day} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={workDays.includes(w.day)} onChange={(e) => toggleDay(w.day, e.target.checked)} />
                  {w.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-subtle">A crew can also be set to work Saturdays on the Crews tab.</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Week starts on">
              <Select value={weekStartsOn} onChange={(e) => { setWeekStartsOn(e.target.value === "0" ? 0 : 1); edited(); }}>
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </Select>
            </Field>
            <Field label="Calendar shows">
              <Select value={span} onChange={(e) => { setSpan(Number(e.target.value) as 7 | 14 | 28); edited(); }}>
                <option value={7}>1 week</option>
                <option value={14}>2 weeks</option>
                <option value={28}>4 weeks</option>
              </Select>
            </Field>
            <Field label="Default crew size" hint="Used to suggest how long a job takes before a crew is picked.">
              <Input type="number" inputMode="numeric" min={1} max={20} value={crewSize} onChange={(e) => { setCrewSize(e.target.value); edited(); }} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="BC statutory holidays"
          description="Worked out automatically every year."
          action={
            <a href={BC_STAT_HOLIDAYS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
              BC government list <ExternalLink className="size-3.5" aria-hidden />
            </a>
          }
        />
        <div className="space-y-4 p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={holidayRegion === "BC"} onChange={(e) => { setHolidayRegion(e.target.checked ? "BC" : "none"); edited(); }} />
            Skip BC statutory holidays
          </label>
          <div className={`grid gap-6 sm:grid-cols-2 ${holidayRegion === "BC" ? "" : "opacity-60"}`}>
            {holidays.map((y) => (
              <div key={y.year}>
                <h3 className="text-sm font-semibold">{y.year}</h3>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {y.days.map((h) => (
                    <li key={h.date} className="flex justify-between gap-3">
                      <span>{h.label}</span>
                      <span className="whitespace-nowrap text-muted">{formatIsoDate(h.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {holidayRegion !== "BC" && <p className="text-sm text-warning">Statutory holidays are not skipped. Turn this back on unless you work them.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Extra closed days" description="Company shutdowns and other days nobody works, e.g. between Christmas and New Year." />
        <div className="space-y-4 p-4">
          {closed.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul aria-label="Extra closed days" className="divide-y divide-border rounded-md border border-border">
              {closed.map((c) => (
                <li key={c.date} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span>
                    <span className="font-medium">{dayText(c.date)}</span> · {c.label}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2"
                    aria-label={`Remove ${dayText(c.date)}`}
                    onClick={() => {
                      setClosed(closed.filter((x) => x.date !== c.date));
                      edited();
                    }}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div
            className="grid items-end gap-3 rounded-md bg-surface-2 p-3 sm:grid-cols-[10rem_10rem_1fr_auto]"
            onKeyDown={(e) => {
              // Enter here adds the days instead of saving the whole calendar.
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
                addClosed();
              }
            }}
          >
            <Field label="First day">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Last day (optional)">
              <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Reason">
              <Input value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Christmas shutdown" />
            </Field>
            <Button variant="secondary" onClick={addClosed}>
              <Plus className="size-4" aria-hidden /> Add closed days
            </Button>
          </div>
          <FormError message={addError} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save calendar"}</Button>
        {result?.ok && <span role="status" className="text-sm text-success">{result.message}</span>}
      </div>
      {result && !result.ok && <FormError message={result.error} />}
    </form>
  );
}
