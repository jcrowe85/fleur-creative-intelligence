// What actually works — and, just as often, whether the data can support the
// claim at all.
//
// Pure functions over rows, like coverage.ts: the database fetch lives in the
// report builder that calls this. Every threshold below came from measuring
// Fleur's own account rather than from a convention, and the measurements are
// recorded because they are the reason the numbers are what they are.
//
// Three findings shaped this module:
//
// 1. CPA barely varies by category. Across pillars it spans 1.47x ($75-$110
//    against an $88 benchmark) while spend-per-creative spans 11.2x once
//    age-normalised. Meta equalises CPA by moving budget, so CPA is the axis
//    its optimiser flattens. How much a creative can absorb at an acceptable
//    CPA is the thing that actually differs — so volume is reported beside
//    CPA, never behind it.
//
// 2. Categories are frequently one advert. In 5 of 17 judgeable hook terms a
//    single creative is more than half the term's spend ($115,804 of it);
//    `routine_demo` is 99% one creative on three creatives and $25,776.
//    Reporting a CPA for those alongside a term backed by 300 creatives, with
//    nothing to separate them, is how a dashboard invents winners.
//
// 3. The account is ~25 adverts. The top 25 creatives carry 60% of spend, the
//    top 100 carry 87%. Averages over 1,313 creatives describe a population
//    that barely spends.

/** A creative needs this many purchases before its own CPA means anything.
 *  Individual CPA runs p10 $62 / p50 $81 / p90 $136, so the spread is real —
 *  but under a handful of purchases it is coin-flipping. */
export const MIN_PURCHASES_CREATIVE = 5;

/** An axis term needs this many before it can be compared with another. */
export const MIN_PURCHASES_TERM = 25;

/** Above this share, a term's numbers are a statement about one creative.
 *  Half is deliberately generous: at 50% the single advert already outweighs
 *  every other creative in the term combined. */
export const DOMINATED_SHARE = 0.5;

/** How far from the account benchmark counts as genuinely different rather
 *  than drift. CPA sits within ±15% for most of the library. */
const MATERIAL_DIFFERENCE = 0.15;

export interface PerfInput {
  id: string;
  name: string;
  spend: number;
  purchases: number;
  revenue: number;
  /** Distinct days this creative delivered — ages differ, so totals alone
   *  reward whatever launched first. */
  deliveryDays: number;
}

export type Verdict = "beats" | "matches" | "loses" | "no_sales" | "too_small";

export interface CreativePerf extends PerfInput {
  cpa: number | null;
  roas: number | null;
  spendPerDay: number;
  /** CPA relative to the account benchmark: -0.2 means 20% cheaper. */
  vsBenchmark: number | null;
  verdict: Verdict;
}

export interface Benchmark {
  spend: number;
  purchases: number;
  cpa: number | null;
  creatives: number;
  /** Share of spend carried by the top 25 creatives — the number that decides
   *  whether an account-wide average describes anything real. */
  top25Share: number;
}

export function benchmarkOf(rows: PerfInput[]): Benchmark {
  const spend = rows.reduce((a, r) => a + r.spend, 0);
  const purchases = rows.reduce((a, r) => a + r.purchases, 0);
  const top25 = [...rows].sort((a, b) => b.spend - a.spend).slice(0, 25);
  return {
    spend,
    purchases,
    cpa: purchases > 0 ? spend / purchases : null,
    creatives: rows.length,
    top25Share: spend > 0 ? top25.reduce((a, r) => a + r.spend, 0) / spend : 0,
  };
}

/**
 * Score each creative against the account.
 *
 * "too_small" and "no_sales" are different claims and stay different: one says
 * we cannot tell, the other says we can and it did not sell. Collapsing them
 * would bury every creative that never had a chance to prove itself.
 */
export function scoreCreatives(rows: PerfInput[], bench: Benchmark): CreativePerf[] {
  return rows.map((r) => {
    const cpa = r.purchases > 0 ? r.spend / r.purchases : null;
    const vsBenchmark = cpa != null && bench.cpa ? cpa / bench.cpa - 1 : null;

    let verdict: Verdict;
    if (r.purchases === 0) verdict = r.spend > 0 ? "no_sales" : "too_small";
    else if (r.purchases < MIN_PURCHASES_CREATIVE) verdict = "too_small";
    else if (vsBenchmark == null) verdict = "too_small";
    else if (vsBenchmark <= -MATERIAL_DIFFERENCE) verdict = "beats";
    else if (vsBenchmark >= MATERIAL_DIFFERENCE) verdict = "loses";
    else verdict = "matches";

    return {
      ...r,
      cpa,
      roas: r.spend > 0 ? r.revenue / r.spend : null,
      spendPerDay: r.spend / Math.max(r.deliveryDays, 1),
      vsBenchmark,
      verdict,
    };
  });
}

/** Whether a term's numbers describe a pattern, one advert, or nothing yet. */
export type TermStatus = "pattern" | "one_creative" | "too_thin";

