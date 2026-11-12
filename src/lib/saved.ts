/**
 * Saved calculations, kept in the browser (localStorage) on this device.
 *
 * Only inputs are stored; results are recalculated when shown, so saved cars benefit from
 * later fixes to the cost model and always compare on the same basis.
 */
import type { Listing } from "./listing";
import { type Assumptions, type CarInputs, defaultAssumptions } from "./tco";

export interface SavedCar {
  id: string;
  savedAt: string; // ISO timestamp
  listing: Listing;
  car: CarInputs;
  assumptions: Assumptions;
}

const KEY = "cartco.saved.v1";

/** Fill in fields added after a car was saved, so old saves keep working. */
function upgrade(s: SavedCar): SavedCar {
  const defaults = defaultAssumptions(s.car.powertrain);
  // Insurance used to be one setting for all cars (default 600). A changed value was the
  // user's own figure, so keep it as this car's quote.
  const { insurancePerYear: legacyInsurance, ...assumptions } = (s.assumptions ?? {}) as Assumptions & {
    insurancePerYear?: number;
  };
  return {
    ...s,
    car: {
      ...s.car,
      vehicleTaxOverride: s.car.vehicleTaxOverride ?? null,
      powerKw: s.car.powerKw ?? s.listing.powerKw ?? null,
      curbMassKg: s.car.curbMassKg ?? s.listing.curbMassKg ?? null,
      insuranceOverride:
        s.car.insuranceOverride ?? (legacyInsurance !== undefined && legacyInsurance !== 600 ? legacyInsurance : null),
    },
    assumptions: {
      ...defaults,
      ...assumptions,
      opportunityOn: { ...defaults.opportunityOn, ...assumptions.opportunityOn },
    },
  };
}

export function loadSaved(): SavedCar[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((s) => s?.id && s.listing && s.car).map(upgrade) : [];
  } catch {
    return [];
  }
}

/** Returns false if the browser refused to store (private mode, storage full). */
export function storeSaved(list: SavedCar[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert or replace by id, newest first. */
export function upsert(list: SavedCar[], item: SavedCar): SavedCar[] {
  return [item, ...list.filter((s) => s.id !== item.id)];
}

/** Settings that make totals incomparable when they differ between saved cars. */
export function differingSettings(list: SavedCar[]): string[] {
  if (list.length < 2) return [];
  const checks: [string, (a: Assumptions) => string | number][] = [
    ["ownership period", (a) => a.years],
    ["km per year", (a) => a.kmPerYear],
    ["expected return", (a) => a.expectedReturn],
    ["payment method", (a) => a.financing],
    ["lost returns setting", (a) => a.opportunityMode],
  ];
  return checks.filter(([, f]) => new Set(list.map((s) => f(s.assumptions))).size > 1).map(([label]) => label);
}
