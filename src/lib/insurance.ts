/**
 * Car insurance estimate (traffic insurance + full comprehensive cover, €/year).
 *
 * Calibrated on five Fennia "laaja kasko" quotes for one driver (November 2026):
 *
 *   Ford Focus, petrol     €6 000  → €560     Volvo XC60          €18 390 → €906
 *   Ford Focus, petrol    €17 000  → €593     Tesla Model 3       €19 990 → €1 205
 *   VW Passat, diesel     €15 880  → €869
 *
 * What the quotes show: the car's price matters little (same model at nearly 3× the price is
 * only €33/year more), while size and electric drive matter a lot. Model:
 *
 *   (€540 + €3 per €1 000 of price) × factor
 *   factor: 1.0 ordinary car, 1.5 large/heavy car (curb mass ≥ 1 450 kg), 2.0 electric
 *
 * Powerful cars can't be quoted online; they get a flat, deliberately high placeholder
 * (2× the highest quote) until the user enters a real quote.
 *
 * This reflects one driver's bonus, age and region. It's a rough guide, not a quote.
 */
import type { Powertrain } from "./listing";

export const INSURANCE_BASE = 540;
export const INSURANCE_PER_1000_EUR = 3;
export const LARGE_CAR_CURB_KG = 1450;
export const HIGHEST_QUOTE = 1205.33;
export const HIGH_POWER_PLACEHOLDER = Math.round(2 * HIGHEST_QUOTE);

export type InsuranceClass = "ordinary" | "large" | "electric" | "high-power" | "unknown-size";

export const CLASS_FACTOR: Record<Exclude<InsuranceClass, "high-power">, number> = {
  ordinary: 1.0,
  "unknown-size": 1.25,
  large: 1.5,
  electric: 2.0,
};

export interface InsuranceInput {
  price: number;
  powertrain: Powertrain;
  powerKw: number | null;
  curbMassKg: number | null;
  totalMassKg: number | null;
}

export interface InsuranceEstimate {
  perYear: number;
  insuranceClass: InsuranceClass;
  /** Plain-language reason, shown next to the figure. */
  reason: string;
}

/**
 * Cars online quote forms refuse. Non-electric 200+ kW couldn't be quoted; electric cars are
 * routinely 200–260 kW (a Tesla Model 3 was quotable), so only performance EVs (300+ kW) count.
 */
export function isHighPower(powertrain: Powertrain, powerKw: number | null): boolean {
  if (powerKw === null) return false;
  return powertrain === "electric" ? powerKw >= 300 : powerKw >= 200;
}

export function estimateInsurance(car: InsuranceInput): InsuranceEstimate {
  if (isHighPower(car.powertrain, car.powerKw)) {
    return {
      perYear: HIGH_POWER_PLACEHOLDER,
      insuranceClass: "high-power",
      reason: `${car.powerKw} kW is too powerful for online quotes, so this is a high placeholder. Get a quote from an insurer.`,
    };
  }

  // Curb mass, or estimate it from total mass (gross mass is typically ~500 kg more).
  const curb = car.curbMassKg ?? (car.totalMassKg !== null ? car.totalMassKg - 500 : null);
  const insuranceClass: InsuranceClass =
    car.powertrain === "electric"
      ? "electric"
      : curb === null
        ? "unknown-size"
        : curb >= LARGE_CAR_CURB_KG
          ? "large"
          : "ordinary";

  const base = INSURANCE_BASE + (INSURANCE_PER_1000_EUR * Math.max(0, car.price)) / 1000;
  const reason = {
    electric: "Electric cars cost about twice as much to insure as an ordinary car.",
    large: "Large or heavy car (1 450 kg or more): about 1.5× an ordinary car.",
    ordinary: "Ordinary-sized car.",
    "unknown-size": "Car size unknown, so between an ordinary and a large car. Enter the total mass to sharpen this.",
  }[insuranceClass];

  return { perYear: Math.round(base * CLASS_FACTOR[insuranceClass]), insuranceClass, reason };
}
