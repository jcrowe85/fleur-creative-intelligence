// Video → structured creative classification.
//
// Pipeline: sample frames with ffmpeg, transcribe the audio, hand both plus the
// ad's own copy to Claude, and get back a classification against
// `taxonomy.ts` with reasoning and quality scores.
//
// Frames matter as much as the transcript. A lot of Fleur's best assets are
// silent or near-silent with burned-in text, so a transcript-only read
// misclassifies them — and the hook, format, production style and placement fit
// are all visual facts that no transcript carries.

import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import {
  AWARENESS_STAGES,
  FORMATS,
  FUNNEL_STAGES,
  HOOK_TYPES,
  PERSONAS,
  PILLARS,
  PLACEMENT_FITS,
  PRODUCTION_STYLES,
  type TaxonomyTerm,
} from "./taxonomy";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");
const execFileAsync = promisify(execFile);

/** Frames sampled per video. Enough to see the hook, the middle and the payoff
 *  without blowing the vision token budget — each frame costs ~1.1k tokens. */
const FRAME_COUNT = 8;
/** Long edge in px. Claude downsamples above ~1568px, so anything larger is
 *  wasted upload. */
const FRAME_LONG_EDGE = 768;

export interface AnalysisInput {
  /** Raw video bytes. Omit for static-image assets and pass `imageBuffer`. */
  videoBuffer?: Buffer;
  /** Single still, for image ads. */
  imageBuffer?: Buffer;
  /** Ad name as it appears in Meta — often carries creator and date. */
  adName?: string;
  /** The ad's own copy, which is part of the creative and must be classified with it. */
  headline?: string;
  primaryText?: string;
  /** Where the ad sends people; a VSL lander implies a different job to a PDP. */
  destinationUrl?: string;
}

export interface AxisPick<T extends string = string> {
  id: T;
  confidence: number; // 0–1
  reasoning: string;
}

export interface CreativeAnalysis {
  transcript: string;
  /** One-paragraph plain description of what actually happens in the asset. */
  synopsis: string;
  /** The literal opening line or on-screen text of the first ~2 seconds. */
  hookText: string;

  pillar: AxisPick;
  secondaryPillar: AxisPick | null;
  persona: AxisPick;
  hook: AxisPick;
  funnel: AxisPick;
  awareness: AxisPick;
  format: AxisPick;
  production: AxisPick;
  placementFit: AxisPick;

  /** 1–5 subjective craft scores. Explicitly not performance predictions. */
  scores: {
    hookStrength: number;
    messageClarity: number;
    /** How hard this would be for a competitor to replicate. */
    differentiation: number;
    productionQuality: number;
    /** Built for the surface, or repurposed and dropped in. */
    placementNativeness: number;
  };

  /** Claims that could trip Meta health policy or Fleur's own standing rules. */
  complianceFlags: string[];
  /** What a strategist would say about this asset in one line. */
  critique: string;
  /** Concrete adjacent territories this asset does *not* cover. */
  suggestedAdjacent: string[];
}

// ── Media handling ────────────────────────────────────────────────────────────

/**
 * Duration via ffmpeg's own stderr on a null-muxer pass. ffprobe is not a
 * dependency here, and ffmpeg-static ships only the one binary.
 */
async function videoDurationSeconds(path: string): Promise<number> {
  try {
    await execFileAsync(ffmpegPath, ["-i", path, "-f", "null", "-"]);
  } catch (e) {
    const err = e as { stderr?: string };
    const m = err.stderr?.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  }
  return 0;
}

/**
 * Samples frames across the video. Deliberately front-loaded: the first two
 * seconds decide whether an ad is watched at all, so two frames come out of
 * that window regardless of length.
 */
