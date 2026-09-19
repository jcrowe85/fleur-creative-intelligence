// What changed in the account, week by week, computed.
//
// Donovan never wants to review anything, so every line this produces has to
// earn being read. The thresholds below are not taste — each one was measured
// by replaying the real 18 weeks of this account and counting what a detector
// would have emitted:
//
//   A naive version emitted 36.4 events a week. 56% of that was top-25
//   leaderboard churn, which is an arithmetic identity rather than news: a
//   fixed-size list must evict one creative for every one it admits, so "14 in,
//   14 out" appears every week forever. Another 24% was "stopped" firing on a
//   truncated final window. Removing leaderboard churn and qualifying "stopped"
//   left 8.7 a week, median 8, max 22 — a list someone reads.
//
// Windowing is measured too. Every historical day in this account reconciles to
// Meta to the dollar; only the current day under-reports while attribution
// settles (by ~29% on the day it was checked). So the detector excludes the
// current day and requires complete weeks, and nothing heavier than that.

import { db } from "@/lib/db";
import { familyKey } from "./family";

/** Both weeks need this many purchases before a change in cost means anything.
 *  Individual creative CPA runs p10 $62 / p50 $81 / p90 $136, so the spread is
 *  real — but under a handful of purchases it is coin-flipping. */
export const MIN_PURCHASES = 5;

/** How far cost per purchase must move to be worth a line. */
export const MATERIAL_MOVE = 0.25;

/** Below this a creative's week is not worth reporting on at all. */
export const MATERIAL_SPEND = 200;

/** "Stopped" is only news if the creative was actually carrying something. */
export const STOPPED_SPEND = 1000;

/** A launch needs the same weight as a stop before it earns a line.
 *
 *  Measured: at the MATERIAL_SPEND floor, 63% of "started" events were under
 *  $500 and 126 of 238 total events were launches — a creative spending $200 in
 *  its first week is a test, not news. Gating at $1,000 takes the log from 13.2
 *  events a week to 7.2 while keeping every launch above $2,500, and it leaves
 *  the dearer/cheaper/stopped lines — the ones carrying the actual signal —
 *  completely untouched. */
export const STARTED_SPEND = 1000;

export type EventType = "started" | "stopped" | "dearer" | "cheaper";

export interface DetectedEvent {
  key: string;
  weekOf: Date;
  type: EventType;
  creativeId: string;
  name: string | null;
  spend: number;
  detail: Record<string, number> | null;
}

/** Monday of the week a date falls in, in UTC. */
export function weekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

export interface EventRun {
  weeksProcessed: number;
  events: number;
  byType: Record<EventType, number>;
  /** Weeks left alone because they are not finished yet. */
  weeksSkippedIncomplete: number;
}

/**
 * Recompute the log.
 *
 * Deletes and replaces each week it processes rather than upserting: if the
 * underlying data is restated, an upsert would leave behind events that no
 * longer qualify and the log would drift from the numbers it describes. This is
 * the same delete-and-replace that sync/meta.ts uses on insights, for the same
 * reason.
 */
