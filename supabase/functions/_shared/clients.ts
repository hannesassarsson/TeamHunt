import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export function env(name: string, required = true): string {
  const v = Deno.env.get(name) ?? "";
  if (required && !v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Service-role client. Bypasses RLS: only use after authorising the caller yourself. */
export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client acting as the calling user (RLS applies). Throws 401 when no valid session. */
export async function userClient(req: Request): Promise<{ client: SupabaseClient; userId: string; email: string | null }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "Missing authorization", "unauthenticated");
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(auth.slice(7));
  if (error || !data.user) throw new HttpError(401, "Invalid session", "unauthenticated");
  return { client, userId: data.user.id, email: data.user.email ?? null };
}
