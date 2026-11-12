"use client";

import { useEffect, useMemo, useState } from "react";
import { CashflowChart } from "@/components/CashflowChart";
import { COST_COLORS, SavedComparison } from "@/components/SavedComparison";
import { loadSaved, newId, storeSaved, upsert, type SavedCar } from "@/lib/saved";
import {
  looksLikeListingText,
  mergeListing,
  normaliseListingUrl,
  parseListingText,
  technicalSectionMissing,
  type Listing,
  type Powertrain,
} from "@/lib/listing";
import {
  type Assumptions,
  type CarInputs,
  carInputsFromListing,
  computeTco,
  DEFAULT_CONSUMPTION,
  OUTFLOW_LABELS,
  type OutflowKind,
  type TcoResult,
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

const BAR_COLORS: Record<string, string> = COST_COLORS;

export default function Home() {
  const [input, setInput] = useState("");
  /** Link the user pasted that we couldn't fetch, so we can offer to open it. */
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-blocking hint shown after a paste (e.g. collapsed technical section). */
  const [notice, setNotice] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [car, setCar] = useState<CarInputs | null>(null);
  const [assumptions, setAssumptions] = useState<Assumptions | null>(null);

  const [saved, setSaved] = useState<SavedCar[]>([]);
  /** Id of the saved entry currently open, so saving again updates it. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Read saved cars after mounting (localStorage isn't available during server rendering).
  useEffect(() => setSaved(loadSaved()), []);

  function persist(list: SavedCar[]) {
    setSaved(list);
    if (!storeSaved(list)) setSaveMsg("Couldn't save: this browser blocks storage (private mode?).");
  }

  function saveCurrent() {
    if (!listing || !car || !assumptions) return;
    const id = savedId && saved.some((x) => x.id === savedId) ? savedId : newId();
    persist(upsert(saved, { id, savedAt: new Date().toISOString(), listing, car, assumptions }));
    setSaveMsg(id === savedId ? "Updated" : "Saved");
    setSavedId(id);
    setTimeout(() => setSaveMsg(null), 2500);
  }

  function openSaved(s: SavedCar) {
    setListing(s.listing);
    setCar(s.car);
    setAssumptions(s.assumptions);
    setSavedId(s.id);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function removeSaved(id: string) {
    persist(saved.filter((x) => x.id !== id));
    if (id === savedId) setSavedId(null);
  }

  function show(l: Listing) {
    setSavedId(null);
    setListing(l);
    setCar(carInputsFromListing(l));
    setAssumptions(defaultAssumptions(l.powertrain));
  }

  function fromText(text: string): boolean {
    if (!looksLikeListingText(text)) return false;
    const l = parseListingText(text);
    setBlockedUrl(null);
    setError(null);

    // A snippet without a price (e.g. just the technical section) adds to the car already loaded.
    if (l.price === null && listing && car) {
      const merged = mergeListing(listing, l);
      const fresh = carInputsFromListing(merged);
      setListing(merged);
      setCar({
        ...car,
        powertrain: fresh.powertrain,
        ...Object.fromEntries(
          (["fuelConsumption", "electricConsumption", "co2", "totalMassKg", "commissionedOn", "modelYear", "powerKw", "curbMassKg"] as const)
            .filter((k) => fresh[k] !== null)
            .map((k) => [k, fresh[k]]),
        ),
      });
      setNotice("Added the pasted details to this car.");
      setInput("");
      return true;
    }

    if (l.price === null) setError("Couldn't find the price in the pasted text. Enter it under Car details.");
    setNotice(
      technicalSectionMissing(text)
        ? "The technical details (Tekniset tiedot) were missing from the paste. That section was probably collapsed. Open it on the listing, copy it, and paste it here to fill in the missing values."
        : null,
    );
    show({ ...l, price: l.price ?? 0 });
    return true;
  }

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    if (fromText(input)) return;

    const target = normaliseListingUrl(input);
    if (!target) {
      setError("That doesn't look like a nettiauto listing. Paste the listing page's text (see the steps below) or its link.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/listing?url=${encodeURIComponent(target.url)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setBlockedUrl(null);
      show(data.listing);
    } catch {
      setBlockedUrl(target.url);
      setError("nettiauto.com doesn't let this app fetch listings. Copy the listing page's text and paste it here instead.");
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
    show(l);
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
          insurance, upkeep, financing and lost investment returns.
        </p>
      </header>

      <form onSubmit={load} className="space-y-2">
        <textarea
          required
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            // Calculate straight away when a whole listing page is pasted.
            const text = e.clipboardData.getData("text");
            if (looksLikeListingText(text)) {
              e.preventDefault();
              setInput(text);
              fromText(text);
            }
          }}
          placeholder="Paste the listing page here (select all, copy, paste)"
          aria-label="Listing text or link"
          className="block w-full resize-y rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-indigo-900"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "Fetching…" : "Calculate"}
          </button>
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                setError(null);
                setNotice(null);
                setBlockedUrl(null);
              }}
              className="text-sm text-zinc-500 underline hover:text-zinc-700"
            >
              Clear
            </button>
          )}
        </div>
      </form>
      {error && (
        <p className="mt-3 text-sm text-rose-600">
          {error}
          {blockedUrl && (
            <>
              {" "}
              <a href={blockedUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                Open the listing
              </a>
            </>
          )}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{notice}</p>
      )}
      {!listing && (
        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Open the car&apos;s listing on nettiauto.com.</li>
          <li>
            Select the whole page and copy it: <kbd className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700">Ctrl</kbd>+
            <kbd className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700">A</kbd>, then{" "}
            <kbd className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700">Ctrl</kbd>+
            <kbd className="rounded border border-zinc-300 px-1 text-xs dark:border-zinc-700">C</kbd> (⌘ on Mac). On a phone,
            long-press some text, tap <em>Select all</em>, then <em>Copy</em>.
          </li>
          <li>Paste it in the box above. The calculation starts automatically.</li>
          <li>
            If the <em>Tekniset tiedot</em> (technical details) section on the listing is collapsed, open it before
            copying. Otherwise copy it afterwards and paste it here; it fills in what&apos;s missing.
          </li>
        </ol>
      )}
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
                  label={phev ? "Fuel use on petrol" : "Fuel consumption"}
                  unit={car.powertrain === "gas" ? "kg/100km" : "l/100km"}
                  step={0.1}
                  value={car.fuelConsumption}
                  placeholder={`≈ ${DEFAULT_CONSUMPTION[car.powertrain].fuel}`}
                  onChange={(v) => setCarField("fuelConsumption", v)}
                />
              )}
              {(ev || phev) && (
                <Num
                  label="Electricity consumption"
                  unit="kWh/100km"
                  step={0.1}
                  value={car.electricConsumption}
                  placeholder={`≈ ${DEFAULT_CONSUMPTION[car.powertrain].electric}`}
                  onChange={(v) => setCarField("electricConsumption", v)}
                />
              )}
              {!ev && <Num label="CO₂ emissions" unit="g/km" value={car.co2} placeholder="?" onChange={(v) => setCarField("co2", v)} />}
              <Num label="Total mass" unit="kg" value={car.totalMassKg} placeholder="≈ 2000" onChange={(v) => setCarField("totalMassKg", v)} />
              <Num label="Power" unit="kW" value={car.powerKw} onChange={(v) => setCarField("powerKw", v)} />
              {(() => {
                const missing = [
                  !ev && !phev && car.fuelConsumption === null && "fuel consumption",
                  (ev || phev) && car.electricConsumption === null && "electricity consumption",
                  !ev && car.co2 === null && "CO₂",
                  car.totalMassKg === null && "total mass",
                ].filter(Boolean);
                return missing.length ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Not found in the paste: {missing.join(", ")}. Using typical values (≈) for now. Type in the real figures if
                    you know them{car.co2 === null && !ev ? "; vehicle tax is a rough estimate without CO₂" : ""}.
                  </p>
                ) : null;
              })()}
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>First in service</span>
                <input
                  type="date"
                  value={car.commissionedOn ?? ""}
                  onChange={(e) => setCarField("commissionedOn", e.target.value || null)}
                  className="w-48 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <Num
                  label="Insurance (your quote)"
                  unit="€/year"
                  step={10}
                  value={car.insuranceOverride}
                  placeholder={`≈ ${int(result.insurance.perYear)}`}
                  onChange={(v) => setCarField("insuranceOverride", v)}
                />
                {result.insurance.fromQuote ? (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Using your quote. The estimate would be {eur(result.insurance.perYear)}/year.
                  </p>
                ) : (
                  <p
                    className={`mt-1.5 rounded-md px-3 py-2 text-xs ${
                      result.insurance.insuranceClass === "high-power"
                        ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                        : "text-zinc-500"
                    }`}
                  >
                    Estimate: {eur(result.insurance.perYear)}/year for traffic insurance + full cover.{" "}
                    {result.insurance.reason} Based on a handful of real quotes, so enter your own quote
                    {listing.registrationNumber ? ` (plate ${listing.registrationNumber})` : ""} for an exact figure.
                  </p>
                )}
              </div>
            </Card>

            <Card title="Your situation">
              <Num label="Ownership period" unit="years" step={0.5} value={assumptions.years} onChange={(v) => setA("years", v ?? 1)} />
              <Num label="Driving" unit="km/year" step={1000} value={assumptions.kmPerYear} onChange={(v) => setA("kmPerYear", v ?? 0)} />
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

              <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <h3 className="text-sm font-medium">Financing & opportunity cost</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Your own money in the car could otherwise earn a return in the stock market. That lost return is a cost.
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span>Payment</span>
                <div role="radiogroup" className="flex w-48 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
                  {(
                    [
                      ["cash", "Lump sum"],
                      ["loan", "Financed"],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={assumptions.financing === v}
                      onClick={() => setA("financing", v)}
                      className={`flex-1 rounded px-2 py-1 ${
                        assumptions.financing === v ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {assumptions.financing === "loan" && (
                <>
                  <Num label="Own equity (down payment)" unit="€" step={500} value={assumptions.downPayment} onChange={(v) => setA("downPayment", v ?? 0)} />
                  <Pct label="Loan interest" value={assumptions.loanInterestRate} onChange={(v) => setA("loanInterestRate", v)} />
                  <Num label="Loan term" unit="years" value={assumptions.loanTermYears} onChange={(v) => setA("loanTermYears", v ?? 1)} />
                  <p className="text-xs text-zinc-500 tabular-nums">
                    Loan {eur(result.financing.loanAmount)} · {eur(result.financing.monthlyPayment)}/month
                    {result.financing.remainingBalance > 1 && (
                      <> · {eur(result.financing.remainingBalance)} still owed when sold (paid from the sale)</>
                    )}
                  </p>
                </>
              )}
              <Pct label="Expected stock market return" value={assumptions.expectedReturn} onChange={(v) => setA("expectedReturn", v)} />
              <p className="-mt-1 text-xs text-zinc-500">Per year, after tax. Returns earn returns (monthly compounding).</p>
              <LostReturnsToggle value={assumptions.opportunityMode} onChange={(v) => setA("opportunityMode", v)} />
              <p className="-mt-1 text-xs text-zinc-500">
                {assumptions.opportunityMode === "cost"
                  ? "Added to the total cost of ownership."
                  : "Left out of the total; the chart below shows how the money would grow invested."}
              </p>
              <Num
                label="Already invested"
                unit="€"
                step={1000}
                value={assumptions.alreadyInvested || null}
                placeholder="0"
                onChange={(v) => setA("alreadyInvested", Math.max(0, v ?? 0))}
              />
              <p className="-mt-1 text-xs text-zinc-500">
                Stocks, funds etc. you already hold. {assumptions.opportunityMode === "chart" ? "Shown" : "With “Show in chart”, it’s shown"}{" "}
                growing in the chart under the car money. It doesn&apos;t change lost returns: returns grow in proportion to
                the money, so the car money earns the same on top of any amount.
              </p>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm">Count lost returns on</legend>
                {(Object.keys(OUTFLOW_LABELS) as OutflowKind[]).map((k) => {
                  const na = assumptions.financing === "cash" && (k === "principal" || k === "interest");
                  return (
                    <label key={k} className={`flex items-center justify-between gap-4 text-sm ${na ? "text-zinc-400" : ""}`}>
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={assumptions.opportunityOn[k]}
                          onChange={(e) => setA("opportunityOn", { ...assumptions.opportunityOn, [k]: e.target.checked })}
                          disabled={na}
                          className="h-4 w-4 accent-indigo-600"
                        />
                        {OUTFLOW_LABELS[k]}
                      </span>
                      <span className="tabular-nums text-zinc-500">
                        {na ? "n/a" : assumptions.opportunityOn[k] ? eur(result.financing.opportunityByKind[k]) : "off"}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
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
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={saveCurrent}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                >
                  {savedId && saved.some((x) => x.id === savedId) ? "Update saved car" : "Save for comparison"}
                </button>
                {savedId && saved.some((x) => x.id === savedId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSavedId(null);
                      const id = newId();
                      persist(upsert(saved, { id, savedAt: new Date().toISOString(), listing, car, assumptions }));
                      setSavedId(id);
                      setSaveMsg("Saved as a new car");
                      setTimeout(() => setSaveMsg(null), 2500);
                    }}
                    className="text-sm text-indigo-100 underline hover:text-white"
                  >
                    Save as new
                  </button>
                )}
                {saveMsg && (
                  <span role="status" className="text-sm text-indigo-100">
                    {saveMsg}
                    {saved.length > 1 && !saveMsg.startsWith("Couldn") && (
                      <>
                        {" · "}
                        <a href="#saved" className="underline">
                          compare {saved.length} cars
                        </a>
                      </>
                    )}
                  </span>
                )}
              </div>
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
              {assumptions.opportunityMode === "chart" && (
                <p className="mt-1 text-sm text-zinc-500">
                  Not included: {eur(result.financing.opportunityCost)} of lost investment returns, shown in the{" "}
                  <a href="#cashflow" className="underline">
                    chart below
                  </a>
                  .
                </p>
              )}
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

      {listing && car && assumptions && result && (
          <section id="cashflow" className="mt-6 min-w-0 scroll-mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="font-medium">Lump sum vs financed</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {assumptions.opportunityMode === "cost"
                ? "Cash out of your pocket over time, including running costs. The step at the end is selling the car"
                : `Solid: money paid into the car, including running costs; it steps down when you sell. Dashed: the same money invested at ${Math.round(assumptions.expectedReturn * 1000) / 10} % a year instead, growing with returns on returns. The gap is the lost return. Paying a lump sum starts with more money in the car, so its gap compounds fastest`}
              {assumptions.financing === "loan" ? "" : ` (financed: ${eur(Math.min(assumptions.downPayment, car.price))} down, ${Math.round(assumptions.loanInterestRate * 1000) / 10} %, ${assumptions.loanTermYears} years)`}.
            </p>
            <div className="mt-3 max-w-md">
              <LostReturnsToggle value={assumptions.opportunityMode} onChange={(v) => setA("opportunityMode", v)} />
            </div>
            <div className="mt-4">
              <CashflowChart
                cash={result.scenarios.cash}
                loan={result.scenarios.loan}
                mode={assumptions.opportunityMode}
                alreadyInvested={assumptions.alreadyInvested}
                expectedReturn={assumptions.expectedReturn}
              />
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-xs tabular-nums sm:text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-500 dark:border-zinc-800">
                    <th className="py-2 font-normal" />
                    <th className="py-2 pl-3 text-right font-normal">Lump sum</th>
                    <th className="py-2 pl-3 text-right font-normal">Financed</th>
                    <th className="py-2 pl-3 text-right font-normal">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {(
                    [
                      ["Paid on purchase day", (s) => s.equity],
                      ["Monthly loan payment", (s) => s.monthlyPayment],
                      ["Total paid out", (s) => s.totalPaidOut],
                      ["Back from the sale", (s) => s.saleProceeds],
                      ["Interest paid", (s) => s.interest],
                      ...(assumptions.opportunityMode === "chart"
                        ? ([
                            ["Worth if invested instead", (s) => s.investedValue[s.investedValue.length - 1]],
                            ["Lost returns (not in total)", (s) => s.opportunityCost],
                            ["Total cost, without lost returns", (s) => s.tco],
                          ] as [string, (s: TcoResult["scenarios"]["cash"]) => number][])
                        : ([
                            ["Lost returns", (s) => s.opportunityCost],
                            ["Total cost of ownership", (s) => s.tco],
                          ] as [string, (s: TcoResult["scenarios"]["cash"]) => number][])),
                    ] as [string, (s: TcoResult["scenarios"]["cash"]) => number][]
                  ).map(([label, f], i, rows) => {
                    const c = f(result.scenarios.cash);
                    const l = f(result.scenarios.loan);
                    const last = i === rows.length - 1;
                    return (
                      <tr key={label} className={last ? "font-medium" : ""}>
                        <td className="py-2">{label}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right">{eur(c)}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right">{eur(l)}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right text-zinc-500">
                          {Math.abs(l - c) < 0.5 ? "—" : `${l > c ? "+" : "−"}${eur(Math.abs(l - c))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-zinc-500">
              {(() => {
                if (assumptions.opportunityMode === "chart") {
                  const cashOnly = result.scenarios.loan.tco - result.scenarios.cash.tco;
                  const withReturns =
                    result.scenarios.loan.tco + result.scenarios.loan.opportunityCost -
                    (result.scenarios.cash.tco + result.scenarios.cash.opportunityCost);
                  const cashPart =
                    cashOnly > 0.5
                      ? `Counting cash only, the lump sum is ${eur(cashOnly)} cheaper (no interest).`
                      : "Counting cash only, the two options cost about the same.";
                  const withPart =
                    Math.abs(withReturns) < 50
                      ? " Including what your money would earn invested, they come out about even."
                      : withReturns > 0
                        ? ` Including what your money would earn invested, the lump sum is still ${eur(withReturns)} cheaper.`
                        : ` Including what your money would earn invested, financing comes out ${eur(-withReturns)} ahead.`;
                  return cashPart + withPart;
                }
                const d = result.scenarios.loan.tco - result.scenarios.cash.tco;
                if (Math.abs(d) < 50) return "With these assumptions the two options cost about the same.";
                return d > 0
                  ? `Paying a lump sum is ${eur(d)} cheaper overall: the loan interest costs more than your money would earn invested.`
                  : `Financing is ${eur(-d)} cheaper overall: your money earns more invested than the loan costs.`;
              })()}
            </p>
          </section>
      )}

      {saved.length > 0 && (
        <div id="saved" className="scroll-mt-6">
          <SavedComparison
            saved={saved}
            currentId={listing ? savedId : null}
            onOpen={openSaved}
            onRemove={removeSaved}
            onUpdateAll={(list) => {
              persist(list);
              // Keep the calculator in step if the car open above was changed.
              const open = savedId ? list.find((x) => x.id === savedId) : undefined;
              if (open && listing) setAssumptions(open.assumptions);
              setSaveMsg(null);
            }}
          />
        </div>
      )}

      <footer className="mt-16 text-xs text-zinc-500">
        Estimates only. Not affiliated with Nettiauto. Vehicle tax rates: Traficom, 2026.
      </footer>
    </main>
  );
}

function LostReturnsToggle({ value, onChange }: { value: "cost" | "chart"; onChange: (v: "cost" | "chart") => void }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span>Lost returns</span>
      <div role="radiogroup" aria-label="Lost returns" className="flex w-56 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
        {(
          [
            ["cost", "Count as cost"],
            ["chart", "Show in chart"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded px-2 py-1 ${
              value === v ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
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
  placeholder = "—",
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  placeholder?: string;
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
          placeholder={placeholder}
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
