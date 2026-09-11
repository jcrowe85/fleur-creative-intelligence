"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bookmark, ChevronDown, Clapperboard, Play, Sparkles, TrendingUp, Volume2, VolumeX, X } from "lucide-react";
import { labelFor } from "@/lib/creative/taxonomy";
import type { ReferenceCard } from "@/lib/reference/lookup";
import type { FeedCard } from "@/lib/reference/feed";
import type { Framework } from "@/lib/reference/framework";

// ── formatting ────────────────────────────────────────────────────────────────

const compact = (n: number | null) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const chip = "rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm";

// ── fullscreen card face (video + overlaid content) ───────────────────────────

const fmtTime = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

function CardFace({
  card,
  active,
  muted,
  preload,
}: {
  card: FeedCard | ReferenceCard;
  active: boolean;
  muted: boolean;
  preload: "auto" | "metadata";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [waiting, setWaiting] = useState(false); // genuine mid-playback buffering
  const [progress, setProgress] = useState(0); // 0..1
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 2 | null>(null);
  const [duration, setDuration] = useState(0);
  const thin = "thinForFleur" in card && card.thinForFleur;

  // long-press bookkeeping
  const holdTimer = useRef<number | null>(null);
  const pressStart = useRef(0);
  const downPos = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  // Reliably play the active video. Programmatic play() can silently fail when
  // it races a pause() during a fast scroll, when the element isn't ready yet,
  // or when a preloaded video already fired `canplay` off-screen (so it won't
  // fire again). Retry on a short schedule and on readiness events until it's
  // actually playing — no tap required.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!active) {
      v.pause();
      v.playbackRate = 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear speed overlay when this card scrolls out of view
      setSpeed(null);
      return;
    }
    let cancelled = false;
    const attempt = () => {
      const vid = videoRef.current;
      if (cancelled || !vid || !vid.paused) return;
      vid.play().catch(() => {});
    };
    attempt();
    const timers = [80, 250, 600, 1200].map((ms) => window.setTimeout(attempt, ms));
    v.addEventListener("canplay", attempt);
    v.addEventListener("loadeddata", attempt);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      v.removeEventListener("canplay", attempt);
      v.removeEventListener("loadeddata", attempt);
    };
  }, [active]);

  // ── scrub bar: drag to seek ──
  const seekToClientX = (clientX: number) => {
    const bar = barRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setProgress(ratio);
    v.currentTime = ratio * v.duration;
  };
  const scrubDown = (e: React.PointerEvent) => {
    setScrubbing(true);
    videoRef.current?.pause();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekToClientX(e.clientX);
  };
  const scrubMove = (e: React.PointerEvent) => {
    if (scrubbing) seekToClientX(e.clientX);
  };
  const scrubUp = () => {
    if (!scrubbing) return;
    setScrubbing(false);
    if (active) videoRef.current?.play().catch(() => {});
  };

  // ── long-press: hold left = 0.5×, hold right = 2× (release restores) ──
  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const pressDown = (e: React.PointerEvent) => {
    pressStart.current = Date.now();
    downPos.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    const isRight = e.clientX - rect.left > rect.width / 2;
    holdTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      const rate = isRight ? 2 : 0.5;
      v.playbackRate = rate;
      setSpeed(rate);
    }, 220);
  };
  const pressMove = (e: React.PointerEvent) => {
    if (speed) return; // in speed mode; stay until release
    // real movement means a scroll gesture, not a hold — cancel the long-press
    if (Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y) > 10) {
      moved.current = true;
      clearHold();
    }
  };
  const pressUp = () => {
    clearHold();
    const v = videoRef.current;
    if (speed && v) {
      v.playbackRate = 1;
      setSpeed(null);
      if (active) v.play().catch(() => {});
      return;
    }
    // a quick, still tap toggles play/pause
    if (v && !moved.current && Date.now() - pressStart.current < 220) {
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* thumbnail underlay — always painted, so the frame is never pure black
          while the video mounts/buffers or swaps in on scroll */}
      {card.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.thumbUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {card.mediaUrl ? (
        <video
          ref={videoRef}
          src={card.mediaUrl}
          poster={card.thumbUrl ?? undefined}
          muted={muted}
          loop
          playsInline
          preload={preload}
          onWaiting={() => setWaiting(true)}
          onStalled={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => {
            if (!scrubbing && e.currentTarget.duration) setProgress(e.currentTarget.currentTime / e.currentTarget.duration);
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : !card.thumbUrl ? (
        <div className="flex h-full w-full items-center justify-center text-white/40">no media</div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      {/* gesture layer: long-press for speed, tap to pause (active video only) */}
      {active && card.mediaUrl ? (
        <div
          className="absolute inset-0 z-10"
          onPointerDown={pressDown}
          onPointerMove={pressMove}
          onPointerUp={pressUp}
          onPointerCancel={pressUp}
        />
      ) : null}

      {/* loading cue only while the active video is genuinely buffering mid-play */}
      {active && waiting && card.mediaUrl && !scrubbing ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
        </div>
      ) : null}

      {/* speed indicator */}
      {speed ? (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 -translate-x-1/2 rounded-full bg-black/60 px-3.5 py-1 text-sm font-bold text-white backdrop-blur-sm">
          {speed === 2 ? "2× ⏵⏵" : "0.5× ⏴⏴"}
        </div>
      ) : null}

      {/* top-left: brand + thin nudge */}
      <div className="absolute left-4 top-[env(safe-area-inset-top)] mt-4 flex items-center gap-2">
        <span className="text-sm font-semibold text-white drop-shadow">{card.brand}</span>
        {thin ? (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/25 px-2 py-0.5 text-[11px] font-medium text-amber-200 ring-1 ring-amber-400/40">
            <TrendingUp size={12} /> you&rsquo;re thin here
          </span>
        ) : null}
      </div>

      {/* bottom-left: hook + classification + durability (padded to clear the rail) */}
      <div className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] space-y-2.5 p-4 pr-20 pb-6">
        {card.hookText ? (
          <p className="line-clamp-3 text-[16px] font-medium leading-snug text-white drop-shadow">“{card.hookText}”</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <span className={chip}>{labelFor("pillar", card.pillar)}</span>
          {card.persona !== "none" && <span className={chip}>{labelFor("persona", card.persona)}</span>}
          <span className={chip}>{card.funnel}</span>
          <span className={chip}>{labelFor("format", card.format)}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px] font-medium text-white/85">
          <span className="tabular-nums">{card.daysRunning ?? "?"}d running</span>
          <span className="tabular-nums">{compact(card.reach)} reach</span>
          <span className="tabular-nums">{card.variants ?? "?"} variants</span>
        </div>
      </div>

      {/* scrub timeline — drag along the bar to seek. Lifted off the bottom edge
          and inset from the sides, with a tall touch zone, so it's easy to grab. */}
      {active && card.mediaUrl ? (
        <div
          onPointerDown={scrubDown}
          onPointerMove={scrubMove}
          onPointerUp={scrubUp}
          onPointerCancel={scrubUp}
          style={{ touchAction: "none" }}
          className="absolute inset-x-4 bottom-[max(env(safe-area-inset-bottom),16px)] z-30 flex flex-col justify-end pb-6 pt-8"
        >
          {scrubbing ? (
            <div className="pointer-events-none mb-3 text-center text-[13px] font-semibold tabular-nums text-white drop-shadow">
              {fmtTime(progress * duration)} <span className="text-white/50">/ {fmtTime(duration)}</span>
            </div>
          ) : null}
          <div ref={barRef} className={"relative w-full rounded-full bg-white/30 transition-all " + (scrubbing ? "h-1.5" : "h-[3px]")}>
            <div className="h-full rounded-full bg-white" style={{ width: `${progress * 100}%` }} />
            {scrubbing ? (
              <div
                className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                style={{ left: `${progress * 100}%` }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── right-side action rail (fixed over the video) ─────────────────────────────

function RailButton({
  onClick,
  label,
  className = "",
  children,
}: {
  onClick: () => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={
        "flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-90 " +
        className
      }
    >
      {children}
    </button>
  );
}

// ── swipe feed ────────────────────────────────────────────────────────────────


function Feed({
  initialCards,
  savedCount,
  onSavedChange,
  onOpenSaved,
}: {
  initialCards: FeedCard[];
  savedCount: number;
  onSavedChange: (delta: number) => void;
  onOpenSaved: () => void;
}) {
  const [cards] = useState<FeedCard[]>(initialCards);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [briefCard, setBriefCard] = useState<FeedCard | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<Set<string>>(new Set()); // mirror for stable closures
  const recorded = useRef<Set<string>>(new Set()); // assets already dismissed/saved
  const prevActive = useRef(0);

  // Track which video is in view (the active one plays).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !cards) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            setActive(Number((e.target as HTMLElement).dataset.idx));
          }
        }
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-idx]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cards]);

  const post = (assetId: string, status: "saved" | "dismissed") =>
    fetch("/api/reference/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, status }),
    }).catch(() => {});

  // Scrolling past a video (advancing forward) is an implicit "deny" — record it
  // dismissed so future feeds don't repeat it, unless the creator saved it.
  useEffect(() => {
    if (!cards) return;
    for (let k = prevActive.current; k < active; k++) {
      const c = cards[k];
      if (c && !savedRef.current.has(c.id) && !recorded.current.has(c.id)) {
        recorded.current.add(c.id);
        post(c.id, "dismissed");
      }
    }
    prevActive.current = active;
  }, [active, cards]);

  const toggleSave = (card: FeedCard) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
        recorded.current.add(card.id);
        onSavedChange(-1);
        post(card.id, "dismissed");
      } else {
        next.add(card.id);
        recorded.current.delete(card.id);
        onSavedChange(1);
        post(card.id, "saved");
      }
      savedRef.current = next;
      return next;
    });
  };

  if (cards.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Clapperboard className="text-white/50" />
        <p className="text-sm text-white/60">You’ve been through everything for now. Check your saved videos, or come back as we add more.</p>
        <button onClick={onOpenSaved} className="mt-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-sm">
          Saved videos ({savedCount})
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={scrollRef}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((card, idx) => {
          // Keep few videos mounted at once — iOS refuses to play a new one when
          // too many are decoding. Active ± 1 covers the next scroll smoothly.
          const near = Math.abs(idx - active) <= 1;
          const isActive = idx === active;
          const isSaved = savedIds.has(card.id);
          return (
            <div key={card.id} data-idx={idx} className="relative h-full w-full snap-start snap-always">
              {near ? (
                <CardFace card={card} active={isActive} muted={muted} preload="auto" />
              ) : (
                <div className="h-full w-full bg-black">
                  {Math.abs(idx - active) <= 4 && card.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={card.thumbUrl} alt="" className="h-full w-full object-cover opacity-80" />
                  ) : null}
                </div>
              )}

              {isActive && (
                <div className="absolute bottom-[24%] right-3 z-30 flex flex-col items-center gap-5">
                  <RailButton onClick={() => setMuted((m) => !m)} label={muted ? "Unmute" : "Mute"}>
                    {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </RailButton>
                  <button onClick={() => setBriefCard(card)} className="flex flex-col items-center gap-1 active:scale-95" aria-label="Creative brief">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
                      <Sparkles size={22} />
                    </span>
                    <span className="text-[11px] font-medium text-white/90 drop-shadow">Brief</span>
                  </button>
                  <button onClick={() => toggleSave(card)} className="flex flex-col items-center gap-1 active:scale-95" aria-label={isSaved ? "Saved" : "Save"}>
                    <span className={"flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-sm transition " + (isSaved ? "bg-white text-black" : "bg-black/40 text-white")}>
                      <Bookmark size={22} className={isSaved ? "fill-current" : ""} />
                    </span>
                    <span className="text-[11px] font-medium text-white/90 drop-shadow">{isSaved ? "Saved" : "Save"}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* saved collection — where they find their saves, TikTok-profile style */}
      <button
        onClick={onOpenSaved}
        className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm active:scale-95"
      >
        <Bookmark size={16} />
        <span className="tabular-nums">{savedCount}</span>
      </button>

      {/* creative brief / brainstorm for the current video */}
      {briefCard && <BriefSheet card={briefCard} onClose={() => setBriefCard(null)} />}
    </div>
  );
}

// ── creative framework ("how to remake this for Fleur") ───────────────────────

function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/10">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 py-3.5 text-left">
        <span className="text-[15px] font-semibold text-white">{title}</span>
        <ChevronDown size={18} className={"shrink-0 text-white/40 transition-transform duration-200 " + (open ? "rotate-180" : "")} />
      </button>
      {open ? (
        <div className="pb-4">{children}</div>
      ) : summary ? (
        <p className="-mt-1.5 line-clamp-1 pb-3.5 text-[12.5px] text-white/40">{summary}</p>
      ) : null}
    </div>
  );
}

function FrameworkView({ assetId }: { assetId: string }) {
  const [fw, setFw] = useState<Framework | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/reference/framework?assetId=${assetId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d) => alive && setFw(d.framework))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [assetId]);

  if (err)
    return <p className="text-sm text-white/50">Couldn’t build a brief for this one right now — try again in a moment.</p>;
  if (!fw)
    return (
      <div className="flex items-center gap-3 py-8 text-sm text-white/60">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        Building your creative brief…
      </div>
    );

  return (
    <div className="text-white">
      <Collapsible title="Why it works" defaultOpen>
        <p className="text-[14px] leading-relaxed text-white/85">{fw.whyItWorks}</p>
      </Collapsible>

      {fw.beats.length > 0 && (
        <Collapsible title="The structure" summary={`${fw.beats.length} beats — the shot-by-shot`}>
          <ol className="space-y-2.5">
            {fw.beats.map((b, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/70">
                  {b.time}
                </span>
                <span className="text-[13px] leading-snug text-white/85">
                  <span className="font-semibold text-white">{b.job}.</span> {b.detail}
                </span>
              </li>
            ))}
          </ol>
        </Collapsible>
      )}

      {fw.hookOptions.length > 0 && (
        <Collapsible title="Hook options" summary={`${fw.hookOptions.length} ways to open`}>
          <ul className="space-y-2">
            {fw.hookOptions.map((h, i) => (
              <li key={i} className="text-[13px] leading-snug text-white/85">• {h}</li>
            ))}
          </ul>
        </Collapsible>
      )}

      <Collapsible title="Where Fleur fits" summary={fw.fleurAngle}>
        <p className="text-[13px] leading-relaxed text-white/85">{fw.fleurAngle}</p>
      </Collapsible>

      <Collapsible title="Make it yours" summary={fw.yourCanvas}>
        <p className="text-[13px] leading-relaxed text-white/85">{fw.yourCanvas}</p>
      </Collapsible>

      {fw.compliance.length > 0 && (
        <Collapsible title="Keep it compliant" summary={`${fw.compliance.length} guardrails`}>
          <ul className="space-y-1.5 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-400/20">
            {fw.compliance.map((c, i) => (
              <li key={i} className="text-[12px] leading-snug text-amber-200/90">• {c}</li>
            ))}
          </ul>
        </Collapsible>
      )}
    </div>
  );
}

// ── brainstorm chat ───────────────────────────────────────────────────────────

type ChatMsg = { role: "user" | "assistant"; content: string };
const SUGGESTIONS = ["Write me a full script", "Suggest a different setting", "Make it 15 seconds", "Re-angle for postpartum"];

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
        />
      ))}
    </div>
  );
}

