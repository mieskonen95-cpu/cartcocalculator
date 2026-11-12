"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ALTERNATIVE_LABELS,
  type AlternativeKind,
  type AlternativeSettings,
  computeAlternative,
  DEFAULT_ALTERNATIVES,
  loadAlternatives,
  storeAlternatives,
} from "@/lib/alternatives";
import type { Powertrain } from "@/lib/listing";
import {
  BULK_FIELDS,
  type BulkKey,
  commonValue,
  harmonize,
  type SavedCar,
  setForAll,
  settingDifferences,
  SHARED_KEYS,
} from "@/lib/saved";
import { computeTco, type CostLine, defaultAssumptions, depreciationRateFor, type TcoResult } from "@/lib/tco";

export const COST_COLORS: Record<CostLine["key"], string> = {
  depreciation: "bg-indigo-500",
  energy: "bg-amber-500",
  tax: "bg-rose-500",
  insurance: "bg-sky-500",
  maintenance: "bg-emerald-500",
  inspections: "bg-violet-500",
  interest: "bg-slate-500",
  opportunity: "bg-teal-500",
};
/** Ticket or bike costs, and extra taxi rides: the alternatives' spend. */
const TRANSPORT_COLOR = "bg-lime-600";
const RIDES_COLOR = "bg-pink-500";

const COST_LABELS: Record<CostLine["key"], string> = {
  depreciation: "Depreciation",
  energy: "Fuel / electricity",
  tax: "Vehicle tax",
  insurance: "Insurance",
  maintenance: "Maintenance & repairs",
  inspections: "Inspections",
  interest: "Loan interest",
  opportunity: "Lost returns",
};

const POWERTRAIN_SHORT: Record<Powertrain, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  electric: "Electric",
  "hybrid-petrol": "Hybrid",
  "hybrid-diesel": "Diesel hybrid",
  "phev-petrol": "Plug-in hybrid",
  "phev-diesel": "Plug-in diesel hybrid",
  gas: "Gas",
  other: "Other",
};

const eur = (n: number, digits = 0) =>
  new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const int = (n: number) => new Intl.NumberFormat("fi-FI").format(Math.round(n));

type SegmentKey = CostLine["key"] | "transport" | "rides";

/** One column of the comparison: a saved car or a car-free alternative. */
interface Column {
  id: string;
  title: string;
  alternative: boolean;
  total: number;
  perMonth: number;
  perKm: number;
  /** Bar segments and table rows. `transport` is the alternatives' ticket/bike spend. */
  costs: Partial<Record<SegmentKey, number>>;
  info: { price: string; type: string; yearKm: string; ownership: string; payment: string };
  insuranceEstimated?: boolean;
  insuranceHighPower?: boolean;
  saved?: SavedCar;
  r?: TcoResult;
}

