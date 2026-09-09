// Per-campaign creative diversity, joined to delivery.
//
// The portfolio view answers "what does the library look like". This answers
// the operational question: for each campaign currently spending money, how
// varied is the creative inside it, and what is that variety returning?
//
// It matters because Andromeda retrieves candidates per ad set from a shared
// hierarchical index. A campaign whose ads all sit in one region of that index
// is competing with itself for the same retrieval events no matter how much
// budget it has.

import { db } from "@/lib/db";
import {
  FORMATS, HOOK_TYPES, PERSONAS, PILLARS, labelFor,
} from "./taxonomy";

/** Size of each axis in the taxonomy. Evenness is measured against these, not
 *  against the handful of terms a campaign happens to use — otherwise a
 *  campaign running two formats 95/5 scores "perfectly even across two"
 *  instead of "missing eleven of thirteen". */
const AXIS_SIZE = {
  pillar: PILLARS.length,
  persona: PERSONAS.length,
  hook: HOOK_TYPES.length,
  format: FORMATS.length,
} as const;

/**
 * Effective coverage of an axis: `exp(H) / axisSize`, where H is Shannon
 * entropy over the observed counts.
 *
 * `exp(H)` is the *effective number of terms* in use — 8 terms at equal weight
 * gives 8, the same 8 with one dominating gives less. Divided by the axis size
 * it reads directly as "the fraction of this axis the campaign actually
 * covers": 8 of 20 pillars used evenly is 40%, and lopsidedness pulls it below.
 *
 * This replaced normalised Shannon evenness, which measured balance *among the
 * terms already in use* and so scored a campaign touching 8 of 20 pillars at
 * 62-67%. That reads as broad coverage when the campaign is missing twelve
 * pillars, and it was the single reason grades looked inflated.
 */
function axisCoverageScore(counts: Map<string, number>, axisSize: number): number {
  const observed = [...counts.values()].filter((n) => n > 0);
  const total = observed.reduce((a, b) => a + b, 0);
  if (total === 0 || axisSize === 0) return 0;
  let h = 0;
  for (const n of observed) {
    const p = n / total;
    h -= p * Math.log(p);
  }
  return Math.min(1, Math.exp(h) / axisSize);
}

export interface CampaignCreative {
  campaignId: string;
  name: string;
  effectiveStatus: string;
  live: boolean;
  dailyBudget: number | null;

  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
  landingPageViews: number;

  cpm: number | null;
  cpc: number | null;
  cac: number | null;
  roas: number | null;
  ctr: number | null;
  cvr: number | null;

  /** Distinct classified assets running in this campaign. */
  assets: number;
  /** Ads running those assets — assets x reuse. */
  ads: number;
  /** Assets whose analysis has not run yet; the score covers only what is known. */
  unclassified: number;

  territories: number;
  /** Distinct terms used on each axis, against the size of that axis. This is
   *  what makes the grade auditable — "8/20 pillars, 2/13 formats". */
  coverage: {
    pillar: [number, number];
    persona: [number, number];
    hook: [number, number];
    format: [number, number];
  };
  diversity: number; // 0-100
  grade: string;
  evennessByAxis: { pillar: number; persona: number; hook: number; format: number };
  /** The biggest single concentration, e.g. "Ingredient Spotlight 62%". */
  dominant: { axis: string; label: string; share: number } | null;
  topPillars: { label: string; n: number }[];
}

const LIVE = new Set(["ACTIVE"]);

/** Below this, evenness is meaningless and the score is not reported. */
const MIN_ASSETS_TO_GRADE = 4;

/** Letter grade for the diversity score. Deliberately blunt — this is a
 *  briefing aid, not a measurement. "n/a" when there is too little to judge. */
function grade(score: number, assets: number, unclassified: number): string {
  if (assets === 0) return unclassified > 0 ? "pending" : "n/a";
  if (assets < MIN_ASSETS_TO_GRADE) return "n/a";
  // The score now reads as a genuine fraction of the taxonomy in play, so the
  // bands sit where they should: covering half the taxonomy evenly on all four
  // axes is excellent, and a fifth of it is not diversity.
  if (score >= 50) return "A";
  if (score >= 38) return "B";
  if (score >= 28) return "C";
  if (score >= 18) return "D";
  return "F";
}

/**
 * Mean effective coverage across the four axes.
 *
 * Reads as "what fraction of the taxonomy is genuinely in play here". No
 * separate breadth term: an earlier version had one and it inflated everything,
 * because a campaign whose assets are each distinct from one another is not the
 * same as one covering the space.
 */
function diversityScore(
  ev: { pillar: number; persona: number; hook: number; format: number },
  assets: number,
): number {
  if (assets < MIN_ASSETS_TO_GRADE) return 0;
  return Math.round((100 * (ev.pillar + ev.persona + ev.hook + ev.format)) / 4);
}