export async function extractFrames(videoBuf: Buffer): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), "creative-frames-"));
  const videoPath = join(dir, "video.mp4");
  try {
    await writeFile(videoPath, videoBuf);
    const duration = await videoDurationSeconds(videoPath);

    // Two early frames (0.3s, 1.2s) then evenly spaced across the remainder.
    const stamps: number[] =
      duration > 3
        ? [0.3, 1.2, ...Array.from({ length: FRAME_COUNT - 2 }, (_, i) =>
            2 + ((duration - 2.5) * (i + 0.5)) / (FRAME_COUNT - 2))]
        : Array.from({ length: FRAME_COUNT }, (_, i) =>
            (Math.max(duration, 0.5) * (i + 0.5)) / FRAME_COUNT);

    await Promise.all(
      stamps.map((t, i) =>
        execFileAsync(ffmpegPath, [
          "-y",
          "-ss", t.toFixed(2),
          "-i", videoPath,
          "-frames:v", "1",
          "-vf", `scale='min(${FRAME_LONG_EDGE},iw)':-2`,
          "-q:v", "4",
          join(dir, `f${String(i).padStart(2, "0")}.jpg`),
        ]).catch(() => undefined), // a stamp past EOF is not fatal
      ),
    );

    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    return await Promise.all(files.map((f) => readFile(join(dir, f))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whisper transcription. Returns "" for silent assets rather than throwing —
 *  a silent ad is a legitimate creative choice, not an error. */
export async function transcribeVideo(videoBuf: Buffer): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return "";
  const dir = await mkdtemp(join(tmpdir(), "creative-audio-"));
  const videoPath = join(dir, "video.mp4");
  const audioPath = join(dir, "audio.mp3");
  try {
    await writeFile(videoPath, videoBuf);
    await execFileAsync(ffmpegPath, [
      "-y", "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
      audioPath,
    ]);
    const audioBuf = await readFile(audioPath);
    if (audioBuf.byteLength < 2000) return "";
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audioBuf)], { type: "audio/mpeg" }),
      "audio.mp3",
    );
    form.append("model", "whisper-1");
    form.append("response_format", "json");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) return "";
    return ((await r.json()) as { text?: string }).text?.trim() ?? "";
  } catch {
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const renderAxis = (name: string, terms: readonly TaxonomyTerm[]) =>
  `${name}:\n` +
  terms
    .map((t) => `  ${t.id} — ${t.label}: ${t.definition}${t.example ? ` e.g. "${t.example}"` : ""}`)
    .join("\n");

const SYSTEM = `You classify advertising creative for Fleur, a DTC hair and scalp serum brand. The product is Bloom: a water-based leave-in serum with six clinical peptides including GHK-Cu, sold mainly on subscription.

Your job is to place each asset in a creative taxonomy so the team can see which territories they have covered and which they have not. This exists because Meta's Andromeda retrieval stage selects ad candidates from a jointly-trained hierarchical index — near-duplicate creatives land in the same region of that index and compete with each other, while genuinely distinct creatives make the account retrievable for a wider set of queries. So the classification must reflect what actually makes one asset *different* from another, not just what it is nominally about.

Rules:
- Judge what is in the asset, not what you assume about the brand. If it is silent, say so and classify from the visuals and on-screen text.
- The ad copy (headline, primary text) is part of the creative. Classify the asset and its copy together.
- Pick the SINGLE best id for each axis. Use the secondary pillar only when a genuinely different second territory is present — otherwise null.
- Confidence is honest: 0.9+ only when unambiguous, below 0.5 when guessing.
- Scores are craft judgements on a 1–5 scale, NOT predictions of performance. Do not infer performance.
- complianceFlags: list any claim that risks Meta health policy or Fleur's standing rules. Fleur NEVER mentions injectables, injections, needles, syringes, or GLP-1 drug names — flag any such reference. Also flag guarantees of regrowth, before/after implying medical treatment, and claims to treat a diagnosed condition.
- suggestedAdjacent: 2–3 specific, briefable territories this asset does NOT occupy, phrased as a concrete creative idea, not a category name.

Reply with ONLY a JSON object matching the requested schema. No prose, no markdown fences.`;

function buildTaxonomyBlock(): string {
  return [
    renderAxis("PILLAR (the conceptual territory — the reason to care)", PILLARS),
    renderAxis("PERSONA (who the creative addresses; 'none' is a valid and common answer)", PERSONAS),
    renderAxis("HOOK (mechanism of the first 1-3 seconds)", HOOK_TYPES),
    renderAxis("FUNNEL", FUNNEL_STAGES),
    renderAxis("AWARENESS (Schwartz stage the copy assumes)", AWARENESS_STAGES),
    renderAxis("FORMAT (how it is constructed)", FORMATS),
    renderAxis("PRODUCTION (finish and style)", PRODUCTION_STYLES),
    renderAxis("PLACEMENT_FIT (built for the surface, or dropped in)", PLACEMENT_FITS),
  ].join("\n\n");
}

const SCHEMA_HINT = `{
  "synopsis": "one paragraph, what literally happens",
  "hookText": "the opening line or first on-screen text, verbatim",
  "pillar": {"id": "...", "confidence": 0.0, "reasoning": "one sentence"},
  "secondaryPillar": null,
  "persona": {"id": "...", "confidence": 0.0, "reasoning": "..."},
  "hook": {"id": "...", "confidence": 0.0, "reasoning": "..."},
  "funnel": {"id": "TOF|MOF|BOF", "confidence": 0.0, "reasoning": "..."},
  "awareness": {"id": "...", "confidence": 0.0, "reasoning": "..."},
  "format": {"id": "...", "confidence": 0.0, "reasoning": "..."},
  "production": {"id": "...", "confidence": 0.0, "reasoning": "..."},
  "placementFit": {"id": "...", "confidence": 0.0, "reasoning": "..."},
  "scores": {"hookStrength": 1, "messageClarity": 1, "differentiation": 1, "productionQuality": 1, "placementNativeness": 1},
  "complianceFlags": [],
  "critique": "one line a strategist would say",
  "suggestedAdjacent": ["...", "..."]
}`;

// ── Validation ────────────────────────────────────────────────────────────────

const VALID = {
  pillar: new Set(PILLARS.map((t) => t.id)),
  persona: new Set(PERSONAS.map((t) => t.id)),
  hook: new Set(HOOK_TYPES.map((t) => t.id)),
  funnel: new Set(FUNNEL_STAGES.map((t) => t.id)),
  awareness: new Set(AWARENESS_STAGES.map((t) => t.id)),
  format: new Set(FORMATS.map((t) => t.id)),
  production: new Set(PRODUCTION_STYLES.map((t) => t.id)),
  placementFit: new Set(PLACEMENT_FITS.map((t) => t.id)),
} as const;

function coercePick(raw: unknown, valid: Set<string>, fallback: string): AxisPick {
  const o = (raw ?? {}) as Partial<AxisPick>;
  const id = typeof o.id === "string" && valid.has(o.id) ? o.id : fallback;
  const c = Number(o.confidence);
  return {
    id,
    // An id the model invented means the classification failed, not that it was
    // confident — record that honestly rather than inheriting a high number.
    confidence: id === fallback && o.id !== fallback ? 0 : Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0.5)),
    reasoning: typeof o.reasoning === "string" ? o.reasoning.slice(0, 400) : "",
  };
}

