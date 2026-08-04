// Every Edge Function called directly from client code (web in particular
// — native doesn't enforce this) needs these on every response, and needs
// to short-circuit the browser's preflight OPTIONS request before it ever
// reaches the function's own auth/logic — Deno.serve doesn't add CORS
// headers on its own, and a response missing them gets silently blocked by
// the browser (surfaces as a bare "net::ERR_FAILED", not a readable error).
// See https://supabase.com/docs/guides/functions/cors.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
