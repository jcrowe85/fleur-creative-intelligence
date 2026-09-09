# Fleur Creative Intelligence

Classifies every video and image in the Meta ad account against a fixed
taxonomy — pillar, persona, hook, funnel stage, awareness, format, production
and placement fit — then reports where the creative portfolio is concentrated
and where it is empty, overall and per campaign.

Split out of `fleur-financials` so it can be worked on without any access to
sales, order, customer or user data. **This app has its own database and syncs
the Meta data it needs directly from the Meta API. It never reads the financials
database, and nothing here can reach it.**

## What it holds

| Data | Source |
|---|---|
| Creative assets and their classifications | This app (Meta creative + Claude) |
| Meta entity tree — campaigns, ad sets, ads | Meta Marketing API, hourly cron |
| Meta delivery — spend, purchases, revenue | Meta Marketing API, hourly cron |
| Users and sessions | This app's own login |

No Shopify data. No Amazon data. No customer records. No financial aggregates.

## Getting started

Secrets live in **Infisical** (project `fleur-creative-intelligence`), not in a
file on disk. `.env.example` documents the shape; the CLI injects the real
values at launch.

```bash
infisical login                # once per machine
infisical init                 # links the repo — already done, .infisical.json is committed
npm install
npm run db:migrate             # apply migrations
npm run dev                    # runs against the `dev` environment
```

`npm run dev:prod` runs against `prod`. Every `db:*` script targets `dev` except
`db:deploy`, which is the only one that touches the production database.

Then open http://localhost:3000, sign in, and use the two buttons:

1. **Pull assets from Meta** — walks the ad account, dedupes on the underlying
   video/image, ~4 minutes. Read-only against Meta.
2. **Analyse N remaining** — starts a server-side run. Safe to close the tab.

## Docs

`docs/creative-intelligence.md` — what the tool measures, why that measure, how
to read the output, and what it cannot tell you. **Read the "What this is not"
section before quoting any number from it.**

## Deployment

Vercel. Two crons are declared in `vercel.json`:

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/meta-sync?days=7` | hourly at :20 | Refresh entity tree + delivery |
| `/api/cron/creative-analyze` | every 10 min | Revive a stalled analysis run |

Both authenticate with `CRON_SECRET`.
