import { requireUser } from "@/lib/dal";
import { savedCount } from "@/lib/reference/saves";
import SwipeClient from "./SwipeClient";

// The feed and the user's saves both change under it, so render per request.
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireUser();
  const saved = await savedCount(user.id);
  return <SwipeClient initialSavedCount={saved} />;
}
