/**
 * Car-free alternatives shown next to saved cars: public transport and cycling.
 *
 * They're priced as monthly outflows over the same period and km as the cars, and get the same
 * lost-returns treatment as a car's running costs, so totals compare like for like.
 */
import { type Assumptions, simulateOwnership } from "./tco";

export type AlternativeKind = "transit" | "bike";

export interface AlternativeSettings {
  transit: { on: boolean; pricePer30Days: number };
  bike: { on: boolean; perMonth: number };
}

export const DEFAULT_ALTERNATIVES: AlternativeSettings = {
  // Season ticket (kausilippu), 30 days, bought as a one-off purchase.
  transit: { on: true, pricePer30Days: 110.4 },
  // Bike, maintenance, gear and the odd repair.
  bike: { on: true, perMonth: 50 },
};

export const ALTERNATIVE_LABELS: Record<AlternativeKind, { title: string; detail: string }> = {
  transit: { title: "Public transport", detail: "30-day season ticket" },
  bike: { title: "Cycling", detail: "Bike & upkeep" },
};

export interface AlternativeResult {
  kind: AlternativeKind;
  perYear: number;
  /** Ticket or bike costs over the period, without lost returns. */
  spend: number;
  lostReturns: number;
  /** Total, including lost returns when they're counted as a cost. */
  total: number;
  perMonth: number;
  perKm: number;
}

export function alternativePerYear(kind: AlternativeKind, s: AlternativeSettings): number {
  return kind === "transit" ? (s.transit.pricePer30Days * 365) / 30 : s.bike.perMonth * 12;
}

/** Cost of an alternative over the ownership period and km of `a`. */
export function computeAlternative(kind: AlternativeKind, s: AlternativeSettings, a: Assumptions): AlternativeResult {
  const years = Math.max(0.1, a.years);
  const months = Math.max(1, Math.round(years * 12));
  const perYear = alternativePerYear(kind, s);
  const spend = perYear * years;
  // Same treatment as a car's running costs: monthly payments that could have been invested.
  const sim = simulateOwnership(0, { ...a, financing: "cash" }, "cash", months, spend / months, 0);
  const lostReturns = sim.opportunityCost;
  const total = spend + (a.opportunityMode === "cost" ? lostReturns : 0);
  const km = a.kmPerYear * years;
  return { kind, perYear, spend, lostReturns, total, perMonth: total / (years * 12), perKm: km > 0 ? total / km : 0 };
}

const KEY = "cartco.alternatives.v1";

export function loadAlternatives(): AlternativeSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return {
      transit: { ...DEFAULT_ALTERNATIVES.transit, ...raw?.transit },
      bike: { ...DEFAULT_ALTERNATIVES.bike, ...raw?.bike },
    };
  } catch {
    return DEFAULT_ALTERNATIVES;
  }
}

export function storeAlternatives(s: AlternativeSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings just won't persist */
  }
}
