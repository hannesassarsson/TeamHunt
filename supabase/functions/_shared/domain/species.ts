// Nordic species catalog. Mirrors public.species (migration 20261102000003). Keep in sync.
export type SpeciesCategory =
  | "ungulate" | "large_carnivore" | "small_carnivore" | "small_game" | "bird" | "other" | "non_animal";

export interface Species {
  code: string;
  en: string;
  sv: string;
  scientific?: string;
  category: SpeciesCategory;
  /** Extra labels AI providers commonly return for this species (lowercase). */
  aliases?: string[];
}

export const SPECIES: Species[] = [
  { code: "moose", en: "Moose", sv: "Älg", scientific: "Alces alces", category: "ungulate", aliases: ["elk", "eurasian elk", "alces"] },
  { code: "roe_deer", en: "Roe deer", sv: "Rådjur", scientific: "Capreolus capreolus", category: "ungulate", aliases: ["roe", "european roe deer"] },
  { code: "red_deer", en: "Red deer", sv: "Kronhjort", scientific: "Cervus elaphus", category: "ungulate", aliases: ["deer stag", "cervus"] },
  { code: "fallow_deer", en: "Fallow deer", sv: "Dovhjort", scientific: "Dama dama", category: "ungulate" },
  { code: "white_tailed_deer", en: "White-tailed deer", sv: "Vitsvanshjort", scientific: "Odocoileus virginianus", category: "ungulate", aliases: ["whitetail"] },
  { code: "wild_boar", en: "Wild boar", sv: "Vildsvin", scientific: "Sus scrofa", category: "ungulate", aliases: ["boar", "wild pig", "feral pig", "pig"] },
  { code: "reindeer", en: "Reindeer", sv: "Ren", scientific: "Rangifer tarandus", category: "ungulate", aliases: ["caribou"] },
  { code: "mouflon", en: "Mouflon", sv: "Mufflon", scientific: "Ovis gmelini musimon", category: "ungulate" },
  { code: "brown_bear", en: "Brown bear", sv: "Brunbjörn", scientific: "Ursus arctos", category: "large_carnivore", aliases: ["bear"] },
  { code: "wolf", en: "Wolf", sv: "Varg", scientific: "Canis lupus", category: "large_carnivore", aliases: ["gray wolf", "grey wolf"] },
  { code: "lynx", en: "Eurasian lynx", sv: "Lodjur", scientific: "Lynx lynx", category: "large_carnivore" },
  { code: "wolverine", en: "Wolverine", sv: "Järv", scientific: "Gulo gulo", category: "large_carnivore" },
  { code: "red_fox", en: "Red fox", sv: "Rödräv", scientific: "Vulpes vulpes", category: "small_carnivore", aliases: ["fox"] },
  { code: "badger", en: "European badger", sv: "Grävling", scientific: "Meles meles", category: "small_carnivore" },
  { code: "pine_marten", en: "Pine marten", sv: "Mård", scientific: "Martes martes", category: "small_carnivore", aliases: ["marten"] },
  { code: "raccoon_dog", en: "Raccoon dog", sv: "Mårdhund", scientific: "Nyctereutes procyonoides", category: "small_carnivore" },
  { code: "otter", en: "Eurasian otter", sv: "Utter", scientific: "Lutra lutra", category: "small_carnivore" },
  { code: "mink", en: "American mink", sv: "Mink", scientific: "Neogale vison", category: "small_carnivore" },
  { code: "stoat", en: "Stoat", sv: "Hermelin", scientific: "Mustela erminea", category: "small_carnivore", aliases: ["ermine", "weasel"] },
  { code: "mountain_hare", en: "Mountain hare", sv: "Skogshare", scientific: "Lepus timidus", category: "small_game", aliases: ["hare", "snow hare"] },
  { code: "brown_hare", en: "European hare", sv: "Fälthare", scientific: "Lepus europaeus", category: "small_game", aliases: ["brown hare"] },
  { code: "beaver", en: "Eurasian beaver", sv: "Bäver", scientific: "Castor fiber", category: "small_game" },
  { code: "red_squirrel", en: "Red squirrel", sv: "Ekorre", scientific: "Sciurus vulgaris", category: "small_game", aliases: ["squirrel"] },
  { code: "capercaillie", en: "Western capercaillie", sv: "Tjäder", scientific: "Tetrao urogallus", category: "bird" },
  { code: "black_grouse", en: "Black grouse", sv: "Orre", scientific: "Lyrurus tetrix", category: "bird" },
  { code: "hazel_grouse", en: "Hazel grouse", sv: "Järpe", scientific: "Tetrastes bonasia", category: "bird" },
  { code: "willow_ptarmigan", en: "Willow ptarmigan", sv: "Dalripa", scientific: "Lagopus lagopus", category: "bird", aliases: ["willow grouse", "ptarmigan"] },
  { code: "rock_ptarmigan", en: "Rock ptarmigan", sv: "Fjällripa", scientific: "Lagopus muta", category: "bird" },
  { code: "pheasant", en: "Common pheasant", sv: "Fasan", scientific: "Phasianus colchicus", category: "bird" },
  { code: "mallard", en: "Mallard", sv: "Gräsand", scientific: "Anas platyrhynchos", category: "bird", aliases: ["duck"] },
  { code: "canada_goose", en: "Canada goose", sv: "Kanadagås", scientific: "Branta canadensis", category: "bird", aliases: ["goose"] },
  { code: "corvid", en: "Crow / raven / magpie", sv: "Kråkfågel", scientific: "Corvidae", category: "bird", aliases: ["crow", "raven", "magpie", "jay", "hooded crow"] },
  { code: "bird_other", en: "Other bird", sv: "Annan fågel", category: "bird", aliases: ["bird"] },
  { code: "domestic_dog", en: "Dog", sv: "Hund", scientific: "Canis familiaris", category: "other", aliases: ["dog", "hunting dog"] },
  { code: "domestic_cat", en: "Cat", sv: "Katt", scientific: "Felis catus", category: "other", aliases: ["cat"] },
  { code: "livestock", en: "Livestock", sv: "Tamdjur", category: "other", aliases: ["cow", "cattle", "sheep", "horse", "goat"] },
  { code: "animal_unknown", en: "Unidentified animal", sv: "Oidentifierat djur", category: "other", aliases: ["animal", "unknown animal", "mammal"] },
  { code: "human", en: "Person", sv: "Människa", scientific: "Homo sapiens", category: "non_animal", aliases: ["person", "people", "hunter"] },
  { code: "vehicle", en: "Vehicle", sv: "Fordon", category: "non_animal", aliases: ["car", "truck", "atv", "tractor"] },
];

