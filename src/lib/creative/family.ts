// Creative families: one row per real creative, however many times it was uploaded.
//
// `familyKey()` is the unit everything downstream should count. Coverage, gaps,
// redundancy and campaign grades all used to count uploads, which meant one
// video re-uploaded 21 times read as 21 creatives occupying 21 slots.

import { db } from "@/lib/db";
import { fingerprintImages, fingerprintVideo, sameCreative } from "./fingerprint";

/** The creative an upload belongs to. Ungrouped uploads are their own creative. */
export function familyKey(a: { id: string; familyId: string | null }): string {
  return a.familyId ?? a.id;
}

export interface FingerprintRun {
  attempted: number;
  fingerprinted: number;
  failed: number;
}

/**
 * Fingerprint assets that don't have one yet.
 *
 * Safe to re-run and safe to interrupt: `fpAt` marks a row as tried, failures
 * included, so a video the token can't read isn't retried on every sync. Clear
 * `fpAt` to force a re-try.
 */
export async function fingerprintPending(limit = 400): Promise<FingerprintRun> {
  const pending = await db.creativeAsset.findMany({
    where: { fpAt: null },
    select: { id: true, assetKey: true },
    take: limit,
  });
  if (pending.length === 0) return { attempted: 0, fingerprinted: 0, failed: 0 };

  let fingerprinted = 0;
  let failed = 0;

  const videos = pending.filter((a) => a.assetKey.startsWith("v:"));
  const queue = [...videos];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const a = queue.shift()!;
        const fp = await fingerprintVideo(a.assetKey.slice(2));
        // Only the new columns are written. `durationSec` is empty on every row
        // and Meta's `length` would fill it, but leaving it alone keeps this
        // change invisible to the previous version of the app: roll the code
        // back and nothing it reads has moved. Fill it from `fpDurationSec`
        // once the change is kept.
        await db.creativeAsset.update({
          where: { id: a.id },
          data: {
            fpHashes: fp.hashes,
            fpDurationSec: fp.durationSec,
            fpAt: new Date(),
          },
        });
        if (fp.hashes.length) fingerprinted++;
        else failed++;
      }
    }),
  );

  const images = pending.filter((a) => a.assetKey.startsWith("i:"));
  if (images.length) {
    const byHash = await fingerprintImages(images.map((a) => a.assetKey.slice(2)));
    for (const a of images) {
      const fp = byHash.get(a.assetKey.slice(2)) ?? { hashes: [], durationSec: null };
      await db.creativeAsset.update({
        where: { id: a.id },
        data: { fpHashes: fp.hashes, fpAt: new Date() },
      });
      if (fp.hashes.length) fingerprinted++;
      else failed++;
    }
  }

  return { attempted: pending.length, fingerprinted, failed };
}

export interface FamilyRun {
  families: number;
  uploadsGrouped: number;
  duplicateUploads: number;
}

/**
 * Rebuild the grouping from the fingerprints on record.
 *
 * Cheap enough to run whole: the comparison is O(n²) over a few thousand rows
 * of 64-bit strings, and it only touches assets that carry a fingerprint.
 */
export async function rebuildFamilies(): Promise<FamilyRun> {
  const assets = await db.creativeAsset.findMany({
    select: {
      id: true,
      assetType: true,
      fpHashes: true,
      fpDurationSec: true,
      adIds: true,
    },
  });
  const have = assets.filter((a) => a.fpHashes.length > 0);

  const parent = new Map(have.map((a) => [a.id, a.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };

  for (let i = 0; i < have.length; i++) {
    for (let j = i + 1; j < have.length; j++) {
      if (!sameCreative(have[i], have[j])) continue;
      const a = find(have[i].id);
      const b = find(have[j].id);
      if (a !== b) parent.set(a, b);
    }
  }

  const groups = new Map<string, typeof have>();
  for (const a of have) {
    const key = find(a.id);
    const g = groups.get(key) ?? [];
    g.push(a);
    groups.set(key, g);
  }

  const keep: string[] = [];
  let uploadsGrouped = 0;
  let duplicateUploads = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // The upload running in the most ads is the face of the family.
    const canonical = [...group].sort((a, b) => b.adIds.length - a.adIds.length)[0];
    const id = `fam_${canonical.id}`;
    const data = {
      canonicalAssetId: canonical.id,
      fingerprints: [...new Set(group.flatMap((a) => a.fpHashes))].slice(0, 12),
      durationSec: canonical.fpDurationSec,
      memberCount: group.length,
    };
    await db.creativeFamily.upsert({ where: { id }, create: { id, ...data }, update: data });
    await db.creativeAsset.updateMany({
      where: { id: { in: group.map((a) => a.id) } },
      data: { familyId: id },
    });
    keep.push(id);
    uploadsGrouped += group.length;
    duplicateUploads += group.length - 1;
  }

  // Anything that no longer matches goes back to standing on its own.
  await db.creativeAsset.updateMany({
    where: { familyId: { notIn: keep } },
    data: { familyId: null },
  });
  await db.creativeFamily.deleteMany({ where: { id: { notIn: keep } } });

  return { families: keep.length, uploadsGrouped, duplicateUploads };
}