export interface TermSignal {
  axis: string;
  term: string;
  creatives: number;
  spend: number;
  purchases: number;
  cpa: number | null;
  vsBenchmark: number | null;
  /** Medians, because means here are dragged around by single adverts: across
   *  pillars the mean spread is 9.1x and the median spread 60.8x. */
  medianSpend: number;
  medianSpendPerDay: number;
  /** Share of the term's spend carried by its single biggest creative. */
  top1Share: number;
  top3Share: number;
  status: TermStatus;
  /** The creative behind a dominated term, so the claim can be checked. */
  dominantName: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Group creatives by one taxonomy axis and report whether each term can be
 * believed.
 *
 * A term is only a "pattern" when enough of the account bought through it AND
 * no single creative dominates it. Everything else is labelled rather than
 * hidden — a term that is one advert is often the most interesting row on the
 * page, as long as nobody mistakes it for a category that works.
 */
export function termSignals(
  rows: (CreativePerf & { term: string | null })[],
  axis: string,
  bench: Benchmark,
): TermSignal[] {
  const byTerm = new Map<string, (CreativePerf & { term: string | null })[]>();
  for (const r of rows) {
    if (!r.term || r.spend <= 0) continue;
    const list = byTerm.get(r.term) ?? [];
    list.push(r);
    byTerm.set(r.term, list);
  }

  const out: TermSignal[] = [];
  for (const [term, list] of byTerm) {
    const spend = list.reduce((a, r) => a + r.spend, 0);
    const purchases = list.reduce((a, r) => a + r.purchases, 0);
    const ranked = [...list].sort((a, b) => b.spend - a.spend);
    const top1Share = ranked[0].spend / spend;
    const top3Share = ranked.slice(0, 3).reduce((a, r) => a + r.spend, 0) / spend;
    const cpa = purchases > 0 ? spend / purchases : null;

    const status: TermStatus =
      purchases < MIN_PURCHASES_TERM
        ? "too_thin"
        : top1Share >= DOMINATED_SHARE
          ? "one_creative"
          : "pattern";

    out.push({
      axis,
      term,
      creatives: list.length,
      spend,
      purchases,
      cpa,
      vsBenchmark: cpa != null && bench.cpa ? cpa / bench.cpa - 1 : null,
      medianSpend: median(list.map((r) => r.spend)),
      medianSpendPerDay: median(list.map((r) => r.spendPerDay)),
      top1Share,
      top3Share,
      status,
      dominantName: status === "one_creative" ? ranked[0].name : null,
    });
  }

  // Volume first: it is the axis that actually separates, and a term that
  // absorbs nothing is not an opportunity however cheap its CPA looks.
  return out.sort((a, b) => b.medianSpendPerDay - a.medianSpendPerDay);
}

export interface WasteRow {
  label: string;
  creatives: number;
  spend: number;
  note: string;
}

/** Where the money went that bought nothing, stated without inflation. */
export function waste(rows: CreativePerf[], bench: Benchmark): WasteRow[] {
  const noSales = rows.filter((r) => r.verdict === "no_sales");
  const losing = rows.filter(
    (r) => r.verdict === "loses" && r.vsBenchmark != null && r.vsBenchmark >= 0.5,
  );
  return [
    {
      label: "Spent, never sold",
      creatives: noSales.length,
      spend: noSales.reduce((a, r) => a + r.spend, 0),
      note: "Mostly small tests — normal, and the cost of finding winners.",
    },
    {
      label: "Half again the benchmark or worse",
      creatives: losing.length,
      spend: losing.reduce((a, r) => a + r.spend, 0),
      note: bench.cpa ? `Benchmark CPA $${bench.cpa.toFixed(0)}.` : "",
    },
  ];
}

export interface TrendRow {
  id: string;
  name: string;
  earlyCpa: number;
  lateCpa: number;
  /** Positive means it got more expensive. */
  change: number;
  spend: number;
}

export interface WindowPerf {
  id: string;
  name: string;
  spend: number;
  /** Distinct days delivered. Decides whether the two windows can be disjoint. */
  deliveryDays: number;
  earlySpend: number;
  earlyPurchases: number;
  lateSpend: number;
  latePurchases: number;
}

/**
 * Creatives whose cost of acquisition moved between their first and last two
 * weeks of delivery.
 *
 * Both windows need their own purchases before a comparison is allowed, which
 * is why this covers a small number of creatives — on Fleur's library only 23
 * qualify. That is a real limit of the data, not a filter to loosen: comparing
 * two one-purchase windows would generate confident nonsense.
 */
export function trends(
  rows: WindowPerf[],
  minPurchasesPerWindow = 3,
  windowDays = 14,
): TrendRow[] {
  const out: TrendRow[] = [];
  for (const r of rows) {
    // The two windows must not overlap, or a creative is being compared with
    // itself. A 20-day creative sliced first-14/last-14 shares eight days
    // between them; the first version of this function did exactly that and
    // produced "$27 -> $278, +928%" fatigue that was pure arithmetic artefact.
    if (r.deliveryDays < windowDays * 2) continue;
    if (r.earlyPurchases < minPurchasesPerWindow) continue;
    if (r.latePurchases < minPurchasesPerWindow) continue;
    const earlyCpa = r.earlySpend / r.earlyPurchases;
    const lateCpa = r.lateSpend / r.latePurchases;
    if (!Number.isFinite(earlyCpa) || !Number.isFinite(lateCpa) || earlyCpa <= 0) continue;
    out.push({
      id: r.id,
      name: r.name,
      earlyCpa,
      lateCpa,
      change: lateCpa / earlyCpa - 1,
      spend: r.spend,
    });
  }
  return out.sort((a, b) => b.change - a.change);
}
