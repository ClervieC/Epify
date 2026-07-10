// Deploy with: npx supabase functions deploy delete-account
// Requires SUPABASE_SERVICE_ROLE_KEY to be set as a secret for this project
// (it's available by default as an Edge Function secret in most Supabase
// projects — check with `npx supabase secrets list` and set it with
// `npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` if missing).
//
// Deleting an auth.users row requires the service role key — never
// available client-side — because every other table here references
// auth.users(id) on delete cascade, this one deleteUser() call is enough
// to remove the account's shows, movies, comments, reports, lists,
// follows, etc. in one shot.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verifies the caller's JWT and resolves it to a user id server-side —
  // never trusts a user id supplied in the request body, which would let
  // anyone delete anyone else's account just by knowing their id.
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
