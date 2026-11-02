import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  if (online) return null;
  return (
    <div className="flex items-center gap-2 bg-surface-2 px-4 py-1.5 text-xs font-medium text-muted" role="status">
      <WifiOff className="size-3.5" /> You're offline. Observations are saved on this device and synced when you reconnect.
    </div>
  );
}
