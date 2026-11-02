import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Moon, Sun } from "lucide-react";
import { supabase, unwrap } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { useTheme } from "@/components/AppShell";

export default function Settings() {
  const { userId, email } = useAuth();
  const { dark, toggle } = useTheme();
  const profile = useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async () => unwrap(await supabase.from("profiles").select("display_name").eq("id", userId!).single()) as { display_name: string },
  });
  const [name, setName] = useState("");
  useEffect(() => { if (profile.data) setName(profile.data.display_name); }, [profile.data]);
  const save = useAction(async () => unwrap(await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", userId!).select()), { success: "Profile saved", invalidate: [["profile"], ["members"]] });
  const [pw, setPw] = useState("");
  const changePw = useAction(async () => { const { error } = await supabase.auth.updateUser({ password: pw }); if (error) throw error; }, { success: "Password updated", onSuccess: () => setPw("") });

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <PageHeader title="Settings" description={email ?? undefined} />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Profile" description="Your name is shown to members of your teams." />
          <CardBody>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Display name" />
              <Button type="submit" loading={save.isPending}>Save</Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
              <Field label="New password" className="flex-1"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" required /></Field>
              <Button type="submit" variant="outline" loading={changePw.isPending}>Update</Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Appearance" />
          <CardBody><Button variant="outline" onClick={toggle}>{dark ? <Sun /> : <Moon />} Switch to {dark ? "light" : "dark"} mode</Button></CardBody>
        </Card>
        <Card>
          <CardHeader title="Privacy" />
          <CardBody className="space-y-2 text-sm text-muted">
            <p>Locations, images and journal entries are visible only to members of the team they belong to. Weather lookups send coordinates rounded to about 1 km to the weather provider.</p>
            <p>AI image analysis sends camera images to the configured vision provider for classification.</p>
          </CardBody>
        </Card>
        <Button variant="ghost" className="text-danger" onClick={() => supabase.auth.signOut()}><LogOut /> Sign out</Button>
      </div>
    </div>
  );
}
