// The creator feed — one endless, gap-weighted, pillar-interleaved deck.
//
// No pillar picker: the creator drops straight into a scroll. Every card is
// still chosen for Fleur's needs — pillars the portfolio is thin on surface more
// often and earlier — but the running order rotates pillars card-to-card so it
// feels like a varied feed (lifestyle → myth-busting → mechanism …) rather than
// a run of the same territory. Durability decides order within a pillar.

import { db } from "@/lib/db";
import { buildPortfolio } from "@/lib/creative/portfolio";
import { actionedAssetIds } from "./saves";
import { toCard, type AssetWithAnalysis, type ReferenceCard } from "./lookup";

export interface FeedCard extends ReferenceCard {
  /** This card's pillar is one Fleur is thin on — worth a nudge in the UI. */
  thinForFleur: boolean;
}

/** Non-gap pillars still appear, just rarely. */
const BASELINE_WEIGHT = 0.5;

export async function buildFeed(userId: string, limit = 60): Promise<FeedCard[]> {
  // How badly Fleur needs each pillar: summed gap priority (strategic × persona
  // that converts × thin funnel), from the same gaps() the dashboard uses.
  const portfolio = await buildPortfolio();
  const pillarWeight = new Map<string, number>();
  for (const g of portfolio.gaps) {
    pillarWeight.set(g.pillar, (pillarWeight.get(g.pillar) ?? 0) + g.priority);
  }

  const [actioned, rows] = await Promise.all([
    actionedAssetIds(userId),
    db.referenceAsset.findMany({
      where: { mediaUrl: { not: null }, analysis: { isNot: null } },
      include: { analysis: true },
    }),
  ]);

  // Group un-swiped, playable cards by pillar; most durable first within each.
  const groups = new Map<string, FeedCard[]>();
  for (const r of rows) {
    if (actioned.has(r.id)) continue;
    const base = toCard(r as AssetWithAnalysis);
    const arr = groups.get(base.pillar) ?? [];
    arr.push({ ...base, thinForFleur: pillarWeight.has(base.pillar) });
    groups.set(base.pillar, arr);
  }
  for (const arr of groups.values()) {
    arr.sort(
      (a, b) =>
        (b.daysRunning ?? -1) - (a.daysRunning ?? -1) ||
        (b.reach ?? -1) - (a.reach ?? -1),
    );
  }

  // Weighted round-robin interleave. Each step picks the pillar most "behind"
  // its target share, never the pillar just emitted (so no back-to-back
  // repeats), with a little jitter so the order varies session to session.
  const pillars = [...groups.keys()];
  const weightOf = (p: string) => (pillarWeight.get(p) ?? 0) + BASELINE_WEIGHT;
  const totalW = pillars.reduce((s, p) => s + weightOf(p), 0) || 1;
  const emitted = new Map<string, number>(pillars.map((p) => [p, 0]));

  const out: FeedCard[] = [];
  let last: string | null = null;
  while (out.length < limit) {
    const avail = pillars.filter((p) => (groups.get(p)?.length ?? 0) > 0);
    if (avail.length === 0) break;

    let pick = avail[0];
    let best = Infinity;
    for (const p of avail) {
      if (p === last && avail.length > 1) continue; // no two of a pillar in a row
      const share = weightOf(p) / totalW;
      const deficit = (emitted.get(p)! + 1) / share + Math.random() * 0.4;
      if (deficit < best) {
        best = deficit;
        pick = p;
      }
    }

    out.push(groups.get(pick)!.shift()!);
    emitted.set(pick, (emitted.get(pick) ?? 0) + 1);
    last = pick;
  }
  return out;
}
