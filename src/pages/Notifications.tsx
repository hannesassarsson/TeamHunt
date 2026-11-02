import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, CheckCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { useAction, useCameras } from "@/lib/hooks";
import type { NotificationRow, NotificationRuleRow } from "@/lib/types";
import { enablePush, disablePush, currentPushSubscription, pushSupported } from "@/lib/push";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { Badge, EmptyState, PageHeader, PageLoader, Switch, Tabs, TabPanel } from "@/components/ui/misc";
import { SpeciesSelect } from "@/components/species";
import { cn, fmt } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";

const EVENTS: Record<NotificationRuleRow["event"], string> = {
  species_detected: "Specific species detected on camera",
  detection: "Any animal detected on camera",
  camera_offline: "Camera goes offline",
  observation_created: "New observation by a teammate",
  harvest_created: "Harvest registered",
  daily_summary: "Daily wildlife summary",
};

export default function Notifications() {
  const { org } = useOrg();
  const { userId } = useAuth();
  const [tab, setTab] = useState("inbox");
  const [ruleOpen, setRuleOpen] = useState<NotificationRuleRow | null | "new">(null);
  const inbox = useQuery({
    queryKey: ["notifications", userId],
    enabled: !!userId,
    queryFn: async () => unwrap(await supabase.from("notifications").select("id, event, title, body, link, read_at, created_at").eq("user_id", userId!).order("created_at", { ascending: false }).limit(100)) as NotificationRow[],
  });
  const rules = useQuery({
    queryKey: ["rules", org?.id, userId],
    enabled: !!org && !!userId,
    queryFn: async () => unwrap(await supabase.from("notification_rules").select("*").eq("org_id", org!.id).eq("user_id", userId!).order("created_at")) as NotificationRuleRow[],
  });
  const markAll = useAction(async () => unwrap(await supabase.rpc("mark_all_notifications_read")), { invalidate: [["notifications"], ["notifications-unread"]] });
  const markRead = useAction(async (id: string) => unwrap(await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).select("id")), { invalidate: [["notifications"], ["notifications-unread"]] });
  const toggleRule = useAction(async (r: NotificationRuleRow) => unwrap(await supabase.from("notification_rules").update({ enabled: !r.enabled }).eq("id", r.id).select()), { invalidate: [["rules"]] });
  const delRule = useAction(async (id: string) => unwrap(await supabase.from("notification_rules").delete().eq("id", id).select()), { success: "Rule deleted", invalidate: [["rules"]] });

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <PageHeader title="Notifications" description="Alerts for detections, camera health and team activity." />
      <Tabs value={tab} onValueChange={setTab} tabs={[{ value: "inbox", label: "Inbox" }, { value: "rules", label: "Alert rules" }, { value: "prefs", label: "Delivery" }]}>
        <TabPanel value="inbox">
          <div className="mb-3 flex justify-end"><Button size="sm" variant="ghost" onClick={() => markAll.mutate()} disabled={!inbox.data?.some((n) => !n.read_at)}><CheckCheck /> Mark all read</Button></div>
          {inbox.isLoading ? <PageLoader /> : !inbox.data?.length ? (
            <EmptyState icon={Bell} title="No notifications" description="Create alert rules to be notified when something happens." action={<Button onClick={() => setTab("rules")}>Set up alerts</Button>} />
          ) : (
            <Card><ul className="divide-y divide-border">
              {inbox.data.map((n) => {
                const inner = (
                  <div className={cn("flex gap-3 px-4 py-3", !n.read_at && "bg-accent-soft/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{n.title}</div>
                      {n.body && <div className="whitespace-pre-line text-sm text-muted">{n.body}</div>}
                      <div className="mt-0.5 text-xs text-muted">{fmt.ago(n.created_at)}</div>
                    </div>
                  </div>
                );
                return <li key={n.id} onClick={() => !n.read_at && markRead.mutate(n.id)}>{n.link ? <Link to={n.link}>{inner}</Link> : inner}</li>;
              })}
            </ul></Card>
          )}
        </TabPanel>
        <TabPanel value="rules">
          <div className="mb-3 flex justify-end"><Button onClick={() => setRuleOpen("new")}><Plus /> New rule</Button></div>
          {rules.isLoading ? <PageLoader /> : !rules.data?.length ? (
            <EmptyState icon={BellRing} title="No alert rules" description="For example: notify me by push when a wild boar is detected with probable or confirmed classification." action={<Button onClick={() => setRuleOpen("new")}><Plus /> Create rule</Button>} />
          ) : (
            <div className="space-y-2">
              {rules.data.map((r) => (
                <Card key={r.id} className="flex items-center justify-between gap-3 p-4">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setRuleOpen(r)}>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-xs text-muted">{EVENTS[r.event]}{r.species_codes.length ? ` · ${r.species_codes.map((s) => speciesLabel(s)).join(", ")}` : ""}{["detection", "species_detected"].includes(r.event) ? ` · ${r.min_tier}+` : ""}</div>
                    <div className="mt-1 flex gap-1">{r.channels.map((c) => <Badge key={c}>{c.replace("_", "-")}</Badge>)}</div>
                  </button>
                  <Switch checked={r.enabled} onCheckedChange={() => toggleRule.mutate(r)} label={<span className="sr-only">Enabled</span>} />
                  <Button size="icon-sm" variant="ghost" aria-label="Delete rule" onClick={() => { if (confirm("Delete this rule?")) delRule.mutate(r.id); }}><Trash2 /></Button>
                </Card>
              ))}
            </div>
          )}
        </TabPanel>
        <TabPanel value="prefs"><DeliveryPrefs /></TabPanel>
      </Tabs>
      <RuleDialog rule={ruleOpen} onClose={() => setRuleOpen(null)} />
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: NotificationRuleRow | null | "new"; onClose: () => void }) {
  const { org } = useOrg();
  const cameras = useCameras();
  const r = rule === "new" ? null : rule;
  const [v, setV] = useState({ name: "", event: "species_detected" as NotificationRuleRow["event"], species: [] as string[], cameras: [] as string[], tier: "probable", channels: ["in_app", "push"] as string[] });
  const [pick, setPick] = useState("");
  useEffect(() => {
    if (rule) setV({ name: r?.name ?? "", event: r?.event ?? "species_detected", species: r?.species_codes ?? [], cameras: r?.camera_ids ?? [], tier: r?.min_tier ?? "probable", channels: r?.channels ?? ["in_app", "push"] });
  }, [rule, r]);
  const save = useAction(async () => {
    const row = { name: v.name.trim() || EVENTS[v.event], event: v.event, species_codes: ["species_detected", "observation_created", "harvest_created", "detection"].includes(v.event) ? v.species : [], camera_ids: ["detection", "species_detected", "camera_offline"].includes(v.event) ? v.cameras : [], min_tier: v.tier, channels: v.channels };
    return r ? unwrap(await supabase.from("notification_rules").update(row).eq("id", r.id).select()) : unwrap(await supabase.from("notification_rules").insert({ ...row, org_id: org!.id }).select());
  }, { success: "Rule saved", invalidate: [["rules"]], onSuccess: onClose });
  const needsSpecies = v.event === "species_detected";
  const showSpecies = ["species_detected", "observation_created", "harvest_created"].includes(v.event);
  const showCameras = ["detection", "species_detected", "camera_offline"].includes(v.event);
  const toggle = (arr: string[], x: string) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);

  return (
    <Dialog open={!!rule} onOpenChange={(o) => !o && onClose()} title={r ? "Edit alert rule" : "New alert rule"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!v.channels.length || (needsSpecies && !v.species.length)}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="When"><Select value={v.event} onChange={(e) => setV({ ...v, event: e.target.value as NotificationRuleRow["event"] })}>{Object.entries(EVENTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {showSpecies && (
          <Field label={needsSpecies ? "Species" : "Only these species (optional)"}>
            <div className="flex gap-2"><div className="flex-1"><SpeciesSelect value={pick} onChange={setPick} placeholder="Choose species…" /></div><Button variant="outline" onClick={() => { if (pick && !v.species.includes(pick)) setV({ ...v, species: [...v.species, pick] }); setPick(""); }} disabled={!pick}>Add</Button></div>
            <div className="mt-2 flex flex-wrap gap-1.5">{v.species.map((s) => <button key={s} onClick={() => setV({ ...v, species: v.species.filter((x) => x !== s) })} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs hover:bg-danger/10">{speciesLabel(s)} ×</button>)}</div>
          </Field>
        )}
        {["detection", "species_detected"].includes(v.event) && (
          <Field label="Minimum classification" hint="Uncertain alerts are noisy; probable is a good default.">
            <Select value={v.tier} onChange={(e) => setV({ ...v, tier: e.target.value })}><option value="uncertain">Uncertain or better</option><option value="probable">Probable or better</option><option value="confirmed">Confirmed only (after review)</option></Select>
          </Field>
        )}
        {showCameras && cameras.data && cameras.data.length > 0 && (
          <Field label="Cameras (none selected = all)">
            <div className="grid grid-cols-2 gap-1.5">{cameras.data.map((c) => <Checkbox key={c.id} label={c.name} checked={v.cameras.includes(c.id)} onChange={() => setV({ ...v, cameras: toggle(v.cameras, c.id) })} />)}</div>
          </Field>
        )}
        <Field label="Deliver via">
          <div className="flex flex-wrap gap-4">
            {[["in_app", "In app"], ["push", "Push"], ["email", "Email"]].map(([k, l]) => <Checkbox key={k} label={l} checked={v.channels.includes(k)} onChange={() => setV({ ...v, channels: toggle(v.channels, k) })} />)}
          </div>
        </Field>
        <Field label="Name (optional)"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} placeholder={EVENTS[v.event]} /></Field>
      </div>
    </Dialog>
  );
}

function DeliveryPrefs() {
  const { userId } = useAuth();
  const prefs = useQuery({
    queryKey: ["notification-prefs", userId],
    enabled: !!userId,
    queryFn: async () => unwrap(await supabase.from("notification_preferences").select("*").eq("user_id", userId!).maybeSingle()) as { email_enabled: boolean; push_enabled: boolean; quiet_hours_start: number | null; quiet_hours_end: number | null; timezone: string } | null,
  });
  const p = prefs.data ?? { email_enabled: true, push_enabled: true, quiet_hours_start: null, quiet_hours_end: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const save = useAction(async (patch: Partial<typeof p>) => unwrap(await supabase.from("notification_preferences").upsert({ ...p, ...patch, user_id: userId, updated_at: new Date().toISOString() }).select()), { invalidate: [["notification-prefs"]] });
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => { void currentPushSubscription().then((s) => setSubscribed(!!s)); }, []);
  const [busy, setBusy] = useState(false);
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Channels" />
        <CardBody className="space-y-4">
          <Switch label="Email notifications" checked={p.email_enabled} onCheckedChange={(v) => save.mutate({ email_enabled: v })} />
          <Switch label="Push notifications" checked={p.push_enabled} onCheckedChange={(v) => save.mutate({ push_enabled: v })} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-3 text-sm">
            <span>{!pushSupported() ? "Push is not available in this browser or the server has no VAPID key configured." : subscribed ? "This device receives push notifications." : "This device is not subscribed."}</span>
            {pushSupported() && (
              <Button size="sm" variant="outline" loading={busy} onClick={async () => {
                setBusy(true);
                try { if (subscribed) { await disablePush(); setSubscribed(false); toast.success("Push disabled on this device"); } else { await enablePush(); setSubscribed(true); toast.success("Push enabled on this device"); } }
                catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
              }}>{subscribed ? "Disable on this device" : "Enable on this device"}</Button>
            )}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Quiet hours" description="Email and push are held back during these hours. In-app notifications still arrive." />
        <CardBody className="grid grid-cols-2 gap-3">
          <Field label="From"><Select value={p.quiet_hours_start ?? ""} onChange={(e) => save.mutate({ quiet_hours_start: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Off</option>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select></Field>
          <Field label="Until"><Select value={p.quiet_hours_end ?? ""} onChange={(e) => save.mutate({ quiet_hours_end: e.target.value === "" ? null : Number(e.target.value) })}><option value="">Off</option>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select></Field>
          <p className="col-span-2 text-xs text-muted">Time zone: {p.timezone}</p>
        </CardBody>
      </Card>
    </div>
  );
}
