import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Crosshair, ImagePlus } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useAction, useMembers } from "@/lib/hooks";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { getPosition } from "@/lib/geolocation";
import type { Harvest } from "@/lib/types";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea } from "./ui/form";
import { SpeciesSelect } from "./species";
import { fmt, fromLocalInput, toLocalInput } from "@/lib/utils";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/upload";

export function HarvestForm({ open, onOpenChange, sessionId, harvest }: { open: boolean; onOpenChange: (v: boolean) => void; sessionId: string | null; harvest?: Harvest | null }) {
  const { org } = useOrg();
  const { userId } = useAuth();
  const members = useMembers();
  const [v, setV] = useState({ species: "moose", sex: "unknown", age: "unknown", weight: "", points: "", when: toLocalInput(), shooter: "", shooterName: "", notes: "", lat: "", lon: "" });
  const [photos, setPhotos] = useState<File[]>([]);
  useEffect(() => {
    if (!open) return;
    setPhotos([]);
    setV({
      species: harvest?.species_code ?? "moose", sex: harvest?.sex ?? "unknown", age: harvest?.age_class ?? "unknown",
      weight: harvest?.weight_kg?.toString() ?? "", points: harvest?.antler_points?.toString() ?? "", when: toLocalInput(harvest?.harvested_at ?? new Date()),
      shooter: harvest ? harvest.shooter_user_id ?? "" : userId ?? "", shooterName: harvest?.shooter_name ?? "", notes: harvest?.notes ?? "",
      lat: harvest?.lat?.toString() ?? "", lon: harvest?.lon?.toString() ?? "",
    });
  }, [open, harvest, userId]);

  const save = useAction(async () => {
    const paths = [...(harvest?.photo_paths ?? [])];
    for (const f of photos.slice(0, 10 - paths.length)) {
      const path = `${org!.id}/harvests/${crypto.randomUUID()}.${f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg"}`;
      const up = await supabase.storage.from("journal-photos").upload(path, f, { contentType: f.type });
      if (up.error) throw new Error(`Photo upload failed: ${up.error.message}`);
      paths.push(path);
    }
    const row = {
      species_code: v.species, sex: v.sex, age_class: v.age, weight_kg: v.weight ? Number(v.weight) : null, antler_points: v.points ? Number(v.points) : null,
      harvested_at: fromLocalInput(v.when), shooter_user_id: v.shooter || null, shooter_name: v.shooter ? null : v.shooterName.trim() || null,
      notes: v.notes.trim() || null, lat: v.lat ? Number(v.lat) : null, lon: v.lon ? Number(v.lon) : null, photo_paths: paths,
    };
    return harvest
      ? unwrap(await supabase.from("harvests").update(row).eq("id", harvest.id).select().single())
      : unwrap(await supabase.from("harvests").insert({ ...row, org_id: org!.id, session_id: sessionId }).select().single());
  }, { success: harvest ? "Harvest updated" : "Harvest registered", invalidate: [["harvests"], ["session"], ["sessions"]], onSuccess: () => onOpenChange(false) });

  const locate = async () => {
    try { const p = await getPosition(); setV((s) => ({ ...s, lat: p.lat.toFixed(6), lon: p.lon.toFixed(6) })); }
    catch (e) { toast.error((e as Error).message); }
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const posInvalid = (!!v.lat) !== (!!v.lon);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={harvest ? "Edit harvest" : "Register harvest"} description="Recorded by the hunter. Never inferred from images."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={posInvalid}>Save</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Species"><SpeciesSelect value={v.species} onChange={(s) => setV({ ...v, species: s })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sex"><Select value={v.sex} onChange={set("sex")}><option value="unknown">Unknown</option><option value="male">Male</option><option value="female">Female</option></Select></Field>
          <Field label="Age class"><Select value={v.age} onChange={set("age")}><option value="unknown">Unknown</option><option value="juvenile">Calf / juvenile</option><option value="yearling">Yearling</option><option value="adult">Adult</option></Select></Field>
          <Field label="Weight (kg)"><Input type="number" inputMode="decimal" min={0.1} max={1499} step={0.1} value={v.weight} onChange={set("weight")} /></Field>
          <Field label="Antler points"><Input type="number" min={0} max={40} value={v.points} onChange={set("points")} /></Field>
        </div>
        <Field label="Time"><Input type="datetime-local" value={v.when} onChange={set("when")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shooter"><Select value={v.shooter} onChange={set("shooter")}><option value="">Guest / other</option>{members.data?.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}</option>)}</Select></Field>
          {!v.shooter && <Field label="Guest name"><Input value={v.shooterName} onChange={set("shooterName")} maxLength={80} /></Field>}
        </div>
        <Field label="Location" error={posInvalid ? "Enter both latitude and longitude" : null} hint={v.lat && v.lon ? fmt.coord(Number(v.lat), Number(v.lon)) : undefined}>
          <div className="flex gap-2">
            <Input inputMode="decimal" placeholder="Latitude" value={v.lat} onChange={set("lat")} />
            <Input inputMode="decimal" placeholder="Longitude" value={v.lon} onChange={set("lon")} />
            <Button variant="outline" size="icon" onClick={locate} aria-label="Use my position"><Crosshair /></Button>
          </div>
        </Field>
        <Field label="Photos" hint={`${(harvest?.photo_paths.length ?? 0) + photos.length} / 10`}>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted">
            <ImagePlus className="size-4" /> {photos.length ? `${photos.length} photo(s) selected` : "Add photos"}
            <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} multiple capture="environment" className="hidden"
              onChange={(e) => setPhotos([...(e.target.files ?? [])].filter((f) => f.size <= MAX_IMAGE_BYTES && ACCEPTED_IMAGE_TYPES.includes(f.type)))} />
          </label>
        </Field>
        <Field label="Notes"><Textarea value={v.notes} onChange={set("notes")} maxLength={4000} placeholder="Shot placement, tracking, dog work…" /></Field>
      </form>
    </Dialog>
  );
}
