// Builds the portfolio read: every classified asset joined to its Meta
// performance, plus coverage, redundancy and ranked gaps.
//
// Lives here rather than in the route handler so the page can render it
// server-side on first paint and the route can serve refreshes, without the
// two drifting apart.

import { db } from "@/lib/db";
import {
  axisCoverage,
  gaps,
  redundancy,
  summarize,
  type ClassifiedAsset,
} from "@/lib/creative/coverage";

export async function buildPortfolio(since?: string) {


  const assets = await db.creativeAsset.findMany({
    where: { analysis: { isNot: null } },
    include: { analysis: true },
  });

  // One grouped query for every ad id in play, rather than per asset.
  const allAdIds = [...new Set(assets.flatMap((a) => a.adIds))];
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

  const classified: ClassifiedAsset[] = assets.map((a) => {
    const totals = a.adIds.reduce(
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
    const an = a.analysis!;
    return {
      id: a.id,
      name: a.name,
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

  const flagged = assets.filter((a) => (a.analysis?.complianceFlags.length ?? 0) > 0);

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
    compliance: flagged.map((a) => ({
      id: a.id,
      name: a.name,
      flags: a.analysis!.complianceFlags,
    })),
    assets: classified
      .map((c) => {
        const src = assets.find((a) => a.id === c.id)!;
        return {
          ...c,
          thumbUrl: src.thumbUrl,
          assetType: src.assetType,
          adCount: src.adIds.length,
          hookText: src.analysis!.hookText,
          critique: src.analysis!.critique,
          scores: {
            hookStrength: src.analysis!.hookStrength,
            messageClarity: src.analysis!.messageClarity,
            differentiation: src.analysis!.differentiation,
            productionQuality: src.analysis!.productionQuality,
            placementNativeness: src.analysis!.placementNativeness,
          },
          lowConfidence: Math.min(
            src.analysis!.pillarConf,
            src.analysis!.personaConf,
            src.analysis!.funnelConf,
          ) < 0.5,
        };
      })
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)),
    counts: {
      analyzed: assets.length,
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
