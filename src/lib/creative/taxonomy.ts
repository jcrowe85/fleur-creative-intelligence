// The creative taxonomy — the vocabulary every analysed asset is scored against.
//
// WHY THIS EXISTS, MECHANICALLY
// -----------------------------
// Andromeda is Meta's *retrieval* stage: it cuts tens of millions of eligible
// ads down to roughly a thousand candidates before the auction ranks anything.
// It never ranks or prices an ad — it only decides which ads are allowed to
// compete. (Meta, "Supercharging Advantage+ automation with the next-gen
// personalized ads retrieval engine", Dec 2024; architecture in HSNN
// arXiv:2408.06653 and HILL/MoNN arXiv:2604.12965.)
//
// Ads sit in a jointly-trained hierarchical index. Index nodes and the
// retrieval model are trained together, coarse-to-fine, with FLOPs
// regularisation that explicitly balances the index. Two consequences follow,
// and they are the entire basis for this tool:
//
//   1. Near-duplicate creatives land in the same region of the index. They
//      compete with each other for the same retrieval slots instead of
//      widening the set of queries the account can be retrieved for.
//   2. Genuinely distinct creatives occupy distinct regions, so the account
//      becomes eligible for more, and more varied, retrieval events.
//
// Memento (arXiv:2605.24051), on the ranking side, retrieves user history with
// Maximal Marginal Relevance — similarity traded explicitly against diversity.
// Redundancy is actively discounted there too.
//
// WHAT THIS IS NOT. A widely-circulated claim says Andromeda performs
// "real-time vector inference to align an ad's visual Entity ID to a user's
// instantaneous psychological state." No such mechanism appears in any Meta
// paper or post. It is fabricated. Nothing in this file assumes it. The
// defensible goal is *retrieval coverage*: occupy more distinct territory, and
// avoid paying twice for the same territory.
//
// The unit of diversity is therefore not "another video" but a distinct
// combination across the axes below.

export interface TaxonomyTerm {
  id: string;
  label: string;
  /** What this term means, written for the model doing the classification. */
  definition: string;
  /** A concrete Fleur-specific instance, so the classifier has a worked example. */
  example?: string;
}

// ── Funnel position ───────────────────────────────────────────────────────────
// Kept because it is how the team already talks about media. It is a coarse
// rollup of awareness stage, not an independent fact about the creative.

export const FUNNEL_STAGES = [
  {
    id: "TOF",
    label: "Top of funnel",
    definition:
      "Earns attention from someone with no relationship to the brand and often no active intent. " +
      "Leads with a problem, a story, an idea or an entertaining hook. The product may appear late or barely.",
    example: "'Your widening part isn't in your head' — problem agitation, product shown at 20s.",
  },
  {
    id: "MOF",
    label: "Middle of funnel",
    definition:
      "Speaks to someone who knows they have the problem and is comparing ways to solve it. " +
      "Explains mechanism, differentiates from alternatives, builds credibility, handles doubt.",
    example: "'Peptides vs minoxidil — what's actually different' — category comparison.",
  },
  {
    id: "BOF",
    label: "Bottom of funnel",
    definition:
      "Speaks to someone already considering Fleur specifically. Removes the last barriers: price, " +
      "risk, objections, urgency, proof.",
    example: "'Will it make my hair greasy?' — objection handling with a demo.",
  },
] as const satisfies readonly TaxonomyTerm[];

// ── Awareness stage (Schwartz) ────────────────────────────────────────────────
// Finer-grained than funnel and far more actionable for briefing. A gap here is
// a specific missing message, not a vague "we need more TOF".

export const AWARENESS_STAGES = [
  {
    id: "unaware",
    label: "Unaware",
    definition: "Does not yet recognise they have a hair problem. Must be shown the problem exists.",
    example: "'Most people lose 50–100 hairs a day. Here's when it stops being normal.'",
  },
  {
    id: "problem_aware",
    label: "Problem aware",
    definition: "Knows something is wrong — shedding, thinning, a widening part — but not what to do.",
    example: "'Postpartum shedding peaks around month four. Here's what's happening.'",
  },
  {
    id: "solution_aware",
    label: "Solution aware",
    definition: "Knows solutions exist (peptides, minoxidil, supplements) but hasn't chosen one.",
    example: "'Why six peptides instead of one hero ingredient.'",
  },
  {
    id: "product_aware",
    label: "Product aware",
    definition: "Knows Fleur specifically. Weighing whether it works and whether it's worth it.",
    example: "'I was skeptical for 90 days. Here's the honest result.'",
  },
  {
    id: "most_aware",
    label: "Most aware",
    definition: "Ready to buy. Needs a reason to act now — offer, guarantee, scarcity.",
    example: "'Save 30% and get the scalp massager free this week.'",
  },
] as const satisfies readonly TaxonomyTerm[];

