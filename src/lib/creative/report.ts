// The reporting read: what works, what it cost, and what the data can support.
//
// Sits over performance.ts the way portfolio.ts sits over coverage.ts — this
// file talks to the database, that one does the arithmetic.
//
// One row per *creative*, folded by family before anything is counted. Meta
// issues a fresh id on every re-upload, so counting uploads inflated coverage,
// territory occupancy and campaign grades before 32b83e8; any new aggregate
// that skips familyKey() quietly reintroduces the same bug.

import { db } from "@/lib/db";
import { familyKey } from "@/lib/creative/family";
import {
  benchmarkOf,
  scoreCreatives,
  termSignals,
  trends,
  waste,
  type CreativePerf,
  type PerfInput,
  type WindowPerf,
} from "@/lib/creative/performance";

/** The axes worth asking "does this predict anything?" about. */
const AXES = ["pillar", "persona", "hook", "funnel", "format", "production"] as const;
type Axis = (typeof AXES)[number];

/** Days at each end of a creative's life used for the fatigue comparison. */
const WINDOW_DAYS = 14;

export async function buildReport(since?: string) {
  const [assets, daily, copiedClassifications] = await Promise.all([
    db.creativeAsset.findMany({
      select: {
        id: true,
        name: true,
        familyId: true,
        adIds: true,
        assetType: true,
        analysis: {
          select: {
            pillar: true, persona: true, hook: true, funnel: true,
            format: true, production: true, copiedFromAssetId: true,
            // Fetched to judge how grounded a classification is, then reduced
            // to a boolean and dropped. Postgres has no length filter through
            // Prisma, and the alternative — counting rows where transcript is
            // merely non-null — would score a two-word stub as heard.
            transcript: true,
          },
        },
      },
    }),
    db.metaInsightDaily.findMany({
      where: { level: "ad", ...(since ? { date: { gte: new Date(since) } } : {}) },
      select: { entityId: true, date: true, spend: true, purchases: true, purchaseValue: true },
    }),
    // Counted across the whole library, not off the folded rows: folding keeps
    // only the face of each family, so counting copies there reports whichever
    // member happened to win the fold rather than how many copies exist.
    db.creativeAnalysis.count({ where: { copiedFromAssetId: { not: null } } }),
  ]);

  // Fold uploads into creatives. The upload running in the most ads is the
  // face of the group, matching buildPortfolio so the two reads agree.
  interface Fold {
    id: string;
    name: string;
    adIds: string[];
    analysis: (typeof assets)[number]["analysis"];
    faceAdCount: number;
  }
  const byCreative = new Map<string, Fold>();
  for (const a of assets) {
    const key = familyKey(a);
    const cur = byCreative.get(key);
    if (!cur) {
      byCreative.set(key, {
        id: a.id, name: a.name, adIds: [...a.adIds],
        analysis: a.analysis, faceAdCount: a.adIds.length,
      });
      continue;
    }
    cur.adIds.push(...a.adIds);
    // Keep whichever member actually carries a classification.
    cur.analysis = cur.analysis ?? a.analysis;
    if (a.adIds.length > cur.faceAdCount) {
      cur.id = a.id;
      cur.name = a.name;
      cur.faceAdCount = a.adIds.length;
    }
  }

  const adToCreative = new Map<string, string>();
  for (const [key, c] of byCreative) for (const id of c.adIds) adToCreative.set(id, key);

  // Per-creative totals, plus the day series the age and fatigue maths need.
  interface Totals {
    spend: number; purchases: number; revenue: number;
    days: Map<string, { spend: number; purchases: number }>;
  }
  const totals = new Map<string, Totals>();
  let accountSpend = 0;
  let accountPurchases = 0;

  for (const row of daily) {
    const spend = Number(row.spend);
    const purchases = row.purchases;
    accountSpend += spend;
    accountPurchases += purchases;

    const key = adToCreative.get(row.entityId);
    if (!key) continue;
    const t = totals.get(key) ?? { spend: 0, purchases: 0, revenue: 0, days: new Map() };
    t.spend += spend;
    t.purchases += purchases;
    t.revenue += Number(row.purchaseValue);
    if (spend > 0) {
      const d = row.date.toISOString().slice(0, 10);
      const day = t.days.get(d) ?? { spend: 0, purchases: 0 };
      day.spend += spend;
      day.purchases += purchases;
      t.days.set(d, day);
    }
    totals.set(key, t);
  }

  const inputs: PerfInput[] = [];
  const windows: WindowPerf[] = [];
  for (const [key, c] of byCreative) {
    const t = totals.get(key);
    if (!t || t.spend <= 0) continue;
    inputs.push({
      id: key,
      name: c.name,
      spend: t.spend,
      purchases: t.purchases,
      revenue: t.revenue,
      deliveryDays: t.days.size,
    });

    const ordered = [...t.days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const early = ordered.slice(0, WINDOW_DAYS);
    const late = ordered.slice(-WINDOW_DAYS);
    windows.push({
      id: key,
      name: c.name,
      spend: t.spend,
      deliveryDays: t.days.size,
      earlySpend: early.reduce((a, [, d]) => a + d.spend, 0),
      earlyPurchases: early.reduce((a, [, d]) => a + d.purchases, 0),
      lateSpend: late.reduce((a, [, d]) => a + d.spend, 0),
      latePurchases: late.reduce((a, [, d]) => a + d.purchases, 0),
    });
  }

  const benchmark = benchmarkOf(inputs);
  const scored = scoreCreatives(inputs, benchmark);
  const byId = new Map(scored.map((s) => [s.id, s]));

  // Attach each creative's taxonomy terms, then ask each axis what it can prove.
  const withTerms = (axis: Axis): (CreativePerf & { term: string | null })[] => {
    const out: (CreativePerf & { term: string | null })[] = [];
    for (const [key, c] of byCreative) {
      const perf = byId.get(key);
      if (!perf) continue;
      out.push({ ...perf, term: c.analysis?.[axis] ?? null });
    }
    return out;
  };

  const signals = Object.fromEntries(
    AXES.map((axis) => [axis, termSignals(withTerms(axis), axis, benchmark)]),
  ) as Record<Axis, ReturnType<typeof termSignals>>;

  const classified = scored.filter((s) => byCreative.get(s.id)?.analysis != null);

  // How much of the money rests on a classification made without hearing the
  // video. Only 286 of 1,188 canonical creatives carry a usable transcript, so
  // the rest were judged from eight still frames plus the ad copy. That is a
  // real difference in confidence and it should be on the page, not implied.
  let groundedCreatives = 0;
  let groundedSpend = 0;
  let ungroundedCreatives = 0;
  let ungroundedSpend = 0;
  for (const s of scored) {
    const a = byCreative.get(s.id)?.analysis;
    if (!a) continue;
    if ((a.transcript?.length ?? 0) > 40) {
      groundedCreatives++;
      groundedSpend += s.spend;
    } else {
      ungroundedCreatives++;
      ungroundedSpend += s.spend;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    account: {
      spend: accountSpend,
      purchases: accountPurchases,
      cpa: accountPurchases > 0 ? accountSpend / accountPurchases : null,
      /** Spend on ads that map to no creative. Surfaced rather than netted off:
       *  a silent gap here is how 423 ads and $218,608 went missing before
       *  f06f002, with no error and no visible change. */
      unattributedSpend: accountSpend - benchmark.spend,
      classifiedCreatives: classified.length,
    },
    benchmark,
    /** How much confidence the classifications deserve. Not decoration: 55% of
     *  spend is classified from stills and copy, and a page that renders those
     *  rows identically to transcript-grounded ones overstates what it knows. */
    quality: {
      groundedCreatives,
      groundedSpend,
      ungroundedCreatives,
      ungroundedSpend,
      copiedClassifications,
    },
    creatives: scored.sort((a, b) => b.spend - a.spend),
    signals,
    waste: waste(scored, benchmark),
    trends: trends(windows),
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;
