import { requireUser } from "@/lib/dal";
import { pillarSummary } from "@/lib/reference/pillars";
import { savedCount } from "@/lib/reference/saves";
import SwipeClient from "./SwipeClient";

// The corpus and the user's saves both change under it, so render per request.
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const [pillars, saved] = await Promise.all([pillarSummary(), savedCount(user.id)]);
  return <SwipeClient pillars={pillars} initialSavedCount={saved} />;
}
