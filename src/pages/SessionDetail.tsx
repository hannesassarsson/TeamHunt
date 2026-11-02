import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, Pencil, Plus, Square, Target, Trash2, UserPlus, X } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { useAction, useMembers, useSignedUrls } from "@/lib/hooks";
import type { Harvest, HuntSession, Observation, Participant } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Badge, EmptyState, PageLoader } from "@/components/ui/misc";
import { SessionForm, HUNT_TYPES } from "@/components/SessionForm";
import { HarvestForm } from "@/components/HarvestForm";
import { QuickObservation } from "@/components/QuickObservation";
import { SpeciesName } from "@/components/species";
import { WeatherSummary } from "@/components/weather";
import { fmt } from "@/lib/utils";
import { BookOpen } from "lucide-react";

const ROLES: Record<string, string> = { leader: "Hunt leader", hunter: "Hunter", dog_handler: "Dog handler", driver: "Driver", guest: "Guest" };

export default function SessionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useOrg();
  const { userId } = useAuth();
  const members = useMembers();
  const [editOpen, setEditOpen] = useState(false);
  const [harvestOpen, setHarvestOpen] = useState<Harvest | null | "new">(null);
  const [obsOpen, setObsOpen] = useState(false);
  const [addUser, setAddUser] = useState("");
  const [guest, setGuest] = useState("");
  const [role, setRole] = useState("hunter");

  const q = useQuery({
    queryKey: ["session", id],
    enabled: !!id,
    queryFn: async () => {
      const [s, p, o, h] = await Promise.all([
        supabase.from("hunt_sessions").select("*").eq("id", id!).single(),
        supabase.from("session_participants").select("*").eq("session_id", id!).order("created_at"),
        supabase.from("observations").select("*").eq("session_id", id!).order("observed_at"),
        supabase.from("harvests").select("*").eq("session_id", id!).order("harvested_at"),
      ]);
      return { session: unwrap(s) as HuntSession, participants: unwrap(p) as Participant[], observations: unwrap(o) as Observation[], harvests: unwrap(h) as Harvest[] };
    },
  });
  const photos = useSignedUrls("journal-photos", (q.data?.harvests ?? []).flatMap((h) => h.photo_paths));
  const inv = [["session", id], ["sessions"], ["open-sessions"]];
  const endHunt = useAction(async () => unwrap(await supabase.from("hunt_sessions").update({ ended_at: new Date().toISOString() }).eq("id", id!).select().single()), { success: "Hunt ended", invalidate: inv });
  const del = useAction(async () => unwrap(await supabase.from("hunt_sessions").delete().eq("id", id!).select("id")), { success: "Session deleted", invalidate: inv, onSuccess: () => navigate("/journal") });
  const addParticipant = useAction(async () => unwrap(await supabase.from("session_participants").insert({ session_id: id, org_id: q.data!.session.org_id, user_id: addUser || null, guest_name: addUser ? null : guest.trim(), role }).select()), { invalidate: inv, onSuccess: () => { setAddUser(""); setGuest(""); } });
  const removeParticipant = useAction(async (pid: string) => unwrap(await supabase.from("session_participants").delete().eq("id", pid).select()), { invalidate: inv });
  const delHarvest = useAction(async (hid: string) => unwrap(await supabase.from("harvests").delete().eq("id", hid).select("id")), { success: "Harvest deleted", invalidate: inv });

  if (q.isLoading) return <PageLoader />;
  if (!q.data) return <div className="p-6"><EmptyState icon={BookOpen} title="Session not found" action={<Link to="/journal" className="text-primary">Back to journal</Link>} /></div>;
  const { session: s, participants, observations, harvests } = q.data;
  const canEdit = can("admin") || (can("member") && s.created_by === userId);
  const name = (uid: string | null) => members.data?.find((m) => m.user_id === uid)?.display_name || members.data?.find((m) => m.user_id === uid)?.email || "Former member";
  const duration = s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000 : null;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Link to="/journal" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowLeft className="size-4" /> Journal</Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">{s.title}</h1>
          <p className="mt-1 text-sm text-muted">{fmt.dateTime(s.started_at)}{s.ended_at ? ` – ${fmt.dateTime(s.ended_at)} (${fmt.num(duration, 1)} h)` : " · in progress"}{s.hunt_type ? ` · ${HUNT_TYPES[s.hunt_type]}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("member") && <Button variant="outline" onClick={() => setObsOpen(true)}><Eye /> Observation</Button>}
          {can("member") && <Button variant="outline" onClick={() => setHarvestOpen("new")}><Target /> Harvest</Button>}
          {canEdit && !s.ended_at && <Button onClick={() => endHunt.mutate()} loading={endHunt.isPending}><Square /> End hunt</Button>}
          {canEdit && <Button variant="ghost" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title={`Harvest (${harvests.length})`} />
            <CardBody>
              {harvests.length === 0 ? <p className="text-sm text-muted">No harvest registered.</p> : (
                <ul className="divide-y divide-border">
                  {harvests.map((h) => (
                    <li key={h.id} className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <SpeciesName code={h.species_code} className="font-semibold" />
                          <p className="text-xs capitalize text-muted">{fmt.time(h.harvested_at)} · {h.sex} · {h.age_class}{h.weight_kg ? ` · ${h.weight_kg} kg` : ""}{h.antler_points != null ? ` · ${h.antler_points} points` : ""} · {h.shooter_user_id ? name(h.shooter_user_id) : h.shooter_name ?? "Unknown shooter"}</p>
                          {h.notes && <p className="mt-1 whitespace-pre-line text-sm">{h.notes}</p>}
                        </div>
                        {(can("admin") || h.created_by === userId) && can("member") && (
                          <div className="flex gap-1">
                            <Button size="icon-sm" variant="ghost" aria-label="Edit harvest" onClick={() => setHarvestOpen(h)}><Pencil /></Button>
                            <Button size="icon-sm" variant="ghost" aria-label="Delete harvest" onClick={() => { if (confirm("Delete this harvest record?")) delHarvest.mutate(h.id); }}><Trash2 /></Button>
                          </div>
                        )}
                      </div>
                      {h.photo_paths.length > 0 && (
                        <div className="mt-2 flex gap-2 overflow-x-auto">
                          {h.photo_paths.map((p) => photos.data?.[p] && <a key={p} href={photos.data[p]} target="_blank" rel="noreferrer"><img src={photos.data[p]} alt="Harvest" className="h-24 rounded-lg object-cover" /></a>)}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`Observations (${observations.length})`} action={can("member") && <Button size="sm" variant="ghost" onClick={() => setObsOpen(true)}><Plus /> Add</Button>} />
            <CardBody>
              {observations.length === 0 ? <p className="text-sm text-muted">No observations linked to this session.</p> : (
                <ul className="divide-y divide-border">
                  {observations.map((o) => (
                    <li key={o.id} className="flex items-start justify-between gap-2 py-2.5 text-sm">
                      <div>
                        <SpeciesName code={o.species_code} className="font-medium" />{o.count && <span className="text-muted"> ×{o.count}</span>} <Badge>{o.kind}</Badge>
                        {o.notes && <p className="mt-0.5 text-muted">{o.notes}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted">{fmt.time(o.observed_at)} · {name(o.created_by)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {s.notes && <Card><CardHeader title="Notes" /><CardBody><p className="whitespace-pre-line text-sm">{s.notes}</p></CardBody></Card>}
        </div>

        <div className="space-y-4">
          <Card><CardHeader title="Weather" /><CardBody><WeatherSummary w={s.weather} /></CardBody></Card>
          <Card>
            <CardHeader title={`Participants (${participants.length})`} />
            <CardBody>
              <ul className="space-y-2">
                {participants.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.user_id ? name(p.user_id) : `${p.guest_name} (guest)`}<span className="ml-1 text-xs text-muted">{p.role ? ROLES[p.role] : ""}</span></span>
                    {can("member") && <button onClick={() => removeParticipant.mutate(p.id)} className="text-muted hover:text-danger" aria-label="Remove participant"><X className="size-4" /></button>}
                  </li>
                ))}
              </ul>
              {can("member") && (
                <form className="mt-3 space-y-2 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); if (addUser || guest.trim()) addParticipant.mutate(); }}>
                  <Select value={addUser} onChange={(e) => setAddUser(e.target.value)} aria-label="Member">
                    <option value="">Guest (not a member)</option>
                    {members.data?.filter((m) => !participants.some((p) => p.user_id === m.user_id)).map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}</option>)}
                  </Select>
                  {!addUser && <Input placeholder="Guest name" value={guest} onChange={(e) => setGuest(e.target.value)} maxLength={80} />}
                  <div className="flex gap-2">
                    <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">{Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                    <Button type="submit" variant="outline" loading={addParticipant.isPending} aria-label="Add participant"><UserPlus /></Button>
                  </div>
                </form>
              )}
            </CardBody>
          </Card>
          {s.lat != null && <Card><CardHeader title="Location" /><CardBody className="text-sm tabular">{fmt.coord(s.lat, s.lon)}</CardBody></Card>}
          {canEdit && <Button variant="ghost" className="text-danger" onClick={() => { if (confirm("Delete this session? Linked observations and harvests are kept.")) del.mutate(); }}><Trash2 /> Delete session</Button>}
        </div>
      </div>
      <SessionForm open={editOpen} onOpenChange={setEditOpen} session={s} />
      <HarvestForm open={harvestOpen !== null} onOpenChange={(v) => !v && setHarvestOpen(null)} sessionId={s.id} harvest={harvestOpen === "new" ? null : harvestOpen} />
      <QuickObservation open={obsOpen} onOpenChange={(v) => { setObsOpen(v); if (!v) void q.refetch(); }} sessionId={s.id} />
    </div>
  );
}
