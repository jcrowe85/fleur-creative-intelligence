"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { labelFor } from "@/lib/creative/taxonomy";
import type { Portfolio } from "@/lib/creative/portfolio";
import type { CampaignCreative } from "@/lib/creative/campaigns";

interface RunState {
  status: string;
  processed: number;
  failed: number;
  analyzed: number;
  pending: number;
  abandoned: number;
  total: number;
  startedAt: string | null;
  lastError: string | null;
  stale: boolean;
}

// ── Types mirroring /api/creative/portfolio ───────────────────────────────────

interface CoverageRow {
  id: string;
  label: string;
  assets: number;
  assetShare: number;
  spend: number;
  spendShare: number;
  purchases: number;
  cpa: number | null;
  roas: number | null;
  strategicPriority?: boolean;
}
interface AxisCoverage {
  axis: string;
  rows: CoverageRow[];
  evenness: number;
  missing: { id: string; label: string }[];
}

const money = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

// ── Small presentational pieces ───────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1.5 text-2xl font-semibold tabular-nums " +
          (tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "")
        }
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Horizontal share bar. Encodes asset count and spend share together so an
 *  over-funded pillar with few assets is visible at a glance. */
function CoverageBar({ row, max }: { row: CoverageRow; max: number }) {
  const w = max > 0 ? (row.assets / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[minmax(170px,1.2fr)_1fr_auto] items-center gap-3 py-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="truncate text-base">{row.label}</span>
        {row.strategicPriority ? (
          <span
            title="A pillar Fleur can uniquely own"
            className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-400"
          >
            key
          </span>
        ) : null}
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={
            "h-full rounded-full " + (row.assets === 0 ? "bg-red-500/40" : "bg-sky-500/70")
          }
          style={{ width: `${Math.max(w, row.assets > 0 ? 3 : 0)}%` }}
        />
      </div>
      <div className="flex items-center gap-3 text-sm tabular-nums text-muted-foreground">
        <span className="w-8 text-right">{row.assets}</span>
        <span className="w-12 text-right">{row.spend > 0 ? money(row.spend) : "—"}</span>
        <span className="w-12 text-right">
          {row.cpa != null ? `$${row.cpa.toFixed(0)}` : "—"}
        </span>
      </div>
    </div>
  );
}

function AxisPanel({ title, cov }: { title: string; cov: AxisCoverage }) {
  const max = Math.max(1, ...cov.rows.map((r) => r.assets));
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="text-xs text-muted-foreground">
            evenness {cov.evenness.toFixed(2)} · {cov.missing.length} unused
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[minmax(170px,1.2fr)_1fr_auto] gap-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
          <span />
          <span />
          <span className="flex gap-3">
            <span className="w-8 text-right">ads</span>
            <span className="w-12 text-right">spend</span>
            <span className="w-12 text-right">cpa</span>
          </span>
        </div>
        {cov.rows.map((r) => (
          <CoverageBar key={r.id} row={r} max={max} />
        ))}
      </CardContent>
    </Card>
  );
}

const GRADE_TONE: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-400",
  B: "bg-sky-500/15 text-sky-400",
  C: "bg-amber-500/15 text-amber-400",
  D: "bg-orange-500/15 text-orange-400",
  F: "bg-red-500/15 text-red-400",
};