// ── Content pillars ───────────────────────────────────────────────────────────
// The conceptual territory the ad occupies — the *reason* it gives someone to
// care. `defaultFunnel` is a prior, not a rule: an asset gets its own funnel
// classification and may legitimately differ.

export interface Pillar extends TaxonomyTerm {
  defaultFunnel: (typeof FUNNEL_STAGES)[number]["id"];
  /** Fleur has an unusually deep ingredient/science story; these are the pillars
   *  competitors can least easily copy, so under-coverage here is expensive. */
  strategicPriority?: boolean;
}

export const PILLARS: readonly Pillar[] = [
  {
    id: "category_comparison",
    label: "Category Comparison",
    definition: "Positions Fleur against alternative approaches — other product categories, not named competitors.",
    example: "Peptides vs minoxidil: what's actually different, and what each one asks of you.",
    defaultFunnel: "MOF",
  },
  {
    id: "personal_story",
    label: "Personal Story / Transformation",
    definition: "First-person emotional narrative across time. The arc carries it, not the claim.",
    example: "'I stopped wearing my hair down for two years' → 90-day journey.",
    defaultFunnel: "TOF",
  },
  {
    id: "science_authority",
    label: "Science & Authority",
    definition: "Credibility through expertise — a chemist, a formulator, cited research, credentials on screen.",
    example: "A cosmetic chemist explains what copper peptides do at the follicle.",
    defaultFunnel: "MOF",
  },
  {
    id: "problem_agitation",
    label: "Problem Awareness / Pain Agitation",
    definition: "Makes the problem vivid and urgent. Names a specific, recognisable symptom.",
    example: "'Your part is widening and you've started parting it the other way to hide it.'",
    defaultFunnel: "TOF",
  },
  {
    id: "social_proof",
    label: "Social Proof & Testimonials",
    definition: "Validation from other customers — review montage, stitched reactions, UGC stack.",
    example: "Six customers in sequence describing month three.",
    defaultFunnel: "MOF",
  },
  {
    id: "education",
    label: "Education & Value Building",
    definition: "Teaches something genuinely useful before selling. Earns trust by being worth watching alone.",
    example: "'Three things your follicles need that your shampoo isn't doing.'",
    defaultFunnel: "TOF",
  },
  {
    id: "objection_handling",
    label: "Objection Handling",
    definition: "Names and dismantles a specific purchase barrier.",
    example: "'Will this make my hair greasy?' — texture demo on camera.",
    defaultFunnel: "BOF",
  },
  {
    id: "problem_solution",
    label: "Problem → Solution",
    definition: "Classic direct response: state the problem, present the product as the answer.",
    example: "Shedding and thinning → a six-peptide leave-in serum.",
    defaultFunnel: "MOF",
  },
  {
    id: "claims_benefits",
    label: "Claims & Benefits",
    definition: "Outcome-led. Leads with the result rather than the reason.",
    example: "Fuller, thicker, healthier-looking hair in 90 days.",
    defaultFunnel: "MOF",
  },
  {
    id: "direct_offer",
    label: "Direct Offer / Promotion",
    definition: "Price, bundle or promotional value is the primary message.",
    example: "'Save up to 30% and get the scalp massager free.'",
    defaultFunnel: "BOF",
  },
  {
    id: "scarcity_urgency",
    label: "Scarcity & Urgency",
    definition: "Gives a reason to act now — deadline, limited stock, closing window.",
    example: "'Only 39 gift bundles left.'",
    defaultFunnel: "BOF",
  },
  {
    id: "guarantee_risk_reversal",
    label: "Guarantee / Risk Reversal",
    definition: "Reduces perceived risk of trying — guarantee, trial period, easy cancellation.",
    example: "'Give it 90 days. If nothing changes, you don't pay for it.'",
    defaultFunnel: "BOF",
  },
  {
    id: "mechanism",
    label: "Mechanism / How It Works",
    definition:
      "Explains *why* the product works differently — the causal pathway, not the outcome. " +
      "The single most defensible pillar for Fleur because the multi-peptide story is hard to copy.",
    example: "'Most serums rely on one pathway. Fleur signals the follicle through six.'",
    defaultFunnel: "MOF",
    strategicPriority: true,
  },
  {
    id: "ingredient_spotlight",
    label: "Ingredient Spotlight",
    definition: "Gives one ingredient its own story — origin, research, what it does alone.",
    example: "'Why is this serum blue? Meet GHK-Cu.'",
    defaultFunnel: "MOF",
    strategicPriority: true,
  },
  {
    id: "myth_busting",
    label: "Myth Busting / Contrarian",
    definition: "Pattern interrupt that corrects a widely held belief. Earns attention by disagreeing.",
    example: "'Hair oil isn't fixing the problem you think it is.'",
    defaultFunnel: "TOF",
    strategicPriority: true,
  },
  {
    id: "routine_demo",
    label: "Routine / Demonstration / How-To",
    definition: "Shows the product used in real life, in sequence. Answers 'what would this actually be like'.",
    example: "Night routine: part, roll, massage, done — 40 seconds, no voiceover.",
    defaultFunnel: "MOF",
    strategicPriority: true,
  },
  {
    id: "identity_persona",
    label: "Identity / Persona",
    definition:
      "Speaks to a specific life stage or situation so directly that the viewer recognises themselves. " +
      "Pairs with the persona axis — this pillar is where the persona is the *subject*, not just the casting.",
    example: "'Postpartum shedding at month four — you are not losing your hair permanently.'",
    defaultFunnel: "TOF",
    strategicPriority: true,
  },
  {
    id: "founder_brand",
    label: "Founder / Brand Story",
    definition: "Why the brand exists, who made it, what they refused to compromise on.",
    example: "'We spent eleven months getting the copper peptide concentration right.'",
    defaultFunnel: "MOF",
    strategicPriority: true,
  },
  {
    id: "product_sensory",
    label: "Product / Sensory Experience",
    definition: "Sells the physical object and the feel of using it — texture, colour, applicator, ritual.",
    example: "Macro on the blue serum beading on the rollerball.",
    defaultFunnel: "MOF",
    strategicPriority: true,
  },
  {
    id: "lifestyle_aspirational",
    label: "Lifestyle / Aspirational",
    definition: "Sells the identity the outcome unlocks rather than the outcome itself.",
    example: "'Wearing it down again, without thinking about it.'",
    defaultFunnel: "TOF",
    strategicPriority: true,
  },
];

