// Tag creatives with the H/R/S principles they use.
//
//   npm run tag:principles -- 5        # five creatives, highest spend first
//   npm run tag:principles             # default 25
//
// Spend-ordered, so an interrupted run has already covered the part of the
// library that carries the money. Re-runnable: anything with `toolsAt` set is
// left alone.
//
// Frames come from the same path the analysis worker uses. Meta serves no
// source for a large part of this library, and that is not a failure here —
// the tagger falls back to transcript-only, which still supports the spoken
// principles (R7 pace, S3 plain words, S6 recommend don't beg) even though it
// cannot support the visual ones (H4 first-frame motion, R3 new framing on
// every cut).

import { db } from "@/lib/db";
import { tagPrinciples } from "@/lib/creative/tools";
import { extractFrames } from "@/lib/creative/analyze";
import { downloadAsset, videoSourceUrl } from "@/lib/creative/ingest";
import { TOOL_NAMES, type ToolId } from "@/lib/reference/creator-brief";

const limit = Number(process.argv[2]) || 25;

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error("ANTHROPIC_API_KEY is not set — refusing to run.");
  process.exit(1);
}

let framed = 0;
let frameless = 0;

const fetchFrames = async (assetId: string): Promise<Buffer[]> => {
  const asset = await db.creativeAsset.findUnique({
    where: { id: assetId },
    select: { assetKey: true, thumbUrl: true },
  });
  if (!asset) return [];
  try {
    const src = await videoSourceUrl(asset.assetKey.replace(/^v:/, ""));
    if (src) {
      const frames = await extractFrames(await downloadAsset(src));
      framed++;
      return frames;
    }
  } catch {
    // fall through to the thumbnail
  }
  if (asset.thumbUrl) {
    try {
      frameless++;
      return [await downloadAsset(asset.thumbUrl)];
    } catch {
      /* transcript only */
    }
  }
  frameless++;
  return [];
};

const t0 = Date.now();
const run = await tagPrinciples(limit, fetchFrames);
const secs = ((Date.now() - t0) / 1000).toFixed(0);

console.log(
  `\nattempted ${run.attempted} · tagged ${run.tagged} · failed ${run.failed} · ` +
    `skipped for no transcript ${run.skipped}  (${secs}s)`,
);
console.log(`frames available ${framed} · transcript-only or thumbnail ${frameless}`);

// What the tagging actually found, and how much spend it now describes.
const tagged = await db.creativeAnalysis.findMany({
  where: { toolsAt: { not: null } },
  select: { assetId: true, tools: true, asset: { select: { name: true, adIds: true } } },
});

const spend = await db.metaInsightDaily.groupBy({
  by: ["entityId"],
  where: { level: "ad" },
  _sum: { spend: true },
});
const spendByAd = new Map(spend.map((s) => [s.entityId, Number(s._sum.spend ?? 0)]));
const spendOf = (ids: string[]) => ids.reduce((a, id) => a + (spendByAd.get(id) ?? 0), 0);
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

const counts = new Map<string, { n: number; spend: number }>();
for (const t of tagged) {
  const s = spendOf(t.asset?.adIds ?? []);
  for (const id of t.tools) {
    const c = counts.get(id) ?? { n: 0, spend: 0 };
    c.n++;
    c.spend += s;
    counts.set(id, c);
  }
}

console.log(`\ncreatives tagged so far: ${tagged.length} · ${money(tagged.reduce((a, t) => a + spendOf(t.asset?.adIds ?? []), 0))}`);
console.log(`tags per creative: ${(tagged.reduce((a, t) => a + t.tools.length, 0) / Math.max(tagged.length, 1)).toFixed(1)} average\n`);
console.log(`  principle                              creatives      spend`);
for (const [id, c] of [...counts.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 15)) {
  const label = `${id} ${TOOL_NAMES[id as ToolId] ?? ""}`;
  console.log(`  ${label.slice(0, 38).padEnd(38)} ${String(c.n).padStart(7)} ${money(c.spend).padStart(11)}`);
}

const unused = (Object.keys(TOOL_NAMES) as ToolId[]).filter((id) => !counts.has(id));
console.log(`\nprinciples nothing uses yet: ${unused.length ? unused.join(", ") : "none"}`);
console.log(`  (an unused principle is a gap worth briefing, not a bug)`);

await db.$disconnect();
