// The creative framework for a saved reference video.
//
// A recipe, NOT a script: it abstracts why the example works and the structure
// that carries it, shows where Fleur's product plugs in (with compliance baked
// in), and explicitly leaves the words/setting/personality to the creator. This
// gives direction without dictating a performance — the thing that keeps UGC
// authentic. Generated once per video (it's about the video + Fleur, not the
// user) and cached on ReferenceAsset.
//
// Beats carry numeric in/out points so the app can loop one section of the clip
// at a time — a creator studies 0-3s on repeat, then 3-8s, and so on. Those are
// also the natural unit of recording later: a creator shoots section by section
// and stitches, so the same boundaries drive both studying and filming.

import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { labelFor } from "@/lib/creative/taxonomy";

const MODEL = "claude-sonnet-4-6";

export interface Beat {
  time: string; // display label, e.g. "0–3s"
  /** In/out points for looping this section. Always present. */
  startSec: number;
  endSec: number;
  job: string; // what this beat accomplishes
  detail: string; // how, in Fleur terms — direction, not lines
  /** What the reference creator actually said in this window, when the clip has
   *  a timed transcript. The real words are most of the study value. */
  says?: string;
}

export interface Framework {
  whyItWorks: string; // the strategic move, one line
  beats: Beat[]; // the transferable structure
  hookOptions: string[]; // 2–3 opener directions for Fleur (not full scripts)
  fleurAngle: string; // where Bloom's story slots in
  yourCanvas: string; // what's the creator's to decide
  compliance: string[]; // guardrails for this specific idea
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

/** Whisper-style transcripts are stored as JSON with per-segment timings for
 *  most of the corpus; the rest is plain text (or nothing). */
function parseSegments(transcript: string | null): Segment[] {
  if (!transcript) return [];
  try {
    const j = JSON.parse(transcript) as { segments?: unknown };
    if (!Array.isArray(j.segments)) return [];
    return j.segments
      .map((s) => s as Record<string, unknown>)
      .filter((s) => typeof s.start === "number" && typeof s.end === "number")
      .map((s) => ({ start: s.start as number, end: s.end as number, text: String(s.text ?? "").trim() }));
  } catch {
    return [];
  }
}

/** Plain text for the prompt, whether the transcript is timed or not. */
function transcriptText(transcript: string | null, segs: Segment[]): string {
  if (segs.length) return segs.map((s) => s.text).join(" ");
  return transcript ?? "";
}

/** "0–3s", "3-8s", "20s+" → [start, end]. Legacy frameworks only carry these. */
function labelToRange(label: string): [number, number] | null {
  const nums = label.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  if (nums.length === 1) return [Number(nums[0]), Number(nums[0]) + 3];
  return [Number(nums[0]), Number(nums[1])];
}

const fmtLabel = (a: number, b: number) => `${Math.round(a)}–${Math.round(b)}s`;

/**
 * Force the beats into a clean, gapless, in-order set of sections covering the
 * clip. The model is good at structure and loose with arithmetic, so this is
 * where correctness is enforced rather than hoped for.
 */
function normaliseBeats(beats: Beat[], duration: number, segs: Segment[]): Beat[] {
  if (beats.length === 0) return beats;
  const total = duration > 0 ? duration : (segs.at(-1)?.end ?? 0);

  const out = beats.map((b, i) => {
    let start = Number.isFinite(b.startSec) ? b.startSec : NaN;
    let end = Number.isFinite(b.endSec) ? b.endSec : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      const parsed = labelToRange(b.time);
      if (parsed) [start, end] = parsed;
    }
    // Last resort: divide the clip evenly so a section player still works.
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      const span = (total || beats.length * 4) / beats.length;
      start = i * span;
      end = (i + 1) * span;
    }
    return { ...b, startSec: Math.max(0, start), endSec: Math.max(0, end) };
  });

  out.sort((a, b) => a.startSec - b.startSec);

  // Snap to sentence boundaries where we have them: a loop that cuts mid-word
  // is unusable for study.
  const snap = (t: number) => {
    if (!segs.length) return t;
    const edges = [segs[0].start, ...segs.map((s) => s.end)];
    let best = t;
    let bestGap = Infinity;
    for (const e of edges) {
      const gap = Math.abs(e - t);
      if (gap < bestGap) {
        bestGap = gap;
        best = e;
      }
    }
    return bestGap <= 1.2 ? best : t;
  };

  for (let i = 0; i < out.length; i++) {
    out[i].startSec = i === 0 ? 0 : out[i - 1].endSec;
    out[i].endSec = snap(out[i].endSec);
    // Every section must be playable.
    if (out[i].endSec - out[i].startSec < 0.8) out[i].endSec = out[i].startSec + 0.8;
    if (total > 0) out[i].endSec = Math.min(out[i].endSec, total);
  }
  if (total > 0) out[out.length - 1].endSec = total;

  return out.map((b) => ({
    ...b,
    time: fmtLabel(b.startSec, b.endSec),
    says:
      segs
        .filter((s) => s.end > b.startSec + 0.05 && s.start < b.endSec - 0.05)
        .map((s) => s.text)
        .join(" ")
        .slice(0, 400) || undefined,
  }));
}

