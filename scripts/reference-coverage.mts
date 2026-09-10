// Pre-UI sanity check: for Fleur's real ranked gaps, how many playable
// reference examples does the corpus hold, and what's the best one?
//
// A gap with zero matches is a swipe deck with nothing in it — this tells us
// where the intake needs to reach (a persona-targeted pull, a deeper sweep)
// before the swipe screen is worth building.
//
//   npm run reference:coverage           # top 25 gaps
//   npm run reference:coverage -- 40     # top 40

import { buildPortfolio } from "../src/lib/creative/portfolio";
import { gapCoverage } from "../src/lib/reference/lookup";

const N = Math.max(1, Math.min(100, Number(process.argv[2] ?? 25)));

async function main() {
  const portfolio = await buildPortfolio();
  const gaps = portfolio.gaps.slice(0, N);
  console.log(`Fleur has ${portfolio.gaps.length} ranked gaps; checking the top ${gaps.length} against the reference corpus.\n`);

  const coverage = await gapCoverage(gaps);

  const withAny = coverage.filter((c) => c.total > 0).length;
  const empty = coverage.filter((c) => c.total === 0);

  console.log("GAP  (pillar × persona × funnel)".padEnd(52) + "matches   best example");
  console.log("=".repeat(96));
  for (const c of coverage) {
    const best = c.top
      ? `${c.top.brand} · ${c.top.daysRunning ?? "?"}d · ${(c.top.reach ?? 0).toLocaleString()} reach · ${c.top.matchTier}`
      : "—";
    const counts = `${c.total} (P+p:${c.pillarPersona} P+f:${c.pillarFunnel})`;
    console.log(`${c.gap.label.slice(0, 50).padEnd(52)}${counts.padEnd(10)}${best}`);
  }

  console.log("\n" + "=".repeat(96));
  console.log(`${withAny}/${coverage.length} gaps have at least one playable example.`);
  if (empty.length) {
    console.log(`\n${empty.length} gaps with NO example (intake needs to reach these):`);
    for (const c of empty.slice(0, 20)) console.log(`  · ${c.gap.label}   [${c.gap.reason}]`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
