# Creative Intelligence — what it is and how to use it

Written 2026-09-08. Covers what the tool measures, why that measure and not
another, how to run it, and what it cannot tell you.

Read the "What this is not" section before quoting any number from it to
someone else. Several of the obvious readings of this data are wrong.

---

## 1. The question it answers

Fleur runs hundreds of ads. The team's instinct when performance dips is *make
more creative*. The tool exists to sharpen that into a better question: **more
creative of what kind, and where are we already saturated?**

It classifies every video and image in the Meta ad account against a fixed
taxonomy, then reports where the library is concentrated and where it is empty —
overall, and per campaign.

Live at `/tools/creative`. Gated by the **Creative Intelligence** permission
(`canUseCreativeTool`); admins hold it implicitly.

---

## 2. Why diversity, mechanically

This part matters, because the reasoning is widely misreported and the wrong
version leads to the wrong briefs.

**Andromeda is Meta's *retrieval* stage.** It cuts tens of millions of eligible
ads down to roughly a thousand candidates *before* the auction ranks anything.
It never ranks or prices an ad — it only decides which ads are allowed to
compete. Ads sit in a jointly-trained hierarchical index, built coarse-to-fine,
with FLOPs regularisation that explicitly balances the index.

Two consequences follow, and they are the entire basis for this tool:

1. **Near-duplicate creatives land in the same region of the index.** They
   compete with each other for the same retrieval slots instead of widening the
   set of queries the account can be retrieved for.
2. **Genuinely distinct creatives occupy distinct regions**, so the account
   becomes eligible for more, and more varied, retrieval events.

Memento, on the ranking side, retrieves user history using Maximal Marginal
Relevance — similarity traded explicitly against diversity. Redundancy is
discounted there too.

Sources: Meta's Andromeda post (Dec 2024), HSNN `arXiv:2408.06653`,
HILL/MoNN `arXiv:2604.12965`, Memento `arXiv:2605.24051`.

> **A fabricated claim to ignore.** Several agency blogs assert that Andromeda
> performs "real-time vector inference to align an ad's visual Entity ID to a
> user's instantaneous psychological state." No such mechanism appears in any
> Meta paper or post. Nothing in this codebase assumes it. The defensible goal
> is **retrieval coverage**: occupy more distinct territory, and stop paying
> twice for the same ground.

---

## 3. The taxonomy

Defined in `src/lib/creative/taxonomy.ts`. Every asset is classified on eight
axes; four of them are treated as the primary "territory" coordinates.

