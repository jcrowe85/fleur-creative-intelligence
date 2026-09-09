// One-time data lift: fleur-financials → fleur-creative.
//
// Copies the creative tables (and the Meta rows they reference) out of the
// financials database into this app's own. Run once, after the new database has
// been migrated and before the tables are dropped from financials — there are
// hours of classification and real API spend in CreativeAnalysis.
//
//   SOURCE_DATABASE_URL=<financials DIRECT_URL> npm run import:financials
//
// Idempotent: every write is an upsert keyed on the natural key, so a partial
// run can simply be repeated. Reads only; it never writes to the source.

import { PrismaClient } from "@prisma/client";

const sourceUrl = process.env.SOURCE_DATABASE_URL?.trim();
if (!sourceUrl) {
  console.error("SOURCE_DATABASE_URL is required (the financials DIRECT_URL).");
  process.exit(1);
}
if (sourceUrl === process.env.DATABASE_URL || sourceUrl === process.env.DIRECT_URL) {
  console.error("SOURCE_DATABASE_URL must differ from this app's database.");
  process.exit(1);
}

const src = new PrismaClient({ datasourceUrl: sourceUrl, log: ["error"] });
const dst = new PrismaClient({ log: ["error"] });

const chunk = <T,>(xs: T[], n: number): T[][] =>
  xs.reduce<T[][]>((acc, x, i) => (i % n ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);

async function main() {
  // ── Meta entities ──
  const entities = await src.metaEntity.findMany();
  for (const batch of chunk(entities, 500)) {
    await dst.metaEntity.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`MetaEntity        ${entities.length}`);

  // ── Meta insights ──
  const insights = await src.metaInsightDaily.findMany();
  for (const batch of chunk(insights, 500)) {
    await dst.metaInsightDaily.createMany({ data: batch, skipDuplicates: true });
  }
  console.log(`MetaInsightDaily  ${insights.length}`);

  // ── Creative assets, with their analyses ──
  const assets = await src.creativeAsset.findMany({ include: { analysis: true } });
  let withAnalysis = 0;
  for (const a of assets) {
    const { analysis, ...asset } = a;
    await dst.creativeAsset.upsert({
      where: { assetKey: asset.assetKey },
      update: asset,
      create: asset,
    });
    if (analysis) {
      // assetId is a cuid from the source row and is carried across, so the
      // relation stays intact without a lookup.
      await dst.creativeAnalysis.upsert({
        where: { assetId: analysis.assetId },
        update: analysis,
        create: analysis,
      });
      withAnalysis++;
    }
  }
  console.log(`CreativeAsset     ${assets.length}  (${withAnalysis} classified)`);

  // Deliberately not copied: CreativeRun (a live job handle, meaningless here),
  // User and Session (this app has its own accounts), and every financial
  // table — none of which exist in this schema.
  const check = await dst.creativeAnalysis.count();
  console.log(`\nverify: ${check} analyses now in fleur-creative`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await src.$disconnect();
    await dst.$disconnect();
  });
