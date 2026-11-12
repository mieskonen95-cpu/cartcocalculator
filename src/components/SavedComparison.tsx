"use client";

import { useMemo } from "react";
import type { Powertrain } from "@/lib/listing";
import { differingSettings, type SavedCar } from "@/lib/saved";
import { computeTco, type CostLine } from "@/lib/tco";

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

export function SavedComparison({
  saved,
  currentId,
  onOpen,
  onRemove,
}: {
  saved: SavedCar[];
  currentId: string | null;
  onOpen: (s: SavedCar) => void;
  onRemove: (id: string) => void;
}) {
  const rows = useMemo(() => saved.map((s) => ({ s, r: computeTco(s.car, s.assumptions) })), [saved]);
  const cheapest = rows.length > 1 ? Math.min(...rows.map((x) => x.r.total)) : null;
  const maxTotal = Math.max(...rows.map((x) => x.r.total), 1);
  const differing = differingSettings(saved);
  const keys = Object.keys(COST_LABELS) as CostLine["key"][];
  const line = (r: (typeof rows)[number]["r"], k: CostLine["key"]) => r.lines.find((l) => l.key === k)?.total ?? 0;

  return (
    <section className="mt-10 min-w-0 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="font-medium">Saved cars ({saved.length})</h2>
      <p className="mt-0.5 text-sm text-zinc-500">Stored in this browser on this device. Click Open to change a car&apos;s inputs.</p>

      {differing.length > 0 && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          These cars were saved with different {differing.join(", ")}, so their totals aren&apos;t directly comparable. Open
          a car to change its settings, then save it again.
        </p>
      )}

      {/* Stacked cost bars: one per car, same scale. */}
      <ul className="mt-5 space-y-3">
        {rows.map(({ s, r }) => (
          <li key={s.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{s.listing.title}</span>
              <span className="shrink-0 tabular-nums">
                {r.total === cheapest && <span className="mr-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">Cheapest</span>}
                <strong>{eur(r.total)}</strong>
              </span>
            </div>
            <div className="mt-1 flex h-3 gap-[2px] overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" style={{ width: `${(100 * r.total) / maxTotal}%` }}>
              {r.lines.map((l) =>
                l.total > 0 ? (
                  <div key={l.key} title={`${COST_LABELS[l.key]}: ${eur(l.total)}`} className={COST_COLORS[l.key]} style={{ width: `${(100 * l.total) / r.total}%` }} />
                ) : null,
              )}
            </div>
          </li>
        ))}
      </ul>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${COST_COLORS[k]}`} />
            {COST_LABELS[k]}
          </li>
        ))}
      </ul>

      {/* Side-by-side table; scrolls sideways when there are many cars. */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--background)] py-2 pr-3" />
              {rows.map(({ s }) => (
                <th key={s.id} className="min-w-36 border-b border-zinc-200 px-3 py-2 text-left align-top font-medium dark:border-zinc-800">
                  <span className="line-clamp-3">{s.listing.title}</span>
                  {s.id === currentId && <span className="mt-1 block text-xs font-normal text-indigo-600 dark:text-indigo-400">Open above</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Price", (x) => eur(x.s.car.price)],
                ["Type", (x) => POWERTRAIN_SHORT[x.s.car.powertrain]],
                ["Year · km", (x) => [x.s.car.modelYear, x.s.listing.mileageKm !== null && `${int(x.s.listing.mileageKm)} km`].filter(Boolean).join(" · ") || "—"],
                ["Ownership", (x) => `${x.s.assumptions.years} y · ${int(x.s.assumptions.kmPerYear)} km/y`],
                ["Payment", (x) => (x.s.assumptions.financing === "loan" ? `Financed, ${eur(x.r.financing.equity)} down` : "Lump sum")],
              ] as [string, (x: (typeof rows)[number]) => string][]
            ).map(([label, f]) => (
              <tr key={label}>
                <td className="sticky left-0 bg-[var(--background)] py-2 pr-3 text-zinc-500">{label}</td>
                {rows.map((x) => (
                  <td key={x.s.id} className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                    {f(x)}
                  </td>
                ))}
              </tr>
            ))}
            {(
              [
                ["Total cost", (x) => x.r.total, true],
                ["Per month", (x) => x.r.perMonth, false],
                ["Per km", (x) => x.r.perKm, false],
              ] as [string, (x: (typeof rows)[number]) => number, boolean][]
            ).map(([label, f, bold]) => (
              <tr key={label} className={bold ? "font-semibold" : ""}>
                <td className="sticky left-0 bg-[var(--background)] py-2 pr-3">{label}</td>
                {rows.map((x) => (
                  <td key={x.s.id} className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                    {label === "Per km" ? eur(f(x), 2) : eur(f(x))}
                    {bold && x.r.total === cheapest && (
                      <span className="ml-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ cheapest</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {keys.map((k) => (
              <tr key={k}>
                <td className="sticky left-0 bg-[var(--background)] py-1.5 pr-3 text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${COST_COLORS[k]}`} />
                    {COST_LABELS[k]}
                  </span>
                </td>
                {rows.map((x) => (
                  <td key={x.s.id} className="border-b border-zinc-100 px-3 py-1.5 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                    {k === "insurance" && !x.r.insurance.fromQuote ? "≈ " : ""}
                    {eur(line(x.r, k))}
                    {k === "insurance" && x.r.insurance.insuranceClass === "high-power" && !x.r.insurance.fromQuote && (
                      <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">get quote</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="sticky left-0 bg-[var(--background)]" />
              {rows.map(({ s }) => (
                <td key={s.id} className="px-3 pt-3">
                  <div className="flex gap-3">
                    <button type="button" onClick={() => onOpen(s)} className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400">
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove ${s.listing.title} from saved cars?`)) onRemove(s.id);
                      }}
                      className="text-zinc-500 underline hover:text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
