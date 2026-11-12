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
  /** Which cash outflows are charged the forgone investment return. */
  opportunityOn: Record<OutflowKind, boolean>;
}

/** Kinds of money leaving your pocket during ownership. */
export type OutflowKind = "equity" | "principal" | "interest" | "running";

export const OUTFLOW_LABELS: Record<OutflowKind, string> = {
  equity: "Lump sum / down payment",
  principal: "Loan repayments",
  interest: "Interest payments",
  running: "Running costs",
};

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
    opportunityOn: { equity: true, principal: true, interest: true, running: true },
  };
}

export function carInputsFromListing(l: Listing): CarInputs {
  return {
    price: l.price ?? 0,
    powertrain: l.powertrain,
    // A plug-in's official fuel figure is a weighted mix dominated by electric driving, so it
    // can't be used for the share driven on fuel. Leave it empty to use a typical value.
    fuelConsumption: l.powertrain.startsWith("phev") ? null : l.fuelConsumption,
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
  /** The selected financing option. */
  financing: Scenario;
  /** Both options side by side, for comparison. TCO = net cash cost + opportunity cost. */
  scenarios: Record<"cash" | "loan", Scenario & { tco: number }>;
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
      // For plug-ins, `fuelConsumption` means consumption when running on petrol/diesel.
      const fuelMode = (car.fuelConsumption ?? d.fuel) * a.realWorldFactor;
      return per100(s * kwh * a.electricityPrice + (1 - s) * fuelMode * price);
    }
    case "gas":
      return per100(fuelL * a.gasPrice);
    default:
      return per100(fuelL * a.petrolPrice);
  }
}

export interface Scenario {
  financing: "cash" | "loan";
  /** Own money put into the car up front. */
  equity: number;
  loanAmount: number;
  monthlyPayment: number;
  /** Interest paid during the ownership period. */
  interest: number;
  /** Loan still outstanding when the car is sold (paid off from the sale). */
  remainingBalance: number;
  /** Cash back at the end: resale value minus any remaining loan. */
  saleProceeds: number;
  /** Everything paid out during ownership (purchase, loan payments, running costs). */
  totalPaidOut: number;
  /** Forgone investment return on the outflows switched on in `opportunityOn`. */
  opportunityCost: number;
  opportunityByKind: Record<OutflowKind, number>;
  /**
   * Cumulative net cash position (≤ 0) at the end of each month, index 0 = purchase day.
   * The sale is not included; add `saleProceeds` at the last point.
   */
  cumulativeCash: number[];
}

/** Monthly payment of an annuity loan. */
export function annuityPayment(principal: number, annualRate: number, termYears: number): number {
  const n = Math.max(1, Math.round(termYears * 12));
  const r = annualRate / 12;
  return r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * Simulates the cash flows of ownership month by month.
 *
 * Opportunity cost: each euro paid out could otherwise have been invested at `expectedReturn`
 * until the car is sold. For every outflow kind switched on, we add the growth that money would
 * have had. Running costs and loan payments are paid at the end of each month; the lump sum or
 * down payment on day 0. The car's loss in value is already counted as depreciation.
 */
export function simulateOwnership(
  price: number,
  a: Assumptions,
  financing: "cash" | "loan",
  months: number,
  runningPerMonth: number,
  residualValue: number,
): Scenario {
  const loan = financing === "loan";
  const equity = loan ? Math.min(Math.max(0, a.downPayment), price) : price;
  const loanAmount = loan ? price - equity : 0;
  const n = Math.max(1, Math.round(a.loanTermYears * 12));
  const rLoan = a.loanInterestRate / 12;
  const payment = loanAmount > 0 ? annuityPayment(loanAmount, a.loanInterestRate, a.loanTermYears) : 0;
  const growth = (monthsInvested: number) => Math.pow(1 + a.expectedReturn, monthsInvested / 12) - 1;

  const opp: Record<OutflowKind, number> = { equity: 0, principal: 0, interest: 0, running: 0 };
  const charge = (kind: OutflowKind, amount: number, month: number) => {
    if (a.opportunityOn[kind]) opp[kind] += amount * growth(months - month);
  };

  let balance = loanAmount;
  let interest = 0;
  let cash = -equity;
  let paidOut = equity;
  const cumulativeCash = [cash];
  charge("equity", equity, 0);

  for (let m = 1; m <= months; m++) {
    let out = runningPerMonth;
    charge("running", runningPerMonth, m);
    if (balance > 0 && m <= n) {
      const it = balance * rLoan;
      const principal = Math.min(balance, payment - it);
      interest += it;
      balance -= principal;
      out += it + principal;
      charge("interest", it, m);
      charge("principal", principal, m);
    }
    cash -= out;
    paidOut += out;
    cumulativeCash.push(cash);
  }

  const remainingBalance = Math.max(0, balance);
  return {
    financing,
    equity,
    loanAmount,
    monthlyPayment: payment,
    interest,
    remainingBalance,
    saleProceeds: residualValue - remainingBalance,
    totalPaidOut: paidOut,
    opportunityCost: opp.equity + opp.principal + opp.interest + opp.running,
    opportunityByKind: opp,
    cumulativeCash,
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

  const running: CostLine[] = [
    { key: "energy", label: car.powertrain === "electric" ? "Electricity" : "Fuel & charging", total: energyPerYear * years },
    { key: "tax", label: "Vehicle tax", total: taxPerYear * years },
    { key: "insurance", label: "Insurance", total: a.insurancePerYear * years },
    { key: "maintenance", label: "Maintenance, repairs & tyres", total: maintenance },
    { key: "inspections", label: "Inspections", total: inspectionsDuring(age, years) * a.inspectionCost },
  ];
  const runningTotal = running.reduce((s, l) => s + l.total, 0);
  const months = Math.max(1, Math.round(years * 12));
  const scenario = (f: "cash" | "loan") => {
    const sc = simulateOwnership(car.price, a, f, months, runningTotal / months, residualValue);
    return { ...sc, tco: depreciation + runningTotal + sc.interest + sc.opportunityCost };
  };
  const scenarios = { cash: scenario("cash"), loan: scenario("loan") };
  const financing = scenarios[a.financing];

  const lines: CostLine[] = [
    { key: "depreciation", label: "Depreciation", total: depreciation },
    ...running,
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
    scenarios,
  };
}
