// Ported verbatim from Creator-Briefs-Dev-Handoff/lib/creator-brief.ts.
// This is the spec's own implementation — keep it byte-identical so the
// handoff's checker, examples and JSON schema stay authoritative. Changes
// belong in the handoff first.
// Creator brief: the data shape, limits, and the checker that runs on every generated brief.
// Drop-in for src/lib/reference/. No dependencies. Replaces the Framework type in framework.ts.
//
// The model returns everything except `time` and `says` on each section; the server fills those in
// (sectionTime() below, and the transcript words inside each section's start/end).

export type ToolId =
  | "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7" | "H8" | "H9" | "H10"
  | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8"
  | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";

/** Plain names for each tool, as creators learned them from Donovan's training videos. */
export const TOOL_NAMES: Record<ToolId, string> = {
  H1: "two hooks at once",
  H2: "the four jobs of a hook",
  H3: "no dead air",
  H4: "big first-frame motion",
  H5: "text on screen right away",
  H6: "call out the exact customer",
  H7: "something that doesn't add up",
  H8: "it only has to hold 3 seconds",
  H9: "product in the opening",
  H10: "borrow the format, not the words",
  R1: "hook stacking",
  R2: "open loops and close them fast",
  R3: "every cut starts with something new",
  R4: "pictures and overlays",
  R5: "get to the point",
  R6: "length",
  R7: "pace",
  R8: "organic, not an ad",
  S1: "sell the solution and the dream outcome",
  S2: "the specific result",
  S3: "plain words",
  S4: "logical mechanism",
  S5: "proof",
  S6: "recommend, don't beg",
  S7: "the price loop",
  S8: "authority you can see",
  S9: "call to action with a reason",
};

export const TOOL_IDS = Object.keys(TOOL_NAMES) as ToolId[];

export type LoopKind = "loop" | "micro" | "long";

export interface BriefLoop {
  /** The question the video plants, in the viewer's words. */
  question: string;
  /** How the video answers it. */
  answer: string;
  openSec: number;
  closeSec: number;
  kind: LoopKind;
}

export interface BriefSection {
  name: string;
  startSec: number;
  endSec: number;
  /** What's on screen and what's said. */
  did: string;
  /** Why it works, naming the tools in plain words. */
  why: string;
  tools: ToolId[];
  /** Filled by the server after generation: "0–4s" or "1:05–1:20". */
  time?: string;
  /** Filled by the server: what the reference creator said inside this section. */
  says?: string;
}

export interface BriefSwap {
  theirs: string;
  yours: string;
}

export interface CreatorBrief {
  version: 1;
  /** Names the move, never the reference's brand. */
  title: string;
  /** What the video is, never the brand. Notes "(German, quotes translated)" or "(music only)". */
  ref: string;
  durationSec: number;
  /** Spoken language code ("en", "nl"), or null when nobody talks. */
  language: string | null;
  anatomy: {
    /** Section names in order. */
    beatLine: string[];
    loops: BriefLoop[];
    whyLoopsWork: string[];
  };
  framework: {
    coreMove: string;
    sections: BriefSection[];
    dontCopy: string[];
  };
  fleur: {
    keep: string[];
    swaps: BriefSwap[];
    ideas: string[];
    check: string[];
  };
}

export const LIMITS = {
  maxWords: 350,
  shortVideoSec: 15,
  loops: { min: 3, max: 5 },
  loopsShort: { min: 2, max: 3 },
  sections: { min: 4, max: 7 },
  sectionsShort: { min: 3, max: 4 },
  whyLoopsWork: { min: 2, max: 3 },
  swaps: { min: 2, max: 3 },
  ideas: { min: 2, max: 3 },
  dontCopyMax: 3,
} as const;

