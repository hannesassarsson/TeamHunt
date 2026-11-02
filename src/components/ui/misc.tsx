import type { ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import * as T from "@radix-ui/react-tabs";
import * as S from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "primary" | "accent" | "success" | "danger" | "warning" | "info"; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    primary: "bg-primary/12 text-primary",
    accent: "bg-accent-soft text-accent",
    success: "bg-success/12 text-success",
    danger: "bg-danger/12 text-danger",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/12 text-info",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", tones[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-muted", className)} aria-label="Loading" />;
}

export function PageLoader() {
  return <div className="flex h-64 items-center justify-center"><Spinner /></div>;
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center", className)}>
      <div className="mb-3 rounded-full bg-surface-2 p-3"><Icon className="size-6 text-muted" /></div>
      <h3 className="font-display font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
      {error instanceof Error ? error.message : "Something went wrong."}
      {onRetry && <button className="ml-2 underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: "accent" | "danger" | "success" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {Icon && <Icon className={cn("size-4", tone === "accent" && "text-accent", tone === "danger" && "text-danger", tone === "success" && "text-success")} />}
      </div>
      <div className="mt-2 font-display text-2xl font-bold tabular">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Tabs({ value, onValueChange, tabs, children, className }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: ReactNode }[]; children: ReactNode; className?: string }) {
  return (
    <T.Root value={value} onValueChange={onValueChange} className={className}>
      <T.List className="mb-4 inline-flex rounded-lg bg-surface-2 p-1">
        {tabs.map((t) => (
          <T.Trigger key={t.value} value={t.value} className="rounded-md px-3 py-1.5 text-sm font-medium text-muted transition data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm">
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}
export const TabPanel = T.Content;

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <S.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="relative h-6 w-10 shrink-0 rounded-full bg-border transition data-[state=checked]:bg-primary disabled:opacity-50">
        <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[18px]" />
      </S.Root>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-lg bg-surface-2 p-1", className)} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-md px-2.5 py-1 text-xs font-medium text-muted transition", value === o.value && "bg-surface text-text shadow-sm")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
