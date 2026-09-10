// De-risking spike: can TrendTrack's durable video ads be classified into our
// taxonomy coherently, before we build anything on top of that assumption?
//
// It pulls long-running, high-reach VIDEO ads from TrendTrack, downloads each,
// and runs them through the SAME classifier the app uses on Fleur's own ads
// (`analyzeCreative`). It prints the coordinates it assigned and, crucially, the
// confidences — so we can eyeball whether competitor creative sorts into
// pillar × persona × hook × funnel cleanly, or whether the classifier flails on
// content it wasn't tuned for.
//
//   npm run trendtrack:spike           # default 25 ads
//   npm run trendtrack:spike -- 10     # cheaper first look
//   npm run trendtrack:spike -- 25 "hair growth"   # override the search term
//
// Needs TRENDTRACK_API_KEY in the vault (dev env), plus the ANTHROPIC_API_KEY /
// OPENAI_API_KEY the classifier already uses. TrendTrack bills 1 credit per ad
// returned; classification is ~$0.03 + a Whisper call each. Reads only.

import { analyzeCreative, type CreativeAnalysis } from "../src/lib/creative/analyze";

const TT = "https://api.trendtrack.io/v1";

const N = Math.max(1, Math.min(100, Number(process.argv[2] ?? 25)));
// Optional adCopy search; omit it to sweep the whole Hair Care category by reach.
const SEARCH = process.argv[3];

// Beauty & Fitness > Hair Care (268) and its "Other" child (270), from the
// categories facet. This is what makes the corpus relevant instead of "any ad
// that says 'hair'".
const HAIR_CARE_CATEGORY_IDS = [268, 270];

const key = process.env.TRENDTRACK_API_KEY?.trim();
if (!key) {
  console.error(
    "TRENDTRACK_API_KEY is required. Add it to Infisical (dev) then re-run:\n" +
      "  infisical secrets set TRENDTRACK_API_KEY=<key> --env=dev",
  );
  process.exit(1);
}

const auth = { Authorization: `Bearer ${key}` };

// ── TrendTrack ────────────────────────────────────────────────────────────────

interface TTAd {
  id?: string;
  advertiser?: { name?: string };
  media?: { type?: string; mediaUrl?: string; thumbnailUrl?: string };
  content?: { title?: string; body?: string; transcript?: string; landingPageUrl?: string };
  metrics?: { reach?: number; duplicates?: number };
  daysRunning?: number;
}

async function usage(): Promise<void> {
  try {
    const r = await fetch(`${TT}/usage`, { headers: auth });
    if (r.ok) {
      const j = (await r.json()) as { data?: { creditsRemaining?: number } };
      console.log(`Credits remaining: ${j.data?.creditsRemaining ?? "?"}\n`);
    } else {
      console.log(`(/usage returned ${r.status})\n`);
    }
  } catch {
    /* non-fatal */
  }
}

/** Durable, high-reach video ads from large US hair brands — the exact intake
 *  the real pipeline wants: relevant category, right market, proven longevity,
 *  ranked by reach so the biggest spenders come first. */
