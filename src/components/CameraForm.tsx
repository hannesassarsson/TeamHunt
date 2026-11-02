import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Crosshair } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useAction, useAreas } from "@/lib/hooks";
import { useOrg } from "@/lib/org";
import { getPosition } from "@/lib/geolocation";
import type { Camera } from "@/lib/types";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "./ui/form";

export function CameraForm({ open, onOpenChange, camera, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; camera?: Camera | null; onSaved?: (c: Camera) => void }) {
  const { org } = useOrg();
  const areas = useAreas();
  const [v, setV] = useState({ name: "", model: "", serial: "", lat: "", lon: "", heading: "", area: "", notes: "", offline: "48", active: true });
  useEffect(() => {
    if (open) setV({
      name: camera?.name ?? "", model: camera?.model ?? "", serial: camera?.serial ?? "",
      lat: camera?.lat?.toString() ?? "", lon: camera?.lon?.toString() ?? "", heading: camera?.heading_deg?.toString() ?? "",
      area: camera?.area_id ?? "", notes: camera?.notes ?? "", offline: String(camera?.offline_after_hours ?? 48), active: camera?.active ?? true,
    });
  }, [open, camera]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const latN = v.lat === "" ? null : Number(v.lat), lonN = v.lon === "" ? null : Number(v.lon);
  const posInvalid = (latN === null) !== (lonN === null) || (latN !== null && (Number.isNaN(latN) || Math.abs(latN) > 90)) || (lonN !== null && (Number.isNaN(lonN) || Math.abs(lonN) > 180));

  const save = useAction(async () => {
    const row = {
      name: v.name.trim(), model: v.model.trim() || null, serial: v.serial.trim() || null, lat: latN, lon: lonN,
      heading_deg: v.heading === "" ? null : Math.round(Number(v.heading)) % 360, area_id: v.area || null, notes: v.notes.trim() || null,
      offline_after_hours: Math.max(1, Math.min(2160, Number(v.offline) || 48)), active: v.active,
    };
    return (camera
      ? unwrap(await supabase.from("cameras").update(row).eq("id", camera.id).select().single())
      : unwrap(await supabase.from("cameras").insert({ ...row, org_id: org!.id }).select().single())) as Camera;
  }, { success: camera ? "Camera updated" : "Camera added", invalidate: [["cameras"], ["camera"]], onSuccess: (c) => { onOpenChange(false); onSaved?.(c); } });

  const locate = async () => {
    try { const p = await getPosition(); setV((s) => ({ ...s, lat: p.lat.toFixed(6), lon: p.lon.toFixed(6) })); toast.success(`Position set (±${Math.round(p.accuracy)} m)`); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={camera ? "Edit camera" : "Add camera"}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!v.name.trim() || posInvalid}>Save</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (v.name.trim() && !posInvalid) save.mutate(); }}>
        <Field label="Name"><Input value={v.name} onChange={set("name")} required maxLength={80} placeholder="e.g. Myren norr" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model"><Input value={v.model} onChange={set("model")} maxLength={80} placeholder="e.g. Burrel S12" /></Field>
          <Field label="Serial / IMEI"><Input value={v.serial} onChange={set("serial")} maxLength={80} /></Field>
        </div>
        <Field label="Location" hint="Standing at the camera? Use GPS. You can also place it on the map later." error={posInvalid ? "Enter both latitude and longitude in decimal degrees" : null}>
          <div className="flex gap-2">
            <Input inputMode="decimal" placeholder="Latitude" value={v.lat} onChange={set("lat")} />
            <Input inputMode="decimal" placeholder="Longitude" value={v.lon} onChange={set("lon")} />
            <Button variant="outline" size="icon" onClick={locate} aria-label="Use my position"><Crosshair /></Button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Facing (°)"><Input type="number" min={0} max={359} value={v.heading} onChange={set("heading")} placeholder="0 = north" /></Field>
          <Field label="Offline after (hours)" hint="Alert when no image arrives for this long."><Input type="number" min={1} max={2160} value={v.offline} onChange={set("offline")} /></Field>
        </div>
        {areas.data && areas.data.length > 0 && (
          <Field label="Hunting area"><Select value={v.area} onChange={set("area")}><option value="">None</option>{areas.data.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        )}
        <Field label="Notes"><Textarea value={v.notes} onChange={set("notes")} maxLength={2000} /></Field>
        <Checkbox label="Active (monitored for offline alerts and accepts uploads)" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} />
      </form>
    </Dialog>
  );
}