// ── Personas ──────────────────────────────────────────────────────────────────
// Who the ad is *for*, inferred from subject, casting and framing. Distinct from
// Meta targeting — this is what the creative itself addresses.

export interface Persona extends TaxonomyTerm {
  /** Copy in this territory carries policy risk; the analyser surfaces it. */
  complianceNote?: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: "postpartum",
    label: "Postpartum",
    definition: "New mothers experiencing the month 3–6 shedding cycle.",
    example: "'Month four is when it peaks. Here's why.'",
  },
  {
    id: "menopause",
    label: "Perimenopause / Menopause",
    definition: "Women 40+ facing hormonal thinning and texture change.",
    example: "'Your follicles aren't broken — the signal changed.'",
  },
  {
    id: "medical_weight_loss",
    label: "Rapid Weight Loss",
    definition:
      "People shedding after rapid weight loss. Address the hair cycle and nutrition, never the drug class.",
    example: "'Rapid weight loss can push follicles into the resting phase early.'",
    complianceNote:
      "Never name GLP-1 drugs, brand names, or injections. Meta bans injectable-peptide language and " +
      "Fleur has a standing rule against mentioning injectables at all. Speak to rapid weight loss generally.",
  },
  {
    id: "stress_telogen",
    label: "Stress / Telogen Shedding",
    definition: "Shedding triggered by acute stress, illness or major life events.",
    example: "'Three months after the worst of it is when the hair goes.'",
  },
  {
    id: "general_thinning",
    label: "General Thinning",
    definition: "Diffuse thinning with no stated cause — the broadest, most competitive territory.",
    example: "'It's not falling out in clumps. It's just… less.'",
  },
  {
    id: "styling_damage",
    label: "Styling & Traction Damage",
    definition: "Damage from tight styles, extensions, heat or bleach. Often edges and hairline.",
    example: "'Your edges didn't thin overnight — it was every slick-back.'",
  },
  {
    id: "scalp_health",
    label: "Scalp Health",
    definition: "Buildup, flaking, itch, irritation — scalp as the route to hair health.",
    example: "'Healthy hair is a scalp story first.'",
  },
  {
    id: "maintainer",
    label: "Preventative / Maintainer",
    definition: "No visible problem yet; wants to protect what they have. Younger skew.",
    example: "'The best time to start is before you notice.'",
  },
  {
    id: "mens_thinning",
    label: "Men's Thinning",
    definition: "Male pattern thinning — receding hairline, crown.",
    example: "'No pills. No prescription. Two minutes a night.'",
    complianceNote: "Avoid implying treatment of androgenetic alopecia as a medical condition.",
  },
  {
    id: "textured_curly",
    label: "Textured & Curly Hair",
    definition: "Curl and coil patterns — density, breakage and scalp access concerns specific to the texture.",
    example: "'60 days after the big chop.'",
  },
  {
    id: "none",
    label: "No specific persona",
    definition: "Generic address with no identifiable life stage or situation. Common and usually a weakness.",
  },
];

