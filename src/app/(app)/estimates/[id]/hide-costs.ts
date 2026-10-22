"use client";
import { useSyncExternalStore } from "react";
import type { DocLine } from "@/lib/estimating/document";
import { UNIT_LABELS, type LineResult } from "@/lib/estimating/engine";
import { formatCAD, formatNum, formatPct } from "@/lib/money";
import type { MaterialOption } from "./editor-types";

const HIDE_KEY = "gv.estimate.hideCosts";
const HIDE_EVENT = "gv:hide-costs";

function readHide(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeHide(onChange: () => void) {
  window.addEventListener(HIDE_EVENT, onChange);
  return () => window.removeEventListener(HIDE_EVENT, onChange);
}

/**
 * "Hide costs" for when the customer is looking at the screen; remembered on this device.
 * Everything on the estimate page that shows a cost, margin or markup reads it, so the one
 * switch in Totals changes them all at once.
 */
export function useHideCosts(): [boolean, (v: boolean) => void] {
  // The server can't know this device's choice, so the first paint hides costs rather than flashing them.
  const hide = useSyncExternalStore(subscribeHide, readHide, () => true);
  return [
    hide,
    (v: boolean) => {
      try {
        localStorage.setItem(HIDE_KEY, v ? "1" : "0");
      } catch {
        // Storage blocked (private window): nothing to remember it in, so it stays as it was.
      }
      window.dispatchEvent(new Event(HIDE_EVENT));
    },
  ];
}

/** The rate note under a surface's details. The money in it (labour, paint, other, cost, margin) only with `costs`. */
export function costingNote(line: DocLine, r: LineResult, costs: boolean): string {
  const s = line.rateSnapshot;
  const unit = UNIT_LABELS[s.unit];
  const rate = `Rate: ${s.basis === "hours_per_unit" ? `${Number(s.productionRate)} h/${unit}` : `${Number(s.productionRate)} ${unit}/h`} (v${s.rateVersion ?? "–"})`;
  const paint = `Paint ${formatNum(r.gallons, 2)} gal`;
  if (!costs) return `${rate} · ${paint}`;
  return [rate, `Labour ${formatCAD(r.laborCost)} @ ${formatCAD(r.laborRate)}/h`, `${paint} ${formatCAD(r.materialCost)}`, `Other ${formatCAD(r.otherCost)}`, `Cost ${formatCAD(r.cost)}`, `Margin ${formatPct(r.margin)}`].join(" · ");
}

/** A paint product in the picker; its price per gallon only with `costs`. */
export function paintOptionLabel(m: MaterialOption, costs: boolean): string {
  return costs ? `${m.label} · ${formatCAD(m.snapshot.pricePerGallon)}/gal` : m.label;
}
