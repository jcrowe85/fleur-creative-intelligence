// Bulk reference ingest — pull thousands of durable hair-care video ads.
//
// Walks many pages, dedupes variants of the same creative (collationId) so we
// don't pay to classify 900 copies of one ad, mirrors + classifies with bounded
// concurrency, and saves everything. Idempotent: already-ingested ads refresh
// metrics but skip the paid mirror/classify steps, so it's safe to grow the
// corpus incrementally and safe to re-run after an interruption.
//
//   npm run reference:bulk                 # 10 pages, concurrency 5, by reach
//   npm run reference:bulk -- 30 6         # 30 pages, concurrency 6
//   npm run reference:bulk -- 30 6 longestRunning   # diversify the sort
//
// Cost: ~$0.03 per NEWLY classified video + 1 TrendTrack credit per row pulled.

import { ingestReferenceBulk } from "../src/lib/reference/ingest";

const pages = Math.max(1, Number(process.argv[2] ?? 10));
const concurrency = Math.max(1, Math.min(10, Number(process.argv[3] ?? 5)));
const sortBy = process.argv[4] || "reach";
const minDaysRunning = process.argv[5] ? Number(process.argv[5]) : undefined;
const startPage = process.argv[6] ? Number(process.argv[6]) : undefined;

async function main() {
  console.log(`Bulk ingest — up to ${pages} pages × 100, concurrency ${concurrency}, sort=${sortBy}\n`);
  const t0 = Date.now();

  const summary = await ingestReferenceBulk({
    pages,
    startPage,
    perPage: 100,
    concurrency,
    sortBy,
    minDaysRunning,
    onProgress: (done, total, r) => {
      const tag = r.error ? `FAIL(${r.error.slice(0, 30)})` : r.freshAnalysis ? "NEW" : "cached";
      if (done % 10 === 0 || r.freshAnalysis || r.error) {
        console.log(`  [${done}/${total}] ${tag.padEnd(8)} ${r.brand}${r.freshAnalysis ? ` → ${r.pillar}/${r.format}` : ""}`);
      }
    },
  });

  const fresh = summary.results.filter((r) => r.freshAnalysis);
  const cached = summary.results.filter((r) => r.analyzed && !r.freshAnalysis);
  const failed = summary.results.filter((r) => r.error);
  const mins = ((Date.now() - t0) / 60000).toFixed(1);

  const spread = new Map<string, number>();
  for (const r of summary.results) if (r.analyzed && r.pillar) spread.set(r.pillar, (spread.get(r.pillar) ?? 0) + 1);

  console.log("\n" + "=".repeat(60));
  console.log(`Creatives after dedupe: ${summary.returned}`);
  console.log(`  newly classified: ${fresh.length}   already had: ${cached.length}   failed: ${failed.length}`);
  console.log(`  est. classify spend this run: ~$${(fresh.length * 0.03).toFixed(2)}`);
  console.log(`  credits remaining: ${summary.creditsRemaining ?? "?"}   time: ${mins} min`);
  console.log("\nPillar spread (this batch):");
  [...spread.entries()].sort((a, b) => b[1] - a[1]).forEach(([p, c]) => console.log(`  ${p.padEnd(22)} ${c}`));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
