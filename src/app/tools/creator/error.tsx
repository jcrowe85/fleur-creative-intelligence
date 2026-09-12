"use client";

import { useEffect } from "react";

// Route-level recovery boundary. Without this, any client-side exception unwinds
// the whole tree to a blank white screen. Here we catch it, log it, show the
// message (so issues are diagnosable), and let the creator retry in place.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[creator] render error:", error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6 text-center text-white">
      <p className="text-base font-semibold">The feed hit a snag</p>
      <p className="max-w-xs text-sm text-white/60">Tap reload to jump back in.</p>
      {error?.message ? (
        <pre className="max-h-40 max-w-full overflow-auto rounded-lg bg-white/10 p-3 text-left text-[11px] leading-snug text-white/50">
          {error.message}
          {error.digest ? `\n(ref: ${error.digest})` : ""}
        </pre>
      ) : null}
      <button
        onClick={reset}
        className="mt-1 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black active:scale-95"
      >
        Reload feed
      </button>
    </div>
  );
}
