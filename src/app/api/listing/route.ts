import { NextResponse } from "next/server";
import { normaliseListingUrl, parseListing } from "@/lib/listing";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  const target = normaliseListingUrl(raw);
  if (!target) {
    return NextResponse.json(
      { error: "Paste a nettiauto.com listing link, e.g. https://www.nettiauto.com/audi/a6/15911646" },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetch(target.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; car-tco/0.1)",
        "Accept-Language": "fi-FI,fi;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 3600 },
    });
  } catch {
    return NextResponse.json({ error: "Could not reach nettiauto.com. Try again shortly." }, { status: 502 });
  }

  // Only trust content served from nettiauto itself (guards against redirects elsewhere).
  const finalHost = new URL(res.url || target.url).hostname;
  if (!finalHost.endsWith("nettiauto.com")) {
    return NextResponse.json({ error: "Unexpected redirect away from nettiauto.com." }, { status: 502 });
  }
  if (res.status === 404 || res.status === 410) {
    return NextResponse.json({ error: "That listing no longer exists (it may have been sold)." }, { status: 404 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `nettiauto.com responded with ${res.status}.` }, { status: 502 });
  }

  const listing = parseListing(await res.text(), target.url);
  if (listing.price === null && listing.fuelTypeRaw === null) {
    return NextResponse.json({ error: "Couldn't read car details from that page." }, { status: 422 });
  }
  return NextResponse.json({ listing });
}
