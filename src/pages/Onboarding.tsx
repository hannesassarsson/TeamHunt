import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/card";

const ZONES = ["Europe/Stockholm", "Europe/Oslo", "Europe/Helsinki", "Europe/Copenhagen", "Atlantic/Reykjavik"];

export function OnboardingPage() {
  const { memberships, setOrgId, refetch, loading } = useOrg();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Stockholm");
  const [busy, setBusy] = useState(false);

  if (!loading && memberships.length > 0 && !params.get("new")) return <Navigate to="/" replace />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const org = unwrap(await supabase.rpc("create_organization", { p_name: name.trim(), p_timezone: tz })) as { id: string };
      setOrgId(org.id);
      await qc.invalidateQueries({ queryKey: ["memberships"] });
      refetch();
      toast.success("Team created");
      navigate("/map");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md p-6">
        <img src="/icon.svg" className="size-10" alt="" />
        <h1 className="mt-4 font-display text-2xl font-bold">Create your hunting team</h1>
        <p className="mt-1 text-sm text-muted">A team shares maps, cameras, observations and the journal. Joining an existing team? Ask an admin to invite your email address.</p>
        <form onSubmit={create} className="mt-6 space-y-4">
          <Field label="Team name" htmlFor="tn"><Input id="tn" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Norrskogens jaktlag" required minLength={2} maxLength={80} /></Field>
          <Field label="Time zone" hint="Used for daily summaries and activity-by-hour analytics.">
            <Select value={tz} onChange={(e) => setTz(e.target.value)}>
              {[...new Set([tz, ...ZONES])].map((z) => <option key={z}>{z}</option>)}
            </Select>
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={busy}>Create team</Button>
          {memberships.length > 0 && <Button variant="ghost" className="w-full" onClick={() => navigate("/")}>Cancel</Button>}
        </form>
        <button className="mt-4 w-full text-center text-xs text-muted underline" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </Card>
    </div>
  );
}
