import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Segmented } from "@/components/ui/misc";
import { Camera, Map, Users } from "lucide-react";

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  if (session) return <Navigate to={next.startsWith("/") ? next : "/"} replace />;

  const redirectTo = `${location.origin}${next.startsWith("/") ? next : "/"}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { display_name: name.trim() } } });
        if (error) throw error;
        if (!data.session) setSent("Check your inbox to confirm your email address.");
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setSent("We sent you a sign-in link.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-[#0f1714] p-12 text-[#e6ebe7] lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(1200px 600px at 20% 110%, #2f5d50 0%, transparent 60%), radial-gradient(800px 400px at 90% -10%, #b9802f 0%, transparent 55%)" }} />
        <div className="relative flex items-center gap-2"><img src="/icon.svg" className="size-8" alt="" /><span className="font-display text-xl font-extrabold tracking-[0.14em]">NORDHUNT</span></div>
        <div className="relative mt-auto max-w-md">
          <h2 className="font-display text-4xl font-bold leading-tight">Wildlife intelligence for Nordic hunting teams.</h2>
          <ul className="mt-8 space-y-4 text-sm text-[#b7c3bc]">
            <li className="flex gap-3"><Map className="size-5 text-[#d9a55b]" /> Plan areas, stands and drives on satellite and terrain maps.</li>
            <li className="flex gap-3"><Camera className="size-5 text-[#d9a55b]" /> Trail camera images classified by AI, verified by your team.</li>
            <li className="flex gap-3"><Users className="size-5 text-[#d9a55b]" /> Shared journal, observations and harvest records.</li>
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden"><img src="/icon.svg" className="size-8" alt="" /><span className="font-display text-xl font-extrabold tracking-[0.14em]">NORDHUNT</span></div>
          <h1 className="font-display text-2xl font-bold">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1 text-sm text-muted">Sign in to your hunting team.</p>
          <Segmented className="mt-6 w-full [&>button]:flex-1" value={mode} onChange={(m) => { setMode(m); setSent(null); }}
            options={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Sign up" }, { value: "magic", label: "Email link" }]} />
          {sent ? (
            <div className="mt-6 rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success">{sent}</div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "signup" && <Field label="Name" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} /></Field>}
              <Field label="Email" htmlFor="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
              {mode !== "magic" && (
                <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : undefined} />
                </Field>
              )}
              <Button type="submit" className="w-full" size="lg" loading={busy}>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send link"}</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
