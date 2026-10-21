/**
 * Plain-English definitions of every dashboard number. They feed the
 * "How these numbers are calculated" panel and the tile hints, so the two always agree.
 */

export interface KpiDefinition {
  key: string;
  label: string;
  text: string;
  /** Explains a money figure: shown only to people who can see company financials. */
  money: boolean;
}

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  { key: "sales", label: "Sales", money: true, text: "The contract price of every job signed in the period, counted on the day the customer signed. Jobs cancelled later still count here, so past months never change; cancellations are shown separately." },
  { key: "jobsSold", label: "Jobs sold", money: false, text: "How many jobs were signed in the period, counted on the signing day." },
  { key: "averageSale", label: "Average sale", money: true, text: "Sales divided by jobs sold." },
  { key: "cancelled", label: "Cancelled after sale", money: false, text: "Signed jobs whose cancellation took effect in the period. Net sales is sales minus these." },
  { key: "produced", label: "Produced", money: true, text: "The contract price of every job finished in the period. A job counts as finished on its Finish date, set when it first moves to Complete, Invoiced or Job costed. You can change the Finish date on the project page." },
  { key: "jobsCompleted", label: "Jobs completed", money: false, text: "How many jobs were finished in the period." },
  { key: "backlog", label: "Backlog", money: false, text: "Jobs that are sold but not finished or cancelled, as of the end of the period (or right now for the current period). On-hold jobs are included." },
  { key: "backlogWeeks", label: "Weeks of work", money: true, text: "Backlog divided by the average weekly production over the 13 weeks before. Shows a dash if nothing was finished in that time." },
  { key: "grossMargin", label: "Gross margin (estimated)", money: true, text: "1 − estimated cost ÷ contract price, for jobs sold in the period. These are the estimate's numbers; actual job costs come later." },
  { key: "leads", label: "Leads in", money: false, text: "New leads created in the period, by source (where they heard of us) and channel (how they reached us). Leads lost with a reason you've marked as junk in Settings → Goals are left out." },
  { key: "visitsBooked", label: "Visits booked", money: false, text: "Estimate visits booked in the period, counted when the appointment was made, not when it happens." },
  { key: "visitsCompleted", label: "Visits completed", money: false, text: "Estimate visits that took place in the period. A visit counts as done when the lead moves to Estimate completed, Proposal sent or Won." },
  { key: "proposalsSent", label: "Proposals sent", money: false, text: "Estimates whose first proposal went out in the period. Re-sending a revised proposal doesn't count twice." },
  { key: "proposalsSentValue", label: "Proposals sent ($)", money: true, text: "For those estimates, the price of each one's latest proposal." },
  { key: "closeRate", label: "Close rate", money: false, text: "Of the leads that got a proposal and were won or lost in the period, the share that was won. Junk leads are left out." },
  { key: "closeRateValue", label: "Close rate by value", money: true, text: "The same leads, weighted by dollars: won value ÷ (won value + quoted value of the lost ones)." },
  { key: "salesCycle", label: "Sales cycle", money: false, text: "For jobs sold in the period, the typical number of days from the lead coming in to the customer signing (the middle value; the average is in the tile's tooltip)." },
  { key: "pipeline", label: "Pipeline now", money: false, text: "Right now, not for the period: proposals that are out and haven't expired on open leads, and open leads that haven't had a proposal yet (with their estimated value where entered)." },
  { key: "lostReasons", label: "Lost reasons", money: false, text: "Leads lost in the period, grouped by the reason recorded when they were marked lost. Junk leads appear here too." },
  { key: "salesperson", label: "By salesperson", money: false, text: "Each lead belongs to its assigned estimator, or else to whoever created its first estimate. Jobs and proposals follow their lead." },
  { key: "goals", label: "Goals", money: true, text: "The goal for a period adds up the monthly goals it covers, prorated by days. The pace marker shows how much of the goal should be done by today." },
  { key: "funnel", label: "Funnel", money: false, text: "Each step is counted on its own date in the period, so this shows activity, not the same group of leads moving through. The percentages compare each step to the one above it." },
];

export const DEFINITION_NOTES: readonly { text: string; money: boolean }[] = [
  { text: "All dollar amounts are before GST, so they read about 5% lower than totals that include tax.", money: false },
  { text: "Days run midnight to midnight, Vancouver time. A period that includes today counts all of today.", money: false },
  { text: "Comparisons show a dash when the earlier period starts before the first record in Grandview OS.", money: false },
];

export function definitionsFor(access: { money: boolean }): KpiDefinition[] {
  return KPI_DEFINITIONS.filter((k) => access.money || !k.money);
}

export function definitionText(key: string): string | undefined {
  return KPI_DEFINITIONS.find((k) => k.key === key)?.text;
}
