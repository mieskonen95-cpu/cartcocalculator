/**
 * Parsing of nettiauto.com listing pages.
 *
 * A listing page carries three useful sources of data:
 *  1. schema.org JSON-LD (`<script type="application/ld+json">`): name, price, year, mileage, images.
 *  2. An analytics blob (`window.digitalData` → `productInfo`): fuel type, consumption, CO2, etc.
 *  3. The human-readable spec table: masses, commissioning date, power, battery capacity.
 */

export type Powertrain =
  | "petrol"
  | "diesel"
  | "electric"
  | "hybrid-petrol" // non-plug-in petrol hybrid
  | "hybrid-diesel" // non-plug-in diesel hybrid
  | "phev-petrol"
  | "phev-diesel"
  | "gas"
  | "other";

export interface Listing {
  id: string;
  url: string;
  title: string;
  /** Asking price in EUR. */
  price: number | null;
  modelYear: number | null;
  mileageKm: number | null;
  fuelTypeRaw: string | null;
  powertrain: Powertrain;
  /** Combined fuel consumption, l/100 km (official figure). */
  fuelConsumption: number | null;
  /** Combined electricity consumption, kWh/100 km (official figure). */
  electricConsumption: number | null;
  co2: number | null;
  curbMassKg: number | null;
  totalMassKg: number | null;
  /** Date first put into service, ISO yyyy-mm-dd. */
  commissionedOn: string | null;
  powerKw: number | null;
  batteryKwh: number | null;
  imageUrl: string | null;
  registrationNumber: string | null;
  seller: string | null;
}

const LISTING_PATH = /^\/[a-z0-9-]+\/[a-z0-9-]+\/(\d{5,})\/?$/i;

/** Validates and normalises a nettiauto listing URL. Returns null if it isn't one. */
export function normaliseListingUrl(input: string): { url: string; id: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname !== "www.nettiauto.com" && u.hostname !== "nettiauto.com") return null;
  const m = u.pathname.match(LISTING_PATH);
  if (!m) return null;
  return { url: `https://www.nettiauto.com${u.pathname.replace(/\/$/, "")}`, id: m[1] };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&shy;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Strip tags and collapse whitespace so spec labels and values sit next to each other. */
function pageText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ");
}

function extractJsonLd(html: string): Record<string, unknown> | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(re)) {
    try {
      const data = JSON.parse(m[1]);
      const types = ([] as unknown[]).concat(data["@type"]);
      if (types.includes("Car") || types.includes("Product")) return data;
    } catch {
      /* ignore malformed blocks */
    }
  }
  return null;
}

