// Pulls creative assets out of the Meta ad account and dedupes them.
//
// The important move here is deduping on the underlying asset (video_id, or
// image_hash for stills) rather than on the ad. Fleur runs the same video as
// dozens of ads across campaigns — classifying each ad separately would both
// waste model calls and badly distort the coverage picture, since one video
// appearing 12 times would read as 12 occupied territories.

const GRAPH = "https://graph.facebook.com/v23.0";

function accountId(): string {
  const raw = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!raw) throw new Error("Missing env var: META_AD_ACCOUNT_ID");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function token(): string {
  const t = process.env.META_ACCESS_TOKEN?.trim();
  if (!t) throw new Error("Missing env var: META_ACCESS_TOKEN");
  return t;
}

async function graph<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token());
  const r = await fetch(url);
  const j = (await r.json()) as T & { error?: { message?: string; code?: number } };
  if (j.error) throw new Error(`Meta API ${j.error.code ?? ""}: ${j.error.message ?? "unknown"}`);
  return j;
}

interface Paged<T> {
  data?: T[];
  paging?: { next?: string };
}

/** Meta refuses an oversized page with code 1 ("reduce the amount of data")
 *  rather than truncating. Creative expansion is heavy — an account with ~900
 *  ads trips this well below the nominal limit — so start modest and halve on
 *  refusal instead of guessing a constant that will break on the next account. */
const REDUCE_DATA = /reduce the amount of data/i;

async function graphAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  let limit = 50;
  let page: Paged<T> | null = null;
  for (;;) {
    try {
      page = await graph<Paged<T>>(path, { limit: String(limit), ...params });
      break;
    } catch (e) {
      if (limit > 5 && e instanceof Error && REDUCE_DATA.test(e.message)) {
        limit = Math.max(5, Math.floor(limit / 2));
        continue;
      }
      throw e;
    }
  }

  const out: T[] = [...(page.data ?? [])];
  // Paging cursors carry their own limit, so the reduced page size sticks.
  let guard = 0;
  while (page?.paging?.next && guard++ < 500) {
    const r = await fetch(page.paging.next);
    const next = (await r.json()) as Paged<T> & { error?: { message?: string } };
    if (next.error) {
      // A mid-walk refusal loses the cursor; return what we have rather than
      // failing the whole discovery run.
      break;
    }
    page = next;
    out.push(...(page.data ?? []));
  }
  return out;
}

interface RawAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    title?: string;
    body?: string;
    thumbnail_url?: string;
    image_url?: string;
    object_story_spec?: {
      video_data?: {
        video_id?: string;
        image_hash?: string;
        image_url?: string;
        title?: string;
        message?: string;
        call_to_action?: { value?: { link?: string } };
      };
      link_data?: {
        image_hash?: string;
        picture?: string;
        link?: string;
        name?: string;
        message?: string;
      };
    };
    asset_feed_spec?: {
      videos?: { video_id?: string; thumbnail_url?: string }[];
      images?: { hash?: string; url?: string }[];
      titles?: { text?: string }[];
      bodies?: { text?: string }[];
    };
  };
}

export interface DiscoveredAsset {
  assetKey: string;
  assetType: "video" | "image";
  name: string;
  adIds: string[];
  thumbUrl: string | null;
  headline: string | null;
  primaryText: string | null;
  destinationUrl: string | null;
}

const CREATIVE_FIELDS =
  "id,name,status,effective_status,creative{id,title,body,thumbnail_url,image_url," +
  "object_story_spec,asset_feed_spec}";

/**
 * Every distinct asset in the account, with the ads that run it.
 *
 * `activeOnly` limits to ads currently deliverable. Off by default: the whole
 * point is to see the historical library, including assets that have been
 * paused, since a paused winner is still occupied territory.
 */
export async function discoverAssets(opts: { activeOnly?: boolean } = {}): Promise<DiscoveredAsset[]> {
  const params: Record<string, string> = { fields: CREATIVE_FIELDS };
  if (opts.activeOnly) params.effective_status = JSON.stringify(["ACTIVE"]);

  const ads = await graphAll<RawAd>(`${accountId()}/ads`, params);
  const map = new Map<string, DiscoveredAsset>();

  for (const ad of ads) {
    const c = ad.creative ?? {};
    const oss = c.object_story_spec ?? {};
    const afs = c.asset_feed_spec ?? {};
    const vd = oss.video_data;
    const ld = oss.link_data;

    const videoId = vd?.video_id ?? afs.videos?.[0]?.video_id ?? null;
    const imageHash = vd?.image_hash ?? ld?.image_hash ?? afs.images?.[0]?.hash ?? null;

    // Video wins when both are present — the image is only the thumbnail.
    const assetKey = videoId ? `v:${videoId}` : imageHash ? `i:${imageHash}` : null;
    if (!assetKey) continue;

    const existing = map.get(assetKey);
    if (existing) {
      existing.adIds.push(ad.id);
      // Keep the first non-empty copy we see; ads sharing an asset usually
      // share copy, and where they differ the first is as good as any.
      existing.headline ??= vd?.title ?? ld?.name ?? c.title ?? null;
      existing.primaryText ??= vd?.message ?? ld?.message ?? c.body ?? null;
      continue;
    }

    map.set(assetKey, {
      assetKey,
      assetType: videoId ? "video" : "image",
      name: ad.name,
      adIds: [ad.id],
      thumbUrl:
        vd?.image_url ??
        afs.videos?.[0]?.thumbnail_url ??
        ld?.picture ??
        c.thumbnail_url ??
        c.image_url ??
        afs.images?.[0]?.url ??
        null,
      headline: vd?.title ?? ld?.name ?? c.title ?? afs.titles?.[0]?.text ?? null,
      primaryText: vd?.message ?? ld?.message ?? c.body ?? afs.bodies?.[0]?.text ?? null,
      destinationUrl: vd?.call_to_action?.value?.link ?? ld?.link ?? null,
    });
  }

  return [...map.values()];
}

/**
 * Resolves a Meta video id to a downloadable URL.
 *
 * `source` is only returned for videos the token's user owns and is not always
 * present — Meta omits it for some page-owned and boosted-post videos. Callers
 * must handle null by falling back to the thumbnail, which still supports
 * classification from stills plus copy, just less reliably.
 */
export async function videoSourceUrl(videoId: string): Promise<string | null> {
  try {
    const v = await graph<{ source?: string; permalink_url?: string }>(videoId, {
      fields: "source,permalink_url",
    });
    return v.source ?? null;
  } catch {
    return null;
  }
}

export async function downloadAsset(url: string, maxBytes = 200 * 1024 * 1024): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Asset download failed: ${r.status}`);
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new Error(`Asset too large: ${(len / 1e6).toFixed(0)}MB`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("Asset exceeded size limit");
  return buf;
}
