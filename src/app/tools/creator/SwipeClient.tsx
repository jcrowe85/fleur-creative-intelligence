"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Clapperboard,
  Heart,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { labelFor } from "@/lib/creative/taxonomy";
import type { PillarSummary } from "@/lib/reference/pillars";
import type { MatchTier, ReferenceCard, ReferenceMatch } from "@/lib/reference/lookup";

// ── formatting ────────────────────────────────────────────────────────────────

const compact = (n: number | null) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const tierLabel: Record<MatchTier, string> = {
  exact: "exact match",
  "pillar+persona": "persona match",
  "pillar+funnel": "funnel match",
  pillar: "pillar match",
  secondary: "related pillar",
};

const chip = "rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm";

// ── card face (video + overlay) ───────────────────────────────────────────────

function CardFace({
  card,
  active,
  muted,
  onToggleMute,
}: {
  card: ReferenceCard;
  active: boolean;
  muted: boolean;
  onToggleMute?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) v.play().catch(() => {});
    else v.pause();
  }, [active]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl bg-neutral-900">
      {card.mediaUrl ? (
        <video
          ref={videoRef}
          src={card.mediaUrl}
          poster={card.thumbUrl ?? undefined}
          muted={muted}
          loop
          playsInline
          preload={active ? "auto" : "metadata"}
          className="h-full w-full object-cover"
        />
      ) : card.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.thumbUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/40">no media</div>
      )}

      {/* legibility gradients */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      {/* top row: brand + match badge */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="text-sm font-semibold text-white drop-shadow">{card.brand}</div>
        {"matchTier" in card ? (
          <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-[11px] font-medium text-emerald-200 ring-1 ring-emerald-400/40">
            {tierLabel[(card as ReferenceMatch).matchTier]}
          </span>
        ) : null}
      </div>

      {active && onToggleMute ? (
        <button
          onClick={onToggleMute}
          className="absolute right-3 top-14 rounded-full bg-black/40 p-2 text-white/90 backdrop-blur-sm"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      ) : null}

      {/* bottom: hook + classification + durability */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-4">
        {card.hookText ? (
          <p className="line-clamp-3 text-[15px] font-medium leading-snug text-white drop-shadow">
            “{card.hookText}”
          </p>
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

// ── swipe deck ────────────────────────────────────────────────────────────────

const THRESHOLD = 110;

function Deck({
  pillar,
  onBack,
  onSavedChange,
}: {
  pillar: PillarSummary;
  onBack: () => void;
  onSavedChange: (delta: number) => void;
}) {
  const [cards, setCards] = useState<ReferenceMatch[] | null>(null);
  const [i, setI] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [leaving, setLeaving] = useState<null | "left" | "right">(null);
  const [muted, setMuted] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let alive = true;
    fetch(`/api/reference/deck?pillar=${encodeURIComponent(pillar.id)}`)
      .then((r) => r.json())
      .then((d) => alive && setCards(d.cards ?? []))
      .catch(() => alive && setCards([]));
    return () => {
      alive = false;
    };
  }, [pillar.id]);

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
      const card = cards[i];
      record(card.id, dir === "right" ? "saved" : "dismissed");
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
    return <DeckShell pillar={pillar} onBack={onBack}><Centered>Loading examples…</Centered></DeckShell>;
  }

  const remaining = cards.slice(i, i + 3);
  const top = remaining[0];

  return (
    <DeckShell pillar={pillar} onBack={onBack}>
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[380px]">
        {remaining.length === 0 ? (
          <Centered>
            <div className="space-y-2 px-6 text-center">
              <Clapperboard className="mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                That’s every example we have in {pillar.label}. Pick another pillar, or check your saved list.
              </p>
            </div>
          </Centered>
        ) : (
          remaining
            .map((card, idx) => {
              const isTop = idx === 0;
              const offset = isTop ? drag : { x: 0, y: 0 };
              const rot = isTop ? drag.x / 18 : 0;
              const leavingX = leaving === "right" ? 600 : leaving === "left" ? -600 : 0;
              const style: React.CSSProperties = {
                transform: isTop
                  ? `translate(${offset.x + leavingX}px, ${offset.y}px) rotate(${leaving ? drag.x / 18 + (leaving === "right" ? 20 : -20) : rot}deg)`
                  : `scale(${1 - idx * 0.04}) translateY(${idx * 10}px)`,
                transition: isDragging && isTop ? "none" : "transform 0.24s ease-out",
                zIndex: remaining.length - idx,
              };
              return (
                <div
                  key={card.id}
                  className="absolute inset-0 touch-none select-none"
                  style={style}
                  onPointerDown={isTop ? onPointerDown : undefined}
                  onPointerMove={isTop ? onPointerMove : undefined}
                  onPointerUp={isTop ? onPointerUp : undefined}
                  onPointerCancel={isTop ? onPointerUp : undefined}
                >
                  {/* decision stamps */}
                  {isTop && (
                    <>
                      <Stamp show={drag.x > 40} kind="save" />
                      <Stamp show={drag.x < -40} kind="skip" />
                    </>
                  )}
                  <CardFace
                    card={card}
                    active={isTop && !leaving}
                    muted={muted}
                    onToggleMute={isTop ? () => setMuted((m) => !m) : undefined}
                  />
                </div>
              );
            })
        )}
      </div>

      {top ? (
        <div className="mt-6 flex items-center justify-center gap-6">
          <button
            onClick={() => decide("left")}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-card ring-1 ring-border transition hover:ring-red-500/60"
            aria-label="Skip"
          >
            <X className="text-red-400" size={26} />
          </button>
          <button
            onClick={() => decide("right")}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-card ring-1 ring-border transition hover:ring-emerald-500/60"
            aria-label="Save to shot list"
          >
            <Heart className="text-emerald-400" size={26} />
          </button>
        </div>
      ) : null}
      {top?.critique ? (
        <p className="mx-auto mt-4 max-w-[380px] px-2 text-center text-[12px] leading-relaxed text-muted-foreground">
          {top.critique}
        </p>
      ) : null}
    </DeckShell>
  );
}

function Stamp({ show, kind }: { show: boolean; kind: "save" | "skip" }) {
  const save = kind === "save";
  return (
    <div
      className={
        "pointer-events-none absolute top-8 z-20 rounded-lg border-4 px-3 py-1 text-2xl font-black uppercase tracking-wider transition-opacity " +
        (save
          ? "right-6 rotate-12 border-emerald-400 text-emerald-400"
          : "left-6 -rotate-12 border-red-400 text-red-400") +
        (show ? " opacity-100" : " opacity-0")
      }
    >
      {save ? "Save" : "Skip"}
    </div>
  );
}

function DeckShell({
  pillar,
  onBack,
  children,
}: {
  pillar: PillarSummary;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-card" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-sm font-semibold">{pillar.label}</div>
          <div className="text-[11px] text-muted-foreground">Swipe right to save · left to skip</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex aspect-[9/16] w-full max-w-[380px] items-center justify-center rounded-3xl bg-card ring-1 ring-border">
      {children}
    </div>
  );
}

// ── saved list ────────────────────────────────────────────────────────────────

function SavedList({ onBack, onCount }: { onBack: () => void; onCount: (n: number) => void }) {
  const [cards, setCards] = useState<ReferenceCard[] | null>(null);

  const load = useCallback(() => {
    fetch("/api/reference/saved")
      .then((r) => r.json())
      .then((d) => {
        setCards(d.cards ?? []);
        onCount((d.cards ?? []).length);
      })
      .catch(() => setCards([]));
  }, [onCount]);

  useEffect(load, [load]);

  const remove = (assetId: string) => {
    setCards((c) => c?.filter((x) => x.id !== assetId) ?? null);
    onCount((cards?.length ?? 1) - 1);
    fetch("/api/reference/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, status: "dismissed" }),
    }).catch(() => {});
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-card" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="text-sm font-semibold">Your shot list</div>
      </div>
      {cards === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing saved yet. Swipe right on examples you want to make.
        </p>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-xl bg-card p-3 ring-1 ring-border">
              <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-900">
                {c.thumbUrl || c.mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbUrl ?? undefined} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{c.brand}</span>
                  <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-red-400" aria-label="Remove">
                    <X size={16} />
                  </button>
                </div>
                {c.hookText ? (
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">“{c.hookText}”</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{labelFor("pillar", c.pillar)}</span>
                  <span className="tabular-nums">· {c.daysRunning ?? "?"}d</span>
                  <span className="tabular-nums">· {compact(c.reach)} reach</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────

type View = { name: "pillars" } | { name: "deck"; pillar: PillarSummary } | { name: "saved" };

export default function SwipeClient({
  pillars,
  initialSavedCount,
}: {
  pillars: PillarSummary[];
  initialSavedCount: number;
}) {
  const [view, setView] = useState<View>({ name: "pillars" });
  const [saved, setSaved] = useState(initialSavedCount);

  const withExamples = pillars.filter((p) => p.examples > 0);
  const empty = pillars.filter((p) => p.examples === 0 && p.thinForFleur);

  return (
    <div className="mx-auto min-h-screen w-full max-w-[440px] px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-lg font-semibold">Creator Studio</h1>
          <p className="text-[12px] text-muted-foreground">Proven ads in the pillars you’re thin on</p>
        </div>
        <button
          onClick={() => setView({ name: "saved" })}
          className="relative flex items-center gap-1.5 rounded-full bg-card px-3 py-2 text-sm ring-1 ring-border"
        >
          <Bookmark size={16} />
          <span className="tabular-nums">{saved}</span>
        </button>
      </header>

      {view.name === "pillars" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            {withExamples.map((p) => (
              <button
                key={p.id}
                onClick={() => setView({ name: "deck", pillar: p })}
                className="flex flex-col justify-between rounded-xl bg-card p-4 text-left ring-1 ring-border transition hover:ring-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium leading-snug">{p.label}</span>
                  {p.thinForFleur && <TrendingUp size={15} className="shrink-0 text-amber-400" />}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-2xl font-semibold tabular-nums">{p.examples}</span>
                  <span className="text-[11px] text-muted-foreground">examples</span>
                </div>
                {p.strategicPriority && (
                  <span className="mt-2 w-fit rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary-foreground/90">
                    strategic
                  </span>
                )}
              </button>
            ))}
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <TrendingUp size={13} className="text-amber-400" /> = a pillar your portfolio is thin on
          </p>

          {empty.length > 0 && (
            <div className="rounded-xl border border-dashed border-border p-4">
              <p className="text-[12px] font-medium text-muted-foreground">
                Thin pillars with no examples yet
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {empty.map((p) => p.label).join(", ")} — the corpus needs a deeper or persona-targeted pull to
                fill these.
              </p>
            </div>
          )}
        </div>
      )}

      {view.name === "deck" && (
        <Deck
          pillar={view.pillar}
          onBack={() => setView({ name: "pillars" })}
          onSavedChange={(d) => setSaved((s) => Math.max(0, s + d))}
        />
      )}

      {view.name === "saved" && (
        <SavedList onBack={() => setView({ name: "pillars" })} onCount={setSaved} />
      )}
    </div>
  );
}
