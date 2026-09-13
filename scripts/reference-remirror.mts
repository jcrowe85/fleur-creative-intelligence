// Re-mirror reference videos from the original TrendTrack source, losslessly.
//
// Why this exists: an earlier optimize pass re-encoded the library with a scale
// filter that capped the LONG edge at 720. That is right for landscape footage
// and wrong for a corpus that is entirely vertical, so 720x1280 sources were
// stored as 406x720, and CRF 30 took ~1300kbps down to ~250kbps. On a phone it
// looks exactly as bad as that sounds.
//
// This re-downloads each original and stores it with faststart only (`-c copy`):
// identical bytes to what the advertiser shipped, with the moov atom moved to
// the front so it still streams progressively. No re-encode, ~1s per asset.
//
// It writes to a NEW path (video/hq/<ttAdId>.mp4) instead of overwriting.
// Uploads carry `cache-control: public, max-age=31536000, immutable`, so
// overwriting a path would leave the CDN serving the old, degraded copy for a
// year. The old object is deleted once the new one is recorded.
//
// Resumable by construction: an asset is "done" when its mediaUrl already points
// at video/hq/, so a re-run only picks up what's left.
//
//   npm run reference:remirror              # everything, concurrency 4
//   npm run reference:remirror -- 6         # concurrency 6
//   npm run reference:remirror -- 4 200     # only the 200 highest-reach

import { db } from "../src/lib/db";
import { deleteFromStorage, storageConfigured, uploadToStorage } from "../src/lib/reference/storage";
import { faststartRemux } from "../src/lib/reference/transcode";

const HQ_PREFIX = "video/hq/";
const concurrency = Math.max(1, Math.min(8, Number(process.argv[2] ?? 4)));
const limit = process.argv[3] ? Number(process.argv[3]) : undefined;
/** Optional: re-mirror one specific ad, for checking a clip you're looking at. */
const onlyTtAdId = process.argv[4];

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Supabase public URLs look like .../object/public/<bucket>/<path>. */
function storagePathFromUrl(url: string): string | null {
  const m = url.match(/\/object\/public\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

async function download(url: string): Promise<Buffer> {
  // TrendTrack's CDN occasionally drops a connection under concurrency; a few
  // backed-off retries recover it rather than failing the asset.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.byteLength < 10_000) throw new Error("suspiciously small download");
      return buf;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
}

async function main() {
  if (!storageConfigured()) throw new Error("Supabase storage not configured");

  const targets = await db.referenceAsset.findMany({
    where: {
      mediaUrl: { not: null },
      // Already re-mirrored in a previous run — nothing to do.
      NOT: { mediaUrl: { contains: HQ_PREFIX } },
      ...(onlyTtAdId ? { ttAdId: onlyTtAdId } : {}),
    },
    orderBy: { reach: "desc" }, // fix what creators actually see, first
    take: limit,
    select: { id: true, ttAdId: true, mediaUrl: true, mediaBytes: true, advertiserName: true, raw: true },
  });

  console.log(
    `Re-mirroring ${targets.length} videos from source — lossless faststart, concurrency ${concurrency}\n`,
  );

  let done = 0;
  let failed = 0;
  let noSource = 0;
  let beforeBytes = 0;
  let afterBytes = 0;

  await pool(targets, concurrency, async (a) => {
    const src = (a.raw as { media?: { mediaUrl?: string } } | null)?.media?.mediaUrl;
    if (!src) {
      noSource += 1;
      return;
    }
    try {
      const original = await download(src);
      const out = await faststartRemux(original);
      const newUrl = await uploadToStorage(`${HQ_PREFIX}${a.ttAdId}.mp4`, out, "video/mp4");

      const oldPath = a.mediaUrl ? storagePathFromUrl(a.mediaUrl) : null;
      await db.referenceAsset.update({
        where: { id: a.id },
        data: { mediaUrl: newUrl, mediaBytes: out.byteLength },
      });

      // Only after the row points at the new object — an orphan is harmless, a
      // row pointing at a deleted file is not.
      if (oldPath && !oldPath.startsWith(HQ_PREFIX)) await deleteFromStorage(oldPath).catch(() => {});

      beforeBytes += a.mediaBytes ?? 0;
      afterBytes += out.byteLength;
      done += 1;
      if (done % 20 === 0) {
        console.log(
          `  [${done}/${targets.length}] ${a.advertiserName ?? ""}  ` +
            `${((a.mediaBytes ?? 0) / 1e6).toFixed(1)}→${(out.byteLength / 1e6).toFixed(1)}MB`,
        );
      }
    } catch (e) {
      failed += 1;
      console.log(`  FAIL ${a.advertiserName ?? a.ttAdId}: ${(e as Error).message}`);
    }
  });

  console.log(
    `\nDone: re-mirrored ${done}, no source ${noSource}, failed ${failed}. ` +
      `Storage ${(beforeBytes / 1e9).toFixed(2)}GB → ${(afterBytes / 1e9).toFixed(2)}GB for these assets.`,
  );
  return failed;
}

main()
  // Non-zero on failures so a wrapper loop can re-run; finished assets are
  // skipped by the mediaUrl check, so a re-run is cheap.
  .then((failed) => process.exit(failed > 0 ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
