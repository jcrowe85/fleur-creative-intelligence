// Portfolio-level diversity maths.
//
// The question this answers is not "how many ads do we have" but "how much
// distinct territory do we occupy, and where are we paying twice for the same
// ground". Andromeda selects candidates from a balanced hierarchical index, so
// twenty assets clustered in one territory buy far less retrieval surface than
// twenty spread across the space.
//
// Everything here is deliberately simple and inspectable — counts, shares and
// two standard concentration measures. No black boxes: the team has to be able
// to argue with the output.

import {
  FUNNEL_STAGES,
  HOOK_TYPES,
  PERSONAS,
  PILLARS,
  TERRITORY_SPACE_SIZE,
  labelFor,
  territoryKey,
  type FunnelStageId,
} from "./taxonomy";

export interface ClassifiedAsset {
  id: string;
  name: string;
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
  awareness: string;
  format: string;
  production: string;
  placementFit: string;
  /** Optional performance, when the asset has been joined to Meta insights. */
  spend?: number;
  purchases?: number;
  revenue?: number;
}

export interface AxisCoverage {
  axis: string;
  rows: {
    id: string;
    label: string;
    assets: number;
    assetShare: number;
    spend: number;
    spendShare: number;
    purchases: number;
    cpa: number | null;
    roas: number | null;
    /** Flagged when the pillar is one Fleur is uniquely able to own. */
    strategicPriority?: boolean;
  }[];
  /** Fraction of this axis genuinely in play. See effectiveCoverage. */
  coverage: number;
  /** Terms with zero assets. */
  missing: { id: string; label: string }[];
}

/**
 * Effective coverage of an axis: `exp(H) / axisSize`, where H is Shannon
 * entropy over the observed counts.
 *
 * `exp(H)` is the effective number of terms in use — 8 terms at equal weight
 * gives 8, the same 8 with one dominating gives less. Over the axis size it
 * reads directly as "the fraction of this axis actually covered": 8 of 20
 * pillars used evenly is 0.40, and lopsidedness pulls it below.
 *
 * THIS IS THE ONLY DIVERSITY MEASURE IN THE APP. An earlier version used
 * normalised Shannon evenness, which measures balance *among the terms already
 * in use* and is blind to what is missing — it scored a campaign touching 8 of
 * 20 pillars at 0.62-0.67. Worse, only the campaign view was migrated, so the
 * portfolio cards and the campaign table reported different numbers for the
 * same idea. Both now call this.
 */
export function effectiveCoverage(counts: number[], axisSize: number): number {
  const observed = counts.filter((c) => c > 0);
  const total = observed.reduce((a, b) => a + b, 0);
  if (total === 0 || axisSize === 0) return 0;
  let h = 0;
  for (const c of observed) {
    const p = c / total;
    h -= p * Math.log(p);
  }
  return Math.min(1, Math.exp(h) / axisSize);
}

/** Herfindahl index on spend — how concentrated the money is. Above ~0.25 is
 *  a portfolio leaning hard on a handful of assets. */
export function herfindahl(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return values.reduce((acc, v) => acc + (v / total) ** 2, 0);
}

const AXIS_TERMS = {
  pillar: PILLARS,
  persona: PERSONAS,
  hook: HOOK_TYPES,
  funnel: FUNNEL_STAGES,
} as const;

export function axisCoverage(
  assets: ClassifiedAsset[],
  axis: keyof typeof AXIS_TERMS,
): AxisCoverage {
  const terms = AXIS_TERMS[axis];
  const totalAssets = assets.length;
  const totalSpend = assets.reduce((a, x) => a + (x.spend ?? 0), 0);

  const rows = terms.map((t) => {
    const hits = assets.filter((a) => a[axis] === t.id);
    const spend = hits.reduce((s, x) => s + (x.spend ?? 0), 0);
    const purchases = hits.reduce((s, x) => s + (x.purchases ?? 0), 0);
    const revenue = hits.reduce((s, x) => s + (x.revenue ?? 0), 0);
    return {
      id: t.id,
      label: t.label,
      assets: hits.length,
      assetShare: totalAssets ? hits.length / totalAssets : 0,
      spend,
      spendShare: totalSpend ? spend / totalSpend : 0,
      purchases,
      cpa: purchases > 0 ? spend / purchases : null,
      roas: spend > 0 ? revenue / spend : null,
      ...("strategicPriority" in t && t.strategicPriority
        ? { strategicPriority: true as const }
        : {}),
    };
  });

  return {
    axis,
    rows: rows.sort((a, b) => b.assets - a.assets),
    coverage: effectiveCoverage(rows.map((r) => r.assets), terms.length),
    missing: rows.filter((r) => r.assets === 0).map(({ id, label }) => ({ id, label })),
  };
}

// ── Territory occupancy ───────────────────────────────────────────────────────

export interface Territory {
  key: string;
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
  label: string;
  assets: ClassifiedAsset[];
  spend: number;
  purchases: number;
  revenue: number;
}

export function territories(assets: ClassifiedAsset[]): Territory[] {
  const map = new Map<string, Territory>();
  for (const a of assets) {
    const key = territoryKey(a);
    let t = map.get(key);
    if (!t) {
      t = {
        key,
        pillar: a.pillar,
        persona: a.persona,
        hook: a.hook,
        funnel: a.funnel,
        label:
          `${labelFor("pillar", a.pillar)} × ${labelFor("persona", a.persona)} × ` +
          `${labelFor("hook", a.hook)} × ${a.funnel}`,
        assets: [],
        spend: 0,
        purchases: 0,
        revenue: 0,
      };
      map.set(key, t);
    }
    t.assets.push(a);
    t.spend += a.spend ?? 0;
    t.purchases += a.purchases ?? 0;
    t.revenue += a.revenue ?? 0;
  }
  return [...map.values()].sort((a, b) => b.assets.length - a.assets.length);
}