function CampaignPanel({
  rows,
  liveOnly,
  onToggle,
}: {
  rows: CampaignCreative[];
  liveOnly: boolean;
  onToggle: () => void;
}) {
  const shown = liveOnly ? rows.filter((r) => r.live) : rows;
  const liveCount = rows.filter((r) => r.live).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <CardTitle className="text-base">Diversity by campaign</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              The score is <strong>how much of the taxonomy is actually in play</strong>,
              averaged over four axes. Using 8 of 20 pillars evenly scores 40% on that axis;
              leaning on two of them scores less. It is not a measure of balance among the
              pillars you already use — that flattered campaigns missing most of the list.
            </p>
          </div>
          <button
            onClick={onToggle}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
          >
            {liveOnly ? `Live only (${liveCount})` : `All (${rows.length})`}
          </button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[1180px] text-base">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5">Campaign</th>
              <th className="px-2 py-2.5">Diversity</th>
              <th className="px-2 py-2.5">Coverage of each axis</th>
              <th className="px-2 py-2.5">Most concentrated</th>
              <th className="px-2 py-2.5 text-right">Spend</th>
              <th className="px-2 py-2.5 text-right">CPM</th>
              <th className="px-2 py-2.5 text-right">CPC</th>
              <th className="px-2 py-2.5 text-right">CAC</th>
              <th className="px-4 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.campaignId} className="border-b border-border/60 last:border-0">
                <td className="max-w-[320px] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      title={r.effectiveStatus}
                      className={
                        "size-1.5 shrink-0 rounded-full " +
                        (r.live ? "bg-emerald-400" : "bg-muted-foreground/40")
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{r.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {r.assets} creatives · {r.territories} territories
                        {r.unclassified > 0 ? ` · ${r.unclassified} pending` : ""}
                        {r.dailyBudget ? ` · $${r.dailyBudget.toFixed(0)}/day` : ""}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "rounded px-2 py-1 text-xs font-semibold uppercase " +
                        (GRADE_TONE[r.grade] ?? "bg-muted text-muted-foreground")
                      }
                    >
                      {r.grade}
                    </span>
                    {r.grade.length === 1 ? (
                      <span
                        className="text-sm tabular-nums text-muted-foreground"
                        title="Share of the taxonomy in play, averaged over the four axes"
                      >
                        {r.diversity}%
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="flex flex-col gap-1">
                    {(
                      [
                        ["Pillars", r.coverage.pillar, r.evennessByAxis.pillar],
                        ["Personas", r.coverage.persona, r.evennessByAxis.persona],
                        ["Hooks", r.coverage.hook, r.evennessByAxis.hook],
                        ["Formats", r.coverage.format, r.evennessByAxis.format],
                      ] as const
                    ).map(([label, [used, total], score]) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-muted-foreground">
                          {label}
                        </span>
                        <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                          <span
                            className={
                              "block h-full rounded-full " +
                              (score < 0.2 ? "bg-red-400" : score < 0.35 ? "bg-amber-400" : "bg-emerald-400")
                            }
                            style={{ width: `${Math.max(score * 100, 2)}%` }}
                          />
                        </span>
                        <span
                          className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground"
                          title={`${used} of ${total} used, weighted for how evenly`}
                        >
                          {used}/{total}
                        </span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="max-w-[210px] px-2 py-3 text-sm">
                  {r.dominant ? (
                    <span
                      className={
                        r.dominant.share >= 0.8 ? "text-amber-400" : "text-muted-foreground"
                      }
                    >
                      {r.dominant.label} {(r.dominant.share * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-3 text-right text-sm tabular-nums">
                  {r.spend > 0 ? money(r.spend) : "—"}
                </td>
                <td className="px-2 py-3 text-right text-sm tabular-nums">
                  {r.cpm ? `$${r.cpm.toFixed(0)}` : "—"}
                </td>
                <td className="px-2 py-3 text-right text-sm tabular-nums">
                  {r.cpc ? `$${r.cpc.toFixed(2)}` : "—"}
                </td>
                <td className="px-2 py-3 text-right text-sm tabular-nums">
                  {r.cac ? `$${r.cac.toFixed(0)}` : "—"}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums">
                  <span className={r.roas && r.roas >= 1 ? "text-emerald-400" : ""}>
                    {r.roas ? r.roas.toFixed(2) : "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────


export default function CreativeClient({
  initial,
  initialRun,
  initialCampaigns,
}: {
  initial: Portfolio;
  initialRun: RunState | null;
  initialCampaigns: CampaignCreative[];
}) {
  const [data, setData] = useState<Portfolio>(initial);
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"campaigns" | "coverage" | "gaps" | "redundancy" | "assets">("campaigns");
  const [run, setRun] = useState<RunState | null>(initialRun);
  const [camps, setCamps] = useState<CampaignCreative[]>(initialCampaigns);
  const [liveOnly, setLiveOnly] = useState(true);
  const lastAnalyzed = useRef(initialRun?.analyzed ?? 0);

  // First paint is server-rendered; this only refreshes after a mutation.
  const load = useCallback(async () => {
    const r = await fetch("/api/creative/portfolio");
    // Nothing surfaces an error here any more; the next poll simply retries.
    if (!r.ok) return;
    const next = (await r.json()) as Portfolio;
    startTransition(() => setData(next));
  }, []);

  // Poll while a run is live. Subscribing to server state is what effects are
  // for; the setState here happens in the interval callback, not the body.
  useEffect(() => {
    // Poll slowly when idle and quickly while working. The idle poll is what
    // makes a cron-started run appear without anyone pressing anything.
    const period = run?.status === "running" ? 5000 : 60000;
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/creative/analyze");
        if (!r.ok) return;
        const next = (await r.json()) as RunState;
        setRun(next);
        // Refresh the portfolio as new results land, but not on every tick.
        if (next.analyzed - lastAnalyzed.current >= 10 || next.status !== "running") {
          lastAnalyzed.current = next.analyzed;
          void load();
        }
      } catch {
        /* transient — the next tick retries */
      }
    }, period);
    return () => clearInterval(id);
  }, [run?.status, load]);

  // Refreshes when the tab is opened, so newly-classified assets show up.
  const loadCampaigns = useCallback(async () => {
    const r = await fetch("/api/creative/campaigns");
    if (r.ok) setCamps(((await r.json()) as { campaigns: CampaignCreative[] }).campaigns);
  }, []);

  const running = run?.status === "running";
  const pending = run?.pending ?? data.counts.pending;
  // 41s/asset measured across the first 233; good enough to set expectations.
  const eta =
    running && pending > 0
      ? pending * 41 > 5400
        ? `${(pending * 41 / 3600).toFixed(1)}h`
        : `${Math.max(1, Math.round((pending * 41) / 60))}m`
      : null;
  const s = data.summary;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Creative Intelligence</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Every video and image in the ad account, classified by pillar, persona, hook and funnel
          stage, so you can see which creative territories are occupied and which are empty. New
          creative is discovered and analysed automatically. Andromeda picks candidates out of a
          hierarchical index — near-duplicate ads land in the same region and compete with each
          other, so coverage is what buys reach, not volume.
        </p>
      </header>

      {/* Shown only while work is actually happening. Discovery and analysis
          are driven by cron now, so this appears on its own when new creative
          lands and disappears when the queue drains. */}
      {run && running ? (
        <div className="mb-6 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {run.stale
                ? "Analysis stalled — no progress for 10 minutes"
                : "Analysing new creative"}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {run.analyzed.toLocaleString()} of {run.total.toLocaleString()} assets
              {run.failed > 0 ? ` · ${run.failed} failed` : ""}
              {run.abandoned > 0 ? ` · ${run.abandoned} given up on` : ""}
              {eta ? ` · ~${eta} left` : ""}
            </span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={
                "h-full rounded-full transition-[width] duration-500 " +
                (run.stale ? "bg-amber-500" : running ? "bg-sky-500" : "bg-emerald-500")
              }
              style={{ width: `${run.total ? (run.analyzed / run.total) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Runs on the server — nothing to keep open.
          </p>
        </div>
      ) : null}

      {data.counts.analyzed === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing analysed yet. New creative is picked up automatically each morning.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Assets" value={String(s!.assets)} sub={`${data.counts.pending} pending`} />
            <Stat
              label="Territories"
              value={String(s!.territoriesOccupied)}
              sub={`of ${s!.territorySpaceSize.toLocaleString()} possible`}
            />
            <Stat
              label="Pillar evenness"
              value={s!.evennessByAxis.pillar.toFixed(2)}
              sub="1.0 = perfectly spread"
              tone={s!.evennessByAxis.pillar < 0.6 ? "bad" : "good"}
            />
            <Stat
              label="Persona evenness"
              value={s!.evennessByAxis.persona.toFixed(2)}
              sub="1.0 = perfectly spread"
              tone={s!.evennessByAxis.persona < 0.6 ? "bad" : "good"}
            />
            <Stat
              label="Duplicate spend"
              value={money(s!.duplicateSpend)}
              sub={`${pct(s!.totalSpend ? s!.duplicateSpend / s!.totalSpend : 0)} of total`}
              tone={s!.duplicateSpend / Math.max(1, s!.totalSpend) > 0.3 ? "bad" : undefined}
            />
            <Stat
              label="Compliance flags"
              value={String(s!.complianceFlagged)}
              tone={s!.complianceFlagged > 0 ? "bad" : "good"}
            />
          </div>

          <div className="mb-4 flex gap-1 border-b border-border">
            {(
              [
                ["campaigns", "Campaigns"],
                ["coverage", "Coverage"],
                ["gaps", `Gaps (${data.gaps.length})`],
                ["redundancy", `Redundancy (${data.redundancy.length})`],
                ["assets", `Assets (${data.assets.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  if (key === "campaigns") void loadCampaigns();
                }}
                className={
                  "px-3 py-2 text-sm font-medium transition-colors " +
                  (tab === key
                    ? "border-b-2 border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "campaigns" ? (
            <CampaignPanel
              rows={camps}
              liveOnly={liveOnly}
              onToggle={() => setLiveOnly((v) => !v)}
            />
          ) : null}

          {tab === "coverage" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <AxisPanel title="Content pillar" cov={data.coverage.pillar} />
              <AxisPanel title="Persona" cov={data.coverage.persona} />
              <AxisPanel title="Hook type" cov={data.coverage.hook} />
              <AxisPanel title="Funnel stage" cov={data.coverage.funnel} />
            </div>
          ) : null}

          {tab === "gaps" ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Unoccupied territory worth briefing</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Ranked by strategic pillar, whether the persona already converts, and how thin
                  that funnel stage is. Hook is left out on purpose — it is the cheapest axis to
                  vary once the brief exists.
                </p>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {data.gaps.map((g, i) => (
                  <div key={g.label} className="flex items-baseline gap-3 py-2.5">
                    <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{g.label}</div>
                      <div className="text-sm text-muted-foreground">{g.reason}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {tab === "redundancy" ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Territories with more than one asset</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Same pillar, persona, hook and funnel stage. These compete with each other in
                  retrieval rather than widening reach.
                </p>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {data.redundancy.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">
                    No territory holds more than two assets. Good.
                  </p>
                ) : (
                  data.redundancy.map((r) => (
                    <div key={r.label} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm">{r.label}</span>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                          {r.assets} assets · {money(r.duplicateSpend)} on duplicates
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm text-muted-foreground">
                        {r.names.join(" · ")}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}

          {tab === "assets" ? (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[980px] text-base">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2.5">Asset</th>
                      <th className="px-3 py-2.5">Pillar</th>
                      <th className="px-3 py-2.5">Persona</th>
                      <th className="px-3 py-2.5">Hook</th>
                      <th className="px-3 py-2.5">Stage</th>
                      <th className="px-3 py-2.5 text-right">Spend</th>
                      <th className="px-3 py-2.5 text-right">CPA</th>
                      <th className="px-4 py-2.5 text-right">Diff.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.assets.map((a) => {
                      const cpa =
                        a.purchases && a.purchases > 0 ? (a.spend ?? 0) / a.purchases : null;
                      return (
                        <tr key={a.id} className="border-b border-border/60 last:border-0">
                          <td className="max-w-[300px] px-4 py-3">
                            <div className="flex items-center gap-2">
                              {a.thumbUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={a.thumbUrl}
                                  alt=""
                                  className="size-11 shrink-0 rounded object-cover"
                                />
                              ) : (
                                <span className="size-11 shrink-0 rounded bg-muted" />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate">{a.name}</span>
                                <span className="block truncate text-sm text-muted-foreground">
                                  {a.hookText || a.critique || `${a.adCount} ads`}
                                </span>
                              </span>
                              {a.lowConfidence ? (
                                <span
                                  title="Classifier was unsure — worth a human check"
                                  className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase text-amber-400"
                                >
                                  ?
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-sm">{labelFor("pillar", a.pillar)}</td>
                          <td className="px-3 py-3 text-sm">{labelFor("persona", a.persona)}</td>
                          <td className="px-3 py-3 text-sm">{labelFor("hook", a.hook)}</td>
                          <td className="px-3 py-3 text-sm">{a.funnel}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-sm">
                            {a.spend ? money(a.spend) : "—"}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-sm">
                            {cpa ? `$${cpa.toFixed(0)}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-sm">
                            {a.scores.differentiation}/5
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {data.compliance.length > 0 ? (
            <Card className="mt-6 border-red-500/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-400">Compliance flags</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {data.compliance.map((c) => (
                  <div key={c.id} className="py-2.5">
                    <div className="text-sm">{c.name}</div>
                    <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                      {c.flags.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
