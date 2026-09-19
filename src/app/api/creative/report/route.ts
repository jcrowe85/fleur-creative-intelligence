import { NextResponse } from "next/server";
import { apiRequireUser } from "@/lib/dal";
import { buildReport } from "@/lib/creative/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The whole creative-intelligence read, as JSON.
 *
 * This exists for agents, not for the page — /reports renders the same call
 * server-side and never needed an endpoint. The reason to add one is that the
 * judgement lives in TypeScript, not in the database:
 *
 *   - a term is only a "pattern" if it clears 25 purchases AND no single
 *     creative carries half its spend
 *   - retention rates are null below 1,000 impressions rather than zero
 *   - hold and finish rates are ranked within a length band, because finish
 *     rate correlates -0.49 with video length
 *   - counts are folded to creatives, so a video uploaded 21 times is one
 *
 * Anything reading Postgres directly gets the raw rows with none of that, and
 * would confidently rank a category that is really one advert. Going through
 * this route means the caveats arrive attached to the numbers.
 *
 * `?since=YYYY-MM-DD` narrows the window; percentiles and benchmarks are then
 * computed within it, so a filtered view compares a creative against its
 * contemporaries.
 */
export async function GET(req: Request) {
  const auth = await apiRequireUser();
  if ("error" in auth) return auth.error;

  const since = new URL(req.url).searchParams.get("since") ?? undefined;
  try {
    const report = await buildReport(since);
    return NextResponse.json({
      ...report,
      /** What the numbers above will and will not support, so a caller does not
       *  have to rediscover it. Measured against this account. */
      caveats: {
        creatorSpendShare:
          "Creator attribution covers ~16% of account spend. The rest is TrendTrack, animator and internal creative. Quote shares of creator spend, not of the account.",
        taxonomyDiscrimination:
          "CPA spreads only ~1.5x across pillars and ~1.35x across principle tags, against an $88 benchmark. Category differences are mostly not actionable; the real 2.2x spread is at the creative level.",
        hookRate:
          "Hook rate does NOT predict CPA here (correlation +0.06). Treat it as a delivery diagnostic. Hold rate does correlate (-0.27).",
        concentration:
          "The top 25 creatives carry ~58% of spend. Averages across the whole library describe creatives that barely ran.",
        principleTags:
          "Tagged creatives are limited to those with a transcript (~46% of spend); the rest cannot be grounded because Meta serves no source for them. Tags describe the library, they do not rank it.",
        freshness:
          "Every historical day reconciles to Meta exactly; only the current day under-reports while attribution settles.",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
