// HTTP helpers for edge functions: CORS, JSON responses, typed errors, structured logs.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-camera-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req), ...extra },
  });
}

export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) {
  console[level === "info" ? "log" : level](JSON.stringify({ level, msg, ts: new Date().toISOString(), ...fields }));
}

/** Wrap a handler with CORS preflight, error mapping and request logging. */
export function serve(name: string, handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    const started = Date.now();
    try {
      const res = await handler(req);
      log("info", `${name} ${req.method}`, { status: res.status, ms: Date.now() - started });
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        log("warn", `${name} rejected`, { status: e.status, error: e.message });
        return json(req, { error: e.message, code: e.code }, e.status);
      }
      log("error", `${name} failed`, { error: String(e instanceof Error ? e.stack ?? e.message : e) });
      return json(req, { error: "Internal error" }, 500);
    }
  });
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** fetch with timeout and retries on network errors / 429 / 5xx (exponential backoff with jitter). */
export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: { retries?: number; timeoutMs?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status !== 429 && res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      await res.body?.cancel();
    } catch (e) {
      lastErr = e;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 2 ** attempt * 500 + Math.random() * 250));
  }
  throw lastErr;
}
