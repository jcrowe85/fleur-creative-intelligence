// Creator briefs: the format from Creator-Briefs-Dev-Handoff, generated here.
//
// This sits ALONGSIDE framework.ts rather than replacing it. Four things read
// the old Framework — the framework route, the save route's pre-warm, chat.ts
// and SwipeClient.tsx — and swapping the shape under all of them at once would
// be one large untestable change. Both live in ReferenceAsset.framework, which
// is Json?, and CreatorBrief carries `version: 1` while every framework written
// before this does not. That field is what tells them apart, so each consumer
// can move over on its own and move back if it needs to.
//
// What differs from the handoff spec, deliberately:
//   - The spec sends two tiled contact sheets. This app has no tiling step, but
//     creative/analyze.ts already extracts 8 frames reliably and that path is
//     proven against thousands of assets, so it sends those instead.
//   - The spec reads product facts from a file or database. They are inlined in
//     prompts.ts for now (fs reads are not reliably traced into a Vercel
//     bundle); PRODUCT_FACTS is exported separately so a database override is a
//     small change here and nowhere else.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { extractFrames } from "@/lib/creative/analyze";
import { downloadAsset } from "@/lib/creative/ingest";
import { assembleBrief, checkBrief, LIMITS, type CreatorBrief, type CreatorBriefDraft } from "./creator-brief";
import { CreatorBriefDraftSchema } from "./creator-brief.zod";
import { BRIEF_SYSTEM, PRODUCT_FACTS } from "./prompts";

const MODEL = "claude-opus-5";
/** The spec's budget. A brief runs long: 27 tools, 4–7 sections, 3–5 loops. */
const MAX_TOKENS = 16000;

interface Segment {
  start: number;
  end: number;
  text: string;
}

/** Whisper-style transcripts are stored as JSON with per-segment timings for
 *  most of the corpus; the rest is plain text (or nothing). Same shape
 *  framework.ts parses — kept local so that file can be retired independently. */
function parseSegments(transcript: string | null): Segment[] {
  if (!transcript) return [];
  try {
    const j = JSON.parse(transcript) as { segments?: unknown };
    if (!Array.isArray(j.segments)) return [];
    return j.segments
      .map((s) => s as Record<string, unknown>)
      .filter((s) => typeof s.start === "number" && typeof s.end === "number")
      .map((s) => ({
        start: s.start as number,
        end: s.end as number,
        text: String(s.text ?? "").trim(),
      }));
  } catch {
    return [];
  }
}

/** The words spoken inside one section, for assembleBrief's `saysFor`. The real
 *  words are most of the study value, so they are attached server-side rather
 *  than asked of the model, which would only paraphrase them. */
function saysFactory(segs: Segment[]) {
  return (startSec: number, endSec: number): string | undefined =>
    segs
      .filter((s) => s.end > startSec + 0.05 && s.start < endSec - 0.05)
      .map((s) => s.text)
      .join(" ")
      .slice(0, 400) || undefined;
}

