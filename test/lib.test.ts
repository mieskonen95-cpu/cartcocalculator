import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  looksLikeListingText,
  mergeListing,
  normaliseListingUrl,
  parseListing,
  parseListingText,
  technicalSectionMissing,
} from "../src/lib/listing";
import { annualVehicleTax } from "../src/lib/tax";
import {
  carInputsFromListing,
  computeTco,
  defaultAssumptions,
  inspectionsDuring,
  simulateOwnership,
  grownInvestment,
  type Assumptions,
} from "../src/lib/tco";
import { differingSettings, loadSaved, storeSaved, upsert } from "../src/lib/saved";
import { estimateInsurance, isHighPower, type InsuranceInput } from "../src/lib/insurance";
import { alternativePerYear, computeAlternative, DEFAULT_ALTERNATIVES } from "../src/lib/alternatives";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("normaliseListingUrl", () => {
  it("accepts listing URLs and strips query strings", () => {
    expect(normaliseListingUrl("https://www.nettiauto.com/audi/a6/15911646?ref=x")).toEqual({
      url: "https://www.nettiauto.com/audi/a6/15911646",
      id: "15911646",
    });
    expect(normaliseListingUrl(" nettiauto.com/audi/a6/1 ")).toBeNull();
  });
  it("rejects other hosts and non-listing paths", () => {
    expect(normaliseListingUrl("https://evil.com/audi/a6/15911646")).toBeNull();
    expect(normaliseListingUrl("https://www.nettiauto.com.evil.com/audi/a6/15911646")).toBeNull();
    expect(normaliseListingUrl("https://www.nettiauto.com/audi/a6")).toBeNull();
  });
});

