// TrendTrack Public API client — the source of the reference library.
//
// We pull OTHER brands' durable, high-reach video ads (see docs: TrendTrack is
// the enriched Meta/TikTok ad library, so "durable + high reach" is a proven-ad
// signal, not organic virality). Billing is 1 credit per returned row.

const BASE = "https://api.trendtrack.io/v1";

// Beauty & Fitness > Hair Care (268) and its "Other" child (270), from
// /v1/facets/categories. This is what makes the corpus relevant instead of
// "any ad whose copy mentions hair".
export const HAIR_CARE_CATEGORY_IDS = [268, 270];

/** The raw shape TrendTrack returns. Loosely typed — every field is optional and
 *  the untouched object is also persisted to ReferenceAsset.raw. */
export interface TrendTrackAd {
  id?: string | number;
  collationId?: string;
  platform?: string;
  status?: string;
  daysRunning?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  media?: { type?: string; thumbnailUrl?: string; mediaUrl?: string };
  advertiser?: { id?: string; name?: string; facebookPageId?: string };
  content?: {
    title?: string;
    body?: string;
    transcript?: string;
    callToAction?: string;
    landingPageUrl?: string;
  };
  metrics?: {
    reach?: number;
    aggregatedReach?: number;
    estimatedSpend?: number;
    duplicates?: number;
    reachDelta7d?: number;
    reachDelta30d?: number;
  };
  audience?: {
    targetedCountries?: string[];
    mainCountry?: string;
    gender?: string;
    ageMin?: number;
    ageMax?: number;
  };
}

export interface AdsQuery {
  categoryIds?: number[];
  /** Optional adCopy search; omit to sweep the whole category by reach. */
  search?: string;
  mediaType?: "video" | "image" | "carousel";
  countries?: string[];
  languages?: string[];
  minDaysRunning?: number;
  minReach?: number;
  sortBy?: string;
  page?: number;
  limit?: number;
}

export interface AdsResult {
  ads: TrendTrackAd[];
  cost: string | null;
  remaining: string | null;
}

function authHeaders(): Record<string, string> {
  const k = process.env.TRENDTRACK_API_KEY?.trim();
  if (!k) throw new Error("TRENDTRACK_API_KEY is not set");
  return { Authorization: `Bearer ${k}` };
}

/** Durable, high-reach video ads from large brands in the given category. */
export async function queryAds(q: AdsQuery = {}): Promise<AdsResult> {
  const body: Record<string, unknown> = {
    categoryIds: q.categoryIds ?? HAIR_CARE_CATEGORY_IDS,
    mediaType: q.mediaType ?? "video",
    status: "active",
    adCountries: { include: q.countries ?? ["US"] },
    languages: q.languages ?? ["en"],
    minDaysRunning: q.minDaysRunning ?? 90, // durable: still running a quarter on
    sortBy: q.sortBy ?? "reach", // large brands: biggest spenders first
    order: "desc",
    page: q.page ?? 1,
    limit: q.limit ?? 25,
  };
  if (q.minReach) body.minReach = q.minReach;
  if (q.search) {
    body.search = q.search;
    body.searchType = "adCopy";
  }

  const r = await fetch(`${BASE}/ads/query`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`TrendTrack /ads/query ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  const j = (await r.json()) as { data?: TrendTrackAd[] };
  return {
    ads: j.data ?? [],
    cost: r.headers.get("X-Usage-Cost"),
    remaining: r.headers.get("X-Credits-Remaining"),
  };
}

// ── Normalisation ─────────────────────────────────────────────────────────────

const int = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** The ReferenceAsset column values for an ad, excluding our mirrored URLs and
 *  bookkeeping. `raw` keeps the full payload so no field is lost to the schema. */
export function toAssetRow(ad: TrendTrackAd) {
  return {
    ttAdId: String(ad.id),
    collationId: str(ad.collationId),
    platform: str(ad.platform),
    advertiserName: str(ad.advertiser?.name),
    advertiserId: str(ad.advertiser?.facebookPageId) ?? str(ad.advertiser?.id),
    mediaType: str(ad.media?.type) ?? "video",
    sourceMediaUrl: str(ad.media?.mediaUrl),
    sourceThumbUrl: str(ad.media?.thumbnailUrl),
    title: str(ad.content?.title),
    body: str(ad.content?.body),
    transcript: str(ad.content?.transcript),
    landingPageUrl: str(ad.content?.landingPageUrl),
    cta: str(ad.content?.callToAction),
    reach: int(ad.metrics?.reach),
    estSpend: num(ad.metrics?.estimatedSpend),
    daysRunning: int(ad.daysRunning),
    variants: int(ad.metrics?.duplicates),
    reachDelta7d: int(ad.metrics?.reachDelta7d),
    reachDelta30d: int(ad.metrics?.reachDelta30d),
    gender: str(ad.audience?.gender),
    ageMin: int(ad.audience?.ageMin),
    ageMax: int(ad.audience?.ageMax),
    countries: ad.audience?.targetedCountries ?? [],
    mainCountry: str(ad.audience?.mainCountry),
  };
}
