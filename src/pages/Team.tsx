import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, History, Mail, Trash2, UserPlus, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase, unwrap, invokeFunction } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { useAction, useMembers } from "@/lib/hooks";
import type { AuditEvent, Role } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge, PageHeader, PageLoader, Tabs, TabPanel } from "@/components/ui/misc";
import { fmt } from "@/lib/utils";

const ROLE_HELP: Record<Role, string> = {
  viewer: "Can view maps, images, journal and analytics.",
  member: "Can also record observations, upload images, review detections and add map items.",
  admin: "Can also manage cameras, hunting areas, members and team settings.",
  owner: "Full control, including deleting the team.",
};
const ZONES = ["Europe/Stockholm", "Europe/Oslo", "Europe/Helsinki", "Europe/Copenhagen", "Atlantic/Reykjavik"];

export default function Team() {
  const { org, role, can, refetch } = useOrg();
  const { userId } = useAuth();
  const members = useMembers();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [link, setLink] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ name: string; timezone: string; threshold: string } | null>(null);

  const invites = useQuery({
    queryKey: ["invitations", org?.id],
    enabled: !!org && can("admin"),
    queryFn: async () => unwrap(await supabase.from("invitations").select("id, email, role, created_at, expires_at").eq("org_id", org!.id).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false })) as { id: string; email: string; role: Role; created_at: string; expires_at: string }[],
  });
  const audit = useQuery({
    queryKey: ["audit", org?.id],
    enabled: !!org && can("admin") && tab === "audit",
    queryFn: async () => unwrap(await supabase.from("audit_events").select("*").eq("org_id", org!.id).order("at", { ascending: false }).limit(200)) as AuditEvent[],
  });

  const invite = useAction(async () => invokeFunction<{ emailed: boolean; link: string; email_error: string | null }>("send-invitation", { body: { org_id: org!.id, email, role: inviteRole } }), {
    invalidate: [["invitations"]],
    onSuccess: (r) => { if (r.emailed) { toast.success(`Invitation sent to ${email}`); setInviteOpen(false); } else setLink(r.link); setEmail(""); },
  });
  const revoke = useAction(async (id: string) => unwrap(await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id).select()), { success: "Invitation revoked", invalidate: [["invitations"]] });
  const changeRole = useAction(async (p: { user: string; role: Role }) => unwrap(await supabase.from("memberships").update({ role: p.role }).eq("org_id", org!.id).eq("user_id", p.user).select()), { success: "Role updated", invalidate: [["members"], ["memberships"]] });
  const removeMember = useAction(async (user: string) => unwrap(await supabase.from("memberships").delete().eq("org_id", org!.id).eq("user_id", user).select()), {
    invalidate: [["members"], ["memberships"]],
    onSuccess: (_r, user) => { if (user === userId) { toast.success("You left the team"); refetch(); navigate("/"); } else toast.success("Member removed"); },
  });
  const saveSettings = useAction(async () => unwrap(await supabase.from("organizations").update({ name: settings!.name.trim(), timezone: settings!.timezone, probable_threshold: Number(settings!.threshold) }).eq("id", org!.id).select().single()), {
    success: "Team settings saved", invalidate: [["memberships"], ["analytics"]],
  });
  const deleteOrg = useAction(async () => unwrap(await supabase.from("organizations").delete().eq("id", org!.id).select("id")), {
    onSuccess: async () => { toast.success("Team deleted"); await qc.invalidateQueries(); navigate("/onboarding"); },
  });
  const memberName = (id: string | null) => members.data?.find((m) => m.user_id === id)?.display_name || members.data?.find((m) => m.user_id === id)?.email || "System";

  if (!org) return <PageLoader />;
  const s = settings ?? { name: org.name, timezone: org.timezone, threshold: String(org.probable_threshold) };
  const tabs = [{ value: "members", label: "Members" }, ...(can("admin") ? [{ value: "settings", label: "Settings" }, { value: "audit", label: "Activity log" }] : [])];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader title="Team" description={`${org.name} · you are ${role}`} actions={can("admin") && <Button onClick={() => { setLink(null); setInviteOpen(true); }}><UserPlus /> Invite</Button>} />
      <Tabs value={tab} onValueChange={setTab} tabs={tabs}>
        <TabPanel value="members" className="space-y-4">
          <Card>
            <CardBody className="pt-4">
              {members.isLoading ? <PageLoader /> : (
                <ul className="divide-y divide-border">
                  {members.data?.map((m) => (
                    <li key={m.user_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium">{m.display_name || m.email}{m.user_id === userId && <span className="ml-1 text-xs text-muted">(you)</span>}</div>
                        <div className="text-xs text-muted">{m.email} · joined {fmt.date(m.joined_at)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {can("admin") && m.user_id !== userId && (m.role !== "owner" || role === "owner") ? (
                          <Select className="h-8 w-32 text-xs" value={m.role} onChange={(e) => changeRole.mutate({ user: m.user_id, role: e.target.value as Role })} aria-label={`Role for ${m.email}`}>
                            <option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option>{role === "owner" && <option value="owner">Owner</option>}
                          </Select>
                        ) : <Badge tone={m.role === "owner" ? "accent" : m.role === "admin" ? "primary" : "neutral"}>{m.role}</Badge>}
                        {can("admin") && m.user_id !== userId && (m.role !== "owner" || role === "owner") && (
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.email}`} onClick={() => { if (confirm(`Remove ${m.display_name || m.email} from the team?`)) removeMember.mutate(m.user_id); }}><Trash2 /></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {can("admin") && invites.data && invites.data.length > 0 && (
            <Card>
              <CardHeader title="Pending invitations" />
              <CardBody>
                <ul className="divide-y divide-border">
                  {invites.data.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span><Mail className="mr-1 inline size-3.5 text-muted" />{i.email} <Badge>{i.role}</Badge><span className="ml-2 text-xs text-muted">expires {fmt.date(i.expires_at)}</span></span>
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(i.id)}>Revoke</Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Roles" />
            <CardBody><dl className="space-y-1.5 text-sm">{(Object.keys(ROLE_HELP) as Role[]).map((r) => <div key={r} className="flex gap-2"><dt className="w-16 shrink-0 font-semibold capitalize">{r}</dt><dd className="text-muted">{ROLE_HELP[r]}</dd></div>)}</dl></CardBody>
          </Card>
          <Button variant="ghost" className="text-danger" onClick={() => { if (confirm(`Leave ${org.name}?`)) removeMember.mutate(userId!); }}><LogOut /> Leave team</Button>
        </TabPanel>

        <TabPanel value="settings" className="space-y-4">
          <Card>
            <CardHeader title="Team settings" />
            <CardBody>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveSettings.mutate(); }}>
                <Field label="Team name"><Input value={s.name} onChange={(e) => setSettings({ ...s, name: e.target.value })} minLength={2} maxLength={80} required /></Field>
                <Field label="Time zone"><Select value={s.timezone} onChange={(e) => setSettings({ ...s, timezone: e.target.value })}>{[...new Set([s.timezone, ...ZONES])].map((z) => <option key={z}>{z}</option>)}</Select></Field>
                <Field label={`AI "probable" threshold: ${Math.round(Number(s.threshold) * 100)}%`} hint="AI detections at or above this confidence are shown as probable; below it as uncertain and sent to the review queue. Only people can confirm a detection.">
                  <input type="range" min={0.5} max={0.99} step={0.01} value={s.threshold} onChange={(e) => setSettings({ ...s, threshold: e.target.value })} className="w-full accent-[var(--primary)]" />
                </Field>
                <Button type="submit" loading={saveSettings.isPending}>Save settings</Button>
              </form>
            </CardBody>
          </Card>
          {role === "owner" && (
            <Card className="border-danger/40">
              <CardHeader title="Danger zone" description="Deleting the team permanently removes all its maps, cameras, images, journal entries and analytics." />
              <CardBody>
                <Button variant="danger" loading={deleteOrg.isPending} onClick={() => { if (prompt(`Type the team name "${org.name}" to delete it permanently`) === org.name) deleteOrg.mutate(); }}><Trash2 /> Delete team</Button>
              </CardBody>
            </Card>
          )}
        </TabPanel>

        <TabPanel value="audit">
          <Card>
            <CardHeader title="Activity log" description="Who changed what. Coordinates and content are not copied into the log." />
            <CardBody>
              {audit.isLoading ? <PageLoader /> : !audit.data?.length ? <p className="text-sm text-muted">No activity yet.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {audit.data.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                      <span><History className="mr-1 inline size-3.5 text-muted" /><b>{memberName(a.actor_id)}</b> {a.action === "insert" ? "added" : a.action === "update" ? "updated" : "deleted"} {a.entity.replace(/_/g, " ").replace(/s$/, "")}
                        {a.changes.label && <span className="text-muted"> "{a.changes.label}"</span>}
                        {a.changes.fields && <span className="text-muted"> ({a.changes.fields.join(", ")})</span>}</span>
                      <span className="shrink-0 text-xs text-muted">{fmt.dateTime(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </TabPanel>
      </Tabs>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen} title="Invite to team" description="They sign in with this email address to join."
        footer={!link && <><Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button><Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)}>Send invitation</Button></>}>
        {link ? (
          <div className="space-y-3 text-sm">
            <p>The invitation was created, but email delivery isn't configured. Share this link with the person directly — it only works for the invited email address and expires in 14 days.</p>
            <div className="flex gap-2"><code className="flex-1 break-all rounded-lg bg-surface-2 p-2 text-xs">{link}</code><Button variant="outline" size="icon" aria-label="Copy link" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Copied"); }}><Copy /></Button></div>
            <Button className="w-full" onClick={() => { setInviteOpen(false); setLink(null); }}>Done</Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <Field label="Role" hint={ROLE_HELP[inviteRole]}><Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}><option value="viewer">Viewer</option><option value="member">Member</option><option value="admin">Admin</option></Select></Field>
          </form>
        )}
      </Dialog>
    </div>
  );
}
