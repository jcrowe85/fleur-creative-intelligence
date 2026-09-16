// Fleur's product facts, editable without a deploy.
//
// These are the one piece of content in the brief pipeline that changes for
// business reasons rather than engineering ones: a price moves, a claim comes
// off hold, a gift stops shipping. Inlining them in prompts.ts means correcting
// "$48 a month" requires a code change and a deploy, which is how a prompt ends
// up asserting something the site stopped saying months ago.
//
// Stored in AppCache rather than a new table. That is the established pattern
// here for a small value read often and changed rarely (see reference/feed.ts),
// and it needs no migration — so the previous version of the app is unaffected
// whether or not a row exists.
//
// The constant generated from the handoff stays as the seed and the fallback:
// if the row is missing or the read fails, briefs are still written against the
// facts the handoff shipped, never against nothing.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PRODUCT_FACTS } from "./prompts";

const KEY = "productFacts";
/** Short on purpose: an edit should reach the next brief, not the next hour. */
const TTL_MS = 60_000;

/**
 * The shipped facts, trimmed once here so every path compares like with like.
 *
 * The generated constant carries a leading and trailing newline from the
 * template literal it lives in. Stored values are trimmed on the way in, so
 * comparing a stored value against the raw constant reported an unmodified
 * save as "overridden" — telling Donovan he had changed something he hadn't.
 */
const SHIPPED = PRODUCT_FACTS.trim();

let mem: { at: number; text: string } | null = null;

interface Stored {
  markdown: string;
  updatedBy?: string;
}

/**
 * The facts a brief is written against.
 *
 * Falls back to the shipped copy on a missing row OR a failed read: a brief
 * generated against no product facts would invent them, which is worse than one
 * generated against slightly stale ones.
 */
export async function productFacts(): Promise<string> {
  if (mem && Date.now() - mem.at < TTL_MS) return mem.text;
  try {
    const row = await db.appCache.findUnique({ where: { key: KEY } });
    const stored = row?.json as Stored | null;
    const text = stored?.markdown?.trim();
    if (text) {
      mem = { at: Date.now(), text };
      return text;
    }
  } catch (e) {
    console.warn(`product facts: falling back to the shipped copy — ${(e as Error).message.slice(0, 100)}`);
  }
  mem = { at: Date.now(), text: SHIPPED };
  return SHIPPED;
}

/** Replace the facts. Takes effect within TTL_MS, with no deploy. */
export async function setProductFacts(markdown: string, updatedBy?: string): Promise<void> {
  const text = markdown.trim();
  if (!text) throw new Error("Product facts cannot be empty — briefs would be written against nothing");
  const json: Stored = { markdown: text, ...(updatedBy ? { updatedBy } : {}) };
  await db.appCache.upsert({
    where: { key: KEY },
    // Prisma's InputJsonValue wants an index signature, which a named interface
    // doesn't carry. Same cast the other writers of this column use.
    create: { key: KEY, json: json as unknown as Prisma.InputJsonValue },
    update: { json: json as unknown as Prisma.InputJsonValue },
  });
  mem = { at: Date.now(), text };
}

/** What shipped with the build, for seeding and for showing a diff against. */
export function shippedProductFacts(): string {
  return SHIPPED;
}

/** Whether the live facts differ from the shipped copy, and when they changed. */
export async function productFactsStatus(): Promise<{
  overridden: boolean;
  updatedAt: Date | null;
  chars: number;
}> {
  const row = await db.appCache.findUnique({ where: { key: KEY } }).catch(() => null);
  const stored = row?.json as Stored | null;
  const text = stored?.markdown?.trim();
  return {
    // Compared against the trimmed constant, so saving the facts unchanged
    // reports as not overridden rather than as an edit nobody made.
    overridden: Boolean(text && text !== SHIPPED),
    updatedAt: row?.updatedAt ?? null,
    chars: (text ?? SHIPPED).length,
  };
}
