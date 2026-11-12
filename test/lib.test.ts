import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseListingUrl, parseListing } from "../src/lib/listing";
import { annualVehicleTax } from "../src/lib/tax";
import {
  carInputsFromListing,
  computeTco,
  defaultAssumptions,
  inspectionsDuring,
  loanInterest,
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
  it("computes loan interest for an annuity", () => {
    expect(loanInterest(10000, 0, 5, 60)).toBe(0);
    const full = loanInterest(10000, 0.06, 5, 60);
    expect(full).toBeGreaterThan(1590);
    expect(full).toBeLessThan(1610);
  });
  it("produces a consistent breakdown", () => {
    const l = parseListing(fixture("a6.html"), "https://www.nettiauto.com/audi/a6/15911646");
    const r = computeTco(carInputsFromListing(l), defaultAssumptions(l.powertrain), new Date("2026-11-12"));
    const sum = r.lines.reduce((s, x) => s + x.total, 0);
    expect(r.total).toBeCloseTo(sum, 6);
    expect(r.perMonth).toBeCloseTo(r.total / 36, 6);
    expect(r.lines.find((x) => x.key === "inspections")!.total).toBe(120); // ages ~5.6→8.6: due at 6 and 8
  });
});
