# Car TCO calculator

Paste a [nettiauto.com](https://www.nettiauto.com) listing link and get an estimate of the car's
**total cost of ownership** in Finland: depreciation, fuel/electricity, vehicle tax (ajoneuvovero),
insurance, maintenance, inspections and loan interest.

## How it works

1. **Paste the listing page (main path).** The user opens the listing, selects all, copies and
   pastes it into the app. `parseListingText` in `src/lib/listing.ts` reads the Finnish spec labels
   (Mittarilukema, Moottori, Kokonaismassa, …) in the browser. Nothing is fetched from nettiauto.com.
2. **Paste a link.** `GET /api/listing?url=…` tries to fetch and parse the page server-side.
   nettiauto.com currently refuses these requests (HTTP 403), and the app then asks the user
   to paste the page text instead.
3. **Manual entry** as a last resort.
4. The browser computes the TCO (`src/lib/tco.ts`) and vehicle tax (`src/lib/tax.ts`).
   Every parsed value and assumption is editable, and the results update live.

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests (vitest), using saved listing pages in test/fixtures
npm run lint
```

## Hosting on Render

`render.yaml` sets up a free Render web service. In Render: **New → Blueprint**,
connect this GitHub repo, pick the `main` branch, and apply. Render then redeploys on
every push. The free tier sleeps when idle, so the first request after a break is slow.

## Known limitations

- **Vehicle tax:** EV basic tax and driving-power tax rates are the official 2026 figures. The
  CO₂ → basic tax curve above ~100 g/km is an *approximation*. It should be replaced with the
  official tables (ajoneuvoverolaki 1281/2003, VEROTAULUKKO 1 / 1 A).
- **Fetching listings:** nettiauto.com refuses server-side requests (HTTP 403), so the link option
  doesn't work in practice. Pasting the page text is the supported path. Proper link support
  would need permission or API access from Alma Media.
- Depreciation, maintenance and insurance are rule-of-thumb defaults.