/**
 * Drag-to-dismiss on `ref` via native touch listeners. Pointer events get
 * cancelled the moment the browser starts a scroll, so a scroll body could only
 * be dragged from a non-scrolling handle; touch listeners with {passive:false}
 * let us preventDefault and take over the gesture. On a scroll body the drag
 * only engages when it's already at the top (so normal scrolling still works);
 * pass `alwaysDismiss` for a non-scrolling handle like the header.
 */
function useDismissDrag(
  ref: React.RefObject<HTMLElement | null>,
  onMove: (dy: number) => void,
  onEnd: (dy: number) => void,
  alwaysDismiss = false,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY = 0;
    let active = false;
    let dy = 0;
    const ts = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      active = false;
      dy = 0;
    };
    const tm = (e: TouchEvent) => {
      dy = e.touches[0].clientY - startY;
      if (!active) {
        if (dy > 4 && (alwaysDismiss || el.scrollTop <= 0)) active = true;
        else return;
      }
      if (dy >= 0) {
        onMove(dy);
        if (e.cancelable) e.preventDefault();
      }
    };
    const te = () => {
      if (active) {
        active = false;
        onEnd(dy);
      }
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", te);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
    };
  }, [ref, onMove, onEnd, alwaysDismiss]);
}

function ChatView({
  assetId,
  dragMove,
  dragEnd,
}: {
  assetId: string;
  dragMove: (dy: number) => void;
  dragEnd: (dy: number) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useDismissDrag(scrollRef, dragMove, dragEnd);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: ChatMsg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput("");
    requestAnimationFrame(grow);
    setBusy(true);
    try {
      const res = await fetch("/api/reference/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, messages: next }),
      });
      if (!res.ok || !res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch {
      setMsgs((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", content: "Sorry — I hit an error. Try again." };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} style={{ overscrollBehavior: "contain" }} className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {msgs.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-white/50">Ask about remaking this for Fleur — a script, a different setting, a re-angle, a shorter cut.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-white/85 active:scale-95">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) => {
            const sent = m.role === "user";
            const dots = !sent && !m.content && busy;
            return (
              <div key={i} className={sent ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    "max-w-[82%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-[14px] leading-[1.35] " +
                    (sent ? "rounded-br-md bg-[#0A84FF] text-white" : "rounded-bl-md bg-[#262629] text-white")
                  }
                >
                  {dots ? <TypingDots /> : m.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-2 flex items-end gap-2 rounded-[22px] bg-white/10 px-2 py-1.5">
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask anything about this idea…"
          // 16px min prevents iOS Safari from auto-zooming the viewport on focus
          className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] leading-snug text-white placeholder:text-white/40 focus:outline-none"
        />
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white transition disabled:bg-white/20 disabled:text-white/40"
        >
          <ArrowUp size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ── brief + chat bottom sheet (slides up, drag-down to dismiss) ───────────────

function BriefSheet({ card, onClose }: { card: ReferenceCard; onClose: () => void }) {
  const [tab, setTab] = useState<"brief" | "chat">("brief");
  const [entered, setEntered] = useState(false);
  const [y, setY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const briefScroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = useCallback(() => {
    setEntered(false);
    setY(0);
    setTimeout(onClose, 260);
  }, [onClose]);

  const onDragMove = useCallback((dy: number) => {
    setDragging(true);
    setY(dy);
  }, []);
  const onDragEnd = useCallback(
    (dy: number) => {
      setDragging(false);
      if (dy > 100) close();
      else setY(0);
    },
    [close],
  );

  // The whole header always drags; the scroll bodies drag when pulled from the top.
  useDismissDrag(headerRef, onDragMove, onDragEnd, true);
  useDismissDrag(briefScroll, onDragMove, onDragEnd);

  return (
    <>
      <div
        onClick={close}
        className={"absolute inset-0 z-[55] bg-black/50 transition-opacity duration-300 " + (entered ? "opacity-100" : "opacity-0")}
      />
      <div
        style={{
          transform: entered ? `translateY(${y}px)` : "translateY(100%)",
          transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.32,0.72,0,1)",
        }}
        className="absolute inset-x-0 bottom-0 z-[60] flex h-[86%] flex-col rounded-t-2xl bg-neutral-950 shadow-2xl"
      >
        {/* whole header is a drag handle */}
        <div ref={headerRef} style={{ touchAction: "none" }} className="shrink-0 px-4 pt-2">
          <div className="mx-auto my-2 h-1.5 w-10 rounded-full bg-white/30" />
          <div className="mb-3 mt-1 flex items-center justify-between">
            <div className="flex gap-1 rounded-full bg-white/10 p-1">
              <button onClick={() => setTab("brief")} className={"rounded-full px-3.5 py-1 text-[13px] font-medium " + (tab === "brief" ? "bg-white text-black" : "text-white/70")}>
                Brief
              </button>
              <button onClick={() => setTab("chat")} className={"rounded-full px-3.5 py-1 text-[13px] font-medium " + (tab === "chat" ? "bg-white text-black" : "text-white/70")}>
                Brainstorm
              </button>
            </div>
          </div>
        </div>
        {tab === "brief" ? (
          <div ref={briefScroll} style={{ overscrollBehavior: "contain" }} className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
            <FrameworkView key={card.id} assetId={card.id} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 px-4 pb-4">
            <ChatView key={card.id} assetId={card.id} dragMove={onDragMove} dragEnd={onDragEnd} />
          </div>
        )}
      </div>
    </>
  );
}

// ── swipe-right-to-go-back ────────────────────────────────────────────────────
// The natural mobile motion for leaving a screen. Attach the returned ref to the
// screen; it follows the finger on a rightward drag and, past a threshold, slides
// off and calls onBack. Only engages on a clearly-horizontal rightward gesture,
// so vertical scrolling underneath still works.
function useSwipeBack(onBack: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dxRef = useRef(0);
  const set = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let active = false;
    let decided = false;
    const ts = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      active = false;
      decided = false;
    };
    const tm = (e: TouchEvent) => {
      const dX = e.touches[0].clientX - startX;
      const dY = e.touches[0].clientY - startY;
      if (!decided) {
        if (Math.abs(dX) < 10 && Math.abs(dY) < 10) return;
        decided = true;
        active = dX > 0 && Math.abs(dX) > Math.abs(dY) * 1.3; // clearly rightward
        if (active) setDragging(true);
      }
      if (active) {
        set(Math.max(0, dX));
        if (e.cancelable) e.preventDefault();
      }
    };
    const te = () => {
      if (!active) return;
      active = false;
      setDragging(false);
      if (dxRef.current > 90) {
        set(el.getBoundingClientRect().width);
        setTimeout(onBack, 200);
      } else {
        set(0);
      }
    };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("touchcancel", te);
    return () => {
      el.removeEventListener("touchstart", ts);
      el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", te);
      el.removeEventListener("touchcancel", te);
    };
  }, [onBack]);
  return { ref, dx, dragging };
}

// ── saved list (full overlay) ─────────────────────────────────────────────────

function SavedOverlay({ onClose, onCount }: { onClose: () => void; onCount: (n: number) => void }) {
  const [cards, setCards] = useState<ReferenceCard[] | null>(null);
  const [playing, setPlaying] = useState<ReferenceCard | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const [muted, setMuted] = useState(false); // reopening a saved video: sound on

  const open = (c: ReferenceCard) => {
    setShowBrief(false);
    setPlaying(c);
  };

  const { ref: listRef, dx: listDx, dragging: listDragging } = useSwipeBack(onClose);
  const { ref: replayRef, dx: replayDx, dragging: replayDragging } = useSwipeBack(() => setPlaying(null));

  useEffect(() => {
    fetch("/api/reference/saved")
      .then((r) => r.json())
      .then((d) => {
        setCards(d.cards ?? []);
        onCount((d.cards ?? []).length);
      })
      .catch(() => setCards([]));
  }, [onCount]);

  const remove = (assetId: string) => {
    setCards((c) => {
      const next = c?.filter((x) => x.id !== assetId) ?? null;
      if (next) onCount(next.length);
      return next;
    });
    fetch("/api/reference/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, status: "dismissed" }),
    }).catch(() => {});
  };

  return (
    <div className="absolute inset-0 z-40">
      {/* list screen — swipe right to go back to the feed */}
      <div
        ref={listRef}
        style={{ transform: `translateX(${listDx}px)`, transition: listDragging ? "none" : "transform 0.2s ease-out" }}
        className="absolute inset-0 flex flex-col bg-neutral-950 text-white"
      >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <span className="text-base font-semibold">Your shot list</span>
        <span className="text-[12px] text-white/40">— swipe right to go back</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {cards === null ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="text-sm text-white/50">Nothing saved yet. Swipe right on ideas you want to make.</p>
        ) : (
          <ul className="space-y-3">
            {cards.map((c) => (
              <li key={c.id} className="flex gap-3 rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                <button
                  onClick={() => open(c)}
                  className="group relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-black"
                  aria-label="Play video"
                >
                  {c.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <Play size={20} className="fill-white text-white drop-shadow" />
                  </span>
                </button>
                <button onClick={() => open(c)} className="min-w-0 flex-1 text-left" aria-label="Open video">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.brand}</span>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(c.id);
                      }}
                      className="shrink-0 text-white/50 hover:text-red-400"
                      aria-label="Remove"
                    >
                      <X size={16} />
                    </span>
                  </div>
                  {c.hookText ? <p className="mt-0.5 line-clamp-2 text-[13px] text-white/60">“{c.hookText}”</p> : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
                    <span>{labelFor("pillar", c.pillar)}</span>
                    <span className="tabular-nums">· {c.daysRunning ?? "?"}d</span>
                    <span className="tabular-nums">· {compact(c.reach)} reach</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>

      {/* replay — swipe right to go back to the list */}
      {playing ? (
        <div
          ref={replayRef}
          style={{ transform: `translateX(${replayDx}px)`, transition: replayDragging ? "none" : "transform 0.2s ease-out" }}
          className="absolute inset-0 z-50 bg-black"
        >
          <CardFace card={playing} active muted={muted} preload="auto" />
          <button
            onClick={() => setMuted((m) => !m)}
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[55] rounded-full bg-black/40 p-2 backdrop-blur-sm"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          {!showBrief && (
            <button
              onClick={() => setShowBrief(true)}
              className="absolute bottom-7 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-lg active:scale-95"
            >
              Creative brief
            </button>
          )}
          {showBrief && <BriefSheet card={playing} onClose={() => setShowBrief(false)} />}
        </div>
      ) : null}
    </div>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────

export default function SwipeClient({
  initialSavedCount,
  initialCards,
}: {
  initialSavedCount: number;
  initialCards: FeedCard[];
}) {
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState(initialSavedCount);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white select-none">
      <Feed
        initialCards={initialCards}
        savedCount={saved}
        onSavedChange={(d) => setSaved((s) => Math.max(0, s + d))}
        onOpenSaved={() => setShowSaved(true)}
      />
      {showSaved && <SavedOverlay onClose={() => setShowSaved(false)} onCount={setSaved} />}
    </div>
  );
}
