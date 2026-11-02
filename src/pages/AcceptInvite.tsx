import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, unwrap } from "@/lib/supabase";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/misc";

export function AcceptInvitePage() {
  const { token } = useParams();
  const { email } = useAuth();
  const { setOrgId } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current || !token) return;
    once.current = true;
    (async () => {
      try {
        const orgId = unwrap(await supabase.rpc("accept_invitation", { p_token: token })) as string;
        await qc.invalidateQueries({ queryKey: ["memberships"] });
        setOrgId(orgId);
        navigate("/", { replace: true });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [token, navigate, qc, setOrgId]);

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        {error ? (
          <>
            <h1 className="font-display text-xl font-bold">Could not accept invitation</h1>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <p className="mt-2 text-xs text-muted">Signed in as {email}</p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="outline" onClick={() => supabase.auth.signOut()}>Use another account</Button>
              <Button onClick={() => navigate("/")}>Continue</Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6"><Spinner /> Joining team…</div>
        )}
      </Card>
    </div>
  );
}
