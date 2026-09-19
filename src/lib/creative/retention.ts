// Hook rate, hold rate and finish rate, per creative.
//
// The sync has been writing videoViews3s, thruplays and videoP25–P100 into
// MetaInsightDaily every day since May and nothing has ever read them. These
// are the three rates worth reading off those columns — and the two traps,
// both measured against Fleur's own library before any of this was written:
//
//   hook   = 3s views / impressions   Clean. Correlation with video length
//                                     −0.02, so any two creatives compare
//                                     directly. Median 32.7%, p10 18.8%,
//                                     p90 44.7%.
//
//   hold   = thruplays / 3s views     Length-sensitive. Meta counts a thruplay
//                                     at 15 seconds OR completion, whichever
//                                     comes first, so for a 9-second video it
//                                     is nearly the completion rate while for
//                                     a 60-second video it is 15s retention.
//                                     The thruplay/P100 ratio runs 1.01 in the
//                                     0–10s band and 4.98 at 30s+.
//
//   finish = P100 / 3s views          Badly length-confounded: correlation
//                                     −0.49, median 43% for videos under 10s
//                                     against 4.6% at 45–60s. A ~9× swing that
//                                     is mechanics, not quality.
//
// Hook rate is therefore reported as-is, while hold and finish carry a
// percentile taken *within their own length band*. Ranking the library on raw
// finish rate would put short videos on top almost regardless of how good they
// are, and the advice falling out of that — "make shorter videos" — is not
// advice anyone actually measured.
//
// There is deliberately no single blended score. Averaging one clean metric
// with two confounded ones would bury the distinction this module exists to
// keep visible.

/** Below this, the rates are noise: report null rather than a number. */
export const MIN_IMPRESSIONS = 1000;

/** A band needs enough creatives for a percentile to mean anything. */
const MIN_BAND_SIZE = 8;

/** Boundaries chosen to straddle Meta's 15s thruplay cutoff, where the
 *  meaning of "hold" changes, rather than at round numbers. */
const BANDS: { label: string; lo: number; hi: number }[] = [
  { label: "0–10s", lo: 0, hi: 10 },
  { label: "10–15s", lo: 10, hi: 15 },
  { label: "15–20s", lo: 15, hi: 20 },
  { label: "20–30s", lo: 20, hi: 30 },
  { label: "30–45s", lo: 30, hi: 45 },
  { label: "45–60s", lo: 45, hi: 60 },
  { label: "60s+", lo: 60, hi: Infinity },
];

export interface VideoTotals {
  impressions: number;
  videoViews3s: number;
  thruplays: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
}

export interface Retention {
  /** 3-second views over impressions. Comparable across every creative. */
  hookRate: number | null;
  /** Thruplays over 3-second views. Only compare within a length band. */
  holdRate: number | null;
  /** Completions over 3-second views. Only compare within a length band. */
  finishRate: number | null;
  /** Where this creative sits among others of its own length, 0–1. Null when
   *  the length is unknown or the band is too small to rank within. */
  holdPercentile: number | null;
  finishPercentile: number | null;
  durationSec: number | null;
  lengthBand: string | null;
  /** How many creatives the percentiles were taken against. */
  bandSize: number;
}

export function bandFor(durationSec: number | null): string | null {
  if (durationSec == null || !Number.isFinite(durationSec)) return null;
  return BANDS.find((b) => durationSec >= b.lo && durationSec < b.hi)?.label ?? null;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * Rates for one creative. Null throughout when the creative hasn't been seen
 * enough times to judge — a zero here would sort it alongside genuinely bad
 * creative, which is a different claim than "too small to say".
 */
export function ratesFor(totals: VideoTotals, durationSec: number | null): Retention {
  const scorable = totals.impressions >= MIN_IMPRESSIONS && totals.videoViews3s > 0;
  return {
    hookRate: scorable ? rate(totals.videoViews3s, totals.impressions) : null,
    holdRate: scorable ? rate(totals.thruplays, totals.videoViews3s) : null,
    finishRate: scorable ? rate(totals.videoP100, totals.videoViews3s) : null,
    holdPercentile: null,
    finishPercentile: null,
    durationSec,
    lengthBand: bandFor(durationSec),
    bandSize: 0,
  };
}

/** Fraction of the band scoring strictly below, plus half the ties — the
 *  ordinary definition, and it keeps identical creatives at the same rank. */
function percentile(values: number[], v: number): number {
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length;
  return (below + equal / 2) / values.length;
}

/**
 * Fill in the within-band percentiles across a whole set of creatives.
 *
 * Percentiles are taken over whatever set is passed in, so a date-filtered
 * view ranks a creative against its contemporaries rather than against the
 * library's whole history. That is the comparison someone reading a filtered
 * dashboard is actually making.
 */
export function withBandPercentiles<T extends { retention: Retention }>(rows: T[]): T[] {
  const byBand = new Map<string, Retention[]>();
  for (const r of rows) {
    const band = r.retention.lengthBand;
    if (!band || r.retention.holdRate == null) continue;
    const list = byBand.get(band) ?? [];
    list.push(r.retention);
    byBand.set(band, list);
  }

  for (const [band, members] of byBand) {
    if (members.length < MIN_BAND_SIZE) continue;
    const holds = members.map((m) => m.holdRate!).filter((v) => v != null);
    const finishes = members
      .map((m) => m.finishRate)
      .filter((v): v is number => v != null);
    for (const r of rows) {
      if (r.retention.lengthBand !== band) continue;
      if (r.retention.holdRate != null) {
        r.retention.holdPercentile = percentile(holds, r.retention.holdRate);
        r.retention.bandSize = members.length;
      }
      if (r.retention.finishRate != null && finishes.length > 0) {
        r.retention.finishPercentile = percentile(finishes, r.retention.finishRate);
      }
    }
  }
  return rows;
}