function extractProductInfo(html: string): Record<string, unknown> | null {
  const i = html.indexOf('"productInfo":');
  if (i < 0) return null;
  // Walk braces to find the end of the object (strings may contain braces, so track quotes).
  const start = html.indexOf("{", i);
  let depth = 0;
  let inStr = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, j + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Read a "<label> 1 845 kg"-style number from the spec text. */
function specNumber(text: string, label: string, unit: string): number | null {
  const re = new RegExp(`${label}\\s+([\\d ]+(?:,\\d+)?)\\s*${unit}`, "i");
  const m = text.match(re);
  return m ? num(m[1].replace(/ /g, "")) : null;
}

function specDate(text: string): string | null {
  const m = text.match(/Käyttöönottopäivä(?:määrä)?\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function classifyPowertrain(fuelType: string | null, isPlugIn: boolean): Powertrain {
  const f = (fuelType ?? "").toLowerCase();
  if (!f) return "other";
  if (f.includes("hybrid")) {
    const diesel = f.includes("diesel");
    if (isPlugIn) return diesel ? "phev-diesel" : "phev-petrol";
    return diesel ? "hybrid-diesel" : "hybrid-petrol";
  }
  if (f.includes("electric")) return "electric";
  if (f.includes("diesel")) return "diesel";
  if (f.includes("petrol") || f.includes("gasoline")) return "petrol";
  if (f.includes("gas")) return "gas";
  return "other";
}

export function parseListing(html: string, url: string): Listing {
  const ld = extractJsonLd(html) ?? {};
  const pi = extractProductInfo(html) ?? {};
  const text = pageText(html);

  const offers = (ld.offers ?? {}) as Record<string, unknown>;
  const seller = (offers.seller ?? {}) as Record<string, unknown>;
  const odometer = (ld.mileageFromOdometer ?? {}) as Record<string, unknown>;
  const fuelC = (pi.fuelConsumption ?? {}) as Record<string, unknown>;
  const elecC = (pi.electricConsumption ?? {}) as Record<string, unknown>;
  const images = ([] as unknown[]).concat(ld.image ?? []);

  const fuelTypeRaw = typeof pi.fuelType === "string" ? pi.fuelType : null;
  const electricConsumption = positive(elecC.electricConsumptionCombined);
  const batteryKwh = specNumber(text, "Akkukapasiteetti", "kWh");
  // Don't search the whole page: the site navigation links to "Plug-in hybridit" everywhere.
  const engineLine = text.match(/Moottori\s+[^|]{0,80}/)?.[0] ?? "";
  const isPlugIn =
    electricConsumption !== null ||
    (batteryKwh !== null && batteryKwh >= 5) ||
    /lataushybridi|plug-?in|phev/i.test(`${ld.name ?? ""} ${pi.productName ?? ""} ${engineLine}`);

  const title =
    (typeof ld.name === "string" && ld.name) ||
    [pi.vehicleBrand, pi.vehicleModel, pi.productName].filter(Boolean).join(" ") ||
    "Unknown car";

  return {
    id: normaliseListingUrl(url)?.id ?? String(pi.productID ?? ""),
    url,
    title: decodeEntities(title),
    price: positive(offers.price) ?? positive(pi.basePrice),
    modelYear: positive(ld.vehicleModelDate) ?? positive(pi.productionDate),
    mileageKm: num(odometer.value) ?? num(pi.mileageFromOdometer),
    fuelTypeRaw,
    powertrain: classifyPowertrain(fuelTypeRaw, isPlugIn),
    fuelConsumption: positive(fuelC.fuelConsumptionCombined),
    electricConsumption,
    co2: num(pi.emissionsCO2),
    curbMassKg: specNumber(text, "Omamassa", "kg"),
    totalMassKg: specNumber(text, "Kokonaismassa", "kg"),
    commissionedOn: specDate(text),
    powerKw: specNumber(text, "Teho", "kW"),
    batteryKwh,
    imageUrl: typeof images[0] === "string" ? images[0] : null,
    registrationNumber: typeof pi.registrationNumber === "string" ? pi.registrationNumber : null,
    seller: typeof seller.name === "string" ? seller.name : null,
  };
}

/* ------------------------------------------------------------------------------------------ *
 * Parsing text copied from a listing page (select all → copy → paste).                        *
 * Used when nettiauto.com refuses server-side requests: the user's own browser has the page,  *
 * so they paste its text instead. Labels are Finnish; values follow on the same line          *
 * (after a tab or colon) or on the next line, depending on browser.                           *
 * ------------------------------------------------------------------------------------------ */

/** Finnish fuel names → the English names used by `classifyPowertrain`. */
function finnishFuelToEnglish(s: string): string {
  return s
    .toLowerCase()
    .replace(/lataushybridi/g, "hybrid plug-in")
    .replace(/hybridi/g, "hybrid")
    .replace(/bensiini/g, "petrol")
    .replace(/sähkö/g, "electric")
    .replace(/kaasu/g, "gas");
}

/** Value for a spec label: the rest of the label's line, or the next non-empty line. */
function textField(lines: string[], label: string): string | null {
  const re = new RegExp(`^${label}\\s*(?:[:\\t]\\s*|\\s{2,})?(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    if (m[1].trim()) return m[1].trim();
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next) return next.trim();
  }
  return null;
}

const firstNumber = (s: string | null): number | null => {
  const m = s?.match(/\d[\d ]*(?:,\d+)?/);
  return m ? num(m[0].replace(/ /g, "")) : null;
};

const EURO_LINE = /^(\d{1,3}(?: \d{3})*) ?€$/;

export function looksLikeListingText(text: string): boolean {
  return /Mittarilukema|Vuosimalli|Rekisterinumero|Käyttöönottopäivä/i.test(text);
}

export function parseListingText(raw: string): Listing {
  const text = raw.replace(/[   ]/g, " ").replace(/­/g, "").replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim());
  const field = (label: string) => textField(lines, label);

  // The asking price is the first euro amount on its own line; the title sits just above it.
  const priceIdx = lines.findIndex((l) => EURO_LINE.test(l));
  const basePrice = priceIdx >= 0 ? firstNumber(lines[priceIdx]) : null;
  const officeFee = firstNumber(field("Toimistomaksu"));
  const price = basePrice !== null ? basePrice + (officeFee ?? 0) : null;
  const titleAbove = lines
    .slice(0, Math.max(0, priceIdx))
    .reverse()
    .find((l) => l && !/^PÄIVITETTY|^UUSI|^\d+H$/i.test(l));
  const variant = priceIdx >= 0 ? lines.slice(priceIdx + 1).find((l) => l) : undefined;
  const title = [titleAbove, variant && !/^Päivitetty/i.test(variant) ? variant : null].filter(Boolean).join(" ");

  const engine = field("Moottori") ?? field("Polttoaine");
  const fuelTypeRaw = engine ? finnishFuelToEnglish(engine.replace(/^[\d,]+ l,\s*/, "")) : null;

  const fuelLine = text.match(/yhdistetty:?\s*(\d+(?:,\d+)?)\s*l\/100/i);
  const elecLine = text.match(/yhdistetty:?\s*(\d+(?:,\d+)?)\s*kWh\/100/i);
  const electricConsumption = elecLine ? positive(elecLine[1]) : null;
  const batteryKwh = firstNumber(field("Akkukapasiteetti"));

  const isPlugIn =
    electricConsumption !== null ||
    (batteryKwh !== null && batteryKwh >= 5) ||
    /lataushybridi|plug-?in|phev/i.test(`${title} ${engine ?? ""}`);

  const id = text.match(/^ID\s+(\d{5,})$/m)?.[1] ?? "pasted";
  const dateMatch = text.match(/Käyttöönottopäivä(?:määrä)?\s*[:\t]?\s*\n?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);

  return {
    id,
    url: "",
    title: title || "Pasted listing",
    price,
    modelYear: firstNumber(field("Vuosimalli")),
    mileageKm: firstNumber(field("Mittarilukema")),
    fuelTypeRaw: engine,
    powertrain: classifyPowertrain(fuelTypeRaw, isPlugIn),
    fuelConsumption: fuelLine ? positive(fuelLine[1]) : null,
    electricConsumption,
    co2: firstNumber(field("CO2 -päästöt") ?? field("CO2-päästöt")),
    curbMassKg: firstNumber(field("Omamassa")),
    totalMassKg: firstNumber(field("Kokonaismassa")),
    commissionedOn: dateMatch ? `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}` : null,
    powerKw: firstNumber(field("Teho")),
    batteryKwh,
    imageUrl: null,
    registrationNumber: field("Rekisterinumero"),
    seller: null,
  };
}
