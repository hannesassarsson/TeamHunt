// Delivery adapters. Each returns { status, provider, error? } and never throws for "not configured".
import webpush from "npm:web-push@3";
import { fetchWithRetry } from "./http.ts";

export interface DeliveryResult {
  status: "sent" | "failed" | "skipped";
  provider: string;
  error?: string;
  /** Push subscription endpoints that are gone and should be deleted. */
  expiredEndpoints?: string[];
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Email via Resend (RESEND_API_KEY, EMAIL_FROM). */
export async function sendEmail(msg: EmailMessage): Promise<DeliveryResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!key || !from) return { status: "skipped", provider: "none", error: "Email provider not configured" };
  const res = await fetchWithRetry("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) return { status: "failed", provider: "resend", error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { status: "sent", provider: "resend" };
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidReady = false;

/** Web Push (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). */
export async function sendPush(subs: PushSubscriptionRow[], payload: { title: string; body: string; url?: string }): Promise<DeliveryResult> {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!pub || !priv) return { status: "skipped", provider: "none", error: "Web Push not configured" };
  if (!subs.length) return { status: "skipped", provider: "webpush", error: "No push subscriptions" };
  if (!vapidReady) {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  }
  const expired: string[] = [];
  let sent = 0;
  const errors: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) expired.push(s.endpoint);
      else errors.push(String((e as Error).message ?? e));
    }
  }));
  if (sent > 0) return { status: "sent", provider: "webpush", expiredEndpoints: expired };
  return { status: expired.length && !errors.length ? "skipped" : "failed", provider: "webpush", error: errors[0] ?? "All subscriptions expired", expiredEndpoints: expired };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