export function SavedComparison({
  saved,
  currentId,
  onOpen,
  onRemove,
  onUpdateAll,
}: {
  saved: SavedCar[];
  currentId: string | null;
  onOpen: (s: SavedCar) => void;
  onRemove: (id: string) => void;
  /** Replace every saved car at once (used when harmonizing settings). */
  onUpdateAll: (list: SavedCar[]) => void;
}) {
  const [matchTo, setMatchTo] = useState<string>("");
  const [bulk, setBulk] = useState<Partial<Record<BulkKey, number>>>({});
  const [alts, setAlts] = useState<AlternativeSettings>(DEFAULT_ALTERNATIVES);
  useEffect(() => setAlts(loadAlternatives()), []);
  const updateAlts = (next: AlternativeSettings) => {
    setAlts(next);
    storeAlternatives(next);
  };

  // Alternatives use the period and km of the most recently saved car.
  const reference = saved[0]?.assumptions;

  const columns: Column[] = useMemo(() => {
    const cars: Column[] = saved.map((s) => {
      const r = computeTco(s.car, s.assumptions);
      return {
        id: s.id,
        title: s.listing.title,
        alternative: false,
        total: r.total,
        perMonth: r.perMonth,
        perKm: r.perKm,
        costs: Object.fromEntries(r.lines.map((l) => [l.key, l.total])),
        info: {
          price: eur(s.car.price),
          type: POWERTRAIN_SHORT[s.car.powertrain],
          yearKm: [s.car.modelYear, s.listing.mileageKm !== null && `${int(s.listing.mileageKm)} km`].filter(Boolean).join(" · ") || "—",
          ownership: `${s.assumptions.years} y · ${int(s.assumptions.kmPerYear)} km/y`,
          payment: s.assumptions.financing === "loan" ? `Financed, ${eur(r.financing.equity)} down` : "Lump sum",
        },
        insuranceEstimated: !r.insurance.fromQuote,
        insuranceHighPower: r.insurance.insuranceClass === "high-power",
        saved: s,
        r,
      };
    });
    if (!reference) return cars;
    const alternatives: Column[] = (["transit", "bike"] as AlternativeKind[])
      .filter((k) => alts[k].on)
      .map((k) => {
        const r = computeAlternative(k, alts, reference);
        return {
          id: `alt-${k}`,
          title: ALTERNATIVE_LABELS[k].title,
          alternative: true,
          total: r.total,
          perMonth: r.perMonth,
          perKm: r.perKm,
          costs: {
            transport: r.spend - r.rides,
            ...(k === "transit" ? { rides: r.rides } : {}),
            ...(reference.opportunityMode === "cost" ? { opportunity: r.lostReturns } : {}),
          },
          info: {
            price: "—",
            type: ALTERNATIVE_LABELS[k].detail,
            yearKm: "—",
            ownership: `${reference.years} y · ${int(reference.kmPerYear)} km/y`,
            payment:
              k === "transit"
                ? `${eur(alts.transit.pricePer30Days, 2)} / 30 days + ${alts.transit.ridesPerMonth} × ${eur(alts.transit.pricePerRide)} rides / month`
                : `${eur(alts.bike.perMonth)} / month`,
          },
        };
      });
    return [...cars, ...alternatives];
  }, [saved, alts, reference]);

  const cheapest = columns.length > 1 ? Math.min(...columns.map((c) => c.total)) : null;
  const maxTotal = Math.max(...columns.map((c) => c.total), 1);
  const differences = settingDifferences(saved);
  const shortTitle = (t: string) => (t.length > 32 ? `${t.slice(0, 30).trimEnd()}…` : t);
  const keys = Object.keys(COST_LABELS) as CostLine["key"][];
  const anyAlt = columns.some((c) => c.alternative);
  const anyRides = columns.some((c) => (c.costs.rides ?? 0) > 0);
  const segments: [SegmentKey, string][] = [
    ...(anyAlt ? [["transport", TRANSPORT_COLOR] as [SegmentKey, string]] : []),
    ...(anyRides ? [["rides", RIDES_COLOR] as [SegmentKey, string]] : []),
    ...keys.map((k) => [k, COST_COLORS[k]] as [SegmentKey, string]),
  ];
  const update = (target: SavedCar, fn: (s: SavedCar) => SavedCar) =>
    onUpdateAll(saved.map((x) => (x.id === target.id ? fn(x) : x)));
  const setCarFields = (s: SavedCar, patch: Partial<SavedCar["car"]>): SavedCar => ({ ...s, car: { ...s.car, ...patch } });
  const setAssumptionFields = (s: SavedCar, patch: Partial<SavedCar["assumptions"]>): SavedCar => ({
    ...s,
    assumptions: { ...s.assumptions, ...patch },
  });
  const km = (s: SavedCar) => Math.max(1, s.assumptions.kmPerYear * s.assumptions.years);

  /** Turn an edited cost total (over the period) into the setting that produces it. */
  function applyCostEdit(s: SavedCar, k: SegmentKey, v: number): SavedCar {
    const years = Math.max(0.1, s.assumptions.years);
    switch (k) {
      case "depreciation":
        return setAssumptionFields(s, { depreciationRate: depreciationRateFor(s.car.price, v, years) });
      case "energy":
        return setCarFields(s, { energyPerKmOverride: v / km(s) });
      case "maintenance":
        return setCarFields(s, { maintenancePerKmOverride: v / km(s) });
      case "tax":
        return setCarFields(s, { vehicleTaxOverride: v / years });
      case "insurance":
        return setCarFields(s, { insuranceOverride: v / years });
      case "inspections":
        return setCarFields(s, { inspectionsPerYearOverride: v / years });
      default:
        return s;
    }
  }
  function resetCost(s: SavedCar, k: SegmentKey): SavedCar {
    switch (k) {
      case "depreciation":
        return setAssumptionFields(s, { depreciationRate: defaultAssumptions(s.car.powertrain).depreciationRate });
      case "energy":
        return setCarFields(s, { energyPerKmOverride: null });
      case "maintenance":
        return setCarFields(s, { maintenancePerKmOverride: null });
      case "tax":
        return setCarFields(s, { vehicleTaxOverride: null });
      case "insurance":
        return setCarFields(s, { insuranceOverride: null });
      case "inspections":
        return setCarFields(s, { inspectionsPerYearOverride: null });
      default:
        return s;
    }
  }
  function costEdited(s: SavedCar, k: SegmentKey): boolean {
    switch (k) {
      case "depreciation":
        return Math.abs(s.assumptions.depreciationRate - defaultAssumptions(s.car.powertrain).depreciationRate) > 1e-9;
      case "energy":
        return s.car.energyPerKmOverride !== null;
      case "maintenance":
        return s.car.maintenancePerKmOverride !== null;
      case "tax":
        return s.car.vehicleTaxOverride !== null;
      case "insurance":
        return s.car.insuranceOverride !== null;
      case "inspections":
        return s.car.inspectionsPerYearOverride !== null;
      default:
        return false;
    }
  }

  const inputRows: [string, (c: Column) => React.ReactNode][] = [
    [
      "Price",
      (c) =>
        c.saved ? (
          <EditableNumber
            value={c.saved.car.price}
            display={eur(c.saved.car.price)}
            label={`Price, ${c.title}`}
            onCommit={(v) => update(c.saved!, (s) => setCarFields(s, { price: Math.max(0, v) }))}
          />
        ) : (
          "—"
        ),
    ],
    [
      "Type",
      (c) =>
        c.saved ? (
          <select
            aria-label={`Type, ${c.title}`}
            value={c.saved.car.powertrain}
            onChange={(e) => update(c.saved!, (s) => setCarFields(s, { powertrain: e.target.value as Powertrain }))}
            className="max-w-full rounded border border-transparent bg-transparent py-0.5 hover:border-zinc-300 dark:hover:border-zinc-700"
          >
            {(Object.keys(POWERTRAIN_SHORT) as Powertrain[]).map((p) => (
              <option key={p} value={p}>
                {POWERTRAIN_SHORT[p]}
              </option>
            ))}
          </select>
        ) : (
          c.info.type
        ),
    ],
    [
      "Year",
      (c) =>
        c.saved ? (
          <EditableNumber
            value={c.saved.car.modelYear ?? 0}
            display={c.saved.car.modelYear ? String(c.saved.car.modelYear) : "—"}
            label={`Model year, ${c.title}`}
            onCommit={(v) => update(c.saved!, (s) => setCarFields(s, { modelYear: v > 1900 ? Math.round(v) : null }))}
          />
        ) : (
          "—"
        ),
    ],
    [
      "Mileage",
      (c) =>
        c.saved ? (
          <EditableNumber
            value={c.saved.listing.mileageKm ?? 0}
            display={c.saved.listing.mileageKm !== null ? `${int(c.saved.listing.mileageKm)} km` : "—"}
            label={`Mileage, ${c.title}`}
            onCommit={(v) => update(c.saved!, (s) => ({ ...s, listing: { ...s.listing, mileageKm: Math.max(0, Math.round(v)) } }))}
          />
        ) : (
          "—"
        ),
    ],
    [
      "Period",
      (c) =>
        c.saved ? (
          <EditableNumber
            value={c.saved.assumptions.years}
            display={`${c.saved.assumptions.years} y`}
            step={0.5}
            label={`Ownership period, ${c.title}`}
            onCommit={(v) => update(c.saved!, (s) => setAssumptionFields(s, { years: Math.max(0.5, v) }))}
          />
        ) : (
          `${reference?.years ?? "—"} y`
        ),
    ],
    [
      "Driving",
      (c) =>
        c.saved ? (
          <EditableNumber
            value={c.saved.assumptions.kmPerYear}
            display={`${int(c.saved.assumptions.kmPerYear)} km/y`}
            step={1000}
            label={`Km per year, ${c.title}`}
            onCommit={(v) => update(c.saved!, (s) => setAssumptionFields(s, { kmPerYear: Math.max(0, Math.round(v)) }))}
          />
        ) : (
          `${int(reference?.kmPerYear ?? 0)} km/y`
        ),
    ],
    [
      "Payment",
      (c) =>
        c.saved ? (
          <select
            aria-label={`Payment, ${c.title}`}
            value={c.saved.assumptions.financing}
            onChange={(e) => update(c.saved!, (s) => setAssumptionFields(s, { financing: e.target.value as "cash" | "loan" }))}
            className="max-w-full rounded border border-transparent bg-transparent py-0.5 hover:border-zinc-300 dark:hover:border-zinc-700"
          >
            <option value="cash">Lump sum</option>
            <option value="loan">Financed</option>
          </select>
        ) : (
          c.info.payment
        ),
    ],
    [
      "Down payment",
      (c) =>
        c.saved && c.saved.assumptions.financing === "loan" ? (
          <EditableNumber
            value={c.saved.assumptions.downPayment}
            display={`${eur(c.r!.financing.equity)} · ${Math.round(c.saved.assumptions.loanInterestRate * 1000) / 10} %`}
            step={500}
            label={`Down payment, ${c.title}`}
            onCommit={(v) => update(c.saved!, (s) => setAssumptionFields(s, { downPayment: Math.max(0, v) }))}
          />
        ) : (
          "—"
        ),
    ],
  ];

  const segmentLabel = (k: SegmentKey) =>
    k === "transport" ? "Ticket / bike" : k === "rides" ? "Taxi rides (Uber, Bolt)" : COST_LABELS[k];

  return (
    <section className="mt-10 min-w-0 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="font-medium">Saved cars ({saved.length})</h2>
      <p className="mt-0.5 text-sm text-zinc-500">Stored in this browser on this device. Click any underlined value in the table to change it; edited costs can be
        reset with ↺. Open loads a car into the calculator above.</p>

      {differences.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p>
            These cars were saved with different {differences.map((d) => d.label).join(", ")}, so their totals aren&apos;t
            directly comparable. Pick one value to use for all:
          </p>
          <ul className="mt-2 space-y-2">
            {differences.map((d) => (
              <li key={d.label} className="flex flex-wrap items-center gap-2">
                <span className="w-full font-medium first-letter:uppercase sm:w-40">{d.label}</span>
                {d.options.map((o) => (
                  <button
                    key={o.sourceId}
                    type="button"
                    onClick={() => onUpdateAll(harmonize(saved, o.sourceId, d.keys))}
                    title={`Used by: ${o.titles.join(", ")}`}
                    className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-left hover:border-amber-500 dark:border-amber-800 dark:bg-zinc-900"
                  >
                    {o.description}
                    <span className="block text-xs text-amber-800/80 dark:text-amber-300/80">
                      {o.titles.length === 1 ? shortTitle(o.titles[0]) : `${o.titles.length} cars`}
                    </span>
                  </button>
                ))}
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-200 pt-3 dark:border-amber-900"
            onSubmit={(e) => {
              e.preventDefault();
              if (matchTo) onUpdateAll(harmonize(saved, matchTo, SHARED_KEYS));
            }}
          >
            <label htmlFor="match-to">Or match all settings to</label>
            <select
              id="match-to"
              value={matchTo}
              onChange={(e) => setMatchTo(e.target.value)}
              className="max-w-full rounded-md border border-amber-300 bg-white px-2 py-1 dark:border-amber-800 dark:bg-zinc-900"
            >
              <option value="">Choose a car…</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {shortTitle(s.listing.title)}
                </option>
              ))}
            </select>
            <button
              disabled={!matchTo}
              className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Apply
            </button>
            <span className="w-full text-xs text-amber-800/80 dark:text-amber-300/80">
              Copies period, km, payment, expected return, lost-returns and fuel/electricity prices. Each car keeps its own
              price, consumption, insurance, depreciation and maintenance.
            </span>
          </form>
        </div>
      )}

      {saved.length > 0 && (
        <form
          className="mt-4 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault();
            onUpdateAll(setForAll(saved, bulk));
            setBulk({});
          }}
        >
          <p className="font-medium">Settings for all cars</p>
          <p className="text-xs text-zinc-500">Fill in what you want to change; empty fields stay as they are.</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            {BULK_FIELDS.map((f) => {
              const common = commonValue(saved, f.key);
              return (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500">{f.label}</span>
                  <span className="flex items-center rounded-md border border-zinc-300 bg-white focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
                    <input
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      min={0}
                      aria-label={`${f.label} for all cars`}
                      placeholder={common === null ? "mixed" : String(common)}
                      value={bulk[f.key] ?? ""}
                      onChange={(e) =>
                        setBulk((b) => ({ ...b, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))
                      }
                      className="w-20 bg-transparent px-2 py-1 text-right tabular-nums outline-none"
                    />
                    <span className="pr-2 text-xs text-zinc-500">{f.unit}</span>
                  </span>
                </label>
              );
            })}
            <button
              disabled={!Object.values(bulk).some((v) => v !== undefined && v > 0)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Apply to all
            </button>
          </div>
        </form>
      )}

      {/* Car-free alternatives */}
      <fieldset className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <legend className="sr-only">Compare with</legend>
        <span className="text-zinc-500">Compare with:</span>
        <label className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            checked={alts.transit.on}
            onChange={(e) => updateAlts({ ...alts, transit: { ...alts.transit, on: e.target.checked } })}
            className="h-4 w-4 accent-indigo-600"
          />
          Public transport
          <MiniNum
            value={alts.transit.pricePer30Days}
            step={0.1}
            unit="€ / 30 days"
            label="Season ticket price per 30 days"
            onChange={(v) => updateAlts({ ...alts, transit: { ...alts.transit, pricePer30Days: v } })}
          />
          <span className="text-zinc-500">+</span>
          <MiniNum
            value={alts.transit.ridesPerMonth}
            step={1}
            unit="rides / mo"
            label="Extra Uber or Bolt rides per month"
            onChange={(v) => updateAlts({ ...alts, transit: { ...alts.transit, ridesPerMonth: v } })}
          />
          <span className="text-zinc-500">×</span>
          <MiniNum
            value={alts.transit.pricePerRide}
            step={1}
            unit="€ / ride"
            label="Price per Uber or Bolt ride"
            onChange={(v) => updateAlts({ ...alts, transit: { ...alts.transit, pricePerRide: v } })}
          />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            checked={alts.bike.on}
            onChange={(e) => updateAlts({ ...alts, bike: { ...alts.bike, on: e.target.checked } })}
            className="h-4 w-4 accent-indigo-600"
          />
          Cycling
          <MiniNum
            value={alts.bike.perMonth}
            step={5}
            unit="€ / month"
            label="Cycling cost per month"
            onChange={(v) => updateAlts({ ...alts, bike: { ...alts.bike, perMonth: v } })}
          />
        </label>
      </fieldset>
      {anyAlt && reference && (
        <p className="mt-1 text-xs text-zinc-500">
          Over {reference.years} years (same as the most recently saved car), with lost returns on the monthly payments like a
          car&apos;s running costs.
        </p>
      )}

      {/* Stacked cost bars: one per option, same scale. */}
      <ul className="mt-5 space-y-3">
        {columns.map((c) => (
          <li key={c.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={`min-w-0 truncate ${c.alternative ? "italic" : ""}`}>{c.title}</span>
              <span className="shrink-0 tabular-nums">
                {c.total === cheapest && <span className="mr-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">Cheapest</span>}
                <strong>{eur(c.total)}</strong>
              </span>
            </div>
            <div className="mt-1 flex h-3 gap-[2px] overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" style={{ width: `${(100 * c.total) / maxTotal}%` }}>
              {segments.map(([k, color]) => {
                const v = c.costs[k] ?? 0;
                return v > 0 ? <div key={k} title={`${segmentLabel(k)}: ${eur(v)}`} className={color} style={{ width: `${(100 * v) / c.total}%` }} /> : null;
              })}
            </div>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {segments.map(([k, color]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
            {segmentLabel(k)}
          </li>
        ))}
      </ul>

      {/* Side-by-side table; scrolls sideways when there are many options. */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--background)] py-2 pr-3" />
              {columns.map((c) => (
                <th
                  key={c.id}
                  className={`min-w-36 border-b border-zinc-200 px-3 py-2 text-left align-top font-medium dark:border-zinc-800 ${
                    c.alternative ? "bg-zinc-50 dark:bg-zinc-900" : ""
                  }`}
                >
                  <span className="line-clamp-3">{c.title}</span>
                  {c.alternative && <span className="mt-1 block text-xs font-normal text-zinc-500">No car</span>}
                  {c.saved && c.id === currentId && (
                    <span className="mt-1 block text-xs font-normal text-indigo-600 dark:text-indigo-400">Open above</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inputRows.map(([label, render]) => (
              <tr key={label}>
                <td className="sticky left-0 bg-[var(--background)] py-2 pr-3 text-zinc-500">{label}</td>
                {columns.map((c) => (
                  <Cell key={c.id} alt={c.alternative}>
                    {render(c)}
                  </Cell>
                ))}
              </tr>
            ))}
            {(
              [
                ["Total cost", (c) => eur(c.total), true],
                ["Per month", (c) => eur(c.perMonth), false],
                ["Per km", (c) => eur(c.perKm, 2), false],
              ] as [string, (c: Column) => string, boolean][]
            ).map(([label, f, bold]) => (
              <tr key={label} className={bold ? "font-semibold" : ""}>
                <td className="sticky left-0 bg-[var(--background)] py-2 pr-3">{label}</td>
                {columns.map((c) => (
                  <Cell key={c.id} alt={c.alternative}>
                    {f(c)}
                    {bold && c.total === cheapest && (
                      <span className="ml-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ cheapest</span>
                    )}
                  </Cell>
                ))}
              </tr>
            ))}
            {segments.map(([k, color]) => (
              <tr key={k}>
                <td className="sticky left-0 bg-[var(--background)] py-1.5 pr-3 text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
                    {segmentLabel(k)}
                  </span>
                </td>
                {columns.map((c) => (
                  <Cell key={c.id} alt={c.alternative} muted>
                    {c.costs[k] === undefined ? (
                      "—"
                    ) : c.saved && isEditableCost(k) ? (
                      <EditableNumber
                        value={c.costs[k]!}
                        display={`${k === "insurance" && c.insuranceEstimated ? "≈ " : ""}${eur(c.costs[k]!)}`}
                        label={`${segmentLabel(k)}, ${c.title}`}
                        edited={costEdited(c.saved, k)}
                        onCommit={(v) => update(c.saved!, (s) => applyCostEdit(s, k, v))}
                        onReset={() => update(c.saved!, (s) => resetCost(s, k))}
                        suffix={
                          k === "insurance" && c.insuranceEstimated && c.insuranceHighPower ? (
                            <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">get quote</span>
                          ) : null
                        }
                      />
                    ) : (
                      <span title={k === "interest" || k === "opportunity" ? "Calculated: change it via payment and returns settings" : undefined}>
                        {eur(c.costs[k]!)}
                      </span>
                    )}
                  </Cell>
                ))}
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 bg-[var(--background)]" />
              {columns.map((c) => (
                <td key={c.id} className={`px-3 pt-3 ${c.alternative ? "bg-zinc-50 dark:bg-zinc-900" : ""}`}>
                  {c.saved && (
                    <div className="flex gap-3">
                      <button type="button" onClick={() => onOpen(c.saved!)} className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400">
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Remove ${c.title} from saved cars?`)) onRemove(c.id);
                        }}
                        className="text-zinc-500 underline hover:text-rose-600"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

const EDITABLE_COSTS: SegmentKey[] = ["depreciation", "energy", "tax", "insurance", "maintenance", "inspections"];
function isEditableCost(k: SegmentKey): boolean {
  return EDITABLE_COSTS.includes(k);
}

/** A value that turns into a number field when clicked. Enter or leaving the field saves; Esc cancels. */
function EditableNumber({
  value,
  display,
  label,
  onCommit,
  onReset,
  edited,
  step = 1,
  suffix,
}: {
  value: number;
  display: string;
  label: string;
  onCommit: (v: number) => void;
  onReset?: () => void;
  edited?: boolean;
  step?: number;
  suffix?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onCommit(Number(draft));
    setDraft(null);
  };
  if (draft !== null) {
    return (
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        step={step}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        className="w-24 rounded border border-indigo-500 bg-white px-1.5 py-0.5 text-right tabular-nums outline-none dark:bg-zinc-900"
      />
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <button
        type="button"
        aria-label={`Edit ${label}`}
        title="Click to edit"
        onClick={() => setDraft(String(Math.round(value * 100) / 100))}
        className="cursor-text rounded px-0.5 text-left underline decoration-zinc-300 decoration-dotted underline-offset-4 hover:bg-indigo-50 hover:decoration-indigo-500 dark:decoration-zinc-600 dark:hover:bg-indigo-950"
      >
        {display}
      </button>
      {suffix}
      {edited && (
        <span className="inline-flex items-center gap-0.5 text-xs text-indigo-600 dark:text-indigo-400">
          edited
          {onReset && (
            <button type="button" onClick={onReset} aria-label={`Reset ${label} to the calculated value`} title="Back to the calculated value" className="px-0.5 hover:text-indigo-800">
              ↺
            </button>
          )}
        </span>
      )}
    </span>
  );
}

function Cell({ alt, muted, children }: { alt: boolean; muted?: boolean; children: React.ReactNode }) {
  return (
    <td
      className={`border-b border-zinc-100 px-3 py-2 dark:border-zinc-800 ${alt ? "bg-zinc-50 dark:bg-zinc-900" : ""} ${
        muted ? "py-1.5 text-zinc-600 dark:text-zinc-400" : ""
      }`}
    >
      {children}
    </td>
  );
}

function MiniNum({
  value,
  step,
  unit,
  label,
  onChange,
}: {
  value: number;
  step: number;
  unit: string;
  label: string;
  onChange: (v: number) => void;
}) {
  return (
    <span className="flex items-center rounded-md border border-zinc-300 bg-white focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-20 bg-transparent px-2 py-1 text-right tabular-nums outline-none"
      />
      <span className="pr-2 text-xs text-zinc-500">{unit}</span>
    </span>
  );
}
