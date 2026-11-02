import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase, unwrap, invokeFunction } from "@/lib/supabase";
import { useAction, useAreas } from "@/lib/hooks";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { getPosition } from "@/lib/geolocation";
import { geometryCenter } from "@/lib/geo";
import type { HuntSession } from "@/lib/types";
import type { WeatherSample } from "@shared/domain/weather.ts";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "./ui/form";
import { fromLocalInput, toLocalInput } from "@/lib/utils";

export const HUNT_TYPES: Record<string, string> = { stand: "Stand / pass", stalk: "Stalking", drive: "Drive hunt", dog: "With dog", calling: "Calling", tracking: "Tracking / search", other: "Other" };

export function SessionForm({ open, onOpenChange, session, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; session?: HuntSession | null; onSaved?: (s: HuntSession) => void }) {
  const { org } = useOrg();
  const { userId } = useAuth();
  const areas = useAreas();
  const [v, setV] = useState({ title: "", type: "stand", start: toLocalInput(), end: "", area: "", notes: "", useGps: true, addMe: true });
  useEffect(() => {
    if (open) setV({
      title: session?.title ?? `Hunt ${new Date().toLocaleDateString("sv-SE")}`, type: session?.hunt_type ?? "stand",
      start: toLocalInput(session?.started_at ?? new Date()), end: session?.ended_at ? toLocalInput(session.ended_at) : "",
      area: session?.area_id ?? "", notes: session?.notes ?? "", useGps: !session, addMe: !session,
    });
  }, [open, session]);

  const save = useAction(async () => {
    let lat = session?.lat ?? null, lon = session?.lon ?? null;
    if (v.useGps) {
      try { const p = await getPosition(8000); lat = p.lat; lon = p.lon; } catch (e) { toast.message((e as Error).message); }
    }
    if (lat == null && v.area) {
      const a = areas.data?.find((x) => x.id === v.area);
      if (a) [lon, lat] = geometryCenter(a.geometry);
    }
    const startedAt = fromLocalInput(v.start);
    const row: Record<string, unknown> = {
      title: v.title.trim(), hunt_type: v.type, started_at: startedAt, ended_at: v.end ? fromLocalInput(v.end) : null,
      area_id: v.area || null, notes: v.notes.trim() || null, lat, lon,
    };
    // Weather snapshot: forecast for now, historical model data for past sessions.
    if (lat != null && lon != null && !session?.weather) {
      try {
        const r = await invokeFunction<{ sample: WeatherSample | null }>("weather", { query: { lat: String(lat), lon: String(lon), at: startedAt } });
        if (r.sample) row.weather = r.sample;
      } catch { /* weather is optional */ }
    }
    const saved = (session
      ? unwrap(await supabase.from("hunt_sessions").update(row).eq("id", session.id).select().single())
      : unwrap(await supabase.from("hunt_sessions").insert({ ...row, org_id: org!.id }).select().single())) as HuntSession;
    if (!session && v.addMe && userId) {
      await supabase.from("session_participants").insert({ session_id: saved.id, org_id: org!.id, user_id: userId, role: "hunter" });
    }
    return saved;
  }, { success: session ? "Session updated" : "Hunt started", invalidate: [["sessions"], ["session"], ["open-sessions"]], onSuccess: (s) => { onOpenChange(false); onSaved?.(s); } });

  const invalidEnd = v.end && new Date(v.end) < new Date(v.start);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={session ? "Edit hunt session" : "Start a hunt"}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!v.title.trim() || !!invalidEnd}>Save</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Title"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={120} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{Object.entries(HUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Hunting area"><Select value={v.area} onChange={(e) => setV({ ...v, area: e.target.value })}><option value="">None</option>{areas.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started"><Input type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required /></Field>
          <Field label="Ended" error={invalidEnd ? "End must be after start" : null}><Input type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={10000} /></Field>
        <Checkbox label="Use my current GPS position as the session location" checked={v.useGps} onChange={(e) => setV({ ...v, useGps: e.target.checked })} />
        {!session && <Checkbox label="Add me as participant" checked={v.addMe} onChange={(e) => setV({ ...v, addMe: e.target.checked })} />}
      </form>
    </Dialog>
  );
}
