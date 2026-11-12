import type { Listing, Powertrain } from "./listing";
import { annualVehicleTax, type TaxResult } from "./tax";

export interface Assumptions {
  years: number;
  kmPerYear: number;
  petrolPrice: number; // €/l (95E10)
  dieselPrice: number; // €/l
  electricityPrice: number; // €/kWh incl. transfer and taxes
  gasPrice: number; // €/kg
  /** Official consumption figures understate real driving; multiply by this. */
  realWorldFactor: number;
  /** Share of km a plug-in hybrid drives on electricity (0–1). */
  phevElectricShare: number;
  insurancePerYear: number;
  /** Maintenance + repairs + tyres, €/km, before the age multiplier. */
  maintenancePerKm: number;
  /** Annual depreciation as a fraction of current value. */
  depreciationRate: number;
  inspectionCost: number;
  /** "cash": paid as a lump sum. "loan": down payment from own funds, the rest financed. */
  financing: "cash" | "loan";
  /** Own equity put in up front when financing, EUR. */
  downPayment: number;
  loanInterestRate: number; // annual, e.g. 0.059
  loanTermYears: number;
  /** Expected annual return on money left invested instead (e.g. stock market, after tax). */
  expectedReturn: number;
}

/** Overrides the user can apply to values parsed from the listing. */
export interface CarInputs {
  price: number;
  powertrain: Powertrain;
  fuelConsumption: number | null; // l/100km (or kg/100km for gas)
  electricConsumption: number | null; // kWh/100km
  co2: number | null;
  totalMassKg: number | null;
  commissionedOn: string | null;
  modelYear: number | null;
  /** Manual vehicle tax override, €/year. */
  vehicleTaxOverride: number | null;
}

export const DEFAULT_CONSUMPTION: Record<Powertrain, { fuel: number; electric: number }> = {
  petrol: { fuel: 7.0, electric: 0 },
  diesel: { fuel: 6.0, electric: 0 },
  electric: { fuel: 0, electric: 18 },
  "hybrid-petrol": { fuel: 5.0, electric: 0 },
  "hybrid-diesel": { fuel: 5.0, electric: 0 },
  "phev-petrol": { fuel: 6.5, electric: 20 },
  "phev-diesel": { fuel: 6.0, electric: 20 },
  gas: { fuel: 5.0, electric: 0 },
  other: { fuel: 7.0, electric: 0 },
};

export function defaultAssumptions(powertrain: Powertrain): Assumptions {
  const ev = powertrain === "electric";
  return {
    years: 3,
    kmPerYear: 15000,
    petrolPrice: 1.85,
    dieselPrice: 1.8,
    electricityPrice: 0.18,
    gasPrice: 2.0,
    realWorldFactor: 1.15,
    phevElectricShare: 0.4,
    insurancePerYear: 600,
    maintenancePerKm: ev ? 0.03 : powertrain.startsWith("hybrid") || powertrain.startsWith("phev") ? 0.045 : 0.05,
    depreciationRate: ev ? 0.14 : 0.11,
    inspectionCost: 60,
    financing: "cash",
    downPayment: 5000,
    loanInterestRate: 0.059,
    loanTermYears: 5,
    expectedReturn: 0.06,
  };
}

export function carInputsFromListing(l: Listing): CarInputs {
  return {
    price: l.price ?? 0,
    powertrain: l.powertrain,
    fuelConsumption: l.fuelConsumption,
    electricConsumption: l.electricConsumption,
    co2: l.co2,
    // Listings often show only curb mass; gross mass is typically ~500 kg more.
    totalMassKg: l.totalMassKg ?? (l.curbMassKg ? l.curbMassKg + 500 : null),
    commissionedOn: l.commissionedOn,
    modelYear: l.modelYear,
    vehicleTaxOverride: null,
  };
}

export interface CostLine {
  key: "depreciation" | "energy" | "tax" | "insurance" | "maintenance" | "inspections" | "interest" | "opportunity";
  label: string;
  total: number;
}

export interface TcoResult {
  lines: CostLine[];
  total: number;
  perYear: number;
  perMonth: number;
  perKm: number;
  residualValue: number;
  tax: TaxResult;
  energyPerYear: number;
  financing: FinancingResult;
}

