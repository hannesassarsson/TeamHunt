import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase, unwrap } from "./supabase";
import { useAuth } from "./auth";
import type { Membership, Organization, Role } from "./types";
import { getStored, setStored } from "./utils";
import { useState } from "react";

interface OrgState {
  memberships: Membership[];
  org: Organization | null;
  role: Role | null;
  loading: boolean;
  error: unknown;
  setOrgId: (id: string) => void;
  can: (min: Role) => boolean;
  refetch: () => void;
}

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const roleAtLeast = (role: Role | null, min: Role) => role != null && RANK[role] >= RANK[min];

const OrgContext = createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [orgId, setOrgIdState] = useState<string | null>(() => getStored("nh-org", null));
  // Memberships are cached per user on the device so the app keeps working offline in the field.
  const cacheKey = `nh-memberships-${userId}`;
  const q = useQuery({
    queryKey: ["memberships", userId],
    enabled: !!userId,
    networkMode: "offlineFirst",
    initialData: () => (userId ? getStored<Membership[] | undefined>(cacheKey, undefined) : undefined),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const rows = unwrap(await supabase.from("memberships").select("org_id, user_id, role, organizations(*)").eq("user_id", userId!)) as unknown as Membership[];
      setStored(cacheKey, rows);
      return rows;
    },
  });
  const memberships = useMemo(() => q.data ?? [], [q.data]);
  const current = memberships.find((m) => m.org_id === orgId) ?? memberships[0] ?? null;

  useEffect(() => {
    if (current && current.org_id !== orgId) setOrgIdState(current.org_id);
  }, [current, orgId]);

  const value: OrgState = {
    memberships,
    org: current?.organizations ?? null,
    role: current?.role ?? null,
    // Still "loading" while we have neither data nor a definitive answer (keeps offline users out of onboarding).
    loading: q.data === undefined && !q.isError,
    error: q.data === undefined && q.isError ? q.error : null,
    setOrgId: (id) => {
      setStored("nh-org", id);
      setOrgIdState(id);
    },
    can: (min) => roleAtLeast(current?.role ?? null, min),
    refetch: () => void q.refetch(),
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg outside OrgProvider");
  return ctx;
}

/** Current org id; only call inside routes that require an org. */
export function useOrgId(): string {
  const { org } = useOrg();
  if (!org) throw new Error("No organization selected");
  return org.id;
}
