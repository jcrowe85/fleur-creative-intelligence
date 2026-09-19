// Fetch the transcripts that were never captured.
//
//   npm run backfill:transcripts -- 25      # a batch of 25
//   npm run backfill:transcripts            # everything outstanding
//
// 401 analysed video creatives hold no transcript, so they were classified from
// eight still frames and the ad copy alone — about half of all video spend.
//
// This will currently recover none of them, and that is worth recording rather
// than discovering twice. Meta serves no `source` for those videos: probing
// them returns permalink_url, length, status and id with the field simply
// absent. A control run separates perfectly — 12 of 12 videos that DO have a
// transcript return a source, 0 of 12 that don't. The audio was never
// obtainable, so the gap is structural and permanent, not a failure anyone can
// retry. (An earlier estimate that two thirds were fetchable came from sampling
// families whose representative held a short transcript, i.e. videos that HAD
// been sourced — a different population.)
//
// It is kept because the control group proves recently-uploaded videos do serve
// a source, so this correctly fills any future gap, and it no-ops safely today.
//
// Safe to re-run and safe to interrupt: it only ever fills a transcript that is
// missing, and each asset is committed as it completes.

import { db } from "@/lib/db";
import { transcribeVideo } from "@/lib/creative/analyze";
import { downloadAsset, videoSourceUrl } from "@/lib/creative/ingest";

const limit = Number(process.argv[2]) || undefined;
const WORKERS = 4;
/** Below this a "transcript" is a stub, not speech. Matches the report's rule. */
const USABLE = 40;

// Without a key transcribeVideo returns "" for every video, which this script
// would otherwise read as "silent". A full run would then mark all 401 as
// answered and close the gap it exists to fill.
if (!process.env.OPENAI_API_KEY?.trim()) {
  console.error(
    "OPENAI_API_KEY is not set — transcribeVideo returns \"\" without it, so every video\n" +
      "would be recorded as silent. Refusing to run.",
  );
  process.exit(1);
}

const pending = await db.creativeAsset.findMany({
  where: {
    assetType: "video",
    analysis: { isNot: null },
    OR: [{ analysis: { transcript: null } }, { analysis: { transcript: "" } }],
  },
  select: { id: true, assetKey: true, name: true, familyId: true },
  take: limit,
});

console.log(`video creatives with no transcript: ${pending.length}${limit ? ` (limited to ${limit})` : ""}`);

let transcribed = 0;
let silent = 0;
let noSource = 0;
let failed = 0;
let propagated = 0;

const queue = [...pending];
await Promise.all(
  Array.from({ length: WORKERS }, async () => {
    while (queue.length) {
      const asset = queue.shift()!;
      const label = asset.name.slice(0, 44);
      try {
        const src = await videoSourceUrl(asset.assetKey.replace(/^v:/, ""));
        if (!src) {
          noSource++;
          continue;
        }
        const buf = await downloadAsset(src);
        const text = await transcribeVideo(buf);

        if (text.length < USABLE) {
          // Left NULL rather than written as "". transcribeVideo returns "" for
          // a genuinely silent advert AND for a failed request, and nothing here
          // can tell those apart — writing "" would mark a failure as answered
          // and make it unretryable, which is precisely the conflation this
          // backfill exists to undo. Re-attempting a silent video later costs a
          // fraction of a cent; losing a real one costs the transcript.
          silent++;
          continue;
        }

        await db.creativeAnalysis.update({
          where: { assetId: asset.id },
          data: { transcript: text },
        });
        transcribed++;
        console.log(`  ${transcribed}. ${label} — ${text.length} chars`);

        // Same file, same words: carry it to the family so re-uploads don't get
        // transcribed again.
        if (asset.familyId) {
          const siblings = await db.creativeAsset.findMany({
            where: { familyId: asset.familyId, id: { not: asset.id }, analysis: { isNot: null } },
            select: { id: true },
          });
          for (const s of siblings) {
            const existing = await db.creativeAnalysis.findUnique({
              where: { assetId: s.id },
              select: { transcript: true },
            });
            if ((existing?.transcript?.length ?? 0) >= USABLE) continue;
            await db.creativeAnalysis.update({
              where: { assetId: s.id },
              data: { transcript: text },
            });
            propagated++;
          }
        }
      } catch (e) {
        failed++;
        console.warn(`  failed: ${label} — ${(e as Error).message.slice(0, 80)}`);
      }
    }
  }),
);

console.log(
  `\ntranscribed ${transcribed} · silent or music-only ${silent} · no source from Meta ${noSource}` +
    ` · failed ${failed} · carried to re-uploads ${propagated}`,
);

const grounded = await db.creativeAnalysis.count({ where: { NOT: { transcript: null } } });
console.log(`analyses now holding a transcript field: ${grounded}`);

await db.$disconnect();
