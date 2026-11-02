import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

// The anon key is public by design; all data access is enforced by Row Level Security.
export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export class AppError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Unwrap a Supabase response, converting PostgREST errors into readable messages. */
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string; details?: string | null } | null }): T {
  if (res.error) throw new AppError(friendlyError(res.error), res.error.code);
  return res.data as T;
}

export function friendlyError(e: { message: string; code?: string }): string {
  switch (e.code) {
    case "42501":
      return e.message.includes("row-level security") ? "You don't have permission to do that." : e.message;
    case "23505":
      return e.message.includes("sha256") ? "This image has already been uploaded." : "That already exists.";
    case "23503":
      return e.message.includes("Participant") ? e.message : "Referenced item no longer exists.";
    case "23514":
      return "Some values are out of range. Please check the form.";
    case "PGRST116":
      return "Not found.";
    default:
      return e.message || "Something went wrong.";
  }
}

export async function invokeFunction<T>(name: string, init: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
  const res = await fetch(`${url}/functions/v1/${name}${qs}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      apikey: anonKey ?? "",
      Authorization: `Bearer ${session.session?.access_token ?? anonKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(body?.error ?? `Request failed (${res.status})`, body?.code);
  return body as T;
}