describe("parseListing", () => {
  it("parses a diesel hybrid (Audi A6)", () => {
    const l = parseListing(fixture("a6.html"), "https://www.nettiauto.com/audi/a6/15911646");
    expect(l).toMatchObject({
      id: "15911646",
      price: 17339,
      modelYear: 2021,
      mileageKm: 268000,
      powertrain: "hybrid-diesel",
      fuelConsumption: 5.8,
      electricConsumption: null,
      co2: 148,
      curbMassKg: 1845,
      totalMassKg: 2425,
      commissionedOn: "2021-03-31",
      powerKw: 150,
      registrationNumber: "IZK-146",
    });
    expect(l.title).toContain("Audi A6");
    expect(l.imageUrl).toMatch(/^https:\/\/images\.nettiauto\.com\//);
  });

  it("parses an EV (Tesla Model Y)", () => {
    const l = parseListing(fixture("tesla.html"), "https://www.nettiauto.com/tesla/model-y/16075506");
    expect(l).toMatchObject({
      price: 40129,
      powertrain: "electric",
      electricConsumption: 16.9,
      co2: null,
      curbMassKg: 2054,
      totalMassKg: null,
      commissionedOn: "2022-12-01",
      batteryKwh: 82,
    });
  });
});

describe("annualVehicleTax", () => {
  it("uses the fixed EV basic tax and mass-based driving power tax", () => {
    const t = annualVehicleTax({ powertrain: "electric", co2: null, totalMassKg: 2554, commissionedOn: "2022-12-01" });
    expect(t.basic).toBe(171.18);
    expect(t.drivingPower).toBeCloseTo((26 * 1.9 * 365) / 100, 2);
  });
  it("applies the lower EV basic tax for cars commissioned by 2021-09-30", () => {
    const t = annualVehicleTax({ powertrain: "electric", co2: null, totalMassKg: 2000, commissionedOn: "2021-09-30" });
    expect(t.basic).toBe(106.21);
  });
  it("has no driving power tax for petrol and the minimum basic tax for low CO2", () => {
    const t = annualVehicleTax({ powertrain: "petrol", co2: 80, totalMassKg: 1500, commissionedOn: "2015-01-01" });
    expect(t).toMatchObject({ basic: 106.21, drivingPower: 0, estimated: false });
  });
  it("matches the official NEDC 100 g/km point", () => {
    expect(annualVehicleTax({ powertrain: "petrol", co2: 100, totalMassKg: 1500, commissionedOn: "2015-01-01" }).basic).toBe(125.56);
  });
});

describe("tco helpers", () => {
  it("counts Finnish inspections (4, 6, 8, then yearly)", () => {
    expect(inspectionsDuring(0, 3)).toBe(0);
    expect(inspectionsDuring(0, 4)).toBe(1);
    expect(inspectionsDuring(3, 6)).toBe(4); // 4, 6, 8, 9
    expect(inspectionsDuring(12, 3)).toBe(3);
  });
  const base = (over: Partial<Assumptions> = {}): Assumptions => ({
    ...defaultAssumptions("petrol"),
    loanInterestRate: 0.06,
    loanTermYears: 5,
    expectedReturn: 0.06,
    ...over,
  });
  const allOff = { equity: false, principal: false, interest: false, running: false };

  it("charges the forgone return on a lump-sum purchase", () => {
    const only = base({ opportunityOn: { ...allOff, equity: true } });
    const f = simulateOwnership(20000, only, "cash", 36, 0, 15000);
    expect(f).toMatchObject({ equity: 20000, loanAmount: 0, interest: 0, saleProceeds: 15000 });
    expect(f.opportunityCost).toBeCloseTo(20000 * (1.06 ** 3 - 1), 6);
  });

  it("runs an annuity loan correctly", () => {
    const f = simulateOwnership(15000, base({ downPayment: 5000, expectedReturn: 0 }), "loan", 60, 0, 0);
    expect(f.loanAmount).toBe(10000);
    expect(f.monthlyPayment).toBeCloseTo(193.33, 2);
    expect(f.interest).toBeGreaterThan(1590);
    expect(f.interest).toBeLessThan(1610);
    expect(f.remainingBalance).toBeCloseTo(0, 6);
    expect(f.opportunityCost).toBe(0);
  });

  it("only charges opportunity cost on the outflows switched on", () => {
    const run = (on: Assumptions["opportunityOn"]) =>
      simulateOwnership(15000, base({ downPayment: 5000, opportunityOn: on }), "loan", 36, 200, 10000);
    const all = run({ equity: true, principal: true, interest: true, running: true });
    const none = run(allOff);
    expect(none.opportunityCost).toBe(0);
    const parts = (["equity", "principal", "interest", "running"] as const).map(
      (k) => run({ ...allOff, [k]: true }).opportunityCost,
    );
    parts.forEach((p) => expect(p).toBeGreaterThan(0));
    expect(parts.reduce((x, y) => x + y, 0)).toBeCloseTo(all.opportunityCost, 6);
    // Running costs paid monthly forgo less than the same total paid on day 0.
    expect(parts[3]).toBeLessThan(200 * 36 * (1.06 ** 3 - 1));
  });

  it("balances cash: paid out minus sale = depreciation + interest + running", () => {
    for (const f of ["cash", "loan"] as const) {
      const sc = simulateOwnership(15000, base({ downPayment: 3000 }), f, 36, 150, 11000);
      const net = sc.totalPaidOut - sc.saleProceeds;
      expect(net).toBeCloseTo(15000 - 11000 + sc.interest + 150 * 36, 6);
      expect(sc.cumulativeCash).toHaveLength(37);
      expect(sc.cumulativeCash[36]).toBeCloseTo(-sc.totalPaidOut, 6);
    }
  });

  it("tracks the invested value month by month with compounding", () => {
    const a = base({ downPayment: 5000 });
    for (const f of ["cash", "loan"] as const) {
      const sc = simulateOwnership(15000, a, f, 36, 150, 11000);
      expect(sc.investedValue).toHaveLength(37);
      // Day 0: the lump sum or down payment, not yet grown.
      expect(sc.investedValue[0]).toBe(f === "cash" ? 15000 : 5000);
      // At the sale: invested value − cash paid out = lost returns.
      expect(sc.investedValue[36] - sc.totalPaidOut).toBeCloseTo(sc.opportunityCost, 6);
      // Lost returns so far never shrink.
      const gap = sc.investedValue.map((v, m) => v + sc.cumulativeCash[m]);
      gap.slice(1).forEach((g, i) => expect(g).toBeGreaterThanOrEqual(gap[i] - 1e-9));
    }
    // Returns on returns: a lump sum grows by (1.06^3 − 1), more than 3 × 6 %.
    const lump = simulateOwnership(10000, base({ opportunityOn: { ...allOff, equity: true } }), "cash", 36, 0, 0);
    expect(lump.investedValue[36]).toBeCloseTo(10000 * 1.06 ** 3, 6);
    expect(lump.opportunityCost).toBeGreaterThan(10000 * 0.06 * 3);
  });

  it("existing investments grow on their own and don't change lost returns", () => {
    expect(grownInvestment(50000, 0.06, 36)).toBeCloseTo(50000 * 1.06 ** 3, 6);
    expect(grownInvestment(50000, 0.06, 0)).toBe(50000);
    const none = simulateOwnership(15000, base({ alreadyInvested: 0 }), "cash", 36, 150, 11000);
    const lots = simulateOwnership(15000, base({ alreadyInvested: 100000 }), "cash", 36, 150, 11000);
    expect(lots.opportunityCost).toBe(none.opportunityCost);
  });

  it("switched-off outflows count as cash without growth in the invested line", () => {
    const sc = simulateOwnership(15000, base({ opportunityOn: allOff }), "cash", 36, 150, 11000);
    sc.investedValue.forEach((v, m) => expect(v).toBeCloseTo(-sc.cumulativeCash[m], 6));
  });

  it("caps the down payment at the price", () => {
    expect(simulateOwnership(10000, base({ downPayment: 99999 }), "loan", 12, 0, 8000)).toMatchObject({
      equity: 10000,
      loanAmount: 0,
      interest: 0,
    });
  });
  it("produces a consistent breakdown", () => {
    const l = parseListing(fixture("a6.html"), "https://www.nettiauto.com/audi/a6/15911646");
    const r = computeTco(carInputsFromListing(l), defaultAssumptions(l.powertrain), new Date("2026-11-12"));
    const sum = r.lines.reduce((s, x) => s + x.total, 0);
    expect(r.total).toBeCloseTo(sum, 6);
    expect(r.perMonth).toBeCloseTo(r.total / 36, 6);
    expect(r.scenarios.cash.tco).toBeCloseTo(r.total, 6); // default is a lump sum
    // "Show in chart": lost returns leave the total and the breakdown.
    const chart = computeTco(carInputsFromListing(l), { ...defaultAssumptions(l.powertrain), opportunityMode: "chart" }, new Date("2026-11-12"));
    expect(chart.lines.some((x) => x.key === "opportunity")).toBe(false);
    expect(chart.total).toBeCloseTo(r.total - r.financing.opportunityCost, 6);
    expect(chart.scenarios.cash.tco).toBeCloseTo(chart.total, 6);
    expect(r.lines.find((x) => x.key === "inspections")!.total).toBe(120); // ages ~5.6→8.6: due at 6 and 8
  });
});

describe("parseListingText (copied page text)", () => {
  const a6 = fixture("a6.txt");
  const tesla = fixture("tesla.txt");

  it("recognises listing text", () => {
    expect(looksLikeListingText(a6)).toBe(true);
    expect(looksLikeListingText("https://www.nettiauto.com/audi/a6/15911646")).toBe(false);
  });

  it("matches the HTML parser for a diesel hybrid", () => {
    const fromText = parseListingText(a6);
    const fromHtml = parseListing(fixture("a6.html"), "https://www.nettiauto.com/audi/a6/15911646");
    for (const k of [
      "price", "modelYear", "mileageKm", "powertrain", "fuelConsumption", "electricConsumption",
      "co2", "curbMassKg", "totalMassKg", "commissionedOn", "powerKw", "registrationNumber",
    ] as const) {
      expect(fromText[k], k).toEqual(fromHtml[k]);
    }
    expect(fromText.id).toBe("15911646");
    expect(fromText.title).toBe("Audi A6 Avant Business 40 TDI MHEV quattro S tronic");
    expect(fromText.fuelTypeRaw).toBe("2,0 l, Hybridi (diesel/sähkö)");
  });

  it("parses an EV", () => {
    expect(parseListingText(tesla)).toMatchObject({
      price: 40129,
      modelYear: 2023,
      mileageKm: 33000,
      powertrain: "electric",
      electricConsumption: 16.9,
      co2: null,
      curbMassKg: 2054,
      totalMassKg: null,
      commissionedOn: "2022-12-01",
      batteryKwh: 82,
      powerKw: 258,
      registrationNumber: "NOY-656",
    });
  });

  it("handles label and value on one line (tab-separated copy)", () => {
    const tabbed = a6.replace(/^(Mittarilukema|Vuosimalli|Kokonaismassa|Moottori|Käyttöönottopäivä|Toimistomaksu)\n/gm, "$1\t");
    expect(tabbed).not.toBe(a6);
    expect(parseListingText(tabbed)).toMatchObject({
      price: 17339,
      mileageKm: 268000,
      modelYear: 2021,
      totalMassKg: 2425,
      commissionedOn: "2021-03-31",
      powertrain: "hybrid-diesel",
    });
  });

  it("handles a sparse plug-in hybrid listing (Seat Tarraco e-Hybrid)", () => {
    const l = parseListingText(fixture("tarraco.txt"));
    expect(l).toMatchObject({
      id: "15875394",
      title: "Seat Tarraco 1,4 PHEV 245 e-Hybrid Xperience Launch Edition DSG",
      price: 31149, // 30 800 € + 349 € office fee
      modelYear: 2023,
      mileageKm: 31000,
      powertrain: "phev-petrol",
      co2: 37, // only shown with the energy label
      batteryKwh: 13, // only in the summary line
      commissionedOn: "2023-04-14",
      // Not in this listing at all:
      fuelConsumption: null,
      totalMassKg: null,
      curbMassKg: null,
    });
  });

  it("doesn't mistake a regular hybrid for a plug-in because of site navigation", () => {
    const text = fixture("tarraco.txt")
      .replace("1,4 PHEV 245 e-Hybrid Xperience Launch Edition DSG", "1,8 Hybrid Active")
      .replace(/^13 kwh\n/m, "");
    expect(parseListingText(text).powertrain).toBe("hybrid-petrol");
  });

  it("spots a collapsed technical section", () => {
    expect(technicalSectionMissing(fixture("tarraco.txt"))).toBe(true);
    expect(technicalSectionMissing(a6)).toBe(false);
    expect(technicalSectionMissing(tesla)).toBe(false);
  });

  it("reads a pasted technical section on its own and merges it in", () => {
    const tech = fixture("tarraco-tech.txt");
    expect(looksLikeListingText(tech)).toBe(true);
    expect(technicalSectionMissing(tech)).toBe(false);
    const extra = parseListingText(tech);
    expect(extra).toMatchObject({
      price: null,
      powerKw: 180,
      batteryKwh: 13,
      curbMassKg: 1868,
      totalMassKg: 2390,
      co2: 37,
      fuelConsumption: 1.9,
      electricConsumption: 16.7,
    });
    const base = parseListingText(fixture("tarraco.txt"));
    const merged = mergeListing(base, extra);
    expect(merged).toMatchObject({
      title: base.title,
      price: 31149,
      mileageKm: 31000,
      powertrain: "phev-petrol",
      totalMassKg: 2390,
      fuelConsumption: 1.9,
      electricConsumption: 16.7,
    });
    // The official plug-in fuel figure (1.9) is not used as petrol-mode consumption.
    expect(carInputsFromListing(merged).fuelConsumption).toBeNull();
    // A plain hybrid becomes a plug-in once a battery shows up.
    expect(mergeListing({ ...base, powertrain: "hybrid-petrol" }, extra).powertrain).toBe("phev-petrol");
  });

  it("maps Finnish fuel names", () => {
    const t = (m: string) => parseListingText(`Auto\n10 000 €\nMoottori\n${m}\nVuosimalli\n2020`).powertrain;
    expect(t("1,5 l, Bensiini")).toBe("petrol");
    expect(t("2,0 l, Diesel")).toBe("diesel");
    expect(t("Sähkö")).toBe("electric");
    expect(t("1,8 l, Hybridi (bensiini/sähkö)")).toBe("hybrid-petrol");
    expect(t("2,0 l, Lataushybridi (bensiini/sähkö)")).toBe("phev-petrol");
  });
});

describe("saved cars", () => {
  const mk = (id: string, over: Partial<Assumptions> = {}) => {
    const l = parseListingText(fixture("a6.txt"));
    return {
      id,
      savedAt: "2026-11-12T00:00:00Z",
      listing: l,
      car: carInputsFromListing(l),
      assumptions: { ...defaultAssumptions(l.powertrain), ...over },
    };
  };

  it("upserts newest first and replaces by id", () => {
    const list = upsert(upsert([], mk("a")), mk("b"));
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    expect(upsert(list, mk("a", { years: 5 })).map((s) => [s.id, s.assumptions.years])).toEqual([
      ["a", 5],
      ["b", 3],
    ]);
  });

  it("flags settings that make totals incomparable", () => {
    expect(differingSettings([mk("a"), mk("b")])).toEqual([]);
    expect(differingSettings([mk("a"), mk("b", { kmPerYear: 25000, financing: "loan" })])).toEqual([
      "km per year",
      "payment method",
    ]);
  });

  it("round-trips through storage and upgrades old saves", () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    (globalThis as unknown as { localStorage: typeof ls }).localStorage = ls;
    expect(loadSaved()).toEqual([]);
    const old = mk("x") as unknown as { assumptions: Record<string, unknown> };
    delete old.assumptions.opportunityOn; // saved before this setting existed
    expect(storeSaved([old as never])).toBe(true);
    const [back] = loadSaved();
    expect(back.id).toBe("x");
    expect(back.assumptions.opportunityOn).toEqual({ equity: true, principal: true, interest: true, running: true });
    store.set("cartco.saved.v1", "not json");
    expect(loadSaved()).toEqual([]);
  });
});

