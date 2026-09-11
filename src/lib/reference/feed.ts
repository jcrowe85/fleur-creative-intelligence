// The creator feed — one endless, self-personalising scroll.
//
// No pillar picker, no questionnaire. Each card is scored from three things:
//
//   1. GAP FLOOR      — how badly Fleur needs this pillar (from gaps()). Keeps
//                       the feed strategic instead of pure entertainment.
//   2. SEED priors    — "start smart": a fresh creator is biased toward phone /
//                       UGC content and away from studio/animation (capability.ts).
//   3. LEARNED affinity — per-attribute preference from THIS creator's swipes
//                       (save = more of that format/pillar/hook/persona, skip =
//                       less). Added on top of the seed, so behaviour gradually
//                       takes over — the TikTok-style part.
//
// Cards are then greedily interleaved so no two of the same pillar run back to
// back, keeping the scroll varied. A user's own swipes are excluded so it never
// repeats.

import { db } from "@/lib/db";
import { buildPortfolio } from "@/lib/creative/portfolio";
import { actionedAssetIds } from "./saves";
import { toCard, type AssetWithAnalysis, type ReferenceCard } from "./lookup";
import { AFFINITY_ATTRS, AFFINITY_SMOOTHING, LEARNED_WEIGHT, seedAffinity } from "./capability";

export interface FeedCard extends ReferenceCard {
  /** This card's pillar is one Fleur is thin on — worth a nudge in the UI. */
  thinForFleur: boolean;
}

// Ranking weights — how much each signal counts. Tunable.
const W_GAP = 2.0;
const W_AFFINITY = 1.0;
const W_EXPLORE = 0.4;

const attrValues = (an: { production: string; format: string; pillar: string; hook: string; persona: string }) =>
  ({ production: an.production, format: an.format, pillar: an.pillar, hook: an.hook, persona: an.persona }) as Record<string, string>;

/** Per-attribute-value preference learned from this creator's swipe history. */
async function learnedAffinity(userId: string): Promise<(attr: string, value: string) => number> {
  const swipes = await db.savedReference.findMany({
    where: { userId },
    include: { asset: { include: { analysis: true } } },
  });

  const sum: Record<string, Map<string, number>> = {};
  const cnt: Record<string, Map<string, number>> = {};
  for (const a of AFFINITY_ATTRS) {
    sum[a] = new Map();
    cnt[a] = new Map();
  }

  for (const s of swipes) {
    const an = s.asset.analysis;
    if (!an) continue;
    const signal = s.status === "saved" ? 1 : s.status === "dismissed" ? -1 : 0;
    if (!signal) continue;
    const vals = attrValues(an);
    for (const a of AFFINITY_ATTRS) {
      const v = vals[a];
      sum[a].set(v, (sum[a].get(v) ?? 0) + signal);
      cnt[a].set(v, (cnt[a].get(v) ?? 0) + 1);
    }
  }

  return (attr, value) => {
    const c = cnt[attr]?.get(value) ?? 0;
    if (!c) return 0;
    return (sum[attr]!.get(value) ?? 0) / (c + AFFINITY_SMOOTHING); // ~[-1, 1]
  };
}

export async function buildFeed(userId: string, limit = 60): Promise<FeedCard[]> {
  // How badly Fleur needs each pillar (summed gap priority), normalised 0..1.
  const portfolio = await buildPortfolio();
  const pillarWeight = new Map<string, number>();
  for (const g of portfolio.gaps) pillarWeight.set(g.pillar, (pillarWeight.get(g.pillar) ?? 0) + g.priority);
  const maxGap = Math.max(1, ...pillarWeight.values());

  const [actioned, learned, rows] = await Promise.all([
    actionedAssetIds(userId),
    learnedAffinity(userId),
    db.referenceAsset.findMany({
      where: { mediaUrl: { not: null }, analysis: { isNot: null } },
      include: { analysis: true },
    }),
  ]);

  // Score every un-swiped, playable card.
  const scored: { card: FeedCard; score: number }[] = [];
  for (const r of rows) {
    if (actioned.has(r.id)) continue;
    const an = r.analysis!;
    const base = toCard(r as AssetWithAnalysis);
    const card: FeedCard = { ...base, thinForFleur: pillarWeight.has(base.pillar) };

    const vals = attrValues(an);
    let affinity = 0;
    for (const a of AFFINITY_ATTRS) {
      affinity += seedAffinity(a, vals[a]) + LEARNED_WEIGHT * learned(a, vals[a]);
    }
    const gapNorm = (pillarWeight.get(base.pillar) ?? 0) / maxGap;
    const score = W_GAP * gapNorm + W_AFFINITY * affinity + W_EXPLORE * Math.random();
    scored.push({ card, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Greedy interleave: take the highest-scoring card whose pillar isn't the one
  // we just emitted, so the scroll stays varied without abandoning the ranking.
  const out: FeedCard[] = [];
  let last: string | null = null;
  while (out.length < limit && scored.length) {
    let idx = scored.findIndex((s) => s.card.pillar !== last);
    if (idx === -1) idx = 0; // only same-pillar cards remain
    const [picked] = scored.splice(idx, 1);
    out.push(picked.card);
    last = picked.card.pillar;
  }
  return out;
}
