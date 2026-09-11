// The creative framework for a saved reference video.
//
// A recipe, NOT a script: it abstracts why the example works and the structure
// that carries it, shows where Fleur's product plugs in (with compliance baked
// in), and explicitly leaves the words/setting/personality to the creator. This
// gives direction without dictating a performance — the thing that keeps UGC
// authentic. Generated once per video (it's about the video + Fleur, not the
// user) and cached on ReferenceAsset.

import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { labelFor } from "@/lib/creative/taxonomy";

const MODEL = "claude-sonnet-4-6";

export interface Beat {
  time: string; // e.g. "0–3s"
  job: string; // what this beat accomplishes
  detail: string; // how, in Fleur terms — direction, not lines
}

export interface Framework {
  whyItWorks: string; // the strategic move, one line
  beats: Beat[]; // the transferable structure
  hookOptions: string[]; // 2–3 opener directions for Fleur (not full scripts)
  fleurAngle: string; // where Bloom's story slots in
  yourCanvas: string; // what's the creator's to decide
  compliance: string[]; // guardrails for this specific idea
}

const SYSTEM = `You are a creative director briefing a UGC creator for Fleur, a DTC hair and scalp serum brand. The product is Bloom: a water-based leave-in serum with six clinical peptides including GHK-Cu, sold mainly on subscription.

You are given a COMPETITOR/REFERENCE ad. Your job is to turn it into a reusable FRAMEWORK the creator can remake for Fleur — a recipe, not a script.

Hard rules:
- Give STRUCTURE and DIRECTION, never a word-for-word script. The creator supplies the exact words, setting and personality — that authenticity is the point.
- Ground everything in what actually happens in THIS example, then translate it to Bloom.
- Compliance is absolute: NEVER suggest mentioning injectables, injections, needles, syringes or GLP-1 drugs; NEVER promise or imply guaranteed regrowth or treating a diagnosed condition. Use "supports/helps thicker-looking hair", not medical claims. If the example itself makes such claims, tell the creator what to do INSTEAD.
- Keep it concrete and short. A creator should be able to shoot from it today.

Reply with ONLY a JSON object in exactly this shape, no prose or markdown:
{
  "whyItWorks": "one sentence: the strategic move that makes this example work",
  "beats": [{"time":"0–3s","job":"what this beat does","detail":"how to do it for Bloom — direction, not lines"}],
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
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
  format: string;
  critique: string | null;
}): string {
  return (
    `REFERENCE AD (brand: ${a.brand})\n` +
    `Pillar: ${labelFor("pillar", a.pillar)}\n` +
    `Persona: ${labelFor("persona", a.persona)}\n` +
    `Hook type: ${labelFor("hook", a.hook)}\n` +
    `Funnel: ${a.funnel}\n` +
    `Format: ${labelFor("format", a.format)}\n` +
    `Opening / hook: ${a.hookText || "(none captured)"}\n` +
    `What happens: ${a.synopsis || "(none)"}\n` +
    `Strategist note: ${a.critique || "(none)"}\n` +
    `Transcript (may be partial): ${(a.transcript || "(silent / none)").slice(0, 1500)}\n\n` +
    `Produce the framework JSON.`
  );
}

const clampStr = (v: unknown, n = 600) => (typeof v === "string" ? v.slice(0, n) : "");
const strArr = (v: unknown, n = 6) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 400)).slice(0, n) : []);

async function generate(prompt: string): Promise<Framework> {
  const client = new Anthropic();
  const ask = async (nudge?: string) => {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: nudge
        ? [{ role: "user", content: prompt }, { role: "assistant", content: "{" }, { role: "user", content: nudge }]
        : [{ role: "user", content: prompt }],
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
  if (!raw) raw = parse(await ask("Reply again with ONLY the complete JSON object, no prose."));
  if (!raw) throw new Error("Framework generation did not return valid JSON");

  const beatsRaw = Array.isArray(raw.beats) ? raw.beats : [];
  const beats: Beat[] = beatsRaw.slice(0, 8).map((b) => {
    const o = (b ?? {}) as Record<string, unknown>;
    return { time: clampStr(o.time, 20), job: clampStr(o.job, 200), detail: clampStr(o.detail, 400) };
  });

  return {
    whyItWorks: clampStr(raw.whyItWorks, 400),
    beats,
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
  if (asset.framework) return asset.framework as unknown as Framework;
  if (!asset.analysis) throw new Error("asset has no analysis to build a framework from");

  const fw = await generate(
    buildPrompt({
      brand: asset.advertiserName ?? "the brand",
      synopsis: asset.analysis.synopsis,
      hookText: asset.analysis.hookText,
      transcript: asset.transcript,
      pillar: asset.analysis.pillar,
      persona: asset.analysis.persona,
      hook: asset.analysis.hook,
      funnel: asset.analysis.funnel,
      format: asset.analysis.format,
      critique: asset.analysis.critique,
    }),
  );

  await db.referenceAsset.update({
    where: { id: assetId },
    data: { framework: fw as unknown as Prisma.InputJsonValue, frameworkAt: new Date() },
  });
  return fw;
}