export async function detectEvents(): Promise<EventRun> {
  const [assets, daily] = await Promise.all([
    db.creativeAsset.findMany({ select: { id: true, familyId: true, adIds: true, name: true } }),
    db.metaInsightDaily.findMany({
      where: { level: "ad" },
      select: { entityId: true, date: true, spend: true, purchases: true },
    }),
  ]);

  const adToCreative = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const a of assets) {
    const k = familyKey(a);
    for (const id of a.adIds) adToCreative.set(id, k);
    if (!nameOf.has(k)) nameOf.set(k, a.name);
  }

  // Bucket into weeks, dropping today: it is the only day that under-reports.
  const today = new Date().toISOString().slice(0, 10);
  const byWeek = new Map<string, Map<string, { spend: number; purchases: number }>>();
  let maxDate = "";
  for (const row of daily) {
    const day = row.date.toISOString().slice(0, 10);
    if (day >= today) continue;
    if (day > maxDate) maxDate = day;
    const k = adToCreative.get(row.entityId);
    if (!k) continue;
    const w = weekOf(row.date);
    const week = byWeek.get(w) ?? new Map();
    const cur = week.get(k) ?? { spend: 0, purchases: 0 };
    cur.spend += Number(row.spend);
    cur.purchases += row.purchases;
    week.set(k, cur);
    byWeek.set(w, week);
  }

  const weeks = [...byWeek.keys()].sort();
  // A week is complete only when its Sunday is behind the newest day held.
  const complete = weeks.filter((w) => {
    const sunday = new Date(`${w}T00:00:00Z`);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return sunday.toISOString().slice(0, 10) <= maxDate;
  });

  // "Started" means first material week ever, so this walks every week held,
  // not just the complete ones — otherwise a long-running creative would be
  // announced as new.
  const seen = new Set<string>();
  const firstWeek = weeks[0];
  for (const [k, c] of byWeek.get(firstWeek) ?? []) if (c.spend >= MATERIAL_SPEND) seen.add(k);

  const byType: Record<EventType, number> = { started: 0, stopped: 0, dearer: 0, cheaper: 0 };
  let events = 0;
  let processed = 0;

  for (let i = 1; i < weeks.length; i++) {
    const w = weeks[i];
    const cur = byWeek.get(w)!;
    const prev = byWeek.get(weeks[i - 1])!;

    if (!complete.includes(w)) {
      for (const [k, c] of cur) if (c.spend >= MATERIAL_SPEND) seen.add(k);
      continue;
    }

    const found: DetectedEvent[] = [];
    const push = (type: EventType, k: string, spend: number, detail: Record<string, number> | null) =>
      found.push({ key: `${w}|${type}|${k}`, weekOf: new Date(`${w}T00:00:00Z`), type, creativeId: k, name: nameOf.get(k) ?? null, spend, detail });

    for (const [k, c] of cur) {
      if (c.spend < MATERIAL_SPEND) continue;
      // `seen` is still marked at MATERIAL_SPEND below, so a creative that ramps
      // from $300 to $5,000 is not announced late as a "launch" — it simply
      // never qualified as news in the week it was small.
      if (!seen.has(k) && c.spend >= STARTED_SPEND) push("started", k, c.spend, { purchases: c.purchases });
      const p = prev.get(k);
      if (p && p.purchases >= MIN_PURCHASES && c.purchases >= MIN_PURCHASES) {
        const before = p.spend / p.purchases;
        const after = c.spend / c.purchases;
        const detail = { cpaFrom: Number(before.toFixed(2)), cpaTo: Number(after.toFixed(2)), purchases: c.purchases };
        if (after > before * (1 + MATERIAL_MOVE)) push("dearer", k, c.spend, detail);
        else if (after < before * (1 - MATERIAL_MOVE)) push("cheaper", k, c.spend, detail);
      }
    }
    for (const [k, p] of prev) {
      if (p.spend < STOPPED_SPEND) continue;
      if ((cur.get(k)?.spend ?? 0) >= MATERIAL_SPEND) continue;
      push("stopped", k, p.spend, { lastWeekSpend: Number(p.spend.toFixed(2)) });
    }

    for (const [k, c] of cur) if (c.spend >= MATERIAL_SPEND) seen.add(k);

    await db.$transaction([
      db.accountEvent.deleteMany({ where: { weekOf: new Date(`${w}T00:00:00Z`) } }),
      db.accountEvent.createMany({
        data: found.map((e) => ({
          key: e.key, weekOf: e.weekOf, type: e.type, creativeId: e.creativeId,
          name: e.name, spend: e.spend, detail: e.detail ?? undefined,
        })),
        skipDuplicates: true,
      }),
    ]);

    for (const e of found) byType[e.type]++;
    events += found.length;
    processed++;
  }

  return {
    weeksProcessed: processed,
    events,
    byType,
    weeksSkippedIncomplete: weeks.length - 1 - processed,
  };
}

/**
 * The log, newest first, ranked within a week by the spend at stake.
 *
 * `weeks` means weeks. The first version took `weeks * 40` rows instead, so
 * asking for four weeks returned up to 160 rows covering however many weeks
 * that happened to span — a signature that reads as a date range and behaves as
 * a row cap is a bug waiting for its first caller.
 */
export async function recentEvents(weeks = 4) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7);
  const rows = await db.accountEvent.findMany({
    where: { weekOf: { gte: cutoff } },
    orderBy: [{ weekOf: "desc" }, { spend: "desc" }],
  });
  return rows.map((r) => ({ ...r, spend: Number(r.spend) }));
}
