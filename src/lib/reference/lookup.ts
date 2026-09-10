// Gap → reference-corpus lookup.
//
// Fleur's portfolio has thin/empty territories (from `gaps()`). This finds the
// durable competitor ads that occupy those same territories, so a creator
// briefing into a gap has proven examples to swipe through.
//
// The taxonomy has ~13k cells and the corpus is small, so an exact
// pillar × persona × funnel match is usually empty. We therefore key on PILLAR
// (the territory that matters, and how the swipe app is organised) and treat
// persona/funnel as ranking bonuses, not filters — a strong pillar example is
// worth showing even if its persona differs. Within a tier, durability wins:
// days-running then reach, because that is the whole reason a reference ad earns
// its place.

import { db } from "@/lib/db";
import type { Gap } from "@/lib/creative/coverage";

export type MatchTier = "exact" | "pillar+persona" | "pillar+funnel" | "pillar" | "secondary";

/** The fields a swipe card needs. Shared by the deck and the saved list. */
export interface ReferenceCard {
  id: string;
  ttAdId: string;
  brand: string;
  mediaType: string;
  /** Our permanent, phone-playable URL. Null only if mirroring failed. */
  mediaUrl: string | null;
  thumbUrl: string | null;
  durationSec: number | null;

  // Durability overlay — what the swipe card shows.
  daysRunning: number | null;
  reach: number | null;
  variants: number | null;
  reachDelta7d: number | null;

  // Our classification.
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
  format: string;
  hookText: string | null;
  critique: string | null;
}

export interface ReferenceMatch extends ReferenceCard {
  matchTier: MatchTier;
  matchScore: number;
}

export type AssetWithAnalysis = NonNullable<
  Awaited<ReturnType<typeof db.referenceAsset.findFirst>>
> & { analysis: NonNullable<Awaited<ReturnType<typeof db.referenceAnalysis.findFirst>>> };

/** Map an asset+analysis row to the card shape. */
export function toCard(a: AssetWithAnalysis): ReferenceCard {
  const an = a.analysis;
  return {
    id: a.id,
    ttAdId: a.ttAdId,
    brand: a.advertiserName ?? "(unknown)",
    mediaType: a.mediaType,
    mediaUrl: a.mediaUrl,
    thumbUrl: a.thumbUrl,
    durationSec: a.durationSec,
    daysRunning: a.daysRunning,
    reach: a.reach,
    variants: a.variants,
    reachDelta7d: a.reachDelta7d,
    pillar: an.pillar,
    persona: an.persona,
    hook: an.hook,
    funnel: an.funnel,
    format: an.format,
    hookText: an.hookText,
    critique: an.critique,
  };
}

function toMatch(
  a: AssetWithAnalysis,
  pillar: string,
  persona?: string,
  funnel?: string,
): ReferenceMatch {
  const an = a.analysis;
  const primary = an.pillar === pillar;
  const personaMatch = Boolean(persona) && an.persona === persona;
  const funnelMatch = Boolean(funnel) && an.funnel === funnel;

  const score =
    (primary ? 4 : 2) + (personaMatch ? 2 : 0) + (funnelMatch ? 1 : 0);

  const matchTier: MatchTier = !primary
    ? "secondary"
    : personaMatch && funnelMatch
      ? "exact"
      : personaMatch
        ? "pillar+persona"
        : funnelMatch
          ? "pillar+funnel"
          : "pillar";

  return { ...toCard(a), matchTier, matchScore: score };
}

/** Best-match-first, then durability. Nulls sort last. */
function compareMatches(a: ReferenceMatch, b: ReferenceMatch): number {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  const ad = a.daysRunning ?? -1;
  const bd = b.daysRunning ?? -1;
  if (bd !== ad) return bd - ad;
  return (b.reach ?? -1) - (a.reach ?? -1);
}

export interface FindOptions {
  pillar: string;
  persona?: string;
  funnel?: string;
  limit?: number;
  /** Only return assets we can actually play (default true). */
  requirePlayable?: boolean;
}

/**
 * Reference ads for a pillar (optionally biased toward a persona/funnel),
 * ranked best-match-then-most-durable. Matches on the pillar as either the
 * primary or secondary classification.
 */
export async function findReferences(opts: FindOptions): Promise<ReferenceMatch[]> {
  const { pillar, persona, funnel, limit = 20, requirePlayable = true } = opts;

  const rows = await db.referenceAsset.findMany({
    where: {
      ...(requirePlayable ? { mediaUrl: { not: null } } : {}),
      analysis: { is: { OR: [{ pillar }, { secondaryPillar: pillar }] } },
    },
    include: { analysis: true },
  });

  return rows
    .filter((r): r is AssetWithAnalysis => r.analysis !== null)
    .map((r) => toMatch(r, pillar, persona, funnel))
    .sort(compareMatches)
    .slice(0, limit);
}

/** The swipe deck for a specific gap cell. */
export async function referencesForGap(gap: Gap, limit = 20): Promise<ReferenceMatch[]> {
  return findReferences({ pillar: gap.pillar, persona: gap.persona, funnel: gap.funnel, limit });
}

// ── Diagnostic: do the thin cells actually have examples? ─────────────────────

export interface GapCoverage {
  gap: Gap;
  /** Playable reference ads whose pillar matches this gap. */
  total: number;
  exact: number; // pillar + persona + funnel
  pillarPersona: number; // pillar + persona
  pillarFunnel: number; // pillar + funnel
  top: ReferenceMatch | null;
}

/**
 * For each gap, how many playable reference examples exist and the best one.
 * This is the pre-UI sanity check: a gap with zero matches is a swipe deck with
 * nothing in it, and tells us where the intake needs to reach (e.g. a
 * persona-targeted pull) before the screen is worth building.
 */
export async function gapCoverage(gaps: Gap[]): Promise<GapCoverage[]> {
  const out: GapCoverage[] = [];
  for (const gap of gaps) {
    const matches = await referencesForGap(gap, 500);
    out.push({
      gap,
      total: matches.length,
      exact: matches.filter((m) => m.matchTier === "exact").length,
      pillarPersona: matches.filter((m) => m.matchTier === "pillar+persona" || m.matchTier === "exact").length,
      pillarFunnel: matches.filter((m) => m.matchTier === "pillar+funnel" || m.matchTier === "exact").length,
      top: matches[0] ?? null,
    });
  }
  return out;
}
