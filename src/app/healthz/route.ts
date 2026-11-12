// Health check for Render (see render.yaml).
export function GET() {
  return new Response("ok", { headers: { "content-type": "text/plain" } });
}