const SYSTEM = `You are a creative director briefing a UGC creator for Fleur, a DTC hair and scalp serum brand. The product is Bloom: a water-based leave-in serum with six clinical peptides including GHK-Cu, sold mainly on subscription.

You are given a COMPETITOR/REFERENCE ad. Your job is to turn it into a reusable FRAMEWORK the creator can remake for Fleur — a recipe, not a script.

Hard rules:
- Give STRUCTURE and DIRECTION, never a word-for-word script. The creator supplies the exact words, setting and personality — that authenticity is the point.
- Ground everything in what actually happens in THIS example, then translate it to Bloom.
- Compliance is absolute: NEVER suggest mentioning injectables, injections, needles, syringes or GLP-1 drugs; NEVER promise or imply guaranteed regrowth or treating a diagnosed condition. Use "supports/helps thicker-looking hair", not medical claims. If the example itself makes such claims, tell the creator what to do INSTEAD.
- Keep it concrete and short. A creator should be able to shoot from it today.

BEATS ARE SECTIONS OF THE CLIP. The creator studies one section on loop, then films it, then moves to the next — so the beats must tile the whole clip in order, with startSec/endSec in seconds:
- The first beat starts at 0 and the last ends at the clip's length.
- No gaps and no overlaps: each beat's startSec equals the previous beat's endSec.
- 3 to 6 beats. Each at least 1.5s — a section shorter than that can't be studied or filmed.
- Cut where the MEANING changes (hook → stakes → proof → payoff), not on a fixed grid. Use the timed transcript when one is given.

Reply with ONLY a JSON object in exactly this shape, no prose or markdown:
{
  "whyItWorks": "one sentence: the strategic move that makes this example work",
  "beats": [{"time":"0–3s","startSec":0,"endSec":3,"job":"what this beat does","detail":"how to do it for Bloom — direction, not lines"}],
  "hookOptions": ["2–3 distinct ways to open for Bloom, as directions not scripts"],
  "fleurAngle": "where and how Bloom's peptide/ingredient story plugs into this structure",
  "yourCanvas": "what is the creator's to decide — setting, wardrobe, voice, specifics",
  "compliance": ["short reminders specific to this idea"]
}`;