function buildUserText(a: {
  durationSec: number;
  language: string | null;
  transcript: string | null;
  segments: Segment[];
  synopsis: string | null;
  hookText: string | null;
  frames: number;
}): string {
  const timed = a.segments.length
    ? a.segments
        .map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}s] ${s.text}`)
        .join("\n")
        .slice(0, 6000)
    : null;

  return (
    `REFERENCE VIDEO\n` +
    `Length: ${a.durationSec > 0 ? `${a.durationSec.toFixed(1)}s` : "(unknown — infer from the transcript)"}\n` +
    `Detected language: ${a.language ?? "(unknown)"}\n` +
    `What happens: ${a.synopsis ?? "(none)"}\n` +
    `Opening: ${a.hookText ?? "(none captured)"}\n\n` +
    (timed
      ? `TIMED TRANSCRIPT — cut your sections on these boundaries:\n${timed}\n\n`
      : `TRANSCRIPT (no timings; estimate section boundaries): ${(a.transcript ?? "(silent / none)").slice(0, 3000)}\n\n`) +
    (a.frames > 0
      ? `${a.frames} frames follow, in order across the whole video. Confirm the cuts on them — cut detection misses jump cuts filmed in the same spot.\n`
      : `No frames are available for this video; work from the transcript and treat anything visual as unconfirmed.\n`) +
    // Per-field targets measured off the finished briefs in the handoff, not a
    // total to divide up. Those run 266-331 words by the checker's count with
    // 5-6 sections and 4-5 loops — the same structure this was producing at 630
    // words. The difference was never structural: every field averaged about
    // twice the spec's words per item, uniformly, which is invisible when each
    // line still reads as "short" on its own.
    // The counts have to respect the checker's short-video rule: checkBrief
    // requires 3–4 sections and 2–3 loops under LIMITS.shortVideoSec, against
    // 4–7 and 3–5 above it. Stating one set unconditionally guaranteed an error
    // on every short clip, and the spec's own corpus includes a 14.3s one.
    //
    // The long-form figures quoted are the tighter range the finished examples
    // actually occupy (4–6 sections, 3–5 loops), not the checker's outer
    // bounds, so the model aims at the corpus rather than at the limit. Quoting
    // "5–6" as I first did would push it to pad a video with four real sections.
    `\nHOW THESE ARE WRITTEN. Finished briefs run 266–331 words with ` +
    (a.durationSec > 0 && a.durationSec < LIMITS.shortVideoSec
      ? `3–4 sections and 2–3 loops (this video is under ${LIMITS.shortVideoSec}s)`
      : `4–6 sections and 3–5 loops`) +
    ` — the same shape you are writing. They fit because the register is notes, not prose. ` +
    `Fragments. No subject, no verb where the thing speaks for itself. Real briefs read like this:\n` +
    `  keep:  advice → new problem → Fleur as the answer → price with a reason   (4 steps, 11 words)\n` +
    `  did:   silent lab pour + "Real copper peptides are blue"   (8 words)\n` +
    `  why:   striking visual, text carries it, real footage builds trust   (9 words)\n` +
    `  loop:  "What is that blue stuff?" → others have the wrong colour   (5 words each side)\n` +
    `  check: no "sale" unless one is live   (6 words)\n` +
    `Targets: did and why ~7 words, loop sides ~5, keep steps 1–4 words, check 2–4 lines total, ` +
    `ideas and whyLoopsWork ~11 — those two earn their length. ` +
    `Say the thing and stop; the second clause is almost always the one to cut.\n\n` +
    `Write the brief.`
  );
}

async function generate(
  userText: string,
  frames: Buffer[],
  durationSec: number,
  segs: Segment[],
  referenceBrand: string | null,
): Promise<{ brief: CreatorBrief; issues: string[] }> {
  const client = new Anthropic();

  const content: Anthropic.MessageParam["content"] = [
    { type: "text", text: userText },
    ...frames.map((f) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/jpeg" as const, data: f.toString("base64") },
    })),
  ];

  const ask = async (repair?: { previous: CreatorBriefDraft; instruction: string }) => {
    const msg = await client.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Both blocks are stable across every brief, so they cache. The product
      // facts are their own block: when they change, only that block's cache
      // is invalidated.
      system: [
        { type: "text", text: BRIEF_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `FLEUR PRODUCT FACTS\n\n${PRODUCT_FACTS}`, cache_control: { type: "ephemeral" } },
      ],
      // A repair has to show the model its own draft back. The first version of
      // this sent two consecutive user turns, so the model never saw what it
      // had written and simply generated afresh against rules it could not see
      // itself breaking — a 630-word brief stayed 630 words.
      messages: repair
        ? [
            { role: "user", content },
            { role: "assistant", content: JSON.stringify(repair.previous) },
            { role: "user", content: repair.instruction },
          ]
        : [{ role: "user", content }],
      // `output_config.format`, not the older `output_format`: the API now
      // rejects the latter outright, and the SDK's auto-parser reads the schema
      // from here (lib/parser.js) to populate parsed_output. The old field
      // still type-checks because the params type is permissive, so this is a
      // mistake the compiler cannot catch — only a real request can.
      output_config: { format: zodOutputFormat(CreatorBriefDraftSchema) },
    });
    // A refusal has no parsed output; reading it would throw something opaque.
    if (msg.stop_reason === "refusal") {
      throw new Error("The model declined to write a brief for this video");
    }
    return msg.parsed_output as CreatorBriefDraft | null;
  };

  const draft = await ask();
  if (!draft) throw new Error("Brief generation returned no structured output");

  let brief = assembleBrief(draft, durationSec, saysFactory(segs));
  const check = checkBrief(brief, { referenceBrand: referenceBrand ?? undefined });
  let issues = check.issues;
  let errors = issues.filter((i) => i.level === "error");
  let words = check.words;

  // One repair pass. The checker exists to be acted on, and the common failures
  // — over the word count, too many sections, a claim on the hold list — are
  // exactly what a model fixes when shown its own draft and told what it broke.
  if (errors.length > 0) {
    const overBy = check.words - LIMITS.maxWords;
    const retry = await ask({
      previous: draft,
      instruction:
        `That brief breaks these rules. Return the whole brief again, fixed:\n` +
        errors.map((e) => `- ${e.where}: ${e.message}`).join("\n") +
        (overBy > 0
          ? `\n\nIt is ${check.words} words and the limit is 350, so roughly ${overBy} words have to go. ` +
            `Keep every section, loop and swap — cut length inside them. One short line each, no second clause.`
          : ""),
    });
    if (retry) {
      const repaired = assembleBrief(retry, durationSec, saysFactory(segs));
      const after = checkBrief(repaired, { referenceBrand: referenceBrand ?? undefined });
      const afterErrors = after.issues.filter((i) => i.level === "error");
      // Fewer errors, OR the same errors but materially shorter. Comparing the
      // error COUNT alone silently binned good repairs: over-length is a single
      // error whether a brief is 551 words or 380, so cutting 171 words never
      // moved the count and the improvement was thrown away every time.
      const better =
        afterErrors.length < errors.length ||
        (afterErrors.length === errors.length && after.words < words);
      // Logged because the repair is otherwise invisible — runtime alone cannot
      // tell a repair that fired from one that never ran.
      console.warn(
        `brief repair: ${words}w/${errors.length}e -> ${after.words}w/${afterErrors.length}e — ${better ? "kept" : "discarded"}`,
      );
      if (better) {
        brief = repaired;
        issues = after.issues;
        errors = afterErrors;
        words = after.words;
      }
    }
  }

  // A brief that is 12 words over is still worth reading, so this returns rather
  // than throws — but it says so, and the caller logs it.
  return { brief, issues: issues.map((i) => `${i.level}: ${i.where} — ${i.message}`) };
}

/** True when a cached value is a CreatorBrief rather than a legacy Framework. */
export function isCreatorBrief(v: unknown): v is CreatorBrief {
  return typeof v === "object" && v !== null && (v as { version?: unknown }).version === 1;
}

/**
 * Return the cached brief, generating and caching it on first request.
 *
 * Deliberately does NOT overwrite a legacy Framework that is still cached:
 * `force` has to be passed. Frameworks are what the creator app renders today,
 * and silently replacing them would change what creators see before the UI
 * knows how to read the new shape.
 */
export async function getOrCreateBrief(assetId: string, force = false): Promise<CreatorBrief> {
  const asset = await db.referenceAsset.findUnique({
    where: { id: assetId },
    include: { analysis: true },
  });
  if (!asset) throw new Error("asset not found");

  if (!force && isCreatorBrief(asset.framework)) return asset.framework as unknown as CreatorBrief;

  const segments = parseSegments(asset.transcript);
  // durationSec isn't populated across the corpus; the transcript's last segment
  // is the only length available server-side.
  const durationSec = asset.durationSec ?? segments.at(-1)?.end ?? 0;

  let frames: Buffer[] = [];
  if (asset.mediaUrl) {
    try {
      frames = await extractFrames(await downloadAsset(asset.mediaUrl));
    } catch (e) {
      // A brief from transcript alone is weaker but still useful; the prompt is
      // told the frames are missing so it doesn't assert anything visual.
      console.warn(`brief: no frames for ${assetId} — ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const userText = buildUserText({
    durationSec,
    language: null,
    transcript: segments.length ? null : asset.transcript,
    segments,
    synopsis: asset.analysis?.synopsis ?? null,
    hookText: asset.analysis?.hookText ?? null,
    frames: frames.length,
  });

  const { brief, issues } = await generate(
    userText,
    frames,
    durationSec,
    segments,
    asset.advertiserName,
  );
  if (issues.length > 0) {
    console.warn(`brief ${assetId}: ${issues.length} unresolved issue(s) — ${issues.slice(0, 3).join(" | ")}`);
  }

  await db.referenceAsset.update({
    where: { id: assetId },
    data: { framework: brief as unknown as Prisma.InputJsonValue, frameworkAt: new Date() },
  });
  return brief;
}
