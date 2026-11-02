// Offline outbox for field entries. Observations captured without connectivity are stored
// locally and synced automatically when the device is back online.
import { supabase } from "./supabase";
import { getStored, setStored } from "./utils";

export interface PendingObservation {
  local_id: string;
  org_id: string;
  species_code: string;
  kind: string;
  count: number | null;
  observed_at: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  notes: string | null;
  session_id: string | null;
  attempts: number;
  last_error?: string;
}

const KEY = "nh-outbox-observations";
const listeners = new Set<() => void>();

export function getOutbox(): PendingObservation[] {
  return getStored<PendingObservation[]>(KEY, []);
}

function save(items: PendingObservation[]) {
  setStored(KEY, items);
  listeners.forEach((l) => l());
}

export function subscribeOutbox(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function enqueueObservation(o: Omit<PendingObservation, "local_id" | "attempts">) {
  save([...getOutbox(), { ...o, local_id: crypto.randomUUID(), attempts: 0 }]);
}

export function isNetworkError(e: unknown): boolean {
  if (!navigator.onLine) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Failed to fetch|NetworkError|Load failed|network/i.test(msg);
}

let syncing = false;

/** Push pending items. Validation errors are kept with the error so the user can see them. */
export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0, failed = 0;
  try {
    for (const item of getOutbox()) {
      const { local_id: _l, attempts: _a, last_error: _e, ...row } = item;
      const { error } = await supabase.from("observations").insert(row);
      const rest = getOutbox();
      if (!error) {
        synced++;
        save(rest.filter((r) => r.local_id !== item.local_id));
      } else if (isNetworkError(error)) {
        break;
      } else {
        failed++;
        save(rest.map((r) => (r.local_id === item.local_id ? { ...r, attempts: r.attempts + 1, last_error: error.message } : r)));
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}

export function discardOutboxItem(localId: string) {
  save(getOutbox().filter((r) => r.local_id !== localId));
}
