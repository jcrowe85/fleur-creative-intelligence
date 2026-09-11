import { NextResponse } from "next/server";
import { apiRequireCreator } from "@/lib/dal";
import { listSaved, type SaveStatus } from "@/lib/reference/saves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The creator's shot list (?status=saved|dismissed|filmed, default saved). */
export async function GET(req: Request) {
  const auth = await apiRequireCreator();
  if ("error" in auth) return auth.error;

  const status = (new URL(req.url).searchParams.get("status") ?? "saved") as SaveStatus;
  return NextResponse.json({ cards: await listSaved(auth.user.id, status) });
}
