// Fingerprint every asset, then group the uploads of the same creative.
//
//   npm run backfill:families
//
// Safe to re-run and safe to stop: fingerprints are stored per asset as they're
// taken, and the grouping is rebuilt from scratch each time. Meta won't return
// details for videos owned by other pages, so some assets never get a
// fingerprint; those simply stay on their own.

import { fingerprintPending, rebuildFamilies } from "../src/lib/creative/family";

const BATCH = 400;

async function main() {
  let attempted = 0;
  let fingerprinted = 0;
  let failed = 0;

  for (;;) {
    const run = await fingerprintPending(BATCH);
    if (run.attempted === 0) break;
    attempted += run.attempted;
    fingerprinted += run.fingerprinted;
    failed += run.failed;
    console.log(
      `fingerprinted ${fingerprinted} · no image available ${failed} · ${attempted} tried`,
    );
  }

  const families = await rebuildFamilies();
  console.log(
    `\nfamilies ${families.families} · uploads grouped ${families.uploadsGrouped} · ` +
      `duplicate rows ${families.duplicateUploads}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
