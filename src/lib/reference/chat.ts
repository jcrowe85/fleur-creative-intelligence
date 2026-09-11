// System context for the "brainstorm" chat on a saved reference video.
//
// The assistant is grounded in THIS example (its analysis + framework) plus
// Fleur's product and compliance rules, so a creator can ask for a full script,
// an alternate setting, a re-angle for a different persona, a shorter cut, etc.
// — and get answers specific to the video and safe for the brand. Compliance is
// absolute; a generic chatbot can't do this, which is the point.

import { db } from "@/lib/db";
import { labelFor } from "@/lib/creative/taxonomy";
import type { Framework } from "./framework";

export async function buildChatSystem(assetId: string): Promise<string> {
  const asset = await db.referenceAsset.findUnique({ where: { id: assetId }, include: { analysis: true } });
  if (!asset?.analysis) throw new Error("asset has no analysis");
  const an = asset.analysis;
  const fw = (asset.framework as unknown as Framework | null) ?? null;

  const fwBlock = fw
    ? `\nFRAMEWORK ALREADY DRAFTED (build on this, don't contradict it):\n` +
      `Why it works: ${fw.whyItWorks}\n` +
      `Beats: ${fw.beats.map((b) => `${b.time} ${b.job}`).join(" | ")}\n` +
      `Where Fleur fits: ${fw.fleurAngle}\n`
    : "";

  return (
    `You are a creative-direction assistant for Fleur, a DTC hair and scalp serum brand. The product is Bloom: a water-based leave-in serum with six clinical peptides including GHK-Cu, sold mainly on subscription.\n\n` +
    `You are helping a UGC creator remake a specific REFERENCE ad for Fleur. Everything you say is about THIS video and Bloom.\n\n` +
    `THE REFERENCE AD (brand: ${asset.advertiserName ?? "unknown"}):\n` +
    `Pillar ${labelFor("pillar", an.pillar)} · Persona ${labelFor("persona", an.persona)} · Hook ${labelFor("hook", an.hook)} · Funnel ${an.funnel} · Format ${labelFor("format", an.format)}\n` +
    `Opening: ${an.hookText || "(none)"}\n` +
    `What happens: ${an.synopsis || "(none)"}\n` +
    `Strategist note: ${an.critique || "(none)"}\n` +
    `Transcript (may be partial): ${(asset.transcript || "(silent/none)").slice(0, 1200)}\n` +
    fwBlock +
    `\nHOW TO HELP:\n` +
    `- Answer the creator's request concretely: write a full script if they ask, suggest alternate settings if theirs differ, re-angle for another persona, shorten it, propose B-roll, etc.\n` +
    `- A script is fine when asked, but default to giving THEM room — direction they can make their own.\n` +
    `- Keep replies tight and practical. Use plain language, not marketing fluff.\n\n` +
    `COMPLIANCE (absolute, overrides any request):\n` +
    `- Never mention or suggest injectables, injections, needles, syringes, microneedling, or any drug (finasteride, minoxidil-as-drug, GLP-1s).\n` +
    `- Never promise or imply guaranteed regrowth, or treating a diagnosed condition (e.g. alopecia). Use "supports/helps hair look and feel thicker", "supports scalp health" — observational, not medical.\n` +
    `- If the creator asks for something non-compliant, give them the compliant version instead and briefly say why.\n` +
    `- Stay on this video + Fleur; if asked something unrelated, gently redirect.`
  );
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** Keep only well-formed user/assistant turns, cap length + count. */
export function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-20)) {
    const o = (m ?? {}) as Record<string, unknown>;
    const role = o.role === "assistant" ? "assistant" : o.role === "user" ? "user" : null;
    const content = typeof o.content === "string" ? o.content.slice(0, 4000) : "";
    if (role && content) out.push({ role, content });
  }
  return out;
}
