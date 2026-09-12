// Mirrors the backend's ReferenceCard / FeedCard shape (see lib/reference).
export interface FeedCard {
  id: string;
  ttAdId: string;
  brand: string;
  mediaType: string;
  mediaUrl: string | null;
  thumbUrl: string | null;
  durationSec: number | null;
  daysRunning: number | null;
  reach: number | null;
  variants: number | null;
  reachDelta7d: number | null;
  pillar: string;
  persona: string;
  hook: string;
  funnel: string;
  format: string;
  hookText: string | null;
  critique: string | null;
  /** Present on feed cards: pillar Fleur is thin on. */
  thinForFleur?: boolean;
}
