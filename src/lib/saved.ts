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

/**
 * Settings that should match across cars for a fair comparison, grouped as the user thinks of
 * them. Each group lists the assumption fields it covers and how to describe a value.
 */
interface SettingGroup {
  label: string;
  keys: (keyof Assumptions)[];
  describe: (a: Assumptions) => string;
}

const nf = (n: number) => new Intl.NumberFormat("fi-FI").format(n);
const pct = (n: number) => `${Math.round(n * 1000) / 10} %`;

export const SETTING_GROUPS: SettingGroup[] = [
  { label: "ownership period", keys: ["years"], describe: (a) => `${a.years} ${a.years === 1 ? "year" : "years"}` },
  { label: "km per year", keys: ["kmPerYear"], describe: (a) => `${nf(a.kmPerYear)} km/year` },
  { label: "expected return", keys: ["expectedReturn"], describe: (a) => pct(a.expectedReturn) },
  {
    label: "payment method",
    keys: ["financing", "downPayment", "loanInterestRate", "loanTermYears"],
    describe: (a) =>
      a.financing === "cash"
        ? "Lump sum"
        : `Financed, ${nf(a.downPayment)} € down, ${pct(a.loanInterestRate)}, ${a.loanTermYears} y`,
  },
  {
    label: "lost returns setting",
    keys: ["opportunityMode", "opportunityOn"],
    describe: (a) =>
      `${a.opportunityMode === "cost" ? "Counted as cost" : "Shown in chart"}${
        Object.values(a.opportunityOn).every(Boolean) ? "" : " (some payments off)"
      }`,
  },
];

/**
 * Settings that aren't car-specific: "match all settings" copies these. Price, consumption,
 * insurance, depreciation and maintenance rates stay with each car.
 */
export const SHARED_KEYS: (keyof Assumptions)[] = [
  ...SETTING_GROUPS.flatMap((g) => g.keys),
  "petrolPrice",
  "dieselPrice",
  "electricityPrice",
  "gasPrice",
  "realWorldFactor",
  "phevElectricShare",
  "inspectionCost",
  "alreadyInvested",
];

export interface SettingDifference {
  label: string;
  keys: (keyof Assumptions)[];
  /** One entry per distinct value, with the cars that use it. */
  options: { description: string; sourceId: string; titles: string[] }[];
}

/** Setting groups whose values differ between saved cars, with the values in use. */
export function settingDifferences(list: SavedCar[]): SettingDifference[] {
  if (list.length < 2) return [];
  const out: SettingDifference[] = [];
  for (const g of SETTING_GROUPS) {
    const byValue = new Map<string, { description: string; sourceId: string; titles: string[] }>();
    for (const s of list) {
      const sig = JSON.stringify(g.keys.map((k) => s.assumptions[k]));
      const entry = byValue.get(sig) ?? { description: g.describe(s.assumptions), sourceId: s.id, titles: [] };
      entry.titles.push(s.listing.title);
      byValue.set(sig, entry);
    }
    if (byValue.size > 1) out.push({ label: g.label, keys: g.keys, options: [...byValue.values()] });
  }
  return out;
}

/** Labels of the differing settings (kept for callers that only need the names). */
export function differingSettings(list: SavedCar[]): string[] {
  return settingDifferences(list).map((d) => d.label);
}

/** Copy the given settings from one saved car to all of them. */
export function harmonize(list: SavedCar[], sourceId: string, keys: (keyof Assumptions)[]): SavedCar[] {
  const source = list.find((s) => s.id === sourceId);
  if (!source) return list;
  const picked = Object.fromEntries(keys.map((k) => [k, structuredClone(source.assumptions[k])])) as Partial<Assumptions>;
  return list.map((s) => ({ ...s, assumptions: { ...s.assumptions, ...picked } }));
}

/** Settings editable for all saved cars at once. */
export const BULK_FIELDS = [
  { key: "years", label: "Period", unit: "years", step: 0.5 },
  { key: "kmPerYear", label: "Driving", unit: "km/year", step: 1000 },
  { key: "petrolPrice", label: "Petrol", unit: "€/l", step: 0.01 },
  { key: "dieselPrice", label: "Diesel", unit: "€/l", step: 0.01 },
  { key: "electricityPrice", label: "Electricity", unit: "€/kWh", step: 0.01 },
] as const;

export type BulkKey = (typeof BULK_FIELDS)[number]["key"];

/** Set the given settings on every saved car; other settings are left alone. */
export function setForAll(list: SavedCar[], patch: Partial<Pick<Assumptions, BulkKey>>): SavedCar[] {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "number" && v > 0));
  return list.map((s) => ({ ...s, assumptions: { ...s.assumptions, ...clean } }));
}

/** The shared value of a setting across saved cars, or null when they differ. */
export function commonValue(list: SavedCar[], key: BulkKey): number | null {
  const values = new Set(list.map((s) => s.assumptions[key]));
  return values.size === 1 ? [...values][0] : null;
}
