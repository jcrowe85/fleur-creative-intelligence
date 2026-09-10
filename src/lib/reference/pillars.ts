// Pillar summary for the creator landing screen.
//
// Shows every pillar that has playable reference examples, flags the ones where
// Fleur's own portfolio is thin (so a creator knows where new creative is worth
// making), and surfaces strategic-priority pillars first.

import { db } from "@/lib/db";
import { buildPortfolio } from "@/lib/creative/portfolio";
import { PILLARS } from "@/lib/creative/taxonomy";

export interface PillarSummary {
  id: string;
  label: string;
  strategicPriority: boolean;
  /** Playable reference ads occupying this pillar (primary or secondary). */
  examples: number;
  /** This pillar shows up in Fleur's ranked gaps — thin territory worth filling. */
  thinForFleur: boolean;
}

export async function pillarSummary(): Promise<PillarSummary[]> {
  // Playable, classified reference assets — count each toward its primary and
  // secondary pillar, matching how findReferences() surfaces them.
  const rows = await db.referenceAsset.findMany({
    where: { mediaUrl: { not: null }, analysis: { isNot: null } },
    select: { analysis: { select: { pillar: true, secondaryPillar: true } } },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const a = r.analysis!;
    counts.set(a.pillar, (counts.get(a.pillar) ?? 0) + 1);
    if (a.secondaryPillar && a.secondaryPillar !== a.pillar) {
      counts.set(a.secondaryPillar, (counts.get(a.secondaryPillar) ?? 0) + 1);
    }
  }

  const portfolio = await buildPortfolio();
  const thin = new Set(portfolio.gaps.map((g) => g.pillar));

  return PILLARS.map((p) => ({
    id: p.id,
    label: p.label,
    strategicPriority: Boolean(p.strategicPriority),
    examples: counts.get(p.id) ?? 0,
    thinForFleur: thin.has(p.id),
  })).sort((a, b) => {
    // Strategic + thin + has-examples float to the top; empty pillars sink.
    const score = (s: PillarSummary) =>
      (s.examples > 0 ? 100 : 0) +
      (s.strategicPriority ? 10 : 0) +
      (s.thinForFleur ? 5 : 0);
    return score(b) - score(a) || b.examples - a.examples;
  });
}