async function fetchDurableVideoAds(): Promise<TTAd[]> {
  const body: Record<string, unknown> = {
    categoryIds: HAIR_CARE_CATEGORY_IDS,
    mediaType: "video",
    status: "active",
    adCountries: { include: ["US"] },
    languages: ["en"],
    minDaysRunning: 90, // "durable": still running a quarter later
    sortBy: "reach", // "large brands": biggest spenders first
    order: "desc",
    page: 1,
    limit: N,
  };
  if (SEARCH) {
    body.search = SEARCH;
    body.searchType = "adCopy";
  }
  const r = await fetch(`${TT}/ads/query`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(
    `POST /ads/query → ${r.status}  ` +
      `cost=${r.headers.get("X-Usage-Cost") ?? "?"} ` +
      `remaining=${r.headers.get("X-Credits-Remaining") ?? "?"}`,
  );
  if (!r.ok) {
    console.error(await r.text());
    process.exit(1);
  }
  const j = (await r.json()) as { data?: TTAd[] };
  return j.data ?? [];
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    const buf = Buffer.from(await r.arrayBuffer());
    // Guard against an HTML error page or a streaming manifest masquerading as media.
    if (buf.byteLength < 10_000 || ct.includes("text") || ct.includes("mpegurl")) return null;
    return buf;
  } catch {
    return null;
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pick = (p: { id: string; confidence: number }) => `${p.id}(${pct(p.confidence)})`;

interface Row {
  brand: string;
  days: number;
  reach: number;
  variants: number;
  a: CreativeAnalysis;
}

function printRow(r: Row) {
  const { a } = r;
  console.log(
    `\n▸ ${r.brand}  ·  ${r.days}d running  ·  reach ${r.reach.toLocaleString()}  ·  ${r.variants} variants`,
  );
  console.log(`  hook text: "${a.hookText.slice(0, 80)}"`);
  console.log(
    `  pillar=${pick(a.pillar)}  persona=${pick(a.persona)}  ` +
      `hook=${pick(a.hook)}  funnel=${pick(a.funnel)}  format=${pick(a.format)}`,
  );
  console.log(`  critique: ${a.critique}`);
}

async function main() {
  console.log(`TrendTrack classifiability spike — ${N} durable video ads, search="${SEARCH}"\n`);
  await usage();

  const ads = await fetchDurableVideoAds();
  console.log(`Got ${ads.length} ads back.\n`);

  const rows: Row[] = [];
  let noMedia = 0;
  let failed = 0;

  for (const [i, ad] of ads.entries()) {
    const url = ad.media?.mediaUrl;
    const brand = ad.advertiser?.name ?? "(unknown)";
    process.stdout.write(`[${i + 1}/${ads.length}] ${brand} … `);

    if (ad.media?.type !== "video" || !url) {
      console.log("skip (no video url)");
      noMedia++;
      continue;
    }
    const buf = await download(url);
    if (!buf) {
      console.log("skip (download failed / not media)");
      noMedia++;
      continue;
    }
    try {
      const a = await analyzeCreative({
        videoBuffer: buf,
        adName: brand,
        headline: ad.content?.title,
        primaryText: ad.content?.body,
        destinationUrl: ad.content?.landingPageUrl,
      });
      rows.push({
        brand,
        days: ad.daysRunning ?? 0,
        reach: ad.metrics?.reach ?? 0,
        variants: ad.metrics?.duplicates ?? 0,
        a,
      });
      console.log("ok");
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("RESULTS");
  console.log("=".repeat(72));
  rows.forEach(printRow);

  // ── Coherence read ──
  // A pick that fell back to the default carries confidence 0 (see coercePick);
  // a real, confident classification is >= 0.6. This is the number that tells us
  // whether the premise holds.
  const axes = ["pillar", "persona", "hook", "funnel", "format"] as const;
  console.log("\n" + "=".repeat(72));
  console.log("COHERENCE  (share of ads classified at confidence ≥ 0.6, per axis)");
  console.log("=".repeat(72));
  for (const ax of axes) {
    const conf = rows.filter((r) => r.a[ax].confidence >= 0.6).length;
    console.log(`  ${ax.padEnd(8)} ${conf}/${rows.length}  (${pct(conf / (rows.length || 1))})`);
  }

  // Distribution across pillars — are they landing in varied territory, or all
  // collapsing into one or two cells (which would mean the classifier can't
  // separate competitor content)?
  const byPillar = new Map<string, number>();
  for (const r of rows) byPillar.set(r.a.pillar.id, (byPillar.get(r.a.pillar.id) ?? 0) + 1);
  console.log("\nPillar spread:");
  [...byPillar.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, c]) => console.log(`  ${p.padEnd(24)} ${c}`));

  console.log(
    `\nClassified ${rows.length}, skipped ${noMedia} (no media), failed ${failed}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