// ── Hook types ────────────────────────────────────────────────────────────────
// The mechanism of the first 1–3 seconds. This is the axis that multiplies
// pillars into genuinely distinct creatives most cheaply.

export const HOOK_TYPES = [
  { id: "confession", label: "Confession", definition: "Admits something personal or slightly embarrassing.", example: "'I stopped taking photos from the left side.'" },
  { id: "question", label: "Question", definition: "Opens with a direct question to the viewer.", example: "'Is your part getting wider?'" },
  { id: "warning", label: "Warning", definition: "Alerts to a risk or mistake being made now.", example: "'Stop rubbing oil into your scalp.'" },
  { id: "contrarian", label: "Contrarian", definition: "States a position against conventional wisdom.", example: "'Biotin did nothing for my hair.'" },
  { id: "curiosity_gap", label: "Curiosity Gap", definition: "Withholds the payoff to force the next second.", example: "'Nobody told me the real reason my hair thinned.'" },
  { id: "shocking_fact", label: "Shocking Fact", definition: "Opens on a surprising statistic or claim.", example: "'You lose up to 100 hairs a day before it's visible.'" },
  { id: "listicle", label: "Listicle", definition: "Announces an enumerated structure.", example: "'Three things wrecking your hairline.'" },
  { id: "pov", label: "POV", definition: "Framed as a scene the viewer is inside.", example: "'POV: you finally found something that worked.'" },
  { id: "demonstration", label: "Demonstration", definition: "Opens mid-action, showing rather than telling.", example: "Serum dispensing onto a part line, no words." },
  { id: "before_after", label: "Before / After", definition: "Leads with the visual contrast.", example: "Split screen, day 1 vs day 90." },
  { id: "expert_statement", label: "Expert Statement", definition: "Credentialed person makes an assertion.", example: "'As a trichologist, this is the part people skip.'" },
  { id: "customer_quote", label: "Customer Quote", definition: "Opens on a real review, spoken or on screen.", example: "Screenshot of a five-star review read aloud." },
  { id: "comparison", label: "Comparison", definition: "Sets two options against each other immediately.", example: "'Minoxidil vs peptides.'" },
  { id: "nobody_told_me", label: "'Nobody Told Me'", definition: "Frames the content as withheld or overlooked knowledge.", example: "'Why did nobody tell me about this serum sooner?'" },
  { id: "mistake", label: "Mistake", definition: "Names an error the viewer is probably making.", example: "'You're applying it to your hair, not your scalp.'" },
  { id: "discovery", label: "Discovery", definition: "Narrates finding something that worked.", example: "'I found this by accident.'" },
  { id: "challenge", label: "Challenge", definition: "Invites the viewer to try or test something.", example: "'Give it 90 days and count.'" },
  { id: "news_trend", label: "News / Trend", definition: "Anchors to something current or culturally live.", example: "'Everyone's talking about copper peptides.'" },
  { id: "direct_benefit", label: "Direct Benefit", definition: "States the outcome flatly in the first line.", example: "'Thicker-looking hair in 90 days.'" },
  { id: "pattern_interrupt", label: "Pattern Interrupt", definition: "Visually or sonically jarring open that breaks the scroll.", example: "Hard cut to an extreme macro of the scalp." },
] as const satisfies readonly TaxonomyTerm[];

// ── Format ────────────────────────────────────────────────────────────────────
// How the thing is constructed.

export const FORMATS = [
  { id: "talking_head_ugc", label: "Talking-head UGC", definition: "Creator speaking to a phone camera, unpolished." },
  { id: "voiceover_broll", label: "Voiceover over B-roll", definition: "Narration over cut footage; speaker not on camera." },
  { id: "text_on_screen", label: "Text-led / Silent", definition: "Carried by on-screen text; works with sound off." },
  { id: "founder_piece", label: "Founder to camera", definition: "Brand principal speaking directly, identified as such." },
  { id: "expert_explainer", label: "Expert / Whiteboard explainer", definition: "Credentialed explanation, often with diagrams or annotation." },
  { id: "before_after_montage", label: "Before / After montage", definition: "Sequenced progress footage over time." },
  { id: "product_macro", label: "Product macro / Sensory", definition: "Close product photography — texture, pour, applicator." },
  { id: "routine_demo", label: "Routine / Demo", definition: "Step-by-step use in a real setting." },
  { id: "review_montage", label: "Review montage", definition: "Multiple testimonials or reviews cut together." },
  { id: "animation_motion", label: "Animation / Motion graphics", definition: "Illustrated or animated explanation." },
  { id: "split_screen", label: "Split screen / Comparison", definition: "Two things shown simultaneously for contrast." },
  { id: "street_interview", label: "Street interview / Vox pop", definition: "Unscripted responses from multiple people." },
  { id: "static_image", label: "Static image", definition: "Single still frame with copy. Not a video." },
] as const satisfies readonly TaxonomyTerm[];

