import { db } from "@/lib/db";

// The first brand/tenant. Everything runs against this today; the Brand model
// exists so a public multi-brand launch needs no migration.
const DEFAULT_SLUG = "fleur";

let cachedId: string | null = null;

/** The default brand (Fleur / Motif), created on first use and cached. */
export async function getDefaultBrandId(): Promise<string> {
  if (cachedId) return cachedId;
  const brand = await db.brand.upsert({
    where: { slug: DEFAULT_SLUG },
    create: { slug: DEFAULT_SLUG, name: "Fleur" },
    update: {},
  });
  cachedId = brand.id;
  return cachedId;
}

/** A user's brand, defaulting to the Fleur brand when unset (legacy/guest rows). */
export async function resolveBrandId(userBrandId: string | null | undefined): Promise<string> {
  return userBrandId ?? (await getDefaultBrandId());
}
