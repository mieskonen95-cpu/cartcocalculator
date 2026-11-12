/**
 * Finnish annual vehicle tax (ajoneuvovero) for passenger cars, 2026 rates.
 *
 * Vehicle tax = basic tax (perusvero) + driving power tax (käyttövoimavero).
 *
 * Sources (read 2026-11-12):
 *  - https://traficom.fi/en/transport/drivers-and-vehicles/vehicle-taxation/vehicle-tax-amount
 *  - https://www.veronmaksajat.fi/neuvot/henkiloverotus/asuminen-ja-auto/autoilun-verotus/ajoneuvovero-perusvero-ja-kayttovoimavero/
 *
 * Exact: EV fixed basic tax, driving power tax rates, the flat minimum band.
 * APPROXIMATE: the CO2 → basic tax curve above ~100 g/km is interpolated between
 * anchor points; the official per-g/km table (ajoneuvoverolaki 1281/2003, VEROTAULUKKO 1 / 1 A)
 * should replace it. See TODO below.
 */
import type { Powertrain } from "./listing";

const DAYS = 365;

/** Driving power tax, cents/day per started 100 kg of total mass. */
export const DRIVING_POWER_CENTS: Record<Powertrain, number> = {
  petrol: 0,
  "hybrid-petrol": 0,
  diesel: 5.5,
  "hybrid-diesel": 5.5,
  electric: 1.9,
  "phev-petrol": 0.95,
  "phev-diesel": 3.6,
  gas: 3.1,
  other: 0,
};

export const MIN_BASIC_TAX = 106.21;
export const EV_BASIC_TAX_OLD = 106.21; // commissioned on or before 2021-09-30
export const EV_BASIC_TAX_NEW = 171.18; // commissioned on or after 2021-10-01

/**
 * NEDC CO2 (g/km) → basic tax (€/year).
 * 0–82 g/km and 90/100 g/km points are official 2026 figures; points from 120 g/km up are
 * TODO estimates following the shape of earlier years' tables, pending the official 2026 table.
 */
const NEDC_ANCHORS: [number, number][] = [
  [0, MIN_BASIC_TAX],
  [82, MIN_BASIC_TAX],
  [90, 113.88],
  [100, 125.56],
  [120, 151],
  [150, 196],
  [200, 290],
  [250, 390],
  [300, 485],
  [400, 655],
];
/** The WLTP table's flat band ends at 102 g/km vs 82 for NEDC; approximate it as a 20 g/km shift. */
const WLTP_SHIFT = 20;
/** Cars first registered from 2018-09-01 are generally taxed on their WLTP value. */
const WLTP_FROM = "2018-09-01";

function interpolate(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const [xa, ya] = points[points.length - 2];
  const [xb, yb] = points[points.length - 1];
  return yb + ((yb - ya) / (xb - xa)) * (x - xb);
}

export interface TaxInput {
  powertrain: Powertrain;
  co2: number | null;
  totalMassKg: number | null;
  commissionedOn: string | null;
}

export interface TaxResult {
  basic: number;
  drivingPower: number;
  total: number;
  /** True when part of the figure is an approximation rather than an exact rate. */
  estimated: boolean;
  notes: string[];
}

export function annualVehicleTax(input: TaxInput): TaxResult {
  const notes: string[] = [];
  let estimated = false;
  let basic: number;

  if (input.powertrain === "electric") {
    const old = input.commissionedOn !== null && input.commissionedOn <= "2021-09-30";
    basic = old ? EV_BASIC_TAX_OLD : EV_BASIC_TAX_NEW;
    if (!input.commissionedOn) notes.push("Commissioning date unknown; assumed after 2021-09-30.");
  } else if (input.co2 !== null) {
    const wltp = input.commissionedOn === null || input.commissionedOn >= WLTP_FROM;
    const co2 = wltp ? Math.max(0, input.co2 - WLTP_SHIFT) : input.co2;
    basic = interpolate(NEDC_ANCHORS, co2);
    if (co2 > 100) estimated = true;
    notes.push(`Basic tax from ${input.co2} g/km (${wltp ? "WLTP" : "NEDC"}).`);
  } else {
    basic = interpolate(NEDC_ANCHORS, 150);
    estimated = true;
    notes.push("No CO2 value in listing; assumed a mid-range basic tax.");
  }

  const cents = DRIVING_POWER_CENTS[input.powertrain];
  let drivingPower = 0;
  if (cents > 0) {
    if (input.totalMassKg) {
      drivingPower = (Math.ceil(input.totalMassKg / 100) * cents * DAYS) / 100;
    } else {
      drivingPower = (Math.ceil(2000 / 100) * cents * DAYS) / 100;
      estimated = true;
      notes.push("Total mass unknown; driving power tax assumes 2 000 kg.");
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    basic: round(basic),
    drivingPower: round(drivingPower),
    total: round(basic + drivingPower),
    estimated,
    notes,
  };
}
