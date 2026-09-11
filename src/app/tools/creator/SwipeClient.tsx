"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Clapperboard, Heart, Play, TrendingUp, Volume2, VolumeX, X } from "lucide-react";
import { labelFor } from "@/lib/creative/taxonomy";
import type { ReferenceCard } from "@/lib/reference/lookup";
import type { FeedCard } from "@/lib/reference/feed";
import type { Framework } from "@/lib/reference/framework";

// ── formatting ────────────────────────────────────────────────────────────────

const compact = (n: number | null) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const chip = "rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm";

// ── fullscreen card face (video + overlaid content) ───────────────────────────

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
  const [buffering, setBuffering] = useState(true);
  const thin = "thinForFleur" in card && card.thinForFleur;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) v.play().catch(() => {});
    else v.pause();
  }, [active]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {card.mediaUrl ? (
        <video
          ref={videoRef}
          src={card.mediaUrl}
          poster={card.thumbUrl ?? undefined}
          muted={muted}
          loop
          playsInline
          preload={preload}
          onWaiting={() => setBuffering(true)}
          onStalled={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          className="h-full w-full object-cover"
        />
      ) : card.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.thumbUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/40">no media</div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      {/* loading cue while the active video buffers */}
      {active && buffering && card.mediaUrl ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
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

const THRESHOLD = 110;

function Feed({
  savedCount,
  onSavedChange,
  onOpenSaved,
}: {
  savedCount: number;
  onSavedChange: (delta: number) => void;
  onOpenSaved: () => void;
}) {
  const [cards, setCards] = useState<FeedCard[] | null>(null);
  const [i, setI] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [leaving, setLeaving] = useState<null | "left" | "right">(null);
  const [muted, setMuted] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let alive = true;
    fetch("/api/reference/feed")
      .then((r) => r.json())
      .then((d) => alive && setCards(d.cards ?? []))
      .catch(() => alive && setCards([]));
    return () => {
      alive = false;
    };
  }, []);

  const record = useCallback(
    (assetId: string, status: "saved" | "dismissed") => {
      if (status === "saved") onSavedChange(1);
      fetch("/api/reference/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, status }),
      }).catch(() => {});
    },
    [onSavedChange],
  );

  const decide = useCallback(
    (dir: "left" | "right") => {
      if (!cards || i >= cards.length || leaving) return;
      record(cards[i].id, dir === "right" ? "saved" : "dismissed");
      setLeaving(dir);
      setTimeout(() => {
        setLeaving(null);
        setDrag({ x: 0, y: 0 });
        setI((n) => n + 1);
      }, 240);
    },
    [cards, i, leaving, record],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (leaving) return;
    dragging.current = true;
    setIsDragging(true);
    start.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    if (drag.x > THRESHOLD) decide("right");
    else if (drag.x < -THRESHOLD) decide("left");
    else setDrag({ x: 0, y: 0 });
  };

  if (cards === null) {
    return <div className="flex h-full w-full items-center justify-center text-white/60">Loading your feed…</div>;
  }

  const remaining = cards.slice(i, i + 3);

  if (remaining.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Clapperboard className="text-white/50" />
        <p className="text-sm text-white/60">You’ve been through everything for now. Check your shot list, or come back as we add more.</p>
        <button onClick={onOpenSaved} className="mt-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-sm">
          View shot list ({savedCount})
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {remaining
        .map((card, idx) => {
          const isTop = idx === 0;
          const offset = isTop ? drag : { x: 0, y: 0 };
          const rot = isTop ? drag.x / 22 : 0;
          const leavingX = leaving === "right" ? 700 : leaving === "left" ? -700 : 0;
          const style: React.CSSProperties = {
            transform: isTop
              ? `translate(${offset.x + leavingX}px, ${offset.y}px) rotate(${leaving ? drag.x / 22 + (leaving === "right" ? 15 : -15) : rot}deg)`
              : "none",
            transition: isDragging && isTop ? "none" : "transform 0.24s ease-out",
            zIndex: remaining.length - idx,
          };
          return (
            <div
              key={card.id}
              className="absolute inset-0 touch-none"
              style={style}
              onPointerDown={isTop ? onPointerDown : undefined}
              onPointerMove={isTop ? onPointerMove : undefined}
              onPointerUp={isTop ? onPointerUp : undefined}
              onPointerCancel={isTop ? onPointerUp : undefined}
            >
              {isTop && (
                <>
                  <Stamp show={drag.x > 40} kind="save" />
                  <Stamp show={drag.x < -40} kind="skip" />
                </>
              )}
              {/* preload the top card and the next one so the swipe-to-next is instant */}
              <CardFace card={card} active={isTop && !leaving} muted={muted} preload={idx <= 1 ? "auto" : "metadata"} />
            </div>
          );
        })
        .reverse()}

      {/* right action rail — fixed over the video, doesn't move with the swipe */}
      <div className="absolute bottom-6 right-3 z-30 flex flex-col items-center gap-3 pb-[env(safe-area-inset-bottom)]">
        <RailButton onClick={onOpenSaved} label="Shot list" className="relative">
          <Bookmark size={20} />
          {savedCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-black">
              {savedCount}
            </span>
          ) : null}
        </RailButton>
        <RailButton onClick={() => setMuted((m) => !m)} label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </RailButton>
        <RailButton onClick={() => decide("left")} label="Skip" className="h-14 w-14 ring-1 ring-white/20">
          <X className="text-red-400" size={26} />
        </RailButton>
        <RailButton onClick={() => decide("right")} label="Save to shot list" className="h-14 w-14 ring-1 ring-white/20">
          <Heart className="text-emerald-400" size={26} />
        </RailButton>
      </div>
    </div>
  );
}