// ── Production style ──────────────────────────────────────────────────────────

export const PRODUCTION_STYLES = [
  { id: "ugc_native", label: "UGC-native", definition: "Looks like organic platform content — handheld, natural light, imperfect." },
  { id: "polished_studio", label: "Polished / Studio", definition: "Lit, art-directed, obviously produced." },
  { id: "animated", label: "Animated", definition: "Illustration or motion graphics rather than filmed footage." },
  { id: "screen_capture", label: "Screen capture", definition: "Phone or desktop screen recording — reviews, search results, texts." },
  { id: "mixed", label: "Mixed", definition: "Combines two or more of the above in one asset." },
] as const satisfies readonly TaxonomyTerm[];

// ── Placement fit ─────────────────────────────────────────────────────────────
// Meta repeatedly emphasises creative built natively for the surface it runs on.

export const PLACEMENT_FITS = [
  { id: "reels_native", label: "Reels-native", definition: "9:16, sound-on design, hook inside 1.5s, safe zones respected." },
  { id: "feed_native", label: "Feed-native", definition: "1:1 or 4:5, legible with sound off, works as a still." },
  { id: "stories_native", label: "Stories-native", definition: "9:16, tap-forward pacing, top and bottom safe zones clear." },
  { id: "repurposed_unadapted", label: "Repurposed, unadapted", definition: "Clearly built elsewhere and dropped in — letterboxing, burned-in captions in the wrong place, watermarks." },
] as const satisfies readonly TaxonomyTerm[];

// ── Derived types ─────────────────────────────────────────────────────────────

export type FunnelStageId = (typeof FUNNEL_STAGES)[number]["id"];
export type AwarenessId = (typeof AWARENESS_STAGES)[number]["id"];
export type PillarId = (typeof PILLARS)[number]["id"];
export type PersonaId = (typeof PERSONAS)[number]["id"];
export type HookId = (typeof HOOK_TYPES)[number]["id"];
export type FormatId = (typeof FORMATS)[number]["id"];
export type ProductionId = (typeof PRODUCTION_STYLES)[number]["id"];
export type PlacementFitId = (typeof PLACEMENT_FITS)[number]["id"];

/** The axes that define a creative territory, in the order used for the
 *  coverage matrix and the territory key. */
export const TERRITORY_AXES = ["pillar", "persona", "hook", "funnel"] as const;
export type TerritoryAxis = (typeof TERRITORY_AXES)[number];

/** Total addressable territories on the four primary axes. Reported in the UI
 *  so nobody mistakes "we have 200 ads" for "we have covered the space". */
export const TERRITORY_SPACE_SIZE =
  PILLARS.length * PERSONAS.length * HOOK_TYPES.length * FUNNEL_STAGES.length;

export const TAXONOMY = {
  funnel: FUNNEL_STAGES,
  awareness: AWARENESS_STAGES,
  pillar: PILLARS,
  persona: PERSONAS,
  hook: HOOK_TYPES,
  format: FORMATS,
  production: PRODUCTION_STYLES,
  placementFit: PLACEMENT_FITS,
} as const;

const byId = <T extends TaxonomyTerm>(list: readonly T[]) =>
  new Map(list.map((t) => [t.id, t]));

export const LOOKUPS = {
  funnel: byId(FUNNEL_STAGES),
  awareness: byId(AWARENESS_STAGES),
  pillar: byId(PILLARS),
  persona: byId(PERSONAS),
  hook: byId(HOOK_TYPES),
  format: byId(FORMATS),
  production: byId(PRODUCTION_STYLES),
  placementFit: byId(PLACEMENT_FITS),
};

export function labelFor(axis: keyof typeof LOOKUPS, id: string): string {
  return LOOKUPS[axis].get(id)?.label ?? id;
}

/** Stable key for one cell of the coverage matrix. */
export function territoryKey(a: {
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
}): string {
  return `${a.pillar}|${a.persona}|${a.hook}|${a.funnel}`;
}
