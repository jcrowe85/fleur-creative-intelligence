// Mirror media into our own Supabase Storage bucket.
//
// TrendTrack/Meta media URLs are signed and expire within days, so a reference
// video has to be copied somewhere permanent before it can be served to a
// creator in the swipe app later. This uploads bytes to the bucket named by
// SUPABASE_MEDIA_BUCKET (default "reference-media") and returns the stable
// public URL. Same Supabase project as the database — nothing new to run.

const trimEnd = (s: string) => s.replace(/\/+$/, "");

function config() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() || "reference-media";
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return { url: trimEnd(url), key, bucket };
}

/** True when the vault has what mirroring needs — check before a run so the
 *  failure is one clear message, not one per asset. */
export function storageConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/**
 * Uploads `body` to `path` within the bucket (create or replace) and returns the
 * public URL. `path` is relative to the bucket, e.g. "video/<ttAdId>.mp4".
 */
export async function uploadToStorage(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const { url, key, bucket } = config();
  const clean = path.replace(/^\/+/, "");
  const r = await fetch(`${url}/storage/v1/object/${bucket}/${clean}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      // Re-mirroring the same asset should overwrite, not 409.
      "x-upsert": "true",
    },
    body: new Uint8Array(body),
  });
  if (!r.ok) {
    throw new Error(`Supabase upload ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  return `${url}/storage/v1/object/public/${bucket}/${clean}`;
}