| Axis | Terms | What it captures |
|---|---|---|
| **Pillar** | 20 | The conceptual territory — the *reason* to care |
| **Persona** | 11 | Who the creative addresses (postpartum, menopause, men's, textured/curly…) |
| **Hook** | 20 | The mechanism of the first 1–3 seconds |
| **Funnel** | 3 | TOF / MOF / BOF |
| Awareness | 5 | Schwartz stage the copy assumes |
| Format | 13 | How it is constructed (talking-head UGC, founder piece, macro…) |
| Production | 5 | UGC-native, studio, animated… |
| Placement fit | 4 | Built for the surface, or repurposed and dropped in |

A **territory** is one `pillar × persona × hook × funnel` cell. There are
~13,200 of them. That number is in the UI deliberately, to stop anyone reading
"we have 900 ads" as "we have covered the space."

Eight pillars are marked `strategicPriority` — mechanism, ingredient spotlight,
myth busting, routine/demo, identity/persona, founder story, product/sensory and
lifestyle/aspirational. These are the ones Fleur's ingredient and science story
lets it own and competitors cannot easily copy, so under-coverage there is
expensive.

The `medical_weight_loss` persona carries a hard compliance note: **never name
GLP-1 drugs, brand names, or injections.** That is a standing Fleur rule and a
Meta policy risk, and it is encoded in the taxonomy rather than left to memory.

---

## 4. How it works

```
Meta ad account  ──►  discover  ──►  CreativeAsset   (deduped)
                                          │
                                          ▼
                        ffmpeg frames + Whisper transcript + ad copy
                                          │
                                          ▼
                                   Claude (vision)
                                          │
                                          ▼
                                   CreativeAnalysis
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
                Portfolio coverage                  Per-campaign grades
```

**Discovery** walks every ad and dedupes on the underlying `video_id` /
`image_hash`. This is the important step: Fleur runs the same video as many
ads — one asset has been seen running as **40 separate ads**. Classifying per
ad would waste model calls and read as 40 occupied territories instead of one.
Roughly 3,900 ads collapse to ~1,360 distinct assets.

**Analysis** samples 8 frames per video, deliberately front-loaded — one at
0.3s, one at 1.2s, then six across the rest — because the hook decides whether
anything else is seen. Whisper transcribes the audio. Claude then reads frames,
transcript **and the ad's own headline and primary text together**, since copy
is part of the creative.

Costs about **41 seconds and $0.03 per asset**.

---

## 5. Running it

Two buttons on `/tools/creative`.

**Pull assets from Meta** — ~4 minutes, free, read-only against Meta. It writes
only to our own database; it never creates, edits or pauses anything in the ad
account. Safe to re-run: existing assets get their ad list refreshed and their
analysis left alone.

**Analyse N remaining** — starts a **server-side** run. Close the tab, refresh,
sleep the laptop; it keeps going. Progress, failure count and ETA are on the
page, and the run can be stopped at any time.

Two details worth knowing if you touch this code:

- Next kills a route handler the instant its client disconnects, so the work is
  deliberately **detached** from the request — the worker holds the promise at
  module scope and answers `202` immediately. An earlier version awaited the
  work inside the handler and died the moment the browser hung up.
- `src/proxy.ts` gates every `/api` route on the session cookie, which blocked
  the internal worker call. The worker therefore lives at
  `/api/cron/creative-worker`, which is already exempt and is where
  `CRON_SECRET`-authed endpoints belong.

`/api/cron/creative-analyze` runs every 10 minutes and revives a run whose
heartbeat has gone stale — a deploy mid-run, a recycled process. It is a no-op
otherwise.

---

## 6. Reading the output

### Campaigns tab

Live campaigns first, with a green dot; toggle for all. Per campaign: a
diversity grade, the axis coverage that produced it, and CPM / CPC / CAC / ROAS.

**The grade is Shannon evenness on each axis, measured against the *whole*
taxonomy** — 20 pillars, 11 personas, 20 hooks, 13 formats — averaged across the
four. Unused terms pull it down exactly as hard as lopsided ones.

> **The bug this replaced, because it will be tempting to reintroduce.** The
> first version computed evenness over only the terms a campaign already used.
> A campaign running two formats split 95/5 scored as "perfectly even across
> two" rather than "missing eleven of thirteen", and graded **A 86** while
> touching 8/20 pillars and 2/13 formats. There was also a separate "breadth"
> term counting distinct territories, which double-counted
> *different-from-each-other* as *covering-the-space*. Both are gone. After the
> fix that campaign is **C 50**, and nothing in the account is an A.

Anything under 4 classified assets reads `n/a` rather than a misleading letter.
The axis fractions are shown next to every grade so it can be audited rather
than trusted — red under 25% of an axis, amber under 50%.

### Coverage, Gaps, Redundancy tabs

- **Coverage** — asset count, spend and CPA per term, with an evenness figure
  and a list of unused terms, for each of the four primary axes.
- **Gaps** — unoccupied territory ranked by strategic pillar, whether the
  persona already converts, and how thin that funnel stage is. Hook is
  deliberately excluded: it is the cheapest axis to vary once a brief exists,
  and including it would bury the list in near-duplicates.
- **Redundancy** — territories holding more than one asset, with the spend
  sitting on the duplicates.

---

## 7. What this is not

**Not a performance predictor.** The five 1–5 scores (hook strength, message
clarity, differentiation, production quality, placement nativeness) are craft
judgements. They are explicitly not forecasts, and the prompt tells the model
not to infer performance.

**Not a substitute for significance testing.** Most cells hold few assets. On
the first 113 analysed only two findings cleared `p<0.05` (myth-busting best,
category-comparison worst); everything else was directional. Check the counts
before acting on a ranking.

**Not complete for every asset.** Meta withholds a downloadable `source` for
roughly **13% of videos** — page-owned and boosted-post videos. Those fall back
to thumbnail-plus-copy: one frame, no transcript. Still classifiable, but weaker,
and the per-axis confidence scores reflect it. Assets with any confidence below
0.5 are flagged `?` in the asset table.

**Compliance flags need triage, not panic.** The classifier is deliberately
conservative and flags most assets for something. The pattern is what matters:
on the first 113, **37 flagged injectable/needle language**, 55 flagged "visible
regrowth", 51 flagged disease-claim wording. The injectables ones breach a
standing Fleur rule and are worth acting on directly.

**The classifier can be wrong.** `CreativeAnalysis` has `reviewedBy` /
`reviewedAt` columns for human correction. Re-running analysis on an asset
clears them.

---

## 8. What it found first time out

From the first 233 assets — which carry ~76% of the account's all-time ad spend,
so this is the part that matters, not a random sample:

- **The problem is monoculture, not duplication.** 98 distinct territories across
  113 classified assets, and 85 of those held exactly one asset. Nobody was
  making fifteen versions of the same ad at the pillar × hook level.
- **The sameness is one level up.** 81% talking-head UGC, 94% UGC-native, 65%
  addressed to "general thinning" or no persona at all, and **1 of 113 assets
  was bottom-of-funnel**.
- **Four of twenty pillars had never been made**: science & authority,
  scarcity/urgency, guarantee/risk-reversal, founder story.
- **The July creator brief worked, was followed, and saturated.** Its headline
  recommendation — the minoxidil-vs-peptides wedge — is now the
  worst-performing pillar in the account at $152 CPA (`z = −4.09`), while
  myth-busting is the best at $73 (`z = +2.28`).
- **The best territory was under-exploited, not over-produced.** The
  myth-busting win is essentially one hook aimed at men, and there were two
  assets in it.

The brief that follows from this assigns creators **coordinates** — pillar ×
persona × hook × format — rather than topics. The previous brief told everyone
what to say, and they all said it, in the same format.

---

## 9. Files

| Path | Purpose |
|---|---|
| `src/lib/creative/taxonomy.ts` | The vocabulary. Start here. |
| `src/lib/creative/ingest.ts` | Meta walk + asset dedupe |
| `src/lib/creative/analyze.ts` | Frames, transcript, classification |
| `src/lib/creative/worker.ts` | Server-side run, detached from any request |
| `src/lib/creative/coverage.ts` | Evenness, Herfindahl, redundancy, gaps |
| `src/lib/creative/campaigns.ts` | Per-campaign grades joined to delivery |
| `src/lib/creative/portfolio.ts` | The portfolio read, shared by page and API |
| `src/app/tools/creative/` | UI |
| `src/app/api/creative/` | discover / analyze / portfolio / campaigns |
| `src/app/api/cron/creative-worker` | The worker link (CRON_SECRET) |
| `src/app/api/cron/creative-analyze` | Stale-run sweep, every 10 min |

Requires `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `ANTHROPIC_API_KEY`,
`CRON_SECRET`, and `OPENAI_API_KEY` for transcription. **If the OpenAI key is
missing, transcription returns empty silently rather than erroring** and every
classification quietly degrades to visual-only — worth checking before a large
run.

---

## 10. Related

- `docs/creator-brief-data-driven.md` — the July 2026 brief. Useful history, and
  the direct cause of the monoculture described above. Do not re-issue it as-is.
- `CAMPAIGN_STATE.md` — the ad account's source of truth. Read it before
  changing anything in Meta.
