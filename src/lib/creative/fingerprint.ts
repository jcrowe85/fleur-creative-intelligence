// Content fingerprints for creative assets.
//
// Meta issues a new video_id / image_hash every time the same file is uploaded
// again: a creator's own copy of a Trybe video, a duplicated ad, a re-export
// with different captions. Deduping on those ids counts one creative many times
// over, which inflates coverage, flatters campaign grades and hides the real
// duplication. So we fingerprint the pixels instead — a 64-bit difference hash
// of a few frames, matched within a small Hamming distance.
//
// Frames come from Meta, not from the stored thumbUrl: those URLs are signed
// and expire within days (759 of 1,440 were already dead when this was written).

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

const GRAPH = "https://graph.facebook.com/v23.0";

/** Two fingerprints this close are the same creative. Measured on Fleur's
 *  library, anything from 4 to 10 gives the same answer (120 to 164 duplicate
 *  rows); 8 sits in the middle of that plateau. */
export const FP_HAMMING_MAX = 8;

/** Videos must also agree on length, when Meta tells us the length. */
export const FP_DURATION_TOLERANCE_SEC = 0.6;

export interface Fingerprint {
  hashes: string[];
  durationSec: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function token(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error("META_ACCESS_TOKEN is not set");
  return t;
}

function accountId(): string {
  const raw = process.env.META_AD_ACCOUNT_ID ?? "";
  if (!raw) throw new Error("META_AD_ACCOUNT_ID is not set");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      // Rate limits and Meta's own hiccups are worth another go; a 400 on a
      // video the token can't read is not.
      if (r.status === 429 || r.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

/** 64-bit difference hash: 9x8 greyscale, each pixel compared with its neighbour. */
export async function dhash(image: Buffer): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "fleur-fp-"));
  try {
    const src = join(dir, "in.jpg");
    const out = join(dir, "out.gray");
    await writeFile(src, image);
    await execFileAsync(ffmpegPath, [
      "-v", "error", "-i", src, "-vf", "scale=9:8,format=gray", "-f", "rawvideo", out,
    ]);
    const px = await readFile(out);
    if (px.byteLength < 72) return null;
    let bits = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    }
    return bits;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function hashUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return null;
    return await dhash(Buffer.from(await r.arrayBuffer()));
  } catch {
    return null;
  }
}

interface VideoFields {
  length?: number;
  picture?: string;
  thumbnails?: { data?: { uri?: string; is_preferred?: boolean }[] };
}

/**
 * Fresh frames for a video id: the cover image plus a few stills from across
 * the clip, so a re-upload still matches when Meta picks a different cover.
 *
 * Returns empty hashes when the token can't read the video — page-owned and
 * creator-owned videos are common in this account, and that is not an error.
 */
export async function fingerprintVideo(videoId: string): Promise<Fingerprint> {
  const v = await graph<VideoFields>(videoId, {
    fields: "length,picture,thumbnails{uri,is_preferred}",
  });
  const urls: string[] = [];
  if (v?.picture) urls.push(v.picture);

  const thumbs = v?.thumbnails?.data ?? [];
  const picks = [
    thumbs.find((t) => t.is_preferred),
    thumbs[Math.floor(thumbs.length / 2)],
    thumbs.at(-1),
  ];
  for (const t of picks) {
    if (t?.uri && !urls.includes(t.uri)) urls.push(t.uri);
  }

  const hashes = (await Promise.all(urls.slice(0, 4).map(hashUrl))).filter(
    (h): h is string => Boolean(h),
  );
  return { hashes, durationSec: v?.length ?? null };
}

/** Fresh URLs for stored image hashes, 20 at a time. */
export async function fingerprintImages(
  imageHashes: string[],
): Promise<Map<string, Fingerprint>> {
  const out = new Map<string, Fingerprint>();
  for (let i = 0; i < imageHashes.length; i += 20) {
    const chunk = imageHashes.slice(i, i + 20);
    const res = await graph<{ data?: { hash: string; url?: string }[] }>(
      `${accountId()}/adimages`,
      { hashes: JSON.stringify(chunk), fields: "hash,url,width,height" },
    );
    const byHash = new Map((res?.data ?? []).map((d) => [d.hash, d]));
    await Promise.all(
      chunk.map(async (h) => {
        const url = byHash.get(h)?.url;
        const hash = url ? await hashUrl(url) : null;
        out.set(h, { hashes: hash ? [hash] : [], durationSec: null });
      }),
    );
  }
  return out;
}

export function hamming(a: string, b: string, cap = FP_HAMMING_MAX): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++d > cap) return d;
  }
  return d;
}

export interface Fingerprinted {
  assetType: string;
  fpHashes: string[];
  fpDurationSec: number | null;
}

/** Same underlying creative: same media type, same length where both are known,
 *  and at least one pair of frames that match. */
export function sameCreative(a: Fingerprinted, b: Fingerprinted): boolean {
  if (a.assetType !== b.assetType) return false;
  if (
    a.fpDurationSec != null &&
    b.fpDurationSec != null &&
    Math.abs(a.fpDurationSec - b.fpDurationSec) > FP_DURATION_TOLERANCE_SEC
  ) {
    return false;
  }
  for (const x of a.fpHashes) {
    for (const y of b.fpHashes) if (hamming(x, y) <= FP_HAMMING_MAX) return true;
  }
  return false;
}