const BY_CODE = new Map(SPECIES.map((s) => [s.code, s]));

export function getSpecies(code: string | null | undefined): Species | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

export function speciesLabel(code: string | null | undefined, lang: "en" | "sv" = "en"): string {
  const s = getSpecies(code);
  if (!s) return code ?? "Unknown";
  return lang === "sv" ? s.sv : s.en;
}

export function isAnimal(code: string): boolean {
  const s = getSpecies(code);
  return !!s && s.category !== "non_animal";
}

function normalise(label: string): string {
  return label.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

const LOOKUP = new Map<string, string>();
for (const s of SPECIES) {
  for (const key of [s.code, s.en, s.sv, s.scientific, ...(s.aliases ?? [])]) {
    if (key) LOOKUP.set(normalise(key), s.code);
  }
}

/**
 * Map a free-text label from an AI provider to a catalog code.
 * Returns null when the label cannot be mapped (caller decides whether to use animal_unknown).
 */
export function resolveSpeciesCode(label: string | null | undefined): string | null {
  if (!label) return null;
  const n = normalise(label);
  if (LOOKUP.has(n)) return LOOKUP.get(n)!;
  // Taxonomy strings such as "mammalia;artiodactyla;cervidae;alces;alces alces" (SpeciesNet).
  const parts = n.split(/[;|>/]/).map((p) => p.trim()).filter(Boolean).reverse();
  for (const p of parts) if (LOOKUP.has(p)) return LOOKUP.get(p)!;
  return null;
}
