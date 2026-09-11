import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { getCreatorUser } from "@/lib/dal";
import { buildFeed } from "@/lib/reference/feed";
import { savedCount } from "@/lib/reference/saves";
import SwipeClient from "./SwipeClient";

// The feed and the user's saves both change under it, so render per request.
export const dynamic = "force-dynamic";

// A fullscreen, app-like swipe experience — lock zoom so focusing the chat input
// (or a stray pinch) never throws the fixed layout out of proportion. Scoped to
// this route; the dashboard keeps normal zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

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

  // Build the feed server-side so the first video is in the initial HTML — the
  // app opens straight onto a playing video, no client fetch / loading screen.
  const [saved, cards] = await Promise.all([savedCount(user.id), buildFeed(user.id)]);
  return <SwipeClient initialSavedCount={saved} initialCards={cards} />;
}
