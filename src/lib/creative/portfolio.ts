// Builds the portfolio read: every classified creative joined to its Meta
// performance, plus coverage, redundancy and ranked gaps.
//
// Lives here rather than in the route handler so the page can render it
// server-side on first paint and the route can serve refreshes, without the
// two drifting apart.
//
// One row per *creative*, not per upload. Meta issues a new id each time the
// same file is uploaded, so counting uploads inflated everything downstream —
// coverage, territory occupancy, campaign grades. Uploads of one creative are
// folded together here and their ad ids merged, so spend still ties out.

import { db } from "@/lib/db";
import {
  axisCoverage,
  gaps,
  redundancy,
  summarize,
  type ClassifiedAsset,
} from "@/lib/creative/coverage";
import { familyKey } from "@/lib/creative/family";

export async function buildPortfolio(since?: string) {
  const uploads = await db.creativeAsset.findMany({
    where: { analysis: { isNot: null } },
    include: { analysis: true },
  });

  // Fold uploads of the same creative together. The upload running in the most
  // ads is the face of the group; every group member's ads come along.
  type Upload = (typeof uploads)[number];
  const byCreative = new Map<string, { face: Upload; adIds: string[]; uploads: number }>();
  for (const u of uploads) {
    const key = familyKey(u);
    const cur = byCreative.get(key);
    if (!cur) {
      byCreative.set(key, { face: u, adIds: [...u.adIds], uploads: 1 });
      continue;
    }
    cur.adIds.push(...u.adIds);
    cur.uploads++;
    if (u.adIds.length > cur.face.adIds.length) cur.face = u;
  }
  const creatives = [...byCreative.values()];

  // One grouped query for every ad id in play, rather than per asset.
  const allAdIds = [...new Set(creatives.flatMap((c) => c.adIds))];
  const perf = allAdIds.length
    ? await db.metaInsightDaily.groupBy({
        by: ["entityId"],
        where: {
          level: "ad",
          entityId: { in: allAdIds },
          ...(since ? { date: { gte: new Date(since) } } : {}),
        },
        _sum: { spend: true, purchases: true, purchaseValue: true },
      })
    : [];

  const perfByAd = new Map(
    perf.map((p) => [
      p.entityId,
      {
        spend: Number(p._sum.spend ?? 0),
        purchases: p._sum.purchases ?? 0,
        revenue: Number(p._sum.purchaseValue ?? 0),
      },
    ]),
  );

  const classified: ClassifiedAsset[] = creatives.map((c) => {
    const totals = c.adIds.reduce(
      (acc, id) => {
        const p = perfByAd.get(id);
        if (p) {
          acc.spend += p.spend;
          acc.purchases += p.purchases;
          acc.revenue += p.revenue;
        }
        return acc;
      },
      { spend: 0, purchases: 0, revenue: 0 },
    );
    const an = c.face.analysis!;
    return {
      id: c.face.id,
      name: c.face.name,
      pillar: an.pillar,
      persona: an.persona,
      hook: an.hook,
      funnel: an.funnel,
      awareness: an.awareness,
      format: an.format,
      production: an.production,
      placementFit: an.placementFit,
      ...totals,
    };
  });

  const flagged = creatives.filter(
    (c) => (c.face.analysis?.complianceFlags.length ?? 0) > 0,
  );
  const byFaceId = new Map(creatives.map((c) => [c.face.id, c]));

  return {
    summary: summarize(classified, flagged.length),
    coverage: {
      pillar: axisCoverage(classified, "pillar"),
      persona: axisCoverage(classified, "persona"),
      hook: axisCoverage(classified, "hook"),
      funnel: axisCoverage(classified, "funnel"),
    },
    redundancy: redundancy(classified).slice(0, 15).map((r) => ({
      label: r.territory.label,
      assets: r.territory.assets.length,
      names: r.territory.assets.map((a) => a.name),
      duplicateSpend: r.duplicateSpend,
      spend: r.territory.spend,
      purchases: r.territory.purchases,
    })),
    gaps: gaps(classified),
    compliance: flagged.map((c) => ({
      id: c.face.id,
      name: c.face.name,
      flags: c.face.analysis!.complianceFlags,
    })),
    assets: classified
      .map((c) => {
        const src = byFaceId.get(c.id)!;
        const an = src.face.analysis!;
        return {
          ...c,
          thumbUrl: src.face.thumbUrl,
          assetType: src.face.assetType,
          adCount: src.adIds.length,
          /** How many times this same creative was uploaded to the account. */
          uploads: src.uploads,
          hookText: an.hookText,
          critique: an.critique,
          scores: {
            hookStrength: an.hookStrength,
            messageClarity: an.messageClarity,
            differentiation: an.differentiation,
            productionQuality: an.productionQuality,
            placementNativeness: an.placementNativeness,
          },
          lowConfidence:
            Math.min(an.pillarConf, an.personaConf, an.funnelConf) < 0.5,
        };
      })
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)),
    counts: {
      /** Distinct creatives, after folding re-uploads together. */
      analyzed: creatives.length,
      /** Rows behind them, i.e. how many times things were uploaded. */
      uploads: uploads.length,
      duplicateUploads: uploads.length - creatives.length,
      pending: await db.creativeAsset.count({
        where: { analysis: null, attempts: { lt: 3 } },
      }),
      abandoned: await db.creativeAsset.count({
        where: { analysis: null, attempts: { gte: 3 } },
      }),
    },
  };
}

export type Portfolio = Awaited<ReturnType<typeof buildPortfolio>>;