describe("insurance estimate", () => {
  const est = (o: Partial<InsuranceInput>) =>
    estimateInsurance({ price: 15000, powertrain: "petrol", powerKw: 100, curbMassKg: 1300, totalMassKg: null, ...o });

  it("reproduces the Fennia full-cover quotes within 5 %", () => {
    // Typical specs for these models; the quotes themselves were for specific listings.
    const quotes: [Partial<InsuranceInput>, number][] = [
      [{ price: 6000, powertrain: "petrol", powerKw: 74, curbMassKg: 1250 }, 560], // Ford Focus
      [{ price: 17000, powertrain: "petrol", powerKw: 92, curbMassKg: 1300 }, 593], // Ford Focus
      [{ price: 15880, powertrain: "diesel", powerKw: 110, curbMassKg: 1550 }, 868.62], // VW Passat
      [{ price: 18390, powertrain: "diesel", powerKw: 140, curbMassKg: 1850 }, 906.11], // Volvo XC60
      [{ price: 19990, powertrain: "electric", powerKw: 211, curbMassKg: 1750 }, 1205.33], // Tesla Model 3
    ];
    for (const [car, quote] of quotes) {
      const e = est(car).perYear;
      expect(Math.abs(e - quote) / quote, `${JSON.stringify(car)} → ${e} vs ${quote}`).toBeLessThan(0.05);
    }
  });

  it("uses a high placeholder for cars too powerful to quote online", () => {
    expect(est({ powerKw: 220 })).toMatchObject({ perYear: 2411, insuranceClass: "high-power" });
    expect(est({ powertrain: "electric", powerKw: 220 }).insuranceClass).toBe("electric"); // EVs quote fine
    expect(est({ powertrain: "electric", powerKw: 258 }).insuranceClass).toBe("electric"); // Model Y Long Range
    expect(est({ powertrain: "electric", powerKw: 340 }).insuranceClass).toBe("high-power"); // Performance
    expect(isHighPower("petrol", null)).toBe(false);
  });

  it("falls back to total mass, then to a middle factor", () => {
    expect(est({ curbMassKg: null, totalMassKg: 2200 }).insuranceClass).toBe("large"); // 1 700 kg curb
    expect(est({ curbMassKg: null, totalMassKg: null }).insuranceClass).toBe("unknown-size");
  });

  it("lets the user's quote override the estimate in the TCO", () => {
    const l = parseListingText(fixture("a6.txt"));
    const car = carInputsFromListing(l);
    const a = defaultAssumptions(l.powertrain);
    const estimated = computeTco(car, a, new Date("2026-11-12"));
    expect(estimated.insurance.fromQuote).toBe(false);
    const quoted = computeTco({ ...car, insuranceOverride: 700 }, a, new Date("2026-11-12"));
    expect(quoted.insurance).toMatchObject({ used: 700, fromQuote: true });
    expect(quoted.lines.find((x) => x.key === "insurance")!.total).toBe(2100);
  });

  it("keeps a customised old global insurance setting as the car's quote", () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const l = parseListingText(fixture("a6.txt"));
    // A car saved before power, curb mass and insurance quotes were part of the inputs.
    const oldCar: Record<string, unknown> = { ...carInputsFromListing(l) };
    for (const k of ["powerKw", "curbMassKg", "insuranceOverride"]) delete oldCar[k];
    const mk = (id: string, insurancePerYear: number) => ({
      id, savedAt: "", listing: l, car: oldCar, assumptions: { ...defaultAssumptions(l.powertrain), insurancePerYear },
    });
    store.set("cartco.saved.v1", JSON.stringify([mk("custom", 850), mk("default", 600)]));
    const [custom, dflt] = loadSaved();
    expect(custom.car).toMatchObject({ insuranceOverride: 850, powerKw: 150, curbMassKg: 1845 });
    expect(dflt.car.insuranceOverride).toBeNull();
    expect("insurancePerYear" in custom.assumptions).toBe(false);
  });
});