function buildPrompt(a: {
  brand: string;
  synopsis: string | null;
  hookText: string | null;
  transcript: string | null;
  segments: Segment[];
  duration: number;
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
  format: string;
  critique: string | null;
}): string {
  // A timed transcript lets the model cut sections on meaning instead of guessing.
  const timed = a.segments.length
    ? a.segments.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}s] ${s.text}`).join("\n").slice(0, 2500)
    : null;

  return (
    `REFERENCE AD (brand: ${a.brand})\n` +
    `Pillar: ${labelFor("pillar", a.pillar)}\n` +
    `Persona: ${labelFor("persona", a.persona)}\n` +
    `Hook type: ${labelFor("hook", a.hook)}\n` +
    `Funnel: ${a.funnel}\n` +
    `Format: ${labelFor("format", a.format)}\n` +
    `Clip length: ${a.duration > 0 ? `${a.duration.toFixed(1)}s` : "(unknown — infer from the transcript, or assume ~30s)"}\n` +
    `Opening / hook: ${a.hookText || "(none captured)"}\n` +
    `What happens: ${a.synopsis || "(none)"}\n` +
    `Strategist note: ${a.critique || "(none)"}\n` +
    (timed
      ? `Timed transcript — cut your beats on these boundaries:\n${timed}\n\n`
      : `Transcript (may be partial, no timings — estimate section boundaries): ${(a.transcript || "(silent / none)").slice(0, 1500)}\n\n`) +
    `Produce the framework JSON.`
  );
}

const clampStr = (v: unknown, n = 600) => (typeof v === "string" ? v.slice(0, n) : "");
const strArr = (v: unknown, n = 6) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 400)).slice(0, n) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

// Sectioned beats carry in/out points and more of them, so a framework now runs
// ~1700 output tokens. At the old 1500 ceiling the reply was severed mid-object
// and the JSON simply never parsed — three clips in four failed that way.
const MAX_TOKENS = 4000;
const MAX_TOKENS_RETRY = 8000;

async function generate(prompt: string, duration: number, segs: Segment[]): Promise<Framework> {
  const client = new Anthropic();
  let lastStop: string | null = null;

  const ask = async (nudge?: string, maxTokens: number = MAX_TOKENS) => {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      messages: nudge
        ? [{ role: "user", content: prompt }, { role: "assistant", content: "{" }, { role: "user", content: nudge }]
        : [{ role: "user", content: prompt }],
    });
    lastStop = msg.stop_reason;
    return msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
  };

  const parse = (text: string): Record<string, unknown> | null => {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  let raw = parse(await ask());
  // A truncated reply is a budget problem, not a formatting one — retry bigger.
  if (!raw) raw = parse(await ask("Reply again with ONLY the complete JSON object, no prose.", MAX_TOKENS_RETRY));
  if (!raw) throw new Error(`Framework generation did not return valid JSON (stop_reason: ${lastStop})`);

  const beatsRaw = Array.isArray(raw.beats) ? raw.beats : [];
  const beats: Beat[] = beatsRaw.slice(0, 8).map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return {
      time: clampStr(o.time, 20),
      startSec: num(o.startSec),
      endSec: num(o.endSec),
      job: clampStr(o.job, 200),
      detail: clampStr(o.detail, 400),
    };
  });

  return {
    whyItWorks: clampStr(raw.whyItWorks, 400),
    beats: normaliseBeats(beats, duration, segs),
    hookOptions: strArr(raw.hookOptions),
    fleurAngle: clampStr(raw.fleurAngle, 800),
    yourCanvas: clampStr(raw.yourCanvas, 800),
    compliance: strArr(raw.compliance),
  };
}

/** Return the cached framework, generating and caching it on first request. */
export async function getOrCreateFramework(assetId: string): Promise<Framework> {
  const asset = await db.referenceAsset.findUnique({ where: { id: assetId }, include: { analysis: true } });
  if (!asset) throw new Error("asset not found");

  const segments = parseSegments(asset.transcript);
  // durationSec isn't populated across the corpus; the transcript's last segment
  // is the only server-side length we have. The player knows the real one.
  const duration = asset.durationSec ?? segments.at(-1)?.end ?? 0;

  if (asset.framework) {
    const cached = asset.framework as unknown as Framework;
    const timed = cached.beats?.every((b) => Number.isFinite(b.startSec) && Number.isFinite(b.endSec));
    if (timed) return cached;
    // Frameworks cached before sections existed: derive the in/out points from
    // their "0–3s" labels rather than paying for a regeneration.
    const upgraded: Framework = { ...cached, beats: normaliseBeats(cached.beats ?? [], duration, segments) };
    await db.referenceAsset
      .update({ where: { id: assetId }, data: { framework: upgraded as unknown as Prisma.InputJsonValue } })
      .catch(() => {});
    return upgraded;
  }

  if (!asset.analysis) throw new Error("asset has no analysis to build a framework from");

  const fw = await generate(
    buildPrompt({
      brand: asset.advertiserName ?? "the brand",
      synopsis: asset.analysis.synopsis,
      hookText: asset.analysis.hookText,
      transcript: transcriptText(asset.transcript, segments) || null,
      segments,
      duration,
      pillar: asset.analysis.pillar,
      persona: asset.analysis.persona,
      hook: asset.analysis.hook,
      funnel: asset.analysis.funnel,
      format: asset.analysis.format,
      critique: asset.analysis.critique,
    }),
    duration,
    segments,
  );

  await db.referenceAsset.update({
    where: { id: assetId },
    data: { framework: fw as unknown as Prisma.InputJsonValue, frameworkAt: new Date() },
  });
  return fw;
}
