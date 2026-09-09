import { buildPortfolio } from "@/lib/creative/portfolio";
import { campaignCreatives } from "@/lib/creative/campaigns";
import { getRunState } from "@/lib/creative/worker";
import { requireUser } from "@/lib/dal";
import CreativeClient from "./CreativeClient";

// Rendered per request: the portfolio, the campaign view and the run state all
// change while the analyser works.
export const dynamic = "force-dynamic";

export default async function Page() {
  await requireUser();
  const [initial, runState, initialCampaigns] = await Promise.all([
    buildPortfolio(),
    getRunState(),
    campaignCreatives(),
  ]);
  const initialRun = {
    ...runState,
    startedAt: runState.startedAt?.toISOString() ?? null,
    heartbeatAt: undefined,
  };
  return (
    <CreativeClient
      initial={initial}
      initialRun={initialRun}
      initialCampaigns={initialCampaigns}
    />
  );
}
