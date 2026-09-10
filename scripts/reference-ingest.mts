// Persistent reference-library ingest.
//
// Pulls durable, high-reach hair-care video ads from TrendTrack, mirrors each
// video into our Supabase bucket, classifies it, and SAVES everything to the
// ReferenceAsset / ReferenceAnalysis tables. Unlike the throwaway spike, this is
// the real pipeline — the data and the playable video URLs persist.
//
//   npm run reference:ingest            # 25 ads
//   npm run reference:ingest -- 50      # 50 ads
//   npm run reference:ingest -- 25 "thinning"   # bias intake with an adCopy search
//
// Idempotent: re-running refreshes metrics and fills in any missing mirror /
// analysis without re-charging for work already done.

import { ingestReference } from "../src/lib/reference/ingest";

const N = Math.max(1, Math.min(100, Number(process.argv[2] ?? 25)));
const SEARCH = process.argv[3];

const pct = (n?: number) => (n == null ? "—" : `${Math.round(n * 100)}%`);

async function main() {
  console.log(`Reference ingest — ${N} durable hair-care video ads${SEARCH ? ` (search="${SEARCH}")` : ""}\n`);

  const summary = await ingestReference({ limit: N, search: SEARCH });

  console.log(
    `TrendTrack returned ${summary.returned} ads · credits cost=${summary.creditsCost ?? "?"} remaining=${summary.creditsRemaining ?? "?"}\n`,
  );

  for (const [i, r] of summary.results.entries()) {
    const tag = r.error ? `FAILED: ${r.error}` : `${r.mirrored ? "mirrored" : "—"} · ${r.analyzed ? "classified" : "—"}`;
    console.log(`[${i + 1}/${summary.results.length}] ${r.brand}  (${r.daysRunning ?? "?"}d, reach ${(r.reach ?? 0).toLocaleString()}, ${r.variants ?? "?"} variants)  ${tag}`);
    if (r.analyzed) {
      console.log(`        pillar=${r.pillar}(${pct(r.pillarConf)})  persona=${r.persona}  hook=${r.hook}  funnel=${r.funnel}  format=${r.format}`);
    }
  }

  const done = summary.results.filter((r) => r.analyzed);
  const failed = summary.results.filter((r) => r.error);

  // Pillar spread across what we classified — are they landing in varied
  // territory, or collapsing into one cell?
  const byPillar = new Map<string, number>();
  for (const r of done) byPillar.set(r.pillar!, (byPillar.get(r.pillar!) ?? 0) + 1);

  console.log("\nPillar spread:");
  [...byPillar.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, c]) => console.log(`  ${p.padEnd(24)} ${c}`));

  console.log(`\nClassified & saved ${done.length}, failed ${failed.length}, of ${summary.returned} returned.`);
  console.log("Data is in ReferenceAsset / ReferenceAnalysis; videos mirrored to Supabase Storage.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