const clampScore = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
};

// ── Main entry point ──────────────────────────────────────────────────────────

export async function analyzeCreative(input: AnalysisInput): Promise<CreativeAnalysis> {
  let frames: Buffer[] = [];
  let transcript = "";

  if (input.videoBuffer) {
    // Frames and transcript are independent; run them together.
    const [f, t] = await Promise.all([
      extractFrames(input.videoBuffer),
      transcribeVideo(input.videoBuffer),
    ]);
    frames = f;
    transcript = t;
  } else if (input.imageBuffer) {
    frames = [input.imageBuffer];
  } else {
    throw new Error("analyzeCreative needs videoBuffer or imageBuffer");
  }

  if (frames.length === 0) throw new Error("No frames could be extracted from the asset");

  const client = new Anthropic();
  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text:
        `TAXONOMY\n========\n${buildTaxonomyBlock()}\n\n` +
        `ASSET\n=====\n` +
        `Ad name: ${input.adName || "(none)"}\n` +
        `Headline: ${input.headline || "(none)"}\n` +
        `Primary text: ${input.primaryText || "(none)"}\n` +
        `Destination: ${input.destinationUrl || "(none)"}\n` +
        `Transcript: ${transcript || "(silent or no speech detected)"}\n\n` +
        `${frames.length} frames follow in chronological order; the first two are from the opening ~1.2 seconds.\n\n` +
        `Return JSON in exactly this shape:\n${SCHEMA_HINT}`,
    },
    ...frames.map(
      (b) =>
        ({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: b.toString("base64") },
        }) as const,
    ),
  ];

  // A truncated or malformed object is worth one retry — it is a formatting
  // slip, not a judgement the model cannot make. Re-asking costs one call;
  // abandoning the asset costs it entirely.
  const ask = async (nudge?: string) => {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM,
      messages: nudge
        ? [
            { role: "user", content },
            { role: "assistant", content: "{" },
            { role: "user", content: nudge },
          ]
        : [{ role: "user", content }],
    });
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
  if (!raw) {
    raw = parse(
      await ask(
        "Your previous reply was not valid JSON — it was truncated or malformed. " +
          "Reply again with ONLY the complete JSON object, no prose and no markdown fences. " +
          "Keep every string short so the object closes properly.",
      ),
    );
  }
  if (!raw) throw new Error("Classifier did not return valid JSON after a retry");
  const scores = (raw.scores ?? {}) as Record<string, unknown>;

  const secondaryRaw = raw.secondaryPillar;
  const secondary =
    secondaryRaw && typeof secondaryRaw === "object"
      ? coercePick(secondaryRaw, VALID.pillar, "")
      : null;

  return {
    transcript,
    synopsis: String(raw.synopsis ?? "").slice(0, 2000),
    hookText: String(raw.hookText ?? "").slice(0, 500),
    pillar: coercePick(raw.pillar, VALID.pillar, "problem_solution"),
    secondaryPillar: secondary && secondary.id ? secondary : null,
    persona: coercePick(raw.persona, VALID.persona, "none"),
    hook: coercePick(raw.hook, VALID.hook, "direct_benefit"),
    funnel: coercePick(raw.funnel, VALID.funnel, "MOF"),
    awareness: coercePick(raw.awareness, VALID.awareness, "solution_aware"),
    format: coercePick(raw.format, VALID.format, "talking_head_ugc"),
    production: coercePick(raw.production, VALID.production, "ugc_native"),
    placementFit: coercePick(raw.placementFit, VALID.placementFit, "reels_native"),
    scores: {
      hookStrength: clampScore(scores.hookStrength),
      messageClarity: clampScore(scores.messageClarity),
      differentiation: clampScore(scores.differentiation),
      productionQuality: clampScore(scores.productionQuality),
      placementNativeness: clampScore(scores.placementNativeness),
    },
    complianceFlags: Array.isArray(raw.complianceFlags)
      ? raw.complianceFlags.map(String).slice(0, 10)
      : [],
    critique: String(raw.critique ?? "").slice(0, 600),
    suggestedAdjacent: Array.isArray(raw.suggestedAdjacent)
      ? raw.suggestedAdjacent.map(String).slice(0, 5)
      : [],
  };
}