describe("car-free alternatives", () => {
  const a = { ...defaultAssumptions("petrol"), years: 3, kmPerYear: 15000, expectedReturn: 0.06 };

  it("prices a 30-day season ticket and a monthly bike budget per year", () => {
    // Ticket ≈ 1 343 €/yr + 2 rides × 20 € × 12 = 480 €/yr.
    expect(alternativePerYear("transit", DEFAULT_ALTERNATIVES)).toBeCloseTo((110.4 * 365) / 30 + 480, 6);
    const noRides = { ...DEFAULT_ALTERNATIVES, transit: { ...DEFAULT_ALTERNATIVES.transit, ridesPerMonth: 0 } };
    expect(alternativePerYear("transit", noRides)).toBeCloseTo((110.4 * 365) / 30, 6);
    expect(alternativePerYear("bike", DEFAULT_ALTERNATIVES)).toBe(600);
  });

  it("adds lost returns on the monthly payments, like a car's running costs", () => {
    const t = computeAlternative("transit", DEFAULT_ALTERNATIVES, a);
    expect(t.spend).toBeCloseTo(3 * ((110.4 * 365) / 30 + 480), 6);
    expect(t.rides).toBeCloseTo(3 * 480, 6);
    expect(t.lostReturns).toBeGreaterThan(0);
    expect(t.lostReturns).toBeLessThan(t.spend * (1.06 ** 3 - 1)); // paid monthly, not up front
    expect(t.total).toBeCloseTo(t.spend + t.lostReturns, 6);
    expect(t.perKm).toBeCloseTo(t.total / 45000, 9);
  });

  it("follows the lost-returns settings", () => {
    const off = computeAlternative("bike", DEFAULT_ALTERNATIVES, { ...a, opportunityOn: { ...a.opportunityOn, running: false } });
    expect(off.lostReturns).toBe(0);
    const chart = computeAlternative("bike", DEFAULT_ALTERNATIVES, { ...a, opportunityMode: "chart" });
    expect(chart.lostReturns).toBeGreaterThan(0);
    expect(chart.total).toBe(chart.spend);
  });
});
