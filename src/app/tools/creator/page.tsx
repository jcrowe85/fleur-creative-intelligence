import { redirect } from "next/navigation";
import { getCreatorUser } from "@/lib/dal";
import { savedCount } from "@/lib/reference/saves";
import SwipeClient from "./SwipeClient";

// The feed and the user's saves both change under it, so render per request.
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const user = await getCreatorUser();
  if (!user) {
    // No session yet — mint a guest account, then come back. Pass the acquisition
    // source through so it's tagged on the guest.
    const { src } = await searchParams;
    const q = src ? `&src=${encodeURIComponent(src)}` : "";
    redirect(`/api/auth/guest?next=/tools/creator${q}`);
  }

  const saved = await savedCount(user.id);
  return <SwipeClient initialSavedCount={saved} />;
}
