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
import { type ReferenceCard } from "./lookup";
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

// Fleur's gap weights are the same for every creator and change only when the
// portfolio is re-synced (hourly), so we cache them instead of running
// buildPortfolio on every feed request. The cache is PERSISTENT (an AppCache
// row) because Vercel spreads requests across instances — an in-memory cache
// misses too often. In-memory is layered on top to skip the DB read when warm.
type GapWeights = { weights: Map<string, number>; max: number };
let memGap: { at: number; value: GapWeights } | null = null;
const GAP_TTL_MS = 60 * 60 * 1000;

async function computeGapWeights(): Promise<GapWeights> {
  const portfolio = await buildPortfolio();
  const weights = new Map<string, number>();
  for (const g of portfolio.gaps) weights.set(g.pillar, (weights.get(g.pillar) ?? 0) + g.priority);
  const value: GapWeights = { weights, max: Math.max(1, ...weights.values()) };
  await db.appCache
    .upsert({
      where: { key: "gapWeights" },
      create: { key: "gapWeights", json: { weights: [...weights], max: value.max } },
      update: { json: { weights: [...weights], max: value.max } },
    })
    .catch(() => {});
  memGap = { at: Date.now(), value };
  return value;
}

async function pillarWeights(): Promise<GapWeights> {
  if (memGap && Date.now() - memGap.at < GAP_TTL_MS) return memGap.value;

  const row = await db.appCache.findUnique({ where: { key: "gapWeights" } }).catch(() => null);
  if (row) {
    const data = row.json as { weights: [string, number][]; max: number };
    const value: GapWeights = { weights: new Map(data.weights), max: data.max };
    memGap = { at: Date.now(), value };
    // Stale? Recompute now (blocking) at most once per TTL — every other request
    // in the window reads the fast row.
    if (Date.now() - row.updatedAt.getTime() > GAP_TTL_MS) return computeGapWeights();
    return value;
  }
  return computeGapWeights();
}

// Only the columns the feed needs — critically NOT `raw` (the full TrendTrack ad
// payload), which is large and dominated the query time across ~1000 rows.
const FEED_SELECT = {
  id: true,
  ttAdId: true,
  advertiserName: true,
  mediaType: true,
  mediaUrl: true,
  thumbUrl: true,
  durationSec: true,
  daysRunning: true,
  reach: true,
  variants: true,
  reachDelta7d: true,
  analysis: {
    select: {
      pillar: true,
      persona: true,
      hook: true,
      funnel: true,
      format: true,
      production: true,
      hookText: true,
      critique: true,
    },
  },
} as const;

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
  const [{ weights: pillarWeight, max: maxGap }, actioned, learned, rows] = await Promise.all([
    pillarWeights(),
    actionedAssetIds(userId),
    learnedAffinity(userId),
    db.referenceAsset.findMany({
      where: { mediaUrl: { not: null }, analysis: { isNot: null } },
      select: FEED_SELECT,
    }),
  ]);

  // Score every un-swiped, playable card.
  const scored: { card: FeedCard; score: number }[] = [];
  for (const r of rows) {
    if (actioned.has(r.id) || !r.analysis) continue;
    const an = r.analysis;
    const card: FeedCard = {
      id: r.id,
      ttAdId: r.ttAdId,
      brand: r.advertiserName ?? "(unknown)",
      mediaType: r.mediaType,
      mediaUrl: r.mediaUrl,
      thumbUrl: r.thumbUrl,
      durationSec: r.durationSec,
      daysRunning: r.daysRunning,
      reach: r.reach,
      variants: r.variants,
      reachDelta7d: r.reachDelta7d,
      pillar: an.pillar,
      persona: an.persona,
      hook: an.hook,
      funnel: an.funnel,
      format: an.format,
      hookText: an.hookText,
      critique: an.critique,
      thinForFleur: pillarWeight.has(an.pillar),
    };

    const vals = attrValues(an);
    let affinity = 0;
    for (const a of AFFINITY_ATTRS) {
      affinity += seedAffinity(a, vals[a]) + LEARNED_WEIGHT * learned(a, vals[a]);
    }
    const gapNorm = (pillarWeight.get(an.pillar) ?? 0) / maxGap;
    const score = W_GAP * gapNorm + W_AFFINITY * affinity + W_EXPLORE * Math.random();
    scored.push({ card, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Greedy interleave: take the highest-scoring card that doesn't repeat the card
  // we just emitted, so the scroll stays varied without abandoning the ranking.
  // We avoid back-to-back same *pillar* AND same *persona* — persona tracks the
  // on-screen subject, so diversifying it is what breaks up runs of similar-looking
  // videos (the main cause of "endless back-to-back" clusters). Fall back to
  // pillar-only, then to score order, when nothing better is left.
  const out: FeedCard[] = [];
  let lastPillar: string | null = null;
  let lastPersona: string | null = null;
  while (out.length < limit && scored.length) {
    let idx = scored.findIndex((s) => s.card.pillar !== lastPillar && s.card.persona !== lastPersona);
    if (idx === -1) idx = scored.findIndex((s) => s.card.pillar !== lastPillar);
    if (idx === -1) idx = 0; // only same-pillar cards remain
    const [picked] = scored.splice(idx, 1);
    out.push(picked.card);
    lastPillar = picked.card.pillar;
    lastPersona = picked.card.persona;
  }
  return out;
}
