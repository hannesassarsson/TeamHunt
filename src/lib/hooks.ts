import { useQuery, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, unwrap } from "./supabase";
import { useOrg } from "./org";
import type { Camera, HuntingArea, Member, MapFeature } from "./types";

export function useCameras() {
  const { org } = useOrg();
  return useQuery({
    queryKey: ["cameras", org?.id],
    enabled: !!org,
    queryFn: async () => unwrap(await supabase.from("cameras").select("*").eq("org_id", org!.id).order("name")) as Camera[],
  });
}

export function useAreas() {
  const { org } = useOrg();
  return useQuery({
    queryKey: ["areas", org?.id],
    enabled: !!org,
    queryFn: async () => unwrap(await supabase.from("hunting_areas").select("*").eq("org_id", org!.id).order("name")) as HuntingArea[],
  });
}

export function useMapFeatures() {
  const { org } = useOrg();
  return useQuery({
    queryKey: ["map_features", org?.id],
    enabled: !!org,
    queryFn: async () => unwrap(await supabase.from("map_features").select("*").eq("org_id", org!.id).order("name").limit(5000)) as MapFeature[],
  });
}

export function useMembers() {
  const { org } = useOrg();
  return useQuery({
    queryKey: ["members", org?.id],
    enabled: !!org,
    queryFn: async () => unwrap(await supabase.rpc("org_members", { p_org: org!.id })) as Member[],
  });
}

const urlCache = new Map<string, { url: string; exp: number }>();

/** Batch-sign private storage paths (cached ~50 min). */
export function useSignedUrls(bucket: "camera-images" | "journal-photos", paths: string[]) {
  const key = paths.slice().sort().join("|");
  return useQuery({
    queryKey: ["signed", bucket, key],
    enabled: paths.length > 0,
    staleTime: 45 * 60_000,
    queryFn: async () => {
      const now = Date.now();
      const out: Record<string, string> = {};
      const missing = paths.filter((p) => {
        const c = urlCache.get(bucket + p);
        if (c && c.exp > now) out[p] = c.url;
        return !out[p];
      });
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, 3600);
        if (error) throw error;
        for (const d of data ?? []) {
          if (d.signedUrl && d.path) {
            out[d.path] = d.signedUrl;
            urlCache.set(bucket + d.path, { url: d.signedUrl, exp: now + 50 * 60_000 });
          }
        }
      }
      return out;
    },
  });
}

/** Mutation helper with toast feedback and cache invalidation. */
export function useAction<TVars, TResult = unknown>(fn: (v: TVars) => Promise<TResult>, opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TResult, v: TVars) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Something went wrong"),
  });
}

/** Storage path to show in grids: the worker-generated thumbnail when available. */
export const thumbOf = (img: { thumb_path?: string | null; storage_path: string }) => img.thumb_path ?? img.storage_path;

/** Camera online state from last image time. */
export function cameraStatus(c: Camera): "online" | "offline" | "never" | "inactive" {
  if (!c.active) return "inactive";
  if (!c.last_seen_at) return "never";
  return Date.now() - new Date(c.last_seen_at).getTime() > c.offline_after_hours * 3_600_000 ? "offline" : "online";
}
