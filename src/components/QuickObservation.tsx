import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, Minus, Plus, WifiOff } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, Select, Textarea, Input } from "./ui/form";
import { SpeciesSelect } from "./species";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/supabase";
import { getPosition, type Position } from "@/lib/geolocation";
import { enqueueObservation, isNetworkError } from "@/lib/outbox";
import { cn, fmt, fromLocalInput, toLocalInput, getStored, setStored } from "@/lib/utils";
import { speciesLabel } from "@shared/domain/species.ts";
import type { HuntSession } from "@/lib/types";

const QUICK = ["moose", "roe_deer", "wild_boar", "red_deer", "fallow_deer", "red_fox", "brown_bear", "lynx"];
const KINDS = [["sighting", "Sighting"], ["track", "Tracks"], ["scat", "Droppings"], ["sound", "Heard"], ["bed", "Bed / lay"], ["browsing", "Browsing"], ["carcass", "Carcass"], ["other", "Other"]] as const;

export function QuickObservation({ open, onOpenChange, sessionId }: { open: boolean; onOpenChange: (v: boolean) => void; sessionId?: string | null }) {
  const { org } = useOrg();
  const { userId } = useAuth();
  const qc = useQueryClient();
  const recent = getStored<string[]>("nh-recent-species", []);
  const quick = [...new Set([...recent, ...QUICK])].slice(0, 8);
  const [species, setSpecies] = useState(quick[0] ?? "moose");
  const [count, setCount] = useState(1);
  const [kind, setKind] = useState("sighting");
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState(toLocalInput());
  const [pos, setPos] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [session, setSession] = useState<string>(sessionId ?? "");
  const [saving, setSaving] = useState(false);

  const sessions = useQuery({
    queryKey: ["open-sessions", org?.id],
    enabled: open && !!org,
    queryFn: async () => unwrap(await supabase.from("hunt_sessions").select("id, title, started_at, ended_at").eq("org_id", org!.id)
      .gte("started_at", new Date(Date.now() - 2 * 86_400_000).toISOString()).order("started_at", { ascending: false }).limit(10)) as HuntSession[],
  });

  const locate = async () => {
    setLocating(true);
    try {
      setPos(await getPosition());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (open) {
      setWhen(toLocalInput());
      setNotes("");
      setCount(1);
      setSession(sessionId ?? "");
      void locate();
    }
  }, [open, sessionId]);

  useEffect(() => {
    if (!session && sessions.data) {
      const active = sessions.data.find((s) => !s.ended_at);
      if (active) setSession(active.id);
    }
  }, [sessions.data, session]);

  const save = async () => {
    if (!org || !userId) return;
    setSaving(true);
    const row = {
      org_id: org.id, species_code: species, kind, count, observed_at: fromLocalInput(when),
      lat: pos?.lat ?? null, lon: pos?.lon ?? null, accuracy_m: pos ? Math.round(pos.accuracy) : null,
      notes: notes.trim() || null, session_id: session || null,
    };
    setStored("nh-recent-species", [species, ...recent.filter((s) => s !== species)].slice(0, 6));
    try {
      const { error } = await supabase.from("observations").insert(row);
      if (error) throw error;
      toast.success(`${speciesLabel(species)} recorded`);
      qc.invalidateQueries({ queryKey: ["observations"] });
      onOpenChange(false);
    } catch (e) {
      if (isNetworkError(e)) {
        enqueueObservation(row);
        toast.message("Saved offline", { description: "It will sync automatically when you're back online." });
        onOpenChange(false);
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Record observation" description={org?.name}
      footer={<>
        {!navigator.onLine && <span className="mr-auto inline-flex items-center gap-1 text-xs text-warning"><WifiOff className="size-3.5" /> Offline — will sync later</span>}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={save} loading={saving} size="lg">Save</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {quick.map((s) => (
            <button key={s} type="button" onClick={() => setSpecies(s)}
              className={cn("rounded-xl border px-1 py-3 text-xs font-semibold leading-tight transition", species === s ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface-2 hover:border-primary/50")}>
              {speciesLabel(s)}
            </button>
          ))}
        </div>
        <Field label="Species"><SpeciesSelect value={species} onChange={setSpecies} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Count">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Decrease" onClick={() => setCount((c) => Math.max(1, c - 1))}><Minus /></Button>
              <span className="w-8 text-center font-display text-xl font-bold tabular">{count}</span>
              <Button variant="outline" size="icon" aria-label="Increase" onClick={() => setCount((c) => Math.min(1000, c + 1))}><Plus /></Button>
            </div>
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Location" hint={pos ? `±${Math.round(pos.accuracy)} m` : "Location helps the team map activity. You can save without it."}>
          <div className="flex items-center gap-2">
            <div className="flex-1 truncate rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm tabular">{pos ? fmt.coord(pos.lat, pos.lon) : locating ? "Locating…" : "No position"}</div>
            <Button variant="outline" onClick={locate} loading={locating}><Crosshair /> GPS</Button>
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Time"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Hunt session">
            <Select value={session} onChange={(e) => setSession(e.target.value)}>
              <option value="">None</option>
              {sessions.data?.map((s) => <option key={s.id} value={s.id}>{s.title}{!s.ended_at ? " (active)" : ""}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Direction of travel, behaviour, sign…" /></Field>
      </div>
    </Dialog>
  );
}
