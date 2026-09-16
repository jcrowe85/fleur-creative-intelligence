"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

interface Status {
  overridden: boolean;
  updatedAt: string | null;
  chars: number;
}

/** Rough word count, so the editor shows the same units the briefs are judged in. */
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

export default function FactsClient() {
  const [text, setText] = useState("");
  const [shipped, setShipped] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  // The alive-flag pattern the creator app already uses, rather than an async
  // callback invoked from the effect: setting state straight from an effect
  // body is what react-hooks/set-state-in-effect catches, and the flag also
  // stops a slow response landing on an unmounted component.
  useEffect(() => {
    let alive = true;
    fetch("/api/product-facts")
      .then(async (r) => {
        if (!r.ok) {
          throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't load the facts");
        }
        return (await r.json()) as { markdown: string; shipped: string; status: Status };
      })
      .then((d) => {
        if (!alive) return;
        setText(d.markdown);
        setSaved(d.markdown);
        setShipped(d.shipped);
        setStatus(d.status);
        setBusy(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fetch("/api/product-facts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: text }),
      });
      const d = (await r.json()) as { markdown?: string; status?: Status; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Couldn't save");
      setText(d.markdown ?? text);
      setSaved(d.markdown ?? text);
      setStatus(d.status ?? null);
      setNote("Saved. The next brief is written against this.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dirty = text !== saved;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">Product facts</h1>
          <Link
            href="/"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Dashboard
          </Link>
        </div>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Everything a creator brief is allowed to say about Bloom comes from this page — prices,
          plans, and which claims are safe, on hold, or never. Editing here changes the next brief
          that gets written. No deploy.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            "rounded px-2 py-1 font-medium " +
            (status?.overridden
              ? "bg-amber-500/15 text-amber-400"
              : "bg-muted text-muted-foreground")
          }
        >
          {status?.overridden ? "Edited" : "As shipped"}
        </span>
        {status?.updatedAt ? (
          <span className="text-muted-foreground">
            last changed {new Date(status.updatedAt).toLocaleString()}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {words(text).toLocaleString()} words · {text.length.toLocaleString()} characters
        </span>
        {dirty ? <span className="text-amber-400">unsaved changes</span> : null}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-300">
          {note}
        </p>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            disabled={busy}
            className="h-[62vh] w-full resize-y rounded-lg bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-foreground outline-none disabled:opacity-60"
          />
        </CardContent>
      </Card>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy || !dirty || !text.trim()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-40"
        >
          {busy ? "Working…" : "Save"}
        </button>
        <button
          onClick={() => {
            setText(saved);
            setNote(null);
            setError(null);
          }}
          disabled={busy || !dirty}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          Discard changes
        </button>
        {/* The shipped copy comes down with every GET, so reverting never depends
            on anyone having kept one. */}
        <button
          onClick={() => {
            setText(shipped);
            setNote(null);
            setError(null);
            area.current?.focus();
          }}
          disabled={busy || text === shipped}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          Restore the shipped copy
        </button>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Empty facts are refused: a brief written against nothing would invent what it needs. If a
        save fails, what is live stays live.
      </p>
    </div>
  );
}
