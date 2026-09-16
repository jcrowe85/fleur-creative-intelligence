// Principle tags: which of Donovan's H/R/S moves a creative actually uses.
//
// The toolkit ids and names are imported from lib/reference/creator-brief.ts —
// the handoff's own file, already the authority for the tools named inside a
// creator brief. Re-declaring them here as a ninth taxonomy axis would give the
// app two lists that agree until the day one of them is edited.
//
// Two limits are deliberate, and both are measured rather than assumed:
//
//   Only videos with a transcript are tagged. H3 "no dead air", R7 "pace" and
//   S3 "plain words" are claims about what is SAID. 399 of this library's
//   videos have no transcript and their audio cannot be fetched — Meta serves
//   no source for them — so tagging those would mean inferring speech from
//   eight stills. They stay untagged, and `toolsAt` null is what says so.
//
//   Images are skipped entirely. H/R/S is a video toolkit; a still has no
//   retention curve to describe.
//
// Coverage this can reach: 297 of 1,195 analysed creatives, 46% of creative
// spend. Tagging the top 100 by spend reaches 54 of them and 38% of spend.
// That ceiling is a property of the data, not of the prompt.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { db } from "@/lib/db";
import { TOOL_IDS, TOOL_NAMES, type ToolId } from "@/lib/reference/creator-brief";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 2000;
/** Below this a transcript is a stub, not speech. Matches the report's rule. */
const USABLE_TRANSCRIPT = 40;

const TagsSchema = z.object({
  tools: z
    .array(z.enum(TOOL_IDS as [ToolId, ...ToolId[]]))
    .describe("Only the principles this video actually uses, in the order they appear"),
  reasoning: z
    .string()
    .describe("One short line per tool: where it happens and how you can tell"),
});

/** The toolkit as the tagger sees it: ids, names, and what each one means. */
function toolkitBlock(): string {
  return TOOL_IDS.map((id) => `${id} — ${TOOL_NAMES[id]}`).join("\n");
}

const SYSTEM = `You tag advertising creative with the principles it uses, from a fixed toolkit a media buyer teaches his creators.

THE TOOLKIT
${toolkitBlock()}

H tags describe the first three seconds. R tags describe how the video holds attention after that. S tags describe how it sells.

RULES
- Tag only what the video demonstrably does. A video that uses four moves gets four tags, not twelve. Most videos use between three and seven.
- You are given the transcript and frames. If a claim depends on hearing something and the transcript does not show it, do not tag it.
- H3 (no dead air) means talking from the first frame — check the transcript's first timestamp, not your impression.
- H4 (big first-frame motion) and R3 (every cut starts with something new) are visual: check the frames.
- Do not tag a principle because the video SHOULD have used it. This is a description of what is there.
- reasoning gives one short line per tag naming where it happens. If you cannot say where, drop the tag.`;

export interface TagRun {
  attempted: number;
  tagged: number;
  skipped: number;
  failed: number;
}

interface Candidate {
  assetId: string;
  name: string;
  transcript: string;
  synopsis: string | null;
  hookText: string | null;
}

async function tagOne(client: Anthropic, c: Candidate, frames: Buffer[]): Promise<ToolId[]> {
  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text:
        `AD: ${c.name}\n` +
        `What happens: ${c.synopsis ?? "(none)"}\n` +
        `Opening: ${c.hookText ?? "(none captured)"}\n\n` +
        `TRANSCRIPT:\n${c.transcript.slice(0, 4000)}\n\n` +
        (frames.length
          ? `${frames.length} frames follow, in order across the video.`
          : `No frames available — tag only what the transcript supports.`),
    },
    ...frames.map((f) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.toString("base64") },
    })),
  ];

  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // The toolkit is identical on every call, so it caches across a run.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(TagsSchema) },
  });
  if (msg.stop_reason === "refusal") throw new Error("model declined to tag this creative");
  return (msg.parsed_output?.tools ?? []) as ToolId[];
}

/**
 * Tag the creatives worth tagging, highest spend first.
 *
 * Spend-ordered because tagging is not free and the library is not flat: the
 * top 25 creatives carry 58% of spend, so an interrupted run has still covered
 * the part that matters. Safe to re-run — anything with `toolsAt` set is left
 * alone — and safe to interrupt, since each creative commits as it completes.
 */
export async function tagPrinciples(
  limit: number,
  fetchFrames: (assetId: string) => Promise<Buffer[]>,
): Promise<TagRun> {
  const rows = await db.creativeAsset.findMany({
    where: {
      assetType: "video",
      analysis: { is: { toolsAt: null } },
    },
    select: {
      id: true,
      name: true,
      adIds: true,
      analysis: { select: { transcript: true, synopsis: true, hookText: true } },
    },
  });

  // Order by spend across the creative's ads, so a partial run covers the money.
  const spend = await db.metaInsightDaily.groupBy({
    by: ["entityId"],
    where: { level: "ad" },
    _sum: { spend: true },
  });
  const spendByAd = new Map(spend.map((s) => [s.entityId, Number(s._sum.spend ?? 0)]));
  const ranked = rows
    .map((r) => ({ r, spend: r.adIds.reduce((a, id) => a + (spendByAd.get(id) ?? 0), 0) }))
    .sort((a, b) => b.spend - a.spend);

  const client = new Anthropic();
  let tagged = 0;
  let skipped = 0;
  let failed = 0;
  let attempted = 0;

  for (const { r } of ranked) {
    if (attempted >= limit) break;
    const t = r.analysis?.transcript ?? "";
    if (t.length < USABLE_TRANSCRIPT) {
      // Left untagged rather than tagged empty: toolsAt stays null, which says
      // "not attempted" instead of "uses none of them".
      skipped++;
      continue;
    }
    attempted++;
    try {
      const frames = await fetchFrames(r.id);
      const tools = await tagOne(
        client,
        {
          assetId: r.id,
          name: r.name,
          transcript: t,
          synopsis: r.analysis?.synopsis ?? null,
          hookText: r.analysis?.hookText ?? null,
        },
        frames,
      );
      await db.creativeAnalysis.update({
        where: { assetId: r.id },
        data: { tools, toolsAt: new Date() },
      });
      tagged++;
    } catch (e) {
      failed++;
      console.warn(`tagging failed for ${r.name.slice(0, 40)}: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  return { attempted, tagged, skipped, failed };
}