function Stamp({ show, kind }: { show: boolean; kind: "save" | "skip" }) {
  const save = kind === "save";
  return (
    <div
      className={
        "pointer-events-none absolute top-16 z-20 rounded-lg border-4 px-3 py-1 text-3xl font-black uppercase tracking-wider transition-opacity " +
        (save ? "right-6 rotate-12 border-emerald-400 text-emerald-400" : "left-6 -rotate-12 border-red-400 text-red-400") +
        (show ? " opacity-100" : " opacity-0")
      }
    >
      {save ? "Save" : "Skip"}
    </div>
  );
}

// ── creative framework ("how to remake this for Fleur") ───────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{title}</h3>
      {children}
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
      <div className="flex items-center gap-3 py-6 text-sm text-white/60">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        Building your creative brief…
      </div>
    );

  return (
    <div className="text-white">
      <Section title="Why it works">
        <p className="text-[15px] font-medium leading-snug">{fw.whyItWorks}</p>
      </Section>

      {fw.beats.length > 0 && (
        <Section title="The structure">
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
        </Section>
      )}

      {fw.hookOptions.length > 0 && (
        <Section title="Hook options">
          <ul className="space-y-1.5">
            {fw.hookOptions.map((h, i) => (
              <li key={i} className="text-[13px] leading-snug text-white/85">• {h}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Where Fleur fits">
        <p className="text-[13px] leading-snug text-white/85">{fw.fleurAngle}</p>
      </Section>

      <Section title="Make it yours">
        <p className="text-[13px] leading-snug text-white/85">{fw.yourCanvas}</p>
      </Section>

      {fw.compliance.length > 0 && (
        <Section title="Keep it compliant">
          <ul className="space-y-1 rounded-lg bg-amber-500/10 p-3 ring-1 ring-amber-400/20">
            {fw.compliance.map((c, i) => (
              <li key={i} className="text-[12px] leading-snug text-amber-200/90">• {c}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
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
    <div className="absolute inset-0 z-40 flex flex-col bg-neutral-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <span className="text-base font-semibold">Your shot list</span>
        <button onClick={onClose} className="rounded-full bg-white/10 p-2" aria-label="Close">
          <X size={18} />
        </button>
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

      {/* fullscreen replay of a saved video */}
      {playing ? (
        <div className="absolute inset-0 z-50 bg-black">
          <CardFace card={playing} active muted={muted} preload="auto" />
          <button
            onClick={() => setPlaying(null)}
            className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 rounded-full bg-black/40 p-2 backdrop-blur-sm"
            aria-label="Back to shot list"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            className="absolute right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 rounded-full bg-black/40 p-2 backdrop-blur-sm"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          {/* Creative brief — the "how to remake this for Fleur" framework */}
          {!showBrief ? (
            <button
              onClick={() => setShowBrief(true)}
              className="absolute bottom-7 left-1/2 z-[55] -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-lg"
            >
              Creative brief
            </button>
          ) : (
            <div className="absolute inset-x-0 bottom-0 z-[60] max-h-[82%] overflow-y-auto rounded-t-2xl bg-neutral-950/95 p-4 pb-10 backdrop-blur-md">
              <button
                onClick={() => setShowBrief(false)}
                className="mx-auto mb-3 block h-1.5 w-10 rounded-full bg-white/25"
                aria-label="Close brief"
              />
              <div className="mb-3 flex items-center justify-between">
                <span className="text-base font-semibold text-white">Make this for Fleur</span>
                <button onClick={() => setShowBrief(false)} className="rounded-full bg-white/10 p-1.5" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <FrameworkView key={playing.id} assetId={playing.id} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────

export default function SwipeClient({ initialSavedCount }: { initialSavedCount: number }) {
  const [showSaved, setShowSaved] = useState(false);
  const [saved, setSaved] = useState(initialSavedCount);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white select-none">
      <Feed
        savedCount={saved}
        onSavedChange={(d) => setSaved((s) => Math.max(0, s + d))}
        onOpenSaved={() => setShowSaved(true)}
      />
      {showSaved && <SavedOverlay onClose={() => setShowSaved(false)} onCount={setSaved} />}
    </div>
  );
}
