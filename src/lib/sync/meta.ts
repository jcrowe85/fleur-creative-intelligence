// Meta → this app's own database.
//
// Deliberately independent of Fleur Financials. That app runs its own, richer
// Meta sync into its own tables; this one pulls the slice Creative Intelligence
// needs — the entity tree and campaign/ad delivery — straight from the Meta
// API. No cross-database read exists in either direction, which is the whole
// point of the split.

import { db } from "@/lib/db";

const GRAPH = "https://graph.facebook.com/v23.0";

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const account = () => {
  const raw = env("META_AD_ACCOUNT_ID");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
};

interface Paged<T> {
  data?: T[];
  paging?: { next?: string };
}

/** Meta refuses an oversized page with code 1 rather than truncating, so start
 *  modest and halve on refusal instead of guessing a constant. */
const REDUCE = /reduce the amount of data/i;

async function graphAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  let limit = 200;
  let page: Paged<T> | null = null;
  for (;;) {
    const url = new URL(`${GRAPH}/${path}`);
    for (const [k, v] of Object.entries({ limit: String(limit), ...params })) {
      url.searchParams.set(k, v);
    }
    url.searchParams.set("access_token", env("META_ACCESS_TOKEN"));
    const j = (await (await fetch(url)).json()) as Paged<T> & { error?: { message?: string } };
    if (j.error) {
      if (limit > 5 && REDUCE.test(j.error.message ?? "")) {
        limit = Math.max(5, Math.floor(limit / 2));
        continue;
      }
      throw new Error(`Meta API: ${j.error.message ?? "unknown"}`);
    }
    page = j;
    break;
  }

  const out: T[] = [...(page.data ?? [])];
  let guard = 0;
  while (page?.paging?.next && guard++ < 500) {
    const next = (await (await fetch(page.paging.next)).json()) as Paged<T> & { error?: unknown };
    if (next.error) break;
    page = next;
    out.push(...(page.data ?? []));
  }
  return out;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const action = (list: { action_type: string; value: string }[] | undefined, type: string) =>
  num(list?.find((a) => a.action_type === type)?.value);

interface InsightRow {
  date_start: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  outbound_clicks?: { action_type: string; value: string }[];
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  video_p25_watched_actions?: { action_type: string; value: string }[];
  video_p50_watched_actions?: { action_type: string; value: string }[];
  video_p75_watched_actions?: { action_type: string; value: string }[];
  video_p100_watched_actions?: { action_type: string; value: string }[];
  video_thruplay_watched_actions?: { action_type: string; value: string }[];
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
}

const INSIGHT_FIELDS = [
  "spend", "impressions", "reach", "clicks", "inline_link_clicks", "outbound_clicks",
  "actions", "action_values",
  "video_p25_watched_actions", "video_p50_watched_actions",
  "video_p75_watched_actions", "video_p100_watched_actions",
  "video_thruplay_watched_actions",
].join(",");

const LEVEL_ID: Record<string, keyof InsightRow> = {
  campaign: "campaign_id",
  adset: "adset_id",
  ad: "ad_id",
};

async function syncLevel(level: "campaign" | "adset" | "ad", since: string, until: string) {
  const rows = await graphAll<InsightRow>(`${account()}/insights`, {
    level,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: `${INSIGHT_FIELDS},${LEVEL_ID[level]}`,
  });

  let n = 0;
  for (const r of rows) {
    const entityId = r[LEVEL_ID[level]] as string | undefined;
    if (!entityId) continue;
    const data = {
      date: new Date(r.date_start),
      level,
      entityId,
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      clicks: num(r.clicks),
      inlineLinkClicks: num(r.inline_link_clicks),
      outboundClicks: action(r.outbound_clicks, "outbound_click"),
      purchases: action(r.actions, "purchase"),
      purchaseValue: action(r.action_values, "purchase"),
      addToCart: action(r.actions, "add_to_cart"),
      initiateCheckout: action(r.actions, "initiate_checkout"),
      landingPageViews: action(r.actions, "landing_page_view"),
      videoViews3s: action(r.actions, "video_view"),
      thruplays: action(r.video_thruplay_watched_actions, "video_view"),
      videoP25: action(r.video_p25_watched_actions, "video_view"),
      videoP50: action(r.video_p50_watched_actions, "video_view"),
      videoP75: action(r.video_p75_watched_actions, "video_view"),
      videoP100: action(r.video_p100_watched_actions, "video_view"),
      syncedAt: new Date(),
    };
    await db.metaInsightDaily.upsert({
      where: { date_level_entityId: { date: data.date, level, entityId } },
      update: data,
      create: { id: `${r.date_start}_${level}_${entityId}`, ...data },
    });
    n++;
  }
  return n;
}

interface EntityRow {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
  adset_id?: string;
}

async function syncEntities() {
  const specs = [
    { level: "campaign", path: "campaigns", fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget" },
    { level: "adset", path: "adsets", fields: "id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id" },
    { level: "ad", path: "ads", fields: "id,name,status,effective_status,campaign_id,adset_id" },
  ] as const;

  let n = 0;
  for (const s of specs) {
    const rows = await graphAll<EntityRow>(`${account()}/${s.path}`, { fields: s.fields });
    for (const r of rows) {
      const data = {
        level: s.level,
        name: r.name ?? "(unnamed)",
        campaignId: r.campaign_id ?? (s.level === "campaign" ? r.id : null),
        adsetId: r.adset_id ?? (s.level === "adset" ? r.id : null),
        status: r.status ?? null,
        effectiveStatus: r.effective_status ?? null,
        objective: r.objective ?? null,
        dailyBudget: r.daily_budget ? Number(r.daily_budget) / 100 : null,
        lifetimeBudget: r.lifetime_budget ? Number(r.lifetime_budget) / 100 : null,
        syncedAt: new Date(),
      };
      await db.metaEntity.upsert({ where: { id: r.id }, update: data, create: { id: r.id, ...data } });
      n++;
    }
  }
  return n;
}

export interface MetaSyncResult {
  entities: number;
  insights: number;
}

export async function syncMeta(daysBack = 7): Promise<MetaSyncResult> {
  const log = await db.syncLog.create({ data: { source: "meta", status: "running" } });
  try {
    const until = new Date();
    const since = new Date(until.getTime() - daysBack * 86400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const entities = await syncEntities();
    let insights = 0;
    for (const level of ["campaign", "adset", "ad"] as const) {
      insights += await syncLevel(level, fmt(since), fmt(until));
    }

    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "success", finishedAt: new Date(), recordsUpserted: entities + insights },
    });
    return { entities, insights };
  } catch (e) {
    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status: "error",
        finishedAt: new Date(),
        errorMessage: e instanceof Error ? e.message.slice(0, 500) : "sync failed",
      },
    });
    throw e;
  }
}