export async function campaignCreatives(opts: { since?: string } = {}): Promise<CampaignCreative[]> {
  // Ad -> campaign, and campaign metadata, from the synced mirror.
  const [adRows, campRows, assets] = await Promise.all([
    db.metaEntity.findMany({
      where: { level: "ad" },
      select: { id: true, campaignId: true },
    }),
    db.metaEntity.findMany({
      where: { level: "campaign" },
      select: {
        id: true, name: true, effectiveStatus: true, status: true, dailyBudget: true,
      },
    }),
    db.creativeAsset.findMany({ include: { analysis: true } }),
  ]);

  const campaignOfAd = new Map(adRows.map((a) => [a.id, a.campaignId]));

  // Which assets (and how many ads of each) run in each campaign.
  interface Bucket {
    assetIds: Set<string>;
    ads: Set<string>;
    unclassified: Set<string>;
    pillar: Map<string, number>;
    persona: Map<string, number>;
    hook: Map<string, number>;
    format: Map<string, number>;
    territories: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const asset of assets) {
    // An asset can run in several campaigns; count it once per campaign.
    const seenHere = new Set<string>();
    for (const adId of asset.adIds) {
      const cid = campaignOfAd.get(adId);
      if (!cid) continue;
      let b = buckets.get(cid);
      if (!b) {
        b = {
          assetIds: new Set(), ads: new Set(), unclassified: new Set(),
          pillar: new Map(), persona: new Map(), hook: new Map(), format: new Map(),
          territories: new Set(),
        };
        buckets.set(cid, b);
      }
      b.ads.add(adId);
      if (seenHere.has(cid)) continue;
      seenHere.add(cid);
      b.assetIds.add(asset.id);
      const an = asset.analysis;
      if (!an) {
        b.unclassified.add(asset.id);
        continue;
      }
      bump(b.pillar, an.pillar);
      bump(b.persona, an.persona);
      bump(b.hook, an.hook);
      bump(b.format, an.format);
      b.territories.add(`${an.pillar}|${an.persona}|${an.hook}|${an.funnel}`);
    }
  }

  // Delivery, summed at campaign level.
  const perf = await db.metaInsightDaily.groupBy({
    by: ["entityId"],
    where: {
      level: "campaign",
      ...(opts.since ? { date: { gte: new Date(opts.since) } } : {}),
    },
    _sum: {
      spend: true, impressions: true, clicks: true, purchases: true,
      purchaseValue: true, landingPageViews: true,
    },
  });
  const perfById = new Map(perf.map((p) => [p.entityId, p._sum]));

  const out: CampaignCreative[] = [];
  for (const c of campRows) {
    const b = buckets.get(c.id);
    const p = perfById.get(c.id);
    const spend = Number(p?.spend ?? 0);
    // Campaigns that never spent and hold no classified creative are noise.
    if (!b && spend === 0) continue;

    const impressions = p?.impressions ?? 0;
    const clicks = p?.clicks ?? 0;
    const purchases = p?.purchases ?? 0;
    const revenue = Number(p?.purchaseValue ?? 0);
    const lpv = p?.landingPageViews ?? 0;

    const classified = (b?.assetIds.size ?? 0) - (b?.unclassified.size ?? 0);
    const empty = new Map<string, number>();
    const ev = {
      pillar: axisCoverageScore(b?.pillar ?? empty, AXIS_SIZE.pillar),
      persona: axisCoverageScore(b?.persona ?? empty, AXIS_SIZE.persona),
      hook: axisCoverageScore(b?.hook ?? empty, AXIS_SIZE.hook),
      format: axisCoverageScore(b?.format ?? empty, AXIS_SIZE.format),
    };
    const territories = b?.territories.size ?? 0;
    const score = diversityScore(ev, classified);

    // Biggest single concentration across the four axes.
    let dominant: CampaignCreative["dominant"] = null;
    if (classified > 0 && b) {
      for (const [axis, m] of [
        ["pillar", b.pillar], ["persona", b.persona],
        ["hook", b.hook], ["format", b.format],
      ] as const) {
        for (const [id, n] of m) {
          const share = n / classified;
          if (!dominant || share > dominant.share) {
            dominant = { axis, label: labelFor(axis, id), share };
          }
        }
      }
    }

    out.push({
      campaignId: c.id,
      name: c.name,
      effectiveStatus: c.effectiveStatus ?? c.status ?? "UNKNOWN",
      live: LIVE.has(c.effectiveStatus ?? ""),
      dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null,
      spend, impressions, clicks, purchases, revenue, landingPageViews: lpv,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      cpc: clicks > 0 ? spend / clicks : null,
      cac: purchases > 0 ? spend / purchases : null,
      roas: spend > 0 ? revenue / spend : null,
      ctr: impressions > 0 ? clicks / impressions : null,
      cvr: lpv > 0 ? purchases / lpv : null,
      assets: classified,
      ads: b?.ads.size ?? 0,
      unclassified: b?.unclassified.size ?? 0,
      territories,
      coverage: {
        pillar: [b?.pillar.size ?? 0, AXIS_SIZE.pillar],
        persona: [b?.persona.size ?? 0, AXIS_SIZE.persona],
        hook: [b?.hook.size ?? 0, AXIS_SIZE.hook],
        format: [b?.format.size ?? 0, AXIS_SIZE.format],
      },
      diversity: score,
      grade: grade(score, classified, b?.unclassified.size ?? 0),
      evennessByAxis: ev,
      dominant,
      topPillars: [...(b?.pillar.entries() ?? [])]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([id, n]) => ({ label: labelFor("pillar", id), n })),
    });
  }

  // Live first, then by spend — the operational reading order.
  return out.sort((a, z) =>
    a.live === z.live ? z.spend - a.spend : a.live ? -1 : 1,
  );
}
