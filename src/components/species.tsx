import { SPECIES, speciesLabel, getSpecies } from "@shared/domain/species.ts";
import { TIER_LABEL, type Tier } from "@shared/domain/tiers.ts";
import { Select } from "./ui/form";
import { cn } from "@/lib/utils";
import { CheckCircle2, CircleHelp, CircleDot, XCircle } from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  ungulate: "Ungulates", large_carnivore: "Large carnivores", small_carnivore: "Small carnivores",
  small_game: "Small game", bird: "Birds", other: "Other", non_animal: "Not animals",
};

export function SpeciesSelect({ value, onChange, includeNonAnimals = false, placeholder, id, required }: {
  value: string; onChange: (v: string) => void; includeNonAnimals?: boolean; placeholder?: string; id?: string; required?: boolean;
}) {
  const groups = Object.keys(CATEGORY_LABEL).filter((c) => includeNonAnimals || c !== "non_animal");
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {groups.map((g) => (
        <optgroup key={g} label={CATEGORY_LABEL[g]}>
          {SPECIES.filter((s) => s.category === g).map((s) => (
            <option key={s.code} value={s.code}>{s.en} · {s.sv}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export function SpeciesName({ code, className }: { code: string; className?: string }) {
  const s = getSpecies(code);
  return (
    <span className={className}>
      {speciesLabel(code)}
      {s && <span className="ml-1 text-muted font-normal">· {s.sv}</span>}
    </span>
  );
}

const TIER_STYLE: Record<Tier, { cls: string; Icon: typeof CheckCircle2; help: string }> = {
  confirmed: { cls: "bg-tier-confirmed/15 text-tier-confirmed", Icon: CheckCircle2, help: "Verified by a team member" },
  probable: { cls: "bg-tier-probable/15 text-tier-probable", Icon: CircleDot, help: "AI confidence above your team's threshold — not yet verified" },
  uncertain: { cls: "bg-tier-uncertain/15 text-tier-uncertain", Icon: CircleHelp, help: "Low AI confidence — needs review" },
  rejected: { cls: "bg-danger/10 text-danger line-through", Icon: XCircle, help: "Rejected by a reviewer" },
};

export function TierBadge({ tier, confidence, className }: { tier: Tier; confidence?: number | null; className?: string }) {
  const s = TIER_STYLE[tier];
  return (
    <span title={s.help} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", s.cls, className)}>
      <s.Icon className="size-3" />
      {TIER_LABEL[tier]}
      {confidence != null && tier !== "confirmed" && <span className="tabular opacity-80">{Math.round(confidence * 100)}%</span>}
    </span>
  );
}