// ── Redundancy ────────────────────────────────────────────────────────────────

export interface RedundancyCluster {
  territory: Territory;
  /** Assets beyond the first in this exact territory. */
  surplus: number;
  /** Spend sitting on the duplicates, i.e. what is being paid twice. */
  duplicateSpend: number;
}

/**
 * Territories holding more assets than `threshold`. These are the places where
 * new creatives are landing on ground already occupied — the concrete form of
 * "we made fifteen versions of the same ad".
 */
export function redundancy(assets: ClassifiedAsset[], threshold = 2): RedundancyCluster[] {
  return territories(assets)
    .filter((t) => t.assets.length > threshold)
    .map((t) => {
      const sorted = [...t.assets].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
      return {
        territory: t,
        surplus: t.assets.length - 1,
        duplicateSpend: sorted.slice(1).reduce((s, a) => s + (a.spend ?? 0), 0),
      };
    })
    .sort((a, b) => b.duplicateSpend - a.duplicateSpend);
}

// ── Gaps ──────────────────────────────────────────────────────────────────────

export interface Gap {
  pillar: string;
  persona: string;
  funnel: FunnelStageId;
  label: string;
  reason: string;
  priority: number; // higher = brief this first
}

/**
 * Unoccupied territory worth briefing. The full space is ~13k cells, so listing
 * every empty one is noise. This ranks the gaps that matter: strategic pillars
 * Fleur can uniquely own, crossed with personas that already convert, at funnel
 * stages the portfolio is thin on.
 *
 * Hook is deliberately excluded here — it is the cheapest axis to vary once a
 * pillar × persona × funnel brief exists, so it would only inflate the list.
 */
export function gaps(assets: ClassifiedAsset[], limit = 25): Gap[] {
  const occupied = new Set(assets.map((a) => `${a.pillar}|${a.persona}|${a.funnel}`));

  // Personas that have earned attention: any spend at all, ranked by purchases.
  const personaPerf = new Map<string, { purchases: number; spend: number }>();
  for (const a of assets) {
    const p = personaPerf.get(a.persona) ?? { purchases: 0, spend: 0 };
    p.purchases += a.purchases ?? 0;
    p.spend += a.spend ?? 0;
    personaPerf.set(a.persona, p);
  }

  const funnelCounts = new Map<string, number>(FUNNEL_STAGES.map((f) => [f.id, 0]));
  for (const a of assets) funnelCounts.set(a.funnel, (funnelCounts.get(a.funnel) ?? 0) + 1);
  const maxFunnel = Math.max(1, ...funnelCounts.values());

  const out: Gap[] = [];
  for (const pillar of PILLARS) {
    for (const persona of PERSONAS) {
      if (persona.id === "none") continue; // not a territory worth briefing into
      for (const funnel of FUNNEL_STAGES) {
        const key = `${pillar.id}|${persona.id}|${funnel.id}`;
        if (occupied.has(key)) continue;

        const perf = personaPerf.get(persona.id);
        // A persona nobody has tried is a weaker bet than one already converting,
        // but not worthless — it just ranks below proven ground.
        const personaScore = perf ? (perf.purchases > 0 ? 2 : 1) : 0.5;
        const funnelThinness = 1 - (funnelCounts.get(funnel.id) ?? 0) / maxFunnel;
        const strategic = pillar.strategicPriority ? 2 : 1;
        const alignsWithDefault = pillar.defaultFunnel === funnel.id ? 1.5 : 1;

        const priority = strategic * personaScore * (1 + funnelThinness) * alignsWithDefault;

        out.push({
          pillar: pillar.id,
          persona: persona.id,
          funnel: funnel.id,
          label: `${pillar.label} × ${persona.label} × ${funnel.id}`,
          reason: [
            pillar.strategicPriority ? "pillar Fleur can uniquely own" : null,
            perf && perf.purchases > 0 ? "persona already converts" : null,
            funnelThinness > 0.5 ? `${funnel.id} is thin` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "unoccupied",
          priority,
        });
      }
    }
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

// ── Portfolio summary ─────────────────────────────────────────────────────────

export interface PortfolioSummary {
  assets: number;
  territoriesOccupied: number;
  territorySpaceSize: number;
  occupancyRate: number;
  spendHerfindahl: number;
  coverageByAxis: Record<string, number>;
  duplicateSpend: number;
  totalSpend: number;
  complianceFlagged: number;
}

export function summarize(
  assets: ClassifiedAsset[],
  flaggedCount = 0,
): PortfolioSummary {
  const t = territories(assets);
  const totalSpend = assets.reduce((s, a) => s + (a.spend ?? 0), 0);
  return {
    assets: assets.length,
    territoriesOccupied: t.length,
    territorySpaceSize: TERRITORY_SPACE_SIZE,
    occupancyRate: t.length / TERRITORY_SPACE_SIZE,
    spendHerfindahl: herfindahl(assets.map((a) => a.spend ?? 0)),
    coverageByAxis: {
      pillar: axisCoverage(assets, "pillar").coverage,
      persona: axisCoverage(assets, "persona").coverage,
      hook: axisCoverage(assets, "hook").coverage,
      funnel: axisCoverage(assets, "funnel").coverage,
    },
    duplicateSpend: redundancy(assets).reduce((s, r) => s + r.duplicateSpend, 0),
    totalSpend,
    complianceFlagged: flaggedCount,
  };
}
