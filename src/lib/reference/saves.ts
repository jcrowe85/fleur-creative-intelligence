// A creator's swipe decisions, persisted per user.
//
// Right-swipe → "saved" (their shot list). Left-swipe → "dismissed" (so the deck
// doesn't show it again). "filmed" marks a saved idea they've since shot.

import { db } from "@/lib/db";
import { toCard, type AssetWithAnalysis, type ReferenceCard } from "./lookup";

export type SaveStatus = "saved" | "dismissed" | "filmed";

export async function setSaveStatus(
  userId: string,
  assetId: string,
  status: SaveStatus,
): Promise<void> {
  await db.savedReference.upsert({
    where: { userId_assetId: { userId, assetId } },
    create: { userId, assetId, status },
    update: { status },
  });
}

/** Every asset this user has already swiped, so the deck can skip them. */
export async function actionedAssetIds(userId: string): Promise<Set<string>> {
  const rows = await db.savedReference.findMany({
    where: { userId },
    select: { assetId: true },
  });
  return new Set(rows.map((r) => r.assetId));
}

/** The creator's shot list (or dismissed/filmed), newest first. */
export async function listSaved(
  userId: string,
  status: SaveStatus = "saved",
): Promise<ReferenceCard[]> {
  const rows = await db.savedReference.findMany({
    where: { userId, status },
    orderBy: { updatedAt: "desc" },
    include: { asset: { include: { analysis: true } } },
  });
  return rows
    .filter((r) => r.asset.analysis !== null)
    .map((r) => toCard(r.asset as AssetWithAnalysis));
}

export async function savedCount(userId: string, status: SaveStatus = "saved"): Promise<number> {
  return db.savedReference.count({ where: { userId, status } });
}
