# Car TCO calculator

Paste a [nettiauto.com](https://www.nettiauto.com) listing link and get an estimate of the car's
**total cost of ownership** in Finland: depreciation, fuel/electricity, vehicle tax (ajoneuvovero),
insurance, maintenance, inspections and loan interest.

## How it works

1. `GET /api/listing?url=…` fetches the listing server-side and parses it (`src/lib/listing.ts`)
   from the page's schema.org JSON-LD, its embedded `productInfo` data and the spec table.
2. The browser computes the TCO (`src/lib/tco.ts`) and vehicle tax (`src/lib/tax.ts`).
   Every parsed value and assumption is editable, and the results update live.
3. If a listing can't be fetched, the user can enter the car's details manually.

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests (vitest), using saved listing pages in test/fixtures
npm run lint
```

## Known limitations

- **Vehicle tax:** EV basic tax and driving-power tax rates are the official 2026 figures. The
  CO₂ → basic tax curve above ~100 g/km is an *approximation*. It should be replaced with the
  official tables (ajoneuvoverolaki 1281/2003, VEROTAULUKKO 1 / 1 A).
- **Fetching listings:** nettiauto.com may refuse automated requests. Check its terms of use and
  consider asking Alma Media for permission or API access before deploying publicly.
- Depreciation, maintenance and insurance are rule-of-thumb defaults.
