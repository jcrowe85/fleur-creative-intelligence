// The creator-facing "what do you make?" content types shown at onboarding.
//
// Each maps to the taxonomy `format`/`production` values the corpus is classified
// on, so the onboarding pick can (a) show a real example clip of that lane and
// (b) seed the feed toward it immediately — no cold-start scrolling. The swipe
// algorithm still refines persona/hook/etc. on top of this seed.
//
// Note: AI-generated and VSL/long-form are intentionally omitted for now — the
// corpus has no taxonomy values for them yet. They become content types once the
// classifier + corpus gain those dimensions.

export interface ContentType {
  key: string;
  label: string;
  description: string;
  /** ReferenceAnalysis.format values this lane maps to. */
  formats: string[];
  /** ReferenceAnalysis.production values this lane maps to. */
  production?: string[];
}

export const CONTENT_TYPES: ContentType[] = [
  {
    key: "talking_head_ugc",
    label: "Talking-head UGC",
    description: "Selfie-style, straight to camera — you talking to your phone.",
    formats: ["talking_head_ugc"],
    production: ["ugc_native"],
  },
  {
    key: "voiceover_broll",
    label: "Voiceover + B-roll",
    description: "You narrate over edited clips and product shots.",
    formats: ["voiceover_broll"],
  },
  {
    key: "product_demo",
    label: "Product demo & routines",
    description: "Showing the product in use — steps, routines, results.",
    formats: ["routine_demo", "product_macro"],
  },
  {
    key: "animation_motion",
    label: "Animation & Motion",
    description: "Motion graphics, animated explainers, kinetic text.",
    formats: ["animation_motion"],
    production: ["animated"],
  },
  {
    key: "founder_expert",
    label: "Founder & Expert",
    description: "Authority-led — founder story or expert explainer.",
    formats: ["founder_piece", "expert_explainer"],
  },
  {
    key: "street_interview",
    label: "Street interviews",
    description: "Vox-pop, on-the-street reactions and testimonials.",
    formats: ["street_interview"],
  },
];

export const CONTENT_TYPE_KEYS = new Set(CONTENT_TYPES.map((c) => c.key));

/** All taxonomy format values covered by the chosen content types. */
export function formatsForKeys(keys: string[]): string[] {
  const set = new Set<string>();
  for (const k of keys) CONTENT_TYPES.find((c) => c.key === k)?.formats.forEach((f) => set.add(f));
  return [...set];
}

/**
 * A seed-affinity function derived from the creator's onboarding picks. Boosts
 * the chosen lanes' formats/production, down-weights other formats (only once
 * something is chosen), neutral otherwise. Learned affinity layers on top.
 *
 * The boost has to beat W_GAP (2.0 in feed.ts), because a thin lane usually
 * sits on pillars Fleur has no gap in: 18 of the 21 street interviews are
 * social_proof, which carries no gap weight at all. At +1.2/-0.4 the gap term
 * outvoted the creator's own pick and exactly one street interview reached a
 * 60-card feed. At +4.0/-1.5 the whole lane surfaces.
 */
export function contentTypeSeed(keys: string[]): (attr: string, value: string) => number {
  const boostFormat = new Set<string>();
  const boostProduction = new Set<string>();
  for (const k of keys) {
    const ct = CONTENT_TYPES.find((c) => c.key === k);
    if (!ct) continue;
    ct.formats.forEach((f) => boostFormat.add(f));
    (ct.production ?? []).forEach((p) => boostProduction.add(p));
  }
  const chose = boostFormat.size > 0;
  return (attr, value) => {
    if (attr === "format") return boostFormat.has(value) ? 4.0 : chose ? -1.5 : 0;
    if (attr === "production") return boostProduction.has(value) ? 0.8 : 0;
    return 0;
  };
}
