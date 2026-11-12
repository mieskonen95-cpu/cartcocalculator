import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeListingText, normaliseListingUrl, parseListing, parseListingText } from "../src/lib/listing";
import { annualVehicleTax } from "../src/lib/tax";
import {
  carInputsFromListing,
  computeTco,
  defaultAssumptions,
  inspectionsDuring,
  simulateOwnership,
  type Assumptions,
} from "../src/lib/tco";

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

  it("maps Finnish fuel names", () => {
    const t = (m: string) => parseListingText(`Auto\n10 000 €\nMoottori\n${m}\nVuosimalli\n2020`).powertrain;
    expect(t("1,5 l, Bensiini")).toBe("petrol");
    expect(t("2,0 l, Diesel")).toBe("diesel");
    expect(t("Sähkö")).toBe("electric");
    expect(t("1,8 l, Hybridi (bensiini/sähkö)")).toBe("hybrid-petrol");
    expect(t("2,0 l, Lataushybridi (bensiini/sähkö)")).toBe("phev-petrol");
  });
});
