// Ported verbatim from Creator-Briefs-Dev-Handoff/lib/creator-brief.zod.ts.
// Keep it byte-identical to the spec; changes belong in the handoff first.
// Zod schema of what the model returns, for client.messages.parse with zodOutputFormat
// (the pattern in Anthropic's TypeScript SDK docs). Needs the `zod` package.
// Limits (word count, how many loops, sections and ideas) are enforced by checkBrief(), not here.
import { z } from "zod";
import { TOOL_IDS, type ToolId } from "./creator-brief";

const text = z.string();

export const CreatorBriefDraftSchema = z.object({
  title: text.describe("Names the move, never the reference's brand"),
  ref: text.describe("What the video is, never the brand; notes '(German, quotes translated)' or '(music only)'"),
  language: z.string().nullable().describe("Spoken language code, or null when nobody talks"),
  anatomy: z.object({
    beatLine: z.array(text).describe("Section names in order"),
    loops: z.array(
      z.object({
        question: text.describe("The question the video plants, in the viewer's words"),
        answer: text.describe("How the video answers it"),
        openSec: z.number(),
        closeSec: z.number(),
        kind: z.enum(["loop", "micro", "long"]),
      }),
    ),
    whyLoopsWork: z.array(text),
  }),
  framework: z.object({
    coreMove: text,
    sections: z.array(
      z.object({
        name: text,
        startSec: z.number(),
        endSec: z.number(),
        did: text.describe("What's on screen and what's said"),
        why: text.describe("Why it works, naming the tools in plain words"),
        tools: z.array(z.enum(TOOL_IDS as [ToolId, ...ToolId[]])),
      }),
    ),
    dontCopy: z.array(text),
  }),
  fleur: z.object({
    keep: z.array(text),
    swaps: z.array(z.object({ theirs: text, yours: text })),
    ideas: z.array(text),
    check: z.array(text),
  }),
});
