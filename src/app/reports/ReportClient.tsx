"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labelFor } from "@/lib/creative/taxonomy";
import type { Report } from "@/lib/creative/report";

const money = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;

const AXES = ["pillar", "persona", "hook", "funnel", "format", "production"] as const;
type Axis = (typeof AXES)[number];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Colour carries the verdict, but never alone — the word is always present. */
const VERDICT_TONE: Record<string, string> = {
  beats: "bg-emerald-500/15 text-emerald-400",
  matches: "bg-sky-500/15 text-sky-400",
  loses: "bg-red-500/15 text-red-400",
  no_sales: "bg-orange-500/15 text-orange-400",
  too_small: "bg-muted text-muted-foreground",
};
const VERDICT_WORD: Record<string, string> = {
  beats: "beats", matches: "matches", loses: "loses",
  no_sales: "no sales", too_small: "too small",
};

const STATUS_NOTE: Record<string, string> = {
  pattern: "Enough creatives and purchases to read as a pattern.",
  one_creative: "One creative is more than half this term's spend — this is an advert, not a category.",
  too_thin: "Fewer than 25 purchases. Not enough to compare.",
};

export default function ReportClient({ report }: { report: Report }) {
  const [axis, setAxis] = useState<Axis>("hook");
  const [showAll, setShowAll] = useState(false);

  const terms = report.signals[axis];
  const patterns = terms.filter((t) => t.status === "pattern");
  const oneAd = terms.filter((t) => t.status === "one_creative");
  const thin = terms.filter((t) => t.status === "too_thin");
  const shown = showAll ? terms : patterns;

  const bench = report.benchmark.cpa;
  const top = report.creatives.slice(0, 25);
  const topShare = report.benchmark.top25Share;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">What works</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every comparison below is gated: a term needs 25 purchases before it can be
          ranked, and if one creative carries more than half its spend it is called an
          advert rather than a category. Volume leads because CPA is the axis Meta&apos;s
          optimiser flattens — across this account CPA varies 1.5x while spend per
          creative varies 11x.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Benchmark CPA"
          value={bench ? `$${bench.toFixed(0)}` : "—"}
          sub={`${report.benchmark.purchases.toLocaleString()} purchases`}
        />
        <Stat
          label="Creative spend"
          value={money(report.benchmark.spend)}
          sub={`${report.benchmark.creatives} creatives with delivery`}
        />
        <Stat
          label="Top 25 creatives"
          value={`${(topShare * 100).toFixed(0)}%`}
          sub="of all creative spend"
        />
        <Stat
          label="Unattributed"
          value={money(report.account.unattributedSpend)}
          sub="spend on ads with no creative"
        />
        <Stat
          label="Getting dearer"
          value={`${report.trends.filter((t) => t.change > 0.2).length} of ${report.trends.length}`}
          sub="CPA up >20% since launch"
        />
      </div>

      {topShare > 0.5 ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-300/90">
          {(topShare * 100).toFixed(0)}% of spend sits in 25 creatives. Averages across the
          whole library describe creatives that barely ran — read the individual rows below.
        </p>
      ) : null}

      {report.quality.ungroundedCreatives > 0 ? (
        <p className="mt-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <span className="text-foreground">
            {report.quality.ungroundedCreatives} creatives carrying{" "}
            {money(report.quality.ungroundedSpend)}
          </span>{" "}
          were classified from still frames and ad copy — the model never heard them. Against{" "}
          {report.quality.groundedCreatives} classified with a transcript (
          {money(report.quality.groundedSpend)}). Terms resting mostly on the first group are
          softer than the numbers make them look.
          {report.quality.copiedClassifications > 0 ? (
            <>
              {" "}
              {report.quality.copiedClassifications === 1
                ? "One classification in the library was copied"
                : `${report.quality.copiedClassifications} classifications in the library were copied`}{" "}
              from a re-upload rather than generated afresh. The rows above fold re-uploads
              together, so that is a saved model call rather than a double count.
            </>
          ) : null}
        </p>
      ) : null}

      {/* ── What changed ────────────────────────────────────────────────── */}
      {report.events.length > 0 ? (
        <Card className="mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What changed</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Computed from delivery, complete weeks only, ranked by the spend at stake.
              Leaderboard reshuffles and launches under $1,000 are left out deliberately — a
              fixed list evicts one creative for every one it admits, and a creative spending
              $200 in its first week is a test, not news.
            </p>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {report.events.slice(0, 12).map((e) => {
              const tone =
                e.type === "dearer"
                  ? "bg-red-500/15 text-red-400"
                  : e.type === "cheaper"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : e.type === "started"
                      ? "bg-sky-500/15 text-sky-400"
                      : "bg-muted text-muted-foreground";
              const word =
                e.type === "dearer"
                  ? "costlier"
                  : e.type === "cheaper"
                    ? "cheaper"
                    : e.type === "started"
                      ? "launched"
                      : "stopped";
              return (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-20 shrink-0 tabular-nums text-xs text-muted-foreground">
                    {e.week}
                  </span>
                  <span
                    className={
                      "w-[72px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide " +
                      tone
                    }
                  >
                    {word}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.name ?? e.creativeId}</span>
                  {e.detail?.cpaFrom != null && e.detail?.cpaTo != null ? (
                    <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                      ${e.detail.cpaFrom.toFixed(0)} → ${e.detail.cpaTo.toFixed(0)}
                    </span>
                  ) : null}
                  <span className="w-16 shrink-0 text-right tabular-nums text-sm">
                    {money(e.spend)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ── What works, by axis ─────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">By {axis}</CardTitle>
            <div className="flex flex-wrap items-center gap-1">
              {AXES.map((a) => (
                <button
                  key={a}
                  onClick={() => setAxis(a)}
                  className={
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                    (a === axis
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {patterns.length} read as patterns · {oneAd.length} are one advert ·{" "}
            {thin.length} too thin to judge
            {terms.length > patterns.length ? (
              <button
                onClick={() => setShowAll((s) => !s)}
                className="ml-2 underline underline-offset-2 hover:text-foreground"
              >
                {showAll ? "show only patterns" : "show everything"}
              </button>
            ) : null}
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-base">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Term</th>
                <th className="px-3 py-2.5 text-right">Creatives</th>
                <th className="px-3 py-2.5 text-right" title="Median spend per day of delivery — age-normalised, so an old creative doesn't win by having had longer.">
                  Median $/day
                </th>
                <th className="px-3 py-2.5 text-right">Spend</th>
                <th className="px-3 py-2.5 text-right">CPA</th>
                <th className="px-3 py-2.5 text-right" title="Share of this term's spend carried by its single biggest creative.">
                  Top-1
                </th>
                <th className="px-4 py-2.5">Reading</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.term} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <span className="block">{labelFor(axis, t.term)}</span>
                    {t.dominantName ? (
                      <span className="block truncate text-sm text-muted-foreground">
                        mostly: {t.dominantName}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">{t.creatives}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">
                    {money(t.medianSpendPerDay)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">{money(t.spend)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">
                    {t.cpa ? `$${t.cpa.toFixed(0)}` : "—"}
                    {t.vsBenchmark != null ? (
                      <span
                        className={
                          "ml-1 text-xs " +
                          (t.vsBenchmark <= -0.15
                            ? "text-emerald-400"
                            : t.vsBenchmark >= 0.15
                              ? "text-red-400"
                              : "text-muted-foreground")
                        }
                      >
                        {signed(t.vsBenchmark)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">
                    {(t.top1Share * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-3">
                    <span
                      title={STATUS_NOTE[t.status]}
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        (t.status === "pattern"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : t.status === "one_creative"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-muted text-muted-foreground")
                      }
                    >
                      {t.status === "one_creative" ? "one advert" : t.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── The creatives that are the account ──────────────────────────── */}
      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">The 25 creatives carrying the account</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {(topShare * 100).toFixed(0)}% of creative spend. Judged individually, against a{" "}
            {bench ? `$${bench.toFixed(0)}` : "—"} benchmark.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-base">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5">Creative</th>
                <th className="px-3 py-2.5 text-right">Spend</th>
                <th className="px-3 py-2.5 text-right">$/day</th>
                <th className="px-3 py-2.5 text-right">Purchases</th>
                <th className="px-3 py-2.5 text-right">CPA</th>
                <th className="px-3 py-2.5 text-right">ROAS</th>
                <th className="px-4 py-2.5">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {top.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="max-w-[340px] truncate px-4 py-3">{c.name}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">{money(c.spend)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">
                    {money(c.spendPerDay)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">{c.purchases}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">
                    {c.cpa ? `$${c.cpa.toFixed(0)}` : "—"}
                    {c.vsBenchmark != null ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {signed(c.vsBenchmark)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm">
                    {c.roas ? `${c.roas.toFixed(1)}x` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                        VERDICT_TONE[c.verdict]
                      }
                    >
                      {VERDICT_WORD[c.verdict]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ── Fatigue ──────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Getting more expensive</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              First 14 days of delivery against the last 14. Only creatives that ran at
              least 28 days appear, so the two windows never overlap — {report.trends.length}{" "}
              qualify.
            </p>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {report.trends.slice(0, 10).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm">{t.name}</span>
                <span className="shrink-0 tabular-nums text-sm">
                  <span className="text-muted-foreground">
                    ${t.earlyCpa.toFixed(0)} → ${t.lateCpa.toFixed(0)}
                  </span>
                  <span className={"ml-2 " + (t.change > 0 ? "text-red-400" : "text-emerald-400")}>
                    {signed(t.change)}
                  </span>
                </span>
              </div>
            ))}
            {report.trends.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No creative has run long enough for a non-overlapping comparison.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* ── Waste ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Where money went without sales</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {report.waste.map((w) => (
              <div key={w.label} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{w.label}</span>
                  <span className="shrink-0 tabular-nums text-sm">
                    {money(w.spend)}
                    <span className="ml-2 text-muted-foreground">{w.creatives} creatives</span>
                  </span>
                </div>
                {w.note ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{w.note}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Built {new Date(report.generatedAt).toLocaleString()} · one row per creative, with
        re-uploads folded together.
      </p>
    </div>
  );
}
