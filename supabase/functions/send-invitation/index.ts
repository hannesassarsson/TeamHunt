// Creates a team invitation (as the calling admin, RLS + role checks in SQL) and emails it.
// When no email provider is configured, the link is returned so the admin can share it manually.
import { userClient } from "../_shared/clients.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { escapeHtml, sendEmail } from "../_shared/notify.ts";

serve("send-invitation", async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const { client } = await userClient(req);
  const body = await req.json().catch(() => null);
  const orgId = body?.org_id, email = String(body?.email ?? "").trim().toLowerCase(), role = body?.role ?? "member";
  if (typeof orgId !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !["viewer", "member", "admin"].includes(role)) {
    throw new HttpError(400, "org_id, a valid email and role (viewer|member|admin) are required");
  }
  const { data, error } = await client.rpc("create_invitation", { p_org: orgId, p_email: email, p_role: role });
  if (error) throw new HttpError(error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400, error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const { data: org } = await client.from("organizations").select("name").eq("id", orgId).single();

  const appUrl = Deno.env.get("APP_URL") ?? new URL(req.headers.get("origin") ?? "http://localhost:5173").origin;
  const link = `${appUrl}/invite/${row.token}`;
  const teamName = org?.name ?? "a hunting team";
  const result = await sendEmail({
    to: email,
    subject: `You're invited to ${teamName} on NORDHUNT`,
    text: `You have been invited to join ${teamName} on NORDHUNT as ${role}.\n\nAccept: ${link}\n\nThe link expires in 14 days.`,
    html: `<p style="font-family:sans-serif">You have been invited to join <b>${escapeHtml(teamName)}</b> on NORDHUNT as ${escapeHtml(role)}.</p><p><a href="${escapeHtml(link)}">Accept invitation</a></p><p style="font-family:sans-serif;color:#666">The link expires in 14 days.</p>`,
  });
  return json(req, { invitation_id: row.invitation_id, emailed: result.status === "sent", email_error: result.status === "sent" ? null : result.error, link });
});
