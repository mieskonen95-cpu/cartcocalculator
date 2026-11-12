"use client";

import { useMemo, useState } from "react";
import type { Listing, Powertrain } from "@/lib/listing";
import {
  type Assumptions,
  type CarInputs,
  carInputsFromListing,
  computeTco,
  defaultAssumptions,
} from "@/lib/tco";

const eur = (n: number, digits = 0) =>
  new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const int = (n: number) => new Intl.NumberFormat("fi-FI").format(Math.round(n));

const POWERTRAINS: [Powertrain, string][] = [
  ["petrol", "Petrol"],
  ["diesel", "Diesel"],
  ["electric", "Electric"],
  ["hybrid-petrol", "Hybrid (petrol)"],
  ["hybrid-diesel", "Hybrid (diesel)"],
  ["phev-petrol", "Plug-in hybrid (petrol)"],
  ["phev-diesel", "Plug-in hybrid (diesel)"],
  ["gas", "Gas (CNG)"],
  ["other", "Other"],
];

const BAR_COLORS: Record<string, string> = {
  depreciation: "bg-indigo-500",
  energy: "bg-amber-500",
  tax: "bg-rose-500",
  insurance: "bg-sky-500",
  maintenance: "bg-emerald-500",
  inspections: "bg-violet-500",
  interest: "bg-slate-500",
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [car, setCar] = useState<CarInputs | null>(null);
  const [assumptions, setAssumptions] = useState<Assumptions | null>(null);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/listing?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      const l: Listing = data.listing;
      setListing(l);
      setCar(carInputsFromListing(l));
      setAssumptions(defaultAssumptions(l.powertrain));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function startManual() {
    const l: Listing = {
      id: "manual",
      url: "",
      title: "Your car",
      price: 20000,
      modelYear: new Date().getFullYear() - 5,
      mileageKm: null,
      fuelTypeRaw: null,
      powertrain: "petrol",
      fuelConsumption: null,
      electricConsumption: null,
      co2: 140,
      curbMassKg: null,
      totalMassKg: 2000,
      commissionedOn: null,
      powerKw: null,
      batteryKwh: null,
      imageUrl: null,
      registrationNumber: null,
      seller: null,
    };
    setError(null);
    setListing(l);
    setCar(carInputsFromListing(l));
    setAssumptions(defaultAssumptions(l.powertrain));
  }

  const result = useMemo(() => (car && assumptions ? computeTco(car, assumptions) : null), [car, assumptions]);

  const setCarField = <K extends keyof CarInputs>(k: K, v: CarInputs[K]) => setCar((c) => (c ? { ...c, [k]: v } : c));
  const setA = <K extends keyof Assumptions>(k: K, v: Assumptions[K]) => setAssumptions((a) => (a ? { ...a, [k]: v } : a));

  const ev = car?.powertrain === "electric";
  const phev = car?.powertrain.startsWith("phev");

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">What will this car really cost?</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Paste a nettiauto.com listing to estimate the total cost of ownership: depreciation, fuel, vehicle tax,
          insurance and upkeep.
        </p>
      </header>

      <form onSubmit={load} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.nettiauto.com/audi/a6/15911646"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-indigo-900"
        />
        <button
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? "Fetching…" : "Calculate"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {!listing && (
        <button type="button" onClick={startManual} className="mt-3 text-sm text-indigo-600 underline hover:text-indigo-800">
          Or enter the car&apos;s details manually
        </button>
      )}

      {listing && car && assumptions && result && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          {/* Left: car + inputs */}
          <div className="space-y-6">
            <section className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
              {listing.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={listing.imageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
              )}
              <div className="p-4">
                {listing.url ? (
                  <a href={listing.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {listing.title}
                  </a>
                ) : (
                  <span className="font-medium">{listing.title}</span>
                )}
                <p className="mt-1 text-sm text-zinc-500">
                  {[
                    listing.modelYear,
                    listing.mileageKm !== null && `${int(listing.mileageKm)} km`,
                    listing.fuelTypeRaw,
                    listing.powerKw && `${listing.powerKw} kW`,
                    listing.seller,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </section>

            <Card title="Car details" hint="Read from the listing. Fix anything that looks off.">
              <Num label="Price" unit="€" value={car.price} onChange={(v) => setCarField("price", v ?? 0)} />
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>Powertrain</span>
                <select
                  value={car.powertrain}
                  onChange={(e) => setCarField("powertrain", e.target.value as Powertrain)}
                  className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {POWERTRAINS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {!ev && (
                <Num
                  label="Fuel consumption"
                  unit={car.powertrain === "gas" ? "kg/100km" : "l/100km"}
                  step={0.1}
                  value={car.fuelConsumption}
                  onChange={(v) => setCarField("fuelConsumption", v)}
                />
              )}
              {(ev || phev) && (
                <Num
                  label="Electricity consumption"
                  unit="kWh/100km"
                  step={0.1}
                  value={car.electricConsumption}
                  onChange={(v) => setCarField("electricConsumption", v)}
                />
              )}
              {!ev && <Num label="CO₂ emissions" unit="g/km" value={car.co2} onChange={(v) => setCarField("co2", v)} />}
              <Num label="Total mass" unit="kg" value={car.totalMassKg} onChange={(v) => setCarField("totalMassKg", v)} />
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>First in service</span>
                <input
                  type="date"
                  value={car.commissionedOn ?? ""}
                  onChange={(e) => setCarField("commissionedOn", e.target.value || null)}
                  className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            </Card>

            <Card title="Your situation">
              <Num label="Ownership period" unit="years" step={0.5} value={assumptions.years} onChange={(v) => setA("years", v ?? 1)} />
              <Num label="Driving" unit="km/year" step={1000} value={assumptions.kmPerYear} onChange={(v) => setA("kmPerYear", v ?? 0)} />
              <Num label="Insurance" unit="€/year" step={50} value={assumptions.insurancePerYear} onChange={(v) => setA("insurancePerYear", v ?? 0)} />
              <Num label="Loan amount" unit="€" step={500} value={assumptions.loanAmount} onChange={(v) => setA("loanAmount", v ?? 0)} />
              {assumptions.loanAmount > 0 && (
                <>
                  <Pct label="Loan interest" value={assumptions.loanInterestRate} onChange={(v) => setA("loanInterestRate", v)} />
                  <Num label="Loan term" unit="years" value={assumptions.loanTermYears} onChange={(v) => setA("loanTermYears", v ?? 1)} />
                </>
              )}
            </Card>

            <Card title="Prices & assumptions">
              {(!ev || phev) && car.powertrain !== "gas" && (
                <Num
                  label={car.powertrain.includes("diesel") ? "Diesel price" : "Petrol price"}
                  unit="€/l"
                  step={0.01}
                  value={car.powertrain.includes("diesel") ? assumptions.dieselPrice : assumptions.petrolPrice}
                  onChange={(v) => setA(car.powertrain.includes("diesel") ? "dieselPrice" : "petrolPrice", v ?? 0)}
                />
              )}
              {car.powertrain === "gas" && <Num label="Gas price" unit="€/kg" step={0.01} value={assumptions.gasPrice} onChange={(v) => setA("gasPrice", v ?? 0)} />}
              {(ev || phev) && (
                <Num label="Electricity price" unit="€/kWh" step={0.01} value={assumptions.electricityPrice} onChange={(v) => setA("electricityPrice", v ?? 0)} />
              )}
              {phev && <Pct label="Share driven on electricity" value={assumptions.phevElectricShare} onChange={(v) => setA("phevElectricShare", v)} />}
              <Num label="Real-world consumption factor" unit="×" step={0.05} value={assumptions.realWorldFactor} onChange={(v) => setA("realWorldFactor", v ?? 1)} />
              <Pct label="Depreciation per year" value={assumptions.depreciationRate} onChange={(v) => setA("depreciationRate", v)} />
              <Num label="Maintenance & repairs" unit="€/km" step={0.005} value={assumptions.maintenancePerKm} onChange={(v) => setA("maintenancePerKm", v ?? 0)} />
            </Card>
          </div>

          {/* Right: results */}
          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <section className="rounded-xl bg-indigo-600 p-6 text-white">
              <p className="text-sm text-indigo-100">
                Total cost over {assumptions.years} {assumptions.years === 1 ? "year" : "years"}
              </p>
              <p className="mt-1 text-4xl font-semibold tabular-nums">{eur(result.total)}</p>
              <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
                <Stat label="per month" value={eur(result.perMonth)} />
                <Stat label="per year" value={eur(result.perYear)} />
                <Stat label="per km" value={eur(result.perKm, 2)} />
              </dl>
            </section>

            <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
              <h2 className="font-medium">Breakdown</h2>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                {result.lines.map((l) =>
                  l.total > 0 ? (
                    <div key={l.key} className={BAR_COLORS[l.key]} style={{ width: `${(100 * l.total) / result.total}%` }} />
                  ) : null,
                )}
              </div>
              <ul className="mt-4 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                {result.lines.map((l) => (
                  <li key={l.key} className="flex items-center justify-between py-2">
                    <span className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${BAR_COLORS[l.key]}`} />
                      {l.label}
                    </span>
                    <span className="tabular-nums">
                      {eur(l.total)}
                      <span className="ml-2 inline-block w-10 text-right text-zinc-400">
                        {result.total > 0 ? Math.round((100 * l.total) / result.total) : 0}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-zinc-500">
                Estimated resale value after {assumptions.years} years: <strong>{eur(result.residualValue)}</strong>
              </p>
            </section>

            <section className="rounded-xl border border-zinc-200 p-5 text-sm dark:border-zinc-800">
              <h2 className="font-medium">Vehicle tax</h2>
              <p className="mt-2 tabular-nums">
                Basic {eur(result.tax.basic, 2)} + driving power {eur(result.tax.drivingPower, 2)} ={" "}
                <strong>{eur(result.tax.total, 2)} / year</strong>
                {result.tax.estimated && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">estimate</span>}
              </p>
              {result.tax.notes.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-zinc-500">
                  {result.tax.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Num
                  label="Override (from Traficom)"
                  unit="€/year"
                  value={car.vehicleTaxOverride}
                  onChange={(v) => setCarField("vehicleTaxOverride", v)}
                />
              </div>
              <p className="mt-2 text-zinc-500">
                Exact figure for a plate number:{" "}
                <a className="underline" href="https://www.traficom.fi/fi/asioi-kanssamme/ajoneuvoveron-maaran-laskeminen" target="_blank" rel="noreferrer">
                  Traficom
                </a>
                {listing.registrationNumber && <> ({listing.registrationNumber})</>}.
              </p>
            </section>
          </div>
        </div>
      )}

      <footer className="mt-16 text-xs text-zinc-500">
        Estimates only. Not affiliated with Nettiauto. Vehicle tax rates: Traficom, 2026.
      </footer>
    </main>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="font-medium">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
      <dt className="text-indigo-100">{label}</dt>
    </div>
  );
}

function Num({
  label,
  unit,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <span className="flex w-48 items-center rounded-md border border-zinc-300 bg-white focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="w-full min-w-0 bg-transparent px-2 py-1.5 text-right tabular-nums outline-none"
        />
        <span className="shrink-0 pr-2 text-xs text-zinc-500">{unit}</span>
      </span>
    </label>
  );
}

function Pct({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Num
      label={label}
      unit="%"
      step={0.5}
      value={Math.round(value * 1000) / 10}
      onChange={(v) => onChange((v ?? 0) / 100)}
    />
  );
}