/** "0–4s" under a minute, "1:05–1:20" past it. */
export function sectionTime(startSec: number, endSec: number): string {
  const clock = (t: number) => {
    const total = Math.round(t);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  if (endSec < 59.5) return `${Math.round(startSec)}–${Math.round(endSec)}s`;
  return `${clock(startSec)}–${clock(endSec)}`;
}

/** What the model returns. The server adds version, durationSec, and each section's time and says. */
export type CreatorBriefDraft = Omit<CreatorBrief, "version" | "durationSec" | "framework"> & {
  framework: Omit<CreatorBrief["framework"], "sections"> & {
    sections: Omit<BriefSection, "time" | "says">[];
  };
};

/** Turn the model's draft into the stored brief. `saysFor` returns the transcript words inside a window. */
export function assembleBrief(
  draft: CreatorBriefDraft,
  durationSec: number,
  saysFor?: (startSec: number, endSec: number) => string | undefined,
): CreatorBrief {
  return {
    version: 1,
    durationSec,
    ...draft,
    framework: {
      ...draft.framework,
      sections: draft.framework.sections.map((s) => ({
        ...s,
        time: sectionTime(s.startSec, s.endSec),
        says: saysFor?.(s.startSec, s.endSec),
      })),
    },
  };
}

export interface BriefIssue {
  level: "error" | "warning";
  where: string;
  message: string;
}

type Rule = [RegExp, string];

// What creators will make: keep, swaps and ideas. From product.md's claims list.
const NEVER: Rule[] = [
  [/six copper peptides|6 copper peptides/i, 'says "six copper peptides" (only two are copper)'],
  [/\$70|on sale \$48/i, 'uses the retired "$70, on sale $48" line'],
  [/90[- ]day (guarantee|money)/i, "promises a 90-day guarantee"],
  [/\$800/, 'mentions "$800 in gifts"'],
  [/insane results/i, 'says "insane results"'],
  [/\b(cure[sd]?|treats?|heal(s|ed)?|guaranteed)\b/i, "uses cure / treat / heal / guaranteed"],
  [/\bsix (monthly )?gifts\b|\b6 gifts\b/i, 'says "six gifts" (five months of gifts exist)'],
  [/your (thinning|thin) hair|your hair loss|your bald/i, "tells the viewer they have a condition"],
  [/inject|syringe/i, "mentions injections"],
];

const HOLD: Rule[] = [
  [/\bregrow/i, '"regrows hair" is on hold'],
  [/prevents? shedding|stops? (the |your )?shedding/i, '"prevents shedding" is on hold'],
  [/dormant follicle/i, "dormant-follicle wording is on hold"],
  [/clinically (proven|backed)|clinical (results|peptides)/i, '"clinically proven" is on hold'],
  [/#1|dermatologist|trichologist/i, "expert endorsements are on hold"],
  [/made in (the )?usa/i, '"Made in USA" is on hold'],
  [/was \$(68|90)/i, '"was $68 / $90" is on hold'],
  [/\b(90|89|91)%/, "the 90 / 89 / 91% stats are on hold"],
  [/\bin (\d+|one|two|three|four|six|eight|twelve) (days|weeks|months)\b/i, "results by a date are on hold"],
];

// Anywhere except the check line.
const DRUGS = /glp-?1|semaglutide|ozempic|wegovy|tirzepatide|mounjaro|zepbound|retatrutide/i;
const PRONOUNS = /\b(he|she|his|her|hers|him|himself|herself)\b/i;
const SCRIPT_CUE = /\b(say|open with|script)\s*[:"“]/i;
const LONG_QUOTE = /["“]([^"”]+)["”]/g;

function words(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Check a generated brief. Errors mean regenerate; warnings are worth a look. */
export function checkBrief(
  brief: CreatorBrief,
  opts: { referenceBrand?: string } = {},
): { words: number; issues: BriefIssue[] } {
  const issues: BriefIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });

  const { anatomy, framework, fleur } = brief;
  const short = brief.durationSec < LIMITS.shortVideoSec;

  // Every text field, labelled, so each rule can pick its scope.
  const fields: [string, string][] = [
    ["title", brief.title],
    ["ref", brief.ref],
    ...anatomy.beatLine.map((t, i): [string, string] => [`anatomy.beatLine[${i}]`, t]),
    ...anatomy.loops.flatMap((l, i): [string, string][] => [
      [`anatomy.loops[${i}].question`, l.question],
      [`anatomy.loops[${i}].answer`, l.answer],
    ]),
    ...anatomy.whyLoopsWork.map((t, i): [string, string] => [`anatomy.whyLoopsWork[${i}]`, t]),
    ["framework.coreMove", framework.coreMove],
    ...framework.sections.flatMap((s, i): [string, string][] => [
      [`framework.sections[${i}].name`, s.name],
      [`framework.sections[${i}].did`, s.did],
      [`framework.sections[${i}].why`, s.why],
    ]),
    ...framework.dontCopy.map((t, i): [string, string] => [`framework.dontCopy[${i}]`, t]),
    ...fleur.keep.map((t, i): [string, string] => [`fleur.keep[${i}]`, t]),
    ...fleur.swaps.flatMap((s, i): [string, string][] => [
      [`fleur.swaps[${i}].theirs`, s.theirs],
      [`fleur.swaps[${i}].yours`, s.yours],
    ]),
    ...fleur.ideas.map((t, i): [string, string] => [`fleur.ideas[${i}]`, t]),
    ...fleur.check.map((t, i): [string, string] => [`fleur.check[${i}]`, t]),
  ];

  // Length and empties.
  const total = fields.reduce((n, [, t]) => n + words(t), 0);
  if (total > LIMITS.maxWords) err("brief", `${total} words; the limit is ${LIMITS.maxWords}`);
  for (const [where, text] of fields) if (!text.trim()) err(where, "is empty");

  // Counts.
  const count = (where: string, n: number, range: { min: number; max: number }) => {
    if (n < range.min || n > range.max) err(where, `has ${n}; expected ${range.min}–${range.max}`);
  };
  count("anatomy.loops", anatomy.loops.length, short ? LIMITS.loopsShort : LIMITS.loops);
  count("framework.sections", framework.sections.length, short ? LIMITS.sectionsShort : LIMITS.sections);
  count("anatomy.whyLoopsWork", anatomy.whyLoopsWork.length, LIMITS.whyLoopsWork);
  count("fleur.swaps", fleur.swaps.length, LIMITS.swaps);
  count("fleur.ideas", fleur.ideas.length, LIMITS.ideas);
  if (framework.dontCopy.length > LIMITS.dontCopyMax) err("framework.dontCopy", `has ${framework.dontCopy.length}; max ${LIMITS.dontCopyMax}`);
  if (fleur.keep.length < 2) err("fleur.keep", "needs at least 2 steps");
  if (fleur.check.length < 1) err("fleur.check", "needs at least one reminder");
  if (anatomy.beatLine.length !== framework.sections.length)
    warn("anatomy.beatLine", `has ${anatomy.beatLine.length} names for ${framework.sections.length} sections`);

  // Timing.
  const end = brief.durationSec + 1;
  anatomy.loops.forEach((l, i) => {
    if (!(l.openSec < l.closeSec)) err(`anatomy.loops[${i}]`, "closes before it opens");
    if (l.openSec < 0 || l.closeSec > end) err(`anatomy.loops[${i}]`, "falls outside the video");
  });
  framework.sections.forEach((s, i) => {
    const where = `framework.sections[${i}]`;
    if (!(s.startSec < s.endSec)) err(where, "ends before it starts");
    if (s.endSec > end) err(where, "runs past the end of the video");
    if (i === 0 && s.startSec > 1) warn(where, "doesn't start at the beginning");
    if (i > 0 && Math.abs(s.startSec - framework.sections[i - 1].endSec) > 1.5)
      warn(where, "leaves a gap or overlap with the section before");
    if (!s.tools.length) err(where, "names no tools");
    for (const t of s.tools) if (!TOOL_IDS.includes(t)) err(where, `unknown tool "${t}"`);
  });
  const last = framework.sections.at(-1);
  if (last && last.endSec < brief.durationSec - 3) warn("framework.sections", "don't reach the end of the video");

  // Claims and wording.
  const isCheck = (where: string) => where.startsWith("fleur.check");
  const isMake = (where: string) => /^fleur\.(keep|swaps|ideas)/.test(where);
  for (const [where, text] of fields) {
    if (!isCheck(where) && DRUGS.test(text)) err(where, "names a weight-loss drug");
    if (PRONOUNS.test(text)) warn(where, "uses he/she; say \"the creator\" or \"they\" unless it's a customer group");
    if (opts.referenceBrand && text.toLowerCase().includes(opts.referenceBrand.toLowerCase()))
      err(where, "names the reference's brand");
    if (!isMake(where)) continue;
    for (const [rx, message] of NEVER) if (rx.test(text)) err(where, message);
    for (const [rx, message] of HOLD) if (rx.test(text)) err(where, message);
    if (SCRIPT_CUE.test(text)) err(where, "reads like a script or hook line");
    for (const m of text.matchAll(LONG_QUOTE)) if (words(m[1]) >= 6) warn(where, "has a long quote; it may be a line to say");
    if (/\bsale\b|% off|discount/i.test(text)) warn(where, "mentions a sale; only if one is live");
  }
  const makeText = fields.filter(([w]) => isMake(w)).map(([, t]) => t).join(" ");
  if (/\$\d/.test(makeText) && !fleur.check.some((c) => /check the price/i.test(c)))
    err("fleur.check", 'mentions a price without "check the price on your link"');

  return { words: total, issues };
}
