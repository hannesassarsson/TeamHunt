import { useEffect, useState, useSyncExternalStore } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as DM from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import {
  BarChart3, Bell, BookOpen, Camera, ChevronsUpDown, CloudSun, Eye, Images, LayoutDashboard, LogOut, Map, Moon, Plus, Settings, Sun, Users, Check, CloudOff, Menu,
} from "lucide-react";
import { useOrg } from "@/lib/org";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { QuickObservation } from "./QuickObservation";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { getOutbox, subscribeOutbox, syncOutbox } from "@/lib/outbox";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/map", label: "Map", icon: Map },
  { to: "/library", label: "Camera images", short: "Images", icon: Images },
  { to: "/cameras", label: "Cameras", icon: Camera },
  { to: "/observations", label: "Observations", icon: Eye },
  { to: "/journal", label: "Journal", icon: BookOpen },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/weather", label: "Weather", icon: CloudSun },
  { to: "/team", label: "Team", icon: Users },
];
const MOBILE = [NAV[0], NAV[1], NAV[2]];

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("nh-theme", next ? "dark" : "light"); } catch { /* ignore */ }
    setDark(next);
  };
  return { dark, toggle };
}

function OrgSwitcher() {
  const { org, memberships, setOrgId, role } = useOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <DM.Root>
      <DM.Trigger className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-fg">{org?.name.slice(0, 1).toUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{org?.name}</div>
          <div className="text-[11px] capitalize text-muted">{role}</div>
        </div>
        <ChevronsUpDown className="size-4 text-muted" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={6} className="z-50 min-w-60 rounded-xl border border-border bg-surface p-1 shadow-xl animate-fade-in">
          <DM.Label className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Hunting teams</DM.Label>
          {memberships.map((m) => (
            <DM.Item key={m.org_id} onSelect={() => { setOrgId(m.org_id); qc.invalidateQueries(); navigate("/"); }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
              <span className="flex-1 truncate">{m.organizations.name}</span>
              {m.org_id === org?.id && <Check className="size-4 text-primary" />}
            </DM.Item>
          ))}
          <DM.Separator className="my-1 h-px bg-border" />
          <DM.Item onSelect={() => navigate("/onboarding?new=1")} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-2">
            <Plus className="size-4" /> Create team
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function useUnreadCount() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications-unread", userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId!).is("read_at", null);
      return count ?? 0;
    },
  });
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        qc.invalidateQueries({ queryKey: ["notifications-unread"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        const n = p.new as { title?: string; body?: string };
        if (n.title) toast(n.title, { description: n.body });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [userId, qc]);
  return q.data ?? 0;
}

function useOutboxCount() {
  const count = useSyncExternalStore(subscribeOutbox, () => getOutbox().length);
  const qc = useQueryClient();
  useEffect(() => {
    const run = async () => {
      const r = await syncOutbox();
      if (r.synced) {
        toast.success(`${r.synced} offline observation${r.synced > 1 ? "s" : ""} synced`);
        qc.invalidateQueries({ queryKey: ["observations"] });
      }
    };
    void run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [qc]);
  return count;
}

export function AppShell() {
  const { email } = useAuth();
  const { dark, toggle } = useTheme();
  const unread = useUnreadCount();
  const pending = useOutboxCount();
  const [quickOpen, setQuickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { can } = useOrg();
  const onMap = useLocation().pathname === "/map";

  const link = ({ isActive }: { isActive: boolean }) =>
    cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-text", isActive && "bg-surface-2 text-text");

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2 px-5 pt-5 pb-3">
          <img src="/icon.svg" alt="" className="size-7" />
          <span className="font-display text-lg font-extrabold tracking-[0.12em]">NORDHUNT</span>
        </div>
        <div className="px-3"><OrgSwitcher /></div>
        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}><n.icon className="size-[18px]" />{n.label}</NavLink>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-border p-3">
          <NavLink to="/notifications" className={link}>
            <Bell className="size-[18px]" /> Notifications
            {unread > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-bold text-white tabular">{unread}</span>}
          </NavLink>
          <NavLink to="/settings" className={link}><Settings className="size-[18px]" /> Settings</NavLink>
          <div className="flex items-center gap-1 px-1 pt-2">
            <span className="flex-1 truncate px-2 text-xs text-muted" title={email ?? ""}>{email}</span>
            <button className="rounded-md p-2 text-muted hover:bg-surface-2" onClick={toggle} aria-label="Toggle theme">{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
            <button className="rounded-md p-2 text-muted hover:bg-surface-2" onClick={() => supabase.auth.signOut()} aria-label="Sign out"><LogOut className="size-4" /></button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 lg:hidden">
          <div className="min-w-0 flex-1"><OrgSwitcher /></div>
          <NavLink to="/notifications" className="relative rounded-md p-2 text-muted" aria-label="Notifications">
            <Bell className="size-5" />
            {unread > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
          </NavLink>
          <NavLink to="/settings" className="rounded-md p-2 text-muted" aria-label="Settings"><Settings className="size-5" /></NavLink>
        </header>
        {pending > 0 && (
          <div className="flex items-center gap-2 bg-warning/15 px-4 py-1.5 text-xs font-medium text-warning">
            <CloudOff className="size-3.5" /> {pending} observation{pending > 1 ? "s" : ""} waiting to sync
            <NavLink to="/observations" className="ml-auto underline">Review</NavLink>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <nav className="grid grid-cols-5 border-t border-border bg-surface pb-safe lg:hidden" aria-label="Mobile">
          {MOBILE.slice(0, 2).map((n) => <MobileLink key={n.to} {...n} />)}
          <button onClick={() => setQuickOpen(true)} disabled={!can("member")} className="flex flex-col items-center justify-center py-1" aria-label="Record observation">
            <span className="grid size-11 place-items-center rounded-full bg-accent text-white shadow-lg"><Plus className="size-6" /></span>
          </button>
          {MOBILE.slice(2).map((n) => <MobileLink key={n.to} {...n} />)}
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted" aria-label="More sections">
            <Menu className="size-5" />More
          </button>
        </nav>
      </div>
      {can("member") && (
        <button onClick={() => setQuickOpen(true)} className={cn("fixed right-6 hidden items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white shadow-xl hover:opacity-90 lg:flex", onMap ? "bottom-12" : "bottom-6")}>
          <Plus className="size-4" /> Observation
        </button>
      )}
      <QuickObservation open={quickOpen} onOpenChange={setQuickOpen} />
      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title="NORDHUNT" size="sm">
        <nav className="grid grid-cols-3 gap-2" onClick={() => setMoreOpen(false)}>
          {[...NAV, { to: "/notifications", label: "Alerts", icon: Bell }, { to: "/settings", label: "Settings", icon: Settings }].map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("flex flex-col items-center gap-1.5 rounded-xl border border-border px-2 py-3 text-xs font-medium", isActive ? "border-primary text-primary" : "text-muted")}>
              <n.icon className="size-5" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={toggle}>{dark ? <Sun /> : <Moon />} {dark ? "Light" : "Dark"} mode</Button>
          <Button variant="outline" className="flex-1" onClick={() => supabase.auth.signOut()}><LogOut /> Sign out</Button>
        </div>
      </Dialog>
    </div>
  );
}

function MobileLink({ to, label, short, icon: Icon, end }: { to: string; label: string; short?: string; icon: typeof Images; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted", isActive && "text-primary")}>
      <Icon className="size-5" />{short ?? label}
    </NavLink>
  );
}