/** Car age in years at the start of ownership. */
export function carAge(car: CarInputs, today: Date): number {
  if (car.commissionedOn) {
    const d = new Date(car.commissionedOn);
    return Math.max(0, (today.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  }
  if (car.modelYear) return Math.max(0, today.getFullYear() - car.modelYear + 0.5);
  return 5;
}

/**
 * Finnish periodic inspections: first at 4 years, then at 6 and 8, then annually.
 * Counts inspections falling in (ageStart, ageStart + years].
 */
export function inspectionsDuring(ageStart: number, years: number): number {
  let count = 0;
  for (let due = 4; due <= ageStart + years; due = due < 8 ? due + 2 : due + 1) {
    if (due > ageStart) count++;
  }
  return count;
}

export function energyCostPerYear(car: CarInputs, a: Assumptions): number {
  const d = DEFAULT_CONSUMPTION[car.powertrain];
  const fuelL = (car.fuelConsumption ?? d.fuel) * a.realWorldFactor;
  const kwh = (car.electricConsumption ?? d.electric) * a.realWorldFactor;
  const km = a.kmPerYear;
  const per100 = (n: number) => (km / 100) * n;

  switch (car.powertrain) {
    case "electric":
      return per100(kwh * a.electricityPrice);
    case "diesel":
    case "hybrid-diesel":
      return per100(fuelL * a.dieselPrice);
    case "phev-petrol":
    case "phev-diesel": {
      const price = car.powertrain === "phev-diesel" ? a.dieselPrice : a.petrolPrice;
      const s = Math.min(1, Math.max(0, a.phevElectricShare));
      // Official PHEV fuel figures are heavily weighted to electric driving; use the default
      // combustion-mode figure for the fuel share.
      const fuelMode = d.fuel * a.realWorldFactor;
      return per100(s * kwh * a.electricityPrice + (1 - s) * fuelMode * price);
    }
    case "gas":
      return per100(fuelL * a.gasPrice);
    default:
      return per100(fuelL * a.petrolPrice);
  }
}

export interface FinancingResult {
  /** Own money put into the car up front. */
  equity: number;
  loanAmount: number;
  monthlyPayment: number;
  /** Interest paid during the ownership period. */
  interest: number;
  /** Investment return forgone on own money tied up in the car during the ownership period. */
  opportunityCost: number;
  /** Loan still outstanding when the car is sold (paid off from the sale). */
  remainingBalance: number;
}

/** Monthly payment of an annuity loan. */
export function annuityPayment(principal: number, annualRate: number, termYears: number): number {
  const n = Math.max(1, Math.round(termYears * 12));
  const r = annualRate / 12;
  return r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * Simulates the ownership period month by month.
 *
 * Opportunity cost: every euro of own money in the car (the lump sum, or the down payment plus
 * loan principal as it is repaid) could otherwise have been invested at `expectedReturn`. We
 * track what that money would have grown to; the growth is the opportunity cost. The car's
 * loss in value is already counted as depreciation, so only the forgone return is added here.
 */
export function financingCosts(price: number, a: Assumptions, months: number): FinancingResult {
  const loan = a.financing === "loan";
  const equity = loan ? Math.min(Math.max(0, a.downPayment), price) : price;
  const loanAmount = loan ? price - equity : 0;
  const n = Math.max(1, Math.round(a.loanTermYears * 12));
  const rLoan = a.loanInterestRate / 12;
  const rInvest = Math.pow(1 + a.expectedReturn, 1 / 12) - 1;
  const payment = loanAmount > 0 ? annuityPayment(loanAmount, a.loanInterestRate, a.loanTermYears) : 0;

  let balance = loanAmount;
  let interest = 0;
  let contributed = equity;
  let invested = equity; // what our own contributions would be worth if invested instead

  for (let m = 0; m < months; m++) {
    invested *= 1 + rInvest;
    if (balance > 0 && m < n) {
      const it = balance * rLoan;
      const principal = Math.min(balance, payment - it);
      interest += it;
      balance -= principal;
      contributed += principal;
      invested += principal;
    }
  }

  return {
    equity,
    loanAmount,
    monthlyPayment: payment,
    interest,
    opportunityCost: invested - contributed,
    remainingBalance: Math.max(0, balance),
  };
}

export function computeTco(car: CarInputs, a: Assumptions, today = new Date()): TcoResult {
  const years = Math.max(0.1, a.years);
  const km = a.kmPerYear * years;
  const age = carAge(car, today);

  const residualValue = car.price * Math.pow(1 - a.depreciationRate, years);
  const depreciation = car.price - residualValue;

  const energyPerYear = energyCostPerYear(car, a);

  const tax = annualVehicleTax({
    powertrain: car.powertrain,
    co2: car.co2,
    totalMassKg: car.totalMassKg,
    commissionedOn: car.commissionedOn,
  });
  const taxPerYear = car.vehicleTaxOverride ?? tax.total;

  // Running costs rise with age: +4 % per year beyond 3 years old, capped at 2×.
  const midAge = age + years / 2;
  const ageMultiplier = Math.min(2, 1 + 0.04 * Math.max(0, midAge - 3));
  const maintenance = km * a.maintenancePerKm * ageMultiplier;

  const financing = financingCosts(car.price, a, Math.round(years * 12));

  const lines: CostLine[] = [
    { key: "depreciation", label: "Depreciation", total: depreciation },
    { key: "energy", label: car.powertrain === "electric" ? "Electricity" : "Fuel & charging", total: energyPerYear * years },
    { key: "tax", label: "Vehicle tax", total: taxPerYear * years },
    { key: "insurance", label: "Insurance", total: a.insurancePerYear * years },
    { key: "maintenance", label: "Maintenance, repairs & tyres", total: maintenance },
    { key: "inspections", label: "Inspections", total: inspectionsDuring(age, years) * a.inspectionCost },
    { key: "interest", label: "Loan interest", total: financing.interest },
    { key: "opportunity", label: "Opportunity cost (lost returns)", total: financing.opportunityCost },
  ];

  const total = lines.reduce((s, l) => s + l.total, 0);
  return {
    lines,
    total,
    perYear: total / years,
    perMonth: total / (years * 12),
    perKm: km > 0 ? total / km : 0,
    residualValue,
    tax,
    energyPerYear,
    financing,
  };
}
